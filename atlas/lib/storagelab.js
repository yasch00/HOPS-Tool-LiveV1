/* atlas/lib/storagelab.js — the Storage tab of the results dashboard: (1) this run's three stores and their duty from the hourly
   dispatch, (2) the storage-technology sweep — every alternative priced (LCOS) at the duty this plant actually needs, and across
   durations, (3) the zoom into the Li-ion cell (atlas/lib/cell.js). Technology parameters are indicative 2025 values
   (Lazard LCOS v9, NREL ATB 2024, IEA) and are all on screen as assumptions. */
const STORAGE_TECH = [   // capex_e $/kWh (energy), capex_p $/kW (power), rte round-trip, life yr, cyc cycle life, om %/yr of capex, dur [min,max] h, whl Wh/L (system), trl, kind
  { k: 'lfp',  n: 'Li-ion · LFP',            capex_e: 200, capex_p: 150,  rte: .88, life: 15, cyc: 6000,   om: .02,  dur: [1, 8],     whl: 150, trl: 9, kind: 'electrochemical', c: '#56B4E9' },
  { k: 'nmc',  n: 'Li-ion · NMC',            capex_e: 230, capex_p: 150,  rte: .90, life: 12, cyc: 3500,   om: .02,  dur: [0.5, 6],   whl: 220, trl: 9, kind: 'electrochemical', c: '#0072B2' },
  { k: 'naion', n: 'Sodium-ion',             capex_e: 210, capex_p: 150,  rte: .85, life: 12, cyc: 4000,   om: .02,  dur: [1, 8],     whl: 100, trl: 8, kind: 'electrochemical', c: '#1B6F8E' },
  { k: 'vrfb', n: 'Vanadium flow',           capex_e: 350, capex_p: 900,  rte: .72, life: 25, cyc: 15000,  om: .025, dur: [4, 12],    whl: 25,  trl: 8, kind: 'electrochemical', c: '#CC79A7' },
  { k: 'feair', n: 'Iron-air',               capex_e: 25,  capex_p: 1400, rte: .45, life: 20, cyc: 3000,   om: .02,  dur: [50, 150],  whl: 30,  trl: 6, kind: 'electrochemical', c: '#8C6D1F' },
  { k: 'phs',  n: 'Pumped hydro',            capex_e: 80,  capex_p: 1800, rte: .78, life: 60, cyc: 1e9,    om: .015, dur: [6, 24],    whl: 1,   trl: 9, kind: 'mechanical', c: '#009E73' },
  { k: 'caes', n: 'Compressed air (adiabatic)', capex_e: 60, capex_p: 1300, rte: .62, life: 35, cyc: 10000, om: .02, dur: [6, 24],    whl: 6,   trl: 7, kind: 'mechanical', c: '#4C5B6E' },
  { k: 'laes', n: 'Liquid air',              capex_e: 70,  capex_p: 1500, rte: .55, life: 30, cyc: 10000,  om: .02,  dur: [8, 24],    whl: 60,  trl: 7, kind: 'mechanical', c: '#6B7379' },
  { k: 'fly',  n: 'Flywheel',                capex_e: 3000, capex_p: 400, rte: .88, life: 20, cyc: 1e5,    om: .02,  dur: [0.05, 0.5], whl: 20, trl: 9, kind: 'mechanical', c: '#8A8F94' },
  { k: 'h2',   n: 'Hydrogen (electrolyser · tank · reconversion)', capex_e: 15, capex_p: 2200, rte: .35, life: 25, cyc: 1e9, om: .03, dur: [24, 1000], whl: 0.6, trl: 7, kind: 'chemical', c: '#E69F00' },
  { k: 'heat', n: 'Heat battery (electric → process heat)', capex_e: 25, capex_p: 250, rte: .95, life: 30, cyc: 20000, om: .01, dur: [4, 48], whl: 200, trl: 8, kind: 'thermal', heatOnly: true, c: '#D55E00' },
  { k: 'scap', n: 'Supercapacitor',          capex_e: 5000, capex_p: 200, rte: .95, life: 15, cyc: 1e6,    om: .01,  dur: [0.003, 0.05], whl: 10, trl: 9, kind: 'electrochemical', c: '#A6392A' }
];
const SL = { dur: 4, cycles: 250, price: 40, rate: 0.08, tech: 'lfp' };
function crf(r, n){ return r === 0 ? 1 / n : r / (1 - Math.pow(1 + r, -n)); }
/* levelised cost of storage, $/MWh discharged, for a store of E MWh (duration h × power) cycling `cycles` times a year */
function lcos(t, dur, cycles, price, rate){
  const E = 1, P = 1 / dur;                                                     // per MWh of energy capacity
  const life = Math.min(t.life, t.cyc / Math.max(1, cycles)), capex = t.capex_e * 1000 * E + t.capex_p * 1000 * P;
  const annual = crf(rate, life) * capex + t.om * capex, out = E * cycles, charge = out / t.rte * price, losses = (out / t.rte - out) * price;
  return { capital: annual / out, om: 0, charging: charge / out, losses: losses / out, total: (annual + charge) / out, life, capex };
}
function slSet(k, v){ SL[k] = k === 'tech' ? v : +v; buildStorage(true); }
function suited(t, dur){ return dur >= t.dur[0] * 0.8 && dur <= t.dur[1] * 1.25; }
function lcosBars(rows){
  const W = 880, H = 26 * rows.length + 40, ml = 250, mr = 90, pw = W - ml - mr, max = Math.max(...rows.map(r => r.v.total)) * 1.05, nz = niceScale(0, max, 5);
  const x = v => ml + v / nz.max * pw; let s = svgEl(W, H);
  nz.ticks.forEach(v => { s += `<line class="gridline" x1="${x(v)}" y1="8" x2="${x(v)}" y2="${H - 28}"/><text class="axis" x="${x(v)}" y="${H - 12}" text-anchor="middle">${axisFmt(v, nz.step)}</text>`; });
  rows.forEach((r, i) => { const y = 12 + i * 26, w1 = x(r.v.capital) - ml, w2 = x(r.v.charging) - ml;
    s += `<text class="axis" x="${ml - 8}" y="${y + 13}" text-anchor="end" fill="${r.ok ? C.ink : C.mut}">${r.t.n}${r.t.heatOnly ? ' †' : ''}</text>`;
    s += `<rect x="${ml}" y="${y}" width="${w1}" height="18" fill="${r.t.c}" opacity="${r.ok ? .95 : .3}"/><rect x="${ml + w1}" y="${y}" width="${w2}" height="18" fill="${r.t.c}" opacity="${r.ok ? .45 : .15}"/>`;
    s += `<text class="axis" x="${x(r.v.total) + 6}" y="${y + 13}" fill="${r.ok ? C.ink : C.mut}">${fmt(r.v.total)}${r.ok ? '' : ' · outside its duration range'}</text>`; });
  return s + `<text class="axis" x="${ml + pw / 2}" y="${H - 1}" text-anchor="middle" fill="${C.mut}">$ / MWh discharged — solid: capital + O&amp;M · light: charging electricity incl. losses</text></svg>`;
}
function lcosSweep(techs, mark){
  const W = 880, H = 320, ml = 64, mr = 16, mt = 14, mb = 44, pw = W - ml - mr, ph = H - mt - mb, durs = [];
  for (let d = 0.1; d <= 500; d *= 1.15) durs.push(d);
  const series = techs.map(t => ({ t, pts: durs.map(d => [d, lcos(t, d, SL.cycles, SL.price, SL.rate).total]) }));
  const allY = series.flatMap(s => s.pts.map(p => p[1]).filter(v => v < 2000)), nz = niceScale(0, Math.min(2000, Math.max(...allY)) * 1.02, 5);
  const x = d => ml + (Math.log10(d) - Math.log10(0.1)) / (Math.log10(500) - Math.log10(0.1)) * pw, y = v => mt + ph - Math.min(v, nz.max) / nz.max * ph;
  let s = svgEl(W, H);
  nz.ticks.forEach(v => { s += `<line class="gridline" x1="${ml}" y1="${y(v)}" x2="${W - mr}" y2="${y(v)}"/><text class="axis" x="${ml - 7}" y="${y(v) + 3}" text-anchor="end">${axisFmt(v, nz.step)}</text>`; });
  [0.1, 0.3, 1, 3, 10, 30, 100, 300].forEach(d => { s += `<line class="gridline" x1="${x(d)}" y1="${mt}" x2="${x(d)}" y2="${mt + ph}" opacity=".35"/><text class="axis" x="${x(d)}" y="${H - mb + 15}" text-anchor="middle">${d} h</text>`; });
  series.forEach(sr => { let d = '', pen = false; sr.pts.forEach(([dd, v]) => { const ok = suited(sr.t, dd); if (ok && v <= nz.max) { d += (pen ? 'L' : 'M') + x(dd).toFixed(1) + ' ' + y(v).toFixed(1) + ' '; pen = true; } else pen = false; });
    s += `<path d="${d}" fill="none" stroke="${sr.t.c}" stroke-width="${sr.t.k === SL.tech ? 3 : 1.8}" opacity="${sr.t.k === SL.tech ? 1 : .8}"><title>${sr.t.n}</title></path>`; });
  if (mark) s += `<line x1="${x(mark)}" y1="${mt}" x2="${x(mark)}" y2="${mt + ph}" stroke="${C.ink}" stroke-dasharray="4 3"/><text class="axis" x="${x(mark) + 4}" y="${mt + 12}" fill="${C.ink}">this plant · ${fmt(mark, 1)} h</text>`;
  s += `<text class="axis" x="${ml + pw / 2}" y="${H - 6}" text-anchor="middle" fill="${C.mut}">storage duration (hours at rated power, log scale) — each line drawn only over the technology's suitable range</text>`;
  s += `<text class="axis" transform="translate(14 ${mt + ph / 2}) rotate(-90)" text-anchor="middle" fill="${C.mut}">LCOS $ / MWh</text>`;
  return s + '</svg>';
}
function dutyOf(rec, chgK, disK, socK, cap){ if (!rec || !rec[chgK]) return null; const n = rec[chgK].length; let ech = 0, edis = 0, act = 0, soc = 0; for (let t = 0; t < n; t++) { ech += rec[chgK][t] || 0; edis += rec[disK][t] || 0; if ((rec[chgK][t] || 0) > 1e-3 || (rec[disK][t] || 0) > 1e-3) act++; soc += rec[socK] ? (rec[socK][t] || 0) : 0; }
  return { cycles: cap ? edis / cap : null, active: act / n, meanSoc: cap ? soc / n / cap : null, out: edis, eff: ech ? edis / ech : null }; }
