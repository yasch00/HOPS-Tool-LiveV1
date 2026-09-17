/* atlas/build.js — "Build a plant": a guided flow on the real map.
   1 Site         click anywhere (or type coordinates)
   2 Plant        capacity and pathway (the exact run always sweeps the full CI range 0–1.75 for BOTH pathways)
   3 Assumptions  the optimizer's economic and technical inputs, shown with their model defaults
   4 Estimate     instant proxy from the nearest modelled plant — its optimized designs scaled to the capacity — plus land need
   5 Request      the exact HOPS run, queued as a GitHub issue with the full spec (run with tools/run_requests.py, published to data/)
   Nothing here re-optimises: the proxy is the nearest real solve, said on screen. Financing (gearing, debt, tax) is deliberately
   not part of a run request — it is post-optimization and lives in the dashboard's Finance tab. */

const BUILD = { on: false, lat: null, lon: null, name: '', tpd: 1000, path: 'SMR+CCS', near: [], T: {} };
const RHO_WIND = 5.0, RHO_PV = 50.0;             // MW/km², same central values as the siting model
const REPO_ISSUES = 'https://github.com/yasch00/HOPS-Tool-LiveV1/issues/new';
/* the optimizer's inputs (keys = tools/hops_site_run.py OVERRIDES). Defaults are hops_core.py's; `us`/`eu` where the model's default
   depends on the sales region. Field: [key, label, unit, min, max, step, default, decimals] */
const TECH_FIELDS = [
  ['Economic', [
    ['nh3_price_usd_per_t', 'NH₃ price (objective)', '$/t', 200, 1500, 5, { us: 450, eu: 660 }, 0],
    ['gas_price_mult', 'Gas price × local 2025 series', '×', 0.3, 3, 0.05, 1, 2],
    ['grid_price_mult', 'Grid price × local 2025 series', '×', 0.3, 3, 0.05, 1, 2],
    ['interest_rate', 'Interest rate (annuity)', '%', 0.03, 0.15, 0.005, 0.08, 1],
    ['eua_price_eur_per_t', 'EUA price (EU ETS, if enabled)', '€/t', 0, 200, 1, 72, 0]]],
  ['Capital cost', [
    ['el_capex_usd_per_kw', 'Electrolyzer', '$/kW', 300, 2500, 10, 1100, 0],
    ['pv_capex_mult', 'Solar PV × regional (Berkeley Lab / IRENA 2024)', '×', 0.4, 2, 0.05, 1, 2],
    ['wt_capex_mult', 'Wind × regional', '×', 0.4, 2, 0.05, 1, 2],
    ['battery_capex_usd_per_mwh', 'Battery', '$/MWh', 100000, 600000, 5000, { us: 300000, eu: 215000 }, 0],
    ['smr_capex_mult', 'Reformer (SMR) ×', '×', 0.5, 2, 0.05, 1, 2],
    ['ccs_capex_mult', 'CO₂ capture ×', '×', 0.5, 3, 0.05, 1, 2],
    ['hb_capex_usd_per_mwh', 'Heat battery', '$/MWh', 20000, 150000, 1000, 53750, 0]]],
  ['Technical', [
    ['res_overbuild', 'Renewable overbuild cap', '× E_ref', 1, 3, 0.1, 1.4, 1],
    ['el_minload', 'Electrolyzer minimum load', '%', 0, 0.5, 0.05, 0.1, 0],
    ['nh3_minload', 'Haber-Bosch minimum load', '%', 0.5, 1, 0.05, 0.95, 0],
    ['asu_minload', 'ASU minimum load', '%', 0.3, 1, 0.05, 0.7, 0],
    ['hb_hours', 'Heat battery hours', 'h', 0, 24, 1, 5, 0],
    ['ccs_capture_process', 'CO₂ capture — process stream', '%', 0.5, 1, 0.01, 0.99, 0],
    ['ccs_capture_flue', 'CO₂ capture — flue gas', '%', 0.5, 1, 0.01, 0.9, 0]]]
];
function techDefault(f){ const d = f[6]; if (d && typeof d === 'object') { const us = BUILD.near[0] && BUILD.near[0].p.region === 'US'; return us ? d.us : d.eu; } return d; }
function techValue(k){ const f = TECH_FIELDS.flatMap(g => g[1]).find(f => f[0] === k); return BUILD.T[k] != null ? BUILD.T[k] : techDefault(f); }

