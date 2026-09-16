/* atlas/finance.js — project finance for the selected run, in the browser.
   A port of ProjectFinance/build_finance_model.py (single-entity model): the optimizer's annualised, per-tonne
   cost lines are de-annualised with the run's own CRF, then pushed through a 3-year construction + 30-year
   operations cash flow with debt sizing, IDC, tax, DSCR, IRR and NPV. Every assumption is editable on the page.
   The plant design is NOT re-optimised when an assumption changes: this is a fixed-design sensitivity. */

const FIN_DEFAULTS = {
  life: 30, price: null, adder: 0, rev_esc: 0.005, cost_esc: 0.005,
  ncon: 3, spend: [0.20, 0.45, 0.35], gearing: 0.70, debt_rate: 0.065, tenor: 20, dscr_target: 1.30,
  hurdle: 0.12, tax: null, dep_years: 20, disc: 0.08, merchant_credit: 0.80
};
let FIN_A = null;                                   // live assumptions (reset per plant region)
const FIN_FIELDS = [
  ['Revenue', [
    ['price', 'NH₃ price', '$/t', 200, 1500, 5, 0],
    ['adder', 'Policy / premium adder', '$/t', -300, 600, 5, 0],
    ['rev_esc', 'Revenue escalation', '%/yr', -0.02, 0.05, 0.001, 1],
    ['cost_esc', 'Cost escalation', '%/yr', -0.02, 0.05, 0.001, 1]]],
  ['Financing', [
    ['gearing', 'Gearing (debt share)', '%', 0, 0.9, 0.01, 1],
    ['debt_rate', 'Debt interest rate', '%', 0.02, 0.12, 0.001, 1],
    ['tenor', 'Debt tenor', 'yr', 5, 30, 1, 0],
    ['dscr_target', 'Minimum DSCR target', '×', 1.0, 2.0, 0.05, 2],
    ['hurdle', 'Equity hurdle (IRR)', '%', 0.05, 0.25, 0.005, 1],
    ['merchant_credit', 'Merchant power credit', '%', 0, 1, 0.05, 1]]],
  ['Tax & valuation', [
    ['tax', 'Corporate tax rate', '%', 0, 0.4, 0.01, 1],
    ['dep_years', 'Depreciation (straight line)', 'yr', 5, 30, 1, 0],
    ['disc', 'Project discount rate', '%', 0.03, 0.15, 0.005, 1],
    ['life', 'Operating life', 'yr', 15, 40, 1, 0]]]
];
const CAPEX_KEYS = ['capex_pv', 'capex_wt', 'capex_el', 'capex_b', 'capex_cp', 'capex_st', 'capex_asu', 'capex_nh3', 'capex_grid', 'capex_gridload', 'capex_smr', 'capex_hb', 'capex_stturb', 'capex_ccs'];
const OPEX_KEYS = ['opex_pv', 'opex_wt', 'opex_el', 'opex_b', 'opex_cp', 'opex_nh3', 'opex_asu', 'opex_smr', 'opex_hb', 'opex_stturb', 'opex_ccs'];
const CAPEX_LABEL = { capex_pv: 'Solar PV', capex_wt: 'Wind', capex_el: 'Electrolyzer', capex_b: 'Battery', capex_cp: 'H₂ compressor', capex_st: 'H₂ storage', capex_asu: 'ASU', capex_nh3: 'NH₃ synthesis', capex_grid: 'Grid connection (export)', capex_gridload: 'Grid connection (load)', capex_smr: 'SMR', capex_hb: 'Heat battery', capex_stturb: 'Steam turbine', capex_ccs: 'CCS' };

