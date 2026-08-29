# Datageneratie

`obstacles.js` in de projectmap is **gegenereerd**. Pas het niet met de hand aan — je wijziging
verdwijnt bij de volgende run. Handmatig geverifieerde objecten horen in `data.js`.

## Verversen

Vanuit deze map, met PowerShell:

```powershell
.\fetch-overpass.ps1     # haalt bruggen/sluizen/havens op bij de Overpass API -> overpass-raw.json
.\build-obstacles.ps1    # zet dat om naar ..\obstacles.js
.\build-vhf.ps1          # haalt landelijke RWS VHF-meldpunten op -> ..\vhf-points.js
.\build-fairway-depths.ps1 # haalt RWS-vaarwegdieptes en max. diepgang op -> ..\fairway-depths.js
.\build-stations.ps1     # haalt de meetstations waterstand op -> ..\stations.js
```

`build-stations.ps1` legt alleen de **stationlijst** vast (die verandert zelden) en rekent de
coördinaten om van EPSG:25831 naar WGS84. Het script controleert zichzelf tegen drie bekende
posities; staat daar `VERDACHT!` bij, dan klopt de conversie niet en moet je niet publiceren.
De actuele waterstanden haalt de app live op via de proxy uit [`proxy/`](proxy/).

Dieptedata gaat met Python:

```bash
python build-depth-rws.py     # RWS-lodingen (20 m, NAP) -> ../depth/rws/*.mpd + index.json
python build-depth.py         # EMODnet-achtervang       -> ../depth/ijsselmeergebied.json
```

`build-depth-rws.py` haalt per tegel de jaargangen van nieuw naar oud op tot de tegel vol is,
en onthoudt per cel uit welk meetjaar de waarde komt. Standaard doet hij alleen het kerngebied;
met `--bbox 125630 472780 198610 567440` pak je het hele IJsselmeergebied. Hij cachet de
opgehaalde GeoTIFFs in `.rws-cache/` — **die map kun je na afloop weggooien**, hij loopt al
snel richting een paar honderd MB.

Bij het verkleinen van 5 m naar 20 m wordt de **ondiepste** cel genomen, niet het gemiddelde;
en cellen op of boven NAP tellen als geen data, want het IJsselmeerpeil ligt eronder. De
2006-laag heeft 22% opvulcellen met exact `0.00` over land — die zouden anders als ondiepte
binnenkomen.

`fetch-overpass.ps1` is **hervatbaar**: al opgehaalde gebieden worden overgeslagen, dus na een
onderbreking draai je hem gewoon opnieuw. Reken op 10–20 minuten — de Overpass-servers zijn
gratis en knijpen af met 429/504; het script vangt dat op met wachttijden en een tweede endpoint.

Na het genereren: **verhoog het versienummer** op drie plekken, anders krijgen bestaande
gebruikers de nieuwe data niet (de service worker cachet op URL):

- `index.html` → `?v=` achter `data.js`, `vhf-points.js`, `obstacles.js` en `app.js`
- `sw.js` → `VERSION` én dezelfde `?v=` in `SHELL_FILES`

## Bronnen en licentie

Data komt van OpenStreetMap via de Overpass API, © OpenStreetMap-bijdragers, licentie
[ODbL](https://www.openstreetmap.org/copyright). Een deel is in OSM overgenomen uit Rijkswaterstaat
Vaarweginformatie (herkenbaar aan `s:"rws"`). Bij verspreiding van de app moet de bronvermelding
mee — die staat in het scherm *Instellingen → Over & installeren*.

De landelijke marifoon-oproeppunten in `vhf-points.js` komen rechtstreeks uit de open
Rijkswaterstaat FIS/VNDS-collectie `meldpunt`. Het bouwscript neemt uitsluitend bruggen,
sluizen en VTS-sectoren met een numeriek VHF-kanaal op; objecten met `Geen` of een ontbrekend
kanaal worden bewust niet ingevuld.

De landelijke dieptelabels in `fairway-depths.js` komen rechtstreeks uit de FIS/VNDS-collecties
`vaarwegdiepte`, `max_toegestane_afmeting` en `route`. Het script bewaart het referentievlak
expliciet en verwijdert de FIS-onbekendwaarde `-99,99`; het rekent bodemniveaus niet stilzwijgend
om naar actuele waterdiepte.

## Wat er wél en niet in komt

Meegenomen worden bruggen met een naam of een doorvaarthoogte, sluizen met een naam, en
jachthavens met een naam. Naamloze objecten zonder hoogte zijn ruis en vallen af. Objecten die
binnen 250 m van een geverifieerd object uit `data.js` liggen worden overgeslagen — die
geverifieerde versie wint, want die heeft een gecontroleerd marifoonkanaal.

Doorvaarthoogtes: voor een **vaste** brug `seamark:bridge:clearance_height`, voor een
**beweegbare** brug `seamark:bridge:clearance_height_closed` (de hoogte die je hebt zonder
opening). Ontbreekt die, dan wordt het `null` en rekent de app altijd met openen.

> **Let op bij aanpassen van `build-obstacles.ps1`:** parseer getallen uitsluitend met
> `InvariantCulture`. Onder de Nederlandse locale leest .NET de punt in `5.7` als
> duizendtalscheiding en maakt er 57 van — dat leverde eerder doorvaarthoogtes van 48 en 68 meter op.
