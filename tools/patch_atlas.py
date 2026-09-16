#!/usr/bin/env python3
"""
patch_atlas.py — turn the unbundled Claude-Design tool into a data-driven app.

    python3 patch_atlas.py <unbundled atlas dir> <repo>/atlas

What changes (all in index.html; the rest of the tool is untouched):
  1. the 60 MB of embedded data (three hourly-by-ci*.js, layers.js, the inline DATA blob) is removed;
     scenarios / bau / plants / manifest are fetched from ../data/, globe geometry + fleet + assumptions
     from assets/static.json, and hourly dispatch per run from ../data/runs/... on demand (gzip, decoded in-browser)
  2. plant identity: the three hard-coded plants (23/80/81) become the modelled fleet from data/plants.json;
     globe dots map through amm_idx, names come from plants.json
  3. BAU lookup by plant + policy case instead of by "Texas"/"Germany" strings
  4. pathway comparison gets a plant picker instead of three fixed toggles
  5. URL state (#plant=61&ccs=1&policy=&ci=0.5&tab=hourly), data-version stamp, link back to the site
"""
import json, re, shutil, sys
from pathlib import Path

src, dst = Path(sys.argv[1]), Path(sys.argv[2])
html = (src / "index.html").read_text(encoding="utf-8")
n_edits = 0

def rep(old, new, count=1):
    """Replace exactly `count` occurrences or die."""
    global html, n_edits
    c = html.count(old)
    assert c == count, f"anchor found {c}x (expected {count}): {old[:90]!r}"
    html = html.replace(old, new); n_edits += 1

# ---------------------------------------------------------------- 1. static data out of the page
m = re.search(r'<script id="DATA" type="application/json">(.*?)</script>\n?', html, re.S)
blob = json.loads(m.group(1))
layers_full = json.loads((src / "assets/layers.js").read_text(encoding="utf-8").split("=", 1)[1].rstrip().rstrip(";"))
static = {"ammonia": blob["ammonia"], "layers": blob["layers"], "assumptions": blob["assumptions"], "geo": blob["geo"],
          "layer_counts": {k: len(v) for k, v in layers_full.items()}}
(dst / "assets").mkdir(parents=True, exist_ok=True)
(dst / "assets/static.json").write_text(json.dumps(static, separators=(",", ":")))
(dst / "assets/layers.json").write_text(json.dumps(layers_full, separators=(",", ":")))
html = html[:m.start()] + html[m.end():]

rep('''<script>window.HOURLY_BY_CI={};</script>
<script src="assets/hourly-by-ci.js"></script>
<script src="assets/hourly-by-ci-3.js"></script>
<script src="assets/hourly-by-ci-2.js"></script>
<script src="assets/corrected-battery-charging-column-u-e-b-for-ludw.js"></script>
<script src="assets/layers.js"></script>
''', '''<script>
/* Results live in ../data/ (written by tools/hops_to_web.py); globe geometry, the global fleet and the
   assumption tables in assets/static.json; industry layers in assets/layers.json (fetched on first toggle). */
window.HOPS_DATA_BASE = window.HOPS_DATA_BASE || '../data/';
</script>
''')

