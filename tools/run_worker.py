#!/usr/bin/env python3
"""
run_worker.py — hands-off queue: poll GitHub for run requests, solve them here, publish, push, close.

    python3 run_worker.py --once            # one pass: solve the oldest open request (if any), publish, push, close
    python3 run_worker.py --loop 600        # keep going, checking every 600 s (what the launchd job runs)

Needs GITHUB_TOKEN in the environment (fine-grained token, this repo only: Contents read/write + Issues read/write).
Solves one request at a time (lock file), skips issues that already carry a "hops-worker" comment, and never
touches anything outside data/ in the repo. A failed solve gets a comment on the issue and is left open.
"""
from __future__ import annotations
import argparse, json, os, re, subprocess, sys, time, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
MODEL = Path(os.environ.get("HOPS_CODE_DIR", Path.home() / "Documents/Stanford/PhD/HOPS/Sherlock all Plants/New"))   # hops_core + ets_policy_cases + us_credit_cases
SITE_REPO = Path.home() / "Documents/Stanford/PhD/hops-site/HOPS-Tool-LiveV1"
OUT = Path.home() / "Documents/Stanford/PhD/HOPS/results/site_runs"
LOCK = OUT / ".worker.lock"; LOG = OUT / "worker.log"
REPO = "yasch00/HOPS-Tool-LiveV1"; LABEL = "site_v1"
PY = next((c for c in [HERE / ".venv-siting/bin/python", Path.home() / "Documents/Stanford/PhD/hops-site-tools/.venv-siting/bin/python"] if c.exists()), Path(sys.executable))

def log(msg):
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')}  {msg}"; print(line, flush=True)
    OUT.mkdir(parents=True, exist_ok=True); LOG.open("a").write(line + "\n")
def api(path, method="GET", data=None):
    req = urllib.request.Request(f"https://api.github.com/repos/{REPO}{path}", method=method, headers={"Accept": "application/vnd.github+json", "User-Agent": "hops-worker", "Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}"})
    if data is not None: req.data = json.dumps(data).encode(); req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=60) as r: return json.load(r)
def sh(cmd, cwd=None): log("$ " + " ".join(map(str, cmd))); subprocess.run([str(c) for c in cmd], cwd=cwd, check=True)

def pending():
    out = []
    for it in api("/issues?state=open&per_page=100"):
        if "pull_request" in it: continue
        if not (any(l["name"] == "run-request" for l in it.get("labels", [])) or str(it["title"]).lower().startswith("run request")): continue
        if not re.search(r"```json\s*(\{.*?\})\s*```", it["body"] or "", re.S): continue
        if any("hops-worker" in (c.get("body") or "") for c in api(f"/issues/{it['number']}/comments")): continue   # already handled / in progress
        out.append(it)
    return sorted(out, key=lambda it: it["number"])

