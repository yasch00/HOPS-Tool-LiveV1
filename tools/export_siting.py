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

_here = Path(__file__).resolve().parent
HOPS_DIR = Path(os.environ.get("HOPS_SITING_DIR") or (_here if (_here / "hops_land_siting.py").exists() else Path.home() / "Documents/Stanford/PhD/HOPS"))
sys.path.insert(0, str(HOPS_DIR))
import hops_land_siting as hls                      # noqa: E402  (config-at-import, no side effects)

# --- offline OSM ------------------------------------------------------------
# Overpass is rate-limited per IP, which is fatal on a cluster: every task queues
# behind the same limiter and hits the wall having done nothing. hls already has a
# complete offline reader (_build_exclusions_pbf, pyrosm, identical tags/layers)
# gated on PBF_PATH. With --extracts/--pbf we drive it directly, once per file, and
# concatenate -- so a border plant simply reads both countries' extracts. The layer
# pickle is ours because hls's cache key does not record WHICH .pbf was read.

def _pbf_cache_path(cache_dir, lat, lon, radius_km, pbfs, reader="auto"):
    import hashlib
    sig = hashlib.md5(("|".join(sorted(Path(p).name for p in pbfs))
                       + hls._layer_cache_version() + f"|reader={reader}").encode()).hexdigest()[:10]
    return Path(cache_dir) / f"_pbf_layers_{lat:.4f}_{lon:.4f}_{radius_km:.1f}km_{sig}.pkl"


def _concat_layers(parts):
    """Merge per-class GeoDataFrames from several extracts (Geofabrik regions
    overlap at borders, so drop repeated OSM ids)."""
    import geopandas as gpd, pandas as pd
    if len(parts) == 1:
        return parts[0]
    out = {}
    for k in set().union(*(set(p) for p in parts)):
        gdfs = [p[k] for p in parts if p.get(k) is not None and len(p[k])]
        if not gdfs:
            out[k] = gpd.GeoDataFrame(geometry=[], crs=parts[0][k].crs)
            continue
        m = pd.concat(gdfs, ignore_index=True)
        if "id" in m.columns:
            m = m.drop_duplicates(subset="id")
        out[k] = gpd.GeoDataFrame(m, geometry="geometry", crs=gdfs[0].crs)
        hls.log(f"    {k:12s} {len(out[k]):>7,} features (merged from {len(gdfs)} extracts)")
    return out


# --- GDAL/pyogrio reader ----------------------------------------------------
# pyrosm has no Linux wheel and its build chain (pyrobuf, cykhash) does not
# compile on Sherlock, so the offline reader is GDAL's OSM driver instead, via
# pyogrio. Same idea as hls._build_exclusions_pbf and the same tag lists (taken
# from hls, not copied), so the layers are the ones the model expects; GDAL does
# the multipolygon assembly. Two passes per extract (multipolygons, lines) with a
# bbox filter, rather than one pass per layer.
#
# GDAL only promotes a fixed set of OSM keys to real columns; railway, waterway,
# wetland and the protected-area keys are not among them, so we hand it our own
# osmconf.ini that adds them.
_OSMCONF = """closed_ways_are_polygons=aeroway,amenity,boundary,building,craft,geological,historic,landuse,leisure,military,natural,office,place,shop,sport,tourism,waterway
report_all_nodes=no
report_all_ways=no
attribute_name_laundering=yes

[points]
osm_id=yes
attributes=name,barrier,highway,ref,address,is_in,place,man_made
other_tags=yes

[lines]
osm_id=yes
attributes=name,highway,waterway,aerialway,barrier,man_made,railway,natural
ignore=created_by,converted_by,source,time,ele,note,openGeoDB:,fixme,FIXME
other_tags=yes

[multipolygons]
osm_id=yes
osm_way_id=yes
attributes=name,type,aeroway,amenity,admin_level,barrier,boundary,building,craft,geological,historic,land_area,landuse,leisure,man_made,military,natural,office,place,shop,sport,tourism,waterway,wetland,protect_class,protection_title,related_law,designation
ignore=area,created_by,converted_by,source,time,ele,note,openGeoDB:,fixme,FIXME
other_tags=yes

[multilinestrings]
osm_id=yes
attributes=name,type
other_tags=yes

[other_relations]
osm_id=yes
attributes=name,type
other_tags=yes
"""