function finDefaults(plant){
  const us = plant && plant.region === 'US';
  return { ...FIN_DEFAULTS, spend: [...FIN_DEFAULTS.spend], price: us ? 450 : 660, tax: us ? 0.21 : 0.30 };
}
/* ---- de-annualise the optimizer's per-tonne lines (identical to hops_extract._scenario_from_getter) */
function finInputsFromRow(r, plant){
  const tpy = (plant.tpd || 0) * 365, crf = r.crf || 0.0888, g = k => (r[k] == null ? 0 : r[k]);
  const capex = {}; CAPEX_KEYS.forEach(k => { capex[k] = g(k) * tpy / crf; });
  const capex_abs = Object.values(capex).reduce((a, b) => a + b, 0);
  const fixed_opex = OPEX_KEYS.reduce((a, k) => a + g(k), 0) * tpy;
  const ren_ann_pt = g('capex_pv') + g('capex_wt') + g('opex_pv') + g('opex_wt');
  const grid_purchase = (g('elec_cost') - ren_ann_pt) * tpy;
  const iso = r.iso_unit === 'kw_yr' ? g('iso_trans') * tpy : 0;
  const ann_capex = CAPEX_KEYS.reduce((a, k) => a + g(k), 0) * tpy;
  const lines = { fixed_opex, ng: g('ng_cost') * tpy, grid_purchase, carbon: g('carbon_price') * tpy, ets: g('ets_cost') * tpy,
                  demand: g('demand_cost') * tpy, iso, export_rev: g('sold') * tpy };
  const recon = ann_capex + lines.fixed_opex + lines.ng + lines.carbon + lines.ets + lines.grid_purchase + lines.demand + lines.iso - lines.export_rev;
  lines.residual = g('lcoa') * tpy - recon;
  return { tpy, crf, capex, capex_abs, ...lines, z: g('lcoa'), nh3_price_run: r.nh3_price, ci: r.target };
}
/* ---- the cash-flow model. Periods 1..ncon are construction, then `life` operating years. */
function runFinance(I, A){
  const N = A.ncon + A.life, P = [];
  // construction & IDC
  let open = 0, idc_total = 0, equity_total = 0;
  for (let y = 0; y < A.ncon; y++) {
    const capex = (A.spend[y] || 0) * I.capex_abs, ddraw = capex * A.gearing, edraw = capex - ddraw;
    const idc = A.debt_rate * (open + 0.5 * ddraw); const close = open + ddraw + idc;
    P.push({ p: y + 1, phase: 'con', capex, ddraw, edraw, idc, debt_open: open, debt_close: close });
    open = close; idc_total += idc; equity_total += edraw;
  }
  const senior = open, total_cost = I.capex_abs + idc_total;
  const annuity = A.debt_rate / (1 - Math.pow(1 + A.debt_rate, -A.tenor));
  const crf_h = A.hurdle * Math.pow(1 + A.hurdle, A.life) / (Math.pow(1 + A.hurdle, A.life) - 1);
  let dopen = senior;
  for (let t = 1; t <= A.life; t++) {
    const er = Math.pow(1 + A.rev_esc, t - 1), cr = Math.pow(1 + A.cost_esc, t - 1);
    const price = (A.price + A.adder) * er, rev_nh3 = I.tpy * price, rev_grid = I.export_rev * er, rev = rev_nh3 + rev_grid;
    const opx = (I.fixed_opex + I.ng + I.grid_purchase + I.carbon + I.ets + (I.demand + I.iso + I.residual)) * cr;
    const ebitda = rev - opx, dep = t <= A.dep_years ? total_cost / A.dep_years : 0, ebit = ebitda - dep;
    const interest = A.debt_rate * dopen, pay = t <= A.tenor ? senior * annuity : 0, principal = Math.min(pay - interest, dopen), dclose = dopen - principal;
    const ebt = ebit - interest, tax = Math.max(0, ebt) * A.tax, ni = ebt - tax;
    const cfads = ebitda - tax, dscr = pay > 0 ? cfads / pay : null, eqcf = cfads - pay;
    const utax = Math.max(0, ebitda - dep) * A.tax, pcf = ebitda - utax;
    const cfads_b = cfads - (1 - A.merchant_credit) * rev_grid, dscr_b = pay > 0 ? cfads_b / pay : null;
    P.push({ p: A.ncon + t, phase: 'ops', t, price, rev_nh3, rev_grid, rev, opx, ebitda, dep, ebit, debt_open: dopen, interest, pay, principal, debt_close: dclose, ebt, tax, ni, cfads, dscr, eqcf, pcf, cfads_b, dscr_b });
    dopen = dclose;
  }
  // series in period order (construction years carry the draws as negatives)
  const eqcf = P.map(x => x.phase === 'con' ? -x.edraw : x.eqcf), pcf = P.map(x => x.phase === 'con' ? -x.capex : x.pcf);
  let cum = 0; const eqcum = eqcf.map(v => (cum += v)); cum = 0; const pcum = pcf.map(v => (cum += v));
  const disc = P.map((x, i) => 1 / Math.pow(1 + A.disc, i + 1)); cum = 0; const npv_cum = pcf.map((v, i) => (cum += v * disc[i]));
  const ops = P.filter(x => x.phase === 'ops');
  const dscrs = ops.map(x => x.dscr).filter(v => v != null), dscrs_b = ops.map(x => x.dscr_b).filter(v => v != null);
  const y1 = ops[0], cf_b = y1.cfads_b;
  const max_capex_dscr = cf_b / A.dscr_target * (1 - Math.pow(1 + A.debt_rate, -A.tenor)) / A.debt_rate / A.gearing;
  const max_capex_irr = cf_b / (A.gearing * annuity + (1 - A.gearing) * crf_h);
  const K = {
    project_irr: irr(pcf), equity_irr: irr(eqcf), equity_npv: npv(A.hurdle, eqcf), project_npv: npv(A.disc, pcf),
    min_dscr: dscrs.length ? Math.min(...dscrs) : null, min_dscr_b: dscrs_b.length ? Math.min(...dscrs_b) : null,
    payback: eqcum.filter(v => v < 0).length + 1, total_cost, senior, equity_total, idc_total,
    power_share: y1.rev_grid / y1.rev, rev_nh3_y1: y1.rev_nh3, rev_grid_y1: y1.rev_grid,
    max_capex_dscr, max_capex_irr, max_capex: Math.min(max_capex_dscr, max_capex_irr), headroom: Math.min(max_capex_dscr, max_capex_irr) / total_cost,
    annuity, crf_h
  };
  K.meets_hurdle = K.equity_irr != null && K.equity_irr >= A.hurdle; K.meets_dscr = K.min_dscr_b != null && K.min_dscr_b >= A.dscr_target;
  return { P, eqcf, pcf, eqcum, pcum, npv_cum, K };
}
function npv(rate, cfs){ return cfs.reduce((a, v, i) => a + v / Math.pow(1 + rate, i + 1), 0); }   // Excel NPV convention
function irr(cfs){   // Excel IRR convention: first flow at t=0. Bisection on a bracket, null if no sign change.
  const f = r => cfs.reduce((a, v, i) => a + v / Math.pow(1 + r, i), 0);
  let lo = -0.99, hi = 1.0, flo = f(lo), fhi = f(hi);
  if (!(isFinite(flo) && isFinite(fhi)) || flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2, fm = f(mid); if (Math.abs(fm) < 1e-6) return mid; if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; } }
  return (lo + hi) / 2;
}
/* ---- UI */
function finFmt(v, kind){
  if (v == null || !isFinite(v)) return '—';
  if (kind === 'pct') return (v * 100).toFixed(1) + '%';
  if (kind === 'x') return v.toFixed(2) + '×';
  if (kind === 'm') return (v / 1e6).toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' M';
  if (kind === 'bn') return (v / 1e9).toFixed(2) + ' bn';
  return fmt(v);
}
function finSetup(){
  if (!FIN_A || FIN_A.__plant !== curPlantIdx) { FIN_A = finDefaults(PLANT[curPlantIdx]); FIN_A.__plant = curPlantIdx; }
}
function finSet(k, v){ FIN_A[k] = +v; buildFinance(); }
function finSetSpend(i, v){ FIN_A.spend[i] = +v; buildFinance(); }
function finReset(){ FIN_A = null; buildFinance(); }
function tsChart(series, opt){   // time-series line chart, x = period
  opt = opt || {}; const W = opt.w || 560, H = opt.h || 240, ml = 70, mr = 16, mt = 14, mb = 36, pw = W - ml - mr, ph = H - mt - mb;
  const n = Math.max(...series.map(s => s.v.length)); let ymin = 0, ymax = 0;
  series.forEach(s => s.v.forEach(v => { if (v == null) return; ymin = Math.min(ymin, v); ymax = Math.max(ymax, v); }));
  if (opt.ymin != null) ymin = Math.min(ymin, opt.ymin); if (opt.ymax != null) ymax = Math.max(ymax, opt.ymax);
  if (ymax === ymin) ymax = ymin + 1; const span = ymax - ymin; ymax += span * .06;
  const x = i => ml + i / (n - 1) * pw, y = v => mt + ph - (v - ymin) / (ymax - ymin) * ph;
  let s = svgEl(W, H);
  for (let i = 0; i <= 4; i++) { const val = ymin + (ymax - ymin) * i / 4, yy = y(val);
    s += `<line class="gridline" x1="${ml}" y1="${yy}" x2="${W - mr}" y2="${yy}"/><text class="axis" x="${ml - 7}" y="${yy + 3}" text-anchor="end">${opt.fmt ? opt.fmt(val) : fmt(val)}</text>`; }
  if (ymin < 0) s += `<line x1="${ml}" y1="${y(0)}" x2="${W - mr}" y2="${y(0)}" stroke="${C.ink}" stroke-width="1" opacity=".5"/>`;
  if (opt.ref != null) { const yy = y(opt.ref); s += `<line x1="${ml}" y1="${yy}" x2="${W - mr}" y2="${yy}" stroke="${C.co2}" stroke-width="1.3" stroke-dasharray="5 4"/><text class="axis" x="${W - mr}" y="${yy - 4}" text-anchor="end" fill="${C.co2}">${opt.refLabel || ''}</text>`; }
  if (opt.ncon) { s += `<rect x="${x(0)}" y="${mt}" width="${x(opt.ncon - 1) - x(0) + pw / (n - 1) / 2}" height="${ph}" fill="${C.line}" opacity=".35"/><text class="axis" x="${x(0) + 3}" y="${mt + 11}" fill="${C.mut}">construction</text>`; }
  for (let i = 0; i < n; i += Math.max(1, Math.round(n / 8))) s += `<text class="axis" x="${x(i)}" y="${H - mb + 15}" text-anchor="middle">${i + 1}</text>`;
  series.forEach(sr => { let d = ''; sr.v.forEach((v, i) => { if (v == null) return; d += (d ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1) + ' '; });
    s += `<path d="${d}" fill="none" stroke="${sr.c}" stroke-width="2.2" stroke-linejoin="round" ${sr.dash ? 'stroke-dasharray="6 4"' : ''}><title>${sr.n}</title></path>`; });
  s += `<text class="axis" x="${ml + pw / 2}" y="${H - 6}" text-anchor="middle" fill="${C.mut}">${opt.xlab || 'Year (construction, then operations)'}</text>`;
  s += `<text class="axis" transform="translate(14 ${mt + ph / 2}) rotate(-90)" text-anchor="middle" fill="${C.mut}">${opt.ylab || ''}</text>`;
  return s + '</svg>';
}
function buildFinance(){
  finSetup();
  const s = curScn, plant = PLANT[curPlantIdx], rows = cappedRows(s), sidx = selectedCIidx(rows), r = rows[sidx], A = FIN_A;
  const I = finInputsFromRow(r, plant), R = runFinance(I, A), K = R.K, M = 1e6;
  const ops = R.P.filter(x => x.phase === 'ops');
  // sweep: same assumptions across every CI row of this scenario
  const sweep = rows.map(rr => { const RR = runFinance(finInputsFromRow(rr, plant), A); return { ci: rr.target, pirr: RR.K.project_irr, eirr: RR.K.equity_irr, dscr: RR.K.min_dscr_b, cost: RR.K.total_cost }; });
  const field = ([k, n, u, lo, hi, st, dec]) => {
    const v = A[k], isPct = u.startsWith('%'), shown = isPct ? (v * 100).toFixed(dec) : (+v).toFixed(dec);
    return `<label class="fin-f"><span class="fin-l">${n}<small>${u}</small></span><input type="range" min="${lo}" max="${hi}" step="${st}" value="${v}" oninput="finSet('${k}',this.value)"><input type="number" class="fin-n" step="${isPct ? st * 100 : st}" value="${shown}" onchange="finSet('${k}',${isPct ? 'this.value/100' : 'this.value'})"></label>`;
  };
  let h = `<div class="fin-grid"><aside class="card fin-side"><div class="card-h"><h3>Assumptions</h3><button class="btn ghost sm" onclick="finReset()">Reset</button></div>
    <p class="section-d" style="margin:0 0 10px">Everything below is editable. The plant design and the optimizer's cost lines stay fixed — this is a financing sensitivity on the selected run, not a re-optimisation.</p>
    ${FIN_FIELDS.map(([g, fs]) => `<div class="fin-group"><div class="fp-h">${g}</div>${fs.map(field).join('')}</div>`).join('')}
    <div class="fin-group"><div class="fp-h">Construction</div>
      <label class="fin-f"><span class="fin-l">Years<small>yr</small></span><input type="range" min="1" max="5" step="1" value="${A.ncon}" oninput="FIN_A.ncon=+this.value;FIN_A.spend=[0.2,0.45,0.35,0,0].slice(0,FIN_A.ncon).map((v,i,a)=>FIN_A.ncon===3?v:1/FIN_A.ncon);buildFinance()"><span class="fin-n">${A.ncon}</span></label>
      <div class="sub" style="font-size:11.5px;margin:2px 0 6px">Spend profile ${A.spend.map((v, i) => `<input type="number" class="fin-n" style="width:52px" step="5" value="${(v * 100).toFixed(0)}" onchange="finSetSpend(${i},this.value/100)">%`).join(' ')} ${Math.abs(A.spend.reduce((a, b) => a + b, 0) - 1) > 1e-6 ? '<b style="color:var(--rust)">≠ 100%</b>' : ''}</div></div>
  </aside><div class="fin-main">`;
  // KPIs
  const kpi = (l, v, d, warn) => `<div class="kpi"><div class="l">${l}</div><div class="v" ${warn ? 'style="color:var(--rust)"' : ''}>${v}</div><div class="d">${d}</div></div>`;
  h += `<div class="card"><div class="card-h"><h3>Project finance — ${s.name} · CI ${r.target.toFixed(2)}</h3><span class="real-badge">● ${plant.name} · ${fmt(I.tpy)} t/yr · CRF ${I.crf.toFixed(4)}</span></div>
    <div class="kpi-grid" style="margin-top:10px">
    ${kpi('Project IRR', finFmt(K.project_irr, 'pct'), 'unlevered, post-tax')}
    ${kpi('Equity IRR', finFmt(K.equity_irr, 'pct'), K.meets_hurdle ? 'meets hurdle ' + finFmt(A.hurdle, 'pct') : 'below hurdle ' + finFmt(A.hurdle, 'pct'), !K.meets_hurdle)}
    ${kpi('Min DSCR (banking)', finFmt(K.min_dscr_b, 'x'), K.meets_dscr ? 'meets target ' + A.dscr_target.toFixed(2) + '×' : 'below target ' + A.dscr_target.toFixed(2) + '×', !K.meets_dscr)}
    ${kpi('Project NPV', '$' + finFmt(K.project_npv, 'm'), 'at ' + finFmt(A.disc, 'pct') + ' discount rate', K.project_npv < 0)}
    </div><div class="kpi-grid" style="margin-top:0">
    ${kpi('Total project cost', '$' + finFmt(K.total_cost, 'bn'), 'overnight $' + finFmt(I.capex_abs, 'bn') + ' + IDC $' + finFmt(K.idc_total, 'm'))}
    ${kpi('Debt / equity', '$' + finFmt(K.senior, 'm') + ' / ' + finFmt(K.equity_total, 'm'), 'gearing ' + finFmt(K.senior / K.total_cost, 'pct') + ' incl. IDC')}
    ${kpi('Equity payback', K.payback + ' yr', 'from financial close')}
    ${kpi('Merchant power share', finFmt(K.power_share, 'pct'), 'of year-1 revenue; lenders haircut this', K.power_share > 0.3)}
    </div>
    <p class="foot-note">Cost lines are the optimizer's: annualised per-tonne CAPEX de-annualised with the run's CRF, fixed OPEX, gas, grid purchase (electricity cost net of the renewables' own annuity), carbon and ETS, demand and capacity charges, and a reconciliation plug so year-1 cost ties to LCOA ${fmt(I.z)} $/t exactly (plug ${fmt(I.residual / M, 1)} M$/yr). NH₃ price default is the run's market benchmark; the optimizer's own IRR objective used ${fmt(I.nh3_price_run)} $/t.</p></div>`;
  h += `<div class="grid2">
    <div class="card"><div class="card-h"><h3>Annual cash flows</h3><span class="note">M$/yr</span></div>${legend([{ c: C.renew, n: 'EBITDA' }, { c: C.co2, n: 'Debt service' }, { c: C.grid, n: 'CFADS' }, { c: C.mut, n: 'CFADS banking case' }])}
      ${tsChart([{ n: 'EBITDA', c: C.renew, v: R.P.map(x => x.ebitda == null ? null : x.ebitda / M) }, { n: 'Debt service', c: C.co2, v: R.P.map(x => x.pay == null ? null : x.pay / M) }, { n: 'CFADS', c: C.grid, v: R.P.map(x => x.cfads == null ? null : x.cfads / M) }, { n: 'CFADS banking', c: C.mut, dash: true, v: R.P.map(x => x.cfads_b == null ? null : x.cfads_b / M) }], { ylab: 'M$ / yr', ncon: A.ncon })}</div>
    <div class="card"><div class="card-h"><h3>Equity cash flow</h3><span class="note">M$</span></div>${legend([{ c: C.grid, n: 'Annual' }, { c: C.renew, n: 'Cumulative' }])}
      ${tsChart([{ n: 'Equity CF', c: C.grid, v: R.eqcf.map(v => v / M) }, { n: 'Cumulative', c: C.renew, v: R.eqcum.map(v => v / M) }], { ylab: 'M$', ncon: A.ncon })}</div>
    <div class="card"><div class="card-h"><h3>DSCR by year</h3><span class="note">× · target ${A.dscr_target.toFixed(2)}</span></div>${legend([{ c: C.grid, n: 'Full revenue' }, { c: C.mut, n: 'Banking case' }])}
      ${tsChart([{ n: 'DSCR', c: C.grid, v: R.P.map(x => x.dscr ?? null) }, { n: 'Banking', c: C.mut, dash: true, v: R.P.map(x => x.dscr_b ?? null) }], { ylab: '×', ref: A.dscr_target, refLabel: 'target', ymin: 0, ncon: A.ncon, fmt: v => v.toFixed(1) })}</div>
    <div class="card"><div class="card-h"><h3>NPV profile & debt</h3><span class="note">M$</span></div>${legend([{ c: C.renew, n: 'Cumulative discounted project CF' }, { c: C.co2, n: 'Debt outstanding' }])}
      ${tsChart([{ n: 'Cumulative NPV', c: C.renew, v: R.npv_cum.map(v => v / M) }, { n: 'Debt', c: C.co2, v: R.P.map(x => x.debt_close == null ? null : x.debt_close / M) }], { ylab: 'M$', ncon: A.ncon })}</div>
  </div>`;
  // sweep + capex breakdown + max financeable
  const pal = { p: C.renew, e: C.grid };
  h += `<div class="grid2">
    <div class="card"><div class="card-h"><h3>Returns across the CI sweep</h3><span class="note">same assumptions, every run of ${scnShortName(s)}</span></div>${legend([{ c: pal.p, n: 'Project IRR' }, { c: pal.e, n: 'Equity IRR' }, { c: C.co2, n: 'Equity hurdle' }])}
      ${lineChart([{ n: 'Project IRR', c: pal.p, pts: sweep.filter(x => x.pirr != null).map(x => [x.ci, x.pirr * 100]) }, { n: 'Equity IRR', c: pal.e, pts: sweep.filter(x => x.eirr != null).map(x => [x.ci, x.eirr * 100]) }], { bau: [{ n: 'hurdle', v: A.hurdle * 100, c: C.co2 }], h: 300 }).replace('LCOA ($ / tNH₃)', 'IRR (%)')}
      <p class="foot-note">Selected point: CI ${r.target.toFixed(2)}. Where a curve is missing the IRR is undefined (cash flows never turn positive).</p></div>
    <div class="card"><div class="card-h"><h3>Overnight CAPEX by unit</h3><span class="note">de-annualised · M$</span></div>
      <table class="assump-tbl">${CAPEX_KEYS.filter(k => I.capex[k] > 0).sort((a, b) => I.capex[b] - I.capex[a]).map(k => `<tr><td class="p">${CAPEX_LABEL[k]}</td><td class="v" style="text-align:right">${fmt(I.capex[k] / M)}</td><td class="u">M$</td><td class="s">${(I.capex[k] / I.capex_abs * 100).toFixed(0)}%</td></tr>`).join('')}
      <tr style="font-weight:600"><td class="p">Total overnight</td><td class="v" style="text-align:right">${fmt(I.capex_abs / M)}</td><td class="u">M$</td><td></td></tr></table>
      <div class="fp-h" style="margin-top:14px">Max financeable CAPEX (flat banking-case CFADS)</div>
      <table class="assump-tbl">
        <tr><td class="p">Year-1 CFADS, banking case</td><td class="v" style="text-align:right">${fmt(ops[0].cfads_b / M)}</td><td class="u">M$</td></tr>
        <tr><td class="p">Max CAPEX at DSCR ${A.dscr_target.toFixed(2)}×</td><td class="v" style="text-align:right">${fmt(K.max_capex_dscr / M)}</td><td class="u">M$</td></tr>
        <tr><td class="p">Max CAPEX at equity hurdle</td><td class="v" style="text-align:right">${fmt(K.max_capex_irr / M)}</td><td class="u">M$</td></tr>
        <tr style="font-weight:600"><td class="p">Headroom (binding max ÷ actual)</td><td class="v" style="text-align:right;color:${K.headroom >= 1 ? 'var(--renew)' : 'var(--rust)'}">${finFmt(K.headroom, 'pct')}</td><td class="u"></td></tr>
      </table></div></div>`;
  h += `<div class="card"><div class="card-h"><h3>Cash flow table</h3><button class="btn ghost sm" onclick="finDownload()">Download CSV</button></div>
    <div class="tbl-scroll"><table class="tableX"><thead><tr><th>Year</th><th>Revenue</th><th>Opex</th><th>EBITDA</th><th>Depr.</th><th>Interest</th><th>Debt service</th><th>Tax</th><th>CFADS</th><th>DSCR</th><th>Equity CF</th><th>Project CF</th><th>Debt close</th></tr></thead><tbody>
    ${R.P.map((x, i) => x.phase === 'con' ? `<tr style="color:var(--mut)"><td>${x.p} (con)</td><td>—</td><td>—</td><td>—</td><td>—</td><td>IDC ${fmt(x.idc / M)}</td><td>—</td><td>—</td><td>—</td><td>—</td><td>${fmt(-x.edraw / M)}</td><td>${fmt(-x.capex / M)}</td><td>${fmt(x.debt_close / M)}</td></tr>`
      : `<tr><td>${x.p}</td><td>${fmt(x.rev / M)}</td><td>${fmt(x.opx / M)}</td><td>${fmt(x.ebitda / M)}</td><td>${fmt(x.dep / M)}</td><td>${fmt(x.interest / M)}</td><td>${fmt(x.pay / M)}</td><td>${fmt(x.tax / M)}</td><td>${fmt(x.cfads / M)}</td><td>${x.dscr == null ? '—' : x.dscr.toFixed(2)}</td><td>${fmt(x.eqcf / M)}</td><td>${fmt(x.pcf / M)}</td><td>${fmt(x.debt_close / M)}</td></tr>`).join('')}
    </tbody></table></div><p class="foot-note">All values M$ nominal. Construction rows show the equity draw and total capex spend as negatives; IDC is capitalised into the debt balance.</p></div>`;
  h += `</div></div>`;
  document.getElementById('tab-finance').innerHTML = h;
  window.__finLast = { R, I, A, s, r, plant };
}
function finDownload(){
  const L = window.__finLast; if (!L) return;
  const cols = ['p', 'phase', 'capex', 'edraw', 'ddraw', 'idc', 'rev_nh3', 'rev_grid', 'rev', 'opx', 'ebitda', 'dep', 'ebit', 'debt_open', 'interest', 'pay', 'principal', 'debt_close', 'ebt', 'tax', 'ni', 'cfads', 'dscr', 'eqcf', 'pcf', 'cfads_b', 'dscr_b'];
  const lines = [`# HOPS project finance · ${L.s.name} · CI ${L.r.target} · plant ${L.plant.idx} · ${new Date().toISOString().slice(0, 10)}`,
    '# assumptions: ' + JSON.stringify(Object.fromEntries(Object.entries(L.A).filter(([k]) => !k.startsWith('__')))),
    cols.join(',')].concat(L.R.P.map(x => cols.map(c => x[c] == null ? '' : (typeof x[c] === 'number' ? Math.round(x[c] * 1000) / 1000 : x[c])).join(',')));
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' })); a.download = `hops_finance_plant${L.plant.idx}_${scnPathwayLabel(L.s)}_ci${L.r.target}.csv`; a.click();
}
