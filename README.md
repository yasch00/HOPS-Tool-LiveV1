# HOPS — site + tool

Public website and interactive atlas for HOPS (Hybrid Optimization of Plant Systems).
Served by GitHub Pages from the `main` branch root; every push goes live at
https://yasch00.github.io/HOPS-Tool-LiveV1/ within a minute or two.

```
index.html method.html results.html data.html watch.html team.html about.html
tokens.css components.css site.js      design system (see docs/RATIONALE.md, docs/HANDOFF.md)
atlas/                                 the interactive tool (globe + plant dashboards)
data/                                  everything the tool and the site read — no code in here
  plants.json  scenarios.json  bau.json  manifest.json  summary.json.gz
  runs/plant{idx}/{SMR|SMR+CCS}/ci{x}.json.gz     hourly dispatch, fetched on demand
  runs/plant{idx}/BAU/bau.json.gz
  parameters.json  watch.json          parameter registry (data page) and news feed (watch page)
tools/                                 scripts that build data/ and atlas/
docs/                                  design + pipeline notes from the Design export
```

## Updating results

1. Pull the finished run from Sherlock to the laptop (only the label you want to publish):

   ```bash
   rsync -av --include='*_v7.csv' --include='*_v7.parquet' --include='*_v7_*.csv' --exclude='*' \
         sherlock:/scratch/users/yaschue/HOPS_results/  ~/Documents/Stanford/PhD/HOPS/results/sherlock_v7/
   rsync -av --include='*_v7.parquet' --exclude='*' \
         sherlock:/scratch/users/yaschue/HOPS_results/hourly/  ~/Documents/Stanford/PhD/HOPS/results/sherlock_v7/hourly/
   ```

2. Convert (idempotent; ~3 min for the full fleet, seconds for a re-run because hourly files are skipped when up to date):

   ```bash
   python3 tools/hops_to_web.py --results ~/Documents/Stanford/PhD/HOPS/results/sherlock_v7 \
           --label IRR_v7 --bau-label BAU_v7 --names tools/plant_names.json -o data
   gzip -kf6 data/summary.json && rm data/summary.json
   ```

3. Commit and push (GitHub Desktop). No code changes needed — the tool reads `data/manifest.json` and
   shows the data version in the globe footer.

**Policy cases and LCOA.** The Sherlock re-pricings (`_ETSlaw`, `_ETSprop`, `_USCred`) change the ammonia-only LCOA columns
by the levelised credit and leave `z_cost` and IRR as solved. The converter carries that delta onto the headline `lcoa`
(`lcoa = z_cost + (LCOA_LCOE − LCOA_LCOE_no-policy)`), keeps the solved value as `lcoa_zcost`, and stores the delta as
`policy_delta`; BAU rows are treated the same. The Finance tab reconciles its cost lines to `lcoa_zcost` and books the
credit as a revenue line, so nothing is counted twice.

Plant numbering is the HOPS index from `Plants_US_and_Europe.xlsx` (Brunsbüttel = 61, Mannheim/Ludwigshafen = 60,
Brazoria County TX = 22). `plants.json` carries `amm_idx` to cross-reference the global fleet list drawn on the globe.
Town names come from `tools/plant_names.json` (OpenStreetMap reverse geocoding) — edit that file to rename a plant.

## The map (atlas/map.js)

One MapLibre map from globe to site, no API keys: Esri World Imagery, Mapzen/AWS terrain tiles, OpenStreetMap buildings
(extruded, via OpenFreeMap vector tiles), and — per plant — the siting model's layers from `data/siting/plant{idx}/`.
Turbines are three.js meshes at the siting model's hub height and rotor diameter; PV blocks are 3 m extrusions.

To add a plant's siting layers (needs Python 3.12 + osmnx; the venv is `~/Documents/Stanford/PhD/hops-site-tools/.venv-siting`):

```bash
cd ~/Documents/Stanford/PhD/HOPS        # so the OSM layer cache in ./land_siting_out is reused
~/Documents/Stanford/PhD/hops-site-tools/.venv-siting/bin/python tools/export_siting.py --plant 61 --tol 12 \
    --scenarios <repo>/data/scenarios.json -o <repo>/data/siting
```

First run for a plant downloads 25 km of OpenStreetMap through Overpass (minutes to tens of minutes); the layers are cached.
The site view shows the catchment, terrain and buildings for every plant, and the buildout where layers exist (all 69 plants since 2026-09-16; `data/siting/index.json` lists them). The site panel's **Hide renewables** button switches the whole buildout off and on.

## The Watch page (watch/)

`watch/watch.py` runs daily in GitHub Actions (`.github/workflows/watch.yml`): it collects new items from the sources in
`watch/sources.yaml` (OpenAlex, Crossref, arXiv, the Federal Register, and journal / agency RSS), drops what has been seen,
prefilters by keyword, and asks Claude to classify and summarise the survivors — from the given text only — into
`data/watch.json`, which `watch.html` renders. One-time setup:

1. GitHub → repo *Settings → Secrets and variables → Actions → New repository secret*: `ANTHROPIC_API_KEY`.
2. Optional repository *variable* `WATCH_MODEL` (default `claude-opus-5`; `claude-haiku-4-5` is ~5× cheaper).
3. *Actions → watch → Run workflow* once to seed the feed; afterwards it runs at 06:20 UTC daily and commits its own output.

Cost: ~150 items/day in batches of 20 ≈ 8 model calls ≈ well under $1/day at Opus rates. `python3 watch/watch.py --dry-run`
shows what would be screened without calling the model.

## The plant on the map (atlas/facility.js + atlas/facility/)

