#!/usr/bin/env python3
"""
watch.py — daily screen of the literature, policy and project news for HOPS.

    python3 watch/watch.py              # collect → dedupe → prefilter → classify (Claude) → write data/watch.json
    python3 watch/watch.py --dry-run    # everything except the model call; prints what would be screened

Runs in GitHub Actions (.github/workflows/watch.yml) with ANTHROPIC_API_KEY as a repo secret; the site just
reads data/watch.json. Rules baked in:
  * the model classifies and compresses only the text it is given — every item carries the primary URL
    it came from, and nothing is written that the source text does not contain
  * recall over precision at the collect stage, precision at the screen stage
  * on any failure nothing is written, so the site keeps serving yesterday's feed
State: data/watch/seen.json (hashes), data/watch/archive/YYYY-MM.json, data/watch/status.json.
"""
from __future__ import annotations
import argparse, time, hashlib, json, os, re, sys, time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests, feedparser, yaml

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"; STATE = DATA / "watch"; ARCHIVE = STATE / "archive"
UA = {"User-Agent": "HOPS-watch/1.0 (Stanford research; https://github.com/yasch00/HOPS-Tool-LiveV1)"}
MODEL = os.environ.get("WATCH_MODEL", "github:openai/gpt-4o-mini")
# Providers, chosen by the WATCH_MODEL prefix — all give the same structured verdicts:
#   github:<publisher>/<model>   GitHub Models, FREE with the Actions GITHUB_TOKEN (permission models: read); rate-limited
#                                (low tier ≈150 requests/day, 8k input tokens each) — plenty for one daily screen. Default.
#   openai:<model>               any OpenAI-compatible endpoint: WATCH_ENDPOINT (e.g. Groq / Gemini free tiers) + WATCH_API_KEY
#   claude-…                     Anthropic (ANTHROPIC_API_KEY, paid)
#   none                         keyword mode, no model at all
LOOKBACK_DAYS = int(os.environ.get("WATCH_LOOKBACK_DAYS", "3"))     # window per run; seen.json prevents repeats
MAX_ITEMS = int(os.environ.get("WATCH_MAX_ITEMS", "150"))          # hard cap on model input per run
FEED_DAYS, FEED_MAX = 120, 300                                     # what the site shows
PREFILTER = re.compile(r"(ammonia|\bNH3\b|haber|nitrogen fertili[sz]|hydrogen|electrolys|\bSMR\b|\bATR\b|steam methane|autothermal|"
                       r"carbon captur|\bCCS\b|\bCCUS\b|\b45V\b|\b45Q\b|CBAM|\bETS\b|emissions trading|low-carbon|decarboni)", re.I)
CATS = ["publication", "project", "cost", "policy"]

def log(*a): print(*a, file=sys.stderr, flush=True)
def hid(*parts): return hashlib.sha1("|".join(str(p or "").strip().lower() for p in parts).encode()).hexdigest()[:16]
def clean(s, n=1200): return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", str(s or ""))).strip()[:n]

# ------------------------------------------------------------------ collectors: each yields {id,title,text,url,date,source,category_hint,region_hint}
def get(url, params=None, timeout=40):
    r = requests.get(url, params=params, headers=UA, timeout=timeout); r.raise_for_status(); return r

PAGES = int(os.environ.get("WATCH_PAGES", "1"))          # pages of 50 per API source; raise for a backfill

def c_openalex(src, since):
  for page in range(1, PAGES + 1):
    r = get("https://api.openalex.org/works", {"search": src["query"], "filter": f"from_publication_date:{since}", "per-page": 50, "page": page, "sort": "publication_date:desc"})
    res = r.json().get("results", [])
    if not res: break
    for w in res:
        inv = w.get("abstract_inverted_index") or {}
        words = sorted((pos, t) for t, ps in inv.items() for pos in ps); abstract = " ".join(t for _, t in words)
        loc = w.get("primary_location") or {}
        yield {"id": hid(w.get("doi") or w.get("id")), "title": w.get("title") or "", "text": abstract, "url": w.get("doi") or loc.get("landing_page_url") or w.get("id"),
               "date": w.get("publication_date"), "source": ((loc.get("source") or {}).get("display_name")) or "OpenAlex"}