rep('''const DATA = JSON.parse(document.getElementById('DATA').textContent);
const SCN = DATA.scenarios, AMM = DATA.ammonia, BAU = DATA.bau, GEO = DATA.geo;
// per-CI hourly dispatch (loaded from js/hourly-byci.js → window.HOURLY_BY_CI)
DATA.hourlyByCI = window.HOURLY_BY_CI || {};
// resolution is taken from the data itself: 2190 pts = every 4th hour, 8760 = true hourly
const HPTS = (()=>{ for(const k in DATA.hourlyByCI){ const r=DATA.hourlyByCI[k]; if(r&&r.pv) return r.pv.length; } return 2190; })();
const HSTEP = Math.round(8760/HPTS);
''', '''let DATA={hourlyByCI:{}}, SCN=[], AMM=[], BAU={base:{}}, GEO={coast:[],border:[]}, PLANTS=[], PLANT={}, MANIFEST={plants:{},policies:{}};
// resolution is taken from the first hourly file loaded: 8760 = true hourly, 2190 = every 4th hour
let HPTS=8760, HSTEP=1;
const DATA_BASE = window.HOPS_DATA_BASE || '../data/';
async function fetchJSON(url){ const r=await fetch(url); if(!r.ok) throw new Error(url+' → HTTP '+r.status); return r.json(); }
async function fetchGz(url){
  const r=await fetch(url); if(!r.ok) throw new Error(url+' → HTTP '+r.status);
  const buf=await r.arrayBuffer(), u=new Uint8Array(buf);
  if(u[0]===0x1f&&u[1]===0x8b){ const txt=await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text(); return JSON.parse(txt); }
  return JSON.parse(new TextDecoder().decode(buf));   // server already un-gzipped it
}
async function loadData(){
  const [st,scn,bau,plants,man]=await Promise.all([fetchJSON('assets/static.json'),fetchJSON(DATA_BASE+'scenarios.json'),
    fetchJSON(DATA_BASE+'bau.json'),fetchJSON(DATA_BASE+'plants.json'),fetchJSON(DATA_BASE+'manifest.json')]);
  DATA={...st,scenarios:scn,bau,plants,manifest:man,hourlyByCI:{}};
  SCN=scn; AMM=st.ammonia; BAU=bau; GEO=st.geo; PLANTS=plants; MANIFEST=man; PLANT={}; plants.forEach(p=>PLANT[p.idx]=p);
  postProcessRows();
  const lg=document.getElementById('legendModeled'); if(lg) lg.textContent=`Modelled (${plants.length} plants · US + EU)`;
  const ds=document.getElementById('dataStamp'); if(ds) ds.textContent=`data ${man.version}`;
}
function plantLabel(idx){ const p=PLANT[idx]; return p?`${p.name} · ${p.admin?p.admin+', ':''}${p.country}`:'—'; }
function policyLabel(pol){ return (MANIFEST.policies||{})[pol]||pol; }
function scnShortName(s){ return scnPathwayLabel(s).replace('+CCS',' +CCS')+(s.policy?' +'+policyLabel(s.policy):''); }
/* hourly dispatch: one gzipped file per plant × pathway × CI, fetched on demand and cached */
const __hourlyPending={};
function hourlyFileFor(s,ci){ const lst=((MANIFEST.plants[s.plant]||{})[scnPathwayLabel(s)])||[]; const e=lst.find(x=>Math.abs(x.ci-ci)<1e-6); return e&&e.file?DATA_BASE+e.file:null; }
function ensureHourly(s,ci){
  const key=s.plant+'_'+scnPathwayLabel(s)+'_CI'+ci;
  if(DATA.hourlyByCI[key]) return Promise.resolve(DATA.hourlyByCI[key]);
  if(__hourlyPending[key]) return __hourlyPending[key];
  const url=hourlyFileFor(s,ci); if(!url) return Promise.resolve(null);
  __hourlyPending[key]=fetchGz(url).then(d=>{ const rec={ci:d.ci,...d.series}; DATA.hourlyByCI[key]=rec;
      if(rec.pv){ HPTS=rec.pv.length; HSTEP=Math.round(8760/HPTS); } delete __hourlyPending[key]; return rec; })
    .catch(e=>{ delete __hourlyPending[key]; console.error(e); return null; });
  return __hourlyPending[key];
}
function loadingCard(msg){ return `<div class="card"><p class="section-d">${msg} …</p></div>`; }
''')

