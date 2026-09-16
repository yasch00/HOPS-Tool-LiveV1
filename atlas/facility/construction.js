/* atlas/facility/construction.js — the construction site shown at a requested plant while HOPS is still solving it.
   Same plot, scale and materials as the finished plant (plant_assembly.js), so the site later "completes" in place:
   graded pad, fence, the subsystems' foundations poured one after another as the cloud jobs finish (progress 0–1),
   a slewing tower crane, a mobile crane at the unit being built, dump trucks on the haul loop. Scene units as the
   original (plot 170 × 110, 1 unit = 3 m on the map). */
import { THREE, PALETTE, SUBSYSTEMS } from './plant_assembly.js';
import { mat } from './plant_builders.js';

const CONCRETE = 0xb9b5ad, STEEL = 0x8e97a1, SAFETY = 0xf2b134, DIRT = 0x8a7358, RUBBER = 0x24272b, CAB = 0x2f6fb0;
const FOOT = { solar: [30, 22], wind: [20, 16], grid: [18, 14], ng: [12, 10], battery: [16, 12], heat: [14, 12], electrolyzer: [22, 16], smr: [22, 18], h2tank: [16, 14], asu: [18, 16], hb: [24, 20], nh3: [18, 18], ccs: [18, 14], optimizer: [10, 8] };

function at(m, x, y, z){ m.position.set(x, y, z); return m; }
function box(w, h, d, color, opts){ const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts)); return m; }
function cyl(r1, r2, h, color, seg = 12){ return new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), mat(color)); }

function towerCrane(h = 44, jib = 46){
  const g = new THREE.Group();
  g.add(at(box(6, 1, 6, CONCRETE), 0, 0.5, 0));                       // base
  const mast = box(1.8, h, 1.8, SAFETY, { roughness: 0.6 }); mast.position.y = h / 2; g.add(mast);
  const lattice = new THREE.Mesh(new THREE.BoxGeometry(1.9, h, 1.9), new THREE.MeshBasicMaterial({ color: 0x3a3a3a, wireframe: true, transparent: true, opacity: 0.35 })); lattice.position.y = h / 2; g.add(lattice);
  const slew = new THREE.Group(); slew.position.y = h; g.add(slew);
  slew.add(at(box(2.6, 2.2, 2.6, STEEL), 0, 1.1, 0));                // cab / slewing ring
  const jibM = box(jib, 1.0, 1.0, SAFETY); jibM.position.set(jib / 2 - 3, 2.6, 0); slew.add(jibM);
  const cj = box(12, 1.0, 1.2, SAFETY); cj.position.set(-8, 2.6, 0); slew.add(cj);
  const cw = box(4, 2.4, 2.2, CONCRETE); cw.position.set(-12.5, 1.8, 0); slew.add(cw);                           // counterweight
  const apex = cyl(0.25, 0.25, 7, STEEL, 6); apex.position.set(0, 6, 0); slew.add(apex);
  const tie = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 9.5, 0), new THREE.Vector3(jib - 5, 3.2, 0), new THREE.Vector3(0, 9.5, 0), new THREE.Vector3(-13, 3.2, 0)]), new THREE.LineBasicMaterial({ color: 0x2a2f36 })); slew.add(tie);
  const trolley = new THREE.Group(); trolley.position.set(jib * 0.55, 2.0, 0); slew.add(trolley);
  trolley.add(box(1.6, 0.8, 1.4, STEEL));
  const cableLen = h - 6; const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, cableLen, 4), mat(0x1c1f23)); cable.position.y = -cableLen / 2; trolley.add(cable);
  const hook = new THREE.Group(); hook.position.y = -cableLen; trolley.add(hook);
  hook.add(at(box(0.8, 1.2, 0.8, STEEL), 0, 0.6, 0));
  const load = box(5, 2.2, 3, 0x7f8f9f, { roughness: 0.7 }); load.position.y = -1.2; hook.add(load);            // a module / steel bundle
  return { group: g, slew, trolley, cable, hook, h, cableLen };
}
function mobileCrane(){
  const g = new THREE.Group();
  g.add(at(box(9, 1.6, 3.2, SAFETY), 0, 1.4, 0));
  g.add(at(box(2.6, 1.8, 2.8, CAB), -3.5, 3.0, 0));
  for (const x of [-3, -0.5, 2, 3.6]) for (const z of [-1.6, 1.6]) { const w = cyl(0.8, 0.8, 0.6, RUBBER); w.rotation.x = Math.PI / 2; w.position.set(x, 0.8, z); g.add(w); }
  for (const s of [-1, 1]) { const o = box(0.6, 0.4, 5.6, STEEL); o.position.set(2.5 * s, 0.9, 0); g.add(o); }  // outriggers
  const turret = new THREE.Group(); turret.position.set(1.2, 2.3, 0); g.add(turret);
  turret.add(at(box(3, 1.4, 2.4, SAFETY), 0, 0.7, 0));
  const boom = box(22, 0.9, 0.9, SAFETY); boom.position.set(9, 0.3, 0); const bg = new THREE.Group(); bg.position.set(0, 1.4, 0); bg.rotation.z = 0.95; bg.add(boom); turret.add(bg);
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 10, 4), mat(0x1c1f23)); cable.position.set(20, -4.7, 0); cable.rotation.z = -0.95; bg.add(cable);
  return { group: g, turret, bg };
}
function dumpTruck(color){
  const g = new THREE.Group();
  g.add(at(box(3.2, 2.4, 2.6, color), 2.8, 2.2, 0));                 // cab
  const bed = box(5.6, 1.9, 2.8, 0x5a5f66, { roughness: 0.8 }); bed.position.set(-1.6, 2.4, 0); g.add(bed);
  const dirt = box(5.2, 0.8, 2.4, DIRT, { roughness: 1 }); dirt.position.set(-1.6, 3.7, 0); g.add(dirt);
  g.add(at(box(9, 0.6, 2.4, 0x2b2f33), 0.6, 1.1, 0));
  for (const x of [3.2, -0.6, -2.8]) for (const z of [-1.35, 1.35]) { const w = cyl(0.75, 0.75, 0.7, RUBBER); w.rotation.x = Math.PI / 2; w.position.set(x, 0.75, z); g.add(w); }
  return g;
}
function excavator(){
  const g = new THREE.Group();
  for (const z of [-1.3, 1.3]) g.add(at(box(5.5, 1.3, 1.1, RUBBER), 0, 0.65, z));   // tracks
  const house = new THREE.Group(); house.position.y = 1.6; g.add(house);
  house.add(at(box(4.2, 1.8, 3.2, SAFETY), -0.6, 0.9, 0));
  house.add(at(box(1.6, 1.6, 1.4, CAB), 0.6, 1.9, 0.8));
  const boomG = new THREE.Group(); boomG.position.set(1.4, 1.2, 0); boomG.rotation.z = 0.7; house.add(boomG);
  boomG.add(at(box(7, 0.8, 0.8, SAFETY), 3.5, 0, 0));
  const stick = new THREE.Group(); stick.position.set(7, 0, 0); stick.rotation.z = -1.9; boomG.add(stick);
  stick.add(at(box(4.5, 0.6, 0.6, SAFETY), 2.2, 0, 0));
  stick.add(at(box(1.6, 1.4, 1.6, STEEL), 4.6, -0.4, 0));
  return { group: g, house, boomG, stick };
}

