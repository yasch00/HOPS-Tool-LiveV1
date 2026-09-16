/* atlas/build.js — "Build a plant": a guided flow on the real map.
   1 Site      click anywhere (or type coordinates)
   2 Plant     capacity, pathway, carbon-intensity target
   3 Assumptions   financing and price assumptions (the finance model), with what is NOT adjustable stated
   4 Estimate  instant proxy from the nearest modelled plant — its optimized design scaled to the capacity — plus land
               need and the project-finance KPIs; every number labelled as a proxy
   5 Request   the exact HOPS run, queued as a GitHub issue with the full spec (solved on Sherlock, published to data/)
   Nothing here re-optimises: the proxy is the nearest real solve. That is said on screen. */

const BUILD = { on: false, lat: null, lon: null, name: '', tpd: 1000, path: 'SMR+CCS', ci: 0.5, near: [], A: null, T: {} };
/* technical assumptions of the optimizer (keys = tools/hops_site_run.py OVERRIDES). Defaults are hops_core.py's;
   the exact run applies them, the instant proxy cannot (it is a solved design). */
const TECH_FIELDS = [
  ['Capital cost', [
    ['el_capex_usd_per_kw', 'Electrolyzer CAPEX', '$/kW', 300, 2500, 10, 1100],
    ['pv_capex_mult', 'Solar PV CAPEX × regional', '×', 0.4, 2, 0.05, 1],
    ['wt_capex_mult', 'Wind CAPEX × regional', '×', 0.4, 2, 0.05, 1],
    ['battery_capex_usd_per_mwh', 'Battery CAPEX', '$/MWh', 100000, 600000, 5000, null],
    ['smr_capex_mult', 'Reformer (SMR) CAPEX ×', '×', 0.5, 2, 0.05, 1],
    ['ccs_capex_mult', 'CCS CAPEX ×', '×', 0.5, 3, 0.05, 1],
    ['hb_capex_usd_per_mwh', 'Heat battery CAPEX', '$/MWh', 20000, 150000, 1000, 53750]]],
  ['Prices', [
    ['gas_price_mult', 'Gas price × local series', '×', 0.3, 3, 0.05, 1],
    ['grid_price_mult', 'Grid price × local series', '×', 0.3, 3, 0.05, 1],
    ['nh3_price_usd_per_t', 'NH₃ price (optimizer objective)', '$/t', 200, 1500, 5, null],
    ['interest_rate', 'Interest rate (annuity)', '%', 0.03, 0.15, 0.005, 0.08]]],
  ['Operation', [
    ['res_overbuild', 'Renewable overbuild cap', '× E_ref', 1, 3, 0.1, 1.4],
    ['el_minload', 'Electrolyzer minimum load', '%', 0, 0.5, 0.05, 0.1],
    ['nh3_minload', 'Haber-Bosch minimum load', '%', 0.5, 1, 0.05, 0.95],
    ['asu_minload', 'ASU minimum load', '%', 0.3, 1, 0.05, 0.7],
    ['hb_hours', 'Heat battery hours', 'h', 0, 24, 1, 5],
    ['ccs_capture_process', 'CCS capture — process stream', '%', 0.5, 1, 0.01, 0.99],
    ['ccs_capture_flue', 'CCS capture — flue gas', '%', 0.5, 1, 0.01, 0.9]]]
];
function buildSetT(k, v){ if (v === '' || v == null) delete BUILD.T[k]; else BUILD.T[k] = +v; renderBuildPanel(); }
function buildResetT(){ BUILD.T = {}; renderBuildPanel(); }
const RHO_WIND = 5.0, RHO_PV = 50.0;             // MW/km², same central values as the siting model
const REPO_ISSUES = 'https://github.com/yasch00/HOPS-Tool-LiveV1/issues/new';

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
  BUILD.near = PLANTS.map(p => ({ p, km: haversine(lat, lon, p.lat, p.lon) })).sort((a, b) => a.km - b.km).slice(0, 3);
  map.getSource('build-site').setData({ type: 'FeatureCollection', features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [BUILD.lon, BUILD.lat] }, properties: {} }, circlePolygon(BUILD.lon, BUILD.lat, 25)] });
  if (!BUILD.A) BUILD.A = finDefaults(BUILD.near[0].p);
  ensureSiteBase();                                   // terrain + buildings around the chosen point
  map.flyTo({ center: [BUILD.lon, BUILD.lat], zoom: Math.max(map.getZoom(), 9.5), pitch: 45, duration: 1400 });
  renderBuildPanel();
  if (typeof syncURL === 'function') syncURL();
}
function buildSet(k, v){ BUILD[k] = (k === 'name') ? v : +v; renderBuildPanel(); }
function buildSetA(k, v){ BUILD.A[k] = +v; renderBuildPanel(); }

