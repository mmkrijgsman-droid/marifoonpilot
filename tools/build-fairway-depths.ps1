$ErrorActionPreference = 'Stop'

$project = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$base = 'https://geo.rijkswaterstaat.nl/services/ogc/gdr/fis_vnds/ogc/features/v1/collections'

function Get-CompleteCollection([string]$name, [int]$minimum) {
  Write-Output "RWS FIS/VNDS $name ophalen..."
  $response = Invoke-RestMethod -Uri "$base/$name/items?f=json&limit=10000" -TimeoutSec 120
  if (-not $response.features -or $response.numberReturned -lt $minimum) {
    throw "Verdacht weinig objecten in ${name}: $($response.numberReturned)."
  }
  if ($response.numberMatched -gt $response.numberReturned) {
    throw "Onvolledige download van ${name}: $($response.numberReturned) van $($response.numberMatched)."
  }
  return $response
}

function Convert-Line($coordinates) {
  $flat = New-Object System.Collections.ArrayList
  $previousLon = $null
  $previousLat = $null
  for ($i = 0; $i -lt $coordinates.Count; $i++) {
    $lon = [math]::Round([double]$coordinates[$i][0], 5)
    $lat = [math]::Round([double]$coordinates[$i][1], 5)
    $last = $i -eq ($coordinates.Count - 1)
    # Verwijder alleen vrijwel identieke opeenvolgende meetpunten. De lijn blijft daarmee
    # nautisch herkenbaar, terwijl het gegenereerde browserbestand aanzienlijk kleiner is.
    if (-not $last -and $null -ne $previousLon -and
        [math]::Abs($lon - $previousLon) -lt 0.00005 -and
        [math]::Abs($lat - $previousLat) -lt 0.00005) { continue }
    [void]$flat.Add($lon)
    [void]$flat.Add($lat)
    $previousLon = $lon
    $previousLat = $lat
  }
  return ,@($flat)
}

function Get-Midpoint($flat) {
  $pairs = [int]($flat.Count / 2)
  $index = [math]::Floor(($pairs - 1) / 2) * 2
  return @($flat[$index + 1], $flat[$index]) # Leaflet-volgorde: lat, lon
}

$routesResponse = Get-CompleteCollection 'route' 1800
$depthResponse = Get-CompleteCollection 'vaarwegdiepte' 1200
$draftResponse = Get-CompleteCollection 'max_toegestane_afmeting' 500

$routeNames = @{}
foreach ($feature in $routesResponse.features) {
  $routeNames[[string]$feature.properties.id] = ([string]$feature.properties.name -replace '\s+', ' ').Trim()
}

$depthRows = New-Object System.Collections.ArrayList
foreach ($feature in $depthResponse.features) {
  $p = $feature.properties
  if (-not $feature.geometry -or $feature.geometry.type -ne 'LineString') { continue }
  if ($null -eq $p.minimaldepthlowerlimit -or $null -eq $p.minimaldepthupperlimit) { continue }
  $lower = [double]$p.minimaldepthlowerlimit
  $upper = [double]$p.minimaldepthupperlimit
  if ($lower -le -90 -or $upper -le -90) { continue } # FIS-onbekendwaarde -99,99
  $line = Convert-Line $feature.geometry.coordinates
  if ($line.Count -lt 4) { continue }
  [void]$depthRows.Add([ordered]@{
    id    = "rws-depth-$($p.id)"
    route = $routeNames[[string]$p.routeid]
    lo    = [math]::Round($lower, 2)
    hi    = [math]::Round($upper, 2)
    ref   = ([string]$p.referencelevel).Trim()
    km    = @([math]::Round([double]$p.routekmbegin, 3), [math]::Round([double]$p.routekmend, 3))
    mid   = Get-Midpoint $line
    line  = $line
  })
}

$draftRows = New-Object System.Collections.ArrayList
foreach ($feature in $draftResponse.features) {
  $p = $feature.properties
  if (-not $feature.geometry -or $feature.geometry.type -ne 'LineString') { continue }
  if ($null -eq $p.generaldepth) { continue }
  $draft = [double]$p.generaldepth
  if ($draft -le 0 -or $draft -gt 40) { continue }
  $line = Convert-Line $feature.geometry.coordinates
  if ($line.Count -lt 4) { continue }
  [void]$draftRows.Add([ordered]@{
    id    = "rws-draft-$($p.id)"
    route = $routeNames[[string]$p.routeid]
    draft = [math]::Round($draft, 2)
    km    = @([math]::Round([double]$p.routekmbegin, 3), [math]::Round([double]$p.routekmend, 3))
    note  = (([string]$p.note -replace '\s+', ' ').Trim())
    mid   = Get-Midpoint $line
    line  = $line
  })
}

if ($depthRows.Count -lt 1200 -or $draftRows.Count -lt 500) {
  throw "Validatie mislukt: $($depthRows.Count) dieptetrajecten en $($draftRows.Count) diepgangstrajecten."
}

$date = Get-Date -Format 'yyyy-MM-dd'
$builder = New-Object System.Text.StringBuilder
[void]$builder.AppendLine('/* MarifoonPilot - landelijke vaarwegdiepten (GEGENEREERD, niet handmatig aanpassen)')
[void]$builder.AppendLine(' * Bron: Rijkswaterstaat FIS/VNDS, collecties vaarwegdiepte, max_toegestane_afmeting en route.')
[void]$builder.AppendLine(" * Opgehaald: $date. $($depthRows.Count) bodem-/dieptetrajecten; $($draftRows.Count) max.-diepgangstrajecten.")
[void]$builder.AppendLine(' * De getekende vaarwegdiepte is een niveau/range t.o.v. het vermelde referentievlak;')
[void]$builder.AppendLine(' * maximale diepgang is een vaarwegbeperking. Geen van beide is een actuele loding.')
[void]$builder.AppendLine(' */')
[void]$builder.AppendLine('"use strict";')
[void]$builder.AppendLine("const RWS_FAIRWAY_DEPTH_META = {source:`"Rijkswaterstaat FIS/VNDS`",retrieved:`"$date`",depthCount:$($depthRows.Count),draftCount:$($draftRows.Count)};")
[void]$builder.AppendLine('const RWS_FAIRWAY_DEPTHS = [')
foreach ($row in ($depthRows | Sort-Object route, {$_['km'][0]})) {
  [void]$builder.Append('  ')
  [void]$builder.Append(($row | ConvertTo-Json -Compress -Depth 6))
  [void]$builder.AppendLine(',')
}
[void]$builder.AppendLine('];')
[void]$builder.AppendLine('const RWS_MAX_DRAFTS = [')
foreach ($row in ($draftRows | Sort-Object route, {$_['km'][0]})) {
  [void]$builder.Append('  ')
  [void]$builder.Append(($row | ConvertTo-Json -Compress -Depth 6))
  [void]$builder.AppendLine(',')
}
[void]$builder.AppendLine('];')

$target = Join-Path $project 'fairway-depths.js'
[System.IO.File]::WriteAllText($target, $builder.ToString(), [System.Text.UTF8Encoding]::new($false))
Write-Output "Geschreven: $target ($($depthRows.Count) dieptetrajecten; $($draftRows.Count) maximale diepgangen)"
