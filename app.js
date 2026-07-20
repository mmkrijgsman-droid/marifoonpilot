/* MarifoonPilot – applicatielogica */
"use strict";

/* ---------------- Instellingen (met opslag) ---------------- */
const DEFAULTS = { warn:700, sound:true, vibe:true, notify:true, theme:"auto", wake:false, sim:false, seenIntro:false };
let S = load();
function load(){ try{ return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem("mp_settings")||"{}")); }catch(e){ return {...DEFAULTS}; } }
function save(){ try{ localStorage.setItem("mp_settings", JSON.stringify(S)); }catch(e){} }

/* ---------------- Helpers ---------------- */
const $ = id => document.getElementById(id);
const R = 6371000;
const rad = d => d*Math.PI/180;
function haversine(la1,lo1,la2,lo2){
  const dLa=rad(la2-la1), dLo=rad(lo2-lo1);
  const a=Math.sin(dLa/2)**2 + Math.cos(rad(la1))*Math.cos(rad(la2))*Math.sin(dLo/2)**2;
  return 2*R*Math.asin(Math.min(1,Math.sqrt(a)));
}
function bearing(la1,lo1,la2,lo2){
  const y=Math.sin(rad(lo2-lo1))*Math.cos(rad(la2));
  const x=Math.cos(rad(la1))*Math.sin(rad(la2))-Math.sin(rad(la1))*Math.cos(rad(la2))*Math.cos(rad(lo2-lo1));
  return (Math.atan2(y,x)*180/Math.PI+360)%360;
}
function pointInPolygon(pt, poly){ // pt=[lat,lon]; poly=[[lat,lon]...]
  let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const yi=poly[i][0],xi=poly[i][1],yj=poly[j][0],xj=poly[j][1];
    const intersect=((yi>pt[0])!==(yj>pt[0])) && (pt[1]<(xj-xi)*(pt[0]-yi)/((yj-yi)||1e-12)+xi);
    if(intersect) inside=!inside;
  }
  return inside;
}
function fmtDist(m){ return m>=1000 ? (m/1000).toFixed(m>=10000?0:1)+" km" : Math.round(m/10)*10+" m"; }
function compass(deg){ const dirs=["N","NO","O","ZO","Z","ZW","W","NW"]; return dirs[Math.round(deg/45)%8]; }

/* ---------------- Toestand ---------------- */
let pos=null;            // {lat,lon,acc,speed,heading}
let watchId=null;
let lastKey=null;        // laatst geadviseerde situatie
let needsAck=false;
let wakeLock=null;

/* ---------------- Kernberekening ---------------- */
function computeAdvice(lat,lon){
  let nearest=null, nd=Infinity;
  for(const p of POINTS){ const d=haversine(lat,lon,p.lat,p.lon); if(d<nd){nd=d;nearest=p;} }
  const warn = S.warn;
  let area=null;
  for(const a of AREAS){ if(pointInPolygon([lat,lon],a.polygon)){ area=a; break; } }

  let advice;
  const eff = nearest ? Math.max(warn, nearest.radius) : 0;
  if(nearest && nd<=eff){
    advice = { source:"point", channel:nearest.channel, post:nearest.name, sub:nearest.sub,
      reason:nearest.reason, dist:nd, level: nd<=150?"red":"warn" };
  } else if(area && area.channel!=null){
    advice = { source:"area", channel:area.channel, post:area.name, reason:area.reason, level:"ok" };
  } else if(area){
    advice = { source:"area-none", channel:null, post:area.name, reason:area.reason, level:"ok" };
  } else {
    advice = { source:"none", channel:null, post:"Buiten bekend gebied",
      reason:"Geen kanaaladvies voor deze positie. Luister uit op 16.", level:"ok" };
  }
  return { advice, nearest, nd, area };
}