rep('''function hourlyCIkey(s, target){
  const pid = s.plant || (s.loc==='Texas'?23:80), path = scnPathwayLabel(s) + (s.cp?'_cp':'');
  const avail = Object.keys(DATA.hourlyByCI).filter(k=>k.startsWith(pid+'_'+path+'_CI'));
  if(!avail.length) return null;
  const exact = pid+'_'+path+'_CI'+target;
  if(DATA.hourlyByCI[exact]) return exact;
  let best=avail[0], bd=1e9;
  avail.forEach(k=>{ const ci=DATA.hourlyByCI[k].ci; const d=Math.abs(ci-target); if(d<bd){bd=d;best=k;} });
  return best;
}
function ciTargetsFor(s){
  const pid = s.plant || (s.loc==='Texas'?23:80), path=scnPathwayLabel(s) + (s.cp?'_cp':'');
  return Object.keys(DATA.hourlyByCI).filter(k=>k.startsWith(pid+'_'+path+'_CI'))
    .map(k=>DATA.hourlyByCI[k].ci).sort((a,b)=>a-b);
}''', '''/* CI targets with an hourly file (from the manifest); policy cases share the base run's dispatch */
function ciTargetsFor(s){ const lst=((MANIFEST.plants[s.plant]||{})[scnPathwayLabel(s)])||[]; return lst.filter(x=>x.file).map(x=>x.ci).sort((a,b)=>a-b); }
function hourlyCIfor(s,target){
  const ts=ciTargetsFor(s); if(!ts.length) return null;
  if(target==null){ const rows=cappedRows(s); target=rows.length?rows[lowestCostIdx(rows)].target:ts[0]; }
  let best=ts[0],bd=1e9; ts.forEach(t=>{ const d=Math.abs(t-target); if(d<bd){bd=d;best=t;} }); return best;
}
function hourlyCIkey(s,target){ const ci=hourlyCIfor(s,target); return ci==null?null:s.plant+'_'+scnPathwayLabel(s)+'_CI'+ci; }''')

# ---------------------------------------------------------------- 2. plant identity
rep('''function scnsForPlant(idx){ const byPlant=SCN.filter(s=>s.plant===idx && s.hb); if(byPlant.length) return byPlant; const loc=idx===23?'Texas':'Germany'; return SCN.filter(s=>s.loc===loc && s.hb); }''',
    '''function scnsForPlant(idx){ return SCN.filter(s=>s.plant===idx && s.hb); }''')

rep('''  const modeled={23:1,80:1,81:1};''',
    '''  const modeled={}; PLANTS.forEach(p=>{ if(p.amm_idx!=null) modeled[p.amm_idx]=p.idx; });   // globe idx → HOPS plant idx''')
rep('''    if(modeled[p.idx]){col.push(.12,.43,.33);} else {col.push(.70,.34,.18);}''',
    '''    if(p.idx in modeled){col.push(.12,.43,.33);} else {col.push(.70,.34,.18);}''')
rep('''    siz.push(0.05 + Math.sqrt(c/capMax)*0.30 + (modeled[p.idx]?0.03:0));
    ammMeta.push({...p,modeled:!!modeled[p.idx]});''',
    '''    siz.push(0.05 + Math.sqrt(c/capMax)*0.30 + ((p.idx in modeled)?0.03:0));
    ammMeta.push({...p,modeled:(p.idx in modeled),hops:modeled[p.idx]});''')
rep('''  AMM.filter(p=>modeled[p.idx]).forEach(p=>{''', '''  AMM.filter(p=>p.idx in modeled).forEach(p=>{''')
rep('''    tip.innerHTML=`<div class="t-n">${p.modeled?(({23:'Texas plant',80:'Ludwigshafen plant',81:'Brunsbüttel plant'})[p.idx]||'Modeled plant'):'Ammonia plant'}</div>''',
    '''    tip.innerHTML=`<div class="t-n">${p.modeled?plantLabel(p.hops):'Ammonia plant'}</div>''')
rep('''  if(hit.length){ const p=ammMeta[hit[0].index]; if(p.modeled) openPlant(p.idx); }''',
    '''  if(hit.length){ const p=ammMeta[hit[0].index]; if(p.modeled) openPlant(p.hops); }''')
