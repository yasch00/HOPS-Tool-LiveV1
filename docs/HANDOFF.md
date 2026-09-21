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
  image-slot.js           <image-slot> placeholder component (index.html suite cards + question visual)
  img/globe-fleet.png     hero globe (screenshot crop of the Atlas)
  img/atlas-globe.png     earlier crop, unused
  data/parameters.json    parameter registry (renders the data page)
  data/watch.json         news feed (renders the watch page)
```

Total weight excluding webfonts: ~24 KB CSS + ~5 KB JS shared across all pages. Keeping it small is a hard requirement — the previous tool build was a 15 MB single file and that is what is being moved away from.

## Design system — do not re-derive it, read `tokens.css`

Register: contemporary research-institute site — confident, colourful, professional. Consultant polish with academic rigour. Not a national-lab PDF, not a SaaS template.

- **Manrope** (single sans) — everything: display 800, headings 700, body 400/500. `--serif` aliases to `--sans`; no serif anywhere.
- **IBM Plex Mono** with `tabular-nums` — every number, unit, date, run ID, axis tick. This rule is load-bearing.
- Colour: cool white `--paper #FFF`, light-blue band `--paper-2 #EEF4F7`, mint band `--mist-green #E9F4EE`, ink `#121A20`, deep-teal dark surfaces `--navy #123542`, anchor teal-blue `#1B6F8E` (buttons, links, active nav), accent green `#1E9A6E` (eyebrows, step rules), warm amber `--accent-2 #D9822B` used sparingly. Okabe–Ito for data series.
- **Colour means data or state in charts. In UI, anchor/accent are the only chromatic colours.**
- Motion: `.orb` drifting radial blobs (26–32 s, blurred) behind heroes; `[data-reveal]` + `.rv` children fade-up with stagger on scroll (site.js IntersectionObserver); globe floats 9 s. All off under `prefers-reduced-motion`.
- Surfaces: pill buttons (`border-radius:999px`), cards `--r-lg 20px` with hairline border + soft shadow, section rhythm white → light-blue → white → mint → deep-teal band → teal gradient CTA.
- Every page opens with `.page-hero` (gradient + 3 orbs + reveal); index.html uses the larger `.hero` variant with the globe and three action pills.
- Charts: inline SVG, no top/right spine, 1px ink left/bottom spines, dashed light y-grid, series labelled in place, large black axis text.

## Components available (class names in `components.css`, demoed in `components.html`)

`nav` · `footer.site` · `.page-hero` + `.orb` · `[data-reveal]`/`.rv` · `.cite` (mono superscript + hover/focus card with source, year, link, badge) · `.badge` (ok/est/todo) · `.stat` + `.unc` (point estimate with named interval) · `.readout` · `.fig-frame`/`figcaption` · `.eq` + `dl.defs` · `.filterbar` + `.chip` · `.ptable` (card-stacks on mobile) · `.fcard` (watch card) · `.skeleton` / `.empty` · `.tcard` · `.toc` · `.note` / `.note.warn` · `.panel` / `.card` · `<image-slot>` (image-slot.js, user-fillable placeholders on index.html)

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
- Home-page suite cards and the question-section visual are `<image-slot>` placeholders — replace with real screenshots (`<img>`) and drop image-slot.js.
- Hero "threshold" claim (~30% below BAU) is from early runs; wire to published output.
