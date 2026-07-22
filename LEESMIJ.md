# MarifoonPilot v2 ⚓📻

Een GPS-vaarassistent die **automatisch het juiste marifoonkanaal** adviseert op het IJsselmeer,
Markermeer en de Waddenzee — op basis van je **positie én vaarrichting**. Werkt als **PWA** op
**telefoon, tablet én laptop**, zónder app store, en altijd schermvullend.

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

**IJsselmeer / Markermeer / Randmeren:** hiervoor zit (nog) geen vlakdekkende diepte in de app.
De vrij beschikbare zeekaarten bevatten daar alleen vaargeul-dieptes, geen open-water bathymetrie.
Wil je dat toch, dan is de bron de Rijkswaterstaat-dieptekaart (`bodemhoogte_20mtr.tif`) — zie
hieronder hoe je die omzet.

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
