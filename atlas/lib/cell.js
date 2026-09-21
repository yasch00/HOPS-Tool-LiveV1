/* atlas/lib/cell.js — the Li-ion cell lab, shared by the public Storage page and the tool's Storage tab.
   A bottom-up cell model: chemistry + format + electrode design → electrode stack → capacity, energy, Wh/kg, Wh/L, mass,
   materials bill — scaled to a battery of a given MWh. renderCellLab(host, ctx) renders into `host`;
   ctx = { batMWh, plantName, ci, capex_b (annualised $/t NH₃, optional), pMW }. Constants are on screen as assumptions. */
const cfmt = (v, d = 0) => v == null || !isFinite(v) ? '—' : (+v).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
/* ---------------------------------------------------------------- 3 · cell lab: a bottom-up Li-ion cell */
const CHEM = {   // active-material properties: specific capacity (mAh/g), nominal voltage vs graphite (V), crystal density (g/cm³), material cost ($/kg, 2025 order of magnitude)
  NMC811: { n: 'NMC 811', q: 200, v: 3.65, rho: 4.75, cost: 24, note: 'LiNi₀.₈Mn₀.₁Co₀.₁O₂' },
  NMC622: { n: 'NMC 622', q: 180, v: 3.65, rho: 4.75, cost: 22, note: 'LiNi₀.₆Mn₀.₂Co₀.₂O₂' },
  NCA:    { n: 'NCA', q: 200, v: 3.60, rho: 4.75, cost: 24, note: 'LiNi₀.₈Co₀.₁₅Al₀.₀₅O₂' },
  LFP:    { n: 'LFP', q: 160, v: 3.20, rho: 3.60, cost: 8, note: 'LiFePO₄ — the stationary-storage workhorse' },
  LMFP:   { n: 'LMFP', q: 150, v: 3.90, rho: 3.50, cost: 10, note: 'LiMn₀.₇Fe₀.₃PO₄' }
};
const ANODE = { graphite: { n: 'Graphite', q: 355, rho: 2.24, cost: 8 }, si10: { n: 'Graphite + 10 % SiOₓ', q: 480, rho: 2.15, cost: 14 } };
const FORMAT = {   // outer dimensions (mm), inner allowance, casing mass (g), casing cost ($)
  '21700': { n: '21700 cylindrical', kind: 'cyl', d: 21, h: 70, wall: 0.3, core: 2.0, hMargin: 6, case_g: 6.5, case_usd: 0.35 },
  '4680':  { n: '4680 cylindrical', kind: 'cyl', d: 46, h: 80, wall: 0.5, core: 3.0, hMargin: 7, case_g: 24, case_usd: 0.9 },
  prism:   { n: 'Prismatic (LFP 280 Ah class)', kind: 'flat', L: 174, H: 204, T: 72, wall: 0.8, margin: 8, case_g: 420, case_usd: 3.5 },
  pouch:   { n: 'Pouch (EV class)', kind: 'flat', L: 330, H: 100, T: 12, wall: 0.15, margin: 4, case_g: 14, case_usd: 0.4 }
};
const ASSUMP = { binder: 0.04, cb: 0.02, rhoBinder: 1.4, alFoil_um: 14, cuFoil_um: 8, sep_um: 14, sepPor: 0.42, rhoSep: 0.95, rhoElyte: 1.2, elyteCost: 9, alCost_m2: 0.35, cuCost_m2: 1.4, sepCost_m2: 0.9, otherFrac: 0.12, ctp: 1.32, ctpCost: 1.28 };
const CELL = { chem: 'LFP', anode: 'graphite', format: 'prism', loading: 18, por: 0.30, np: 1.10, anPor: 0.32 };
function cellSet(k, v){ CELL[k] = (k === 'chem' || k === 'anode' || k === 'format') ? v : +v; renderCellLab(); }
function cellModel(){
  const C = CHEM[CELL.chem], A = ANODE[CELL.anode], F = FORMAT[CELL.format], S = ASSUMP;
  const qArea = CELL.loading * 1e-3 * C.q;                                         // mAh/cm² (loading mg/cm² × mAh/g)
  const anLoading = qArea * CELL.np / A.q * 1e3;                                    // mg/cm² of anode active for the N/P ratio
  const compRho = (ma, rhoA) => 1 / ((1 - S.binder - S.cb) / rhoA + (S.binder + S.cb) / S.rhoBinder);   // composite (solid) density
  const catTh = CELL.loading / (1 - S.binder - S.cb) * 1e-3 / (compRho(1, C.rho) * (1 - CELL.por)) * 1e4;   // µm, one side
  const anTh = anLoading / (1 - S.binder - S.cb) * 1e-3 / (compRho(1, A.rho) * (1 - CELL.anPor)) * 1e4;
  const unit = 2 * catTh + S.alFoil_um + 2 * anTh + S.cuFoil_um + 2 * S.sep_um;   // µm, one double-sided repeat unit
  let areaCm2, layers;                                                              // double-sided coated area (both faces), cm²
  if (F.kind === 'cyl') { const R = F.d / 2 - F.wall, r0 = F.core / 2, len = Math.PI * (R * R - r0 * r0) / (unit * 1e-3), h = F.h - F.hMargin; areaCm2 = 2 * len * h / 100; layers = len / (2 * Math.PI * (R + r0) / 2); }
  else { const T = F.T - 2 * F.wall, n = Math.floor(T / (unit * 1e-3)), L = F.L - 2 * F.wall - F.margin, H = F.H - 2 * F.wall - F.margin; areaCm2 = 2 * n * L * H / 100; layers = n; }
  const Ah = areaCm2 * qArea / 1000, V = C.v, Wh = Ah * V;
  const catG = areaCm2 * CELL.loading / (1 - S.binder - S.cb) * 1e-3, anG = areaCm2 * anLoading / (1 - S.binder - S.cb) * 1e-3;
  const foilArea = areaCm2 / 2 / 1e4, alG = foilArea * S.alFoil_um * 1e-6 * 2.7 * 1e6 / 1e0 / 1e3 * 1e3 / 1e3, cuG = foilArea * S.cuFoil_um * 1e-6 * 8.96 * 1e6 / 1e3;   // g
  const alMass = foilArea * (S.alFoil_um * 1e-4) * 2.7 * 1e4, cuMass = foilArea * (S.cuFoil_um * 1e-4) * 8.96 * 1e4;                     // g (area m² → cm² ×1e4)
  const sepMass = (areaCm2 / 2) * 2 * (S.sep_um * 1e-4) * S.rhoSep * (1 - S.sepPor);
  const poreVol = (areaCm2 / 2) * ((2 * catTh * 1e-4) * CELL.por + (2 * anTh * 1e-4) * CELL.anPor + 2 * (S.sep_um * 1e-4) * S.sepPor);   // cm³
  const elyteG = poreVol * S.rhoElyte * 1.05;
  const mass = catG + anG + alMass + cuMass + sepMass + elyteG + F.case_g;
  const vol = F.kind === 'cyl' ? Math.PI * (F.d / 20) ** 2 * F.h / 10 : F.L * F.H * F.T / 1000;                                       // cm³
  const cost = { cathode: catG / 1e3 * C.cost, anode: anG / 1e3 * A.cost, foils: foilArea * (S.alCost_m2 + S.cuCost_m2), separator: foilArea * 2 * S.sepCost_m2, electrolyte: elyteG / 1e3 * S.elyteCost, casing: F.case_usd };
  const matSum = Object.values(cost).reduce((a, b) => a + b, 0), cellCost = matSum * (1 + S.otherFrac);
  return { C, A, F, qArea, anLoading, catTh, anTh, unit, areaCm2, layers, Ah, V, Wh, mass, vol, whkg: Wh / mass * 1000, whl: Wh / vol * 1000, cost, cellCost, usdkwh: cellCost / (Wh / 1000), packUsdkwh: cellCost / (Wh / 1000) * S.ctpCost, packWhkg: Wh / (mass * S.ctp) * 1000, catG, anG, alMass, cuMass, sepMass, elyteG };
}
function stackSVG(m){
  const parts = [['Al foil', ASSUMP.alFoil_um, '#9aa5ad'], ['Cathode', m.catTh, '#1B6F8E'], ['Separator', ASSUMP.sep_um, '#e4e9ec'], ['Anode', m.anTh, '#39444D'], ['Cu foil', ASSUMP.cuFoil_um, '#c8873a'], ['Anode', m.anTh, '#39444D'], ['Separator', ASSUMP.sep_um, '#e4e9ec'], ['Cathode', m.catTh, '#1B6F8E']];
  const tot = parts.reduce((a, p) => a + p[1], 0), W = 560, H = 120, ml = 8, pw = W - 16;
  let x = ml, s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="cell stack cross-section">`;
  parts.forEach(([n, t, c]) => { const w = t / tot * pw; s += `<rect x="${x}" y="20" width="${w}" height="60" fill="${c}" stroke="#fff" stroke-width=".8"/>`; if (w > 34) s += `<text x="${x + w / 2}" y="54" text-anchor="middle" font-size="10" fill="${c === '#e4e9ec' || c === '#9aa5ad' ? '#121A20' : '#fff'}">${n}</text><text x="${x + w / 2}" y="98" text-anchor="middle" font-size="10" fill="var(--ink-3)">${t.toFixed(0)} µm</text>`; x += w; });
  s += `<text x="${ml}" y="14" font-size="10.5" fill="var(--ink-3)">one repeat unit of the electrode stack — ${m.unit.toFixed(0)} µm, ${cfmt(m.layers, 0)} ${m.F.kind === 'cyl' ? 'winds' : 'layers'} in the ${m.F.n}</text></svg>`;
  return s;
}
let __cellHost = null, __cellCtx = {};
function renderCellLab(host, ctx){
  if (host) { __cellHost = host; __cellCtx = ctx || {}; } host = __cellHost; if (!host) return; const ctx0 = __cellCtx;
  const m = cellModel(), C = m.C, S = ASSUMP;
  const sel = (id, obj, cur, fn) => `<select class="sel" onchange="cellSet('${fn}',this.value)">${Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${v.n}</option>`).join('')}</select>`;
  const slider = (label, k, lo, hi, st, v, u) => `<label class="cl-f"><span>${label}<small>${u}</small></span><input type="range" min="${lo}" max="${hi}" step="${st}" value="${v}" oninput="cellSet('${k}',this.value)"><b class="mono">${v}</b></label>`;
  const batMWh = ctx0.batMWh || 0, row = batMWh > 1 ? ctx0 : null, cells = batMWh ? batMWh * 1e6 / m.Wh : 0;
  host.innerHTML = `<div class="oc-link"><div><b>Design the cell properly in STEER OpenCell</b><span> — Stanford's platform for battery design, cost intelligence and technology roadmapping (Stanford Energy · SLAC). The lab below is a quick bottom-up look at what sits behind the optimizer's battery number; OpenCell is the full model.</span></div><span style="display:flex;gap:8px;flex:none"><a class="btn sm" href="https://dash.steerproject.org/opencell-beta/" target="_blank" rel="noopener">Open OpenCell →</a><a class="btn ghost sm" href="https://steer.stanford.edu/open-cell" target="_blank" rel="noopener">About</a></span></div><div class="cl-grid">
    <div class="card"><h3>Design</h3>
      <div class="cl-f"><span>Cathode chemistry<small>${C.note}</small></span>${sel('chem', CHEM, CELL.chem, 'chem')}</div>
      <div class="cl-f"><span>Anode</span>${sel('anode', ANODE, CELL.anode, 'anode')}</div>
      <div class="cl-f"><span>Format</span>${sel('format', FORMAT, CELL.format, 'format')}</div>
      ${slider('Cathode areal loading', 'loading', 8, 35, 0.5, CELL.loading, 'mg/cm² per side')}
      ${slider('Cathode porosity', 'por', 0.2, 0.45, 0.01, CELL.por, '–')}
      ${slider('N/P capacity ratio', 'np', 1.0, 1.3, 0.01, CELL.np, '–')}
      ${slider('Anode porosity', 'anPor', 0.22, 0.45, 0.01, CELL.anPor, '–')}
      <p class="small muted" style="margin:var(--s3) 0 0">Fixed: Al ${S.alFoil_um} µm, Cu ${S.cuFoil_um} µm, separator ${S.sep_um} µm (${(S.sepPor * 100).toFixed(0)} % porous), ${((S.binder + S.cb) * 100).toFixed(0)} % binder + carbon, cell-to-pack ×${S.ctp} mass and ×${S.ctpCost} cost.</p></div>
    <div class="card"><h3>The cell</h3>
      <div class="readout" style="border-top-color:var(--rule)"><div><span class="eyebrow">Capacity</span><b>${cfmt(m.Ah, m.Ah < 10 ? 2 : 0)} Ah</b><small>${m.qArea.toFixed(2)} mAh/cm² per side · ${m.V.toFixed(2)} V</small></div><div><span class="eyebrow">Energy</span><b>${cfmt(m.Wh, m.Wh < 50 ? 1 : 0)} Wh</b><small>${cfmt(m.mass)} g · ${cfmt(m.vol)} cm³</small></div>
        <div><span class="eyebrow">Gravimetric</span><b>${cfmt(m.whkg)} Wh/kg</b><small>pack ≈ ${cfmt(m.packWhkg)} Wh/kg</small></div><div><span class="eyebrow">Volumetric</span><b>${cfmt(m.whl)} Wh/L</b><small>cell</small></div></div>
      <div style="margin-top:var(--s4)">${stackSVG(m)}</div>
      <table class="ptable" style="margin-top:var(--s3)"><thead><tr><th>Component</th><th>Mass</th><th>Materials cost</th></tr></thead><tbody>
        ${[['Cathode coating (' + C.n + ')', m.catG, m.cost.cathode], ['Anode coating (' + m.A.n + ')', m.anG, m.cost.anode], ['Al + Cu foils', m.alMass + m.cuMass, m.cost.foils], ['Separator', m.sepMass, m.cost.separator], ['Electrolyte', m.elyteG, m.cost.electrolyte], ['Casing', m.F.case_g, m.cost.casing]].map(([n, g, c]) => `<tr><td class="p-name">${n}</td><td class="p-val">${cfmt(g, 1)} g</td><td class="p-val">$${c.toFixed(2)}</td></tr>`).join('')}
        <tr><td class="p-name"><b>Cell (+${(S.otherFrac * 100).toFixed(0)} % other materials)</b></td><td class="p-val">${cfmt(m.mass, 0)} g</td><td class="p-val"><b>$${m.cellCost.toFixed(2)}</b> · ${cfmt(m.usdkwh)} $/kWh</td></tr></tbody></table>
      <p class="fig-note">Pack-level ≈ ${cfmt(m.packUsdkwh)} $/kWh materials only — before cell manufacturing, BMS, thermal management, power electronics and installation. The optimizer's battery CAPEX (${cfmt(215000 / 1000)}–${cfmt(300000 / 1000)} $/kWh installed, 4 h) includes all of those.</p></div>
    <div class="card"><h3>Scaled to ${ctx0.plantName || 'the plant'}</h3>
      ${row && batMWh > 1 ? `<div class="readout" style="border-top-color:var(--rule)"><div><span class="eyebrow">Battery</span><b>${cfmt(batMWh)} MWh</b><small>${cfmt(ctx0.pMW)} MW · 4 h${ctx0.ci != null ? ' · CI ' + (+ctx0.ci).toFixed(2) : ''}</small></div><div><span class="eyebrow">Cells</span><b>${cfmt(cells / 1e3, cells < 1e4 ? 1 : 0)} k</b><small>${m.F.n}</small></div><div><span class="eyebrow">Cell mass</span><b>${cfmt(cells * m.mass / 1e6)} t</b><small>≈ ${cfmt(cells * m.mass * S.ctp / 1e6)} t as packs</small></div><div><span class="eyebrow">Cathode material</span><b>${cfmt(cells * m.catG / 1e6)} t</b><small>${C.n}</small></div></div>
        <div class="row" style="margin-top:var(--s3)"><span>Cell materials, this design</span><b class="mono">$${cfmt(cells * m.cellCost / 1e6, 1)} M</b></div><div class="row"><span>Pack-level materials</span><b class="mono">$${cfmt(batMWh * 1e3 * m.packUsdkwh / 1e6, 1)} M</b></div><div class="row"><span>Optimizer's installed battery CAPEX (annualised)</span><b class="mono">${ctx0.capex_b != null ? cfmt(ctx0.capex_b, 1) + ' $/t NH₃' : '—'}</b></div>
        <p class="small muted" style="margin-top:var(--s3)">Change the chemistry or loading and the cell count, tonnage and materials bill of this plant's battery follow. The optimizer itself sees only $/MWh installed — this is what sits behind that number.</p>` : `<p class="small muted">The selected run builds no battery; pick another plant or a lower carbon target above.</p>`}</div></div>`;
}

