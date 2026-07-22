/* MarifoonPilot v2 – vaargebieden & kanalen
 * Kanalen geverifieerd (juli 2026) via Rijkswaterstaat Vaarweginformatie, waterkaart.net,
 * varendoejesamen.nl, Nautin en havenautoriteiten — met adversariële dubbelcontrole
 * (56/57 kanalen bevestigd door minstens twee bronnen).
 * Coördinaten van gebieden (polygonen) zijn INDICATIEF, bedoeld voor kanaaladvies — niet om
 * op te navigeren. Sluizen/bruggen staan op hun werkelijke locatie.
 * Alles is platte data, zodat je het eenvoudig kunt uitbreiden/verfijnen.
 */

/* ---------- GEBIEDEN (polygonen) ---------- */
const AREAS = [
  {
    id: "vts-den-helder", name: "VTS Den Helder", channel: 62,
    station: "Verkeerscentrale Den Helder",
    reason: "VTS-gebied — meld en luister uit op kanaal 62 (Marsdiep / Texelstroom).",
    color: "#e0662f",
    polygon: [[52.89,4.63],[52.96,4.64],[53.02,4.68],[53.05,4.79],[53.02,4.90],
              [52.94,4.90],[52.947,4.787],[52.915,4.72],[52.89,4.63]]
  },
  {
    id: "ijsselmeer", name: "IJsselmeer", channel: 1,
    station: "Centrale Meldpost IJsselmeergebied",
    reason: "Uitluisteren kanaal 01 (info-uitzending elk uur rond xx:15). Schip-schip: kanaal 10.",
    color: "#2f9be0",
    polygon: [[52.930,5.020],[53.072,5.336],[53.060,5.430],[52.980,5.435],
              [52.880,5.560],[52.845,5.730],[52.720,5.720],[52.610,5.560],
              [52.520,5.440],[52.700,5.300],[52.770,5.100]]
  },
  {
    id: "markermeer", name: "Markermeer / IJmeer", channel: 1,
    station: "Centrale Meldpost IJsselmeergebied",
    reason: "Uitluisteren kanaal 01 (CMIJ). Schip-schip: kanaal 10. Sluizen/havens op eigen kanaal.",
    color: "#2fb0a0",
    polygon: [[52.700,5.300],[52.520,5.440],[52.420,5.380],[52.340,5.200],
              [52.310,4.980],[52.380,5.020],[52.440,5.000],[52.610,5.050]]
  }
];

/* ---------- PUNTEN (sluizen & bruggen — kanaaladvies bij nadering) ----------
 * type: 'sluis' | 'brug'
 * radius = basis-meldafstand (m); schaalt met snelheid en instelling
 * conf: 'high' | 'medium'  (medium = op één bron gevonden, extra controleren)
 */
const POINTS = [
  // Afsluitdijk
  { id:"lorentz", name:"Lorentzsluizen", sub:"Kornwerderzand · Afsluitdijk", type:"sluis", channel:18, lat:53.0692, lon:5.3373, radius:800, conf:"high",
    reason:"Schutten IJsselmeer ↔ Waddenzee — bediening op kanaal 18. Ook de A7-bruggen: kanaal 18." },
  { id:"stevin", name:"Stevinsluizen", sub:"Den Oever · Afsluitdijk", type:"sluis", channel:20, lat:52.9308, lon:5.0468, radius:800, conf:"high",
    reason:"Schutten IJsselmeer ↔ Waddenzee — bediening op kanaal 20. Ook de A7-brug: kanaal 20." },
  // IJsselmeer / Ketelmeer
  { id:"ketelbrug", name:"Ketelbrug", sub:"A6 · Ketelmeer", type:"brug", channel:18, lat:52.6125, lon:5.6455, radius:700, conf:"high",
    reason:"Beweegbare brug A6. Opening 10 min vóór heel en half uur; buiten seizoen op afroep. Kanaal 18." },
  { id:"krabbersgat", name:"Naviduct Krabbersgat", sub:"Enkhuizen–Lelystad", type:"sluis", channel:22, lat:52.6906, lon:5.2954, radius:700, conf:"high",
    reason:"Aquaduct-sluis IJsselmeer ↔ Markermeer. Roep 'Naviduct-noordzijde' of '-zuidzijde'. Kanaal 22." },
  { id:"ramspol", name:"Ramspolbrug", sub:"N50 · Ramsdiep", type:"brug", channel:20, lat:52.6135, lon:5.8413, radius:700, conf:"medium",
    reason:"Beweegbare brug over het Ramsdiep. Buiten seizoen op afroep. Kanaal 20 (op één bron — controleren)." },
  { id:"reeve", name:"Reevesluis", sub:"Reevediep · Kampen", type:"sluis", channel:20, lat:52.5189, lon:5.8575, radius:600, conf:"medium",
    reason:"Schutsluis Reevediep (opvolger Roggebotsluis). Kanaal 20 (op één bron — controleren)." },
  // Houtribdijk
  { id:"houtrib", name:"Houtribsluizen", sub:"Lelystad", type:"sluis", channel:20, lat:52.5270, lon:5.4344, radius:700, conf:"high",
    reason:"Schutsluis Markermeer ↔ IJsselmeer. Bruggen niet bediend bij wind ≥ 6 Bft. Kanaal 20." },
  // Markermeer / Amsterdam
  { id:"oranje", name:"Oranjesluizen", sub:"Schellingwoude · Amsterdam", type:"sluis", channel:18, lat:52.3798, lon:4.9701, radius:700, conf:"high",
    reason:"Schutten naar het Amsterdamse water / IJ. Kanaal 18. Sector Schellingwoude: kanaal 60." },
  // Waddenzee west / Den Helder
  { id:"koopvaarder", name:"Koopvaardersschutsluis", sub:"Den Helder", type:"sluis", channel:22, lat:52.9470, lon:4.7873, radius:600, conf:"high",
    reason:"Schutsluis Den Helder (Noordzeekanaal-verbinding haven). Kanaal 22." },
  { id:"moorman", name:"Moormanbrug", sub:"Den Helder", type:"brug", channel:18, lat:52.9548, lon:4.7799, radius:500, conf:"high",
    reason:"Vice-Admiraal Moormanbrug. Kanaal 18." },
  // Waddenzee oost
  { id:"tjerkhiddes", name:"Tjerk Hiddessluis", sub:"Harlingen", type:"sluis", channel:22, lat:53.1742, lon:5.4088, radius:700, conf:"high",
    reason:"Zeesluis Harlingen (Waddenzee ↔ Van Harinxmakanaal). Kanaal 22." },
  { id:"robbengat", name:"Robbengatsluis", sub:"Lauwersoog", type:"sluis", channel:64, lat:53.4056, lon:6.2016, radius:700, conf:"high",
    reason:"Zeesluis Lauwersoog (Waddenzee ↔ Lauwersmeer). Kanaal 64." },
  { id:"farmsum", name:"Zeesluis Farmsum", sub:"Delfzijl", type:"sluis", channel:60, lat:53.3243, lon:6.9316, radius:700, conf:"high",
    reason:"Zeesluis Delfzijl. Kanaal 60. VTS/havendienst Delfzijl-Eemshaven: kanaal 66." },
  { id:"lemster", name:"Lemstersluis", sub:"Lemmer", type:"sluis", channel:22, lat:52.8490, lon:5.7178, radius:500, conf:"high",
    reason:"Sluis Lemmer (IJsselmeer ↔ Friese boezem). Kanaal 22." }
];

