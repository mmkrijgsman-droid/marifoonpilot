/* MarifoonPilot v2 – applicatielogica */
"use strict";

/* ---------------- Instellingen ---------------- */
const DEFAULTS = {
  distMode:null, distFactor:null,        // null = automatisch (per apparaat)
  theme:"auto", wake:false,
  warn:700, lookahead:true, sound:true, vibe:true, notify:true,
  draft:1.55, margin:0.4,
  anchorRadius:40, sim:false, seenIntro:false,
  predDots:true, predRings:false, planSpeed:4.5,  // vooruitblik: bolletjes, ringen, planningssnelheid (kn) bij stilliggen
  lockDelay:15,                                   // extra minuten per sluis/brug die open moet
  airDraft:null,                                  // hoogte boven water (m); null = niet ingesteld → elke brug moet open
  baseLayer:null, overlays:{depth:true}, mapKeys:{}, vhfPoints:true, // kaartkeuze, overlays, landelijke VHF-punten
  chartDatum:null,                                // reductievlak van de LAT-dieptedata t.o.v. NAP (m); null = geen getijcorrectie
  wind:false,                                     // wind langs de route (Open-Meteo)
  ais:false, aisApi:"",                           // AIS-scheepvaart via de EuRIS-proxy (zie tools/proxy/)
  peilNAP:-0.20                                   // aangenomen waterpeil t.o.v. NAP (m) voor de RWS-bodemhoogte; wordt overruled door een gemeten stand
};
const AIR_MARGIN = 0.5;   // veiligheidsmarge onder een brug (m) — waterpeil wisselt
let S = load();
function load(){
  try{
    const saved=JSON.parse(localStorage.getItem("mp2")||"{}");
    return Object.assign({},DEFAULTS,saved,{
      overlays:Object.assign({},DEFAULTS.overlays,saved.overlays||{}),
      mapKeys:Object.assign({},DEFAULTS.mapKeys,saved.mapKeys||{})
    });
  }catch(e){ return {...DEFAULTS,overlays:{...DEFAULTS.overlays},mapKeys:{...DEFAULTS.mapKeys}}; }
}
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

/* Landelijke officiële VHF-meldpunten. Handmatig dubbel-gecontroleerde POINTS winnen
 * wanneer een RWS-meldpunt vrijwel op dezelfde plek staat. */
let advicePointsCache=null;
function advicePoints(){
  if(advicePointsCache) return advicePointsCache;
  const national = typeof RWS_VHF_POINTS!=="undefined" ? RWS_VHF_POINTS : [];
  const extra=national.filter(p=>!POINTS.some(v=>v.type===p.type && haversine(v.lat,v.lon,p.lat,p.lon)<300)).map(p=>{
    const kind=p.type==="vts"?"VTS-meldpunt":(p.type==="sluis"?"Sluis":"Brug");
    const status=p.status==="mandatory"?" Meldplicht volgens FIS/VNDS.":(p.status==="recommended"?" Aanmelden aanbevolen volgens FIS/VNDS.":"");
    return Object.assign({},p,{
      sub:kind+" · Rijkswaterstaat FIS/VNDS",
      reason:kind+" — gebruik VHF-kanaal "+p.channel+"."+status+(p.note?" "+p.note:"")
    });
  });
  advicePointsCache=POINTS.concat(extra);
  return advicePointsCache;
}

/* ---------------- Toestand ---------------- */
let pos=null, prevPos=null, watchId=null, wakeLock=null, smoothSpeed=null;
let lastKey=null, needsAck=false;
let depth={ loaded:false, points:[], meta:null, status:"none", index:null };
const DEPTH_BUCKET=0.01, DEPTH_SNAP=200;
function buildDepthIndex(){
  depth.index=new Map();
  depth.points.forEach((p,i)=>{
    const k=Math.round(p.lat/DEPTH_BUCKET)+","+Math.round(p.lon/DEPTH_BUCKET);
    let a=depth.index.get(k); if(!a){ a=[]; depth.index.set(k,a); } a.push(i);
  });
}
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
/* Twee soorten dieptedata naast elkaar: officiële lodingen (Waddenzee, uit de ENC-kaarten)
 * en een regionaal model (EMODnet, voor het IJsselmeergebied). Waar beide iets weten wint
 * de officiële meting — die is fijner en heeft een bekend reductievlak. */
/* ---------------- RWS-bodemhoogte (tegelraster) ----------------
 * Waarom dit naast de puntenwolk hierboven bestaat: de RWS-loding is 20 m fijn en staat
 * t.o.v. NAP. Een bekend referentievlak is het hele punt — de waterstand staat ook t.o.v.
 * NAP, dus diepte = waterpeil - bodemhoogte, zonder dat de schipper een reductievlak
 * hoeft op te zoeken. Bij de EMODnet-punten kan dat niet: die hebben geen bekend vlak.
 *
 * De tegels worden pas opgehaald als je er vaart, en de service worker bewaart ze. Zo
 * kost dekking geen download van tientallen MB's bij de eerste start.
 * Bouwen/verversen: tools/build-depth-rws.py                                        */
const RD_R=[[0,1,190094.945],[1,1,-11832.228],[2,1,-114.221],[0,3,-32.391],[1,0,-0.705],
            [3,1,-2.340],[1,3,-0.608],[0,2,-0.008],[2,3,0.148]];
const RD_S=[[1,0,309056.544],[0,2,3638.893],[2,0,73.077],[1,2,-157.984],[3,0,59.788],
            [0,1,0.433],[2,2,-6.439],[1,1,-0.032],[0,4,0.092],[1,4,-0.054]];
function naarRD(lat,lon){
  const dl=0.36*(lat-52.15517440), dp=0.36*(lon-5.38720621);
  let x=155000, y=463000;
  for(const c of RD_R) x+=c[2]*Math.pow(dl,c[0])*Math.pow(dp,c[1]);
  for(const c of RD_S) y+=c[2]*Math.pow(dl,c[0])*Math.pow(dp,c[1]);
  return {x:x,y:y};
}

let rws={ index:null, beschikbaar:null, tegels:new Map(), bezig:new Set(), mislukt:new Set() };

async function laadRwsIndex(){
  try{
    const r=await fetch("depth/rws/index.json",{cache:"force-cache"});
    if(!r.ok) return;
    const ix=await r.json();
    if(ix.formaat!=="mpd1" || !Array.isArray(ix.tegels)) return;
    rws.index=ix;
    rws.beschikbaar=new Set(ix.tegels.map(t=>t.x+"_"+t.y));
    depthSources.push({label:"RWS-loding "+ix.celmaat+" m", n:ix.tegels.length, src:"rws", eenheid:"tegels"});
    $("depthStatus").textContent=depthStatusText();
    if(pos) render();
  }catch(e){}
}

function decodeerTegel(buf){
  const dv=new DataView(buf);
  if(dv.byteLength<19) return null;
  if(String.fromCharCode(dv.getUint8(0),dv.getUint8(1),dv.getUint8(2),dv.getUint8(3))!=="MPD1") return null;
  const b=dv.getUint16(4,true), h=dv.getUint16(6,true);
  const ox=dv.getInt32(8,true), oy=dv.getInt32(12,true);
  const res=dv.getUint16(16,true), nj=dv.getUint8(18);
  let off=19; const jaren=[];
  for(let i=0;i<nj;i++){ jaren.push(dv.getUint16(off,true)); off+=2; }
  const n=b*h;
  if(off+3*n>dv.byteLength) return null;
  const cm=new Int16Array(buf.slice(off,off+2*n));
  const ji=new Uint8Array(buf.slice(off+2*n,off+3*n));
  return {b:b,h:h,ox:ox,oy:oy,res:res,jaren:jaren,cm:cm,ji:ji};
}

async function haalTegel(k){
  rws.bezig.add(k);
  try{
    const r=await fetch("depth/rws/"+k+".mpd",{cache:"force-cache"});
    if(!r.ok) throw new Error("http "+r.status);
    const t=decodeerTegel(await r.arrayBuffer());
    if(t) rws.tegels.set(k,t); else rws.mislukt.add(k);
    if(pos) render();
  }catch(e){ rws.mislukt.add(k); }
  finally{ rws.bezig.delete(k); }
}

/* Bodemhoogte onder een positie, of null als er daar geen loding is. */
function rwsBodem(lat,lon){
  if(!rws.index) return null;
  const rd=naarRD(lat,lon), stap=rws.index.tegelstap;
  const tx=Math.floor(rd.x/stap)*stap, ty=Math.floor(rd.y/stap)*stap;
  const k=tx+"_"+ty;
  const t=rws.tegels.get(k);
  if(!t){
    if(rws.beschikbaar.has(k) && !rws.bezig.has(k) && !rws.mislukt.has(k)) haalTegel(k);
    return null;
  }
  const kol=Math.floor((rd.x-t.ox)/t.res), rij=Math.floor((t.oy-rd.y)/t.res);
  if(kol<0||rij<0||kol>=t.b||rij>=t.h) return null;
  const i=rij*t.b+kol, v=t.cm[i];
  if(v===-32768) return null;
  return { bodem:v/100, jaar:t.jaren[t.ji[i]]||null, cel:t.res };
}

/* Waterpeil t.o.v. NAP. Een gemeten stand wint van de aanname uit de instellingen;
 * welke van de twee het werd, gaat mee naar het scherm — de schipper hoort te zien
 * of hij naar een meting kijkt of naar een streefpeil. */
function waterPeil(){
  if(tide.level!=null) return { peil:tide.level, bron:"gemeten" };
  if(S.peilNAP!=null) return { peil:S.peilNAP, bron:"aanname" };
  return null;
}

function nearestDepth(){
  if(!pos) return null;
  // 1. RWS-loding wint: fijnste raster en een bekend referentievlak.
  const b=rwsBodem(pos.lat,pos.lon), pl=waterPeil();
  if(b && pl) return { depth:pl.peil-b.bodem, dist:0, src:"rws", jaar:b.jaar, cel:b.cel, peil:pl };
  // 2. daarna de puntenwolk: officiele lodingen voor het model.
  if(!depth.points.length || !depth.index) return null;
  const gx=Math.round(pos.lat/DEPTH_BUCKET), gy=Math.round(pos.lon/DEPTH_BUCKET);
  let bestOff=null, bdOff=Infinity, bestMod=null, bdMod=Infinity;
  for(let dx=-1;dx<=1;dx++) for(let dy=-1;dy<=1;dy++){
    const a=depth.index.get((gx+dx)+","+(gy+dy)); if(!a) continue;
    for(const i of a){
      const p=depth.points[i], d=haversine(pos.lat,pos.lon,p.lat,p.lon);
      if(p.src==="model"){ if(d<bdMod){ bdMod=d; bestMod=p; } }
      else if(d<bdOff){ bdOff=d; bestOff=p; }
    }
  }
  if(bestOff && bdOff<=DEPTH_SNAP) return {depth:bestOff.depth, dist:bdOff, src:"official"};
  if(bestMod && bdMod<=DEPTH_SNAP) return {depth:bestMod.depth, dist:bdMod, src:"model"};
  return null;
}

/* ---------------- Getij / waterstand ----------------
 * De app haalt actuele standen op bij Rijkswaterstaat (via de proxy uit config.js) en
 * zoekt het dichtstbijzijnde meetstation. Waarden zijn in cm t.o.v. NAP.
 *
 * De kielspeling-correctie doen we ALLEEN als jij zelf het reductievlak invult. De
 * dieptedata is t.o.v. LAT, de waterstand t.o.v. NAP, en dat verschil loopt per gebied
 * uiteen — dat getal raden we niet. Staat het niet ingesteld, dan is de waterstand
 * puur informatief en blijft de kielspeling de kale kaartdiepte. */
let tide={ at:0, byCode:new Map(), station:null, level:null, when:null, trend:0, busy:false };
function tideHist(){ try{ return JSON.parse(localStorage.getItem("mp2tide")||"{}"); }catch(e){ return {}; } }
function saveTideHist(h){ try{ localStorage.setItem("mp2tide", JSON.stringify(h)); }catch(e){} }

function nearestStation(){
  if(!pos || typeof TIDE_STATIONS==="undefined") return null;
  let best=null, bd=Infinity;
  for(const s of TIDE_STATIONS){
    if(!tide.byCode.has(s.c)) continue;
    const d=haversine(pos.lat,pos.lon,s.lat,s.lon);
    if(d<bd){ bd=d; best=s; }
  }
  return best ? {station:best, dist:bd} : null;
}
async function fetchTide(force){
  const api = (typeof TIDE_API!=="undefined" && TIDE_API) ? TIDE_API : null;
  const every = (typeof TIDE_REFRESH_MIN!=="undefined" ? TIDE_REFRESH_MIN : 10)*60000;
  if(!api || tide.busy) return;
  if(!force && tide.at && Date.now()-tide.at < every) return;
  tide.busy=true;
  try{
    const r=await fetch(api,{cache:"no-store"});
    if(!r.ok) throw new Error("status "+r.status);
    const gj=await r.json();
    const m=new Map();
    for(const f of (gj.features||[])){
      const p=f.properties||{}, meas=(p.measurements||[])[0];
      if(!meas || meas.possiblyFaulty || meas.unitCode!=="cm") continue;
      if(typeof meas.latestValue!=="number") continue;
      m.set(p.locationCode,{ cm:meas.latestValue, t:meas.dateTime });
    }
    if(m.size){ tide.byCode=m; tide.at=Date.now(); updateTide(); }
  }catch(e){ /* offline of proxy onbereikbaar: getij blijft gewoon leeg */ }
  finally{ tide.busy=false; }
}
/* Station kiezen is goedkoop en gebeurt bij elke positie-update; de trend bijhouden
 * (met localStorage-schrijfactie) alleen na een verse fetch. */
function pickStation(){
  const near=nearestStation();
  if(!near){ tide.station=null; tide.level=null; return false; }
  const v=tide.byCode.get(near.station.c);
  tide.station=near.station; tide.dist=near.dist;
  tide.level=v.cm/100; tide.when=v.t;
  return true;
}
function updateTide(){
  if(!pickStation()){ renderTide(); return; }
  const near={station:tide.station}, v=tide.byCode.get(tide.station.c);
  // trend uit de eigen geschiedenis: vergelijk met de oudste meting in het venster
  const h=tideHist(), key=near.station.c;
  const arr=(h[key]||[]).filter(e=>e.t!==v.t);
  arr.push({t:v.t, cm:v.cm});
  while(arr.length>8) arr.shift();
  h[key]=arr; saveTideHist(h);
  const first=arr[0], last=arr[arr.length-1];
  const d = (arr.length>1) ? last.cm-first.cm : 0;
  tide.trend = Math.abs(d)<2 ? 0 : (d>0?1:-1);
  renderTide();
}
/* Correctie op de kaartdiepte, alleen met een door jou ingevuld reductievlak. */
function tideCorrection(){
  if(S.chartDatum==null || tide.level==null) return null;
  return tide.level - S.chartDatum;
}
function renderTide(){
  const el=$("tideVal"), sub=$("tideSub"); if(!el) return;
  if(tide.level==null){
    el.textContent="–";
    sub.textContent = (typeof TIDE_API!=="undefined" && TIDE_API) ? "geen station in bereik" : "niet ingesteld";
    return;
  }
  const pijl = tide.trend>0?"↑":tide.trend<0?"↓":"→";
  el.textContent = (tide.level>=0?"+":"")+fmtNum(tide.level,2)+" "+pijl;
  const min = tide.when ? Math.round((Date.now()-new Date(tide.when).getTime())/60000) : null;
  sub.textContent = tide.station.n + (min!=null && min<180 ? " · "+min+" min geleden" : "");
}

