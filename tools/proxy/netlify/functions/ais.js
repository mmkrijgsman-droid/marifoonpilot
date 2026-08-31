/* AIS-proxy voor NAVIQ — Netlify Functions
 * ---------------------------------------------------------------
 * Waarom dit nodig is: de EuRIS-trackdienst antwoordt prima zonder token, maar stuurt
 * geen CORS-headers — niet op de preflight en niet op de GET. Een browser weigert het
 * antwoord dus. Er is hier GEEN geheim te bewaken; deze proxy bestaat puur voor die
 * header, en doet meteen het werk dat je niet op een telefoon wilt doen.
 *
 * Plaatsen:  netlify/functions/ais.js  in de root van je site
 * Daarna:    zet in config.js  AIS_API = "https://<jouw-site>.netlify.app/.netlify/functions/ais"
 *
 * Wat deze functie extra doet, en waarom:
 *   - PAGINEREN. EuRIS geeft maximaal 100 schepen per aanroep, ook als je meer vraagt.
 *   - FILTEREN. Een gebied van 18x12 km levert 100 schepen waarvan er 24 varen; de rest
 *     ligt in de jachthavens. Daar heeft een schipper niets aan. We houden alles wat vaart,
 *     plus alles vanaf 20 m ook als het stilligt — een wachtend beroepsschip bij een sluis
 *     is juist wél relevant.
 *   - VELDEN STRIPPEN. Van de 38 velden zijn er bij een geanonimiseerde track ruim dertig
 *     leeg of nul. Ongefilterd is een corridor 85 KB; zo blijft er een paar KB over.
 *   - NAAM NORMALISEREN. EuRIS zet bij een afgeschermd schip "Track 745031" in het naamveld.
 *     Dat is geen naam maar een plaatsvervanger, en die geven we door als null. Anders staat
 *     er straks een "scheepsnaam" op het scherm die niemand over de marifoon herkent.
 */
const EURIS = "https://www.eurisportal.eu/api/v3/tracks/bounding-box";

// Beperk tot je eigen domein zodra je live gaat; "*" is handig tijdens het bouwen.
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "*";

const MAX_PAGINAS = 12;          // 1200 schepen; ruim boven wat een corridor ooit oplevert
const MAX_GRAAD = 1.2;           // grootste toegestane bbox-zijde, tegen "heel Europa"-vragen
const GROOT_SCHIP_M = 20;        // ook stilliggend meenemen vanaf deze lengte
// Op het IJsselmeer is "varend of >= 20 m" precies goed: het zeeft 728 liggende
// bootjes weg. Op de randmeren pakt datzelfde filter te hard door - bij Nulde
// passeren maar 4 van de 21 doelen, en dan lijkt de kaart kapot in plaats van rustig.
// Blijft er weinig over, dan vullen we aan met de rest, tot een bovengrens.
const MIN_TONEN = 40;
const MAX_TONEN = 120;

const PLAATSVERVANGER = /^Track\s+\d+$/i;

function getal(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* Alleen doorgeven wat de app echt tekent. Nul en null gooien we weg, zodat een
 * geanonimiseerde track niet dertig lege velden meesleept. */
function verklein(t) {
  const naam = (typeof t.name === "string" && !PLAATSVERVANGER.test(t.name.trim()))
    ? t.name.trim() : null;
  const o = {
    id: String(t.trackId),
    lat: t.lat,
    lon: t.lon
  };
  if (naam) o.naam = naam;
  if (t.callSign) o.roepnaam = t.callSign;
  if (t.mmsi) o.mmsi = t.mmsi;
  if (t.eni) o.eni = t.eni;
  if (t.length) o.lengte = t.length;
  if (t.beam) o.breedte = t.beam;
  if (t.speedGround != null) o.snelheid = t.speedGround;
  if (t.courseGround != null) o.koers = t.courseGround;
  if (t.numberOfCones) o.kegels = t.numberOfCones;
  if (t.dangerousGoods) o.gevaarlijk = t.dangerousGoods;
  if (t.navigationalStatus) o.status = t.navigationalStatus;
  if (t.isMoving) o.vaart = true;
  if (t.positionMeasuredAt) o.gemetenOp = t.positionMeasuredAt;
  if (t.isrsPositionName) o.plaats = t.isrsPositionName;
  return o;
}

function relevant(t) {
  return t.isMoving === true || (Number(t.length) || 0) >= GROOT_SCHIP_M;
}

async function haalAlles(bbox) {
  const kern = [];
  const rest = [];
  let totaal = 0;
  for (let p = 0; p < MAX_PAGINAS; p++) {
    const url = EURIS
      + "?minLon=" + bbox.minLon + "&minLat=" + bbox.minLat
      + "&maxLon=" + bbox.maxLon + "&maxLat=" + bbox.maxLat
      + "&pageSize=100&skip=" + (p * 100);
    const res = await fetch(url, {
      headers: { "User-Agent": "NAVIQ/4.9", "Accept": "application/json" }
    });
    if (!res.ok) throw new Error("EuRIS gaf status " + res.status);
    const rij = await res.json();
    if (!Array.isArray(rij) || rij.length === 0) break;
    totaal += rij.length;
    for (const t of rij) (relevant(t) ? kern : rest).push(verklein(t));
    if (rij.length < 100) break;
  }
  let schepen = kern, aangevuld = false;
  if (kern.length < MIN_TONEN && rest.length) {
    schepen = kern.concat(rest.slice(0, Math.max(0, MAX_TONEN - kern.length)));
    aangevuld = schepen.length > kern.length;
  }
  return { schepen, totaal, kern: kern.length, aangevuld };
}

exports.handler = async function (event) {
  const headers = {
    "Access-Control-Allow-Origin": ALLOW_ORIGIN,
    "Content-Type": "application/json; charset=utf-8",
    // Kort cachen: varende schepen hebben een positie van hooguit een paar minuten oud,
    // dus langer bewaren maakt het beeld onwaar. 30 s houdt EuRIS wel rustig.
    "Cache-Control": "public, max-age=30"
  };
  if (event && event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: { ...headers, "Access-Control-Allow-Methods": "GET, OPTIONS" }, body: "" };
  }

  const q = (event && event.queryStringParameters) || {};
  const bbox = {
    minLon: getal(q.minLon), minLat: getal(q.minLat),
    maxLon: getal(q.maxLon), maxLat: getal(q.maxLat)
  };
  for (const k of ["minLon", "minLat", "maxLon", "maxLat"]) {
    if (bbox[k] === null) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "ontbrekende of ongeldige " + k }) };
    }
  }
  if (bbox.maxLon <= bbox.minLon || bbox.maxLat <= bbox.minLat) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "max moet groter zijn dan min" }) };
  }
  if (bbox.maxLon - bbox.minLon > MAX_GRAAD || bbox.maxLat - bbox.minLat > MAX_GRAAD) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "gebied te groot (max " + MAX_GRAAD + "°)" }) };
  }

  try {
    const r = await haalAlles(bbox);
    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        bron: "EuRIS (eurisportal.eu)",
        opgehaald: new Date().toISOString(),
        bekeken: r.totaal,
        aantal: r.schepen.length,
        varendOfGroot: r.kern,
        aangevuld: r.aangevuld,
        schepen: r.schepen
      })
    };
  } catch (e) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: String((e && e.message) || e) }) };
  }
};
