/* atlas/facility/plant_assembly.js — assembles the Claude-Design plant scene from its own builders, for the map.
   Placement, capacity scaling, pipe routing (Manhattan, obstacle-aware), packet textures, lights and the per-frame
   flow animation are ported from the original page's app section (plantMain lines 1547–2404) and its live-sim module
   (FLOW_MAP / prepData / frame). What is deliberately NOT ported: the page's own camera, OrbitControls, sky dome,
   ground plane, DOM labels and panel — the map supplies terrain, sky, camera and labels. Scene units are the
   original's (the plot is 170 × 110 units); facility.js scales the root to metres. */
import * as THREE from './three.module.js';
import { PALETTE, mat, SUBSYSTEMS } from './plant_builders.js';

export { PALETTE, SUBSYSTEMS, THREE };

/* ---- capacities of a run → which subsystems exist and how big they are (original capForKey / scaleForKey) */
export function capsFromRow(r, plant){
  const g = k => Math.max(0, r[k] || 0), tpy = (plant.tpd || 0) * 365;
  return { pv: g('p_pv'), wt: g('p_wt'), el: g('p_el'), batt: g('p_b'), store: g('p_st') * 1000, smr: g('p_smr'), hb: g('p_hb'),
           imp: g('e_imp'), nh3_mt: tpy / 1e6, capture_rate: g('cap_rate'), co2_cap: g('co2_cap'), ccs: !!r.__ccs,
           cf: { pv: g('e_pv') / Math.max(1, g('p_pv') * 8760), wt: g('e_wt') / Math.max(1, g('p_wt') * 8760), el: g('e_el') / Math.max(1, g('p_el') * 8760) },
           smrH2: g('h2_smr'), row: r };
}
function capForKey(key, C){
  switch (key) {
    case 'solar': return C.pv; case 'wind': return C.wt; case 'electrolyzer': return C.el; case 'battery': return C.batt;
    case 'heat': return C.hb; case 'smr': return C.smr;
    case 'h2tank': return C.store > 0 ? C.store : (C.el > 0 || C.smr > 0 ? 1 : 0);
    case 'ng': return C.smr; case 'grid': return C.imp;
    case 'asu': case 'hb_reactor': case 'hb': case 'nh3': return C.nh3_mt;
    case 'ccs': return (C.ccs && C.capture_rate > 0) ? Math.max(1, C.co2_cap) : 0;
    case 'optimizer': return 1; default: return 1;
  }
}
function scaleForKey(key, C){
  const cap = capForKey(key, C);
  const refs = { solar: 1500, wind: 1000, electrolyzer: 1000, battery: 150, heat: 600, smr: 300, h2tank: 120, ng: 300, grid: 400000, asu: 1, hb: 1, nh3: 1, ccs: 1000000, optimizer: 1 };
  if (key === 'asu' || key === 'hb' || key === 'nh3' || key === 'optimizer') return 1;
  const s = Math.sqrt(Math.max(0.0001, cap / (refs[key] || 1)));
  return Math.max(0.55, Math.min(1.8, s));
}
export function cfForKey(key, C){
  let v = null;
  if (key === 'solar') v = C.cf.pv; else if (key === 'wind') v = C.cf.wt; else if (key === 'electrolyzer') v = C.cf.el;
  else if (key === 'smr') v = C.smr > 0 ? Math.min(1, C.smrH2 / (C.smr * 365)) : 0; else if (key === 'ccs') v = C.capture_rate / 100;
  return v == null ? null : Math.round(Math.max(0, Math.min(1, v)) * 100);
}