Opening a site places the HOPS reference plant — the original Claude-Design 3D facility, unchanged in look — on the real
map next to the existing site, 330 m east of the plant's coordinates. `atlas/facility/plant_builders.js` and
`three.module.js` are extracted verbatim from the old page by `tools/port_plant_scene.py`; `plant_assembly.js` re-implements
the page's placement, capacity scaling, obstacle-aware pipe routing and flow animation against real run data. Subsystems
are present and sized from the selected run (a run without CCS has no capture unit; the electrolysis hall grows with P_EL),
pipes light up only when the optimizer moves something through them in the scrubbed hour, rotors follow the wind output,
and clicking a unit shows its description with the run's numbers. The live-sim's weather is ported too: sun and moon from the
site's latitude and the hour, cloudiness derived from the PV output against its clear-sky envelope, drifting clouds, rain
fronts with lightning, and the lighting following all of it — the map's imagery darkens at night and desaturates under cloud,
the sky takes the palette, the turbines dim. Times in the bar are site-local. The old standalone page is no longer linked.

## Running the optimizer for a requested site (tools/hops_site_run.py)

`hops_core.py` is never edited. `tools/hops_site_run.py` generates a derived copy (`_generated/hops_core_site.py`) with
three multiplier hooks at exact anchor lines (reformer CAPEX, CCS CAPEX, CCS capture rates — the only technical settings
hardcoded inside `build_model`), applies everything else through the environment variables hops_core already reads, and
runs the CI sweep for any coordinates in the US/EU weather grids. Needs the Python 3.12 venv
(`~/Documents/Stanford/PhD/hops-site-tools/.venv-siting`, has gurobipy), `~/gurobi.lic`, and `HOPS_DATA` on this Mac.

```bash
V=~/Documents/Stanford/PhD/hops-site-tools/.venv-siting/bin/python
# prove the derived copy reproduces a published point (no overrides):
$V tools/hops_site_run.py --validate 61 --ccs No --ci 0.5
# run a request from the Build page (the downloaded spec JSON or the issue's JSON block):
$V tools/hops_site_run.py --spec request.json --out ~/Documents/Stanford/PhD/HOPS/results/site_runs --label site_v1
# publish: the converter reads the custom-site register written next to the results
python3 tools/hops_to_web.py --results ~/Documents/Stanford/PhD/HOPS/results/site_runs --label site_v1 --bau-label BAU_v7 --names tools/plant_names.json -o data
```

**The request loop.** A visitor's "Request the run" opens a prefilled GitHub issue labelled `run-request` (site, capacity,
both pathways, full CI sweep, every optimizer input resolved). Then, on this Mac:

```bash
python3 tools/run_requests.py --list            # what is waiting
python3 tools/run_requests.py --run 12 --publish  # solve issue #12 (both pathways, 8 CI points each, ~1–2 h) and convert into data/
```

then commit + push in GitHub Desktop; the new site appears in the atlas as `#plant=<id>&view=site` (ids ≥ 1000). With a
`GITHUB_TOKEN` in the environment the script also comments the link on the issue and closes it; otherwise close it by hand.

Technical overrides accepted in the spec (`technical: {...}`, keys as on the Build page): `el_capex_usd_per_kw`,
`pv_capex_mult`, `wt_capex_mult`, `battery_capex_usd_per_mwh`, `smr_capex_mult`, `ccs_capex_mult`, `ccs_capture_process`,
`ccs_capture_flue`, `hb_capex_usd_per_mwh`, `gas_price_mult`, `grid_price_mult`, `nh3_price_usd_per_t`, `interest_rate`,
`res_overbuild`, `el_minload`, `nh3_minload`, `asu_minload`, `hb_hours`, `export_frac`, `eua_price_eur_per_t`, `eu_ets`.

## Siting for the whole fleet (tools/sherlock_siting/)

`README.md` there has the three commands: upload, one-time venv setup, `sbatch run_siting_all.script` (69 tasks, 3 at a
time so Overpass is not hammered), then rsync `$SCRATCH/HOPS_siting/` into `data/siting/` and push.

## The Finance tab (atlas/finance.js)

A port of `ProjectFinance/build_finance_model.py`: the run's per-tonne cost lines are de-annualised with its CRF and pushed
through construction + 30 years of operations (IDC, annuity debt, straight-line depreciation, tax, DSCR, IRR, NPV, banking
haircut on merchant power). All assumptions are editable in the panel; the plant design is not re-optimised.
For the ETS / 45V-45Q policy scenarios the levelised credit enters as a revenue line.

## Updating the tool's code

`atlas/index.html` is the tool; the map, plant, finance and build flows are `atlas/*.js`. Edit them directly and run
`python3 tools/stamp_atlas.py` before pushing (bumps the `?v=` on the script tags so browsers and GitHub Pages' cache fetch the new files). `tools/patch_atlas.py` documents how it was derived from the
Claude-Design export (the data seams, plant identity, restyle) and is kept only as a record — do not re-run it
over an edited `atlas/`.

## Local preview

```bash
python3 -m http.server 8765
```

then open http://localhost:8765/ (site) or http://localhost:8765/atlas/ (tool). Deep links work:
`atlas/#plant=61&ccs=1&ci=0.5&tab=hourly`.

## Known gaps

- `atlas/pages/hops-hybrid-ammonia-plant-live-sim.html` ("Process schematic") is still the original bundle with
  its own baked-in numbers for three plants; the real-world site view has replaced it as the default.
- Team/About/Results pages contain `[PLACEHOLDER]` tokens from the Design export — fill by hand.
- The atlas preview on the home page is a placeholder awaiting a screenshot.
