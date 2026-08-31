# MarifoonPilot v2 ⚓📻

Een GPS-vaarassistent die **automatisch het juiste marifoonkanaal** adviseert op het IJsselmeer,
Markermeer en de Waddenzee — op basis van je **positie én vaarrichting**. Werkt als **PWA** op
**telefoon, tablet én laptop**, zónder app store, en altijd schermvullend.


## 5.2 — waarom Android niets vroeg

De vorige versie startte de locatie vanzelf op, en dat is precies waar het mis kon gaan:
**een browser mag een locatievraag die niet uit een tik voortkomt stil afhandelen.** Chrome
doet dat ook: geen venster, geen foutmelding, niets. En is de vraag eerder een paar keer
weggetikt, dan zet Chrome de site op een zwarte lijst en komt er nooit meer een venster.
Voor de schipper ziet dat er identiek uit als een kapotte app.

Wat er nu gebeurt:

- 🔔 **Blijft het 3,5 seconde stil, dan zet de app er zelf een knop neer.** Een verzoek ná
  een tik wordt niet weggemoffeld — dat is de enige manier om een echt venster af te dwingen.
  Blijft het ná die tik óók stil (8 s), dan is de vraag geblokkeerd en zegt de app dat, met
  de weg naar de instelling erbij.
- 🧭 **Vier oorzaken worden nu uit elkaar gehouden**: geen beveiligde verbinding, een
  onbruikbare locatievoorziening, een geweigerde toestemming, en gewoon nog geen fix. Alleen
  de laatste is een kwestie van wachten.
- 📱 **Mini-browsers worden herkend.** Een link in WhatsApp, Gmail of Facebook opent in een
  ingebouwde WebView die de locatievraag nooit doorgeeft. De app herkent dat aan de browser
  en zegt: open hem in Chrome.
- 🩺 **Instellingen → GPS-diagnose** toont wat de browser zélf meldt: adres, beveiligde
  context, toestemming, aantal pogingen en posities, de laatste fout, en of de app in de
  browser of vanaf het beginscherm draait. Met een kopieerknop. Zonder dat blijft
  "het werkt niet" giswerk.
- 🛟 **Een fout in de app maakt zichzelf zichtbaar** in plaats van alles stil te laten
  sterven, en een onbruikbare `geolocation` laat de app niet meer vastlopen.
- ♻️ **Updates komen betrouwbaar aan**: de service worker wordt niet meer uit de
  browsercache gehaald en haalt de app-bestanden vers op. Tijdens het testen bleek een oude
  cache hardnekkig genoeg om een nieuwe versie onzichtbaar te houden.

Getest met een nagebootste browser in alle standen die op een Android voorkomen: toestemming
verleend, stil gebleven, geweigerd (zowel via de foutcode als vooraf), geen fix, te traag,
geen bruikbare API, WebView, simulatie, en toestemming die later alsnog binnenkomt — plus
het volledige routespoor als regressie.

## Nieuw in v5.1 — GPS staat meteen aan, en je kiest zelf waar de route begint

- 📡 **Geen "GPS starten" meer.** De app vraagt de locatie zodra hij opent; dat is ook het
  moment waarop Android/Chrome om toestemming vraagt. Op het water zet je geen knop meer aan.
- 🔎 **Eerlijke reden als er geen positie is.** *Geen fix* (de ontvanger zoekt nog) is iets
  anders dan *geweigerd* (de browser mag niet) en weer iets anders dan *geblokkeerd* (de app
  draait niet op https). Alle drie krijgen hun eigen melding, met wat je eraan kunt doen.
  Alleen bij weigeren of blokkeren komt de knop **Locatie opnieuw proberen** terug — die tik
  is nodig, want een browser vraagt pas opnieuw na een gebaar van de gebruiker.
- 🚩 **Bij een nieuwe route vraagt de app waar hij begint:** *vanaf mijn GPS-positie* (de lijn
  schuift mee terwijl je vaart) of *zelf een startpunt aanklikken* (blijft liggen waar je hem
  zet — voor een tocht die morgen pas begint). Dat startpunt is een groene **S** op de kaart:
  verslepen kan, en aantikken zet de route terug op je eigen positie.
