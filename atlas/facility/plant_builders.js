// DERIVED from the Claude-Design facility page (scene module, lines 1-1160): palette, materials, subsystem builders, subsystem table.
// Unchanged apart from the import line. Regenerate with tools/port_plant_scene.py; do not edit by hand.

import * as THREE from './three.module.js';
// =============================================================
// HOPS · Subsystem geometry library
// Each builder returns { group, update?, bounds } for a single
// subsystem of the hybrid ammonia plant.
// =============================================================



// ------------------------------------------------------------------
// Shared palette + material helpers
// ------------------------------------------------------------------
export const PALETTE = {
  // structure / buildings
  shell:      0xeef0f2,
  shellWarm:  0xf2e9d6,
  shellDark:  0x46525e,
  base:       0x3a4651,
  concrete:   0xb2b8be,
  metal:      0xc8d0d8,
  metalDark:  0x6a7682,
  glass:      0x8fc7e8,
  // flows / accents
  elec:       0xffb547,
  h2:         0x66d9ff,
  n2:         0x6be0b6,
  ng:         0xff8a4c,
  nh3:        0xb691ff,
  co2:        0x8b96a2,
  heat:       0xff6b6b,
  // ground
  ground:     0x6a6258,
  pad:        0x3a4048,
  padLight:   0x4a525c,
  paint:      0xffb547,
};

const _mats = new Map();
export function mat(color, opts = {}){
  const key = `${color}|${JSON.stringify(opts)}`;
  if (_mats.has(key)) return _mats.get(key);
  const m = new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.6,
    metalness: opts.metalness ?? 0.1,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    side: opts.side ?? THREE.FrontSide,
    flatShading: opts.flat ?? false,
    envMapIntensity: opts.envMapIntensity ?? 0.7,
  });
  _mats.set(key, m);
  return m;
}

// box helper
function box(w, h, d, material){
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function cyl(rT, rB, h, seg, material){
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rT, rB, h, seg ?? 24), material);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function sphere(r, material, seg = 24){
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.floor(seg/1.5)), material);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

// Build a structural concrete pad under any subsystem so it grounds visually
function pad(w, d, h = 0.3, color = PALETTE.pad){
  const p = box(w, h, d, mat(color, {roughness:0.9, metalness:0}));
  p.position.y = h/2;
  return p;
}

// Small label baked into 3d not used; labels are drawn via DOM/sprites externally
// =============================================================
// Building blocks (reused components)
// =============================================================

// railed walkway/platform on top of a tower
function platform(r, color = PALETTE.metalDark){
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(r, 0.06, 8, 32),
    mat(color, {metalness:0.4, roughness:0.5})
  );
  ring.rotation.x = Math.PI/2;
  g.add(ring);
  const floor = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, 0.08, 24),
    mat(color, {metalness:0.4, roughness:0.5})
  );
  g.add(floor);
  return g;
}

// piping/ladder strip
function ladder(h, color = PALETTE.metalDark){
  const g = new THREE.Group();
  const rails = box(0.05, h, 0.4, mat(color, {metalness:0.5, roughness:0.5}));
  g.add(rails);
  return g;
}

// =============================================================
// 1. SOLAR PV FIELD
// =============================================================
export function buildSolarPV(){
  const g = new THREE.Group();
  const rows = 4, cols = 8;
  const panelW = 2.4, panelH = 1.3, gapX = 0.4, gapZ = 3.0;
  const tilt = -Math.PI / 5;

  const fieldW = cols * (panelW + gapX);
  const fieldD = rows * gapZ;

  g.add(pad(fieldW + 3, fieldD + 3, 0.15, PALETTE.padLight));

  for (let r = 0; r < rows; r++){
    for (let c = 0; c < cols; c++){
      const x = -fieldW/2 + c * (panelW + gapX) + panelW/2;
      const z = -fieldD/2 + r * gapZ + 0.6;

      // post
      const post = cyl(0.05, 0.05, 1.0, 8, mat(PALETTE.metalDark));
      post.position.set(x, 0.5, z);
      g.add(post);

      // panel (dark blue cells on a frame)
      const frame = box(panelW, 0.08, panelH, mat(0x1c2733, {roughness:0.4}));
      const cells = box(panelW * 0.94, 0.05, panelH * 0.9, mat(0x0d2540, {roughness:0.2, metalness:0.3, emissive:0x0e2b54, emissiveIntensity:0.4}));
      cells.position.y = 0.03;
      const panel = new THREE.Group();
      panel.add(frame); panel.add(cells);
      panel.position.set(x, 1.1, z);
      panel.rotation.x = tilt;
      g.add(panel);

      // tiny grid lines
      for (let i = 1; i < 4; i++){
        const line = box(panelW * 0.94, 0.06, 0.015, mat(0x1c2733));
        line.position.set(0, 0.04, -panelH * 0.45 + (i * panelH * 0.9 / 4));
        panel.add(line);
      }
    }
  }

  return {
    group: g,
    bounds: new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(0,1,0), new THREE.Vector3(fieldW+3, 3, fieldD+3))
  };
}

