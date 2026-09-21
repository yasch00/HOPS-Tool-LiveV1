/* atlas/lib/griddata.js — one door to the resource data: the per-cell annual metrics of the globe layers (data/grid/*.json,
   built by tools/build_grid_layers.py from the optimizer's own CF grids) and the hourly solar + wind series of any cell
   (object storage, window.HOPS_CF_BASE, per-cell Uint16 files). Used by the globe layers, the build flow, the site inspector
   and — later — the household tool. Everything derived (combined CF at any mix, monthly means, complementarity) is computed
   here from the two hourly series, so a new region only needs its NPZ processed once. */
const GRID = { index: null, regions: {}, cellCache: new Map() };
const GRID_BASE = (window.HOPS_DATA_BASE || '../data/') + 'grid/';
const CF_BASE = window.HOPS_CF_BASE || '';                                   // e.g. https://pub-….r2.dev/cf — empty: hourly series unavailable
const GRID_METRICS = {
  solar:  { n: 'Solar CF',            u: '',  d: 'annual mean capacity factor, fixed-tilt PV (atlite / ERA5 2025)', lo: 0.08, hi: 0.24, show: true, ramp: ['#3b0f4a', '#8c2981', '#de4968', '#fe9f6d', '#fcfdbf'] },
  wind:   { n: 'Wind CF',             u: '',  d: 'annual mean capacity factor, onshore turbine at hub height', lo: 0.12, hi: 0.48, show: true, ramp: ['#0d0887', '#5c01a6', '#9c179e', '#ed7953', '#f0f921'] },
  comb:   { n: 'Combined CF',         u: '',  d: 'mean CF of the variance-minimising wind + solar mix (1 MW total nameplate)', lo: 0.15, hi: 0.4, ramp: ['#0f2a1e', '#1b7f5a', '#4fd39a', '#e4ffef'] },
  comb50: { n: 'Combined CF · 50/50', u: '',  d: 'mean CF at a 1:1 capacity mix', lo: 0.15, hi: 0.4, ramp: ['#0f2a1e', '#1b7f5a', '#4fd39a', '#e4ffef'] },
  share:  { n: 'Optimal PV share',    u: '%', d: 'PV share of capacity that minimises the variance of the combined output', lo: 0, hi: 1, ramp: ['#1f5f8a', '#cfd8dc', '#e6a532'] },
  corr:   { n: 'Complementarity',     u: '',  d: 'hourly correlation wind ↔ solar; more negative = more complementary', lo: -0.4, hi: 0.2, ramp: ['#1b7f5a', '#f4f1ea', '#a6392a'] },
  cv:     { n: 'Variability',         u: '',  d: 'std / mean of the combined hourly output at the optimal mix (lower = smoother)', lo: 0.5, hi: 1.5, ramp: ['#1b7f5a', '#f4f1ea', '#a6392a'] },
  lowh:   { n: 'Low-output hours',    u: '%', d: 'share of hours with combined output below 10 % of nameplate', lo: 0.05, hi: 0.4, ramp: ['#1b7f5a', '#f4f1ea', '#a6392a'] }
};
async function gridIndex(){ if (!GRID.index) { try { GRID.index = await (await fetch(GRID_BASE + 'index.json', { cache: 'no-cache' })).json(); } catch (e) { GRID.index = { regions: [] }; } } return GRID.index; }
async function gridRegion(name){ if (!GRID.regions[name]) GRID.regions[name] = await (await fetch(`${GRID_BASE}${name}.json`)).json(); return GRID.regions[name]; }
function gridRegionFor(lat, lon){ const ix = GRID.index; if (!ix) return null; const r = ix.regions.find(r => lat >= r.lat[0] - 0.13 && lat <= r.lat[1] + 0.13 && lon >= r.lon[0] - 0.13 && lon <= r.lon[1] + 0.13); return r ? r.region : null; }
function nearestIdx(arr, v){ let b = 0, bd = Infinity; for (let i = 0; i < arr.length; i++) { const d = Math.abs(arr[i] - v); if (d < bd) { bd = d; b = i; } } return b; }
/* the cell containing a point: { region, i, j, lat, lon, m: {solar, wind, comb, …} } or null outside the grids / over sea */
async function gridCellAt(lat, lon){
  await gridIndex(); const name = gridRegionFor(lat, lon); if (!name) return null;
  const R = await gridRegion(name), i = nearestIdx(R.lats, lat), j = nearestIdx(R.lons, lon), k = i * R.nlon + j;
  if (R.metrics.solar[k] == null) return null;
  const m = {}; Object.keys(R.metrics).forEach(key => { m[key] = R.metrics[key][k]; });
  return { region: name, i, j, lat: R.lats[i], lon: R.lons[j], dlat: R.dlat, dlon: R.dlon, m };
}
/* hourly series of a cell from object storage: { solar: Float32Array(8760), wind: Float32Array(8760) } — null when not configured */
async function cfSeries(cell){
  if (!CF_BASE || !cell) return null;
  const key = `${cell.region}/${cell.i}_${cell.j}`; if (GRID.cellCache.has(key)) return GRID.cellCache.get(key);
  const r = await fetch(`${CF_BASE}/${key}.u16.gz`); if (!r.ok) return null;
  const buf = await r.arrayBuffer(), u8 = new Uint8Array(buf);
  const raw = (u8[0] === 0x1f && u8[1] === 0x8b) ? await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer() : buf;
  const u16 = new Uint16Array(raw), n = u16.length / 2, solar = new Float32Array(n), wind = new Float32Array(n);
  for (let t = 0; t < n; t++) { solar[t] = u16[t] / 10000; wind[t] = u16[n + t] / 10000; }
  const out = { solar, wind }; GRID.cellCache.set(key, out); return out;
}
/* derived quantities — the same definitions as tools/build_grid_layers.py */
function combineSeries(solar, wind, share){ const n = solar.length, c = new Float32Array(n); for (let t = 0; t < n; t++) c[t] = share * solar[t] + (1 - share) * wind[t]; return c; }
function optShare(solar, wind){ const n = solar.length; let mp = 0, mw = 0; for (let t = 0; t < n; t++) { mp += solar[t]; mw += wind[t]; } mp /= n; mw /= n;
  let vp = 0, vw = 0, cov = 0; for (let t = 0; t < n; t++) { const a = solar[t] - mp, b = wind[t] - mw; vp += a * a; vw += b * b; cov += a * b; } vp /= n; vw /= n; cov /= n;
  const den = vp + vw - 2 * cov; return { share: den > 1e-9 ? Math.min(1, Math.max(0, (vw - cov) / den)) : 0.5, corr: cov / Math.sqrt(vp * vw), mean: { solar: mp, wind: mw } }; }