/* ---------------- Kernadvies ---------------- */
function computeAdvice(){
  const {course,source}=deriveCourse();
  const range=warnDistance();

  // Dichtstbijzijnde object, puur geometrisch — dit voedt het "volgend object"-vak.
  let nearest=null, nd=Infinity;
  for(const p of advicePoints()){ const d=haversine(pos.lat,pos.lon,p.lat,p.lon); if(d<nd){nd=d;nearest=p;} }

  let area=null;
  for(const a of AREAS){ if(pointInPolygon([pos.lat,pos.lon],a.polygon)){ area=a; break; } }

  // Kanaaladvies: eerst ALLE objecten toetsen op bereik en koers, dan de dichtstbijzijnde
  // daarvan kiezen. Andersom — eerst de dichtstbijzijnde pakken en die toetsen — laat een
  // sluis recht vooruit wegvallen zodra er toevallig een brugpunt dichterbij naast je ligt
  // dat op het koersfilter sneuvelt. Dan was de kandidatenlijst op en viel de app terug op
  // gebiedsadvies of zelfs op "luister 16". Dat trof o.a. de Lorentz-, Stevin-, Oranje- en
  // Robbengatsluis en de Moormanbrug.
  let target=null, td=Infinity, off=null;
  for(const p of advicePoints()){
    const d=haversine(pos.lat,pos.lon,p.lat,p.lon);
    if(d > Math.max(range, p.radius||500)) continue;
    const o = course!=null ? angleDiff(course, bearing(pos.lat,pos.lon,p.lat,p.lon)) : null;
    if(S.lookahead && o!=null && o>=70) continue;
    if(d<td){ td=d; target=p; off=o; }
  }

  let advice;
  if(target){
    advice={ source:"point", channel:target.channel, post:target.name, sub:target.sub,
      reason:target.reason, dist:td, level: td<=150?"red":"warn", point:target };
  } else if(area){
    advice={ source:"area", channel:area.channel, post:area.name, station:area.station, reason:area.reason, level:"ok", area:area };
  } else {
    advice={ source:"none", channel:null, post:"Buiten bekend gebied",
      reason:"Geen kanaaladvies voor deze positie. Luister uit op kanaal 16.", level:"ok" };
  }
  return { advice, nearest, nd, area, course, source, off, range };
}

/* Onder de kielspeling hoort te staan waar het getal vandaan komt: welke bron, welk
 * meetjaar, en of het peil gemeten is of aangenomen. Zonder dat is 3,85 m een bewering. */
function diepteNoot(dp,corr){
  if(dp.src==="rws"){
    const p=dp.peil;
    return "RWS-loding "+(dp.jaar||"?")+" · peil "+(p.peil>=0?"+":"")+fmtNum(p.peil,2)+" m "
         + (p.bron==="gemeten"?"(gemeten)":"(aanname)");
  }
  const bron = dp.src==="model" ? "model" : "kaartdiepte";
  return corr!=null ? (bron+" · getij "+(corr>=0?"+":"")+fmtNum(corr,2)+" m") : bron;
}
function geenDiepteNoot(){
  if(rws.bezig.size) return "loding laden…";
  if(rws.index && !waterPeil()) return "peil niet ingesteld";
  return "geen loding";
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
  if(tide.byCode.size) pickStation();   // dichtstbijzijnde meetstation volgt je positie
  renderTide();
  const info=computeAdvice(), a=info.advice;

  $("bcNum").innerHTML = a.channel!=null ? (a.channel+' <small>VHF</small>') : '<small style="font-size:.34em">luister 16</small>';
  $("bcPost").textContent = a.post;
  $("bcReason").textContent = a.reason;
  $("bcLabel").textContent = a.source==="point" ? "Zet marifoon op" : "Aanbevolen marifoon";
  if(a.source==="point"){ $("bcDist").style.display="inline-block";
    $("bcDist").textContent = a.dist<=150 ? "Ter hoogte van "+a.post : "Nog "+fmtDist(a.dist)+" tot "+a.post;
  } else $("bcDist").style.display="none";

  // Metrics
  $("sog").textContent = pos.speed!=null && !isNaN(pos.speed) && pos.speed>=0 ? fmtNum(pos.speed*1.94384,1) : "–";
  $("cog").textContent = info.course!=null ? Math.round(info.course) : "–";
  $("areaName").textContent = info.area ? info.area.name : "Buiten gebied";
  const dp=nearestDepth();
  // Bij een RWS-loding zit het waterpeil al in dp.depth verwerkt — bodemhoogte en peil
  // staan allebei t.o.v. NAP. Alleen de LAT-punten vragen om een reductievlak, en dat
  // blijft iets wat jij invult; raden we niet.
  const corr = (dp && dp.src==="rws") ? null : tideCorrection();
  const clr = dp ? dp.depth + (corr||0) - S.draft : null;
  const dt=$("depthTile");
  if(dp){
    $("clearance").textContent=fmtNum(clr,2);
    $("depthNote").textContent=diepteNoot(dp,corr);
    dt.classList.toggle("model", dp.src==="model");
    dt.classList.toggle("danger", clr<S.margin); dt.classList.toggle("warn", clr>=S.margin && clr<S.margin+0.3);
  }
  else { $("clearance").textContent="–"; $("depthNote").textContent=geenDiepteNoot();
    dt.classList.remove("model","danger","warn"); }

  // Volgend object
  if(info.nearest){
    $("nextBox").style.display="flex";
    const brg=bearing(pos.lat,pos.lon,info.nearest.lat,info.nearest.lon);
    $("nextName").textContent=(info.nearest.type==="sluis"?"⚓ ":(info.nearest.type==="vts"?"📡 ":"🌉 "))+info.nearest.name;
    $("nextMeta").textContent=fmtDist(info.nd)+" · "+compass(brg)+" ("+Math.round(brg)+"°) · k"+info.nearest.channel;
    $("nextCh").textContent=info.nearest.channel;
  } else $("nextBox").style.display="none";

  // Co-schipper
  let co, cosub;
  if(a.source==="point"){ co = (a.dist<=150?"Nu ":"Nadert ")+a.post+" — kanaal "+a.channel+"."; cosub = "Zet je marifoon tijdig om."; }
  else if(dp && clr<S.margin){ co="Let op: geschatte kielspeling "+fmtNum(clr,2)+" m."; cosub="Onder je ingestelde marge."; }
  else { co = info.area ? ("Je vaart in "+info.area.name+".") : "Buiten bekend vaargebied.";
    cosub = info.source==="stil" ? "Vooruitkijken wacht op koers/snelheid." : "Koers "+Math.round(info.course)+"° · vooruitkijken actief ("+info.source+")."; }
  $("coText").textContent=co; $("coSub").textContent=cosub;

  // Alert bij situatiewissel
  const key=a.source+":"+a.channel+":"+a.post;
  if(key!==lastKey){ if(lastKey!==null && a.channel!=null) triggerChannelAlert(a, a.dist); lastKey=key; }

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
  syncToastPush();
  if(!opt.sticky) toastTimer=setTimeout(hideToast, 6000);
}
function hideToast(){ $("toast").classList.remove("show"); syncToastPush(); }
/* De toast dekt de kaartknoppen bovenaan af (en blijft staan bij een kanaalwissel).
 * Duw de vooruitblik-balk zolang precies onder de toast door. */
function syncToastPush(){
  const t=$("toast"), on=t.classList.contains("show");
  document.documentElement.style.setProperty("--toast-push", on ? (t.offsetHeight+10)+"px" : "0px");
}

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
  // Werkelijke snelheid, licht afgevlakt (voortschrijdend gemiddelde) → stabiele live route-tijd
  if(pos.speed!=null && !isNaN(pos.speed) && pos.speed>=0)
    smoothSpeed = (smoothSpeed==null) ? pos.speed : smoothSpeed*0.85 + pos.speed*0.15;
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
let map=null, boat=null, mapCentered=false, overlays={}, baseLayers={}, curBase="osm", predLayer=null, nationalVhfLayer=null, fairwayDepthLayer=null, aisLayer=null, windLayer=null;
let route=[], routeMode=false, lastBlockedKey=null, pointMarkers=[], routeLayer=null;
/* Alles op de kaart (pins, bolletjes, labels) schaalt mee met --mui, zodat de
 * leesafstand-instelling niet alleen het Varen-dashboard maar ook de kaart raakt. */
let MUI=1;
/* Let op: --mui is in CSS een clamp(); getPropertyValue geeft voor custom properties de
 * ONuitgerekende tekst terug ("clamp(1, 2.1, 1.6)"). Daarom hier dezelfde clamp op --dist,
 * die wél altijd een kaal getal is. */
const MUI_MAX=1.6;
function readMui(){
  const d = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--dist")) || 1;
  MUI = Math.min(MUI_MAX, Math.max(1, d));
}
const sc = n => Math.round(n*MUI);
function initMap(){
  if(typeof L==="undefined"){ const mv=$("view-map"); if(mv) mv.innerHTML='<div style="padding:24px;color:var(--muted);text-align:center">Kaart kon niet laden (geen verbinding). Het kanaaladvies werkt gewoon door.</div>'; return; }
  readMui();
  // Zoomregelaar naar rechtsonder: linksboven botste hij op een telefoon met de vooruitblik-balk
  map=L.map("map",{zoomControl:false}).setView([52.75,5.35],9);
  L.control.zoom({position:"bottomright"}).addTo(map);
  fairwayDepthLayer=L.layerGroup().addTo(map);
  buildTileLayers();
  AREAS.forEach(a=>L.polygon(a.polygon,{color:a.color,weight:2,fillColor:a.color,fillOpacity:.10,interactive:false}).addTo(map));
  pointMarkers=POINTS.map(p=>{
    const extra = p.type==="brug" && p.clearance!=null ? "<br>🌉 Doorvaarthoogte gesloten: <b>"+fmtNum(p.clearance,1)+" m</b>" : "";
    const m=L.marker([p.lat,p.lon],{icon:pinIcon(p)}).bindPopup("<b>"+p.name+"</b><br>"+(p.sub||"")+"<br>📻 Kanaal <b>"+p.channel+"</b>"+extra).addTo(map);
    return {m,p};
  });
  nationalVhfLayer=L.layerGroup().addTo(map);
  aisLayer=L.layerGroup().addTo(map);
  windLayer=L.layerGroup().addTo(map);
  drawNationalVhf();
  drawFairwayDepths();
  KNRM.forEach(k=>L.marker([k.lat,k.lon],{icon:knrmIcon()}).bindPopup("<b>"+k.name+"</b><br>🚨 Alarm via Kustwacht / kanaal 16").addTo(map));
  predLayer=L.layerGroup().addTo(map);
  // Eigen laag: predLayer wordt bij elke hertekening geleegd, en dan zou je een punt
  // midden in een sleep kwijtraken.
  routeLayer=L.layerGroup().addTo(map);
  boat=L.marker([52.75,5.35],{icon:boatIcon(0),zIndexOffset:1000});
  map.on("click",e=>{
    if(routeMode){ route.push({lat:e.latlng.lat,lon:e.latlng.lng}); if(!pos && route.length===1) hintNoPos(); drawRouteMarkers(); drawPrediction(); }
    else if(S.sim){ simSet(e.latlng.lat,e.latlng.lng); }
  });
  map.on("zoomend moveend",()=>{ drawPrediction(); drawNationalVhf(); drawFairwayDepths(); planAis(); drawWind(); });
  // routepunten veranderen van vorm per zoomniveau, dus opnieuw opbouwen na zoomen
  let laatsteDetail=null;
  map.on("zoomend",()=>{ const d=wpDetail(); if(d!==laatsteDetail){ laatsteDetail=d; drawRouteMarkers(); } });
}
/* ---------------- Kaartlagen (config.js) ----------------
 * Lagen die een API-sleutel nodig hebben verschijnen pas zodra die sleutel er is —
 * uit config.js of, handig bij uitproberen, uit Instellingen. Zo blijft de app op
 * OpenStreetMap werken zolang er geen abonnement is. */
function mapKey(name){
  if(!name) return "";
  return (S.mapKeys && S.mapKeys[name]) || (typeof MAP_KEYS!=="undefined" ? MAP_KEYS[name] : "") || "";
}
function availableLayers(){ return TILE_LAYERS.filter(l=>!l.needs || mapKey(l.needs)); }
function makeTileLayer(def){
  const opt={ maxZoom:def.maxZoom||19, attribution:def.attribution||"", opacity:def.opacity==null?1:def.opacity };
  if(def.type==="wms") return L.tileLayer.wms(def.url, Object.assign({}, def.wms, opt));
  return L.tileLayer(def.url.replace("{key}", mapKey(def.needs)), opt);
}
function buildTileLayers(){
  Object.values(baseLayers).forEach(l=>{ if(map.hasLayer(l)) map.removeLayer(l); });
  baseLayers={};
  const avail=availableLayers();
  avail.forEach(def=>{ baseLayers[def.id]=makeTileLayer(def); });
  // bewaarde keuze aanhouden, anders de eerste beschikbare laag
  if(!baseLayers[curBase]) curBase = (S.baseLayer && baseLayers[S.baseLayer]) ? S.baseLayer : avail[0].id;
  baseLayers[curBase].addTo(map);

  buildOverlays();

  const sel=$("layerSel");
  if(sel){
    sel.innerHTML = avail.map(l=>`<option value="${l.id}">${l.label}</option>`).join("");
    sel.value=curBase;
  }
}
/* Elke overlay uit config.js krijgt automatisch een knop. Zo is er straks niets meer
 * nodig dan een regel in TILE_OVERLAYS om er bijvoorbeeld AIS naast te zetten. */