function buildStorage(keepDuty){
  const host = document.getElementById('tab-storage'); if (!host) return;
  const s = curScn, rows = cappedRows(s), r = rows[selectedCIidx(rows)], plant = PLANT[curPlantIdx], hci = hourlyCIfor(s, curCItarget), key = hci == null ? null : s.plant + '_' + scnPathwayLabel(s) + '_CI' + hci, rec = key ? DATA.hourlyByCI[key] : null;
  if (key && !rec) ensureHourly(s, hci).then(() => { if (activeTab === 'storage' && curScn === s) buildStorage(true); });
  const batMWh = (r.p_b || 0) * 4, B = dutyOf(rec, 'b', 'bd', 'bsoc', batMWh), H2 = dutyOf(rec, 'h2chg', 'h2dis', 'h2st', r.p_st), HB = dutyOf(rec, 'hb', 'hbd', 'hbsoc', r.p_hb);
  if (!keepDuty) { SL.dur = r.p_b > 0.5 ? 4 : 4; SL.cycles = B && B.cycles ? Math.round(B.cycles) : 250; SL.rate = r.interest || 0.08; if (rec && rec.price) { let sum = 0, n = 0; for (let t = 0; t < rec.price.length; t++) if ((rec.b && rec.b[t] > 1e-3)) { sum += rec.price[t]; n++; } SL.price = n ? Math.max(0, Math.round(sum / n)) : Math.round(rec.price.reduce((a, b) => a + b, 0) / rec.price.length); } }
  const kpi = (l, v, u, d) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}<small> ${u}</small></div><div class="d">${d}</div></div>`;
  let h = `<div class="section-t">This run's stores</div><p class="section-d">What the optimizer built at ${plant.name} for CI ${r.target.toFixed(2)} (${scnShortName(s)}), and how it uses each store through the year${rec ? '' : ' — loading the hourly dispatch …'}.</p>
    <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr)">
    ${kpi('Li-ion battery', fmt(r.p_b), 'MW', `${fmt(batMWh)} MWh (4 h) · ${fmt(r.capex_b, 1)} $/t NH₃ annualised${B && B.cycles != null ? ' · ' + fmt(B.cycles) + ' full cycles/yr · active ' + fmt(B.active * 100) + ' % of hours' : ''}`)}
    ${kpi('Hydrogen storage', fmt(r.p_st), 't H₂', `${fmt(r.p_st * 33.33)} MWh LHV · ${fmt(r.capex_st, 1)} $/t NH₃${H2 && H2.cycles != null ? ' · ' + fmt(H2.cycles) + ' turnovers/yr · active ' + fmt(H2.active * 100) + ' %' : ''}`)}
    ${kpi('Heat battery', fmt(r.p_hb), 'MWh th', `${fmt(r.capex_hb, 1)} $/t NH₃${HB && HB.cycles != null ? ' · ' + fmt(HB.cycles) + ' full cycles/yr · active ' + fmt(HB.active * 100) + ' %' : ''}`)}</div>
    <p class="foot-note">Battery duration is the model's 4 h; hydrogen is buffered between electrolysis/reforming and the synthesis loop (which must stay above its minimum load); the heat battery stores electric heat as reformer steam. Duty cycles from the hourly dispatch (Hourly ops tab).</p>`;
  // sweep
  const techs = STORAGE_TECH.filter(t => !t.heatOnly), all = STORAGE_TECH.map(t => ({ t, v: lcos(t, SL.dur, SL.cycles, SL.price, SL.rate), ok: suited(t, SL.dur) })).sort((a, b) => (a.ok === b.ok ? a.v.total - b.v.total : a.ok ? -1 : 1));
  const sel = STORAGE_TECH.find(t => t.k === SL.tech), sv = lcos(sel, SL.dur, SL.cycles, SL.price, SL.rate);
  const slider = (label, k, lo, hi, st, v, u, log) => `<label class="fin-f" style="grid-template-columns:1fr 84px"><span class="fin-l">${label}<small>${u}</small></span><input type="range" min="${lo}" max="${hi}" step="${st}" value="${v}" oninput="slSet('${k}',this.value)"><span class="fin-n">${typeof v === 'number' && v < 1 ? v.toFixed(2) : fmt(v, v < 10 ? 1 : 0)}</span></label>`;
  h += `<div class="section-t">Storage alternatives at this duty</div><p class="section-d">Every technology priced for the same job — a store that must deliver <b>${fmt(SL.dur, 1)} h</b> at rated power and cycle <b>${fmt(SL.cycles)}</b> times a year, charged at <b>${fmt(SL.price)} $/MWh</b> — as a levelised cost of storage (LCOS, $ per MWh discharged). Change the duty to see the ranking move: batteries win at hours, mechanical and chemical stores at days.</p>
    <div class="grid2"><div class="card"><div class="card-h"><h3>The duty</h3><span class="note">defaults from this run</span></div>
      ${slider('Duration', 'dur', 0.25, 200, 0.25, SL.dur, 'h at rated power')}${slider('Cycles per year', 'cycles', 10, 1000, 5, SL.cycles, 'full cycles')}${slider('Charging price', 'price', 0, 150, 1, SL.price, '$/MWh')}${slider('Discount rate', 'rate', 0.03, 0.15, 0.005, SL.rate, '–')}
      <div class="sub" style="margin-top:6px">LCOS = (CRF × CAPEX + O&amp;M + charging ÷ round-trip efficiency) ÷ MWh discharged; life = min(calendar life, cycle life ÷ cycles per year). Charging price default: the run's mean wholesale price in the hours the battery charges.</div></div>
    <div class="card"><div class="card-h"><h3>${sel.n}</h3><span class="note">selected technology</span></div>
      <div class="ci-bar" style="margin:0 0 8px;flex-wrap:wrap">${STORAGE_TECH.map(t => `<button class="ci-pill sm ${t.k === SL.tech ? 'active' : ''}" onclick="slSet('tech','${t.k}')">${t.n.split(' (')[0].split(' ·')[0]}${t.n.includes('·') ? ' ' + t.n.split('· ')[1] : ''}</button>`).join('')}</div>
      <div class="kpi-grid" style="grid-template-columns:repeat(2,1fr);margin:0"><div class="kpi"><div class="l">LCOS at this duty</div><div class="v">${fmt(sv.total)}<small> $/MWh</small></div><div class="d">capital ${fmt(sv.capital)} · charging ${fmt(sv.charging)} (of which losses ${fmt(sv.losses)})</div></div>
      <div class="kpi"><div class="l">Sized for this plant</div><div class="v">${fmt(batMWh || SL.dur * 10)}<small> MWh</small></div><div class="d">${fmt(sv.capex * (batMWh || SL.dur * 10) / 1e6, 1)} M$ CAPEX · life ${fmt(sv.life)} yr · ${suited(sel, SL.dur) ? 'suited to this duration' : '<b style="color:var(--rust)">outside its usual ' + sel.dur[0] + '–' + sel.dur[1] + ' h range</b>'}</div></div></div>
      <table class="assump-tbl" style="margin-top:8px"><tr><td class="p">Energy CAPEX</td><td class="v">${fmt(sel.capex_e)}</td><td class="u">$/kWh</td></tr><tr><td class="p">Power CAPEX</td><td class="v">${fmt(sel.capex_p)}</td><td class="u">$/kW</td></tr><tr><td class="p">Round-trip efficiency</td><td class="v">${fmt(sel.rte * 100)}</td><td class="u">%</td></tr><tr><td class="p">Calendar / cycle life</td><td class="v">${sel.life} / ${sel.cyc >= 1e8 ? '∞' : fmt(sel.cyc)}</td><td class="u">yr / cycles</td></tr><tr><td class="p">Typical duration</td><td class="v">${sel.dur[0]}–${sel.dur[1]}</td><td class="u">h</td></tr><tr><td class="p">Energy density (system)</td><td class="v">${sel.whl}</td><td class="u">Wh/L</td></tr><tr><td class="p">Readiness</td><td class="v">TRL ${sel.trl}</td><td class="u">${sel.kind}</td></tr></table></div></div>
    <div class="card"><div class="card-h"><h3>All alternatives at this duty</h3><span class="note">LCOS · $/MWh discharged</span></div>${lcosBars(all)}<p class="foot-note">† delivers heat, not electricity — comparable only for process-heat duty (which is what HOPS uses it for). Greyed technologies are outside their usual duration range at this duty. Indicative 2025 costs (Lazard LCOS v9, NREL ATB 2024, IEA); the optimizer itself uses the region-specific battery and heat-battery CAPEX from the Assumptions tab.</p></div>
    <div class="card"><div class="card-h"><h3>Sweep across durations</h3><span class="note">${fmt(SL.cycles)} cycles/yr · ${fmt(SL.price)} $/MWh</span></div>${legend(techs.map(t => ({ c: t.c, n: t.n.split(' (')[0] })))}${lcosSweep(techs, SL.dur)}</div>`;
  h += `<div class="section-t">Inside the battery</div><p class="section-d">Cell-level design — chemistry, format, electrode loadings, materials and cost — is STEER's domain.</p><div class="oc-link"><div><b>Battery cell design: STEER OpenCell</b><span> — Stanford's platform for battery design, cost intelligence and technology roadmapping (Stanford Energy · SLAC).</span></div><span class="oc-btns"><a class="btn sm" href="https://dash.steerproject.org/opencell-beta/" target="_blank" rel="noopener">Open OpenCell →</a><a class="btn ghost sm" href="https://steer.stanford.edu/open-cell" target="_blank" rel="noopener">About</a></span></div>`;
  host.innerHTML = h;
}
