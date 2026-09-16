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

- `atlas/pages/hops-hybrid-ammonia-plant-live-sim.html` (the 3D facility view) is still the original bundle with
  its own baked-in numbers for three plants; it opens for every plant but shows the default facility.
- Team/About/Results pages contain `[PLACEHOLDER]` tokens from the Design export — fill by hand.
- The atlas preview on the home page is a placeholder awaiting a screenshot.
