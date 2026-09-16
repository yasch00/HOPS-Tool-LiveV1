/* atlas/facility.js — the plant itself, drawn on the real map next to the existing site.
   Process units are three.js meshes sized from the selected run's capacities (P_EL, P_SMR, P_NH3, P_B, P_ST, P_HB, CCS),
   laid out inside a fence 300 m east of the plant's coordinates, and driven hour by hour by the run's own dispatch:
   unit glow = load, storage fill = state of charge, PV brightness = solar output, rotor speed = wind output.
   Footprints use published rules of thumb and are labelled as illustrative; capacities and flows are model output. */

let facilityLayer = null, FAC = { plant: null, row: null, ccs: false, hour: 0, playing: false, speed: 6, rec: null, timer: null, units: [], on: false };
const UNIT_COLORS = { el: 0x2f8f6f, smr: 0xb85a2b, hb: 0x3a6ea5, asu: 0x8e6bb0, b: 0x4f9fd8, st: 0xb0b7bd, hbat: 0xd9a441, nh3: 0xd8d5cc, ccs: 0xa6392a, sub: 0x6b7379, stack: 0x9a9a95 };
const UNIT_NAMES = { el: 'Electrolysis hall', smr: 'Reformer (SMR)', hb: 'Haber-Bosch loop', asu: 'Air separation', b: 'Battery', st: 'H₂ storage', hbat: 'Heat battery', nh3: 'NH₃ storage', ccs: 'CO₂ capture', sub: 'Substation', stack: 'Stack' };

/* ---- sizing rules (metres). Illustrative footprints; the numbers they are scaled from are the run's capacities. */
function facilityPlan(r, ccs){
  const U = [], g = k => Math.max(0, r[k] || 0);
  const add = (id, x, z, w, d, h, opts) => U.push({ id, x, z, w, d, h, ...(opts || {}) });     // x east, z south (m), w×d footprint, h height
  let cx = 0;
  // north row: reformer train + CCS + synthesis + ASU + NH3 tanks
  if (g('p_smr') > 0) { const s = Math.sqrt(12000 * Math.pow(g('p_smr') / 350, 0.7)); add('smr', cx, 0, s, s * 0.8, 22, { cap: `${fmt(g('p_smr'))} t H₂/d` });
    add('stack', cx + s * 0.35, -s * 0.5, 6, 6, 75, { cyl: true }); cx += s + 40;
    if (ccs) { add('ccs', cx, 0, 60, 45, 16, { cap: `${fmt(g('cap_rate'))}% capture`, columns: 2 }); cx += 100; } }
  { const s = 60 * Math.sqrt(Math.max(g('p_nh3'), 5) / 80); add('hb', cx, 0, s, s * 0.85, 20, { cap: `${fmt(g('p_nh3'))} t NH₃/h`, tower: 35 }); cx += s + 40; }
  add('asu', cx, 0, 40, 30, 14, { cap: 'N₂ supply', tower: 55 }); cx += 80;
  add('nh3', cx, 0, 42, 42, 28, { cyl: true, cap: 'storage' }); add('nh3', cx + 55, 0, 42, 42, 28, { cyl: true }); cx += 110;
  const rowW = cx;
  // south row: electrolysis, battery, H2 storage, heat battery, substation
  let sx = 0; const zs = 140;
  if (g('p_el') > 0) { const area = 120 * g('p_el'), w = Math.min(320, Math.sqrt(area * 2.2)), d = area / w; add('el', sx, zs, w, d, 12, { cap: `${fmt(g('p_el'))} MW`, load: 'el', cap_mw: g('p_el') }); sx += w + 40; }
  if (g('p_b') > 0) { const area = 25 * g('p_b') * 4, w = Math.min(140, Math.sqrt(area * 1.5)), d = area / w; add('b', sx, zs, w, d, 3, { cap: `${fmt(g('p_b'))} MW · ${fmt(g('p_b') * 4)} MWh`, soc: 'bsoc', cap_mwh: g('p_b') * 4 }); sx += w + 30; }
  if (g('p_st') > 0) { const n = Math.min(60, Math.ceil(g('p_st') / 3.3)); add('st', sx, zs, Math.min(8, n) * 6, Math.ceil(n / 8) * 28, 4, { cap: `${fmt(g('p_st'))} t H₂ · ${n} bullets`, bullets: n, soc: 'h2st', cap_t: g('p_st') }); sx += Math.min(8, n) * 6 + 30; }
  if (g('p_hb') > 0) { const s = 30 * Math.sqrt(g('p_hb') / 2000); add('hbat', sx, zs, s, s, 12, { cap: `${fmt(g('p_hb'))} MWh thermal`, soc: 'hbsoc', cap_mwh: g('p_hb') }); sx += s + 30; }
  add('sub', sx, zs, 36, 30, 6, { cap: `${fmt(Math.max(g('p_el'), 50))} MW grid` }); sx += 66;
  const W = Math.max(rowW, sx) + 40, D = zs + 160;
  return { units: U, fence: { x0: -20, z0: -60, w: W, d: D } };
}
function facLocal2LngLat(plant, x, z){ const mLat = 110574, mLon = 111320 * Math.cos(plant.lat * Math.PI / 180); return [plant.lon + (300 + x) / mLon, plant.lat - z / mLat]; }