function buildOverlays(){
  Object.values(overlays).forEach(l=>{ if(map.hasLayer(l)) map.removeLayer(l); });
  overlays={};
  const host=$("overlayBtns"); if(host) host.innerHTML="";
  TILE_OVERLAYS.filter(o=>!o.needs || mapKey(o.needs)).forEach(def=>{
    overlays[def.id]=makeTileLayer(def);
    if(S.overlays && S.overlays[def.id]) overlays[def.id].addTo(map);
    if(!host) return;
    const b=document.createElement("button");
    b.className="seabtn"+((S.overlays&&S.overlays[def.id])?" on":"");
    b.textContent=innerWidth<600 && def.shortLabel ? def.shortLabel : def.label; b.title=def.title||def.label;
    b.addEventListener("click",()=>toggleOverlay(def.id,b));
    host.appendChild(b);
  });
  if(host){
    const b=document.createElement("button");
    b.id="toggleVhf"; b.className="seabtn"+(S.vhfPoints?" on":"");
    b.textContent=innerWidth<600?"📻 VHF":"📻 VHF Nederland";
    b.title="Officiële RWS-meldpunten: bruggen en sluizen vanaf zoomniveau 10, VTS-punten altijd";
    b.addEventListener("click",()=>{ S.vhfPoints=!S.vhfPoints; save(); b.classList.toggle("on",S.vhfPoints); drawNationalVhf(); });
    host.appendChild(b);

    const a=document.createElement("button");
    a.id="toggleAis"; a.className="seabtn"+(S.ais?" on":"");
    a.textContent=innerWidth<600?"\u{1F6A2} AIS":"\u{1F6A2} Scheepvaart";
    a.title="Schepen die AIS uitzenden, via EuRIS. Toont lang niet alles \u2014 zie de popup.";
    a.addEventListener("click",()=>{ S.ais=!S.ais; save(); a.classList.toggle("on",S.ais);
      if(S.ais) planAis(true); else { ais.schepen=[]; drawAis(); } });
    host.appendChild(a);

    const w=document.createElement("button");
    w.id="toggleWind"; w.className="seabtn"+(S.wind?" on":"");
    w.textContent="\u{1F32C} Wind";
    w.title="Wind langs je route, op het moment dat je er volgens de planning bent";
    w.addEventListener("click",()=>{ S.wind=!S.wind; save(); w.classList.toggle("on",S.wind);
      if(S.wind){ if(route.length) haalWind(); else showToast("\u{1F32C}","Nog geen route",
        "Teken eerst een route met de Route-knop; dan zet ik de wind erlangs.",{}); drawWind(); }
      else drawWind(); });
    host.appendChild(w);
  }
}
function toggleOverlay(id,btn){
  const l=overlays[id]; if(!l) return;
  S.overlays=Object.assign({},S.overlays);
  S.overlays[id]=!S.overlays[id];
  save();
  if(S.overlays[id]){ l.addTo(map); l.bringToFront(); } else map.removeLayer(l);
  if(btn) btn.classList.toggle("on", S.overlays[id]);
  if(id==="depth") drawFairwayDepths();
}
function setBaseLayer(id){
  if(!baseLayers[id]) return;
  Object.values(baseLayers).forEach(l=>{ if(map.hasLayer(l)) map.removeLayer(l); });
  baseLayers[id].addTo(map);
  Object.values(overlays).forEach(l=>{ if(map.hasLayer(l)) l.bringToFront(); });
  curBase=id; S.baseLayer=id; save();
}

function pinIcon(p){ const c=p.type==="sluis"?"#00d0ff":"#a78bfa", s=sc(26);
  return L.divIcon({className:"",iconSize:[s,s],iconAnchor:[s/2,s/2],
    html:`<div style="width:${s}px;height:${s}px;border-radius:50%;background:${c};border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:${sc(12)}px;font-weight:800;color:#012;box-shadow:0 1px 4px rgba(0,0,0,.6)">${p.channel}</div>`}); }
function nationalVhfIcon(p){
  const c=p.type==="sluis"?"#00d0ff":(p.type==="vts"?"#ffce6b":"#a78bfa"), s=sc(p.type==="vts"?24:22);
  return L.divIcon({className:"",iconSize:[s,s],iconAnchor:[s/2,s/2],
    html:`<div style="width:${s}px;height:${s}px;border-radius:${p.type==="vts"?"5px":"50%"};background:${c};border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:${sc(10)}px;font-weight:900;color:#07131f;box-shadow:0 1px 4px rgba(0,0,0,.65)">${p.channel}</div>`});
}
function nationalVtsCentreIcon(p){
  const s=sc(28), text=p.channels&&p.channels.length===1?p.channel:"VC";
  return L.divIcon({className:"",iconSize:[s,s],iconAnchor:[s/2,s/2],
    html:`<div style="width:${s}px;height:${s}px;border-radius:6px;background:#f59e0b;border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:${sc(9)}px;font-weight:900;color:#241500;box-shadow:0 1px 5px rgba(0,0,0,.75)">${text}</div>`});
}
/* ---------------- AIS-scheepvaart (EuRIS) ----------------
 * Bron: EuRIS (eurisportal.eu), collectie tracks. De dienst antwoordt zonder token maar
 * zonder CORS-headers, dus het loopt via de proxy uit tools/proxy/ - daar wordt ook
 * gepagineerd, gefilterd en gestript, want ongefilterd is een corridor 85 KB per keer.
 *
 * WAT DE SCHIPPER MOET WETEN, en wat daarom in elke popup staat:
 *   - AIS toont alleen schepen die ZENDEN. De meeste pleziervaart doet dat niet. Een lege
 *     kaart betekent dus niet dat het water leeg is. Dit is geen uitkijk.
 *   - EuRIS schermt de identiteit van vrijwel alle binnenvaart af: naam, roepnaam, MMSI en
 *     ENI komen er niet uit (gemeten: 1 van de 1044). Afmetingen, koers, snelheid en kegels
 *     wel. Waar geen naam is, zeggen we dat - we tonen het interne tracknummer niet als
 *     scheepsnaam, want dat herkent niemand over de marifoon.
 *   - Een positie is enkele minuten oud. De leeftijd staat erbij.                       */
let ais={ schepen:[], opgehaald:null, bezig:false, fout:null, timer:null, laatst:0,
  uitgezoomd:false, klok:null, laatsteBox:null };

/* Hoeveel van het NIEUWE beeld al gedekt werd door de vorige ophaal (0..1). */
function aisOverlap(a,b){
  if(!a||!b) return 0;
  const bw=Math.max(0, Math.min(a[2],b[2])-Math.max(a[0],b[0]));
  const bh=Math.max(0, Math.min(a[3],b[3])-Math.max(a[1],b[1]));
  const opp=(b[2]-b[0])*(b[3]-b[1]);
  return opp>0 ? (bw*bh)/opp : 0;
}
const AIS_VERVERS_MS=45000;   // varende posities zijn mediaan 0 min oud; vaker heeft geen zin

/* De kaartbeweging is niet genoeg: lig je stil met de kaart op je boot, dan verouderen de
 * schepen zonder dat er ooit een moveend komt. Vandaar een klok, die stilstaat zodra de
 * laag uit is of de app naar de achtergrond gaat. */
function aisKlok(){
  if(ais.klok){ clearInterval(ais.klok); ais.klok=null; }
  if(!S.ais || !aisUrl()) return;
  ais.klok=setInterval(()=>{
    if(document.hidden || !S.ais || !map) return;
    if($("view-map") && !$("view-map").classList.contains("active")) return;
    haalAis();
  }, AIS_VERVERS_MS);
}
document.addEventListener("visibilitychange",()=>{ if(!document.hidden && S.ais) planAis(true); });

function aisUrl(){
  const eigen=(S.aisApi||"").trim();
  if(eigen) return eigen;
  return (typeof AIS_API!=="undefined" && AIS_API) ? String(AIS_API).trim() : "";
}

/* Niet bij elke kaartbeweging opnieuw ophalen: samenvoegen tot een vraag, en niet vaker
 * dan eens per halve minuut. Varende posities zijn mediaan 0 min oud, dus vaker heeft
 * geen zin en belast de dienst onnodig. */
function planAis(nu){
  if(ais.timer){ clearTimeout(ais.timer); ais.timer=null; }
  if(!S.ais || !map || !aisUrl()){ aisKlok(); return; }
  aisKlok();
  ais.timer=setTimeout(()=>{ ais.timer=null; haalAis(); }, nu?0:700);
}

async function haalAis(){
  const basis=aisUrl();
  if(!S.ais || !map || !basis || ais.bezig) return;
  if(!map.getSize().x) return;              // kaart nog niet doorgemeten
  const b=map.getBounds().pad(0.1);
  // De proxy weigert boven 1,2 graad; bij ver uitzoomen heeft schepen tekenen toch geen zin.
  // Dat is geen fout maar een normale toestand: schoonvegen en stil wachten tot je inzoomt.
  if(b.getEast()-b.getWest() > 1.2 || b.getNorth()-b.getSouth() > 1.2){
    ais.uitgezoomd=true; ais.fout=null; ais.schepen=[]; drawAis(); return;
  }
  ais.uitgezoomd=false;
  /* Het tempo begrenzen mag alleen zolang je NAAR HETZELFDE GEBIED kijkt. Puur op tijd
   * begrenzen was fout: verschoof je de kaart naar een ander vaarwater, dan hield de app
   * tot 25 s de schepen van het vórige gebied vast. Die liggen buiten beeld, dus de kaart
   * lijkt leeg terwijl er daar wel degelijk schepen varen. */
  const box=[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()];
  const zelfdeGebied = aisOverlap(ais.laatsteBox, box) > 0.7;
  if(zelfdeGebied && Date.now()-ais.laatst < 25000 && ais.schepen.length){ drawAis(); return; }
  if(!zelfdeGebied && ais.schepen.length){ ais.schepen=[]; drawAis(); }  // niet het vorige gebied tonen
  ais.bezig=true; ais.fout=null;
  try{
    const u=basis+(basis.indexOf("?")>=0?"&":"?")
      +"minLon="+b.getWest().toFixed(4)+"&minLat="+b.getSouth().toFixed(4)
      +"&maxLon="+b.getEast().toFixed(4)+"&maxLat="+b.getNorth().toFixed(4);
    const r=await fetch(u,{cache:"no-store"});
    if(!r.ok) throw new Error("proxy gaf status "+r.status);
    const d=await r.json();
    ais.schepen=Array.isArray(d.schepen)?d.schepen:[];
    ais.opgehaald=d.opgehaald||new Date().toISOString();
    ais.laatst=Date.now(); ais.laatsteBox=box;
    ais.aangevuld=!!d.aangevuld;
  }catch(e){ ais.fout=String((e&&e.message)||e); ais.schepen=[]; ais.laatsteBox=null; }
  finally{ ais.bezig=false; drawAis(); }
}

function aisIcon(s){
  const groot=(s.lengte||0)>=40;
  const kleur = (s.gevaarlijk||s.kegels) ? "#ff5d5d" : (s.vaart ? (groot?"#ffce6b":"#7fe0a0") : "#8fa3b8");
  const g=sc(groot?20:15), hoek=(s.koers||0);
  // Varend als pijl in de vaarrichting; stilliggend als rondje, want de koers van een
  // stilliggend schip zegt niets.
  const vorm = s.vaart
    ? '<svg width="'+g+'" height="'+g+'" viewBox="0 0 24 24" style="transform:rotate('+hoek+'deg)">'
      + '<path d="M12 1 L20 22 L12 17.5 L4 22 Z" fill="'+kleur+'" stroke="#04121c" stroke-width="1.6"/></svg>'
    : '<div style="width:'+(g*0.66)+'px;height:'+(g*0.66)+'px;border-radius:50%;background:'+kleur+';border:2px solid #04121c"></div>';
  return L.divIcon({className:"",iconSize:[g,g],iconAnchor:[g/2,g/2],
    html:'<div style="width:'+g+'px;height:'+g+'px;display:flex;align-items:center;justify-content:center">'+vorm+'</div>'});
}

function aisOuderdom(iso){
  if(!iso) return null;
  const min=Math.round((Date.now()-new Date(iso).getTime())/60000);
  return (min<0||min>600) ? null : min;
}
const AIS_STATUS={1:"voor anker",2:"niet manoeuvreerbaar",3:"beperkt manoeuvreerbaar",
  4:"beperkt door diepgang",5:"afgemeerd",6:"aan de grond",7:"aan het vissen",8:"onder zeil"};

function aisPopup(s){
  const naam = s.naam
    ? "<b>"+escapeHtml(s.naam)+"</b>"
    : "<b>Naam niet in de bron</b><br><small>EuRIS schermt de identiteit van vrijwel alle binnenvaart af.</small>";
  const maat = (s.lengte||s.breedte)
    ? "<br>\u{1F4CF} "+(s.lengte?fmtNum(s.lengte,0)+" m lang":"lengte onbekend")
      +(s.breedte?" \u00b7 "+fmtNum(s.breedte,0)+" m breed":"")
    : "<br>\u{1F4CF} afmetingen onbekend";
  const vaart = s.vaart
    ? "<br>\u27a4 "+fmtNum(s.snelheid||0,1)+" kn \u00b7 koers "+Math.round(s.koers||0)+"\u00b0"
    : "<br>\u27a4 ligt stil";
  const st = (s.status && AIS_STATUS[s.status]) ? "<br>\u2693 "+AIS_STATUS[s.status] : "";
  const gev = (s.kegels||s.gevaarlijk)
    ? "<br>\u26a0\ufe0f <b>Gevaarlijke lading</b>"+(s.kegels?" \u00b7 "+s.kegels+" kegel"+(s.kegels>1?"s":""):"") : "";
  const roep = s.roepnaam ? "<br>\u{1F4FB} Roepnaam "+escapeHtml(s.roepnaam) : "";
  const id = s.mmsi ? "<br>MMSI "+escapeHtml(String(s.mmsi))
                    : (s.eni ? "<br>ENI "+escapeHtml(String(s.eni)) : "");
  const plaats = s.plaats ? "<br>\u{1F4CD} "+escapeHtml(s.plaats) : "";
  const min = aisOuderdom(s.gemetenOp);
  const oud = (min===null) ? "" : "<br><small>Positie "+(min<1?"minder dan 1 min":min+" min")+" oud</small>";
  return naam+maat+vaart+st+gev+roep+id+plaats+oud
    + "<br><small>Bron: EuRIS (eurisportal.eu). AIS toont alleen schepen die uitzenden \u2014 "
    + "de meeste pleziervaart doet dat niet. Geen vervanging voor uitkijken.</small>";
}

function drawAis(){
  if(!map||!aisLayer) return;
  aisLayer.clearLayers();
  if(!S.ais) return;
  for(const s of ais.schepen){
    if(typeof s.lat!=="number"||typeof s.lon!=="number") continue;
    L.marker([s.lat,s.lon],{icon:aisIcon(s),zIndexOffset:60})
      .bindPopup(aisPopup(s)).addTo(aisLayer);
  }
}