/* ---------- VERKEERSPOSTEN (referentie) ---------- */
const VTS = [
  { name:"Verkeerscentrale Den Helder", sub:"VTS – Marsdiep / Texelstroom", channel:62 },
  { name:"Verkeerscentrale Brandaris", sub:"Terschelling – westelijke Waddenzee", channel:2 },
  { name:"Zeeverkeerspost Schiermonnikoog", sub:"oostelijke Waddenzee", channel:5 },
  { name:"Ems Traffic", sub:"Eemsmonding (D/NL)", channel:74 },
  { name:"VTS Delfzijl / Eemshaven", sub:"havengebied", channel:66 },
  { name:"Centrale Meldpost IJsselmeer", sub:"info-uitzending elk uur ~xx:15", channel:1 }
];

/* ---------- HAVENS (oproep — controleer lokaal) ---------- */
const HARBORS = [
  { name:"Den Helder – Havendienst (Willemsoord)", channel:14, lat:52.9585, lon:4.7660 },
  { name:"Den Helder – Jachthaven Willemsoord", channel:31, lat:52.9615, lon:4.7835 },
  { name:"Harlingen – Havendienst", channel:11, lat:53.1748, lon:5.4088 },
  { name:"Makkum – Marina", channel:31, lat:53.0520, lon:5.4015 },
  { name:"Lelystad – Bataviahaven", channel:14, lat:52.5957, lon:5.2248 },
  { name:"Medemblik – Stadshaven", channel:31, lat:52.7716, lon:5.1052 },
  { name:"Hoorn – Binnenhaven", channel:74, lat:52.6424, lon:5.0557 },
  { name:"Monnickendam – Gemeentehaven", channel:11, lat:52.4586, lon:5.0378 },
  { name:"Enkhuizen – Compagnieshaven", channel:12, lat:52.7095, lon:5.2968 }
];

/* ---------- KNRM-reddingstations (alarmeren via Kustwacht / kanaal 16) ---------- */
const KNRM = [
  { name:"KNRM Enkhuizen", lat:52.7101, lon:5.2935 },
  { name:"KNRM Lelystad", lat:52.5918, lon:5.2438 },
  { name:"KNRM Harlingen", lat:53.1742, lon:5.4078 },
  { name:"KNRM Den Helder", lat:52.9645, lon:4.7845 },
  { name:"KNRM Makkum", lat:53.0525, lon:5.3992 },
  { name:"KNRM Stavoren", lat:52.8850, lon:5.3642 },
  { name:"KNRM Terschelling", lat:53.3623, lon:5.2185 }
];

/* ---------- NOOD- & OPROEPKANALEN ---------- */
const EMERGENCY = [
  { name:"Nood, spoed & veiligheid", sub:"Oproepkanaal · Kustwacht luistert 24/7 uit", channel:16, red:true },
  { name:"DSC digitaal noodoproep", sub:"Digital Selective Calling", channel:70, red:true },
  { name:"Opsporing & Redding (SAR)", sub:"na coördinatie door Kustwacht", channel:67, red:true },
  { name:"Kustwacht – veiligheids- & weerbericht", sub:"aankondiging op 16", channel:23, red:false },
  { name:"Kustwacht – veiligheids- & weerbericht", sub:"alternatief kanaal", channel:83, red:false },
  { name:"Jachthavens (marina)", sub:"veelgebruikt oproepkanaal NL", channel:31, red:false },
  { name:"Schip-schip / calamiteiten binnenwater", sub:"o.a. IJsselmeergebied", channel:10, red:false },
  { name:"Brug- & sluisbediening (algemeen)", sub:"meestal 18, 20 of 22", channel:18, red:false }
];