function makeFacilityLayer(){
  return {
    id: 'facility-3d', type: 'custom', renderingMode: '3d',
    onAdd(map, gl){
      this.map = map; this.camera = new THREE.Camera(); this.scene = new THREE.Scene();
      this.scene.add(new THREE.AmbientLight(0xffffff, .8)); const sun = new THREE.DirectionalLight(0xffffff, .8); sun.position.set(-.5, 1, .6); this.scene.add(sun);
      this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true }); this.renderer.autoClear = false;
      this.group = new THREE.Group(); this.scene.add(this.group); this.meshes = {};
    },
    build(plant, plan){
      this.group.clear(); this.meshes = {}; this.plant = plant; this.plan = plan;
      if (!plant || !plan) { this.map.triggerRepaint(); return; }
      this.origin = maplibregl.MercatorCoordinate.fromLngLat([plant.lon, plant.lat], 0); this.scale = this.origin.meterInMercatorCoordinateUnits();
      const base = this.map.queryTerrainElevation({ lng: plant.lon, lat: plant.lat }) || 0;
      const mat = c => new THREE.MeshLambertMaterial({ color: c });
      plan.units.forEach((u, i) => {
        const g = new THREE.Group(); g.position.set(300 + u.x + u.w / 2, base, u.z + u.d / 2);   // local: x east, y up, z south
        const m = mat(UNIT_COLORS[u.id] || 0x999999);
        if (u.cyl) g.add(new THREE.Mesh(new THREE.CylinderGeometry(u.w / 2, u.w / 2, u.h, 28).translate(0, u.h / 2, 0), m));
        else if (u.bullets) { const n = u.bullets, per = Math.min(8, n); for (let k = 0; k < n; k++) { const col = k % per, row = Math.floor(k / per);
            const b = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 24, 12).rotateX(Math.PI / 2).translate(-u.w / 2 + 3 + col * 6, 2.2, -u.d / 2 + 14 + row * 28), m); g.add(b); } }
        else { g.add(new THREE.Mesh(new THREE.BoxGeometry(u.w, u.h, u.d).translate(0, u.h / 2, 0), m));
          if (u.id === 'el') for (let k = 1; k < Math.floor(u.d / 40); k++) g.add(new THREE.Mesh(new THREE.BoxGeometry(u.w, .6, 1).translate(0, u.h + .3, -u.d / 2 + k * 40), mat(0x1f4d3d)));
          if (u.id === 'smr') g.add(new THREE.Mesh(new THREE.BoxGeometry(u.w * .5, 40, u.d * .35).translate(-u.w * .2, 20, 0), mat(0x8a4a24))); }
        if (u.tower) g.add(new THREE.Mesh(new THREE.CylinderGeometry(u.id === 'asu' ? 4 : 3, u.id === 'asu' ? 4 : 3, u.tower, 16).translate(u.w / 2 - 8, u.tower / 2, -u.d / 2 + 8), mat(0xcfcac0)));
        if (u.columns) for (let k = 0; k < u.columns; k++) g.add(new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 45, 16).translate(-u.w / 2 + 12 + k * 16, 22.5, 0), mat(0xd7c7c2)));
        if (u.soc) { const f = new THREE.Mesh(new THREE.BoxGeometry(u.w + 1, 1, u.d + 1).translate(0, .5, 0), new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: .55 })); f.name = 'fill'; g.add(f); }
        this.group.add(g); this.meshes[u.id + '#' + i] = { g, u, m };
      });
      // fence posts (thin) so the boundary reads in 3D too
      const F = plan.fence, fm = mat(0xf2f2ee);
      for (let x = F.x0; x <= F.x0 + F.w; x += 25) [F.z0, F.z0 + F.d].forEach(z => { const p = new THREE.Mesh(new THREE.BoxGeometry(.4, 2.5, .4), fm); p.position.set(300 + x, base + 1.25, z); this.group.add(p); });
      for (let z = F.z0; z <= F.z0 + F.d; z += 25) [F.x0, F.x0 + F.w].forEach(x => { const p = new THREE.Mesh(new THREE.BoxGeometry(.4, 2.5, .4), fm); p.position.set(300 + x, base + 1.25, z); this.group.add(p); });
      this.map.triggerRepaint();
    },
    setHour(h, rec){
      if (!this.meshes) return;
      const H = rec && rec.pv ? rec.pv.length : 0;
      Object.values(this.meshes).forEach(({ g, u, m }) => {
        let load = null;
        if (rec && H) {
          if (u.id === 'el' && rec.el) load = u.cap_mw ? rec.el[h] / u.cap_mw : 0;
          if (u.id === 'smr' && rec.h2smr) { const mx = Math.max(...rec.h2smr) || 1; load = rec.h2smr[h] / mx; }
          if (u.id === 'hb' && rec.nh3) { const mx = Math.max(...rec.nh3) || 1; load = rec.nh3[h] / mx; }
          if (u.id === 'asu' && rec.asu) { const mx = Math.max(...rec.asu) || 1; load = rec.asu[h] / mx; }
          if (u.id === 'ccs' && rec.co2proc) { const mx = Math.max(...rec.co2proc) || 1; load = rec.co2proc[h] / mx; }
          if (u.id === 'sub' && rec.imp && rec.exp) { const mx = Math.max(...rec.imp, ...rec.exp) || 1; load = (rec.imp[h] + rec.exp[h]) / mx; }
          if (u.soc && rec[u.soc]) { const cap = u.cap_mwh || u.cap_t || Math.max(...rec[u.soc]) || 1; const f = g.getObjectByName('fill'); if (f) { const s = Math.max(.02, Math.min(1, rec[u.soc][h] / cap)); f.scale.y = s * (u.h - .5) / 1; f.position.y = 0; } }
        }
        const c = new THREE.Color(UNIT_COLORS[u.id] || 0x999999);
        if (load != null) { m.emissive = c.clone().multiplyScalar(.6 * Math.max(0, Math.min(1, load))); m.color = c.clone().lerp(new THREE.Color(0xffffff), .25 * Math.max(0, Math.min(1, load))); }
        else { m.emissive = new THREE.Color(0x000000); m.color = c; }
      });
      this.map.triggerRepaint();
    },
    render(gl, args){
      if (!this.plan || !this.origin || !FAC.on) return;
      const proj = (args && args.defaultProjectionData) ? args.defaultProjectionData.mainMatrix : args;
      const M = new THREE.Matrix4().fromArray(proj);
      const Lm = new THREE.Matrix4().makeTranslation(this.origin.x, this.origin.y, this.origin.z).scale(new THREE.Vector3(this.scale, -this.scale, this.scale)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
      this.camera.projectionMatrix = M.multiply(Lm);
      this.renderer.resetState(); this.renderer.render(this.scene, this.camera);
    }
  };
}

