#!/bin/bash
# pack_model.sh — assemble the HOPS model code + every input it needs into ~/Documents/Stanford/PhD/HOPS/cloud/,
# verify with the model's own check_data.py, and tar the data into ≤1.9 GB parts for a GitHub release.
#   bash tools/pack_model.sh
set -e
SRC="$HOME/Documents/Stanford/PhD/HOPS/Sherlock all Plants/New"; DATA="$HOME/Documents/Stanford/PhD/HOPS/HOPS_DATA"
OUT="$HOME/Documents/Stanford/PhD/HOPS/cloud"; PY="$HOME/Documents/Stanford/PhD/hops-site-tools/.venv-siting/bin/python"
rm -rf "$OUT"; mkdir -p "$OUT/model" "$OUT/data/110m_cultural"
cp "$SRC"/*.py "$OUT/model/"; cp "$HOME/Documents/Stanford/PhD/hops-site-tools/hops_site_run.py" "$HOME/Documents/Stanford/PhD/hops-site-tools/export_siting.py" "$HOME/Documents/Stanford/PhD/HOPS/hops_land_siting.py" "$OUT/model/"
printf '# HOPS model (private)\nCode as deployed on Sherlock, byte-identical to the laptop copy. hops_site_run.py drives single-site runs\nwith overrides (see the public site repo). Data is attached to the release `data-v1` as tar parts.\n' > "$OUT/model/README.md"
printf '__pycache__/\nresults/\n_generated/\n*.pyc\n' > "$OUT/model/.gitignore"
# inputs: flat layout (both layouts are supported by the loader)
rsync -a --exclude atlite_cutouts --exclude '*.pdf' --exclude '*.html' --exclude '*.png' "$DATA/" "$OUT/data/"
cp "$HOME/Library/Mobile Documents/com~apple~CloudDocs/Documents/PlantsAmmoniaGreen/110m_cultural/"ne_110m_admin_* "$OUT/data/110m_cultural/" 2>/dev/null || true
cp "$HOME/Documents/PlantsAmmoniaGreen/plants/Plants_US_and_Europe.xlsx" "$OUT/data/"
for f in demand_period_mask_8760.npy Average_retail_price_of_electricity.csv; do
  p=$(find "$HOME/Documents/Stanford/PhD/HOPS" "$HOME/Documents/PlantsAmmoniaGreen" "$HOME/Library/Mobile Documents/com~apple~CloudDocs/Documents" -name "$f" -not -path "*/cloud/*" 2>/dev/null | head -1)
  [ -n "$p" ] && cp "$p" "$OUT/data/" && echo "  + $f  ($p)" || echo "  ! $f NOT FOUND — the run will fail on it"
done
echo "=== check_data.py against the packed folder ==="
cd "$OUT/model" && HOPS_DATA_DIR="$OUT/data" "$PY" check_data.py --data-dir "$OUT/data" || true
echo "=== tar parts (≤1.9 GB each) ==="
cd "$OUT" && tar -cf - data | split -b 1900m - hops_data.tar.part-
ls -la "$OUT"/hops_data.tar.part-* | awk '{printf "  %6.0f MB  %s\n", $5/1e6, $9}'
echo; echo "Next: create the PRIVATE repo yasch00/HOPS-model, push $OUT/model as its contents, make a release tagged data-v1 and upload the part files above as its assets."
