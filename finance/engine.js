/* Project Finance engine — browser port of the Python mirror in ProjectFinance/build_bu_finance.py
   (unit_lines, unit_capex_opex, run_cashflow, solve_min_rate, solve_system_breakeven, default_rates).
   Same arithmetic, same iteration counts, so the page ties to the workbook. One deliberate difference, in the
   STARTING rates only: the operator's electricity tariff covers grid imports too (see defaultRates). The model tables (LINES, CAPEX, OPEX,
   RATES, financing defaults) are not repeated here: they come from data/finance/index.json → "model", which
   tools/bu_finance_to_web.py writes from the script itself. */
(function () {
  'use strict';
  let M = null;                                   // model tables from index.json
  const num = v => (typeof v === 'number' && isFinite(v) ? v : 0);
  const NOISE = 1e-3;                             // MWh, kg or t per year below this is numerical noise of the solve, not a flow

  function setModel(model) { M = model; }
  function annuity(rate, n) { return rate === 0 ? 1 / n : rate / (1 - Math.pow(1 + rate, -n)); }

  function volume(d, key, inp) {
    if (key === 'E_RES_paid') return num(d.E_RES_gen) - num(d.E_curt) * (1 - inp.curt_paid);
    return num(d[key]);
  }

  /* Year-1 $ per line: [{label, sign, value, rate, vol, kind, volume}] */
  function unitLines(u, d, rates, inp) {
    return M.lines[u].map(ln => {
      let v, q = null;
      if (ln.kind === 'fixed') v = num(d[ln.vol]);
      else if (ln.kind === 'scaled') v = num(d[ln.vol]) * inp.exp_real / (num(d.EXPORT_DISC) || 1);
      else { q = volume(d, ln.vol, inp); v = num(rates[ln.rate]) * q; }
      return { label: ln.label, sign: ln.sign, value: v, rate: ln.rate || null, vol: ln.vol, kind: ln.kind, volume: q, primary: !!ln.primary };
    });
  }

  function unitCapexOpex(u, d, inp) {
    const capex = M.capex[u].reduce((s, k) => s + num(d[k]), 0);
    let opex = M.opex[u].reduce((s, k) => s + num(d[k]), 0);
    if (u === 'OPR') opex += inp.grid_opex_pct * capex;
    return [capex, opex];
  }

  function npv(rate, flows) { let s = 0; for (let i = 0; i < flows.length; i++) s += flows[i] / Math.pow(1 + rate, i + 1); return s; }
  function irr(flows) {
    if (!(flows.some(f => f < 0) && flows.some(f => f > 0))) return NaN;
    let lo = -0.99, hi = 10.0, flo = npv(lo, flows);
    for (let i = 0; i < 200; i++) {
      const mid = 0.5 * (lo + hi), fm = npv(mid, flows);
      if ((fm > 0) === (flo > 0)) { lo = mid; flo = fm; } else hi = mid;
    }
    return 0.5 * (lo + hi);
  }
  function payback(flows, ncon) {
    let cum = 0;
    for (let i = 0; i < flows.length; i++) {
      const prev = cum, f = flows[i]; cum += f;
      if (i + 1 > ncon && prev < 0 && cum >= 0 && f !== 0) return (i + 1 - ncon - 1) + (-prev) / f;
    }
    return NaN;
  }

  /* Same arithmetic as the unit sheets. rev0 / cost0 are year-1 totals of the lines. light = NPVs only (solvers). */
  function runCashflow(capex, opex0, rev0, cost0, fin, sh, light) {
    const ncon = M.ncon, nops = M.nops, spend = sh.spend;
    let debtBal = 0, idcTot = 0; const eqDraw = [], capexYr = [], debtDraw = [], idcYr = [];
    for (const s of spend) {
      const sp = capex * s, dd = sp * fin.gearing, idc = fin.rate * (debtBal + 0.5 * dd);
      debtBal += dd + idc; idcTot += idc; capexYr.push(sp); eqDraw.push(sp - dd); debtDraw.push(dd); idcYr.push(idc);
    }
    const debt0 = debtBal, totalCost = capex + idcTot, dsvc = debt0 * annuity(fin.rate, fin.tenor);
    const pcf = [], eqcf = [], dscrs = [], ebts = [], rows = [];
    let dOpen = debt0;
    for (let p = 1; p <= ncon + nops; p++) {
      if (p <= ncon) {
        pcf.push(-capexYr[p - 1]); eqcf.push(-eqDraw[p - 1]);
        if (!light) rows.push({ p, y: p - ncon, con: true, capex: capexYr[p - 1], debtDraw: debtDraw[p - 1], idc: idcYr[p - 1], equity: eqDraw[p - 1], pcf: -capexYr[p - 1], eqcf: -eqDraw[p - 1] });
        continue;
      }
      const y = p - ncon;
      const rev = rev0 * Math.pow(1 + sh.esc_rev, y - 1), cst = (cost0 + opex0) * Math.pow(1 + sh.esc_cost, y - 1);
      const ebitda = rev - cst, dep = y <= fin.dep ? totalCost / fin.dep : 0, interest = fin.rate * dOpen;
      const pay = y <= fin.tenor ? dsvc : 0, prin = Math.min(Math.max(pay - interest, 0), dOpen), open = dOpen;
      dOpen -= prin;
      const ebt = ebitda - dep - interest, tax = Math.max(0, ebt) * fin.tax, cfads = ebitda - tax;
      const e = cfads - pay, pc = ebitda - Math.max(0, ebitda - dep) * fin.tax;
      eqcf.push(e); ebts.push(ebt); if (pay > 0) dscrs.push(cfads / pay); pcf.push(pc);
      if (!light) rows.push({ p, y, con: false, rev, cost: cst, ebitda, dep, interest, principal: prin, debtService: pay, debtOpen: open, debtClose: dOpen, ebt, tax, cfads, eqcf: e, pcf: pc, dscr: pay > 0 ? cfads / pay : NaN });
    }
    const out = { npv_project: npv(fin.disc, pcf), npv_equity: npv(fin.hurdle, eqcf) };
    if (light) return out;
    return Object.assign(out, {
      capex, idc: idcTot, total_cost: totalCost, debt: debt0, equity: totalCost - debt0,
      payback_equity: payback(eqcf, ncon), payback_project: payback(pcf, ncon),
      rev_y1: rev0, cost_y1: cost0 + opex0, ebitda_y1: rev0 - cost0 - opex0, opex_y1: opex0,
      irr_project: irr(pcf), irr_equity: irr(eqcf),
      min_dscr: dscrs.length ? Math.min.apply(null, dscrs) : NaN, min_ebt: ebts.length ? Math.min.apply(null, ebts) : NaN,
      debt_service: dsvc, rows, pcf, eqcf
    });
  }

  function unitCf(u, d, rates, inp, fin, sh, light) {
    const lines = unitLines(u, d, rates, inp);
    let rev0 = 0, cost0 = 0;
    for (const ln of lines) { if (ln.sign > 0) rev0 += ln.value; else cost0 += ln.value; }
    const [capex, opex] = unitCapexOpex(u, d, inp);
    const cf = runCashflow(capex, opex, rev0, cost0, fin, sh, light);
    if (!light) cf.lines = lines;
    return cf;
  }

  function primaryRate(u) { const ln = M.lines[u].find(l => l.primary); return ln ? ln.rate : null; }

  /* Primary rate at which unit NPV (project at disc / equity at hurdle) = 0. NaN if volume is zero. */
  function solveMinRate(u, d, rates, inp, basis, fin, sh) {
    const ln = M.lines[u].find(l => l.primary);
    if (!ln) return NaN;
    if (volume(d, ln.vol, inp) <= NOISE) return NaN;          // the script tests <= 0; solver noise (1e-9 MWh) is not a volume
    const which = basis === 'equity' ? 'npv_equity' : 'npv_project';
    const rr = Object.assign({}, rates);
    const f = x => { rr[ln.rate] = x; return unitCf(u, d, rr, inp, fin, sh, true)[which]; };
    let lo = -1e4, hi = 1e4;
    while (f(hi) < 0 && hi < 1e9) hi *= 10;
    if (f(lo) > 0 || f(hi) < 0) return NaN;
    for (let i = 0; i < 100; i++) { const mid = 0.5 * (lo + hi); if (f(mid) < 0) lo = mid; else hi = mid; }
    return 0.5 * (lo + hi);
  }

  /* NH3 price at which the SUM of all unit project NPVs is zero (each at its own discount rate). */
  function solveSystemBreakeven(d, rates, inp, fins, sh) {
    const rr = Object.assign({}, rates);
    const f = x => { rr.p_NH3 = x; let s = 0; for (const u of M.units) s += unitCf(u, d, rr, inp, fins[u], sh, true).npv_project; return s; };
    let lo = 0, hi = 20000;
    if (f(lo) > 0 || f(hi) < 0) return NaN;
    for (let i = 0; i < 100; i++) { const mid = 0.5 * (lo + hi); if (f(mid) < 0) lo = mid; else hi = mid; }
    return 0.5 * (lo + hi);
  }

  /* Cost-reflective cascade: every supplier exactly at its project hurdle, operator at cost + margin. */
  function defaultRates(d, inp, fins, sh, marketPrice) {
    const r = {}; M.rates.forEach(x => { r[x[0]] = 0; });
    const mr = u => solveMinRate(u, d, r, inp, 'project', fins[u], sh);
    r.p_NG = num(d.NG_PRICE);
    r.p_NH3 = marketPrice != null ? marketPrice : (num(d.NH3_PRICE_RUN) || 660);
    r.r_RES = mr('RES'); if (isNaN(r.r_RES)) r.r_RES = num(d.LCOE_RES);
    // Operator tariff. The script uses r_RES + margin, which is cost-reflective only while grid imports are negligible
    // (plant 61). Fleet-wide many plants import most of their electricity, some build no renewables at all; there the
    // tariff must cover what the operator pays for imports. So: average cost of the electricity the operator procures
    // (renewables at the PPA rate, grid imports at their hourly cost plus demand and network charges) + margin.
    const eRes = volume(d, 'E_RES_paid', inp), eImp = num(d.E_imp), gridCost = num(d.IMP_COST) + num(d.DEMAND_CH) + num(d.NET_CH);
    const avgCost = eRes + eImp > NOISE ? (r.r_RES * eRes + gridCost) / (eRes + eImp) : r.r_RES;
    const tariff = Math.round((avgCost + M.opr_margin) * 10) / 10;
    ['r_B_in', 'r_HB_in', 'r_EL_in', 'r_ST_e', 'r_NH3_e', 'r_SMRgen'].forEach(k => { r[k] = tariff; });
    r.r_B_cap = 0;
    let v = mr('BAT'); r.r_B_out = isNaN(v) ? tariff + 50 : v;
    v = mr('HB'); r.r_heat = isNaN(v) ? tariff / 0.95 : v;
    v = mr('EL'); r.r_H2_EL = isNaN(v) ? 4.0 : v;
    r.r_ST_in = r.r_H2_EL;
    v = mr('H2ST'); r.r_ST_out = isNaN(v) ? r.r_ST_in + 1.0 : v;
    const h2cost = r.r_H2_EL * num(d.H2_EL_kg) + r.r_ST_out * num(d.H2_ST_out_kg) - r.r_ST_in * num(d.H2_ST_in_kg);
    r.r_H2_NH3 = num(d.H2_green_NH3_kg) > 0 ? h2cost / d.H2_green_NH3_kg : r.r_H2_EL;
    r.r_heat_NH3 = r.r_heat;
    for (const k in r) if (k.startsWith('r_') && k !== 'r_B_cap') r[k] = pyRound(r[k], (k.includes('H2') || k.includes('ST_')) ? 2 : 1);
    r.p_NG = pyRound(r.p_NG, 2);
    return r;
  }
  /* Python round(): correctly rounded decimal, ties to even on the binary value → toFixed is the closest match */
  function pyRound(x, n) { return Number(x.toFixed(n)); }

  /* Everything the page shows for one design point. */
  function evaluate(d, rates, inp, fins, sh) {
    const units = {};
    let ebitda = 0, capex = 0, npvP = 0, npvE = 0;
    for (const u of M.units) {
      const cf = unitCf(u, d, rates, inp, fins[u], sh, false);
      cf.built = cf.capex > 1000 || Math.abs(cf.rev_y1) + Math.abs(cf.cost_y1) > 1000;   // $; below that the unit is not built
      cf.min_p = solveMinRate(u, d, rates, inp, 'project', fins[u], sh);
      cf.min_e = solveMinRate(u, d, rates, inp, 'equity', fins[u], sh);
      units[u] = cf; ebitda += cf.ebitda_y1; capex += cf.capex; npvP += cf.npv_project; npvE += cf.npv_equity;
    }
    const allOpex = M.units.reduce((s, u) => s + M.opex[u].reduce((t, k) => t + num(d[k]), 0), 0);
    const expRev = num(d.EXP_REV) * inp.exp_real / (num(d.EXPORT_DISC) || 1);
    const integrated = rates.p_NH3 * num(d.NH3_t) + expRev - num(d.IMP_COST) - rates.p_NG * num(d.NG_MWh) - num(d.CARBON) - num(d.ETS)
      - num(d.DEMAND_CH) - num(d.NET_CH) - allOpex - inp.grid_opex_pct * (num(d.CAPEX_GRID_EXP) + num(d.CAPEX_GRID_LOAD));
    const be = units.NH3.min_p;
    return {
      units, sum: { ebitda, capex, npv_project: npvP, npv_equity: npvE },
      tieout: ebitda - integrated, integrated,
      breakeven: be, breakeven_equity: units.NH3.min_e, gap: be - rates.p_NH3,
      system: solveSystemBreakeven(d, rates, inp, fins, sh),
      mac: (num(d.BAU_CI) - num(d.CI_ACT)) > 1e-9 ? (be - num(d.BAU_LCOA_A)) / (num(d.BAU_CI) - num(d.CI_ACT)) : NaN,
      export_rev: expRev
    };
  }

  window.BUFin = { setModel, unitLines, unitCapexOpex, runCashflow, unitCf, solveMinRate, solveSystemBreakeven, defaultRates, evaluate, primaryRate, volume, npv, irr };
})();
