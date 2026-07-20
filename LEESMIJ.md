# MarifoonPilot ⚓📻

Een GPS-vaarassistent die **automatisch het juiste marifoonkanaal** adviseert op basis van je
positie op het IJsselmeer, Markermeer en de Waddenzee. Vaar je een nieuw gebied binnen of nader
je een sluis of brug, dan krijg je een melding met geluid en het juiste kanaal — groot en van
afstand leesbaar in de kuip.

Het is een **PWA** (Progressive Web App): je installeert hem op Android én iPhone via de browser,
zónder app store, APK of Apple-account.

---

## Wat zit erin

- 📻 **Automatisch kanaaladvies** — groot kanaal in beeld, met kleur: groen = normaal, geel/rood = wisselen.
- 🔔 **Waarschuwing vóór een sluis/brug/gebied** — met geluid, trilsignaal en systeemmelding. De
  melding blijft staan tot je hem bevestigt.
- 🗺️ **Kaart** met je eigen boot, alle vaargebieden, sluizen en bruggen (OpenStreetMap, OpenSeaMap
  zeekaart en satelliet).
- 🔆 **Groot-scherm** ("Groot") — alleen het kanaal, enorm, voor vanaf een paar meter afstand.
- 📋 **Kanalenlijst** — nood- & oproepkanalen, verkeersposten, sluizen/bruggen en havens.
- 🌙 **Nachtmodus** (dag/nacht/automatisch) — rood/gedimd om je nachtzicht te sparen.
- 🧭 **Simulatiemodus** — test alles thuis: tik op de kaart om een positie te kiezen.
- 📴 **Offline** — na de eerste keer laden werkt de app (kaart van eerder bezochte gebieden inclusief).
- ⚙️ Instelbare waarschuwingsafstand (250–2000 m), geluid, trillen, scherm-aan-houden.

---

## Installeren op je telefoon

Je moet de app eerst **online zetten** (hosten op een adres met https). Twee makkelijke manieren:

### Optie A — Netlify Drop (makkelijkst, gratis, geen account nodig om te proberen)
1. Ga naar **https://app.netlify.com/drop**
2. Sleep de map `marifoonpilot` (of pak eerst `marifoonpilot.zip` uit) naar het vlak.
3. Je krijgt meteen een https-adres, bijv. `https://iets-willekeurigs.netlify.app`.
4. Open dat adres op je telefoon → installeer (zie hieronder).

### Optie B — GitHub Pages (gratis, eigen adres)
1. Maak een GitHub-repo en upload alle bestanden.
2. Repo → *Settings → Pages* → *Deploy from branch* → `main` / root.
3. Je krijgt een adres `https://<gebruiker>.github.io/<repo>/`.

### Daarna: op je telefoon zetten
- **iPhone (Safari):** open het adres → deel-icoon **⬆︎** → **"Zet op beginscherm"**.
- **Android (Chrome):** open het adres → menu **⋮** → **"App installeren"**.

Open hem voortaan vanaf je beginscherm: schermvullend, mét GPS. Sta locatie toe op **"altijd"** of
**"tijdens gebruik"** voor de beste werking op het water.

> Tip: even lokaal proberen op je computer kan met een mini-webserver in de map:
> `python3 -m http.server 8000` → open `http://localhost:8000`. (Voor GPS op je telefoon is https/hosting nodig.)

---

## Kanalen aanpassen of uitbreiden

Alle vaargebieden, sluizen, bruggen en kanalen staan als **platte data** in `data.js`. Je kunt daar
eenvoudig gebieden bijmaken of kanalen wijzigen:

- `AREAS` — gebieden (polygonen) met een uitluisterkanaal.
- `POINTS` — sluizen/bruggen op hun exacte locatie, met kanaal en meldafstand.
- `VTS`, `HARBORS`, `EMERGENCY` — de referentielijsten.

Elk punt heeft `lat`, `lon`, `channel` en `radius` (meldafstand in meter). Nieuwe brug toevoegen =
één regel erbij in `POINTS`.

---

## ⚠️ Belangrijk — veiligheid

MarifoonPilot is een **hulpmiddel, geen vervanging** voor je marifoon of officiële vaarinformatie.

- Kanalen en bedieningstijden **kunnen wijzigen**. Controleer altijd de actuele
  **Wateralmanak deel 1 & 2** en **vaarweginformatie.nl**.
- De vaargebieden zijn **indicatief** ingetekend voor kanaaladvies — **niet** om op te navigeren.
  Gebruik altijd een gecertificeerde (zee)kaart.
- In nood: **kanaal 16** (de Kustwacht luistert 24/7 uit).

Kanalen in deze versie zijn geverifieerd via Nautin, Waterkaart Live en Rijkswaterstaat
Vaarweginformatie (juli 2026).

Behouden vaart! ⛵
