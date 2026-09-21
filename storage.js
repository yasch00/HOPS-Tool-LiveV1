/* storage.js — the Energy storage page: (1) what the optimizer builds across the fleet (from data/scenarios.json),
   (2) the duty cycle of one plant's storage from its hourly dispatch (data/runs/…), (3) the Li-ion cell lab — a bottom-up
   cell model (electrode loadings → capacity, energy, mass, cost) that scales up to the selected plant's battery.
   Everything numerical is on screen with its assumption; the cell model is documented in ASSUMP below. */
const DATA = 'data/';
const ST = { plants: [], scn: [], plant: 61, ci: 0.5, path: 'SMR', hourly: null };
const fmt = (v, d = 0) => v == null || !isFinite(v) ? '—' : (+v).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
const $ = id => document.getElementById(id);
const OKABE = { d1: '#0072B2', d2: '#D55E00', d3: '#009E73', d4: '#CC79A7', d5: '#E69F00', d6: '#56B4E9' };

/* ---------------------------------------------------------------- data */
async function loadData(){
  const [plants, scn] = await Promise.all([fetch(DATA + 'plants.json', { cache: 'no-cache' }).then(r => r.json()), fetch(DATA + 'scenarios.json', { cache: 'no-cache' }).then(r => r.json())]);
  ST.plants = plants.filter(p => !p.custom).sort((a, b) => a.name.localeCompare(b.name)); ST.plantMap = {}; plants.forEach(p => { ST.plantMap[p.idx] = p; });
  ST.scn = scn.filter(s => s.hb && !s.policy);
}
function rowsAt(ci, ccs){ const out = []; for (const s of ST.scn) { if (s.ccs !== ccs || s.plant >= 1000 || !ST.plantMap[s.plant]) continue; /* modelled fleet only — requested sites have their own panel */ const r = s.rows.find(x => Math.abs(x.target - ci) < 1e-6); if (r) out.push({ plant: ST.plantMap[s.plant], r }); } return out; }
async function loadHourly(idx, path, ci){
  const key = `${idx}/${path}/${ci.toFixed(2)}`; if (ST.hourly && ST.hourly.key === key) return ST.hourly;
  const r = await fetch(`${DATA}runs/plant${idx}/${path.replace('+', '%2B')}/ci${ci.toFixed(2)}.json.gz`); if (!r.ok) return null;
  const buf = await r.arrayBuffer(), u = new Uint8Array(buf);
  const txt = (u[0] === 0x1f && u[1] === 0x8b) ? await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text() : new TextDecoder().decode(buf);
  const d = JSON.parse(txt); ST.hourly = { key, ...d }; return ST.hourly;
}

/* ---------------------------------------------------------------- 1 · fleet: what gets built */
function quantile(a, q){ const s = [...a].sort((x, y) => x - y); if (!s.length) return null; const p = (s.length - 1) * q, i = Math.floor(p); return s[i] + (s[i + 1] - s[i] || 0) * (p - i); }
function stripChart(values, opt){   // horizontal distribution: one tick per plant, median marked
  const W = 560, H = 64, ml = 10, mr = 10, pw = W - ml - mr, max = Math.max(1e-9, ...values) * 1.05;
  const x = v => ml + v / max * pw, med = quantile(values, .5);
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${opt.label}">`;
  s += `<line x1="${ml}" y1="40" x2="${W - mr}" y2="40" stroke="var(--rule-2)"/>`;
  values.forEach(v => { s += `<line x1="${x(v)}" y1="26" x2="${x(v)}" y2="54" stroke="${opt.c}" stroke-opacity=".55" stroke-width="1.6"/>`; });
  if (med != null) s += `<line x1="${x(med)}" y1="18" x2="${x(med)}" y2="62" stroke="var(--ink)" stroke-width="2"/><text x="${x(med) + 5}" y="16" font-size="11" fill="var(--ink)">median ${fmt(med, opt.dec)} ${opt.u}</text>`;
  s += `<text x="${ml}" y="H" font-size="10.5" fill="var(--ink-3)">0</text><text x="${W - mr}" y="${H - 2}" font-size="10.5" fill="var(--ink-3)" text-anchor="end">${fmt(max / 1.05, opt.dec)} ${opt.u}</text>`.replace('y="H"', `y="${H - 2}"`);
  return s + '</svg>';
}
function renderFleet(){
  const ci = +$('fleetCI').value, ccs = $('fleetPath').value === 'SMR+CCS', rows = rowsAt(ci, ccs);
  const bat = rows.map(x => x.r.p_b || 0), h2 = rows.map(x => x.r.p_st || 0), hb = rows.map(x => x.r.p_hb || 0);
  const share = a => (a.filter(v => v > 0.5).length / Math.max(1, a.length) * 100).toFixed(0);
  const perT = (k) => quantile(rows.map(x => x.r[k] || 0), .5);
  $('fleetOut').innerHTML = `
    <div class="readout"><div><span class="eyebrow">Plants at CI ${ci.toFixed(2)}</span><b>${rows.length}</b><small>${ccs ? 'SMR + CCS' : 'SMR'} pathway, base case</small></div>
      <div><span class="eyebrow">Build a battery</span><b>${share(bat)} %</b><small>median ${fmt(quantile(bat, .5))} MW · 4 h</small></div>
      <div><span class="eyebrow">Build H₂ storage</span><b>${share(h2)} %</b><small>median ${fmt(quantile(h2, .5))} t H₂</small></div>
      <div><span class="eyebrow">Build a heat battery</span><b>${share(hb)} %</b><small>median ${fmt(quantile(hb, .5))} MWh th</small></div></div>
    <div class="grid-3" style="margin-top:var(--s5)">
      <div class="card"><h3>Li-ion battery</h3><p class="small muted" style="margin:4px 0 8px">Power (MW), 4 h duration · annualised ${fmt(perT('capex_b'), 1)} $/t NH₃ median</p>${stripChart(bat, { c: OKABE.d6, u: 'MW', dec: 0, label: 'battery power across plants' })}</div>
      <div class="card"><h3>Hydrogen storage</h3><p class="small muted" style="margin:4px 0 8px">Compressed H₂ (t) · ${fmt(perT('capex_st'), 1)} $/t NH₃ median</p>${stripChart(h2, { c: OKABE.d1, u: 't H₂', dec: 0, label: 'hydrogen storage across plants' })}</div>
      <div class="card"><h3>Heat battery</h3><p class="small muted" style="margin:4px 0 8px">Thermal (MWh) · ${fmt(perT('capex_hb'), 1)} $/t NH₃ median</p>${stripChart(hb, { c: OKABE.d4, u: 'MWh', dec: 0, label: 'heat battery across plants' })}</div></div>
    <p class="fig-note" style="margin-top:var(--s3)">Each tick is one plant's optimized capacity at this carbon target; the black bar is the fleet median. Zero means the optimizer did not build that store at that site and target.</p>`;
}

