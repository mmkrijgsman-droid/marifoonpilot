$ErrorActionPreference = 'Stop'
$out = (Split-Path -Parent $MyInvocation.MyCommand.Path)
$UA  = 'MarifoonPilot/2.8 (open data fetch; contact djurre@huizevisser.nl)'

# Eén gecombineerde query per gebied houdt het aantal requests laag -> minder rate limiting.
# Volgorde op belang: Randmeren en IJsselmeer eerst, Wadden daarna.
$regions = [ordered]@{
  'randmeren'        = '52.20,5.05,52.65,6.05'
  'ijsselmeer-zuid'  = '52.45,5.05,52.80,5.75'
  'ketel-zwarte'     = '52.50,5.55,52.75,6.15'
  'ijsselmeer-noord' = '52.75,4.95,53.15,5.75'
  'wadden-west'      = '52.85,4.55,53.30,5.45'
  'wadden-midden'    = '53.05,5.30,53.50,6.20'
  'wadden-oost'      = '53.20,6.00,53.55,7.05'
}

$endpoints = @(
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
)

function Invoke-Overpass($q) {
  foreach ($ep in $endpoints) {
    for ($try = 1; $try -le 4; $try++) {
      try {
        $body = "data=" + [System.Uri]::EscapeDataString($q)
        $r = Invoke-WebRequest -Uri $ep -Method Post -Body $body `
               -ContentType 'application/x-www-form-urlencoded; charset=utf-8' `
               -Headers @{ 'User-Agent' = $UA } -TimeoutSec 240 -UseBasicParsing
        # NIET $r.Content gebruiken: zonder charset-header decodeert PowerShell als ISO-8859-1,
        # waardoor namen als "Lorebrug" met een accent dubbel gecodeerd raken. Zelf UTF-8 doen.
        $txt = if ($r.Content -is [byte[]]) { [System.Text.Encoding]::UTF8.GetString($r.Content) }
               elseif ($r.RawContentStream) { [System.Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray()) }
               else { [string]$r.Content }
        if ($txt.TrimStart().StartsWith('{')) {
          try { $null = $txt | ConvertFrom-Json; return $txt } catch { Write-Host '    ! ongeldige JSON' }
        } else { Write-Host '    ! geen JSON terug' }
      } catch {
        Write-Host ("    ! {0} poging {1}: {2}" -f ($ep -replace 'https://([^/]+).*','$1'), $try, $_.Exception.Message)
      }
      Start-Sleep -Seconds (25 * $try)   # Overpass wil rust tussen zware queries
    }
  }
  return $null
}

# hervatten: al opgehaalde elementen behouden
$all = New-Object System.Collections.ArrayList
$seen = @{}
$doneRegions = @{}
if (Test-Path "$out\overpass-raw.json") {
  $prev = Get-Content "$out\overpass-raw.json" -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($e in $prev.elements) {
    $k = "$($e.type)/$($e.id)"
    if (-not $seen.ContainsKey($k)) { $seen[$k] = $true; [void]$all.Add($e) }
  }
  if ($prev.regions) { foreach ($r in $prev.regions) { $doneRegions[$r] = $true } }
  Write-Output "hervat met $($all.Count) elementen, gebieden klaar: $($doneRegions.Keys -join ', ')"
}

foreach ($rk in $regions.Keys) {
  if ($doneRegions.ContainsKey($rk)) { Write-Output "$rk : overslaan (al klaar)"; continue }
  $b = $regions[$rk]
  $q = @"
[out:json][timeout:240];
(
  node["seamark:type"="bridge"]($b);
  way["seamark:type"="bridge"]($b);
  node["waterway"="lock_gate"]($b);
  way["waterway"="lock_gate"]($b);
  node["seamark:type"="gate"]($b);
  node["leisure"="marina"]($b);
  way["leisure"="marina"]($b);
);
out center tags;
"@
  Write-Output "$rk ..."
  $txt = Invoke-Overpass $q
  if (-not $txt) { Write-Output "  MISLUKT"; continue }
  $j = $txt | ConvertFrom-Json
  $n = 0
  foreach ($e in $j.elements) {
    $k = "$($e.type)/$($e.id)"
    if ($seen.ContainsKey($k)) { continue }
    $seen[$k] = $true
    $cat = if ($e.tags.'seamark:type' -eq 'bridge' -or $e.tags.'bridge:movable') { 'bridge' }
           elseif ($e.tags.leisure -eq 'marina') { 'marina' } else { 'lock' }
    $e | Add-Member -NotePropertyName _cat -NotePropertyValue $cat -Force
    [void]$all.Add($e); $n++
  }
  $doneRegions[$rk] = $true
  Write-Output ("  +{0} nieuw (totaal {1})" -f $n, $all.Count)
  $partial = @{ fetched=(Get-Date -Format 'yyyy-MM-dd'); regions=@($doneRegions.Keys); count=$all.Count; elements=$all } | ConvertTo-Json -Depth 12
  [System.IO.File]::WriteAllText("$out\overpass-raw.json", $partial, [System.Text.UTF8Encoding]::new($false))
  Start-Sleep -Seconds 20
}

Write-Output "`nKLAAR: $($all.Count) elementen"
Write-Output ("bruggen={0} sluizen={1} havens={2}" -f `
  @($all | Where-Object {$_._cat -eq 'bridge'}).Count, `
  @($all | Where-Object {$_._cat -eq 'lock'}).Count, `
  @($all | Where-Object {$_._cat -eq 'marina'}).Count)
