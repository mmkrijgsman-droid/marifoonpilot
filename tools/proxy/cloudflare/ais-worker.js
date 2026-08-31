/* AIS-proxy voor NAVIQ — Cloudflare Workers
 * ---------------------------------------------------------------
 * Zelfde doel en zelfde regels als de Netlify-variant (zie ais.js daar voor het waarom):
 * de EuRIS-trackdienst antwoordt zonder token maar zonder CORS-headers. Er is hier geen
 * geheim te bewaken — deze Worker bestaat voor die header, en pagineert, filtert en
 * strript meteen, zodat een telefoon niet 85 KB per verversing binnenhaalt.
 *
 * Zet ALLOW_ORIGIN als omgevingsvariabele op je eigen domein zodra je live gaat.
 */
const EURIS = "https://www.eurisportal.eu/api/v3/tracks/bounding-box";

const MAX_PAGINAS = 12;
const MAX_GRAAD = 1.2;
const GROOT_SCHIP_M = 20;        // ook stilliggend meenemen vanaf deze lengte
// Op het IJsselmeer is "varend of >= 20 m" precies goed: het zeeft 728 liggende
// bootjes weg. Op de randmeren pakt datzelfde filter te hard door - bij Nulde
// passeren maar 4 van de 21 doelen, en dan lijkt de kaart kapot in plaats van rustig.
// Blijft er weinig over, dan vullen we aan met de rest, tot een bovengrens.
const MIN_TONEN = 40;
const MAX_TONEN = 120;
const PLAATSVERVANGER = /^Track\s+\d+$/i;

function verklein(t) {
  const naam = (typeof t.name === "string" && !PLAATSVERVANGER.test(t.name.trim()))
    ? t.name.trim() : null;
  const o = { id: String(t.trackId), lat: t.lat, lon: t.lon };
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

const relevant = t => t.isMoving === true || (Number(t.length) || 0) >= GROOT_SCHIP_M;

export default {
  async fetch(request, env, ctx) {
    const origin = (env && env.ALLOW_ORIGIN) || "*";
    const headers = {
      "Access-Control-Allow-Origin": origin,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=30"
    };
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: { ...headers, "Access-Control-Allow-Methods": "GET, OPTIONS" } });
    }

    const p = new URL(request.url).searchParams;
    const bbox = {};
    for (const k of ["minLon", "minLat", "maxLon", "maxLat"]) {
      const v = Number(p.get(k));
      if (!Number.isFinite(v)) {
        return new Response(JSON.stringify({ error: "ontbrekende of ongeldige " + k }), { status: 400, headers });
      }
      bbox[k] = v;
    }
    if (bbox.maxLon <= bbox.minLon || bbox.maxLat <= bbox.minLat) {
      return new Response(JSON.stringify({ error: "max moet groter zijn dan min" }), { status: 400, headers });
    }
    if (bbox.maxLon - bbox.minLon > MAX_GRAAD || bbox.maxLat - bbox.minLat > MAX_GRAAD) {
      return new Response(JSON.stringify({ error: "gebied te groot (max " + MAX_GRAAD + "°)" }), { status: 400, headers });
    }

    // Edge-cache op de genormaliseerde bbox, zodat vijftig schippers in hetzelfde vak
    // samen hooguit eens per 30 s bij EuRIS aankloppen.
    const sleutel = new Request(EURIS + "?k=" + [bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat]
      .map(v => v.toFixed(3)).join(","), { method: "GET" });
    const cache = caches.default;
    const hit = await cache.match(sleutel);
    if (hit) return new Response(hit.body, { status: 200, headers });

    try {
      const kern = [], rest = [];
      let bekeken = 0;
      for (let i = 0; i < MAX_PAGINAS; i++) {
        const url = EURIS + "?minLon=" + bbox.minLon + "&minLat=" + bbox.minLat
          + "&maxLon=" + bbox.maxLon + "&maxLat=" + bbox.maxLat
          + "&pageSize=100&skip=" + (i * 100);
        const up = await fetch(url, {
          headers: { "User-Agent": "NAVIQ/4.9", "Accept": "application/json" }
        });
        if (!up.ok) throw new Error("EuRIS gaf status " + up.status);
        const rij = await up.json();
        if (!Array.isArray(rij) || rij.length === 0) break;
        bekeken += rij.length;
        for (const t of rij) (relevant(t) ? kern : rest).push(verklein(t));
        if (rij.length < 100) break;
      }
      let schepen = kern, aangevuld = false;
      if (kern.length < MIN_TONEN && rest.length) {
        schepen = kern.concat(rest.slice(0, Math.max(0, MAX_TONEN - kern.length)));
        aangevuld = schepen.length > kern.length;
      }
      const body = JSON.stringify({
        bron: "EuRIS (eurisportal.eu)",
        opgehaald: new Date().toISOString(),
        bekeken, aantal: schepen.length, varendOfGroot: kern.length, aangevuld, schepen
      });
      const res = new Response(body, { status: 200, headers });
      ctx.waitUntil(cache.put(sleutel, res.clone()));
      return res;
    } catch (e) {
      return new Response(JSON.stringify({ error: String((e && e.message) || e) }), { status: 502, headers });
    }
  }
};