/* ---------------- UI-update ---------------- */
function setState(level){
  const map={ ok:["--ok","--ok2"], warn:["--warn","--warn2"], red:["--alert","--alert2"] };
  const [a,b]=map[level]||map.ok;
  const cs=getComputedStyle(document.documentElement);
  document.documentElement.style.setProperty("--state", cs.getPropertyValue(a));
  document.documentElement.style.setProperty("--state2", cs.getPropertyValue(b));
}

function render(){
  if(!pos){ return; }
  const {advice,nearest,nd} = computeAdvice(pos.lat,pos.lon);

  // Big channel
  const chTxt = advice.channel!=null ? advice.channel : "—";
  $("bcNum").innerHTML = advice.channel!=null ? (chTxt+' <small>VHF</small>') : '<small style="font-size:.4em">luister 16</small>';
  $("bcPost").textContent = advice.post;
  $("bcReason").textContent = advice.reason;
  $("bcLabel").textContent = advice.source==="point" ? "Zet marifoon op" : "Aanbevolen marifoon";

  if(advice.source==="point"){
    $("bcDist").style.display="inline-block";
    $("bcDist").textContent = (nd<=150?"Ter plaatse · ":"Nog ") + (nd>150?fmtDist(nd):"") + " · " + advice.post.split(" ")[0];
    $("bcDist").textContent = nd<=150 ? "Ter hoogte van "+advice.post : "Nog "+fmtDist(nd)+" tot "+advice.post;
  } else { $("bcDist").style.display="none"; }

  // Next box: dichtstbijzijnde punt
  if(nearest){
    $("nextBox").style.display="flex";
    const brg = bearing(pos.lat,pos.lon,nearest.lat,nearest.lon);
    $("nextName").textContent = (nearest.type==="sluis"?"⚓ ":"🌉 ")+nearest.name;
    $("nextMeta").textContent = fmtDist(nd)+" · "+compass(brg)+" · "+(nearest.sub||"");
    $("nextCh").textContent = nearest.channel;
  } else $("nextBox").style.display="none";

  // Speed/course
  $("sog").textContent = pos.speed!=null && !isNaN(pos.speed) ? (pos.speed*1.94384).toFixed(1) : "–";
  $("cog").textContent = pos.heading!=null && !isNaN(pos.heading) ? Math.round(pos.heading) : "–";

  // Giant view
  $("autoNum").textContent = advice.channel!=null ? advice.channel : "16";
  $("autoLab").textContent = advice.channel!=null ? "Marifoon" : "Luister uit";
  $("autoPost").textContent = advice.post;
  $("autoDist").textContent = advice.source==="point" ? (nd<=150?"ter plaatse":"nog "+fmtDist(nd)) : "";

  // Alert-detectie
  const key = advice.source+":"+advice.channel+":"+advice.post;
  if(key!==lastKey){
    if(lastKey!==null && advice.channel!=null){ triggerAlert(advice, nd); }
    lastKey=key;
  }

  // Kleurstatus
  setState(needsAck ? "red" : advice.level);
  $("bigChannel").classList.toggle("needsack", needsAck);

  updateBoat();
}

/* ---------------- Waarschuwing ---------------- */
function triggerAlert(advice, nd){
  needsAck=true;
  const title = advice.source==="point"
    ? (nd<=150 ? "Nu: "+advice.post : "Nadert "+advice.post)
    : "Nieuw vaargebied: "+advice.post;
  const body = advice.channel!=null
    ? "Zet de marifoon op kanaal "+advice.channel+"."
    : "Luister uit op kanaal 16.";
  showToast("📻", title, body);
  if(S.sound) beep();
  if(S.vibe && navigator.vibrate) navigator.vibrate([180,90,180]);
  if(S.notify && "Notification" in window && Notification.permission==="granted"){
    try{ new Notification("MarifoonPilot — kanaal "+(advice.channel??16), { body:title+" • "+body, tag:"mp-alert", renotify:true }); }catch(e){}
  }
}
function ackAlert(){ needsAck=false; hideToast(); render(); }

