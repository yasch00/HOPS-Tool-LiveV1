#!/usr/bin/env python3
"""
export_siting.py — run the HOPS land-siting model for one plant and write web map layers.

    cd ~/Documents/Stanford/PhD/HOPS            # so the OSM layer cache in ./land_siting_out is found
    python3 ~/Documents/Stanford/PhD/hops-site-tools/export_siting.py --plant 61 \
        --scenarios <repo>/data/scenarios.json -o <repo>/data/siting

Imports hops_land_siting.py unchanged (its config globals are overridden here, the file is not edited)
and reuses its functions: build_exclusions (OSM + Natura, cached), compute_developable, _turbine_points,
allocate_to_capacity. Nothing about the siting method is re-implemented; only the per-class exclusion
masks are recomputed the same way compute_developable does, so they can be drawn.

Writes, per plant (EPSG:4326 GeoJSON, geometry simplified in the metric CRS):
    site.json               plant, radius, setback scenario, turbine spec, densities, developable km², provenance
    developable.geojson     two polygons: tech=wind / tech=solar (after setbacks)
    exclusions.geojson      buffered exclusion masks by class (structures, roads, rails, water, landcover, natura)
    layouts/{SMR|SMR+CCS}_ci{x}.geojson   turbines (points, hub/rotor/MW) + pv (polygons) sized to that run's capacities
"""
from __future__ import annotations
import argparse, json, math, os, sys
from pathlib import Path

HOPS_DIR = Path.home() / "Documents/Stanford/PhD/HOPS"
sys.path.insert(0, str(HOPS_DIR))
import hops_land_siting as hls                      # noqa: E402  (config-at-import, no side effects)

def to_geojson_geom(geom, crs_m, tol_m):
    import geopandas as gpd
    if geom is None or geom.is_empty: return None
    g = geom.simplify(tol_m, preserve_topology=True)
    gj = json.loads(gpd.GeoSeries([g], crs=crs_m).to_crs(4326).to_json())["features"][0]["geometry"]
    def rnd(c): return [round(c[0], 5), round(c[1], 5)] if isinstance(c[0], (int, float)) else [rnd(x) for x in c]   # ~1 m
    gj["coordinates"] = rnd(gj["coordinates"]); return gj

