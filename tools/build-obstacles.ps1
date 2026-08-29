$ErrorActionPreference = 'Stop'
$scratch = (Split-Path -Parent $MyInvocation.MyCommand.Path)
$proj    = (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))

$j = Get-Content "$scratch\overpass-raw.json" -Raw -Encoding UTF8 | ConvertFrom-Json
Write-Output "ingelezen: $($j.elements.Count) elementen"

function Get-Coord($e) {
  if ($null -ne $e.lat) { return @($e.lat, $e.lon) }
  if ($null -ne $e.center) { return @($e.center.lat, $e.center.lon) }
  return $null
}
function Get-Height($v) {
  if (-not $v) { return $null }
  $s = ([string]$v).Trim()
  if ($s -in @('unknown','none','')) { return $null }
  $s = $s -replace '\s*m$',''      # "5.7 m" -> "5.7"
  $d = 0.0
  # LET OP: uitsluitend InvariantCulture. OSM schrijft 5.7 met een punt; onder de Nederlandse
  # locale leest TryParse die punt als duizendtalscheiding en maakt er 57 van.
  if ([double]::TryParse($s, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$d)) {
    if ($d -gt 0 -and $d -lt 100) { return [math]::Round($d,2) }
  }
  return $null
}

$bridges = New-Object System.Collections.ArrayList
$locks   = New-Object System.Collections.ArrayList
$marinas = New-Object System.Collections.ArrayList

foreach ($e in $j.elements) {
  $c = Get-Coord $e
  if (-not $c) { continue }
  $t = $e.tags
  $name = $t.name; if (-not $name) { $name = $t.'seamark:name' }
  if ($name) { $name = ([string]$name -replace '^name=','').Trim() }

  if ($e._cat -eq 'bridge') {
    $cat = [string]$t.'seamark:bridge:category'
    $isFixed = ($cat -eq 'fixed')
    # vaste brug -> clearance_height; beweegbaar -> clearance_height_closed
    $h = if ($isFixed) { Get-Height $t.'seamark:bridge:clearance_height' }
         else { Get-Height $t.'seamark:bridge:clearance_height_closed' }
    if ($null -eq $h) { $h = Get-Height $t.'seamark:bridge:clearance_height' }
    if ($null -eq $h) { $h = Get-Height $t.maxheight }
    # ruis weren: naamloos EN zonder hoogte heeft geen waarde voor de planner
    if (-not $name -and $null -eq $h) { continue }
    [void]$bridges.Add([pscustomobject]@{
      name = $name; lat = [math]::Round($c[0],5); lon = [math]::Round($c[1],5)
      clearance = $h; opens = (-not $isFixed); cat = $cat
      osm = "$($e.type)/$($e.id)"
      src = if ($t.'seamark:source' -like '*vaarweginformatie*') { 'rws' } else { 'osm' }
    })
  }
  elseif ($e._cat -eq 'lock') {
    if (-not $name) { continue }
    [void]$locks.Add([pscustomobject]@{
      name = $name; lat = [math]::Round($c[0],5); lon = [math]::Round($c[1],5)
      osm = "$($e.type)/$($e.id)"
    })
  }
  elseif ($e._cat -eq 'marina') {
    if (-not $name) { continue }
    [void]$marinas.Add([pscustomobject]@{
      name = $name; lat = [math]::Round($c[0],5); lon = [math]::Round($c[1],5)
      osm = "$($e.type)/$($e.id)"
    })
  }
}
Write-Output "na filter: bruggen=$($bridges.Count) sluizen=$($locks.Count) havens=$($marinas.Count)"

# --- ontdubbelen: zelfde object staat vaak als node EN way, en een sluis heeft meerdere deuren ---
function Merge-Near($items, $meters) {
  $res = New-Object System.Collections.ArrayList
  foreach ($it in ($items | Sort-Object { if ($_.clearance -ne $null) { 0 } else { 1 } })) {
    $dup = $false
    foreach ($r in $res) {
      $dLat = ($it.lat - $r.lat) * 111320
      $dLon = ($it.lon - $r.lon) * 111320 * [math]::Cos($it.lat * [math]::PI / 180)
      if ([math]::Sqrt($dLat*$dLat + $dLon*$dLon) -lt $meters) {
        # zelfde object: vul ontbrekende gegevens aan
        if ($null -eq $r.clearance -and $null -ne $it.clearance) { $r.clearance = $it.clearance }
        if (-not $r.name -and $it.name) { $r.name = $it.name }
        $dup = $true; break
      }
    }
    if (-not $dup) { [void]$res.Add($it) }
  }
  return $res
}
$bridges = Merge-Near $bridges 120
$locks   = Merge-Near $locks   250
$marinas = Merge-Near $marinas 300
Write-Output "na ontdubbelen: bruggen=$($bridges.Count) sluizen=$($locks.Count) havens=$($marinas.Count)"