/* ---------------- Toast ---------------- */
let toastTimer=null;
function showToast(ico,h,p){
  $("toastIco").textContent=ico; $("toastH").textContent=h; $("toastP").textContent=p;
  $("toast").classList.add("show");
}
function hideToast(){ $("toast").classList.remove("show"); }

/* ---------------- Geluid (WebAudio) ---------------- */
let ac=null;
function beep(){
  try{
    ac = ac || new (window.AudioContext||window.webkitAudioContext)();
    if(ac.state==="suspended") ac.resume();
    const now=ac.currentTime;
    [0,0.22].forEach((t,i)=>{
      const o=ac.createOscillator(), g=ac.createGain();
      o.type="sine"; o.frequency.value=i?1046:784; // G5, C6
      g.gain.setValueAtTime(0.0001, now+t);
      g.gain.exponentialRampToValueAtTime(0.5, now+t+0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now+t+0.18);
      o.connect(g); g.connect(ac.destination); o.start(now+t); o.stop(now+t+0.2);
    });
  }catch(e){}
}

/* ---------------- GPS ---------------- */
function startGPS(){
  if(!("geolocation" in navigator)){ showToast("⚠️","Geen GPS","Dit apparaat/browser ondersteunt geen locatie."); return; }
  // audio ontgrendelen op gebruikersactie
  try{ ac = ac || new (window.AudioContext||window.webkitAudioContext)(); ac.resume(); }catch(e){}
  if(S.notify && "Notification" in window && Notification.permission==="default"){ Notification.requestPermission(); }
  $("btnStart").textContent="GPS actief…";
  watchId = navigator.geolocation.watchPosition(onPos, onErr, { enableHighAccuracy:true, maximumAge:2000, timeout:15000 });
}
function onPos(p){
  if(S.sim) return; // in simulatie negeren we echte GPS
  const c=p.coords;
  pos={ lat:c.latitude, lon:c.longitude, acc:c.accuracy, speed:c.speed, heading:c.heading };
  updateGpsBadge(c.accuracy);
  render();
  if(map && !mapCentered){ map.setView([pos.lat,pos.lon], 12); mapCentered=true; }
}
function onErr(e){
  updateGpsBadge(null);
  if(e.code===1) showToast("⚠️","Locatie geweigerd","Sta locatie toe in je browserinstellingen om kanaaladvies te krijgen.");
}
function updateGpsBadge(acc){
  const dot=$("gdot"), info=$("gpsInfo");
  if(acc==null){ dot.className="gdot none"; info.textContent = S.sim?"Simulatie":"Geen fix"; return; }
  dot.className = "gdot "+(acc<25?"good":"");
  info.innerHTML = "±"+Math.round(acc)+" m";
}