// =============================================================
// 2. WIND TURBINES (cluster)
// =============================================================
export function buildWindTurbines(){
  const g = new THREE.Group();
  const positions = [
    [-7, 0, 0],
    [ 7, 0, -4],
    [ 0, 0, 6],
  ];

  const rotors = [];
  positions.forEach(([x,_y,z], i) => {
    const t = new THREE.Group();
    t.position.set(x, 0, z);

    // base
    const base = cyl(1.4, 1.6, 0.4, 16, mat(PALETTE.concrete));
    base.position.y = 0.2;
    t.add(base);

    // tower (tapered)
    const tower = cyl(0.4, 0.9, 18, 16, mat(PALETTE.shell, {roughness:0.3, metalness:0.05}));
    tower.position.y = 9.4;
    t.add(tower);

    // nacelle
    const nacelleGroup = new THREE.Group();
    nacelleGroup.position.set(0, 18.6, 0);
    const nacelle = box(2.6, 1.1, 1.1, mat(PALETTE.shell, {roughness:0.3}));
    nacelle.position.x = -0.3;
    nacelleGroup.add(nacelle);
    // nose
    const nose = cyl(0.3, 0.5, 0.7, 12, mat(PALETTE.shell, {roughness:0.3}));
    nose.rotation.z = Math.PI/2;
    nose.position.x = 1.4;
    nacelleGroup.add(nose);
    t.add(nacelleGroup);

    // rotor (hub + 3 tapered airfoil blades)
    const rotor = new THREE.Group();
    rotor.position.set(1.7, 18.6, 0);
    const hub = sphere(0.4, mat(PALETTE.shell, {roughness:0.35}), 16);
    hub.scale.z = 1.4;
    rotor.add(hub);
    for (let b = 0; b < 3; b++){
      // tapered blade: a thin lathe-like shape from root to tip
      const bladeShape = new THREE.Shape();
      bladeShape.moveTo(0, -0.35);
      bladeShape.lineTo(0.06, -0.45);
      bladeShape.lineTo(0.06, 8.0);
      bladeShape.lineTo(0, 8.5);
      bladeShape.lineTo(-0.04, 8.0);
      bladeShape.lineTo(-0.10, 0);
      bladeShape.lineTo(-0.14, -0.45);
      bladeShape.closePath();
      const blade = new THREE.Mesh(
        new THREE.ExtrudeGeometry(bladeShape, {depth:0.12, bevelEnabled:true, bevelThickness:0.04, bevelSize:0.04, bevelSegments:1, steps:1}),
        mat(PALETTE.shell, {roughness:0.32, metalness:0.05})
      );
      blade.castShadow = true;
      // taper the width along length
      blade.scale.x = 1.0;
      const bladeWrap = new THREE.Group();
      bladeWrap.add(blade);
      // subtle twist + coning
      blade.rotation.y = 0.18;
      bladeWrap.rotation.z = (b * Math.PI * 2 / 3);
      rotor.add(bladeWrap);
    }
    rotor.rotation.y = Math.PI/2; // face -x direction
    rotor.userData.speed = 0.5 + i * 0.04;
    t.add(rotor);
    rotors.push(rotor);

    g.add(t);
  });

  return {
    group: g,
    update(dt){
      for (const r of rotors) r.rotation.x += dt * r.userData.speed;
    },
    bounds: new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(0,9,0), new THREE.Vector3(24, 22, 16))
  };
}

// =============================================================
// 3. GRID SUBSTATION
// =============================================================
export function buildGridSubstation(){
  const g = new THREE.Group();
  g.add(pad(14, 10, 0.2));

  // lattice transmission tower (simplified)
  const tower = new THREE.Group();
  const segs = 4; const segH = 3;
  for (let s = 0; s < segs; s++){
    const y = s * segH;
    const w = 1.6 - s * 0.25;
    // 4 corner posts
    [[1,1],[-1,1],[1,-1],[-1,-1]].forEach(([sx,sz]) => {
      const post = cyl(0.07, 0.07, segH, 6, mat(PALETTE.metalDark, {metalness:0.5}));
      post.position.set(sx*w, y + segH/2, sz*w);
      tower.add(post);
    });
    // cross braces (X)
    const brace = box(2*w*1.4, 0.06, 0.06, mat(PALETTE.metalDark, {metalness:0.5}));
    brace.position.y = y + segH/2;
    brace.position.z = w;
    brace.rotation.y = 0;
    brace.rotation.z = Math.atan2(segH, 2*w);
    tower.add(brace);
    const brace2 = brace.clone(); brace2.rotation.z *= -1; tower.add(brace2);
  }
  // crossarms
  const ca1 = box(5, 0.1, 0.3, mat(PALETTE.metalDark));
  ca1.position.set(0, segs*segH + 0.3, 0);
  tower.add(ca1);
  const ca2 = box(7, 0.1, 0.3, mat(PALETTE.metalDark));
  ca2.position.set(0, segs*segH + 1.2, 0);
  tower.add(ca2);
  const top = cyl(0.05, 0.05, 1.4, 8, mat(PALETTE.metalDark));
  top.position.set(0, segs*segH + 2.0, 0);
  tower.add(top);

  // insulators dangling
  [-2.8,-1.4,1.4,2.8].forEach(x => {
    const ins = cyl(0.06, 0.06, 0.35, 8, mat(PALETTE.shell));
    ins.position.set(x, segs*segH + 0.05, 0);
    tower.add(ins);
  });

  tower.position.set(-3.5, 0, 0);
  g.add(tower);

  // transformer block (the boxy unit)
  const tx = new THREE.Group();
  tx.position.set(4, 0, 0);
  const body = box(3.2, 2.6, 2.4, mat(PALETTE.shell, {roughness:0.4}));
  body.position.y = 1.5;
  tx.add(body);
  // cooling fins on side
  for (let i = 0; i < 6; i++){
    const fin = box(0.06, 2.0, 2.6, mat(PALETTE.metal, {metalness:0.3}));
    fin.position.set(1.65 + 0.05, 1.5, -1.0 + i*0.4);
    tx.add(fin);
  }
  // bushings (ceramic insulators on top)
  for (let i = 0; i < 3; i++){
    const bush = cyl(0.18, 0.22, 1.4, 12, mat(PALETTE.shellWarm));
    bush.position.set(-0.8 + i*0.8, 3.4, 0);
    tx.add(bush);
  }
  // base
  const txbase = box(3.6, 0.2, 2.8, mat(PALETTE.concrete));
  txbase.position.y = 0.1;
  tx.add(txbase);
  g.add(tx);

  return {
    group: g,
    bounds: new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(0,7,0), new THREE.Vector3(16, 16, 10))
  };
}

