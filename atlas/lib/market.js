/* atlas/lib/market.js — the ammonia market on the globe: countries coloured by production / demand / imports / exports /
   net trade (data/trade/ammonia_2025.json on data/geo/countries.json), and the bilateral trade flows as great-circle arcs
   whose width follows the tonnage, coloured by exporter, with a moving dash for direction and an arrowhead at the importer.
   One country can be picked to show only its own flows. Used by the Build side panel (choose a site with the market in view). */
const MARKET = { data: null, geo: null, metric: null, flows: false, focus: null, minKt: 50, loaded: false };
const MARKET_BASE = (window.HOPS_DATA_BASE || '../data/');
const MARKET_METRICS = {
  production_kt: { n: 'Production', d: 'ammonia production 2025e (USGS, kt NH₃)', ramp: ['#EEF4F7', '#8CC5D8', '#1B6F8E', '#123542'] },
  demand_kt:     { n: 'Apparent demand', d: 'production + imports − exports (kt NH₃) — an upper bound of the merchant market', ramp: ['#EEF4F7', '#9ad9bd', '#1E9A6E', '#0f5c42'] },
  imports_kt:    { n: 'Imports', d: 'ammonia imports (UN Comtrade, kt NH₃)', ramp: ['#EEF4F7', '#f6c48a', '#D9822B', '#7a4210'] },
  exports_kt:    { n: 'Exports', d: 'ammonia exports (UN Comtrade, kt NH₃)', ramp: ['#EEF4F7', '#c6b0e6', '#8b5cd6', '#3f2478'] },
  net_kt:        { n: 'Net trade', d: 'imports − exports: orange = net importer, blue = net exporter (kt NH₃)', diverging: true, ramp: ['#1B6F8E', '#f4f1ea', '#D9822B'] }
};
const FLOW_COLORS = ['#0072B2', '#D55E00', '#009E73', '#CC79A7', '#E69F00', '#56B4E9', '#8b5cd6', '#1E9A6E', '#a6392a', '#4C5B6E'];
async function marketLoad(){
  if (MARKET.loaded) return MARKET;
  const [t, g] = await Promise.all([fetch(MARKET_BASE + 'trade/ammonia_2025.json', { cache: 'no-cache' }).then(r => r.json()), fetch(MARKET_BASE + 'geo/countries.json').then(r => r.json())]);
  MARKET.data = t; MARKET.geo = g; MARKET.loaded = true;
  MARKET.centroid = {}; g.features.forEach(f => { MARKET.centroid[f.properties.iso3] = [f.properties.lon, f.properties.lat]; });
  MARKET.name = {}; g.features.forEach(f => { MARKET.name[f.properties.iso3] = f.properties.name; }); Object.entries(t.countries).forEach(([k, c]) => { MARKET.name[k] = MARKET.name[k] || c.name; });
  return MARKET;
}
function marketQuantile(metric){ const v = Object.values(MARKET.data.countries).map(c => c[metric]).filter(x => x != null && isFinite(x)).map(Math.abs).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length * 0.92)] : 1; }
async function ensureMarketLayers(){
  await marketLoad(); if (map.getSource('countries')) return;
  const feats = MARKET.geo.features.map(f => { const c = MARKET.data.countries[f.properties.iso3] || {}; return { ...f, properties: { ...f.properties, production_kt: c.production_kt ?? null, demand_kt: c.demand_kt ?? null, imports_kt: c.imports_kt ?? null, exports_kt: c.exports_kt ?? null, net_kt: c.net_kt ?? null, hops: c.hops_plants ?? null } }; });
  map.addSource('countries', { type: 'geojson', data: { type: 'FeatureCollection', features: feats } });
  map.addLayer({ id: 'country-fill', type: 'fill', source: 'countries', layout: { visibility: 'none' }, paint: { 'fill-color': '#000', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 1, .68, 6, .45, 9, .15] } }, 'hops-halo');
  map.addLayer({ id: 'country-line', type: 'line', source: 'countries', layout: { visibility: 'none' }, paint: { 'line-color': 'rgba(255,255,255,.55)', 'line-width': .6 } }, 'hops-halo');
  map.addLayer({ id: 'country-focus', type: 'line', source: 'countries', filter: ['==', ['get', 'iso3'], ''], paint: { 'line-color': '#F0E442', 'line-width': 2.2 } }, 'hops-halo');
  map.addSource('flows', { type: 'geojson', lineMetrics: true, data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'flow-shadow', type: 'line', source: 'flows', layout: { 'line-cap': 'round', visibility: 'none' }, paint: { 'line-color': 'rgba(0,0,0,.35)', 'line-width': ['+', ['get', 'w'], 3], 'line-blur': 3 } }, 'hops-halo');
  map.addLayer({ id: 'flow-line', type: 'line', source: 'flows', layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' }, paint: { 'line-color': ['get', 'c'], 'line-width': ['get', 'w'], 'line-opacity': .92 } }, 'hops-halo');
  map.addSource('flow-dots', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });   // packets travelling exporter → importer (updating a dasharray every frame breaks MapLibre's globe renderer)
  map.addLayer({ id: 'flow-dots', type: 'circle', source: 'flow-dots', layout: { visibility: 'none' }, paint: { 'circle-radius': ['+', 1.6, ['*', ['get', 'w'], .3]], 'circle-color': '#FBFAF8', 'circle-opacity': .95, 'circle-stroke-color': ['get', 'c'], 'circle-stroke-width': 1 } }, 'hops-halo');
  map.addLayer({ id: 'flow-head', type: 'symbol', source: 'flows', layout: { 'symbol-placement': 'point', 'text-field': '➤', 'text-font': ['Noto Sans Bold'], 'text-size': ['+', 12, ['*', ['get', 'w'], 1.4]], 'text-rotate': ['get', 'head'], 'text-rotation-alignment': 'map', 'text-allow-overlap': true, 'text-ignore-placement': true, visibility: 'none' }, paint: { 'text-color': ['get', 'c'], 'text-halo-color': 'rgba(255,255,255,.7)', 'text-halo-width': 1 } });
  map.addLayer({ id: 'flow-lbl', type: 'symbol', source: 'flows', layout: { 'symbol-placement': 'line-center', 'text-field': ['get', 'lbl'], 'text-font': ['Noto Sans Regular'], 'text-size': 10.5, 'text-optional': true, visibility: 'none' }, paint: { 'text-color': '#FBFAF8', 'text-halo-color': 'rgba(21,24,27,.85)', 'text-halo-width': 1.2 } });
  map.on('mousemove', 'country-fill', marketHover); map.on('mouseleave', 'country-fill', () => { if (typeof hideTip === 'function') hideTip(); });
  map.on('click', 'country-fill', e => { if (typeof BUILD !== 'undefined' && BUILD.on) return; const iso = e.features[0].properties.iso3; marketFocus(MARKET.focus === iso ? null : iso); });   // in Build mode a click sites the plant; the country is picked in the side panel
}
function marketHover(e){
  const p = e.features[0].properties, tip = document.getElementById('tip'); if (!tip) return;
  const f = v => v == null || v === 'null' ? '—' : fmt(+v) + ' kt';
  tip.style.opacity = 1; tip.style.left = (e.originalEvent.clientX + 14) + 'px'; tip.style.top = (e.originalEvent.clientY + 14) + 'px';
  tip.innerHTML = `<div class="t-n">${p.name}</div><div class="t-m">production ${f(p.production_kt)} · demand ${f(p.demand_kt)} · imports ${f(p.imports_kt)} · exports ${f(p.exports_kt)}${p.hops && p.hops !== 'null' ? ' · ' + p.hops + ' plants in the HOPS register' : ''}</div><div class="t-cta">${MARKET.flows ? 'click to show only this country\'s flows' : (typeof BUILD !== 'undefined' && BUILD.on ? 'click the map to site a plant here' : '')}</div>`;
}
function marketRamp(metric){ const M = MARKET_METRICS[metric]; if (M.diverging) { const q = marketQuantile(metric); return ['interpolate', ['linear'], ['coalesce', ['get', metric], 0], -q, M.ramp[0], 0, M.ramp[1], q, M.ramp[2]]; }
  const q = marketQuantile(metric), n = M.ramp.length; return ['interpolate', ['linear'], ['sqrt', ['max', 0, ['coalesce', ['get', metric], 0]]], ...M.ramp.flatMap((c, k) => [Math.sqrt(q) * k / (n - 1), c])]; }