def _osmconf_path(cache_dir):
    p = Path(cache_dir) / "osmconf_hops.ini"
    if not p.exists() or p.read_text() != _OSMCONF:
        p.parent.mkdir(parents=True, exist_ok=True); p.write_text(_OSMCONF)
    return p


def _col(gdf, name):
    """Column as a Series, or all-False when GDAL did not emit it."""
    import pandas as pd
    return gdf[name] if name in gdf.columns else pd.Series(False, index=gdf.index)


def _build_exclusions_gdal(lat, lon, radius_km, crs_m, pbfs, cache_dir):
    """Same six layers as hls.build_exclusions, read from local .osm.pbf via GDAL."""
    import geopandas as gpd, pandas as pd, pyogrio
    from shapely.geometry import Point

    os.environ["OSM_CONFIG_FILE"] = str(_osmconf_path(cache_dir))
    os.environ.setdefault("OSM_MAX_TMPFILE_SIZE", "4000")     # MB kept in RAM before spilling
    dlat = radius_km * 1000.0 / 111_000.0
    dlon = dlat / max(math.cos(math.radians(lat)), 0.2)
    bbox = (lon - dlon, lat - dlat, lon + dlon, lat + dlat)

    def read(layer):
        frames = []
        for f in pbfs:
            hls.log(f"    reading {Path(f).name} :: {layer} ...")
            try:
                g = pyogrio.read_dataframe(str(f), layer=layer, bbox=bbox)
            except Exception as e:
                hls.log(f"      FAILED ({type(e).__name__}: {e})"); continue
            if g is not None and len(g):
                frames.append(g)
        if not frames:
            return gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")
        if len(frames) == 1:
            return gpd.GeoDataFrame(frames[0], geometry="geometry", crs="EPSG:4326")
        out = pd.concat(frames, ignore_index=True)
        # Extracts overlap at borders, so drop repeats -- but on the right key. In
        # GDAL's multipolygons layer a RELATION has osm_id and a CLOSED WAY has
        # osm_way_id with osm_id empty. Deduplicating on osm_id alone treats every
        # empty value as equal and collapses all closed-way polygons (nearly every
        # building, pond and landuse patch) into one row. Key on type+id, and never
        # merge rows that have no id at all.
        rel = out["osm_id"] if "osm_id" in out.columns else pd.Series(pd.NA, index=out.index)
        way = out["osm_way_id"] if "osm_way_id" in out.columns else pd.Series(pd.NA, index=out.index)
        key = ("r" + rel.astype("string")).where(rel.notna(), "w" + way.astype("string"))
        out = out[~(key.notna() & key.duplicated())]
        return gpd.GeoDataFrame(out, geometry="geometry", crs="EPSG:4326")

    mp, ln = read("multipolygons"), read("lines")

    def to_m(gdf, label):
        if gdf is None or len(gdf) == 0:
            hls.log(f"    {label:12s} 0 features")
            return gpd.GeoDataFrame(geometry=[], crs=crs_m)
        gdf = gdf[gdf.geometry.notnull()].to_crs(crs_m)
        hls.log(f"    {label:12s} {len(gdf):>7,} features")
        return gdf

    out = {}
    out["structures"] = to_m(mp[_col(mp, "building").notna()] if len(mp) else mp, "buildings")
    out["roads"] = to_m(ln[_col(ln, "highway").isin(
        ["motorway", "trunk", "primary", "secondary", "tertiary",
         "unclassified", "residential"])] if len(ln) else ln, "roads")
    out["rails"] = to_m(ln[_col(ln, "railway").isin(
        ["rail", "light_rail", "subway"])] if len(ln) else ln, "railways")
    # Water is polygons AND waterway centrelines: the model's water layer (Overpass
    # and pyrosm alike) carries river/canal LINES, which the setback then buffers.
    # GDAL puts those in the lines layer, so they must be taken from there too.
    w_poly = mp[_col(mp, "natural").isin(["water", "wetland", "bay", "strait", "mud", "shoal"])
                | _col(mp, "wetland").isin(["tidalflat", "saltmarsh"])
                | _col(mp, "waterway").isin(["river", "canal", "dock"])] if len(mp) else mp
    w_line = ln[_col(ln, "waterway").isin(["river", "canal", "dock"])] if len(ln) else ln
    parts = [g for g in (w_poly, w_line) if len(g)]
    water = (gpd.GeoDataFrame(pd.concat(parts, ignore_index=True), geometry="geometry", crs="EPSG:4326")
             if parts else gpd.GeoDataFrame(geometry=[], crs="EPSG:4326"))
    out["water"] = to_m(water, "water")

    # Sea mask (coastline / water-polygons file), folded into the water layer --
    # mirrors hls._build_exclusions_pbf.
    if hls.SEA_MASK_FROM_COASTLINE or hls.WATER_POLYGONS_PATH:
        centre_m = gpd.GeoSeries([Point(lon, lat)], crs="EPSG:4326").to_crs(crs_m).iloc[0]
        disc_m = centre_m.buffer(radius_km * 1000.0)
        sea_geom = None
        if hls.WATER_POLYGONS_PATH:
            sea_geom = hls._sea_from_water_polygons(hls.WATER_POLYGONS_PATH, disc_m, crs_m)
        if (sea_geom is None or sea_geom.is_empty) and hls.SEA_MASK_FROM_COASTLINE:
            coast = ln[_col(ln, "natural") == "coastline"] if len(ln) else ln
            if len(coast):
                coast = coast[coast.geometry.notnull()].to_crs(crs_m)
                lines = []
                for g in coast.geometry.values:
                    if g is None:
                        continue
                    if g.geom_type == "LineString":
                        lines.append(g)
                    elif g.geom_type == "MultiLineString":
                        lines.extend(list(g.geoms))
                    elif g.geom_type in ("Polygon", "MultiPolygon"):
                        lines.append(g.boundary)
                sea_geom, why = hls._sea_mask_from_coastline(
                    lines, disc_m, Point(centre_m.x, centre_m.y))
                if sea_geom is None:
                    hls.log(f"    water        sea mask not applied ({why}).")
            else:
                hls.log("    water        no coastline in bbox; no sea mask.")
        if sea_geom is not None and not sea_geom.is_empty:
            out["water"] = gpd.GeoDataFrame(
                pd.concat([out["water"], gpd.GeoDataFrame(geometry=[sea_geom], crs=crs_m)],
                          ignore_index=True), crs=crs_m)
            hls.log(f"    water        + sea mask folded in ({sea_geom.area / 1e6:,.0f} km2)")

    out["landcover"] = to_m(mp[_col(mp, "landuse").isin(hls.EXCLUDE_LANDUSE)
                               | _col(mp, "natural").isin(hls.EXCLUDE_NATURAL)
                               | _col(mp, "leisure").isin(hls.EXCLUDE_LEISURE)] if len(mp) else mp, "landcover")

    if hls.NATURA2000_PATH:
        out["natura"] = hls._load_natura_from_file(hls.NATURA2000_PATH, lat, lon, radius_km, crs_m)
    elif hls.NATURA2000_FROM_OSM:
        pa = mp[_col(mp, "boundary") == "protected_area"] if len(mp) else mp
        if len(pa):
            pa = pa[pa.geometry.notnull()].to_crs(crs_m)
            nat = hls._filter_osm_natura(pa)
            out["natura"] = nat if len(nat) else (
                gpd.GeoDataFrame(geometry=[], crs=crs_m) if hls.NATURA2000_OSM_STRICT else pa)
            hls.log(f"    natura       {len(out['natura']):>7,} (of {len(pa):,} protected areas)")
        else:
            out["natura"] = gpd.GeoDataFrame(geometry=[], crs=crs_m)
    else:
        out["natura"] = gpd.GeoDataFrame(geometry=[], crs=crs_m)
    return out