/* ---- the flow graph (original FLOWS) and its mapping onto hourly columns (original FLOW_MAP) */
const FLOWS = [
  ['solar', 'optimizer', 'elec', 18, 0.7], ['wind', 'optimizer', 'elec', 22, 0.8], ['grid', 'optimizer', 'elec', 18, 0.6],
  ['optimizer', 'battery', 'elec', 12, 0.5], ['optimizer', 'electrolyzer', 'elec', 12, 0.7], ['optimizer', 'asu', 'elec', 9, 0.6],
  ['optimizer', 'heat', 'elec', 14, 0.4], ['optimizer', 'smr', 'elec', 14, 0.4], ['optimizer', 'hb', 'elec', 12, 0.5],
  ['optimizer', 'h2tank', 'elec', 10, 0.3], ['ng', 'smr', 'ng', 12, 0.6], ['heat', 'smr', 'heat', 12, 0.3],
  ['electrolyzer', 'h2tank', 'h2', 11, 1.0], ['electrolyzer', 'hb', 'h2', 9, 0.8], ['smr', 'h2tank', 'h2', 14, 0.7],
  ['smr', 'hb', 'h2', 13, 0.7], ['smr', 'ccs', 'co2', 16, 0.5], ['h2tank', 'hb', 'h2', 10, 1.0], ['asu', 'hb', 'n2', 8, 0.8], ['hb', 'nh3', 'nh3', 11, 0.9],
];
const FLOW_MAP = {
  solar_optimizer: { fwd: ['pv'] }, wind_optimizer: { fwd: ['wt'] }, grid_optimizer: { fwd: ['imp'], rev: ['exp'] },
  optimizer_battery: { fwd: ['b', '__bchg'], rev: ['bd', '__bdis'] }, optimizer_electrolyzer: { fwd: ['el'] }, optimizer_asu: { fwd: ['asu'] },
  optimizer_heat: { fwd: ['hb', '__hbchg'] }, optimizer_smr: { fwd: ['smr'] }, optimizer_hb: { fwd: ['nh3el', 'cp'] }, optimizer_h2tank: { fwd: ['cp', 'h2chg'] },
  ng_smr: { fwd: ['h2smr', 'smr'] }, heat_smr: { fwd: ['hbd', '__hbdis'] }, heat_hb: { fwd: ['hbd', '__hbdis'] },
  electrolyzer_h2tank: { fwd: ['__h2elst', 'h2chg', 'h2el'] }, electrolyzer_hb: { fwd: ['__h2elhb', 'h2el'] },
  smr_h2tank: { fwd: ['__h2smrst', 'h2chg', 'h2smr'] }, smr_hb: { fwd: ['__h2smrhb', 'h2smr'] }, smr_ccs: { fwd: ['h2smr'] },
  h2tank_hb: { fwd: ['h2dis', 'h2nh3', 'nh3el'] }, asu_hb: { fwd: ['nh3', 'nh3el'] }, hb_nh3: { fwd: ['nh3', 'nh3el'] },
};
const FLOW_KEYS = ['pv', 'wt', 'imp', 'exp', 'b', 'bd', 'el', 'asu', 'hb', 'hbd', 'smr', 'nh3el', 'cp', 'h2el', 'h2smr', 'h2chg', 'h2dis', 'h2nh3', 'nh3',
  '__h2elhb', '__h2smrhb', '__h2elst', '__h2smrst', '__bchg', '__bdis', '__hbchg', '__hbdis'];

