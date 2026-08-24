# Design System Master File

**Project:** Nepal Market Data (public site over this repo's CSVs)
**Generated:** 2026-08-23 via ui-ux-pro-max, then **corrected by hand** — see "Rejected recommendations".
**Stack:** Astro (static) on GitHub Pages. Charts: lightweight-charts (TradingView, Apache 2.0).

This is the Global Source of Truth. A page-specific override in `pages/<page>.md` beats it; otherwise
these rules apply. If you regenerate this file with `--persist --force`, you will reintroduce the
rejected recommendations below, so re-apply the corrections.

---

## Rejected recommendations (do not restore)

The generator's raw output was wrong for this product in four ways. All four were considered and
declined on 2026-08-23:

| It suggested | Why declined |
|---|---|
| Style: **Exaggerated Minimalism** (`clamp(3rem, 10vw, 12rem)`, `font-weight: 900`, "massive whitespace") | Built for fashion and agency landing pages. This site renders 433-row tables and candlestick charts; oversized type actively fights the density this product needs. Replaced with **Data-Dense Dashboard**. |
| Pattern: **Real-Time / Operations Landing** (trial CTA, demo link, conversion funnel) | There is no product to convert to. This is a free public dataset. Only its "hero + key metrics" bones are kept. |
| Palette: `#020617` background, `#0F172A` primary | The brief was to reuse expensesync's theme. Its own accent recommendation (`#22C55E`) turned out to be *exactly* expensesync's dark primary, so the palette below is both on-brand and what the generator wanted anyway. |
| Fonts: **Fira Code / Fira Sans** | A fine data pairing, but expensesync already uses **Geist / Geist Mono**, which serves the same sans-for-prose, mono-for-numbers purpose. Theme consistency was the explicit requirement. |

---

## Global Rules

### Color Palette

Taken verbatim from expensesync's `app/globals.css` (shadcn/ui green theme). Do not re-derive these.

| Token | Light | Dark |
|---|---|---|
| `--background` | `#FFFFFF` | `#0C0A09` |
| `--foreground` | `#09090B` | `#F2F2F2` |
| `--card` | `#FFFFFF` | `#1C1917` |
| `--primary` | `#16A34A` | `#22C55E` |
| `--muted` | `#F4F4F5` | `#262626` |
| `--muted-foreground` | `#71717A` | `#A1A1AA` |
| `--border` | `#E4E4E7` | `#27272A` |
| `--destructive` | `#EF4444` | `#F77373` |
| `--radius` | `0.5rem` | `0.5rem` |

Both modes ship. Light is the default; dark follows `prefers-color-scheme` with an explicit toggle.

### The green rule (important)

**Green is the brand colour AND the "price up" colour.** That was a deliberate choice on 2026-08-23,
for consistency with expensesync, over the alternative of reserving green for data only. It creates a
real ambiguity, contained by two rules that are not optional:

1. **Never place green chrome inside a data region.** No green links, badges or buttons inside the
   movers table, the symbol table, or an OHLC row. Inside data, green means "up" and nothing else.
   Use `--foreground` / `--muted-foreground` for controls that sit among numbers.
2. **Direction is never carried by colour alone.** Candles: bullish **filled**, bearish **hollow**.
   Change values: always prefixed `+` or `−`. This is required for colourblind users regardless of
   the ambiguity, and it is what makes rule 1 survivable.

### Typography

- **Sans (prose, UI):** Geist
- **Mono (all numbers):** Geist Mono
- Every numeric column uses `font-variant-numeric: tabular-nums` so digits align down a column.
- Type scale: 12 / 14 / 16 / 18 / 24 / 32. Body 14px on data pages (dense), 16px on prose pages
  (`/about`). Never below 12px.
- Line-height 1.5 for prose, 1.2 for table rows.

### Spacing Variables

*Density: 8/10 — dense dashboard. Kept from the generator; this part was right.*

| Token | Value | Usage |
|---|---|---|
| `--space-xs` | `2px` | Tight gaps |
| `--space-sm` | `4px` | Icon gaps, inline spacing |
| `--space-md` | `8px` | Standard padding, grid gap |
| `--space-lg` | `12px` | Card padding |
| `--space-xl` | `16px` | Large gaps |
| `--space-2xl` | `24px` | Section margins |
| `--space-3xl` | `32px` | Page top/bottom |

Density specifics from the Data-Dense Dashboard style: `--table-row-height: 36px`,
`--card-padding: 12px`, `--grid-gap: 8px`, sticky table headers, `overflow-x: auto` on every table
wrapper.

### Shadows

Used sparingly; this is a data product, not a marketing page. `--shadow-sm`
(`0 1px 2px rgba(0,0,0,0.05)`) for cards. Nothing heavier. **No hover lift on cards**
(`transform: translateY(-2px)` was in the generated output) — rows and cards containing numbers
should not move under the cursor.

---

## Style Guidelines

**Style:** Data-Dense Dashboard (BI/Analytics). WCAG AA, performance excellent.

Multiple chart/table widgets, KPI cards, minimal padding, 12-column grid, maximum information
density, dense but readable typography.

**Effects:** hover tooltips, row highlighting on hover, chart zoom. Transitions 150-300ms.

### Page Pattern

Hero (NEPSE index chart + latest level) → key metrics (gold, silver, market breadth) → dense
sortable table → footer with data provenance and licence. No CTA funnel; the "conversion" is
someone cloning the repo or reading a symbol page.

---

## Charts

Non-negotiables, from the chart database (candlestick accessibility grade is only **B**, so the
fallbacks matter):

- **Library:** lightweight-charts. Canvas-based, handles the volume, purpose-built for OHLC.
- **Max ~500 candles visible at once.** History runs to 3,484 rows for NABIL and 6,685 index
  sessions, so ship a range selector (1M / 6M / 1Y / 5Y / All) defaulting to a recent window. Never
  render all history at once.
- **Market-wide views filter on `instrument_type = ordinary` AND `status = listed`** (284 of 432
  symbols), never on "has a sector". 10 of those 284 have a blank sector, including Nepal
  Doorsanchar (NTC); the sector test would drop them.
- **Bullish filled, bearish hollow.** Colour alone is not enough.
- **Volume bars beneath at 40% opacity.**
- **An OHLC data table is the required a11y fallback**, not an optional extra: sortable columns plus
  a numeric summary (daily change %). Ship it in v1.
- Candle colours use `--primary` (up) and `--destructive` (down) per the green rule above.

---

## Astro

- **Islands only where interactive.** The chart is the *only* client component
  (`client:visible`). Everything else is static `.astro`. Hydrating the page like an SPA is the
  high-severity anti-pattern here.
- Layout and structure in `.astro`, never a framework component for static markup.

---

## Motion

*Motion dial: 3/10 — subtle.*

Hover and focus transitions 150-300ms, `ease-out`. Row highlight, tooltip fade, chart crosshair.
`prefers-reduced-motion: reduce` honoured everywhere.

**No scroll-reveal choreography.** The generator offered a GSAP ScrollTrigger preset; declined. The
content is data, not narrative, and animating a table of prices into view delays reading it. No GSAP
dependency at all.

---

## Anti-Patterns (do NOT use)

- Emoji as icons. Use SVG (Lucide, matching expensesync).
- Green chrome inside a data region (see the green rule).
- Direction conveyed by colour alone.
- Rendering full price history into one chart.
- Hover lift / movement on rows or cards containing numbers.
- Horizontal page scroll. Tables scroll inside their own wrapper.
- Body text below 12px, or gray-on-gray below 4.5:1.
- Raw hex in components. Use the tokens.

---

## Pre-Delivery Checklist

- [ ] Contrast 4.5:1 in **both** light and dark
- [ ] Focus rings visible and never removed
- [ ] Keyboard navigable, including the range selector and sortable headers
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive at 375 / 768 / 1024 / 1440, no horizontal page scroll
- [ ] Every table wrapped in `overflow-x: auto`
- [ ] Tabular numerals on all numeric columns
- [ ] Candles readable in greyscale (filled vs hollow)
- [ ] OHLC fallback table present on every chart page
- [ ] SVG icons only
- [ ] `cursor-pointer` on clickable elements
