/* atlas/facility.js — the Claude-Design plant scene, placed on the real map with the selected run's data.
   Geometry, materials, layout, pipes and flow animation come from facility/plant_builders.js (derived, unchanged) and
   facility/plant_assembly.js (a port of the original page's assembly and live-sim logic). This file only hosts that
   scene inside a MapLibre custom layer — the map supplies terrain, imagery, camera and labels — and feeds it the run's
   capacities (which subsystems exist, how large) and hourly dispatch (which pipes carry flow, how fast rotors turn). */

let facilityLayer = null, FAC = { on: false, plant: null, row: null, scn: null, rec: null, hour: 0, playing: false, speed: 0.6, timer: null, P: null, sel: null };
const FAC_SCALE = 3.0;                                  // original scene units → metres (plot 170 × 110 → 510 × 330 m)
let FAC_OFFSET = { x: 650, z: 120 };                    // plot centre relative to the plant's coordinates (m east, m south); per-plant override below
function facOffsetFor(idx){ try { const v = JSON.parse(localStorage.getItem('hops_fac_pos_' + idx) || 'null'); if (v && isFinite(v.x)) return v; } catch (e) {} return { x: 650, z: 120 }; }
function facMoveStart(){ FAC.moving = true; map.getCanvas().style.cursor = 'crosshair'; const b = document.getElementById('facMove'); if (b) b.textContent = 'click the map …'; map.once('click', e => {
  FAC.moving = false; map.getCanvas().style.cursor = ''; const p = FAC.plant; if (!p) return; const mLat = 110574, mLon = 111320 * Math.cos(p.lat * Math.PI / 180);
  FAC_OFFSET = { x: (e.lngLat.lng - p.lon) * mLon, z: -(e.lngLat.lat - p.lat) * mLat }; try { localStorage.setItem('hops_fac_pos_' + p.idx, JSON.stringify(FAC_OFFSET)); } catch (err) {}
  facilityLayer.setPlant(p, FAC.P); facilityLabels(); facilityMaskBuildings(true); if (typeof siteLayoutGeo !== 'undefined' && siteLayoutGeo && map.getSource('layout')) { const shown = clipToPlot(siteLayoutGeo); map.getSource('layout').setData(shown); if (turbineLayer) turbineLayer.setTurbines(shown.features.filter(f => f.properties.kind === 'turbine'), p, siteInfo); } renderFacilityBar(FAC.rec ? 'ok' : 'nohourly'); }); }
