#!/usr/bin/env python3
"""bu_finance_to_web.py — data for the Project Finance page (finance/), one JSON per plant.

The page is the web version of ProjectFinance/build_bu_finance.py (the business-unit finance workbook): seven
business units behind one operator, fixed rates between them, the HOPS design and hourly dispatch taken as given.
This script does NOT re-implement the data layer: it imports build_bu_finance.py and calls its load_points(), so
every volume, CAPEX and reference number is exactly what the workbook's 'Model Data' sheet holds. The cash-flow
arithmetic is done in the browser (finance/engine.js, a port of the script's Python mirror).

    python3 tools/bu_finance_to_web.py                       # all plants in data/plants.json
    python3 tools/bu_finance_to_web.py --plants 61,93        # a subset
    python3 tools/bu_finance_to_web.py --reference 61:No:1.0 # also print the Python results for one point (tie-out)

Reads   <results>/CI_Range_…_{label}.csv, BAU_AllPlants_…_{bau}.csv, hourly/*.parquet
        (default: the staged v13 folder, where the 1,000 $/t fill points carry the IRR_v13 name)
Writes  data/finance/plant<idx>.json   {idx, name, …, units, cases: {"No": [point, …], "Yes": […]}}
        data/finance/index.json        {generated, label, plants: [{idx, name, admin, country, region, lat, lon, ktpa, ccs:[…]}]}
"""
import argparse, contextlib, datetime, importlib, io, json, math, sys
from pathlib import Path
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
HOPS = ROOT.parent.parent / "HOPS"
ap = argparse.ArgumentParser()
ap.add_argument("--results", default=str(HOPS / "results" / "web_stage_v13" / "results"))
ap.add_argument("--script-dir", default=str(HOPS / "ProjectFinance"), help="folder of build_bu_finance.py")
ap.add_argument("--label", default="IRR_v13")
ap.add_argument("--bau-label", default="BAU_v13")
ap.add_argument("--run-haircut", type=float, default=1.0,
                help="export price factor the runs were solved with: 1.0 for v13 (full wholesale), 0.90 for v11")
ap.add_argument("--plants", default="", help="comma-separated plant numbers (default: every plant in data/plants.json)")
ap.add_argument("--reference", default="", help="plant:ccs:ci — print the Python cash-flow results for this point as JSON")
ap.add_argument("-o", "--out", default=str(ROOT / "data" / "finance"))
a = ap.parse_args()

sys.path.insert(0, a.script_dir)
bu = importlib.import_module("build_bu_finance")
bu.RESULTS_DIR = a.results
bu.RUN_EXPORT_DISCOUNT = a.run_haircut   # build_bu_finance.py still carries the v11 value 0.90

plants = json.loads((ROOT / "data" / "plants.json").read_text())
plants = plants if isinstance(plants, list) else plants.get("plants", plants)
want = {int(x) for x in a.plants.split(",") if x.strip()}
plants = [p for p in plants if p["idx"] < 1000 and (not want or p["idx"] in want)]

# keys the page needs (everything the cash flow, the panels and the detail window read)
DROP = {"_h1", "_h2", "_h3", "_h4", "_h5", "_h6"}
KEYS = ["CI"] + [k for k, _, _ in bu.DATA_ROWS if k not in DROP]


def clean(v):
    v = float(v)
    if math.isnan(v) or math.isinf(v):
        return None
    return round(v, 6) if abs(v) < 1e4 else round(v, 2)


def load(idx, ccs):
    """load_points() of the workbook script; None if the sweep or its hourly files are missing."""
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            return bu.load_points(a.results, idx, ccs, a.label, a.bau_label)
    except SystemExit:
        return None


def ccs_electricity(idx, ccs):
    """{CI: MWh/yr} electricity used by the capture unit, from the sweep CSV ('electricity_CCS_sum MWh').
    The hourly files have no U_E_CCS column, so load_points() misses this load: it lands in the balance residual
    ('curtailed') and the ammonia unit is not charged for it. Corrected here: added to the ammonia plant's
    electricity, taken out of the residual."""
    f = Path(a.results) / f"CI_Range_SMR_INT_ASU_plant{idx}_CCS{ccs}_{a.label}.csv"
    d = pd.read_csv(f)
    if "electricity_CCS_sum MWh" not in d.columns:
        return {}
    return {round(float(c), 2): max(0.0, float(v)) for c, v in zip(d[bu.CI_COL], d["electricity_CCS_sum MWh"].fillna(0.0))}