// =============================================================
// 4. NATURAL GAS METERING / PIPELINE
// =============================================================
export function buildNaturalGas(){
  const g = new THREE.Group();
  g.add(pad(12, 8, 0.2));

  // small skid with regulators
  const skid = box(8, 0.4, 4, mat(PALETTE.concrete));
  skid.position.y = 0.4;
  g.add(skid);

  // horizontal pipes
  for (let i = 0; i < 3; i++){
    const z = -1.2 + i*1.2;
    const pipe = cyl(0.18, 0.18, 7.5, 16, mat(PALETTE.ng, {metalness:0.3, roughness:0.35}));
    pipe.rotation.z = Math.PI/2;
    pipe.position.set(0, 1.2, z);
    g.add(pipe);

    // valves
    const v1 = box(0.4, 0.5, 0.4, mat(PALETTE.metalDark));
    v1.position.set(-2.5, 1.2, z); g.add(v1);
    const v2 = box(0.4, 0.5, 0.4, mat(PALETTE.metalDark));
    v2.position.set(2.5, 1.2, z); g.add(v2);

    // valve handles
    [-2.5, 2.5].forEach(x => {
      const stem = cyl(0.04, 0.04, 0.5, 6, mat(PALETTE.metal));
      stem.position.set(x, 1.7, z); g.add(stem);
      const wheel = new THREE.Mesh(
        new THREE.TorusGeometry(0.18, 0.03, 6, 12),
        mat(PALETTE.ng, {metalness:0.2})
      );
      wheel.position.set(x, 1.95, z); g.add(wheel);
    });
  }

  // small control cabin
  const cabin = box(2, 2.4, 2, mat(PALETTE.shellWarm, {roughness:0.5}));
  cabin.position.set(-5, 1.2, 1.5); g.add(cabin);
  const roof = box(2.2, 0.15, 2.2, mat(PALETTE.shellDark));
  roof.position.set(-5, 2.4, 1.5); g.add(roof);

  // vent stack
  const stack = cyl(0.15, 0.15, 3, 12, mat(PALETTE.metal));
  stack.position.set(3, 2.7, 1.4); g.add(stack);

  return {
    group: g,
    bounds: new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(0,2,0), new THREE.Vector3(12, 5, 8))
  };
}

// =============================================================
// 5. ELECTROLYZER
// =============================================================
export function buildElectrolyzer(){
  const g = new THREE.Group();
  g.add(pad(12, 8));

  // main container building (stack of electrolyzer modules)
  const body = box(8, 4, 4, mat(PALETTE.shell, {roughness:0.45}));
  body.position.y = 2.3;
  g.add(body);

  // top deck with piping
  const deck = box(8.2, 0.2, 4.2, mat(PALETTE.shellDark));
  deck.position.y = 4.4;
  g.add(deck);

  // 6 module cells (visible vertical separators on long side)
  for (let i = 0; i < 6; i++){
    const sep = box(0.06, 3.6, 0.06, mat(PALETTE.metalDark));
    sep.position.set(-3.3 + i*1.3, 2.3, 2.02);
    g.add(sep);
  }
  // glowing H2 indicator strip
  const strip = box(7, 0.12, 0.05, mat(PALETTE.h2, {emissive:PALETTE.h2, emissiveIntensity:1.5, roughness:0.2}));
  strip.position.set(0, 0.8, 2.03);
  g.add(strip);

  // H2 stack going up
  const stack = cyl(0.22, 0.22, 4, 12, mat(PALETTE.metal, {metalness:0.4}));
  stack.position.set(3, 6.4, 0);
  g.add(stack);
  const stackCap = cyl(0.28, 0.22, 0.4, 12, mat(PALETTE.h2, {emissive:PALETTE.h2, emissiveIntensity:0.6}));
  stackCap.position.set(3, 8.6, 0);
  g.add(stackCap);

  // small water inlet tank
  const tank = cyl(0.7, 0.7, 2.5, 16, mat(PALETTE.shellWarm));
  tank.position.set(-5, 1.45, 0);
  g.add(tank);
  const tankCap = sphere(0.7, mat(PALETTE.shellWarm), 12);
  tankCap.position.set(-5, 2.7, 0);
  g.add(tankCap);

  // connecting pipes
  const p1 = cyl(0.1, 0.1, 4.2, 8, mat(PALETTE.h2, {emissive:PALETTE.h2, emissiveIntensity:0.3}));
  p1.rotation.z = Math.PI/2;
  p1.position.set(-2, 4.6, 1.6);
  g.add(p1);

  return {
    group: g,
    bounds: new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(0,3,0), new THREE.Vector3(12, 9, 6))
  };
}

// =============================================================
// 6. SMR (Steam Methane Reformer) + CCS
// =============================================================
export function buildSMR(){
  const g = new THREE.Group();
  g.add(pad(14, 10));

  // tall reformer column
  const reformer = cyl(1.0, 1.0, 12, 20, mat(PALETTE.shellWarm, {roughness:0.4}));
  reformer.position.set(-2, 6.2, 0);
  g.add(reformer);
  // top
  const rtop = sphere(1.0, mat(PALETTE.shellWarm), 16);
  rtop.position.set(-2, 12.2, 0); g.add(rtop);
  // base flange
  const rflange = cyl(1.15, 1.15, 0.3, 20, mat(PALETTE.metalDark));
  rflange.position.set(-2, 0.45, 0); g.add(rflange);

  // burner stack with flame indicator
  const stack = cyl(0.35, 0.45, 14, 12, mat(PALETTE.metal, {metalness:0.4}));
  stack.position.set(2.5, 7.2, -1.5); g.add(stack);
  const stackTip = cyl(0.4, 0.35, 0.6, 12, mat(PALETTE.shellDark));
  stackTip.position.set(2.5, 14.5, -1.5); g.add(stackTip);
  // heat shimmer
  const shimmer = cyl(0.5, 0.7, 1.2, 12, mat(PALETTE.heat, {emissive:PALETTE.heat, emissiveIntensity:1.4, transparent:true, opacity:0.4}));
  shimmer.position.set(2.5, 15.4, -1.5); g.add(shimmer);

  // smaller catalytic reactor next to it
  const cat = cyl(0.7, 0.7, 6, 16, mat(PALETTE.shell));
  cat.position.set(3.5, 3.2, 1.5); g.add(cat);
  const catTop = sphere(0.7, mat(PALETTE.shell), 12);
  catTop.position.set(3.5, 6.2, 1.5); g.add(catTop);

  // interconnecting pipes
  const pipe1 = cyl(0.12, 0.12, 5.5, 8, mat(PALETTE.ng, {emissive:PALETTE.ng, emissiveIntensity:0.2}));
  pipe1.rotation.z = Math.PI/2;
  pipe1.position.set(0.5, 3, 1.5); g.add(pipe1);

  const pipe2 = cyl(0.12, 0.12, 4, 8, mat(PALETTE.h2, {emissive:PALETTE.h2, emissiveIntensity:0.3}));
  pipe2.rotation.z = Math.PI/2;
  pipe2.position.set(0, 8, 1.0); g.add(pipe2);

  // ladder up reformer
  for (let i = 0; i < 6; i++){
    const rung = box(0.4, 0.04, 0.04, mat(PALETTE.metalDark));
    rung.position.set(-2, 1 + i*2, 1.05); g.add(rung);
  }

  return {
    group: g,
    update(dt, t){
      shimmer.scale.y = 1 + Math.sin(t*3)*0.15;
      shimmer.material.opacity = 0.3 + Math.sin(t*4)*0.1;
    },
    bounds: new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(0,8,0), new THREE.Vector3(12, 18, 8))
  };
}

