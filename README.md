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
The site view shows the catchment, terrain and buildings for every plant, and the buildout only where this has run.

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

## The Finance tab (atlas/finance.js)

A port of `ProjectFinance/build_finance_model.py`: the run's per-tonne cost lines are de-annualised with its CRF and pushed
through construction + 30 years of operations (IDC, annuity debt, straight-line depreciation, tax, DSCR, IRR, NPV, banking
haircut on merchant power). All assumptions are editable in the panel; the plant design is not re-optimised.

## Updating the tool's code

`atlas/index.html` is the tool. Edit it directly. `tools/patch_atlas.py` documents how it was derived from the
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
