/* atlas/facility.js — the Claude-Design plant scene, placed on the real map with the selected run's data.
   Geometry, materials, layout, pipes and flow animation come from facility/plant_builders.js (derived, unchanged) and
   facility/plant_assembly.js (a port of the original page's assembly and live-sim logic). This file only hosts that
   scene inside a MapLibre custom layer — the map supplies terrain, imagery, camera and labels — and feeds it the run's
   capacities (which subsystems exist, how large) and hourly dispatch (which pipes carry flow, how fast rotors turn). */

let facilityLayer = null, FAC = { on: false, plant: null, row: null, scn: null, rec: null, hour: 0, playing: false, speed: 6, timer: null, P: null, sel: null };
const FAC_SCALE = 3.0;                                  // original scene units → metres (plot 170 × 110 → 510 × 330 m)
const FAC_OFFSET = { x: 330, z: 40 };                   // plot centre relative to the plant's coordinates (m east, m south)
let __plantMod = null;
function loadPlantModule(){ return __plantMod || (__plantMod = import('./facility/plant_assembly.js')); }
function facLocal2LngLat(plant, x, z){ const mLat = 110574, mLon = 111320 * Math.cos(plant.lat * Math.PI / 180); return [plant.lon + x / mLon, plant.lat - z / mLat]; }
function sceneToLocal(v){ return [FAC_OFFSET.x + v.x * FAC_SCALE, FAC_OFFSET.z + v.z * FAC_SCALE]; }   // scene units → local metres (x east, z south)

