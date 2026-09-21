#!/usr/bin/env python3
"""
build_trade_layer.py — the ammonia market layer of the atlas from the demand/trade workbook.

    python3 tools/build_trade_layer.py --xlsx ~/Documents/Stanford/PhD/HOPS/global_ammonia_demand_trade_2025_1.xlsx -o data/trade

Reads the workbook's Country_summary, Production, Imports, Exports and Bilateral_2025 sheets and writes
data/trade/ammonia_2025.json:
    countries  {iso3: {name, production_kt, imports_kt, exports_kt, net_kt, demand_kt, hops_plants, hops_capacity_ktpa,
                       basis: {imports: 'reported 2025' | '2024 (2025 qty missing)' | None, exports: …}, quality}}
    flows      [{from: exporter iso3, to: importer iso3, kt, value_kusd}]     importer-reported bilateral, 2025
    meta       units, sources, coverage notes
Tonnages are kt NH3 (the workbook converts USGS kt N with 1.2159 t NH3 / t N). Where a 2025 quantity is missing but the
2024 one exists, 2024 is used and marked in `basis` so the atlas can say so; nothing is estimated here.
"""
from __future__ import annotations
import argparse, json, re
from pathlib import Path
import openpyxl

ALIASES = {"United States": "USA", "Trinidad and Tobago": "TTO", "Egypt, Arab Rep.": "EGY", "Russian Federation": "RUS", "Korea, Rep.": "KOR",
           "Iran, Islamic Rep.": "IRN", "Turkiye": "TUR", "Türkiye": "TUR", "Viet Nam": "VNM", "Netherlands": "NLD", "Bahrein": "BHR", "Bahrain": "BHR"}

def num(v):
    try: return None if v in (None, "") else float(v)
    except (TypeError, ValueError): return None

def rows(ws, header_key):
    data = list(ws.iter_rows(values_only=True))
    for i, r in enumerate(data):
        if r and str(r[0]).strip() == header_key:
            out = [dict(zip([str(h).strip() for h in r], x)) for x in data[i + 1:] if x and x[0] not in (None, "")]
            return [d for d in out if "ISO3" not in d or (isinstance(d.get("ISO3"), str) and re.fullmatch(r"[A-Z]{3}", d["ISO3"].strip()))]   # drops caveat/footnote rows
    raise SystemExit(f"header row starting with {header_key!r} not found in {ws.title}")