/* original prepData: derived split flows + 98th-percentile normalisation per column */
export function prepSeries(rec){
  if (!rec || !rec.pv) return null;
  const N = rec.pv.length, derived = {};
  const derive = (name, deps, fn) => { if (!deps.every(d => rec[d] && rec[d].length)) return; const out = new Float32Array(N); for (let h = 0; h < N; h++) out[h] = fn(...deps.map(d => rec[d][h] || 0)); derived[name] = out; };
  derive('__h2elhb', ['h2el', 'h2nh3', 'h2dis'], (p, tot, dis) => Math.min(p, Math.max(0, tot - dis)));
  derive('__h2smrhb', ['h2smr', 'h2nh3', 'h2dis'], (p, tot, dis) => Math.min(p, Math.max(0, tot - dis)));
  derive('__h2elst', ['h2el', 'h2chg'], (p, chg) => Math.min(p, chg));
  derive('__h2smrst', ['h2smr', 'h2chg'], (p, chg) => Math.min(p, chg));
  const socDelta = (k, sign) => { const soc = rec[k]; if (!soc || !soc.length) return null; const out = new Float32Array(N); for (let h = 0; h < N; h++) { const d = (soc[(h + 1) % N] || 0) - (soc[h] || 0); out[h] = sign * d > 0 ? Math.abs(d) : 0; } return out; };
  const bc = socDelta('bsoc', 1); if (bc) derived.__bchg = bc; const bdis = socDelta('bsoc', -1); if (bdis) derived.__bdis = bdis;
  const hc = socDelta('hbsoc', 1); if (hc) derived.__hbchg = hc; const hdis = socDelta('hbsoc', -1); if (hdis) derived.__hbdis = hdis;
  const SER = {};
  for (const k of FLOW_KEYS) { const a = derived[k] || rec[k]; if (!a || !a.length) continue; const nz = [...a].filter(v => v > 0).sort((x, y) => x - y); SER[k] = { arr: a, cap: (nz.length ? nz[Math.floor(nz.length * 0.98)] : 0) || 1, live: nz.length > 0 }; }
  SER.__N = N; SER.__pvCap = Math.max(...rec.pv, 1); SER.__wtCap = rec.wt ? Math.max(...rec.wt, 1) : 1; SER.__rec = rec;
  return SER;
}
const at = (arr, h) => { const i = Math.floor(h) % arr.length, f = h - Math.floor(h); return arr[i] + (arr[(i + 1) % arr.length] - arr[i]) * f; };

function makeDashTexture(){
  const c = document.createElement('canvas'); c.width = 512; c.height = 32; const ctx = c.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 4; i++) { const x = i * (c.width / 4) + 40, grad = ctx.createLinearGradient(x - 50, 0, x + 50, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)'); grad.addColorStop(0.5, 'rgba(255,255,255,1)'); grad.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = grad; ctx.fillRect(x - 50, 0, 100, c.height); }
  const baseGrad = ctx.createLinearGradient(0, 0, 0, c.height); baseGrad.addColorStop(0, 'rgba(255,255,255,0.15)'); baseGrad.addColorStop(0.5, 'rgba(255,255,255,0.45)'); baseGrad.addColorStop(1, 'rgba(255,255,255,0.15)');
  ctx.globalCompositeOperation = 'lighten'; ctx.fillStyle = baseGrad; ctx.fillRect(0, 0, c.width, c.height);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/* ---- lights: the original "golden hour with strong ambient bounce" (shadows off: shared GL context with the map) */
export function makeLights(scale = 1){
  const g = new THREE.Group();
  const hemi = new THREE.HemisphereLight(0xeaf2f8, 0x9aa090, 1.55); g.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff6e8, 2.5); sun.position.set(65, 95, 25).multiplyScalar(scale); g.add(sun);
  const fill = new THREE.DirectionalLight(0xa0bcd6, 0.9); fill.position.set(-70, 50, -40).multiplyScalar(scale); g.add(fill);
  const rim = new THREE.DirectionalLight(0xffa570, 0.5); rim.position.set(-20, 30, -100).multiplyScalar(scale); g.add(rim);
  const amb = new THREE.AmbientLight(0xffffff, 0.5); g.add(amb);
  return { group: g, hemi, sun, fill, rim, amb };
}
export function makeSkyTexture(){
  const c = document.createElement('canvas'); c.width = 2; c.height = 512; const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 512); grad.addColorStop(0, '#8fb3d6'); grad.addColorStop(0.45, '#aecae0'); grad.addColorStop(0.65, '#cfdeea'); grad.addColorStop(0.85, '#e7eef4'); grad.addColorStop(1, '#dfe4ea');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 2, 512);
  const tex = new THREE.CanvasTexture(c); tex.mapping = THREE.EquirectangularReflectionMapping; tex.colorSpace = THREE.SRGBColorSpace; return tex;
}