def c_crossref(src, since):
  for page in range(PAGES):
    r = get("https://api.crossref.org/works", {"query.bibliographic": src["query"], "filter": f"from-pub-date:{since}", "rows": 50, "offset": 50 * page, "sort": "published", "order": "desc"})
    res = r.json().get("message", {}).get("items", [])
    if not res: break
    for w in res:
        d = (w.get("published") or w.get("created") or {}).get("date-parts", [[None]])[0]
        yield {"id": hid(w.get("DOI")), "title": clean((w.get("title") or [""])[0], 300), "text": clean(w.get("abstract")), "url": w.get("URL") or f"https://doi.org/{w.get('DOI')}",
               "date": "-".join(f"{x:02d}" if i else str(x) for i, x in enumerate(d)) if d and d[0] else None, "source": (w.get("container-title") or ["Crossref"])[0]}

def c_arxiv(src, since):
    r = get("http://export.arxiv.org/api/query", {"search_query": src["query"], "sortBy": "submittedDate", "sortOrder": "descending", "max_results": 50 * PAGES})
    for e in feedparser.parse(r.text).entries:
        d = time.strftime("%Y-%m-%d", e.published_parsed) if getattr(e, "published_parsed", None) else None
        yield {"id": hid(e.get("id")), "title": clean(e.get("title"), 300), "text": clean(e.get("summary")), "url": e.get("link"), "date": d, "source": "arXiv"}

def c_federalregister(src, since):
    for term in src["terms"]:
      for page in range(1, PAGES + 1):
        r = get("https://www.federalregister.gov/api/v1/documents.json", {"conditions[term]": term, "conditions[publication_date][gte]": since, "order": "newest", "per_page": 50, "page": page})
        res = r.json().get("results", [])
        if not res: break
        for d in res:
            yield {"id": hid(d.get("document_number")), "title": clean(d.get("title"), 300), "text": clean(d.get("abstract")), "url": d.get("html_url"),
                   "date": d.get("publication_date"), "source": "Federal Register · " + ((d.get("agencies") or [{}])[0].get("name") or "")}

def c_rss(src, since):
    f = feedparser.parse(src["url"], request_headers=UA)
    for e in f.entries:
        tp = getattr(e, "published_parsed", None) or getattr(e, "updated_parsed", None)
        d = time.strftime("%Y-%m-%d", tp) if tp else None
        if d and len(d) == 10 and d < since: continue
        if not d or len(d) < 10 or d > date.today().isoformat(): d = date.today().isoformat()   # journal RSS carries volume dates; use the day it appeared
        yield {"id": hid(e.get("link") or e.get("id") or e.get("title")), "title": clean(e.get("title"), 300), "text": clean(e.get("summary") or e.get("description")), "url": e.get("link"), "date": d, "source": src["name"]}

COLLECTORS = {"openalex": c_openalex, "crossref": c_crossref, "arxiv": c_arxiv, "federalregister": c_federalregister, "rss": c_rss}

def collect(sources, since):
    out = []
    for s in sources:
        try:
            items = list(COLLECTORS[s["type"]](s, since))
        except Exception as e:
            log(f"  {s['id']:16s} FAILED {type(e).__name__}: {e}"); continue
        today = date.today().isoformat()
        for it in items:
            it.setdefault("category_hint", s.get("category_hint", "publication")); it.setdefault("region_hint", s.get("region_hint", "Global")); it["source_id"] = s["id"]
            d = it.get("date") or ""
            if len(d) < 10 or d > today: it["date"] = today          # partial (year-month, in-press) or future dates → the day it appeared
        log(f"  {s['id']:16s} {len(items):4d} items"); out += items
    return out

