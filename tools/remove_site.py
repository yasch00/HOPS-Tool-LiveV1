#!/usr/bin/env python3
"""remove_site.py — take a plant (usually a requested site, id ≥ 1000) out of the published data and the globe.

    python3 tools/remove_site.py 1002            # then commit + push
Removes it from plants/scenarios/bau/summary/manifest, deletes data/runs/plant<id>/ and data/siting/plant<id>/,
and refreshes the siting index. The fleet plants (0–94) are refused unless --force is given."""
import argparse, gzip, json, shutil, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent; D = ROOT / "data"
ap = argparse.ArgumentParser(); ap.add_argument("idx", type=int); ap.add_argument("--force", action="store_true"); a = ap.parse_args()
if a.idx < 1000 and not a.force: raise SystemExit(f"plant {a.idx} is a fleet plant; pass --force if you really mean it")
i = a.idx
plants = json.loads((D / "plants.json").read_text()); n0 = len(plants); plants = [p for p in plants if p["idx"] != i]; (D / "plants.json").write_text(json.dumps(plants, indent=0))
scn = json.loads((D / "scenarios.json").read_text()); scn = [s for s in scn if s["plant"] != i]; (D / "scenarios.json").write_text(json.dumps(scn, separators=(",", ":")))
bau = json.loads((D / "bau.json").read_text()); [d.pop(str(i), None) for d in bau.values()]; (D / "bau.json").write_text(json.dumps(bau, separators=(",", ":")))
if (D / "summary.json.gz").exists():
    summ = [r for r in json.loads(gzip.open(D / "summary.json.gz", "rt").read()) if r.get("plant") != i]
    with gzip.open(D / "summary.json.gz", "wt") as f: f.write(json.dumps(summ, separators=(",", ":")))
man = json.loads((D / "manifest.json").read_text()); man["plants"].pop(str(i), None); man["n_scenarios"] = len(scn); man["n_plants"] = len(plants); (D / "manifest.json").write_text(json.dumps(man, indent=1))
for sub in ("runs", "siting"):
    p = D / sub / f"plant{i}"
    if p.exists(): shutil.rmtree(p); print(f"deleted {p.relative_to(ROOT)}")
sit = D / "siting"; have = sorted(int(p.name[5:]) for p in sit.glob("plant*") if (p / "site.json").exists()); (sit / "index.json").write_text(json.dumps({"plants": have, "n": len(have)}))
print(f"plant {i}: {'removed' if len(plants) < n0 else 'was not in plants.json'} · {len(plants)} plants remain · commit and push to publish")
