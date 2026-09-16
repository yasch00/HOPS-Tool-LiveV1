# Watch pipeline — daily AI screening

No server. A scheduled job writes a static JSON file; the site just reads it. This is what keeps the page weight near zero and costs ~$1–3/month in model calls.

```
GitHub Actions cron (daily 06:00 UTC)
  1 COLLECT   → raw items from source APIs/feeds
  2 DEDUPE    → against seen.json (hash of DOI/URL)
  3 SCREEN    → LLM call: relevant? category? region? 1-sentence readout
  4 WRITE     → data/watch.json (+ archive/YYYY-MM.json), commit
  5 DEPLOY    → Pages rebuild
```

## 1. Collect — free, structured, no scraping

| Category | Source | Access |
|---|---|---|
| Publications | OpenAlex, Crossref, arXiv | REST, no key. Query on concept + keyword, filter `from_publication_date` |
| Preprints | ChemRxiv, SSRN | REST / RSS |
| Policy, EU | EUR-Lex, EU ETS/CBAM pages, ENTSO-E news | RSS + EUR-Lex SPARQL |
| Policy, US | Federal Register API, DOE/EPA newsrooms | REST, no key |
| Projects | IEA Hydrogen Projects Database, company newsrooms, trade press RSS | mostly RSS; the IEA DB is periodic, not daily |
| Cost data | IRENA, IEA, NREL ATB, Lazard releases | RSS + release-page polling |
| Ammonia/gas prices | your chosen market data source | depends on licence — do not redistribute paid series |

Keep the source list in `sources.yaml`, one entry per feed: `id, name, type (rss|rest), url, category_hint, region_hint`. Adding a source must never mean editing code.

## 2. Screen — one LLM call per batch, not per item

Send ~40 candidate items in one prompt, ask for strict JSON out. Two things matter:

**Relevance gate first, summary second.** Ask for `relevant: true|false` plus a reason before any prose, and drop the rest. Recall matters more than precision here — you would rather scan five irrelevant items than miss a project announcement.

**Never let the model supply facts.** It may only classify and compress text it was given, and every item must carry the primary URL it came from. Anything the model would have to know from memory (capacity numbers, dates, prices) stays out of the summary. That is the same rule as the site's no-invented-citations rule.

Output schema — matches `data/watch.json` already wired into the Watch page:

```json
{"id":"","date":"YYYY-MM-DD","category":"publication|project|cost|policy",
 "region":"Global|United States|Europe|Asia|…","title":"","summary":"",
 "source":"","url":"","relevance":0.0,"params_touched":["p-001"]}
```

`params_touched` is the interesting field: when a cost release could update a row on the data page, the item links to that parameter ID, and the data page can show "a newer source exists" against the row. That connection is the thing no other site in this space has.

## 3. Cost and failure

Batch screening of ~150 items/day is a few cents. Budget the job: hard cap items per run, retry once, and on failure commit nothing — the site keeps serving yesterday's JSON and the "Feed generated" stamp shows it is stale. The Watch page already renders a loading skeleton, an empty state, and a "data unavailable" state.

## 4. What I can build here

The schema, the page, the states, the prompt text for the screening call, and `sources.yaml`. The Actions workflow and the API key live in your repo — that part is a 60-line Python script, and I can write it as a file you paste in.