def col(d, prefix):
    for k in d:
        if k.startswith(prefix): return d[k]
    return None

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--xlsx", required=True); ap.add_argument("-o", "--out", default="data/trade")
    ap.add_argument("--register", default="atlas/assets/static.json", help="the plant register (the atlas's global fleet with country + ktpa): capacity per country, and the production fallback")
    ap.add_argument("--countries", default="data/geo/countries.json", help="country polygons with ISO3 (for name → ISO3)")
    a = ap.parse_args()
    wb = openpyxl.load_workbook(a.xlsx, read_only=True, data_only=True)
    summ = rows(wb["Country_summary"], "Country"); prod = rows(wb["Production"], "Country"); imp = rows(wb["Imports"], "Country"); exp = rows(wb["Exports"], "Country"); bil = rows(wb["Bilateral_2025"], "Importer")
    name2iso = {**{str(r["Country"]).strip(): r["ISO3"] for r in summ}, **{str(col(r, "Country (as")).strip(): r["ISO3"] for r in imp + exp + prod if col(r, "Country (as")}, **ALIASES}
    C = {}
    for r in summ:
        iso = r["ISO3"]
        C[iso] = {"name": str(r["Country"]).strip(), "production_kt": num(col(r, "Production")), "imports_kt": num(col(r, "Imports")), "exports_kt": num(col(r, "Exports")),
                  "net_kt": num(col(r, "Net trade")), "demand_kt": num(col(r, "Apparent demand")), "hops_plants": num(col(r, "HOPS plants")), "hops_capacity_ktpa": num(col(r, "HOPS capacity")),
                  "quality": (str(col(r, "Data quality")).strip() if col(r, "Data quality") else None), "basis": {}}
    # imports / exports: 2025 reported quantity, else 2024 quantity (flagged)
    for kind, table in (("imports", imp), ("exports", exp)):
        for r in table:
            iso = r["ISO3"]; c = C.setdefault(iso, {"name": str(r["Country"]).strip(), "basis": {}})
            q25, q24 = num(col(r, "2025 (t")), num(col(r, "2024 (t"))
            if q25: c[f"{kind}_kt"] = q25 / 1000; c["basis"][kind] = "reported 2025"
            elif q24: c[f"{kind}_kt"] = q24 / 1000; c["basis"][kind] = "2024 (2025 quantity missing)"
            c[f"{kind}_value_kusd"] = num(col(r, "2025 value")) or num(col(r, "2024 value"))
    for r in prod:
        iso = r["ISO3"]; c = C.setdefault(iso, {"name": str(r["Country"]).strip(), "basis": {}})
        p = num(col(r, "2025e (kt NH3")) or num(col(r, "2024 (kt NH3"))
        if p: c["production_kt"] = p; c["share_world"] = num(col(r, "Share of world"))
    for iso, c in C.items():
        if c.get("net_kt") is None and (c.get("imports_kt") or c.get("exports_kt")): c["net_kt"] = (c.get("imports_kt") or 0) - (c.get("exports_kt") or 0)
        if c.get("demand_kt") is None and c.get("production_kt") is not None: c["demand_kt"] = c["production_kt"] + (c.get("net_kt") or 0)
    # plant register: nameplate capacity per country — the source of truth for "how much ammonia is made here" where USGS has no row
    try:
        reg = json.loads(Path(a.register).read_text())["ammonia"]; geo = json.loads(Path(a.countries).read_text())["features"]
        g2iso = {f["properties"]["name"]: f["properties"]["iso3"] for f in geo}
        g2iso.update({"USA": "USA", "United States": "USA", "Russia": "RUS", "Iran": "IRN", "Vietnam": "VNM", "North Korea": "PRK", "South Korea": "KOR", "Czech Republic": "CZE", "Czechia": "CZE",
                      "Bosnia and Herzegovina": "BIH", "Serbia": "SRB", "Trinidad and Tobago": "TTO", "United Kingdom": "GBR", "Turkey": "TUR", "Syria": "SYR", "Libya": "LBY", "Venezuela": "VEN", "Bolivia": "BOL", "Tanzania": "TZA", "Ivory Coast": "CIV", "Bahrain": "BHR", "Qatar": "QAT", "Kuwait": "KWT", "UAE": "ARE", "United Arab Emirates": "ARE", "Bahrein": "BHR"})
        cap, cnt, unk = {}, {}, set()
        for pl in reg:
            iso = g2iso.get(pl.get("country")); 
            if not iso: unk.add(pl.get("country")); continue
            cap[iso] = cap.get(iso, 0) + float(pl.get("ktpa") or 0); cnt[iso] = cnt.get(iso, 0) + 1
        for iso, k in cap.items():
            c = C.setdefault(iso, {"name": next((f["properties"]["name"] for f in geo if f["properties"]["iso3"] == iso), iso), "basis": {}})
            c["capacity_ktpa"] = round(k, 1); c["plants"] = cnt[iso]
            if c.get("production_kt") is None and k > 0:
                c["production_kt"] = round(k, 1); c["basis"]["production"] = "nameplate capacity (plant register) — no USGS row"
                c["demand_kt"] = round(k + (c.get("net_kt") or 0), 1); c["basis"]["demand"] = "capacity + net trade"
            elif c.get("production_kt") is not None: c["basis"]["production"] = "USGS 2025e"
        print(f"register: {len(reg)} plants → capacity for {len(cap)} countries; unmapped names: {sorted(x for x in unk if x)}")
    except Exception as e:
        print(f"[register] skipped ({e})")
    flows, unknown = [], set()
    for r in bil:
        imp_name = str(r["Importer"]).strip(); frm = r.get("ISO3 exporter"); kt = num(col(r, "Quantity"))
        if imp_name.endswith("— total") or imp_name.endswith("- total"): continue                    # subtotal rows, not flows
        to = name2iso.get(imp_name)
        if not to: unknown.add(imp_name); continue
        if not frm or not kt: continue
        flows.append({"from": frm, "to": to, "kt": round(kt / 1000, 2), "value_kusd": num(col(r, "Value")), "note": (str(r.get("Note")).strip() if r.get("Note") else None)})
    flows.sort(key=lambda f: -f["kt"])
    meta = {"units": "kt NH3 per year (2025; 2024 where flagged in basis); production = USGS where reported, else nameplate capacity of the plant register", "year": 2025,
            "sources": ["USGS Mineral Commodity Summaries 2026 — Nitrogen (fixed)—Ammonia, production (kt N × 1.2159)", "UN Comtrade via WITS — HS 2814 anhydrous ammonia, imports/exports 2024–2025", "Bilateral: importer-reported partner tonnages (WITS), 2025"],
            "notes": ["Apparent demand = production + imports − exports; captive production dominates, so it is an upper bound of the merchant market.",
                      "Russia reports no trade; Algeria/Oman/Qatar 2025 exports missing (2024 used where available); Morocco/Turkey 2025 imports value-only (2024 tonnage used).",
                      "EU reported only as an aggregate in Comtrade; member states carry their own rows."],
            "compiled": "2026-09-21", "n_countries": len(C), "n_flows": len(flows)}
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    (out / "ammonia_2025.json").write_text(json.dumps({"countries": C, "flows": flows, "meta": meta}, separators=(",", ":")))
    print(f"{len(C)} countries, {len(flows)} bilateral flows ({sum(f['kt'] for f in flows):.0f} kt) → {out / 'ammonia_2025.json'}")
    if unknown: print("importer names without ISO3 (add to ALIASES):", sorted(unknown))
    top = sorted(((c.get('demand_kt') or 0, c['name']) for c in C.values()), reverse=True)[:5]; print("top demand:", [(n, round(d)) for d, n in top])

if __name__ == "__main__":
    main()