function makeFacilityLayer(M){
  const THREE = M.THREE;
  return {
    id: 'facility-3d', type: 'custom', renderingMode: '3d',
    onAdd(map, gl){
      this.map = map; this.camera = new THREE.Camera(); this.scene = new THREE.Scene();
      this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
      this.renderer.autoClear = false; this.renderer.outputColorSpace = THREE.SRGBColorSpace; this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.0;   // original 1.28 was tuned for its own pale sky; satellite ground reads better a touch darker
      this.renderer.shadowMap.enabled = false;                                      // no framebuffer switches inside the map's frame
      const pm = new THREE.PMREMGenerator(this.renderer); this.scene.environment = pm.fromEquirectangular(M.makeSkyTexture()).texture; pm.dispose();
      this.lights = M.makeLights(FAC_SCALE); this.scene.add(this.lights.group);
      this.holder = new THREE.Group(); this.scene.add(this.holder); this.clock = new THREE.Clock();
    },
    setPlant(plant, P){
      this.holder.clear(); this.P = P; this.plant = plant; if (!plant || !P) { this.map.triggerRepaint(); return; }
      this.origin = maplibregl.MercatorCoordinate.fromLngLat([plant.lon, plant.lat], 0); this.scale = this.origin.meterInMercatorCoordinateUnits();
      const base = this.map.queryTerrainElevation({ lng: plant.lon, lat: plant.lat }) || 0;
      P.root.scale.setScalar(FAC_SCALE); P.root.position.set(FAC_OFFSET.x, base, FAC_OFFSET.z); this.holder.add(P.root); this.map.triggerRepaint();
    },
    render(gl, args){
      if (!this.P || !FAC.on || !this.origin) return;
      const dt = Math.min(this.clock.getDelta(), 0.05), t = this.clock.elapsedTime;
      this.P.tick(dt, t);
      const proj = (args && args.defaultProjectionData) ? args.defaultProjectionData.mainMatrix : args;
      const Mx = new THREE.Matrix4().fromArray(proj);
      const Lm = new THREE.Matrix4().makeTranslation(this.origin.x, this.origin.y, this.origin.z).scale(new THREE.Vector3(this.scale, -this.scale, this.scale)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
      this.camera.projectionMatrix = Mx.multiply(Lm);
      this.renderer.resetState(); this.renderer.render(this.scene, this.camera); this.map.triggerRepaint();
    }
  };
}
async function ensureFacilityLayers(){
  const M = await loadPlantModule();
  if (!facilityLayer) { facilityLayer = makeFacilityLayer(M); map.addLayer(facilityLayer); }
  if (!map.getSource('fac-labels')) {
    map.addSource('fac-labels', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'fac-labels', type: 'symbol', source: 'fac-labels', minzoom: 12.5, layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-anchor': 'bottom', 'text-offset': [0, -0.6], 'text-optional': true },
      paint: { 'text-color': '#FBFAF8', 'text-halo-color': 'rgba(11,16,20,.88)', 'text-halo-width': 1.4 } });
    map.on('click', facilityClick);
  }
  return M;
}
/* ---- show the plant of one run */
async function showFacility(plant, s, ci){
  const M = await ensureFacilityLayers();
  const rows = cappedRows(s), r = rows.reduce((a, x) => Math.abs(x.target - ci) < Math.abs(a.target - ci) ? x : a, rows[0]);
  FAC.plant = plant; FAC.row = r; FAC.scn = s; FAC.on = true; FAC.rec = null; FAC.hour = FAC.hour || 170 * 24 + 12; FAC.sel = null; facilityPause();
  const C = M.capsFromRow({ ...r, __ccs: s.ccs }, plant); const P = M.assemblePlant(C); FAC.P = P;
  facilityLayer.setPlant(plant, P);
  map.getSource('fac-labels').setData({ type: 'FeatureCollection', features: P.nodes.map(n => { const [x, z] = sceneToLocal(n.topAnchor); return { type: 'Feature', geometry: { type: 'Point', coordinates: facLocal2LngLat(plant, x, z) }, properties: { label: `${n.def.num} · ${n.def.title}`, key: n.def.key } }; }) });
  renderFacilityBar('loading');
  const rec = await ensureHourly(s, hourlyCIfor(s, ci));
  if (!FAC.on || FAC.P !== P) return;
  FAC.rec = rec; P.setSeries(M.prepSeries(rec)); facilitySetHour(FAC.hour); renderFacilityBar(rec ? 'ok' : 'nohourly');
  map.once('idle', () => { if (FAC.on && FAC.P === P) facilityLayer.setPlant(plant, P); });
}
function hideFacility(){
  FAC.on = false; facilityPause(); if (facilityLayer) facilityLayer.setPlant(null, null); FAC.P = null;
  if (map.getSource('fac-labels')) map.getSource('fac-labels').setData({ type: 'FeatureCollection', features: [] });
  const bar = document.getElementById('facilityBar'); if (bar) bar.hidden = true;
  if (map.getLayer('pv-blocks')) map.setPaintProperty('pv-blocks', 'fill-extrusion-color', '#1B3A5C');
  if (turbineLayer) turbineLayer.speed = 1;
}
/* ---- click a subsystem (nearest label anchor on screen) → info card with the run's numbers */
function facilityClick(e){
  if (!FAC.on || !FAC.P) return;
  let best = null, bd = 1e9;
  for (const n of FAC.P.nodes) { const [x, z] = sceneToLocal(n.center); const p = map.project(facLocal2LngLat(FAC.plant, x, z)); const d = Math.hypot(p.x - e.point.x, p.y - e.point.y); if (d < bd) { bd = d; best = n; } }
  if (best && bd < 60) { FAC.sel = best.def.key; FAC.P.select(FAC.sel); } else { FAC.sel = null; FAC.P.select(null); }
  renderFacilityInfo();
}
function facilityInfoHTML(){
  const P = FAC.P, n = P && P.nodes.find(n => n.def.key === FAC.sel); if (!n) return '';
  const d = n.def, C = P.C, r = FAC.row, cf = (typeof P !== 'undefined') ? null : null;
  const real = { solar: [['Capacity', fmt(C.pv), 'MW'], ['Energy', fmt(C.row.e_pv / 1000), 'GWh/yr'], ['CF', (C.cf.pv * 100).toFixed(0), '%'], ['CAPEX', fmt(C.row.capex_pv), '$/t NH₃']],
    wind: [['Capacity', fmt(C.wt), 'MW'], ['Energy', fmt(C.row.e_wt / 1000), 'GWh/yr'], ['CF', (C.cf.wt * 100).toFixed(0), '%'], ['CAPEX', fmt(C.row.capex_wt), '$/t NH₃']],
    grid: [['Import', fmt(C.imp / 1000), 'GWh/yr'], ['Export', fmt((C.row.e_exp || 0) / 1000), 'GWh/yr'], ['Grid CI', (C.row.grid_ci || 0).toFixed(3), 'tCO₂/MWh'], ['Electricity', fmt(C.row.elec_cost), '$/t NH₃']],
    electrolyzer: [['Capacity', fmt(C.el), 'MW'], ['H₂', fmt(C.row.h2_el), 't/yr'], ['CF', (C.cf.el * 100).toFixed(0), '%'], ['CAPEX', fmt(C.row.capex_el), '$/t NH₃']],
    smr: [['Capacity', fmt(C.smr), 't H₂/d'], ['H₂', fmt(C.row.h2_smr), 't/yr'], ['Gas', fmt(C.row.ng_cost), '$/t NH₃'], ['CAPEX', fmt(C.row.capex_smr), '$/t NH₃']],
    battery: [['Power', fmt(C.batt), 'MW'], ['Energy', fmt(C.batt * 4), 'MWh'], ['CAPEX', fmt(C.row.capex_b), '$/t NH₃']],
    heat: [['Capacity', fmt(C.hb), 'MWh th'], ['CAPEX', fmt(C.row.capex_hb), '$/t NH₃']],
    h2tank: [['Storage', fmt(C.store / 1000), 't H₂'], ['CAPEX', fmt(C.row.capex_st), '$/t NH₃']],
    asu: [['ASU', fmt(C.row.capex_asu), '$/t NH₃ CAPEX']],
    hb: [['Synthesis', fmt(C.row.p_nh3), 't NH₃/h'], ['Output', fmt(C.nh3_mt * 1000), 'kt/yr'], ['CAPEX', fmt(C.row.capex_nh3), '$/t NH₃']],
    nh3: [['Output', fmt(C.nh3_mt * 1000), 'kt NH₃/yr'], ['LCOA', fmt(r.lcoa), '$/t']],
    ccs: [['Capture', fmt(C.capture_rate), '%'], ['CO₂ captured', fmt(C.co2_cap / 1000), 'kt/yr'], ['Cost', fmt(C.row.cost_co2), '$/tCO₂'], ['CAPEX', fmt(C.row.capex_ccs), '$/t NH₃']],
    ng: [['Gas feed', (C.row.ng_feed_int || 0).toFixed(2), 'MWh/t NH₃'], ['Gas fuel', (C.row.ng_fuel_int || 0).toFixed(2), 'MWh/t NH₃']],
    optimizer: [['LCOA', fmt(r.lcoa), '$/t'], ['CI', r.target.toFixed(2), 'tCO₂/t'], ['Elec. intensity', (r.elec_int || 0).toFixed(2), 'MWh/t']] }[d.key] || [];
  return `<div class="fac-info"><div class="fac-info-head"><span class="fac-num" style="background:#${d.color.toString(16).padStart(6, '0')}">${d.num}</span><b>${d.title}</b><span class="sub">${d.cat}</span><button class="btn ghost sm" style="margin-left:auto" onclick="FAC.sel=null;FAC.P.select(null);renderFacilityInfo()">✕</button></div>
    <p class="sub">${d.desc}</p>
    <div class="fac-io">${(d.io || []).map(io => `<span><i style="background:#${(PALETTE_HEX[io.c] || 'ffffff')}"></i>${io.dir === 'in' ? '←' : '→'} ${io.kind}</span>`).join('')}</div>
    <div class="fac-specs">${real.map(([k, v, u]) => `<div><div class="l">${k}</div><div class="v">${v}<small> ${u}</small></div></div>`).join('')}</div></div>`;
}
const PALETTE_HEX = { elec: 'ffb547', h2: '66d9ff', n2: '6be0b6', ng: 'ff8a4c', nh3: 'b691ff', co2: '8b96a2', heat: 'ff6b6b' };
function renderFacilityInfo(){ const el = document.getElementById('facInfo'); if (el) el.innerHTML = facilityInfoHTML(); }

