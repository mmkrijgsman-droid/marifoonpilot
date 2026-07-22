/* MarifoonPilot v2 – applicatielogica */
"use strict";

/* ---------------- Instellingen ---------------- */
const DEFAULTS = {
  distMode:null, distFactor:null,        // null = automatisch (per apparaat)
  theme:"auto", wake:false,
  warn:700, lookahead:true, sound:true, vibe:true, notify:true,
  draft:1.2, margin:0.4,
  anchorRadius:40, sim:false, seenIntro:false
};
let S = load();
function load(){ try{ return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem("mp2")||"{}")); }catch(e){ return {...DEFAULTS}; } }
function save(){ try{ localStorage.setItem("mp2", JSON.stringify(S)); }catch(e){} }

/* ---------------- Helpers ---------------- */
const $ = id => document.getElementById(id);
const R = 6371000, rad = d=>d*Math.PI/180, deg = r=>r*180/Math.PI;
function haversine(la1,lo1,la2,lo2){
  const dLa=rad(la2-la1),dLo=rad(lo2-lo1);
  const a=Math.sin(dLa/2)**2+Math.cos(rad(la1))*Math.cos(rad(la2))*Math.sin(dLo/2)**2;
  return 2*R*Math.asin(Math.min(1,Math.sqrt(a)));
}
function bearing(la1,lo1,la2,lo2){
  const y=Math.sin(rad(lo2-lo1))*Math.cos(rad(la2));
  const x=Math.cos(rad(la1))*Math.sin(rad(la2))-Math.sin(rad(la1))*Math.cos(rad(la2))*Math.cos(rad(lo2-lo1));
  return (deg(Math.atan2(y,x))+360)%360;
}
function angleDiff(a,b){ return Math.abs(((a-b+540)%360)-180); }
function pointInPolygon(pt,poly){
  let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const yi=poly[i][0],xi=poly[i][1],yj=poly[j][0],xj=poly[j][1];
    if(((yi>pt[0])!==(yj>pt[0])) && (pt[1]<(xj-xi)*(pt[0]-yi)/((yj-yi)||1e-12)+xi)) inside=!inside;
  }
  return inside;
}
function fmtDist(m){ return m>=1000 ? (m/1000).toFixed(m>=10000?0:1).replace(".",",")+" km" : Math.round(m/10)*10+" m"; }
function fmtNum(n,d){ return n.toFixed(d).replace(".",","); }
function compass(deg){ return ["N","NO","O","ZO","Z","ZW","W","NW"][Math.round(deg/45)%8]; }

/* ---------------- Toestand ---------------- */
let pos=null, prevPos=null, watchId=null, wakeLock=null;
let lastKey=null, needsAck=false;
let depth={ loaded:false, points:[], meta:null, status:"none" };
let anchor={ set:false, pos:null, active:false, breached:false, outsideSince:null, marker:null, circle:null };
const ANCHOR_HYST=0.85, ANCHOR_DWELL=8000;

/* ---------------- Koers afleiden ---------------- */
function deriveCourse(){
  if(pos && pos.heading!=null && !isNaN(pos.heading) && (pos.speed==null || pos.speed>0.5))
    return { course:pos.heading, source:"gps" };
  if(pos && prevPos){
    const d=haversine(prevPos.lat,prevPos.lon,pos.lat,pos.lon);
    if(d > Math.max(4, pos.acc||10)) return { course:bearing(prevPos.lat,prevPos.lon,pos.lat,pos.lon), source:"afgeleid" };
  }
  return { course:null, source:"stil" };
}
function warnDistance(){
  const kn=(pos && pos.speed>0 ? pos.speed*1.94384 : 0);
  return Math.min(2500, S.warn + 90*kn);
}

/* ---------------- Diepte ---------------- */
function nearestDepth(){
  if(!depth.points.length || !pos) return null;
  let best=null, bd=Infinity;
  for(const p of depth.points){ const d=haversine(pos.lat,pos.lon,p.lat,p.lon); if(d<bd){bd=d;best=p;} }
  return bd<=150 ? {depth:best.depth, dist:bd} : null;
}