- Zonder GPS-fix staat de eerste keuze uit, in plaats van dat de app een positie aanneemt.
- 🗺 **De vraag staat op de kaart, niet erover.** Hetzelfde matglazen paneel als de rest van
  de kaartbediening, onderaan waar je duim zit, en zodra je een startpunt mag aanwijzen
  krimpt het tot één regel — juist dán moet je de kaart kunnen zien. Kompasroos en
  zoomknoppen schuiven ervoor omhoog in plaats van eronder te verdwijnen.
- 📐 **Het bovenpaneel is bijna gehalveerd** (op de telefoon van ~127 naar 42 px). Het
  pictogram staat naast de waarde in plaats van erboven, en zonder route staan kanaal,
  object, afstand én snelheid gewoon op één regel: afstand en aankomsttijd hebben dan
  niets te zeggen, en twee streepjes tonen is ruis. Zodra er een route ligt komt de tweede
  regel met alle drie de cijfers terug. Op de kaart krimpt ook de koptekst tot een dunne
  statusstrook. Alles wat er stond staat er nog — er is alleen meer kaart.

> ⚠️ **Locatie werkt alleen op https.** Open je de app via `http://<ip-adres>` of rechtstreeks
> vanaf een bestand, dan geeft de browser géén locatie en vraagt hij er ook niet om — precies
> het beeld "hij vraagt niets en doet niets". Zet hem op Netlify of GitHub Pages (zie
> *Installeren op je toestel*), of test op `localhost`.

## Nieuw in v4.7 — landelijke vaarwegdieptes

- 🌊 De kaartknop **Diepte** toont nu **1.332 officiële RWS-vaarwegdieptetrajecten** in heel
  Nederland. Vanaf zoomniveau 10 staan de gepubliceerde waarden met hun referentievlak
  (NAP, KP, MP, SP, PP of BP) direct op de kaart.
- ↕ Daarnaast staan **602 trajecten met maximaal toegestane diepgang** als oranje `D≤`-labels
  op de kaart. Die zijn vanaf zoomniveau 8 zichtbaar en krijgen voorrang bij labelbotsingen.
- De lijnen en popups komen uit Rijkswaterstaat FIS/VNDS, dezelfde bron als het officiële
  naslagwerk *Vaarwegen in Nederland*. Verversen kan met `tools/build-fairway-depths.ps1`.
- De bestaande EMODnet-bodemlijnen blijven als indicatieve achtergrond onder dezelfde knop.

> De RWS-vaarwegdiepte is een gepubliceerd bodemniveau of bereik ten opzichte van het genoemde
> referentievlak; `D≤` is een vaarwegbeperking. Geen van beide is een actuele loding of garantie
> voor kielspeling. Waterstand, getij, afvoer, aanslibbing en tijdelijke berichten blijven relevant.

## Nieuw in v4.6 — landelijke VHF-kaart en betere responsive schaal

- 📻 **813 actuele RWS-meldpunten** voor bruggen, sluizen en VTS-sectoren in heel Nederland.
  De data komt uit FIS/VNDS en wordt met `tools/build-vhf.ps1` opnieuw opgebouwd.
- 🗺️ **Nieuwe kaartlaag “VHF Nederland”**. VTS-meldpunten blijven landelijk zichtbaar;
  bruggen en sluizen verschijnen vanaf zoomniveau 10 om de kaart rustig te houden.
- 📱 **Telefoon-landscape herkend als telefoon**, zodat het dashboard en de kaartbediening
  niet langer de tablet/cockpit-schaal krijgen.
- 🔎 **Begrensde cockpitletters** en bredere touchdoelen voorkomen afgeknipte tekst.

## Nieuw in v4.5 — diepte in het IJsselmeergebied

- 🌊 **Dieptedata zit er nu gewoon in** voor IJsselmeer, Markermeer, Ketelmeer en de
  Randmeren — 192.036 punten op een raster van ~230 m. Geen upload meer nodig.
- Waar **officiële lodingen** beschikbaar zijn (Waddenzee, uit de ENC-zeekaarten) winnen die
  altijd van het model. Onder de kielspeling zie je welke bron het is: *kaartdiepte* of
  *model* (dat laatste in geel).