/* ---- hour scrubbing (drives pipes + rotors in the scene, PV fields and turbines on the landscape) */
function facilitySetHour(h){
  FAC.hour = h; const rec = FAC.rec;
  if (FAC.P) FAC.P.setHour(h, 0.05);
  if (rec) {
    if (rec.pv && map.getLayer('pv-blocks')) { const mx = Math.max(...rec.pv) || 1, f = rec.pv[Math.floor(h) % rec.pv.length] / mx; map.setPaintProperty('pv-blocks', 'fill-extrusion-color', `rgb(${Math.round(27 + 120 * f)},${Math.round(58 + 110 * f)},${Math.round(92 + 60 * f)})`); }
    if (rec.wt && turbineLayer) { const mx = Math.max(...rec.wt) || 1; turbineLayer.speed = 0.15 + 1.6 * rec.wt[Math.floor(h) % rec.wt.length] / mx; }
  }
  const el = document.getElementById('facHourLabel'); if (el) el.textContent = facHourLabel(h);
  const rd = document.getElementById('facReadout'); if (rd && rec) rd.innerHTML = facReadout(rec, Math.floor(h));
  const sl = document.getElementById('facSlider'); if (sl && Math.abs(+sl.value - h) > 0.5) sl.value = h;
  if (map) map.triggerRepaint();
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], MSTART = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
function facHourLabel(h){ const step = FAC.rec && FAC.rec.pv ? Math.round(8760 / FAC.rec.pv.length) : 1, hr = Math.floor(h) * step, d = Math.floor(hr / 24); let m = 11; while (m > 0 && MSTART[m] > d) m--; return `${d - MSTART[m] + 1} ${MONTHS[m]} · ${String(hr % 24).padStart(2, '0')}:00`; }
function facReadout(rec, h){
  const v = k => rec[k] ? fmt(rec[k][h], rec[k][h] < 10 ? 1 : 0) : '—';
  return [['Solar', v('pv'), 'MW'], ['Wind', v('wt'), 'MW'], ['Grid import', v('imp'), 'MW'], ['Export', v('exp'), 'MW'], ['Electrolysis', v('el'), 'MW'], ['H₂ electrolytic', v('h2el'), 't/h'], ['H₂ reformer', v('h2smr'), 't/h'], ['NH₃', v('nh3'), 't/h'], ['H₂ stored', v('h2st'), 't'], ['Battery', v('bsoc'), 'MWh']]
    .map(([n, x, u]) => `<span><b>${x}</b> <small>${u}</small><br><em>${n}</em></span>`).join('');
}
function facilityPlay(){ if (FAC.timer) return; FAC.playing = true; const n = FAC.rec && FAC.rec.pv ? FAC.rec.pv.length : 8760;
  FAC.timer = setInterval(() => facilitySetHour((FAC.hour + FAC.speed * 0.25) % n), 60); const b = document.getElementById('facPlay'); if (b) b.textContent = '❚❚'; }