/* ---------------- Kaart ---------------- */
let map=null, boat=null, mapCentered=false, seamark=null, baseLayers={}, curBase="osm";
function initMap(){
  if(typeof L==="undefined"){  // Leaflet niet geladen: kaart uitschakelen, rest blijft werken
    const mv=$("view-map"); if(mv) mv.innerHTML='<div style="padding:24px;color:var(--muted);text-align:center">'+
      'Kaart kon niet laden (geen verbinding). Het kanaaladvies werkt gewoon door.<br><br>'+
      'Verbind eenmalig met internet om de kaart te laden; daarna werkt hij ook offline.</div>';
    return;
  }
  map = L.map("map",{ zoomControl:true, attributionControl:true }).setView([52.75,5.35], 9);
  baseLayers.osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    { maxZoom:19, attribution:"© OpenStreetMap" });
  baseLayers.sat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { maxZoom:19, attribution:"© Esri" });
  baseLayers.osm.addTo(map);
  seamark = L.tileLayer("https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png", { maxZoom:18, opacity:0.9 });

  // Gebieden
  AREAS.forEach(a=>{
    L.polygon(a.polygon,{ color:a.color, weight:2, fillColor:a.color, fillOpacity:0.10 })
      .bindPopup("<b>"+a.name+"</b><br>"+(a.channel!=null?("Kanaal "+a.channel):"Geen vaste post")).addTo(map);
  });
  // Punten
  POINTS.forEach(p=>{
    const m=L.marker([p.lat,p.lon],{icon:pinIcon(p)}).addTo(map);
    m.bindPopup("<b>"+p.name+"</b><br>"+(p.sub||"")+"<br>📻 Kanaal <b>"+p.channel+"</b>");
  });

  // Boot
  boat = L.marker([52.75,5.35],{icon:boatIcon(0), zIndexOffset:1000});

  map.on("click", e=>{ if(S.sim){ simSet(e.latlng.lat, e.latlng.lng); } });
}
function pinIcon(p){
  const c = p.type==="sluis" ? "#2f9be0" : "#8b5cf6";
  return L.divIcon({ className:"", iconSize:[26,26], iconAnchor:[13,13],
    html:`<div style="width:26px;height:26px;border-radius:50%;background:${c};border:2px solid #fff;
      display:flex;align-items:center;justify-content:center;font-size:13px;box-shadow:0 1px 4px rgba(0,0,0,.5)">${p.channel}</div>` });
}
function boatIcon(deg){
  return L.divIcon({ className:"", iconSize:[34,34], iconAnchor:[17,17],
    html:`<div style="transform:rotate(${deg}deg);transition:transform .3s">
      <div style="width:0;height:0;border-left:9px solid transparent;border-right:9px solid transparent;
      border-bottom:26px solid #ff4d4d;margin:auto;filter:drop-shadow(0 0 3px rgba(0,0,0,.7))"></div></div>` });
}
function updateBoat(){
  if(!map||!pos) return;
  if(!map.hasLayer(boat)) boat.addTo(map);
  boat.setLatLng([pos.lat,pos.lon]);
  boat.setIcon(boatIcon(pos.heading||0));
}

/* ---------------- Simulatie ---------------- */
let lastSim=null;
function simSet(lat,lon){
  let heading=null, speed=0;
  if(lastSim){ heading=bearing(lastSim.lat,lastSim.lon,lat,lon); speed=null; }
  lastSim={lat,lon};
  pos={ lat, lon, acc:5, speed, heading };
  updateGpsBadge(null);
  render();
}

/* ---------------- Thema ---------------- */
function applyTheme(){
  let night=false;
  if(S.theme==="night") night=true;
  else if(S.theme==="day") night=false;
  else { // auto
    const h=new Date().getHours();
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    night = (h<7 || h>=21) || prefersDark;
  }
  document.body.classList.toggle("night", night);
}

/* ---------------- Wake Lock ---------------- */
async function applyWake(){
  try{
    if(S.wake && "wakeLock" in navigator){
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release",()=>{});
    } else if(wakeLock){ await wakeLock.release(); wakeLock=null; }
  }catch(e){}
}
document.addEventListener("visibilitychange", ()=>{ if(!document.hidden && S.wake) applyWake(); });

/* ---------------- Navigatie tussen views ---------------- */
function showView(v){
  document.querySelectorAll(".view").forEach(el=>el.classList.remove("active"));
  document.querySelectorAll("nav button").forEach(b=>b.classList.toggle("active", b.dataset.view===v));
  if(v==="auto"){ $("view-auto").classList.add("active"); }
  else { $("view-"+v).classList.add("active"); }
  if(v==="map" && map){ setTimeout(()=>{ map.invalidateSize(); if(pos){ map.setView([pos.lat,pos.lon]); } },80); }
}