function haversine(a, b, c, d){ const R = 6371, p = Math.PI / 180, x = Math.sin((c - a) * p / 2) ** 2 + Math.cos(a * p) * Math.cos(c * p) * Math.sin((d - b) * p / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); }

function enterBuild(){
  if (!mapLoaded) { map.once('load', () => setTimeout(enterBuild, 50)); return; }
  if (BUILD.on) return;
  if (siteIdx != null) leaveSite();
  BUILD.on = true; document.body.classList.add('build-mode'); show('globeView'); map.resize();
  map.getCanvas().style.cursor = 'crosshair';
  if (!map.getSource('build-site')) {
    map.addSource('build-site', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'build-ring', type: 'line', source: 'build-site', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'line-color': '#A6392A', 'line-width': 1.6, 'line-dasharray': [3, 2] } });
    map.addLayer({ id: 'build-pt', type: 'circle', source: 'build-site', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 9, 'circle-color': '#A6392A', 'circle-stroke-color': '#FBFAF8', 'circle-stroke-width': 2 } });
  }
  map.on('click', onBuildClick);
  if (map.getZoom() < 3) map.flyTo({ zoom: 3.2, center: [0, 42], pitch: 0, duration: 1600 });
  renderBuildPanel();
  if (typeof syncURL === 'function') syncURL();
}
function leaveBuild(){
  BUILD.on = false; document.body.classList.remove('build-mode'); map.off('click', onBuildClick); map.getCanvas().style.cursor = '';
  if (map.getSource('build-site')) map.getSource('build-site').setData({ type: 'FeatureCollection', features: [] });
  document.getElementById('buildPanel').hidden = true;
  if (typeof syncURL === 'function') syncURL();
}
function onBuildClick(e){
  if (!BUILD.on) return;
  const f = map.queryRenderedFeatures(e.point, { layers: ['hops-pts'] });
  if (f.length) { const p = PLANT[+f[0].properties.idx]; setBuildSite(p.lat, p.lon, p.name + ' (modelled site)'); return; }
  setBuildSite(e.lngLat.lat, e.lngLat.lng, '');
}
function setBuildSite(lat, lon, name){
  if (!BUILD.on || !map.getSource('build-site')) { enterBuild(); if (!map.getSource('build-site')) return; }
  BUILD.lat = +lat.toFixed(4); BUILD.lon = +lon.toFixed(4); if (name != null) BUILD.name = name;
  BUILD.near = PLANTS.filter(p => !p.custom).map(p => ({ p, km: haversine(lat, lon, p.lat, p.lon) })).sort((a, b) => a.km - b.km).slice(0, 3);
  map.getSource('build-site').setData({ type: 'FeatureCollection', features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [BUILD.lon, BUILD.lat] }, properties: {} }, circlePolygon(BUILD.lon, BUILD.lat, 25)] });
  ensureSiteBase();                                   // terrain + buildings around the chosen point
  map.flyTo({ center: [BUILD.lon, BUILD.lat], zoom: Math.max(map.getZoom(), 9.5), pitch: 45, duration: 1400 });
  renderBuildPanel();
  if (typeof syncURL === 'function') syncURL();
}
function buildSet(k, v){ BUILD[k] = (k === 'name' || k === 'path') ? v : +v; renderBuildPanel(); }
function buildSetT(k, v){ if (v === '' || v == null) delete BUILD.T[k]; else BUILD.T[k] = +v; renderBuildPanel(); }
function buildResetT(){ BUILD.T = {}; renderBuildPanel(); }