- Per rastercel is de **ondiepste** waarde genomen, niet het gemiddelde. Een gemiddelde
  verstopt precies de ondiepte waar je op loopt.

> ⚠️ Het EMODnet-model is een regionaal bodemmodel, geen loding, met een referentievlak dat
> niet gelijk is aan LAT. Bruikbaar om te zien wáár het ondiep wordt, **niet om op te navigeren**.
> Het is sinds v4.8 de achtervang: waar RWS een loding heeft, wint die.

## Nieuw in v4.10 — wind langs je route, voor zeilers

- 🌬 De kaartknop **Wind** zet de verwachting langs je routelijn: een pijl die met de wind
  mee wijst, met snelheid en windrichting erbij.
- ⏱ **Op het moment dat je er bent, niet op nu.** Per meetpunt pakt de app het voorspelde
  uur dat hoort bij je ETA daar — inclusief de wachttijd voor sluizen en bruggen die de
  routeplanner al meerekent.
- ⛵ **De hoek tussen wind en koers**, want dat is het getal waar een zeiler op stuurt:
  aan de wind, halve wind, ruime wind of voor de wind. Staat de wind pal op de neus, dan
  zegt de app dat — daar moet je kruisen of de motor aan, en dat kost meer tijd dan de
  routeplanner aangeeft.
- 📅 **Vertrektijdschuif over 7 dagen.** Daar zit de waarde van de vooruitblik: niet "hoe
  waait het deze week" maar *welke dag laat deze route zich zeilen*.
- 💨 Waarschuwing bij vlagen boven de 25 knopen.

