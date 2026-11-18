#!/usr/bin/env python3
"""bu_finance_to_web.py — data for the Project Finance page (finance/), one JSON per plant.

The page is the web version of ProjectFinance/build_bu_finance.py (the business-unit finance workbook): eight
business units (RES, BAT, HB, EL, H2ST, ASU, NH3, OPR) behind one operator, fixed rates between them, the HOPS
design and hourly dispatch taken as given. This script does NOT re-implement the data layer: it imports
build_bu_finance.py and calls its load_points(), so every volume, CAPEX and reference number is what the
workbook's 'Model Data' sheet holds. The cash-flow arithmetic and the rate solvers run in the browser
(finance/engine.js, a port of the script's Python mirror).

Page version 6 (2026-11-17): greenfield AND retrofit, each with its policy re-pricings.

    python3 tools/bu_finance_to_web.py                       # all plants in data/plants.json
    python3 tools/bu_finance_to_web.py --plants 61,110       # a subset (index.json is left as it is)
    python3 tools/bu_finance_to_web.py --reference 61:GF:No:1.0   # also print the Python results for one point

Reads   <stage>/results/          greenfield  CI_Range_…_IRR_v13[_policy].csv, BAU_…_BAU_v13[_policy].csv, hourly/
        <stage>/results_retrofit/ retrofit    CI_Range_…_RETRO50_LCOA_v13[_policy].csv, BAU_…_BAU_RETRO_v13[_policy].csv
        (default stage: HOPS/results/web_stage_v13, the corrected v13c data the atlas is built from)
Writes  data/finance/plant<idx>.json
          {idx, name, …, builds: {GF|RETRO: {label, cases: {No|Yes: [point, …]},
                                             policies: {ETSlaw|ETSprop|USCred: {No|Yes: [{key: value} changed vs the base point]}}}}}
        data/finance/index.json   {generated, model, plants: [{idx, name, …, builds: {GF: {ccs, policies}, RETRO: …}}]}

Policy points store only the values that differ from the base point (ETS / credit, z_cost, LCOA, reference plant);
the page overlays them on the base point. US credits (45V / 45Q, levelised in the re-priced file as
'US_credit_$/tNH3') are booked like a negative ETS cost of the ammonia unit, as the workbook books the ETS.
"""
import argparse, contextlib, datetime, importlib, io, json, math, sys
from pathlib import Path
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
HOPS = ROOT.parent.parent / "HOPS"
ap = argparse.ArgumentParser()
ap.add_argument("--stage", default=str(HOPS / "results" / "web_stage_v13"))
ap.add_argument("--script-dir", default=str(HOPS / "ProjectFinance"), help="folder of build_bu_finance.py")
ap.add_argument("--plants", default="", help="comma-separated plant numbers (default: every plant in data/plants.json)")
ap.add_argument("--reference", default="", help="plant:GF|RETRO:ccs:ci — print the Python cash-flow results for this point")
ap.add_argument("-o", "--out", default=str(ROOT / "data" / "finance"))
ap.add_argument("--index-only", action="store_true", help="only (re)write index.json from the plant files already in --out")
# requested sites (solve.yml): one greenfield site from the cloud solve folder, merged into the published index
ap.add_argument("--site-results", default="", help="folder of a site solve (solve.yml: site_runs); converts --plants as greenfield sites")
ap.add_argument("--site-label", default="site_v1", help="label of the site solve files")
ap.add_argument("--run-haircut", type=float, default=None, help="EXPORT_DISCOUNT the runs were solved with (v13 fleet 1.0; site model 0.90)")
ap.add_argument("--merge-index", action="store_true", help="add/replace the converted plants in the existing index.json instead of rewriting it")
a = ap.parse_args()

sys.path.insert(0, a.script_dir)
bu = importlib.import_module("build_bu_finance")
bu.RUN_EXPORT_DISCOUNT = 1.0          # v13: exports credited at the full wholesale price in the runs