/* ---------------- Kernadvies ---------------- */
function computeAdvice(){
  const {course,source}=deriveCourse();
  const range=warnDistance();
  let nearest=null, nd=Infinity;
  for(const p of POINTS){ const d=haversine(pos.lat,pos.lon,p.lat,p.lon); if(d<nd){nd=d;nearest=p;} }

  let area=null;
  for(const a of AREAS){ if(pointInPolygon([pos.lat,pos.lon],a.polygon)){ area=a; break; } }

  // Is het dichtstbijzijnde object relevant? (afstand + koersfilter)
  let relevant=false, off=null;
  if(nearest){
    const brg=bearing(pos.lat,pos.lon,nearest.lat,nearest.lon);
    off=course!=null?angleDiff(course,brg):null;
    const inRange = nd <= Math.max(range, nearest.radius);
    const onCourse = !S.lookahead || course==null || off < 70;
    relevant = inRange && onCourse;
  }

  let advice;
  if(relevant){
    advice={ source:"point", channel:nearest.channel, post:nearest.name, sub:nearest.sub,
      reason:nearest.reason, dist:nd, level: nd<=150?"red":"warn", point:nearest };
  } else if(area){
    advice={ source:"area", channel:area.channel, post:area.name, station:area.station, reason:area.reason, level:"ok", area:area };
  } else {
    advice={ source:"none", channel:null, post:"Buiten bekend gebied",
      reason:"Geen kanaaladvies voor deze positie. Luister uit op kanaal 16.", level:"ok" };
  }
  return { advice, nearest, nd, area, course, source, off, range };
}

/* ---------------- Weergave ---------------- */
function setState(level){
  const map={ ok:["--ok","--ok2"], warn:["--warn","--warn2"], red:["--alert","--alert2"] };
  const [a,b]=map[level]||map.ok;
  const cs=getComputedStyle(document.documentElement);
  document.documentElement.style.setProperty("--state", cs.getPropertyValue(a).trim());
  document.documentElement.style.setProperty("--state2", cs.getPropertyValue(b).trim());
}
function render(){
  if(!pos) return;
  const info=computeAdvice(), a=info.advice;

  $("bcNum").innerHTML = a.channel!=null ? (a.channel+' <small>VHF</small>') : '<small style="font-size:.34em">luister 16</small>';
  $("bcPost").textContent = a.post;
  $("bcReason").textContent = a.reason;
  $("bcLabel").textContent = a.source==="point" ? "Zet marifoon op" : "Aanbevolen marifoon";
  if(a.source==="point"){ $("bcDist").style.display="inline-block";
    $("bcDist").textContent = info.nd<=150 ? "Ter hoogte van "+a.post : "Nog "+fmtDist(info.nd)+" tot "+a.post;
  } else $("bcDist").style.display="none";

  // Metrics
  $("sog").textContent = pos.speed!=null && !isNaN(pos.speed) && pos.speed>=0 ? fmtNum(pos.speed*1.94384,1) : "–";
  $("cog").textContent = info.course!=null ? Math.round(info.course) : "–";
  $("areaName").textContent = info.area ? info.area.name : "Buiten gebied";
  const dp=nearestDepth(), clr = dp ? dp.depth - S.draft : null;
  const dt=$("depthTile");
  if(dp){ $("clearance").textContent=fmtNum(clr,2); dt.classList.toggle("danger", clr<S.margin); dt.classList.toggle("warn", clr>=S.margin && clr<S.margin+0.3); }
  else { $("clearance").textContent="–"; dt.classList.remove("danger","warn"); }

  // Volgend object
  if(info.nearest){
    $("nextBox").style.display="flex";
    const brg=bearing(pos.lat,pos.lon,info.nearest.lat,info.nearest.lon);
    $("nextName").textContent=(info.nearest.type==="sluis"?"⚓ ":"🌉 ")+info.nearest.name;
    $("nextMeta").textContent=fmtDist(info.nd)+" · "+compass(brg)+" ("+Math.round(brg)+"°) · k"+info.nearest.channel;
    $("nextCh").textContent=info.nearest.channel;
  } else $("nextBox").style.display="none";

  // Co-schipper
  let co, cosub;
  if(a.source==="point"){ co = (info.nd<=150?"Nu ":"Nadert ")+a.post+" — kanaal "+a.channel+"."; cosub = "Zet je marifoon tijdig om."; }
  else if(dp && clr<S.margin){ co="Let op: geschatte kielspeling "+fmtNum(clr,2)+" m."; cosub="Onder je ingestelde marge."; }
  else { co = info.area ? ("Je vaart in "+info.area.name+".") : "Buiten bekend vaargebied.";
    cosub = info.source==="stil" ? "Vooruitkijken wacht op koers/snelheid." : "Koers "+Math.round(info.course)+"° · vooruitkijken actief ("+info.source+")."; }
  $("coText").textContent=co; $("coSub").textContent=cosub;

  // Alert bij situatiewissel
  const key=a.source+":"+a.channel+":"+a.post;
  if(key!==lastKey){ if(lastKey!==null && a.channel!=null) triggerChannelAlert(a, info.nd); lastKey=key; }

  // Kielspeling-alarm
  if(dp && clr<S.margin && lastKey!=="__depth"){ /* handled via co-schipper visueel */ }

  setState(needsAck ? "red" : a.level);
  $("bigChannel").classList.toggle("needsack", needsAck);
  updateBoat(info);
}