def _have(mod):
    import importlib.util
    return importlib.util.find_spec(mod) is not None


def build_exclusions_offline(plant, radius_km, crs_m, pbfs, cache_dir, reader="auto"):
    """Same layers as hls.build_exclusions, read from local .osm.pbf instead of
    Overpass. Falls back to hls.build_exclusions when no extracts were given."""
    import pickle
    lat, lon = plant["lat"], plant["lon"]
    if not pbfs:
        return hls.build_exclusions(lat, lon, radius_km, crs_m)
    hls.PBF_PATH = str(pbfs[0])          # so the cache signature records src=pbf
    reader = reader if reader != "auto" else ("pyrosm" if _have("pyrosm") else "gdal")
    if reader == "gdal":
        reader = "gdal-v3"     # v1 collapsed closed-way polygons on dedup; v2 omitted river/canal centrelines from water
    cp = _pbf_cache_path(cache_dir, lat, lon, radius_km, pbfs, reader)
    if hls.USE_LAYER_CACHE and cp.exists():
        try:
            blob = pickle.loads(cp.read_bytes())
            if blob.get("crs") == str(crs_m):
                hls.log(f"  loaded OSM layers from cache -> {cp}")
                return blob["layers"]
        except Exception as e:
            hls.log(f"  layer cache unreadable ({type(e).__name__}); re-reading PBF.")
    if reader == "pyrosm":
        hls.log("  reader: pyrosm")
        parts = []
        for f in pbfs:
            hls.PBF_PATH = str(f)
            parts.append(hls._build_exclusions_pbf(lat, lon, radius_km, crs_m))
        layers = _concat_layers(parts)
    else:
        hls.log("  reader: GDAL/pyogrio")
        layers = _build_exclusions_gdal(lat, lon, radius_km, crs_m, pbfs, cache_dir)
    try:
        cp.parent.mkdir(parents=True, exist_ok=True)
        cp.write_bytes(pickle.dumps({"crs": str(crs_m), "layers": layers,
                                     "pbfs": [str(f) for f in pbfs]}))
        hls.log(f"  cached layers -> {cp}")
    except Exception as e:
        hls.log(f"  could not write layer cache ({type(e).__name__}: {e})")
    return layers