BUILDS = {
    "GF": dict(dir="results", label="IRR_v13", bau="BAU_v13", gf=None, bau_gf=None,
               name="Greenfield: new hybrid plant at the site"),
    "RETRO": dict(dir="results_retrofit", label="RETRO50_LCOA_v13", bau="BAU_RETRO_v13", gf="IRR_v13", bau_gf="BAU_v13",
                  name="Retrofit: the existing plant converted"),
}
if a.site_results:                       # a requested site: greenfield only (no existing plant), its own BAU reference
    BUILDS = {"GF": dict(dir=str(Path(a.site_results).resolve()), label=a.site_label, bau=a.site_label, gf=None, bau_gf=None,
                         name="Greenfield: new hybrid plant at the site")}
    bu.RUN_EXPORT_DISCOUNT = 0.90 if a.run_haircut is None else a.run_haircut   # the site model (hops_core 2026-09) credits exports at 0.90
elif a.run_haircut is not None:
    bu.RUN_EXPORT_DISCOUNT = a.run_haircut
POLICIES = {"ETSlaw": "EU ETS, current law", "ETSprop": "EU ETS, proposal", "USCred": "US credits 45V / 45Q"}

# keys the page needs: every Model Data row plus the retrofit rows (text rows kept as text)
HEAD = {k for k, _, _ in bu.DATA_ROWS + bu.RETRO_ROWS if k.startswith("_h")}
KEYS = ["CI"] + [k for k, _, _ in bu.DATA_ROWS + bu.RETRO_ROWS if k not in HEAD]
TEXT = {"RETRO_STATE"}
BAU_KEYS = ["BAU_LCOA_A", "BAU_CI", "BAU_CAPEX", "BAU_CASH", "BAU_GRAY_H2", "BAU_NG_MWh", "BAU_H2_kg", "BAU_LCOA_XB"]

# the hourly files are shared by the base sweep and its policy re-pricings: read each once per plant
_pq_cache = {}
_read_parquet = pd.read_parquet
def cached_parquet(path, *args, **kw):
    if args or kw:
        return _read_parquet(path, *args, **kw)
    if path not in _pq_cache:
        _pq_cache[path] = _read_parquet(path)
    return _pq_cache[path]
bu.pd.read_parquet = cached_parquet


def clean(k, v):
    if k in TEXT:
        return str(v) if v is not None else ""
    v = float(v)
    if math.isnan(v) or math.isinf(v):
        return None
    return round(v, 6) if abs(v) < 1e4 else round(v, 2)


def load(build, idx, ccs, policy=None):
    """load_points() of the workbook script; None if the sweep file is missing."""
    b = BUILDS[build]
    res = str(Path(a.stage) / b["dir"])
    gf_res = str(Path(a.stage) / "results")
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            return bu.load_points(res, idx, ccs, b["label"], b["bau"], b["gf"], b["bau_gf"], gf_res, None, policy)
    except SystemExit:
        return None


def us_credit(build, idx, ccs):
    """{CI: $/t} levelised US credit of the sweep, and the reference plant's own credit ($/t)."""
    b = BUILDS[build]
    f = Path(a.stage) / b["dir"] / f"CI_Range_SMR_INT_ASU_plant{idx}_CCS{ccs}_{b['label']}_USCred.csv"
    d = pd.read_csv(f)
    cr = {round(float(c), 2): float(v) for c, v in zip(d[bu.CI_COL], d["US_credit_$/tNH3"].fillna(0.0))}
    fb = Path(a.stage) / b["dir"] / f"BAU_AllPlants_SMR_INT_ASU_CCSNo_{b['bau']}_USCred.csv"
    crb = 0.0
    if fb.exists():
        x = pd.read_csv(fb); x = x[x["plant_idx"] == idx]
        if len(x) and "US_credit_$/tNH3" in x.columns:
            crb = float(x["US_credit_$/tNH3"].fillna(0.0).iloc[0])
    return cr, crb


