# Nepal Market Data: public site design

**Date:** 2026-08-24
**Status:** reviewed and approved 2026-08-24. The three open review questions were answered: a page
for every symbol and reachable from the table, the merged-symbol banner is correct, and 6M stays the
chart default with All available. Nothing is built. Next step: an implementation plan via the
`writing-plans` skill.

**Pages is enabled** (2026-08-24): `build_type: workflow`, serving at
`https://binayabaral.github.io/nepal-market-data/`. Nothing deployed yet, which is why the API
reports `status: null`. This confirms the `base` path below.
**Design system:** `design-system/nepal-market-data/MASTER.md` (tokens, chart rules, anti-patterns)

## Goal

Publish a browsable public site over this repo's CSVs, so the dataset can be explored without
cloning it: search any symbol, chart its history, read gold and NAV trends, download the raw CSV.

Hosted on GitHub Pages from this repo, with a custom domain as a later option.

### Non-goals

Comparison/overlay charts, a search backend, pagination, an API layer, user accounts, a dark-mode
toggle beyond the token switch, and any conversion funnel. This is a reference work, not a product
with a trial.

## Architecture

Astro, static output, living in `site/` inside this repo.

```
nepal-market-data/
  data/                       unchanged, copied into the deploy artifact
  scripts/                    unchanged, plus scripts/site/build-manifest.ts
  site/                       Astro project
  design-system/              MASTER.md, the visual source of truth
  .github/workflows/deploy-site.yml
```

### Why deploy via GitHub Actions rather than deploy-from-branch

Deploy-from-branch serves either the repo root or `/docs`, and nothing else. Choosing `/docs` would
make `data/` unreachable from the site; choosing root would mean committing build output into a
dataset repo. The Actions route uploads an artifact containing **both** the built site and `data/`,
so the CSVs sit on the same origin as the pages while nothing generated is committed.

**Consequence worth stating plainly:** fresh data appears on the site without a rebuild, because the
charts fetch CSVs at runtime. A rebuild only refreshes prerendered numbers and the manifest.

### Base path

`site/astro.config.mjs` reads `base` from an env var, defaulting to `/nepal-market-data/`, which is
the path GitHub reports for this repo's Pages site. Moving to
a custom domain means setting it to `/` in one place. Every internal link and fetch is built from
`import.meta.env.BASE_URL`; no hardcoded absolute paths.

## Data flow

Three shapes, all already stable:

| source | columns |
|---|---|
| `data/nepse/<SYM>.csv` | `published_date,open,high,low,close,per_change,traded_quantity,traded_amount,status` |
| `data/precious-metals/<slug>.csv` | `published_date,price` |
| `data/sip-mutual-funds/<SYM>.csv` | `published_date,nav` |
| `data/reference/nepse-symbols.csv` | `symbol,name,source_category,instrument_type,sector,status` |
| `data/reference/sip-mutual-funds.csv` | `symbol,name,amc` |

### Build step: `scripts/site/build-manifest.ts`

Emits `site/src/data/manifest.json` by reading the CSVs with the existing `readRows` helper. One
entry per symbol:

```
{ symbol, name, kind, instrument_type, sector, status,
  latest_date, latest_close, prev_close, change_pct, rows, first_date }
```

`kind` is `stock | fund | metal | index`. Roughly 450 entries, well under 100KB, and it powers the
landing table, the KPI cards and client-side search. It is a build artifact, not committed.

**Reuse, do not reimplement:** parsing goes through `scripts/lib/csv-store.ts`'s `readRows`, which is
quote-aware and already handles the comma inside `"9% Shangrila Development Bank Debenture, 2087"`.

### Runtime

Symbol pages prerender identity and latest numbers into HTML for SEO. The chart island fetches
`${BASE_URL}data/nepse/<SYM>.csv` on becoming visible and parses it with a small splitter — the
schema is fixed and trivial, so a CSV library is not worth the bytes.

Largest single fetch is `NEPSE_INDEX.csv` at 371KB uncompressed, served gzipped by Pages. Per-scrip
files are far smaller.

## Routes

| route | count | content |
|---|---|---|
| `/` | 1 | NEPSE index chart, gold/silver KPI cards, top movers, full sortable symbol table |
| `/stocks/<SYMBOL>` | 432 | candlestick + volume, range selector, OHLC fallback table, CSV link |
| `/funds/<SYMBOL>` | 14 | NAV line chart, table, CSV link |
| `/metals/<slug>` | 3 | price line chart, table, CSV link |
| `/about` | 1 | what the data is, how to consume it, provenance, licence, freshness per source |

451 pages total. All prerendered.

Reviewed and confirmed 2026-08-24: **every** symbol gets its own page, debentures and promoter shares
included, and every symbol is also reachable from the landing table. The market-wide filter below
governs aggregates such as top movers, not who gets a page.

### The filtering rule every market-wide view must apply

`instrument_type == 'ordinary' && status == 'listed'` → **284** of 432 symbols.

The other 148 are debentures, government bonds, promoter shares, closed-end funds and merged shells,
whose price moves are not comparable to a share's. Top movers, market breadth and any sector chart
must apply this filter.

