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
  SER.__cloud = computeCloud(rec);
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
  const plot = new THREE.Mesh(new THREE.BoxGeometry(170, 2.0, 110), new THREE.MeshStandardMaterial({ color: 0xa9aba2, roughness: 0.95, metalness: 0 }));   // gravel grey, closer to the imagery
  plot.position.y = -1.0 + 0.02; root.add(plot);                                  // top face at y = 0.02, slab 2 units (~6 m) deep into the ground
  const paintLine = (x1, z1, x2, z2, color = 0x2e3e4b, w = 0.25) => { const len = Math.hypot(x2 - x1, z2 - z1); const line = new THREE.Mesh(new THREE.PlaneGeometry(len, w), new THREE.MeshBasicMaterial({ color })); line.rotation.x = -Math.PI / 2; line.position.set((x1 + x2) / 2, 0.06, (z1 + z2) / 2); line.rotation.z = -Math.atan2(z2 - z1, x2 - x1); root.add(line); };
  paintLine(-83, -53, 83, -53); paintLine(-83, 53, 83, 53); paintLine(-83, -53, -83, 53); paintLine(83, -53, 83, 53);
  const grid = new THREE.GridHelper(180, 36, 0x9aa48f, 0xb2b8a8); grid.position.y = 0.04; grid.material.opacity = 0.08; grid.material.transparent = true; root.add(grid);   // faint: the real ground is the picture
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

/* ================================================================== weather + day/night (port of the live-sim module §2–§7)
   Solar geometry at the site, cloudiness from the PV output against its clear-sky envelope, drifting cloud clusters, rain
   fronts with hysteresis and lightning, sun/moon/stars, and the lighting that follows all of it. Everything lives in scene
   units inside the plant root so it scales with the plant; the map's imagery and sky are driven from facility.js. */