/* ---------------------------------------------------------------- 2 · one plant's duty cycle */
function cycleStats(chg, dis, soc, capEnergy){
  const n = chg.length; let ech = 0, edis = 0, hAct = 0, socSum = 0, socMax = 0, full = 0;
  for (let t = 0; t < n; t++) { const c = chg[t] || 0, d = dis[t] || 0, s = soc[t] || 0; ech += c; edis += d; if (c > 1e-3 || d > 1e-3) hAct++; socSum += s; if (s > socMax) socMax = s; if (capEnergy && s > 0.98 * capEnergy) full++; }
  const cap = capEnergy || socMax || 1;
  return { ech, edis, cycles: edis / cap, active: hAct / n, meanSoc: socSum / n / cap, full: full / n, socMax, eff: ech ? edis / ech : null };
}
function socChart(soc, cap, week, color, unit){
  const t0 = week * 168, a = soc.slice(t0, t0 + 168), W = 560, H = 150, ml = 46, mr = 10, mt = 10, mb = 24, pw = W - ml - mr, ph = H - mt - mb, max = Math.max(cap || 0, ...a) * 1.02 || 1;
  const x = i => ml + i / 167 * pw, y = v => mt + ph - v / max * ph;
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%">`;
  [0, .5, 1].forEach(f => { s += `<line class="grid" x1="${ml}" y1="${y(max * f)}" x2="${W - mr}" y2="${y(max * f)}"/><text x="${ml - 6}" y="${y(max * f) + 4}" text-anchor="end">${fmt(max * f)}</text>`; });
  s += `<path d="${a.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ')} L ${x(167)} ${y(0)} L ${x(0)} ${y(0)} Z" fill="${color}" fill-opacity=".18"/><path d="${a.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ')}" fill="none" stroke="${color}" stroke-width="1.8"/>`;
  for (let d = 0; d < 7; d++) s += `<text x="${x(d * 24 + 12)}" y="${H - 6}" text-anchor="middle">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d]}</text>`;
  s += `<text class="axlabel" transform="translate(12 ${mt + ph / 2}) rotate(-90)" text-anchor="middle">${unit}</text></svg>`;
  return s;
}
async function renderPlant(){
  const idx = +$('plantSel').value, ci = +$('plantCI').value, path = $('plantPath').value, p = ST.plantMap[idx];
  ST.plant = idx; ST.ci = ci; ST.path = path;
  const s = ST.scn.find(x => x.plant === idx && (x.ccs === (path === 'SMR+CCS'))), r = s && s.rows.find(x => Math.abs(x.target - ci) < 1e-6);
  if (!r) { $('plantOut').innerHTML = '<div class="empty"><h3>No solved run</h3><p>This plant has no solution at that target and pathway (no positive return at the NH₃ price).</p></div>'; return; }
  ST.row = r;
  const batMWh = (r.p_b || 0) * 4, week = +$('plantWeek').value;
  $('plantOut').innerHTML = `<div class="readout"><div><span class="eyebrow">Battery</span><b>${fmt(r.p_b)} MW</b><small>${fmt(batMWh)} MWh (4 h)</small></div><div><span class="eyebrow">H₂ storage</span><b>${fmt(r.p_st)} t</b><small>${fmt(r.p_st * 33.33)} MWh LHV</small></div><div><span class="eyebrow">Heat battery</span><b>${fmt(r.p_hb)} MWh</b><small>thermal</small></div><div><span class="eyebrow">LCOA</span><b>${fmt(r.lcoa_lcoe || r.lcoa)} $/t</b><small>basis A · CI ${ci.toFixed(2)}</small></div></div><p class="small muted" style="margin-top:var(--s3)">Loading the hourly dispatch …</p>`;
  const h = await loadHourly(idx, path, ci); if (!h || ST.plant !== idx || ST.ci !== ci) { if (!h) $('plantOut').insertAdjacentHTML('beforeend', '<p class="small muted">No hourly file for this run.</p>'); return; }
  const S = h.series, z = new Array((S.bsoc || S.h2st || S.hbsoc || []).length).fill(0);
  const B = cycleStats(S.b || z, S.bd || z, S.bsoc || z, batMWh), H2 = cycleStats(S.h2chg || z, S.h2dis || z, S.h2st || z, r.p_st), HB = cycleStats(S.hb || z, S.hbd || z, S.hbsoc || z, r.p_hb);
  const card = (title, st, cap, unit, soc, color, note) => `<div class="card"><h3>${title}</h3>
      <div class="row"><span>Equivalent full cycles / yr</span><b class="mono">${fmt(st.cycles, 0)}</b></div><div class="row"><span>Hours active (charging or discharging)</span><b class="mono">${fmt(st.active * 100, 0)} %</b></div>
      <div class="row"><span>Mean state of charge</span><b class="mono">${fmt(st.meanSoc * 100, 0)} %</b></div><div class="row"><span>Hours at ≥ 98 % full</span><b class="mono">${fmt(st.full * 100, 0)} %</b></div>
      <div class="row"><span>Throughput out / yr</span><b class="mono">${fmt(st.edis)} ${unit}</b></div>${st.eff != null && st.ech ? `<div class="row"><span>Out ÷ in (round-trip as modelled)</span><b class="mono">${fmt(st.eff * 100, 0)} %</b></div>` : ''}
      <div style="margin-top:var(--s3)">${socChart(soc, cap, week, color, unit.replace('/yr', '') + ' stored')}</div><p class="fig-note">${note}</p></div>`;
  const kt = c => `<span class="mono">${fmt(c)}</span>`;
  $('plantOut').querySelector('p').outerHTML = `<div class="grid-3" style="margin-top:var(--s5)">
    ${r.p_b > 0.5 ? card('Li-ion battery', B, batMWh, 'MWh', S.bsoc || z, OKABE.d6, `${p.name}, week ${week + 1} of the year. State of charge of a ${fmt(batMWh)} MWh store; the optimizer dispatches it against the plant's own renewables and the grid price.`) : `<div class="card"><h3>Li-ion battery</h3><p class="small muted">Not built at this site and target.</p></div>`}
    ${r.p_st > 0.5 ? card('Hydrogen storage', H2, r.p_st, 't H₂', S.h2st || z, OKABE.d1, 'Hydrogen buffered between electrolysis / reforming and the synthesis loop, which must stay above its minimum load.') : `<div class="card"><h3>Hydrogen storage</h3><p class="small muted">Not built at this site and target.</p></div>`}
    ${r.p_hb > 0.5 ? card('Heat battery', HB, r.p_hb, 'MWh', S.hbsoc || z, OKABE.d4, 'Electric heat stored as process steam for the reformer, charged in cheap or surplus hours.') : `<div class="card"><h3>Heat battery</h3><p class="small muted">Not built at this site and target.</p></div>`}</div>`;
  renderCell();   // the cell lab scales to this battery
}

/* the cell lab lives in atlas/lib/cell.js (shared with the tool) */
function renderCell(){ /* cell design is linked to STEER OpenCell instead of modelled here */ }

/* ---------------------------------------------------------------- boot */
window.addEventListener('load', async () => {
  try { await loadData(); } catch (e) { $('fleetOut').innerHTML = '<div class="empty"><h3>Data unavailable</h3><p>' + e.message + '</p></div>'; return; }
  $('plantSel').innerHTML = ST.plants.map(p => `<option value="${p.idx}" ${p.idx === ST.plant ? 'selected' : ''}>${p.name} · ${p.country}</option>`).join('');
  ['fleetCI', 'fleetPath'].forEach(id => $(id).addEventListener('change', renderFleet));
  ['plantSel', 'plantCI', 'plantPath', 'plantWeek'].forEach(id => $(id).addEventListener('change', renderPlant));
  renderFleet(); renderPlant(); renderCell();
});