function facilityLabels(){ const p = FAC.plant, P = FAC.P; if (!p || !P || !map.getSource('fac-labels')) return;
  map.getSource('fac-labels').setData({ type: 'FeatureCollection', features: P.nodes.map(n => { const [x, z] = sceneToLocal(n.topAnchor); return { type: 'Feature', geometry: { type: 'Point', coordinates: facLocal2LngLat(p, x, z) }, properties: { label: `${n.def.num} · ${n.def.title}`, key: n.def.key } }; }) }); }
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
      this.holder = new THREE.Group(); this.scene.add(this.holder); this.clock = new THREE.Clock();
      this.lights = M.makeLights(1); this.scene.add(this.lights.group);                        // in the scene root (setPlant clears the holder); a directional light's direction is scale-free, so scene-unit positions are fine
    },
    setPlant(plant, P){
      this.holder.clear(); this.P = P; this.plant = plant; if (!plant || !P) { this.map.triggerRepaint(); return; }
      this.origin = maplibregl.MercatorCoordinate.fromLngLat([plant.lon, plant.lat], 0); this.scale = this.origin.meterInMercatorCoordinateUnits();
      const samples = []; for (let i = 0; i <= 8; i++) for (let j = 0; j <= 6; j++) { const [lx, lz] = sceneToLocal({ x: -88 + 176 * i / 8, z: -58 + 116 * j / 6 }); const ll = facLocal2LngLat(plant, lx, lz); samples.push(this.map.queryTerrainElevation({ lng: ll[0], lat: ll[1] }) || 0); }
      const base = Math.max(...samples) + 1.5;                                             // graded pad: above the highest ground under the plot
      P.root.scale.setScalar(FAC_SCALE); P.root.position.set(FAC_OFFSET.x, base, FAC_OFFSET.z); this.holder.add(P.root);
      if (!P.weather) { P.weather = M.makeWeather(this.lights); P.root.add(P.weather.group); }
      this.map.triggerRepaint();
    },
    render(gl, args){
      if (!this.P || !FAC.on || !this.origin) return;
      const dt = Math.min(this.clock.getDelta(), 0.05), t = this.clock.elapsedTime;
      this.P.tick(dt, t);
      if (this.P.weather) { const st = this.P.weather.update(FAC.hour, dt, this.plant, this.P.SER, 1.0); this.renderer.toneMappingExposure = st.exposure; FAC.weather = st; applyWeatherToMap(st);
        if (!this.__wxT || performance.now() - this.__wxT > 250) { this.__wxT = performance.now(); const wx = document.getElementById('facWeather'); if (wx) wx.textContent = `${st.cond} · sun ${st.elevDeg.toFixed(0)}° · ${st.ghi} W/m² · ${st.ws} m/s · cloud ${(st.cloud * 100).toFixed(0)}%`; } }
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
  FAC_OFFSET = facOffsetFor(plant.idx);
  const newPlant = !FAC.plant || FAC.plant.idx !== plant.idx;
  FAC.plant = plant; FAC.row = r; FAC.scn = s; FAC.on = true; FAC.rec = null; FAC.sel = null; facilityPause();
  if (newPlant || !FAC.hour) FAC.hour = ((170 * 24 + 12 - Math.round(plant.lon / 15)) % 8760 + 8760) % 8760;   // open at local noon on 20 June (data index is UTC)
  const C = M.capsFromRow({ ...r, __ccs: s.ccs }, plant); const P = M.assemblePlant(C); FAC.P = P;
  facilityLayer.setPlant(plant, P);
  facilityLabels(); facilityMaskBuildings(true);
  if (typeof siteLayoutGeo !== 'undefined' && siteLayoutGeo && map.getSource('layout')) { const shown = clipToPlot(siteLayoutGeo); map.getSource('layout').setData(shown); if (turbineLayer) turbineLayer.setTurbines(shown.features.filter(f => f.properties.kind === 'turbine'), plant, siteInfo); }
  renderFacilityBar('loading');
  const rec = await ensureHourly(s, hourlyCIfor(s, ci));
  if (!FAC.on || FAC.P !== P) return;
  FAC.rec = rec; P.setSeries(M.prepSeries(rec)); facilitySetHour(FAC.hour); renderFacilityBar(rec ? 'ok' : 'nohourly');
  map.once('idle', () => { if (FAC.on && FAC.P === P) facilityLayer.setPlant(plant, P); });
}
function hideFacility(){
  FAC.on = false; facilityPause(); if (facilityLayer) facilityLayer.setPlant(null, null); FAC.P = null; facilityMaskBuildings(false);
  if (map.getSource('fac-labels')) map.getSource('fac-labels').setData({ type: 'FeatureCollection', features: [] });
  const bar = document.getElementById('facilityBar'); if (bar) bar.hidden = true;
  if (map.getLayer('pv-blocks')) map.setPaintProperty('pv-blocks', 'fill-extrusion-color', '#1B3A5C');
  if (turbineLayer) { turbineLayer.speed = 1; turbineLayer.daylight = 1; }
  applyWeatherToMap(null);
}
/* ---- click a subsystem (nearest label anchor on screen) → info card with the run's numbers */
function facilityClick(e){
  if (!FAC.on || !FAC.P || FAC.moving) return;
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
    <div class="fac-specs">${real.map(([k, v, u]) => `<div><div class="l">${k}</div><div class="v">${v}<small> ${u}</small></div></div>`).join('')}</div>
    ${['battery', 'h2tank', 'heat'].includes(d.key) ? `<div class="sp-actions" style="margin-top:8px"><button class="btn sm" onclick="openStorageTab(${FAC.plant.idx})">Zoom in: energy storage →</button></div>` : ''}</div>`;
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
  const wx = document.getElementById('facWeather'); if (wx && FAC.weather) wx.textContent = `${FAC.weather.cond} · sun ${FAC.weather.elevDeg.toFixed(0)}° · ${FAC.weather.ghi} W/m² · ${FAC.weather.ws} m/s · cloud ${(FAC.weather.cloud * 100).toFixed(0)}%`;
  const sl = document.getElementById('facSlider'); if (sl && Math.abs(+sl.value - h) > 0.5) sl.value = h;
  if (map) map.triggerRepaint();
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], MSTART = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
function facHourLabel(h){ const step = FAC.rec && FAC.rec.pv ? Math.round(8760 / FAC.rec.pv.length) : 1, tz = FAC.plant ? Math.round(FAC.plant.lon / 15) : 0, hr = ((Math.floor(h) * step + tz) % 8760 + 8760) % 8760, d = Math.floor(hr / 24); let m = 11; while (m > 0 && MSTART[m] > d) m--; return `${d - MSTART[m] + 1} ${MONTHS[m]} · ${String(hr % 24).padStart(2, '0')}:00 local`; }
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
      <span style="margin-left:auto;display:flex;gap:4px"><button class="btn ghost sm" title="Straight down" onclick="map.easeTo({pitch:0,bearing:0,duration:900})">Top</button><button class="btn ghost sm" title="Perspective" onclick="map.easeTo({pitch:60,bearing:-25,duration:900})">3D</button><button class="btn ghost sm" title="Rotate 45° (or right-drag the map)" onclick="map.easeTo({bearing:map.getBearing()+45,duration:900})">↻</button><button class="btn ghost sm" id="facMove" title="Click, then click the map where the plant should stand (remembered for this site)" onclick="facMoveStart()">Move</button></span>
      <button class="btn ghost sm" onclick="openDashboard(${FAC.plant.idx})">Results →</button><button class="btn ghost sm" onclick="hideFacility()">Hide plant</button></div>
    <div id="facInfo">${facilityInfoHTML()}</div>
    <div class="fb-ctl"><button class="btn sm" id="facPlay" onclick="FAC.playing?facilityPause():facilityPlay()">▶</button>
      <input type="range" id="facSlider" min="0" max="${n - 1}" step="0.25" value="${FAC.hour}" oninput="facilityPause();facilitySetHour(+this.value)">
      <span class="mono" id="facHourLabel">${facHourLabel(FAC.hour)}</span><span class="mono" id="facWeather" style="min-width:0;text-align:left;color:var(--ink2)"></span>
      <select class="tg" onchange="FAC.speed=+this.value"><option value="0.15">slow · 1 h ≈ 1.7 s</option><option value="0.6" selected>normal · 1 day ≈ 10 s</option><option value="2">fast · 1 day ≈ 3 s</option><option value="6">very fast · 1 day ≈ 1 s</option></select></div>
    <div class="fb-read" id="facReadout">${FAC.rec ? facReadout(FAC.rec, Math.floor(FAC.hour)) : ''}</div>
    <div class="sub" style="font-size:10.5px">Subsystems are present and sized from this run's capacities; pipes light up only when the optimizer moves something through them in that hour, rotors follow the wind output. Plot layout is the HOPS reference design, placed next to the existing site. Right-drag to rotate, scroll to zoom.</div>`;
}

