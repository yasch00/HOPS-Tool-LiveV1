# Architecture notes — data, assumptions, and the map

Answers to the three structural questions. Short on purpose; each has a fork in it that you should pick before anyone writes code.

## 1. Structuring the assumption data

Three tiers, kept apart. Mixing them is what makes tools like this unmaintainable.

**Tier 1 — parameter registry.** Every scalar the model uses, one record each: `id, name, value, unit, category, source, source_year, url, status, min, max, step, tooltip`. This is the file the data page already renders (`data/parameters.json`) *and* the file that generates the tool's assumption sliders. One source of truth: if a parameter has no registry entry, the tool cannot expose it, and the website cannot show a number for it.

**Tier 2 — scenarios as diffs.** A user scenario is never a copy of the registry. It is `{base: "v1.2.0", overrides: {"p-001": 720, "p-020": 9.5}}` — a few hundred bytes, shareable as a URL fragment, and it stays valid when you publish a new base. "Reset to sourced value" becomes free.

**Tier 3 — hourly series.** Never JSON. 91 plants × 8,760 h × ~12 series is where the 15 MB came from. Store one file per plant per series as `Float32Array` binary (or Parquet if you want Python parity), served from `/data/hourly/{plant_id}/{series}.bin`, fetched on demand and cached. A year of one series at Float32 is 35 KB. The plant list, metadata and precomputed results stay as small JSON.

**Precompute vs. live solve.** A MILP over 8,760 hours will not run in a browser. Two honest options: (a) precompute a grid of solves — plant × CI target × a handful of price/capex scenarios — ship the results, and interpolate between them, which is instant and offline but limits what a user can change; or (b) run the real optimizer server-side (small container, job queue, HiGHS or Gurobi) and have "Build my plant" submit a job and poll. Most projects do (a) for exploration and (b) behind a "run the full model" button. Decide this before designing the build-a-plant flow, because it changes the UI from a slider that updates live to a form that submits.

## 2. Build-your-plant flow

Four steps, each resolvable to a URL so a run is citable:

1. **Site** — click a map point or pick an existing plant.
2. **Resource** — the tool pulls that site's hourly wind/solar profile (precomputed from reanalysis on a grid; nearest cell, not live API).
3. **Assumptions** — registry-generated controls, grouped as on the data page, every one showing its sourced default and its provenance.
4. **Run** — precomputed interpolation for instant feedback, full solve queued for the real answer; result page shows build, dispatch, LCOA, CI, and the EDT for that site.

## 3. Satellite view, 3D, and your siting code

Yes, this exists and it is not exotic.

- **MapLibre GL JS** (open, free) for the map. Satellite raster from Esri World Imagery or your Mapbox account; terrain from AWS/Mapzen or Mapbox Terrain-DEM; building footprints from OpenStreetMap or Overture Maps as extruded polygons; land cover (forest, cropland) from ESA WorldCover as a raster or vectorised mask.
- **deck.gl** on top for your siting output: `PolygonLayer` for the wind/solar parcels, `ScatterplotLayer` or `SimpleMeshLayer` for turbine positions, `SolidPolygonLayer` extruded for panel blocks. Your siting code just needs to emit GeoJSON in EPSG:4326 — geometry, plus `capacity_mw`, `type`, `exclusion_reason` for the rejected areas, which are as interesting as the accepted ones.
- **True 3D with real buildings**: Cesium + Google Photorealistic 3D Tiles gives an actual textured city/industrial site. It looks spectacular and it is heavy (and keyed/metered). Good for one hero view of a flagship plant; wrong as the default map.
- **Turbines and modules as 3D geometry**: a single low-poly turbine GLB instanced hundreds of times via `ScenegraphLayer`. Cheap, and it reads instantly as "real".

Recommended split: MapLibre + deck.gl as the working map for all 91 plants (fast, free, offline-able tiles), and one optional Cesium "photoreal" toggle for a single site. For existing plants, the same layers work — you draw the fence line from OSM, then overlay the siting code's parcels around it, and the exclusion mask explains why the layout is what it is.

**Making it look real** is mostly restraint: real satellite imagery under a desaturated overlay, true-to-scale geometry, a scale bar, north arrow, and coordinates in the corner, one data colour on top of the imagery, and no glow. The moment the map has a legend, a scale, and a source line, it stops looking like a demo.
