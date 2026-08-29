"""
MarifoonPilot - dieptedata uit de RWS-bodemhoogtedienst IJsselmeergebied.

Waarom deze en niet EMODnet: RWS meet 5 tot 20 m fijn en geeft bodemhoogte t.o.v. NAP,
dus met een BEKEND referentievlak. EMODnet is ~141 m en het referentievlak is onbekend.
De dienst was in augustus 2026 tijdelijk kapot (java.io.IOException op alle jaargangen);
sinds 2026-08-26 werkt hij weer. Zie ook build-depth.py voor de oude EMODnet-route, die
als achtergrond blijft bestaan voor gebieden waar RWS niets heeft.

WAT DIT SCRIPT DOET
  Per tegel de jaargangen van nieuw naar oud ophalen tot de tegel vol is, en per cel
  onthouden UIT WELK MEETJAAR de waarde komt. Dat jaar gaat mee de app in, want een
  loding uit 2013 is iets anders dan een loding uit 2022 en dat hoort de schipper te zien.

TWEE REGELS DIE JE NIET MOET OMDRAAIEN
  1. Bij het verkleinen van 5 m naar 20 m wordt de ONDIEPSTE cel genomen, niet het
     gemiddelde. Een gemiddelde verstopt precies de ondiepte waar je op loopt.
  2. Cellen met bodemhoogte >= NAP tellen als geen data. Het IJsselmeerpeil ligt onder
     NAP, dus die cellen zijn sowieso droog. De 2006-laag heeft bovendien 22% cellen
     met exact 0.00 als opvulwaarde over land - die mogen er niet als ondiepte in komen.

JAARGANGEN
  1905 en 1935 doen NIET mee. Dat is de Zuiderzee van voor de Afsluitdijk, op 100 m
  raster. Als iets ondanks alles alleen daar in staat, is "geen loding" het eerlijke
  antwoord - niet een peiling van honderdtwintig jaar oud.

GEBRUIK
  python build-depth-rws.py                      # standaardgebied (kern IJsselmeer)
  python build-depth-rws.py --bbox 125630 472780 198610 567440   # alles
  python build-depth-rws.py --res 20 --tile 256  # andere korrel/tegelgrootte

UITVOER
  ../depth/rws/index.json  +  ../depth/rws/<x>_<y>.mpd (binair, zie schrijf_tegel)
"""
import argparse
import json
import struct
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np
import rasterio

DIENST = ("https://geo.rijkswaterstaat.nl/services/ogc/gdr/"
          "bodemhoogte_ijsselmeergebied/ows")
LAAG = "bodemhoogte_ijsselmeergebied__bodemhoogte_ijg_%d"

# nieuw naar oud; de eerste jaargang die een cel vult, wint
JAARGANGEN = [2022, 2013, 2012, 2011, 2006]

NODATA_IN = 1e30          # de dienst stuurt 1.79e308 voor "niets gemeten"
NODATA_UIT = -32768       # int16-sentinel in het tegelbestand
GEEN_JAAR = 255

HIER = Path(__file__).resolve().parent
UIT = HIER.parent / "depth" / "rws"
WERK = HIER / ".rws-cache"

# kerngebied: Krabbersgat - Houtrib - Markermeer-noord
STANDAARD_BBOX = (140000, 505000, 155000, 530000)


def haal(url, pad, pogingen=3):
    """GeoTIFF ophalen met cache op schijf. De dienst is traag; niet twee keer vragen."""
    if pad.exists() and pad.stat().st_size > 0:
        return pad
    for poging in range(pogingen):
        try:
            with urllib.request.urlopen(url, timeout=300) as r:
                data = r.read()
            if len(data) < 100:
                return None
            pad.parent.mkdir(parents=True, exist_ok=True)
            pad.write_bytes(data)
            return pad
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            if poging == pogingen - 1:
                print("      ophalen mislukt: %s" % str(e)[:70])
                return None
            time.sleep(2 * (poging + 1))
    return None