/* ---- the map follows the scene's weather: imagery darkens at night and desaturates under cloud, the sky takes the palette */
let __wxLast = 0, __wxPrev = null;
function applyWeatherToMap(st){
  const now = performance.now(); if (st && now - __wxLast < 150) return; __wxLast = now;
  if (!st) { st = { dayF: 1, cloud: 0, rainAmt: 0, top: '#8fbcdc', hor: '#e6eef2', nightF: 0 }; }
  const bright = 0.18 + 0.82 * st.dayF * (1 - 0.35 * st.cloud) * (1 - 0.15 * st.rainAmt), sat = -0.75 * st.cloud - 0.5 * st.nightF, contrast = -0.25 * st.cloud;
  if (map.getLayer('sat')) { map.setPaintProperty('sat', 'raster-brightness-max', bright); map.setPaintProperty('sat', 'raster-saturation', Math.max(-1, sat)); map.setPaintProperty('sat', 'raster-contrast', contrast); }
  if (map.getLayer('buildings')) map.setPaintProperty('buildings', 'fill-extrusion-opacity', 0.92 * (0.35 + 0.65 * st.dayF));
  if (map.setSky) { try { map.setSky({ 'sky-color': st.top, 'horizon-color': st.hor, 'fog-color': st.hor, 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.75 + 0.2 * st.cloud, 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0] }); } catch (e) {} }
  if (turbineLayer) turbineLayer.daylight = 0.25 + 0.75 * st.dayF * (1 - 0.4 * st.cloud);
}