/* ---------------- Waarschuwingen ---------------- */
function triggerChannelAlert(a, nd){
  needsAck=true;
  const title = a.source==="point" ? (nd<=150?"Nu: "+a.post:"Nadert "+a.post) : "Nieuw vaargebied: "+a.post;
  const body = a.channel!=null ? "Zet de marifoon op kanaal "+a.channel+"." : "Luister uit op kanaal 16.";
  showToast("📻", title, body, {sticky:true});
  fireAlert();
  notifySystem("MarifoonPilot — kanaal "+(a.channel??16), title+" • "+body);
}
function ackAlert(){ needsAck=false; hideToast(); if(pos) render(); }
function fireAlert(){ if(S.sound) beep(); if(S.vibe && navigator.vibrate) navigator.vibrate([180,90,180]); }
function notifySystem(title,body){
  if(S.notify && "Notification" in window && Notification.permission==="granted"){
    try{ new Notification(title,{body,tag:"mp",renotify:true}); }catch(e){}
  }
}

/* ---------------- Toast ---------------- */
let toastTimer=null, toastSticky=false;
function showToast(ico,h,p,opt={}){
  clearTimeout(toastTimer);
  $("toastIco").textContent=ico; $("toastH").textContent=h; $("toastP").textContent=p;
  const t=$("toast"); t.classList.toggle("warn", !!opt.warn);
  t.classList.add("show"); toastSticky=!!opt.sticky;
  if(!opt.sticky) toastTimer=setTimeout(hideToast, 6000);
}
function hideToast(){ $("toast").classList.remove("show"); }

/* ---------------- Geluid ---------------- */
let ac=null;
function unlockAudio(){ try{ ac=ac||new (window.AudioContext||window.webkitAudioContext)(); if(ac.state==="suspended") ac.resume(); }catch(e){} }
function beep(freqs=[784,1046]){
  try{ unlockAudio(); const now=ac.currentTime;
    freqs.forEach((f,i)=>{ const o=ac.createOscillator(),g=ac.createGain(); o.type="sine"; o.frequency.value=f;
      const t=now+i*0.22; g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.5,t+0.02);
      g.gain.exponentialRampToValueAtTime(0.0001,t+0.18); o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t+0.2); });
  }catch(e){}
}

/* ---------------- GPS ---------------- */
function startGPS(){
  if(!("geolocation" in navigator)){ showToast("⚠️","Geen GPS","Dit apparaat/browser ondersteunt geen locatie."); return; }
  unlockAudio();
  if(S.notify && "Notification" in window && Notification.permission==="default") Notification.requestPermission();
  $("btnStart").textContent="GPS actief…";
  if(watchId!=null) navigator.geolocation.clearWatch(watchId);
  watchId=navigator.geolocation.watchPosition(onPos,onErr,{enableHighAccuracy:true,maximumAge:1500,timeout:15000});
}
function onPos(p){
  if(S.sim) return;
  const c=p.coords;
  prevPos=pos;
  pos={ lat:c.latitude, lon:c.longitude, acc:c.accuracy, speed:c.speed, heading:c.heading, t:p.timestamp };
  updateGpsBadge(c.accuracy);
  render(); onAnchorFix();
  if(map && !mapCentered){ map.setView([pos.lat,pos.lon],12); mapCentered=true; }
}
function onErr(e){ updateGpsBadge(null); if(e.code===1) showToast("⚠️","Locatie geweigerd","Sta locatie toe in je browserinstellingen.",{}); }
function updateGpsBadge(acc){
  const dot=$("gdot"), info=$("gpsInfo");
  if(acc==null){ dot.className="gdot none"; info.textContent=S.sim?"Simulatie":"Geen fix"; return; }
  dot.className="gdot "+(acc<25?"good":""); info.textContent="±"+Math.round(acc)+" m";
}