/* ---------------- Wind langs de route (Open-Meteo) ----------------
 * Bron: Open-Meteo, model KNMI Harmonie AROME Nederland (2 km) waar beschikbaar, daarna
 * ECMWF IFS. Gemeten: Harmonie dekt ~67 uur vooruit, ECMWF de volle 7 dagen, en ze
 * verschillen echt (16,7 tegen 13,7 kn op hetzelfde uur). Welk model een waarde leverde
 * gaat daarom mee naar het scherm - zelfde regel als het meetjaar bij de loding.
 *
 * WAAROM DIT ANDERS IS DAN "het weer op de kaart": een zeiler wil niet weten hoe het NU
 * waait waar hij STRAKS is, maar hoe het waait op het moment dat hij er is. De app weet
 * dat al: pathLength, predParams().v en waitBefore() leveren samen de ETA per punt. En
 * dan is het getal dat telt niet de windrichting maar de hoek tussen wind en koers -
 * dat bepaalt of een traject te zeilen is of dat je moet kruisen.
 *
 * Open-Meteo stuurt access-control-allow-origin: *, dus dit gaat rechtstreeks vanuit de
 * browser; geen proxy nodig. Let op: hun gratis tier is NIET voor commercieel gebruik.
 * Ga je live, dan koop je een plan of zet je haalWindData() om naar api.met.no, dat wel
 * gratis-commercieel is. Daarom staat het ophalen in een eigen functie.        */
const WIND_API = "https://api.open-meteo.com/v1/forecast";
const WIND_MODELLEN = [
  { id:"knmi_harmonie_arome_netherlands", naam:"KNMI Harmonie 2 km" },
  { id:"ecmwf_ifs025",                    naam:"ECMWF IFS" }
];
/* Meetdichtheid en tekendichtheid zijn bewust twee verschillende dingen. We halen fijn
 * op - om de 2 km - zodat de gekleurde band de wind langs de route nauwkeurig volgt. Hoe
 * veel VEREN je ziet hangt af van je zoomniveau: op het scherm houden we ze minstens
 * WIND_MIN_PX uit elkaar. Zoom je in, dan verschijnen er vanzelf meer. Zo staan ze nooit
 * te ver uit elkaar en nooit op een hoop, zonder opnieuw op te halen. */
const WIND_MAX_PUNTEN = 24;
const WIND_STAP_M = 2000;      // richtafstand tussen meetpunten (ophalen)
const WIND_MIN_PX = 62;        // minimale afstand tussen twee veren op het scherm

let wind={ punten:[], data:null, sleutel:null, bezig:false, fout:null, vertrekU:0 };

/* Meetpunten langs de route: elk routepunt, plus tussenpunten op lange trajecten. */
function windPunten(path){
  if(!path || path.length<2) return [];
  const lengte=pathLength(path);
  if(lengte<1) return [];
  /* Eerder zette ik een meetpunt op ELK routepunt plus om de 8 km. Bij een route met
   * acht punten binnen dertien kilometer levert dat een kluwen veren en getallen over
   * elkaar heen - technisch aanwezig, visueel waardeloos. Nu verdelen we een beperkt
   * aantal punten gelijkmatig over de lengte, zodat ze op het scherm uit elkaar blijven
   * ongeacht hoe fijn je de route hebt geklikt. */
  const n=Math.max(2, Math.min(WIND_MAX_PUNTEN, Math.round(lengte/WIND_STAP_M)+1));
  const stap=lengte/(n-1);
  const uit=[];
  let acc=0, doel=0, i=0;
  while(i<path.length-1 && uit.length<n){
    const la1=path[i][0],lo1=path[i][1],la2=path[i+1][0],lo2=path[i+1][1];
    const seg=haversine(la1,lo1,la2,lo2)||1e-9;
    while(doel<=acc+seg && uit.length<n){
      const f=(doel-acc)/seg;
      uit.push({lat:la1+(la2-la1)*f, lon:lo1+(lo2-lo1)*f, afst:doel});
      doel+=stap;
    }
    acc+=seg; i++;
  }
  const eind=path[path.length-1];
  if(!uit.length || uit[uit.length-1].afst < lengte-1)
    uit.push({lat:eind[0], lon:eind[1], afst:lengte});
  return uit;
}

async function haalWindData(punten){
  const u = WIND_API
    + "?latitude=" + punten.map(p=>p.lat.toFixed(4)).join(",")
    + "&longitude=" + punten.map(p=>p.lon.toFixed(4)).join(",")
    + "&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m"
    + "&models=" + WIND_MODELLEN.map(m=>m.id).join(",")
    + "&wind_speed_unit=kn&timeformat=unixtime&forecast_days=7";
  const r=await fetch(u);
  if(!r.ok) throw new Error("Open-Meteo gaf status "+r.status);
  const d=await r.json();
  return Array.isArray(d) ? d : [d];
}

async function haalWind(){
  const path=livePath();
  const punten=windPunten(path);
  if(!punten.length){ wind.data=null; wind.punten=[]; drawWind(); return; }
  // sleutel op de meetpunten: alleen opnieuw ophalen als de route echt verandert
  const sleutel=punten.map(p=>p.lat.toFixed(3)+","+p.lon.toFixed(3)).join(";");
  if(wind.data && wind.sleutel===sleutel) { drawWind(); return; }
  if(wind.bezig) return;
  wind.bezig=true; wind.fout=null;
  try{
    wind.data=await haalWindData(punten);
    wind.punten=punten; wind.sleutel=sleutel;
  }catch(e){ wind.fout=String((e&&e.message)||e); wind.data=null; }
  finally{ wind.bezig=false; drawWind(); }
}

/* Wind op meetpunt i, op tijdstip t (ms). Harmonie wint zolang die reikt. */
function windOp(i, t){
  if(!wind.data || !wind.data[i]) return null;
  const h=wind.data[i].hourly, tijden=h.time;
  if(!tijden || !tijden.length) return null;
  const doel=Math.round(t/1000);
  if(doel < tijden[0]-3600 || doel > tijden[tijden.length-1]+3600) return null;
  // dichtstbijzijnde uur
  let k=0, best=Infinity;
  for(let j=0;j<tijden.length;j++){ const d=Math.abs(tijden[j]-doel); if(d<best){best=d;k=j;} }
  for(const m of WIND_MODELLEN){
    const kn=h["wind_speed_10m_"+m.id], ri=h["wind_direction_10m_"+m.id], vl=h["wind_gusts_10m_"+m.id];
    if(kn && kn[k]!=null && ri && ri[k]!=null)
      return { kn:kn[k], uit:ri[k], vlaag:(vl&&vl[k]!=null)?vl[k]:null, model:m.naam, uur:tijden[k]*1000 };
  }
  return null;
}

/* De hoek tussen de wind en je koers. 0 graden = pal op de neus, 180 = pal van achteren.
 * Dit is het getal waar een zeiler op stuurt; de absolute windrichting zegt op zichzelf
 * niets over of een traject te zeilen is. */
/* Kleuren zijn hier functioneel, geen opsmuk: je moet van een afstand zien welk stuk
 * zich laat zeilen. Twee eisen. Ze moeten onderling te onderscheiden zijn - eerder deelden
 * halve en ruime wind hetzelfde groen, dus die kon je niet uit elkaar houden. En ze moeten
 * het uithouden BOVEN WATER: het lichtblauw dat hier voor "voor de wind" stond viel op de
 * OSM-kaart volledig weg tegen het meer. Rood, oranje, groen en paars houden stand op
 * zowel het lichte OSM-water als op satelliet. */
const WIND_HOEKEN=[
  { tot:35,  naam:"pal op de neus", kort:"tegen", kleur:"#ff2d20", kruisen:true },
  { tot:60,  naam:"aan de wind",    kort:"aan",   kleur:"#ff9f0a" },
  { tot:110, naam:"halve wind",     kort:"half",  kleur:"#34d058" },
  { tot:150, naam:"ruime wind",     kort:"ruim",  kleur:"#12a05c" },
  { tot:181, naam:"voor de wind",   kort:"voor",  kleur:"#b45cff" }
];
function windHoek(koers, uit){
  const h=angleDiff(koers, uit);
  for(const k of WIND_HOEKEN) if(h<k.tot) return Object.assign({hoek:h}, k);
  return Object.assign({hoek:h}, WIND_HOEKEN[WIND_HOEKEN.length-1]);
}

/* Vertrektijd: nu, of zoveel uur later als de schuif in het venster aangeeft. */
function windVertrek(){ return Date.now() + wind.vertrekU*3600*1000; }

/* Per meetpunt: wanneer ben je daar, welke koers vaar je daar, en wat doet de wind dan. */
function windTrajecten(){
  if(!wind.data || !wind.punten.length) return [];
  const path=livePath();
  if(path.length<2) return [];
  const P=predParams(); if(!P) return [];
  const obst = S.lockDelay>0 ? routeObstacles(path) : [];
  const vertrek=windVertrek();
  const uit=[];
  for(let i=0;i<wind.punten.length;i++){
    const pt=wind.punten[i];
    const wachtMin=waitBefore(pt.afst, obst);
    const t=vertrek + (pt.afst/P.v)*1000 + wachtMin*60000;
    const w=windOp(i,t);
    // koers: richting naar het volgende meetpunt, of vanaf het vorige op het eindpunt
    let koers=null;
    if(i<wind.punten.length-1) koers=bearing(pt.lat,pt.lon,wind.punten[i+1].lat,wind.punten[i+1].lon);
    else if(i>0) koers=bearing(wind.punten[i-1].lat,wind.punten[i-1].lon,pt.lat,pt.lon);
    uit.push({ i:i, pt:pt, tijd:t, koers:koers, w:w,
      hoek: (w&&koers!=null) ? windHoek(koers,w.uit) : null });
  }
  return uit;
}

/* Een windveer, zoals op elke weerkaart: de stok wijst naar de richting waar de wind
 * VANDAAN komt, en de veren aan de bovenkant tellen de snelheid. Halve veer 5 knopen,
 * hele veer 10, wimpel 50. Een zeiler leest daar richting en kracht in een oogopslag uit,
 * ook tussen de boeisymbolen waar een getalletje verdrinkt. */
/* De veren komen niet op de meetpunten te staan maar HALVERWEGE tussen de tijd-bolletjes.
 * De bolletjes staan om de P.interval minuten (stepM meter); de veren op (k+0,5)*stepM.
 * Twee dingen tegelijk daarmee opgelost: ze botsen nooit met een bolletje, en je leest de
 * kaart als een tijdlijn - bolletje, wind, bolletje, wind. En omdat predParams() dat
 * interval al aanpast aan zoom en snelheid, schalen de veren vanzelf mee met je zoomniveau.
 *
 * De wind zelf komt van het dichtstbijzijnde MEETpunt; die halen we los op, om de 2 km.
 * Bewust niet interpoleren tussen twee meetpunten: dan zou ik een waarde tonen die nergens
 * uit het model komt. Welk meetpunt het werd staat in de popup. */
/* Hoe fijn zetten we de veren? Basis is de afstand tussen twee tijd-bolletjes, en dan
 * halveren we zolang ze op het scherm nog ruim uit elkaar staan. Halveren houdt ze buiten
 * de bolletjes: die staan op hele stappen (1, 2, 3 x stepM), de veren op halve van de
 * gekozen spatiering (0,5 / 1,5 ...  of 0,25 / 0,75 ... ), dus nooit op een geheel getal. */
function windSpatiering(path, stepM, lengte){
  let sp=stepM;
  const mid=lengte*0.5;
  for(let n=0;n<3;n++){
    const a=map.latLngToContainerPoint(puntOpAfstand(path, Math.max(0, mid-sp/2)));
    const b=map.latLngToContainerPoint(puntOpAfstand(path, Math.min(lengte, mid+sp/2)));
    if(a.distanceTo(b) <= WIND_MIN_PX*2.2) break;
    sp/=2;
  }
  return sp;
}

function windHaken(){
  if(!wind.data || !wind.punten.length) return [];
  const path=livePath(); if(path.length<2) return [];
  const P=predParams(); if(!P) return [];
  const lengte=pathLength(path);
  const basis=P.v*P.interval*60;
  if(!(basis>0) || lengte<1) return [];
  const stepM=windSpatiering(path, basis, lengte);
  const obst = S.lockDelay>0 ? routeObstacles(path) : [];
  const vertrek=windVertrek();
  const uit=[];
  for(let d=stepM*0.5; d<lengte && uit.length<40; d+=stepM){
    let idx=0, best=Infinity;
    for(let i=0;i<wind.punten.length;i++){
      const v=Math.abs(wind.punten[i].afst-d);
      if(v<best){ best=v; idx=i; }
    }
    const t=vertrek + (d/P.v)*1000 + waitBefore(d,obst)*60000;
    const w=windOp(idx,t);
    if(!w) continue;
    const pt=puntOpAfstand(path,d);
    // koers uit een stukje vóór en ná het punt, zodat hij ook in een bocht klopt
    const delta=Math.max(60, stepM*0.15);
    const van=puntOpAfstand(path, Math.max(0, d-delta));
    const naar=puntOpAfstand(path, Math.min(lengte, d+delta));
    const koers=bearing(van[0],van[1],naar[0],naar[1]);
    uit.push({ pt:{lat:pt[0],lon:pt[1],afst:d}, tijd:t, koers:koers, w:w,
               hoek:windHoek(koers,w.uit) });
  }
  return uit;
}

function windVeerIcon(w, hoek){
  const g=sc(58), c=g/2;
  /* De veer is WIT, niet in de kleur van de hoek. Dat was hij eerst wel, en dan ligt een
   * paarse veer op een paarse band en zie je hem niet. Zo heeft kleur precies een taak -
   * de band vertelt de zeilbaarheid - en de veer een andere: richting en kracht. Wit met
   * een donkere gloed houdt stand op elke ondergrond en op elke bandkleur. */
  const kleur = "#ffffff";
  const kn=Math.max(0, Math.round(w.kn/5)*5);
  const staafTop=c-g*0.34, staafBod=c;
  const stapY=g*0.075, lang=g*0.20, kort=g*0.11;
  let y=staafTop, d='', rest=kn;
  while(rest>=50){ d+='M'+c+' '+y+' L'+(c+lang)+' '+(y-stapY*0.7)+' L'+c+' '+(y+stapY*1.15)+' Z '; y+=stapY*1.5; rest-=50; }
  while(rest>=10){ d+='M'+c+' '+y+' L'+(c+lang)+' '+(y-stapY*0.8)+' '; y+=stapY; rest-=10; }
  if(rest>=5){ if(y===staafTop) y+=stapY; d+='M'+c+' '+y+' L'+(c+kort)+' '+(y-stapY*0.45)+' '; }
  const stil  = kn<3 ? '<circle cx="'+c+'" cy="'+c+'" r="'+(g*0.10)+'" fill="none" stroke="'+kleur+'" stroke-width="2"/>' : '';
  const staaf = kn>=3 ? '<path d="M'+c+' '+staafBod+' L'+c+' '+staafTop+'" stroke="'+kleur+'" stroke-width="2.4" stroke-linecap="round"/>' : '';
  const veren = d ? '<path d="'+d+'" stroke="'+kleur+'" stroke-width="2.4" fill="'+kleur+'" stroke-linejoin="round"/>' : '';
  return L.divIcon({className:"",iconSize:[g,g],iconAnchor:[c,c],
    html:'<div style="width:'+g+'px;height:'+g+'px;filter:drop-shadow(0 0 2px #000) drop-shadow(0 0 3px #000)">'
      +'<svg width="'+g+'" height="'+g+'" viewBox="0 0 '+g+' '+g+'" style="transform:rotate('+w.uit+'deg)">'
      +staaf+veren+stil+'</svg></div>'});
}

