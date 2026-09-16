# HOPS — type &amp; colour rationale

Everything lives in `tokens.css`. Change it there and the whole site follows.

## Type

Three faces, three jobs — no face does two.

**Newsreader** (display serif, 300/400/500) carries every heading, the lede, and the large numbers in stat callouts. It's a screen-first text serif with a real optical-size axis, so it holds up at 66px in the hero and at 21px in an `h3` without looking like two different fonts. The register is publication, not product: closer to a working paper's title page than a landing page. Its italic is used once, deliberately — the emphasised word in the hero headline — and nowhere else.

**IBM Plex Sans** (400/500/600) carries body text, UI, nav, buttons, table cells. It is a neutral grotesque with slightly humanist detailing, which keeps long technical paragraphs readable at 17px without the anonymity of the usual defaults. Body measure is capped at 66ch (`--measure`) and 58ch for tighter columns; line height 1.6.

**IBM Plex Mono** (400/500) carries *every* number and every label. This is the load-bearing rule of the system: if a glyph is a quantity, a unit, a date, a run ID, an axis tick, or a metadata label, it is mono with `font-variant-numeric: tabular-nums`. Consequences worth keeping: figures in a table column align vertically, a `[VALUE]` placeholder is visibly a placeholder, and eyebrow labels (11.5px, 0.13em, uppercase) read as instrumentation rather than as small headings. Plex Sans and Plex Mono share skeletons, so mono numbers sit inside sans prose without a seam.

Scale is fixed in tokens and fluid only where it must be (`--t-display`, `--t-h2` use `clamp`). Don't add sizes; compose from the seven that exist.

## Colour

The palette is deliberately short, and the split is functional rather than decorative:

- **Neutral ramp** (`--paper` → `--ink`, seven steps) does all structural work: page, panels, rules, three text weights. The paper is warm (`#FBFAF8`) and the ink is not pure black (`#15181B`) — on-screen it reads like printed stock and reduces halation on long reads.
- **Anchor, `#1B3A5C`** — deep slate blue. Interactive only: links, primary buttons, focus rings. It never appears in a chart.
- **Accent, `#A6392A`** — brick. Used at roughly 1% of surface area, and only for three things: the citation superscript, the active-nav underline, and the rule on a stat callout. Its scarcity is what makes a citation marker findable on a dense page.
- **Data series** are the Okabe–Ito colourblind-safe set (`--d1`…`--d6`), unchanged from the published palette so figures on the site and figures in the paper can use identical values. Six series is the stated maximum; beyond that, facet rather than add a colour. Series are also distinguished by dash pattern and direct labels, so nothing depends on hue alone.
- **Status** colours (`--ok`, `--warn`, `--todo`) are their own set, kept away from the data ramp so a "Verified" badge can never be misread as a series.

Rule for new pages: **colour means data or state. If it means neither, it is a neutral.** Contrast targets — ink on paper ≈ 15:1, `--ink-2` ≈ 9:1, `--ink-3` on paper ≈ 4.7:1 (use it only at 13px+ for metadata), anchor on paper ≈ 8:1. All pass AA; the first three pass AAA at body size.

## Charts

Authored as inline SVG so they weigh nothing and inherit tokens. House style, matching the publication figures: no top or right spine, left and bottom spines in ink at 1px, y-grid only, dashed 2/4, `--rule-2`; mono tick labels; sans axis labels; series labelled in place rather than in a legend box wherever the layout allows. Reveal-on-scroll is one line-draw (`.draw`) plus one fade (`.fade`), both disabled under `prefers-reduced-motion`.

## Provenance and uncertainty

**Citation** is a mono superscript in accent colour with a hover/focus card (`.cite`). It is keyboard reachable (`tabindex="0"`, shows on `:focus-visible`), holds source, year, link and a status badge, and works identically in prose, in figure captions and in table cells. Any number that can carry a source should carry one.

**Uncertainty** has two forms. In prose, `.pm` renders a mono range next to the point estimate. In a stat callout, `.unc` draws a range bar: the tick is the point estimate, the filled span is the stated interval, and the interval's meaning is always named beneath it ("interquartile range across plants") — never an unlabelled band. In charts, the same idea is a filled band at 14% opacity in the series colour.

## Spacing, radii, shadows

4px base, seven steps (`--s1`…`--s9`). Radii are near-flat (2/4/6px) — this register doesn't round. Two shadows only: `--shadow-1` for hover lift on cards, `--shadow-2` for the citation card. Elevation is otherwise expressed with hairline rules.

## Files

```
hops-site/
  tokens.css        design tokens — the only place values live
  components.css    nav, footer, figure, citation, badge, stat, readout,
                    panel, equation, filter bar, parameter table,
                    watch card, skeleton, empty state, team card, TOC
  site.js           nav toggle, scroll reveal, TOC state, HOPS.list()
  components.html   live reference for every reusable piece
  index.html method.html results.html data.html watch.html team.html about.html
  data/parameters.json  data/watch.json
```

`HOPS.list({url, mount, status, ...})` in `site.js` drives both the parameter table and the Watch feed: it renders a skeleton while fetching, wires search + chips + selects, and falls back to a labelled empty state (with a clear-filters action) or a "data unavailable" state on fetch failure. Porting to Astro: keep the markup, replace the `fetch` with a content collection and render server-side; the CSS needs no change.

Total page weight excluding webfonts: ~24 KB CSS + ~4.5 KB JS, shared across all seven pages.