/* ---------------- Ankeralarm ---------------- */
function onAnchorFix(){
  if(!anchor.active || !anchor.pos || !pos) return;
  const d=haversine(pos.lat,pos.lon,anchor.pos.lat,anchor.pos.lon);
  const trigger=Number(S.anchorRadius)+Math.min(pos.acc||0, S.anchorRadius);
  const release=S.anchorRadius*ANCHOR_HYST;
  if(!anchor.breached){
    if(d>trigger){ anchor.outsideSince=anchor.outsideSince||pos.t;
      if(pos.t-anchor.outsideSince>=ANCHOR_DWELL){ anchor.breached=true; anchorAlarm(d); } }
    else anchor.outsideSince=null;
  } else {
    if(d<release){ anchor.breached=false; anchor.outsideSince=null; }
    else anchorAlarm(d);
  }
  updateAnchorUI(d);
}
function anchorAlarm(d){
  showToast("⚓","Ankeralarm","Je bent "+Math.round(d)+" m van de ankerpositie (straal "+S.anchorRadius+" m).",{warn:true});
  fireAlert(); notifySystem("Ankeralarm","Drift "+Math.round(d)+" m van ankerpositie.");
}
function updateAnchorUI(d){
  const el=$("anchorStat");
  if(!anchor.active){ el.textContent="Uit"; el.className="anchorstat ok"; return; }
  el.textContent="Actief · "+Math.round(d)+" / "+S.anchorRadius+" m";
  el.className="anchorstat "+(anchor.breached?"danger":(d>S.anchorRadius*ANCHOR_HYST?"warn":"ok"));
}
function toggleAnchor(){
  if(anchor.active){ anchor.active=false; anchor.set=false; anchor.breached=false;
    if(anchor.marker) map.removeLayer(anchor.marker); if(anchor.circle) map.removeLayer(anchor.circle);
    anchor.marker=anchor.circle=null; $("btnAnchor").textContent="Anker laten vallen"; updateAnchorUI(0); return; }
  if(!pos){ showToast("⚓","Start eerst GPS","Er is nog geen positie bekend.",{}); return; }
  anchor.pos={lat:pos.lat,lon:pos.lon}; anchor.active=true; anchor.set=true; anchor.breached=false; anchor.outsideSince=null;
  $("btnAnchor").textContent="Anker lichten";
  if(map){ anchor.circle=L.circle([anchor.pos.lat,anchor.pos.lon],{radius:S.anchorRadius,color:"#ffce6b",fillOpacity:.08}).addTo(map);
    anchor.marker=L.marker([anchor.pos.lat,anchor.pos.lon]).addTo(map); }
  updateAnchorUI(0);
}

/* ---------------- Kaart ---------------- */
let map=null, boat=null, mapCentered=false, seamark=null, baseLayers={}, curBase="osm", coneLayer=null;
function initMap(){
  if(typeof L==="undefined"){ const mv=$("view-map"); if(mv) mv.innerHTML='<div style="padding:24px;color:var(--muted);text-align:center">Kaart kon niet laden (geen verbinding). Het kanaaladvies werkt gewoon door.</div>'; return; }
  map=L.map("map",{zoomControl:true}).setView([52.75,5.35],9);
  baseLayers.osm=L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"© OpenStreetMap"});
  baseLayers.sat=L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",{maxZoom:19,attribution:"© Esri"});
  baseLayers.osm.addTo(map);
  seamark=L.tileLayer("https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png",{maxZoom:18,opacity:.9});
  AREAS.forEach(a=>L.polygon(a.polygon,{color:a.color,weight:2,fillColor:a.color,fillOpacity:.10})
    .bindPopup("<b>"+a.name+"</b><br>"+(a.channel!=null?("Kanaal "+a.channel):"Geen vaste post")).addTo(map));
  POINTS.forEach(p=>L.marker([p.lat,p.lon],{icon:pinIcon(p)}).bindPopup("<b>"+p.name+"</b><br>"+(p.sub||"")+"<br>📻 Kanaal <b>"+p.channel+"</b>").addTo(map));
  KNRM.forEach(k=>L.marker([k.lat,k.lon],{icon:knrmIcon()}).bindPopup("<b>"+k.name+"</b><br>🚨 Alarm via Kustwacht / kanaal 16").addTo(map));
  coneLayer=L.layerGroup().addTo(map);
  boat=L.marker([52.75,5.35],{icon:boatIcon(0),zIndexOffset:1000});
  map.on("click",e=>{ if(S.sim) simSet(e.latlng.lat,e.latlng.lng); });
}
function pinIcon(p){ const c=p.type==="sluis"?"#00d0ff":"#a78bfa";
  return L.divIcon({className:"",iconSize:[26,26],iconAnchor:[13,13],
    html:`<div style="width:26px;height:26px;border-radius:50%;background:${c};border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#012;box-shadow:0 1px 4px rgba(0,0,0,.6)">${p.channel}</div>`}); }