// =============================================================
// 7. BATTERY BANK (Megapack-style containers)
// =============================================================
export function buildBatteryBank(){
  const g = new THREE.Group();
  const n = 5;
  const w = 2.4, h = 2.4, d = 6;
  const gap = 0.5;
  const total = n*w + (n-1)*gap;
  g.add(pad(total + 2, d + 2));

  for (let i = 0; i < n; i++){
    const x = -total/2 + i*(w+gap) + w/2;
    const c = box(w, h, d, mat(PALETTE.shell, {roughness:0.45}));
    c.position.set(x, h/2 + 0.1, 0);
    g.add(c);

    // top vent
    const vent = box(w*0.6, 0.2, 1.4, mat(PALETTE.shellDark));
    vent.position.set(x, h + 0.2, 0); g.add(vent);

    // glowing status LED
    const led = box(0.4, 0.08, 0.05, mat(PALETTE.elec, {emissive:PALETTE.elec, emissiveIntensity:2}));
    led.position.set(x, h*0.4, d/2 + 0.03); g.add(led);

    // door seam
    const door = box(w*0.6, h*0.85, 0.04, mat(PALETTE.shellDark));
    door.position.set(x, h/2 + 0.1, d/2 + 0.02); g.add(door);
  }

  // junction box
  const jbox = box(1.2, 1.8, 1.2, mat(PALETTE.shellDark));
  jbox.position.set(total/2 + 1.2, 1.0, 0);
  g.add(jbox);

  return {
    group: g,
    bounds: new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(0,2,0), new THREE.Vector3(total+3, 4, d+2))
  };
}

// =============================================================
// 8. HEAT BATTERY (thermal storage)
// =============================================================
export function buildHeatBattery(){
  const g = new THREE.Group();
  g.add(pad(10, 10));

  // big insulated cylinder
  const body = cyl(2.6, 2.6, 6, 24, mat(PALETTE.shellWarm, {roughness:0.5}));
  body.position.y = 3.2;
  g.add(body);
  const dome = sphere(2.6, mat(PALETTE.shellWarm), 20);
  dome.position.y = 6.2; dome.scale.y = 0.4;
  g.add(dome);

  // insulation rings
  for (let i = 0; i < 4; i++){
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.65, 0.08, 6, 24),
      mat(PALETTE.shellDark)
    );
    ring.rotation.x = Math.PI/2;
    ring.position.y = 1.4 + i*1.3;
    g.add(ring);
  }
  // hot strip (glow)
  const hot = new THREE.Mesh(
    new THREE.TorusGeometry(2.7, 0.12, 8, 32),
    mat(PALETTE.heat, {emissive:PALETTE.heat, emissiveIntensity:1.2})
  );
  hot.rotation.x = Math.PI/2;
  hot.position.y = 2.6;
  g.add(hot);

  // top fitting
  const cap = cyl(0.5, 0.5, 0.6, 12, mat(PALETTE.metalDark));
  cap.position.y = 7.0; g.add(cap);

  // small heat pump cabinet
  const hp = box(1.6, 2.0, 1.6, mat(PALETTE.shell));
  hp.position.set(3.6, 1.1, 0); g.add(hp);
  const hpfan = new THREE.Mesh(
    new THREE.CircleGeometry(0.55, 16),
    mat(PALETTE.shellDark)
  );
  hpfan.rotation.y = -Math.PI/2;
  hpfan.position.set(4.41, 1.2, 0); g.add(hpfan);

  return {
    group: g,
    update(dt, t){
      hot.material.emissiveIntensity = 1.0 + Math.sin(t*2)*0.4;
    },
    bounds: new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(0,4,0), new THREE.Vector3(10, 9, 8))
  };
}

// =============================================================
// 9. HYDROGEN STORAGE (spherical pressure tank)
// =============================================================
export function buildH2Storage(){
  const g = new THREE.Group();
  g.add(pad(12, 12));

  // big sphere
  const ball = sphere(3.2, mat(PALETTE.h2, {roughness:0.35, metalness:0.05}), 32);
  ball.position.y = 4.6;
  g.add(ball);

  // 6 support legs
  for (let i = 0; i < 6; i++){
    const a = (i/6) * Math.PI * 2;
    const x = Math.cos(a) * 2.4;
    const z = Math.sin(a) * 2.4;
    const leg = cyl(0.16, 0.2, 2.8, 8, mat(PALETTE.metalDark));
    leg.position.set(x, 1.4, z);
    // tilt outward slightly
    const tilt = 0.15;
    leg.rotation.x = -Math.sin(a) * tilt;
    leg.rotation.z = Math.cos(a) * tilt;
    g.add(leg);
  }
  // brace ring
  const brace = new THREE.Mesh(
    new THREE.TorusGeometry(2.4, 0.06, 6, 24),
    mat(PALETTE.metalDark)
  );
  brace.rotation.x = Math.PI/2;
  brace.position.y = 2.6;
  g.add(brace);

  // H2 label band
  const band = new THREE.Mesh(
    new THREE.TorusGeometry(3.22, 0.18, 8, 48),
    mat(PALETTE.h2, {emissive:PALETTE.h2, emissiveIntensity:0.8})
  );
  band.rotation.x = Math.PI/2;
  band.position.y = 4.6;
  g.add(band);

  // top valve
  const valve = cyl(0.3, 0.3, 0.6, 12, mat(PALETTE.metalDark));
  valve.position.y = 7.9; g.add(valve);
  const valveTop = box(0.7, 0.15, 0.7, mat(PALETTE.metalDark));
  valveTop.position.y = 8.3; g.add(valveTop);

  // inlet pipe
  const inlet = cyl(0.12, 0.12, 3, 12, mat(PALETTE.h2, {emissive:PALETTE.h2, emissiveIntensity:0.4}));
  inlet.position.set(3.4, 5, 0);
  inlet.rotation.z = Math.PI/2;
  g.add(inlet);

  return {
    group: g,
    bounds: new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(0,4,0), new THREE.Vector3(10, 9, 10))
  };
}

