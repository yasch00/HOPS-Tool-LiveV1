#!/usr/bin/env python3
"""update_global_fleet.py — bring the globe's orange "Global fleet" dots (atlas/assets/static.json → "ammonia")
in line with HOPS_plants_master.xlsx for the map-reviewed regions (USA, Canada, Europe, India = master rows 0–125).

    python3 tools/update_global_fleet.py                 # report only
    python3 tools/update_global_fleet.py --write         # update static.json and the legend count in atlas/index.html

For every master row that records a previous position (rows 0–125), the fleet entry at that previous position is
  · moved to the master's latitude / longitude and capacity when 'Use in HOPS' = Yes, so no dot stays at an old pin;
  · removed when 'Use in HOPS' = No (plants switched off in the map review).
Entries of all other regions are left exactly as they are (the master has no previous position for them).
Safe to re-run: an entry already at the master position is found there and left alone.
"""
import argparse, json, math, re
from pathlib import Path
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
ap = argparse.ArgumentParser()
ap.add_argument("--master", default=str(ROOT.parent.parent / "HOPS" / "HOPS_plants_master.xlsx"))
ap.add_argument("--tol-km", type=float, default=0.5)
ap.add_argument("--write", action="store_true")
a = ap.parse_args()

def km(la, lo, lb, lob): return 111.2 * math.hypot(la - lb, (lo - lob) * math.cos(math.radians(la)))

sf = ROOT / "atlas/assets/static.json"
st = json.loads(sf.read_text()); fleet = st["ammonia"]; n0 = len(fleet)
m = pd.read_excel(a.master, sheet_name="HOPS")
m = m[m["Previous latitude"].notna()]
moved, removed, same, nohit, used = [], [], 0, [], set()
for _, r in m.iterrows():
    cands = []
    for k, e in enumerate(fleet):
        if k in used: continue
        d = min(km(e["lat"], e["lon"], r["Previous latitude"], r["Previous longitude"]), km(e["lat"], e["lon"], r["Latitude"], r["Longitude"]))
        if d < a.tol_km: cands.append((d, k))
    if not cands:
        nohit.append(int(r["Plant idx"])); continue
    k = min(cands)[1]; used.add(k); e = fleet[k]
    if str(r["Use in HOPS"]) != "Yes":
        removed.append((int(r["Plant idx"]), e["idx"], str(r["Name"]))); e["_drop"] = True; continue
    d = km(e["lat"], e["lon"], r["Latitude"], r["Longitude"]); kt = round(float(r["NH3_capacity_per_year_tons"]) / 1000, 1)
    if d < 0.01 and abs((e.get("ktpa") or 0) - kt) < 0.05: same += 1; continue
    moved.append((int(r["Plant idx"]), e["idx"], round(d, 1), e.get("ktpa"), kt))
    e["lat"], e["lon"], e["ktpa"] = round(float(r["Latitude"]), 5), round(float(r["Longitude"]), 5), kt
st["ammonia"] = fleet = [e for e in fleet if not e.get("_drop")]
# Modelled plants that are new in the master (no previous position): an old-list dot of the same plant within 2 km is
# moved onto the plant's pin; otherwise the plant is added, so every modelled plant is part of the global fleet.
plants = [p for p in json.loads((ROOT / "data/plants.json").read_text()) if p["idx"] < 1000 and not p.get("custom")]
under = lambda e: any(km(e["lat"], e["lon"], p["lat"], p["lon"]) < 0.05 for p in plants)
snapped, added = [], []
for p in plants:
    if any(km(p["lat"], p["lon"], e["lat"], e["lon"]) < 0.05 for e in fleet): continue
    near = sorted((km(p["lat"], p["lon"], e["lat"], e["lon"]), k) for k, e in enumerate(fleet) if not under(e))
    if near and near[0][0] < 2.0:
        e = fleet[near[0][1]]; snapped.append((p["idx"], e["idx"], round(near[0][0], 1)))
        e["lat"], e["lon"], e["ktpa"] = p["lat"], p["lon"], p["ktpa"]
    else:
        fleet.append({"idx": max(e["idx"] for e in fleet) + 1, "lon": p["lon"], "lat": p["lat"], "country": p["country"], "ktpa": p["ktpa"]}); added.append(p["idx"])
print(f"{n0} fleet entries · {len(m)} master rows with a previous position")
print(f"  moved / capacity updated: {len(moved)}   (pin moved > 1 km: {sum(1 for x in moved if x[2] > 1)})")
print(f"  removed (not used):       {len(removed)}  " + ", ".join(f"{i} {n}" for i, _, n in removed))
print(f"  already at master values: {same}")
print(f"  master rows without a fleet entry: {nohit}")
print(f"  old-list dot moved onto a new modelled plant: {snapped}")
print(f"  modelled plants added to the fleet: {added}")
print(f"  fleet entries now: {len(st['ammonia'])}")
if a.write:
    sf.write_text(json.dumps(st, separators=(",", ":")))
    ih = ROOT / "atlas/index.html"; s = ih.read_text()
    s2 = re.sub(r"Global fleet \(\d+ plants\)", f"Global fleet ({len(st['ammonia'])} plants)", s)
    if s2 != s: ih.write_text(s2)
    print(f"wrote {sf.relative_to(ROOT)}" + (f" and the legend count in {ih.relative_to(ROOT)}" if s2 != s else ""))
else:
    print("(report only; pass --write to apply)")