def feature(geom, props): return {"type": "Feature", "geometry": geom, "properties": props}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--plant", type=int, required=True)
    ap.add_argument("--radius", type=float, default=hls.RADIUS_KM)
    ap.add_argument("--scenario", default=hls.CAPACITY_MAP_SCENARIO, help="setback scenario (p50, de_10h, ...)")
    ap.add_argument("--scenarios", required=True, help="repo data/scenarios.json (capacities per run)")
    ap.add_argument("--plants-xlsx", default=hls.PLANT_XLSX)
    ap.add_argument("-o", "--out", required=True)
    ap.add_argument("--tol", type=float, default=8.0, help="simplification tolerance, metres")
    a = ap.parse_args()

    import geopandas as gpd
    from shapely.geometry import Point
    from shapely.ops import unary_union

    hls.VERBOSE = True
    plant = hls.load_plant(a.plants_xlsx, a.plant)
    crs_m = hls.utm_crs_for(plant["lat"], plant["lon"])
    hls.log(f"plant{plant['idx']} {plant['lat']:.4f},{plant['lon']:.4f} {plant['country']}  CRS {crs_m}")
    layers = hls.build_exclusions(plant["lat"], plant["lon"], a.radius, crs_m)

    out = Path(a.out) / f"plant{a.plant}"; (out / "layouts").mkdir(parents=True, exist_ok=True)
    centre = gpd.GeoSeries([Point(plant["lon"], plant["lat"])], crs="EPSG:4326").to_crs(crs_m).iloc[0]
    disc = centre.buffer(a.radius * 1000.0)
    px, py = centre.x, centre.y

    # ---- developable land per technology (exactly what the siting model computes)
    dev, area, brk = {}, {}, {}
    for tech in ("wind", "solar"):
        dev[tech], area[tech], brk[tech] = hls.compute_developable(plant, a.radius, layers, crs_m, a.scenario, tech)
        hls.log(f"  {tech}: {area[tech]:,.1f} km2 developable ({brk[tech]['_developable_frac']:.1%})")
    feats = [feature(to_geojson_geom(dev[t], crs_m, a.tol), {"tech": t, "area_km2": round(area[t], 2)}) for t in dev]
    (out / "developable.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}))

    # ---- exclusion masks by class, buffered with the WIND setbacks of the chosen scenario (same as compute_developable)
    sb = hls.SETBACK_SCENARIOS[a.scenario]["wind"]
    buf = {"structures": sb["structure"] * hls.TIP_HEIGHT_M, "roads": sb["road"] * hls.TIP_HEIGHT_M,
           "rails": sb["rail"] * hls.TIP_HEIGHT_M, "water": sb["water"] * hls.TIP_HEIGHT_M, "landcover": 0.0, "natura": 0.0}
    efeats = []
    for key, b in buf.items():
        gdf = layers.get(key)
        if gdf is None or len(gdf) == 0: continue
        geoms = gdf.geometry.buffer(b) if b > 0 else gdf.geometry
        try: merged = unary_union(list(geoms.values))
        except Exception: merged = unary_union([g.buffer(0) for g in geoms.values if g])
        merged = hls._polygons_only(merged.intersection(disc))
        if merged.is_empty: continue
        efeats.append(feature(to_geojson_geom(merged, crs_m, a.tol * 1.5), {"class": key, "buffer_m": round(b, 1), "area_km2": round(merged.area / 1e6, 2)}))
        hls.log(f"  exclusion {key:10s} {merged.area/1e6:8.1f} km2 (buffer {b:.0f} m)")
    (out / "exclusions.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": efeats}))

    # ---- turbine candidates once (greedy packing, nearest-first), then per-run layouts
    spacing_m = (hls.TURBINE_SPACING_D * hls.ROTOR_DIAMETER_M if hls.TURBINE_SPACING_D
                 else (hls.WIND_TURBINE_MW / hls.RHO_WIND_MW_KM2) ** 0.5 * 1000.0)
    wind_dev = hls._polygons_only(dev["wind"]); solar_dev = hls._polygons_only(dev["solar"])
    all_pts = hls._turbine_points(wind_dev, spacing_m) if not wind_dev.is_empty else []
    all_pts.sort(key=lambda p: (p.x - px) ** 2 + (p.y - py) ** 2)
    hls.log(f"  {len(all_pts)} turbine positions fit at {spacing_m:.0f} m spacing ({len(all_pts)*hls.WIND_TURBINE_MW:,.0f} MW max)")
    solar_land = hls._polygons_only(solar_dev.difference(wind_dev)) if not wind_dev.is_empty else solar_dev
    pts_ll = gpd.GeoSeries(all_pts, crs=crs_m).to_crs(4326) if all_pts else []

    scn = [s for s in json.loads(Path(a.scenarios).read_text()) if s["plant"] == a.plant and not s.get("policy")]
    layouts = []
    for s in scn:
        path = "SMR+CCS" if s["ccs"] else "SMR"
        for r in s["rows"]:
            wind_mw, pv_mw, ci = r.get("p_wt") or 0.0, r.get("p_pv") or 0.0, r["target"]
            n = int(math.ceil(wind_mw / hls.WIND_TURBINE_MW)); tp = all_pts[:n]
            tf = [feature({"type": "Point", "coordinates": [round(pts_ll.iloc[i].x, 5), round(pts_ll.iloc[i].y, 5)]},
                          {"kind": "turbine", "i": i, "mw": hls.WIND_TURBINE_MW, "hub_m": hls.HUB_HEIGHT_M, "rotor_m": hls.ROTOR_DIAMETER_M})
                  for i in range(len(tp))]
            # wind land actually used = developable wind land within the reach of the placed turbines (as in make_capacity_map)
            if tp:
                reach = max(math.hypot(p.x - px, p.y - py) for p in tp)
                wind_geom = hls._polygons_only(wind_dev.intersection(Point(px, py).buffer(reach + spacing_m / 2)))
            else: wind_geom = None
            solar_geom, solar_area, _ = hls.allocate_to_capacity(solar_land, (px, py), pv_mw / hls.RHO_PV_MW_KM2, hls.CAPACITY_CELL_KM)
            pf = []
            if solar_geom is not None and not solar_geom.is_empty:
                pf.append(feature(to_geojson_geom(solar_geom, crs_m, a.tol), {"kind": "pv", "area_km2": round(solar_area, 2), "mw": round(solar_area * hls.RHO_PV_MW_KM2, 1)}))
            wf = []
            if wind_geom is not None and not wind_geom.is_empty:
                wf.append(feature(to_geojson_geom(wind_geom, crs_m, a.tol * 2), {"kind": "windland", "area_km2": round(wind_geom.area / 1e6, 2)}))
            name = f"{path}_ci{ci:.2f}"
            (out / "layouts" / f"{name}.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": wf + pf + tf}))
            layouts.append({"path": path, "ci": ci, "file": f"layouts/{name}.geojson", "turbines": len(tp), "wind_mw_target": round(wind_mw, 1),
                            "wind_mw_placed": len(tp) * hls.WIND_TURBINE_MW, "wind_short": len(tp) < n,
                            "pv_mw_target": round(pv_mw, 1), "pv_mw_placed": round(solar_area * hls.RHO_PV_MW_KM2, 1), "pv_km2": round(solar_area, 2),
                            "pv_short": solar_area * hls.RHO_PV_MW_KM2 < pv_mw * 0.999})
            hls.log(f"  layout {name:16s} turbines {len(tp):4d}/{n:<4d}  pv {solar_area:6.1f} km2 for {pv_mw:7.0f} MW")

    site = {"plant": plant["idx"], "lat": plant["lat"], "lon": plant["lon"], "country": plant["country"],
            "capacity_ktpa": plant.get("capacity_ktpa"), "radius_km": a.radius, "setback_scenario": a.scenario,
            "setbacks": hls.SETBACK_SCENARIOS[a.scenario], "hub_m": hls.HUB_HEIGHT_M, "rotor_m": hls.ROTOR_DIAMETER_M,
            "tip_m": hls.TIP_HEIGHT_M, "turbine_mw": hls.WIND_TURBINE_MW, "spacing_m": round(spacing_m, 1),
            "rho_wind_mw_km2": hls.RHO_WIND_MW_KM2, "rho_pv_mw_km2": hls.RHO_PV_MW_KM2,
            "developable_km2": {t: round(area[t], 2) for t in area}, "breakdown": {t: {k: round(v, 3) for k, v in brk[t].items()} for t in brk},
            "max_turbines": len(all_pts), "layouts": layouts, "provenance": hls.LAYER_PROVENANCE}
    (out / "site.json").write_text(json.dumps(site, indent=1))
    tot = sum(f.stat().st_size for f in out.rglob("*") if f.is_file())
    hls.log(f"wrote {out}  ({tot/1e6:.1f} MB)")

if __name__ == "__main__":
    main()
