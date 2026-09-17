/* atlas/map.js — the real-world map: one MapLibre map from globe to site.
   Globe: Esri World Imagery on a globe projection, the global ammonia fleet and the modelled plants.
   Site : terrain (AWS/Mapzen DEM), OpenStreetMap buildings extruded (OpenFreeMap tiles), the 25 km catchment,
          the siting model's developable land and exclusions, and the run's buildout — PV blocks as low
          extrusions, turbines as three.js meshes at true hub height and rotor diameter.
   No API keys. Data: ../data/siting/plant{idx}/ (written by tools/export_siting.py). */

let map = null, mapLoaded = false, siteIdx = null, siteInfo = null, siteLayoutKey = null, turbineLayer = null, __sitePending = null;
const MAP_SOURCES = {
  sat: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
         tileSize: 256, maxzoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community' },
  dem: { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
         encoding: 'terrarium', tileSize: 256, maxzoom: 15, attribution: 'Terrain: Mapzen Terrain Tiles (AWS)' },
  ofm: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: 'Buildings © OpenStreetMap contributors · OpenFreeMap' }
};
const SITE_ZOOM = 15.2, GLOBE_ZOOM = 1.7;          // arrive on the plant itself; the catchment is one zoom-out away
/* same ground scale at every latitude: Web Mercator metres/pixel scale with cos(lat), so a Texas site at 15.2 looks half the size of a German one */
function siteZoomFor(lat){ return SITE_ZOOM + Math.log2(Math.cos(lat * Math.PI / 180) / Math.cos(53.9 * Math.PI / 180)); }
const SITING_BASE = (window.HOPS_DATA_BASE || '../data/') + 'siting/';

/* ---------------------------------------------------------------- globe */
function initGlobe(){
  map = new maplibregl.Map({
    container: 'map',
    style: { version: 8, glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
             sources: MAP_SOURCES, layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
             sky: { 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0] },
             projection: { type: 'globe' } },
    center: [-20, 38], zoom: GLOBE_ZOOM, minZoom: 1, maxZoom: 18, attributionControl: { compact: true }, maxPitch: 75
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 140 }), 'bottom-left');
  map.on('load', () => {
    mapLoaded = true;
    addPlantLayers();
    if (typeof buildLayerList === 'function') buildLayerList();
    map.on('mousemove', 'hops-pts', e => showTip(e, true));
    map.on('mousemove', 'amm-pts', e => showTip(e, false));
    map.on('mouseleave', 'hops-pts', hideTip); map.on('mouseleave', 'amm-pts', hideTip);
    map.on('click', 'hops-pts', e => { const f = e.features[0]; if (f) openSite(+f.properties.idx); });
    map.on('mousemove', 'pending-pts', e => showTip(e, 'pending')); map.on('mouseleave', 'pending-pts', hideTip);
    map.on('click', 'pending-pts', e => { const f = e.features[0]; if (f) openPending(+f.properties.issue); });
    loadPending();
    if (__sitePending != null) { const i = __sitePending; __sitePending = null; openSite(i, true); }
  });
  map.on('error', e => { if (e && e.error && !/tile/i.test(String(e.error.message))) console.warn('map', e.error.message); });
}
function plantsGeo(list, keyfn){ return { type: 'FeatureCollection', features: list.map(p => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: keyfn(p) })) }; }
function addPlantLayers(){
  map.addSource('amm', { type: 'geojson', data: plantsGeo(AMM, p => ({ idx: p.idx, country: p.country, ktpa: p.ktpa || 0 })) });
  map.addSource('hops', { type: 'geojson', data: plantsGeo(PLANTS, p => ({ idx: p.idx, name: p.name, admin: p.admin || '', country: p.country, ktpa: p.ktpa || 0, region: p.region, custom: !!p.custom })) });
  map.addSource('pending', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'amm-pts', type: 'circle', source: 'amm', paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 2.2, 6, 5], 'circle-color': '#D55E00', 'circle-opacity': .8,
    'circle-stroke-color': '#FBFAF8', 'circle-stroke-width': .6 } });
  map.addLayer({ id: 'hops-halo', type: 'circle', source: 'hops', paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 7, 6, 14], 'circle-color': ['case', ['get', 'custom'], CUSTOM_COLOR, '#009E73'], 'circle-opacity': .25, 'circle-blur': .6 } });
  map.addLayer({ id: 'pending-halo', type: 'circle', source: 'pending', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 8, 6, 16], 'circle-color': PENDING_COLOR, 'circle-opacity': .3, 'circle-blur': .7 } });
  map.addLayer({ id: 'hops-pts', type: 'circle', source: 'hops', paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 3.6, 6, 7], 'circle-color': ['case', ['get', 'custom'], CUSTOM_COLOR, '#009E73'],
    'circle-stroke-color': '#FBFAF8', 'circle-stroke-width': 1.2 } });
  map.addLayer({ id: 'pending-pts', type: 'circle', source: 'pending', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 4, 6, 7.5], 'circle-color': PENDING_COLOR, 'circle-stroke-color': '#15181B', 'circle-stroke-width': 1.4 } });
  map.addLayer({ id: 'pending-lbl', type: 'symbol', source: 'pending', minzoom: 3.5, layout: { 'text-field': ['concat', ['get', 'name'], ' · solving'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true },
    paint: { 'text-color': PENDING_COLOR, 'text-halo-color': 'rgba(21,24,27,.85)', 'text-halo-width': 1.2 } });
  map.addLayer({ id: 'hops-lbl', type: 'symbol', source: 'hops', minzoom: 4.5, layout: {
    'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11.5, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true },
    paint: { 'text-color': '#FBFAF8', 'text-halo-color': 'rgba(21,24,27,.85)', 'text-halo-width': 1.2 } });
}
function showTip(e, modelled){
  const p = e.features[0].properties, tip = document.getElementById('tip');
  map.getCanvas().style.cursor = modelled ? 'pointer' : 'default';
  tip.style.opacity = 1; tip.style.left = (e.originalEvent.clientX + 14) + 'px'; tip.style.top = (e.originalEvent.clientY + 14) + 'px';
  tip.innerHTML = modelled === 'pending'
    ? `<div class="t-n">${p.name}</div><div class="t-m">${fmt(p.tpd)} t/d · requested #${p.issue} · HOPS is solving it</div><div class="t-cta">click to watch the site →</div>`
    : modelled
    ? `<div class="t-n">${p.name}${p.admin ? ' · ' + p.admin : ''}, ${p.country}</div><div class="t-m">${fmt(p.ktpa)} ktpa · ${p.custom ? 'requested site · solved' : 'modelled'}</div><div class="t-cta">click to open the site →</div>`
    : `<div class="t-n">Ammonia plant</div><div class="t-m">${p.country} · ${fmt(p.ktpa)} ktpa</div>`;
}
function hideTip(){ document.getElementById('tip').style.opacity = 0; map.getCanvas().style.cursor = ''; }

/* ---------------------------------------------------------------- industry layers (lazy: assets/layers.json on first toggle) */
function loadLayers(){ return window.__layersP || (window.__layersP = fetch('assets/layers.json').then(r => r.json()).then(j => { window.LAYERS = j; }).catch(() => { window.LAYERS = {}; })); }
function toggleLayer(k, on){
  if (!mapLoaded) return;
  const m = LAYER_META[k];
  if (on && !window.LAYERS && !m.line) { loadLayers().then(() => toggleLayer(k, on)); return; }
  const id = 'lyr-' + k;
  if (on) {
    if (!map.getSource(id)) {
      if (m.line) map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: CO2_PIPES.map(line => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: line.map(p => [p[1], p[0]]) }, properties: {} })) } });
      else map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: ((window.LAYERS && window.LAYERS[k]) || DATA.layers[k] || []).map(p => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p[1], p[0]] }, properties: {} })) } });
    }
    if (!map.getLayer(id)) {
      if (m.line) map.addLayer({ id, type: 'line', source: id, paint: { 'line-color': m.c, 'line-width': 1.6, 'line-opacity': .85 } }, 'amm-pts');
      else map.addLayer({ id, type: 'circle', source: id, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 1.4, 8, 3.5, 14, 6], 'circle-color': m.c, 'circle-opacity': .75, 'circle-stroke-color': 'rgba(255,255,255,.5)', 'circle-stroke-width': .4 } }, 'amm-pts');
    }
  } else if (map.getLayer(id)) map.removeLayer(id);
}