/* proxy estimate: nearest modelled plant's run at the chosen pathway / CI, scaled by capacity */
function buildEstimate(){
  const n = BUILD.near[0]; if (!n) return null;
  const s = SCN.find(s => s.plant === n.p.idx && s.hb && !s.policy && scnPathwayLabel(s) === BUILD.path); if (!s) return null;
  const rows = cappedRows(s); if (!rows.length) return null;
  const r = rows.reduce((a, x) => Math.abs(x.target - BUILD.ci) < Math.abs(a.target - BUILD.ci) ? x : a, rows[0]);
  const k = BUILD.tpd / n.p.tpd;
  const pseudo = { idx: -1, name: BUILD.name || 'New site', tpd: BUILD.tpd, region: n.p.region, country: n.p.country, admin: '' };
  const I = finInputsFromRow(r, pseudo), F = runFinance(I, BUILD.A);
  const bau = BAU.base[n.p.idx];
  return { n, s, r, k, I, F, bau, rows,
    cap: { pv: r.p_pv * k, wt: r.p_wt * k, el: r.p_el * k, b: r.p_b * k, smr: r.p_smr * k, hb: r.p_hb * k },
    land: { wind_km2: r.p_wt * k / RHO_WIND, pv_km2: r.p_pv * k / RHO_PV },
    sweep: rows.map(x => [x.target, x.lcoa]) };
}
function renderBuildPanel(){
  const host = document.getElementById('buildPanel'); host.hidden = false;
  const step = (n, t, done) => `<div class="bstep ${done ? 'done' : ''}"><span class="bnum">${n}</span><span>${t}</span></div>`;
  let h = `<div class="sp-head" style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><div><div class="fp-h" style="margin-bottom:4px">Build a plant</div><h2>${BUILD.lat == null ? 'Choose a site' : (BUILD.name || 'New site')}</h2>
    <div class="sub">${BUILD.lat == null ? 'Click anywhere on the map, or a modelled plant to start from it.' : `${BUILD.lat.toFixed(4)}°, ${BUILD.lon.toFixed(4)}° · nearest modelled plant ${BUILD.near[0].p.name} (${fmt(BUILD.near[0].km)} km)`}</div></div>
    <button class="btn ghost" style="flex:none" onclick="leaveBuild()">✕</button></div>`;
  h += `<div class="bsteps">${step(1, 'Site', BUILD.lat != null)}${step(2, 'Plant', BUILD.lat != null)}${step(3, 'Assumptions', BUILD.lat != null)}${step(4, 'Estimate', BUILD.lat != null)}${step(5, 'Exact run', false)}</div>`;
  if (BUILD.lat == null) { host.innerHTML = h + `<p class="sub" style="margin-top:12px">The estimate uses the nearest of the ${PLANTS.length} modelled plants as a proxy for your site's resource, prices and grid. The exact run — HOPS solved for your coordinates and assumptions — is queued from step 5.</p>`; return; }
  const E = buildEstimate();
  // 1 site
  h += `<div class="fin-group"><div class="fp-h">1 · Site</div>
    <label class="fin-f" style="grid-template-columns:1fr"><span class="fin-l">Name<small>optional</small></span><input class="fin-n" style="width:100%;text-align:left" value="${(BUILD.name || '').replace(/"/g, '&quot;')}" onchange="buildSet('name',this.value)"></label>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><label class="fin-f" style="grid-template-columns:1fr"><span class="fin-l">Latitude</span><input type="number" class="fin-n" style="width:100%" step="0.001" value="${BUILD.lat}" onchange="setBuildSite(+this.value,BUILD.lon,null)"></label>
    <label class="fin-f" style="grid-template-columns:1fr"><span class="fin-l">Longitude</span><input type="number" class="fin-n" style="width:100%" step="0.001" value="${BUILD.lon}" onchange="setBuildSite(BUILD.lat,+this.value,null)"></label></div>
    <div class="sub">Nearest modelled: ${BUILD.near.map(x => `${x.p.name} ${fmt(x.km)} km`).join(' · ')}</div></div>`;
  // 2 plant
  const paths = [...new Set(SCN.filter(s => s.plant === BUILD.near[0].p.idx && !s.policy).map(scnPathwayLabel))];
  const cis = E ? E.rows.map(x => x.target) : [];
  h += `<div class="fin-group"><div class="fp-h">2 · Plant</div>
    <label class="fin-f"><span class="fin-l">Capacity<small>t NH₃/day</small></span><input type="range" min="100" max="4000" step="50" value="${BUILD.tpd}" oninput="buildSet('tpd',this.value)"><input type="number" class="fin-n" step="50" value="${BUILD.tpd}" onchange="buildSet('tpd',this.value)"></label>
    <div class="sub" style="margin:-4px 0 6px">${fmt(BUILD.tpd * 365 / 1000)} kt/yr</div>
    <div class="ci-bar" style="margin:0 0 6px">${paths.map(pt => `<button class="ci-pill sm ${BUILD.path === pt ? 'active' : ''}" onclick="buildSet('path','${pt}');BUILD.path='${pt}';renderBuildPanel()">${pt.replace('+CCS', ' +CCS')}</button>`).join('')}</div>
    <div class="ci-bar" style="margin:0"><span class="lbl">CI target</span>${cis.map(c => `<button class="ci-pill sm ${Math.abs(c - BUILD.ci) < 1e-6 ? 'active' : ''}" onclick="buildSet('ci',${c})">${c.toFixed(2)}</button>`).join('')}</div></div>`;
  // 3 assumptions
  const A = BUILD.A, fld = ([k, n, u, lo, hi, st, dec]) => { const v = A[k], isPct = u.startsWith('%'); return `<label class="fin-f"><span class="fin-l">${n}<small>${u}</small></span><input type="range" min="${lo}" max="${hi}" step="${st}" value="${v}" oninput="buildSetA('${k}',this.value)"><input type="number" class="fin-n" step="${isPct ? st * 100 : st}" value="${isPct ? (v * 100).toFixed(dec) : (+v).toFixed(dec)}" onchange="buildSetA('${k}',${isPct ? 'this.value/100' : 'this.value'})"></label>`; };
  const pick = ['price', 'adder', 'gearing', 'debt_rate', 'hurdle', 'tax', 'disc'];
  h += `<div class="fin-group"><div class="fp-h">3 · Assumptions</div>${FIN_FIELDS.flatMap(g => g[1]).filter(f => pick.includes(f[0])).map(fld).join('')}
    </div>
  <div class="fin-group"><div class="fp-h">3b · Technical assumptions <span class="badge est" style="margin-left:6px">exact run only</span> <button class="btn ghost sm" style="float:right" onclick="buildResetT()">Defaults</button></div>
    <div class="sub" style="margin-bottom:6px">These change the optimizer's design, so the instant estimate cannot apply them — they go into the exact run. Blank = the model's default. ${Object.keys(BUILD.T).length ? '<b>' + Object.keys(BUILD.T).length + ' changed.</b>' : ''}</div>
    ${TECH_FIELDS.map(([g, fs]) => `<div class="fp-h" style="margin-top:8px">${g}</div>` + fs.map(([k, n, u, lo, hi, st, def]) => { const isPct = u === '%', v = BUILD.T[k], shown = v == null ? '' : (isPct ? (v * 100).toFixed(1) : v);
      return `<label class="fin-f" style="grid-template-columns:1fr 84px"><span class="fin-l">${n}<small>${u}${def != null ? ' · default ' + (isPct ? def * 100 + '%' : def) : ' · default regional'}</small></span><input type="range" min="${lo}" max="${hi}" step="${st}" value="${v == null ? (def == null ? (lo + hi) / 2 : def) : v}" oninput="buildSetT('${k}',this.value)"><input type="number" class="fin-n" style="width:84px" step="${isPct ? st * 100 : st}" placeholder="default" value="${shown}" onchange="buildSetT('${k}',this.value===''?'':(${isPct ? 'this.value/100' : 'this.value'}))"></label>`; }).join('')).join('')}
  </div>`;
  // 4 estimate
  if (E) {
    const K = E.F.K, M = 1e6, c = E.cap;
    h += `<div class="fin-group"><div class="fp-h">4 · Estimate <span class="badge est" style="margin-left:6px">proxy</span></div>
      <div class="site-kpis">
        <div><div class="l">LCOA</div><div class="v">${fmt(E.r.lcoa)}<small> $/t</small></div><div class="d">at CI ${E.r.target.toFixed(2)} · BAU ${fmt(E.bau && E.bau.lcoa)} $/t</div></div>
        <div><div class="l">Design</div><div class="v">${fmt(c.wt)}<small> MW wind</small></div><div class="d">${fmt(c.pv)} MW PV · ${fmt(c.el)} MW electrolysis · ${fmt(c.smr)} t H₂/d reformer</div></div>
        <div><div class="l">Land for renewables</div><div class="v">${fmt(E.land.wind_km2 + E.land.pv_km2)}<small> km²</small></div><div class="d">${fmt(E.land.wind_km2)} km² wind at ${RHO_WIND} MW/km² · ${fmt(E.land.pv_km2)} km² PV at ${RHO_PV} MW/km² — before setbacks; a 25 km catchment is ${fmt(Math.PI * 625)} km² gross</div></div>
        <div><div class="l">Project finance</div><div class="v">${finFmt(K.equity_irr, 'pct')}<small> equity IRR</small></div><div class="d">project IRR ${finFmt(K.project_irr, 'pct')} · min DSCR ${finFmt(K.min_dscr_b, 'x')} · overnight $${finFmt(E.I.capex_abs, 'bn')}</div></div>
      </div>
      <div class="sub">Proxy = ${E.n.p.name}'s optimized ${BUILD.path.replace('+CCS', ' +CCS')} run at this CI, scaled ×${E.k.toFixed(2)} to ${fmt(BUILD.tpd)} t/d (HOPS costs are linear in capacity, so per-tonne values carry over; resource, prices and grid are the proxy plant's). ${E.n.km > 150 ? '<b style="color:var(--rust)">The nearest modelled plant is ' + fmt(E.n.km) + ' km away — treat this as indicative only.</b>' : ''}</div>
      <div class="sp-actions"><button class="btn ghost sm" onclick="openDashboard(${E.n.p.idx})">Open ${E.n.p.name}'s full results →</button></div></div>`;
  } else h += `<div class="fin-group"><div class="fp-h">4 · Estimate</div><p class="sub">No solved run of the nearest plant for this pathway / target.</p></div>`;
  // 5 request
  h += `<div class="fin-group"><div class="fp-h">5 · Exact run</div>
    <p class="sub">Queue HOPS for these coordinates: one year of ERA5 weather and the local market are pulled for the site, the plant is co-sized and dispatched hourly for every CI target, and the results are published here with a link back. Runs are solved on Stanford's Sherlock cluster in batches.</p>
    <div class="sp-actions"><a class="btn" target="_blank" rel="noopener" href="${buildIssueURL(E)}">Request the run on GitHub →</a><button class="btn ghost" onclick="buildDownloadSpec()">Download spec (JSON)</button></div></div>`;
  host.innerHTML = h;
}
function buildSpec(E){
  return { requested: new Date().toISOString().slice(0, 10), site: { name: BUILD.name || null, lat: BUILD.lat, lon: BUILD.lon },
    plant: { tNH3_day: BUILD.tpd, pathway: BUILD.path, ci_targets: 'sweep 0–1.75', ci_focus: BUILD.ci },
    assumptions: Object.fromEntries(Object.entries(BUILD.A || {}).filter(([k]) => !k.startsWith('__'))),
    technical: { ...BUILD.T },
    proxy: E ? { plant: E.n.p.idx, name: E.n.p.name, km: Math.round(E.n.km), lcoa: E.r.lcoa, ci: E.r.target } : null,
    data_version: MANIFEST.version };
}
function buildIssueURL(E){
  const spec = buildSpec(E), title = `Run request: ${BUILD.name || (BUILD.lat + ', ' + BUILD.lon)} · ${fmt(BUILD.tpd)} t/d ${BUILD.path}`;
  const body = `## HOPS run request\n\n| | |\n|---|---|\n| Site | ${BUILD.name || '—'} (${BUILD.lat}, ${BUILD.lon}) |\n| Capacity | ${fmt(BUILD.tpd)} t NH₃/day |\n| Pathway | ${BUILD.path} |\n| Nearest modelled | ${E ? E.n.p.name + ' · ' + Math.round(E.n.km) + ' km' : '—'} |\n| Technical overrides | ${Object.keys(BUILD.T).length ? Object.entries(BUILD.T).map(([k, v]) => k + '=' + v).join(', ') : 'none (model defaults)'} |\n\n<details><summary>Spec (JSON)</summary>\n\n\`\`\`json\n${JSON.stringify(spec, null, 1)}\n\`\`\`\n</details>\n\n_Submitted from the atlas · data ${MANIFEST.version}_`;
  return `${REPO_ISSUES}?labels=run-request&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}
function buildDownloadSpec(){
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(buildSpec(buildEstimate()), null, 1)], { type: 'application/json' }));
  a.download = `hops_run_request_${BUILD.lat}_${BUILD.lon}.json`; a.click();
}