# ------------------------------------------------------------------ screen with Claude (structured JSON, batched)
SCHEMA = {"type": "object", "additionalProperties": False, "required": ["items"], "properties": {"items": {"type": "array", "items": {
    "type": "object", "additionalProperties": False,
    "required": ["id", "relevant", "category", "region", "title", "summary", "relevance", "params_touched"],
    "properties": {"id": {"type": "string"}, "relevant": {"type": "boolean"}, "category": {"type": "string", "enum": CATS},
                   "region": {"type": "string"}, "title": {"type": "string"}, "summary": {"type": "string"},
                   "relevance": {"type": "number"}, "params_touched": {"type": "array", "items": {"type": "string"}}}}}}}

def system_prompt(params):
    plist = "\n".join(f"  {p['id']}: {p['name']} ({p.get('category','')}, {p.get('unit','')})" for p in params)
    return f"""You screen new documents for a research site about HOPS, an optimisation model of low-carbon ammonia plants
(renewables, electrolysis, steam methane reforming with or without carbon capture, hydrogen storage, Haber-Bosch) across ~70 real
plants in the US and Europe. Its headline is the carbon intensity at which a hybrid plant becomes cost-competitive without subsidies.

For each item decide whether it is directly useful to someone following that work: economics or engineering of low-carbon ammonia or
hydrogen production, concrete ammonia/hydrogen project announcements, cost data for the technologies above (electrolysers, CCS,
renewables, gas, grid tariffs), or policy that changes the economics (EU ETS, CBAM, US 45V/45Q, hydrogen and ammonia standards).
General climate news, unrelated chemistry, and marketing without substance are not relevant.

Rules — these are strict:
- Use ONLY the title and text given for an item. Never add facts, numbers, names, dates or context you happen to know.
- summary: one or two plain sentences saying what the item reports, written for a technical, sceptical reader. Quote numbers only if
  they appear in the text. If the text is empty or too thin to summarise, summarise the title alone and lower the relevance.
- category: publication (peer-reviewed or preprint), project (a plant, investment or offtake announcement), cost (a cost or price
  data release), policy (law, regulation, guidance, tax credit).
- region: Global, United States, Europe, or a country/region named in the text.
- relevance: 0 to 1, your confidence that a HOPS reader wants to see this.
- params_touched: ids from this registry that the item could update, else an empty list:
{plist}
Return one entry per input item, same ids, in the same order."""

STRONG = re.compile(r"(ammonia|\bNH3\b|haber|nitrogen fertili[sz]|\b45V\b|\b45Q\b|CBAM)", re.I)
def screen_keywords(items):
    """WATCH_MODEL=none — no model call, no cost. Keeps items that name ammonia/fertiliser/its policies outright,
    uses the source's category hint and the first sentences of the source text as the summary. Lower precision,
    nothing invented."""
    out = {}
    for it in items:
        hay = it["title"] + " " + it["text"]
        rel = bool(STRONG.search(hay)); strong = len(STRONG.findall(hay))
        summ = re.split(r"(?<=[.!?])\s+", it["text"])[:2]
        out[it["id"]] = {"id": it["id"], "relevant": rel, "category": it["category_hint"], "region": it["region_hint"], "title": it["title"],
                         "summary": (" ".join(summ) if it["text"] else "No abstract in the source feed — title only.")[:400], "relevance": min(1.0, 0.4 + 0.15 * strong) if rel else 0.0, "params_touched": []}
    return out