function knrmIcon(){ return L.divIcon({className:"",iconSize:[20,20],iconAnchor:[10,10],
  html:`<div style="width:20px;height:20px;border-radius:4px;background:#e23b3b;border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:11px">🚨</div>`}); }
function boatIcon(deg){ return L.divIcon({className:"",iconSize:[34,34],iconAnchor:[17,17],
  html:`<div style="transform:rotate(${deg}deg);transition:transform .3s"><div style="width:0;height:0;border-left:9px solid transparent;border-right:9px solid transparent;border-bottom:26px solid #ff4d4d;margin:auto;filter:drop-shadow(0 0 3px rgba(0,0,0,.8))"></div></div>`}); }
function updateBoat(info){
  if(!map||!pos) return;
  if(!map.hasLayer(boat)) boat.addTo(map);
  boat.setLatLng([pos.lat,pos.lon]); boat.setIcon(boatIcon(info&&info.course!=null?info.course:0));
  if(coneLayer){ coneLayer.clearLayers();
    if(info && info.course!=null && S.lookahead){
      const rng=Math.min(info.range,3000)/111320; // ~graden
      const pts=[[pos.lat,pos.lon]];
      for(let da=-70;da<=70;da+=14){ const b=rad(info.course+da);
        pts.push([pos.lat+Math.cos(b)*rng, pos.lon+Math.sin(b)*rng/Math.cos(rad(pos.lat))]); }
      L.polygon(pts,{color:"#00d0ff",weight:1,fillColor:"#00d0ff",fillOpacity:.08,interactive:false}).addTo(coneLayer);
    }
  }
}

/* ---------------- Simulatie ---------------- */
let lastSim=null;
function simSet(lat,lon){
  let heading=null;
  if(lastSim){ heading=bearing(lastSim.lat,lastSim.lon,lat,lon); }
  prevPos=lastSim?{lat:lastSim.lat,lon:lastSim.lon,acc:5}:null;
  lastSim={lat,lon};
  pos={ lat, lon, acc:5, speed:null, heading, t:(pos?pos.t+3000:0) };
  updateGpsBadge(null); render(); onAnchorFix();
}

/* ---------------- Thema ---------------- */
function applyTheme(){
  let night=false;
  if(S.theme==="night") night=true; else if(S.theme==="day") night=false;
  else { const h=new Date().getHours(); night=(h<7||h>=21); }
  document.documentElement.toggleAttribute("data-night", night);
  document.body.classList.toggle("night", night);
}

/* ---------------- Leesafstand ---------------- */
const DIST_PRESET={ phone:1.0, tablet:2.0, cockpit:2.7 };
function applyDist(){
  if(S.distFactor!=null){ document.documentElement.style.setProperty("--dist", S.distFactor); }
  const eff = S.distFactor!=null ? S.distFactor : parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--dist"))||1;
  $("distVal").textContent = fmtNum(eff,1)+"×"; $("distRange").value = Math.min(3.2,Math.max(0.8,eff));
  document.querySelectorAll("#distSeg button").forEach(b=>b.classList.toggle("on", S.distMode===b.dataset.mode));
}