/* the haul loop the trucks drive: rectangle inside the fence, clockwise */
const LOOP = [[-78, -48], [78, -48], [78, 48], [-78, 48]];
function loopPoint(u){ const n = LOOP.length, seg = Math.floor(u * n) % n, f = u * n - Math.floor(u * n), a = LOOP[seg], b = LOOP[(seg + 1) % n]; return { x: a[0] + (b[0] - a[0]) * f, z: a[1] + (b[1] - a[1]) * f, heading: Math.atan2(-(b[1] - a[1]), b[0] - a[0]) }; }

export function buildConstruction(progress = 0){
  const root = new THREE.Group();
  const plot = new THREE.Mesh(new THREE.BoxGeometry(170, 2.0, 110), new THREE.MeshStandardMaterial({ color: 0x9f978a, roughness: 1, metalness: 0 }));   // freshly graded: browner than the finished gravel
  plot.position.y = -0.98; root.add(plot);
  // fence: posts + a faint mesh band
  const fence = new THREE.Group(); root.add(fence);
  const band = new THREE.Mesh(new THREE.BoxGeometry(170.4, 2.2, 110.4), new THREE.MeshBasicMaterial({ color: 0xdadfe3, wireframe: true, transparent: true, opacity: 0.25 })); band.position.y = 1.1; fence.add(band);
  for (let x = -85; x <= 85; x += 10) for (const z of [-55, 55]) { const p = cyl(0.12, 0.12, 2.4, STEEL, 5); p.position.set(x, 1.2, z); fence.add(p); }
  for (let z = -45; z <= 45; z += 10) for (const x of [-85, 85]) { const p = cyl(0.12, 0.12, 2.4, STEEL, 5); p.position.set(x, 1.2, z); fence.add(p); }
  // site offices + material laydown near the gate
  root.add(at(box(10, 2.8, 3.2, 0xe9ecef), -70, 1.4, 46));
  root.add(at(box(10, 2.8, 3.2, 0xe9ecef), -58, 1.4, 46));
  for (let i = 0; i < 6; i++) { const s = box(6, 1.2 + (i % 3) * 0.5, 2.2, i % 2 ? STEEL : 0x6f7a86); s.position.set(60 + (i % 3) * 7, 0.6 + (i % 3) * 0.25, 40 + Math.floor(i / 3) * 3.2); root.add(s); }
  // foundations, one per subsystem in the reference layout, revealed with progress
  const units = SUBSYSTEMS.map(d => ({ key: d.key, title: d.title, pos: d.pos, size: FOOT[d.key] || [16, 12], color: d.color }));
  const founds = new THREE.Group(); root.add(founds);
  const slabs = units.map(u => {
    const grp = new THREE.Group(); grp.position.set(u.pos[0], 0, u.pos[1]); founds.add(grp);
    const pit = box(u.size[0] + 2, 0.6, u.size[1] + 2, DIRT, { roughness: 1 }); pit.position.y = 0.05; grp.add(pit);
    const slab = box(u.size[0], 1.0, u.size[1], CONCRETE, { roughness: 0.9 }); slab.position.y = 0.5; slab.visible = false; grp.add(slab);
    const rebar = new THREE.Mesh(new THREE.BoxGeometry(u.size[0] - 2, 3.5, u.size[1] - 2), new THREE.MeshBasicMaterial({ color: 0x7a4b2a, wireframe: true, transparent: true, opacity: 0.6 })); rebar.position.y = 2.3; rebar.visible = false; grp.add(rebar);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(u.size[0] - 3, 7, u.size[1] - 3), new THREE.MeshBasicMaterial({ color: STEEL, wireframe: true, transparent: true, opacity: 0.8 })); frame.position.y = 4.5; frame.visible = false; grp.add(frame);
    const shell = box(u.size[0] - 3, 6, u.size[1] - 3, u.color || 0x8fa0b0, { roughness: 0.6, transparent: true, opacity: 0.55 }); shell.position.y = 4; shell.visible = false; grp.add(shell);
    return { u, grp, pit, slab, rebar, frame, shell };
  });
  // machines
  const tc = towerCrane(); tc.group.position.set(-6, 0, 4); root.add(tc.group);
  const mc = mobileCrane(); root.add(mc.group);
  const ex = excavator(); root.add(ex.group);
  const trucks = [0xd9a441, 0xc8cdd2, 0xd9a441].map((c, i) => { const t = dumpTruck(c); t.userData.u = i / 3; root.add(t); return t; });
  // a small plot sign
  const sign = box(8, 3.4, 0.2, 0xffffff); sign.position.set(-80, 3.2, 52); root.add(sign); const post = cyl(0.15, 0.15, 3, STEEL, 6); post.position.set(-80, 1.5, 52); root.add(post);

  const S = { root, progress: 0, nodes: [], SER: null, weather: null, current: 0 };
  S.setProgress = function(p){
    p = Math.max(0, Math.min(1, p || 0)); S.progress = p; const n = slabs.length, done = Math.floor(p * n * 0.999), stage = p * n - done;
    slabs.forEach((s, i) => { const st = i < done ? 4 : i === done ? Math.floor(stage * 4) : 0;   // 0 pit · 1 slab · 2 rebar · 3 frame · 4 shell
      s.slab.visible = st >= 1; s.rebar.visible = st === 2; s.frame.visible = st >= 3; s.shell.visible = st >= 4; });
    S.current = Math.min(done, n - 1);
    const c = slabs[S.current].u; mc.group.position.set(c.pos[0] + c.size[0] / 2 + 9, 0, c.pos[1] + 4); mc.turret.rotation.y = Math.PI;
    ex.group.position.set(c.pos[0] - c.size[0] / 2 - 8, 0, c.pos[1] - 3); ex.house.rotation.y = -0.4;
    tc.slewTarget = Math.atan2(-(c.pos[1] - tc.group.position.z), c.pos[0] - tc.group.position.x);
  };
  S.tick = function(dt, t){
    const spd = 7;                                                       // scene units / s (≈ 20 m/s on the map · 1 unit = 3 m)
    for (const tr of trucks) { tr.userData.u = (tr.userData.u + dt * spd / 452) % 1; const q = loopPoint(tr.userData.u); tr.position.set(q.x, 0, q.z); tr.rotation.y = q.heading; }
    if (tc.slewTarget != null) { let d = tc.slewTarget - tc.slew.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d)); tc.slew.rotation.y += Math.max(-0.25 * dt, Math.min(0.25 * dt, d)); }
    tc.slew.rotation.y += 0.02 * dt * Math.sin(t * 0.3);
    const lift = 0.5 + 0.45 * Math.sin(t * 0.35); const len = tc.cableLen * (0.35 + 0.6 * lift); tc.cable.scale.y = len / tc.cableLen; tc.cable.position.y = -len / 2; tc.hook.position.y = -len;
    tc.trolley.position.x = 20 + 12 * Math.sin(t * 0.17);
    mc.bg.rotation.z = 0.95 + 0.12 * Math.sin(t * 0.5); mc.turret.rotation.y = Math.PI + 0.35 * Math.sin(t * 0.22);
    ex.boomG.rotation.z = 0.7 + 0.35 * Math.sin(t * 0.9); ex.stick.rotation.z = -1.9 + 0.5 * Math.sin(t * 0.9 + 1.2); ex.house.rotation.y = -0.4 + 0.5 * Math.sin(t * 0.3);
  };
  S.setSeries = function(){}; S.select = function(){};
  S.setProgress(progress);
  return S;
}
