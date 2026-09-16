#!/usr/bin/env python3
"""siting_index.py — write data/siting/index.json (which plants have siting layers). Run after adding siting folders (rsync from Sherlock)."""
import json, pathlib
root = pathlib.Path(__file__).resolve().parent.parent / "data/siting"
plants = sorted(int(p.name[5:]) for p in root.glob("plant*") if (p / "site.json").exists())
(root / "index.json").write_text(json.dumps({"plants": plants, "n": len(plants)}))
print(f"siting index: {len(plants)} plants → {root/'index.json'}")