/* ---------------- Wake Lock & Fullscreen ---------------- */
async function applyWake(){ try{
  if(S.wake && "wakeLock" in navigator){ wakeLock=await navigator.wakeLock.request("screen"); }
  else if(wakeLock){ await wakeLock.release(); wakeLock=null; }
}catch(e){} }
document.addEventListener("visibilitychange",()=>{ if(!document.hidden && S.wake) applyWake(); });
async function toggleFullscreen(){
  const el=document.documentElement;
  try{
    if(!document.fullscreenElement && !document.webkitFullscreenElement){
      if(el.requestFullscreen) await el.requestFullscreen({navigationUI:"hide"});
      else if(el.webkitRequestFullscreen) el.webkitRequestFullscreen();
      else { showToast("⛶","Volledig scherm","Op iPhone: deel-icoon → 'Zet op beginscherm' voor schermvullend gebruik.",{}); return; }
    } else { if(document.exitFullscreen) document.exitFullscreen(); else if(document.webkitExitFullscreen) document.webkitExitFullscreen(); }
  }catch(e){ showToast("⛶","Volledig scherm","Niet ondersteund in deze browser. Installeer de app op je beginscherm.",{}); }
}
function fsState(){ const on=!!(document.fullscreenElement||document.webkitFullscreenElement); $("btnFs").classList.toggle("on",on); $("btnFs").textContent=on?"✕":"⛶"; }
document.addEventListener("fullscreenchange",fsState);
document.addEventListener("webkitfullscreenchange",fsState);

/* ---------------- Diepte laden ---------------- */
async function loadDepthFile(file){
  try{
    const gj=JSON.parse(await file.text());
    if(gj.type!=="FeatureCollection"||!Array.isArray(gj.features)) throw new Error("Geen geldige GeoJSON FeatureCollection");
    const pts=gj.features.filter(f=>f.geometry?.type==="Point" && typeof f.properties?.depth==="number")
      .map(f=>({lon:f.geometry.coordinates[0],lat:f.geometry.coordinates[1],depth:f.properties.depth}));
    if(!pts.length) throw new Error("Geen dieptepunten gevonden");
    depth.points=pts; depth.meta=gj.properties||{}; depth.loaded=true; depth.status="loaded";
    $("depthStatus").textContent="Geladen: "+pts.length+" dieptepunten"+(depth.meta.source?(" · "+depth.meta.source):"")+(depth.meta.datum?(" · reductievlak "+depth.meta.datum):"");
    if(pos) render();
  }catch(e){ $("depthStatus").textContent="Kon bestand niet laden: "+e.message; }
}

/* ---------------- Navigatie ---------------- */
function showView(v){
  document.querySelectorAll(".view").forEach(el=>el.classList.remove("active"));
  document.querySelectorAll("nav button").forEach(b=>b.classList.toggle("active",b.dataset.view===v));
  $("view-"+v).classList.add("active");
  if(v==="map" && map) setTimeout(()=>{ map.invalidateSize(); if(pos) map.setView([pos.lat,pos.lon]); },80);
}

/* ---------------- Modals ---------------- */
function openModal(html){ $("modalBox").innerHTML=html; $("modal").classList.add("show"); }
function closeModal(){ $("modal").classList.remove("show"); }
function openMayday(){
  const p = pos ? (fmtNum(pos.lat,5)+", "+fmtNum(pos.lon,5)) : "nog niet bekend — start GPS";
  $("maydayBox").innerHTML=`<h3>🆘 Mayday-hulpkaart</h3>
    <p>Alleen bij <b>direct levensgevaar of zinken</b>. Zet de marifoon op <b>kanaal 16</b>.</p>
    <ol class="maystep">
      <li>Zeg drie keer: <b>MAYDAY, MAYDAY, MAYDAY</b>.</li>
      <li>“Hier is [scheepsnaam], [scheepsnaam], [scheepsnaam]”, roepnaam/MMSI.</li>
      <li>Nogmaals <b>MAYDAY</b> + scheepsnaam.</li>
      <li><b>Positie:</b> ${p}</li>
      <li>Aard van de nood (zinken, brand, man overboord…).</li>
      <li>Aantal opvarenden en welke hulp je nodig hebt.</li>
      <li>“Over.” — laat los en luister.</li>
    </ol>
    <p>Geen levensgevaar maar wél dringend hulp? Gebruik <b>PAN-PAN</b> (3×) op kanaal 16.</p>
    <button class="ok" onclick="document.getElementById('mayday').classList.remove('show')">Sluiten</button>`;
  $("mayday").classList.add("show");
}
const ABOUT_HTML=`<h3>Over MarifoonPilot</h3>
  <p>MarifoonPilot gebruikt je GPS-positie én vaarrichting om automatisch het juiste marifoonkanaal te adviseren op het IJsselmeer, Markermeer en de Waddenzee. Werkt op telefoon, tablet en laptop — installeer als app en gebruik schermvullend.</p>
  <p><b>Belangrijk — hulpmiddel, geen vervanging.</b> Kanalen en bedieningen kunnen wijzigen. Controleer altijd de <i>Wateralmanak deel 1 &amp; 2</i> en <i>vaarweginformatie.nl</i>. In nood: kanaal 16.</p>
  <p><b>Installeren:</b> iPhone (Safari): deel-icoon ⬆︎ → “Zet op beginscherm”. Android (Chrome): menu ⋮ → “App installeren”.</p>
  <p style="color:#8fdcff;font-size:13px">Kanalen geverifieerd via Rijkswaterstaat Vaarweginformatie, waterkaart.net, varendoejesamen.nl en Nautin (56/57 door ≥2 bronnen bevestigd).</p>
  <button class="ok" onclick="closeModal()">Begrepen</button>`;