rep('''  document.getElementById('dashLoc').textContent = ({23:'Texas · ERCOT',80:'Ludwigshafen · DE-LU',81:'Brunsbüttel · DE-LU'})[curPlantIdx]||'—';''',
    '''  document.getElementById('dashLoc').textContent = plantLabel(curPlantIdx);''')
rep('''    return `<button class="ci-pill ${s===curScn?'active':''}" onclick="selScn(${i})">${s.name.replace(curScn.loc+' · ','')}</button>`;''',
    '''    return `<button class="ci-pill ${s===curScn?'active':''}" onclick="selScn(${i})">${scnShortName(s)}</button>`;''')
rep('''function selScn(i){ curScn=SCN[i]; curCItarget=null; buildScnSelect(); buildCISelect(); renderActiveTab(); }''',
    '''function selScn(i){ curScn=SCN[i]; curCItarget=null; buildScnSelect(); buildCISelect(); renderActiveTab(); syncURL(); }''')
rep('''function selCI(t){ curCItarget=(t===null||t==='null')?null:+t; buildCISelect(); renderActiveTab(); }''',
    '''function selCI(t){ curCItarget=(t===null||t==='null')?null:+t; buildCISelect(); renderActiveTab(); syncURL(); }''')

# ---------------------------------------------------------------- 3. BAU by plant + policy
rep('''function bauFor(s){ const set = s.cp?BAU.carbon_price:BAU.orig; return set[s.loc] || set[(s.loc||'').indexOf('Germany')===0?'Germany':'Texas']; }''',
    '''function bauFor(s){ const set=(s.policy&&BAU[s.policy])||BAU.base; return set[s.plant]||BAU.base[s.plant]||{lcoa:NaN,ci:2,elec_cost:0,ng_cost:0,carbon_price:0}; }''')
rep('''${s.ccs?`<div><div class="l">CO₂ captured</div><div class="v">${fmt(sel.cap_rate*100)}<small> %</small></div>''',
    '''${s.ccs?`<div><div class="l">CO₂ captured</div><div class="v">${fmt(sel.cap_rate)}<small> %</small></div>''')

# ---------------------------------------------------------------- 4. comparison panel with a plant picker
m = re.search(r"let cmpPlant=23;\nfunction buildCompare\(\)\{.*?\n\}\n", html, re.S)
assert m, "buildCompare not found"
html = html[:m.start()] + '''let cmpPlant=null;
function buildCompare(){
  if(cmpPlant==null||!PLANT[cmpPlant]) cmpPlant=curPlantIdx;
  const scns=SCN.filter(s=>s.plant===cmpPlant && s.hb);
  const pal=['#1f6f54','#a4502f','#2f5d86','#8a6d3b','#b8893b','#7d4fa0','#5b5750','#9a4a52'];
  const seriesList=scns.map((s,i)=>({n:scnShortName(s), c:pal[i%pal.length], dash:!!s.policy,
    pts:cappedRows(s).filter(r=>r.target<=1.75).map(r=>[r.target,r.lcoa])}));
  const bau=[{n:'BAU',v:(BAU.base[cmpPlant]||{}).lcoa,c:'#a4502f'}];
  [...new Set(scns.map(s=>s.policy).filter(Boolean))].forEach((pol,i)=>{ const b=(BAU[pol]||{})[cmpPlant]; if(b&&b.lcoa!==bau[0].v) bau.push({n:'BAU +'+policyLabel(pol),v:b.lcoa,c:'#6b7c74'}); });
  const opts=[...PLANTS].sort((a,b)=>(a.region+a.name).localeCompare(b.region+b.name))
    .map(p=>`<option value="${p.idx}" ${p.idx===cmpPlant?'selected':''}>${p.region} · ${p.name}${p.admin?' ('+p.admin+')':''}</option>`).join('');
  return `<div class="card"><div class="card-h"><h3>Pathway comparison — ${plantLabel(cmpPlant)}</h3>
      <div class="toggle-row"><select class="tg" onchange="cmpPlant=+this.value;renderActiveTab()">${opts}</select></div></div>
    <p class="section-d" style="margin:2px 0 10px">Every modelled configuration for this plant on one axis — optimizer LCOA across the carbon-intensity sweep. Dashed lines are policy re-pricings of the same designs. BAU benchmarks shown as horizontal references; no point exceeds the BAU carbon intensity.</p>
    ${legend(seriesList.map(s=>({c:s.c,n:s.n})))}
    ${lineChart(seriesList,{bau:bau.filter(b=>b.v!=null)})}</div>`;
}
''' + html[m.end():]
n_edits += 1