// =============================================================
// 10. AIR SEPARATION UNIT (ASU) - cryogenic distillation columns
// =============================================================
export function buildASU(){
  const g = new THREE.Group();
  g.add(pad(12, 10));

  // tall main column
  const col1 = cyl(0.9, 0.9, 16, 20, mat(PALETTE.shell, {roughness:0.4}));
  col1.position.set(-1.5, 8.2, 0); g.add(col1);
  // shorter secondary column
  const col2 = cyl(0.7, 0.7, 11, 20, mat(PALETTE.shellWarm, {roughness:0.4}));
  col2.position.set(1.8, 5.7, 0); g.add(col2);

  // domes
  const d1 = sphere(0.9, mat(PALETTE.shell), 16); d1.position.set(-1.5, 16.2, 0); g.add(d1);
  const d2 = sphere(0.7, mat(PALETTE.shellWarm), 16); d2.position.set(1.8, 11.2, 0); g.add(d2);

  // tray rings on column (suggesting internal trays)
  for (let i = 0; i < 6; i++){
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.92, 0.04, 6, 24),
      mat(PALETTE.metalDark)
    );
    ring.rotation.x = Math.PI/2;
    ring.position.set(-1.5, 2 + i*2.4, 0); g.add(ring);
  }

  // air intake compressor (low box w/ fan)
  const compr = box(2.6, 1.6, 2.6, mat(PALETTE.shellDark));
  compr.position.set(-4.2, 0.9, 0); g.add(compr);
  const fan = new THREE.Mesh(
    new THREE.CircleGeometry(0.7, 24),
    mat(PALETTE.metalDark)
  );
  fan.rotation.y = Math.PI/2;
  fan.position.set(-3.0, 0.9, 0); g.add(fan);

  // crossover pipe top to top
  const xpipe = cyl(0.18, 0.18, 3.5, 12, mat(PALETTE.n2, {emissive:PALETTE.n2, emissiveIntensity:0.3}));
  xpipe.position.set(0.15, 11.5, 0);
  xpipe.rotation.z = Math.PI/2;
  g.add(xpipe);

  // ladder
  for (let i = 0; i < 8; i++){
    const rung = box(0.4, 0.04, 0.04, mat(PALETTE.metalDark));
    rung.position.set(-1.5, 1 + i*1.8, 0.95); g.add(rung);
  }

  // small platform mid-column
  const pl = platform(1.5);
  pl.position.set(-1.5, 8, 0);
  g.add(pl);

  return {
    group: g,
    bounds: new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(0,10,0), new THREE.Vector3(12, 22, 8))
  };
}

// =============================================================
// 11. HABER-BOSCH REACTOR
// =============================================================
export function buildHaberBosch(){
  const g = new THREE.Group();
  g.add(pad(14, 10));

  // main reactor (horizontal big cylinder)
  const reactor = cyl(1.3, 1.3, 7, 24, mat(PALETTE.shellWarm, {roughness:0.4}));
  reactor.rotation.z = Math.PI/2;
  reactor.position.set(0, 3.0, -1.5); g.add(reactor);
  // end caps
  const cap1 = sphere(1.3, mat(PALETTE.shellWarm), 16);
  cap1.position.set(-3.5, 3.0, -1.5); g.add(cap1);
  const cap2 = sphere(1.3, mat(PALETTE.shellWarm), 16);
  cap2.position.set(3.5, 3.0, -1.5); g.add(cap2);

  // saddle supports
  [-2.0, 2.0].forEach(x => {
    const saddle = box(0.4, 1.6, 2.6, mat(PALETTE.concrete));
    saddle.position.set(x, 0.8, -1.5); g.add(saddle);
  });

  // heat exchanger drum (vertical) on side
  const hx = cyl(0.9, 0.9, 5, 20, mat(PALETTE.shell));
  hx.position.set(-4.5, 2.5, 1.5); g.add(hx);
  const hxTop = sphere(0.9, mat(PALETTE.shell), 12); hxTop.position.set(-4.5, 5, 1.5); g.add(hxTop);

  // compressor unit
  const comp = box(2.2, 1.6, 1.8, mat(PALETTE.shellDark));
  comp.position.set(3.5, 0.8, 1.8); g.add(comp);
  // 3 bearings/shaft sections
  for (let i = 0; i < 3; i++){
    const seg = cyl(0.35, 0.35, 0.5, 12, mat(PALETTE.metalDark));
    seg.rotation.z = Math.PI/2;
    seg.position.set(2.5 + i*0.55, 1.4, 1.8); g.add(seg);
  }

  // NH3 outlet pipe (purple glow)
  const outlet = cyl(0.18, 0.18, 5, 12, mat(PALETTE.nh3, {emissive:PALETTE.nh3, emissiveIntensity:0.5}));
  outlet.position.set(4, 4, 0);
  outlet.rotation.z = Math.PI/2.6;
  g.add(outlet);

  // small platform
  const plat = box(8, 0.1, 3.5, mat(PALETTE.metalDark, {opacity:0.6, transparent:true}));
  plat.position.set(0, 4.6, -1.5); g.add(plat);

  // top label band on reactor
  const band = new THREE.Mesh(
    new THREE.TorusGeometry(1.3, 0.08, 8, 32),
    mat(PALETTE.nh3, {emissive:PALETTE.nh3, emissiveIntensity:1})
  );
  band.position.set(0, 3, -1.5);
  g.add(band);

  return {
    group: g,
    bounds: new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(0,3,0), new THREE.Vector3(14, 7, 10))
  };
}