/* ---------------------------------------------------------------- site view */
function circlePolygon(lon, lat, km, n = 96){
  const c = [], dLat = km / 110.574, dLon = km / (111.32 * Math.cos(lat * Math.PI / 180));
  for (let i = 0; i <= n; i++) { const a = i / n * 2 * Math.PI; c.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]); }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [c] }, properties: {} };
}
function ensureSiteBase(){
  if (map.getLayer('buildings')) return;
  map.setTerrain({ source: 'dem', exaggeration: 1.15 });
  map.addLayer({ id: 'hillshade', type: 'hillshade', source: 'dem', minzoom: 8, paint: { 'hillshade-exaggeration': .35, 'hillshade-shadow-color': '#2b2a26', 'hillshade-highlight-color': '#ffffff' } }, 'amm-pts');
  map.addLayer({ id: 'buildings', type: 'fill-extrusion', source: 'ofm', 'source-layer': 'building', minzoom: 12.5, paint: {
    'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 6], 0, '#e6e1d6', 40, '#cfc9bd', 120, '#b9b3a7'],
    'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
    'fill-extrusion-opacity': .92 } }, 'amm-pts');
  map.addSource('catchment', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'catchment', type: 'line', source: 'catchment', paint: { 'line-color': '#FBFAF8', 'line-width': 1.4, 'line-dasharray': [3, 2], 'line-opacity': .8 } }, 'amm-pts');
  map.addSource('site-plant', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'site-plant', type: 'circle', source: 'site-plant', paint: { 'circle-radius': 9, 'circle-color': '#A6392A', 'circle-stroke-color': '#FBFAF8', 'circle-stroke-width': 2 } });
  // siting layers (data arrives per plant)
  ['dev', 'excl', 'layout'].forEach(s => map.addSource(s, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }));
  map.addLayer({ id: 'excl-fill', type: 'fill', source: 'excl', layout: { visibility: 'none' }, paint: { 'fill-color': ['match', ['get', 'class'],
    'structures', '#D55E00', 'roads', '#8A8F94', 'rails', '#4C5B6E', 'water', '#0072B2', 'landcover', '#009E73', 'natura', '#CC79A7', '#6B7379'], 'fill-opacity': .28 } }, 'amm-pts');
  map.addLayer({ id: 'dev-wind', type: 'fill', source: 'dev', filter: ['==', ['get', 'tech'], 'wind'], paint: { 'fill-color': '#56B4E9', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 10, .18, 14, .08] } }, 'amm-pts');
  map.addLayer({ id: 'dev-wind-line', type: 'line', source: 'dev', filter: ['==', ['get', 'tech'], 'wind'], paint: { 'line-color': '#56B4E9', 'line-width': .8, 'line-opacity': .7 } }, 'amm-pts');
  map.addLayer({ id: 'dev-solar', type: 'fill', source: 'dev', filter: ['==', ['get', 'tech'], 'solar'], layout: { visibility: 'none' }, paint: { 'fill-color': '#E69F00', 'fill-opacity': .16 } }, 'amm-pts');
  map.addLayer({ id: 'windland', type: 'fill', source: 'layout', filter: ['==', ['get', 'kind'], 'windland'], paint: { 'fill-color': '#0072B2', 'fill-opacity': .10 } }, 'amm-pts');
  map.addLayer({ id: 'pv-blocks', type: 'fill-extrusion', source: 'layout', filter: ['==', ['get', 'kind'], 'pv'], paint: {
    'fill-extrusion-color': '#1B3A5C', 'fill-extrusion-height': 3, 'fill-extrusion-opacity': .95 } }, 'amm-pts');
  map.addLayer({ id: 'turbine-dots', type: 'circle', source: 'layout', filter: ['==', ['get', 'kind'], 'turbine'], maxzoom: 10.5, paint: {
    'circle-radius': 3, 'circle-color': '#FBFAF8', 'circle-stroke-color': '#15181B', 'circle-stroke-width': .8 } });
  turbineLayer = makeTurbineLayer(); map.addLayer(turbineLayer);
}
async function openSite(idx, instant){
  if (!mapLoaded) { __sitePending = idx; return; }
  const p = PLANT[idx]; if (!p) return;
  siteIdx = idx; siteInfo = null; siteLayoutKey = null; document.body.classList.add('site-mode');
  show('globeView'); map.resize();
  ensureSiteBase();
  map.getSource('catchment').setData({ type: 'FeatureCollection', features: [circlePolygon(p.lon, p.lat, 25)] });
  map.getSource('site-plant').setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: {} }] });
  ['dev', 'excl', 'layout'].forEach(s => map.getSource(s).setData({ type: 'FeatureCollection', features: [] }));
  turbineLayer.setTurbines([], p);
  const mLon = 111320 * Math.cos(p.lat * Math.PI / 180), fo = (typeof facOffsetFor === 'function') ? facOffsetFor(idx) : { x: 650, z: 120 };
  const view = { center: [p.lon + (fo.x * 0.6) / mLon, p.lat - (fo.z * 0.6) / 110574], zoom: siteZoomFor(p.lat), pitch: 60, bearing: -25 };   // between the real plant and the new units
  if (instant) map.jumpTo(view); else map.flyTo({ ...view, duration: 3200, essential: true });
  renderSitePanel(p, null, 'loading');
  try {
    if (!window.__sitingIndex) { try { window.__sitingIndex = await fetchJSON(SITING_BASE + 'index.json'); } catch (e) { window.__sitingIndex = null; } }
    if (window.__sitingIndex && !window.__sitingIndex.plants.includes(idx) && p.custom) { try { window.__sitingIndex = await fetchJSON(SITING_BASE + 'index.json'); } catch (e) {} }   // a requested site's layers arrive minutes after its results: re-read the index
    if (window.__sitingIndex && !window.__sitingIndex.plants.includes(idx)) throw new Error('no siting layers');   // known absent: no probing request
    const r = await fetch(`${SITING_BASE}plant${idx}/site.json`);
    if (!r.ok) throw new Error(String(r.status));
    siteInfo = await r.json();
    if (siteIdx !== idx) return;
    const [dev, excl] = await Promise.all([fetch(`${SITING_BASE}plant${idx}/developable.geojson`).then(r => r.json()), fetch(`${SITING_BASE}plant${idx}/exclusions.geojson`).then(r => r.json())]);
    if (siteIdx !== idx) return;
    map.getSource('dev').setData(dev); map.getSource('excl').setData(excl);
  } catch (e) { siteInfo = null; }
  if (siteIdx !== idx) return;
  const pref = (curScn && curScn.plant === idx) ? { path: scnPathwayLabel(curScn), policy: curScn.policy || null, ci: curCItarget } : { path: 'SMR', policy: null, ci: null };
  siteLayoutKey = null; selectRun(pref.path, pref.policy, pref.ci);
  if (!renewOn) siteRenewables(false);
  if (typeof syncURL === 'function') syncURL();
}
/* ---- the run shown at a site: pathway × policy × CI (independent of whether siting layers exist) */
let siteRun = { path: 'SMR', policy: null, ci: null }, siteLayoutGeo = null, renewOn = true;
/* one switch for the whole renewable buildout: turbines (3D + dots), PV blocks, developable wind land */
function siteRenewables(on){
  renewOn = on;
  ['pv-blocks', 'turbine-dots', 'dev-wind', 'dev-wind-line', 'windland'].forEach(id => toggleSiteLayer(id, on));
  if (turbineLayer) turbineLayer.visible = on;
  map.triggerRepaint(); renderSitePanel(PLANT[siteIdx], layoutFor(siteRun.path, siteRun.ci), siteInfo ? 'ok' : 'none');
}
function siteScenarios(idx){ return SCN.filter(s => s.plant === idx && s.hb); }
function siteScn(idx, path, policy){ return siteScenarios(idx).find(s => scnPathwayLabel(s) === path && (s.policy || null) === (policy || null)) || null; }
function layoutFor(path, ci){
  if (!siteInfo) return null;
  const L = siteInfo.layouts.filter(l => l.path === path); if (!L.length) return null;
  return L.reduce((a, l) => Math.abs(l.ci - ci) < Math.abs(a.ci - ci) ? l : a, L[0]);
}
function selectRun(path, policy, ci){
  const idx = siteIdx; if (idx == null) return;
  let s = siteScn(idx, path, policy) || siteScn(idx, path, null) || siteScenarios(idx)[0]; if (!s) { renderSitePanel(PLANT[idx], null, siteInfo ? 'ok' : 'none'); return; }
  const rows = cappedRows(s); if (!rows.length) return;
  if (ci == null) ci = rows[lowestCostIdx(rows)].target;
  const r = rows.reduce((a, x) => Math.abs(x.target - ci) < Math.abs(a.target - ci) ? x : a, rows[0]);
  siteRun = { path: scnPathwayLabel(s), policy: s.policy || null, ci: r.target };
  curScn = s; curCItarget = r.target; curPlantIdx = idx;                       // the dashboard opens on the same run
  const l = layoutFor(siteRun.path, siteRun.ci);
  if (l && siteLayoutKey !== l.file) {
    siteLayoutKey = l.file;
    fetch(`${SITING_BASE}plant${idx}/${l.file}`).then(r => r.json()).then(gj => { if (siteIdx !== idx || siteLayoutKey !== l.file) return;
      siteLayoutGeo = gj; const shown = (typeof clipToPlot === 'function') ? clipToPlot(gj) : gj; map.getSource('layout').setData(shown); const tf = shown.features.filter(f => f.properties.kind === 'turbine'); turbineLayer.setTurbines(tf, PLANT[idx], siteInfo);
      map.once('idle', () => { if (siteIdx === idx && siteLayoutKey === l.file) turbineLayer.setTurbines(tf, PLANT[idx], siteInfo); }); });
  }
  if (typeof showFacility === 'function') showFacility(PLANT[idx], s, r.target);   // policy cases share the base design's dispatch
  renderSitePanel(PLANT[idx], l, siteInfo ? 'ok' : 'none');
  if (typeof syncURL === 'function') syncURL();
}
async function selectLayout(path, ci){ selectRun(path, siteRun.policy, ci); }
const LAYER_COMPANIONS = { 'dev-wind': ['dev-wind-line', 'windland'], 'excl-fill': ['excl-line'] };   // a checkbox drives the fill and its outline / the placed wind land together
function toggleSiteLayer(id, on){ [id, ...(LAYER_COMPANIONS[id] || [])].forEach(l => { if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', on ? 'visible' : 'none'); }); }
function renderSitePanel(p, l, state){
  const host = document.getElementById('sitePanel'); if (!host) return;
  host.hidden = false;
  const info = siteInfo, scns = siteScenarios(p.idx);
  const paths = [...new Set(scns.map(scnPathwayLabel))], policies = [null, ...new Set(scns.map(s => s.policy).filter(Boolean))];
  const s = siteScn(p.idx, siteRun.path, siteRun.policy), rows = s ? cappedRows(s) : [], r = rows.find(x => Math.abs(x.target - siteRun.ci) < 1e-6) || rows[0];
  const bau = s ? bauFor(s) : null, base = s && s.policy ? siteScn(p.idx, siteRun.path, null) : null;
  const baseRow = base ? cappedRows(base).find(x => Math.abs(x.target - siteRun.ci) < 1e-6) : null;
  let h = `<div class="sp-head" style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><div><div class="fp-h" style="margin-bottom:4px">Site</div><h2>${p.name}</h2><div class="sub">${p.custom ? '<span class="badge" style="background:' + CUSTOM_COLOR + ';color:#15181B">requested site</span> · ' : ''}${p.admin ? p.admin + ', ' : ''}${p.country} · ${fmt(p.ktpa)} ktpa NH₃ · ${p.lat.toFixed(3)}°, ${p.lon.toFixed(3)}°</div></div><span style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;max-width:52%"><button class="btn ghost sm" title="25 km catchment: developable land, turbines, PV" onclick="map.flyTo({center:[PLANT[siteIdx].lon,PLANT[siteIdx].lat],zoom:siteZoomFor(PLANT[siteIdx].lat)-3.9,pitch:55,bearing:-18,duration:1800})">Catchment</button><button class="btn ghost sm" title="Back to the plant" onclick="const p=PLANT[siteIdx],m=111320*Math.cos(p.lat*Math.PI/180),fo=facOffsetFor(p.idx);map.flyTo({center:[p.lon+fo.x*0.6/m,p.lat-fo.z*0.6/110574],zoom:siteZoomFor(p.lat),pitch:60,bearing:-25,duration:1800})">Plant</button><button class="btn ghost sm" onclick="leaveSite()">← Globe</button></span></div>`;
  if (state === 'loading') { h += `<p class="sub" style="margin-top:12px">Loading …</p>`; host.innerHTML = h; return; }
  // the run: pathway × policy × CI
  h += `<div class="fin-group" style="margin-top:12px"><div class="fp-h">Run</div>
    <div class="ci-bar" style="margin:0 0 4px"><span class="lbl">Pathway</span>${paths.map(pt => `<button class="ci-pill sm ${siteRun.path === pt ? 'active' : ''}" onclick="selectRun('${pt}',siteRun.policy,siteRun.ci)">${pt.replace('+CCS', ' +CCS')}</button>`).join('')}</div>
    <div class="ci-bar" style="margin:0 0 4px"><span class="lbl">Policy</span>${policies.map(pol => `<button class="ci-pill sm ${(siteRun.policy || null) === pol ? 'active' : ''}" onclick="selectRun(siteRun.path,${pol ? "'" + pol + "'" : 'null'},siteRun.ci)">${pol ? policyLabel(pol) : 'None (base)'}</button>`).join('')}</div>
    <div class="ci-bar" style="margin:0 0 4px"><span class="lbl">CI target</span>${rows.map(x => `<button class="ci-pill sm ${Math.abs(x.target - siteRun.ci) < 1e-6 ? 'active' : ''}" title="LCOA ${fmt(x.lcoa)} $/t" onclick="selectRun(siteRun.path,siteRun.policy,${x.target})">${x.target.toFixed(2)}${x === rows[lowestCostIdx(rows)] ? ' ★' : ''}</button>`).join('')}</div>
    ${(typeof lcoaBasisToggle === 'function') ? lcoaBasisToggle(true) : ''}</div>`;
  // headline results of that run
  if (r) {
    const d = bau ? r.lcoa - bau.lcoa : null;
    h += `<div class="site-kpis">
      <div><div class="l">${(typeof lcoaLabel === 'function') ? lcoaLabel() : 'LCOA'}</div><div class="v">${fmt(r.lcoa)}<small> $/t</small></div><div class="d">${bau ? (d <= 0 ? '−' : '+') + fmt(Math.abs(d)) + ' vs BAU ' + fmt(bau.lcoa) : ''}${baseRow ? ' · base case ' + fmt(baseRow.lcoa) : ''}${s.policy && r.ets_credit != null ? ' · ETS ' + fmt(r.ets_credit) + ' $/t' : ''}${s.policy && r.us_credit != null ? ' · credit ' + fmt(r.us_credit) + ' $/t' : ''}</div></div>
      <div><div class="l">Carbon intensity</div><div class="v">${(s.ccs ? r.ci_ccs : r.ci_noccs).toFixed(2)}<small> t/t</small></div><div class="d">target ${r.target.toFixed(2)} · BAU ${bau ? bau.ci.toFixed(2) : '—'}${s.ccs ? ' · capture ' + fmt(r.cap_rate) + '%' : ''}</div></div>
      <div><div class="l">Renewables</div><div class="v">${fmt(r.p_wt)}<small> MW wind</small></div><div class="d">${fmt(r.p_pv)} MW PV · ${fmt(r.p_b)} MW battery · ${fmt((r.e_pv + r.e_wt) / 1000)} GWh/yr</div></div>
      <div><div class="l">Hydrogen</div><div class="v">${fmt(r.p_el)}<small> MW electrolysis</small></div><div class="d">${fmt(r.p_smr)} t H₂/d reformer · ${fmt(r.h2_el / (r.h2_el + r.h2_smr || 1) * 100)}% electrolytic · ${fmt(r.p_st)} t storage</div></div>
      <div><div class="l">Grid</div><div class="v">${fmt(r.e_imp / 1000)}<small> GWh import</small></div><div class="d">${fmt((r.e_exp || 0) / 1000)} GWh export · ${fmt(r.elec_int, 1)} MWh/t</div></div>
      <div><div class="l">Project IRR</div><div class="v">${r.irr != null ? r.irr.toFixed(1) : '—'}<small> %</small></div><div class="d">${s.policy ? 'base solve (policy case not re-optimised)' : 'optimizer objective'} · CAPEX $${fmt((r.capex_overnight || 0) / 1e9, 2)} bn</div></div>
    </div>`;
  }
  // siting
  if (state === 'none') h += `<p class="sub" style="margin:4px 0 8px">Siting layers have not been computed for this plant yet — the catchment, terrain and buildings are shown; the renewable footprint appears once the fleet siting job has run for plant ${p.idx}.</p>`;
  else if (l) h += `<div class="fin-group"><div class="fp-h">Renewable footprint · ${info.setback_scenario} setbacks</div><div class="site-kpis">
      <div><div class="l">Wind placed</div><div class="v">${fmt(l.wind_mw_placed)}<small> MW</small></div><div class="d">${l.turbines} × ${info.turbine_mw} MW · hub ${info.hub_m} m · rotor ${info.rotor_m} m${l.wind_short ? ' · <b style="color:var(--rust)">short of ' + fmt(l.wind_mw_target) + ' MW</b>' : ''}</div></div>
      <div><div class="l">Solar placed</div><div class="v">${fmt(l.pv_mw_placed)}<small> MW</small></div><div class="d">${l.pv_km2} km² at ${info.rho_pv_mw_km2} MW/km²${l.pv_short ? ' · <b style="color:var(--rust)">short of ' + fmt(l.pv_mw_target) + ' MW</b>' : ''}</div></div>
      <div><div class="l">Developable land</div><div class="v">${fmt(info.developable_km2.wind)}<small> km²</small></div><div class="d">wind after setbacks · ${fmt(info.developable_km2.solar)} km² solar</div></div>
      <div><div class="l">Fits within 25 km?</div><div class="v">${(l.wind_short || l.pv_short) ? 'No' : 'Yes'}</div><div class="d">${info.max_turbines} positions at ${fmt(info.spacing_m)} m spacing</div></div></div></div>`;
  if (state !== 'none') h += `<div class="fin-group"><div class="fp-h">Layers</div>
      ${[['pv-blocks', 'PV blocks (buildout)', '#1B3A5C', renewOn], ['turbine-dots', 'Turbines (buildout)', '#FBFAF8', renewOn], ['dev-wind', 'Developable — wind', '#56B4E9', renewOn], ['dev-solar', 'Developable — solar', '#E69F00', false], ['excl-fill', 'Exclusions by class', '#D55E00', false], ['buildings', 'Buildings (OSM, 3D)', '#cfc9bd', true]]
        .map(([id, n, c, on]) => `<label class="legend-row" style="cursor:pointer"><input type="checkbox" ${(map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none') ? 'checked' : ''} onchange="toggleSiteLayer('${id}',this.checked);if('${id}'==='turbine-dots')turbineLayer.visible=this.checked;map.triggerRepaint()"><span class="dot" style="background:${c}"></span>${n}</label>`).join('')}
      <div class="sub" style="margin-top:6px">Exclusions: <span style="color:#D55E00">■</span> structures · <span style="color:#8A8F94">■</span> roads · <span style="color:#4C5B6E">■</span> rail · <span style="color:#0072B2">■</span> water · <span style="color:#009E73">■</span> forest/land use · <span style="color:#CC79A7">■</span> Natura 2000 — each buffered by the wind setback.</div></div>`;
  h += `<div class="sp-actions"><button class="btn" onclick="openDashboard(${p.idx})">Technical results →</button><button class="btn ghost" onclick="FAC.on?hideFacility():selectRun(siteRun.path,siteRun.policy,siteRun.ci)">${(typeof FAC !== 'undefined' && FAC.on) ? 'Hide plant' : 'Show plant'}</button>${state !== 'none' ? `<button class="btn ghost" onclick="siteRenewables(${!renewOn})">${renewOn ? 'Hide renewables' : 'Show renewables'}</button>` : ''}</div>`;
  if (p.custom && p.skipped && Object.values(p.skipped).some(m => Object.keys(m).length)) h += `<div class="sub" style="margin-top:8px;color:var(--rust)">Not solvable at the NH₃ price (no design earns a positive return, so the IRR objective has no solution — these points are absent, as in the fleet runs): ${Object.entries(p.skipped).filter(([, m]) => Object.keys(m).length).map(([c, m]) => (c === 'Yes' ? 'SMR +CCS' : 'SMR') + ' CI ' + Object.keys(m).sort().join(', ')).join(' · ')}.</div>`;
  if (p.custom) h += `<div class="sub" style="margin-top:8px">Solved from a run request${p.spec && p.spec.requested ? ' of ' + p.spec.requested : ''}${p.spec && p.spec.technical_changed && Object.keys(p.spec.technical_changed).length ? ' · changed assumptions: ' + Object.entries(p.spec.technical_changed).map(([k, v]) => k + '=' + v).join(', ') : ' · model default assumptions'}. ${reqToken(p.idx - 1000) ? `<button class="btn ghost sm" style="color:var(--rust)" onclick="removeSite(${p.idx})">Remove this site</button> (you requested it from this browser; removal takes ~2 minutes)` : `<a href="${removeIssueURL(p)}" target="_blank" rel="noopener">Remove this site</a> (repository owner only; requesters can remove their own sites from the browser they used).`}</div>`;
  h += `<div class="sub" style="margin-top:10px;font-size:11px">Imagery Esri World Imagery · terrain Mapzen/AWS · buildings OpenStreetMap via OpenFreeMap · siting: HOPS land model (OSM + Natura 2000 exclusions)</div>`;
  host.innerHTML = h;
}
function leaveSite(){
  if (typeof hideFacility === 'function') hideFacility();
  if (PENDING.open) closePending(false);
  siteIdx = null; siteInfo = null; document.getElementById('sitePanel').hidden = true; document.body.classList.remove('site-mode');
  if (turbineLayer) turbineLayer.setTurbines([], null);
  ['dev', 'excl', 'layout', 'catchment', 'site-plant'].forEach(s => map.getSource(s) && map.getSource(s).setData({ type: 'FeatureCollection', features: [] }));
  map.flyTo({ zoom: GLOBE_ZOOM, pitch: 0, bearing: 0, duration: 2200 });
  if (typeof syncURL === 'function') syncURL();
}

/* ---------------------------------------------------------------- turbines: three.js custom layer (hub height + rotor from the siting model) */
function makeTurbineLayer(){
  const L = {
    id: 'turbines-3d', type: 'custom', renderingMode: '3d', visible: true, n: 0,
    onAdd(map, gl){
      this.map = map; this.camera = new THREE.Camera(); this.scene = new THREE.Scene();
      this.ambL = new THREE.AmbientLight(0xffffff, .75); this.scene.add(this.ambL);
      this.sunL = new THREE.DirectionalLight(0xffffff, .9); this.sunL.position.set(-.6, 1, .5); this.scene.add(this.sunL); this.daylight = 1;
      this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true }); this.renderer.autoClear = false;
      this.group = new THREE.Group(); this.scene.add(this.group); this.t0 = performance.now();
    },
    setTurbines(feats, plant, info){
      this.group.clear(); this.n = feats.length; this.blades = null;
      if (!feats.length || !plant) { this.map.triggerRepaint(); return; }
      const hub = (info && info.hub_m) || 120, rotor = (info && info.rotor_m) || 150, R = rotor / 2;
      this.origin = maplibregl.MercatorCoordinate.fromLngLat([plant.lon, plant.lat], 0);
      this.scale = this.origin.meterInMercatorCoordinateUnits();
      const mPerLat = 110574, mPerLon = 111320 * Math.cos(plant.lat * Math.PI / 180);
      const pos = feats.map(f => { const [lon, lat] = f.geometry.coordinates; const z = this.map.queryTerrainElevation({ lng: lon, lat }) || 0;
        return [(lon - plant.lon) * mPerLon, z, -(lat - plant.lat) * mPerLat]; });   // local: x east, y up, z south (metres)
      const white = new THREE.MeshLambertMaterial({ color: 0xf2f2ee }), grey = new THREE.MeshLambertMaterial({ color: 0xd8d8d2 });
      const tower = new THREE.InstancedMesh(new THREE.CylinderGeometry(2.2, 4.2, hub, 10).translate(0, hub / 2, 0), white, pos.length);
      const nac = new THREE.InstancedMesh(new THREE.BoxGeometry(12, 4.5, 4.5).translate(2, hub, 0), grey, pos.length);
      const hubm = new THREE.InstancedMesh(new THREE.SphereGeometry(2.4, 10, 8).translate(-4.5, hub, 0), grey, pos.length);
      const blade = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, R, 3.2).translate(0, R / 2, 0), white, pos.length * 3);
      const m = new THREE.Matrix4();
      pos.forEach((p, i) => { m.makeTranslation(p[0], p[1], p[2]); tower.setMatrixAt(i, m); nac.setMatrixAt(i, m); hubm.setMatrixAt(i, m); });
      tower.instanceMatrix.needsUpdate = nac.instanceMatrix.needsUpdate = hubm.instanceMatrix.needsUpdate = true;
      this.group.add(tower, nac, hubm, blade); this.blades = blade; this.pos = pos; this.hub = hub;
      this.phase = pos.map((_, i) => (i * 1.37) % (2 * Math.PI)); this.map.triggerRepaint();
    },
    render(gl, args){
      if (!this.n || !this.visible || !this.origin) return;
      this.ambL.intensity = .75 * this.daylight; this.sunL.intensity = .9 * this.daylight;
      const proj = (args && args.defaultProjectionData) ? args.defaultProjectionData.mainMatrix : args;
      const M = new THREE.Matrix4().fromArray(proj);
      const Lm = new THREE.Matrix4().makeTranslation(this.origin.x, this.origin.y, this.origin.z)
        .scale(new THREE.Vector3(this.scale, -this.scale, this.scale)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
      this.camera.projectionMatrix = M.multiply(Lm);
      if (this.blades) { // rotor spins about the east–west axis (nacelle faces west)
        const now = performance.now(); this.angle = (this.angle || 0) + (now - (this.tLast || now)) / 1000 * 0.9 * (this.speed || 1); this.tLast = now;
      const t = this.angle / 0.9, m = new THREE.Matrix4(), r = new THREE.Matrix4(), tr = new THREE.Matrix4();
        this.pos.forEach((p, i) => { for (let b = 0; b < 3; b++) {
          tr.makeTranslation(p[0] - 4.5, p[1] + this.hub, p[2]); r.makeRotationX(t * 0.9 + this.phase[i] + b * 2 * Math.PI / 3);
          m.multiplyMatrices(tr, r); this.blades.setMatrixAt(i * 3 + b, m); } });
        this.blades.instanceMatrix.needsUpdate = true;
      }
      this.renderer.resetState(); this.renderer.render(this.scene, this.camera); this.map.triggerRepaint();
    }
  };
  return L;
}

/* ---------------------------------------------------------------- requested sites: open "Run request" issues = plants under construction
   Read from the public GitHub API (no token: 60 requests/h per visitor — hence one request per 2-minute poll). A request appears on the
   globe the moment its issue exists, its site view shows the construction scene, and the progress comes from the Actions run that the
   cloud solver links in its first comment (per-job status = which CI points are already solved). When the run is published the
   site is reloaded and it opens as a normal (requested, solved) plant. */
const CUSTOM_COLOR = '#CC79A7', PENDING_COLOR = '#F0E442', GH_API = 'https://api.github.com/repos/yasch00/HOPS-Tool-LiveV1';
const PENDING = { list: [], open: null, timer: null, run: null };
async function gh(path){ const r = await fetch(GH_API + path, { headers: { Accept: 'application/vnd.github+json' } }); if (!r.ok) throw new Error('GitHub ' + r.status); return r.json(); }
function parseRequest(it){
  const m = (it.body || '').match(/```json\s*(\{[\s\S]*?\})\s*```/); if (!m) return null;
  try { const spec = JSON.parse(m[1]); if (!spec.site || !isFinite(spec.site.lat)) return null;
    return { issue: it.number, idx: 1000 + it.number, name: spec.site.name || `Site ${1000 + it.number}`, lat: +spec.site.lat, lon: +spec.site.lon, country: spec.site.country || '', tpd: +spec.plant.tNH3_day || 0, ktpa: (+spec.plant.tNH3_day || 0) * 365 / 1000, spec, opened: it.created_at, url: it.html_url, custom: true, pending: true };
  } catch (e) { return null; }
}
async function loadPending(){
  try {
    const items = await gh('/issues?state=open&per_page=50');
    const fresh = items.filter(it => !it.pull_request && /^run request/i.test(it.title || '')).map(parseRequest).filter(Boolean).filter(r => !PLANT[r.idx]);   // already published → shown as a plant
    const keep = PENDING.list.filter(r => r.local && Date.now() - r.local < 10 * 60000 && !fresh.some(f => f.issue === r.issue) && !PLANT[r.idx]);   // just submitted here, not yet in GitHub's cached list
    PENDING.list = fresh.concat(keep);
  } catch (e) { PENDING.list = []; }
  if (map.getSource('pending')) map.getSource('pending').setData(plantsGeo(PENDING.list, r => ({ issue: r.issue, name: r.name, tpd: r.tpd })));
  const el = document.getElementById('legendPending'); if (el) el.textContent = `Under construction (${PENDING.list.length} request${PENDING.list.length === 1 ? '' : 's'})`;
  return PENDING.list;
}
async function openPending(issue){
  if (!mapLoaded) { map.once('load', () => setTimeout(() => openPending(issue), 50)); return; }
  let r = PENDING.list.find(x => x.issue === issue); if (!r) { await loadPending(); r = PENDING.list.find(x => x.issue === issue); } if (!r) return;
  if (siteIdx != null || PENDING.open) leaveSiteQuiet();
  if (typeof BUILD !== 'undefined' && BUILD.on) leaveBuild();
  PENDING.open = r; PENDING.run = null; document.body.classList.add('site-mode'); show('globeView'); map.resize();
  ensureSiteBase();
  map.getSource('catchment').setData({ type: 'FeatureCollection', features: [circlePolygon(r.lon, r.lat, 25)] });
  map.getSource('site-plant').setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [r.lon, r.lat] }, properties: {} }] });
  ['dev', 'excl', 'layout'].forEach(s => map.getSource(s).setData({ type: 'FeatureCollection', features: [] }));
  const mLon = 111320 * Math.cos(r.lat * Math.PI / 180), fo = (typeof facOffsetFor === 'function') ? facOffsetFor(r.idx) : { x: 650, z: 120 };
  map.flyTo({ center: [r.lon + (fo.x * 0.6) / mLon, r.lat - (fo.z * 0.6) / 110574], zoom: siteZoomFor(r.lat), pitch: 60, bearing: -25, duration: 3200, essential: true });
  renderPendingPanel(r, null);
  if (typeof showConstruction === 'function') showConstruction(r, 0.02);
  await refreshPendingProgress();
  clearInterval(PENDING.timer); PENDING.timer = setInterval(refreshPendingProgress, 120000);   // 1 API call per poll → 30/h, under the anonymous limit of 60/h
  if (typeof syncURL === 'function') syncURL();
}
function leaveSiteQuiet(){ const f = map.flyTo; map.flyTo = () => {}; try { if (PENDING.open) closePending(false); else leaveSite(); } finally { map.flyTo = f; } }
function closePending(fly = true){
  clearInterval(PENDING.timer); PENDING.timer = null; PENDING.open = null; PENDING.run = null;
  if (typeof hideFacility === 'function') hideFacility();
  document.getElementById('sitePanel').hidden = true; document.body.classList.remove('site-mode');
  ['catchment', 'site-plant'].forEach(s => map.getSource(s) && map.getSource(s).setData({ type: 'FeatureCollection', features: [] }));
  if (fly) { map.flyTo({ zoom: GLOBE_ZOOM, pitch: 0, bearing: 0, duration: 2200 }); if (typeof syncURL === 'function') syncURL(); }
}
/* progress of the cloud run: the solver's first comment links actions/runs/<id>; its jobs tell which CI points are done */
async function refreshPendingProgress(){
  const r = PENDING.open; if (!r) return;
  let run = null;
  try {
    if (!r.runId) {                                                          // once: find the run the solver linked on the issue
      const comments = await gh(`/issues/${r.issue}/comments?per_page=50`);
      const link = comments.map(c => (c.body || '').match(/actions\/runs\/(\d+)/)).filter(Boolean).pop();
      if (comments.some(c => /Solved and published/.test(c.body || ''))) r.published = true;
      if (link) r.runId = link[1];
    }
    if (r.published) run = { state: 'published' };
    else if (r.runId) {                                                      // then one request per poll: the jobs carry everything
      const jobs = (await gh(`/actions/runs/${r.runId}/jobs?per_page=100`)).jobs;
      const J = jobs.map(j => ({ name: j.name, status: j.status, conclusion: j.conclusion, started: j.started_at }));
      const solves = J.filter(j => /^solve/.test(j.name)), done = solves.filter(j => j.status === 'completed' && j.conclusion === 'success').length;
      const failed = J.filter(j => j.conclusion === 'failure').length, allDone = J.length && J.every(j => j.status === 'completed');
      const pub = J.find(j => /^publish/.test(j.name)), sit = J.find(j => /^siting/.test(j.name));
      const stage = sit && sit.status !== 'queued' ? 'siting' : pub && pub.status !== 'queued' ? 'publish' : solves.some(j => j.status !== 'queued') ? 'solve' : 'queued';
      const started = J.map(j => j.started).filter(Boolean).sort()[0];
      run = { state: allDone ? ((pub && pub.conclusion === 'success') ? 'done' : 'failed') : (pub && pub.conclusion === 'success') ? 'done' : 'running', id: r.runId, url: `https://github.com/yasch00/HOPS-Tool-LiveV1/actions/runs/${r.runId}`, started, done, total: solves.length || 17, failed, jobs: solves, stage,
              progress: Math.min(0.97, 0.03 + 0.85 * (solves.length ? done / solves.length : 0) + (stage === 'publish' ? 0.05 : stage === 'siting' ? 0.09 : 0)) };
    } else run = { state: 'waiting' };
  } catch (e) { run = /404/.test(String(e.message)) && r.runId ? { state: 'gone' } : { state: 'unknown', error: String(e.message || e) }; }
  if (PENDING.open !== r) return;
  PENDING.run = run; renderPendingPanel(r, run);
  if (typeof setConstructionProgress === 'function') setConstructionProgress(run.progress != null ? run.progress : 0.02);
  if (run.state === 'published' || run.state === 'done') {                       // the data is on the site: reload and open it as a solved plant
    clearInterval(PENDING.timer); PENDING.timer = null;
    setTimeout(async () => { try { await loadData(); } catch (e) {} if (PLANT[r.idx]) { closePending(false); await loadPending(); openSite(r.idx, true); } }, 4000);
  }
}
function ciOf(j){ const m = j.name.match(/\(([^,]+),\s*([^)]+)\)/); return m ? { ccs: m[1].trim(), ci: m[2].trim() } : null; }
function renderPendingPanel(r, run){
  const host = document.getElementById('sitePanel'); if (!host) return; host.hidden = false;
  const T = r.spec.technical_changed || {}, nT = Object.keys(T).length;
  let h = `<div class="sp-head" style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><div><div class="fp-h" style="margin-bottom:4px">Site · under construction</div><h2>${r.name}</h2>
    <div class="sub"><span class="badge" style="background:${PENDING_COLOR};color:#15181B">solving</span> · ${r.country || '—'} · ${fmt(r.ktpa)} ktpa NH₃ (${fmt(r.tpd)} t/d) · ${r.lat.toFixed(3)}°, ${r.lon.toFixed(3)}°</div></div>
    <span style="display:flex;gap:4px"><button class="btn ghost sm" onclick="closePending()">← Globe</button></span></div>`;
  h += `<div class="fin-group" style="margin-top:12px"><div class="fp-h">Request</div><div class="sub">Opened ${r.opened.slice(0, 10)} as <a href="${r.url}" target="_blank" rel="noopener">#${r.issue}</a> · will publish as site ${r.idx} · both pathways, CI 0 – 1.75, BAU reference, policy cases, then the siting layers.<br>${nT ? 'Changed assumptions: ' + Object.entries(T).map(([k, v]) => k + '=' + v).join(', ') : 'Model default assumptions'}${r.spec.proxy ? ' · proxy estimate from ' + r.spec.proxy.name + ': ' + fmt(r.spec.proxy.lcoa) + ' $/t at CI ' + (+r.spec.proxy.ci).toFixed(2) : ''}</div></div>`;
  if (!run) h += `<div class="fin-group"><div class="fp-h">Progress</div><p class="sub">Checking the solver …</p></div>`;
  else if (run.state === 'waiting') h += `<div class="fin-group"><div class="fp-h">Progress</div><p class="sub">Queued — the cloud solver has not picked the request up yet (it starts within a minute of the request if the workflow is enabled; otherwise the local worker or a manual run publishes it).</p></div>`;
  else if (run.state === 'published' || run.state === 'done') h += `<div class="fin-group"><div class="fp-h">Progress</div><p class="sub">Published — loading the results …</p></div>`;
  else if (run.state === 'gone') h += `<div class="fin-group"><div class="fp-h">Progress</div><p class="sub" style="color:var(--rust)">The solver run linked from this request no longer exists (deleted from the Actions page), so nothing is being solved. The request itself is still open, which is why the site is shown here: deleting a run does not delete a request. Remove it with "Stop &amp; cancel" below, or — as the repository owner — close <a href="${r.url}" target="_blank" rel="noopener">#${r.issue}</a> on GitHub as "not planned". To solve it after all: Actions → solve run request → Run workflow with issue ${r.issue}.</p></div>`;
  else if (run.state === 'unknown') h += `<div class="fin-group"><div class="fp-h">Progress</div><p class="sub">Could not read the progress (${run.error}). The GitHub API allows 60 anonymous requests per hour; try again in a while.</p></div>`;
  else {
    const pct = Math.round((run.progress || 0) * 100), el = run.started ? Math.round((Date.now() - new Date(run.started)) / 60000) : null;
    h += `<div class="fin-group"><div class="fp-h">Progress · ${pct}%</div>
      <div style="height:8px;border-radius:4px;background:rgba(255,255,255,.12);overflow:hidden;margin:6px 0"><div style="height:100%;width:${pct}%;background:${PENDING_COLOR};transition:width .8s"></div></div>
      <div class="sub">${run.state === 'failed' ? '<b style="color:var(--rust)">A step failed</b> — ' : ''}${run.done}/${run.total} CI points solved${run.failed ? ' · ' + run.failed + ' failed' : ''} · stage: ${({ queued: 'waiting for a runner', solve: 'solving the CI sweep (all points in parallel)', publish: 'BAU + policy cases → publishing', siting: 'renewable siting layers' })[run.stage] || run.stage}${el != null ? ' · running ' + el + ' min' : ''} · <a href="${run.url}" target="_blank" rel="noopener">log</a></div>
      <div class="ci-bar" style="margin:8px 0 0;flex-wrap:wrap"><span class="lbl">Points</span>${run.jobs.map(j => { const c = ciOf(j), ok = j.status === 'completed' && j.conclusion === 'success', bad = j.conclusion === 'failure', on = j.status === 'in_progress';
        return `<span class="ci-pill sm" style="cursor:default;${ok ? 'background:' + PENDING_COLOR + ';color:#15181B;border-color:' + PENDING_COLOR : bad ? 'border-color:var(--rust);color:var(--rust)' : on ? 'border-color:' + PENDING_COLOR : 'opacity:.55'}" title="${j.name} · ${j.status}${j.conclusion ? ' · ' + j.conclusion : ''}">${c ? (c.ci === 'BAU' ? 'BAU' : c.ci + (c.ccs === 'Yes' ? ' +CCS' : '')) : j.name}</span>`; }).join('')}</div>
      <div class="sub" style="margin-top:6px">Every CI point is its own parallel job, so the whole sweep finishes in about the time of one solve; the results are published together once BAU and the policy cases are done.</div></div>`;
  }
  h += `<div class="sp-actions"><button class="btn ghost" onclick="refreshPendingProgress()">Refresh</button><button class="btn ghost" onclick="map.easeTo({pitch:0,bearing:0,duration:900})">Top</button><button class="btn ghost" onclick="map.easeTo({pitch:60,bearing:map.getBearing()+45,duration:900})">↻</button>${reqToken(r.issue) ? `<button class="btn ghost" style="color:var(--rust)" onclick="cancelRequest(${r.issue})">Stop &amp; cancel</button>` : ''}</div>
    <div class="sub" id="pendingMsg" style="margin-top:6px">${reqToken(r.issue) ? 'You requested this site from this browser: "Stop &amp; cancel" ends the solve and removes the construction site.' : `Requested from another browser — only its requester, or the repository owner (close <a href="${r.url}" target="_blank" rel="noopener">#${r.issue}</a> as "not planned"), can stop it.`}</div>
    <div class="sub" style="margin-top:10px;font-size:11px">The construction scene stands where the plant will: foundations are poured as CI points are solved; cranes, trucks and the excavator keep working while the solver runs.</div>`;
  host.innerHTML = h;
}
function removeIssueURL(p){
  const title = `Remove request: site ${p.idx}`, body = `Remove requested site **${p.idx}** (${p.name}, ${p.lat}, ${p.lon}) from the atlas — data, runs and siting layers.\n\n_Executed by .github/workflows/remove.yml when opened by the repository owner._`;
  return `https://github.com/yasch00/HOPS-Tool-LiveV1/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

/* ---------------------------------------------------------------- the requester's own control over a request: tokens from the request worker
   (kept in this browser only) let the person who submitted a site stop its solve or remove it after publication. */
function reqTokens(){ try { return JSON.parse(localStorage.getItem('hops_req_tokens') || '{}'); } catch (e) { return {}; } }
function reqToken(issue){ return reqTokens()[issue] || null; }
function saveReqToken(issue, token){ try { const t = reqTokens(); t[issue] = token; localStorage.setItem('hops_req_tokens', JSON.stringify(t)); } catch (e) {} }
async function workerCall(payload){
  const ep = (typeof REQUEST_ENDPOINT !== 'undefined' && REQUEST_ENDPOINT) || window.HOPS_REQUEST_ENDPOINT; if (!ep) throw new Error('no request endpoint configured');
  const r = await fetch(ep, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const j = await r.json().catch(() => ({})); if (!r.ok || j.error) throw new Error(j.error || ('HTTP ' + r.status)); return j;
}
async function cancelRequest(issue){
  if (!confirm(`Stop the solve for request #${issue} and remove the construction site?`)) return;
  const msg = document.getElementById('pendingMsg'); if (msg) msg.textContent = 'Cancelling …';
  try {
    await workerCall({ action: 'cancel', issue, token: reqToken(issue) });
    PENDING.list = PENDING.list.filter(x => x.issue !== issue);
    if (map.getSource('pending')) map.getSource('pending').setData(plantsGeo(PENDING.list, r => ({ issue: r.issue, name: r.name, tpd: r.tpd })));
    const el = document.getElementById('legendPending'); if (el) el.textContent = `Under construction (${PENDING.list.length} request${PENDING.list.length === 1 ? '' : 's'})`;
    closePending(true);
  } catch (e) { if (msg) msg.innerHTML = `Could not cancel: ${e.message}. The repository owner can close <a href="https://github.com/yasch00/HOPS-Tool-LiveV1/issues/${issue}" target="_blank" rel="noopener">#${issue}</a> as "not planned".`; }
}
async function removeSite(idx){
  if (!confirm(`Remove site ${idx} — its results, runs and siting layers — from the atlas? This cannot be undone.`)) return;
  const host = document.getElementById('sitePanel');
  try {
    const j = await workerCall({ action: 'remove', site: idx, token: reqToken(idx - 1000) });
    leaveSite();
    alert(`Removal queued (#${j.issue}). Site ${idx} disappears from the globe in about two minutes; reload the page afterwards.`);
  } catch (e) { alert(`Could not remove: ${e.message}`); }
}
