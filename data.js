/* MarifoonPilot – vaargebieden & kanalen
 * Kanalen geverifieerd via Nautin, Waterkaart Live en Rijkswaterstaat Vaarweginformatie (juli 2026).
 * Coördinaten van gebieden zijn INDICATIEF (ruwe begrenzing) — bedoeld voor kanaaladvies,
 * niet voor navigatie. Sluizen/bruggen zijn op hun werkelijke locatie geplaatst.
 * Alles is bewust als platte data opgezet, zodat je het eenvoudig kunt uitbreiden/verfijnen.
 */

/* ---------- GEBIEDEN (polygonen) ----------
 * channel = uitluister-/aanroepkanaal in dat gebied (null = geen doorlopende post)
 * polygon = [ [lat,lon], ... ]  (globaal, mag ruw zijn)
 */
const AREAS = [
  {
    id: "vts-den-helder",
    name: "VTS Den Helder",
    channel: 62,
    reason: "Verkeerscentrale Den Helder — uitluisteren en melden op kanaal 62 (Marsdiep/Texelstroom).",
    color: "#e0662f",
    polygon: [
      [52.90,4.68],[53.02,4.72],[53.12,4.86],[53.18,5.05],[53.14,5.28],
      [53.06,5.36],[52.94,5.06],[52.90,4.80]
    ]
  },
  {
    id: "ijsselmeer",
    name: "IJsselmeer",
    channel: 1,
    reason: "Centrale Meldpost IJsselmeer — informatie/veiligheid op kanaal 01. Sluizen & bruggen op eigen kanaal.",
    color: "#2f9be0",
    polygon: [
      [52.930,5.020],[53.072,5.336],[53.060,5.430],[52.980,5.435],
      [52.880,5.560],[52.845,5.730],[52.720,5.720],[52.610,5.560],
      [52.520,5.440],[52.700,5.300],[52.770,5.100]
    ]
  },
  {
    id: "markermeer",
    name: "Markermeer / IJmeer",
    channel: null,
    reason: "Geen doorlopende verkeerspost. Gebruik het kanaal van sluis/brug/haven en luister uit op 16.",
    color: "#2fb0a0",
    polygon: [
      [52.700,5.300],[52.520,5.440],[52.420,5.380],[52.340,5.200],
      [52.310,4.980],[52.380,5.020],[52.440,5.000],[52.610,5.050]
    ]
  }
];

/* ---------- PUNTEN (sluizen, bruggen, meldposten) ----------
 * type: 'sluis' | 'brug' | 'post'
 * radius = standaard-meldafstand (m); wordt overschreven door de instelling
 * lat/lon = werkelijke locatie
 */
