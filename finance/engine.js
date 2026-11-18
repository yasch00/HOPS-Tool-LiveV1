/* Project Finance engine — browser port of the Python mirror in ProjectFinance/build_bu_finance.py
   (unit_lines, unit_capex_opex, run_cashflow, solve_min_rate, solve_system_breakeven, default_rates), eight units
   RES BAT HB EL H2ST ASU NH3 OPR plus the reference plant BAU (pseudo unit, not in the sums).
   Same arithmetic, same iteration counts, so the page ties to the workbook. One deliberate difference, in the
   STARTING rates of the cost-reflective cascade only: the operator's electricity tariff covers grid imports too.
   New on the page (version 6): negotiate() — the rate sets where every party clears a minimum equity return and the
   ammonia plant produces below the fossil reference: the operator's optimum and the Nash bargaining solution.
   The model tables (LINES, CAPEX, OPEX, BOOK, RATES, financing) come from data/finance/index.json → "model". */
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
      else if (ln.kind === 'ngadj') v = (num(rates.p_NG) - (inp.p_NG_built != null ? inp.p_NG_built : num(rates.p_NG))) * num(d[ln.vol]);
      else { q = volume(d, ln.vol, inp); v = num(rates[ln.rate]) * q; }
      return { label: ln.label, sign: ln.sign, value: v, rate: ln.rate || null, vol: ln.vol, kind: ln.kind, volume: q, primary: !!ln.primary };
    });
  }

  function bookKeys(u, inp) { return u === M.ref ? (inp.retro ? ['BAU_CAPEX'] : []) : (M.book[u] || []); }
  function unitCapexOpex(u, d, inp) {
    let capex = M.capex[u].reduce((s, k) => s + num(d[k]), 0);
    const bs = inp.book_share != null ? inp.book_share : 1;
    capex -= (1 - bs) * bookKeys(u, inp).reduce((s, k) => s + num(d[k]), 0);
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

  function primaryLine(u) { return M.lines[u].find(l => l.primary) || null; }
  function primaryRate(u) { const ln = primaryLine(u); return ln ? ln.rate : null; }

  /* Primary rate at which unit NPV (project at disc / equity at hurdle) = 0. NaN if volume is zero. */
  function solveMinRate(u, d, rates, inp, basis, fin, sh) {
    const ln = primaryLine(u);
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

  /* Operator's average cost of the electricity it procures (renewables at the PPA rate, grid imports at their hourly
     cost plus demand and network charges). */
  function avgElecCost(d, inp, rRes) {
    const eRes = volume(d, 'E_RES_paid', inp), eImp = num(d.E_imp), gridCost = num(d.IMP_COST) + num(d.DEMAND_CH) + num(d.NET_CH);
    return eRes + eImp > NOISE ? (rRes * eRes + gridCost) / (eRes + eImp) : rRes;
  }
  const ELEC_IN = ['r_B_in', 'r_HB_in', 'r_EL_in', 'r_ST_e', 'r_ASU_e'];
  function h2PassThrough(d, r) {
    const kg = num(d.H2_green_NH3_kg);
    return kg > 0 ? (r.r_H2_EL * num(d.H2_EL_kg) + r.r_ST_out * num(d.H2_ST_out_kg) - r.r_ST_in * num(d.H2_ST_in_kg)) / kg : r.r_H2_EL;
  }

  /* Cost-reflective cascade: every supplier exactly at its project hurdle, operator at cost + margin, the ammonia
     plant carries the result. As default_rates() of the script, with the web's tariff (covers grid imports). */
  function defaultRates(d, inp, fins, sh, marketPrice, margin) {
    const r = {}; M.rates.forEach(x => { r[x[0]] = 0; });
    const mr = u => solveMinRate(u, d, r, inp, 'project', fins[u], sh);
    r.p_NG = num(d.NG_PRICE);
    r.p_NH3 = marketPrice != null ? marketPrice : (num(d.NH3_PRICE_RUN) || 660);
    r.r_RES = mr('RES'); if (isNaN(r.r_RES)) r.r_RES = num(d.LCOE_RES);
    const tariff = Math.round((avgElecCost(d, inp, r.r_RES) + (margin != null ? margin : M.opr_margin)) * 10) / 10;
    ELEC_IN.concat(['r_NH3_e']).forEach(k => { r[k] = tariff; });
    r.r_B_cap = 0;
    let v = mr('BAT'); r.r_B_out = isNaN(v) ? tariff + 50 : v;
    v = mr('HB'); r.r_heat = isNaN(v) ? tariff / 0.95 : v;
    v = mr('EL'); r.r_H2_EL = isNaN(v) ? 4.0 : v;
    r.r_ST_in = r.r_H2_EL;
    v = mr('H2ST'); r.r_ST_out = isNaN(v) ? r.r_ST_in + 1.0 : v;
    r.r_H2_NH3 = h2PassThrough(d, r);
    r.r_heat_NH3 = r.r_heat;
    v = mr('ASU'); r.r_N2 = isNaN(v) ? 25.0 : v;
    r.r_N2 = r.r_N2_NH3 = pyRound(r.r_N2, 1);
    for (const k in r) if (k.startsWith('r_') && k !== 'r_B_cap') r[k] = pyRound(r[k], (k.includes('H2') || k.includes('ST_')) ? 2 : 1);
    r.p_NG = pyRound(r.p_NG, 2);
    return r;
  }
  /* Python round(): correctly rounded decimal, ties to even on the binary value → toFixed is the closest match */
  function pyRound(x, n) { return Number(x.toFixed(n)); }

  /* ------------------------------------------------------------------ negotiation
     Parties: every built unit. Walk-away point of a supplier and of the operator: its equity NPV at the minimum
     equity return (hmin) = 0, i.e. equity IRR = hmin. Walk-away point of the ammonia plant: producing at the cost of
     the fossil reference (the HOPS BAU plant on the same financing: new fossil plant for greenfield, the existing
     plant carrying on for retrofit). Its gain = its equity NPV at hmin when ammonia is valued at that cost.
     Every party's gain is a $ NPV at hmin, so they can be compared and multiplied.
     Rates: each supplier is paid through its selling rate (it buys electricity at the operator's tariff, held fixed:
     its average procurement cost + margin); the ammonia plant pays pass-through costs × (1 + m), one markup m on
     electricity, hydrogen, heat and nitrogen. Each of these numbers moves money between one party and the operator
     only, so the problem separates into one bilateral deal per party with the operator. */
  const SELL = { RES: 'r_RES', BAT: 'r_B_out', HB: 'r_heat', EL: 'r_H2_EL', H2ST: 'r_ST_out', ASU: 'r_N2' };
  const NH3_BUY = { r_NH3_e: 'e', r_H2_NH3: 'h2', r_heat_NH3: 'heat', r_N2_NH3: 'n2' };

  function bisect(f, lo, hi, it) {                 // f(lo) < 0 < f(hi) (or the other way round); returns the root
    let flo = f(lo);
    for (let i = 0; i < (it || 80); i++) { const mid = 0.5 * (lo + hi), fm = f(mid); if ((fm < 0) === (flo < 0)) { lo = mid; flo = fm; } else hi = mid; }
    return 0.5 * (lo + hi);
  }
  /* x where g(x) = target, g monotone; search outward from x0. NaN if no sign change within the range. */
  function solveFor(g, target, x0, scale) {
    const f = x => g(x) - target;
    let a = x0, b = x0, fa = f(a), step = Math.max(Math.abs(scale || 1), 1e-3);
    if (fa === 0) return a;
    for (let i = 0; i < 60; i++) {
      a = x0 - step; b = x0 + step;
      const fA = f(a), fB = f(b);
      if ((fA < 0) !== (fa < 0)) return bisect(f, a, x0);
      if ((fB < 0) !== (fa < 0)) return bisect(f, x0, b);
      step *= 2;
    }
    return NaN;
  }

  function negotiate(d, inp, fins, sh, opt) {
    const hmin = opt.hmin, margin = opt.margin != null ? opt.margin : M.opr_margin;
    const F = {}; M.units.concat([M.ref]).forEach(u => { F[u] = Object.assign({}, fins[u], { hurdle: hmin }); });
    const r = defaultRates(d, inp, fins, sh, opt.market, margin);      // starting point; the sell rates are re-solved below
    const pNH3 = r.p_NH3;
    // fossil reference at the same financing: the ammonia price at which the reference plant earns hmin on equity
    const hasRef = num(d.BAU_CASH) !== 0 || num(d.BAU_CAPEX) !== 0;
    const pRef = hasRef ? solveMinRate(M.ref, d, r, inp, 'equity', F[M.ref], sh) : NaN;
    const pWalk = isFinite(pRef) ? pRef : pNH3;
    const surplus = (u, rr) => {
      if (u === 'NH3') { const q = Object.assign({}, rr, { p_NH3: pWalk }); return unitCf('NH3', d, q, inp, F.NH3, sh, true).npv_equity; }
      return unitCf(u, d, rr, inp, F[u], sh, true).npv_equity;
    };
    const built = u => {
      const [cap] = unitCapexOpex(u, d, inp);
      const ln = primaryLine(u);
      return cap > 1000 || (ln && volume(d, ln.vol, inp) > NOISE && u !== 'NH3' && u !== 'OPR');
    };
    const parties = M.units.filter(u => u === 'NH3' || u === 'OPR' || (SELL[u] && built(u) && volume(d, primaryLine(u).vol, inp) > NOISE));
    const notes = [];
    M.units.forEach(u => { if (SELL[u] && built(u) && !parties.includes(u)) notes.push(u + ' has capital but no sales: it cannot be paid through a rate'); });

    // 1. walk-away sell rates (each supplier exactly at hmin), with the tariff from the walk-away PPA rate
    const rr = Object.assign({}, r);
    const walk = {};
    const solveSell = (u, target) => {
      const k = SELL[u], g = x => { rr[k] = x; return surplus(u, rr); };
      const x = solveFor(g, target, num(rr[k]) || 1, Math.max(1, Math.abs(num(rr[k])) * 0.5));
      rr[k] = isFinite(x) ? x : rr[k];
      return x;
    };
    if (parties.includes('RES')) walk.RES = solveSell('RES', 0);
    const tariff = avgElecCost(d, inp, rr.r_RES) + margin;
    ELEC_IN.forEach(k => { rr[k] = tariff; });
    rr.r_B_cap = 0;
    ['BAT', 'HB', 'EL'].forEach(u => { if (parties.includes(u)) walk[u] = solveSell(u, 0); });
    rr.r_ST_in = rr.r_H2_EL;                                        // the store buys hydrogen at the electrolyzer's price
    ['H2ST', 'ASU'].forEach(u => { if (parties.includes(u)) walk[u] = solveSell(u, 0); });
    // pass-through costs of the ammonia plant's inputs, fixed from here (so each deal stays bilateral)
    const cost = { e: tariff, h2: h2PassThrough(d, rr), heat: rr.r_heat, n2: rr.r_N2 };
    const setM = (q, m) => { for (const k in NH3_BUY) q[k] = cost[NH3_BUY[k]] * (1 + m); };
    const nh3Spend = cost.e * num(d.E_NH3plant) + cost.h2 * num(d.H2_green_NH3_kg) + cost.heat * num(d.H_HB_out) + cost.n2 * num(d.N2_ASU_t);
    let mWalk;
    if (nh3Spend > 1000) { mWalk = solveFor(m => { setM(rr, m); return -surplus('NH3', rr); }, 0, 0, 0.5); }
    else mWalk = 0;
    if (!isFinite(mWalk)) mWalk = 0;
    setM(rr, mWalk);
    const opWalk = Object.assign({}, rr);
    const total = surplus('OPR', opWalk);                            // what is left for the operator when every other party is at its walk-away point
    const res = { hmin, pRef, pWalk, hasRef, tariff, cost, parties, notes, walk: Object.assign({ m: mWalk }, walk), total, nh3Spend };
    const sOf = q => { const s = {}; parties.forEach(u => { s[u] = surplus(u, q); }); return s; };
    res.operator = { rates: opWalk, m: mWalk, s: sOf(opWalk) };
    res.feasible = total >= 0;
    if (!res.feasible) {
      // how much higher the ammonia plant's walk-away would have to be for a deal to exist ($/t): the gap to close
      const opAt = dp => { const q = Object.assign({}, opWalk); const pw = pWalk + dp;
        const g = m => { setM(q, m); return unitCf('NH3', d, Object.assign({}, q, { p_NH3: pw }), inp, F.NH3, sh, true).npv_equity; };
        const m = nh3Spend > 1000 ? solveFor(g, 0, mWalk, 0.5) : 0; setM(q, isFinite(m) ? m : mWalk); return surplus('OPR', q); };
      res.gap = opAt(0) < 0 && opAt(5000) > 0 ? bisect(opAt, 0, 5000, 60) : NaN;
      res.nash = null;
      return res;
    }
    // 2. Nash bargaining: maximise the weighted sum of log gains. Weights = bargaining power: equal (the symmetric
    //    Nash solution) or the equity each party puts in (every party then earns about the same return above hmin).
    //    Start from the split in proportion to the weights, then coordinate ascent.
    const eq = {}; parties.forEach(u => { const cf = unitCf(u, d, opWalk, inp, F[u], sh, false); eq[u] = Math.max(0, cf.equity); });
    // a retrofitted plant brings its existing units even when they are written off: count them at the equity share of
    // their replacement value, so an old plant does not bargain with no power at all
    if (eq.NH3 != null) eq.NH3 = Math.max(eq.NH3, (1 - F.NH3.gearing) * num(d.REPL_VAL));
    const eqMax = Math.max.apply(null, parties.map(u => eq[u])) || 1;
    const w = {}; parties.forEach(u => { w[u] = opt.power === 'equity' ? Math.max(eq[u], 0.01 * eqMax) : 1; });
    const wSum = parties.reduce((s, u) => s + w[u], 0);
    res.weights = w; res.equity = eq;
    const q = Object.assign({}, opWalk);
    const vars = parties.filter(u => u !== 'OPR').map(u => u === 'NH3' ? { u, k: 'm' } : { u, k: SELL[u] });
    const getV = v => (v.k === 'm' ? q.__m : q[v.k]);
    const setV = (v, x) => { if (v.k === 'm') { q.__m = x; setM(q, x); } else q[v.k] = x; };
    q.__m = mWalk;
    vars.forEach(v => {                                                // equal split as the starting point
      const g = x => { setV(v, x); return surplus(v.u, q); };
      const x0 = v.k === 'm' ? mWalk : walk[v.u];
      const x = solveFor(g, total * w[v.u] / wSum, x0, v.k === 'm' ? 0.2 : Math.max(0.5, Math.abs(x0) * 0.2));
      setV(v, isFinite(x) ? x : x0);
    });
    const LOG = (a, b, wa) => (a > 0 && b > 0 ? wa * Math.log(a) + w.OPR * Math.log(b) : -Infinity);
    for (let sweep = 0; sweep < 25; sweep++) {
      let moved = 0;
      vars.forEach(v => {
        const x0 = getV(v), lo0 = v.k === 'm' ? mWalk : walk[v.u];
        // bracket between the party's walk-away and the operator's walk-away (given the other deals)
        const gOp = x => { setV(v, x); return surplus('OPR', q); };
        const hiX = solveFor(gOp, 0, x0, v.k === 'm' ? 0.2 : Math.max(0.5, Math.abs(x0) * 0.2));
        if (!isFinite(hiX)) { setV(v, x0); return; }
        let a = Math.min(lo0, hiX), b = Math.max(lo0, hiX);
        const fobj = x => { setV(v, x); return LOG(surplus(v.u, q), surplus('OPR', q), w[v.u]); };
        const gr = (Math.sqrt(5) - 1) / 2;
        let c = b - gr * (b - a), e = a + gr * (b - a), fc = fobj(c), fe = fobj(e);
        for (let i = 0; i < 60; i++) {
          if (fc > fe) { b = e; e = c; fe = fc; c = b - gr * (b - a); fc = fobj(c); }
          else { a = c; c = e; fc = fe; e = a + gr * (b - a); fe = fobj(e); }
        }
        const x = 0.5 * (a + b);
        setV(v, fobj(x) >= fobj(x0) ? x : x0);
        moved = Math.max(moved, Math.abs(getV(v) - x0) / Math.max(1e-6, Math.abs(x0) + 1e-3));
      });
      if (moved < 1e-7) break;
    }
    const nr = Object.assign({}, q); delete nr.__m;
    res.nash = { rates: nr, m: q.__m, s: sOf(nr) };
    return res;
  }

  /* Everything the page shows for one design point. hmin: minimum equity return used for the ammonia cost. */
  function evaluate(d, rates, inp, fins, sh, hmin) {
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
    const h = hmin != null ? hmin : fins.NH3.hurdle;
    const fH = Object.assign({}, fins.NH3, { hurdle: h }), fR = Object.assign({}, fins[M.ref], { hurdle: h });
    const nh3Cost = solveMinRate('NH3', d, rates, inp, 'equity', fH, sh);               // ammonia price the plant needs at hmin on equity
    const hasRef = num(d.BAU_CASH) !== 0 || num(d.BAU_CAPEX) !== 0;
    const refCost = hasRef ? solveMinRate(M.ref, d, rates, inp, 'equity', fR, sh) : NaN;
    const refCf = hasRef ? unitCf(M.ref, d, rates, inp, fins[M.ref], sh, false) : null;
    return {
      units, sum: { ebitda, capex, npv_project: npvP, npv_equity: npvE },
      tieout: ebitda - integrated, integrated,
      breakeven: units.NH3.min_p, breakeven_equity: units.NH3.min_e,
      nh3_cost: nh3Cost, ref_cost: refCost, saving: refCost - nh3Cost, ref: refCf,
      system: solveSystemBreakeven(d, rates, inp, fins, sh),
      mac: (num(d.BAU_CI) - num(d.CI_ACT)) > 1e-9 && isFinite(refCost) ? (nh3Cost - refCost) / (num(d.BAU_CI) - num(d.CI_ACT)) : NaN,
      export_rev: expRev
    };
  }

  window.BUFin = { setModel, unitLines, unitCapexOpex, runCashflow, unitCf, solveMinRate, solveSystemBreakeven, defaultRates, evaluate,
    negotiate, primaryRate, volume, npv, irr, avgElecCost, h2PassThrough, SELL, NH3_BUY };
})();