def screen_openai_compatible(items, params, endpoint, key, model, batch_n=8):
    """One JSON object per batch via the chat-completions API (GitHub Models, Groq, Gemini's OpenAI endpoint …)."""
    import urllib.request
    out = {}
    for i in range(0, len(items), batch_n):
        batch = items[i:i + batch_n]
        payload = [{"id": it["id"], "source": it["source"], "date": it["date"], "category_hint": it["category_hint"], "region_hint": it["region_hint"],
                    "title": it["title"], "text": it["text"][:700]} for it in batch]
        body = {"model": model, "temperature": 0, "max_tokens": 3000, "response_format": {"type": "json_object"},
                "messages": [{"role": "system", "content": system_prompt(params) + "\n\nAnswer with ONE JSON object of the form " + json.dumps({"items": [{"id": "…", "relevant": True, "category": "…", "region": "…", "summary": "…", "relevance": 0.0, "params_touched": []}]}) + " — one entry per input id, nothing else."},
                             {"role": "user", "content": "Screen these items:\n" + json.dumps(payload, ensure_ascii=False)}]}
        req = urllib.request.Request(endpoint, data=json.dumps(body).encode(), method="POST",
                                     headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "hops-watch"})
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=120) as r: resp = json.load(r)
                text = resp["choices"][0]["message"]["content"].strip()
                if text.startswith("```"): text = text.strip("`").split("\n", 1)[1] if "\n" in text else text
                parsed = json.loads(text); rows = parsed.get("items", parsed if isinstance(parsed, list) else [])
                for row in rows:
                    if isinstance(row, dict) and row.get("id"): out[row["id"]] = row
                u = resp.get("usage", {}); log(f"  screened {len(batch)} · tokens in {u.get('prompt_tokens', '?')} out {u.get('completion_tokens', '?')}")
                break
            except urllib.error.HTTPError as e:
                msg = e.read().decode(errors="replace")[:200]; log(f"  screen batch failed: HTTP {e.code} {msg}")
                if e.code == 429 and attempt < 2: time.sleep(65); continue           # per-minute rate limit: wait it out
                if e.code < 500: return out                                          # daily cap or bad request: keep what we have
                break
            except Exception as e:
                log(f"  screen batch failed: {e}"); break
    return out

def screen(items, params, dry):
    if dry: return {}
    if MODEL.lower() in ("none", "keywords", "off"): return screen_keywords(items)
    if MODEL.startswith("github:"):
        key = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
        if not key: log("  no GITHUB_TOKEN — falling back to keyword mode"); return screen_keywords(items)
        return screen_openai_compatible(items, params, "https://models.github.ai/inference/chat/completions", key, MODEL.split(":", 1)[1])
    if MODEL.startswith("openai:"):
        ep, key = os.environ.get("WATCH_ENDPOINT"), os.environ.get("WATCH_API_KEY")
        if not (ep and key): log("  WATCH_ENDPOINT/WATCH_API_KEY missing — falling back to keyword mode"); return screen_keywords(items)
        return screen_openai_compatible(items, params, ep, key, MODEL.split(":", 1)[1])
    import anthropic
    client = anthropic.Anthropic()
    out = {}
    for i in range(0, len(items), 20):
        batch = items[i:i + 20]
        payload = [{"id": it["id"], "source": it["source"], "date": it["date"], "category_hint": it["category_hint"], "region_hint": it["region_hint"],
                    "title": it["title"], "text": it["text"][:900]} for it in batch]
        try:
            resp = client.messages.create(model=MODEL, max_tokens=8000, system=system_prompt(params),
                messages=[{"role": "user", "content": "Screen these items:\n" + json.dumps(payload, ensure_ascii=False)}],
                output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}})
            if resp.stop_reason == "refusal": log("  screen: refusal"); continue
            text = next(b.text for b in resp.content if b.type == "text")
            for r in json.loads(text)["items"]: out[r["id"]] = r
            u = resp.usage; log(f"  screened {len(batch)} · tokens in {u.input_tokens} out {u.output_tokens}")
        except anthropic.APIStatusError as e:
            log(f"  screen batch failed: {e.status_code} {e.message}")
            if e.status_code < 500: raise
        except anthropic.APIConnectionError as e:
            log(f"  screen batch failed: connection {e}")
    return out