Bron: [Open-Meteo](https://open-meteo.com) (CC-BY 4.0), met **KNMI Harmonie AROME
Nederland** op 2 km zolang dat model reikt — ongeveer 2,5 dag — en daarna ECMWF IFS.
Onder de tabel staat altijd welk model je ziet. Er is geen sleutel nodig en geen proxy:
Open-Meteo stuurt CORS-headers, dus de browser mag er rechtstreeks bij.

> ⚠️ Een verwachting is geen meting, en geldt voor 10 m boven open water. In de luwte van
> een dijk waait het anders. Gebruik de zevendaagse blik om een dag te kiezen, niet om op
> te varen.

> **Bij een commerciële uitrol:** de gratis tier van Open-Meteo is uitsluitend voor
> niet-commercieel gebruik. Neem dan een betaald plan, of zet `haalWindData()` om naar
> `api.met.no` (MET Norway) — dat is gratis inclusief commercieel gebruik, stuurt ook
> CORS-headers en reikt tien dagen vooruit, maar levert één punt per verzoek en geen
> windvlagen in het compacte product.

## Nieuw in v4.9 — scheepvaart op de kaart (AIS via EuRIS)

- 🚢 De kaartknop **Scheepvaart** zet schepen op de kaart die AIS uitzenden. Varende schepen
  zijn een pijl in hun vaarrichting, stilliggende een rondje; vanaf 40 m worden ze groter
  getekend en bij gevaarlijke lading rood.
- 👆 **Tik een schip aan** voor lengte en breedte, snelheid en koers, de status (afgemeerd,
  voor anker, aan de grond), kegels/gevaarlijke lading, de plaats volgens de vaarweg-index,
  en hoe oud de positie is.
- 📛 **De scheepsnaam staat erbij als de bron hem geeft.** Dat is zelden: EuRIS schermt de
  identiteit van vrijwel alle binnenvaart af — bij een meting over 1044 schepen had er één een
  naam. Staat er geen naam, dan zegt de app dat ook. Het interne tracknummer tonen we
  bewust niet als scheepsnaam.
- 🔌 Er is **geen sleutel** nodig, maar wel een kleine proxy: EuRIS stuurt geen CORS-headers.
  Kant-en-klare code staat in `tools/proxy/`; de URL vul je in bij *Instellingen → Scheepvaart*.

> ⚠️ AIS toont **alleen schepen die zelf uitzenden**. De meeste pleziervaart doet dat niet, en
> een positie is enkele minuten oud. Een leeg stuk kaart betekent dus niet dat er niets vaart.
> Dit is een aanvulling op uitkijken en op je marifoon, geen vervanging.

## Nieuw in v4.8 — echte RWS-lodingen met NAP als referentievlak

De RWS-dienst `bodemhoogte_ijsselmeergebied` was in augustus 2026 kapot (`java.io.IOException`
op álle jaargangen); **sinds 2026-08-26 werkt hij weer**, en de app gebruikt hem nu.

- 🌊 **20 m raster** in plaats van de ~141 m van het EMODnet-model — zo'n vijftig keer zoveel
  cellen per km².
- 📏 **Bodemhoogte t.o.v. NAP**, dus met een bekend referentievlak. De diepte volgt uit
  `diepte = waterpeil − bodemhoogte`. Je hoeft géén reductievlak meer op te zoeken; dat blijft
  alleen nodig voor de LAT-data van de Waddenzee.
- 🗓️ **Het meetjaar staat erbij.** Onder de kielspeling lees je *RWS-loding 2022* of *2006* —
  want een loding van twintig jaar oud is iets anders dan die van vorig jaar. Waar RWS niets
  heeft, staat er `geen loding` en valt de app terug op het model, zichtbaar gelabeld.
- ⚖️ **Onder de kielspeling staat ook welk peil gebruikt is** en of dat gemeten is of aangenomen.
  Vul het bij *Instellingen → Diepte → Waterpeil t.o.v. NAP*; een gemeten waterstand wint.
- 📦 De data zit in **tegels die pas laden als je er vaart**, en de service worker bewaart ze.
  Landelijke dekking kost daardoor geen download van tientallen MB's bij de eerste start.

> De jaargangen dekken niet allemaal hetzelfde gebied. Het bouwscript stapelt ze van nieuw naar
> oud en onthoudt per cel welk jaar het werd. De peilingen van **1905 en 1935 doen niet mee** —
> dat is de Zuiderzee van vóór de Afsluitdijk. Verversen of uitbreiden: `tools/build-depth-rws.py`.

## De knoppen op de kaart

| knop | wat het doet |
|---|---|
| **● Tijd** | Tijd-bolletjes aan/uit. Heb je een route getekend, dan liggen ze op die route; anders langs je huidige koers ("als ik zo doorvaar, waar ben ik over 30 min?"). Uitzetten laat de routelijn, de sluis/brug-markeringen en de totaaltijd gewoon staan. |
| **◎ Ringen** | Afstandsringen vanaf je boot, op dezelfde tijdsintervallen. |
| **✏️ Route** | Nieuwe routepunten toevoegen door op de kaart te tikken. Bestaande punten verslepen of verwijderen kan altijd, ook als deze knop uit staat. |
| **✕ Wis** | Route weg. |
| **⚓ Zeekaart** | Zeekaart-symbolen (boeien, tonnen, dieptelijnen) over de kaart — werkt ook over satelliet. |
| **🌊 Diepte** | Landelijke officiële RWS-vaarwegdieptes en maximale diepgang; vanaf zoom 10 ook bodemniveau-labels. EMODnet-bodemlijnen vormen de indicatieve achtergrond. |
| **🌬 Wind** | Windverwachting langs je route, op het moment dat je er volgens de planning bent, met de hoek ten opzichte van je koers. Tik de balk aan voor de tabel en de vertrektijdschuif. |
| **🚢 Scheepvaart** | Schepen die AIS uitzenden, via EuRIS. Tik er een aan voor afmetingen, koers, snelheid en — als de bron hem geeft — de naam. Toont lang niet alles; zie de waarschuwing hierboven. |

## Nieuw in v3.0 — routepunten bewerken

- ✋ **Sleep een routepunt** om het te verplaatsen; de reistijd, de tijd-bolletjes en de
  sluizen/bruggen op de route rekenen live mee terwijl je sleept.
- ✕ **Tik een routepunt aan** voor een menuutje: *punt erna invoegen* of *dit punt verwijderen*.
  Bewust geen tik-is-weg, want dat gaat op het water gegarandeerd een keer mis.
- Bewerken werkt **ook als de Route-knop uit staat** — je hoeft dus geen modus aan te zetten om
  een bestaande route bij te stellen. De Route-knop is er alleen om nieuwe punten toe te voegen.
- Punten zijn genummerd; het laatste punt is opgevuld zodat je ziet waar de route eindigt.

## Nieuw in v2.9 — getij, kaartprovider en zeekaart

- 🌊 **Actuele waterstand** van het dichtstbijzijnde Rijkswaterstaat-meetstation (93 stations in
  het vaargebied), met trendpijl en hoe oud de meting is. Vaar je een ander gebied in, dan schakelt
  de app vanzelf naar een dichterbij station.
- ⚓ **Getij in de kielspeling — alleen als jij het reductievlak invult.** De dieptedata is t.o.v.
  LAT, de waterstand t.o.v. NAP, en dat verschil loopt per gebied uiteen. Vul je bij
  *Instellingen → Diepte → Reductievlak t.o.v. NAP* het getal uit de Wateralmanak in, dan rekent de
  app het getij mee (je ziet dan bv. *"getij +1,88 m"* onder de kielspeling). Laat je het op **uit**
  staan, dan blijft de kielspeling de kale kaartdiepte. Dat getal raden we niet.
- 🗺️ **Kaartprovider instelbaar** — zie [`config.js`](config.js). Met een sleutel van MapTiler of
  Thunderforest verschijnen hun lagen automatisch in de kaartkiezer, inclusief MapTiler's
  zeekaart-stijl. Zonder sleutel werkt alles gewoon door op OpenStreetMap.
- ⚓ **Zeekaart-symbolen** staan nu als aparte knop náást de kaartkiezer, en kunnen daardoor ook
  over de satellietkaart heen — dat kon eerder niet.

> ⚠️ **Vóór een commerciële uitrol:** de gratis tegelservers van OpenStreetMap en OpenSeaMap zijn
> volgens hun Tile Usage Policy niet bedoeld voor commercieel of zwaar gebruik. Zet dan een betaalde
> provider in `config.js`.

### Waterstanden vereisen een kleine proxy

De RWS-API stuurt geen CORS-headers, dus een webapp mag hem niet rechtstreeks aanroepen
(gecontroleerd op 2026-08-16). In [`tools/proxy/`](tools/proxy/) staat kant-en-klare code voor
Netlify Functions en Cloudflare Workers — gratis, in een paar minuten live. Vul daarna de URL in bij
`TIDE_API` in `config.js`. Doe je dit niet, dan blijft de getij-tegel leeg en werkt de rest normaal.

## Nieuw in v2.8 — bruggen openen op basis van jouw hoogte

- 📏 **Hoogte boven water** (*Instellingen → Vooruitblik*). Vul het hoogste punt van je boot in.
  Past dat plus 0,5 m marge onder de doorvaarthoogte van een gesloten brug, dan vaar je er zó
  onderdoor: **geen brugopening, geen wachttijd**. Past het niet, dan rekent de app de wachttijd.
  Op de kaart zie je per object waaróm: groen *"vrij · 5,4 m"* of geel *"+15m"*.
- ⛔ **Vaste bruggen** waar je niet onder past zijn geen vertraging maar een **blokkade** — die
  krijgen een rode markering en een waarschuwing, want zo'n brug gaat nooit open.
- ❓ **Onbekende hoogte = altijd openen.** Kent de app de doorvaarthoogte niet, of heb je je eigen
  hoogte niet ingesteld, dan rekent hij altijd met een brugopening én zet er *"hoogte ?"* bij.
  De app gokt nooit een hoogte.
- 🌉 **~190 extra bruggen en sluizen** uit OpenStreetMap, waarvan het merendeel mét doorvaarthoogte.
  Deze laag voedt **alleen de routeplanning**. Het marifoonkanaal-advies blijft uitsluitend uit de
  handmatig geverifieerde lijst komen, omdat OSM geen betrouwbare marifoonkanalen bevat.
- 📱 **Interface schaalt nu ook op de kaart.** Knoppen, pins en tijdlabels volgen de leesafstand-
  instelling (telefoon → cockpit). De zoomregelaar staat rechtsonder in plaats van bovenop de
  vooruitblik-knoppen.

### Databronnen

| Wat | Bron | Licentie |
|---|---|---|
| Marifoonkanalen | RWS FIS/VNDS en Vaarweginformatie; aanvullend waterkaart.net, varendoejesamen.nl, Nautin | landelijk officieel + handmatig geverifieerd |
| Bruggen, sluizen, doorvaarthoogtes | OpenStreetMap (Overpass API) | ODbL |
| Dieptedata Waddenzee | Inland ENC / S-57 (Rijkswaterstaat) | open |
| Kaarttegels | OpenStreetMap · OpenSeaMap · Esri | zie licentievoorwaarden |

Regenereren van de obstakellijst: zie `tools/` — het haalt de data opnieuw op bij Overpass en
schrijft `obstacles.js`. Dat bestand is **gegenereerd**; pas het niet met de hand aan.

## Nieuw in v2.5 — wachttijd bij sluizen & bruggen

- ⏱️ **Schutten telt mee in de reistijd.** Ligt er een sluis of brug op je routelijn, dan rekent de
  app daar **15 minuten** extra voor (in te stellen bij *Instellingen → Vooruitblik op de kaart →
  Wachttijd per sluis/brug*, 0–60 min). Het object krijgt een markering op de kaart met zijn
  wachttijd en kanaal, en — belangrijker — **alle tijd-bolletjes ná dat object schuiven mee op**.
  Zo blijft "waar ben ik over 2 uur" kloppen. In de balk onderin zie je de totaaltijd inclusief
  wachten: *Route 37 km · 4u55 · incl. 2× sluizen/bruggen +30 min*.

  Een object telt mee als je lijn er binnen zijn meldradius (500–800 m) langsgaat.

## Nieuw in v2.2 — vooruitblik & route

- 🔮 **Schaal- & snelheidsafhankelijke vooruitblik.** Tijd-bolletjes langs je koers waarvan het
  interval en de horizon zich automatisch aanpassen: ver ingezoomd fijn (bv. elke 5–10 min tot ~1u),
  uitgezoomd grover (tot elke 30–60 min). Sneller varen → automatisch een fijner interval bij
  dezelfde zoom. Let op: de horizon stopt bij **4 uur vooruit**, dus ver uitgezoomd blijven de
  bolletjes een klompje bij de boot — dat is de grens van de voorspelling, niet van je beeld.
- ✏️ **Teken je eigen routelijn** (knop *Route* op de kaart) — de tijd/afstand-bolletjes projecteren
  zich op jouw lijn, op basis van je snelheid. Handig om te schatten wanneer je waar bent, ook om een hoek.
- ◎ **Afstandsringen** vanaf de boot (knop *Ringen*) op diezelfde afgestemde afstanden.
- ⚓ **Planningssnelheid** (Instellingen) — voor de vooruitblik als je (nog) stilligt.

> ⚠️ De routelijn is een **rechte lijn tussen jouw punten** — de app kent geen vaargeulen, ondieptes
> of land. Hij rekent alleen tijd en afstand. Gebruik hem om te plannen, niet om op te sturen.

## Nieuw in v2

- 🧭 **Koers-vooruitkijken** — je krijgt pas een melding voor een sluis/brug als je er écht naartoe
  vaart. De meldafstand groeit automatisch met je snelheid.
- 📱💻 **Afstand-bewuste weergave** — telefoon voor dichtbij (~1 m), tablet/laptop als **cockpit** met
  fors grotere cijfers, leesbaar op 2–3 m. In te stellen bij *Instellingen → Leesafstand*
  (Telefoon / Tablet / Cockpit + fijnregeling).
- 🖥️ **Altijd fullscreen** — knop ⛶ rechtsboven; op iPhone via "Zet op beginscherm".
- ⚓ **Ankeralarm** — ankerpositie vastleggen, instelbare straal, alarm bij wegdriften (met anti-ruis).
- 🌊 **Kielspeling** — laad optioneel officiële dieptedata (GeoJSON); de app rekent kielspeling =
  diepte − diepgang en waarschuwt onder je marge. **De app verzint nooit zelf dieptes.**
- 🆘 **Mayday-hulpkaart** — noodprocedure op kanaal 16 met je positie voorgevuld.
- ✅ **Geverifieerde kanalen** — 56 van 57 kanalen bevestigd door minstens twee officiële bronnen.
  (Lorentzsluizen 18, Stevinsluizen 20, Houtribsluizen 20, Naviduct Krabbersgat 22, Ketelbrug 18,
  Oranjesluizen 18, VTS Den Helder 62, enz.)

Verder: kaart met gebieden/sluizen/bruggen/KNRM, nachtmodus (rood/gedimd), geluid + trillen +
systeemmelding, scherm-aan-houden, simulatiemodus (tik op de kaart) en offline werking.

---

## Installeren op je toestel

Zet de app eerst online (https), daarna installeer je hem als app.

### Online zetten — kies één
- **Netlify Drop** (makkelijkst): ga naar `https://app.netlify.com/drop` en sleep de uitgepakte
  map `marifoonpilot` erin. Je krijgt direct een https-adres.
- **GitHub Pages**: maak een repo, upload alle bestanden (via *Add file → Upload files*), en zet
  *Settings → Pages → Deploy from branch → main / root* aan.

### Op je toestel zetten
- **iPhone/iPad (Safari):** deel-icoon ⬆︎ → **"Zet op beginscherm"**.
- **Android (Chrome):** menu ⋮ → **"App installeren"**.
- **Laptop (Chrome/Edge):** installeer-icoon in de adresbalk, of menu → "Installeren".

Sta locatie toe op **"altijd/tijdens gebruik"** voor de beste werking op het water.

---

## Dieptedata (kielspeling)

De app wordt geleverd **mét dieptedata voor de hele Waddenzee** (ruim 76.000 officiële lodingen
uit de Inland ENC / S-57 zeekaarten, uitgedund tot ~150 m, per vak de ondiepste loding). Die
laadt automatisch — je hoeft niets te doen. Zet je eigen diepgang goed (Instellingen → Diepte),
dan zie je de kielspeling en krijg je een waarschuwing als die onder je marge komt.

Let op de Waddenzee: die dieptes zijn t.o.v. het reductievlak (LAT) en **de echte diepte wisselt
met het getij** — gebruik het indicatief, tussen de tijen door, nooit als navigatie.

**IJsselmeer / Markermeer / Randmeren:** hier wint de **RWS-loding** (20 m, t.o.v. NAP), met het
meetjaar erbij. Waar RWS niets heeft, is het EMODnet-model de achtervang — een regionaal
bodemmodel, geen actuele loding, en als *model* gelabeld. Op de kaart staan daarnaast de
officiële FIS/VNDS-vaarwegdieptes en maximale toegestane diepgang per gepubliceerd traject.

## Eigen dieptedata toevoegen (optioneel)

Bij *Instellingen → Diepte & kielspeling → Officiële dieptedata laden* kies je een GeoJSON-bestand.
Verwacht formaat — een `FeatureCollection` van `Point`-features met diepte in meters:

```json
{
  "type": "FeatureCollection",
  "properties": { "source": "Rijkswaterstaat", "datum": "LAT", "unit": "m" },
  "features": [
    { "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [5.28, 52.80] },
      "properties": { "depth": 3.4 } }
  ]
}
```

Let op: coördinaten in GeoJSON-volgorde `[lengtegraad, breedtegraad]`. Gebruik uitsluitend
**officiële** dieptedata (bv. van Rijkswaterstaat) — MarifoonPilot toont alleen wat je zelf laadt.

---

## Kanalen aanpassen of uitbreiden

Alles staat als platte data in `data.js`: `AREAS` (gebieden), `POINTS` (sluizen/bruggen),
`VTS`, `HARBORS`, `KNRM` en `EMERGENCY`. Een brug toevoegen is één regel erbij in `POINTS`
(met `lat`, `lon`, `channel`, `radius`).

---

## ⚠️ Belangrijk — veiligheid

MarifoonPilot is een **hulpmiddel, geen vervanging** voor je marifoon of officiële vaarinformatie.

- Kanalen en bedieningstijden **kunnen wijzigen**. Controleer altijd de **Wateralmanak deel 1 & 2**
  en **vaarweginformatie.nl**.
- De vaargebieden zijn **indicatief** ingetekend voor kanaaladvies — **niet** om op te navigeren.
- In nood: **kanaal 16** (Kustwacht luistert 24/7 uit).

Kanalen geverifieerd (juli 2026) via Rijkswaterstaat Vaarweginformatie, waterkaart.net,
varendoejesamen.nl en Nautin.

Behouden vaart! ⛵