/* ---- keep the siting buildout off the plant's plot */
function facilityPlotBBox(){
  if (!FAC.on || !FAC.plant) return null;
  const pts = [[-88, -58], [88, -58], [88, 58], [-88, 58]].map(([x, z]) => { const [lx, lz] = sceneToLocal({ x, z }); return facLocal2LngLat(FAC.plant, lx, lz); });
  return [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))];
}
/* OSM buildings under the plot are hidden while the plant stands there (the pad covers the ground, not the map's own 3D buildings) */
function facilityPlotPolygon(marginM){
  if (!FAC.plant) return null; const m = (marginM || 0) / FAC_SCALE;
  const ring = [[-88 - m, -58 - m], [88 + m, -58 - m], [88 + m, 58 + m], [-88 - m, 58 + m], [-88 - m, -58 - m]].map(([x, z]) => { const [lx, lz] = sceneToLocal({ x, z }); return facLocal2LngLat(FAC.plant, lx, lz); });
  return { type: 'Polygon', coordinates: [ring] };
}
function facilityMaskBuildings(on){
  if (!map.getLayer('buildings')) return;
  if (!on) { map.setFilter('buildings', null); if (__maskTick) { map.off('idle', __maskTick); __maskTick = null; } __maskIds = ''; return; }
  const tick = () => {                                                          // MapLibre's `within` ignores polygons, so the mask is by feature id:
    if (!FAC.on || !FAC.plant) return;                                          // every loaded building whose bounding box overlaps the plot (+ margin) is filtered out
    const bb = facilityPlotBBox(); if (!bb) return;
    const m = 14 / 111320; const box = [bb[0] - m, bb[1] - m, bb[2] + m, bb[3] + m];
    const ids = new Set();
    for (const f of map.querySourceFeatures('ofm', { sourceLayer: 'building' })) {
      if (f.id == null) continue; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      const rings = f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates.flat() : [];
      for (const ring of rings) for (const c of ring) { if (c[0] < x0) x0 = c[0]; if (c[0] > x1) x1 = c[0]; if (c[1] < y0) y0 = c[1]; if (c[1] > y1) y1 = c[1]; }
      if (x1 >= box[0] && x0 <= box[2] && y1 >= box[1] && y0 <= box[3]) ids.add(f.id);
    }
    const key = [...ids].sort().join(','); if (key === __maskIds) return; __maskIds = key;
    map.setFilter('buildings', ids.size ? ['!', ['in', ['id'], ['literal', [...ids]]]] : null);
  };
  __maskIds = ''; tick();
  if (!__maskTick) { __maskTick = tick; map.on('idle', __maskTick); }        // new tiles while panning → recompute
}
let __maskTick = null, __maskIds = '';
function clipToPlot(gj){
  const bb = facilityPlotBBox(); if (!bb || !gj || !gj.features) return gj;
  const inside = c => c[0] > bb[0] && c[0] < bb[2] && c[1] > bb[1] && c[1] < bb[3];
  const hit = g => { const cs = g.type === 'Point' ? [g.coordinates] : g.type === 'Polygon' ? g.coordinates.flat() : g.type === 'MultiPolygon' ? g.coordinates.flat(2) : []; return cs.some(inside); };
  const out = [];
  for (const f of gj.features) {
    const g = f.geometry;
    if (f.properties.kind === 'windland' || !g) { out.push(f); continue; }
    if (g.type === 'MultiPolygon') { const parts = g.coordinates.filter(poly => !poly.flat().some(inside)); if (parts.length) out.push({ ...f, geometry: { type: 'MultiPolygon', coordinates: parts } }); }   // drop only the cells on the plot
    else if (!hit(g)) out.push(f);
  }
  return { type: 'FeatureCollection', features: out };
}

/* ---- a requested site that is still being solved: the construction site instead of the plant (facility/construction.js) */
let __conMod = null;
function loadConstructionModule(){ return __conMod || (__conMod = import('./facility/construction.js')); }
async function showConstruction(site, progress){
  const M = await ensureFacilityLayers(), CM = await loadConstructionModule();
  FAC_OFFSET = facOffsetFor(site.idx);
  FAC.plant = site; FAC.row = null; FAC.scn = null; FAC.on = true; FAC.rec = null; FAC.sel = null; FAC.construction = true; facilityPause();
  FAC.hour = ((170 * 24 + 12 - Math.round(site.lon / 15)) % 8760 + 8760) % 8760;      // local noon, 20 June
  const P = CM.buildConstruction(progress || 0); FAC.P = P;
  facilityLayer.setPlant(site, P); facilityMaskBuildings(true);
  if (map.getSource('fac-labels')) map.getSource('fac-labels').setData({ type: 'FeatureCollection', features: [] });
  map.once('idle', () => { if (FAC.on && FAC.P === P) facilityLayer.setPlant(site, P); });
  return P;
}
function setConstructionProgress(p){ if (FAC.on && FAC.construction && FAC.P && FAC.P.setProgress) { FAC.P.setProgress(p); map.triggerRepaint(); } }
const __hideFacilityBase = hideFacility;
hideFacility = function(){ FAC.construction = false; __hideFacilityBase(); };

/* the plant's storage units link into the results' Storage tab (technology sweep + cell lab) */
function openStorageTab(idx){ openDashboard(idx); const t = document.querySelector('.tab[data-tab="storage"]'); if (t) t.click(); }