# ---------------------------------------------------------------- hourly + utilization tabs load on demand
rep('''  const s=curScn, key=hourlyCIkey(s,curCItarget), rec=key?DATA.hourlyByCI[key]:null;
  let h='';
  if(!rec){ document.getElementById('tab-hourly').innerHTML='<div class="card"><p>No hourly dispatch available for this configuration.</p></div>'; return; }''',
    '''  const s=curScn, hci=hourlyCIfor(s,curCItarget), key=hci==null?null:s.plant+'_'+scnPathwayLabel(s)+'_CI'+hci;
  const rec=key?DATA.hourlyByCI[key]:null;
  let h='';
  if(!key){ document.getElementById('tab-hourly').innerHTML='<div class="card"><p>No hourly dispatch was written for this configuration.</p></div>'; return; }
  if(!rec){ document.getElementById('tab-hourly').innerHTML=loadingCard(`Loading hourly dispatch · CI ${hci.toFixed(2)}`);
    ensureHourly(s,hci).then(r=>{ if(activeTab!=='hourly'||curScn!==s) return; if(!r){ document.getElementById('tab-hourly').innerHTML='<div class="card"><p>The hourly file for this run could not be loaded.</p></div>'; return; } hZoom={a:0,b:HPTS}; buildHourly(); });
    return; }''')
rep('''  const s=curScn, key=hourlyCIkey(s,curCItarget), rec=key?DATA.hourlyByCI[key]:null;
  let h='';
  if(!rec){ document.getElementById('tab-util').innerHTML='<div class="card"><p>No hourly data.</p></div>'; return; }''',
    '''  const s=curScn, hci=hourlyCIfor(s,curCItarget), key=hci==null?null:s.plant+'_'+scnPathwayLabel(s)+'_CI'+hci;
  const rec=key?DATA.hourlyByCI[key]:null;
  let h='';
  if(!key){ document.getElementById('tab-util').innerHTML='<div class="card"><p>No hourly dispatch was written for this configuration.</p></div>'; return; }
  if(!rec){ document.getElementById('tab-util').innerHTML=loadingCard(`Loading hourly dispatch · CI ${hci.toFixed(2)}`);
    ensureHourly(s,hci).then(r=>{ if(activeTab!=='util'||curScn!==s) return; if(!r){ document.getElementById('tab-util').innerHTML='<div class="card"><p>The hourly file for this run could not be loaded.</p></div>'; return; } buildUtil(); });
    return; }''')

# ---------------------------------------------------------------- industry layers: full sets fetched on first toggle
rep('''    const cnt=m.line?CO2_PIPES.length:((window.LAYERS&&window.LAYERS[k])||DATA.layers[k]||[]).length;''',
    '''    const cnt=m.line?CO2_PIPES.length:((DATA.layer_counts&&DATA.layer_counts[k])||(DATA.layers[k]||[]).length);''')
rep('''function toggleLayer(k,on){
  if(on){''', '''function loadLayers(){ return window.__layersP||(window.__layersP=fetch('assets/layers.json').then(r=>r.json()).then(j=>{window.LAYERS=j;}).catch(()=>{window.LAYERS={};})); }
function toggleLayer(k,on){
  if(on && !layerClouds[k] && !LAYER_META[k].line && !window.LAYERS){ loadLayers().then(()=>toggleLayer(k,on)); return; }
  if(on){''')