/* ---- assemble: subsystems placed as in the original, then the pipes between them */
export function assemblePlant(C){
  const root = new THREE.Group();
  // plot pad + painted border + grid (the original's campus pad; the map's ground replaces its 500 × 500 plane)
  const plot = new THREE.Mesh(new THREE.PlaneGeometry(170, 110), new THREE.MeshStandardMaterial({ color: 0xc9cbbf, roughness: 0.9, metalness: 0 }));
  plot.rotation.x = -Math.PI / 2; plot.position.y = 0.02; root.add(plot);
  const paintLine = (x1, z1, x2, z2, color = 0x2e3e4b, w = 0.25) => { const len = Math.hypot(x2 - x1, z2 - z1); const line = new THREE.Mesh(new THREE.PlaneGeometry(len, w), new THREE.MeshBasicMaterial({ color })); line.rotation.x = -Math.PI / 2; line.position.set((x1 + x2) / 2, 0.06, (z1 + z2) / 2); line.rotation.z = -Math.atan2(z2 - z1, x2 - x1); root.add(line); };
  paintLine(-83, -53, 83, -53); paintLine(-83, 53, 83, 53); paintLine(-83, -53, -83, 53); paintLine(83, -53, 83, 53);
  const grid = new THREE.GridHelper(180, 36, 0x9aa48f, 0xb2b8a8); grid.position.y = 0.04; grid.material.opacity = 0.25; grid.material.transparent = true; root.add(grid);
  const nodes = [], pickables = [];
  const active = SUBSYSTEMS.filter(d => capForKey(d.key, C) > 0);
  active.forEach((d, i) => { d.num = String(i + 1).padStart(2, '0'); });
  for (const def of active) {
    const built = def.builder(); const sc = scaleForKey(def.key, C); const g = built.group;
    g.scale.setScalar(sc); g.userData.baseScale = sc; g.position.set(def.pos[0], 0, def.pos[1]); if (def.rot) g.rotation.y = def.rot; g.userData.subsystemKey = def.key;
    root.add(g);
    g.traverse(o => { if (o.isMesh) { o.userData.subsystemKey = def.key; pickables.push(o); o.castShadow = o.receiveShadow = false; } });
    g.updateMatrixWorld(true);
    const wb = new THREE.Box3().setFromObject(g), center = new THREE.Vector3(), size = new THREE.Vector3(); wb.getCenter(center); wb.getSize(size);
    nodes.push({ def, group: g, update: built.update, worldBounds: wb, center, size, topAnchor: new THREE.Vector3(center.x, wb.max.y + 1.0, center.z) });
  }
  const getNode = k => nodes.find(n => n.def.key === k);
  const present = new Set(active.map(d => d.key));
  const flows = FLOWS.filter(f => present.has(f[0]) && present.has(f[1]));
  // lanes, ports, obstacles, routing — verbatim logic
  const KIND_TIER = { elec: 0, ng: 1, h2: 2, n2: 3, heat: 4, co2: 5, nh3: 6 }, kindCount = {};
  const laneHeightFor = kind => { const tier = KIND_TIER[kind] ?? 0, sub = (kindCount[kind] = (kindCount[kind] ?? 0) + 1) - 1; return 0.7 + tier * 0.85 + sub * 0.30; };
  const ports = {}; flows.forEach((f, i) => { (ports[f[0]] ??= []).push({ i, end: 'from' }); (ports[f[1]] ??= []).push({ i, end: 'to' }); });
  for (const key in ports) { const me = getNode(key); ports[key].sort((p, q) => { const np = getNode(flows[p.i][p.end === 'from' ? 1 : 0]), nq = getNode(flows[q.i][q.end === 'from' ? 1 : 0]); return Math.atan2(np.center.z - me.center.z, np.center.x - me.center.x) - Math.atan2(nq.center.z - me.center.z, nq.center.x - me.center.x); }); }
  const portPoint = (node, other, y) => { const list = ports[node.def.key], idx = list.findIndex(p => flows[p.i][p.end === 'from' ? 1 : 0] === other.def.key), count = list.length, c = node.center;
    const dir = new THREE.Vector3(other.center.x - c.x, 0, other.center.z - c.z).normalize(), perp = new THREE.Vector3(-dir.z, 0, dir.x);
    const compact = node.def.key === 'h2tank' || node.def.key === 'nh3', field = node.def.key === 'solar' || node.def.key === 'wind';
    const spread = Math.min(node.size.x, node.size.z) * (compact ? 0.28 : 0.5), t = count > 1 ? (idx / (count - 1) - 0.5) : 0, reachF = compact ? 0.26 : (field ? 0.34 : 0.5);
    const reach = (Math.abs(dir.x) * node.size.x + Math.abs(dir.z) * node.size.z) * reachF + 0.6;
    return new THREE.Vector3(c.x + dir.x * reach + perp.x * t * spread, y, c.z + dir.z * reach + perp.z * t * spread); };
  const obstacles = nodes.map(n => ({ key: n.def.key, minX: n.worldBounds.min.x - 1.2, maxX: n.worldBounds.max.x + 1.2, minZ: n.worldBounds.min.z - 1.2, maxZ: n.worldBounds.max.z + 1.2 }));
  const hits = (x1, z1, x2, z2, ex) => { for (const o of obstacles) { if (ex.includes(o.key)) continue; if (x1 === x2) { if (x1 < o.minX || x1 > o.maxX) continue; const lo = Math.min(z1, z2), hi = Math.max(z1, z2); if (hi < o.minZ || lo > o.maxZ) continue; return true; } else { if (z1 < o.minZ || z1 > o.maxZ) continue; const lo = Math.min(x1, x2), hi = Math.max(x1, x2); if (hi < o.minX || lo > o.maxX) continue; return true; } } return false; };
  const route = (A, B, fk, tk) => { const ex = [fk, tk];
    if (!hits(A.x, A.z, B.x, A.z, ex) && !hits(B.x, A.z, B.x, B.z, ex)) return [A, new THREE.Vector3(B.x, A.y, A.z), B];
    if (!hits(A.x, A.z, A.x, B.z, ex) && !hits(A.x, B.z, B.x, B.z, ex)) return [A, new THREE.Vector3(A.x, A.y, B.z), B];
    for (const off of [12, 18, 24, -12, -18, -24]) { const tx = A.x + off; if (!hits(A.x, A.z, tx, A.z, ex) && !hits(tx, A.z, tx, B.z, ex) && !hits(tx, B.z, B.x, B.z, ex)) return [A, new THREE.Vector3(tx, A.y, A.z), new THREE.Vector3(tx, A.y, B.z), B];
      const tz = A.z + off; if (!hits(A.x, A.z, A.x, tz, ex) && !hits(A.x, tz, B.x, tz, ex) && !hits(B.x, tz, B.x, B.z, ex)) return [A, new THREE.Vector3(A.x, A.y, tz), new THREE.Vector3(B.x, A.y, tz), B]; }
    return [A, new THREE.Vector3(B.x, A.y, A.z), B]; };
  const flowGroup = new THREE.Group(); root.add(flowGroup); const flowMeshes = [];
  for (const [fk, tk, kind, , str] of flows) {
    const a = getNode(fk), b = getNode(tk); if (!a || !b) continue;
    const y = laneHeightFor(kind), pA = portPoint(a, b, y), pB = portPoint(b, a, y);
    const wps = [new THREE.Vector3(pA.x, 0.5, pA.z), ...route(pA, pB, fk, tk), new THREE.Vector3(pB.x, 0.5, pB.z)];
    const path = new THREE.CurvePath(); for (let i = 0; i < wps.length - 1; i++) if (wps[i].distanceTo(wps[i + 1]) >= 1e-4) path.add(new THREE.LineCurve3(wps[i], wps[i + 1]));
    const totalLen = wps.reduce((acc, p, i) => i === 0 ? 0 : acc + wps[i - 1].distanceTo(p), 0), segs = Math.max(40, Math.floor(totalLen * 2.5)), radius = 0.20 + str * 0.10;
    const tex = makeDashTexture(); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; const pathLen = path.getLength(); tex.repeat.set(Math.max(4, pathLen / 7), 1);
    const color = PALETTE[kind] ?? 0xffffff;
    const m = new THREE.MeshStandardMaterial({ color: 0x0d141a, emissive: color, emissiveIntensity: 1.2, emissiveMap: tex, transparent: true, opacity: 0.9, roughness: 0.5, metalness: 0.05 });
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(path, segs, radius, 12, false), m); flowGroup.add(mesh);
    const haloMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false });
    flowGroup.add(new THREE.Mesh(new THREE.TubeGeometry(path, segs, radius * 1.9, 10, false), haloMat));
    const last = path.curves[path.curves.length - 1], endPos = last.getPointAt(0.985), endTan = last.getTangentAt(0.985).normalize();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(radius * 2.0, radius * 4.0, 14), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.2, roughness: 0.4 }));
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), endTan); cone.position.copy(endPos); flowGroup.add(cone);
    flowMeshes.push({ mat: m, tex, speed: 0.35 + Math.random() * 0.15, kind, from: fk, to: tk, haloMat, coneMat: cone.material, level: 1, dir: 1 });
  }
  const rotors = []; root.traverse(o => { if (o.userData && typeof o.userData.speed === 'number') rotors.push({ r: o, base: o.userData.speed }); });
  const selRing = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 64), new THREE.MeshBasicMaterial({ color: 0xffb547, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
  selRing.rotation.x = -Math.PI / 2; selRing.position.y = 0.09; selRing.visible = false; root.add(selRing);

  const P = { root, nodes, flows: flowMeshes, rotors, pickables, selRing, C, SER: null, simH: 0,
    setSeries(SER){ this.SER = SER; },
    /* original live-sim frame: pipes light up only when the model moves something through them; rotors follow wind */
    setHour(simH, dt){
      this.simH = simH; const SER = this.SER; if (!SER) return;
      const windCF = SER.wt ? Math.max(0, Math.min(1, at(SER.wt.arr, simH) / SER.__wtCap)) : 0;
      for (const { r, base } of rotors) r.userData.speed = base * (0.04 + windCF * 3.6);
      for (const f of flowMeshes) {
        const map = FLOW_MAP[f.from + '_' + f.to]; if (!map) continue;
        const sample = keys => { if (!keys) return null; let saw = false; for (const k of keys) { const s = SER[k]; if (!s) continue; saw = true; if (s.live) return Math.min(1, Math.max(0, at(s.arr, simH) / s.cap)); } return saw ? 0 : null; };
        const fwd = sample(map.fwd), rev = sample(map.rev); if (fwd === null && rev === null) continue;
        let lv = Math.max(fwd ?? 0, rev ?? 0); lv = lv < 0.03 ? 0 : Math.pow(lv, 0.6);
        f.dir = (rev ?? 0) > (fwd ?? 0) ? -1 : 1; f.level += (lv - f.level) * Math.min(1, (dt || 0.05) * 4); if (lv === 0 && f.level < 0.02) f.level = 0;
      }
    },
    /* original tick: builder animations, selection scale, packet motion */
    tick(dt, t){
      for (const n of nodes) { if (n.update) n.update(dt, t); const target = (n.group.userData.targetScale ?? 1) * n.group.userData.baseScale; n.group.scale.setScalar(THREE.MathUtils.lerp(n.group.scale.x, target, 0.18)); }
      for (const f of flowMeshes) { const lv = Math.max(0, Math.min(1, f.level ?? 1)), run = lv <= 0.02 ? 0 : 0.2 + 0.8 * lv;
        f.tex.offset.x -= dt * f.speed * run * (f.dir ?? 1); f.tex.needsUpdate = true; f.mat.emissiveIntensity = 0.08 + 1.12 * lv; f.mat.opacity = 0.35 + 0.55 * lv; f.haloMat.opacity = 0.10 * lv; f.coneMat.emissiveIntensity = 0.10 + 1.10 * lv; }
      if (selRing.visible) { const k = 1 + Math.sin(t * 2.6) * 0.04; selRing.scale.setScalar(selRing.userData.r * k); selRing.material.opacity = 0.55 + Math.sin(t * 2.6) * 0.25; }
    },
    select(key){
      for (const n of nodes) n.group.userData.targetScale = (key && n.def.key === key) ? 1.04 : 1.0;
      const n = key && getNode(key); if (!n) { selRing.visible = false; return; }
      selRing.visible = true; selRing.userData.r = Math.max(n.size.x, n.size.z) * 0.62; selRing.scale.setScalar(selRing.userData.r); selRing.position.set(n.center.x, 0.09, n.center.z);
    }
  };
  return P;
}