/* ---- public: show the plant of a run on the map, with its hourly dispatch */
function ensureFacilityLayers(){
  if (!facilityLayer) { facilityLayer = makeFacilityLayer(); map.addLayer(facilityLayer); }
  if (!map.getSource('fac-fence')) {
    map.addSource('fac-fence', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'fac-fence', type: 'line', source: 'fac-fence', paint: { 'line-color': '#FBFAF8', 'line-width': 1.2, 'line-opacity': .9 } });
    map.addSource('fac-labels', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'fac-labels', type: 'symbol', source: 'fac-labels', minzoom: 13, layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-anchor': 'bottom', 'text-offset': [0, -0.4], 'text-allow-overlap': false, 'text-optional': true },
      paint: { 'text-color': '#FBFAF8', 'text-halo-color': 'rgba(21,24,27,.9)', 'text-halo-width': 1.2 } });
  }
}
async function showFacility(plant, s, ci){
  ensureFacilityLayers();
  const rows = cappedRows(s), r = rows.reduce((a, x) => Math.abs(x.target - ci) < Math.abs(a.target - ci) ? x : a, rows[0]);
  FAC.plant = plant; FAC.row = r; FAC.ccs = s.ccs; FAC.scn = s; FAC.on = true; FAC.rec = null; FAC.hour = 0; facilityPause();
  const plan = facilityPlan(r, s.ccs); FAC.plan = plan;
  facilityLayer.build(plant, plan);
  const F = plan.fence, ring = [[F.x0, F.z0], [F.x0 + F.w, F.z0], [F.x0 + F.w, F.z0 + F.d], [F.x0, F.z0 + F.d], [F.x0, F.z0]].map(([x, z]) => facLocal2LngLat(plant, x, z));
  map.getSource('fac-fence').setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: ring }, properties: {} }] });
  const seen = new Set();
  map.getSource('fac-labels').setData({ type: 'FeatureCollection', features: plan.units.filter(u => u.cap && !seen.has(u.id) && seen.add(u.id)).map(u => ({ type: 'Feature', geometry: { type: 'Point', coordinates: facLocal2LngLat(plant, u.x + u.w / 2, u.z - 2) }, properties: { label: `${UNIT_NAMES[u.id]} · ${u.cap}` } })) });
  renderFacilityBar('loading');
  const rec = await ensureHourly(s, hourlyCIfor(s, ci));
  if (!FAC.on || FAC.row !== r) return;
  FAC.rec = rec; facilitySetHour(FAC.rec ? 0 : 0); renderFacilityBar(rec ? 'ok' : 'nohourly');
  map.once('idle', () => { if (FAC.on && FAC.plan === plan) facilityLayer.build(plant, plan), facilitySetHour(FAC.hour); });
}
function hideFacility(){
  FAC.on = false; facilityPause(); if (facilityLayer) facilityLayer.build(null, null);
  ['fac-fence', 'fac-labels'].forEach(k => map.getSource(k) && map.getSource(k).setData({ type: 'FeatureCollection', features: [] }));
  const bar = document.getElementById('facilityBar'); if (bar) bar.hidden = true;
  if (map.getLayer('pv-blocks')) map.setPaintProperty('pv-blocks', 'fill-extrusion-color', '#1B3A5C');
  if (turbineLayer) turbineLayer.speed = 1;
}
function facilitySetHour(h){
  FAC.hour = h; const rec = FAC.rec;
  facilityLayer.setHour(h, rec);
  if (rec) {   // the site's renewables respond too
    if (rec.pv && map.getLayer('pv-blocks')) { const mx = Math.max(...rec.pv) || 1, f = rec.pv[h] / mx; map.setPaintProperty('pv-blocks', 'fill-extrusion-color', `rgb(${Math.round(27 + 120 * f)},${Math.round(58 + 110 * f)},${Math.round(92 + 60 * f)})`); }
    if (rec.wt && turbineLayer) { const mx = Math.max(...rec.wt) || 1; turbineLayer.speed = 0.15 + 1.6 * rec.wt[h] / mx; }
  }
  const el = document.getElementById('facHourLabel'); if (el) el.textContent = facHourLabel(h);
  const rd = document.getElementById('facReadout'); if (rd && rec) rd.innerHTML = facReadout(rec, h);
  const sl = document.getElementById('facSlider'); if (sl && +sl.value !== h) sl.value = h;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], MSTART = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