# ---------------------------------------------------------------- row post-processing becomes a function called after load
rep('''SCN.forEach(s=>s.rows.forEach(r=>{
  r.sold_neg = -(r.sold||0);''', '''function postProcessRows(){ SCN.forEach(s=>s.rows.forEach(r=>{
  r.sold_neg = -(r.sold||0);''')
rep('''  r.co2_cap = (r.cap_syngas||0)+(r.cap_flue||0);
}));''', '''  if(r.cap_syngas!=null&&r.cap_flue!=null) r.co2_cap = (r.cap_syngas||0)+(r.cap_flue||0);
})); }''')

# ---------------------------------------------------------------- boot: async data load + URL state
rep('''window.addEventListener('load',()=>{
  initGlobe();
  const q=new URLSearchParams(location.search);
  const fid=q.get('facility'), dash=q.get('dash');
  if(dash && fid){ const idx=parseInt(fid,10); if(idx===23||idx===80||idx===81) openDashboard(idx); }
});''', '''function syncURL(){
  if(!curScn) return;
  const p=new URLSearchParams(); p.set('plant',curPlantIdx); p.set('ccs',curScn.ccs?1:0); if(curScn.policy) p.set('policy',curScn.policy);
  if(curCItarget!=null) p.set('ci',curCItarget); p.set('tab',activeTab);
  history.replaceState(null,'','#'+p.toString());
}
function applyURLState(){
  const q=new URLSearchParams(location.search), h=new URLSearchParams(location.hash.replace(/^#/,''));
  const fid=q.get('facility'), dash=q.get('dash');
  if(dash && fid && PLANT[parseInt(fid,10)]){ openDashboard(parseInt(fid,10)); return; }
  if(h.get('plant')!=null && PLANT[parseInt(h.get('plant'),10)]){
    openDashboard(parseInt(h.get('plant'),10));
    const want=SCN.find(s=>s.plant===curPlantIdx && s.hb && (s.ccs?1:0)===+(h.get('ccs')||0) && (s.policy||'')===(h.get('policy')||''));
    if(want) curScn=want;
    if(h.get('ci')!=null) curCItarget=parseFloat(h.get('ci'));
    const tab=h.get('tab'); if(tab&&document.querySelector(`.tab[data-tab="${tab}"]`)) document.querySelector(`.tab[data-tab="${tab}"]`).click();
    buildScnSelect(); buildCISelect(); renderActiveTab();
  }
}
window.addEventListener('load',async()=>{
  try{ await loadData(); }
  catch(e){ console.error(e); document.body.insertAdjacentHTML('beforeend',`<div class="panel" style="position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:400;padding:18px 22px;max-width:420px"><b>Data unavailable</b><br><span class="sub">${e.message}</span></div>`); return; }
  initGlobe();
  applyURLState();
});''')
rep('''function openDashboard(idx){
  curPlantIdx=idx;
  curScn=scnsForPlant(idx)[0];
  cmpPlant=idx;
  initDash();
  show('dashView');
}''', '''function openDashboard(idx){
  curPlantIdx=idx;
  curScn=scnsForPlant(idx)[0];
  cmpPlant=idx;
  initDash();
  show('dashView');
  syncURL();
}''')
rep('''      activeTab=t.dataset.tab; document.getElementById('tab-'+activeTab).classList.add('active');
      renderActiveTab(); };''', '''      activeTab=t.dataset.tab; document.getElementById('tab-'+activeTab).classList.add('active');
      renderActiveTab(); syncURL(); };''')

