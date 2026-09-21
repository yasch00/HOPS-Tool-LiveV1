#!/usr/bin/env python3
"""
build_grid_layers.py — the resource data layer of the atlas, from the HOPS capacity-factor grids.

    python3 tools/build_grid_layers.py --region Europe --region NorthAmerica -o data/grid --cells ~/Documents/Stanford/PhD/HOPS/cloud/cf

Reads HOPS_DATA/{solar,wind}_cf_2025_{Region}.npz (hourly, 0.25° grid; shape (8760, nlat, nlon, 1) + lats + lons — the SAME
files the optimizer uses, so what the globe shows is what a run would see) and writes two products:

  1. data/grid/{Region}.json          per-cell annual metrics for the globe layers (small, in the repo):
       solar, wind      annual mean capacity factor
       comb             mean CF of the variance-minimising wind/solar mix (see below), share = its PV share of capacity
       comb50           mean CF at a 50/50 capacity mix
       corr             hourly Pearson correlation wind–solar (negative = complementary)
       cv               coefficient of variation (std/mean) of the hourly combined output at the optimal mix — "smoothness"
       lowh             share of hours in which the combined output is below 10 % of its capacity — "firmness"
     plus data/grid/index.json listing the regions and their boxes.

  2. --cells DIR/{Region}/{i}_{j}.u16.gz   the hourly series of every cell (Uint16 little-endian, CF × 10000; first 8760 values
     solar, next 8760 wind; ~20 KB gzipped) — for upload to object storage (Cloudflare R2), fetched on demand by
     atlas/lib/griddata.js for the site inspector, the build flow and the household tool. Not for the repo (1–2 GB).

Combined capacity factor — how it is defined here (and in the hybrid-plant literature)
--------------------------------------------------------------------------------------
For a capacity mix with PV share s (0–1) the combined hourly CF is  c(t) = s·pv(t) + (1−s)·w(t)  — the generation of a plant
with 1 MW of total nameplate split s / 1−s. Its mean is just the weighted mean CF, so "combined CF" only says something once
the mix is fixed. Studies fix it three ways: (a) an assumed ratio (often 1:1), (b) the mix that minimises the variance of c(t)
— the complementarity optimum, s* = (var_w − cov) / (var_pv + var_w − 2 cov), clipped to [0, 1] — used in the wind–solar
complementarity literature, or (c) the cost-optimal mix from an optimiser (what HOPS solves per plant). The map carries (a)
and (b) precomputed for every cell; the atlas computes (a)–(b) for any share in the browser from the cell's hourly series,
and (c) is read from the nearest solved plant. The NPZ files are the single source: nothing here is re-modelled.
"""
from __future__ import annotations
import argparse, gzip, json, os, sys
from pathlib import Path
import numpy as np

HOPS_DATA = Path(os.environ.get("HOPS_DATA_DIR", Path.home() / "Documents/Stanford/PhD/HOPS/HOPS_DATA"))
YEAR = 2025

DATA_DIRS = [HOPS_DATA]                                   # searched in order; --data-dir prepends (e.g. the OneDrive WeatherData folder)

def load(region: str, kind: str):
    f = next((d / f"{kind}_cf_{YEAR}_{region}.npz" for d in DATA_DIRS if (d / f"{kind}_cf_{YEAR}_{region}.npz").exists()), None)
    if f is None: sys.exit(f"{kind}_cf_{YEAR}_{region}.npz not found in {[str(d) for d in DATA_DIRS]}")
    z = np.load(f)
    d = z["data"]; d = d[..., 0] if d.ndim == 4 else d
    return d.astype(np.float32), z["lats"].astype(float), z["lons"].astype(float)

def metrics_row(pv: np.ndarray, w: np.ndarray):
    """pv, w: (8760, n) → dict of (n,) arrays."""
    mpv, mw = pv.mean(0), w.mean(0)
    vpv, vw = pv.var(0), w.var(0)
    cov = ((pv - mpv) * (w - mw)).mean(0)
    den = vpv + vw - 2 * cov
    s = np.where(den > 1e-9, (vw - cov) / np.where(den > 1e-9, den, 1), 0.5); s = np.clip(s, 0, 1)
    c = s * pv + (1 - s) * w
    mc = c.mean(0)
    with np.errstate(invalid="ignore", divide="ignore"):
        corr = cov / np.sqrt(vpv * vw)
        cv = c.std(0) / mc
    return {"solar": mpv, "wind": mw, "comb": mc, "share": s, "comb50": 0.5 * (mpv + mw), "corr": corr, "cv": cv, "lowh": (c < 0.10).mean(0)}