function facHourLabel(h){ const step = FAC.rec && FAC.rec.pv ? Math.round(8760 / FAC.rec.pv.length) : 1, hr = h * step, d = Math.floor(hr / 24); let m = 11; while (m > 0 && MSTART[m] > d) m--; return `${d - MSTART[m] + 1} ${MONTHS[m]} · ${String(hr % 24).padStart(2, '0')}:00`; }
function facReadout(rec, h){
  const v = k => rec[k] ? fmt(rec[k][h], rec[k][h] < 10 ? 1 : 0) : '—';
  const items = [['Solar', v('pv'), 'MW'], ['Wind', v('wt'), 'MW'], ['Grid import', v('imp'), 'MW'], ['Export', v('exp'), 'MW'], ['Electrolysis', v('el'), 'MW'], ['H₂ electrolytic', v('h2el'), 't/h'], ['H₂ reformer', v('h2smr'), 't/h'], ['NH₃', v('nh3'), 't/h'], ['H₂ stored', v('h2st'), 't'], ['Battery', v('bsoc'), 'MWh']];
  return items.map(([n, x, u]) => `<span><b>${x}</b> <small>${u}</small><br><em>${n}</em></span>`).join('');
}
function facilityPlay(){ if (FAC.timer) return; FAC.playing = true; const n = FAC.rec && FAC.rec.pv ? FAC.rec.pv.length : 8760;
  FAC.timer = setInterval(() => facilitySetHour((FAC.hour + FAC.speed) % n), 120); const b = document.getElementById('facPlay'); if (b) b.textContent = '❚❚'; }