# ---------------------------------------------------------------- 5. chrome: link back to the site, legend, stamp
rep('''      <div class="kicker">HOPS · Global Atlas</div>''', '''      <div class="kicker"><a href="../" style="color:inherit;text-decoration:none">← HOPS</a> · Global Atlas</div>''')
rep('''        <div class="legend-row"><span class="dot amm"></span> Modeled (Texas · Ludwigshafen · Brunsbüttel)</div>''',
    '''        <div class="legend-row"><span class="dot amm"></span> <span id="legendModeled">Modelled plants</span></div>''')
rep('''  <div class="globe-foot"><div class="hint">Drag to orient · scroll to zoom · click a highlighted plant</div></div>''',
    '''  <div class="globe-foot"><div class="hint">Drag to orient · scroll to zoom · click a highlighted plant · <span id="dataStamp"></span></div></div>''')
rep('''      <button class="btn ghost" onclick="goGlobe()">← Globe</button>''',
    '''      <a class="btn ghost" href="../">HOPS</a>
      <button class="btn ghost" onclick="goGlobe()">← Globe</button>''')

# ---------------------------------------------------------------- 6. restyle to the site's design system (tokens.css)
# fonts: the Design export bundled Fraunces / Archivo / JetBrains Mono as local woff2; the site uses
# Newsreader / IBM Plex Sans / IBM Plex Mono from Google Fonts. Swap the @font-face block for the same link.
m = re.search(r'<style>/\* vietnamese \*/.*?</style>', html, re.S)
rest = re.sub(r'@font-face\s*\{[^}]*\}|/\*.*?\*/|\s+', '', m.group(0)) if m else None
assert rest == '<style></style>', f"font block not as expected: {rest!r}"
html = html[:m.start()] + '<link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,500;1,6..72,400&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">' + html[m.end():]
n_edits += 1
for old, new in {"'Fraunces'": "'Newsreader'", "'Archivo'": "'IBM Plex Sans'", "'JetBrains Mono'": "'IBM Plex Mono'",
                 '"Fraunces"': '"Newsreader"', '"Archivo"': '"IBM Plex Sans"', '"JetBrains Mono"': '"IBM Plex Mono"'}.items():
    html = html.replace(old, new)

# UI colour variables → tokens (anchor navy for interaction, warm paper neutrals)
rep("""  --ink:#13201c; --ink2:#2c3b35; --mut:#6b7c74; --faint:#9aa9a1;
  --paper:#f4f1e9; --paper2:#ebe7db; --card:#fbfaf5; --line:#d9d3c4;
  --accent:#1f6f54; --accent2:#0f5740; --gold:#b8893b; --rust:#a4502f;
  --blue:#2f5d86; --shadow:0 1px 2px rgba(20,40,30,.05),0 8px 24px rgba(20,40,30,.06);
  --co2:#a4502f; --renew:#1f6f54; --grid:#2f5d86; --gas:#8a6d3b;""",
"""  /* neutrals + interaction colour follow ../tokens.css; data colours are Okabe–Ito */
  --ink:#15181B; --ink2:#3D444B; --mut:#6B7379; --faint:#A3A9AE;
  --paper:#FBFAF8; --paper2:#F4F1EB; --card:#FFFFFF; --line:#E3DFD8;
  --accent:#1B3A5C; --accent2:#14293F; --gold:#E69F00; --rust:#D55E00;
  --blue:#0072B2; --shadow:0 1px 2px rgba(21,24,27,.06),0 8px 24px -12px rgba(21,24,27,.18);
  --co2:#D55E00; --renew:#009E73; --grid:#0072B2; --gas:#8C6D1F;""")
# chart constant block: the selection highlight becomes the anchor colour, not a data colour
rep("""const C={renew:'#1f6f54',grid:'#2f5d86',gas:'#8a6d3b',co2:'#a4502f',gold:'#b8893b',
  el:'#1f6f54',smr:'#a4502f',nh3:'#2f5d86',asu:'#7d4fa0',cp:'#b8893b',hb:'#d08a2e',b:'#5b5750',
  ink:'#13201c',mut:'#6b7c74',line:'#d9d3c4'};""",
"""const C={renew:'#009E73',grid:'#0072B2',gas:'#8C6D1F',co2:'#D55E00',gold:'#1B3A5C',
  el:'#009E73',smr:'#D55E00',nh3:'#0072B2',asu:'#CC79A7',cp:'#6B7379',hb:'#E69F00',b:'#8A8F94',
  ink:'#15181B',mut:'#6B7379',line:'#E3DFD8'};""")
