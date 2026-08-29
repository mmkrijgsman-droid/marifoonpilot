$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$proj = Split-Path -Parent $here
$UA   = 'MarifoonPilot/2.9 (open data fetch; contact djurre@huizevisser.nl)'

# Live meetstations van Rijkswaterstaat Waterinfo. Alleen de STATIONLIJST wordt hier
# vastgelegd (die verandert zelden); de app haalt de actuele standen zelf op.
$url = 'https://waterinfo.rws.nl/api/point/latestmeasurement?parameterId=waterhoogte'
$r = Invoke-WebRequest -Uri $url -Headers @{ 'User-Agent'=$UA; 'Accept'='application/json' } -TimeoutSec 120 -UseBasicParsing
$txt = if ($r.Content -is [byte[]]) { [System.Text.Encoding]::UTF8.GetString($r.Content) } else { [string]$r.Content }
$j = $txt | ConvertFrom-Json
Write-Output "stations opgehaald: $($j.features.Count)"

# --- inverse UTM (EPSG:25831 = ETRS89 / UTM zone 31N) naar WGS84 ---
# ETRS89 gebruikt GRS80; die is voor onze doeleinden gelijk aan WGS84 (verschil < 1 mm).
function Convert-UtmToWgs84($easting, $northing, $zone = 31) {
  $a = 6378137.0; $f = 1.0 / 298.257222101; $k0 = 0.9996
  $e2 = $f * (2 - $f); $e1sq = $e2 / (1 - $e2)
  $x = $easting - 500000.0; $y = $northing
  $m  = $y / $k0
  $mu = $m / ($a * (1 - $e2/4 - 3*$e2*$e2/64 - 5*[Math]::Pow($e2,3)/256))
  $e1 = (1 - [Math]::Sqrt(1 - $e2)) / (1 + [Math]::Sqrt(1 - $e2))
  $phi1 = $mu + (3*$e1/2 - 27*[Math]::Pow($e1,3)/32) * [Math]::Sin(2*$mu) `
              + (21*$e1*$e1/16 - 55*[Math]::Pow($e1,4)/32) * [Math]::Sin(4*$mu) `
              + (151*[Math]::Pow($e1,3)/96) * [Math]::Sin(6*$mu) `
              + (1097*[Math]::Pow($e1,4)/512) * [Math]::Sin(8*$mu)
  $sp = [Math]::Sin($phi1); $cp = [Math]::Cos($phi1); $tp = [Math]::Tan($phi1)
  $n1 = $a / [Math]::Sqrt(1 - $e2*$sp*$sp)
  $t1 = $tp*$tp; $c1 = $e1sq*$cp*$cp
  $r1 = $a * (1 - $e2) / [Math]::Pow(1 - $e2*$sp*$sp, 1.5)
  $d  = $x / ($n1 * $k0)
  $lat = $phi1 - ($n1*$tp/$r1) * ($d*$d/2 `
        - (5 + 3*$t1 + 10*$c1 - 4*$c1*$c1 - 9*$e1sq) * [Math]::Pow($d,4)/24 `
        + (61 + 90*$t1 + 298*$c1 + 45*$t1*$t1 - 252*$e1sq - 3*$c1*$c1) * [Math]::Pow($d,6)/720)
  $lon = ($d - (1 + 2*$t1 + $c1) * [Math]::Pow($d,3)/6 `
        + (5 - 2*$c1 + 28*$t1 - 3*$c1*$c1 + 8*$e1sq + 24*$t1*$t1) * [Math]::Pow($d,5)/120) / $cp
  $lon0 = [Math]::PI/180 * (($zone - 1) * 6 - 180 + 3)
  return @([Math]::Round($lat * 180/[Math]::PI, 5), [Math]::Round(($lon + $lon0) * 180/[Math]::PI, 5))
}

# Alleen stations in het vaargebied van de app
$regio = @{ latMin = 52.15; latMax = 53.65; lonMin = 4.40; lonMax = 7.20 }

$stations = New-Object System.Collections.ArrayList
foreach ($f in $j.features) {
  $c = $f.geometry.coordinates
  if (-not $c -or $c.Count -lt 2) { continue }
  $ll = Convert-UtmToWgs84 ([double]$c[0]) ([double]$c[1])
  $lat = $ll[0]; $lon = $ll[1]
  if ($lat -lt $regio.latMin -or $lat -gt $regio.latMax -or $lon -lt $regio.lonMin -or $lon -gt $regio.lonMax) { continue }
  $code = $f.properties.locationCode
  if (-not $code) { continue }
  [void]$stations.Add([pscustomobject]@{ code = $code; name = $f.properties.name; lat = $lat; lon = $lon })
}
Write-Output "binnen vaargebied: $($stations.Count)"

# controle: bekende posities moeten kloppen
foreach ($check in @(@('harlingen',53.176,5.409), @('den.helder',52.964,4.745), @('kornwerderzand',53.073,5.339))) {
  $s = $stations | Where-Object { $_.code -like "$($check[0])*" } | Select-Object -First 1
  if ($s) {
    $dLat = [Math]::Abs($s.lat - $check[1]); $dLon = [Math]::Abs($s.lon - $check[2])
    $km = [Math]::Round([Math]::Sqrt([Math]::Pow($dLat*111.32,2) + [Math]::Pow($dLon*67,2)), 2)
    Write-Output ("  controle {0,-18} {1},{2}  afwijking {3} km {4}" -f $s.code, $s.lat, $s.lon, $km, $(if ($km -lt 2) { 'OK' } else { 'VERDACHT!' }))
  } else { Write-Output "  controle $($check[0]): station niet gevonden" }
}

$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine("/* MarifoonPilot - meetstations waterstand (GEGENEREERD, niet met de hand aanpassen)")
[void]$sb.AppendLine(" *")
[void]$sb.AppendLine(" * Bron: Rijkswaterstaat Waterinfo, opgehaald $(Get-Date -Format 'yyyy-MM-dd').")
[void]$sb.AppendLine(" * Alleen de stationlijst staat hier vast; de actuele waterstanden haalt de app live op")
[void]$sb.AppendLine(" * bij https://waterinfo.rws.nl/api/point/latestmeasurement?parameterId=waterhoogte")
[void]$sb.AppendLine(" * Coordinaten omgerekend van EPSG:25831 (UTM 31N) naar WGS84.")
[void]$sb.AppendLine(" * Waarden bij dat endpoint zijn in cm t.o.v. NAP.")
[void]$sb.AppendLine(" */")
[void]$sb.AppendLine('"use strict";')
[void]$sb.AppendLine("const TIDE_STATIONS = [")
foreach ($s in ($stations | Sort-Object name)) {
  $nm = $s.name -replace '"','\"'
  $la = $s.lat.ToString([Globalization.CultureInfo]::InvariantCulture)
  $lo = $s.lon.ToString([Globalization.CultureInfo]::InvariantCulture)
  [void]$sb.AppendLine("  {c:`"$($s.code)`",n:`"$nm`",lat:$la,lon:$lo},")
}
[void]$sb.AppendLine("];")
[System.IO.File]::WriteAllText("$proj\stations.js", $sb.ToString(), [System.Text.UTF8Encoding]::new($false))
Write-Output "geschreven: $proj\stations.js ($([math]::Round((Get-Item "$proj\stations.js").Length/1kb,1)) kB)"
