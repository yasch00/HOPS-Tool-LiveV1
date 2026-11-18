/* finance/units3d.js — still pictures of the business units, rendered once in the browser from the tool's own plant
   scene (atlas/facility: the same three.js builders the atlas places on the map). One small off-screen renderer,
   one picture per unit, transparent background; the page shows them as <img>. If WebGL is not available the page
   simply shows no pictures.
   window.HOPSUnits3D(keys, w, h) → Promise<{ key: dataURL }> */
import { THREE, SUBSYSTEMS, makeLights, makeSkyTexture } from '../atlas/facility/plant_assembly.js';

// unit → subsystems of the scene that make up its picture, laid out side by side (x offset in scene units)
const COMPOSE = {
  RES: [['solar', -6, 2, 1.25], ['wind', 7, -3, 0.75]],
  BAT: [['battery', 0, 0, 1]],
  HB: [['heat', 0, 0, 1]],
  EL: [['electrolyzer', 0, 0, 1]],
  H2ST: [['h2tank', 0, 0, 1]],
  ASU: [['asu', 0, 0, 1]],
  NH3: [['smr', -7, 0, 0.9], ['hb', 2, 0, 0.9], ['nh3', 10, 1, 0.75]],
  NH3CCS: [['smr', -9, 0, 0.85], ['hb', -1, 0, 0.85], ['ccs', 7, -1, 0.75], ['nh3', 14, 2, 0.65]],
  OPR: [['optimizer', 0, 0, 1]],
  GRID: [['grid', 0, 0, 1]],
  NG: [['ng', 0, 0, 1]],
};
const BUILDER = Object.fromEntries(SUBSYSTEMS.map(s => [s.key, s.builder]));

let renderer = null, env = null;
function setup(w, h) {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
    renderer.setClearColor(0x000000, 0);
    const pm = new THREE.PMREMGenerator(renderer); env = pm.fromEquirectangular(makeSkyTexture()).texture; pm.dispose();
  }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(w, h, false);
}

function picture(key, w, h) {
  const parts = COMPOSE[key]; if (!parts) return null;
  const scene = new THREE.Scene(); scene.environment = env;
  scene.add(makeLights(1).group);
  const root = new THREE.Group(); scene.add(root);
  for (const [k, x, z, s] of parts) {
    const b = BUILDER[k]; if (!b) continue;
    const g = b().group; g.scale.setScalar(s); g.position.set(x, 0, z); root.add(g);
  }
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const cam = new THREE.PerspectiveCamera(28, w / h, 0.1, 2000);
  const dir = new THREE.Vector3(0.9, 0.72, 1.05).normalize();
  const rad = 0.5 * Math.max(Math.hypot(size.x, size.z) * 0.82, size.y * 1.6);
  const dist = rad / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2)) * 0.86;
  cam.position.copy(c).addScaledVector(dir, dist); cam.lookAt(c.x, c.y - size.y * 0.08, c.z);
  renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL('image/png');
  root.traverse(o => { if (o.isMesh) { o.geometry.dispose(); } });
  return url;
}

window.HOPSUnits3D = async function (keys, w = 360, h = 230) {
  try { setup(w, h); } catch (e) { return {}; }
  const out = {};
  for (const k of keys) { try { out[k] = picture(k, w, h); } catch (e) { out[k] = null; } await new Promise(r => setTimeout(r, 0)); }
  return out;
};
window.dispatchEvent(new Event('hops-units3d-ready'));