const INTRO_HTML=`<h3>Welkom bij MarifoonPilot ⚓</h3>
  <p>Automatisch marifoonkanaal-advies op basis van je positie én koers.</p>
  <ul><li>📻 Groot kanaal in beeld, kleur: groen normaal, geel/rood bij een wissel.</li>
  <li>🧭 Waarschuwt pas als je een sluis/brug écht nadert op je koers.</li>
  <li>⚓ Ankeralarm, kielspeling (met eigen dieptedata) en mayday-kaart.</li>
  <li>📱 Telefoon dichtbij, tablet/laptop als cockpit op 2–3 m — stel in bij Instellingen.</li>
  <li>🧭 Geen boot? Zet <b>Simulatie</b> aan en tik op de kaart.</li></ul>
  <p style="color:#ffce6b"><b>Let op:</b> hulpmiddel, geen vervanging voor je marifoon of officiële vaarinformatie. Nood: kanaal 16.</p>
  <button class="ok" onclick="closeModal(); if(!S.sim) startGPS();">Aan de slag</button>`;

/* ---------------- Lijsten ---------------- */
function tag(conf){ return conf==="high"?'<span class="tag">✓ geverifieerd</span>':(conf==="medium"?'<span class="tag">⚠ 1 bron</span>':''); }
function rowHtml(name,sub,ch,red,extra){ return `<div class="row"><div class="name"><div class="a">${name}${extra||""}</div><div class="b">${sub||""}</div></div><div class="chan ${red?"red":""}">${ch}</div></div>`; }
function buildLists(){
  $("emgList").innerHTML=EMERGENCY.map(e=>rowHtml(e.name,e.sub,e.channel,e.red)).join("");
  $("vtsList").innerHTML=VTS.map(v=>rowHtml(v.name,v.sub,v.channel,false)).join("");
  $("lockList").innerHTML=POINTS.map(p=>rowHtml(p.name,(p.type==="sluis"?"Sluis":"Brug")+" · "+(p.sub||""),p.channel,false,tag(p.conf))).join("");
  $("harborList").innerHTML=HARBORS.map(h=>rowHtml(h.name,"Havenoproep",h.channel,false)).join("");
  $("knrmList").innerHTML=KNRM.map(k=>rowHtml(k.name,"Reddingstation",16,true)).join("");
}

/* ---------------- Instellingen koppelen ---------------- */
function bindRange(id,valId,key,fmt){ const el=$(id); el.value=S[key]; $(valId).textContent=fmt(S[key]);
  el.addEventListener("input",()=>{ S[key]=+el.value; $(valId).textContent=fmt(S[key]); if(key==="anchorRadius"&&anchor.circle) anchor.circle.setRadius(S[key]); });
  el.addEventListener("change",()=>{ save(); if(pos) render(); }); }
function bindToggle(id,key,cb){ const el=$(id); el.checked=S[key];
  el.addEventListener("change",()=>{ S[key]=el.checked; save(); if(cb) cb(el.checked); if(pos) render(); }); }

