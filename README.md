# nepal-market-data

A daily-updated, public, versioned dataset of NEPSE stock prices, gold/silver rates, and Nepali
open-end (SIP) mutual fund NAVs, stored as plain CSV files and updated automatically by GitHub
Actions. MIT licensed, free to use for research, apps, or your own analysis.

## Why this exists

Valuing a Nepali portfolio means knowing what a scrip closed at, what a tola of gold cost, and what
a fund's NAV was on a given day. None of that was available as a free, versioned dataset: the
sources publish today's number and, at best, a paginated history behind a web page.

This repo collects it once, daily, so nobody else has to. Anyone can `git clone` it, `git pull` it
each morning, or just browse the CSVs on GitHub, without writing or running a scraper.

## Folder structure

Two folders: `data/` is the dataset, `scripts/` is the code that maintains it. If you only want the
numbers, you only want `data/`.

```
data/
  nepse/<SYMBOL>.csv          one file per listed scrip, plus NEPSE_INDEX.csv
  precious-metals/            gold-24k.csv, gold-22k.csv, silver.csv
  sip-mutual-funds/<SYMBOL>.csv   one file per fund
scripts/
  daily/                      one script per source, run by GitHub Actions
  backfill/                   one script per source, run by hand to seed history
  lib/                        shared helpers
```

### `data/nepse/`

One CSV per NEPSE-listed stock symbol (e.g. `data/nepse/NABIL.csv`), plus `data/nepse/NEPSE_INDEX.csv` for
the overall NEPSE index level.

```
published_date,open,high,low,close,per_change,traded_quantity,traded_amount,status
```

- `published_date`: `YYYY-MM-DD`, no time component.
- `open`, `high`, `low`, `close`: NPR per share (kitta).
- `per_change`: percent change vs. the previous close.
- `traded_quantity`: shares traded that day.
- `traded_amount`: turnover in NPR.
- `status`: a constant placeholder, always `A`. No source this repo uses publishes a documented
  per-row status, so rather than mixing vocabularies the column is written the same way by both the
  daily scraper and the historical backfill. Do not read meaning into it.

**File names:** the file is named after the symbol, except that a `/` in a symbol becomes a `-`.
Three debentures are named after a fiscal-year span and contain a slash, so `GBILD84/85` is stored
as `GBILD84-85.csv`, `MND84/85` as `MND84-85.csv`, and `NICAD85/86` as `NICAD85-86.csv`. No other
symbol currently needs this.

**A file is not updated on a day its scrip did not trade.** Thinly traded instruments, mostly
debentures and promoter shares, drop out of the exchange's daily table entirely, so their newest row
stays at their last real session while actively traded scrips move on. That is the same
missing-rather-than-repeated rule described under gaps below.

> **Prices are not adjusted for corporate actions.** Bonus shares, rights issues, and stock splits
> all change a scrip's price without any loss of value to the holder, and this dataset records the
> raw traded prices as published. So a series can show a sudden overnight drop of 30%, 50% or more
> that is not a real loss. Computing returns straight off `close` across such an event gives a wrong
> answer. If you need a total-return series, you must obtain the corporate-action history separately
> and adjust the prices yourself. This is the single most common way a raw price dataset misleads
> people, so please do not skip it.

`NEPSE_INDEX.csv` carries the headline NEPSE index with real session `open`/`high`/`low`/`close`
and `per_change`, and market-wide turnover in `traded_amount`. `traded_quantity` is blank, since the
index has no share count of its own. Every index row is a completed session's close, dated to the
same session as the stock rows, never an intraday snapshot.

### `data/precious-metals/`

`gold-24k.csv`, `gold-22k.csv`, `silver.csv`: NPR per tola.

```
published_date,price
```

Gold 22K is derived from Gold 24K using the standard 0.9167 fineness multiplier, not scraped
separately (no source reliably publishes it directly).

### `data/sip-mutual-funds/`