rep("""#globeView{background:radial-gradient(circle at 50% 40%,#eef1f4 0%,#dde3e8 60%,#ccd5dc 100%)}""",
    """#globeView{background:radial-gradient(circle at 50% 40%,#F4F1EB 0%,#EDE9E1 60%,#E3DFD8 100%)}""")
rep("""    if(p.idx in modeled){col.push(.12,.43,.33);} else {col.push(.70,.34,.18);}""",
    """    if(p.idx in modeled){col.push(0,.62,.45);} else {col.push(.84,.37,0);}""")
rep("""new THREE.MeshBasicMaterial({color:0x1f6f54,""", """new THREE.MeshBasicMaterial({color:0x009E73,""")
# every remaining literal colour in CSS + JS: old palette → new
PALETTE = {'#13201c':'#15181B','#2c3b35':'#3D444B','#6b7c74':'#6B7379','#9aa9a1':'#A3A9AE',
  '#f4f1e9':'#FBFAF8','#ebe7db':'#F4F1EB','#fbfaf5':'#FFFFFF','#d9d3c4':'#E3DFD8','#ece7da':'#EDE9E1','#eef2f5':'#F4F1EB',
  '#1f6f54':'#009E73','#0f5740':'#007A5A','#2f5d86':'#0072B2','#a4502f':'#D55E00','#8a6d3b':'#8C6D1F',
  '#b8893b':'#56B4E9','#e0a32e':'#E69F00','#e0a82e':'#E69F00','#7d4fa0':'#CC79A7','#9c8f6b':'#6B7379',
  '#2f8a8a':'#1B7F79','#5b6f86':'#4C5B6E','#5b5750':'#8A8F94','#c47a3d':'#A6392A','#3f8fae':'#56B4E9',
  '#9a4a52':'#CC79A7','#d08a2e':'#E69F00','#b35727':'#D55E00'}
for old, new in PALETTE.items():
    html = re.sub(re.escape(old), new, html, flags=re.I)
html = html.replace("rgba(31,111,84,", "rgba(27,58,92,")     # drag-zoom rectangle tint → anchor
n_edits += 1
# edited links (#plant=…) apply without a reload
rep("""window.addEventListener('load',async()=>{""", """window.addEventListener('hashchange',()=>{ if(location.hash.length>1 && PLANTS.length) applyURLState(); });
window.addEventListener('load',async()=>{""")

# ---------------------------------------------------------------- write + copy the rest
dst.mkdir(parents=True, exist_ok=True)
(dst / "index.html").write_text(html, encoding="utf-8")
for f in (src / "assets").iterdir():
    if f.name == "d477d7f7.js": shutil.copy2(f, dst / "assets" / f.name)
for f in (dst / "assets").glob("*.woff2"): f.unlink()
(dst / "pages").mkdir(exist_ok=True)
for f in (src / "pages").iterdir(): shutil.copy2(f, dst / "pages" / f.name)
shutil.copy2(src / "resources.json", dst / "resources.json")
print(f"{n_edits} edits applied → {dst}")
tot = sum(f.stat().st_size for f in dst.rglob("*") if f.is_file())
print(f"atlas/ total {tot/1e6:.1f} MB; index.html {(dst/'index.html').stat().st_size/1e6:.2f} MB")
for f in sorted(dst.rglob("*")):
    if f.is_file() and f.stat().st_size > 100_000: print(f"  {f.stat().st_size/1e6:6.2f} MB  {f.relative_to(dst)}")
