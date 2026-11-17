#!/usr/bin/env python3
"""build_chem_layers.py — add the non-ammonia chemical plants of GEM's Global Chemicals Tracker to the atlas
industry layers (atlas/assets/layers.json + layer_counts in atlas/assets/static.json).

    python3 tools/build_chem_layers.py --xlsx <Plant-level-data-Global-Chemicals-Tracker-...xlsx>            # report only
    python3 tools/build_chem_layers.py --xlsx <...> --write

One layer per GEM product group: methanol, olefins (ethylene, propylene, butadiene) and aromatics (benzene,
toluene, xylene). A plant is drawn in a layer when the 'Chemical Capacities' sheet lists capacity of that group
with status "operating" or "operating pre-retirement" (announced, construction, developing, mothballed, retired
and cancelled capacity is not drawn). A plant making several groups appears in each of them. Ammonia is left out:
the atlas shows it as the "Global fleet" (tools/update_global_fleet.py).
Source: Global Energy Monitor, Global Chemicals Tracker (CC BY 4.0).
"""
import argparse, json
from pathlib import Path
import openpyxl

ROOT = Path(__file__).resolve().parent.parent
GROUPS = ["methanol", "olefins", "aromatics"]
LIVE = {"operating", "operating pre-retirement"}
ap = argparse.ArgumentParser()
ap.add_argument("--xlsx", required=True)
ap.add_argument("--write", action="store_true")
a = ap.parse_args()

wb = openpyxl.load_workbook(a.xlsx, read_only=True, data_only=True)
def table(name):
    rows = list(wb[name].iter_rows(values_only=True))
    return [dict(zip(rows[0], r)) for r in rows[1:] if r and r[0]]

pos = {}
for p in table("Plant Data"):
    try:
        lat, lon = (float(v) for v in str(p["Coordinates"]).split(","))
    except ValueError:
        continue
    if -90 <= lat <= 90 and -180 <= lon <= 180:
        pos[p["GEM Plant ID"]] = [round(lat, 3), round(lon, 3)]

ids = {g: set() for g in GROUPS}
for c in table("Chemical Capacities"):
    g = str(c["Product Group"]).strip().lower()
    if g in ids and str(c["Capacity Status"]).strip().lower() in LIVE:
        ids[g].add(c["GEM Plant ID"])

layers = {}
for g in GROUPS:
    missing = sorted(i for i in ids[g] if i not in pos)
    layers[g] = [pos[i] for i in sorted(ids[g]) if i in pos]
    print(f"{g:10s} {len(layers[g]):4d} plants" + (f"  ({len(missing)} without coordinates)" if missing else ""))

if a.write:
    lf = ROOT / "atlas/assets/layers.json"; sf = ROOT / "atlas/assets/static.json"
    L = json.loads(lf.read_text()); L.update(layers)
    lf.write_text(json.dumps(L, separators=(",", ":")))
    S = json.loads(sf.read_text())
    S.setdefault("layer_counts", {}).update({g: len(v) for g, v in layers.items()})
    sf.write_text(json.dumps(S, separators=(",", ":"), ensure_ascii=False))
    print("written:", lf.relative_to(ROOT), sf.relative_to(ROOT))
