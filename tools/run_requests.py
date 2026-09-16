#!/usr/bin/env python3
"""
run_requests.py — the queue: list open "run-request" issues on GitHub, pull their spec, run them locally, publish.

    python3 run_requests.py --list                       # what is waiting (public API, no token needed)
    python3 run_requests.py --run 12                     # run issue #12: both pathways, full sweep, ~1–2 h on this Mac
    python3 run_requests.py --run 12 --publish           # ... then convert into the website's data/ (you still push)

Reading issues needs no credentials. Closing them / commenting needs a token: set GITHUB_TOKEN (repo scope) and
--publish will post a comment with the site id and close the issue; without it, close the issue by hand on GitHub.
"""
from __future__ import annotations
import argparse, json, os, re, subprocess, sys, urllib.request
from pathlib import Path

REPO = "yasch00/HOPS-Tool-LiveV1"
HERE = Path(__file__).resolve().parent
SITE_REPO = Path.home() / "Documents/Stanford/PhD/hops-site/HOPS-Tool-LiveV1"
OUT = Path.home() / "Documents/Stanford/PhD/HOPS/results/site_runs"
PY = next((c for c in [HERE / ".venv-siting/bin/python", Path.home() / "Documents/Stanford/PhD/hops-site-tools/.venv-siting/bin/python"] if c.exists()), Path(sys.executable))   # the 3.12 venv with gurobipy

def api(path, method="GET", data=None):
    req = urllib.request.Request(f"https://api.github.com/repos/{REPO}{path}", method=method, headers={"Accept": "application/vnd.github+json", "User-Agent": "hops-run-requests"})
    tok = os.environ.get("GITHUB_TOKEN")
    if tok: req.add_header("Authorization", f"Bearer {tok}")
    if data is not None: req.data = json.dumps(data).encode(); req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=30) as r: return json.load(r)

def spec_from_issue(issue):
    m = re.search(r"```json\s*(\{.*?\})\s*```", issue["body"] or "", re.S)
    if not m: sys.exit(f"issue #{issue['number']} has no JSON spec block")
    return json.loads(m.group(1))

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--list", action="store_true"); ap.add_argument("--run", type=int, metavar="ISSUE")
    ap.add_argument("--publish", action="store_true"); ap.add_argument("--label", default="site_v1")
    a = ap.parse_args()
    if a.list or a.run is None:
        # GitHub only applies the run-request label if it exists in the repo, so match on the title too
        issues = [it for it in api("/issues?state=open&per_page=100") if "pull_request" not in it and
                  (any(l["name"] == "run-request" for l in it.get("labels", [])) or str(it["title"]).lower().startswith("run request"))]
        if not issues: print("no open run requests on", REPO); return
        for it in issues:
            sp = None
            try: sp = spec_from_issue(it)
            except SystemExit: pass
            print(f"#{it['number']:<4d} {it['created_at'][:10]}  {it['title'][:70]}" + (f"  → {sp['plant']['tNH3_day']} t/d · changed {len(sp.get('technical_changed', {}))}" if sp else "  (no spec)"))
        return
    it = api(f"/issues/{a.run}"); spec = spec_from_issue(it)
    OUT.mkdir(parents=True, exist_ok=True); sf = OUT / f"request_{a.run}.json"; sf.write_text(json.dumps(spec, indent=1))
    print(f"issue #{a.run}: {it['title']}\nspec → {sf}")
    reg = OUT / "sites.json"; sites = json.loads(reg.read_text()) if reg.exists() else {}
    site_id = max([int(k) for k in sites] + [999]) + 1
    subprocess.run([str(PY), str(HERE / "hops_site_run.py"), "--spec", str(sf), "--out", str(OUT), "--label", a.label, "--site-id", str(site_id)], check=True)
    print(f"\nsite {site_id} solved → {OUT}")
    if a.publish:
        subprocess.run([sys.executable, str(SITE_REPO / "tools/hops_to_web.py"), "--results", str(OUT), "--label", a.label, "--bau-label", "BAU_v7",
                        "--names", str(SITE_REPO / "tools/plant_names.json"), "-o", str(SITE_REPO / "data")], check=True)
        print("\npublished into data/ — commit and push in GitHub Desktop")
        if os.environ.get("GITHUB_TOKEN"):
            api(f"/issues/{a.run}/comments", "POST", {"body": f"Solved as site **{site_id}** (label `{a.label}`), both pathways, full CI sweep. It appears in the atlas after the next push: https://yasch00.github.io/HOPS-Tool-LiveV1/atlas/#plant={site_id}&view=site"})
            api(f"/issues/{a.run}", "PATCH", {"state": "closed"}); print(f"issue #{a.run} commented and closed")
        else:
            print(f"no GITHUB_TOKEN: close issue #{a.run} by hand and paste the link https://yasch00.github.io/HOPS-Tool-LiveV1/atlas/#plant={site_id}&view=site")

if __name__ == "__main__":
    main()
