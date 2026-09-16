#!/usr/bin/env python3
"""
hops_to_web.py — turn HOPS fleet results (Sherlock layout) into the files the website reads.

    python3 hops_to_web.py --results ~/Documents/Stanford/PhD/HOPS/results/sherlock_v7 \
                           --label IRR_v7 --bau-label BAU_v7 -o <repo>/data

Reads (from --results):
    CI_Range_{PATHWAY}_plant{idx}_CCS{Yes|No}_{LABEL}.csv            one row per CI target
    CI_Range_..._{LABEL}_{POLICY}.csv                                 re-priced copies (ETSlaw, ETSprop, USCred)
    BAU_AllPlants_{PATHWAY}_CCSNo_{BAU_LABEL}[_{POLICY}].csv          one row per plant
    hourly/hourly_{PATHWAY}_plant{idx}_CCS{Yes|No}_CI{ci}_{LABEL}.parquet
    hourly/hourly_BAU_{PATHWAY}_plant{idx}_CCSNo_{BAU_LABEL}.parquet

Writes (into -o):
    plants.json        one record per modelled plant (idx, name, lat, lon, country, region, capacity)
    scenarios.json     the tool's scenario list: plant x CCS x policy, each with 8 CI rows of scalars
    bau.json           BAU reference per plant, base + each policy case
    summary.json       every Overview column of every run, flat (for fleet views / download)
    manifest.json      version stamp + what hourly files exist
    runs/plant{idx}/{SMR|SMR+CCS}/ci{0.25}.json.gz     hourly dispatch (all series, 2 dp), ~200 KB each
    runs/plant{idx}/BAU/bau.json.gz

Safe to re-run: files are overwritten, the manifest is rebuilt from what is on disk.
Plant numbering is the HOPS index (Plants_US_and_Europe.xlsx "Plant idx", e.g. Brunsbuettel = 61);
amm_idx cross-references the global ammonia list used by the globe (updated_plants_with_country.xlsx).
"""
from __future__ import annotations
import argparse, glob, gzip, json, math, os, re, sys
from datetime import date
from pathlib import Path
import pandas as pd