function facilityPause(){ if (FAC.timer) clearInterval(FAC.timer); FAC.timer = null; FAC.playing = false; const b = document.getElementById('facPlay'); if (b) b.textContent = '▶'; }
function renderFacilityBar(state){
  const bar = document.getElementById('facilityBar'); if (!bar) return; bar.hidden = false;
  const n = FAC.rec && FAC.rec.pv ? FAC.rec.pv.length : 8760, s = FAC.scn, r = FAC.row;
  bar.innerHTML = `<div class="fb-head"><b>${FAC.plant.name}</b> · ${scnShortName(s)} · CI ${r.target.toFixed(2)} · LCOA ${fmt(r.lcoa)} $/t <span class="sub">${state === 'loading' ? '· loading hourly dispatch …' : state === 'nohourly' ? '· no hourly dispatch for this run' : ''}</span>
      <button class="btn ghost sm" style="margin-left:auto" onclick="openDashboard(${FAC.plant.idx})">Results →</button><button class="btn ghost sm" onclick="hideFacility()">Hide plant</button></div>
    <div class="fb-ctl"><button class="btn sm" id="facPlay" onclick="FAC.playing?facilityPause():facilityPlay()">▶</button>
      <input type="range" id="facSlider" min="0" max="${n - 1}" value="${FAC.hour}" oninput="facilityPause();facilitySetHour(+this.value)">
      <span class="mono" id="facHourLabel">${facHourLabel(FAC.hour)}</span>
      <select class="tg" onchange="FAC.speed=+this.value"><option value="1">1 h/step</option><option value="6" selected>6 h/step</option><option value="24">1 day/step</option><option value="168">1 week/step</option></select></div>
    <div class="fb-read" id="facReadout">${FAC.rec ? facReadout(FAC.rec, FAC.hour) : ''}</div>
    <div class="sub" style="font-size:10.5px">Unit footprints are illustrative rules of thumb scaled from the run's capacities; capacities, storage levels and flows are the optimizer's hourly output. Glow = load, storage fill = state of charge.</div>`;
}