# ------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--dry-run", action="store_true"); ap.add_argument("--since", help="YYYY-MM-DD (default: lookback window)")
    a = ap.parse_args()
    STATE.mkdir(parents=True, exist_ok=True); ARCHIVE.mkdir(exist_ok=True)
    today = date.today(); since = a.since or (today - timedelta(days=LOOKBACK_DAYS)).isoformat()
    sources = yaml.safe_load((ROOT / "watch/sources.yaml").read_text())
    params = json.loads((DATA / "parameters.json").read_text())
    seen = json.loads((STATE / "seen.json").read_text()) if (STATE / "seen.json").exists() else {}

    log(f"collect since {since}"); raw = collect(sources, since)
    new = [it for it in raw if it["id"] not in seen and it.get("title")]
    kept = [it for it in new if PREFILTER.search(it["title"] + " " + it["text"])]
    log(f"{len(raw)} collected · {len(new)} unseen · {len(kept)} pass prefilter · cap {MAX_ITEMS}")
    kept = sorted(kept, key=lambda x: x.get("date") or "", reverse=True)[:MAX_ITEMS]
    if a.dry_run:
        for it in kept[:40]: log(f"   [{it['category_hint']:11s}] {it['date']} {it['title'][:90]}  ← {it['source']}")
        return 0

    verdicts = screen(kept, params, a.dry_run)
    feed_path = DATA / "watch.json"
    feed = json.loads(feed_path.read_text()) if feed_path.exists() else []
    feed = [r for r in feed if not str(r.get("date", "")).startswith("[")]        # drop Design placeholders
    added = []
    for it in kept:
        v = verdicts.get(it["id"])
        if not v: continue                                                       # batch failed: leave unseen, retry tomorrow
        seen[it["id"]] = today.isoformat()
        if not v["relevant"] or v["relevance"] < 0.35: continue
        added.append({"id": "w-" + it["id"], "date": it["date"] or today.isoformat(), "category": v["category"] if v["category"] in CATS else it["category_hint"],
                      "region": v["region"] or it["region_hint"], "title": v["title"] or it["title"], "summary": v["summary"], "source": it["source"],
                      "url": it["url"] or "", "relevance": round(float(v["relevance"]), 2), "params_touched": [p for p in v["params_touched"] if any(p == q["id"] for q in params)],
                      "screened": today.isoformat(), "model": MODEL if MODEL.lower() not in ("none", "keywords", "off") else "keywords"})
    for it in new:                                                               # prefilter rejects are seen too
        if it["id"] not in seen and it not in kept: seen[it["id"]] = today.isoformat()
    cutoff = (today - timedelta(days=FEED_DAYS)).isoformat()
    by_id = {r["id"]: r for r in feed}; by_id.update({r["id"]: r for r in added})
    feed = sorted([r for r in by_id.values() if str(r.get("date", "")) >= cutoff], key=lambda r: (r.get("date", ""), r.get("relevance", 0)), reverse=True)[:FEED_MAX]
    feed_path.write_text(json.dumps(feed, indent=0, ensure_ascii=False))
    if added:
        ap_ = ARCHIVE / f"{today:%Y-%m}.json"; arch = json.loads(ap_.read_text()) if ap_.exists() else []
        ids = {r["id"] for r in arch}; arch += [r for r in added if r["id"] not in ids]; ap_.write_text(json.dumps(arch, indent=0, ensure_ascii=False))
    keep_from = (today - timedelta(days=180)).isoformat()
    (STATE / "seen.json").write_text(json.dumps({k: v for k, v in seen.items() if v >= keep_from}))
    (STATE / "status.json").write_text(json.dumps({"generated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "since": since, "collected": len(raw),
                                                   "unseen": len(new), "screened": len(kept), "added": len(added), "feed_items": len(feed), "model": MODEL}, indent=1))
    log(f"added {len(added)} · feed {len(feed)} items")
    return 0

if __name__ == "__main__":
    sys.exit(main())