const MONTH_H = [744, 672, 744, 720, 744, 720, 744, 744, 720, 744, 720, 744];
function seriesStats(a){ const n = a.length; let s = 0, s2 = 0, low = 0; for (let t = 0; t < n; t++) { s += a[t]; s2 += a[t] * a[t]; if (a[t] < 0.1) low++; } const mean = s / n, sd = Math.sqrt(Math.max(0, s2 / n - mean * mean));
  const monthly = []; let t0 = 0; for (const h of MONTH_H) { let m = 0; for (let t = t0; t < t0 + h && t < n; t++) m += a[t]; monthly.push(m / h); t0 += h; }
  const diurnal = new Array(24).fill(0); for (let t = 0; t < n; t++) diurnal[t % 24] += a[t] / (n / 24);
  return { mean, sd, cv: mean ? sd / mean : null, lowh: low / n, monthly, diurnal, fullLoadHours: mean * 8760 }; }
/* colour for a metric value (globe layers + inspector chips) */
function gridColor(metric, v){ const M = GRID_METRICS[metric]; if (v == null) return 'rgba(0,0,0,0)'; const x = Math.min(1, Math.max(0, (v - M.lo) / (M.hi - M.lo))), st = M.ramp, p = x * (st.length - 1), k = Math.min(st.length - 2, Math.floor(p)), f = p - k;
  const c = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)], a = c(st[k]), b = c(st[k + 1]); return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * f)).join(',')})`; }
function gridFmt(metric, v){ if (v == null) return '—'; const M = GRID_METRICS[metric]; return M.u === '%' ? (v * 100).toFixed(0) + ' %' : v.toFixed(metric === 'corr' || metric === 'cv' ? 2 : 3); }
