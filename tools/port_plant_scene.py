#!/usr/bin/env python3
"""
port_plant_scene.py — regenerate atlas/facility/{three.module.js, plant_builders.js} from the Claude-Design facility page.

    python3 tools/port_plant_scene.py            # reads atlas/pages/hops-hybrid-ammonia-plant-live-sim.html

The old page is a self-extracting bundle (manifest of base64+gzip assets + a JSON template). Two of its assets are
reused unchanged on the map: the three.js r161 ES module and the scene module's builder section (palette, materials,
subsystem builders, subsystem table = lines 1–1160, i.e. everything before its baked-in `MODEL` data). The assembly,
routing and animation are re-implemented in atlas/facility/plant_assembly.js against real run data.
"""
import base64, gzip, json, re, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
S = (ROOT / "atlas/pages/hops-hybrid-ammonia-plant-live-sim.html").read_text(encoding="utf-8")
man = json.loads(re.search(r'<script type="__bundler/manifest">(.*?)</script>', S, re.S).group(1))
def raw(uuid):
    b = base64.b64decode(man[uuid]["data"]); return gzip.decompress(b) if b[:2] == b"\x1f\x8b" else b
js = {u: raw(u).decode("utf-8") for u, e in man.items() if e["mime"] in ("text/javascript", "application/javascript")}
three = next(t for t in js.values() if "const REVISION = '161'" in t)
scene = next(t for t in js.values() if "export function buildHaberBosch" in t)
out = ROOT / "atlas/facility"; out.mkdir(exist_ok=True)
(out / "three.module.js").write_text(three, encoding="utf-8")
lines = scene.split("\n"); cut = next(i for i, l in enumerate(lines) if l.startswith("export const MODEL"))
body = "\n".join(lines[:cut]).replace("import * as THREE from 'three';", "import * as THREE from './three.module.js';")
body = "\n".join(l for l in body.split("\n") if not l.startswith("import { OrbitControls }"))
(out / "plant_builders.js").write_text("// DERIVED from the Claude-Design facility page (scene module, lines 1-%d): palette, materials, subsystem builders, subsystem table.\n// Unchanged apart from the import line. Regenerate with tools/port_plant_scene.py; do not edit by hand.\n%s" % (cut, body), encoding="utf-8")
print(f"three.module.js {len(three)/1e6:.2f} MB · plant_builders.js {cut} lines")