def vraag_tegel(jaar, x0, y0, x1, y1):
    """Een jaargang voor een tegel, als numpy-array op native resolutie."""
    url = ("%s?service=WCS&version=2.0.1&request=GetCoverage&coverageId=%s"
           "&format=image/tiff&subset=X(%d,%d)&subset=Y(%d,%d)"
           % (DIENST, LAAG % jaar, x0, x1, y0, y1))
    pad = WERK / str(jaar) / ("%d_%d.tif" % (x0, y0))
    if haal(url, pad) is None:
        return None
    try:
        with rasterio.open(pad) as d:
            return d.read(1).astype(np.float64), d.transform
    except Exception as e:
        print("      onleesbaar: %s" % str(e)[:60])
        try:
            pad.unlink()
        except OSError:
            pass
        return None


def naar_raster(a, tr, x0, y0, x1, y1, res):
    """Native array herleiden tot het doelraster, per doelcel de ONDIEPSTE meting.

    Niet middelen: het gemiddelde van een geul en een plaat is een diepte die er
    nergens is, en hij ligt te diep - precies de verkeerde kant op.
    """
    a = np.where(a >= NODATA_IN, np.nan, a)
    a = np.where(a >= 0.0, np.nan, a)      # >= NAP is droog (of opvulnul uit 2006)

    nx = int(round((x1 - x0) / res))
    ny = int(round((y1 - y0) / res))

    bron_res_x = abs(tr.a)
    bron_res_y = abs(tr.e)
    f_x = max(1, int(round(res / bron_res_x)))
    f_y = max(1, int(round(res / bron_res_y)))

    # bron uitlijnen op de tegelhoek (rij 0 = noordrand)
    off_x = int(round((x0 - tr.c) / bron_res_x))
    off_y = int(round((tr.f - y1) / bron_res_y))
    h, w = a.shape

    # naar een net raster van (ny*f_y, nx*f_x) knippen/padden, dan blokgewijs max
    sy0, sx0 = off_y, off_x
    blok = np.full((ny * f_y, nx * f_x), np.nan)
    bron_y0, bron_y1 = max(0, sy0), min(h, sy0 + ny * f_y)
    bron_x0, bron_x1 = max(0, sx0), min(w, sx0 + nx * f_x)
    if bron_y1 > bron_y0 and bron_x1 > bron_x0:
        doel_y0 = bron_y0 - sy0
        doel_x0 = bron_x0 - sx0
        blok[doel_y0:doel_y0 + (bron_y1 - bron_y0),
             doel_x0:doel_x0 + (bron_x1 - bron_x0)] = a[bron_y0:bron_y1, bron_x0:bron_x1]

    blok = blok.reshape(ny, f_y, nx, f_x)
    with np.errstate(all="ignore"):
        uit = np.nanmax(blok, axis=(1, 3))     # max bodemhoogte = ondiepste punt
    return uit