async function setMarketLayer(metric){
  MARKET.metric = metric || null; await ensureMarketLayers();
  const on = !!metric; ['country-fill', 'country-line'].forEach(l => map.setLayoutProperty(l, 'visibility', on ? 'visible' : 'none'));
  if (on) { map.setPaintProperty('country-fill', 'fill-color', marketRamp(metric)); map.setFilter('country-fill', ['!=', ['coalesce', ['get', metric], 'x'], 'x']); }
  if (typeof renderBuildSide === 'function') renderBuildSide();
}
/* great-circle arc between two centroids, n points, offset sideways a little so opposite flows do not overlap */
function arcPoints(a, b, n = 48){
  const r = Math.PI / 180, la1 = a[1] * r, lo1 = a[0] * r, la2 = b[1] * r, lo2 = b[0] * r;
  const d = 2 * Math.asin(Math.sqrt(Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2)) || 1e-9;
  const pts = [];
  for (let i = 0; i <= n; i++) { const f = i / n, A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2), y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2), z = A * Math.sin(la1) + B * Math.sin(la2);
    pts.push([Math.atan2(y, x) / r, Math.atan2(z, Math.sqrt(x * x + y * y)) / r]); }
  return pts;
}
function flowFeatures(){
  const F = MARKET.data.flows.filter(f => f.kt >= MARKET.minKt && MARKET.centroid[f.from] && MARKET.centroid[f.to] && (!MARKET.focus || f.from === MARKET.focus || f.to === MARKET.focus));
  const exporters = [...new Set(F.map(f => f.from))]; const colorOf = iso => FLOW_COLORS[exporters.indexOf(iso) % FLOW_COLORS.length];
  const maxKt = Math.max(1, ...F.map(f => f.kt)), feats = [];
  for (const f of F) {
    const pts = arcPoints(MARKET.centroid[f.from], MARKET.centroid[f.to]), w = 1.5 + 7 * Math.sqrt(f.kt / maxKt);
    const p1 = pts[pts.length - 2], p2 = pts[pts.length - 1], head = 90 - Math.atan2(p2[1] - p1[1], (p2[0] - p1[0]) * Math.cos(p2[1] * Math.PI / 180)) * 180 / Math.PI;
    const props = { from: f.from, to: f.to, kt: f.kt, w, c: colorOf(f.from), lbl: `${MARKET.name[f.from] || f.from} → ${MARKET.name[f.to] || f.to} · ${fmt(f.kt)} kt`, head };
    feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: pts }, properties: props });
    feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: pts[pts.length - 3] }, properties: props });
  }
  return { fc: { type: 'FeatureCollection', features: feats }, exporters, colorOf, n: F.length, total: F.reduce((a, f) => a + f.kt, 0) };
}
let __flowAnim = null;
async function setFlows(on){
  MARKET.flows = !!on; await ensureMarketLayers();
  ['flow-shadow', 'flow-line', 'flow-dots', 'flow-head', 'flow-lbl'].forEach(l => map.setLayoutProperty(l, 'visibility', on ? 'visible' : 'none'));
  if (!on) { if (__flowAnim) cancelAnimationFrame(__flowAnim); __flowAnim = null; marketFocus(null, true); if (typeof renderBuildSide === 'function') renderBuildSide(); return; }
  refreshFlows();
  let t = 0; const step = () => { if (!MARKET.flows) return; t = (t + 0.004) % 1;
    const lines = MARKET.last.fc.features.filter(f => f.geometry.type === 'LineString'), dots = [];
    for (const f of lines) { const pts = f.geometry.coordinates, n = pts.length - 1; for (let k = 0; k < 3; k++) { const u = (t + k / 3) % 1, i = Math.min(n - 1, Math.floor(u * n)), fr = u * n - i; const a = pts[i], b = pts[i + 1];
      dots.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [a[0] + (b[0] - a[0]) * fr, a[1] + (b[1] - a[1]) * fr] }, properties: { w: f.properties.w, c: f.properties.c } }); } }
    map.getSource('flow-dots').setData({ type: 'FeatureCollection', features: dots }); __flowAnim = requestAnimationFrame(step); };   // packets run exporter → importer
  if (!__flowAnim) __flowAnim = requestAnimationFrame(step);
  if (typeof renderBuildSide === 'function') renderBuildSide();
}
function refreshFlows(){ const F = flowFeatures(); map.getSource('flows').setData(F.fc); MARKET.last = F; }
function marketFocus(iso, quiet){
  MARKET.focus = iso || null; if (map.getLayer('country-focus')) map.setFilter('country-focus', ['==', ['get', 'iso3'], iso || '']);
  if (MARKET.flows) refreshFlows();
  if (iso && MARKET.centroid[iso] && !quiet) map.easeTo({ center: MARKET.centroid[iso], zoom: Math.max(map.getZoom(), 2.4), duration: 900 });
  if (typeof renderBuildSide === 'function' && !quiet) renderBuildSide();
}
function setFlowMin(kt){ MARKET.minKt = +kt; if (MARKET.flows) refreshFlows(); if (typeof renderBuildSide === 'function') renderBuildSide(); }
/* panel fragments */
function marketLegendHTML(){
  if (!MARKET.metric) return '';
  const M = MARKET_METRICS[MARKET.metric], q = marketQuantile(MARKET.metric);
  return `<div style="height:8px;border-radius:4px;background:linear-gradient(90deg,${M.ramp.join(',')})"></div><div class="sub" style="display:flex;justify-content:space-between;font-size:10.5px"><span>${M.diverging ? '−' + fmt(q) + ' kt (exporter)' : '0'}</span><span>${M.d}</span><span>${fmt(q)} kt${M.diverging ? ' (importer)' : '+'}</span></div>`;
}
function marketCountryHTML(iso){
  const c = MARKET.data.countries[iso]; if (!c) return `<div class="sub">${MARKET.name[iso] || iso}: no market data in the workbook.</div>`;
  const f = v => v == null ? '—' : fmt(v) + ' kt';
  const basis = Object.entries(c.basis || {}).filter(([, v]) => /2024/.test(v)).map(([k]) => k).join(', ');
  const rows = MARKET.flows && MARKET.last ? MARKET.data.flows.filter(x => x.from === iso || x.to === iso).slice(0, 8) : [];
  return `<div class="fp-h" style="margin-top:8px">${c.name}</div><div class="site-kpis" style="grid-template-columns:1fr 1fr">
    <div><div class="l">Production</div><div class="v" style="font-size:18px">${f(c.production_kt)}</div><div class="d">2025e, USGS</div></div>
    <div><div class="l">Apparent demand</div><div class="v" style="font-size:18px">${f(c.demand_kt)}</div><div class="d">prod + imp − exp</div></div>
    <div><div class="l">Imports</div><div class="v" style="font-size:18px">${f(c.imports_kt)}</div><div class="d">${c.basis && c.basis.imports || ''}</div></div>
    <div><div class="l">Exports</div><div class="v" style="font-size:18px">${f(c.exports_kt)}</div><div class="d">${c.basis && c.basis.exports || ''}</div></div></div>
    ${c.hops_plants ? `<div class="sub">${c.hops_plants} plants in the HOPS register · ${fmt(c.hops_capacity_ktpa)} ktpa</div>` : ''}${basis ? `<div class="sub" style="color:var(--rust)">${basis}: 2025 tonnage missing in Comtrade, 2024 shown.</div>` : ''}
    ${rows.length ? `<div class="fp-h" style="margin-top:8px">Bilateral flows 2025</div>` + rows.map(x => `<div class="legend-row" style="justify-content:space-between"><span><span class="dot" style="background:${MARKET.last.colorOf(x.from)}"></span>${MARKET.name[x.from] || x.from} → ${MARKET.name[x.to] || x.to}</span><span class="mono">${fmt(x.kt)} kt</span></div>`).join('') : ''}`;
}