def land_mask(lats, lons) -> np.ndarray:
    """True where the cell centre is on land (Natural Earth 110m countries, the file HOPS already ships) — falls back to all-True."""
    try:
        import geopandas as gpd
        from shapely.geometry import Point
        from shapely.strtree import STRtree
        cands = [HOPS_DATA / "110m_cultural/ne_110m_admin_0_countries.shp", HOPS_DATA.parent / "cloud/data/110m_cultural/ne_110m_admin_0_countries.shp",
                 Path.home() / "Documents/Stanford/PhD/HOPS/cloud/data/110m_cultural/ne_110m_admin_0_countries.shp"]
        shp = next(c for c in cands if c.exists())
        geoms = list(gpd.read_file(shp).geometry.buffer(0.15)); tree = STRtree(geoms)          # 0.15° tolerance keeps coastal cells
        pts = [Point(lo, la) for la in lats for lo in lons]
        hit = np.zeros(len(pts), dtype=bool)
        for i, g in enumerate(pts):
            hit[i] = len(tree.query(g, predicate="within")) > 0
        return hit.reshape(len(lats), len(lons))
    except Exception as e:
        print(f"[land] mask unavailable ({e}) — all cells marked land"); return np.ones((len(lats), len(lons)), dtype=bool)

def build_region(region: str, out: Path, cells: Path | None):
    print(f"[{region}] loading …", flush=True)
    pv, lats, lons = load(region, "solar"); w, lats2, lons2 = load(region, "wind")
    assert pv.shape == w.shape and np.allclose(lats, lats2) and np.allclose(lons, lons2), "solar/wind grids differ"
    T, nlat, nlon = pv.shape; assert T == 8760, T
    keys = ["solar", "wind", "comb", "share", "comb50", "corr", "cv", "lowh"]
    M = {k: np.full((nlat, nlon), np.nan, dtype=np.float32) for k in keys}
    for i in range(nlat):
        r = metrics_row(pv[:, i, :], w[:, i, :])
        for k in keys: M[k][i] = r[k]
        if cells is not None:
            d = cells / region; d.mkdir(parents=True, exist_ok=True)
            for j in range(nlon):
                if np.isnan(pv[:, i, j]).any() or np.isnan(w[:, i, j]).any(): continue
                arr = np.concatenate([pv[:, i, j], w[:, i, j]]); u = np.clip(np.round(arr * 10000), 0, 65535).astype("<u2")
                with gzip.open(d / f"{i}_{j}.u16.gz", "wb", compresslevel=6) as f: f.write(u.tobytes())
        if i % 20 == 0: print(f"[{region}] row {i}/{nlat}", flush=True)
    valid = ~np.isnan(M["solar"]) & ~np.isnan(M["wind"])
    land = land_mask(lats, lons)                                             # ERA5 covers the sea too; the atlas draws onshore cells by default
    def flat(a, dec=3): return [None if (not v) else round(float(x), dec) for x, v in zip(a.ravel(), valid.ravel())]
    doc = {"region": region, "year": YEAR, "nlat": nlat, "nlon": nlon, "lats": [round(float(x), 3) for x in lats], "lons": [round(float(x), 3) for x in lons],
           "dlat": round(float(np.median(np.diff(lats))), 4), "dlon": round(float(np.median(np.diff(lons))), 4),
           "metrics": {k: flat(M[k], 4 if k in ("corr", "cv", "lowh", "share") else 3) for k in keys},
           "land": [int(x) for x in land.ravel()],
           "n_valid": int(valid.sum()), "source": f"{{solar,wind}}_cf_{YEAR}_{region}.npz (atlite/ERA5, HOPS inputs)"}
    out.mkdir(parents=True, exist_ok=True)
    (out / f"{region}.json").write_text(json.dumps(doc, separators=(",", ":")))
    print(f"[{region}] {nlat}×{nlon} cells, {valid.sum()} valid, {int((valid & land).sum())} on land · mean solar {np.nanmean(M['solar']):.3f} wind {np.nanmean(M['wind']):.3f} comb {np.nanmean(M['comb']):.3f} · corr {np.nanmean(M['corr']):.2f} → {out / (region + '.json')} ({(out / (region + '.json')).stat().st_size / 1e6:.1f} MB)")
    return {"region": region, "lat": [float(lats.min()), float(lats.max())], "lon": [float(lons.min()), float(lons.max())], "nlat": nlat, "nlon": nlon, "n_valid": int(valid.sum())}

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--region", action="append", required=True); ap.add_argument("-o", "--out", default="data/grid")
    ap.add_argument("--cells", default=None, help="also write the per-cell hourly files under this directory (for R2)")
    ap.add_argument("--data-dir", action="append", default=[], help="extra folder(s) holding the NPZ files (searched before HOPS_DATA)")
    a = ap.parse_args()
    DATA_DIRS[:0] = [Path(d).expanduser() for d in a.data_dir]
    out = Path(a.out); idx_p = out / "index.json"; idx = json.loads(idx_p.read_text()) if idx_p.exists() else {"regions": []}
    for r in a.region:
        e = build_region(r, out, Path(a.cells) if a.cells else None)
        idx["regions"] = [x for x in idx["regions"] if x["region"] != r] + [e]
    idx["year"] = YEAR; idx["cell_format"] = "u16.gz: 8760 solar then 8760 wind, CF×10000, little-endian"
    idx_p.write_text(json.dumps(idx, indent=1)); print("index:", [x["region"] for x in idx["regions"]])

if __name__ == "__main__":
    main()