const POINTS = [
  // --- Afsluitdijk / overgang IJsselmeer <-> Waddenzee ---
  { id:"lorentz", name:"Lorentzsluizen", sub:"Kornwerderzand · Afsluitdijk", type:"sluis", channel:18, lat:53.0723, lon:5.3355, radius:800,
    reason:"Schutten tussen IJsselmeer en Waddenzee — bediening op kanaal 18." },
  { id:"stevin", name:"Stevinsluizen", sub:"Den Oever · Afsluitdijk", type:"sluis", channel:20, lat:52.9337, lon:5.0378, radius:800,
    reason:"Schutten tussen IJsselmeer en Waddenzee — bediening op kanaal 20." },

  // --- IJsselmeer ---
  { id:"ketelbrug", name:"Ketelbrug", sub:"A6 · Ketelmeer", type:"brug", channel:18, lat:52.6065, lon:5.7170, radius:700,
    reason:"Brugopening aanvragen/afstemmen op kanaal 18." },
  { id:"krabbersgat", name:"Krabbersgat / Naviduct", sub:"Enkhuizen–Lelystad", type:"sluis", channel:22, lat:52.7009, lon:5.3130, radius:700,
    reason:"Schutsluis tussen IJsselmeer en Markermeer — bediening op kanaal 22." },

  // --- Markermeer / IJmeer / Amsterdam ---
  { id:"houtrib", name:"Houtribsluizen", sub:"Lelystad", type:"sluis", channel:20, lat:52.5906, lon:5.4256, radius:700,
    reason:"Schutsluis tussen Markermeer en IJsselmeer — bediening op kanaal 20." },
  { id:"oranje", name:"Oranjesluizen", sub:"Schellingwoude · Amsterdam", type:"sluis", channel:18, lat:52.3796, lon:4.9925, radius:700,
    reason:"Schutten naar het Amsterdamse water / IJ — bediening op kanaal 18." },
  { id:"schellingwoude", name:"Schellingwoudebrug", sub:"Amsterdam-IJmeer", type:"brug", channel:18, lat:52.3821, lon:4.9868, radius:600,
    reason:"Brugbediening op kanaal 18." },

  // --- Waddenzee west / Den Helder ---
  { id:"koopvaarder", name:"Koopvaardersschutsluis", sub:"Den Helder", type:"sluis", channel:22, lat:52.9563, lon:4.7830, radius:600,
    reason:"Schutsluis Den Helder — bediening op kanaal 22." },
  { id:"moorman", name:"Moormanbrug", sub:"Den Helder", type:"brug", channel:18, lat:52.9546, lon:4.7862, radius:500,
    reason:"Brugbediening op kanaal 18." },

  // --- Waddenzee oost (referentie) ---
  { id:"tjerkhiddes", name:"Tjerk Hiddessluis", sub:"Harlingen", type:"sluis", channel:22, lat:53.1755, lon:5.4090, radius:700,
    reason:"Zeesluis Harlingen — bediening op kanaal 22." },
  { id:"robbengat", name:"Robbengatsluis", sub:"Lauwersoog", type:"sluis", channel:64, lat:53.4055, lon:6.2005, radius:700,
    reason:"Zeesluis Lauwersoog — bediening op kanaal 64." },
  { id:"farmsum", name:"Zeesluis Farmsum", sub:"Delfzijl", type:"sluis", channel:60, lat:53.3258, lon:6.9335, radius:700,
    reason:"Zeesluis Delfzijl — bediening op kanaal 60." }
];

/* ---------- VERKEERSPOSTEN (referentielijst) ---------- */
const VTS = [
  { name:"Verkeerscentrale Den Helder", sub:"VTS – Marsdiep / Texelstroom", channel:62 },
  { name:"Verkeerscentrale Brandaris", sub:"Terschelling – westelijke Waddenzee", channel:2 },
  { name:"Zeeverkeerspost Schiermonnikoog", sub:"oostelijke Waddenzee", channel:5 },
  { name:"Ems Traffic", sub:"Eemsmonding", channel:74 },
  { name:"VTS Delfzijl / Eemshaven", sub:"havengebied", channel:3 },
  { name:"Centrale Meldpost IJsselmeer", sub:"informatie & veiligheid IJsselmeer", channel:1 }
];

/* ---------- HAVENS (oproep) ---------- */
const HARBORS = [
  { name:"Enkhuizen", channel:12 }, { name:"Hoorn", channel:74 },
  { name:"Medemblik", channel:9 }, { name:"Monnickendam", channel:11 },
  { name:"Harlingen haven", channel:11 }, { name:"Den Helder haven (Willemsoord)", channel:74 }
];

/* ---------- NOOD- & OPROEPKANALEN ---------- */
const EMERGENCY = [
  { name:"Nood, spoed & veiligheid", sub:"Oproepkanaal · Kustwacht luistert 24/7 uit", channel:16, red:true },
  { name:"DSC digitaal noodoproep", sub:"Digital Selective Calling", channel:70, red:true },
  { name:"Kustwacht Nederland", sub:"na oproep op 16 → werkkanaal", channel:16, red:true },
  { name:"Jachthavens (marina)", sub:"veelgebruikt oproepkanaal NL", channel:31, red:false },
  { name:"Brug-/sluisbediening algemeen", sub:"bij twijfel eerst luisteren", channel:18, red:false }
];