def resolve_pbfs(a, plant):
    """--pbf wins; otherwise resolve from --extracts (manifest.json, no network)."""
    if a.pbf:
        return [Path(x) for x in a.pbf.split(",") if x.strip()]
    if not a.extracts:
        return []
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import geofabrik as gf
    paths = gf.resolve(plant["lat"], plant["lon"], a.radius, a.extracts, download=False)
    missing = [p for p in paths if not p.exists()]
    if missing:
        raise FileNotFoundError(
            "missing extracts: " + ", ".join(p.name for p in missing)
            + "  -- run fetch_extracts.py --download on a login node")
    return paths

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
    ap.add_argument("--plant", type=int, required=True, help="plant idx (or the site id of a requested site with --lat/--lon)")
    ap.add_argument("--lat", type=float); ap.add_argument("--lon", type=float); ap.add_argument("--name", default=None); ap.add_argument("--country", default="")
    ap.add_argument("--radius", type=float, default=hls.RADIUS_KM)
    ap.add_argument("--scenario", default=hls.CAPACITY_MAP_SCENARIO, help="setback scenario (p50, de_10h, ...)")
    ap.add_argument("--scenarios", required=True, help="repo data/scenarios.json (capacities per run)")
    ap.add_argument("--plants-xlsx", default=hls.PLANT_XLSX)
    ap.add_argument("-o", "--out", required=True)
    ap.add_argument("--tol", type=float, default=8.0, help="simplification tolerance, metres")
    ap.add_argument("--extracts", default=os.environ.get("HOPS_EXTRACTS"),
                    help="directory of Geofabrik .osm.pbf extracts + manifest.json; "
                         "switches OSM reads from Overpass to offline pyrosm")
    ap.add_argument("--pbf", default=None, help="explicit comma-separated .osm.pbf paths (overrides --extracts)")
    ap.add_argument("--cache", default=os.environ.get("HOPS_SITING_CACHE", hls.OUT_DIR),
                    help="directory for the pickled layer cache")
    ap.add_argument("--reader", default=os.environ.get("HOPS_OSM_READER", "auto"),
                    choices=("auto", "pyrosm", "gdal"), help="offline .osm.pbf reader")
    a = ap.parse_args()

    import geopandas as gpd
    from shapely.geometry import Point
    from shapely.ops import unary_union

    hls.VERBOSE = True
    if a.lat is not None and a.lon is not None:
        plant = {"idx": a.plant, "lat": a.lat, "lon": a.lon, "country": a.country, "capacity_ktpa": None, "name": a.name}   # a requested site
    else:
        plant = hls.load_plant(a.plants_xlsx, a.plant)
    crs_m = hls.utm_crs_for(plant["lat"], plant["lon"])
    hls.log(f"plant{plant['idx']} {plant['lat']:.4f},{plant['lon']:.4f} {plant['country']}  CRS {crs_m}")
    pbfs = resolve_pbfs(a, plant)
    hls.log(f"  OSM source: " + (", ".join(p.name for p in pbfs) if pbfs else "Overpass (online, rate-limited)"))
    os.makedirs(a.cache, exist_ok=True); hls.OUT_DIR = a.cache
    layers = build_exclusions_offline(plant, a.radius, crs_m, pbfs, a.cache, a.reader)

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