/* De routelijn zelf inkleuren naar zeilbaarheid: rood waar de wind pal tegen staat en je
 * moet kruisen, groen waar je gewoon loopt. Dat is wat je van een afstand ziet - de veren
 * geven het detail, de kleur geeft het verhaal. */
/* Punt op afstand d langs het pad. */
function puntOpAfstand(path, d){
  let acc=0;
  for(let i=0;i<path.length-1;i++){
    const seg=haversine(path[i][0],path[i][1],path[i+1][0],path[i+1][1])||1e-9;
    if(acc+seg>=d){ const f=(d-acc)/seg;
      return [path[i][0]+(path[i+1][0]-path[i][0])*f, path[i][1]+(path[i+1][1]-path[i][1])*f]; }
    acc+=seg;
  }
  return path[path.length-1];
}

/* De routelijn inkleuren naar zeilbaarheid: rood waar de wind pal tegen staat en je moet
 * kruisen, groen waar je gewoon loopt. Dat is wat je van een afstand ziet - de veren geven
 * het detail, de kleur geeft het verhaal.
 *
 * LET OP: dit volgt het PAD, niet de rechte lijn tussen twee meetpunten. Die kortsluiting
 * had ik er eerst in zitten en dan snijdt de gekleurde band bochten af - bij een route met
 * een lus liep hij dwars over land. Een lijn die niet op de route ligt is erger dan geen
 * lijn, want je leest hem als de route. */
/* De band moet de route begeleiden, niet overschreeuwen. Dikte hangt aan het zoomniveau
 * en niet aan de leesafstand-instelling: uitgezoomd een dunne draad, ingezoomd een band. */
function windBandDikte(){
  return Math.max(2, Math.min(7, (map.getZoom()-8)*1.1));
}

function drawWindRoute(trajecten){
  const path=livePath();
  if(path.length<2 || trajecten.length<2) return;
  // cumulatieve afstand per pad-hoekpunt, zodat we tussenliggende hoekpunten kunnen meenemen
  const cum=[0];
  for(let i=0;i<path.length-1;i++)
    cum.push(cum[i]+(haversine(path[i][0],path[i][1],path[i+1][0],path[i+1][1])||1e-9));

  for(let k=0;k<trajecten.length-1;k++){
    const a=trajecten[k], b=trajecten[k+1];
    if(!a.w) continue;
    const van=a.pt.afst, tot=b.pt.afst;
    const stuk=[puntOpAfstand(path,van)];
    for(let i=0;i<path.length;i++) if(cum[i]>van && cum[i]<tot) stuk.push(path[i]);
    stuk.push(puntOpAfstand(path,tot));
    L.polyline(stuk,{color:(a.hoek?a.hoek.kleur:"#bfeeff"), weight:windBandDikte(), opacity:.5,
      lineCap:"round", lineJoin:"round", interactive:false}).addTo(windLayer);
  }
}

/* Welke veren tekenen we? Alle punten waarvan de vorige getekende veer ver genoeg weg
 * staat op het SCHERM. Eerste en laatste altijd. Zo zit de dichtheid vast aan wat je ziet
 * en niet aan hoe lang de route is. */
function windZichtbaar(tr){
  const met=tr.filter(t=>t.w);
  if(met.length<3) return met;
  const uit=[met[0]];
  let vorig=map.latLngToContainerPoint([met[0].pt.lat, met[0].pt.lon]);
  for(let i=1;i<met.length-1;i++){
    const px=map.latLngToContainerPoint([met[i].pt.lat, met[i].pt.lon]);
    if(px.distanceTo(vorig)>=WIND_MIN_PX){ uit.push(met[i]); vorig=px; }
  }
  // Het eindpunt hoort erbij - daar kom je aan. Ligt het te dicht op de vorige veer, dan
  // VERVANGT het die in plaats van ernaast te komen staan; anders raken de iconen elkaar.
  const laatste=met[met.length-1];
  const pxL=map.latLngToContainerPoint([laatste.pt.lat, laatste.pt.lon]);
  if(pxL.distanceTo(vorig)>=WIND_MIN_PX || uit.length===1) uit.push(laatste);
  else uit[uit.length-1]=laatste;
  return uit;
}

function drawWind(){
  if(!map||!windLayer) return;
  windLayer.clearLayers();
  updateWindBadge();
  if(!S.wind || !wind.data) return;
  drawWindRoute(windTrajecten());    // de band gebruikt ALLE meetpunten: fijne kleurovergang
  for(const t of windZichtbaar(windHaken())){  // de veren tussen de tijd-bolletjes
    L.marker([t.pt.lat,t.pt.lon],{icon:windVeerIcon(t.w,t.hoek),zIndexOffset:120})
      .bindPopup(windPopup(t)).addTo(windLayer);
    // Alleen het getal, klein en onder de veer. De richting zit al in de veer; een vol
    // tekstlabel per punt maakte er tussen de boeisymbolen een onleesbare brij van.
    windGetal(t.pt.lat, t.pt.lon, fmtKn(t.w.kn), "#ffffff");
  }
}

function windGetal(lat,lon,tekst,kleur){
  const w=sc(54);
  L.marker([lat,lon],{interactive:false,zIndexOffset:110,
    icon:L.divIcon({className:"",iconSize:[w,sc(14)],iconAnchor:[w/2,sc(-16)],
      html:'<div style="width:'+w+'px;text-align:center;color:'+kleur+';font-weight:800;font-size:'+sc(12)+'px;'
        +'text-shadow:0 0 3px #000,0 0 3px #000,0 0 4px #000">'+escapeHtml(tekst)+'</div>'})}).addTo(windLayer);
}

function windTijd(t){
  const d=new Date(t), nu=new Date();
  const zelfdeDag = d.toDateString()===nu.toDateString();
  const uur = String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0");
  if(zelfdeDag) return uur;
  return ["zo","ma","di","wo","do","vr","za"][d.getDay()]+" "+uur;
}

function windPopup(t){
  const w=t.w;
  const vlaag = w.vlaag!=null ? "<br>\u{1F4A8} vlagen tot "+fmtKn(w.vlaag)+" kn" : "";
  const hoek = t.hoek
    ? "<br>⛵ <b>"+t.hoek.naam+"</b> ("+Math.round(t.hoek.hoek)+"° van je koers "+Math.round(t.koers)+"°)"
      + (t.hoek.kruisen?"<br>⚠️ Kruisen of motoren":"")
    : "";
  return "<b>"+windTijd(t.tijd)+"</b> · "+fmtDist(t.pt.afst)+" op de route"
    + "<br>\u{1F32C} "+fmtKn(w.kn)+" kn uit "+compass(w.uit)+" ("+Math.round(w.uit)+"°)"
    + vlaag + hoek
    + "<br><small>"+escapeHtml(w.model)+" via Open-Meteo · verwachting, geen meting.</small>";
}

function updateWindBadge(){
  const el=$("windBadge"); if(!el) return;
  if(!S.wind || !route.length){ el.style.display="none"; return; }
  el.style.display="block";
  if(wind.bezig){ el.textContent="Wind ophalen…"; return; }
  if(wind.fout){ el.textContent="Wind niet beschikbaar: "+wind.fout; return; }
  const tr=windTrajecten().filter(t=>t.w);
  if(!tr.length){ el.textContent="Geen windverwachting voor deze tijd"; return; }
  const kn=tr.map(t=>t.w.kn);
  const tegen=tr.filter(t=>t.hoek&&t.hoek.kruisen).length;
  const vertrek = wind.vertrekU===0 ? "nu" : windTijd(windVertrek());
  el.textContent = "\u{1F32C} Vertrek "+vertrek+" · "+fmtKn(Math.min(...kn))+"–"+fmtKn(Math.max(...kn))+" kn"
    + (tegen ? " · ⚠ "+tegen+"× pal tegen" : "")
    + " · tik voor details";
}

/* Het venster met de vertrektijdschuif. Daar zit de eigenlijke waarde van zeven dagen
 * vooruit: niet "hoe waait het deze week" maar "welke dag is deze route te zeilen". */
function openWindPaneel(){
  openModal(windPaneelHtml());
  bindWindPaneel();
}
function windPaneelHtml(){
  return '<h3>\u{1F32C} Wind op je route</h3>'
    + '<p style="color:var(--muted);font-size:13px">Per meetpunt de verwachting voor het moment dat je er '
    + '<b>volgens de planning bent</b>, niet voor nu. Schuif de vertrektijd om te zien welke dag deze route zich laat zeilen.</p>'
    + '<div style="display:flex;align-items:center;gap:10px;margin:10px 0 4px">'
    + '<span style="font-size:13px;color:var(--muted)">Vertrek</span>'
    + '<input type="range" id="windVertrekRange" min="0" max="144" step="1" value="'+wind.vertrekU+'" style="flex:1">'
    + '<b id="windVertrekVal" style="min-width:86px;text-align:right">'+escapeHtml(wind.vertrekU?windTijd(windVertrek()):"nu")+'</b></div>'
    + '<div id="windPaneelBody">'+windPaneelBody()+'</div>'
    + '<button class="ok" onclick="closeModal()">Sluiten</button>';
}

/* Alles wat met de vertrektijd meebeweegt staat hier bij elkaar - inclusief de modelregel.
 * Ververste eerder alleen de tabel, waardoor er "KNMI Harmonie" onder een tabel bleef
 * staan die allang uit ECMWF kwam. Provenance die niet meeschuift is erger dan geen
 * provenance, want je gelooft hem. */
function windPaneelBody(){
  const tr=windTrajecten();
  const metWind=tr.filter(t=>t.w);
  if(!metWind.length){
    return '<p style="color:#ffce6b">Geen verwachting voor dit tijdstip. De voorspelling reikt zeven dagen '
         + 'vooruit; schuif de vertrektijd terug.</p>';
  }
  const rijen = metWind.map(t=>{
    const h=t.hoek;
    const vl = (t.w.vlaag!=null && t.w.vlaag>t.w.kn+4)
      ? ' <span style="color:#ffce6b">↑'+fmtKn(t.w.vlaag)+'</span>' : '';
    return '<tr>'
      + '<td style="padding:5px 8px;white-space:nowrap">'+escapeHtml(windTijd(t.tijd))+'</td>'
      + '<td style="padding:5px 8px;color:var(--muted);white-space:nowrap">'+escapeHtml(fmtDist(t.pt.afst))+'</td>'
      + '<td style="padding:5px 8px;white-space:nowrap"><b>'+fmtKn(t.w.kn)+'</b> kn '+escapeHtml(compass(t.w.uit))+vl+'</td>'
      + '<td style="padding:5px 8px;color:'+(h?h.kleur:"#bfeeff")+';font-weight:700;white-space:nowrap">'
      + escapeHtml(h?h.naam:"–")+'</td></tr>';
  }).join("");
  const modellen=[...new Set(metWind.map(t=>t.w.model))];
  const tegen=tr.filter(t=>t.hoek&&t.hoek.kruisen).length;
  const waarschuwing = tegen
    ? '<p style="color:#ff9d9d;margin:8px 0"><b>⚠️ '+tegen+' van de '+metWind.length+' meetpunten hebben de wind '
      + 'pal op de neus.</b> Daar moet je kruisen of de motor aan — reken op meer tijd dan de routeplanner aangeeft.</p>'
    : '';
  const hard = metWind.filter(t=>t.w.vlaag!=null && t.w.vlaag>=25).length;
  const vlagen = hard
    ? '<p style="color:#ffce6b;margin:8px 0"><b>\u{1F4A8} Vlagen tot boven de 25 knopen</b> op '+hard+' meetpunt'
      + (hard>1?'en':'')+'.</p>'
    : '';
  const legenda = '<div style="display:flex;flex-wrap:wrap;gap:10px;margin:10px 0 4px;font-size:12px">'
    + WIND_HOEKEN.map(k=>'<span style="display:flex;align-items:center;gap:5px">'
        + '<span style="width:16px;height:5px;border-radius:3px;background:'+k.kleur+';display:inline-block"></span>'
        + escapeHtml(k.naam)+'</span>').join('')
    + '</div>';
  return waarschuwing + vlagen + legenda
    + '<div style="max-height:42vh;overflow:auto;margin-top:8px">'
    + '<table style="width:100%;border-collapse:collapse;font-size:13px"><tbody>'+rijen+'</tbody></table></div>'
    + '<p style="color:var(--muted);font-size:12px;margin-top:10px">Bron: Open-Meteo — '
    + escapeHtml(modellen.join(" en ")) + '. Het KNMI-model van 2 km reikt ongeveer 2,5 dag vooruit; daarna komt '
    + 'de verwachting uit een globaal model dat grover is. <b>Dit is een verwachting, geen meting</b>, en geldt voor '
    + '10 m boven open water — in de luwte van een dijk of tussen de kribben waait het anders.</p>';
}

function bindWindPaneel(){
  const el=$("windVertrekRange"); if(!el) return;
  el.addEventListener("input",()=>{
    wind.vertrekU=+el.value;
    const lab=$("windVertrekVal"); if(lab) lab.textContent = wind.vertrekU ? windTijd(windVertrek()) : "nu";
    const body=$("windPaneelBody"); if(body) body.innerHTML=windPaneelBody();
    drawWind();
  });
}

function drawNationalVhf(){
  if(!map||!nationalVhfLayer) return;
  nationalVhfLayer.clearLayers();
  if(!S.vhfPoints || typeof RWS_VHF_POINTS==="undefined") return;
  const zoom=map.getZoom(), bounds=map.getBounds().pad(.15);
  if(typeof RWS_VTS_CENTRES!=="undefined") for(const p of RWS_VTS_CENTRES){
    if(!bounds.contains([p.lat,p.lon])) continue;
    const channels=p.channel?`<br>📻 Sector${p.channels.length===1?"":"en"}: <b>${escapeHtml(p.channel)}</b>`:"<br>Kanalen verschillen per sector";
    const phone=p.phone?`<br>☎ ${escapeHtml(p.phone)}`:"";
    L.marker([p.lat,p.lon],{icon:nationalVtsCentreIcon(p),zIndexOffset:100})
      .bindPopup(`<b>${escapeHtml(p.name)}</b><br>Verkeerscentrale${p.city?" · "+escapeHtml(p.city):""}${channels}${phone}<br><small>Bron: Rijkswaterstaat FIS/VNDS</small>`)
      .addTo(nationalVhfLayer);
  }
  for(const p of advicePoints()){
    if(!String(p.id||"").startsWith("rws-") || !bounds.contains([p.lat,p.lon])) continue;
    if(p.type!=="vts" && zoom<10) continue;
    const kind=p.type==="sluis"?"Sluis":(p.type==="vts"?"VTS-meldpunt":"Brug");
    const status=p.status==="mandatory"?"<br><b>Meldplicht</b>":(p.status==="recommended"?"<br>Aanmelden aanbevolen":"");
    const note=p.note?"<br>"+escapeHtml(p.note):"";
    L.marker([p.lat,p.lon],{icon:nationalVhfIcon(p)})
      .bindPopup(`<b>${escapeHtml(p.name)}</b><br>${kind}<br>📻 Kanaal <b>${escapeHtml(String(p.channel))}</b>${status}${note}<br><small>Bron: Rijkswaterstaat FIS/VNDS</small>`)
      .addTo(nationalVhfLayer);
  }
}
/* Landelijke, zichtbare diepte-informatie uit dezelfde RWS FIS/VNDS-bron als
 * "Vaarwegen in Nederland". De cijferlabels zijn bewust geen berekende waterdieptes:
 * vaarwegdiepte is een bodemniveau/-bereik t.o.v. NAP, KP, MP enz.; D≤ is de apart
 * gepubliceerde maximaal toegestane diepgang. */