// =============================================================
// 12. AMMONIA STORAGE (large refrigerated sphere)
// =============================================================
export function buildAmmoniaStorage(){
  const g = new THREE.Group();
  g.add(pad(14, 14));

  // large sphere (bigger than H2 tank)
  const ball = sphere(4.2, mat(PALETTE.nh3, {roughness:0.4, metalness:0.05}), 32);
  ball.position.y = 6;
  g.add(ball);

  // 8 support legs
  for (let i = 0; i < 8; i++){
    const a = (i/8) * Math.PI * 2;
    const x = Math.cos(a) * 3.1;
    const z = Math.sin(a) * 3.1;
    const leg = cyl(0.18, 0.22, 3.6, 8, mat(PALETTE.metalDark));
    leg.position.set(x, 1.8, z);
    const tilt = 0.18;
    leg.rotation.x = -Math.sin(a) * tilt;
    leg.rotation.z = Math.cos(a) * tilt;
    g.add(leg);
  }
  const brace = new THREE.Mesh(
    new THREE.TorusGeometry(3.1, 0.08, 6, 32),
    mat(PALETTE.metalDark)
  );
  brace.rotation.x = Math.PI/2;
  brace.position.y = 3.4;
  g.add(brace);

  // top vent stack
  const vent = cyl(0.25, 0.25, 1.2, 12, mat(PALETTE.metalDark));
  vent.position.y = 10.5; g.add(vent);

  // loading arm (truck/rail)
  const arm = box(0.2, 0.2, 5, mat(PALETTE.nh3, {emissive:PALETTE.nh3, emissiveIntensity:0.3}));
  arm.position.set(5.4, 5.5, 0); g.add(arm);
  const armDown = cyl(0.12, 0.12, 3, 8, mat(PALETTE.nh3, {emissive:PALETTE.nh3, emissiveIntensity:0.3}));
  armDown.position.set(7.4, 4, 0); g.add(armDown);

  return {
    group: g,
    bounds: new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(0,6,0), new THREE.Vector3(14, 12, 14))
  };
}

// =============================================================
// 13. CCS (Carbon Capture)
// =============================================================
export function buildCCS(){
  const g = new THREE.Group();
  g.add(pad(10, 8));

  // amine absorber tower
  const tower = cyl(0.8, 0.8, 14, 20, mat(PALETTE.shellDark));
  tower.position.set(0, 7.2, 0); g.add(tower);
  const tdome = sphere(0.8, mat(PALETTE.shellDark), 14);
  tdome.position.set(0, 14.2, 0); g.add(tdome);

  // tray rings
  for (let i = 0; i < 5; i++){
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.82, 0.05, 6, 24),
      mat(PALETTE.metal)
    );
    ring.rotation.x = Math.PI/2;
    ring.position.set(0, 2 + i*2.4, 0); g.add(ring);
  }

  // CO2 capture indicator band
  const band = new THREE.Mesh(
    new THREE.TorusGeometry(0.83, 0.1, 8, 24),
    mat(PALETTE.co2, {emissive:PALETTE.co2, emissiveIntensity:1.2})
  );
  band.rotation.x = Math.PI/2;
  band.position.set(0, 11, 0); g.add(band);

  // pump skid
  const pump = box(1.6, 1, 2.4, mat(PALETTE.shell));
  pump.position.set(2.5, 0.7, 0); g.add(pump);

  // CO2 outlet pipe
  const outlet = cyl(0.12, 0.12, 4, 8, mat(PALETTE.co2));
  outlet.rotation.z = Math.PI/2;
  outlet.position.set(-2.5, 11, 0); g.add(outlet);

  return {
    group: g,
    bounds: new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(0,8,0), new THREE.Vector3(8, 16, 6))
  };
}

// =============================================================
// 14. HYBRID OPTIMIZER (control center)
// =============================================================
export function buildOptimizer(){
  const g = new THREE.Group();
  g.add(pad(10, 8, 0.15, PALETTE.padLight));

  // modern glass-front building
  const body = box(8, 3.2, 5, mat(PALETTE.shell, {roughness:0.4}));
  body.position.y = 1.7;
  g.add(body);

  // glass front strip
  const glass = box(8.01, 1.8, 0.05, mat(PALETTE.glass, {metalness:0.7, roughness:0.1, emissive:0x1a3a4a, emissiveIntensity:0.5, transparent:true, opacity:0.85}));
  glass.position.set(0, 1.9, 2.51);
  g.add(glass);

  // window mullions
  for (let i = 1; i < 6; i++){
    const mull = box(0.06, 1.8, 0.06, mat(PALETTE.shellDark));
    mull.position.set(-4 + i*8/6, 1.9, 2.55);
    g.add(mull);
  }

  // roof with subtle slope
  const roof = box(8.2, 0.2, 5.2, mat(PALETTE.shellDark));
  roof.position.y = 3.4; g.add(roof);

  // antenna / data tower
  const ant = cyl(0.08, 0.08, 3, 8, mat(PALETTE.metalDark));
  ant.position.set(3, 4.9, 0); g.add(ant);
  const dish = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 16, 8, 0, Math.PI*2, 0, Math.PI/2),
    mat(PALETTE.shell, {side: THREE.DoubleSide})
  );
  dish.position.set(3, 6.3, 0); dish.rotation.x = Math.PI; g.add(dish);

  // glowing data orb above
  const orb = sphere(0.5, mat(PALETTE.elec, {emissive:PALETTE.elec, emissiveIntensity:2, roughness:0.2}), 24);
  orb.position.set(0, 5.4, 0); g.add(orb);
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(0.85, 0.04, 8, 32),
    mat(PALETTE.elec, {emissive:PALETTE.elec, emissiveIntensity:1.4})
  );
  halo.position.copy(orb.position);
  halo.rotation.x = Math.PI/2.3;
  g.add(halo);
  const halo2 = halo.clone(); halo2.rotation.x = -Math.PI/2.3; halo2.rotation.y = Math.PI/3; g.add(halo2);

  return {
    group: g,
    update(dt, t){
      halo.rotation.y += dt * 0.8;
      halo2.rotation.y -= dt * 0.6;
      orb.material.emissiveIntensity = 1.6 + Math.sin(t*2.4)*0.4;
      orb.scale.setScalar(1 + Math.sin(t*2.4)*0.06);
    },
    bounds: new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(0,3,0), new THREE.Vector3(10, 7, 6))
  };
}

