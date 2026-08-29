"""
MarifoonPilot — dieptedata IJsselmeergebied uit EMODnet Bathymetry.

LET OP — dit is sinds v4.8 niet meer de hoofdbron. De RWS-dienst
(geo.rijkswaterstaat.nl/services/ogc/gdr/bodemhoogte_ijsselmeergebied) was kapot met
"java.io.IOException: Failed to create reader from file:///mnt/appsdata-prod/...tif",
maar werkt sinds 2026-08-26 weer. Die is beter: 20 m raster en bodemhoogte t.o.v. NAP,
dus met een bekend referentievlak. Gebruik build-depth-rws.py.

Dit script blijft bestaan voor de ACHTERVANG: EMODnet dekt vlakdekkend, ook waar RWS
geen loding heeft. De app pakt eerst de RWS-tegel en valt hierop terug, zichtbaar
gelabeld als "model".

Gebruik:
    python build-depth.py            # gebruikt de meegeleverde emodnet-ijg.tif
    python build-depth.py bron.tif   # of een eigen GeoTIFF

Uitvoer: ../depth/ijsselmeergebied.json — compact formaat [lon,lat,diepte, ...] omdat
volledige GeoJSON voor dit aantal punten tientallen MB's zou kosten.

LET OP bij aanpassen: per cel wordt de ONDIEPSTE meting genomen, niet het gemiddelde.
Dat is de veilige kant — een gemiddelde verstopt precies de ondiepte waar je op loopt.
"""
import json
import sys
from pathlib import Path

import numpy as np
import rasterio

HIER = Path(__file__).resolve().parent
BRON = Path(sys.argv[1]) if len(sys.argv) > 1 else HIER / "emodnet-ijg.tif"
DOEL = HIER.parent / "depth" / "ijsselmeergebied.json"

# 2x2 samenvoegen -> ~230 m raster. De app zoekt dieptepunten binnen 200 m (DEPTH_SNAP),
# en bij 230 m rasterafstand ligt elk punt op hooguit ~163 m van een meting. Grover mag
# dus niet: dan vallen er gaten waar de app geen diepte meer vindt.
BLOK = 2
MIN_DIEPTE = 0.2     # ondieper dan dit is droogvallend/oever, niet zinvol als vaardiepte
MAX_DIEPTE = 60.0    # veiligheidsgrens tegen uitschieters in de brondata


def main() -> int:
    if not BRON.exists():
        print(f"bronbestand ontbreekt: {BRON}")
        return 1

    with rasterio.open(BRON) as src:
        hoogte = src.read(1).astype("float32")
        transform = src.transform
        nodata = src.nodata
        print(f"raster   : {src.width} x {src.height}  {src.crs}")

    if nodata is not None:
        hoogte[hoogte == nodata] = np.nan

    # elevatie -> diepte (positief onder water)
    diepte = -hoogte
    diepte[~np.isfinite(diepte)] = np.nan
    diepte[diepte < MIN_DIEPTE] = np.nan     # land en oever weg
    diepte[diepte > MAX_DIEPTE] = np.nan

    h, w = diepte.shape
    h2, w2 = (h // BLOK) * BLOK, (w // BLOK) * BLOK
    blokken = diepte[:h2, :w2].reshape(h2 // BLOK, BLOK, w2 // BLOK, BLOK)

    with np.errstate(all="ignore"):
        # ondiepste (= minimum diepte) per blok; nanmin negeert de weggevallen cellen
        ondiepste = np.nanmin(blokken, axis=(1, 3))

    rijen, kolommen = np.where(np.isfinite(ondiepste))
    print(f"watercellen na samenvoegen: {len(rijen)}")

    # celmiddelpunten terugrekenen naar lon/lat
    px = (kolommen * BLOK) + BLOK / 2.0
    py = (rijen * BLOK) + BLOK / 2.0
    lon, lat = rasterio.transform.xy(transform, py, px)

    plat = []
    for lo, la, d in zip(lon, lat, ondiepste[rijen, kolommen]):
        plat.append(round(float(lo), 4))
        plat.append(round(float(la), 4))
        plat.append(round(float(d), 1))

    uit = {
        "format": "flat3",
        "source": "EMODnet Bathymetry DTM 2022",
        "license": "EMODnet Bathymetry, CC-BY",
        "url": "https://emodnet.ec.europa.eu/en/bathymetry",
        "note": "Regionaal model, ~115 m brondata, per cel de ondiepste waarde. "
                "Indicatief - niet om op te navigeren.",
        "datum": "onbekend (EMODnet eigen referentievlak, niet gelijk aan LAT)",
        "unit": "m",
        "count": len(rijen),
        "data": plat,
    }

    DOEL.parent.mkdir(parents=True, exist_ok=True)
    DOEL.write_text(json.dumps(uit, separators=(",", ":")), encoding="utf-8")
    mb = DOEL.stat().st_size / 1024 / 1024
    print(f"geschreven: {DOEL}  ({mb:.1f} MB, {len(rijen)} punten)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
