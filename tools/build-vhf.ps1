$ErrorActionPreference = 'Stop'

$project = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$base = 'https://geo.rijkswaterstaat.nl/services/ogc/gdr/fis_vnds/ogc/features/v1/collections'
$endpoint = "$base/meldpunt/items?f=json&limit=10000"
$allowedTypes = @('bridge', 'lock', 'vtssector')
$typeMap = @{ bridge = 'brug'; lock = 'sluis'; vtssector = 'vts' }

Write-Output 'Landelijke RWS FIS/VNDS-meldpunten ophalen...'
$response = Invoke-RestMethod -Uri $endpoint -TimeoutSec 90
$centreResponse = Invoke-RestMethod -Uri "$base/vts_centrales/items?f=json&limit=100" -TimeoutSec 90
$sectorResponse = Invoke-RestMethod -Uri "$base/vts_deelsector_v/items?f=json&limit=100" -TimeoutSec 90
if (-not $response.features -or $response.numberReturned -lt 1) {
  throw 'Rijkswaterstaat gaf geen meldpunten terug.'
}
if ($response.numberMatched -gt $response.numberReturned) {
  throw "Onvolledige download: $($response.numberReturned) van $($response.numberMatched) objecten."
}
if ($centreResponse.numberMatched -gt $centreResponse.numberReturned -or $sectorResponse.numberMatched -gt $sectorResponse.numberReturned) {
  throw 'Onvolledige download van VTS-centrales of sectoren.'
}

$rows = New-Object System.Collections.ArrayList
foreach ($feature in $response.features) {
  $p = $feature.properties
  if ($p.parentgeotype -notin $allowedTypes) { continue }
  if (-not $feature.geometry -or $feature.geometry.type -ne 'Point') { continue }

  try { $parsedChannels = ConvertFrom-Json -InputObject ([string]$p.vhfchannels) }
  catch { $parsedChannels = @() }
  $channels = New-Object System.Collections.ArrayList
  foreach ($raw in $parsedChannels) {
    $channel = ([string]$raw).Trim()
    if ($channel -notmatch '^\d{1,2}$') { continue }
    $number = [int]$channel
    if ($number -lt 1 -or $number -gt 88) { continue }
    if ($channels -notcontains $channel) { [void]$channels.Add($channel) }
  }
  if ($channels.Count -eq 0) { continue }

  $coordinates = $feature.geometry.coordinates
  if ($coordinates.Count -lt 2) { continue }
  $lon = [double]$coordinates[0]
  $lat = [double]$coordinates[1]
  if ($lat -lt 50.5 -or $lat -gt 54.2 -or $lon -lt 2.8 -or $lon -gt 7.7) { continue }

  $name = ([string]$p.name -replace '^Meldpunt\s+', '' -replace '\s+', ' ').Trim()
  if (-not $name) { $name = 'VHF-meldpunt' }
  $note = ([string]$p.note -replace '\s+', ' ').Trim()
  if ($note -eq '-') { $note = '' }

  [void]$rows.Add([ordered]@{
    id       = "rws-$($p.id)"
    parentId = [string]$p.parentid
    name     = $name
    type     = $typeMap[[string]$p.parentgeotype]
    channel  = ($channels -join '/')
    channels = @($channels)
    lat      = [math]::Round($lat, 5)
    lon      = [math]::Round($lon, 5)
    radius   = if ($p.parentgeotype -eq 'vtssector') { 1000 } elseif ($p.parentgeotype -eq 'lock') { 600 } else { 500 }
    status   = ([string]$p.radiostatus).ToLowerInvariant()
    note     = $note
  })
}

if ($rows.Count -lt 500) {
  throw "Verdacht weinig bruikbare VHF-meldpunten: $($rows.Count). Bestand niet vervangen."
}

$centres = New-Object System.Collections.ArrayList
foreach ($feature in $centreResponse.features) {
  if (-not $feature.geometry -or $feature.geometry.type -ne 'Point') { continue }
  $p = $feature.properties
  $linked = @($sectorResponse.features | Where-Object { $_.properties.headofficeid -eq $p.id })
  $channels = @($linked | ForEach-Object { ([string]$_.properties.vhfchannel).Trim() } |
    Where-Object { $_ -match '^\d{1,2}$' -and [int]$_ -ge 1 -and [int]$_ -le 88 } | Sort-Object -Unique)
  $coordinates = $feature.geometry.coordinates
  [void]$centres.Add([ordered]@{
    id       = "rws-vts-$($p.id)"
    name     = ([string]$p.name -replace '\s+', ' ').Trim()
    city     = ([string]$p.city -replace '\s+', ' ').Trim()
    channels = $channels
    channel  = ($channels -join '/')
    lat      = [math]::Round([double]$coordinates[1], 5)
    lon      = [math]::Round([double]$coordinates[0], 5)
    phone    = ([string]$p.telephonenumber).Trim()
  })
}

$counts = $rows | Group-Object { $_['type'] } | ForEach-Object { "$($_.Name)=$($_.Count)" }
$date = Get-Date -Format 'yyyy-MM-dd'
$builder = New-Object System.Text.StringBuilder
[void]$builder.AppendLine('/* MarifoonPilot - landelijke VHF-meldpunten (GEGENEREERD, niet handmatig aanpassen)')
[void]$builder.AppendLine(' * Bron: Rijkswaterstaat FIS/VNDS, collectie meldpunt.')
[void]$builder.AppendLine(" * Opgehaald: $date. $($counts -join ', ').")
[void]$builder.AppendLine(' * Alleen bruggen, sluizen en VTS-sectoren met een numeriek VHF-kanaal zijn opgenomen.')
[void]$builder.AppendLine(' * Controleer bij het varen altijd de actuele officiele vaarweginformatie.')
[void]$builder.AppendLine(' */')
[void]$builder.AppendLine('"use strict";')
[void]$builder.AppendLine("const RWS_VHF_META = {source:`"Rijkswaterstaat FIS/VNDS`",retrieved:`"$date`",count:$($rows.Count)};")
[void]$builder.AppendLine('const RWS_VHF_POINTS = [')
foreach ($row in ($rows | Sort-Object type, name, lat, lon)) {
  [void]$builder.Append('  ')
  [void]$builder.Append(($row | ConvertTo-Json -Compress -Depth 4))
  [void]$builder.AppendLine(',')
}
[void]$builder.AppendLine('];')
[void]$builder.AppendLine('const RWS_VTS_CENTRES = [')
foreach ($centre in ($centres | Sort-Object name)) {
  [void]$builder.Append('  ')
  [void]$builder.Append(($centre | ConvertTo-Json -Compress -Depth 4))
  [void]$builder.AppendLine(',')
}
[void]$builder.AppendLine('];')

$target = Join-Path $project 'vhf-points.js'
[System.IO.File]::WriteAllText($target, $builder.ToString(), [System.Text.UTF8Encoding]::new($false))
Write-Output "Geschreven: $target ($($rows.Count) punten; $($centres.Count) VTS-centrales; $($counts -join ', '))"