/* proxy estimate: nearest modelled plant's lowest-cost run of the chosen pathway, scaled by capacity */
function buildEstimate(){
  const n = BUILD.near[0]; if (!n) return null;
  const s = SCN.find(s => s.plant === n.p.idx && s.hb && !s.policy && scnPathwayLabel(s) === BUILD.path); if (!s) return null;
  const rows = cappedRows(s); if (!rows.length) return null;
  const r = rows[lowestCostIdx(rows)], k = BUILD.tpd / n.p.tpd, bau = BAU.base[n.p.idx];
  return { n, s, r, k, bau, rows, cap: { pv: r.p_pv * k, wt: r.p_wt * k, el: r.p_el * k, b: r.p_b * k, smr: r.p_smr * k, hb: r.p_hb * k },
    land: { wind_km2: r.p_wt * k / RHO_WIND, pv_km2: r.p_pv * k / RHO_PV }, sweep: rows.map(x => [x.target, x.lcoa]) };
}
function renderBuildPanel(){
  const host = document.getElementById('buildPanel'); host.hidden = false;
  const step = (n, t, done) => `<div class="bstep ${done ? 'done' : ''}"><span class="bnum">${n}</span><span>${t}</span></div>`;
  let h = `<div class="sp-head" style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><div><div class="fp-h" style="margin-bottom:4px">Build a plant</div><h2>${BUILD.lat == null ? 'Choose a site' : (BUILD.name || 'New site')}</h2>
    <div class="sub">${BUILD.lat == null ? 'Click anywhere on the map, or a modelled plant to start from it.' : `${BUILD.lat.toFixed(4)}°, ${BUILD.lon.toFixed(4)}° · nearest modelled plant ${BUILD.near[0].p.name} (${fmt(BUILD.near[0].km)} km)`}</div></div>
    <button class="btn ghost" style="flex:none" onclick="leaveBuild()">✕</button></div>`;
  h += `<div class="bsteps">${step(1, 'Site', BUILD.lat != null)}${step(2, 'Plant', BUILD.lat != null)}${step(3, 'Assumptions', BUILD.lat != null)}${step(4, 'Estimate', BUILD.lat != null)}${step(5, 'Exact run', false)}</div>`;
  if (BUILD.lat == null) { host.innerHTML = h + `<p class="sub" style="margin-top:12px">The estimate uses the nearest of the ${PLANTS.filter(p => !p.custom).length} modelled plants as a proxy for your site's resource, prices and grid. The exact run — HOPS solved for your coordinates and assumptions — is queued from step 5.</p>`; return; }
  const E = buildEstimate();
  // 1 site
  h += `<div class="fin-group"><div class="fp-h">1 · Site</div>
    <label class="fin-f" style="grid-template-columns:1fr"><span class="fin-l">Name<small>optional</small></span><input class="fin-n" style="width:100%;text-align:left" value="${(BUILD.name || '').replace(/"/g, '&quot;')}" onchange="buildSet('name',this.value)"></label>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><label class="fin-f" style="grid-template-columns:1fr"><span class="fin-l">Latitude</span><input type="number" class="fin-n" style="width:100%" step="0.001" value="${BUILD.lat}" onchange="setBuildSite(+this.value,BUILD.lon,null)"></label>
    <label class="fin-f" style="grid-template-columns:1fr"><span class="fin-l">Longitude</span><input type="number" class="fin-n" style="width:100%" step="0.001" value="${BUILD.lon}" onchange="setBuildSite(BUILD.lat,+this.value,null)"></label></div>
    <div class="sub">Nearest modelled: ${BUILD.near.map(x => `${x.p.name} ${fmt(x.km)} km`).join(' · ')} · region ${BUILD.near[0].p.region}</div></div>`;
  // 2 plant
  h += `<div class="fin-group"><div class="fp-h">2 · Plant</div>
    <label class="fin-f"><span class="fin-l">Capacity<small>t NH₃/day</small></span><input type="range" min="100" max="4000" step="50" value="${BUILD.tpd}" oninput="buildSet('tpd',this.value)"><input type="number" class="fin-n" step="50" value="${BUILD.tpd}" onchange="buildSet('tpd',this.value)"></label>
    <div class="sub" style="margin:-4px 0 6px">${fmt(BUILD.tpd * 365 / 1000)} kt/yr</div>
    <div class="ci-bar" style="margin:0 0 4px"><span class="lbl">Show</span>${['SMR', 'SMR+CCS'].map(pt => `<button class="ci-pill sm ${BUILD.path === pt ? 'active' : ''}" onclick="buildSet('path','${pt}')">${pt.replace('+CCS', ' +CCS')}</button>`).join('')}</div>
    <div class="sub">The exact run always solves both pathways over the full carbon-intensity sweep (0 – 1.75 t CO₂/t NH₃ in 0.25 steps), exactly like the published fleet. The toggle only picks which one the estimate below shows.</div></div>`;
  // 3 assumptions — economic + technical, defaults shown
  const nT = Object.keys(BUILD.T).length;
  h += `<div class="fin-group"><div class="fp-h">3 · Assumptions <button class="btn ghost sm" style="float:right" onclick="buildResetT()">Reset to defaults</button></div>
    <div class="sub" style="margin-bottom:6px">Shown with the model's default values (region ${BUILD.near[0].p.region}). Edit any of them; ${nT ? '<b>' + nT + ' changed</b>' : 'none changed'}. Financing (debt, tax, hurdle) is post-optimization and stays in the results' Finance tab.</div>
    ${TECH_FIELDS.map(([g, fs]) => `<div class="fp-h" style="margin-top:8px">${g}</div>` + fs.map(f => { const [k, n, u, lo, hi, st, , dec] = f, isPct = u === '%', v = techValue(k), changed = BUILD.T[k] != null;
      return `<label class="fin-f" style="grid-template-columns:1fr 84px${changed ? ';background:var(--anchor-tint,#EAEFF5);border-radius:6px;padding:2px 4px' : ''}"><span class="fin-l">${n}${changed ? ' <b style="color:var(--accent)">·</b>' : ''}<small>${u}</small></span><input type="range" min="${lo}" max="${hi}" step="${st}" value="${v}" oninput="buildSetT('${k}',this.value)"><input type="number" class="fin-n" style="width:84px" step="${isPct ? st * 100 : st}" value="${isPct ? (v * 100).toFixed(dec) : (+v).toFixed(dec)}" onchange="buildSetT('${k}',${isPct ? 'this.value/100' : 'this.value'})"></label>`; }).join('')).join('')}
  </div>`;
  // 4 estimate
  if (E) {
    const c = E.cap;
    h += `<div class="fin-group"><div class="fp-h">4 · Estimate <span class="badge est" style="margin-left:6px">proxy</span></div>
      <div class="site-kpis">
        <div><div class="l">${(typeof lcoaLabel === 'function') ? lcoaLabel() : 'LCOA'}, lowest-cost point</div><div class="v">${fmt(E.r.lcoa)}<small> $/t</small></div><div class="d">at CI ${E.r.target.toFixed(2)} · BAU ${fmt(E.bau && E.bau.lcoa)} $/t · sweep ${fmt(Math.min(...E.sweep.map(x => x[1])))}–${fmt(Math.max(...E.sweep.map(x => x[1])))} $/t</div></div>
        <div><div class="l">Design</div><div class="v">${fmt(c.wt)}<small> MW wind</small></div><div class="d">${fmt(c.pv)} MW PV · ${fmt(c.el)} MW electrolysis · ${fmt(c.smr)} t H₂/d reformer · ${fmt(c.b)} MW battery</div></div>
        <div><div class="l">Land for renewables</div><div class="v">${fmt(E.land.wind_km2 + E.land.pv_km2)}<small> km²</small></div><div class="d">${fmt(E.land.wind_km2)} km² wind at ${RHO_WIND} MW/km² · ${fmt(E.land.pv_km2)} km² PV at ${RHO_PV} MW/km² — before setbacks; a 25 km catchment is ${fmt(Math.PI * 625)} km² gross</div></div>
        <div><div class="l">Carbon intensity</div><div class="v">${E.r.target.toFixed(2)}<small> t/t</small></div><div class="d">${E.s.ccs ? 'post-capture; ' : ''}BAU ${E.bau ? E.bau.ci.toFixed(2) : '—'} t/t</div></div>
      </div>
      <div class="sub">Proxy = ${E.n.p.name}'s optimized ${BUILD.path.replace('+CCS', ' +CCS')} run at its lowest-cost point, scaled ×${E.k.toFixed(2)} to ${fmt(BUILD.tpd)} t/d (HOPS costs are linear in capacity, so per-tonne values carry over; resource, prices and grid are the proxy plant's, and changed assumptions above are not applied — the exact run applies them). ${E.n.km > 150 ? '<b style="color:var(--rust)">The nearest modelled plant is ' + fmt(E.n.km) + ' km away — indicative only.</b>' : ''}</div>
      <div class="sp-actions"><button class="btn ghost sm" onclick="openDashboard(${E.n.p.idx})">Open ${E.n.p.name}'s full results →</button>${(typeof lcoaBasisToggle === 'function') ? lcoaBasisToggle(true) : ''}</div></div>`;
  } else h += `<div class="fin-group"><div class="fp-h">4 · Estimate</div><p class="sub">No solved run of the nearest plant for this pathway.</p></div>`;
  // 5 request
  h += `<div class="fin-group"><div class="fp-h">5 · Exact run</div>
    <p class="sub">Queue HOPS for these coordinates: the site's own hourly weather and local market data are used, the plant is co-sized and dispatched hourly for every CI target and both pathways with the assumptions above, and the results are published here with a link back. Runs are solved in batches and take about an hour of compute each.</p>
    <div class="sp-actions"><a class="btn" target="_blank" rel="noopener" href="${buildIssueURL(E)}">Request the run on GitHub →</a><button class="btn ghost" onclick="buildDownloadSpec()">Download spec (JSON)</button></div></div>`;
  host.innerHTML = h;
}
function buildSpec(E){
  const tech = {}; TECH_FIELDS.flatMap(g => g[1]).forEach(f => { tech[f[0]] = techValue(f[0]); });   // every input, resolved (defaults included)
  return { requested: new Date().toISOString().slice(0, 10), site: { name: BUILD.name || null, lat: BUILD.lat, lon: BUILD.lon, country: BUILD.near[0] ? BUILD.near[0].p.country : null },
    plant: { tNH3_day: BUILD.tpd, pathways: ['SMR', 'SMR+CCS'], ci_targets: [0, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75] },
    technical: tech, technical_changed: { ...BUILD.T },
    proxy: E ? { plant: E.n.p.idx, name: E.n.p.name, km: Math.round(E.n.km), lcoa: E.r.lcoa, ci: E.r.target, pathway: BUILD.path } : null,
    data_version: MANIFEST.version };
}
function buildIssueURL(E){
  const spec = buildSpec(E), title = `Run request: ${BUILD.name || (BUILD.lat + ', ' + BUILD.lon)} · ${fmt(BUILD.tpd)} t/d`;
  const changed = Object.keys(BUILD.T).length ? Object.entries(BUILD.T).map(([k, v]) => k + '=' + v).join(', ') : 'none (model defaults)';
  const body = `## HOPS run request\n\n| | |\n|---|---|\n| Site | ${BUILD.name || '—'} (${BUILD.lat}, ${BUILD.lon}) |\n| Capacity | ${fmt(BUILD.tpd)} t NH₃/day |\n| Pathways | SMR and SMR+CCS, full CI sweep |\n| Nearest modelled | ${E ? E.n.p.name + ' · ' + Math.round(E.n.km) + ' km' : '—'} |\n| Changed assumptions | ${changed} |\n\n<details><summary>Spec (JSON)</summary>\n\n\`\`\`json\n${JSON.stringify(spec, null, 1)}\n\`\`\`\n</details>\n\n_Submitted from the atlas · data ${MANIFEST.version}_`;
  return `${REPO_ISSUES}?labels=run-request&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}
function buildDownloadSpec(){
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(buildSpec(buildEstimate()), null, 1)], { type: 'application/json' }));
  a.download = `hops_run_request_${BUILD.lat}_${BUILD.lon}.json`; a.click();
}
