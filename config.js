/* MarifoonPilot — kaartlagen, API-sleutels en externe diensten
 * ------------------------------------------------------------------
 * Dit is het enige bestand dat je hoeft aan te passen om over te stappen op een
 * betaalde kaartprovider of om het getij aan te zetten. Zonder sleutels werkt de
 * app gewoon door op OpenStreetMap.
 *
 * ⚠️ WAAROM DIT MOET voor een uitrol: de gratis tegelservers van OpenStreetMap en
 * OpenSeaMap zijn niet bedoeld voor commercieel of zwaar gebruik (zie hun Tile Usage
 * Policy). Bij groei word je geblokkeerd. MapTiler en Thunderforest hebben betaalde
 * abonnementen die dat wél toestaan.
 *
 * ⚠️ EEN SLEUTEL IN EEN WEBAPP IS ZICHTBAAR voor iedere gebruiker — dat is inherent aan
 * een PWA en beide providers gaan daarvan uit. Bescherm je sleutel daarom bij de provider
 * met een domeinrestrictie (allowed origins / referrers), niet door hem te verbergen:
 *   MapTiler      → cloud.maptiler.com → Keys → "Allowed origins"
 *   Thunderforest → manage.thunderforest.com → API key → "Referrer restrictions"
 */
"use strict";

const MAP_KEYS = {
  maptiler: "32W0iq9tVFbDXqa5lQlZ", // https://cloud.maptiler.com/account/keys/
  thunderforest: "06c3ef5625d4405d8d0e70e0b9535897"   // https://manage.thunderforest.com/
};

/* Actuele waterstanden (getij) — Rijkswaterstaat Waterinfo.
 * ------------------------------------------------------------------
 * Die API stuurt GEEN CORS-headers (gecontroleerd op 2026-08-16), dus een webapp mag hem
 * niet rechtstreeks aanroepen. Server-naar-server werkt prima; er moet dus een kleine proxy
 * tussen. In tools/proxy/ staat kant-en-klare code voor Netlify Functions en Cloudflare
 * Workers — beide gratis en in een paar minuten live.
 *
 * Leeg laten kan gewoon: dan blijft de getij-tegel op "–" staan en werkt de rest normaal.
 */
const TIDE_API = "";           // bv. "https://jouwapp.netlify.app/.netlify/functions/waterstand"
const TIDE_REFRESH_MIN = 10;   // RWS meet elke 10 minuten; vaker ophalen heeft geen zin

/* AIS-scheepvaart via EuRIS (eurisportal.eu).
 *
 * De EuRIS-trackdienst antwoordt zonder token — een sleutel is dus niet nodig — maar
 * stuurt geen CORS-headers, net als Waterinfo hierboven. Daarom loopt ook dit via een
 * proxy; in tools/proxy/ staat ais.js (Netlify) en ais-worker.js (Cloudflare). Die doen
 * meteen het pagineren en filteren, want ongefilterd is één corridor 85 KB.
 *
 * Leeg laten kan gewoon: dan blijft de AIS-knop zonder effect en werkt de rest normaal.
 * Je kunt de URL ook per toestel invullen bij Instellingen → Scheepvaart (AIS).
 */
const AIS_API = "";            // bv. "https://jouwapp.netlify.app/.netlify/functions/ais"

/* Basiskaarten. `needs` verwijst naar een sleutel in MAP_KEYS; is die leeg, dan verbergt
 * de app de laag automatisch. `{key}` wordt vervangen door de sleutel. */
