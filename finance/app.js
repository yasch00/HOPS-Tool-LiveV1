/* Project Finance page — plant picker, business-unit panels, detail window.
   Numbers come from data/finance/ (tools/bu_finance_to_web.py) and finance/engine.js (port of build_bu_finance.py). */
(function () {
  'use strict';
  const DATA = (window.HOPS_DATA_BASE || '../data/') + 'finance/';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const num = v => (typeof v === 'number' && isFinite(v) ? v : 0);
  const MARKET = { US: 450, Canada: 450, India: 500, Europe: 660 };          // same starting prices as the atlas finance tab
  const REGION_ORDER = ['Europe', 'US', 'Canada', 'India'];
  const UNIT_SHORT = { RES: 'Renewables', BAT: 'Battery', HB: 'Heat battery', EL: 'Electrolyzer', H2ST: 'Hydrogen storage', NH3: 'Ammonia plant', OPR: 'Operator' };
  const UNIT_SUB = { RES: 'PV + wind', BAT: '', HB: '', EL: '', H2ST: 'compressor + tank', NH3: 'SMR + synthesis + ASU', OPR: 'grid connection + trading hub' };
  const RATE_SHORT = {
    r_RES: 'Sells electricity to operator (PPA)', r_B_in: 'Buys charging electricity', r_B_out: 'Sells discharged electricity', r_B_cap: 'Availability payment',
    r_HB_in: 'Buys electricity', r_heat: 'Sells heat', r_EL_in: 'Buys electricity', r_H2_EL: 'Sells hydrogen',
    r_ST_e: 'Buys compression electricity', r_ST_in: 'Buys hydrogen (into store)', r_ST_out: 'Sells hydrogen (out of store)',
    r_NH3_e: 'Buys electricity', r_SMRgen: 'Sells SMR power', r_H2_NH3: 'Buys green hydrogen', r_heat_NH3: 'Buys heat',
    p_NG: 'Buys natural gas', p_NH3: 'Sells ammonia at the market price'
  };
  const UNIT_RATES = { RES: ['r_RES'], BAT: ['r_B_out', 'r_B_in', 'r_B_cap'], HB: ['r_heat', 'r_HB_in'], EL: ['r_H2_EL', 'r_EL_in'],
    H2ST: ['r_ST_out', 'r_ST_in', 'r_ST_e'], NH3: ['p_NH3', 'r_H2_NH3', 'r_heat_NH3', 'r_NH3_e', 'r_SMRgen', 'p_NG'], OPR: [] };
  const FIN_FIELDS = [['gearing', 'Gearing (debt share)', '%'], ['rate', 'Cost of debt', '%'], ['tenor', 'Debt tenor', 'yr'], ['tax', 'Tax rate', '%'],
    ['dep', 'Depreciation, straight line', 'yr'], ['disc', 'Project discount rate (hurdle)', '%'], ['hurdle', 'Equity hurdle rate', '%'], ['dscr', 'Target DSCR', '×']];

  const S = { index: null, M: null, plant: null, ccs: 'No', ci: null, rates: null, edited: new Set(), inp: null, inpEdited: new Set(),
    fins: {}, finEdited: {}, sh: null, shEdited: new Set(), market: null, marketEdited: false, res: null, d: null, modal: null, tab: 'overview', basis: 'equity', map: null };

  /* ------------------------------------------------------------ formatting */
  const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  const nfd = n => new Intl.NumberFormat('en-US', { minimumFractionDigits: n, maximumFractionDigits: n });
  const f0 = v => (isFinite(v) ? nf0.format(v) : 'n/a');
  const fd = (v, n) => (isFinite(v) ? nfd(n).format(v) : 'n/a');
  function money(v) {                                   // $ in millions, sign kept
    if (!isFinite(v)) return 'n/a';
    const m = v / 1e6, a = Math.abs(m), s = m < 0 ? '−' : '';
    return s + '$' + (a >= 100 ? nf0.format(a) : a >= 10 ? nfd(1).format(a) : nfd(2).format(a)) + ' M';
  }
  const pct = (v, n) => (isFinite(v) ? nfd(n == null ? 1 : n).format(v * 100) + '%' : 'n/a');
  const mult = v => (isFinite(v) ? nfd(2).format(v) + '×' : 'n/a');
  const yrs = v => (isFinite(v) ? nfd(1).format(v) + ' yr' : '> 30 yr');
  const rateDec = k => (/H2|ST_in|ST_out/.test(k) ? 2 : k === 'p_NG' ? 2 : k === 'p_NH3' ? 0 : 1);
  const rateStep = k => (/H2|ST_in|ST_out/.test(k) ? 0.05 : k === 'p_NH3' ? 5 : 0.5);
  const rateUnit = k => (S.M.rates.find(r => r[0] === k) || [])[2] || '';
  const dataLabel = k => { const r = S.M.data_rows.find(x => x[0] === k); return r ? r[1] : k; };
  function volUnit(v) { return v.startsWith('E_') ? 'MWh' : v.endsWith('_kg') ? 'kg' : v.startsWith('H_') ? 'MWh-th' : v === 'P_B_MWh' ? 'MWh cap' : v === 'NH3_t' ? 't' : 'MWh NG'; }

  /* ------------------------------------------------------------ boot */
  fetch(DATA + 'index.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).then(ix => {
    S.index = ix; S.M = ix.model; BUFin.setModel(ix.model);
    S.M.units.forEach(u => { S.fins[u] = Object.assign({}, ix.model.fin[u]); S.finEdited[u] = new Set(); });
    S.sh = { spend: ix.model.spend.slice(), esc_rev: ix.model.esc_rev, esc_cost: ix.model.esc_cost };
    $('pfStamp').textContent = 'Project Finance · model ' + ix.label + ' · data ' + ix.generated;
    buildList(''); initMap();
    const q = new URLSearchParams(location.search), want = parseInt(q.get('plant'), 10);
    const first = ix.plants.find(p => p.idx === want) || ix.plants.find(p => p.idx === 61) || ix.plants[0];
    if (q.get('ccs')) S.ccs = q.get('ccs') === 'Yes' ? 'Yes' : 'No';
    if (q.get('ci')) S.ci = parseFloat(q.get('ci'));
    selectPlant(first.idx, false);
  }).catch(e => { $('pfStatus').textContent = 'The finance data could not be loaded (' + e.message + ').'; });

  $('pfSearch').addEventListener('input', e => buildList(e.target.value));
  $('pfMarket').addEventListener('input', e => { const v = parseFloat(e.target.value); if (isFinite(v) && v >= 0) { S.market = v; S.marketEdited = true; S.rates.p_NH3 = v; compute(); } });
  $('pfReset').addEventListener('click', () => { S.edited.clear(); S.inpEdited.clear(); S.inp = null; S.rates = null; compute(true); });

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
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: { idx: p.idx, name: p.name || 'Plant ' + p.idx, where: [p.admin, p.country].filter(Boolean).join(', '), ktpa: p.ktpa || 0 } })) } });
      map.addLayer({ id: 'pl-halo', type: 'circle', source: 'plants', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 5.5, 6, 9], 'circle-color': '#fff', 'circle-opacity': 0.9 } });
      map.addLayer({ id: 'pl-pts', type: 'circle', source: 'plants', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 3.8, 6, 7], 'circle-color': '#1E9A6E' } });
      map.addLayer({ id: 'pl-sel', type: 'circle', source: 'plants', filter: ['==', ['get', 'idx'], -1],
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 9, 6, 13], 'circle-color': '#D9822B', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2.5 } });
      const tip = $('pfTip');
      map.on('mousemove', 'pl-halo', e => {
        const f = e.features[0]; map.getCanvas().style.cursor = 'pointer';
        tip.innerHTML = esc(f.properties.name) + '<small>' + esc(f.properties.where) + ' · ' + f0(f.properties.ktpa) + ' kt/yr</small>';
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
    else m.jumpTo({ center: [S.plant.lon - 18, Math.min(S.plant.lat, 42)], zoom: 2.2 });   // first view: the whole region, the plant right of the card
  }

  /* ------------------------------------------------------------ selection */
  function selectPlant(idx, fly) {
    $('pfStatus').hidden = false; $('pfStatus').textContent = 'Loading plant…';
    fetch(DATA + 'plant' + idx + '.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).then(p => {
      S.plant = p;
      const cc = Object.keys(p.cases);
      if (!cc.includes(S.ccs)) S.ccs = cc.includes('No') ? 'No' : cc[0];
      S.rates = null; S.inp = null; S.edited.clear(); S.inpEdited.clear(); S.marketEdited = false; S.market = null;
      pickCi(); compute(true);
      $('pfStatus').hidden = true; $('pfMain').hidden = false; $('pfHead').hidden = false;
      document.querySelectorAll('#pfList button').forEach(b => {
        const on = +b.dataset.idx === idx; b.setAttribute('aria-selected', on);
        if (on) { const L = $('pfList'); if (b.offsetTop < L.scrollTop || b.offsetTop + b.offsetHeight > L.scrollTop + L.clientHeight) L.scrollTop = b.offsetTop - 60; }
      });
      markSelected(fly);
    }).catch(e => { $('pfStatus').textContent = 'No finance data for this plant (' + e.message + ').'; });
  }
  function points() { return S.plant.cases[S.ccs] || []; }
  function pickCi() {
    const cis = points().map(d => d.CI);
    if (cis.includes(S.ci)) return;
    S.ci = cis.includes(1.0) ? 1.0 : cis[Math.min(cis.length - 1, 4)];
  }

  /* ------------------------------------------------------------ compute */
  function compute(rebuild) {
    const d = points().find(x => x.CI === S.ci); if (!d) return;
    S.d = d;
    if (!S.inp) S.inp = { curt_paid: S.M.curt_paid, grid_opex_pct: S.M.grid_opex_pct, exp_real: Math.round(num(d.EXPORT_DISC) * 100) / 100 || 1 };
    if (!S.marketEdited) S.market = MARKET[S.plant.region] != null ? MARKET[S.plant.region] : (num(d.NH3_PRICE_RUN) || 660);
    if (!S.rates || (S.edited.size === 0 && rebuild)) S.rates = BUFin.defaultRates(d, S.inp, S.fins, S.sh, S.market);
    S.rates.p_NH3 = S.market;
    S.res = BUFin.evaluate(d, S.rates, S.inp, S.fins, S.sh);
    if (rebuild) { buildHead(); buildUnits(); }
    paint();
    if (S.modal && $('pfModal').open) renderModal(false);
    const q = new URLSearchParams({ plant: S.plant.idx, ccs: S.ccs, ci: S.ci.toFixed(2) });
    try { history.replaceState(null, '', '?' + q.toString()); } catch (e) { /* file:// */ }
  }

  /* ------------------------------------------------------------ headline */
  function buildHead() {
    const p = S.plant;
    $('pfName').textContent = (p.name || 'Plant ' + p.idx) + (p.admin ? ', ' + p.admin : '');
    $('pfMeta').textContent = p.country + ' · ' + f0(p.tpd) + ' t NH₃/day · ' + f0(p.ktpa) + ' kt/yr · plant ' + p.idx;
    const cc = Object.keys(p.cases).sort();
    $('pfCcs').innerHTML = cc.map(c => '<button type="button" data-ccs="' + c + '" aria-pressed="' + (c === S.ccs) + '">' + (c === 'Yes' ? 'With CCS' : 'Without CCS') + '</button>').join('');
    $('pfCi').innerHTML = points().map(d => '<button type="button" data-ci="' + d.CI + '" aria-pressed="' + (d.CI === S.ci) + '">' + d.CI.toFixed(2) + '</button>').join('');
    if (document.activeElement !== $('pfMarket')) $('pfMarket').value = S.market;
  }
  $('pfCcs').addEventListener('click', e => { const b = e.target.closest('button[data-ccs]'); if (!b) return; S.ccs = b.dataset.ccs; pickCi(); if (S.edited.size === 0) S.rates = null; compute(true); });
  $('pfCi').addEventListener('click', e => { const b = e.target.closest('button[data-ci]'); if (!b) return; S.ci = parseFloat(b.dataset.ci); if (S.edited.size === 0) S.rates = null; compute(true); });

  /* ------------------------------------------------------------ unit panels */
  function capText(u, d) {
    const g = (k, n) => fd(num(d[k]), n == null ? 0 : n);
    switch (u) {
      case 'RES': return g('P_PV') + ' MW PV · ' + g('P_WT') + ' MW wind';
      case 'BAT': return g('P_B_MWh') + ' MWh';
      case 'HB': return g('P_HB') + ' MW';
      case 'EL': return g('P_EL') + ' MW';
      case 'H2ST': return g('P_ST_t', 1) + ' t H₂ tank · ' + g('P_CP', 1) + ' MW compressor';
      case 'NH3': return f0(S.plant.tpd) + ' t NH₃/day' + (S.ccs === 'Yes' ? ' · with CCS' : '');
      case 'OPR': return fd(num(d.E_imp) / 1e3, 0) + ' GWh import · ' + fd(num(d.E_exp) / 1e3, 0) + ' GWh export';
    }
    return '';
  }
  function rateRow(k) {
    return '<div class="rate"><label for="r_' + k + '">' + esc(RATE_SHORT[k]) + '</label><div class="in"><input id="r_' + k + '" type="number" inputmode="decimal" step="' + rateStep(k) +
      '" data-rate="' + k + '"><span class="un">' + esc(rateUnit(k).replace(' NH3', '').replace(' H2', '').replace(' NG', '')) + '</span></div><div class="min" data-min="' + k + '"></div></div>';
  }
  function buildUnits() {
    const d = S.d; let h = '';
    S.M.units.forEach(u => {
      let rates = UNIT_RATES[u].map(rateRow).join('');
      if (u === 'OPR') rates =
        '<div class="rate"><label for="i_exp">Export price realised vs wholesale</label><div class="in"><input id="i_exp" type="number" step="0.01" min="0" data-inp="exp_real"><span class="un">× wholesale</span></div><div class="min">the run assumed ' + fd(num(d.EXPORT_DISC), 2) + '</div></div>' +
        '<div class="rate"><label for="i_curt">Curtailed renewable MWh still paid</label><div class="in"><input id="i_curt" type="number" step="5" min="0" max="100" data-inp="curt_paid" data-pct="1"><span class="un">%</span></div></div>';
      h += '<div class="unit" style="--uc:var(--u-' + u + ')" data-unit="' + u + '" role="button" tabindex="0" aria-label="' + esc(UNIT_SHORT[u]) + ': open details">' +
        '<header><div><h4>' + esc(UNIT_SHORT[u]) + '</h4><div class="cap">' + esc(capText(u, d)) + '</div></div><span class="pill" data-k="pill"></span></header>' +
        '<div><div class="irr"><b data-k="irr"></b><span data-k="irrsub"></span></div><div class="gauge" aria-hidden="true"><i data-k="gfill"></i><u data-k="gmark"></u></div></div>' +
        '<dl class="facts"><div><dt>Project NPV</dt><dd data-k="npv"></dd></div><div><dt>Equity IRR</dt><dd data-k="eirr"></dd></div>' +
        '<div><dt>CAPEX</dt><dd data-k="capex"></dd></div><div><dt>EBITDA yr 1</dt><dd data-k="ebitda"></dd></div>' +
        '<div><dt>Min DSCR</dt><dd data-k="dscr"></dd></div><div><dt>Equity payback</dt><dd data-k="pb"></dd></div></dl>' +
        '<div class="rates" data-stop="1">' + rates + '</div>' +
        '<div class="more"><span>Cash flows, NPV, IRR, assumptions</span><span aria-hidden="true">→</span></div></div>';
    });
    h += '<div class="unit policy" style="--uc:var(--rule-2)"><header><div><h4>Policy support</h4><div class="cap">coming later</div></div><span class="pill">Planned</span></header>' +
      '<p>A subsidy adder on top of the market price, paid per tonne of low-carbon ammonia, will sit here. It is not part of the numbers yet.</p></div>';
    $('pfUnits').innerHTML = h;
  }
  const U = $('pfUnits');
  U.addEventListener('click', e => {
    const mb = e.target.closest('button[data-setmin]');
    if (mb) { const k = mb.dataset.setmin, dec = rateDec(k), m = Math.pow(10, dec); S.rates[k] = Math.ceil(parseFloat(mb.dataset.v) * m - 1e-9) / m; S.edited.add(k); compute(); return; }
    if (e.target.closest('[data-stop]')) return;
    const c = e.target.closest('.unit[data-unit]'); if (c) openModal(c.dataset.unit);
  });
  U.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.unit[data-unit]')) { e.preventDefault(); openModal(e.target.dataset.unit); } });
  U.addEventListener('input', e => {
    const t = e.target, v = parseFloat(t.value); if (!isFinite(v)) return;
    if (t.dataset.rate) {
      const k = t.dataset.rate; S.rates[k] = v;
      if (k === 'p_NH3') { S.market = v; S.marketEdited = true; } else S.edited.add(k);   // the market price is not a rate between units
      compute();
    } else if (t.dataset.inp) { S.inp[t.dataset.inp] = t.dataset.pct ? v / 100 : v; S.inpEdited.add(t.dataset.inp); compute(); }
  });

  function status(cf, fin) {
    if (!cf.built) return ['', 'Not built'];
    const diff = cf.irr_project - fin.disc;
    if (isFinite(diff)) return Math.abs(diff) < 0.0005 ? ['at', 'At hurdle'] : diff > 0 ? ['ok', '✓ Above hurdle'] : ['bad', '✕ Below hurdle'];
    return cf.npv_project >= 0 ? ['ok', '✓ Above hurdle'] : ['bad', '✕ Below hurdle'];
  }
  function setVal(inp, v, dec) { if (document.activeElement !== inp) inp.value = isFinite(v) ? Number(v.toFixed(dec)) : ''; }

  function paint() {
    const R = S.res, d = S.d;
    // headline
    if (document.activeElement !== $('pfMarket')) $('pfMarket').value = S.market;
    const runP = num(d.NH3_PRICE_RUN);
    $('pfMarketSub').textContent = S.marketEdited ? 'your value · default ' + f0(MARKET[S.plant.region] || runP) : 'starting value for ' + S.plant.region + ' · editable';
    $('pfLcoa').textContent = f0(R.breakeven);
    const gap = R.gap, box = $('pfGapBox');
    box.classList.toggle('ok', gap <= 0); box.classList.toggle('bad', gap > 0);
    $('pfGap').textContent = isFinite(gap) ? (gap > 0 ? '+' : '−') + f0(Math.abs(gap)) : 'n/a';
    $('pfGapSub').textContent = isFinite(gap) ? (gap > 0 ? '✕ ' + pct(gap / S.market, 0) + ' above the market price' : '✓ ' + pct(-gap / S.market, 0) + ' below the market price') : '';
    $('pfBau').textContent = num(d.BAU_LCOA_A) ? f0(d.BAU_LCOA_A) : 'n/a';
    $('pfBauSub').textContent = num(d.BAU_CI) ? 'today, no CCS · ' + fd(d.BAU_CI, 2) + ' t CO₂/t' : '';
    // units
    S.M.units.forEach(u => {
      const el = U.querySelector('.unit[data-unit="' + u + '"]'); if (!el) return;
      const cf = R.units[u], fin = S.fins[u], q = k => el.querySelector('[data-k="' + k + '"]');
      const [cls, txt] = status(cf, fin);
      el.classList.toggle('off', !cf.built);
      const pill = q('pill'); pill.className = 'pill ' + cls; pill.textContent = txt;
      q('irr').textContent = !cf.built ? '—' : isFinite(cf.irr_project) ? pct(cf.irr_project) : 'none';
      q('irrsub').textContent = !cf.built ? 'no capacity at this target' : isFinite(cf.irr_project) ? 'project IRR · hurdle ' + pct(fin.disc) : 'project IRR: the cash flow never pays back · hurdle ' + pct(fin.disc);
      const top = Math.max(2 * fin.disc, isFinite(cf.irr_project) ? cf.irr_project * 1.15 : 0);
      q('gfill').style.width = (cf.built && isFinite(cf.irr_project) ? Math.max(0, Math.min(100, cf.irr_project / top * 100)) : 0) + '%';
      q('gmark').style.left = 'calc(' + (fin.disc / top * 100) + '% - 1px)';
      const npv = q('npv'); npv.textContent = cf.built ? money(cf.npv_project) : '—'; npv.classList.toggle('neg', cf.npv_project < -5e4);
      q('eirr').textContent = cf.built ? pct(cf.irr_equity) + ' / ' + pct(fin.hurdle, 0) : '—';
      q('capex').textContent = cf.built ? money(cf.capex) : '—';
      const eb = q('ebitda'); eb.textContent = cf.built ? money(cf.ebitda_y1) : '—'; eb.classList.toggle('neg', cf.ebitda_y1 < -5e4);
      const ds = q('dscr'); ds.textContent = cf.built ? mult(cf.min_dscr) : '—'; ds.classList.toggle('neg', cf.min_dscr < fin.dscr - 1e-9);
      q('pb').textContent = cf.built ? yrs(cf.payback_equity) : '—';
      UNIT_RATES[u].forEach(k => {
        const inp = el.querySelector('input[data-rate="' + k + '"]'); if (!inp) return;
        setVal(inp, S.rates[k], rateDec(k)); inp.classList.toggle('edited', S.edited.has(k) || (k === 'p_NH3' && S.marketEdited));
        const mn = el.querySelector('[data-min="' + k + '"]');
        if (mn && BUFin.primaryRate(u) === k) {
          const v = cf.min_p;
          mn.innerHTML = !isFinite(v) ? '' : k === 'p_NH3' ? 'breakeven at hurdle <b class="num">' + fd(v, 0) + '</b>' :
            'at hurdle <b class="num">' + fd(v, rateDec(k)) + '</b> · <button type="button" data-setmin="' + k + '" data-v="' + v + '">set</button>';
        } else if (mn) mn.remove();
      });
      if (u === 'OPR') {
        setVal(el.querySelector('[data-inp="exp_real"]'), S.inp.exp_real, 2); setVal(el.querySelector('[data-inp="curt_paid"]'), S.inp.curt_paid * 100, 0);
        el.querySelectorAll('[data-inp]').forEach(i => i.classList.toggle('edited', S.inpEdited.has(i.dataset.inp)));
      }
    });
    // footer cards
    const tie = Math.abs(R.tieout) < 1 ? 'ties out to the dollar' : 'difference ' + f0(R.tieout) + ' $';
    $('pfFoot').innerHTML =
      card('System breakeven', f0(R.system) + ' $/t', 'ammonia price at which all units together earn their hurdles') +
      card('All units together', money(R.sum.capex) + ' CAPEX', 'project NPV ' + money(R.sum.npv_project) + ' · EBITDA yr 1 ' + money(R.sum.ebitda) + ' (' + tie + ')') +
      card('Cost of CO₂ avoided', isFinite(R.mac) ? f0(R.mac) + ' $/t CO₂' : 'n/a', 'LCOA at current rates against the fossil plant, ' + fd(num(d.BAU_CI), 2) + ' → ' + fd(num(d.CI_ACT), 2) + ' t CO₂/t') +
      card('HOPS model LCOA', f0(num(d.LCOA_A)) + ' / ' + f0(num(d.LCOA_B)) + ' $/t', 'the optimiser\'s own cost of ammonia (basis A, LCOE transfer / basis B, export credit)');
    const def = MARKET[S.plant.region];
    $('pfNote').innerHTML = 'The plant design and the 8,760-hour dispatch are taken from the HOPS run for this carbon-intensity target; nothing is re-optimised. ' +
      'The rates only settle who earns what: internal payments cancel, so the units\' EBITDA always adds up to the integrated plant\'s. ' +
      'The starting rates are cost-reflective: each supplier is paid exactly what it needs to earn its project hurdle, the operator charges its average cost of electricity (renewables and grid imports with their charges) plus ' + fd(S.M.opr_margin, 0) + ' $/MWh, and the ammonia plant carries the result.' +
      (runP && def && Math.abs(runP - def) > 1 ? ' <b>Note:</b> this design was solved at an ammonia price of ' + f0(runP) + ' $/t, because the plant has no solution at ' + f0(def) + ' $/t.' : '') +
      (S.edited.size ? ' <b>' + S.edited.size + ' rate' + (S.edited.size > 1 ? 's' : '') + ' changed by you</b> (darker yellow); the others stay as they were.' : '');
    $('pfRatesNote').textContent = S.edited.size ? 'Your rates are held when you change the target. Click a unit for cash flows, NPV, IRR and assumptions.'
      : 'Yellow fields are the rates between the units. Click a unit for cash flows, NPV, IRR and assumptions.';
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
    if (e.target.closest('[data-finreset]')) { const u = S.modal; S.fins[u] = Object.assign({}, S.M.fin[u]); S.finEdited[u].clear(); S.sh.esc_rev = S.M.esc_rev; S.sh.esc_cost = S.M.esc_cost; S.shEdited.clear(); if (S.edited.size === 0) S.rates = null; compute(true); }
  });
  MDI.addEventListener('change', e => {
    const t = e.target, v = parseFloat(t.value); if (!isFinite(v)) return;
    if (t.dataset.fin) {
      const k = t.dataset.fin, u = S.modal; S.fins[u][k] = (k === 'tenor' || k === 'dep') ? Math.max(1, Math.round(v)) : k === 'dscr' ? v : v / 100; S.finEdited[u].add(k);
    } else if (t.dataset.sh) { S.sh[t.dataset.sh] = v / 100; S.shEdited.add(t.dataset.sh); } else return;
    if (S.edited.size === 0) S.rates = null;
    compute(true);
  });

  function renderModal(resetScroll) {
    const u = S.modal, cf = S.res.units[u], fin = S.fins[u], d = S.d, [cls, txt] = status(cf, fin);
    const body = MDI.querySelector('.md-body'), top = body && !resetScroll ? body.scrollTop : 0;
    const tabs = [['overview', 'Returns'], ['lines', 'Revenue and costs'], ['cash', 'Cash flow table'], ['assume', 'Assumptions']];
    MDI.style.setProperty('--uc', 'var(--u-' + u + ')');
    MDI.innerHTML = '<div class="md-head"><div><h3 id="mdTitle">' + esc(S.M.unit_names[u]) + ' <span class="pill ' + cls + '" style="vertical-align:middle;margin-left:8px">' + txt + '</span></h3><p>' +
      esc((S.plant.name || 'Plant ' + S.plant.idx) + ' · ' + (S.ccs === 'Yes' ? 'with CCS' : 'without CCS') + ' · target ' + S.ci.toFixed(2) + ' t CO₂/t · ' + capText(u, d)) + '</p></div><button class="x" type="button">Close ✕</button></div>' +
      '<div class="md-tabs" role="tablist">' + tabs.map(t => '<button type="button" role="tab" data-tab="' + t[0] + '" aria-selected="' + (S.tab === t[0]) + '">' + t[1] + '</button>').join('') + '</div>' +
      '<div class="md-body">' + (S.tab === 'overview' ? tabOverview(u, cf, fin) : S.tab === 'lines' ? tabLines(u, cf) : S.tab === 'cash' ? tabCash(u, cf) : tabAssume(u, fin)) + '</div>';
    MDI.querySelector('.md-body').scrollTop = top;
    if (S.tab === 'overview' && cf.built) drawCharts(u, cf, fin);
  }
  const kt = (l, v, s, hi) => '<div class="kt' + (hi ? ' hi' : '') + '"><div class="lab">' + esc(l) + '</div><div class="v">' + esc(v) + '</div><div class="s">' + esc(s || '') + '</div></div>';

  function tabOverview(u, cf, fin) {
    if (!cf.built) return '<p class="hint">This unit is not built at this carbon-intensity target, so it has no cash flow. Pick a lower target to see it.</p>';
    const pr = BUFin.primaryRate(u);
    return '<div class="kgrid">' +
      kt('Project IRR', pct(cf.irr_project), 'hurdle ' + pct(fin.disc), 1) + kt('Project NPV', money(cf.npv_project), 'at ' + pct(fin.disc), 1) +
      kt('Equity IRR', pct(cf.irr_equity), 'hurdle ' + pct(fin.hurdle), 1) + kt('Equity NPV', money(cf.npv_equity), 'at ' + pct(fin.hurdle), 1) +
      kt('Minimum DSCR', mult(cf.min_dscr), 'target ' + mult(fin.dscr), 1) + kt('Payback', yrs(cf.payback_equity), 'equity · project ' + yrs(cf.payback_project), 1) +
      kt('Overnight CAPEX', money(cf.capex), 'interest during construction ' + money(cf.idc)) + kt('Total cost', money(cf.total_cost), 'incl. interest during construction') +
      kt('Debt', money(cf.debt), pct(cf.total_cost ? cf.debt / cf.total_cost : NaN, 0) + ' of total cost') + kt('Equity', money(cf.equity), 'debt service ' + money(cf.debt_service) + '/yr') +
      kt('Revenue year 1', money(cf.rev_y1), 'costs ' + money(cf.cost_y1)) + kt('EBITDA year 1', money(cf.ebitda_y1), pr && isFinite(cf.min_p) ? 'min ' + (pr === 'p_NH3' ? 'ammonia price ' : 'rate ') + fd(cf.min_p, rateDec(pr) || 0) + ' ' + rateUnit(pr) : '') +
      '</div><div class="cgrid">' +
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
      h += '<tr><td>' + esc(ln.label) + '</td><td>' + (ln.rate ? fd(S.rates[ln.rate], rateDec(ln.rate) || 1) + ' ' + esc(rateUnit(ln.rate)) : '—') + '</td><td>' +
        (ln.volume != null ? f0(ln.volume) + ' ' + volUnit(ln.vol) : '—') + '</td><td class="' + (v < 0 ? 'neg' : '') + '">' + f0(v) + '</td></tr>';
    });
    h += '<tr><td>Fixed operating cost (from the run)</td><td>—</td><td>—</td><td class="neg">' + f0(-cf.opex_y1) + '</td></tr>' +
      '<tr class="tot"><td>EBITDA, year 1</td><td></td><td></td><td class="' + (cf.ebitda_y1 < 0 ? 'neg' : '') + '">' + f0(cf.ebitda_y1) + '</td></tr></tbody></table></div>';
    h += '<h4>Capital and fixed operating cost</h4><p class="hint">Overnight cost of the equipment this unit owns, as sized by the optimiser for this target.</p><div class="tbwrap"><table class="tb"><thead><tr><th>Component</th><th>Overnight CAPEX $</th><th>Fixed OPEX $/yr</th></tr></thead><tbody>';
    const ok = S.M.opex[u];
    S.M.capex[u].forEach(k => { const o = ok.find(x => x.replace('OPEX_', '') === k.replace('CAPEX_', '')); h += '<tr><td>' + esc(dataLabel(k)) + '</td><td>' + f0(num(S.d[k])) + '</td><td>' + (o ? f0(num(S.d[o])) : '—') + '</td></tr>'; });
    h += '<tr class="tot"><td>Total</td><td>' + f0(cf.capex) + '</td><td>' + f0(cf.opex_y1) + '</td></tr></tbody></table></div>';
    if (u === 'OPR') {
      const d = S.d, r = S.rates, R = S.res, pk = R.export_rev - num(d.E_exp) * r.r_RES;
      h += '<h4>Where the operator\'s value comes from</h4><p class="hint">The operator buys every renewable MWh at the fixed PPA rate and sells the surplus into the hourly market.</p><div class="tbwrap"><table class="tb"><thead><tr><th>Item</th><th>Year 1</th></tr></thead><tbody>' +
        [['Grid export revenue at hourly prices × realisation, $', f0(R.export_rev)], ['Grid export, MWh', f0(num(d.E_exp))], ['Average export price, $/MWh', fd(num(d.E_exp) ? R.export_rev / d.E_exp : NaN, 1)],
          ['The same MWh valued at the renewables PPA rate, $', f0(num(d.E_exp) * r.r_RES)], ['Value of selling into price peaks, $', f0(pk)], ['Grid import cost at hourly prices, $', f0(-num(d.IMP_COST))],
          ['Grid import, MWh', f0(num(d.E_imp))], ['Demand, capacity and network charges, $', f0(-(num(d.DEMAND_CH) + num(d.NET_CH)))], ['Curtailed renewable MWh', f0(num(d.E_curt))]]
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
    let h = '<h4>Financing of this unit</h4><p class="hint">Each unit is financed on its own balance sheet. Renewables use developer terms, the other units industrial terms. Change a value and press Enter.' +
      (S.edited.size === 0 ? ' The cost-reflective rates follow.' : ' Your edited rates stay as they are.') + '</p><div class="agrid">';
    FIN_FIELDS.forEach(([k, lab, un]) => {
      const v = un === '%' ? fin[k] * 100 : fin[k];
      h += '<label>' + lab + '<span class="in"><input type="number" step="' + (un === '%' ? 0.5 : un === '×' ? 0.05 : 1) + '" value="' + Number(v.toFixed(3)) + '" data-fin="' + k + '" class="' + (ed.has(k) ? 'edited' : '') + '"><span class="un">' + un + '</span></span></label>';
    });
    h += '</div><h4>Shared by all units</h4><div class="agrid">' +
      '<label>Revenue escalation per year<span class="in"><input type="number" step="0.1" value="' + Number((S.sh.esc_rev * 100).toFixed(3)) + '" data-sh="esc_rev" class="' + (S.shEdited.has('esc_rev') ? 'edited' : '') + '"><span class="un">%</span></span></label>' +
      '<label>Cost escalation per year<span class="in"><input type="number" step="0.1" value="' + Number((S.sh.esc_cost * 100).toFixed(3)) + '" data-sh="esc_cost" class="' + (S.shEdited.has('esc_cost') ? 'edited' : '') + '"><span class="un">%</span></span></label>' +
      '<label>Construction<span class="in"><b class="num">' + S.M.ncon + ' years · ' + S.sh.spend.map(x => Math.round(x * 100) + '%').join(' / ') + '</b></span></label>' +
      '<label>Operating life<span class="in"><b class="num">' + S.M.nops + ' years</b></span></label></div>' +
      '<p style="margin-top:var(--s4)"><button class="btn ghost sm" type="button" data-finreset="1">Reset this unit\'s financing and the escalation</button></p>' +
      '<h4>How the numbers are built</h4><p class="hint">Debt is drawn pro rata with the spend, interest during construction is capitalised, and the loan is repaid as an annuity over the tenor. Tax is paid on positive earnings before tax only; losses are not carried forward. ' +
      'Project NPV discounts the unlevered after-tax cash flow at the project discount rate; equity NPV discounts the cash flow to equity at the equity hurdle. The minimum rate is the unit\'s main selling rate at which its project NPV is zero, with every other rate as set.</p>';
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
    // --- cash flow
    const flows = (S.basis === 'equity' ? cf.eqcf : cf.pcf).map(v => v / 1e6), cum = []; flows.reduce((a, v, i) => (cum[i] = a + v), 0);
    let W = 620, H = 270, m = { l: 58, r: 14, t: 10, b: 30 };
    let lo = Math.min(0, Math.min.apply(null, flows)), hi = Math.max(0, Math.max.apply(null, flows));
    const padv = (hi - lo) * 0.06 || 1; lo -= lo < 0 ? padv : 0; hi += padv;
    let F = frame(W, H, m, lo, hi, 5), bw = (W - m.l - m.r) / flows.length, g = F.g;
    flows.forEach((v, i) => {
      const x = m.l + i * bw, y0 = F.y(0), y1 = F.y(v);
      g += '<rect x="' + (x + 1.5) + '" y="' + Math.min(y0, y1) + '" width="' + (bw - 3) + '" height="' + Math.max(1, Math.abs(y1 - y0)) + '" rx="2" fill="var(--d1)" opacity="' + (i < S.M.ncon ? 0.55 : 1) + '"/>';
    });
    const pb = S.basis === 'equity' ? cf.payback_equity : cf.payback_project;      // years after start of operation
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

    // --- year-1 lines (largest first within revenue and cost; small ones kept, zero ones dropped)
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

    // --- DSCR
    const ds = cf.rows.filter(r => !r.con && isFinite(r.dscr)), c3 = $('chDscr');
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

    // --- sensitivity of NPV to the unit's main rate (operator: to the export price realisation)
    const pr = BUFin.primaryRate(u), c4 = $('chSens'), d = S.d;
    let cur, xs = [], series, xlab, xfmt, minP = NaN, minE = NaN;
    const run = (rates, inp) => BUFin.unitCf(u, d, rates, inp, fin, S.sh, true);
    if (pr) {
      cur = S.rates[pr]; minP = cf.min_p; minE = cf.min_e;
      const ref = [cur, minP, minE].filter(isFinite), a = Math.min.apply(null, ref), b = Math.max.apply(null, ref), span = Math.max(b - a, Math.abs(b) * 0.25, 1e-6);
      for (let i = 0; i <= 24; i++) xs.push(a - span * 0.6 + (b - a + span * 1.2) * i / 24);
      series = xs.map(x => { const rr = Object.assign({}, S.rates); rr[pr] = x; return run(rr, S.inp); });
      xlab = RATE_SHORT[pr].replace(/^Sells /, '').replace(/ at the market price/, ' price') + ', ' + rateUnit(pr); xfmt = v => fd(v, rateDec(pr) > 1 ? 2 : Math.abs(xs[24] - xs[0]) < 20 ? 1 : 0);
      $('chSensT').textContent = 'NPV against the ' + (pr === 'p_NH3' ? 'ammonia price' : 'selling rate');
      $('chSensS').textContent = 'Where each line crosses zero is the minimum ' + (pr === 'p_NH3' ? 'price' : 'rate') + ' on that basis · ' + xlab;
    } else {
      cur = S.inp.exp_real; for (let i = 0; i <= 24; i++) xs.push(0.6 + 0.6 * i / 24);
      series = xs.map(x => run(S.rates, Object.assign({}, S.inp, { exp_real: x })));
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
