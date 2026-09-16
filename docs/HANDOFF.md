# Paste-this — HOPS website, continuation brief

Use this when starting a new session (Claude Code in the website repo, or a fresh design chat). Paste the whole thing.

---

## Project

HOPS (Hybrid Optimization of Plant Systems) — a research tool from a Stanford PhD. A mixed-integer optimizer that co-sizes and hourly-dispatches an ammonia plant — renewables, electrolysis, steam methane reforming, carbon capture, air separation, storage, Haber–Bosch — to find the cheapest way to hit any given carbon-intensity target, across ~91 real US and European plants.

Headline result: the **Economic Decarbonization Threshold (EDT)** — the carbon intensity at which a hybrid clean-and-fossil plant becomes cost-competitive with a conventional fossil plant **without subsidies**. Subsidy independence is the hook; lead with it.

Audience, in priority order: industrial-decarbonization researchers and modellers; ammonia producers, developers and their engineering teams; energy investors and project finance; policy analysts (EU ETS/CBAM, US 45V/45Q). Write for someone technical, skeptical and short on time. No hype.

The interactive tool is a separate codebase, live at https://yasch00.github.io/HOPS-Tool-LiveV1/ — this repo is the public site only, and links out to it.

## What already exists

```
hops-site/
  tokens.css              design tokens — the only place values live
  components.css          all reusable components (~19 KB)
  site.js                 nav toggle, scroll reveal, TOC state, HOPS.list() (~5 KB)
  components.html         live reference for every component
  RATIONALE.md            type & colour rationale — read before adding pages
  WATCH-PIPELINE.md       daily AI screening pipeline design
  ARCHITECTURE-notes.md   data structuring, build-a-plant, map/3D stack
  index.html  method.html  results.html  data.html
  watch.html  team.html  about.html
  data/parameters.json    parameter registry (renders the data page)
  data/watch.json         news feed (renders the watch page)
```

Total weight excluding webfonts: ~24 KB CSS + ~5 KB JS shared across all pages. Keeping it small is a hard requirement — the previous tool build was a 15 MB single file and that is what is being moved away from.

## Design system — do not re-derive it, read `tokens.css`

Register: national-lab report or serious data journalism (Our World in Data, IEA), not a SaaS landing page.

- **Newsreader** (serif) — headings, lede, large stat values. Italic used once in the hero, nowhere else.
- **IBM Plex Sans** — body, UI, nav, tables. Body 17px/1.6, measure capped at 66ch.
- **IBM Plex Mono** with `tabular-nums` — **every** number, unit, date, run ID, axis tick and eyebrow label. This rule is load-bearing.
- Colour: warm paper `#FBFAF8`, ink `#15181B`, anchor `#1B3A5C` (interaction only), accent `#A6392A` (~1% of surface — citation markers, active nav, stat rule), Okabe–Ito data series `#0072B2 #D55E00 #009E73 #CC79A7 #E69F00 #56B4E9`, separate status colours.
- **Colour means data or state. If it means neither, it is a neutral.**
- Charts: inline SVG, no top/right spine, 1px ink left/bottom spines, dashed light y-grid only, series labelled in place, no chartjunk, no gradients.
- Radii 2–6px, hairline rules instead of shadows, generous whitespace.

## Components available (class names in `components.css`, demoed in `components.html`)

`nav` · `footer.site` · `.cite` (mono superscript + hover/focus card with source, year, link, badge) · `.badge` (ok/est/todo) · `.stat` + `.unc` (point estimate with named interval) · `.readout` · `.fig-frame`/`figcaption` · `.eq` + `dl.defs` · `.filterbar` + `.chip` · `.ptable` (card-stacks on mobile) · `.fcard` (watch card) · `.skeleton` / `.empty` · `.tcard` · `.toc` · `.note` / `.note.warn` · `.panel` / `.card`

`HOPS.list({url, mount, status, count, render, group, searchText})` in `site.js` drives both the parameter table and the Watch feed: skeleton while fetching, wired search + chips + selects, labelled empty state with clear-filters, and a "data unavailable" fallback.

## Rules that must not be broken

1. **No invented numbers, citations, DOIs or author names, ever.** Use `[VALUE]`, `[AUTHORS]`, `[YYYY]` tokens. Fictional illustrative numbers must be labelled as such.
2. Every number that can carry a source carries one, via `.cite`.
3. Any range or confidence interval names what the interval means — never an unlabelled band.
4. Version and last-updated stamps in the footer and on data pages.
5. Loading and empty states for every async view.
6. No login, no paywall, no newsletter modal, no telemetry.
7. WCAG AA contrast, keyboard navigable, no meaning by hue alone, `prefers-reduced-motion` respected.
8. Fully responsive; the parameter table must stay usable on a phone.
9. Light mode primary; all colour stays in custom properties so dark is a token swap.
10. New values go in `tokens.css`, not inline. Don't add type sizes — compose from the seven that exist.

## Porting to Astro

Each page is plain HTML using shared CSS/JS — lift the markup straight into `.astro` components. `nav`, `footer.site`, `.cite`, `figure`, `.ptable` rows, `.fcard`, `.stat` and the section header are the natural component boundaries. Replace the `fetch` in `HOPS.list` with a content collection and render server-side; the CSS needs no change.

## Open decisions

- **Solve strategy** — precomputed solve grid (instant, offline, limited) vs. server-side solve queue. Changes the build-a-plant UI from a live slider to a submitted form.
- Hero chart is currently a schematic EDT curve; it should be replaced with real model output geometry once a run is published.
- Atlas preview on the home page is a labelled placeholder awaiting a screenshot or embed.