function initSettings(){
  // Leesafstand
  document.querySelectorAll("#distSeg button").forEach(b=>b.addEventListener("click",()=>{ S.distMode=b.dataset.mode; S.distFactor=DIST_PRESET[b.dataset.mode]; save(); applyDist(); }));
  $("distRange").addEventListener("input",e=>{ S.distFactor=+e.target.value; S.distMode=null; document.documentElement.style.setProperty("--dist",S.distFactor); $("distVal").textContent=fmtNum(S.distFactor,1)+"×"; document.querySelectorAll("#distSeg button").forEach(b=>b.classList.remove("on")); });
  $("distRange").addEventListener("change",save);

  $("setTheme").value=S.theme; $("setTheme").addEventListener("change",e=>{ S.theme=e.target.value; save(); applyTheme(); });
  bindToggle("setWake","wake",()=>applyWake());
  bindRange("warnRange","warnVal","warn",v=>v+" m");
  bindToggle("setLookahead","lookahead");
  bindToggle("setSound","sound"); bindToggle("setVibe","vibe");
  bindToggle("setNotify","notify",on=>{ if(on&&"Notification" in window&&Notification.permission==="default") Notification.requestPermission(); });
  bindRange("draftRange","draftVal","draft",v=>fmtNum(v,2)+" m");
  bindRange("marginRange","marginVal","margin",v=>fmtNum(v,2)+" m");
  bindRange("anchorRad","anchorRadVal","anchorRadius",v=>v+" m");
  bindToggle("setSim","sim",on=>{ document.body.classList.toggle("sim",on); updateGpsBadge(on?null:(pos?pos.acc:null));
    if(on){ showView("map"); showToast("🧭","Simulatie aan","Tik op de kaart om je positie te kiezen.",{}); } else lastSim=null; });
  $("setSim").checked=S.sim; document.body.classList.toggle("sim",S.sim);
  $("depthFile").addEventListener("change",e=>{ if(e.target.files[0]) loadDepthFile(e.target.files[0]); });
}

/* ---------------- Init ---------------- */
window.addEventListener("DOMContentLoaded",()=>{
  try{ initMap(); }catch(e){ console.warn("kaart init:",e); }
  buildLists(); initSettings(); applyTheme(); applyDist();

  document.querySelectorAll("nav button").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.view)));
  $("btnStart").addEventListener("click",startGPS);
  $("btnSim").addEventListener("click",()=>{ $("setSim").checked=true; S.sim=true; save(); document.body.classList.toggle("sim",true); showView("map"); showToast("🧭","Simulatie aan","Tik op de kaart om je positie te kiezen.",{}); });
  $("btnAck").addEventListener("click",ackAlert);
  $("toastOk").addEventListener("click",()=>{ if(needsAck) ackAlert(); else hideToast(); });
  $("btnFs").addEventListener("click",toggleFullscreen);
  $("btnLocate").addEventListener("click",()=>{ if(pos&&map) map.setView([pos.lat,pos.lon],13); else startGPS(); });
  $("btnMayday").addEventListener("click",openMayday);
  $("btnAnchor").addEventListener("click",toggleAnchor);
  $("btnAbout").addEventListener("click",()=>openModal(ABOUT_HTML));
  $("disclaimerHint").addEventListener("click",()=>openModal(ABOUT_HTML));
  $("btnTestAlert").addEventListener("click",()=>{ needsAck=false; triggerChannelAlert({source:"point",channel:20,post:"Houtribsluizen",reason:"Test"},480); if(pos)render(); });
  $("modal").addEventListener("click",e=>{ if(e.target===$("modal")) closeModal(); });
  $("mayday").addEventListener("click",e=>{ if(e.target===$("mayday")) $("mayday").classList.remove("show"); });

  const layerSel=$("layerSel");
  if(layerSel) layerSel.addEventListener("change",e=>{ if(!map) return; const v=e.target.value;
    Object.values(baseLayers).forEach(l=>{ if(map.hasLayer(l)) map.removeLayer(l); });
    if(map.hasLayer(seamark)) map.removeLayer(seamark);
    if(v==="sat"){ baseLayers.sat.addTo(map); curBase="sat"; } else { baseLayers.osm.addTo(map); curBase="osm"; if(v==="seamap") seamark.addTo(map); } });

  if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(()=>{});
  if(!S.seenIntro){ openModal(INTRO_HTML); S.seenIntro=true; save(); }
});
