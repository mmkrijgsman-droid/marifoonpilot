/* Waterstand-proxy voor NAVIQ — Netlify Functions
 * ---------------------------------------------------------------
 * Waarom dit nodig is: de Rijkswaterstaat Waterinfo-API stuurt geen CORS-headers, dus een
 * browser weigert het antwoord. Server-naar-server mag wel. Deze functie haalt de data op
 * en zet er de CORS-header bij.
 *
 * Plaatsen:  netlify/functions/waterstand.js  in de root van je site
 * Daarna:    zet in config.js  TIDE_API = "https://<jouw-site>.netlify.app/.netlify/functions/waterstand"
 *
 * De cache van 5 minuten houdt het aantal calls naar Rijkswaterstaat laag: al je gebruikers
 * samen halen de data hooguit eens per 5 minuten op, ongeacht hoeveel het er zijn.
 */
const RWS = "https://waterinfo.rws.nl/api/point/latestmeasurement?parameterId=waterhoogte";

// Beperk tot je eigen domein zodra je live gaat; "*" is handig tijdens het bouwen.
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "*";

exports.handler = async function () {
  const headers = {
    "Access-Control-Allow-Origin": ALLOW_ORIGIN,
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=300"
  };
  try {
    const res = await fetch(RWS, {
      headers: { "User-Agent": "NAVIQ/2.9 (+https://github.com/)", "Accept": "application/json" }
    });
    if (!res.ok) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: "RWS gaf status " + res.status }) };
    }
    return { statusCode: 200, headers, body: await res.text() };
  } catch (e) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: String(e && e.message || e) }) };
  }
};