# ----------------------------------------------------------------- Overview column -> tool row key
# Left: the tool's existing row keys (kept byte-identical so the tool code needs no change).
# Right: Sherlock CSV column. Values are already per-tonne where the unit says so.
ROW_MAP = {
    "target":       "Target_NH3_CO2_intensity_kgCO2_per_kgNH3",
    "ci_noccs":     "Carbon Intensity tCO2/tNH3 no CCS",
    "ci_ccs":       "Carbon Intensity tCO2/tNH3 with CCS",
    "lcoa":         "z_cost $/ton NH3",                       # integrated owner, nets export revenue
    "lcoa_base":    "LCOA_ammonia_only_base_$/tNH3",
    "lcoa_lcoe":    "LCOA_ammonia_only_LCOE",                 # basis A
    "lcoa_export":  "LCOA_ammonia_only_EXPORT",               # basis B
    "elec_cost":    "Electricity Costs $/tNH3",
    "ng_cost":      "OPEX_NG_FUEL $/ton NH3",
    "demand_cost":  "Demand_Charge_Cost $/tNH3",
    "sold":         "Sold to Grid $/ton NH3",
    "carbon_price": "Carbon price cost per ton NH3",
    "ets_cost":     "EU ETS allowance cost per ton NH3",
    "capex_pv":     "CAPEX_PV $",       "opex_pv":  "OPEX_PV $",
    "capex_wt":     "CAPEX_WT $",       "opex_wt":  "OPEX_WT $",
    "capex_el":     "CAPEX_EL $",       "opex_el":  "OPEX_EL $",
    "capex_b":      "CAPEX_B $",        "opex_b":   "OPEX_B $",
    "capex_cp":     "CAPEX_CP $",       "opex_cp":  "OPEX_CP $",
    "capex_st":     "CAPEX_ST $",
    "capex_asu":    "CAPEX ASU $",      "opex_asu": "OPEX_ASU $",
    "capex_nh3":    "CAPEX_NH3 $",      "opex_nh3": "OPEX_NH3 $",
    "capex_smr":    "CAPEX_SMR $",      "opex_smr": "OPEX_SMR $",
    "capex_hb":     "CAPEX_HB $",       "opex_hb":  "OPEX_HB $",
    "capex_ccs":    "CAPEX_CCS $",      "opex_ccs": "OPEX_CCS $",
    "capex_stturb": "CAPEX_ST_TURB $",  "opex_stturb": "OPEX_ST_TURB $",
    "capex_grid":   "CAPEX_GRID_CONNECTION",
    "capex_gridload": "CAPEX_GRID_CONNECTION_LOAD",
    "p_pv": "P_PV MW", "p_wt": "P_WT MW", "p_el": "P_EL MW", "p_b": "P_B MW", "p_cp": "P_CP MW",
    "p_st": "P_ST MW", "p_nh3": "P_NH3 MW", "p_smr": "P_SMR tons H2/day", "p_hb": "P_HB MW", "p_stturb": "P_ST_TURB MW",
    "e_pv": "PV_output_sum MWh", "e_wt": "WT_output_sum MWh", "e_imp": "imported_electricity_sum MWh",
    "e_el": "electrolyzer_electricity_input_sum MWh", "e_exp": "Export_MWh_raw", "e_smr": "smr_electricity_input_sum MWh",
    "h2_el": "electrolyzer_H2_output_sum tons", "h2_smr": "smr_H2_output_sum tons",
    "co2_gen": "CO2 generated total tCO2/yr", "co2_cap": "CO2 captured tCO2/yr", "cap_rate": "Overall capture rate %",
    "cap_syngas": "CO2 captured syngas point tCO2/yr", "cap_flue": "CO2 captured flue point tCO2/yr",
    "cost_co2": "Cost of CO2 captured TOTAL $/tCO2",
    "elec_int": "Total_electricity_consumed MWh/tNh3", "ng_feed_int": "Total NG Feed Consumed MWh/tNh3",
    "ng_fuel_int": "Total NG Fuel Consumed MWh/tNh3",
    "retail_bench": "Industrial_Retail_Benchmark $/MWh", "grid_ci": "Avg grid CI tCO2/MWh",
    "grid_share": "Grid emissions share %", "emis_noccs": "Emissions tCO2 no CCS", "emis_ccs": "Emissions tCO2 with CCS",
    "irr": "Project IRR %", "npv": "Project NPV $", "capex_overnight": "CAPEX overnight $", "net_cf": "Annual net CF $",
    "nh3_price": "NH3 price $/t", "lcoe_ren": "LCOE Renewables $/MWh", "elec_price": "Realized_Elec_Price_Total $/MWh",
    "crf": "CRF", "interest": "interest_rate", "lifetime": "lifetime_yr",
    # policy re-pricing extras (present only in the policy CSVs)
    "ets_credit": "ETS_levelised_credit_$/tNH3", "us_credit": "US_credit_$/tNH3",
    "lcoa_lcoe_nopolicy": ("LCOA_ammonia_only_LCOE_noETS", "LCOA_ammonia_only_LCOE_noCredit"),
}
OPEX_SUM = ["opex_pv","opex_wt","opex_el","opex_b","opex_cp","opex_asu","opex_nh3","opex_smr","opex_hb","opex_ccs","opex_stturb"]

# hourly parquet column -> series key (the first 13 are what the tool reads today)
HOURLY_MAP = {
    "V_E_PV":"pv","V_E_WT":"wt","U_E_GRID":"imp","V_E_GRID":"exp","U_E_EL":"el","U_E_SMR":"smr","U_E_ASU":"asu",
    "V_NH3_NH3":"nh3","U_E_CP":"cp","U_E_HB":"hb","U_E_B":"b","V_H2_EL":"h2el","V_H2_SMR":"h2smr",
    "V_H_HB":"hbd","S_E_HB":"hbsoc","V_E_B":"bd","S_E_B":"bsoc","U_E_NH3":"nh3el",
    "U_H2_ST":"h2chg","V_H2_ST":"h2dis","S_H2_ST":"h2st","U_H2_NH3":"h2nh3",
    "p_grid_import_$/MWh":"price","p_grid_export_$/MWh":"pexp",
    "V_CO2_CCS_process":"co2proc","V_CO2_CCS_heating":"co2heat",
    "U_NG_feedstock_SMR":"ngfeed","U_NG_combustion_SMR":"ngfuel","V_E_ST":"stgen","U_H_ST":"stheat",
}
POLICIES = {"ETSlaw": "EU ETS (current law)", "ETSprop": "EU ETS (proposed)", "USCred": "US 45V/45Q"}
PATHWAY = "SMR_INT_ASU"

def path_label(ccs: str) -> str:            # Sherlock CCS flag -> tool pathway label
    return "SMR+CCS" if ccs == "Yes" else "SMR"

def num(v, nd=3):
    """Round for JSON; None for NaN; ints for large magnitudes."""
    if v is None or (isinstance(v, float) and (math.isnan(v) or math.isinf(v))): return None
    if isinstance(v, str): return v
    if hasattr(v, "item"): v = v.item()
    if isinstance(v, bool): return v
    if isinstance(v, (int,)): return v
    if abs(v) >= 1e5: return int(round(v))
    return round(float(v), nd)