function fairwayCoords(flat){
  const out=new Array(flat.length/2);
  for(let i=0,k=0;i<flat.length;i+=2,k++) out[k]=[flat[i+1],flat[i]];
  return out;
}
function signedDepth(v){
  const n=fmtNum(Math.abs(v),Math.abs(v)%1?1:0);
  return (v<0?"−":v>0?"+":"")+n;
}
function fairwayDepthText(p){
  const range=Math.abs(p.lo-p.hi)<0.005?signedDepth(p.lo):signedDepth(p.lo)+"…"+signedDepth(p.hi);
  return range+" "+p.ref;
}
function fairwayDepthPopup(p,kind){
  const km=p.km&&p.km.length===2?`<br>Km ${fmtNum(p.km[0],3)}–${fmtNum(p.km[1],3)}`:"";
  const source=`<br><small>Bron: Rijkswaterstaat FIS/VNDS · ${escapeHtml(RWS_FAIRWAY_DEPTH_META.retrieved)}. Controleer actuele vaarweginformatie.</small>`;
  if(kind==="draft"){
    const note=p.note?`<br>${escapeHtml(p.note)}`:"";
    return `<b>${escapeHtml(p.route||"Vaarweg")}</b><br>Maximaal toegestane diepgang: <b>${fmtNum(p.draft,2)} m</b>${km}${note}${source}`;
  }
  return `<b>${escapeHtml(p.route||"Vaarweg")}</b><br>Gepubliceerd vaarwegdiepte-/bodembereik: <b>${escapeHtml(fairwayDepthText(p))}</b>${km}<br><small>Dit zijn niveaus t.o.v. het vermelde referentievlak, geen live waterdiepte.</small>${source}`;
}
function drawFairwayDepths(){
  if(!map||!fairwayDepthLayer) return;
  fairwayDepthLayer.clearLayers();
  if(!S.overlays?.depth || typeof RWS_FAIRWAY_DEPTHS==="undefined" || typeof RWS_MAX_DRAFTS==="undefined") return;
  const zoom=map.getZoom();
  if(zoom<8) return;
  const bounds=map.getBounds().pad(.12), centre=map.getCenter(), occupied=new Set();
  const phone=innerWidth<600;
  const labelLimit={draft:phone?16:42,level:phone?9:24}, labelCount={draft:0,level:0};
  function addFeature(p,kind,showLabel){
    const coords=fairwayCoords(p.line), visible=coords.filter(ll=>bounds.contains(ll));
    if(!visible.length) return;
    const popup=fairwayDepthPopup(p,kind);
    L.polyline(coords,kind==="draft"
      ?{color:"#ffb84d",weight:sc(3),opacity:.9,dashArray:"7 5"}
      :{color:"#00d0ff",weight:sc(3),opacity:.82})
      .bindPopup(popup).addTo(fairwayDepthLayer);
    if(!showLabel || labelCount[kind]>=labelLimit[kind]) return;
    let at=visible[0], best=Infinity;
    for(const ll of visible){ const d=(ll[0]-centre.lat)**2+(ll[1]-centre.lng)**2; if(d<best){best=d;at=ll;} }
    const pixel=map.latLngToContainerPoint(at), cellX=phone?138:Math.max(sc(96),88), cellY=phone?58:sc(46);
    const key=Math.floor(pixel.x/cellX)+","+Math.floor(pixel.y/cellY);
    if(occupied.has(key)) return;
    occupied.add(key);
    labelCount[kind]++;
    const text=kind==="draft"?"D≤"+fmtNum(p.draft,1)+" m":fairwayDepthText(p);
    L.marker(at,{zIndexOffset:kind==="draft"?420:400,icon:L.divIcon({className:"depth-label-wrap",iconSize:null,html:`<span class="depth-map-label ${kind}">${escapeHtml(text)}</span>`})})
      .bindPopup(popup).addTo(fairwayDepthLayer);
  }
  // Toegestane diepgang is voor de schipper het meest direct bruikbaar en krijgt voorrang
  // bij labelbotsingen. Het onderliggende FIS-bodembereik verschijnt vanaf zoom 10.
  for(const p of RWS_MAX_DRAFTS) addFeature(p,"draft",true);
  if(zoom>=10) for(const p of RWS_FAIRWAY_DEPTHS) addFeature(p,"level",true);
}
function escapeHtml(s){ return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]); }
function knrmIcon(){ const s=sc(20);
  return L.divIcon({className:"",iconSize:[s,s],iconAnchor:[s/2,s/2],
    html:`<div style="width:${s}px;height:${s}px;border-radius:4px;background:#e23b3b;border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:${sc(11)}px">🚨</div>`}); }
function boatIcon(deg){ const s=sc(34), w=sc(9), h=sc(26);
  return L.divIcon({className:"",iconSize:[s,s],iconAnchor:[s/2,s/2],
    html:`<div style="transform:rotate(${deg}deg);transition:transform .3s"><div style="width:0;height:0;border-left:${w}px solid transparent;border-right:${w}px solid transparent;border-bottom:${h}px solid #ff4d4d;margin:auto;filter:drop-shadow(0 0 3px rgba(0,0,0,.8))"></div></div>`}); }
/* Leesafstand gewijzigd → bestaande markers opnieuw van een icoon voorzien */
function restyleMarkers(){
  if(!map) return;
  readMui();
  pointMarkers.forEach(({m,p})=>m.setIcon(pinIcon(p)));
  drawNationalVhf();
  drawFairwayDepths();
  if(boat && map.hasLayer(boat)) boat.setIcon(boatIcon(pos?(deriveCourse().course||0):0));
  drawRouteMarkers();
  drawPrediction();
}
function updateBoat(info){
  if(!map||!pos) return;
  if(!map.hasLayer(boat)) boat.addTo(map);
  boat.setLatLng([pos.lat,pos.lon]); boat.setIcon(boatIcon(info&&info.course!=null?info.course:0));
  drawPrediction();
}

/* ---------------- Vooruitblik (schaal- & snelheidsafhankelijk) ---------------- */
function predParams(){
  // snelheid: werkelijke (afgevlakte) SOG; planningssnelheid alleen bij stilliggen/geen GPS-snelheid
  let usingPlan = !(smoothSpeed!=null && smoothSpeed>0.3);
  let v = usingPlan ? S.planSpeed/1.94384 : smoothSpeed;    // m/s
  // zichtbare kaart-omvang (halve diagonaal ≈ straal van het beeld)
  const b=map.getBounds();
  let viewM = haversine(b.getSouth(),b.getWest(),b.getNorth(),b.getEast())/2;
  viewM = Math.max(300, Math.min(120000, viewM));           // veilige grenzen
  // mik op ~6 markeringen over het beeld → afstand per stap
  const targetSpacing = viewM/6;
  const NICE=[5,10,15,20,30,60];                            // max 60 min per bolletje
  const rawMin = targetSpacing / v / 60;
  const interval = NICE.find(n=>n>=rawMin) || 60;           // minuten per bolletje
  const horizonMin = Math.min(240, Math.max(interval*2, viewM/v/60)); // tot max 4 uur
  const count = Math.max(2, Math.min(12, Math.round(horizonMin/interval)));
  return { v, interval, count, usingPlan };
}
function fmtMin(m){ m=Math.round(m); if(m<60) return m+"m"; return (m%60===0)?(m/60)+"u":Math.floor(m/60)+"u"+(m%60); }
function fmtKn(n){ return fmtNum(n,1).replace(",0",""); }
function timeDot(lat,lon,min,color){
  L.circleMarker([lat,lon],{radius:sc(6),color:color||"#00d0ff",weight:2,fillColor:"#001a22",fillOpacity:.95,interactive:false}).addTo(predLayer);
  L.marker([lat,lon],{interactive:false,icon:L.divIcon({className:"",iconSize:[sc(46),sc(16)],iconAnchor:[-sc(8),sc(8)],
    html:`<span style="color:${color?"#ffd98a":"#bfeeff"};font-weight:800;font-size:${sc(12)}px;text-shadow:0 0 3px #000,0 0 3px #000,0 0 3px #000">${fmtMin(min)}</span>`})}).addTo(predLayer);
}

/* ---- Sluizen & bruggen op de route ----
 * Loodrechte afstand van elk object tot de routelijn; ligt het binnen de meldradius
 * van dat object, dan vaar je er doorheen.
 *
 * Een sluis kost altijd tijd (schutten). Bij een brug hangt het af van je hoogte:
 * past je boot + marge onder de doorvaarthoogte in gesloten toestand, dan vaar je
 * er zó onderdoor en kost het niets. Bij twijfel — hoogte onbekend, of jouw hoogte
 * niet ingesteld — rekenen we mét openen. Dat maakt de ETA hooguit te pessimistisch.
 * Een VASTE brug waar je niet onder past is geen vertraging maar een blokkade. */
function passageInfo(p){
  if(p.type!=="brug") return { wait:true, why:"schutten" };
  if(S.airDraft==null) return { wait:true, why:"hoogte niet ingesteld" };
  if(p.clearance==null) return { wait:true, why:"doorvaarthoogte onbekend" };
  if(S.airDraft + AIR_MARGIN <= p.clearance) return { wait:false, why:"past eronder door" };
  if(p.opens===false) return { wait:false, why:"vaste brug — past niet", blocked:true };
  return { wait:true, why:"moet open" };
}
function segDist(plat,plon,la1,lo1,la2,lo2){
  const cosLat=Math.cos(rad((la1+la2)/2));
  const x2=(lo2-lo1)*111320*cosLat, y2=(la2-la1)*111320;
  const px=(plon-lo1)*111320*cosLat, py=(plat-la1)*111320;
  const L2=x2*x2+y2*y2;
  let t = L2>0 ? (px*x2+py*y2)/L2 : 0;
  t=Math.max(0,Math.min(1,t));
  const dx=px-t*x2, dy=py-t*y2;
  return { d:Math.sqrt(dx*dx+dy*dy), t };
}
/* Obstakellijst = geverifieerde POINTS (met kanaal) + de gegenereerde OBSTACLES uit
 * OpenStreetMap (zonder kanaal). De OSM-laag voedt alléén de routeplanning; het
 * kanaaladvies in computeAdvice() blijft uitsluitend op POINTS draaien. */
let ALL_OBSTACLES=[];
function buildObstacleList(){
  const list = POINTS.map(p=>({ name:p.name, type:p.type, lat:p.lat, lon:p.lon,
    clearance: p.clearance===undefined?null:p.clearance, opens: p.opens!==false,
    channel:p.channel, radius:p.radius, src:"verified" }));
  if(typeof OBSTACLES!=="undefined" && Array.isArray(OBSTACLES)){
    for(const o of OBSTACLES){
      // binnen 250 m van een geverifieerd object → hetzelfde object, geverifieerde versie wint
      if(list.some(p=>p.src==="verified" && haversine(p.lat,p.lon,o.lat,o.lon)<250)) continue;
      list.push({ name:o.n, type:o.t, lat:o.lat, lon:o.lon, clearance:o.c,
        opens:o.o!==false, channel:null, radius:300, src:o.s });
    }
  }
  ALL_OBSTACLES=list;
  return list;
}
function routeObstacles(pts){
  const out=[];
  for(const p of ALL_OBSTACLES){
    let best=null, acc=0;
    for(let i=0;i<pts.length-1;i++){
      const la1=pts[i][0],lo1=pts[i][1],la2=pts[i+1][0],lo2=pts[i+1][1];
      const segLen=haversine(la1,lo1,la2,lo2);
      const r=segDist(p.lat,p.lon,la1,lo1,la2,lo2);
      if(!best || r.d<best.d) best={ d:r.d, along:acc+segLen*r.t };
      acc+=segLen;
    }
    if(best && best.d<=p.radius) out.push({ point:p, along:best.along, off:best.d, pass:passageInfo(p) });
  }
  return out.sort((a,b)=>a.along-b.along);
}
function waitBefore(distM, obst){ return obst ? obst.filter(o=>o.along<=distM && o.pass.wait).length*S.lockDelay : 0; }