const TILE_LAYERS = [
  { id:"osm", label:"Kaart (OSM)", needs:null, free:true,
    url:"https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    maxZoom:19, attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },

  { id:"mt-streets", label:"Kaart (MapTiler)", needs:"maptiler",
    url:"https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key={key}",
    maxZoom:20, attribution:'&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },

  { id:"mt-ocean", label:"Zeekaart (MapTiler)", needs:"maptiler",
    url:"https://api.maptiler.com/maps/ocean/{z}/{x}/{y}.png?key={key}",
    maxZoom:20, attribution:'&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },

  { id:"mt-sat", label:"Satelliet (MapTiler)", needs:"maptiler",
    url:"https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key={key}",
    maxZoom:20, attribution:'&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a>' },

  { id:"tf-outdoors", label:"Kaart (Thunderforest)", needs:"thunderforest",
    url:"https://tile.thunderforest.com/outdoors/{z}/{x}/{y}.png?apikey={key}",
    maxZoom:22, attribution:'Maps &copy; <a href="https://www.thunderforest.com/">Thunderforest</a>, Data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },

  { id:"tf-landscape", label:"Landschap (Thunderforest)", needs:"thunderforest",
    url:"https://tile.thunderforest.com/landscape/{z}/{x}/{y}.png?apikey={key}",
    maxZoom:22, attribution:'Maps &copy; <a href="https://www.thunderforest.com/">Thunderforest</a>, Data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },

  { id:"esri-sat", label:"Satelliet (Esri)", needs:null, free:true,
    url:"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    maxZoom:19, attribution:"&copy; Esri" }
];

/* Overlays liggen bovenop de basiskaart en zijn los aan/uit te zetten. Elke overlay
 * krijgt automatisch een eigen knop naast de kaartkiezer. */
const TILE_OVERLAYS = [
  { id:"seamark", label:"⚓ Zeekaart", shortLabel:"⚓ Zee", title:"Zeekaart-symbolen: boeien, tonnen, vaargeulen",
    needs:null, free:true, type:"tile",
    url:"https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png",
    maxZoom:18, opacity:0.9, attribution:'&copy; <a href="https://www.openseamap.org/">OpenSeaMap</a>' },

  /* Dieptekaart. Rijkswaterstaat heeft hier een eigen dienst voor
   * (geo.rijkswaterstaat.nl .../bodemhoogte_ijsselmeergebied), maar die is aan hun kant
   * kapot: WMS en WCS geven voor álle jaargangen "Failed to create reader from
   * file:///mnt/appsdata-prod/...tif" (gecontroleerd 2026-08-16). Zolang dat zo is
   * gebruiken we EMODnet, dat wél werkt en het hele vaargebied dekt.
   *
   * ⚠️ EMODnet is een regionaal model (~115 m raster) — geschikt om te zien wáár het
   * ondiep wordt, niet om op te navigeren. De numerieke kielspeling in de app blijft
   * op de fijnere loodingen uit depth/diepte.geojson draaien. */
  { id:"depth", label:"🌊 Vaardieptes", shortLabel:"🌊 Diepte", title:"Landelijke RWS-vaarwegdieptes en maximale diepgang, met indicatieve EMODnet-bodemlijnen",
    needs:null, free:true, type:"wms",
    url:"https://ows.emodnet-bathymetry.eu/wms",
    /* Bewust de CONTOUR-laag en niet de kleurenkaart: die laatste gebruikt een wereldwijde
     * schaal tot -5000 m, waardoor het hele ondiepe IJsselmeer in één kleurband valt en je
     * alleen een egale waas ziet. Dieptelijnen zeggen in ondiep binnenwater wél iets. */
    wms:{ layers:"emodnet:contours", format:"image/png", transparent:true, version:"1.3.0" },
    maxZoom:18, opacity:0.9,
    attribution:'&copy; <a href="https://emodnet.ec.europa.eu/en/bathymetry">EMODnet Bathymetry</a>' }
];

/* Hosts waarvan de service worker tegels mag cachen. Nieuwe provider erbij? Zet hem hier
 * ook neer, anders werkt hij niet offline. */
const TILE_HOSTS = [
  "tile.openstreetmap.org", "tiles.openseamap.org", "server.arcgisonline.com",
  "api.maptiler.com", "tile.thunderforest.com"
];