def tidy(build, idx, ccs, pts, policy=None):
    """Points as the page stores them (rounded), with the US credit booked where it applies."""
    if policy == "USCred":
        cr, crb = us_credit(build, idx, ccs)
        for d in pts:
            c = cr.get(d["CI"], 0.0)
            d["ETS"] -= c * d["NH3_t"]          # a credit is a negative cost of the ammonia unit
            d["Z_COST"] -= c
            if crb:
                d["BAU_CASH"] -= crb * d["NH3_t"]
    return [{k: clean(k, d.get(k, 0.0)) for k in KEYS} for d in pts]


def diff(base, pol):
    """Per CI point of the base sweep: the values of the policy point that differ."""
    by_ci = {p["CI"]: p for p in pol}
    out = []
    for b in base:
        p = by_ci.get(b["CI"])
        out.append(None if p is None else {k: v for k, v in p.items() if k != "CI" and v != b.get(k)})
    return out


plants = json.loads((ROOT / "data" / "plants.json").read_text())
plants = plants if isinstance(plants, list) else plants.get("plants", plants)
want = {int(x) for x in a.plants.split(",") if x.strip()}
plants = [p for p in plants if (p["idx"] < 1000 or a.site_results) and (not want or p["idx"] in want)]

out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
index, skipped = [], []
if a.index_only:                                   # after parallel runs on plant subsets (--plants): collect them
    for p in sorted(plants, key=lambda q: q["idx"]):
        f = out / f"plant{p['idx']}.json"
        if not f.exists():
            skipped.append(p["idx"]); continue
        rec = json.loads(f.read_text())
        if "builds" not in rec:
            sys.exit(f"ABORT: {f} is in the old format (run the converter for this plant first)")
        index.append({k: rec[k] for k in ("idx", "name", "admin", "country", "region", "lat", "lon", "ktpa")}
                     | {"builds": {bk: {"ccs": sorted(v["cases"]), "policies": sorted(v["policies"])} for bk, v in rec["builds"].items()}})
    plants = []
for n, p in enumerate(sorted(plants, key=lambda q: q["idx"])):
    _pq_cache.clear()
    builds, meta, tpd = {}, {}, None
    for bk in BUILDS:
        cases, pols = {}, {}
        for ccs in ("No", "Yes"):
            got = load(bk, p["idx"], ccs)
            if got is None:
                continue
            m, pts = got
            tpd = tpd or m["tpd"]
            cases[ccs] = tidy(bk, p["idx"], ccs, pts)
            for pk in POLICIES:
                gp = load(bk, p["idx"], ccs, pk)
                if gp is None:
                    continue
                pols.setdefault(pk, {})[ccs] = diff(cases[ccs], tidy(bk, p["idx"], ccs, gp[1], pk))
        if not cases:
            continue
        # Plants that are already green have one design point and no fossil baseline: no business case.
        if sum(len(v) for v in cases.values()) < 2:
            continue
        # Reference plant = today's plant WITHOUT CCS for both cases (the BAU with CCS is not staged for the web).
        if "No" in cases and "Yes" in cases:
            b0 = cases["No"][0]
            for q in cases["Yes"]:
                for k in BAU_KEYS:
                    q[k] = b0.get(k, q.get(k))
            for pk, pv in pols.items():
                if "No" in pv and "Yes" in pv and pv["No"][0] is not None:
                    for q in pv["Yes"]:
                        if q is not None:
                            for k in BAU_KEYS:
                                if k in pv["No"][0]:
                                    q[k] = pv["No"][0][k]
                                else:
                                    q.pop(k, None)
        builds[bk] = {"label": BUILDS[bk]["label"], "cases": cases, "policies": pols}
    if not builds:
        skipped.append(p["idx"]); continue
    rec = {"idx": p["idx"], "name": p.get("name"), "admin": p.get("admin"), "country": p.get("country"),
           "region": p.get("region"), "lat": p["lat"], "lon": p["lon"], "ktpa": p.get("ktpa"), "tpd": round(tpd, 1),
           "builds": builds}
    (out / f"plant{p['idx']}.json").write_text(json.dumps(rec, separators=(",", ":"), ensure_ascii=False))
    index.append({k: rec[k] for k in ("idx", "name", "admin", "country", "region", "lat", "lon", "ktpa")}
                 | {"builds": {bk: {"ccs": sorted(v["cases"]), "policies": sorted(v["policies"])} for bk, v in builds.items()}})
    print(f"[{n + 1}/{len(plants)}] plant {p['idx']:3d} {str(p.get('name')):24s} "
          + " · ".join(f"{bk}: " + ",".join(f"{c}{len(x)}" for c, x in v["cases"].items()) + (" +" + "/".join(v["policies"]) if v["policies"] else "")
                       for bk, v in builds.items()), flush=True)