def handle(issue):
    n = issue["number"]; spec = json.loads(re.search(r"```json\s*(\{.*?\})\s*```", issue["body"], re.S).group(1))
    OUT.mkdir(parents=True, exist_ok=True); sf = OUT / f"request_{n}.json"; sf.write_text(json.dumps(spec, indent=1))
    reg = OUT / "sites.json"; sites = json.loads(reg.read_text()) if reg.exists() else {}; site_id = max([int(k) for k in sites] + [999]) + 1
    api(f"/issues/{n}/comments", "POST", {"body": f"<!-- hops-worker --> Picked up by the HOPS worker as site **{site_id}** — solving both pathways over the full CI sweep on the model machine. This usually takes 1–2 hours; the result is posted here when it is live."})
    t0 = time.time()
    try:
        run_dir = OUT / f"site{site_id}"; run_dir.mkdir(parents=True, exist_ok=True)                       # one folder per site: the converter merges it into the fleet
        sh([PY, HERE / "hops_site_run.py", "--spec", sf, "--out", run_dir, "--label", LABEL, "--site-id", str(site_id)])
        sh([PY, HERE / "hops_site_run.py", "--spec", sf, "--out", run_dir, "--label", LABEL, "--site-id", str(site_id), "--bau", "--bau-label", LABEL])
        for script in ("ets_policy_cases.py", "us_credit_cases.py"):                                          # policy re-pricings for the site's region (the other one finds no plants and just says so)
            if (MODEL / script).exists(): subprocess.run([str(PY), str(MODEL / script), "--results-dir", str(run_dir), "--label", LABEL, "--bau-label", LABEL, "--ccs", "both"], cwd=MODEL)
        (OUT / "sites.json").write_text(json.dumps({**sites, **json.loads((run_dir / "sites.json").read_text())}, indent=1))   # the id register across runs
        sh([sys.executable, SITE_REPO / "tools/hops_to_web.py", "--results", run_dir, "--label", LABEL, "--bau-label", LABEL, "--names", SITE_REPO / "tools/plant_names.json", "-o", SITE_REPO / "data"])
        try:                                                                                                    # siting layers (OSM via Overpass): best effort, the site is published without them if it fails
            sh([PY, HERE / "export_siting.py", "--plant", str(site_id), "--lat", str(spec["site"]["lat"]), "--lon", str(spec["site"]["lon"]), "--name", spec["site"].get("name") or f"Site {site_id}", "--country", spec["site"].get("country") or "",
                "--tol", "12", "--scenarios", SITE_REPO / "data/scenarios.json", "-o", SITE_REPO / "data/siting"])
            sh([sys.executable, SITE_REPO / "tools/siting_index.py"])
        except subprocess.CalledProcessError as e: log(f"siting failed for site {site_id}: {e} — published without layers")
        # summary.json is kept gzipped in the repo
        summ = SITE_REPO / "data/summary.json"
        if summ.exists(): sh(["gzip", "-kf6", summ]); summ.unlink()
        sh(["git", "add", "data"], cwd=SITE_REPO)
        sh(["git", "-c", "user.name=hops-worker", "-c", "user.email=hops-worker@users.noreply.github.com", "commit", "-m", f"site {site_id}: run request #{n} ({spec['site'].get('name') or spec['site']['lat']}, {spec['site']['lon']})"], cwd=SITE_REPO)
        sh(["git", "push", f"https://x-access-token:{os.environ['GITHUB_TOKEN']}@github.com/{REPO}.git", "HEAD:main"], cwd=SITE_REPO)
        url = f"https://yasch00.github.io/{REPO.split('/')[1]}/atlas/#plant={site_id}&view=site"
        api(f"/issues/{n}/comments", "POST", {"body": f"<!-- hops-worker --> Solved in {(time.time()-t0)/60:.0f} min and published as site **{site_id}**: {url}\n\nBoth pathways, CI 0 – 1.75, BAU reference, policy cases and siting layers. The page updates a minute or two after this comment."})
        api(f"/issues/{n}", "PATCH", {"state": "closed"}); log(f"issue #{n} → site {site_id} done")
    except subprocess.CalledProcessError as e:
        api(f"/issues/{n}/comments", "POST", {"body": f"<!-- hops-worker --> The solve failed (`{' '.join(map(str, e.cmd))[:120]}` exited {e.returncode}). Left open for a manual look."}); log(f"issue #{n} FAILED: {e}")

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--once", action="store_true"); ap.add_argument("--loop", type=int, metavar="SECONDS")
    a = ap.parse_args()
    if "GITHUB_TOKEN" not in os.environ: sys.exit("GITHUB_TOKEN not set")
    while True:
        if LOCK.exists() and time.time() - LOCK.stat().st_mtime < 6 * 3600: log("another run in progress; skipping")
        else:
            OUT.mkdir(parents=True, exist_ok=True); LOCK.write_text(str(os.getpid()))
            try:
                q = pending(); log(f"{len(q)} pending request(s)")
                if q: handle(q[0])
            finally: LOCK.unlink(missing_ok=True)
        if not a.loop: break
        time.sleep(a.loop)

if __name__ == "__main__":
    main()