/* ---------------- Modals ---------------- */
function openModal(html){ $("modalBox").innerHTML=html; $("modal").classList.add("show"); }
function closeModal(){ $("modal").classList.remove("show"); }
const ABOUT_HTML = `
  <h3>Over MarifoonPilot</h3>
  <p>MarifoonPilot gebruikt je GPS-positie om automatisch het juiste marifoonkanaal te adviseren op het
  IJsselmeer, Markermeer en de Waddenzee. Vaar je een nieuw gebied binnen of nader je een sluis of brug, dan
  krijg je een melding met het kanaal.</p>
  <p><b>Belangrijk — dit is hulpmiddel, geen vervanging.</b> Kanalen en bedieningen kunnen wijzigen.
  Controleer altijd de officiële bron: de <i>Wateralmanak deel 1 &amp; 2</i> en
  <i>vaarweginformatie.nl</i>. In noodgevallen: kanaal 16.</p>
  <p>De vaargebieden zijn indicatief ingetekend en bedoeld voor kanaaladvies, niet voor navigatie.
  Gebruik altijd een gecertificeerde kaart om te navigeren.</p>
  <p style="color:#8fb;font-size:13px">Bronnen kanalen: Nautin, Waterkaart Live, Rijkswaterstaat Vaarweginformatie.</p>
  <button class="ok" onclick="closeModal()">Begrepen</button>`;
const INSTALL_HTML = `
  <h3>Installeren als app</h3>
  <p>MarifoonPilot werkt als een gewone app op je telefoon — zónder app store.</p>
  <p><b>iPhone (Safari):</b></p>
  <ul><li>Open de website in <b>Safari</b>.</li><li>Tik op het deel-icoon <b>⬆︎</b> onderin.</li>
  <li>Kies <b>“Zet op beginscherm”</b>.</li><li>Open hem voortaan vanaf je beginscherm — schermvullend, mét GPS.</li></ul>
  <p><b>Android (Chrome):</b></p>
  <ul><li>Open de website in <b>Chrome</b>.</li><li>Tik op <b>⋮</b> rechtsboven.</li>
  <li>Kies <b>“App installeren”</b> of “Toevoegen aan startscherm”.</li></ul>
  <p style="color:var(--muted)">Tip: laat locatie “altijd/tijdens gebruik” toe voor de beste werking op het water.</p>
  <button class="ok" onclick="closeModal()">Sluiten</button>`;
const INTRO_HTML = `
  <h3>Welkom bij MarifoonPilot ⚓</h3>
  <p>Deze app adviseert automatisch welk <b>marifoonkanaal</b> je moet gebruiken op basis van je positie.</p>
  <ul><li>📻 Groot kanaal in beeld, met kleur: groen normaal, geel/rood bij een wissel.</li>
  <li>🔔 Melding + geluid zodra je een sluis, brug of nieuw gebied nadert.</li>
  <li>🗺️ Kaart met gebieden, sluizen en bruggen.</li>
  <li>🧭 Geen boot bij de hand? Zet <b>Simulatie</b> aan en tik op de kaart.</li></ul>
  <p style="color:#ffd27a"><b>Let op:</b> hulpmiddel, geen vervanging voor je marifoon of officiële vaarinformatie.
  Controleer kanalen bij de Wateralmanak / vaarweginformatie.nl. Nood: kanaal 16.</p>
  <button class="ok" onclick="closeModal(); if(!S.sim) startGPS();">Aan de slag</button>`;

/* ---------------- Referentielijsten opbouwen ---------------- */
function buildRef(){
  $("emgList").innerHTML = EMERGENCY.map(e=>rowHtml(e.name,e.sub,e.channel,e.red)).join("");
  $("vtsList").innerHTML = VTS.map(v=>rowHtml(v.name,v.sub,v.channel,false)).join("");
  $("lockList").innerHTML = POINTS.map(p=>rowHtml(p.name,(p.type==="sluis"?"Sluis":"Brug")+" · "+(p.sub||""),p.channel,false)).join("");
  $("harborList").innerHTML = HARBORS.map(h=>rowHtml(h.name,"Havenoproep",h.channel,false)).join("");
}
function rowHtml(name,sub,ch,red){
  return `<div class="row"><div class="name"><div class="a">${name}</div><div class="b">${sub||""}</div></div>
    <div class="chan ${red?"red":""}">${ch}</div></div>`;
}