if a.merge_index and (out / "index.json").exists():
    ixf = json.loads((out / "index.json").read_text())
    done = {e["idx"] for e in index}
    ixf["plants"] = sorted([e for e in ixf["plants"] if e["idx"] not in done] + index, key=lambda e: e["idx"])
    ixf["generated"] = datetime.date.today().isoformat()
    (out / "index.json").write_text(json.dumps(ixf, separators=(",", ":"), ensure_ascii=False))
    print(f"index.json: {len(index)} plant(s) added or replaced, {len(ixf['plants'])} in total")
elif not want or a.index_only:
    fin = {u: bu.FIN[u] for u in bu.UNITS + [bu.REF]}
    book = dict(bu.BOOK)
    (out / "index.json").write_text(json.dumps({
        "generated": datetime.date.today().isoformat(), "builds": {k: v["name"] for k, v in BUILDS.items()},
        "labels": {k: v["label"] for k, v in BUILDS.items()}, "policies": POLICIES, "plants": index,
        "model": {"units": bu.UNITS, "ref": bu.REF, "unit_names": bu.UNIT_NAMES, "fin": fin, "ncon": bu.NCON, "nops": bu.NOPS,
                  "spend": list(bu.SPEND), "esc_rev": bu.ESC_REV, "esc_cost": bu.ESC_COST, "opr_margin": bu.OPR_MARGIN,
                  "grid_opex_pct": bu.GRID_OPEX_PCT, "curt_paid": bu.CURTAIL_PAID, "run_export_discount": bu.RUN_EXPORT_DISCOUNT,
                  "rates": [list(r) for r in bu.RATES], "lines": bu.LINES, "capex": bu.CAPEX, "opex": bu.OPEX, "book": book,
                  "data_rows": [list(r) for r in bu.DATA_ROWS + bu.RETRO_ROWS]}}, separators=(",", ":"), ensure_ascii=False))
    print(f"index.json: {len(index)} plants" + (f" · no finance data for {skipped}" if skipped else ""))

if a.reference:
    pl, bk, ccs, ci = a.reference.split(":")
    meta, pts = load(bk, int(pl), ccs)
    if meta["retro"]:
        bu.BOOK[bu.REF] = ["BAU_CAPEX"]
    d = next(q for q in pts if q["CI"] == round(float(ci), 2))
    inputs = dict(curt_paid=bu.CURTAIL_PAID, grid_opex_pct=bu.GRID_OPEX_PCT, exp_real=1.0, book_share=1.0)
    rates = bu.default_rates(d, inputs)
    inputs["p_NG_built"] = rates["p_NG"]
    ref = {"rates": rates, "units": {}, "system": bu.solve_system_breakeven(d, rates, inputs)}
    for u in bu.UNITS + [bu.REF]:
        cf = bu.unit_cf(u, d, rates, inputs); cf.pop("lines"); cf.pop("pcf", None)
        cf["min_p"] = bu.solve_min_rate(u, d, rates, inputs, "project")
        cf["min_e"] = bu.solve_min_rate(u, d, rates, inputs, "equity")
        ref["units"][u] = {k: (None if isinstance(v, float) and math.isnan(v) else v) for k, v in cf.items()}
    print("REFERENCE " + json.dumps(ref))
