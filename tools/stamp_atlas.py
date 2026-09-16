#!/usr/bin/env python3
"""stamp_atlas.py — bump the ?v= cache-buster on atlas/*.js script tags. Run after editing any atlas/*.js, before pushing."""
import re, time, pathlib
p = pathlib.Path(__file__).resolve().parent.parent / "atlas/index.html"; s = p.read_text(encoding="utf-8")
stamp = time.strftime("%Y%m%d%H%M%S")
s, n = re.subn(r'<script src="([a-z]+)\.js(\?v=[^"]*)?"></script>', lambda m: f'<script src="{m.group(1)}.js?v={stamp}"></script>', s)
p.write_text(s, encoding="utf-8"); print(n, "script tags stamped", stamp)
