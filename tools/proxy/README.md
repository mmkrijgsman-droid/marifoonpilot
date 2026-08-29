# Proxies

De app haalt actuele waterstanden bij Rijkswaterstaat Waterinfo. Die API stuurt **geen
CORS-headers**, dus een browser weigert het antwoord — server-naar-server werkt wél. Er moet
dus een klein tussenstukje tussen. Dit is de enige serverkant die MarifoonPilot nodig heeft.

Geverifieerd op 2026-08-16:

```
GET https://waterinfo.rws.nl/api/point/latestmeasurement?parameterId=waterhoogte
→ 200, 309 stations, waarden in cm t.o.v. NAP, geen access-control-* headers
```

## Optie A — Netlify Functions

Je host de app waarschijnlijk al op Netlify. Zet [`netlify/functions/waterstand.js`](netlify/functions/waterstand.js)
in de root van je site, deploy, en vul in `config.js` in:

```js
const TIDE_API = "https://<jouw-site>.netlify.app/.netlify/functions/waterstand";
```

## Optie B — Cloudflare Workers

Maak een Worker met [`cloudflare/worker.js`](cloudflare/worker.js) en vul zijn URL in bij `TIDE_API`.

## Beide

- **Gratis** binnen de free tier; deze functie doet vrijwel niets.
- **Cache van 5 minuten.** Rijkswaterstaat meet elke 10 minuten, dus vaker ophalen heeft geen
  zin. Al je gebruikers samen belasten RWS zo hooguit eens per 5 minuten — dat schaalt door
  naar duizenden gebruikers zonder dat je iets aanpast.
- **Zet `ALLOW_ORIGIN` op je eigen domein** zodra je live gaat. Met `*` kan iedereen jouw proxy
  gebruiken en betaal jij het verkeer.

## AIS-scheepvaart (EuRIS)

Zelfde verhaal, andere bron. De EuRIS-trackdienst **werkt zonder token** — er is dus geen
sleutel en geen geheim te bewaken — maar stuurt geen CORS-headers. Gecontroleerd op 2026-08-29:

```
GET https://www.eurisportal.eu/api/v3/tracks/bounding-box?minLon=&minLat=&maxLon=&maxLat=
→ 200, landelijke dekking, geen access-control-* headers (preflight geeft 204, ook zonder)
```

Zet [`netlify/functions/ais.js`](netlify/functions/ais.js) of
[`cloudflare/ais-worker.js`](cloudflare/ais-worker.js) neer en vul de URL in bij `AIS_API` in
`config.js`, of per toestel bij *Instellingen → Scheepvaart (AIS)*.

Deze proxy doet meer dan doorgeven, en dat is met opzet:

- **Pagineren.** EuRIS geeft maximaal 100 schepen per aanroep, ook als je meer vraagt.
- **Filteren.** Een corridor van 18×12 km levert 100 schepen waarvan er 24 varen; de rest ligt
  in de jachthavens. We houden alles wat vaart, plus alles vanaf 20 m ook als het stilligt —
  een wachtend beroepsschip bij een sluis is juist wél relevant.
- **Velden strippen.** Bij een afgeschermde track zijn ruim dertig van de 38 velden leeg.
  Ongefilterd is een corridor 85 KB; zo blijft er ongeveer 10 KB over.
- **Naam normaliseren.** EuRIS zet bij een afgeschermd schip `"Track 745031"` in het naamveld.
  Dat is een plaatsvervanger, geen naam, en die geven we door als `null` — anders staat er een
  "scheepsnaam" op het scherm die niemand over de marifoon herkent.

Cache staat op 30 s. Varende posities zijn mediaan 0 minuten oud (p90 3 min); langer bewaren
maakt het beeld onwaar, korter belast EuRIS zonder dat je er iets voor terugkrijgt.

> **Privacy.** EuRIS levert de identiteit van vrijwel alle binnenvaart niet uit: bij een meting
> over 1044 schepen had er één een naam en MMSI. Afmetingen, koers, snelheid en kegels komen
> wél door. Bronvermelding is verplicht: *"API/Service tracks incorporated from EuRIS
> (eurisportal.eu)"* — die staat in *Instellingen → Over & installeren*.

## Waarom niet gewoon de data meeleveren?

Waterstanden veranderen elke 10 minuten. Meeleveren kan dus niet — dit is per definitie live
data. De stationlijst (`stations.js`) verandert wél zelden en die zit daarom wel gewoon in de app.

## Later

Als je toch een backend hebt, is dit het natuurlijke aanknopingspunt voor de rest: routes
opslaan, gedeelde routes, historische vaardata, en een AIS-overlay (EuRIS vereist vrijwel zeker
ook een sleutel en dus server-side afhandeling).
