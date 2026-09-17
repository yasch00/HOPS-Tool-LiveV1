/* atlas/policy.js — the policy cases' per-year credit streams, in the browser.
   A port of the two re-pricing scripts (ets_lcoa_from_results.py / ets_policy_cases.py with hops_eu_ets.py, and
   us_credits.py / us_credit_cases.py): the published policy rows carry the LEVELISED credit that those scripts subtract
   from the LCOA; the finance model needs the year-by-year stream behind it (45V stops after 10 years, 45Q after 12,
   the ETS position moves with the benchmark, the free-allocation phase-out and the EUA price path). The stream here
   levelises back to the published number at the run's own annuity rate — that identity is checked and reported.
   Positive = credit / net seller; negative = allowances bought. */

const POLICY_START_YEAR = 2026, EUR_TO_USD = 1.1306;         // data_loading_2026_fixed: 2025-average FX, as the fleet re-pricing used
/* ---- EU ETS (hops_eu_ets.py) */
const FREE_SHARE_LAW = { 2025: 1.0, 2026: 0.975, 2027: 0.95, 2028: 0.9, 2029: 0.775, 2030: 0.515, 2031: 0.39, 2032: 0.265, 2033: 0.14, 2034: 0 };   // Art. 10a(1a), 2023/959
const FREE_SHARE_PROPOSAL = (() => { const o = {}; for (let y = 2025; y <= 2030; y++) { let s = FREE_SHARE_LAW[y]; if (y >= 2028) s = s + 0.15 * (1 - s); o[y] = s; } for (let y = 2031; y <= 2038; y++) o[y] = o[2030] * (2038 - y) / 8; o[2039] = 0; return o; })();   // COM(2026) 616 reconstruction
const BM_BASE = 1.619, BM_PERIODS = [[2021, 2025, 15, 1.570], [2026, 2030, 20, 1.522], [2031, 2035, 25, null], [2036, 2040, 30, null], [2041, 2045, 35, null], [2046, 2050, 40, null], [2051, 2060, 45, null]];   // legislated values pinned; floor rate 0.3%/yr beyond
function etsBenchmark(y){ for (const [a, b, win, pinned] of BM_PERIODS) if (y >= a && y <= b) return pinned != null ? pinned : BM_BASE * (1 - 0.003 * win); if (y < 2021) return BM_BASE; const win = 45 + 5 * (Math.floor((y - 2061) / 5) + 1); return Math.max(0, BM_BASE * (1 - 0.003 * win)); }
const EUA_ANCHORS = { law: { 2026: 80, 2030: 120, 2034: 150, 2038: 195 }, proposal: { 2026: 80, 2030: 103, 2034: 118, 2038: 145 } };
function euaPrice(anchors, y){ const ys = Object.keys(anchors).map(Number).sort((a, b) => a - b); if (y <= ys[0]) return anchors[ys[0]]; if (y >= ys[ys.length - 1]) return anchors[ys[ys.length - 1]];   // log-linear between anchors, flat beyond the last forecast
  const lo = Math.max(...ys.filter(a => a <= y)), hi = Math.min(...ys.filter(a => a >= y)), w = lo === hi ? 0 : (y - lo) / (hi - lo); return anchors[lo] * Math.pow(anchors[hi] / anchors[lo], w); }
