/* Project Finance page (version 6) — plant picker, case bar, deal overview (hub diagram), detail windows and the
   "adjust the deal" sliders. Numbers come from data/finance/ (tools/bu_finance_to_web.py) and finance/engine.js
   (port of build_bu_finance.py plus the negotiation). Unit pictures: finance/units3d.js (the tool's plant scene). */
(function () {
  'use strict';
  const DATA = (window.HOPS_DATA_BASE || '../data/') + 'finance/';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const num = v => (typeof v === 'number' && isFinite(v) ? v : 0);
  const MARKET = { US: 450, Canada: 450, India: 500, Europe: 660 };          // same starting prices as the atlas finance tab
  const REGION_ORDER = ['Europe', 'US', 'Canada', 'India'];
  const PAGE_VERSION = 6;      // shown in the footer: tells at a glance which version of the page a browser is running
  const EXP_REAL = 1.0;        // exports valued at the full wholesale price (user decision 2026-11-14)
  const HMIN = 0.12;           // every party at least 12 % on equity (user, 2026-11-17)
  const NOISE = 1e-3;
  const UNIT_SHORT = { RES: 'Renewables', BAT: 'Battery', HB: 'Heat battery', EL: 'Electrolyzer', H2ST: 'Hydrogen storage', ASU: 'Air separation', NH3: 'Ammonia plant', OPR: 'Operator' };
  const UNIT_SUB = { RES: 'PV + wind', BAT: '', HB: '', EL: '', H2ST: 'compressor + tank', ASU: 'nitrogen', NH3: 'SMR + synthesis', OPR: 'the optimizer' };
  const BUILD_TXT = { GF: 'Greenfield · new plant', RETRO: 'Retrofit · existing plant' };
  const MODE_TXT = { nash: 'Nash optimum (equal power)', nashEq: 'Nash optimum (power ∝ equity)', operator: 'Operator optimum', cost: 'Cost-reflective cascade', custom: 'Your rates' };
  const RATE_SHORT = {
    r_RES: 'Sells electricity (PPA)', r_B_in: 'Buys charging electricity', r_B_out: 'Sells discharged electricity', r_B_cap: 'Availability payment',
    r_HB_in: 'Buys electricity', r_heat: 'Sells heat', r_EL_in: 'Buys electricity', r_H2_EL: 'Sells hydrogen',
    r_ST_e: 'Buys compression electricity', r_ST_in: 'Buys hydrogen (into store)', r_ST_out: 'Sells hydrogen (out of store)',
    r_ASU_e: 'Buys electricity', r_N2: 'Sells nitrogen',
    r_NH3_e: 'Buys electricity', r_H2_NH3: 'Buys green hydrogen', r_heat_NH3: 'Buys heat', r_N2_NH3: 'Buys nitrogen',
    p_NG: 'Buys natural gas (market)', p_NH3: 'Sells ammonia (market price)'
  };
  const ADJ = { RES: ['r_RES'], BAT: ['r_B_out', 'r_B_in', 'r_B_cap'], HB: ['r_heat', 'r_HB_in'], EL: ['r_H2_EL', 'r_EL_in'],
    H2ST: ['r_ST_out', 'r_ST_in', 'r_ST_e'], ASU: ['r_N2', 'r_ASU_e'], NH3: ['r_H2_NH3', 'r_NH3_e', 'r_heat_NH3', 'r_N2_NH3', 'p_NG', 'p_NH3'], OPR: [] };
  const RATE_VOL = { r_RES: 'E_RES_paid', r_B_in: 'E_B_in', r_B_out: 'E_B_out', r_B_cap: 'P_B_MWh', r_HB_in: 'E_HB_in', r_heat: 'H_HB_out', r_EL_in: 'E_EL', r_H2_EL: 'H2_EL_kg',
    r_ST_e: 'E_CP', r_ST_in: 'H2_ST_in_kg', r_ST_out: 'H2_ST_out_kg', r_ASU_e: 'E_ASU', r_N2: 'N2_ASU_t', r_NH3_e: 'E_NH3plant', r_H2_NH3: 'H2_green_NH3_kg',
    r_heat_NH3: 'H_HB_out', r_N2_NH3: 'N2_ASU_t', p_NG: 'NG_MWh', p_NH3: 'NH3_t' };
  // flows on the wires of the hub diagram: rate, direction seen from the unit, commodity, short label
  const FLOWS = {
    RES: [['r_RES', 'sells', 'elec', 'power']],
    BAT: [['r_B_out', 'sells', 'elec', 'power'], ['r_B_in', 'buys', 'elec', 'charge']],
    HB: [['r_heat', 'sells', 'heat', 'heat'], ['r_HB_in', 'buys', 'elec', 'power']],
    EL: [['r_H2_EL', 'sells', 'h2', 'H₂'], ['r_EL_in', 'buys', 'elec', 'power']],
    H2ST: [['r_ST_out', 'sells', 'h2', 'H₂ out'], ['r_ST_in', 'buys', 'h2', 'H₂ in'], ['r_ST_e', 'buys', 'elec', 'power']],
    ASU: [['r_N2', 'sells', 'n2', 'N₂'], ['r_ASU_e', 'buys', 'elec', 'power']],
    NH3: [['r_H2_NH3', 'buys', 'h2', 'H₂'], ['r_NH3_e', 'buys', 'elec', 'power'], ['r_heat_NH3', 'buys', 'heat', 'heat'], ['r_N2_NH3', 'buys', 'n2', 'N₂']],
  };
  const RETRO_NAMES = { NH3: 'Ammonia plant (existing reformer + synthesis loop; CCS and a new reformer where built)', ASU: 'Air separation unit (new nitrogen supply for green hydrogen)' };
  const LAYOUT = [['RES', 'EL', 'H2ST'], ['BAT', 'OPR', 'ASU'], ['HB', 'NH3', 'MKT']];
  const FIN_FIELDS = [['gearing', 'Gearing (debt share)', '%'], ['rate', 'Cost of debt', '%'], ['tenor', 'Debt tenor', 'yr'], ['tax', 'Tax rate', '%'],
    ['dep', 'Depreciation, straight line', 'yr'], ['disc', 'Project discount rate', '%'], ['dscr', 'Target DSCR', '×']];

  const S = { index: null, M: null, plant: null, build: 'GF', policy: '', ccs: 'No', ci: 1.0, market: null, marketEdited: false,
    mode: 'nashEq', baseMode: 'nashEq', hmin: HMIN, margin: null, rates: null, base: null, edited: new Set(), neg: {}, negKey: '',
    fins: {}, finEdited: {}, sh: null, inp: { exp_real: EXP_REAL, book_share: 1 }, inpEdited: new Set(), res: null, d: null,
    modal: null, tab: 'overview', basis: 'equity', map: null, pics: {} };

  /* ------------------------------------------------------------ saved view (this browser only) */
  const LS = 'hopsProjectFinance.v2';
  function loadStore() { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch (e) { return {}; } }
  function saveStore() {
    try {
      const st = loadStore(); st.custom = st.custom || {};
      st.last = { plant: S.plant.idx, build: S.build, policy: S.policy, ccs: S.ccs, ci: S.ci, mode: S.mode, baseMode: S.baseMode, hmin: S.hmin };
      if (S.marketEdited) { st.market = st.market || {}; st.market[S.plant.idx] = S.market; }
      const k = caseKey();
      if (S.mode === 'custom' && S.edited.size) st.custom[k] = { rates: S.rates, edited: [...S.edited], baseMode: S.baseMode };
      else delete st.custom[k];
      const keys = Object.keys(st.custom); if (keys.length > 60) keys.slice(0, keys.length - 60).forEach(x => delete st.custom[x]);
      localStorage.setItem(LS, JSON.stringify(st));
    } catch (e) { /* private window or storage blocked: the page works, nothing is kept */ }
  }

  /* ------------------------------------------------------------ formatting */
  const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  const nfd = n => new Intl.NumberFormat('en-US', { minimumFractionDigits: n, maximumFractionDigits: n });
  const f0 = v => (isFinite(v) ? nf0.format(v) : 'n/a');
  const fd = (v, n) => (isFinite(v) ? nfd(n).format(v) : 'n/a');
  function money(v) {
    if (!isFinite(v)) return 'n/a';
    const m = v / 1e6, a = Math.abs(m), s = m < 0 ? '−' : '';
    return s + '$' + (a >= 100 ? nf0.format(a) : a >= 10 ? nfd(1).format(a) : nfd(2).format(a)) + ' M';
  }
  const sgnMoney = v => (isFinite(v) && v > 0 ? '+' : '') + money(v);
  const pct = (v, n) => (isFinite(v) ? nfd(n == null ? 1 : n).format(v * 100) + '%' : 'n/a');
  const pctI = v => (!isFinite(v) ? 'none' : v >= 1 ? '> 100%' : pct(v));          // IRR: above 100 % the unit has next to no capital at stake
  const mult = v => (isFinite(v) ? nfd(2).format(v) + '×' : 'n/a');
  const yrs = v => (isFinite(v) ? nfd(1).format(v) + ' yr' : '> 30 yr');
  const rateDec = k => (/H2|ST_in|ST_out/.test(k) ? 2 : k === 'p_NG' ? 2 : k === 'p_NH3' ? 0 : 1);
  const rateStep = k => (/H2|ST_in|ST_out/.test(k) ? 0.01 : k === 'p_NH3' ? 1 : 0.1);
  const rateUnitRaw = k => (S.M.rates.find(r => r[0] === k) || [])[2] || '';
  const rateUnit = k => rateUnitRaw(k).replace(' NH3', '').replace(' H2', '').replace(' NG', '').replace(' N2', '');
  const dataLabel = k => { const r = S.M.data_rows.find(x => x[0] === k); return r ? r[1] : k; };
  function volUnit(v) { return v.startsWith('E_') ? 'MWh' : v.endsWith('_kg') ? 'kg' : v.startsWith('H_') ? 'MWh-th' : v === 'P_B_MWh' ? 'MWh cap' : v === 'NH3_t' ? 't' : v === 'N2_ASU_t' ? 't N₂' : 'MWh NG'; }

  /* ------------------------------------------------------------ boot */
  fetch(DATA + 'index.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).then(ix => {
    S.index = ix; S.M = ix.model; BUFin.setModel(ix.model);
    S.M.units.concat([S.M.ref]).forEach(u => { S.fins[u] = Object.assign({}, ix.model.fin[u]); S.finEdited[u] = new Set(); });
    S.sh = { spend: ix.model.spend.slice(), esc_rev: ix.model.esc_rev, esc_cost: ix.model.esc_cost };
    S.margin = ix.model.opr_margin;
    const st = loadStore(), last = st.last || {};
    if (isFinite(last.hmin)) S.hmin = last.hmin;
    $('pfStamp').textContent = 'Project Finance · models ' + Object.values(ix.labels).join(' / ') + ' · data ' + ix.generated + ' · page version ' + PAGE_VERSION;
    buildList(''); initMap(); loadPictures();
    const q = new URLSearchParams(location.hash.length > 1 ? location.hash.slice(1) : location.search), want = parseInt(q.get('plant'), 10);
    const first = ix.plants.find(p => p.idx === want) || ix.plants.find(p => p.idx === last.plant) || ix.plants.find(p => p.idx === 61) || ix.plants[0];
    const fromUrl = isFinite(want) && first.idx === want;
    const pick = (k, dflt) => (fromUrl && q.get(k) != null ? q.get(k) : (!fromUrl && last[k] != null ? last[k] : dflt));
    S.build = pick('build', 'GF') === 'RETRO' ? 'RETRO' : 'GF';
    S.policy = String(pick('policy', '') || '');
    S.ccs = pick('ccs', 'No') === 'Yes' ? 'Yes' : 'No';
    S.ci = parseFloat(pick('ci', 1.0));
    const m = pick('mode', 'nashEq'); S.mode = MODE_TXT[m] ? m : 'nashEq';
    S.baseMode = MODE_TXT[last.baseMode] && last.baseMode !== 'custom' ? last.baseMode : (S.mode === 'custom' ? 'nashEq' : S.mode);
    if (isFinite(parseFloat(q.get('hmin')))) S.hmin = parseFloat(q.get('hmin')) / 100;
    selectPlant(first.idx, false, true);
  }).catch(e => { $('pfStatus').textContent = 'The finance data could not be loaded (' + e.message + ').'; });

  function loadPictures() {
    const go = () => window.HOPSUnits3D(['RES', 'BAT', 'HB', 'EL', 'H2ST', 'ASU', 'NH3', 'NH3CCS', 'OPR', 'GRID', 'NG'], 360, 230).then(p => { S.pics = p || {}; paintPictures(); });
    if (window.HOPSUnits3D) go(); else window.addEventListener('hops-units3d-ready', go, { once: true });
  }
  const picKey = u => (u === 'NH3' && S.ccs === 'Yes' ? 'NH3CCS' : u === 'MKT' ? 'GRID' : u);
  function paintPictures() { document.querySelectorAll('img[data-pic]').forEach(im => { const s = S.pics[picKey(im.dataset.pic)]; if (s) { im.src = s; im.hidden = false; } }); }

  $('pfSearch').addEventListener('input', e => buildList(e.target.value));

  /* ------------------------------------------------------------ plant list + map */
  function buildList(q) {
    q = q.trim().toLowerCase();
    const el = $('pfList'); let h = '';
    const regs = REGION_ORDER.concat([...new Set(S.index.plants.map(p => p.region))].filter(r => !REGION_ORDER.includes(r)));
    regs.forEach(reg => {
      const ps = S.index.plants.filter(p => p.region === reg && (!q || [p.name, p.admin, p.country, String(p.idx)].join(' ').toLowerCase().includes(q)))
        .sort((a, b) => (a.country + a.name).localeCompare(b.country + b.name));
      if (!ps.length) return;
      h += '<div class="grp">' + esc(reg) + ' · ' + ps.length + '</div>';
      ps.forEach(p => {
        h += '<button type="button" role="option" data-idx="' + p.idx + '" aria-selected="' + (S.plant && S.plant.idx === p.idx) + '">' +
          '<b style="font-weight:600">' + esc(p.name || 'Plant ' + p.idx) + '</b><span>' + esc((reg === 'US' || reg === 'Canada' || reg === 'India') ? (p.admin || p.country) : p.country) +
          ' · ' + f0(p.ktpa) + ' kt/yr</span></button>';
      });
    });
    el.innerHTML = h || '<div class="grp">No plant matches</div>';
  }
  $('pfList').addEventListener('click', e => { const b = e.target.closest('button[data-idx]'); if (b) selectPlant(+b.dataset.idx, true); });

  function initMap() {
    if (!window.maplibregl) { $('pfMapHint').textContent = 'Map unavailable — use the list'; return; }
    let map;
    try {
      map = new maplibregl.Map({
        container: 'pfMap',
        style: { version: 8,
          sources: { sat: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19,
            attribution: 'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community' } },
          layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
          sky: { 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0] }, projection: { type: 'globe' } },
        center: [-25, 40], zoom: 1.9, minZoom: 1, maxZoom: 12, attributionControl: { compact: true }, cooperativeGestures: true, fadeDuration: 0
      });
    } catch (e) { $('pfMapHint').textContent = 'Map unavailable — use the list'; return; }
    S.map = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.on('load', () => {
      map.addSource('plants', { type: 'geojson', data: { type: 'FeatureCollection', features: S.index.plants.map(p => ({ type: 'Feature', id: p.idx,
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: { idx: p.idx, name: p.name || 'Plant ' + p.idx, where: [p.admin, p.country].filter(Boolean).join(', '), ktpa: p.ktpa || 0,
          cases: Object.keys(p.builds || {}).map(b => b === 'GF' ? 'new build' : 'retrofit').join(' · ') } })) } });
      map.addLayer({ id: 'pl-halo', type: 'circle', source: 'plants', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 5.5, 6, 9], 'circle-color': '#fff', 'circle-opacity': 0.9 } });
      map.addLayer({ id: 'pl-pts', type: 'circle', source: 'plants', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 3.8, 6, 7], 'circle-color': '#1E9A6E' } });
      map.addLayer({ id: 'pl-sel', type: 'circle', source: 'plants', filter: ['==', ['get', 'idx'], -1],
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 9, 6, 13], 'circle-color': '#D9822B', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2.5 } });
      const tip = $('pfTip');
      map.on('mousemove', 'pl-halo', e => {
        const f = e.features[0]; map.getCanvas().style.cursor = 'pointer';
        tip.innerHTML = esc(f.properties.name) + '<small>' + esc(f.properties.where) + ' · ' + f0(f.properties.ktpa) + ' kt/yr · ' + esc(f.properties.cases) + '</small>';
        tip.style.left = e.point.x + 'px'; tip.style.top = e.point.y + 'px'; tip.style.display = 'block';
      });
      map.on('mouseleave', 'pl-halo', () => { map.getCanvas().style.cursor = ''; tip.style.display = 'none'; });
      map.on('click', 'pl-halo', e => selectPlant(e.features[0].properties.idx, true));
      if (S.plant) markSelected(false);
    });
  }
  function markSelected(fly) {
    const m = S.map; if (!m || !m.getLayer || !m.getLayer('pl-sel')) return;
    m.setFilter('pl-sel', ['==', ['get', 'idx'], S.plant.idx]);
    if (fly) m.easeTo({ center: [S.plant.lon, S.plant.lat], zoom: Math.max(m.getZoom(), 3.4), duration: 900 });
    else m.jumpTo({ center: [S.plant.lon - 18, Math.min(S.plant.lat, 42)], zoom: 2.2 });
  }

  /* ------------------------------------------------------------ selection */
  function selectPlant(idx, fly, boot) {
    $('pfStatus').hidden = false; $('pfStatus').textContent = 'Loading plant…';
    fetch(DATA + 'plant' + idx + '.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).then(p => {
      S.plant = p; S.neg = {};
      const mk = (loadStore().market || {})[idx];
      S.marketEdited = isFinite(mk); S.market = S.marketEdited ? mk : null;
      if (!boot) { S.mode = S.mode === 'custom' ? S.baseMode : S.mode; }
      fixCase(); restoreCustom(); compute(true);
      $('pfStatus').hidden = true; $('pfMain').hidden = false; $('pfHead').hidden = false;
      document.querySelectorAll('#pfList button').forEach(b => {
        const on = +b.dataset.idx === idx; b.setAttribute('aria-selected', on);
        if (on) { const L = $('pfList'); if (b.offsetTop < L.scrollTop || b.offsetTop + b.offsetHeight > L.scrollTop + L.clientHeight) L.scrollTop = b.offsetTop - 60; }
      });
      markSelected(fly);
    }).catch(e => { $('pfStatus').textContent = 'No finance data for this plant (' + e.message + ').'; });
  }
  const B = () => S.plant.builds[S.build];
  function fixCase() {                                   // keep the selection valid for this plant
    if (!S.plant.builds[S.build]) S.build = Object.keys(S.plant.builds)[0];
    if (!B().cases[S.ccs]) S.ccs = B().cases.No ? 'No' : Object.keys(B().cases)[0];
    if (S.policy && !(B().policies[S.policy] && B().policies[S.policy][S.ccs])) S.policy = '';
    const cis = B().cases[S.ccs].map(d => d.CI);
    if (!cis.includes(S.ci)) S.ci = cis.includes(1.0) ? 1.0 : cis[Math.min(cis.length - 1, 4)];
  }
  function point() {
    const base = B().cases[S.ccs], i = base.findIndex(x => x.CI === S.ci);
    let ov = null;
    if (S.policy) { const pv = B().policies[S.policy][S.ccs]; ov = pv ? pv[i] : null; }
    return Object.assign({}, base[i], ov || {}, { _policyMissing: !!S.policy && !ov });
  }
  const caseKey = () => [S.plant.idx, S.build, S.policy || '-', S.ccs, S.ci.toFixed(2)].join('|');
  function restoreCustom() {
    const c = (loadStore().custom || {})[caseKey()];
    S.edited.clear();
    if (S.mode === 'custom' && c && c.rates) { S.rates = Object.assign({}, c.rates); (c.edited || []).forEach(k => S.edited.add(k)); S.baseMode = c.baseMode || 'nash'; }
    else if (S.mode === 'custom') S.mode = S.baseMode;
  }

  /* ------------------------------------------------------------ compute */
  function finsAt() { S.M.units.concat([S.M.ref]).forEach(u => { S.fins[u].hurdle = S.hmin; }); return S.fins; }
  function inputs(d) {
    return { curt_paid: S.M.curt_paid, grid_opex_pct: S.M.grid_opex_pct, exp_real: S.inp.exp_real, book_share: S.inp.book_share,
      retro: S.build === 'RETRO', p_NG_built: Number(num(d.NG_PRICE).toFixed(2)) };
  }
  function negotiation(mode) {
    const pw = mode === 'nashEq' ? 'equity' : 'equal';
    const key = caseKey() + '|' + S.hmin + '|' + S.margin + '|' + pw + '|' + S.inp.exp_real + '|' + S.inp.book_share + '|' +
      JSON.stringify(S.M.units.map(u => [...S.finEdited[u]].map(k => S.fins[u][k]))) + '|' + S.sh.esc_rev + '|' + S.sh.esc_cost;
    if (!S.neg[key]) S.neg[key] = BUFin.negotiate(S.d, S.inpX, S.fins, S.sh, { hmin: S.hmin, market: S.market, margin: S.margin, power: pw });
    return S.neg[key];
  }
  function ratesFor(mode) {
    if (mode === 'cost') return BUFin.defaultRates(S.d, S.inpX, S.fins, S.sh, S.market, S.margin);
    const n = negotiation(mode);
    if (mode === 'operator' || !n.nash) return Object.assign({}, n.operator.rates);
    return Object.assign({}, n.nash.rates);
  }
  function compute(rebuild) {
    const d = point(); S.d = d;
    S.inpX = inputs(d); finsAt();
    if (!S.marketEdited) S.market = MARKET[S.plant.region] != null ? MARKET[S.plant.region] : (num(d.NH3_PRICE_RUN) || 660);
    S.base = ratesFor(S.mode === 'custom' ? S.baseMode : S.mode); S.base.p_NH3 = S.market;
    if (S.mode !== 'custom' || !S.rates) { S.rates = Object.assign({}, S.base); if (S.mode === 'custom') S.mode = S.baseMode; }
    S.rates.p_NH3 = S.mode === 'custom' && S.edited.has('p_NH3') ? S.rates.p_NH3 : S.market;
    S.res = BUFin.evaluate(d, S.rates, S.inpX, S.fins, S.sh, S.hmin);
    S.resBase = S.mode === 'custom' ? BUFin.evaluate(d, S.base, S.inpX, S.fins, S.sh, S.hmin) : S.res;
    S.negNow = S.mode === 'cost' ? negotiation('nash') : negotiation(S.mode === 'custom' ? S.baseMode === 'cost' ? 'nash' : S.baseMode : S.mode);
    if (rebuild) { buildHead(); buildHub(); buildAdjust(); }
    paint();
    if (S.modal && $('pfModal').open) renderModal(false);
    const q = new URLSearchParams({ plant: S.plant.idx, build: S.build, policy: S.policy, ccs: S.ccs, ci: S.ci.toFixed(2), mode: S.mode });
    try { history.replaceState(null, '', location.pathname + '#' + q.toString()); } catch (e) { /* file:// */ }
    saveStore();
  }
  /* gain of each party at the current rates, in $ NPV at the minimum equity return (ammonia plant: against the fossil reference) */
  function gains(rates) {
    const n = S.negNow, g = {};
    S.M.units.forEach(u => {
      const q = u === 'NH3' ? Object.assign({}, rates, { p_NH3: n.pWalk }) : rates;
      g[u] = BUFin.unitCf(u, S.d, q, S.inpX, S.fins[u], S.sh, true).npv_equity;
    });
    return g;
  }
  const isParty = u => S.negNow && S.negNow.parties.includes(u);

  /* ------------------------------------------------------------ case bar */
  function buildHead() {
    const p = S.plant;
    $('pfName').textContent = (p.name || 'Plant ' + p.idx) + (p.admin ? ', ' + p.admin : '');
    $('pfMeta').innerHTML = esc(p.country + ' · ' + f0(p.tpd) + ' t NH₃/day · ' + f0(p.ktpa) + ' kt/yr · plant ' + p.idx) + ' · <a href="../atlas/#plant=' + p.idx + '">open in the tool →</a>';
    $('pfBuild').innerHTML = Object.keys(p.builds).map(b => '<option value="' + b + '"' + (b === S.build ? ' selected' : '') + '>' + BUILD_TXT[b] + '</option>').join('');
    const pols = B().policies;
    $('pfPolicy').innerHTML = '<option value="">No policy</option>' + Object.keys(pols).filter(k => pols[k][S.ccs]).map(k => '<option value="' + k + '"' + (k === S.policy ? ' selected' : '') + '>' + esc(S.index.policies[k] || k) + '</option>').join('');
    $('pfPolicy').disabled = !Object.keys(pols).length;
    $('pfCcs').innerHTML = Object.keys(B().cases).sort().map(c => '<option value="' + c + '"' + (c === S.ccs ? ' selected' : '') + '>' + (c === 'Yes' ? 'With CCS' : 'Without CCS') + '</option>').join('');
    $('pfCi').innerHTML = B().cases[S.ccs].map(d => '<option value="' + d.CI + '"' + (d.CI === S.ci ? ' selected' : '') + '>' + d.CI.toFixed(2) + (d.CI === 0 ? ' · fully green' : '') + '</option>').join('');
    $('pfMode').value = S.mode;
    if (document.activeElement !== $('pfMarket')) $('pfMarket').value = S.market;
    if (document.activeElement !== $('pfHmin')) $('pfHmin').value = Number((S.hmin * 100).toFixed(2));
  }
  const onCase = () => { S.mode = S.mode === 'custom' ? S.baseMode : S.mode; fixCase(); restoreCustom(); compute(true); };
  $('pfBuild').addEventListener('change', e => { S.build = e.target.value; onCase(); });
  $('pfPolicy').addEventListener('change', e => { S.policy = e.target.value; onCase(); });
  $('pfCcs').addEventListener('change', e => { S.ccs = e.target.value; onCase(); });
  $('pfCi').addEventListener('change', e => { S.ci = parseFloat(e.target.value); onCase(); });
  $('pfMode').addEventListener('change', e => {
    const m = e.target.value;
    if (m === 'custom') { if (S.mode !== 'custom') { S.baseMode = S.mode; S.mode = 'custom'; S.rates = Object.assign({}, S.base); } }
    else { S.mode = m; S.baseMode = m; S.edited.clear(); S.rates = null; }
    compute(true);
  });
  $('pfMarket').addEventListener('change', e => { const v = parseFloat(e.target.value); if (isFinite(v) && v >= 0) { S.market = v; S.marketEdited = true; S.edited.delete('p_NH3'); compute(true); } });
  $('pfHmin').addEventListener('change', e => { const v = parseFloat(e.target.value); if (isFinite(v) && v >= 0 && v < 60) { S.hmin = v / 100; if (S.mode === 'custom') { S.mode = S.baseMode; S.edited.clear(); } S.rates = null; compute(true); } });

  /* ------------------------------------------------------------ deal overview */
  function capText(u, d) {
    const g = (k, n) => fd(num(d[k]), n == null ? 0 : n);
    switch (u) {
      case 'RES': return g('P_PV') + ' MW PV · ' + g('P_WT') + ' MW wind';
      case 'BAT': return g('P_B_MWh') + ' MWh';
      case 'HB': return g('P_HB') + ' MW';
      case 'EL': return g('P_EL') + ' MW';
      case 'H2ST': return g('P_ST_t', 1) + ' t H₂ · ' + g('P_CP', 1) + ' MW compressor';
      case 'ASU': return f0(num(d.N2_ASU_t) / 1e3) + ' kt N₂/yr';
      case 'NH3': return f0(S.plant.tpd) + ' t NH₃/day' + (S.ccs === 'Yes' ? ' · with CCS' : '') + (S.build === 'RETRO' && d.RETRO_STATE ? ' · reformer ' + d.RETRO_STATE : '');
      case 'OPR': return fd(num(d.E_imp) / 1e3, 0) + ' GWh import · ' + fd(num(d.E_exp) / 1e3, 0) + ' GWh export';
    }
    return '';
  }
  function buildHub() {
    let h = '<svg class="wires" id="pfWires" aria-hidden="true"></svg>';
    LAYOUT.forEach(row => row.forEach(u => {
      if (u === 'MKT') {
        h += '<div class="node ext" data-node="MKT" style="--uc:var(--u-GRID)"><div class="pic"><img data-pic="MKT" alt="" hidden></div><h4>Markets</h4><div class="cap">outside the plant</div><div data-k="mkt" style="font-size:12.5px;color:var(--ink-2);display:grid;gap:2px"></div></div>';
        return;
      }
      const cls = u === 'OPR' ? ' center' : u === 'NH3' ? ' nh3' : '';
      h += '<div class="node' + cls + '" data-node="' + u + '" data-unit="' + u + '" role="button" tabindex="0" style="--uc:var(--u-' + u + ')" aria-label="' + esc(UNIT_SHORT[u]) + ': open details">' +
        '<div class="pic"><img data-pic="' + u + '" alt="" hidden></div>' +
        '<h4>' + esc(UNIT_SHORT[u]) + '<small>' + esc(UNIT_SUB[u]) + '</small></h4><div class="cap">' + esc(capText(u, S.d)) + '</div>' +
        (u === 'NH3' ? '<div class="row"><div><dt>Ammonia cost</dt><dd data-k="cost"></dd></div><div><dt>Fossil plant</dt><dd data-k="ref"></dd></div>' +
          '<div><dt>vs fossil plant</dt><dd data-k="save"></dd></div><div><dt>Equity IRR at market</dt><dd data-k="irr"></dd></div></div>' :
          '<div class="big"><b data-k="irr"></b><span data-k="irrsub"></span></div><div class="gain" data-k="gain"></div>') +
        '<div class="flows" data-k="flows"></div><div class="more">Details →</div></div>';
    }));
    $('pfHub').innerHTML = h;
    paintPictures();
  }
  const HUB = $('pfHub');
  HUB.addEventListener('click', e => { const c = e.target.closest('[data-unit]'); if (c) openModal(c.dataset.unit); });
  HUB.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-unit]')) { e.preventDefault(); openModal(e.target.dataset.unit); } });
  if (window.ResizeObserver) new ResizeObserver(() => { if (S.res) drawWires(); }).observe(HUB);

  function flowOn(k) { return BUFin.volume(S.d, RATE_VOL[k], S.inpX) > NOISE; }
  function rateTxt(k, v) { return fd(v, rateDec(k)) + ' ' + rateUnit(k); }
  function partyOk(u) {
    const cf = S.res.units[u];
    if (u === 'NH3') return S.res.saving >= -0.05;
    return cf.npv_equity >= -Math.max(5e4, 1e-4 * Math.abs(cf.capex));
  }

  function paint() {
    const R = S.res, d = S.d, n = S.negNow, g = gains(S.rates), h = S.hmin;
    // ---- banner
    const modeName = S.mode === 'custom' ? 'Your rates (starting from the ' + MODE_TXT[S.baseMode].toLowerCase() + ')' : MODE_TXT[S.mode];
    let cls, title, sub;
    const okParties = S.M.units.filter(u => isParty(u) && partyOk(u)).length, nParties = n.parties.length;
    if ((S.mode === 'nash' || S.mode === 'nashEq' || S.mode === 'operator') && !n.feasible) {
      cls = 'bad'; title = 'No deal at this target: short by ' + fd(n.gap, n.gap < 10 ? 1 : 0) + ' $/t of ammonia';
      sub = 'Even if the operator gives up everything, the units cannot all earn ' + pct(h, 0) + ' on equity while the ammonia plant produces below the fossil plant (' + f0(n.pWalk) + ' $/t). ' +
        'The deal closes if ammonia from this plant is worth ' + f0(n.gap) + ' $/t more (low-carbon premium, subsidy or carbon price) or costs fall by that much. Shown: the operator optimum, where the operator carries the shortfall.';
    } else if (S.mode === 'custom' || S.mode === 'cost') {
      const all = okParties === nParties;
      cls = all ? 'ok' : 'bad'; title = (all ? 'Every party clears its walk-away point' : okParties + ' of ' + nParties + ' parties clear their walk-away point');
      sub = modeName + '. Walk-away: ' + pct(h, 0) + ' on equity for the suppliers and the operator; for the ammonia plant, its cost below the fossil plant (' + f0(R.ref_cost) + ' $/t).' +
        (n.feasible ? ' A deal exists at this target: shared gain ' + money(n.total) + ' NPV.' : ' No rate set reaches all walk-away points here (short by ' + f0(n.gap) + ' $/t).');
    } else {
      cls = 'ok'; title = 'Deal found: every party ≥ ' + pct(h, 0) + ' on equity, ' + (R.saving >= 0.5 ? 'ammonia ' + f0(R.saving) + ' $/t below the fossil plant' : 'ammonia at the fossil plant\'s cost');
      sub = S.mode === 'operator' ? 'Operator optimum: every other party sits exactly at its walk-away point and the operator keeps the whole gain of ' + money(n.total) + ' NPV.'
        : 'Nash bargaining: the rates that maximise the product of every party\'s gain over its walk-away point' + (S.mode === 'nashEq' ? ', weighted by the equity each party puts in' : ', all parties with equal power') +
          '. Shared gain ' + money(n.total) + ' NPV, split as shown below the diagram.';
    }
    if (d._policyMissing) sub += ' (The policy case has no result at this target: shown without policy.)';
    const kc = (lab, v, unit, s, c) => '<div class="k' + (c ? ' ' + c : '') + '"><div class="lab">' + esc(lab) + '</div><div class="v">' + v + ' <small>' + esc(unit) + '</small></div><div class="s">' + s + '</div></div>';
    $('pfDeal').innerHTML = '<div class="msg ' + cls + '"><b class="t">' + esc(title) + '</b><span>' + esc(sub) + '</span></div>' +
      kc('Ammonia cost at these rates', f0(R.nh3_cost), '$/t', 'what the ammonia plant needs to earn ' + pct(h, 0) + ' on equity · market ' + f0(S.market) + ' $/t') +
      kc('vs fossil plant', (R.saving >= 0 ? '−' : '+') + f0(Math.abs(R.saving)), '$/t', 'fossil reference ' + f0(R.ref_cost) + ' $/t on the same financing · ' + (S.build === 'RETRO' ? 'the existing plant carrying on' : 'a new fossil plant here') +
        ' · ' + money(R.saving * num(d.NH3_t)) + '/yr', R.saving >= 0 ? 'good' : 'poor') +
      kc(n.feasible ? 'Gain to share' : 'Shortfall', n.feasible ? money(n.total) : f0(n.gap), n.feasible ? 'NPV' : '$/t', n.feasible ? 'over all walk-away points, at ' + pct(h, 0) + ' · ' + nParties + ' parties' : 'what the ammonia would need to be worth more', n.feasible ? 'good' : 'poor');
    // ---- nodes
    S.M.units.forEach(u => {
      const el = HUB.querySelector('[data-node="' + u + '"]'); if (!el) return;
      const cf = R.units[u], q = k => el.querySelector('[data-k="' + k + '"]');
      el.classList.toggle('off', !cf.built);
      if (u === 'NH3') {
        q('cost').textContent = f0(R.nh3_cost) + ' $/t'; q('ref').textContent = f0(R.ref_cost) + ' $/t';
        const sv = q('save'); sv.textContent = (R.saving >= 0 ? '−' : '+') + f0(Math.abs(R.saving)) + ' $/t'; sv.style.color = R.saving >= 0 ? 'var(--ok)' : 'var(--bad)';
        q('irr').textContent = (cf.capex < 1e5 ? 'no new capital' : pctI(cf.irr_equity)) + ' @ ' + f0(S.rates.p_NH3);
      } else {
        const ok = partyOk(u), b = q('irr');
        if (!cf.built) { b.textContent = '—'; b.className = ''; q('irrsub').textContent = 'not built at this target'; q('gain').textContent = ''; }
        else {
          const noCap = cf.capex < 1e5;
          b.textContent = noCap ? 'no capital' : pctI(cf.irr_equity); b.className = ok ? 'ok' : 'bad';
          q('irrsub').textContent = noCap ? '' : 'equity IRR · min ' + pct(h, 0);
          q('gain').innerHTML = (ok ? '✓ ' : '✕ ') + '<span class="num">' + esc(sgnMoney(g[u])) + '</span> NPV above ' + pct(h, 0);
        }
      }
      const fl = q('flows');
      if (fl) fl.innerHTML = (FLOWS[u] || []).filter(f => flowOn(f[0])).map(f => '<span>' + esc(f[1] + ' ' + f[3]) + ' <b class="num">' + esc(rateTxt(f[0], S.rates[f[0]])) + '</b></span>').join('');
    });
    const mk = HUB.querySelector('[data-k="mkt"]');
    if (mk) {
      const imp = num(d.E_imp), exp = num(d.E_exp);
      mk.innerHTML = '<span>Grid import <b class="num">' + (imp > NOISE ? fd((num(d.IMP_COST) + num(d.DEMAND_CH) + num(d.NET_CH)) / imp, 1) + ' $/MWh' : '—') + '</b></span>' +
        '<span>Grid export <b class="num">' + (exp > NOISE ? fd(R.export_rev / exp, 1) + ' $/MWh' : '—') + '</b></span>' +
        '<span>Natural gas <b class="num">' + fd(S.rates.p_NG, 1) + ' $/MWh</b></span><span>Ammonia <b class="num">' + f0(S.rates.p_NH3) + ' $/t</b></span>';
    }
    drawWires();
    paintSplit(g);
    paintAdjust(g);
    paintFoot();
    const rb = $('pfReset'); rb.disabled = S.mode !== 'custom'; rb.textContent = S.mode === 'custom' ? 'Back to the ' + MODE_TXT[S.baseMode].toLowerCase() + ' · ' + S.edited.size + ' change' + (S.edited.size === 1 ? '' : 's') : 'At the ' + MODE_TXT[S.mode].toLowerCase();
    $('pfMode').value = S.mode;
  }

  /* wires between every unit and the operator, the rates on them */
  function drawWires() {
    const svgEl = $('pfWires'); if (!svgEl) return;
    HUB.querySelectorAll('.chip').forEach(c => c.remove());
    const box = HUB.getBoundingClientRect();
    if (window.matchMedia('(max-width: 980px)').matches || box.width < 10) { svgEl.innerHTML = ''; return; }
    const rect = u => { const r = HUB.querySelector('[data-node="' + u + '"]').getBoundingClientRect(); return { x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height }; };
    const ctr = r => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
    const exitPt = (r, to) => {                                    // where the line from the centre of r towards `to` leaves r
      const c = ctr(r), dx = to.x - c.x, dy = to.y - c.y;
      if (!dx && !dy) return c;
      const tx = dx ? (r.w / 2) / Math.abs(dx) : Infinity, ty = dy ? (r.h / 2) / Math.abs(dy) : Infinity, t = Math.min(tx, ty);
      return { x: c.x + dx * t, y: c.y + dy * t };
    };
    const op = rect('OPR'), opc = ctr(op);
    let g = '<defs><marker id="pfArr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--ink-3)"/></marker></defs>';
    const chips = [];
    const wire = (from, to, list, dashed, color) => {
      const a = exitPt(from, ctr(to)), b = exitPt(to, ctr(from));
      g += '<line x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '" stroke="' + (color || 'var(--rule-2)') + '" stroke-width="2.5"' + (dashed ? ' stroke-dasharray="5 4"' : '') + ' stroke-linecap="round"/>';
      chips.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, list });
    };
    S.M.units.forEach(u => {
      if (u === 'OPR') return;
      const fl = (FLOWS[u] || []).filter(f => flowOn(f[0]));
      if (!fl.length) return;
      wire(rect(u), op, fl.map(f => ({ c: f[2], t: f[3] + ' ' + rateTxt(f[0], S.rates[f[0]]), dir: f[1] })), false, 'var(--u-' + u + ')');
    });
    const mkt = rect('MKT'), d = S.d;
    const gl = [];
    if (num(d.E_imp) > NOISE) gl.push({ c: 'elec', t: 'import ' + fd((num(d.IMP_COST) + num(d.DEMAND_CH) + num(d.NET_CH)) / num(d.E_imp), 1) + ' $/MWh' });
    if (num(d.E_exp) > NOISE) gl.push({ c: 'elec', t: 'export ' + fd(S.res.export_rev / num(d.E_exp), 1) + ' $/MWh' });
    if (gl.length) wire(mkt, op, gl, true);
    const nl = [{ c: 'nh3', t: 'ammonia ' + f0(S.rates.p_NH3) + ' $/t' }];
    if (num(d.NG_MWh) > NOISE) nl.push({ c: 'gas', t: 'gas ' + fd(S.rates.p_NG, 1) + ' $/MWh' });
    wire(mkt, rect('NH3'), nl, true);
    svgEl.innerHTML = g;
    chips.forEach(c => {
      const el = document.createElement('div'); el.className = 'chip'; el.style.left = c.x + 'px'; el.style.top = c.y + 'px';
      el.innerHTML = c.list.map(x => '<span style="--cc:var(--c-' + x.c + ')">' + (x.dir ? '<i>' + (x.dir === 'sells' ? 'sells' : 'buys') + '</i>' : '') + esc(x.t) + '</span>').join('');
      HUB.appendChild(el);
    });
  }

  /* split of the gain: each party's NPV above its walk-away point */
  function paintSplit(g) {
    const parties = S.M.units.filter(u => isParty(u) || Math.abs(g[u]) > 1e5);
    const vals = parties.map(u => g[u] / 1e6), base = gains(S.base), bv = parties.map(u => base[u] / 1e6);
    const lo = Math.min(0, ...vals, ...bv), hi = Math.max(0, ...vals, ...bv, 0.01);
    const W = 1000, rh = 26, H = parties.length * rh + 30, x0 = 170, x1 = W - 90, X = v => x0 + (x1 - x0) * (v - lo) / ((hi - lo) || 1);
    let s = '<line x1="' + X(0) + '" x2="' + X(0) + '" y1="2" y2="' + (H - 24) + '" stroke="var(--ink-3)"/>';
    parties.forEach((u, i) => {
      const y = 4 + i * rh, v = vals[i], ok = partyOk(u);
      s += '<text x="0" y="' + (y + 15) + '" style="font:600 12.5px var(--sans);fill:var(--ink-2)">' + esc(UNIT_SHORT[u]) + '</text>' +
        '<rect x="' + Math.min(X(0), X(v)) + '" y="' + (y + 3) + '" width="' + Math.max(2, Math.abs(X(v) - X(0))) + '" height="' + (rh - 9) + '" rx="3" fill="var(--u-' + u + ')" opacity="' + (ok ? 1 : 0.55) + '"/>' +
        (S.mode === 'custom' ? '<line x1="' + X(bv[i]) + '" x2="' + X(bv[i]) + '" y1="' + (y + 1) + '" y2="' + (y + rh - 4) + '" stroke="var(--ink)" stroke-width="2" opacity=".45"/>' : '') +
        '<text x="' + W + '" y="' + (y + 15) + '" text-anchor="end" style="font:600 12.5px var(--mono);fill:' + (v < -0.05 ? 'var(--bad)' : 'var(--ink)') + '">' + esc(sgnMoney(v * 1e6)) + '</text>';
    });
    $('pfSplit').innerHTML = '<h5>Who gets what</h5><div class="cs">Each party\'s gain over its walk-away point, $ NPV at ' + pct(S.hmin, 0) +
      ' (ammonia plant: against producing at the fossil plant\'s cost)' + (S.mode === 'custom' ? ' · dark marks: the ' + MODE_TXT[S.baseMode].toLowerCase() : '') + '</div><svg viewBox="0 0 ' + W + ' ' + H + '" role="img">' + s + '</svg>';
  }

  /* ------------------------------------------------------------ adjust the deal */
  function sliderRange(k) {
    const b = num(S.base[k]), st = rateStep(k);
    if (k === 'p_NH3') return [Math.max(0, Math.round(S.market * 0.4)), Math.round(S.market * 1.6)];
    const span = Math.max(Math.abs(b) * 0.6, st * 60);
    const lo = Math.floor((b - span) / st) * st, hi = Math.ceil((b + span) / st) * st;
    return [lo, hi];
  }
  function buildAdjust() {
    let h = '';
    S.M.units.forEach(u => {
      const ks = ADJ[u].filter(k => k === 'p_NH3' || flowOn(k) || (k === 'r_B_cap' && flowOn('r_B_out')));
      if (u === 'OPR') {
        h += '<div class="ap" style="--uc:var(--u-OPR)" data-ap="OPR"><header><h5>Operator</h5><span class="res" data-k="res"></span></header>' +
          '<div class="sl"><label for="sl_margin">Margin on the electricity tariff <small>tariff = average procurement cost + margin</small></label>' +
          '<input type="range" id="sl_margin" data-margin="1" min="0" max="30" step="0.5"><input type="number" data-margin="1" step="0.5"></div>' +
          '<p class="hint" style="font-size:12px;color:var(--ink-3);margin:4px 0 0">The operator is the counterparty of every rate on this page: what a unit gains on a rate, the operator gives up. The margin re-solves the optimum.</p></div>';
        return;
      }
      if (!ks.length) return;
      h += '<div class="ap" style="--uc:var(--u-' + u + ')" data-ap="' + u + '"><header><h5>' + esc(UNIT_SHORT[u]) + '</h5><span class="res" data-k="res"></span></header>' +
        ks.map(k => { const [lo, hi] = sliderRange(k); return '<div class="sl"><label for="sl_' + k + '">' + esc(RATE_SHORT[k]) + ' <small data-k="b_' + k + '"></small></label>' +
          '<input type="range" id="sl_' + k + '" data-rate="' + k + '" min="' + lo + '" max="' + hi + '" step="' + rateStep(k) + '">' +
          '<input type="number" data-rate="' + k + '" step="' + rateStep(k) + '" aria-label="' + esc(RATE_SHORT[k]) + ', ' + esc(rateUnit(k)) + '"></div>'; }).join('') + '</div>';
    });
    $('pfAdj').innerHTML = h;
  }
  const ADJEL = $('pfAdj');
  ADJEL.addEventListener('input', e => {
    const t = e.target, v = parseFloat(t.value); if (!isFinite(v)) return;
    if (t.dataset.margin) { if (t.type === 'range' || e.type === 'change') setMargin(v); return; }
    const k = t.dataset.rate; if (!k) return;
    if (t.type === 'number') return;                    // typed values apply on change (Enter / leaving the field)
    setRate(k, v);
  });
  ADJEL.addEventListener('change', e => {
    const t = e.target, v = parseFloat(t.value); if (!isFinite(v)) return;
    if (t.dataset.margin) { setMargin(v); return; }
    if (t.dataset.rate && t.type === 'number') setRate(t.dataset.rate, v);
  });
  ADJEL.addEventListener('click', e => { const b = e.target.closest('button[data-back]'); if (!b) return; const k = b.dataset.back; S.rates[k] = S.base[k]; S.edited.delete(k); if (!S.edited.size) { S.mode = S.baseMode; S.rates = null; } compute(false); });
  function setRate(k, v) {
    if (S.mode !== 'custom') { S.baseMode = S.mode; S.mode = 'custom'; S.rates = Object.assign({}, S.base); }
    S.rates[k] = v; S.edited.add(k);
    if (k === 'p_NH3') { /* the market price stays a market input: kept with the custom rates */ }
    compute(false);
  }
  function setMargin(v) { S.margin = Math.max(0, v); if (S.mode === 'custom') { S.mode = S.baseMode; S.edited.clear(); } S.rates = null; compute(false); }
  $('pfReset').addEventListener('click', () => { S.mode = S.baseMode; S.edited.clear(); S.rates = null; compute(false); });

  function paintAdjust(g) {
    const R = S.res, h = S.hmin;
    ADJEL.querySelectorAll('.ap').forEach(ap => {
      const u = ap.dataset.ap, cf = R.units[u], r = ap.querySelector('[data-k="res"]');
      if (u === 'NH3') { r.textContent = f0(R.nh3_cost) + ' $/t · ' + (R.saving >= 0 ? '−' : '+') + f0(Math.abs(R.saving)) + ' vs fossil'; r.className = 'res ' + (R.saving >= -0.05 ? 'ok' : 'bad'); }
      else if (cf) { r.textContent = (cf.capex < 1e5 ? sgnMoney(g[u]) + ' NPV' : pctI(cf.irr_equity) + ' equity IRR'); r.className = 'res ' + (partyOk(u) ? 'ok' : 'bad'); }
      ap.querySelectorAll('input[data-rate]').forEach(inp => {
        const k = inp.dataset.rate, v = S.rates[k];
        if (document.activeElement !== inp) inp.value = inp.type === 'range' ? v : Number(num(v).toFixed(rateDec(k)));
        inp.classList.toggle('edited', S.edited.has(k));
      });
      ap.querySelectorAll('[data-k^="b_"]').forEach(sm => {
        const k = sm.dataset.k.slice(2);
        sm.innerHTML = S.edited.has(k) ? 'optimum ' + esc(rateTxt(k, S.base[k])) + ' · <button type="button" data-back="' + k + '">back</button>' : esc(rateUnit(k));
      });
      ap.querySelectorAll('input[data-margin]').forEach(inp => { if (document.activeElement !== inp) inp.value = S.margin; });
    });
    paintImpact(g);
  }

  /* live picture of the impact: every party's equity return against the minimum, the ammonia cost against the fossil plant */
  function paintImpact(g) {
    const R = S.res, RB = S.resBase, h = S.hmin, custom = S.mode === 'custom';
    const rows = S.M.units.filter(u => u !== 'NH3' && R.units[u].built && R.units[u].capex >= 1e5);
    const val = (res, u) => res.units[u].irr_equity;
    const all = rows.map(u => val(R, u)).concat(custom ? rows.map(u => val(RB, u)) : []).filter(isFinite);
    const top = Math.max(h * 2, ...all.map(v => Math.min(v, 1)), 0.05) * 1.08, bot = Math.min(0, ...all.map(v => Math.max(v, -0.3)));
    const W = 460, rh = 24, x0 = 112, x1 = W - 58, H1 = rows.length * rh + 26, X = v => x0 + (x1 - x0) * (Math.max(bot, Math.min(top, v)) - bot) / (top - bot);
    let s = '<line x1="' + X(h) + '" x2="' + X(h) + '" y1="0" y2="' + (H1 - 18) + '" stroke="var(--ink)" stroke-width="1.5" stroke-dasharray="4 3"/>' +
      '<text x="' + X(h) + '" y="' + (H1 - 4) + '" text-anchor="middle" style="font:600 11px var(--mono);fill:var(--ink-2)">min ' + pct(h, 0) + '</text>';
    rows.forEach((u, i) => {
      const y = 2 + i * rh, v = val(R, u), ok = partyOk(u);
      s += '<text x="0" y="' + (y + 14) + '" style="font:600 12px var(--sans);fill:var(--ink-2)">' + esc(UNIT_SHORT[u]) + '</text>';
      if (isFinite(v)) s += '<rect x="' + X(bot) + '" y="' + (y + 3) + '" width="' + Math.max(2, X(v) - X(bot)) + '" height="' + (rh - 9) + '" rx="3" fill="' + (ok ? 'var(--u-' + u + ')' : 'var(--bad)') + '" opacity="' + (ok ? 1 : 0.75) + '"/>';
      if (custom && isFinite(val(RB, u))) s += '<line x1="' + X(val(RB, u)) + '" x2="' + X(val(RB, u)) + '" y1="' + (y + 1) + '" y2="' + (y + rh - 4) + '" stroke="var(--ink)" stroke-width="2" opacity=".4"/>';
      s += '<text x="' + W + '" y="' + (y + 14) + '" text-anchor="end" style="font:600 12px var(--mono);fill:' + (ok ? 'var(--ink)' : 'var(--bad)') + '">' + pctI(v) + '</text>';
    });
    // ammonia: cost at these rates vs fossil reference vs market
    const items = [['Ammonia plant, these rates', R.nh3_cost, R.saving >= 0 ? 'var(--u-NH3)' : 'var(--bad)'], ['Fossil plant (walk-away)', R.ref_cost, 'var(--ink-3)'], ['Market price', S.rates.p_NH3, 'var(--anchor)']];
    if (custom) items.splice(1, 0, ['Ammonia plant, ' + MODE_TXT[S.baseMode].replace(/ \(.*\)/, '').toLowerCase(), RB.nh3_cost, 'var(--u-NH3)']);
    const mx = Math.max(...items.map(x => num(x[1]))) * 1.05 || 1, H2 = items.length * rh + 6, XA = v => x0 + 60 + (x1 - x0 - 60) * Math.max(0, v) / mx;
    let s2 = '';
    items.forEach((it, i) => {
      const y = 2 + i * rh;
      s2 += '<text x="0" y="' + (y + 14) + '" style="font:600 12px var(--sans);fill:var(--ink-2)">' + esc(it[0]) + '</text>' +
        '<rect x="' + (x0 + 60) + '" y="' + (y + 3) + '" width="' + Math.max(2, XA(num(it[1])) - x0 - 60) + '" height="' + (rh - 9) + '" rx="3" fill="' + it[2] + '" opacity="' + (i === 1 && custom ? 0.45 : 1) + '"/>' +
        '<text x="' + W + '" y="' + (y + 14) + '" text-anchor="end" style="font:600 12px var(--mono);fill:var(--ink)">' + f0(it[1]) + '</text>';
    });
    const tot = S.M.units.reduce((a, u) => a + (isParty(u) ? g[u] : 0), 0);
    $('pfImpact').innerHTML = '<h5>Impact of your rates</h5><div class="cs">Updates as you move a rate' + (custom ? ' · grey marks: the ' + MODE_TXT[S.baseMode].toLowerCase() : '') + '</div>' +
      '<div class="lg"><span>Equity IRR of each unit (units with capital)</span></div><svg viewBox="0 0 ' + W + ' ' + H1 + '" role="img">' + s + '</svg>' +
      '<div class="lg" style="margin-top:var(--s3)"><span>Cost of ammonia, $/t (at ' + pct(h, 0) + ' on equity)</span></div><svg viewBox="0 0 ' + W + ' ' + H2 + '" role="img">' + s2 + '</svg>' +
      '<div class="cs" style="margin-top:var(--s3)">Sum of all gains: <b class="num">' + esc(money(tot)) + '</b> NPV' + (S.negNow.feasible ? ' (the optimum shares ' + esc(money(S.negNow.total)) + '; the rest is lost to tax and financing asymmetries or given to a party below its walk-away)' : '') + '. ' +
      'Operator: ' + (R.units.OPR.capex < 1e5 ? esc(sgnMoney(g.OPR)) + ' NPV' : pctI(R.units.OPR.irr_equity) + ' equity IRR') + '.</div>';
  }

  /* ------------------------------------------------------------ footer + notes */
  function paintFoot() {
    const R = S.res, d = S.d;
    const tie = Math.abs(R.tieout) < 1 ? 'ties out to the dollar' : 'difference ' + f0(R.tieout) + ' $';
    $('pfFoot').innerHTML =
      card('System breakeven', f0(R.system) + ' $/t', 'ammonia price at which all units together earn their project discount rates') +
      card('All units together', money(R.sum.capex) + ' CAPEX', 'project NPV ' + money(R.sum.npv_project) + ' · EBITDA yr 1 ' + money(R.sum.ebitda) + ' (' + tie + ')') +
      card('Cost of CO₂ avoided', isFinite(R.mac) ? f0(R.mac) + ' $/t CO₂' : 'n/a', 'ammonia cost at these rates vs the fossil plant, ' + fd(num(d.BAU_CI), 2) + ' → ' + fd(num(d.CI_ACT), 2) + ' t CO₂/t') +
      card('HOPS model LCOA', f0(num(d.LCOA_A)) + ' / ' + f0(num(d.LCOA_B)) + ' $/t', 'the optimiser\'s own cost of ammonia (LCOE transfer / export price basis) · HOPS fossil ' + f0(num(d.BAU_LCOA_A)) + ' $/t');
    const runP = num(d.NH3_PRICE_RUN), def = MARKET[S.plant.region];
    $('pfNote').innerHTML = '<p><b>How the deal is found.</b> The plant design and its 8,760-hour dispatch come from the HOPS run for this case and target; nothing is re-optimised, the rates only decide who earns what. Internal payments cancel, so the units together always earn what the integrated plant earns. ' +
      'Every party has a walk-away point: the suppliers and the operator want at least ' + pct(S.hmin, 0) + ' on their equity; the ammonia plant wants to produce below the fossil plant (' + (S.build === 'RETRO' ? 'the existing plant carrying on, its book value as investment' : 'a new fossil plant at the same site') + ', on the same financing). ' +
      'The total gain above all walk-away points is fixed by the design. The <b>operator optimum</b> gives every other party exactly its walk-away point and the operator the rest. The <b>Nash optimum</b> chooses the rates that maximise the product of all gains, the standard bargaining solution: with equal power it splits the gain about equally, with power in proportion to the equity each party puts in (a retrofitted plant counts its existing units at the equity share of their replacement value) every party earns about the same return above the minimum.</p>' +
      '<p><b>Which rates move.</b> Each supplier is paid through its selling rate and buys electricity at the operator\'s tariff (its average procurement cost, renewables and grid imports with their charges, plus a margin of ' + fd(S.margin, 1) + ' $/MWh). The ammonia plant buys electricity, hydrogen, heat and nitrogen at the operator\'s cost of each times one common markup. Market prices (gas, grid, ammonia) stay as they are.' +
      (runP && def && Math.abs(runP - def) > 1 ? ' <b>Note:</b> this design was solved at an ammonia price of ' + f0(runP) + ' $/t.' : '') + '</p>';
  }
  const card = (l, v, s) => '<div class="sumc"><div class="lab">' + esc(l) + '</div><div class="v">' + esc(v) + '</div><div class="s">' + esc(s) + '</div></div>';

  /* ------------------------------------------------------------ detail window */
  const MD = $('pfModal'), MDI = $('pfModalIn');
  function openModal(u) { S.modal = u; S.tab = 'overview'; renderModal(true); if (!MD.open) MD.showModal(); }
  MD.addEventListener('click', e => { if (e.target === MD) MD.close(); });
  MD.addEventListener('close', () => { S.modal = null; hideTip(); });
  MDI.addEventListener('click', e => {
    if (e.target.closest('.x')) { MD.close(); return; }
    const t = e.target.closest('[data-tab]'); if (t) { S.tab = t.dataset.tab; renderModal(true); return; }
    const b = e.target.closest('[data-basis]'); if (b) { S.basis = b.dataset.basis; renderModal(false); return; }
    if (e.target.closest('[data-adjust]')) { MD.close(); $('adjust').scrollIntoView({ behavior: 'smooth' }); return; }
    if (e.target.closest('[data-finreset]')) { const u = S.modal; S.fins[u] = Object.assign({}, S.M.fin[u]); S.finEdited[u].clear(); if (u === 'OPR') { S.inp.exp_real = EXP_REAL; S.inpEdited.delete('exp_real'); } if (u === 'NH3') { S.inp.book_share = 1; S.inpEdited.delete('book_share'); } S.rates = S.mode === 'custom' ? S.rates : null; compute(true); }
  });
  MDI.addEventListener('change', e => {
    const t = e.target, v = parseFloat(t.value); if (!isFinite(v)) return;
    if (t.dataset.fin) {
      const k = t.dataset.fin, u = S.modal; S.fins[u][k] = (k === 'tenor' || k === 'dep') ? Math.max(1, Math.round(v)) : k === 'dscr' ? v : v / 100; S.finEdited[u].add(k);
    } else if (t.dataset.sh) { S.sh[t.dataset.sh] = v / 100;
    } else if (t.dataset.inp) { S.inp[t.dataset.inp] = Math.max(0, v); S.inpEdited.add(t.dataset.inp); } else return;
    if (S.mode !== 'custom') S.rates = null;
    compute(true);
  });

  function status(u, cf) {
    if (!cf.built) return ['', 'Not built'];
    if (u === 'NH3') return S.res.saving >= -0.05 ? ['ok', '✓ Below the fossil plant'] : ['bad', '✕ Above the fossil plant'];
    return partyOk(u) ? ['ok', '✓ At or above ' + pct(S.hmin, 0)] : ['bad', '✕ Below ' + pct(S.hmin, 0)];
  }
  function renderModal(resetScroll) {
    const u = S.modal, cf = S.res.units[u], fin = S.fins[u], d = S.d, [cls, txt] = status(u, cf);
    const body = MDI.querySelector('.md-body'), top = body && !resetScroll ? body.scrollTop : 0;
    const tabs = [['overview', 'Returns'], ['lines', 'Revenue and costs'], ['cash', 'Cash flow table'], ['assume', 'Assumptions']];
    const pic = S.pics[picKey(u)];
    MDI.style.setProperty('--uc', 'var(--u-' + u + ')');
    MDI.innerHTML = '<div class="md-head"><div class="ttl">' + (pic ? '<img src="' + pic + '" alt="">' : '') + '<div><h3 id="mdTitle">' + esc((S.build === 'RETRO' && RETRO_NAMES[u]) || S.M.unit_names[u]) + ' <span class="pill ' + cls + '" style="vertical-align:middle;margin-left:8px">' + txt + '</span></h3><p>' +
      esc((S.plant.name || 'Plant ' + S.plant.idx) + ' · ' + BUILD_TXT[S.build] + (S.policy ? ' · ' + S.index.policies[S.policy] : '') + ' · ' + (S.ccs === 'Yes' ? 'with CCS' : 'without CCS') + ' · target ' + S.ci.toFixed(2) + ' t CO₂/t · ' + capText(u, d) + ' · ' + (S.mode === 'custom' ? 'your rates' : MODE_TXT[S.mode].toLowerCase())) + '</p></div></div><button class="x" type="button">Close ✕</button></div>' +
      '<div class="md-tabs" role="tablist">' + tabs.map(t => '<button type="button" role="tab" data-tab="' + t[0] + '" aria-selected="' + (S.tab === t[0]) + '">' + t[1] + '</button>').join('') + '</div>' +
      '<div class="md-body">' + (S.tab === 'overview' ? tabOverview(u, cf, fin) : S.tab === 'lines' ? tabLines(u, cf) : S.tab === 'cash' ? tabCash(u, cf) : tabAssume(u, fin)) + '</div>';
    MDI.querySelector('.md-body').scrollTop = top;
    if (S.tab === 'overview' && cf.built) drawCharts(u, cf, fin);
  }
  const kt = (l, v, s, hi) => '<div class="kt' + (hi ? ' hi' : '') + '"><div class="lab">' + esc(l) + '</div><div class="v">' + esc(v) + '</div><div class="s">' + esc(s || '') + '</div></div>';

  function tabOverview(u, cf, fin) {
    if (!cf.built) return '<p class="hint">This unit is not built at this carbon-intensity target, so it has no cash flow. Pick a lower target to see it.</p>';
    const pr = BUFin.primaryRate(u), R = S.res, g = gains(S.rates)[u];
    const head = u === 'NH3'
      ? kt('Ammonia cost', f0(R.nh3_cost) + ' $/t', 'price for ' + pct(S.hmin, 0) + ' on equity', 1) + kt('Fossil plant', f0(R.ref_cost) + ' $/t', 'walk-away point, same financing', 1) +
        kt('vs fossil plant', (R.saving >= 0 ? '−' : '+') + f0(Math.abs(R.saving)) + ' $/t', money(R.saving * num(S.d.NH3_t)) + ' per year', 1) + kt('Equity IRR at market', pctI(cf.irr_equity), 'market ' + f0(S.rates.p_NH3) + ' $/t', 1) +
        kt('Project NPV', money(cf.npv_project), 'at ' + pct(fin.disc) + ', market price', 1) + kt('Gain over walk-away', sgnMoney(g), 'NPV at ' + pct(S.hmin, 0), 1)
      : kt('Equity IRR', pctI(cf.irr_equity), 'minimum ' + pct(S.hmin, 0), 1) + kt('Gain over walk-away', sgnMoney(g), 'equity NPV at ' + pct(S.hmin, 0), 1) +
        kt('Project IRR', pctI(cf.irr_project), 'discount rate ' + pct(fin.disc), 1) + kt('Project NPV', money(cf.npv_project), 'at ' + pct(fin.disc), 1) +
        kt('Minimum DSCR', mult(cf.min_dscr), 'target ' + mult(fin.dscr), 1) + kt('Payback', yrs(cf.payback_equity), 'equity · project ' + yrs(cf.payback_project), 1);
    return '<div class="kgrid">' + head +
      kt('Overnight CAPEX', money(cf.capex), 'interest during construction ' + money(cf.idc)) + kt('Total cost', money(cf.total_cost), 'incl. interest during construction') +
      kt('Debt', money(cf.debt), pct(cf.total_cost ? cf.debt / cf.total_cost : NaN, 0) + ' of total cost') + kt('Equity', money(cf.equity), 'debt service ' + money(cf.debt_service) + '/yr') +
      kt('Revenue year 1', money(cf.rev_y1), 'costs ' + money(cf.cost_y1)) + kt('EBITDA year 1', money(cf.ebitda_y1), pr && isFinite(cf.min_e) ? 'at ' + pct(S.hmin, 0) + ': ' + (pr === 'p_NH3' ? 'ammonia ' : 'rate ') + fd(cf.min_e, rateDec(pr) || 0) + ' ' + rateUnit(pr) : '') +
      '</div><p class="hint">Rates for this unit: ' + (ADJ[u] || []).filter(k => flowOn(k)).map(k => esc(RATE_SHORT[k].toLowerCase()) + ' <b class="num">' + esc(rateTxt(k, S.rates[k])) + '</b>').join(' · ') +
      (ADJ[u] && ADJ[u].length ? ' · <a href="#adjust" data-adjust="1">adjust them</a>' : '') + '</p><div class="cgrid">' +
      '<div class="chart"><h5>Cash flow over the project life</h5><div class="cs">$ million per year · 3 construction years, then 30 operating years</div>' +
      '<div class="seg segsm"><button type="button" data-basis="equity" aria-pressed="' + (S.basis === 'equity') + '">Equity</button><button type="button" data-basis="project" aria-pressed="' + (S.basis === 'project') + '">Project</button></div>' +
      '<div class="lg"><span><i class="sq" style="background:var(--d1)"></i>Cash flow in the year</span><span><i style="background:var(--ink);width:2px;height:12px"></i>Year the investment is paid back</span></div><div id="chCash"></div></div>' +
      '<div class="chart"><h5>Year-1 revenue and costs</h5><div class="cs">$ million · what the unit is paid and what it pays at the current rates</div>' +
      '<div class="lg"><span><i class="sq" style="background:var(--d1)"></i>Revenue</span><span><i class="sq" style="background:var(--d2)"></i>Cost</span><span><i class="sq" style="background:var(--ink)"></i>EBITDA</span></div><div id="chLines"></div></div>' +
      '<div class="chart"><h5>Debt service cover</h5><div class="cs">Cash available for debt service ÷ debt service, each year of the loan</div>' +
      '<div class="lg"><span><i style="background:var(--d1)"></i>DSCR</span><span><i style="background:var(--d2)"></i>Lender\'s target ' + mult(fin.dscr) + '</span></div><div id="chDscr"></div></div>' +
      '<div class="chart"><h5 id="chSensT"></h5><div class="cs" id="chSensS"></div>' +
      '<div class="lg" id="chSensL"></div><div id="chSens"></div></div></div>';
  }

  function tabLines(u, cf) {
    let h = '<h4>Year-1 transactions</h4><p class="hint">Rate × volume from the hourly dispatch of the run. Fixed items come from the run as they are.</p><div class="tbwrap"><table class="tb"><thead><tr><th>Line</th><th>Rate</th><th>Volume, year 1</th><th>Value, year 1 $</th></tr></thead><tbody>';
    cf.lines.forEach(ln => {
      const v = ln.sign * ln.value;
      if (Math.abs(v) < 0.5 && (ln.volume == null || ln.volume < NOISE)) return;
      h += '<tr><td>' + esc(ln.label) + '</td><td>' + (ln.rate ? fd(S.rates[ln.rate], rateDec(ln.rate) || 1) + ' ' + esc(rateUnitRaw(ln.rate)) : '—') + '</td><td>' +
        (ln.volume != null ? f0(ln.volume) + ' ' + volUnit(ln.vol) : '—') + '</td><td class="' + (v < 0 ? 'neg' : '') + '">' + f0(v) + '</td></tr>';
    });
    h += '<tr><td>Fixed operating cost (from the run)</td><td>—</td><td>—</td><td class="neg">' + f0(-cf.opex_y1) + '</td></tr>' +
      '<tr class="tot"><td>EBITDA, year 1</td><td></td><td></td><td class="' + (cf.ebitda_y1 < 0 ? 'neg' : '') + '">' + f0(cf.ebitda_y1) + '</td></tr></tbody></table></div>';
    h += '<h4>Capital and fixed operating cost</h4><p class="hint">Overnight cost of the equipment this unit owns, as sized by the optimiser for this target' + (S.build === 'RETRO' ? '; existing equipment at its book value' : '') + '.</p><div class="tbwrap"><table class="tb"><thead><tr><th>Component</th><th>Overnight CAPEX $</th><th>Fixed OPEX $/yr</th></tr></thead><tbody>';
    const ok = S.M.opex[u];
    S.M.capex[u].forEach(k => { const o = ok.find(x => x.replace('OPEX_', '') === k.replace('CAPEX_', '')); h += '<tr><td>' + esc(dataLabel(k)) + '</td><td>' + f0(num(S.d[k])) + '</td><td>' + (o ? f0(num(S.d[o])) : '—') + '</td></tr>'; });
    h += '<tr class="tot"><td>Total charged to the unit</td><td>' + f0(cf.capex) + '</td><td>' + f0(cf.opex_y1) + '</td></tr></tbody></table></div>';
    if (u === 'NH3' && S.build === 'RETRO') {
      const d = S.d;
      h += '<h4>What is existing and what is new</h4><div class="tbwrap"><table class="tb"><tbody>' +
        [['Reformer at this target', d.RETRO_STATE || '—'], ['Plant age', fd(num(d.RETRO_AGE), 0) + ' yr'], ['Existing reformer', fd(num(d.P_SMR_EX), 1) + ' t H₂/day'], ['New reformer built', fd(num(d.P_SMR_NEW), 1) + ' t H₂/day'],
          ['Book value of the existing units', money(num(d.BOOK_TOT))], ['New capital, all units', money(num(d.NEWCAP_TOT))], ['HOPS: existing plant carrying on', f0(num(d.BAU_LCOA_A)) + ' $/t'], ['HOPS: greenfield hybrid at this target', f0(num(d.GF_LCOA_A)) + ' $/t']]
          .map(x => '<tr><td>' + x[0] + '</td><td>' + esc(x[1]) + '</td></tr>').join('') + '</tbody></table></div>';
    }
    if (u === 'OPR') {
      const d = S.d, r = S.rates, R = S.res, pk = R.export_rev - num(d.E_exp) * r.r_RES;
      h += '<h4>Where the operator\'s value comes from</h4><p class="hint">The operator buys every renewable MWh at the fixed PPA rate and sells the surplus into the hourly market.</p><div class="tbwrap"><table class="tb"><thead><tr><th>Item</th><th>Year 1</th></tr></thead><tbody>' +
        [['Grid export revenue at hourly prices × realisation, $', f0(R.export_rev)], ['Grid export, MWh', f0(num(d.E_exp))], ['Average export price, $/MWh', fd(num(d.E_exp) ? R.export_rev / d.E_exp : NaN, 1)],
          ['The same MWh valued at the renewables PPA rate, $', f0(num(d.E_exp) * r.r_RES)], ['Value of selling into price peaks, $', f0(pk)], ['Grid import cost at hourly prices, $', f0(-num(d.IMP_COST))],
          ['Grid import, MWh', f0(num(d.E_imp))], ['Demand, capacity and network charges, $', f0(-(num(d.DEMAND_CH) + num(d.NET_CH)))], ['Curtailed renewable MWh', f0(num(d.E_curt))],
          ['Electricity tariff to the units (average procurement cost + margin), $/MWh', fd(S.negNow.tariff, 1)]]
          .map(x => '<tr><td>' + x[0] + '</td><td>' + x[1] + '</td></tr>').join('') + '</tbody></table></div>';
    }
    return h;
  }

  function tabCash(u, cf) {
    if (!cf.built) return '<p class="hint">This unit is not built at this target.</p>';
    const rows = [['Capital spend', r => r.con ? -r.capex : null], ['Debt drawn', r => r.con ? r.debtDraw : null], ['Interest during construction (capitalised)', r => r.con ? r.idc : null],
      ['Revenue', r => r.con ? null : r.rev], ['Operating costs', r => r.con ? null : -r.cost], ['EBITDA', r => r.con ? null : r.ebitda, 1], ['Depreciation', r => r.con ? null : -r.dep],
      ['Interest', r => r.con ? null : -r.interest], ['Tax', r => r.con ? null : -r.tax], ['Cash available for debt service', r => r.con ? null : r.cfads, 1], ['Debt service', r => r.con ? null : -r.debtService],
      ['Equity cash flow', r => r.eqcf, 1], ['Project cash flow (unlevered, after tax)', r => r.pcf, 1], ['Debt balance, end of year', r => r.con ? null : r.debtClose]];
    let h = '<p class="hint">$ million. C1–C3 are construction years; 1–30 are operating years. Scroll sideways.</p><div class="tbwrap cf"><table class="tb"><thead><tr><th>$ million</th>' +
      cf.rows.map(r => '<th>' + (r.con ? 'C' + r.p : r.y) + '</th>').join('') + '</tr></thead><tbody>';
    rows.forEach(([lab, f, tot]) => {
      h += '<tr' + (tot ? ' class="tot"' : '') + '><td>' + lab + '</td>' + cf.rows.map(r => { const v = f(r); return v == null ? '<td></td>' : '<td class="' + (v < -5e3 ? 'neg' : '') + '">' + fd(v / 1e6, 1) + '</td>'; }).join('') + '</tr>';
    });
    h += '<tr><td>DSCR</td>' + cf.rows.map(r => '<td>' + (r.con || !isFinite(r.dscr) ? '' : fd(r.dscr, 2)) + '</td>').join('') + '</tr></tbody></table></div>';
    return h;
  }

  function tabAssume(u, fin) {
    const ed = S.finEdited[u];
    let h = '<h4>Financing of this unit</h4><p class="hint">Each unit is financed on its own balance sheet. Renewables use developer terms, the other units industrial terms. The equity hurdle of every unit is the minimum equity return in the case bar (' + pct(S.hmin, 0) + '). Change a value and press Enter; the optimum is solved again.</p><div class="agrid">';
    FIN_FIELDS.forEach(([k, lab, un]) => {
      const v = un === '%' ? fin[k] * 100 : fin[k];
      h += '<label>' + lab + '<span class="in"><input type="number" step="' + (un === '%' ? 0.5 : un === '×' ? 0.05 : 1) + '" value="' + Number(v.toFixed(3)) + '" data-fin="' + k + '" class="' + (ed.has(k) ? 'edited' : '') + '"><span class="un">' + un + '</span></span></label>';
    });
    h += '</div>';
    if (u === 'OPR') h += '<h4>Grid exports</h4><p class="hint">1.00 values every exported MWh at the full hourly wholesale price, as the v13 runs did.</p><div class="agrid"><label>Export price realised, share of wholesale<span class="in"><input type="number" step="0.01" min="0" value="' +
      Number(S.inp.exp_real.toFixed(3)) + '" data-inp="exp_real" class="' + (S.inpEdited.has('exp_real') ? 'edited' : '') + '"><span class="un">× wholesale</span></span></label></div>';
    if (u === 'NH3' && S.build === 'RETRO') h += '<h4>Existing equipment</h4><p class="hint">Share of the existing units\' book value charged as investment (1 = as HOPS; the fossil reference carries the same share).</p><div class="agrid"><label>Book value charged<span class="in"><input type="number" step="0.05" min="0" max="1" value="' +
      Number(S.inp.book_share.toFixed(2)) + '" data-inp="book_share" class="' + (S.inpEdited.has('book_share') ? 'edited' : '') + '"><span class="un">share</span></span></label></div>';
    h += '<h4>Shared by all units</h4><div class="agrid">' +
      '<label>Revenue escalation per year<span class="in"><input type="number" step="0.1" value="' + Number((S.sh.esc_rev * 100).toFixed(3)) + '" data-sh="esc_rev"><span class="un">%</span></span></label>' +
      '<label>Cost escalation per year<span class="in"><input type="number" step="0.1" value="' + Number((S.sh.esc_cost * 100).toFixed(3)) + '" data-sh="esc_cost"><span class="un">%</span></span></label>' +
      '<label>Construction<span class="in"><b class="num">' + S.M.ncon + ' years · ' + S.sh.spend.map(x => Math.round(x * 100) + '%').join(' / ') + '</b></span></label>' +
      '<label>Operating life<span class="in"><b class="num">' + S.M.nops + ' years</b></span></label></div>' +
      '<p style="margin-top:var(--s4)"><button class="btn ghost sm" type="button" data-finreset="1">Reset the assumptions on this tab</button></p>' +
      '<h4>How the numbers are built</h4><p class="hint">Debt is drawn pro rata with the spend, interest during construction is capitalised, and the loan is repaid as an annuity over the tenor. Tax is paid on positive earnings before tax only; losses are not carried forward. ' +
      'Project NPV discounts the unlevered after-tax cash flow at the project discount rate; equity NPV discounts the cash flow to equity at the minimum equity return.</p>';
    return h;
  }

  /* ------------------------------------------------------------ charts (plain SVG) */
  const CT = $('pfCtip');
  function showTip(e, html) { CT.innerHTML = html; CT.style.display = 'block'; const w = CT.offsetWidth, x = Math.min(window.innerWidth - w - 8, e.clientX + 14); CT.style.left = Math.max(8, x) + 'px'; CT.style.top = Math.max(8, e.clientY - CT.offsetHeight - 12) + 'px'; }
  function hideTip() { CT.style.display = 'none'; }
  function ticks(lo, hi, n) {
    if (hi === lo) { hi = lo + 1; }
    const raw = (hi - lo) / n, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p, st = (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p, out = [];
    for (let v = Math.ceil(lo / st) * st; v <= hi + st * 1e-9; v += st) out.push(Math.abs(v) < st * 1e-9 ? 0 : v);
    return out;
  }
  const tk = v => { const a = Math.abs(v); return (v < 0 ? '−' : '') + (a >= 100 || a === Math.round(a) ? nf0.format(a) : a >= 10 ? nfd(1).format(a) : nfd(2).format(a)); };
  const AX = 'font:500 11px var(--mono);fill:var(--ink-3)';
  function frame(W, H, m, lo, hi, n, fmt) {
    const y = v => m.t + (H - m.t - m.b) * (1 - (v - lo) / (hi - lo));
    let g = '';
    ticks(lo, hi, n || 5).forEach(v => { g += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="' + (v === 0 ? 'var(--ink-3)' : 'var(--rule)') + '" stroke-width="1"/><text x="' + (m.l - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end" style="' + AX + '">' + (fmt || tk)(v) + '</text>'; });
    return { y, g };
  }
  function svg(W, H, inner) { return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img">' + inner + '</svg>'; }

  function drawCharts(u, cf, fin) {
    const flows = (S.basis === 'equity' ? cf.eqcf : cf.pcf).map(v => v / 1e6), cum = []; flows.reduce((a, v, i) => (cum[i] = a + v), 0);
    let W = 620, H = 270, m = { l: 58, r: 14, t: 10, b: 30 };
    let lo = Math.min(0, Math.min.apply(null, flows)), hi = Math.max(0, Math.max.apply(null, flows));
    const padv = (hi - lo) * 0.06 || 1; lo -= lo < 0 ? padv : 0; hi += padv;
    let F = frame(W, H, m, lo, hi, 5), bw = (W - m.l - m.r) / flows.length, g = F.g;
    flows.forEach((v, i) => {
      const x = m.l + i * bw, y0 = F.y(0), y1 = F.y(v);
      g += '<rect x="' + (x + 1.5) + '" y="' + Math.min(y0, y1) + '" width="' + (bw - 3) + '" height="' + Math.max(1, Math.abs(y1 - y0)) + '" rx="2" fill="var(--d1)" opacity="' + (i < S.M.ncon ? 0.55 : 1) + '"/>';
    });
    const pb = S.basis === 'equity' ? cf.payback_equity : cf.payback_project;
    if (isFinite(pb)) { const xp = m.l + (S.M.ncon + pb) * bw, right = xp > W - 150;
      g += '<line x1="' + xp + '" x2="' + xp + '" y1="' + m.t + '" y2="' + (H - m.b) + '" stroke="var(--ink)" stroke-width="2"/><text x="' + (xp + (right ? -8 : 8)) + '" y="' + (m.t + 12) + '" text-anchor="' + (right ? 'end' : 'start') + '" style="font:600 12px var(--sans);fill:var(--ink);paint-order:stroke;stroke:var(--panel);stroke-width:5px;stroke-linejoin:round">paid back after ' + nfd(1).format(pb) + ' years</text>'; }
    else g += '<text x="' + (W - m.r) + '" y="' + (m.t + 12) + '" text-anchor="end" style="font:600 12px var(--sans);fill:var(--bad);paint-order:stroke;stroke:var(--panel);stroke-width:5px;stroke-linejoin:round">not paid back within 30 years</text>';
    cf.rows.forEach((r, i) => { if (r.con ? r.p === 1 : (r.y === 1 || r.y % 5 === 0)) g += '<text x="' + (m.l + i * bw + bw / 2) + '" y="' + (H - 10) + '" text-anchor="middle" style="' + AX + '">' + (r.con ? 'C' + r.p : r.y) + '</text>'; });
    flows.forEach((v, i) => { g += '<rect data-i="' + i + '" x="' + (m.l + i * bw) + '" y="' + m.t + '" width="' + bw + '" height="' + (H - m.t - m.b) + '" fill="transparent"/>'; });
    const c1 = $('chCash'); c1.innerHTML = svg(W, H, g);
    c1.onmousemove = e => { const t = e.target.closest('[data-i]'); if (!t) return hideTip(); const i = +t.dataset.i, r = cf.rows[i];
      showTip(e, '<div class="t">' + (r.con ? 'Construction year ' + r.p : 'Operating year ' + r.y) + ' · ' + S.basis + ' basis</div>In the year <b>' + money(flows[i] * 1e6) + '</b><br>Cumulative <b>' + money(cum[i] * 1e6) + '</b>' +
        (r.con ? '' : '<br>EBITDA <b>' + money(r.ebitda) + '</b> · tax <b>' + money(r.tax) + '</b><br>Debt service <b>' + money(r.debtService) + '</b>')); };
    c1.onmouseleave = hideTip;

    let items = cf.lines.filter(l => Math.abs(l.value) > 1).map(l => ({ label: l.label, v: l.sign * l.value / 1e6, c: l.sign > 0 ? 'var(--d1)' : 'var(--d2)' }));
    if (cf.opex_y1 > 1) items.push({ label: 'Fixed operating cost', v: -cf.opex_y1 / 1e6, c: 'var(--d2)' });
    items.sort((a, b) => (b.v > 0) - (a.v > 0) || Math.abs(b.v) - Math.abs(a.v));
    items.push({ label: 'EBITDA, year 1', v: cf.ebitda_y1 / 1e6, c: 'var(--ink)', bold: 1 });
    const rh = 24; W = 620; H = items.length * rh + 26; const lw = 300, vw = 62, x0 = lw, x1 = W - vw;
    lo = Math.min(0, Math.min.apply(null, items.map(i => i.v))); hi = Math.max(0, Math.max.apply(null, items.map(i => i.v)));
    const X = v => x0 + (x1 - x0) * (v - lo) / ((hi - lo) || 1);
    g = '<line x1="' + X(0) + '" x2="' + X(0) + '" y1="4" y2="' + (H - 22) + '" stroke="var(--ink-3)" stroke-width="1"/>';
    items.forEach((it, i) => {
      const y = 6 + i * rh, a = X(0), b = X(it.v), lab0 = it.label.replace(/ \(.*\)$/, ''), lab = lab0.length > 46 ? lab0.slice(0, 44) + '…' : lab0;
      g += '<text x="0" y="' + (y + 13) + '" style="font:' + (it.bold ? 700 : 500) + ' 12px var(--sans);fill:var(--ink-2)">' + esc(lab) + '</text>' +
        '<rect x="' + Math.min(a, b) + '" y="' + (y + 2) + '" width="' + Math.max(1.5, Math.abs(b - a)) + '" height="' + (rh - 8) + '" rx="3" fill="' + it.c + '"/>' +
        '<text x="' + W + '" y="' + (y + 13) + '" text-anchor="end" style="font:' + (it.bold ? 600 : 500) + ' 12px var(--mono);fill:var(--ink)">' + tk(it.v) + '</text>' +
        '<rect data-i="' + i + '" x="0" y="' + y + '" width="' + W + '" height="' + rh + '" fill="transparent"/>';
    });
    const c2 = $('chLines'); c2.innerHTML = svg(W, H, g);
    c2.onmousemove = e => { const t = e.target.closest('[data-i]'); if (!t) return hideTip(); const it = items[+t.dataset.i]; showTip(e, '<div class="t">' + esc(it.label) + '</div><b>' + money(it.v * 1e6) + '</b> in year 1'); };
    c2.onmouseleave = hideTip;

    const ds = cf.debt > 1e4 ? cf.rows.filter(r => !r.con && isFinite(r.dscr)) : [], c3 = $('chDscr');
    if (!ds.length) c3.innerHTML = '<p class="hint" style="margin:var(--s4) 0">No debt in this unit\'s financing.</p>';
    else {
      W = 620; H = 250; m = { l: 46, r: 16, t: 12, b: 30 };
      const vals = ds.map(r => r.dscr); lo = Math.min(0.8, Math.min.apply(null, vals), fin.dscr) - 0.1; hi = Math.max(Math.max.apply(null, vals), fin.dscr) + 0.15;
      F = frame(W, H, m, lo, hi, 5, v => nfd(1).format(v) + '×'); g = F.g;
      const xx = i => m.l + (W - m.l - m.r) * (ds.length > 1 ? i / (ds.length - 1) : 0.5);
      g += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + F.y(fin.dscr) + '" y2="' + F.y(fin.dscr) + '" stroke="var(--d2)" stroke-width="2" stroke-dasharray="6 4"/>';
      g += '<path d="' + ds.map((r, i) => (i ? 'L' : 'M') + xx(i) + ' ' + F.y(r.dscr)).join('') + '" fill="none" stroke="var(--d1)" stroke-width="2" stroke-linejoin="round"/>';
      const mi = vals.indexOf(Math.min.apply(null, vals));
      g += '<circle cx="' + xx(mi) + '" cy="' + F.y(vals[mi]) + '" r="4.5" fill="var(--d1)" stroke="var(--panel)" stroke-width="2"/><text x="' + Math.min(W - 60, Math.max(m.l + 30, xx(mi))) + '" y="' + (F.y(vals[mi]) + 18) + '" text-anchor="middle" style="font:600 12px var(--sans);fill:var(--ink)">lowest ' + mult(vals[mi]) + '</text>';
      ds.forEach((r, i) => { if (r.y === 1 || r.y % 5 === 0) g += '<text x="' + xx(i) + '" y="' + (H - 10) + '" text-anchor="middle" style="' + AX + '">' + r.y + '</text>'; });
      const sw = (W - m.l - m.r) / ds.length;
      ds.forEach((r, i) => { g += '<rect data-i="' + i + '" x="' + (xx(i) - sw / 2) + '" y="' + m.t + '" width="' + sw + '" height="' + (H - m.t - m.b) + '" fill="transparent"/>'; });
      c3.innerHTML = svg(W, H, g);
      c3.onmousemove = e => { const t = e.target.closest('[data-i]'); if (!t) return hideTip(); const r = ds[+t.dataset.i];
        showTip(e, '<div class="t">Operating year ' + r.y + '</div>DSCR <b>' + mult(r.dscr) + '</b><br>Cash available <b>' + money(r.cfads) + '</b><br>Debt service <b>' + money(r.debtService) + '</b>'); };
      c3.onmouseleave = hideTip;
    }

    const pr = BUFin.primaryRate(u), c4 = $('chSens'), d = S.d;
    let cur, xs = [], series, xlab, xfmt, minP = NaN, minE = NaN;
    const run = (rates, inp) => BUFin.unitCf(u, d, rates, inp, fin, S.sh, true);
    if (pr) {
      cur = S.rates[pr]; minP = cf.min_p; minE = cf.min_e;
      const ref = [cur, minP, minE].filter(isFinite), a = Math.min.apply(null, ref), b = Math.max.apply(null, ref), span = Math.max(b - a, Math.abs(b) * 0.25, 1e-6);
      for (let i = 0; i <= 24; i++) xs.push(a - span * 0.6 + (b - a + span * 1.2) * i / 24);
      series = xs.map(x => { const rr = Object.assign({}, S.rates); rr[pr] = x; return run(rr, S.inpX); });
      xlab = RATE_SHORT[pr].replace(/^Sells /, '').replace(/ \(market price\)/, ' price') + ', ' + rateUnit(pr); xfmt = v => fd(v, rateDec(pr) > 1 ? 2 : Math.abs(xs[24] - xs[0]) < 20 ? 1 : 0);
      $('chSensT').textContent = 'NPV against the ' + (pr === 'p_NH3' ? 'ammonia price' : 'selling rate');
      $('chSensS').textContent = 'Where each line crosses zero is the minimum ' + (pr === 'p_NH3' ? 'price' : 'rate') + ' on that basis · ' + xlab;
    } else {
      cur = S.inp.exp_real; for (let i = 0; i <= 24; i++) xs.push(0.6 + 0.6 * i / 24);
      series = xs.map(x => run(S.rates, Object.assign({}, S.inpX, { exp_real: x })));
      xlab = 'export price realised, × wholesale'; xfmt = v => fd(v, 2);
      $('chSensT').textContent = 'NPV against the export price realised'; $('chSensS').textContent = 'The operator keeps what the hourly market pays above the fixed rates · ' + xlab;
    }
    $('chSensL').innerHTML = '<span><i style="background:var(--d1)"></i>Project NPV at ' + pct(fin.disc) + '</span><span><i style="background:var(--d3)"></i>Equity NPV at ' + pct(fin.hurdle) + '</span><span><i style="background:var(--ink);width:2px;height:12px"></i>Current ' + (pr === 'p_NH3' ? 'market price' : pr ? 'rate' : 'value') + '</span>';
    const sp = series.map(s => s.npv_project / 1e6), se = series.map(s => s.npv_equity / 1e6);
    W = 620; H = 250; m = { l: 62, r: 16, t: 12, b: 30 };
    lo = Math.min(0, Math.min.apply(null, sp), Math.min.apply(null, se)); hi = Math.max(0, Math.max.apply(null, sp), Math.max.apply(null, se)); const pv = (hi - lo) * 0.06 || 1; lo -= pv; hi += pv;
    F = frame(W, H, m, lo, hi, 5); g = F.g;
    const SX = v => m.l + (W - m.l - m.r) * (v - xs[0]) / (xs[24] - xs[0]);
    ticks(xs[0], xs[24], 5).forEach(v => { g += '<text x="' + SX(v) + '" y="' + (H - 10) + '" text-anchor="middle" style="' + AX + '">' + xfmt(v) + '</text>'; });
    g += '<line x1="' + SX(cur) + '" x2="' + SX(cur) + '" y1="' + m.t + '" y2="' + (H - m.b) + '" stroke="var(--ink)" stroke-width="2"/>';
    g += '<path d="' + xs.map((x, i) => (i ? 'L' : 'M') + SX(x) + ' ' + F.y(sp[i])).join('') + '" fill="none" stroke="var(--d1)" stroke-width="2"/>';
    g += '<path d="' + xs.map((x, i) => (i ? 'L' : 'M') + SX(x) + ' ' + F.y(se[i])).join('') + '" fill="none" stroke="var(--d3)" stroke-width="2"/>';
    if (isFinite(minP)) g += '<circle cx="' + SX(minP) + '" cy="' + F.y(0) + '" r="4.5" fill="var(--d1)" stroke="var(--panel)" stroke-width="2"/>';
    if (isFinite(minE)) g += '<circle cx="' + SX(minE) + '" cy="' + F.y(0) + '" r="4.5" fill="var(--d3)" stroke="var(--panel)" stroke-width="2"/>';
    const sw2 = (W - m.l - m.r) / 24;
    xs.forEach((x, i) => { g += '<rect data-i="' + i + '" x="' + (SX(x) - sw2 / 2) + '" y="' + m.t + '" width="' + sw2 + '" height="' + (H - m.t - m.b) + '" fill="transparent"/>'; });
    c4.innerHTML = svg(W, H, g);
    c4.onmousemove = e => { const t = e.target.closest('[data-i]'); if (!t) return hideTip(); const i = +t.dataset.i;
      showTip(e, '<div class="t">' + esc(xlab) + ' = ' + xfmt(xs[i]) + '</div>Project NPV <b>' + money(sp[i] * 1e6) + '</b><br>Equity NPV <b>' + money(se[i] * 1e6) + '</b>' +
        (isFinite(minP) ? '<div class="t">zero at ' + fd(minP, rateDec(pr) || 0) + ' (project) · ' + fd(minE, rateDec(pr) || 0) + ' (equity)</div>' : '')); };
    c4.onmouseleave = hideTip;
  }

  window.PF = S;   // for inspection in the console
})();
