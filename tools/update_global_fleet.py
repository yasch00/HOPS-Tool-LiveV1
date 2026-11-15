#!/usr/bin/env python3
"""update_global_fleet.py — build the globe's orange "Global fleet" dots (atlas/assets/static.json → "ammonia")
from HOPS_plants_master.xlsx, so the atlas shows the same plant list the model uses.

    python3 tools/update_global_fleet.py                 # report only
    python3 tools/update_global_fleet.py --write         # replace the list and the legend count in atlas/index.html

The fleet is
  · every row of sheet 'HOPS' with 'Use in HOPS' = Yes and 'Type' = Plant (GEM baseline + map review; position,
    capacity and name from the workbook; idx = the HOPS plant number), and
  · the plants on sheet 'Not used' whose reason is "GEM gives no ammonia capacity": GEM lists them as operating, so
    they exist, but they cannot be modelled without a capacity. They are drawn with ktpa = null and idx = 9000 + n.
Everything else on 'Not used' (announced, under construction, retired, cancelled, review removals, old-list plants
that GEM does not have) is not drawn. The previous list is replaced as a whole; nothing is merged.
"""
import argparse, json, re
from pathlib import Path
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
ap = argparse.ArgumentParser()
ap.add_argument("--master", default=str(ROOT.parent.parent / "HOPS" / "HOPS_plants_master.xlsx"))
ap.add_argument("--write", action="store_true")
a = ap.parse_args()

s = lambda v: str(v).strip() if isinstance(v, str) and v.strip() else None
sf = ROOT / "atlas/assets/static.json"
st = json.loads(sf.read_text()); old = st["ammonia"]
x = pd.ExcelFile(a.master); m = x.parse("HOPS"); nu = x.parse("Not used")
fleet = []
for _, r in m[(m["Use in HOPS"] == "Yes") & (m["Type"] == "Plant")].iterrows():
    fleet.append({"idx": int(r["Plant idx"]), "lon": round(float(r["Longitude"]), 5), "lat": round(float(r["Latitude"]), 5),
                  "country": s(r["SOVEREIGNT"]) or s(r["Country"]) or "", "ktpa": round(float(r["NH3_capacity_per_year_tons"]) / 1000, 1),
                  "name": s(r["Name"])})
nocap = nu[nu["Why not used"].astype(str).str.contains("no ammonia capacity")]
for n, (_, r) in enumerate(nocap.iterrows()):
    c = s(r["Country"]) or ""
    fleet.append({"idx": 9000 + n, "lon": round(float(r["Longitude"]), 5), "lat": round(float(r["Latitude"]), 5),
                  "country": {"United States": "USA"}.get(c, c), "ktpa": None, "name": s(r["Name"])})
st["ammonia"] = fleet

key = lambda e: (round(e["lat"], 2), round(e["lon"], 2))
ok, nk = {key(e) for e in old}, {key(e) for e in fleet}
by = lambda L: pd.Series([e["country"] for e in L]).value_counts()
d = (by(fleet).reindex(sorted(set(by(fleet).index) | set(by(old).index)), fill_value=0) - by(old).reindex(sorted(set(by(fleet).index) | set(by(old).index)), fill_value=0))
print(f"previous list {len(old)} plants -> new list {len(fleet)} plants ({len(fleet) - len(nocap)} from sheet HOPS, {len(nocap)} operating without capacity)")
print(f"  positions kept {len(ok & nk)} · positions gone {len(ok - nk)} · positions new {len(nk - ok)}")
print("  change in plants per country: " + ", ".join(f"{c} {int(v):+d}" for c, v in d[d != 0].sort_values().items()))
if a.write:
    sf.write_text(json.dumps(st, separators=(",", ":"), ensure_ascii=False))
    ih = ROOT / "atlas/index.html"; t = ih.read_text()
    t2 = re.sub(r"Global fleet \(\d+ plants\)", f"Global fleet ({len(fleet)} plants)", t)
    if t2 != t: ih.write_text(t2)
    print(f"wrote {sf.relative_to(ROOT)}" + (" and the legend count in atlas/index.html" if t2 != t else ""))
else:
    print("(report only; pass --write to apply)")