function projectAlongPath(pts, stepM, v, maxDots, obst){
  let acc=0, next=stepM, k=1;
  for(let i=0;i<pts.length-1 && k<=maxDots;i++){
    const la1=pts[i][0],lo1=pts[i][1],la2=pts[i+1][0],lo2=pts[i+1][1];
    const segLen=haversine(la1,lo1,la2,lo2)||1e-9;
    while(acc+segLen>=next && k<=maxDots){
      const f=(next-acc)/segLen, wait=waitBefore(next,obst);
      // label = vaartijd tot hier + opgelopen wachttijd van eerder gepasseerde objecten
      timeDot(la1+(la2-la1)*f, lo1+(lo2-lo1)*f, next/v/60 + wait, wait?"#ffce6b":null);
      k++; next+=stepM;
    }
    acc+=segLen;
  }
}
function pathLength(pts){ let t=0; for(let i=0;i<pts.length-1;i++) t+=haversine(pts[i][0],pts[i][1],pts[i+1][0],pts[i+1][1]); return t; }
function fmtDur(min){ min=Math.round(min); const h=Math.floor(min/60),m=min%60; return h ? (h+"u"+(m<10?"0":"")+m) : (m+" min"); }
function mapLabel(lat,lon,text,color,dy){
  const w=sc(130);
  L.marker([lat,lon],{interactive:false,icon:L.divIcon({className:"",iconSize:[w,sc(16)],iconAnchor:[w/2,sc(8+(dy||0))],
    html:`<div style="width:${w}px;text-align:center;color:${color||"#bfeeff"};font-weight:800;font-size:${sc(12)}px;text-shadow:0 0 3px #000,0 0 3px #000,0 0 3px #000">${text}</div>`})}).addTo(predLayer);
}
function drawPrediction(){
  if(!map||!predLayer) return;
  if(draggingWp) return;   // tijdens het slepen doet de lichte voorbeeldlijn het werk
  readMui();
  predLayer.clearLayers();
  if(!pos){ updatePredBadge(null); return; }
  const P=predParams();
  const stepM=P.v*P.interval*60;

  // Afstandsringen vanaf de boot — fel en met labels
  if(S.predRings){
    for(let k=1;k<=P.count;k++){
      const rM=stepM*k;
      L.circle([pos.lat,pos.lon],{radius:rM,color:"#00e5ff",weight:2,opacity:.9,fill:false,dashArray:"7 6",interactive:false}).addTo(predLayer);
      mapLabel(pos.lat + rM/111320, pos.lon, fmtMin(P.interval*k));   // label bovenaan de ring
    }
  }

  // Pad bepalen: de getekende route, anders een projectie langs de huidige koers
  let path=null, isRoute=false;
  if(route.length){
    path=[[pos.lat,pos.lon],...route.map(p=>[p.lat,p.lon])];
    isRoute=true;
  } else if(S.predDots){
    const c=deriveCourse().course;
    if(c!=null){
      const cosLat=Math.cos(rad(pos.lat)), d=stepM*P.count*1.001;   // marge zodat het laatste bolletje meetelt
      path=[[pos.lat,pos.lon],[pos.lat + d*Math.cos(rad(c))/111320, pos.lon + d*Math.sin(rad(c))/(111320*cosLat)]];
    }
  }
  if(!path){ updatePredBadge(P, null); return; }

  const obst = S.lockDelay>0 ? routeObstacles(path) : [];

  if(isRoute){
    L.polyline(path,{color:"#ffce6b",weight:3,dashArray:"9 6",interactive:false}).addTo(predLayer);
  }
  // De Tijd-knop zet de bolletjes uit in BEIDE gevallen. Deed hij dat alleen langs de
  // koers, dan leek hij kapot zodra je een route had getekend.
  if(S.predDots) projectAlongPath(path, stepM, P.v, isRoute?80:P.count, obst);

  // Sluizen/bruggen onderweg markeren — met wachttijd, of juist met de reden dat je zó doorvaart
  obst.forEach(o=>{
    const ico=o.point.type==="sluis"?"⚓":"🌉";
    const col = o.pass.blocked ? "#ff8f8f" : (o.pass.wait ? "#ffce6b" : "#7bf57b");
    // Onzekere hoogte krijgt een expliciete "?" — we rekenen dan mét openen, maar zeg erbij dat we het niet zeker weten
    const onzeker = o.pass.why==="doorvaarthoogte onbekend" || o.pass.why==="hoogte niet ingesteld";
    const kan = o.point.channel!=null ? " · k"+o.point.channel : "";   // OSM-objecten hebben geen kanaal
    const txt = o.pass.blocked ? ("⛔ "+fmtNum(o.point.clearance,1)+" m — past niet")
              : !o.pass.wait  ? (ico+" vrij · "+fmtNum(o.point.clearance,1)+" m")
              : onzeker       ? (ico+" +"+S.lockDelay+"m · hoogte ?"+kan)
              :                 (ico+" +"+S.lockDelay+"m"+kan);
    L.circleMarker([o.point.lat,o.point.lon],{radius:sc(8),color:col,weight:3,fillColor:"#20200a",fillOpacity:.95,interactive:false}).addTo(predLayer);
    mapLabel(o.point.lat,o.point.lon,txt,col,28);   // 28px: vrij van de 26px kanaalpin
  });

  if(S.wind && isRoute) haalWind();
  const len=pathLength(path), sail=len/P.v/60;
  const stops=obst.filter(o=>o.pass.wait), blocked=obst.filter(o=>o.pass.blocked);
  const onzeker=stops.filter(o=>o.pass.why==="doorvaarthoogte onbekend"||o.pass.why==="hoogte niet ingesteld");
  const wait=stops.length*S.lockDelay;
  if(isRoute){
    const end=path[path.length-1];
    mapLabel(end[0],end[1],"⚑ "+fmtDur(sail+wait),"#ffd98a");
    updatePredBadge(P, {len, sail, wait, stops:stops.length, blocked:blocked.length, onzeker:onzeker.length});
    // Alleen melden als de set blokkades wijzigt — drawPrediction draait bij elke fix en kaartbeweging
    const bKey=blocked.map(o=>o.point.id).join(",");
    if(bKey!==lastBlockedKey){
      lastBlockedKey=bKey;
      if(blocked.length) showToast("⛔","Past er niet onder",
        blocked.map(o=>o.point.name+" ("+fmtNum(o.point.clearance,1)+" m)").join(", ")+
        " — vaste brug, die gaat niet open. Jouw hoogte "+fmtNum(S.airDraft,1)+" m + "+fmtNum(AIR_MARGIN,1)+" m marge.",{warn:true});
    }
  } else updatePredBadge(P, null);
}
function updatePredBadge(P, rt){
  const el=$("predBadge"); if(!el) return;
  if(!P){ el.style.display="none"; el.textContent=""; return; }
  el.style.display="block";
  const spd = P.usingPlan ? (fmtKn(S.planSpeed)+" kn (plan)") : (fmtKn(P.v*1.94384)+" kn (live)");
  // staan de bolletjes uit, dan zegt "elke 10m" niets meer
  const ivl = S.predDots ? (" · elke "+fmtMin(P.interval)) : "";
  if(rt){
    const stops = rt.stops ? " · incl. "+rt.stops+"× "+(rt.stops===1?"sluis/brug":"sluizen/bruggen")+" +"+fmtDur(rt.wait) : "";
    const blok  = rt.blocked ? " · ⛔ "+rt.blocked+"× te laag" : "";
    const onz   = rt.onzeker ? " · ⚠ "+rt.onzeker+"× hoogte onzeker" : "";
    el.textContent = "Route "+fmtDist(rt.len)+" · "+fmtDur(rt.sail+rt.wait)+" @ "+spd+stops+blok+onz+ivl;
  }
  else if(!S.predDots && !S.predRings){ el.style.display="none"; el.textContent=""; }
  else el.textContent = "elke "+fmtMin(P.interval)+" · tot "+fmtMin(P.interval*P.count)+(P.usingPlan?(" · plan "+fmtKn(S.planSpeed)+" kn"):"");
}
/* ---- Routepunten bewerken ----
 * Slepen om te verplaatsen, tikken voor een menuutje met verwijderen of een punt
 * ertussen zetten. Werkt ook als de teken-modus uit staat, zodat je een bestaande
 * route kunt bijstellen zonder eerst een knop te zoeken. */
/* Routepunten schalen mee met het zoomniveau. Ver uitgezoomd zijn genummerde bollen
 * alleen maar in de weg — dan telt de routelijn, niet waar precies je knikpunten zitten.
 *   z >= 12  volle bol met nummer (goed aan te tikken en te slepen)
 *   z 10-11  klein stipje, geen nummer — je ziet wáár ze zitten, meer niet
 *   z < 10   helemaal weg; alleen de lijn blijft
 * Slepen kan zolang ze zichtbaar zijn. */
function wpDetail(){
  const z = map ? map.getZoom() : 12;
  if(z>=12) return "vol";
  if(z>=10) return "stip";
  return "verborgen";
}
function wpIcon(n, laatste, detail){
  if(detail==="stip"){
    const s=Math.max(14, sc(14));
    return L.divIcon({className:"",iconSize:[s,s],iconAnchor:[s/2,s/2],
      html:`<div style="width:${s}px;height:${s}px;border-radius:50%;background:${laatste?"#ffce6b":"#3a2b00"};
        border:2px solid #ffce6b;box-shadow:0 1px 3px rgba(0,0,0,.6);cursor:grab"></div>`});
  }
  const s=Math.max(30, sc(30));
  return L.divIcon({className:"",iconSize:[s,s],iconAnchor:[s/2,s/2],
    html:`<div style="width:${s}px;height:${s}px;border-radius:50%;background:${laatste?"#ffce6b":"#3a2b00"};
      border:3px solid #ffce6b;color:${laatste?"#3a2b00":"#ffce6b"};display:flex;align-items:center;
      justify-content:center;font-size:${Math.round(s*0.42)}px;font-weight:900;
      box-shadow:0 1px 5px rgba(0,0,0,.7);cursor:grab">${n}</div>`});
}
function removeWaypoint(i){
  if(i<0 || i>=route.length) return;
  route.splice(i,1);
  map.closePopup(); lastBlockedKey=null;
  drawRouteMarkers(); drawPrediction();
}
function insertWaypointAfter(i){
  // nieuw punt halverwege naar het volgende punt, of een stukje voorbij het laatste
  const a=route[i];
  const b=route[i+1] || (pos ? {lat:a.lat+(a.lat-pos.lat)*0.3, lon:a.lon+(a.lon-pos.lon)*0.3} : {lat:a.lat+0.01, lon:a.lon+0.01});
  route.splice(i+1,0,{lat:(a.lat+b.lat)/2, lon:(a.lon+b.lon)/2});
  map.closePopup(); lastBlockedKey=null;
  drawRouteMarkers(); drawPrediction();
}
/* Tijdens het slepen NIET de hele vooruitblik herbouwen. drawPrediction() gooit predLayer
 * leeg en zet er ~100 SVG-lagen voor terug; doe je dat per beeldframe, dan werkt Leaflets
 * renderer nog aan paden die net verwijderd zijn en krijg je "reading 'baseVal'"-fouten.
 * In plaats daarvan tonen we één lichte voorbeeldlijn die we met setLatLngs bijwerken —
 * geen DOM die verdwijnt, dus geen race — en rekenen we alles opnieuw bij het loslaten. */
let draggingWp=false, dragLine=null;
function livePath(){ return pos ? [[pos.lat,pos.lon],...route.map(p=>[p.lat,p.lon])] : route.map(p=>[p.lat,p.lon]); }
let dragWatchdog=null;
function endWpDrag(){
  clearTimeout(dragWatchdog); dragWatchdog=null;
  draggingWp=false;
  if(dragLine && routeLayer) routeLayer.removeLayer(dragLine);
  dragLine=null;
}
/* Nooit afhankelijk zijn van dragend alleen: blijft dat event weg (afgebroken sleep,
 * verdwenen pointer), dan zou de vooruitblik permanent bevroren blijven. Stopt de
 * beweging, dan ronden we na 400 ms sowieso af. */
function armDragWatchdog(){
  clearTimeout(dragWatchdog);
  dragWatchdog=setTimeout(()=>{ endWpDrag(); lastBlockedKey=null; drawPrediction(); }, 400);
}
function drawRouteMarkers(){
  if(!routeLayer) return;
  routeLayer.clearLayers();
  // vangnet: raakt een sleep onderbroken zonder dragend, dan zou draggingWp blijven staan
  // en werkt de vooruitblik nooit meer bij. Elke routewijziging zet de boel weer schoon.
  draggingWp=false; dragLine=null;
  const detail=wpDetail();
  if(detail==="verborgen") return;      // ver uitgezoomd: alleen de routelijn
  route.forEach((w,i)=>{
    const m=L.marker([w.lat,w.lon],{draggable:true,icon:wpIcon(i+1,i===route.length-1,detail),zIndexOffset:900}).addTo(routeLayer);
    m.on("dragstart",()=>{
      endWpDrag();                      // eventuele resten van een afgebroken sleep opruimen
      draggingWp=true;
      predLayer.clearLayers();          // zware laag rust tijdens het slepen
      dragLine=L.polyline(livePath(),{color:"#ffce6b",weight:3,dashArray:"9 6",interactive:false}).addTo(routeLayer);
    });
    m.on("drag",()=>{
      const ll=m.getLatLng(); route[i]={lat:ll.lat,lon:ll.lng};
      if(dragLine) dragLine.setLatLngs(livePath());
      armDragWatchdog();
    });
    m.on("dragend",()=>{
      endWpDrag();
      lastBlockedKey=null;
      drawPrediction();
    });
    m.bindPopup(
      `<div style="text-align:center;min-width:150px">
         <b>Routepunt ${i+1} van ${route.length}</b>
         <div style="font-size:12px;color:#9db4cf;margin:4px 0 8px">Sleep om te verplaatsen.</div>
         <button onclick="insertWaypointAfter(${i})" style="width:100%;margin-bottom:5px;padding:9px;border:0;border-radius:9px;background:#0f1f30;color:#bfeeff;font-weight:800">＋ Punt erna invoegen</button>
         <button onclick="removeWaypoint(${i})" style="width:100%;padding:9px;border:0;border-radius:9px;background:#c62828;color:#fff;font-weight:800">✕ Dit punt verwijderen</button>
       </div>`);
  });
}
function setRouteMode(on){
  routeMode=on;
  const b=$("tgRoute"); if(b) b.classList.toggle("on",on);
  if(map) map.getContainer().style.cursor = on?"crosshair":"";
  if(!on) return;
  if(!pos) hintNoPos();   // zonder positie is er geen beginpunt: zeg dat, teken niet stilletjes niets
  else showToast("✏️","Route tekenen","Tik op de kaart om punten toe te voegen. Punten kun je altijd verslepen, of aantikken om ze te verwijderen — ook als deze knop uit staat.",{});
}
function clearRoute(){ route=[]; setRouteMode(false); lastBlockedKey=null; wind.data=null; wind.sleutel=null;
  drawRouteMarkers(); drawPrediction(); drawWind(); }
function hintNoPos(){ showToast("📍","Nog geen positie","Start GPS of zet Simulatie aan (tik dan op de kaart), dan verschijnen de ringen/bolletjes vanaf je boot.",{}); }

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
  restyleMarkers();   // kaart-iconen en -labels volgen de leesafstand
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
let depthSources=[];
function depthStatusText(){
  if(!depthSources.length) return "Nog geen dieptedata geladen.";
  return depthSources.map(s=>s.label+": "+s.n.toLocaleString("nl-NL")+" "+(s.eenheid||"punten")).join(" · ");
}
function addDepthPoints(pts, meta, src, label){
  if(!pts.length) throw new Error("Geen dieptepunten gevonden");
  depth.points=depth.points.concat(pts);
  depth.meta=Object.assign({}, depth.meta, meta||{});
  depth.loaded=true; depth.status="loaded";
  depthSources.push({label, n:pts.length, src});
  buildDepthIndex();
  $("depthStatus").textContent=depthStatusText();
  if(pos) render();
}
/* GeoJSON: het formaat waarin je zelf officiële lodingen aanlevert. */
function applyDepthData(gj, src, label){
  if(gj.type!=="FeatureCollection"||!Array.isArray(gj.features)) throw new Error("Geen geldige GeoJSON FeatureCollection");
  const pts=gj.features.filter(f=>f.geometry?.type==="Point" && typeof f.properties?.depth==="number")
    .map(f=>({lon:f.geometry.coordinates[0],lat:f.geometry.coordinates[1],depth:f.properties.depth,src:src||"official"}));
  addDepthPoints(pts, gj.properties, src||"official", label||(gj.properties&&gj.properties.source)||"Eigen bestand");
}
/* flat3: [lon,lat,diepte, ...] — veel compacter dan GeoJSON, gebruikt voor de
 * gegenereerde modeldata (zie tools/build-depth.py). */