def row_from(r: pd.Series) -> dict:
    out = {}
    for k, col in ROW_MAP.items():
        cols = col if isinstance(col, tuple) else (col,)
        for c in cols:
            if c in r.index:
                out[k] = num(r[c]); break
    out["opex_fixed"] = num(sum((out.get(k) or 0) for k in OPEX_SUM))
    return out

def load_plants(results: Path, plants_xlsx: Path | None, amm_xlsx: Path | None, names: dict) -> dict[int, dict]:
    """Plant records from the CSVs themselves (lat/lon/country/region/tpd), enriched from the master lists."""
    recs = {}
    for f in glob.glob(str(results / f"CI_Range_{PATHWAY}_plant*_CCSNo_*.csv")):
        d = pd.read_csv(f, nrows=1)
        idx = int(d["plant_idx"].iloc[0])
        if idx in recs: continue
        recs[idx] = {"idx": idx, "lat": num(d["lat"].iloc[0], 5), "lon": num(d["lon"].iloc[0], 5),
                     "country": str(d["country"].iloc[0]), "region": str(d.get("Sales region", pd.Series(["?"])).iloc[0]),
                     "tpd": num(d["tNH3_day"].iloc[0], 1), "ktpa": num(d["tNH3_day"].iloc[0] * 365 / 1000, 0)}
    amm = pd.read_excel(amm_xlsx) if amm_xlsx and amm_xlsx.exists() else None
    for idx, p in recs.items():
        if amm is not None:
            dd = (amm["Latitude"] - p["lat"]).abs() + (amm["Longitude"] - p["lon"]).abs()
            i = dd.idxmin(); p["amm_idx"] = int(amm.loc[i, "Plant idx"]) if dd[i] < 0.02 else None
        n = names.get(str(idx)) or {}
        p["name"] = n.get("name") or f"Plant {idx}"
        p["admin"] = n.get("admin") or ""
    return recs

