/* atlas/lib/storage3d.js — the Storage Lab's centre piece: a 3D model of the selected storage technology on a slowly turning
   pad. Procedural (no downloaded assets) but rendered for realism: physically-based materials lit by an environment map,
   soft shadows from a sun, procedural concrete / corrugated-steel / insulation textures, and the details that make an
   installation read as real — doors, HVAC fans, cable trays, transformer and inverter skids, ladders, manways, pipe runs,
   bollards, fencing. One builder per technology family; nothing is to scale. three.js r161 (the facility scene's copy). */
import * as THREE from '../facility/three.module.js';
import { makeSkyTexture } from '../facility/plant_assembly.js';

/* ---- procedural textures (canvas) */
function canvasTex(w, h, draw, repeat = [1, 1]){ const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }
function noise(ctx, w, h, base, amp, n = 6000){ ctx.fillStyle = base; ctx.fillRect(0, 0, w, h); for (let i = 0; i < n; i++) { const v = Math.floor(Math.random() * amp * 2 - amp); ctx.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 255})`; ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 3); } }
const TEX = {};
function tex(name){
  if (TEX[name]) return TEX[name];
  if (name === 'concrete') TEX[name] = canvasTex(512, 512, (ctx, w, h) => { noise(ctx, w, h, '#b9b6ae', 28, 14000); ctx.strokeStyle = 'rgba(0,0,0,.12)'; ctx.lineWidth = 2; for (let x = 0; x <= w; x += 128) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); } for (let y = 0; y <= h; y += 128) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); } }, [4, 4]);
  if (name === 'asphalt') TEX[name] = canvasTex(512, 512, (ctx, w, h) => noise(ctx, w, h, '#3a3d40', 22, 20000), [6, 6]);
  if (name === 'corrugated') TEX[name] = canvasTex(256, 64, (ctx, w, h) => { for (let x = 0; x < w; x++) { const v = 0.5 + 0.5 * Math.sin(x / 6 * Math.PI); const g = Math.floor(205 + 40 * v); ctx.fillStyle = `rgb(${g},${g + 2},${g + 4})`; ctx.fillRect(x, 0, 1, h); } }, [3, 1]);
  if (name === 'corrugatedN') TEX[name] = canvasTex(256, 64, (ctx, w, h) => { for (let x = 0; x < w; x++) { const nx = Math.cos(x / 6 * Math.PI) * 0.6; ctx.fillStyle = `rgb(${Math.floor(128 + nx * 110)},128,255)`; ctx.fillRect(x, 0, 1, h); } }, [3, 1]);
  if (name === 'grate') TEX[name] = canvasTex(64, 64, (ctx, w, h) => { ctx.fillStyle = '#4a4f55'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#1e2226'; for (let y = 4; y < h; y += 12) ctx.fillRect(0, y, w, 6); }, [8, 8]);
  if (name === 'insul') TEX[name] = canvasTex(256, 256, (ctx, w, h) => { noise(ctx, w, h, '#c9ccd1', 12, 4000); ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 3; for (let y = 0; y <= h; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); } }, [1, 2]);
  if (name === 'water') TEX[name] = canvasTex(256, 256, (ctx, w, h) => noise(ctx, w, h, '#6fb3d8', 10, 6000), [3, 3]);
  if (name === 'grass') TEX[name] = canvasTex(256, 256, (ctx, w, h) => noise(ctx, w, h, '#5f7a4b', 26, 16000), [5, 5]);
  if (name === 'chainlink') TEX[name] = canvasTex(64, 64, (ctx, w, h) => { ctx.clearRect(0, 0, w, h); ctx.strokeStyle = 'rgba(235,238,241,1)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 32); ctx.lineTo(32, 0); ctx.lineTo(64, 32); ctx.lineTo(32, 64); ctx.closePath(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-32, 32); ctx.lineTo(0, 0); ctx.moveTo(0, 64); ctx.lineTo(32, 96); ctx.moveTo(64, 0); ctx.lineTo(96, 32); ctx.stroke(); }, [1, 1]);
  if (name === 'brick') TEX[name] = canvasTex(256, 128, (ctx, w, h) => { ctx.fillStyle = '#6a625b'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#8a7d72'; for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) ctx.fillRect(c * 32 + (r % 2) * 16 + 1, r * 32 + 1, 30, 30); }, [4, 2]);
  return TEX[name];
}
const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: o.r ?? .65, metalness: o.m ?? .05, map: o.map ? tex(o.map) : null, normalMap: o.nmap ? tex(o.nmap) : null, transparent: !!o.t, opacity: o.t ? o.o ?? .5 : 1, envMapIntensity: o.env ?? 1, emissive: o.e ?? 0x000000, emissiveIntensity: o.ei ?? 1 });
const WHITE = 0xe7eaed, DARK = 0x2b3238, STEEL = 0x9aa5ad, TEAL = 0x1b6f8e, ORANGE = 0xd9822b, GREEN = 0x1e9a6e, RED = 0xa6392a, BLUE = 0x0072b2, YEL = 0xe6a532;
function box(w, h, d, color, o){ const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, o)); m.castShadow = m.receiveShadow = true; return m; }
function cyl(r1, r2, h, color, o, seg = 40){ const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), mat(color, o)); m.castShadow = m.receiveShadow = true; return m; }
function tor(r, t, color, o){ const m = new THREE.Mesh(new THREE.TorusGeometry(r, t, 12, 64), mat(color, o)); m.castShadow = true; return m; }
const at = (m, x, y, z) => { m.position.set(x, y, z); return m; };
const rotX = (m, a) => { m.rotation.x = a; return m; }, rotZ = (m, a) => { m.rotation.z = a; return m; };
function pipe(points, r = .18, color = STEEL){   // a pipe run through a list of points, with elbow spheres
  const g = new THREE.Group(); for (let i = 0; i < points.length - 1; i++) { const a = new THREE.Vector3(...points[i]), b = new THREE.Vector3(...points[i + 1]), d = b.clone().sub(a), l = d.length(); const c = cyl(r, r, l, color, { m: .4, r: .35 }, 16); c.position.copy(a).add(d.multiplyScalar(.5)); c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); g.add(c); const s = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 12), mat(color, { m: .4, r: .35 })); s.position.copy(a); g.add(s); } const e = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 12), mat(color, { m: .4, r: .35 })); e.position.set(...points[points.length - 1]); g.add(e); return g; }
function ladder(h, x, z, ry = 0){ const g = new THREE.Group(); for (const s of [-.25, .25]) g.add(at(cyl(.04, .04, h, STEEL, { m: .6, r: .4 }, 8), s, h / 2, 0)); for (let y = .3; y < h; y += .35) g.add(rotZ(at(cyl(.03, .03, .5, STEEL, { m: .6, r: .4 }, 8), 0, y, 0), Math.PI / 2)); g.position.set(x, 0, z); g.rotation.y = ry; return g; }
function fence(w, d, h = 2.2){   // chain-link: posts + four transparent panels with a fine mesh texture
  const g = new THREE.Group(); const post = (x, z) => g.add(at(cyl(.05, .05, h, STEEL, { m: .5, r: .4 }, 8), x, h / 2, z)); for (let x = -w / 2; x <= w / 2 + .01; x += 3) { post(x, -d / 2); post(x, d / 2); } for (let z = -d / 2 + 3; z < d / 2; z += 3) { post(-w / 2, z); post(w / 2, z); }
  const link = new THREE.MeshStandardMaterial({ map: tex('chainlink'), transparent: true, alphaTest: .5, side: THREE.DoubleSide, roughness: .5, metalness: .6, color: 0xd8dde2 });
  const panel = (len, x, z, ry) => { const t = tex('chainlink').clone(); t.needsUpdate = true; t.repeat.set(len * 3, h * 3); const m = new THREE.Mesh(new THREE.PlaneGeometry(len, h * .92), link.clone()); m.material.map = t; m.position.set(x, h * .48, z); m.rotation.y = ry; m.castShadow = false; g.add(m); };
  panel(w, 0, -d / 2, 0); panel(w, 0, d / 2, 0); panel(d, -w / 2, 0, Math.PI / 2); panel(d, w / 2, 0, Math.PI / 2);
  g.add(at(box(w, .04, .04, STEEL, { m: .6 }), 0, h, -d / 2)); g.add(at(box(w, .04, .04, STEEL, { m: .6 }), 0, h, d / 2)); g.add(at(box(.04, .04, d, STEEL, { m: .6 }), -w / 2, h, 0)); g.add(at(box(.04, .04, d, STEEL, { m: .6 }), w / 2, h, 0));   // top rail
  return g; }
function bollards(pts){ const g = new THREE.Group(); pts.forEach(([x, z]) => { g.add(at(cyl(.12, .12, 1, YEL, { r: .5 }, 12), x, .5, z)); }); return g; }
function skid(x, z, w = 3.2, kind = 'inverter'){   // inverter / transformer skids beside the batteries
  const g = new THREE.Group(); g.add(at(box(w, .25, 2.2, STEEL, { m: .5, r: .5 }), 0, .12, 0));
  if (kind === 'transformer') { g.add(at(box(w * .6, 2, 1.6, 0x6b7379, { m: .6, r: .45 }), 0, 1.25, 0)); for (let i = 0; i < 7; i++) g.add(at(box(.08, 1.6, 1.7, 0x5a6169, { m: .6, r: .45 }), -w * .28 + i * w * .093, 1.2, 0)); for (const dx of [-.5, 0, .5]) g.add(at(cyl(.06, .06, .8, 0xb0a48a, { r: .5 }, 10), dx, 2.6, 0)); }
  else { g.add(at(box(w * .8, 2.1, 1.4, WHITE, { r: .55 }), 0, 1.3, 0)); g.add(at(box(w * .8 + .02, .12, 1.42, DARK), 0, 2.4, 0)); for (let i = 0; i < 3; i++) g.add(at(box(.5, .9, .02, 0x1f2429, { m: .2, r: .3 }), -w * .25 + i * w * .25, 1.2, .72)); g.add(at(box(.1, .1, .1, GREEN, { e: GREEN, ei: 2 }), w * .3, 2.1, .72)); }
  g.position.set(x, 0, z); return g;
}
function hvacUnit(x, y, z){ const g = new THREE.Group(); g.add(at(box(1.1, .22, 1.5, 0x1f2429, { m: .4, r: .5 }), 0, 0, 0)); const fan = at(cyl(.36, .36, .06, 0x111417, { m: .3, r: .6 }, 24), 0, .14, 0); const ring = at(tor(.38, .025, 0x8a8f94, { m: .6, r: .4 }), 0, .14, 0); ring.rotation.x = Math.PI / 2; g.add(fan); g.add(ring); for (let i = 0; i < 5; i++) { const b = box(.6, .01, .06, 0x2b3238); b.rotation.y = i / 5 * Math.PI; b.position.y = .18; fan.add(b); } g.position.set(x, y, z); return g; }
function container(trim, hot){
  const u = new THREE.Group();
  const wall = mat(WHITE, { map: 'corrugated', nmap: 'corrugatedN', r: .55, m: .25 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.6, 6), [wall, wall, mat(WHITE, { r: .6 }), mat(WHITE, { r: .6 }), wall, wall]); body.castShadow = body.receiveShadow = true; u.add(at(body, 0, 1.4, 0));
  u.add(at(box(2.7, .12, 6.1, hot ? 0x3a2a24 : DARK, { m: .3, r: .5 }), 0, 2.76, 0));                                 // roof
  u.add(at(box(2.62, .12, 6.02, 0x1a1e22, { m: .3 }), 0, .06, 0));                                                        // skid
  u.add(at(box(2.64, .42, .04, trim, { m: .2, r: .5 }), 0, .5, 3.0));                                                    // trim band
  for (const zz of [-2.2, -.9, .4, 1.7]) u.add(hvacUnit(.45, 2.95, zz));                                                  // roof HVAC / vents
  u.add(at(box(.9, 1.9, .03, 0xcfd5da, { m: .4, r: .4 }), -.6, 1.15, 3.02)); u.add(at(box(.02, .5, .02, DARK), -.2, 1.2, 3.05));   // door + handle
  for (const zz of [-2.4, -1.2, 0, 1.2, 2.4]) u.add(at(box(.02, 2.2, .02, 0xb7bdc3), -1.31, 1.4, zz));                   // panel seams
  u.add(at(box(.1, .1, .1, hot ? RED : GREEN, { e: hot ? RED : GREEN, ei: 2.5 }), 1.05, 2.2, 3.03));                    // status LED
  u.add(at(box(.14, .08, 6, 0x6b7379, { m: .6, r: .4 }), 1.4, 2.5, 0));                                                  // cable tray
  return u;
}
function containers(n, trim = TEAL, cols = 5, hot = false){
  const g = new THREE.Group(); const rows = Math.ceil(n / cols);
  for (let i = 0; i < n; i++) { const r = Math.floor(i / cols), c = i % cols; const u = container(trim, hot); u.position.set((c - (cols - 1) / 2) * 3.4, 0, (r - (rows - 1) / 2) * 7.2); g.add(u); }
  g.add(skid(-(cols - 1) / 2 * 3.4 - 4.2, 0, 3.2, 'inverter')); g.add(skid(-(cols - 1) / 2 * 3.4 - 4.2, 4.2, 3.2, 'transformer'));
  g.add(bollards([[-(cols - 1) / 2 * 3.4 - 6.3, -1.4], [-(cols - 1) / 2 * 3.4 - 6.3, 1.4], [-(cols - 1) / 2 * 3.4 - 6.3, 4.2]]));
  g.add(fence(cols * 3.4 + 10, rows * 7.2 + 5)); return g;
}
function tank(r, h, x, z, color = WHITE, o = {}){ const g = new THREE.Group(); g.add(at(cyl(r, r, h, color, { map: o.insul ? 'insul' : null, r: .5, m: .2 }), 0, h / 2, 0)); g.add(at(cyl(r + .05, r + .05, .12, DARK, { m: .4 }), 0, h + .05, 0)); g.add(at(cyl(r + .08, r + .08, .25, DARK, { m: .4 }), 0, .12, 0)); g.add(ladder(h, r + .05, 0)); const man = at(cyl(.3, .3, .2, STEEL, { m: .6, r: .35 }, 16), 0, h + .2, r * .6); g.add(man); const rail = at(tor(r - .1, .03, STEEL, { m: .6, r: .35 }), 0, h + 1.0, 0); rail.rotation.x = Math.PI / 2; g.add(rail); for (let i = 0; i < 12; i++) g.add(at(cyl(.025, .025, 1, STEEL, { m: .6 }, 6), Math.cos(i / 12 * Math.PI * 2) * (r - .1), h + .5, Math.sin(i / 12 * Math.PI * 2) * (r - .1))); g.position.set(x, 0, z); return g; }
function flow(){
  const g = new THREE.Group();
  g.add(tank(3.2, 5.2, -6.5, 0)); g.add(tank(3.2, 5.2, 6.5, 0)); g.add(at(box(2.6, .3, 6.5, TEAL, { m: .2 }), -6.5, 5.4, 0)); g.add(at(box(2.6, .3, 6.5, ORANGE, { m: .2 }), 6.5, 5.4, 0));
  const stack = at(box(4.2, 3, 4.2, DARK, { m: .35, r: .45 }), 0, 1.5, 0); g.add(stack); for (let i = 0; i < 8; i++) g.add(at(box(3.8, .06, .1, STEEL, { m: .7, r: .3 }), 0, .4 + i * .32, 2.12));
  g.add(pipe([[-3.3, 3.4, 0], [-2.2, 3.4, 0], [-2.2, 2.2, 0]], .16)); g.add(pipe([[3.3, 3.4, 0], [2.2, 3.4, 0], [2.2, 2.2, 0]], .16));
  g.add(pipe([[-3.3, .8, 1.2], [-2.3, .8, 1.2]], .14, ORANGE)); g.add(pipe([[3.3, .8, -1.2], [2.3, .8, -1.2]], .14, TEAL));
  for (const x of [-3.2, 3.2]) { g.add(at(box(1.2, .8, 1.2, 0x5a6169, { m: .6, r: .4 }), x, .4, 4.2)); g.add(at(cyl(.35, .35, 1.0, STEEL, { m: .6, r: .35 }, 16), x, 1.1, 4.2)); }   // pumps
  g.add(skid(0, -7.5, 4, 'inverter')); g.add(fence(24, 20)); return g;
}
function ironair(){ const g = new THREE.Group(); for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) { const x = (c - 3.5) * 1.6, z = (r - 1.5) * 4.2; g.add(at(box(1.15, 2.4, 2.8, WHITE, { map: 'corrugated', r: .55, m: .2 }), x, 1.2, z)); g.add(at(box(1.18, .1, 2.84, 0x8c6d1f, { m: .3 }), x, 2.45, z)); g.add(at(box(.06, .06, .06, GREEN, { e: GREEN, ei: 2 }), x + .45, 2.1, z + 1.42)); } for (let r = 0; r < 4; r++) g.add(at(box(13.6, .1, .12, 0x6b7379, { m: .6 }), 0, 2.55, (r - 1.5) * 4.2)); g.add(skid(-9.5, 0, 3, 'inverter')); g.add(skid(9.5, 0, 3, 'transformer')); g.add(fence(26, 22)); return g; }
function pumpedHydro(){
  const g = new THREE.Group();
  const hill = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 12, 6.5, 48), mat(0x5f7a4b, { map: 'grass', r: .95 })); hill.castShadow = hill.receiveShadow = true; g.add(at(hill, 6, 3.25, -2));
  g.add(at(cyl(5.6, 5.6, .5, 0x8fc6e6, { map: 'water', r: .12, m: .05, env: 1.6 }, 48), 6, 6.45, -2));                              // upper reservoir
  g.add(at(box(9, 2.2, 1.2, 0xb9b6ae, { map: 'concrete', r: .8 }), 6, 5.6, 3.6));                                         // dam crest
  g.add(at(cyl(6.5, 6.5, .35, 0x8fc6e6, { map: 'water', r: .12, m: .05, env: 1.6 }, 48), -9, .17, 3));                              // lower reservoir
  g.add(pipe([[3.5, 6.0, 1.2], [-1.5, 3.2, 1.6], [-6.5, 1.3, 0.2]], .4, 0x6b7379));                                        // penstock
  const ph = new THREE.Group(); ph.add(at(box(4.2, 2.6, 3.2, WHITE, { map: 'corrugated', r: .55, m: .2 }), 0, 1.3, 0)); ph.add(at(box(4.3, .18, 3.3, DARK, { m: .3 }), 0, 2.7, 0)); ph.add(at(box(.9, 1.8, .03, 0xcfd5da), 0, 1.0, 1.62)); ph.position.set(-8.5, 0, -2); g.add(ph);   // powerhouse
  g.add(skid(-13, 0, 3, 'transformer')); for (let i = 0; i < 3; i++) { const p = at(cyl(.06, .06, 6, STEEL, { m: .6 }, 8), -13 + i * 1.2, 3, -5); g.add(p); }  // pylons
  return g;
}
function caes(){
  const g = new THREE.Group();
  const cav = new THREE.Mesh(new THREE.SphereGeometry(5, 32, 24), mat(0x8a7358, { t: true, o: .3, r: .9 })); cav.position.set(0, -4.6, 0); cav.scale.set(1, .9, 1); g.add(cav);
  g.add(pipe([[0, -2, 0], [0, 2.2, 0], [-2.5, 2.2, 0], [-3.9, 2.2, 0]], .28)); g.add(pipe([[0, 1.6, 0], [2.5, 1.6, 0], [3.9, 1.6, 0]], .28));
  for (const [x, lab] of [[-6.5, 'compressor'], [6.5, 'expander']]) { g.add(at(box(5.2, 3, 3.6, WHITE, { map: 'corrugated', r: .55, m: .2 }), x, 1.5, 0)); g.add(at(box(5.3, .18, 3.7, DARK, { m: .3 }), x, 3.1, 0)); for (let i = 0; i < 3; i++) g.add(at(cyl(.22, .22, .5, 0x6b7379, { m: .5 }, 12), x - 1.5 + i * 1.5, 3.4, .8)); g.add(at(box(.9, 1.9, .03, 0xcfd5da), x, 1.0, 1.82)); }
  g.add(tank(2.2, 3.8, 0, -7, WHITE, { insul: true })); g.add(pipe([[-1.5, 2.6, -5.8], [-1.5, 2.6, -2.2], [-3.9, 2.6, -2.2]], .18, ORANGE));   // thermal store + hot pipe
  g.add(at(cyl(.5, .5, .8, STEEL, { m: .6, r: .35 }, 20), 0, 2.4, 0)); g.add(skid(11.5, 0, 3, 'transformer')); g.add(fence(30, 22)); return g;
}
function liquidAir(){ const g = new THREE.Group(); g.add(tank(2.4, 8, -5.5, 0, WHITE, { insul: true })); g.add(tank(2.4, 8, 0, 0, WHITE, { insul: true }));
  const cb = new THREE.Group(); cb.add(at(box(4, 5, 4, STEEL, { m: .6, r: .35 }), 0, 2.5, 0)); for (let y = .5; y < 5; y += 1.1) cb.add(at(box(4.05, .08, 4.05, 0x5a6169, { m: .6 }), 0, y, 0)); cb.add(pipe([[0, 5, 0], [0, 6.2, 0], [1.4, 6.2, 0], [1.4, 4.8, 0]], .14)); cb.position.set(6, 0, 0); g.add(cb);
  g.add(at(box(6, 2.6, 3.2, WHITE, { map: 'corrugated', r: .55, m: .2 }), 3, 1.3, 6.5)); g.add(at(box(6.1, .18, 3.3, DARK, { m: .3 }), 3, 2.7, 6.5)); g.add(pipe([[-5.5, 1.2, 2.4], [-5.5, 1.2, 5.0], [1, 1.2, 5.0]], .16)); g.add(skid(10, 0, 3, 'transformer')); g.add(fence(28, 20)); return g; }
function flywheel(){ const g = new THREE.Group(); g.add(at(cyl(3.4, 3.4, .4, 0xb9b6ae, { map: 'concrete', r: .85 }, 48), 0, .2, 0)); const h = at(cyl(3.0, 3.0, 3.4, STEEL, { m: .75, r: .3 }), 0, 2.1, 0); g.add(h); for (let i = 0; i < 16; i++) g.add(at(cyl(.08, .08, .3, DARK, { m: .6 }, 8), Math.cos(i / 16 * Math.PI * 2) * 3.05, 3.85, Math.sin(i / 16 * Math.PI * 2) * 3.05));   // bolted lid
  const d = cyl(2.3, 2.3, 2.2, 0x3a4249, { m: .85, r: .25 }); d.name = 'spin'; g.add(at(d, 0, 5.0, 0)); for (let i = 0; i < 12; i++) { const s = box(.25, 2.0, .5, 0x4e585f, { m: .8, r: .3 }); s.position.set(Math.cos(i / 12 * Math.PI * 2) * 2.05, 0, Math.sin(i / 12 * Math.PI * 2) * 2.05); s.rotation.y = -i / 12 * Math.PI * 2; d.add(s); }
  g.add(at(cyl(.25, .25, 3, STEEL, { m: .8, r: .25 }, 16), 0, 6.2, 0)); g.add(pipe([[3.0, 2.4, 0], [4.6, 2.4, 0], [4.6, 1.2, 0]], .1)); g.add(skid(6.5, 0, 3.2, 'inverter')); g.add(bollards([[-4.2, -4.2], [4.2, -4.2], [-4.2, 4.2]])); return g; }
function hydrogen(){ const g = new THREE.Group(); [-6.5, -2.2, 2.2, 6.5].forEach(x => { const t = rotZ(cyl(1.25, 1.25, 7.5, WHITE, { r: .45, m: .3 }), Math.PI / 2); g.add(at(t, x, 1.7, -4.5)); for (const dz of [-2.4, 2.4]) g.add(at(box(2.8, .9, .5, 0xb9b6ae, { map: 'concrete', r: .85 }), x, .45, -4.5 + dz)); g.add(at(cyl(.15, .15, 1.2, STEEL, { m: .6 }, 10), x, 3.4, -4.5)); });
  g.add(pipe([[-6.5, 3.1, -4.5], [-6.5, 3.6, -4.5], [6.5, 3.6, -4.5], [6.5, 3.1, -4.5]], .12)); g.add(pipe([[0, 3.6, -4.5], [0, 3.6, 0], [0, 1.6, 0]], .14));
  const hall = new THREE.Group(); hall.add(at(box(6.5, 3.2, 4.2, WHITE, { map: 'corrugated', r: .55, m: .2 }), 0, 1.6, 0)); hall.add(at(box(6.6, .2, 4.3, TEAL, { m: .3 }), 0, 3.3, 0)); hall.add(at(box(5.5, .7, .03, 0x1f2429, { m: .2, r: .3 }), 0, 2.2, 2.12)); hall.add(at(box(.9, 1.9, .03, 0xcfd5da), -2.2, 1.0, 2.12)); hall.position.set(-3, 0, 3.5); g.add(hall);   // electrolyser hall
  const tb = new THREE.Group(); tb.add(at(box(5, 2.8, 3.4, STEEL, { m: .6, r: .35 }), 0, 1.4, 0)); tb.add(at(cyl(.45, .45, 5.5, STEEL, { m: .6, r: .35 }, 16), 1.6, 5.2, 0)); tb.add(at(box(2, 1.2, 2, 0x5a6169, { m: .6 }), -1.5, 3.4, 0)); tb.position.set(6, 0, 3.5); g.add(tb);   // reconversion turbine + stack
  g.add(skid(11.5, 0, 3, 'transformer')); g.add(fence(30, 20)); return g; }
function heatBattery(){ const g = new THREE.Group(); const blk = new THREE.Mesh(new THREE.BoxGeometry(8, 5, 6), [mat(0xc9ccd1, { map: 'insul', r: .6, m: .3 }), mat(0xc9ccd1, { map: 'insul', r: .6, m: .3 }), mat(0xd6d9dd, { r: .5, m: .3 }), mat(0xd6d9dd, { r: .5 }), mat(0xc9ccd1, { map: 'insul', r: .6, m: .3 }), mat(0xc9ccd1, { map: 'insul', r: .6, m: .3 })]); blk.castShadow = blk.receiveShadow = true; g.add(at(blk, 0, 2.5, 0));
  g.add(at(box(8.3, .25, 6.3, STEEL, { m: .6, r: .35 }), 0, 5.15, 0)); g.add(at(box(.6, 3.2, 5.9, 0x6a625b, { map: 'brick', r: .9 }), 4.02, 2.2, 0));                               // exposed brick core at the open face
  for (let i = 0; i < 6; i++) g.add(at(box(.18, 4.2, .18, RED, { e: 0xff6a3d, ei: 1.6, r: .4 }), -3.2 + i * 1.3, 2.7, 3.12));                                                       // heater elements
  g.add(pipe([[4.3, 4.4, 1], [7.5, 4.4, 1], [7.5, 1.8, 1]], .3, 0xd6d9dd)); g.add(pipe([[-4.3, 1.2, 1.5], [-6.5, 1.2, 1.5]], .18));                                                    // steam out, power in
  g.add(at(box(3.4, 2.4, 3, WHITE, { map: 'corrugated', r: .55, m: .2 }), 9.8, 1.2, 1)); g.add(at(box(3.5, .18, 3.1, DARK, { m: .3 }), 9.8, 2.5, 1)); g.add(skid(-8.5, 0, 3, 'transformer')); g.add(fence(28, 16)); return g; }
function moltenSalt(){ const g = new THREE.Group(); g.add(tank(3, 5, -5.5, 0, 0xc9ccd1, { insul: true })); g.add(tank(3, 5, 5.5, 0, 0xc9ccd1, { insul: true })); g.add(at(box(2.6, .3, 6.2, 0xc9a24a, { m: .2 }), -5.5, 5.2, 0)); g.add(at(box(2.6, .3, 6.2, 0x8fb3c9, { m: .2 }), 5.5, 5.2, 0));
  g.add(at(box(3.2, 2.8, 3.2, STEEL, { m: .6, r: .35 }), 0, 1.4, 0)); for (let i = 0; i < 4; i++) g.add(at(box(.1, 2.2, .1, RED, { e: 0xff6a3d, ei: 1.4 }), -1.2 + i * .8, 1.4, 1.62)); g.add(pipe([[-2.5, 3.8, 0], [-1.6, 3.8, 0], [-1.6, 2.8, 0]], .18, 0xc9a24a)); g.add(pipe([[2.5, 3.8, 0], [1.6, 3.8, 0], [1.6, 2.8, 0]], .18, 0x8fb3c9));
  g.add(at(box(4, 2.4, 3, WHITE, { map: 'corrugated', r: .55, m: .2 }), 0, 1.2, 6.5)); g.add(at(box(4.1, .18, 3.1, DARK, { m: .3 }), 0, 2.5, 6.5)); g.add(pipe([[0, 2.8, 1.6], [0, 2.8, 5.0]], .22, 0xd6d9dd)); g.add(fence(24, 20)); return g; }
function racks(){ const g = new THREE.Group(); for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) { const x = (c - 2.5) * 1.35, z = (r - 1) * 3.2; g.add(at(box(.95, 2.3, .75, DARK, { m: .4, r: .5 }), x, 1.15, z)); for (let k = 0; k < 7; k++) { g.add(at(box(.82, .24, .04, 0x3a4249, { m: .5, r: .4 }), x, .25 + k * .3, z + .385)); g.add(at(box(.05, .05, .02, k % 2 ? TEAL : GREEN, { e: k % 2 ? TEAL : GREEN, ei: 2 }), x + .32, .25 + k * .3, z + .41)); } } for (let r = 0; r < 3; r++) g.add(at(box(8.4, .1, .12, 0x6b7379, { m: .6 }), 0, 2.45, (r - 1) * 3.2)); g.add(at(box(9, .06, 8, 0x4a4f55, { map: 'grate', r: .7, m: .4 }), 0, .03, 0)); g.add(skid(6.5, 0, 3, 'inverter')); return g; }
const BUILDERS = { containers: () => containers(10), containersHot: () => containers(8, RED, 4, true), flow, ironair, phs: pumpedHydro, caes, laes: liquidAir, fly: flywheel, h2: hydrogen, heat: heatBattery, salt: moltenSalt, racks, leadacid: () => containers(6, 0x8a8f94, 3) };

export function mountStorageScene(canvas){
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene(); const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromEquirectangular(makeSkyTexture()).texture; pm.dispose();
  const camera = new THREE.PerspectiveCamera(32, 1, .1, 200); camera.position.set(0, 17, 28); camera.lookAt(0, 1.5, 0);
  scene.add(new THREE.HemisphereLight(0xeaf2f8, 0x7f8a7a, .9));
  const sun = new THREE.DirectionalLight(0xfff3e0, 2.4); sun.position.set(22, 30, 14); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 90 }); sun.shadow.bias = -.0006; sun.shadow.normalBias = .02; scene.add(sun);
  const fill = new THREE.DirectionalLight(0xa0bcd6, .5); fill.position.set(-20, 12, -10); scene.add(fill);
  const table = new THREE.Group(); scene.add(table);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(15, 15.4, .6, 96), mat(0x1c2126, { r: .9 })); base.receiveShadow = true; table.add(at(base, 0, -.3, 0));
  const ring = tor(15.15, .12, YEL, { m: .4, r: .3 }); ring.rotation.x = Math.PI / 2; table.add(at(ring, 0, .05, 0));
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(12.5, 12.5, .3, 96), mat(0xb9b6ae, { map: 'concrete', r: .9 })); pad.receiveShadow = true; table.add(at(pad, 0, .15, 0));
  const road = new THREE.Mesh(new THREE.RingGeometry(12.5, 14.6, 96), mat(0x3a3d40, { map: 'asphalt', r: .95 })); road.rotation.x = -Math.PI / 2; road.receiveShadow = true; table.add(at(road, 0, .02, 0));
  const holder = new THREE.Group(); holder.position.y = .3; table.add(holder);
  let spin = null, turning = true, tech = null, dragging = false, lastX = 0, vel = 0;
  function resize(){ const w = canvas.clientWidth || 800, h = canvas.clientHeight || 600; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  new ResizeObserver(resize).observe(canvas); resize();
  canvas.addEventListener('pointerdown', e => { dragging = true; lastX = e.clientX; turning = false; canvas.setPointerCapture(e.pointerId); });   // drag to turn, wheel to zoom
  canvas.addEventListener('pointermove', e => { if (!dragging) return; vel = (e.clientX - lastX) * .006; table.rotation.y += vel; lastX = e.clientX; });
  canvas.addEventListener('pointerup', () => { dragging = false; setTimeout(() => { if (!dragging) turning = true; }, 4000); });
  canvas.addEventListener('wheel', e => { e.preventDefault(); const k = Math.exp(e.deltaY * .0012); camera.position.multiplyScalar(k); const d = camera.position.length(); if (d < 14) camera.position.setLength(14); if (d > 60) camera.position.setLength(60); camera.lookAt(0, 1.5, 0); }, { passive: false });
  let camDist = 33;
  function fit(g){ const bb = new THREE.Box3().setFromObject(g), sz = bb.getSize(new THREE.Vector3()); const r = Math.max(sz.x, sz.z) * .5 * 1.15 + sz.y * .6; camDist = Math.max(20, Math.min(60, r / Math.tan(camera.fov * Math.PI / 360) * .95)); camera.position.setLength(camDist); camera.lookAt(0, sz.y * .35, 0); }
  const clock = new THREE.Clock(); let alive = true;
  function frame(){ if (!alive) return; const dt = Math.min(.05, clock.getDelta()); if (turning) table.rotation.y += dt * .1; if (spin) spin.rotation.y += dt * 7; renderer.render(scene, camera); requestAnimationFrame(frame); }
  frame();
  return {
    setTech(model){ if (model === tech) return; tech = model; holder.clear(); const b = BUILDERS[model] || BUILDERS.containers; const g = b(); g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); holder.add(g); spin = g.getObjectByName('spin') || null; fit(g); },
    setTurning(on){ turning = !!on; },
    view(kind){ if (kind === 'top') camera.position.set(0, 1, .0001); else camera.position.set(0, 17, 28); camera.position.setLength(camDist); camera.lookAt(0, 1.5, 0); },
    dispose(){ alive = false; renderer.dispose(); }
  };
}