// =============================================================
// Subsystem registry — the catalog used by the scene
// position = [x, z]  (y is computed)
// =============================================================
export const SUBSYSTEMS = [
  {
    key:'solar', num:'01', cf:24, cat:'Renewables', title:'Solar PV',
    pos:[-66, -40], rot:0, builder: buildSolarPV,
    desc:'Photovoltaic field providing variable daytime power to the plant. The optimizer dispatches PV output to electrolysis or grid export when prices are favorable.',
    color: PALETTE.elec,
    io:[ {dir:'out', kind:'Electricity', c:'elec'} ],
    specs:[
      {k:'Capacity', v:'120', u:'MWp'},
      {k:'CF (annual)', v:'24', u:'%'},
      {k:'LCOE', v:'29', u:'$/MWh'},
      {k:'Area', v:'1.6', u:'km²'},
    ],
  },
  {
    key:'wind', num:'02', cf:48, cat:'Renewables', title:'Wind Turbines',
    pos:[-15, -32], rot:0, builder: buildWindTurbines,
    desc:'Onshore wind farm — dominant night-time supply at the North Dakota reference site. Higher capacity factor than PV; key to lowering carbon intensity below 0.5 t CO₂/t NH₃.',
    color: PALETTE.elec,
    io:[ {dir:'out', kind:'Electricity', c:'elec'} ],
    specs:[
      {k:'Capacity', v:'180', u:'MW'},
      {k:'CF (annual)', v:'48', u:'%'},
      {k:'Turbines', v:'30', u:'× 6 MW'},
      {k:'Hub height', v:'120', u:'m'},
    ],
  },
  {
    key:'grid', num:'03', cf:35, cat:'Energy Input', title:'Grid Substation',
    pos:[ 30, -32], rot:0, builder: buildGridSubstation,
    desc:'Bidirectional 138 kV grid connection. Imports cheap off-peak power, exports surplus during high-price hours. The MILP optimizer chooses every hour whether to buy or sell.',
    color: PALETTE.elec,
    io:[
      {dir:'in', kind:'Electricity (import)', c:'elec'},
      {dir:'out', kind:'Electricity (export)', c:'elec'},
    ],
    specs:[
      {k:'Voltage', v:'138', u:'kV'},
      {k:'Interconnect', v:'80', u:'MW'},
      {k:'Avg. price', v:'42', u:'$/MWh'},
      {k:'CI (grid)', v:'380', u:'kg CO₂/MWh'},
    ],
  },
  {
    key:'ng', num:'04', cf:42, cat:'Energy Input', title:'Natural Gas Inlet',
    pos:[ 64, -26], rot:0, builder: buildNaturalGas,
    desc:'Metering and regulation skid for pipeline natural gas. Feeds the SMR for backup hydrogen production when renewables are scarce or electricity prices spike.',
    color: PALETTE.ng,
    io:[ {dir:'out', kind:'Natural gas → SMR', c:'ng'} ],
    specs:[
      {k:'Flow (max)', v:'45', u:'kt/yr'},
      {k:'Pressure', v:'40', u:'bar'},
      {k:'Price', v:'4.20', u:'$/MMBtu'},
      {k:'CI factor', v:'56', u:'kg CO₂/GJ'},
    ],
  },
  {
    key:'battery', num:'05', cf:46, cat:'Storage', title:'Battery Bank',
    pos:[ 50, 16], rot:0, builder: buildBatteryBank,
    desc:'Li-ion battery storage smooths sub-hourly renewable variability and arbitrages diurnal grid prices. Round-trip efficiency ~88%.',
    color: PALETTE.elec,
    io:[
      {dir:'in', kind:'Electricity', c:'elec'},
      {dir:'out', kind:'Electricity', c:'elec'},
    ],
    specs:[
      {k:'Energy', v:'200', u:'MWh'},
      {k:'Power', v:'50', u:'MW'},
      {k:'Duration', v:'4', u:'h'},
      {k:'RTE', v:'88', u:'%'},
    ],
  },
  {
    key:'heat', num:'06', cf:51, cat:'Storage', title:'Heat Battery',
    pos:[ 28, 30], rot:0, builder: buildHeatBattery,
    desc:'Sensible thermal storage (molten salt / firebrick) charged electrically when power is cheap, discharged as process steam to displace combustion in the Haber-Bosch and SMR loops.',
    color: PALETTE.heat,
    io:[
      {dir:'in', kind:'Electricity', c:'elec'},
      {dir:'out', kind:'Process heat', c:'heat'},
    ],
    specs:[
      {k:'Capacity', v:'400', u:'MWh-th'},
      {k:'Temp', v:'620', u:'°C'},
      {k:'Discharge', v:'80', u:'MW-th'},
      {k:'RTE', v:'52', u:'%'},
    ],
  },
  {
    key:'electrolyzer', num:'07', cf:58, cat:'Hydrogen', title:'Electrolyzer',
    pos:[-30, 0], rot:0, builder: buildElectrolyzer,
    desc:'PEM electrolyzer modules split deionized water into hydrogen and oxygen using renewable electricity. Highly flexible — modulates with PV/wind output minute-by-minute.',
    color: PALETTE.h2,
    io:[
      {dir:'in', kind:'Electricity', c:'elec'},
      {dir:'in', kind:'Water', c:'h2'},
      {dir:'out', kind:'Hydrogen', c:'h2'},
    ],
    specs:[
      {k:'Capacity', v:'100', u:'MW'},
      {k:'H₂ output', v:'2.0', u:'t/h'},
      {k:'Efficiency', v:'68', u:'%'},
      {k:'Stack life', v:'80', u:'kh'},
    ],
  },
  {
    key:'smr', num:'08', cf:39, cat:'Hydrogen', title:'Steam Methane Reformer',
    pos:[-50, 18], rot:0, builder: buildSMR,
    desc:'Reforms natural gas with steam to produce hydrogen — the backup molecular-hydrogen path used when electrolysis is uneconomic. Coupled with downstream CCS to mitigate emissions.',
    color: PALETTE.ng,
    io:[
      {dir:'in', kind:'Natural gas', c:'ng'},
      {dir:'in', kind:'Steam (heat)', c:'heat'},
      {dir:'out', kind:'Hydrogen', c:'h2'},
      {dir:'out', kind:'CO₂ → CCS', c:'co2'},
    ],
    specs:[
      {k:'Capacity', v:'60', u:'kt H₂/yr'},
      {k:'Efficiency', v:'74', u:'%'},
      {k:'CO₂ raw', v:'9.1', u:'t/t H₂'},
      {k:'Turn-down', v:'40', u:'%'},
    ],
  },
  {
    key:'h2tank', num:'09', cf:63, cat:'Storage', title:'Hydrogen Storage',
    pos:[-10, 22], rot:0, builder: buildH2Storage,
    desc:'Pressurized buffer between intermittent hydrogen supply and continuous Haber-Bosch demand. Sized to ride out multi-day wind/PV droughts.',
    color: PALETTE.h2,
    io:[
      {dir:'in', kind:'Hydrogen', c:'h2'},
      {dir:'out', kind:'Hydrogen', c:'h2'},
    ],
    specs:[
      {k:'Capacity', v:'120', u:'t H₂'},
      {k:'Pressure', v:'80', u:'bar'},
      {k:'Buffer', v:'60', u:'h'},
      {k:'Vessels', v:'3', u:'spheres'},
    ],
  },
  {
    key:'asu', num:'10', cf:86, cat:'Process', title:'Air Separation Unit',
    pos:[ 5, -8], rot:0, builder: buildASU,
    desc:'Cryogenic distillation columns separate atmospheric air into high-purity nitrogen for the synthesis loop. The ASU is one of the largest electrical loads on site (~15% of plant power).',
    color: PALETTE.n2,
    io:[
      {dir:'in', kind:'Air', c:'n2'},
      {dir:'in', kind:'Electricity', c:'elec'},
      {dir:'out', kind:'Nitrogen', c:'n2'},
    ],
    specs:[
      {k:'N₂ output', v:'56', u:'t/h'},
      {k:'Purity', v:'99.999', u:'%'},
      {k:'Power', v:'18', u:'MW'},
      {k:'Cold-box', v:'−196', u:'°C'},
    ],
  },
  {
    key:'hb', num:'11', cf:91, cat:'Process', title:'Haber-Bosch Reactor',
    pos:[ 28, -4], rot:0, builder: buildHaberBosch,
    desc:'Catalytic synthesis loop combining N₂ + 3H₂ → 2NH₃ at high pressure and temperature. The thermal mass favors steady operation, so storage buffers absorb upstream variability.',
    color: PALETTE.nh3,
    io:[
      {dir:'in', kind:'Hydrogen', c:'h2'},
      {dir:'in', kind:'Nitrogen', c:'n2'},
      {dir:'out', kind:'Ammonia (NH₃)', c:'nh3'},
    ],
    specs:[
      {k:'Capacity', v:'0.5', u:'Mt NH₃/yr'},
      {k:'Pressure', v:'150', u:'bar'},
      {k:'Temp', v:'450', u:'°C'},
      {k:'Catalyst', v:'Fe / Ru', u:''},
    ],
  },
  {
    key:'nh3', num:'12', cf:71, cat:'Product', title:'Ammonia Storage',
    pos:[ 55, 30], rot:0, builder: buildAmmoniaStorage,
    desc:'Refrigerated atmospheric storage at −33 °C. Loaded to rail and truck for fertilizer markets; future ports may export as a hydrogen carrier or shipping fuel.',
    color: PALETTE.nh3,
    io:[
      {dir:'in', kind:'Ammonia', c:'nh3'},
      {dir:'out', kind:'Ammonia (to market)', c:'nh3'},
    ],
    specs:[
      {k:'Capacity', v:'30', u:'kt NH₃'},
      {k:'Temp', v:'−33', u:'°C'},
      {k:'Buffer', v:'21', u:'days'},
      {k:'Loading', v:'rail/truck', u:''},
    ],
  },
  {
    key:'ccs', num:'13', cf:38, cat:'Emissions', title:'Carbon Capture (CCS)',
    pos:[-25, 30], rot:0, builder: buildCCS,
    desc:'Amine-based post-combustion CO₂ capture on the SMR flue stream. Captured CO₂ is compressed and pipelined to nearby geological storage in the Bakken basin.',
    color: PALETTE.co2,
    io:[
      {dir:'in', kind:'Flue gas (CO₂)', c:'co2'},
      {dir:'out', kind:'CO₂ → pipeline', c:'co2'},
    ],
    specs:[
      {k:'Capture', v:'90', u:'%'},
      {k:'Throughput', v:'500', u:'kt CO₂/yr'},
      {k:'Solvent', v:'MEA', u:''},
      {k:'Energy', v:'3.2', u:'GJ/t CO₂'},
    ],
  },
  {
    key:'optimizer', num:'14', cf:100, cat:'Control', title:'Hybrid Optimizer',
    pos:[ 10, 6], rot:0, builder: buildOptimizer,
    desc:'The brain of HOPS. A mixed-integer linear program co-optimizes electrons and molecules every hour: which path makes a kilogram of NH₃ cheapest right now, subject to physics, ramp limits, and a CO₂ intensity cap.',
    color: PALETTE.elec,
    io:[
      {dir:'in', kind:'Price · weather · CI signals', c:'elec'},
      {dir:'out', kind:'Setpoints to every subsystem', c:'elec'},
    ],
    specs:[
      {k:'Horizon', v:'24', u:'h rolling'},
      {k:'Solve time', v:'< 60', u:'s'},
      {k:'Variables', v:'~ 250k', u:''},
      {k:'Updates', v:'hourly', u:''},
    ],
  },
];