export function sunAngles(lat, lon, hourOfYear){
  const LAT = lat * Math.PI / 180, local = hourOfYear + lon / 15;              // data index is UTC → local solar time
  const doy = ((Math.floor(local / 24) % 365) + 365) % 365 + 1, decl = 23.44 * Math.PI / 180 * Math.sin(2 * Math.PI * (284 + doy) / 365);
  const hod = ((local % 24) + 24) % 24, ha = (hod - 12) * 15 * Math.PI / 180;
  const elev = Math.asin(Math.sin(LAT) * Math.sin(decl) + Math.cos(LAT) * Math.cos(decl) * Math.cos(ha));
  const az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(LAT) - Math.tan(decl) * Math.cos(LAT));
  return { elev, az };
}
export function dirFrom(elev, az){ return new THREE.Vector3(Math.sin(az) * Math.cos(elev), Math.sin(elev), -Math.cos(az) * Math.cos(elev)); }
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
function monthOf(h){ let d = Math.floor(h / 24); for (let m = 0; m < 12; m++) { if (d < MONTH_DAYS[m]) return m; d -= MONTH_DAYS[m]; } return 11; }
/* cloudiness per hour: 1 − pv / clear-sky envelope (90th percentile per month × hour-of-day), forward-filled at night, smoothed */
export function computeCloud(rec){
  if (!rec || !rec.pv) return null;
  const PV = rec.pv, N = PV.length, step = Math.round(8760 / N), pvCap = Math.max(...PV, 1);
  const buckets = Array.from({ length: 12 * 24 }, () => []);
  for (let h = 0; h < N; h++) buckets[monthOf(h * step) * 24 + ((h * step) % 24)].push(PV[h]);
  const env90 = buckets.map(a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length * 0.9)] || 0; });
  const C = new Float32Array(N); let carry = 0.3;
  for (let h = 0; h < N; h++) { const exp = env90[monthOf(h * step) * 24 + ((h * step) % 24)]; if (exp > pvCap * 0.06) carry = Math.min(1, Math.max(0, 1 - PV[h] / exp)); C[h] = carry; }
  const sm = new Float32Array(N); for (let h = 0; h < N; h++) sm[h] = (C[Math.max(0, h - 1)] + C[h] * 2 + C[Math.min(N - 1, h + 1)]) / 4;
  return sm;
}
const C_ = h => new THREE.Color(h), lerpC = (a, b, t) => a.clone().lerp(b, Math.min(1, Math.max(0, t))), smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const PAL = { nightTop: C_('#0b1322'), nightHor: C_('#1d2c40'), duskTop: C_('#54749c'), duskHor: C_('#f0ae72'), dayTop: C_('#8fbcdc'), dayHor: C_('#e6eef2'), grayTop: C_('#79858f'), grayHor: C_('#a8b2ba') };
function glowTexture(inner, outer){ const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'); const g = x.createRadialGradient(64, 64, 4, 64, 64, 64); g.addColorStop(0, inner); g.addColorStop(0.35, outer); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); }

export function makeWeather(lights){
  const group = new THREE.Group();
  const sunDisc = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,246,220,1)', 'rgba(255,210,130,0.55)'), transparent: true, depthWrite: false })); sunDisc.scale.setScalar(70); group.add(sunDisc);
  const moonDisc = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(232,238,245,1)', 'rgba(170,190,215,0.35)'), transparent: true, depthWrite: false })); moonDisc.scale.setScalar(34); group.add(moonDisc);
  const starGeo = new THREE.BufferGeometry(); { const pts = []; for (let i = 0; i < 900; i++) { const az = Math.random() * Math.PI * 2, el = Math.asin(Math.random()) * 0.98 + 0.02; const v = dirFrom(el, az).multiplyScalar(355); pts.push(v.x, v.y, v.z); } starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); }
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: '#dbe7f7', size: 1.7, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false })); group.add(stars);
  const cloudGroups = [], WIND_DIR = new THREE.Vector3(1, 0, 0.25).normalize();
  for (let i = 0; i < 26; i++) { const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, metalness: 0, transparent: true, opacity: 0, flatShading: true });
    const puffs = 5 + Math.floor(Math.random() * 3); for (let p = 0; p < puffs; p++) { const s = new THREE.Mesh(new THREE.SphereGeometry(1, 7, 5), m); s.position.set((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 2.4, (Math.random() - 0.5) * 7); s.scale.set(6 + Math.random() * 8, 2.4 + Math.random() * 1.8, 4 + Math.random() * 4); g.add(s); }
    g.position.set((Math.random() - 0.5) * 560, 58 + Math.random() * 30, (Math.random() - 0.5) * 560); g.userData = { mat: m, target: 0, drift: 0.75 + Math.random() * 0.5 }; group.add(g); cloudGroups.push(g); }
  const RAIN_N = 4200, rainGeo = new THREE.BufferGeometry(); { const pts = new Float32Array(RAIN_N * 3); for (let i = 0; i < RAIN_N; i++) { pts[i * 3] = (Math.random() - 0.5) * 260; pts[i * 3 + 1] = Math.random() * 120; pts[i * 3 + 2] = (Math.random() - 0.5) * 260; } rainGeo.setAttribute('position', new THREE.BufferAttribute(pts, 3)); }
  const rain = new THREE.Points(rainGeo, new THREE.PointsMaterial({ color: '#9fb4c8', size: 0.5, transparent: true, opacity: 0, depthWrite: false })); group.add(rain);
  const W = { group, sunDisc, moonDisc, stars, cloudGroups, rain, rainGeo, RAIN_N, WIND_DIR, rainAmt: 0, bolt: 0, lights, state: {} };
  /* one frame of the original loop: returns what the map and the HUD need */
  W.update = function(simH, dt, plant, SER, exposureBase){
    const L = this.lights, rec = SER && SER.__rec, N = rec && rec.pv ? rec.pv.length : 8760, step = Math.round(8760 / N);
    const at = (arr, h) => { const i = Math.floor(h) % arr.length, f = h - Math.floor(h); return arr[i] + (arr[(i + 1) % arr.length] - arr[i]) * f; };
    const pvNow = rec && rec.pv ? at(rec.pv, simH) : 0, wtNow = rec && rec.wt ? at(rec.wt, simH) : 0, wtCap = SER ? SER.__wtCap : 1, pvCap = SER ? SER.__pvCap : 1;
    const cloudRaw = SER && SER.__cloud ? Math.min(1, Math.max(0, at(SER.__cloud, simH))) : 0.3, cloud = smooth(0.10, 0.78, cloudRaw);
    const { elev, az } = sunAngles(plant.lat, plant.lon, simH * step), elevDeg = elev * 180 / Math.PI;
    const rainTarget = (this.rainAmt > 0 ? cloud > 0.60 : cloud > 0.74) ? 1 : 0; this.rainAmt += (rainTarget - this.rainAmt) * Math.min(1, dt * 1.2); const raining = this.rainAmt > 0.45;
    if (raining && this.rainAmt > 0.7 && Math.random() < dt * 0.25) this.bolt = 1; this.bolt = Math.max(0, this.bolt - dt * 5);
    const dayF = smooth(-7, 12, elevDeg), duskF = Math.exp(-Math.pow((elevDeg - 1) / 9, 2)), nightF = 1 - dayF;
    let top = lerpC(lerpC(PAL.nightTop, PAL.dayTop, dayF), PAL.duskTop, duskF * 0.8), hor = lerpC(lerpC(PAL.nightHor, PAL.dayHor, dayF), PAL.duskHor, duskF * 0.85);
    top = lerpC(top, PAL.grayTop, cloud * 0.92 * dayF); hor = lerpC(hor, PAL.grayHor, cloud * 0.92 * dayF);
    // lights (original intensities)
    const sunDir = dirFrom(Math.max(elev, -0.12), az);
    L.sun.position.copy(sunDir).multiplyScalar(130); L.sun.intensity = 2.5 * dayF * (1 - 0.92 * cloud); L.sun.color.copy(lerpC(C_('#ffd9a8'), C_('#fff6e8'), smooth(2, 25, elevDeg)));
    L.hemi.intensity = 0.22 + 1.35 * dayF * (1 - 0.62 * cloud); L.hemi.color.copy(lerpC(C_('#27374d'), C_('#eaf2f8'), dayF)); L.hemi.groundColor.copy(lerpC(C_('#0e1216'), C_('#9aa090'), dayF));
    L.fill.intensity = 0.12 + 0.78 * dayF + nightF * 0.25 * (1 - 0.7 * cloud); L.fill.color.copy(lerpC(C_('#9fb6d8'), C_('#a0bcd6'), dayF));
    L.rim.intensity = 0.5 * dayF; L.amb.intensity = 0.14 + 0.36 * dayF;
    let exposure = exposureBase * (0.78 + 0.5 * dayF) * (1 - 0.26 * cloud * dayF) * (1 - 0.18 * this.rainAmt);
    if (this.bolt > 0) { L.hemi.intensity += this.bolt * 2.2; L.amb.intensity += this.bolt * 1.6; exposure += this.bolt * 0.55; }
    // sun / moon / stars
    this.sunDisc.position.copy(sunDir).multiplyScalar(352); this.sunDisc.material.opacity = smooth(-3, 4, elevDeg) * Math.pow(1 - cloud, 2.2);
    const moonDir = dirFrom(Math.max(-elev, -0.1), az + Math.PI); this.moonDisc.position.copy(moonDir).multiplyScalar(352); this.moonDisc.material.opacity = nightF * Math.pow(1 - cloud, 1.2) * smooth(-2, 6, -elevDeg);
    this.stars.material.opacity = 0;   // no stars on the map: at scene distance they would draw over the real ground
    // clouds drift with the wind
    const visible = Math.round(cloud * this.cloudGroups.length), windCF = Math.max(0, Math.min(1, wtNow / wtCap)), driftSpd = 3 + windCF * 30;
    this.cloudGroups.forEach((g, i) => { g.userData.target = i < visible ? (0.65 + 0.35 * cloud) : 0; const m = g.userData.mat; m.opacity += (g.userData.target - m.opacity) * Math.min(1, dt * 0.7);
      m.color.copy(lerpC(C_('#ffffff'), C_('#5e6a76'), cloud * 0.9)); m.visible = m.opacity > 0.02; g.position.addScaledVector(this.WIND_DIR, driftSpd * g.userData.drift * dt); if (g.position.x > 320) { g.position.x = -320; g.position.z = (Math.random() - 0.5) * 560; } });
    // rain
    this.rain.material.opacity = this.rainAmt * 0.85; this.rain.visible = this.rainAmt > 0.03;
    if (this.rain.visible) { const p = this.rainGeo.attributes.position.array, fall = (75 + windCF * 45) * dt; for (let i = 0; i < this.RAIN_N; i++) { p[i * 3 + 1] -= fall; p[i * 3] += windCF * 22 * dt; if (p[i * 3 + 1] < 0) { p[i * 3 + 1] = 110 + Math.random() * 10; p[i * 3] = (Math.random() - 0.5) * 260; p[i * 3 + 2] = (Math.random() - 0.5) * 260; } } this.rainGeo.attributes.position.needsUpdate = true; }
    const night = elevDeg < -2, cond = raining ? '🌧 Rain' : night ? (cloud > 0.55 ? '☁ Cloudy night' : '🌙 Clear night') : cloud < 0.25 ? '☀ Clear' : cloud < 0.55 ? '⛅ Partly cloudy' : '☁ Overcast';
    const ghi = Math.round(1000 * Math.max(0, Math.sin(elevDeg * Math.PI / 180)) * (1 - 0.75 * cloud)), ws = (12 * Math.cbrt(Math.max(0, wtNow / wtCap))).toFixed(1);
    this.state = { dayF, nightF, duskF, cloud, cloudRaw, elevDeg, raining, rainAmt: this.rainAmt, bolt: this.bolt, exposure, top: '#' + top.getHexString(), hor: '#' + hor.getHexString(), cond, ghi, ws, pvNow, wtNow, windCF };
    return this.state;
  };
  return W;
}