function applyFlatDepth(obj, src, label){
  const a=obj.data||[]; const pts=new Array(a.length/3);
  for(let i=0,k=0;i<a.length;i+=3,k++) pts[k]={lon:a[i],lat:a[i+1],depth:a[i+2],src:src||"model"};
  addDepthPoints(pts, obj, src||"model", label||obj.source||"Model");
}
async function loadDepthFile(file){
  try{
    const obj=JSON.parse(await file.text());
    if(obj.format==="flat3") applyFlatDepth(obj,"official",obj.source||"Eigen bestand");
    else applyDepthData(obj,"official");
  }catch(e){ $("depthStatus").textContent="Kon bestand niet laden: "+e.message; }
}
async function tryAutoDepth(){
  laadRwsIndex();   // tegelindex; de tegels zelf komen pas als je er vaart
  // officiële lodingen eerst, daarna het model — de volgorde bepaalt niets voor de
  // voorrang (die zit in nearestDepth), maar wel wat je als eerste in beeld krijgt
  try{
    const r=await fetch("depth/diepte.geojson",{cache:"force-cache"});
    if(r.ok) applyDepthData(await r.json(),"official","Waddenzee (ENC-lodingen)");
  }catch(e){}
  try{
    const r=await fetch("depth/ijsselmeergebied.json",{cache:"force-cache"});
    if(r.ok) applyFlatDepth(await r.json(),"model","IJsselmeergebied (EMODnet-model)");
  }catch(e){}
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
  <p><b>Bronnen &amp; licenties.</b></p>
  <ul style="font-size:13px">
    <li><b>Landelijke VHF-meldpunten</b> — Rijkswaterstaat FIS/VNDS: officiële brug-, sluis- en VTS-meldpunten met kanaal en meldstatus. Aanvullende IJsselmeer/Waddenzee-kanalen zijn handmatig dubbel gecontroleerd.</li>
    <li><b>Bruggen, sluizen &amp; doorvaarthoogtes</b> — © OpenStreetMap-bijdragers, licentie <a href="https://www.openstreetmap.org/copyright" style="color:#8fdcff">ODbL</a>. Een deel is in OSM overgenomen uit Rijkswaterstaat Vaarweginformatie.</li>
    <li><b>Dieptedata Waddenzee</b> — Inland ENC / S-57 zeekaarten (Rijkswaterstaat).</li>
    <li><b>Dieptedata IJsselmeergebied</b> — Rijkswaterstaat, bodemhoogte IJsselmeergebied (20 m, t.o.v. NAP), aangevuld met het EMODnet Bathymetry-model waar RWS geen loding heeft. Het meetjaar staat onder de kielspeling.</li>
    <li><b>Scheepvaart (AIS)</b> — API/Service tracks incorporated from EuRIS (eurisportal.eu). Posities van schepen die AIS uitzenden op de Europese binnenwateren.</li>
    <li><b>Windverwachting</b> — <a href="https://open-meteo.com" style="color:#8fdcff">Open-Meteo</a>, licentie CC-BY 4.0. Modellen: KNMI Harmonie AROME Nederland (2 km, ~2,5 dag vooruit) en ECMWF IFS voor de dagen daarna.</li>
    <li><b>Kaartmateriaal</b> — © OpenStreetMap-bijdragers · OpenSeaMap · Esri World Imagery.</li>
  </ul>
  <p style="color:#ffce6b;font-size:13px"><b>Over de wind op je route:</b> dat is een <b>verwachting, geen meting</b>, en hij geldt voor 10 m boven open water. In de luwte van een dijk, tussen hoge oevers of vlak onder de wal waait het anders — soms flink. De eerste ~2,5 dag komt uit het KNMI-model van 2 km; daarna uit een globaal model dat grover is, en onder de tabel staat welk van de twee je ziet. Hoe verder vooruit, hoe onzekerder: gebruik de zevendaagse vooruitblik om een dag te kiezen, niet om op te varen.</p>
  <p style="color:#ffce6b;font-size:13px"><b>Over de AIS-scheepvaart:</b> de schepen komen van <b>EuRIS</b> (eurisportal.eu). AIS toont uitsluitend schepen die zelf uitzenden — de meeste pleziervaart doet dat niet — en een positie is enkele minuten oud. Een leeg stuk kaart betekent dus niet dat er niets vaart. Gebruik het als aanvulling op uitkijken en op je marifoon, nooit als vervanging. EuRIS schermt de identiteit van vrijwel alle binnenvaartschepen af; afmetingen, koers en snelheid komen wel door, een scheepsnaam meestal niet.</p>
  <p style="color:#ffce6b;font-size:13px"><b>Over doorvaarthoogtes:</b> die gelden t.o.v. het streefpeil en wisselen met het waterpeil. Waar de app de hoogte niet kent, rekent hij altijd met een brugopening en zet er <i>hoogte ?</i> bij. Controleer altijd de Wateralmanak deel 2.</p>
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
  const nationalVts=typeof RWS_VTS_CENTRES!=="undefined" ? RWS_VTS_CENTRES.filter(v=>v.channel && !VTS.some(m=>m.name.toLowerCase()===v.name.toLowerCase())).map(v=>({name:v.name,sub:"Rijkswaterstaat FIS/VNDS"+(v.city?" · "+v.city:""),channel:v.channel})) : [];
  $("vtsList").innerHTML=VTS.concat(nationalVts).map(v=>rowHtml(v.name,v.sub,v.channel,false)).join("");
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
/* Het waterpeil is bewust GEEN "uit"-stand: zonder peil kan de app uit een bodemhoogte
 * geen diepte maken en zou de RWS-loding onbruikbaar zijn. Daarom een aanname als
 * startwaarde, met die aanname zichtbaar onder de kielspeling — niet weggemoffeld. */
function bindPeil(){
  const el=$("peilRange"), lab=$("peilVal");
  const show=()=>{ lab.textContent = (S.peilNAP>=0?"+":"")+fmtNum(S.peilNAP,2)+" m"; };
  el.value=S.peilNAP; show();
  el.addEventListener("input",()=>{ S.peilNAP=+el.value; show(); if(pos) render(); });
  el.addEventListener("change",()=>{ save(); if(pos) render(); });
}
/* Reductievlak kent net als de hoogte een "uit"-stand: zonder ingevuld getal doen we
 * geen getijcorrectie, want het verschil LAT–NAP raden we niet. Onder de laagste
 * schuifstand betekent het "uit". */
function bindChartDatum(){
  const el=$("chartDatumRange"), lab=$("chartDatumVal");
  const MIN=-2.5;
  const show=()=>{ lab.textContent = S.chartDatum==null ? "uit" : fmtNum(S.chartDatum,2)+" m"; };
  el.min=String(MIN-0.05);   // één stap onder het bereik = uit
  el.value = S.chartDatum==null ? (MIN-0.05) : S.chartDatum; show();
  el.addEventListener("input",()=>{ const v=+el.value; S.chartDatum = v<MIN ? null : v; show(); });
  el.addEventListener("change",()=>{ save(); if(pos) render(); });
}
/* Hoogte boven water kent een derde stand: "niet ingesteld". Zolang die geldt gaat de app
 * ervan uit dat elke brug open moet — we raden je hoogte niet. */
function bindAirDraft(){
  const el=$("airDraftRange"), lab=$("airDraftVal");
  const show=()=>{ lab.textContent = S.airDraft==null ? "niet ingesteld" : fmtNum(S.airDraft,1)+" m"; };
  el.value = S.airDraft==null ? 4 : S.airDraft; show();
  el.addEventListener("input",()=>{ S.airDraft=+el.value; show(); });
  el.addEventListener("change",()=>{ save(); lastBlockedKey=null; if(pos) render(); else drawPrediction(); });
}

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
  bindRange("planSpeedRange","planSpeedVal","planSpeed",v=>fmtKn(v)+" kn");
  bindRange("lockDelayRange","lockDelayVal","lockDelay",v=>v+" min");
  bindAirDraft();
  bindPeil(); bindChartDatum();
  bindRange("draftRange","draftVal","draft",v=>fmtNum(v,2)+" m");
  bindRange("marginRange","marginVal","margin",v=>fmtNum(v,2)+" m");
  bindRange("anchorRad","anchorRadVal","anchorRadius",v=>v+" m");
  bindToggle("setSim","sim",on=>{ document.body.classList.toggle("sim",on); updateGpsBadge(on?null:(pos?pos.acc:null));
    if(on){ showView("map"); showToast("🧭","Simulatie aan","Tik op de kaart om je positie te kiezen.",{}); } else lastSim=null; });
  $("setSim").checked=S.sim; document.body.classList.toggle("sim",S.sim);
  $("depthFile").addEventListener("change",e=>{ if(e.target.files[0]) loadDepthFile(e.target.files[0]); });

  // AIS: schakelaar en proxy-URL. Zonder URL blijft de laag uit — zie tools/proxy/.
  bindToggle("setAis","ais",()=>{ const b=$("toggleAis"); if(b) b.classList.toggle("on",S.ais);
    if(S.ais) planAis(true); else { ais.schepen=[]; drawAis(); } });
  (()=>{ const el=$("aisApiInput"); if(!el) return;
    el.value=S.aisApi||"";
    el.addEventListener("change",()=>{ S.aisApi=el.value.trim(); save();
      if(S.ais) planAis(true);
      showToast("🚢", S.aisApi?"AIS-proxy ingesteld":"AIS-proxy gewist",
        S.aisApi?"Zet de kaartknop Scheepvaart aan om schepen te zien.":"De AIS-laag blijft nu leeg.",{}); });
  })();
  // Kaartprovider-sleutels: bij wijzigen de lagen opnieuw opbouwen
  ["maptiler","thunderforest"].forEach(nm=>{
    const el=$("key"+nm.charAt(0).toUpperCase()+nm.slice(1)); if(!el) return;
    el.value=(S.mapKeys&&S.mapKeys[nm])||"";
    el.addEventListener("change",()=>{
      S.mapKeys=Object.assign({},S.mapKeys,{[nm]:el.value.trim()}); save();
      if(map){ buildTileLayers();
        showToast("🗺️", el.value.trim()?"Kaartlagen bijgewerkt":"Sleutel gewist",
          el.value.trim()?"De lagen van deze provider staan nu in de kaartkiezer.":"Die lagen zijn uit de kaartkiezer gehaald.",{}); }
    });
  });
}

/* ---------------- Service worker & updates ----------------
 * De service worker cachet op URL, dus een geopend tabblad blijft de oude JS draaien
 * tot je herlaadt — ook al staat de nieuwe versie al klaar. Zonder melding merk je dat
 * niet en denk je dat een nieuwe functie stuk is. Daarom een expliciete vraag. */
let pendingReload=false, swReg=null, swReloading=false;
/* registration.waiting is alleen gevuld als er écht een andere versie klaarstaat. Daarom
 * doet de service worker géén skipWaiting() — anders springt hij meteen door naar active
 * en valt er niets betrouwbaars te detecteren. */
function promptReload(){
  if(pendingReload) return;
  pendingReload=true;
  showToast("⬆️","Nieuwe versie klaar","Tik op OK om MarifoonPilot te vernieuwen.",{sticky:true});
}
function applyUpdate(){
  if(swReg && swReg.waiting){ swReg.waiting.postMessage({type:"SKIP_WAITING"}); }
  else location.reload();   // geen wachtende worker (meer): gewoon herladen
}
function registerSW(){
  if(!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("controllerchange",()=>{
    if(swReloading) return; swReloading=true; location.reload();
  });
  navigator.serviceWorker.register("sw.js").then(reg=>{
    swReg=reg;
    const check=()=>{ if(reg.waiting && navigator.serviceWorker.controller) promptReload(); };
    check();
    reg.addEventListener("updatefound",()=>{
      const nw=reg.installing; if(!nw) return;
      nw.addEventListener("statechange",()=>{ if(nw.state==="installed") check(); });
    });
    document.addEventListener("visibilitychange",()=>{ if(!document.hidden) reg.update().catch(()=>{}); });
  }).catch(()=>{});
}

/* ---------------- Init ---------------- */
window.addEventListener("DOMContentLoaded",()=>{
  buildObstacleList();
  try{ initMap(); }catch(e){ console.warn("kaart init:",e); }
  buildLists(); initSettings(); applyTheme(); applyDist();

  document.querySelectorAll("nav button").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.view)));
  $("btnStart").addEventListener("click",startGPS);
  $("btnSim").addEventListener("click",()=>{ $("setSim").checked=true; S.sim=true; save(); document.body.classList.toggle("sim",true); showView("map"); showToast("🧭","Simulatie aan","Tik op de kaart om je positie te kiezen.",{}); });
  $("btnAck").addEventListener("click",ackAlert);
  $("toastOk").addEventListener("click",()=>{
    if(pendingReload){ applyUpdate(); return; }
    if(needsAck) ackAlert(); else hideToast();
  });
  $("btnFs").addEventListener("click",toggleFullscreen);
  $("btnLocate").addEventListener("click",()=>{ if(pos&&map) map.setView([pos.lat,pos.lon],13); else startGPS(); });
  // Vooruitblik-knoppen
  $("tgDots").classList.toggle("on",S.predDots); $("tgRings").classList.toggle("on",S.predRings);
  $("tgDots").addEventListener("click",()=>{ S.predDots=!S.predDots; save(); $("tgDots").classList.toggle("on",S.predDots); drawPrediction(); if(S.predDots&&!pos) hintNoPos(); });
  $("tgRings").addEventListener("click",()=>{ S.predRings=!S.predRings; save(); $("tgRings").classList.toggle("on",S.predRings); drawPrediction(); if(S.predRings&&!pos) hintNoPos(); });
  $("tgRoute").addEventListener("click",()=>setRouteMode(!routeMode));
  $("tgClear").addEventListener("click",clearRoute);
  $("btnMayday").addEventListener("click",openMayday);
  $("btnAnchor").addEventListener("click",toggleAnchor);
  const wb=$("windBadge"); if(wb) wb.addEventListener("click",openWindPaneel);
  $("btnAbout").addEventListener("click",()=>openModal(ABOUT_HTML));
  $("disclaimerHint").addEventListener("click",()=>openModal(ABOUT_HTML));
  $("btnTestAlert").addEventListener("click",()=>{ needsAck=false; triggerChannelAlert({source:"point",channel:20,post:"Houtribsluizen",reason:"Test"},480); if(pos)render(); });
  $("modal").addEventListener("click",e=>{ if(e.target===$("modal")) closeModal(); });
  $("mayday").addEventListener("click",e=>{ if(e.target===$("mayday")) $("mayday").classList.remove("show"); });

  const layerSel=$("layerSel");
  if(layerSel) layerSel.addEventListener("change",e=>setBaseLayer(e.target.value));

  registerSW();
  tryAutoDepth();
  fetchTide(true);
  setInterval(()=>fetchTide(false), 60000);   // fetchTide bewaakt zelf het echte interval
  if(!S.seenIntro){ openModal(INTRO_HTML); S.seenIntro=true; save(); }
});