function facilityPause(){ if (FAC.timer) clearInterval(FAC.timer); FAC.timer = null; FAC.playing = false; const b = document.getElementById('facPlay'); if (b) b.textContent = '▶'; }
function renderFacilityBar(state){
  const bar = document.getElementById('facilityBar'); if (!bar) return; bar.hidden = false;
  const n = FAC.rec && FAC.rec.pv ? FAC.rec.pv.length : 8760, s = FAC.scn, r = FAC.row;
  bar.innerHTML = `<div class="fb-head"><b>${FAC.plant.name}</b> · ${scnShortName(s)} · CI ${r.target.toFixed(2)} · LCOA ${fmt(r.lcoa)} $/t <span class="sub">${state === 'loading' ? '· loading hourly dispatch …' : state === 'nohourly' ? '· no hourly dispatch for this run' : '· click a unit for its numbers'}</span>
      <button class="btn ghost sm" style="margin-left:auto" onclick="openDashboard(${FAC.plant.idx})">Results →</button><button class="btn ghost sm" onclick="hideFacility()">Hide plant</button></div>
    <div id="facInfo">${facilityInfoHTML()}</div>
    <div class="fb-ctl"><button class="btn sm" id="facPlay" onclick="FAC.playing?facilityPause():facilityPlay()">▶</button>
      <input type="range" id="facSlider" min="0" max="${n - 1}" step="0.25" value="${FAC.hour}" oninput="facilityPause();facilitySetHour(+this.value)">
      <span class="mono" id="facHourLabel">${facHourLabel(FAC.hour)}</span>
      <select class="tg" onchange="FAC.speed=+this.value"><option value="1">slow</option><option value="6" selected>normal</option><option value="24">fast</option><option value="96">very fast</option></select></div>
    <div class="fb-read" id="facReadout">${FAC.rec ? facReadout(FAC.rec, Math.floor(FAC.hour)) : ''}</div>
    <div class="sub" style="font-size:10.5px">Subsystems are present and sized from this run's capacities; pipes light up only when the optimizer moves something through them in that hour, rotors follow the wind output. Plot layout is the HOPS reference design, placed next to the existing site.</div>`;
}
