# Siting layers for all plants — on Sherlock

Uses the siting model exactly as it is (`hops_land_siting.py`, unmodified) through `export_siting.py`, which takes
the wind/PV capacities of **every published run** (each pathway × each CI target) from the website's
`data/scenarios.json` — nothing is hardcoded. Turbine spec (6 MW, 120 m hub, 150 m rotor), densities and setbacks
are the siting model's own parameters and stay in `hops_land_siting.py`.

## 1. Upload (on the laptop)

```bash
cd ~/Documents/Stanford/PhD/hops-site-tools/sherlock_siting
rsync -av setup_sherlock.sh run_siting_all.script ../export_siting.py \
      ~/Documents/Stanford/PhD/HOPS/hops_land_siting.py \
      ~/Documents/Stanford/PhD/hops-site/HOPS-Tool-LiveV1/data/scenarios.json  sherlock:~/HOPS/siting/
```

## 2. One-time setup (on Sherlock)

```bash
cd ~/HOPS/siting && bash setup_sherlock.sh
```

## 3. Submit (on Sherlock)

```bash
cd ~/HOPS/siting && sbatch run_siting_all.script
squeue -u $USER                                   # progress
ls $SCRATCH/HOPS_siting/*/site.json | wc -l       # plants done, expect 69
grep -l "Error\|Traceback" ~/HOPS/Output/SLURM/siting_*.err
```

Re-submitting is safe: a plant with `site.json` is skipped. Overpass occasionally times out; just resubmit.

## 4. Pull back and publish (on the laptop)

```bash
rsync -av sherlock:'$SCRATCH/HOPS_siting/' ~/Documents/Stanford/PhD/hops-site/HOPS-Tool-LiveV1/data/siting/
```

then commit + push in GitHub Desktop. Every plant's site view picks its layers up automatically.
Expected size: ~6 MB per plant, ~400 MB for the fleet (GitHub Pages limit is 1 GB, so this is fine; if the repo
gets tight, the developable/exclusion GeoJSON can move to a release asset later).