function etsStream(ciOblig, scenario, life){   // $/t NH3 per operating year
  const share = scenario === 'law' ? FREE_SHARE_LAW : FREE_SHARE_PROPOSAL, anch = EUA_ANCHORS[scenario], out = [];
  for (let k = 0; k < life; k++) { const y = POLICY_START_YEAR + k, alloc = etsBenchmark(y) * (share[y] || 0); out.push({ year: y, alloc, price_usd: euaPrice(anch, y) * EUR_TO_USD, credit: (alloc - ciOblig) * euaPrice(anch, y) * EUR_TO_USD }); }
  return out;
}
/* ---- US 45V / 45Q (statutory, constant nominal, no indexation) */
const V45_RATE = 0.60 * 5, V45_TERM = 10, V45_TIERS = [[0.45, 1.0], [1.5, 0.334], [2.5, 0.25], [4.0, 0.2]], Q45_RATE = 17 * 5, Q45_TERM = 12;
function v45pct(h2ci){ for (const [c, p] of V45_TIERS) if (h2ci < c) return p; return 0; }
function annuityFactor(r, n){ return r === 0 ? n : (1 - Math.pow(1 + r, -n)) / r; }
function levelise(stream, r, life){ return stream.reduce((a, s, k) => a + Math.pow(1 + r, -(k + 1)) * s.credit, 0) / annuityFactor(r, life); }
/* ---- the stream for a published policy row.  r = scenario row, s = scenario, plant = its plant */
function policyStream(r, s, plant){
  if (!s || !s.policy || !r) return null;
  const life = Math.round(r.lifetime || 30), rate = r.interest || 0.08, tpy = (plant.tpd || 0) * 365;
  let stream, label, detail;
  if (s.policy === 'ETSlaw' || s.policy === 'ETSprop') {
    const gross = r.ci_direct != null ? r.ci_direct : Math.max(0, (r.ci_noccs || 0) - (r.e_imp || 0) * (r.grid_ci || 0) / (tpy || 1));   // NG emissions before capture; derived when the row predates the column
    const stored = tpy ? Math.max(0, r.co2_cap || 0) / tpy : 0, oblig = Math.max(0, gross - stored);   // Art. 12(3a): stored CO2 carries no obligation
    stream = etsStream(oblig, s.policy === 'ETSlaw' ? 'law' : 'proposal', life); label = s.policy === 'ETSlaw' ? 'EU ETS · current law' : 'EU ETS · July 2026 proposal';
    detail = `obligation ${oblig.toFixed(3)} tCO₂/t (direct ${gross.toFixed(3)} − stored ${stored.toFixed(3)}) vs free allocation ${stream[0].alloc.toFixed(3)} in ${POLICY_START_YEAR} → 0 in ${s.policy === 'ETSlaw' ? 2034 : 2039} · EUA ${EUA_ANCHORS[s.policy === 'ETSlaw' ? 'law' : 'proposal'][2026]}→${EUA_ANCHORS[s.policy === 'ETSlaw' ? 'law' : 'proposal'][2038]} €/t by 2038, flat after`;
  } else if (s.policy === 'USCred') {
    const elecH2 = tpy ? Math.max(0, r.h2_el || 0) * 1000 / tpy : 0, co2st = tpy ? Math.max(0, r.co2_cap || 0) / tpy : 0;
    const h2ci = elecH2 > 0.1 ? (r.e_imp || 0) / (tpy || 1) * (r.grid_ci || 0) * 1000 / elecH2 : 0, pct = v45pct(h2ci);   // all grid import charged to the electrolyser: upper bound
    const mk = (rt, q, term) => Array.from({ length: life }, (_, k) => ({ year: POLICY_START_YEAR + k, credit: k < term ? rt * q : 0 }));
    const sV = mk(V45_RATE * pct, elecH2, V45_TERM), sQ = mk(Q45_RATE, co2st, Q45_TERM), lV = levelise(sV, rate, life), lQ = levelise(sQ, rate, life);
    if (lQ > lV) { stream = sQ; label = '45Q'; detail = `${co2st.toFixed(3)} tCO₂ stored per t NH₃ × $${Q45_RATE}/t for ${Q45_TERM} years (45Q elected over 45V $${fmt(lV)}/t levelised)`; }
    else if (lV > 0) { stream = sV; label = '45V'; detail = `${fmt(elecH2)} kg electrolytic H₂ per t NH₃ × $${(V45_RATE * pct).toFixed(2)}/kg for ${V45_TERM} years (tier ${(pct * 100).toFixed(0)}% at ${h2ci.toFixed(2)} kgCO₂e/kgH₂${lQ > 0 ? '; 45Q would be $' + fmt(lQ) + '/t' : ''})`; }
    else { stream = sV; label = 'none'; detail = 'no electrolytic hydrogen and no stored CO₂ — nothing to claim'; }
  } else return null;
  const lev = levelise(stream, rate, life), published = (r.ets_credit != null ? r.ets_credit : 0) + (r.us_credit != null ? r.us_credit : 0);
  return { stream, label, detail, lev, published, ok: Math.abs(lev - published) < Math.max(1, 0.01 * Math.abs(published)), rate, life };
}