def convert(results: Path, out: Path, label: str, bau_label: str, plants_xlsx, amm_xlsx, names_json) -> None:
    names = json.loads(Path(names_json).read_text()) if names_json and Path(names_json).exists() else {}
    plants = load_plants(results, plants_xlsx, amm_xlsx, names)
    print(f"{len(plants)} plants")
    hourly_dir = results / "hourly"
    scenarios, summary, bau = [], [], {"base": {}}
    manifest = {"version": f"{label}-{date.today().isoformat()}", "label": label, "bau_label": bau_label,
                "pathway": PATHWAY, "generated": date.today().isoformat(), "policies": POLICIES, "plants": {}}

    # ---- BAU (CCSNo is canonical; CCS is irrelevant to an unconstrained solve)
    def bau_rows(fp):
        d = pd.read_csv(fp); o = {}
        for _, r in d.iterrows():
            rr = row_from(r)
            o[int(r["plant_idx"])] = {"lcoa": rr["lcoa"], "ci": rr["ci_noccs"], "elec_cost": rr["elec_cost"],
                                      "ng_cost": rr["ng_cost"], "carbon_price": rr["carbon_price"], "ets_cost": rr.get("ets_cost"),
                                      "lcoa_base": rr.get("lcoa_base"), "irr": rr.get("irr"), "row": rr}
        return o
    bau["base"] = bau_rows(results / f"BAU_AllPlants_{PATHWAY}_CCSNo_{bau_label}.csv")
    for pol in POLICIES:
        fp = results / f"BAU_AllPlants_{PATHWAY}_CCSNo_{bau_label}_{pol}.csv"
        if fp.exists(): bau[pol] = bau_rows(fp)

    # ---- CI sweeps: plant x CCS x policy
    for idx in sorted(plants):
        p = plants[idx]; man = manifest["plants"].setdefault(str(idx), {})
        for ccs in ("No", "Yes"):
            path = path_label(ccs)
            for pol in [None, *POLICIES]:
                suffix = f"{label}_{pol}" if pol else label
                fp = results / f"CI_Range_{PATHWAY}_plant{idx}_CCS{ccs}_{suffix}.csv"
                if not fp.exists(): continue
                d = pd.read_csv(fp).sort_values("Target_NH3_CO2_intensity_kgCO2_per_kgNH3")
                rows = [row_from(r) for _, r in d.iterrows()]
                name = f"{p['name']} · {path.replace('+CCS', ' +CCS')}" + (f" +{POLICIES[pol]}" if pol else "")
                scenarios.append({"plant": idx, "amm_idx": p.get("amm_idx"), "loc": p["name"], "region": p["region"],
                                  "country": p["country"], "path": "SMR", "ccs": ccs == "Yes", "hb": True,
                                  "cp": pol is not None, "policy": pol, "name": name, "label": suffix,
                                  "file": fp.name, "rows": rows})
                for _, r in d.iterrows():
                    summary.append({"plant": idx, "name": p["name"], "path": path, "policy": pol, "label": suffix,
                                    **{c: num(r[c]) for c in d.columns}})
                # hourly (policy runs are re-priced, not re-solved: same dispatch as base)
                if pol is None:
                    lst = man.setdefault(path, [])
                    for _, r in d.iterrows():
                        ci = float(r["Target_NH3_CO2_intensity_kgCO2_per_kgNH3"])
                        hp = hourly_dir / f"hourly_{PATHWAY}_plant{idx}_CCS{ccs}_CI{ci:.2f}_{label}.parquet"
                        rel = f"runs/plant{idx}/{path}/ci{ci:.2f}.json.gz"
                        ok = write_hourly(hp, out / rel, {"key": f"{idx}_{path}_CI{ci:g}", "plant": idx, "path": path, "ci": ci})
                        lst.append({"ci": ci, "file": rel if ok else None})
        hp = hourly_dir / f"hourly_BAU_{PATHWAY}_plant{idx}_CCSNo_{bau_label}.parquet"
        rel = f"runs/plant{idx}/BAU/bau.json.gz"
        man["BAU"] = rel if write_hourly(hp, out / rel, {"key": f"{idx}_BAU", "plant": idx, "path": "BAU", "ci": None}) else None
        print(f"  plant{idx:<3d} {p['name'][:28]:28s} hourly: " + " ".join(
            f"{k}:{sum(1 for x in v if x['file'])}/{len(v)}" for k, v in man.items() if isinstance(v, list)) + f"  BAU:{'y' if man['BAU'] else '-'}")

    out.mkdir(parents=True, exist_ok=True)
    (out / "plants.json").write_text(json.dumps(sorted(plants.values(), key=lambda p: p["idx"]), indent=0))
    (out / "scenarios.json").write_text(json.dumps(scenarios, separators=(",", ":")))
    (out / "bau.json").write_text(json.dumps(bau, separators=(",", ":")))
    (out / "summary.json").write_text(json.dumps(summary, separators=(",", ":")))
    manifest["n_scenarios"] = len(scenarios); manifest["n_runs"] = len(summary)
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))
    kb = lambda f: f"{(out / f).stat().st_size / 1024:,.0f} KB"
    print(f"\n{len(scenarios)} scenarios, {len(summary)} runs")
    print(f"plants.json {kb('plants.json')} · scenarios.json {kb('scenarios.json')} · bau.json {kb('bau.json')} · summary.json {kb('summary.json')}")
    tot = sum(f.stat().st_size for f in (out / "runs").rglob("*.json.gz"))
    print(f"runs/: {sum(1 for _ in (out / 'runs').rglob('*.json.gz'))} files, {tot / 1e6:,.0f} MB")

def write_hourly(parquet: Path, dest: Path, meta: dict) -> bool:
    if not parquet.exists(): return False
    if dest.exists() and dest.stat().st_mtime >= parquet.stat().st_mtime: return True   # up to date
    d = pd.read_parquet(parquet)
    series = {k: [round(float(v), 2) for v in d[c].fillna(0).tolist()] for c, k in HOURLY_MAP.items() if c in d.columns}
    dest.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(dest, "wt", encoding="utf-8", compresslevel=6) as fh:
        json.dump({**meta, "n": len(d), "series": series}, fh, separators=(",", ":"))
    return True

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--results", required=True, help="folder with the CI_Range/BAU csvs and hourly/")
    ap.add_argument("--label", default="IRR_v7"); ap.add_argument("--bau-label", default="BAU_v7")
    ap.add_argument("-o", "--out", default="data")
    ap.add_argument("--plants", default="/Users/yaschue/Documents/PlantsAmmoniaGreen/plants/Plants_US_and_Europe.xlsx")
    ap.add_argument("--amm", default="/Users/yaschue/Downloads/HOPS/uploads/updated_plants_with_country.xlsx")
    ap.add_argument("--names", default=None, help="plant_names.json {idx: {name, admin}}")
    a = ap.parse_args()
    convert(Path(a.results), Path(a.out), a.label, a.bau_label, Path(a.plants), Path(a.amm), a.names)
    return 0

if __name__ == "__main__":
    sys.exit(main())