$metH = @($bridges | Where-Object { $null -ne $_.clearance }).Count
Write-Output "bruggen met doorvaarthoogte: $metH van $($bridges.Count)"

# --- JS-bestand schrijven ---
$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine("/* MarifoonPilot - vaarwegobstakels (GEGENEREERD, niet met de hand aanpassen)")
[void]$sb.AppendLine(" *")
[void]$sb.AppendLine(" * Bron: OpenStreetMap via de Overpass API, opgehaald $(Get-Date -Format 'yyyy-MM-dd').")
[void]$sb.AppendLine(" * Data (c) OpenStreetMap-bijdragers, licentie ODbL - https://www.openstreetmap.org/copyright")
[void]$sb.AppendLine(" * Een deel is in OSM overgenomen uit Rijkswaterstaat Vaarweginformatie (src:'rws').")
[void]$sb.AppendLine(" *")
[void]$sb.AppendLine(" * Deze lijst voedt ALLEEN de routeplanning (wachttijd + doorvaarthoogte).")
[void]$sb.AppendLine(" * Het marifoonkanaal-advies blijft uitsluitend uit de geverifieerde POINTS in data.js komen,")
[void]$sb.AppendLine(" * omdat OSM geen betrouwbare marifoonkanalen bevat.")
[void]$sb.AppendLine(" *")
[void]$sb.AppendLine(" * clearance = doorvaarthoogte in meters die je zonder brugopening hebt (null = onbekend;")
[void]$sb.AppendLine(" *             de app rekent dan altijd met openen en meldt dat de hoogte onzeker is).")
[void]$sb.AppendLine(" * opens     = true bij een beweegbare brug, false bij een vaste brug.")
[void]$sb.AppendLine(" */")
[void]$sb.AppendLine('"use strict";')
[void]$sb.AppendLine("const OBSTACLES = [")
foreach ($b in ($bridges | Sort-Object lat)) {
  $nm = ($b.name -replace '"','\"'); if (-not $nm) { $nm = 'Naamloze brug' }
  $cl = if ($null -eq $b.clearance) { 'null' } else { ([string]$b.clearance -replace ',','.') }
  $op = if ($b.opens) { 'true' } else { 'false' }
  [void]$sb.AppendLine("  {t:`"brug`",n:`"$nm`",lat:$($b.lat.ToString([Globalization.CultureInfo]::InvariantCulture)),lon:$($b.lon.ToString([Globalization.CultureInfo]::InvariantCulture)),c:$cl,o:$op,s:`"$($b.src)`",id:`"$($b.osm)`"},")
}
foreach ($l in ($locks | Sort-Object lat)) {
  $nm = ($l.name -replace '"','\"')
  [void]$sb.AppendLine("  {t:`"sluis`",n:`"$nm`",lat:$($l.lat.ToString([Globalization.CultureInfo]::InvariantCulture)),lon:$($l.lon.ToString([Globalization.CultureInfo]::InvariantCulture)),c:null,o:true,s:`"osm`",id:`"$($l.osm)`"},")
}
[void]$sb.AppendLine("];")
[void]$sb.AppendLine("const OSM_MARINAS = [")
foreach ($m in ($marinas | Sort-Object lat)) {
  $nm = ($m.name -replace '"','\"')
  [void]$sb.AppendLine("  {n:`"$nm`",lat:$($m.lat.ToString([Globalization.CultureInfo]::InvariantCulture)),lon:$($m.lon.ToString([Globalization.CultureInfo]::InvariantCulture)),id:`"$($m.osm)`"},")
}
[void]$sb.AppendLine("];")

[System.IO.File]::WriteAllText("$proj\obstacles.js", $sb.ToString(), [System.Text.UTF8Encoding]::new($false))
Write-Output "geschreven: $proj\obstacles.js  ($([math]::Round((Get-Item "$proj\obstacles.js").Length/1kb,1)) kB)"