/* ---------------- Instellingen koppelen ---------------- */
function bindSettings(){
  const wr=$("warnRange"); wr.value=S.warn; $("warnVal").textContent=S.warn+" m";
  wr.addEventListener("input",()=>{ S.warn=+wr.value; $("warnVal").textContent=S.warn+" m"; });
  wr.addEventListener("change",()=>{ save(); if(pos) render(); });

  bindToggle("setSound","sound"); bindToggle("setVibe","vibe");
  bindToggle("setNotify","notify",(on)=>{ if(on && "Notification" in window && Notification.permission==="default") Notification.requestPermission(); });
  bindToggle("setWake","wake",()=>applyWake());
  bindToggle("setSim","sim",(on)=>{ document.body.classList.toggle("sim",on); updateGpsBadge(on?null:(pos?pos.acc:null));
    if(on){ showView("map"); showToast("🧭","Simulatie aan","Tik op de kaart om je positie te kiezen."); }
    else { lastSim=null; } });

  $("setSim").checked=S.sim; document.body.classList.toggle("sim",S.sim);
  ["setSound","setVibe","setNotify","setWake"].forEach(id=>{ $(id).checked = S[id.replace("set","").toLowerCase()]; });

  const th=$("setTheme"); th.value=S.theme;
  th.addEventListener("change",()=>{ S.theme=th.value; save(); applyTheme(); });
}
function bindToggle(id,key,cb){
  const el=$(id); el.checked=S[key];
  el.addEventListener("change",()=>{ S[key]=el.checked; save(); if(cb) cb(el.checked); });
}

/* ---------------- Init ---------------- */
window.addEventListener("DOMContentLoaded", ()=>{
  try{ initMap(); }catch(e){ console.warn("Kaart init mislukt:", e); }
  buildRef();
  bindSettings();
  applyTheme();

  document.querySelectorAll("nav button").forEach(b=> b.addEventListener("click",()=>showView(b.dataset.view)) );
  $("btnStart").addEventListener("click", startGPS);
  $("btnSim").addEventListener("click", ()=>{ $("setSim").checked=true; S.sim=true; save(); document.body.classList.toggle("sim",true); showView("map"); showToast("🧭","Simulatie aan","Tik op de kaart om je positie te kiezen."); });
  $("btnAck").addEventListener("click", ackAlert);
  $("toastOk").addEventListener("click", ackAlert);
  $("autoExit").addEventListener("click", ()=>showView("varen"));
  $("btnLocate").addEventListener("click", ()=>{ if(pos){ map.setView([pos.lat,pos.lon],13);} else startGPS(); });
  $("btnSimMap").addEventListener("click", ()=>{ $("setSim").click ? ($("setSim").checked=!$("setSim").checked, $("setSim").dispatchEvent(new Event("change"))) : null; });
  $("btnAbout").addEventListener("click", ()=>openModal(ABOUT_HTML));
  $("btnInstall").addEventListener("click", ()=>openModal(INSTALL_HTML));
  $("disclaimerHint").addEventListener("click", ()=>openModal(ABOUT_HTML));
  $("btnTestAlert").addEventListener("click", ()=>{ needsAck=true; triggerAlert({source:"point",channel:20,post:"Houtribsluizen",reason:"Testmelding"}, 480); render(); });
  $("modal").addEventListener("click", e=>{ if(e.target===$("modal")) closeModal(); });

  const layerSel=$("layerSel");
  if(layerSel) layerSel.addEventListener("change", e=>{
    if(!map) return;
    const v=e.target.value;
    Object.values(baseLayers).forEach(l=>{ if(map.hasLayer(l)) map.removeLayer(l); });
    if(map.hasLayer(seamark)) map.removeLayer(seamark);
    if(v==="sat"){ baseLayers.sat.addTo(map); curBase="sat"; }
    else { baseLayers.osm.addTo(map); curBase="osm"; if(v==="seamap") seamark.addTo(map); }
  });

  // Service worker
  if("serviceWorker" in navigator){ navigator.serviceWorker.register("sw.js").catch(()=>{}); }

  // Intro bij eerste keer
  if(!S.seenIntro){ openModal(INTRO_HTML); S.seenIntro=true; save(); }
});
