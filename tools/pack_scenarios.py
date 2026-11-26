#!/usr/bin/env python3
"""pack_scenarios.py — write data/scenarios.pack.json, a lossless compact form of data/scenarios.json.

    python3 tools/pack_scenarios.py            # (re)build the pack and verify it
    python3 tools/pack_scenarios.py --check    # exit 1 if the pack is missing or does not match scenarios.json

Why: scenarios.json repeats 92 column names in every one of ~3,500 rows, and every policy case
(EU ETS law / proposal, US credits) repeats the design of its base case, where only the cost columns
differ. The pack stores each column list once and each policy row as its differences from the base
row with the same CI target (field r = index of that base row). Unpacked (scnpack.js in the site root, or unpack() below) it gives the
identical list: same scenarios, same order, same keys in the same order, same values.

scenarios.json stays the source of truth and stays published (downloads, tools/export_siting.py).
The atlas and the storage page read the pack and fall back to scenarios.json when the pack is
missing or its scenario count / version differ from manifest.json. hops_to_web.py and
remove_site.py call write_pack() after they change scenarios.json, so the two cannot drift."""
import argparse, json, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


def _base_key(s):
    return (s["plant"], s["path"], s["ccs"], s["hb"])


def pack(scenarios, version=None):
    orders = []

    def oid(keys):
        keys = list(keys)
        if keys not in orders:
            orders.append(keys)
        return orders.index(keys)

    base = {}
    for i, s in enumerate(scenarios):
        if not s.get("policy"):
            base.setdefault(_base_key(s), i)
    out = []
    for s in scenarios:
        meta = {k: v for k, v in s.items() if k != "rows"}
        bi = base.get(_base_key(s)) if s.get("policy") else None
        rows = []
        for r in s["rows"]:
            j = next((n for n, q in enumerate(scenarios[bi]["rows"]) if q.get("target") == r.get("target")), None) if bi is not None else None
            if j is not None:       # only the cells that differ from base row j (or do not exist there)
                br = scenarios[bi]["rows"][j]
                d = {k: v for k, v in r.items() if k not in br or br[k] != v or type(br[k]) is not type(v)}
                rows.append({"o": oid(r.keys()), "r": j, "k": oid(d.keys()), "v": list(d.values())})
            else:
                rows.append({"o": oid(r.keys()), "v": list(r.values())})
        e = dict(meta)
        if bi is not None:
            e["b"] = bi
        e["rows"] = rows
        out.append(e)
    return {"v": 1, "n": len(scenarios), "version": version, "orders": orders, "scn": out}


def unpack(p):
    """Inverse of pack(); the JavaScript twin is scnpack.js."""
    orders = p["orders"]
    out = [None] * len(p["scn"])
    for stage in (0, 1):                                   # base cases first, then the cases stored as differences
        for i, e in enumerate(p["scn"]):
            if ("b" in e) != bool(stage):
                continue
            s = {k: v for k, v in e.items() if k not in ("b", "rows")}
            rows = []
            for r in e["rows"]:
                keys = orders[r["o"]]
                if "k" not in r:
                    rows.append(dict(zip(keys, r["v"])))
                else:
                    d, br = dict(zip(orders[r["k"]], r["v"])), out[e["b"]]["rows"][r["r"]]
                    rows.append({k: (d[k] if k in d else br[k]) for k in keys})
            s["rows"] = rows
            out[i] = s
    return out


def write_pack(data_dir=None, quiet=False):
    d = pathlib.Path(data_dir) if data_dir else ROOT / "data"
    scenarios = json.loads((d / "scenarios.json").read_text())
    man = json.loads((d / "manifest.json").read_text()) if (d / "manifest.json").exists() else {}
    p = pack(scenarios, man.get("version"))
    if json.dumps(unpack(p)) != json.dumps(scenarios):     # order-sensitive: keys and values must come back exactly
        raise SystemExit("pack_scenarios: round trip differs from scenarios.json — pack NOT written")
    (d / "scenarios.pack.json").write_text(json.dumps(p, separators=(",", ":")))
    if not quiet:
        a, b = (d / "scenarios.json").stat().st_size, (d / "scenarios.pack.json").stat().st_size
        print(f"scenarios.pack.json: {len(scenarios)} scenarios, {b / 1024:,.0f} KB (scenarios.json {a / 1024:,.0f} KB), round trip identical")


def check(data_dir=None):
    d = pathlib.Path(data_dir) if data_dir else ROOT / "data"
    f = d / "scenarios.pack.json"
    if not f.exists():
        print("scenarios.pack.json is missing"); return 1
    ok = json.dumps(unpack(json.loads(f.read_text()))) == json.dumps(json.loads((d / "scenarios.json").read_text()))
    print("scenarios.pack.json matches scenarios.json" if ok else "scenarios.pack.json is STALE: run python3 tools/pack_scenarios.py")
    return 0 if ok else 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--data", default=None)
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    sys.exit(check(a.data)) if a.check else write_pack(a.data)