**Filter on those two columns, never on "has a sector".** 10 of the 284 have a blank `sector` because
the source files them under `Others` or `Non Category`, and they include Nepal Doorsanchar (NTC),
Nepal Reinsurance and Himalayan Reinsurance. A sector test would silently drop Nepal Telecom from the
market view. (This spec's first draft made exactly that mistake.)

The landing table defaults to the 284 with a toggle to reveal the rest, labelled by
`instrument_type`.

## Visual design

Full tokens and rules in `design-system/nepal-market-data/MASTER.md`. The load-bearing points:

- **Palette is expensesync's verbatim** (shadcn green theme): `--primary` `#16A34A` light / `#22C55E`
  dark, `--destructive` `#EF4444` / `#F77373`, `--background` `#FFFFFF` / `#0C0A09`.
- **Green is both brand and "up".** Deliberate, for consistency with expensesync. Contained by two
  non-optional rules: no green chrome inside a data region, and direction never carried by colour
  alone (candles filled/hollow, changes always `+`/`−` prefixed).
- **Geist / Geist Mono**, matching expensesync. All numeric columns `tabular-nums`.
- **Data-Dense Dashboard** style: 36px table rows, 12px card padding, 8px grid gap, sticky headers,
  12-14px body on data pages.
- Style recommendations explicitly rejected, with reasons, are recorded in MASTER.md so they are not
  reintroduced.

## Charts

lightweight-charts (TradingView, Apache 2.0), self-hosted, the only hydrated island
(`client:visible`).

- **Range selector 1M / 6M / 1Y / 5Y / All, defaulting to 6M.** Reviewed 2026-08-24: 6M confirmed as
  the default, and All must stay available.
- **Candles below 1Y, a close-only line at 5Y and All.** Candlestick legibility caps out near 500
  candles while NABIL has 3,484 rows and the index 6,685, so full history cannot be drawn as candles.
  Switching representation keeps All reachable without rendering an unreadable smear. Rejected the
  alternative of downsampling to weekly or monthly candles: more code, and it draws an OHLC bar for a
  period no single session actually traded. The switch is announced in the chart's caption so the
  change in representation is never silent.
- Candles: bullish filled, bearish hollow. Volume beneath at 40% opacity.
- **The OHLC table is the accessibility fallback, not a bonus.** Candlestick charts grade B for
  accessibility; the sortable table plus a numeric change summary is what carries the page for screen
  readers and greyscale. Ships in v1.
- Funds and metals get line charts, not candles: they have one value per day, no OHLC.

## Error and edge handling

| case | behaviour |
|---|---|
| CSV fetch fails | chart area shows an inline message; the prerendered latest numbers and the OHLC table still render, so the page is never blank |
| symbol has very few rows | chart renders what exists; range buttons wider than the history are disabled, not hidden |
| blank `sector` | render `—`, never "Unknown" or a guess |
| blank `amc` (SLK) | omit the line rather than showing an empty label |
| `status == 'merged'` | page renders with a banner saying the company no longer trades and the last session it did; excluded from market-wide views |
| debentures / promoter shares | own pages render normally, excluded from movers and sector views |
| weekend or holiday | no fabricated rows; gaps are real and the about page explains them |

## Testing and verification

No test framework exists in this repo (`package.json` has only `typecheck`), so verification follows
the existing convention rather than inventing one:

1. `pnpm typecheck` clean, including the new manifest script.
2. `astro build` succeeds and emits 451 pages; a build assertion fails the run if the page count does
   not match the manifest.
3. A smoke script asserts: the manifest covers every CSV in `data/`; every symbol page contains a
   chart container and an OHLC table; a sampled page's prerendered latest close equals the last row
   of its CSV.
4. Manual pass against the MASTER.md pre-delivery checklist at 375 / 768 / 1024 / 1440, both themes.
5. Greyscale check that candle direction is still readable.

## Deployment

`.github/workflows/deploy-site.yml`, triggered on push to `main` and manually. Builds the manifest,
builds Astro, assembles an artifact of the built site plus `data/`, deploys to Pages.

Concurrency: its own group, `deploy-site`, with `cancel-in-progress: true`. It must NOT join
`commit-data`: that group exists to serialise workflows that push to the branch, and this one only
reads. Sharing it would make every deploy queue behind the scrapers for no reason. Cancel-in-progress
is correct here precisely because deploys are idempotent and only the newest matters, which is the
opposite of the scrapers' `cancel-in-progress: false`.

Data commits land 3-4 times a day, so the site rebuilds that often. The build is seconds; the
artifact is ~30MB, dominated by `data/`.

**Manual prerequisite: done.** Pages was enabled by hand on 2026-08-24 with source = GitHub Actions
(`build_type: workflow`). No deploy has run yet.

## Risks

- **30MB artifact per deploy, 3-4 times daily.** Within Pages' limits, but if it becomes a problem
  the fix is to ship compact per-symbol JSON instead of raw CSVs, at the cost of duplicating data.
- **Runtime CSV fetch means the chart needs JS.** Mitigated by the OHLC table being prerendered, so
  the page carries its data without scripts.
- **`sector` vocabulary is the source's, not a standard.** `government_bond` is a known misnomer
  (both rows are bank bonds). Kept verbatim by decision; the site should not present it as
  authoritative taxonomy.
- **451 prerendered pages will grow** as new scrips list. The build is driven off the manifest, so
  this needs no code change, but build time grows linearly.

## Out of scope for v1, likely next

Comparison/overlay charts, sector aggregate charts, a downloadable filtered CSV, sparklines in the
landing table, and an RSS or JSON feed of daily changes.
