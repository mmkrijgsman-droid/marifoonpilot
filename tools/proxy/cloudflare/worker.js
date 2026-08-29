/* Waterstand-proxy voor MarifoonPilot — Cloudflare Workers
 * ---------------------------------------------------------------
 * Zelfde doel als de Netlify-variant: de Rijkswaterstaat-API stuurt geen CORS-headers,
 * dus haalt deze Worker de data server-side op en zet ze er wel bij.
 *
 * Zet ALLOW_ORIGIN als omgevingsvariabele op je eigen domein zodra je live gaat.
 */
const RWS = "https://waterinfo.rws.nl/api/point/latestmeasurement?parameterId=waterhoogte";

export default {
  async fetch(request, env, ctx) {
    const origin = (env && env.ALLOW_ORIGIN) || "*";
    const headers = {
      "Access-Control-Allow-Origin": origin,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: { ...headers, "Access-Control-Allow-Methods": "GET, OPTIONS" }
      });
    }

    // Cloudflare cachet dit edge-side, zodat RWS hooguit eens per 5 minuten wordt bevraagd
    const cache = caches.default;
    const cacheKey = new Request(RWS, { method: "GET" });
    let res = await cache.match(cacheKey);

    if (!res) {
      const upstream = await fetch(RWS, {
        headers: { "User-Agent": "MarifoonPilot/2.9", "Accept": "application/json" },
        cf: { cacheTtl: 300, cacheEverything: true }
      });
      if (!upstream.ok) {
        return new Response(JSON.stringify({ error: "RWS gaf status " + upstream.status }), {
          status: 502, headers
        });
      }
      res = new Response(upstream.body, upstream);
      res.headers.set("Cache-Control", "public, max-age=300");
      ctx.waitUntil(cache.put(cacheKey, res.clone()));
    }

    return new Response(res.body, { status: 200, headers });
  }
};
