#!/bin/bash
# ONE-TIME setup on Sherlock (run in a login shell, ~10 min). Creates ~/HOPS/siting with its own venv,
# because hops_env has no osmnx. The siting model (hops_land_siting.py) is used unchanged.
set -e
mkdir -p ~/HOPS/siting/land_siting_out ~/HOPS/Output/SLURM
cd ~/HOPS/siting
ml purge; ml load python/3.9.0 py-numpy/1.24.2_py39 py-pandas/2.0.1_py39 py-scipy/1.10.1_py39
python3 -m venv venv && source venv/bin/activate
pip install -q --upgrade pip
pip install -q "osmnx<2" geopandas shapely pyproj pandas numpy openpyxl matplotlib requests
python3 -c "import osmnx, geopandas; print('siting venv ok: osmnx', osmnx.__version__)"