One CSV per open-end (SIP-subscribable) Nepali mutual fund, NAV per unit in NPR.

```
published_date,nav
```

| Symbol | Fund name |
|---|---|
| CSBY | Citizens Sadabahar Yojana |
| GSYA | Garima Subarna Yojana |
| MSIP | Machhapuchchhre SIP Yojana |
| KSLY | Kumari Sunaulo Lagani Yojana |
| NFCF | Nabil Flexi Cap Fund |
| NIBLSF | NIBL Sahabhagita Fund |
| NADDF | NIC Asia Dynamic Debt Fund |
| NICAELIS | NIC Asia Equity Linked Investment Scheme |
| NMBSBF | NMB Saral Bachat Fund - E |
| SFF | Sanima Flexi Fund |
| PSIS | Prabhu Systematic Investment Scheme |
| SLK | Shubha Laxmi Kosh |
| SSIS | Siddhartha Systematic Investment Scheme |
| NI31 | NI 31 (Nabil Invest) |

Closed-end mutual funds that trade on NEPSE like ordinary stocks (e.g. NIBL Growth Fund) are
covered by `data/nepse/`, not here, since their price is set by the exchange rather than an AMC's
published NAV.

## How the data is collected

Three scraper workflows run on a schedule, each fetching directly from public sources
(sharesansar.com, fenegosida.org, and each AMC's own site/API), then committing any changed CSVs
back to this repo. A fourth reconciles history weekly, described under Self-healing below:

| Workflow | Schedule (Nepal Time) | Covers |
|---|---|---|
| `scrape-nepse.yml` | 3:00 PM, Mon-Fri | `data/nepse/*.csv` |
| `scrape-metals.yml` | 11:00 AM, daily | `data/precious-metals/*.csv` |
| `scrape-mutual-funds.yml` | 4:00 PM, daily | `data/sip-mutual-funds/*.csv` |
| `reconcile.yml` | 4:00 AM Mondays, or on demand | all of `data/` |

Only NEPSE is weekday-only, because only the stock market actually closes at weekends. Metals and
mutual funds run all seven days: FENEGOSIDA posts gold rates on Sundays and on roughly half of
Saturdays, and 13 of the 14 funds publish NAV on every calendar day. Since each source posts a day's
value the following day, a weekday-only schedule never even asked for Friday's or Saturday's figure.

No secrets or database credentials are needed; every source is a public, unauthenticated endpoint.

### What `published_date` means, and gaps

`published_date` is always the date the value **applies to**, taken from the source itself, never
the date the scraper happened to run. That matters because most of these sources keep serving the
last published value until the next one lands: sharesansar shows the previous session's table on a
holiday, and a fund that has not published since Friday still answers with Friday's NAV. So a
scheduled run does **not** guarantee a row. If the source's latest value is one already on file,
the run appends nothing and exits 0.

**Consequence for consumers: expect gaps, by design.** Weekends and market holidays in `data/nepse/`,
and any day a fund or the federation simply did not publish, show up as **missing dates rather than
repeated values**. Nothing is carried forward, interpolated, or invented. A gap is not a bug.

A repeated value on *consecutive* dates is different, and deliberately so: it means the source
published that day and the figure had not moved. Keeping the two distinguishable is why nothing is
forward-filled here.

If you want a value "as of" a given day rather than "published on" it, take the most recent row on
or before that day. In pandas:

```python
import pandas as pd

nav = pd.read_csv("data/sip-mutual-funds/SSIS.csv", parse_dates=["published_date"])
nav = nav.set_index("published_date").sort_index()

# every calendar day, carrying the last published NAV forward
daily = nav.reindex(pd.date_range(nav.index.min(), nav.index.max(), freq="D")).ffill()

# or the NAV in effect on one specific date
as_of = nav.asof(pd.Timestamp("2026-08-08"))
```

The last row of a file is therefore the last **published** value, which is not necessarily today's.

### Self-healing

A fourth workflow, `reconcile.yml`, runs **weekly** (Mondays, 04:00 Nepal time) and re-runs every
backfill script. Since backfills only ever add dates that are missing, this recovers anything the
daily runs did not get: a run that failed, a source that was briefly down, and, more often than you
would think, a source that published several earlier days at once **after** the daily run had already
asked for the latest value. It can also be triggered by hand from the Actions tab, for one source or
all of them, if you spot a gap and do not want to wait for Monday.

A reconciliation run that recovers nothing is the normal case. It only reports failure if every
source failed, which would mean the recovery path itself is broken.

Two funds are less reliable than the rest: NFCF and NI31 take their **history** from a host that
intermittently answers with a bot-challenge page or a connect timeout, more often from CI than from
a home connection. Their backfills do take part in reconciliation, and pace and retry themselves,
but either one can still come back FAILED in a given week's run without the run itself failing.
Their daily collection is unaffected (it uses a different, unchallenged endpoint), and a gap in
those two funds' history can always be healed by running their backfill scripts locally.

You can do the same thing locally at any time by re-running the matching backfill script, because
both paths key rows on the same source-supplied date and only missing dates are ever filled in.

## Backfilling / seeding history

The daily workflows only ever append today's row. To seed a file with full historical data (or
heal a gap left by a broken scraper), run the matching backfill script once locally:

Requires **Node.js 22 or newer** and **pnpm** (the repo pins `pnpm@11.14.0` via `packageManager`,
so a recent Corepack-enabled Node will pick the right version automatically).

```bash
pnpm install
pnpm tsx scripts/backfill/backfill-nepse.ts
pnpm tsx scripts/backfill/backfill-metals.ts
pnpm tsx scripts/backfill/backfill-csby-nav.ts
# ...one backfill-<symbol>-nav.ts script per fund in scripts/backfill/
```

The two Nabil scripts (`backfill-nfcf-nav.ts`, `backfill-ni31-nav.ts`) fetch only the last two
Bikram Sambat years by default, since that is where any recent gap can be and their source is the
flakiest one here. Pass `--full` to sweep every year for a complete reseed.

Backfill scripts are idempotent (they dedupe against every date already on file), so re-running one
is always safe, and the order they run in relative to the daily scripts does not matter: every write
goes through one helper that fills in only the dates missing from a file and leaves it sorted
ascending by date.

Type checking is a separate step, since `tsx` strips types without verifying them:

```bash
pnpm typecheck
```

## Attribution

This dataset is compiled from, and would not exist without, these upstream sources:

- [sharesansar.com](https://www.sharesansar.com): daily NEPSE stock prices and index history.
- [Aabishkar2/nepse-data](https://github.com/Aabishkar2/nepse-data): historical NEPSE OHLC data.
- [fenegosida.org](https://fenegosida.org): daily gold/silver rates (Federation of Nepal Gold
  and Silver Dealers' Association).
- [dhirajraut1/gold-prices-nepal](https://github.com/dhirajraut1/gold-prices-nepal): historical
  gold/silver rates.
- [notifynepal.com](https://notifynepal.com): historical gold/silver rates (gap-filling source).
- Each mutual fund's own AMC website/API (Citizens Capital, Garima Capital, Machhapuchchhre
  Capital, Kumari Capital, Nabil Investment Banking, NIMB Ace Capital, NIC Asia Capital, NMB
  Capital, Sanima Capital, Prabhu Capital, Laxmi Sunrise Capital, Siddhartha Capital) for NAV
  data.

## Disclaimer

This is an unofficial, best-effort dataset assembled by automated scraping of public sources. It
is provided as-is, with no guarantee of accuracy, completeness, or timeliness. Do not make
financial or trading decisions based solely on this data, always verify independently against an
official source (NEPSE, the relevant AMC, or FENEGOSIDA) before acting on it.

## License

MIT, see [LICENSE](./LICENSE).
