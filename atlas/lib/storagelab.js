/* atlas/lib/storagelab.js — the Energy Storage Lab: a full-screen view in the tool for learning storage technologies against
   THIS plant's need. Top: category → technology chips. Centre: a 3D model of the technology (lib/storage3d.js). Left: the
   technology, its fit for the plant, key facts, the duty assumptions. Right: charge pattern, state of charge, degradation,
   effect on the plant. Two kinds of numbers live here and are marked apart: the plant's own (battery size, duty cycle,
   prices, LCOA — model output) and the technology parameters (INDICATIVE 2025 literature values: Lazard LCOS v9, NREL ATB
   2024, IEA; the only place in the tool where indicative values are used, and they are labelled as such). */
const STORAGE_CATS = { electrochemical: 'Electrochemical', mechanical: 'Mechanical', thermal: 'Thermal', electrical: 'Electrical', chemical: 'Chemical' };
const STORAGE_TECH = [   // capex_e $/kWh, capex_p $/kW, rte, life yr, cyc cycle life, om %/yr, dur [min,max] h, whkg, whl (system), trl, model (3D), fade: % capacity lost per year at 1 cycle/day
  { k: 'lfp',  cat: 'electrochemical', fam: 'Lithium-ion', n: 'LFP', long: 'Lithium iron phosphate', d: 'The grid-storage workhorse — cheap, cobalt-free, thermally stable. Hours of duration, thousands of cycles.', capex_e: 200, capex_p: 150, rte: .88, life: 15, cyc: 6000, om: .02, dur: [1, 8], whkg: 160, whl: 150, trl: 9, model: 'containers', c: '#56B4E9', main: true },
  { k: 'nmc',  cat: 'electrochemical', fam: 'Lithium-ion', n: 'NMC', long: 'Nickel manganese cobalt', d: 'Higher energy density than LFP, more expensive and shorter-lived; the EV chemistry, less common for stationary duty.', capex_e: 230, capex_p: 150, rte: .90, life: 12, cyc: 3500, om: .02, dur: [.5, 6], whkg: 250, whl: 220, trl: 9, model: 'containers', c: '#0072B2', main: true },
  { k: 'naion', cat: 'electrochemical', fam: 'Sodium-based', n: 'Na-ion', long: 'Sodium-ion', d: 'Lithium-free with abundant materials; early commercial. Competitive only if lithium prices stay high (Yao, Benson & Chueh 2025).', capex_e: 210, capex_p: 150, rte: .85, life: 12, cyc: 4000, om: .02, dur: [1, 8], whkg: 140, whl: 100, trl: 8, model: 'containers', c: '#1B6F8E', main: true },
  { k: 'vrfb', cat: 'electrochemical', fam: 'Flow', n: 'Vanadium flow', long: 'Vanadium redox flow', d: 'Energy in tanks of electrolyte, power in the stack — the two scale independently. Long life, low density, expensive vanadium.', capex_e: 350, capex_p: 900, rte: .72, life: 25, cyc: 15000, om: .025, dur: [4, 12], whkg: 25, whl: 25, trl: 8, model: 'flow', c: '#CC79A7', main: true },
  { k: 'feair', cat: 'electrochemical', fam: 'Metal-air', n: 'Iron-air', long: 'Iron-air (rusting/un-rusting)', d: 'Very cheap energy, very slow: 100-hour discharge at low efficiency. Built for multi-day gaps, not daily arbitrage.', capex_e: 25, capex_p: 1400, rte: .45, life: 20, cyc: 3000, om: .02, dur: [50, 150], whkg: 30, whl: 30, trl: 6, model: 'ironair', c: '#8C6D1F', main: true },
  { k: 'nca',  cat: 'electrochemical', fam: 'Lithium-ion', n: 'NCA', long: 'Nickel cobalt aluminium', d: 'High energy density, used in some EVs; rarely chosen for grid storage.', capex_e: 240, capex_p: 150, rte: .90, life: 12, cyc: 3000, om: .02, dur: [.5, 6], whkg: 260, whl: 230, trl: 9, model: 'containers', c: '#3f6f8e' },
  { k: 'lto',  cat: 'electrochemical', fam: 'Lithium-ion', n: 'LTO', long: 'Lithium titanate', d: 'Extremely long cycle life and fast charging, but low energy density and high cost per kWh — a power product.', capex_e: 500, capex_p: 150, rte: .92, life: 20, cyc: 20000, om: .02, dur: [.1, 2], whkg: 80, whl: 90, trl: 8, model: 'containers', c: '#6b8fa8' },
  { k: 'ssb',  cat: 'electrochemical', fam: 'Lithium-ion', n: 'Solid-state', long: 'Solid-state lithium', d: 'Solid electrolyte; higher density and safety promised, pre-commercial at grid scale.', capex_e: 400, capex_p: 150, rte: .90, life: 12, cyc: 3000, om: .02, dur: [.5, 6], whkg: 350, whl: 300, trl: 4, model: 'containers', c: '#7d9fb5' },
  { k: 'nas',  cat: 'electrochemical', fam: 'Sodium-based', n: 'NaS', long: 'Sodium-sulfur (high-temperature)', d: 'Molten sodium and sulfur at ~300 °C; long duration, decades of deployment in Japan.', capex_e: 300, capex_p: 200, rte: .80, life: 15, cyc: 4500, om: .025, dur: [4, 8], whkg: 150, whl: 120, trl: 8, model: 'containersHot', c: '#8a5a1e' },
  { k: 'zebra', cat: 'electrochemical', fam: 'Sodium-based', n: 'ZEBRA', long: 'Sodium-nickel-chloride', d: 'High-temperature sodium chemistry, robust and long-lived, niche supply.', capex_e: 350, capex_p: 200, rte: .85, life: 15, cyc: 4000, om: .025, dur: [2, 8], whkg: 120, whl: 150, trl: 7, model: 'containersHot', c: '#9c7a2a' },
  { k: 'ironflow', cat: 'electrochemical', fam: 'Flow', n: 'Iron flow', long: 'All-iron flow', d: 'Flow battery on iron chloride — cheap electrolyte, lower efficiency than vanadium.', capex_e: 250, capex_p: 800, rte: .65, life: 25, cyc: 20000, om: .025, dur: [6, 12], whkg: 20, whl: 20, trl: 7, model: 'flow', c: '#b07aa0' },
  { k: 'znbr', cat: 'electrochemical', fam: 'Flow', n: 'Zinc-bromine', long: 'Zinc-bromine flow', d: 'Hybrid flow battery; deep-cycle tolerant, bromine handling.', capex_e: 300, capex_p: 700, rte: .70, life: 15, cyc: 10000, om: .025, dur: [4, 10], whkg: 60, whl: 40, trl: 7, model: 'flow', c: '#c98fb8' },
  { k: 'pbacid', cat: 'electrochemical', fam: 'Lead', n: 'Lead-acid', long: 'Advanced lead-acid', d: 'The oldest rechargeable chemistry: cheap and recyclable, short cycle life, heavy.', capex_e: 180, capex_p: 150, rte: .80, life: 8, cyc: 1500, om: .03, dur: [1, 4], whkg: 40, whl: 80, trl: 9, model: 'leadacid', c: '#8A8F94' },
  { k: 'phs',  cat: 'mechanical', fam: 'Gravity', n: 'Pumped hydro', long: 'Pumped-storage hydropower', d: 'Water pumped uphill and run back through turbines. Most of the world\'s storage; needs the geography.', capex_e: 80, capex_p: 1800, rte: .78, life: 60, cyc: 1e9, om: .015, dur: [6, 24], whkg: .3, whl: .3, trl: 9, model: 'phs', c: '#009E73', main: true },
  { k: 'caes', cat: 'mechanical', fam: 'Compressed air', n: 'Compressed air', long: 'Adiabatic compressed-air energy storage', d: 'Air compressed into a cavern, the heat of compression stored and returned on expansion. Needs a salt cavern or aquifer.', capex_e: 60, capex_p: 1300, rte: .62, life: 35, cyc: 10000, om: .02, dur: [6, 24], whkg: 3, whl: 6, trl: 7, model: 'caes', c: '#4C5B6E', main: true },
  { k: 'laes', cat: 'mechanical', fam: 'Cryogenic', n: 'Liquid air', long: 'Liquid-air energy storage', d: 'Air liquefied with surplus power, stored in tanks, re-gasified through a turbine. Siteable anywhere; efficiency is the cost.', capex_e: 70, capex_p: 1500, rte: .55, life: 30, cyc: 10000, om: .02, dur: [8, 24], whkg: 60, whl: 60, trl: 7, model: 'laes', c: '#6B7379', main: true },
  { k: 'fly',  cat: 'mechanical', fam: 'Kinetic', n: 'Flywheel', long: 'Flywheel', d: 'A spinning rotor in vacuum — seconds to minutes of power, millions of cycles. Frequency response, not energy shifting.', capex_e: 3000, capex_p: 400, rte: .88, life: 20, cyc: 1e5, om: .02, dur: [.02, .5], whkg: 10, whl: 20, trl: 9, model: 'fly', c: '#8A8F94', main: true },
  { k: 'heat', cat: 'thermal', fam: 'Sensible heat', n: 'Heat battery', long: 'Electrically heated brick / firebrick storage', d: 'Bricks heated to 1,000 °C+ with cheap power, discharged as process steam. Round trip to heat is nearly lossless — it is what HOPS builds for the reformer.', capex_e: 25, capex_p: 250, rte: .95, life: 30, cyc: 20000, om: .01, dur: [4, 48], whkg: 300, whl: 400, trl: 8, model: 'heat', c: '#D55E00', heatOnly: true, main: true },
  { k: 'salt', cat: 'thermal', fam: 'Sensible heat', n: 'Molten salt', long: 'Two-tank molten-salt storage', d: 'Nitrate salt at ~560 °C between a hot and a cold tank; proven in solar-thermal plants, delivers heat or steam-turbine power.', capex_e: 30, capex_p: 900, rte: .40, life: 30, cyc: 10000, om: .02, dur: [6, 15], whkg: 150, whl: 250, trl: 9, model: 'salt', c: '#c9a24a', main: true },
  { k: 'scap', cat: 'electrical', fam: 'Capacitive', n: 'Supercapacitor', long: 'Electric double-layer capacitor', d: 'Electrostatic storage: instant, near-lossless, a million cycles — and almost no energy. Power quality, not energy.', capex_e: 5000, capex_p: 200, rte: .95, life: 15, cyc: 1e6, om: .01, dur: [.003, .05], whkg: 8, whl: 10, trl: 9, model: 'racks', c: '#A6392A', main: true },
  { k: 'h2',   cat: 'chemical', fam: 'Hydrogen', n: 'Hydrogen', long: 'Electrolyser · compressed storage · reconversion', d: 'Power to hydrogen to power. The cheapest energy of all per kWh stored and the worst round trip — the seasonal option. In HOPS the hydrogen is used, not reconverted.', capex_e: 15, capex_p: 2200, rte: .35, life: 25, cyc: 1e9, om: .03, dur: [24, 2000], whkg: 1200, whl: 1.3, trl: 7, model: 'h2', c: '#E69F00', main: true }
];
const SL = { cat: 'electrochemical', tech: 'lfp', dur: 4, cycles: 250, price: 40, rate: 0.08, capexMult: 1, swing: 'intraday', view: 'persp', idx: null, scn: null, ci: null };
let __sl3d = null;
function crf(r, n){ return r === 0 ? 1 / n : r / (1 - Math.pow(1 + r, -n)); }
function lcos(t, dur, cycles, price, rate, mult = 1){
  const E = 1, P = 1 / dur, life = Math.min(t.life, t.cyc / Math.max(1, cycles)), capex = (t.capex_e * 1000 * E + t.capex_p * 1000 * P) * mult;
  const annual = crf(rate, life) * capex + t.om * capex, out = E * cycles, charge = out / t.rte * price, losses = (out / t.rte - out) * price;
  return { capital: annual / out, charging: charge / out, losses: losses / out, total: (annual + charge) / out, life, capex };
}
function suited(t, dur){ return dur >= t.dur[0] * 0.8 && dur <= t.dur[1] * 1.25; }
function techOf(k){ return STORAGE_TECH.find(t => t.k === k); }
/* fit for this plant, 0–100: duration match, cycle-life headroom, cost rank among suited technologies, maturity, heat use */
function fitScore(t, ctx){
  const dur = SL.dur, cycles = SL.cycles;
  const ratio = dur < t.dur[0] ? dur / t.dur[0] : dur > t.dur[1] ? t.dur[1] / dur : 1, fDur = Math.max(0, Math.min(1, Math.log10(Math.max(ratio, 1e-3)) / 1 + 1)) * 40;   // 40 at match, 0 at a decade off
  const yrs = t.cyc / Math.max(1, cycles), fLife = Math.min(1, yrs / 15) * 20;
  const all = STORAGE_TECH.filter(x => !x.heatOnly && suited(x, dur)).map(x => lcos(x, dur, cycles, SL.price, SL.rate).total).sort((a, b) => a - b);
  const mine = lcos(t, dur, cycles, SL.price, SL.rate).total, rank = all.length ? all.filter(v => v < mine).length / all.length : .5, fCost = (1 - rank) * 30;
  const fTrl = Math.min(1, (t.trl - 3) / 6) * 10;
  let heat = 'None'; if (t.heatOnly) heat = ctx.hbMWh > 1 ? 'Direct — HOPS builds ' + fmt(ctx.hbMWh) + ' MWh of it' : 'Direct (this run builds none)';
  return { score: Math.round(fDur + fLife + fCost + fTrl), parts: { duration: fDur, life: fLife, cost: fCost, trl: fTrl }, heat, durLabel: ratio >= 1 ? 'Good' : ratio > .5 ? 'Stretch' : 'Poor', lifeLabel: yrs >= 15 ? 'Full life' : yrs >= 8 ? fmt(yrs) + ' yr at this duty' : 'Cycle-limited · ' + fmt(yrs) + ' yr' };
}
/* charge pattern: the plant's real battery dispatch when available (24 h window from the summer week), else a synthetic pattern for the chosen swing */
function patternSeries(rec, swing){
  const hours = swing === 'spiky' ? 6 : swing === 'intraday' ? 48 : swing === 'multiday' ? 24 * 7 : 24 * 365, n = swing === 'spiky' ? 72 : swing === 'intraday' ? 48 : swing === 'multiday' ? 168 : 365, step = hours / n;
  const p = [], soc = []; let s = .5;
  if (rec && rec.b && rec.bd && swing === 'intraday' && Math.max(...rec.bd) > 1e-3) {
    let best = 0, bestV = -1; for (let t0 = 0; t0 + 48 <= rec.b.length; t0 += 24) { let v = 0; for (let i = 0; i < 48; i++) v += Math.abs((rec.b[t0 + i] || 0) - (rec.bd[t0 + i] || 0)); if (v > bestV) { bestV = v; best = t0; } }   // the two busiest days
    for (let i = 0; i < 48; i++) { const c = (rec.b[best + i] || 0) - (rec.bd[best + i] || 0); p.push(c); soc.push(rec.bsoc ? rec.bsoc[best + i] || 0 : 0); }
    const d = Math.floor(best / 24), MS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]; let m = 11; while (m > 0 && MS[m] > d) m--;
    return { p, soc, hours, live: true, unit: 'MW', socUnit: 'MWh', when: `${d - MS[m] + 1} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m]}` }; }
  for (let i = 0; i < n; i++) { const x = i / n; let c;
    if (swing === 'spiky') c = Math.sin(x * Math.PI * 2 * 9) * (0.5 + 0.5 * Math.sin(x * 40)) + 0.3 * Math.sin(x * 130);
    else if (swing === 'intraday') { const h = (i * step) % 24; c = h > 9 && h < 16 ? 1 : (h > 18 || h < 6) ? -0.7 : 0; }
    else if (swing === 'multiday') c = Math.sin(x * Math.PI * 2 * 1.5) * (0.6 + 0.4 * Math.sin(x * 9));
    else c = Math.cos((x - .55) * Math.PI * 2) * 0.9;
    p.push(c); s = Math.max(0, Math.min(1, s + c * (swing === 'seasonal' ? .006 : swing === 'multiday' ? .03 : swing === 'intraday' ? .12 : .02))); soc.push(s); }
  return { p, soc, hours, live: false, unit: '× rated power', socUnit: 'fraction' };
}
function miniChart(arr, opt){   // small SVG: filled area, zero line, ±colours for charge/discharge
  const W = 360, H = opt.h || 90, ml = 34, mr = 6, mt = 8, mb = 16, pw = W - ml - mr, ph = H - mt - mb, max = Math.max(1e-9, ...arr.map(v => Math.abs(v))), lo = opt.signed ? -max : 0, hi = max;
  const x = i => ml + i / (arr.length - 1) * pw, y = v => mt + ph - (v - lo) / (hi - lo) * ph;
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block">`;
  s += `<line x1="${ml}" y1="${y(0)}" x2="${W - mr}" y2="${y(0)}" stroke="#66717B" stroke-width=".8"/>`;
  if (opt.signed) { let up = '', dn = ''; arr.forEach((v, i) => { const X = x(i).toFixed(1); up += `${i ? 'L' : 'M'}${X} ${y(Math.max(0, v)).toFixed(1)} `; dn += `${i ? 'L' : 'M'}${X} ${y(Math.min(0, v)).toFixed(1)} `; });
    s += `<path d="${up}L${x(arr.length - 1)} ${y(0)} L${x(0)} ${y(0)} Z" fill="${opt.c1}" opacity=".85"/><path d="${dn}L${x(arr.length - 1)} ${y(0)} L${x(0)} ${y(0)} Z" fill="${opt.c2}" opacity=".85"/>`; }
  else { let d = ''; arr.forEach((v, i) => { d += `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `; }); s += `<path d="${d}L${x(arr.length - 1)} ${y(0)} L${x(0)} ${y(0)} Z" fill="${opt.c1}" opacity=".18"/><path d="${d}" fill="none" stroke="${opt.c1}" stroke-width="1.8"/>`; }
  s += `<text x="${ml - 4}" y="${mt + 4}" font-size="9" text-anchor="end" fill="#66717B">${opt.top || ''}</text><text x="${ml - 4}" y="${y(0) + 3}" font-size="9" text-anchor="end" fill="#66717B">0</text>`;
  if (opt.signed) s += `<text x="${ml - 4}" y="${mt + ph}" font-size="9" text-anchor="end" fill="#66717B">−${opt.top || ''}</text>`;
  s += `<text x="${ml}" y="${H - 4}" font-size="9" fill="#66717B">${opt.xl || ''}</text><text x="${W - mr}" y="${H - 4}" font-size="9" text-anchor="end" fill="#66717B">${opt.xr || ''}</text></svg>`;
  return s;
}
function fadeChart(t){
  const yrs = 20, life = Math.min(t.life, t.cyc / Math.max(1, SL.cycles)), W = 360, H = 90, ml = 34, mr = 6, mt = 8, mb = 16, pw = W - ml - mr, ph = H - mt - mb;
  const x = yr => ml + yr / yrs * pw, y = f => mt + ph - (f - .4) / .6 * ph, pts = []; for (let yr = 0; yr <= yrs; yr += .5) pts.push([yr, Math.max(.4, 1 - .2 * yr / life)]);
  let d = ''; pts.forEach(([yr, f], i) => { d += `${i ? 'L' : 'M'}${x(yr).toFixed(1)} ${y(f).toFixed(1)} `; });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block"><line x1="${ml}" y1="${y(.8)}" x2="${W - mr}" y2="${y(.8)}" stroke="#D9822B" stroke-dasharray="3 3"/><text x="${ml + 4}" y="${y(.8) - 3}" font-size="9" fill="#D9822B">80 % end of life · year ${fmt(life)}</text>
    <path d="${d}L${x(yrs)} ${y(.4)} L${x(0)} ${y(.4)} Z" fill="${t.c}" opacity=".15"/><path d="${d}" fill="none" stroke="${t.c}" stroke-width="1.8"/>
    <text x="${ml - 4}" y="${mt + 4}" font-size="9" text-anchor="end" fill="#66717B">100%</text><text x="${ml - 4}" y="${mt + ph}" font-size="9" text-anchor="end" fill="#66717B">40%</text><text x="${ml}" y="${H - 4}" font-size="9" fill="#66717B">0</text><text x="${W - mr}" y="${H - 4}" font-size="9" text-anchor="end" fill="#66717B">${yrs} yr</text></svg>`;
}
/* ---- the view */
async function openStorageLab(idx, scn, ci){
  SL.idx = idx; const p = PLANT[idx]; if (!p) return;
  const scns = scnsForPlant(idx); SL.scn = scn || (typeof curScn !== 'undefined' && curScn && curScn.plant === idx ? curScn : scns[0]); if (!SL.scn) return;
  const rows = cappedRows(SL.scn), withBat = rows.filter(r => (r.p_b || 0) > 0.5);
  SL.row = (ci != null ? rows.find(r => Math.abs(r.target - ci) < 1e-6) : null) || (typeof curCItarget !== 'undefined' && curCItarget != null && SL.scn === curScn ? rows.find(r => Math.abs(r.target - curCItarget) < 1e-6) : null)
        || (withBat.length ? withBat[withBat.length - 1] : null) || rows[lowestCostIdx(rows)] || rows[0];   // by default the cheapest run that builds a battery
  show('storageView'); document.body.classList.add('lab-mode');
  const hci = hourlyCIfor(SL.scn, SL.row.target), key = hci == null ? null : SL.scn.plant + '_' + scnPathwayLabel(SL.scn) + '_CI' + hci; SL.rec = key ? DATA.hourlyByCI[key] : null;
  if (key && !SL.rec) ensureHourly(SL.scn, hci).then(r => { if (SL.idx === idx) { SL.rec = r; labDefaults(); renderLab(); } });
  labDefaults(); renderLab();
  if (!__sl3d) { const mod = await import('./storage3d.js'); const cv = document.getElementById('labCanvas'); if (cv && !__sl3d) __sl3d = mod.mountStorageScene(cv); }
  if (__sl3d) __sl3d.setTech(techOf(SL.tech).model);
  if (typeof syncURL === 'function') syncURL();
}
function labDefaults(){
  const r = SL.row, rec = SL.rec; SL.dur = 4; SL.rate = r.interest || 0.08; SL.capexMult = 1;
  if (rec && rec.b && rec.bd) { let out = 0, sum = 0, n = 0; for (let t = 0; t < rec.b.length; t++) { out += rec.bd[t] || 0; if ((rec.b[t] || 0) > 1e-3 && rec.price) { sum += rec.price[t]; n++; } } SL.cycles = (r.p_b || 0) * 4 > 1 ? Math.max(10, Math.round(out / ((r.p_b || 0) * 4))) : 250; SL.price = n ? Math.max(0, Math.round(sum / n)) : 40; }
  else { SL.cycles = 250; SL.price = 40; }
}
function labSet(k, v){ SL[k] = ['cat', 'tech', 'swing', 'view'].includes(k) ? v : +v; if (k === 'cat') { const first = STORAGE_TECH.find(t => t.cat === v && t.main) || STORAGE_TECH.find(t => t.cat === v); SL.tech = first.k; } if (k === 'tech') SL.cat = techOf(v).cat; renderLab(); if (__sl3d) { __sl3d.setTech(techOf(SL.tech).model); if (k === 'view') __sl3d.view(v); } if (typeof syncURL === 'function') syncURL(); }
function closeStorageLab(toFacility){ document.body.classList.remove('lab-mode'); if (toFacility) openSite(SL.idx); else openDashboard(SL.idx); }
function renderLab(){
  const host = document.getElementById('storageView'); if (!host || !SL.row) return;
  const p = PLANT[SL.idx], r = SL.row, s = SL.scn, t = techOf(SL.tech), batMWh = (r.p_b || 0) * 4, ctx = { hbMWh: r.p_hb || 0 };
  const F = fitScore(t, ctx), L = lcos(t, SL.dur, SL.cycles, SL.price, SL.rate, SL.capexMult), E = batMWh > 1 ? batMWh : SL.dur * 10, capexPlant = L.capex * E, tpy = (p.tpd || 0) * 365;
  const annTech = crf(SL.rate, L.life) * capexPlant / Math.max(1, tpy), dLCOA = batMWh > 1 ? annTech - (r.capex_b || 0) : null;
  const pat = patternSeries(SL.rec, SL.swing);
  const techsInCat = STORAGE_TECH.filter(x => x.cat === SL.cat), mains = techsInCat.filter(x => x.main), cousins = techsInCat.filter(x => !x.main);
  const chip = x => `<button class="lab-chip ${x.k === SL.tech ? 'active' : ''}" onclick="labSet('tech','${x.k}')"><small>${x.fam}</small><b>${x.n}</b><i style="background:${x.c}"></i></button>`;
  const cousin = x => `<button class="lab-cousin ${x.k === SL.tech ? 'active' : ''}" onclick="labSet('tech','${x.k}')">${x.n}<small>TRL ${x.trl}</small></button>`;
  const fact = (l, v, u) => `<div class="lab-fact"><div class="l">${l}</div><div class="v">${v}<small> ${u}</small></div></div>`;
  const slider = (label, k, lo, hi, st, v, u, show) => `<label class="fin-f" style="grid-template-columns:1fr 64px"><span class="fin-l">${label}<small>${u}</small></span><input type="range" min="${lo}" max="${hi}" step="${st}" value="${v}" oninput="labSet('${k}',this.value)"><span class="fin-n">${show != null ? show : v}</span></label>`;
  const alts = STORAGE_TECH.filter(x => !x.heatOnly && suited(x, SL.dur)).map(x => ({ x, v: lcos(x, SL.dur, SL.cycles, SL.price, SL.rate).total })).sort((a, b) => a.v - b.v).slice(0, 6);
  if (!document.getElementById('labCanvas')) host.innerHTML = `<div class="lab-head" id="labHead"></div><div class="lab-cats" id="labCats"></div><div class="lab-chips" id="labChips"></div><div class="lab-stage"><canvas id="labCanvas"></canvas><div class="lab-stage-ctl"><button class="btn ghost sm" onclick="labSet('view','persp')">3D</button><button class="btn ghost sm" onclick="labSet('view','top')">Top</button></div></div><aside class="lab-left panel" id="labLeft"></aside><aside class="lab-right" id="labRight"></aside>`;
  document.getElementById('labHead').innerHTML = `<div class="lab-brand"><div class="lab-logo">H</div><div><b>HOPS · Energy Storage Lab</b><small>${p.name} · ${scnShortName(s)} · CI ${r.target.toFixed(2)} · <span class="lab-ind">technology values indicative</span></small></div></div>
    <span style="display:flex;gap:6px"><button class="btn ghost sm" onclick="closeStorageLab(true)">← Back to facility</button><button class="btn ghost sm" onclick="closeStorageLab(false)">Results →</button></span>`;
  document.getElementById('labCats').innerHTML = `${Object.entries(STORAGE_CATS).map(([k, n]) => `<button class="lab-cat ${k === SL.cat ? 'active' : ''}" onclick="labSet('cat','${k}')"><i style="background:${(STORAGE_TECH.find(x => x.cat === k && x.main) || {}).c}"></i>${n}</button>`).join('')}`;
  document.getElementById('labChips').innerHTML = `${mains.map(chip).join('')}${cousins.length ? `<span class="lab-sep">deep cousins</span>${cousins.map(cousin).join('')}` : ''}`;
  document.getElementById('labLeft').innerHTML = `
    <div class="lab-tags"><span>${STORAGE_CATS[t.cat]}</span><span>${t.fam}</span>${(t.k === 'lfp' && batMWh > 1) || (t.k === 'heat' && (r.p_hb || 0) > 1) ? '<span class="on">● in this run</span>' : ''}</div>
    <h2>${t.long}</h2><p class="sub">${t.d}</p>
    <div class="lab-fit"><div class="l">Fit for this plant</div><div class="score"><b>${F.score}</b><small>/100</small></div><div class="bar"><i style="width:${F.score}%"></i></div>
      <div class="sub">duration ${Math.round(F.parts.duration)}/40 · lifetime ${Math.round(F.parts.life)}/20 · cost rank ${Math.round(F.parts.cost)}/30 · maturity ${Math.round(F.parts.trl)}/10</div></div>
    <div class="fp-h" style="margin-top:12px">Key facts <span class="lab-ind">indicative</span></div>
    <div class="lab-facts">${fact('Round-trip', fmt(t.rte * 100), '%')}${fact('Energy density', fmt(t.whkg), 'Wh/kg')}${fact('Cycle life', t.cyc >= 1e8 ? '∞' : fmt(t.cyc), 'cycles')}${fact('Calendar life', t.life, 'yr')}${fact('CAPEX', fmt(t.capex_e * SL.capexMult), '$/kWh')}${fact('LCOS here', fmt(L.total), '$/MWh')}</div>
    <div class="fp-h" style="margin-top:12px">Applicability · this plant</div>
    <div class="lab-row"><span>Duration vs plant (${fmt(SL.dur, 1)} h)</span><b class="${F.durLabel === 'Good' ? 'ok' : F.durLabel === 'Stretch' ? 'mid' : 'bad'}">${F.durLabel}</b></div>
    <div class="lab-row"><span>Lifetime at ${fmt(SL.cycles)} cycles/yr</span><b class="${F.parts.life >= 18 ? 'ok' : F.parts.life >= 10 ? 'mid' : 'bad'}">${F.lifeLabel}</b></div>
    <div class="lab-row"><span>Process-heat match</span><b class="${t.heatOnly ? 'ok' : ''}">${F.heat}</b></div>
    <div class="lab-row"><span>Maturity (TRL ${t.trl})</span><b class="${t.trl >= 8 ? 'ok' : t.trl >= 6 ? 'mid' : 'bad'}">${t.trl >= 9 ? 'commercial' : t.trl >= 7 ? 'early commercial' : t.trl >= 5 ? 'demonstration' : 'lab'}</b></div>
    <div class="fp-h" style="margin-top:12px">Assumptions</div>
    ${slider('Duration', 'dur', 0.25, 200, 0.25, SL.dur, 'h at rated power', fmt(SL.dur, 1))}${slider('Cycles per year', 'cycles', 10, 1000, 5, SL.cycles, 'full cycles')}${slider('Charging price', 'price', 0, 150, 1, SL.price, '$/MWh')}${slider('CAPEX multiplier', 'capexMult', 0.5, 2, 0.05, SL.capexMult, '× indicative', SL.capexMult.toFixed(2))}${slider('Discount rate', 'rate', 0.03, 0.15, 0.005, SL.rate, '–', (SL.rate * 100).toFixed(1) + ' %')}
    <div class="sub" style="font-size:10.5px">Duty defaults from this run: ${SL.rec && SL.rec.b ? 'cycles and charging price from the battery\'s own hourly dispatch' : 'generic (no hourly dispatch loaded)'}; the discount rate is the model's. Technology parameters are indicative 2025 literature values (Lazard LCOS v9, NREL ATB 2024, IEA) — the only indicative numbers in the tool.</div>`;
  document.getElementById('labRight').innerHTML = `
    <div class="panel lab-card"><div class="lab-ch">Charge / discharge <span class="${pat.live ? 'on' : ''}">${pat.live ? '● live · this run' : 'pattern'}</span></div>
      ${miniChart(pat.p, { signed: true, c1: '#1B6F8E', c2: '#D9822B', top: pat.live ? fmt(Math.max(...pat.p.map(Math.abs))) + ' MW' : '+1', xl: '0', xr: pat.hours >= 24 * 300 ? '1 year' : pat.hours >= 100 ? fmt(pat.hours / 24) + ' days' : fmt(pat.hours) + ' h' })}
      <div class="legend-mini"><span><i style="background:#1B6F8E"></i>Charging (+)</span><span><i style="background:#D9822B"></i>Discharging (−)</span></div>
      <div class="lab-ch" style="margin-top:8px">State of charge</div>${miniChart(pat.soc, { c1: t.c, top: pat.live ? fmt(batMWh) + ' MWh' : '100 %', xl: '0', xr: pat.hours >= 24 * 300 ? '1 year' : pat.hours >= 100 ? fmt(pat.hours / 24) + ' days' : fmt(pat.hours) + ' h' })}
      <div class="lab-ch" style="margin-top:8px">Plant demand swing <span>${SL.swing === 'spiky' ? 'sub-hourly ripple' : SL.swing === 'intraday' ? 'intraday (2–8 h)' : SL.swing === 'multiday' ? 'multi-day (1–5 d)' : 'seasonal'}</span></div>
      <div class="ci-bar" style="margin:4px 0 0">${[['spiky', 'Spiky'], ['intraday', 'Intraday'], ['multiday', 'Multi-day'], ['seasonal', 'Seasonal']].map(([k, n]) => `<button class="ci-pill sm ${SL.swing === k ? 'active' : ''}" onclick="labSet('swing','${k}')">${n}</button>`).join('')}</div>
      <div class="sub" style="font-size:10.5px;margin-top:4px">${pat.live ? 'The battery\'s two busiest days of actual dispatch (from ' + pat.when + '). Other swings show the shape of duty that technology class is built for.' : 'Illustrative pattern for this swing; "Intraday" shows the run\'s real dispatch where the plant has a battery.'}</div></div>
    <div class="panel lab-card"><div class="lab-ch">Degradation · capacity fade <span class="lab-ind">indicative</span></div>${fadeChart(t)}<div class="sub" style="font-size:10.5px">Linear fade to 80 % at the shorter of calendar life and cycle life ÷ ${fmt(SL.cycles)} cycles/yr.</div></div>
    <div class="panel lab-card"><div class="lab-ch">System effect · vs this run</div>
      <div class="lab-facts"><div class="lab-fact"><div class="l">Storage CAPEX</div><div class="v">$${fmt(capexPlant / 1e6)}<small> M</small></div><div class="d">${fmt(E)} MWh · ${fmt(E / SL.dur)} MW of ${t.n}</div></div>
        <div class="lab-fact"><div class="l">Plant LCOA</div><div class="v">${fmt(r.lcoa)}<small> $/t</small></div><div class="d">${dLCOA != null ? (dLCOA >= 0 ? '+' : '−') + fmt(Math.abs(dLCOA), 1) + ' $/t if this replaced the run\'s battery' : 'run builds no battery'}</div></div></div>
      <div class="lab-ch" style="margin-top:8px">Cheapest alternatives at this duty <span>LCOS $/MWh</span></div>
      ${alts.map(a => `<div class="lab-row"><span><i class="dot" style="background:${a.x.c}"></i>${a.x.n}</span><b class="mono">${fmt(a.v)}</b></div>`).join('')}
      <div class="sub" style="font-size:10.5px;margin-top:4px">Same duration, cycles, price and rate; only technologies suited to the duration. Everything the optimizer sees is the installed $/MWh in its Assumptions tab.</div></div>`;
}
/* the Storage tab of the dashboard is the launcher + the technology sweep at this run's duty */
function buildStorage(){
  const host = document.getElementById('tab-storage'); if (!host) return;
  const s = curScn, rows = cappedRows(s), r = rows[selectedCIidx(rows)], plant = PLANT[curPlantIdx], batMWh = (r.p_b || 0) * 4;
  host.innerHTML = `<div class="section-t">Energy storage</div><p class="section-d">What this run builds — and a lab to learn every storage technology against this plant's own need: duty, fit, costs, charge pattern, degradation, effect on the plant.</p>
    <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr)">
      <div class="kpi"><div class="l">Li-ion battery</div><div class="v">${fmt(r.p_b)}<small> MW</small></div><div class="d">${fmt(batMWh)} MWh (4 h) · ${fmt(r.capex_b, 1)} $/t NH₃ annualised</div></div>
      <div class="kpi"><div class="l">Hydrogen storage</div><div class="v">${fmt(r.p_st)}<small> t H₂</small></div><div class="d">${fmt(r.p_st * 33.33)} MWh LHV · ${fmt(r.capex_st, 1)} $/t NH₃</div></div>
      <div class="kpi"><div class="l">Heat battery</div><div class="v">${fmt(r.p_hb)}<small> MWh th</small></div><div class="d">${fmt(r.capex_hb, 1)} $/t NH₃</div></div></div>
    <div class="sp-actions" style="margin:8px 0 18px"><button class="btn" onclick="openStorageLab(${curPlantIdx}, curScn, ${r.target})">Open the Energy Storage Lab →</button></div>
    <div class="oc-link"><div><b>Battery cell design: STEER OpenCell</b><span> — Stanford's platform for battery design, cost intelligence and technology roadmapping (Stanford Energy · SLAC).</span></div><span class="oc-btns"><a class="btn sm" href="https://dash.steerproject.org/opencell-beta/" target="_blank" rel="noopener">Open OpenCell →</a><a class="btn ghost sm" href="https://steer.stanford.edu/open-cell" target="_blank" rel="noopener">About</a></span></div>`;
}
function openStorageTab(idx){ openStorageLab(idx); }