out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
index, skipped = [], []
for n, p in enumerate(sorted(plants, key=lambda q: q["idx"])):
    cases, meta = {}, None
    for ccs in ("No", "Yes"):
        got = load(p["idx"], ccs)
        if got is None:
            continue
        meta, pts = got
        e_ccs = ccs_electricity(p["idx"], ccs)
        for d in pts:
            e = e_ccs.get(d["CI"], 0.0)
            if e > 0:
                d["E_NH3plant"] += e; d["E_curt"] = max(0.0, d["E_curt"] - e)
        cases[ccs] = [{k: clean(d[k]) for k in KEYS} for d in pts]
    if not cases:
        skipped.append(p["idx"]); continue
    # Fossil reference on the page = today's plant WITHOUT CCS, for both cases (as the atlas does). The workbook
    # compares the CCS case with a BAU that has CCS; that file is not staged for the web.
    if "No" in cases and "Yes" in cases:
        for q in cases["Yes"]:
            q["BAU_LCOA_A"], q["BAU_CI"] = cases["No"][0]["BAU_LCOA_A"], cases["No"][0]["BAU_CI"]
    rec = {"idx": p["idx"], "name": p.get("name"), "admin": p.get("admin"), "country": p.get("country"),
           "region": p.get("region"), "lat": p["lat"], "lon": p["lon"], "ktpa": p.get("ktpa"), "tpd": round(meta["tpd"], 1),
           "label": a.label, "cases": cases}
    (out / f"plant{p['idx']}.json").write_text(json.dumps(rec, separators=(",", ":"), ensure_ascii=False))
    index.append({k: rec[k] for k in ("idx", "name", "admin", "country", "region", "lat", "lon", "ktpa")} | {"ccs": sorted(cases)})
    print(f"[{n + 1}/{len(plants)}] plant {p['idx']:3d} {str(p.get('name')):24s} " + " ".join(f"CCS {c}: {len(v)} CI" for c, v in cases.items()), flush=True)

if not want:
    fin = {u: bu.FIN[u] for u in bu.UNITS}
    (out / "index.json").write_text(json.dumps({
        "generated": datetime.date.today().isoformat(), "label": a.label, "bau_label": a.bau_label, "plants": index,
        "model": {"units": bu.UNITS, "unit_names": bu.UNIT_NAMES, "fin": fin, "ncon": bu.NCON, "nops": bu.NOPS, "spend": list(bu.SPEND),
                  "esc_rev": bu.ESC_REV, "esc_cost": bu.ESC_COST, "opr_margin": bu.OPR_MARGIN, "grid_opex_pct": bu.GRID_OPEX_PCT,
                  "curt_paid": bu.CURTAIL_PAID, "run_export_discount": bu.RUN_EXPORT_DISCOUNT,
                  "rates": [list(r) for r in bu.RATES], "lines": bu.LINES, "capex": bu.CAPEX, "opex": bu.OPEX,
                  "data_rows": [list(r) for r in bu.DATA_ROWS]}}, separators=(",", ":"), ensure_ascii=False))
    print(f"index.json: {len(index)} plants" + (f" · no finance data for {skipped}" if skipped else ""))

if a.reference:
    pl, ccs, ci = a.reference.split(":")
    meta, pts = load(int(pl), ccs)
    d = next(q for q in pts if q["CI"] == round(float(ci), 2))   # as the workbook has it (without the CCS-electricity correction)
    inputs = dict(curt_paid=bu.CURTAIL_PAID, grid_opex_pct=bu.GRID_OPEX_PCT, exp_real=round(d["EXPORT_DISC"], 2))
    rates = bu.default_rates(d, inputs)
    ref = {"rates": rates, "units": {}, "system": bu.solve_system_breakeven(d, rates, inputs)}
    for u in bu.UNITS:
        cf = bu.unit_cf(u, d, rates, inputs); cf.pop("lines")
        cf["min_p"] = bu.solve_min_rate(u, d, rates, inputs, "project")
        cf["min_e"] = bu.solve_min_rate(u, d, rates, inputs, "equity")
        ref["units"][u] = {k: (None if isinstance(v, float) and math.isnan(v) else v) for k, v in cf.items()}
    print("REFERENCE " + json.dumps(ref))