def schrijf_tegel(pad, hoogte, jaar_idx, jaren, x0, y1, res):
    """Binair tegelformaat, little-endian:

        magic   4s   'MPD1'
        breedte u2
        hoogte  u2
        oorsprX i4   RD-x van de linkerrand
        oorsprY i4   RD-y van de BOVENrand (rij 0 ligt noordelijk)
        celmaat u2   meters
        nJaren  u1   gevolgd door nJaren x u2 met de jaartallen
        data    i16[b*h]  bodemhoogte in cm t.o.v. NAP, -32768 = geen loding
        jaar    u8[b*h]   index in de jarenlijst, 255 = geen loding

    Bewust geen JSON: een raster van 256x256 kost zo 192 KB in plaats van megabytes,
    en gzip van de webserver drukt dat nog eens flink in.
    """
    h, b = hoogte.shape
    cm = np.where(np.isnan(hoogte), NODATA_UIT,
                  np.round(hoogte * 100.0)).astype(np.int16)
    kop = struct.pack("<4sHHiiHB", b"MPD1", b, h, int(x0), int(y1), int(res), len(jaren))
    kop += struct.pack("<%dH" % len(jaren), *jaren)
    pad.parent.mkdir(parents=True, exist_ok=True)
    pad.write_bytes(kop + cm.tobytes() + jaar_idx.astype(np.uint8).tobytes())
    return len(kop) + cm.nbytes + jaar_idx.size


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--bbox", nargs=4, type=int, metavar=("X0", "Y0", "X1", "Y1"),
                   default=list(STANDAARD_BBOX), help="RD-kader (EPSG:28992)")
    p.add_argument("--res", type=int, default=20, help="doelresolutie in meter")
    p.add_argument("--tile", type=int, default=256, help="tegelgrootte in cellen")
    p.add_argument("--jaren", nargs="*", type=int, default=JAARGANGEN)
    a = p.parse_args()

    res, n = a.res, a.tile
    stap = res * n
    x0b, y0b, x1b, y1b = a.bbox
    # tegelraster uitlijnen op veelvouden van stap, zodat losse runs op elkaar passen
    tx0, ty0 = (x0b // stap) * stap, (y0b // stap) * stap
    UIT.mkdir(parents=True, exist_ok=True)

    tegels = []
    totaal_bytes = 0
    jaar_teller = {}
    xs = list(range(tx0, x1b, stap))
    ys = list(range(ty0, y1b, stap))
    print("Doel %d m, tegels van %d cellen (%d m), %d x %d = %d tegels"
          % (res, n, stap, len(xs), len(ys), len(xs) * len(ys)))

    for x0 in xs:
        for y0 in ys:
            x1, y1 = x0 + stap, y0 + stap
            hoogte = np.full((n, n), np.nan)
            jaar_idx = np.full((n, n), GEEN_JAAR, dtype=np.uint8)
            gebruikte = []
            print("tegel %d,%d" % (x0, y0), end=" ", flush=True)

            for jaar in a.jaren:
                leeg = np.isnan(hoogte)
                if not leeg.any():
                    break
                r = vraag_tegel(jaar, x0, y0, x1, y1)
                if r is None:
                    continue
                laag = naar_raster(r[0], r[1], x0, y0, x1, y1, res)
                nieuw = leeg & ~np.isnan(laag)
                if not nieuw.any():
                    continue
                if jaar not in gebruikte:
                    gebruikte.append(jaar)
                hoogte[nieuw] = laag[nieuw]
                jaar_idx[nieuw] = gebruikte.index(jaar)
                print("%d:+%d" % (jaar, int(nieuw.sum())), end=" ", flush=True)

            gevuld = int((~np.isnan(hoogte)).sum())
            if gevuld == 0:
                print("- leeg")
                continue
            naam = "%d_%d.mpd" % (x0, y0)
            b = schrijf_tegel(UIT / naam, hoogte, jaar_idx, gebruikte, x0, y1, res)
            totaal_bytes += b
            for j in gebruikte:
                jaar_teller[j] = jaar_teller.get(j, 0) + 1
            tegels.append({
                "bestand": naam, "x": x0, "y": y0, "breedte": n, "hoogte": n,
                "dekking": round(100.0 * gevuld / (n * n), 1),
                "jaren": gebruikte,
                "bodem_min": round(float(np.nanmin(hoogte)), 2),
                "bodem_max": round(float(np.nanmax(hoogte)), 2),
            })
            print("-> %s  %.0f%% gevuld  %d KB"
                  % (naam, 100.0 * gevuld / (n * n), b // 1024))

    index = {
        "formaat": "mpd1",
        "bron": "Rijkswaterstaat, bodemhoogte IJsselmeergebied (WCS)",
        "dienst": DIENST,
        "opgehaald": time.strftime("%Y-%m-%d"),
        "eenheid": "cm bodemhoogte t.o.v. NAP, negatief = onder NAP",
        "referentievlak": "NAP",
        "let_op": ("Bodemhoogte, geen diepte. Diepte = waterpeil - bodemhoogte. "
                   "Per cel de ondiepste meting van de nieuwste beschikbare jaargang. "
                   "Geen garantie voor kielspeling."),
        "celmaat": res,
        "tegelstap": stap,
        "crs": "EPSG:28992",
        "jaargangen_gebruikt": {str(k): v for k, v in sorted(jaar_teller.items(),
                                                             reverse=True)},
        "tegels": tegels,
    }
    (UIT / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1),
                                    encoding="utf-8")
    print("\n%d tegels, %.1f MB, index.json geschreven"
          % (len(tegels), totaal_bytes / 1048576.0))
    print("jaargangen: %s" % ", ".join("%s in %d tegels" % (k, v)
                                       for k, v in sorted(jaar_teller.items(),
                                                          reverse=True)))


if __name__ == "__main__":
    sys.exit(main())
