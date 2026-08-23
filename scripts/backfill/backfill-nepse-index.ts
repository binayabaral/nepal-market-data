#!/usr/bin/env tsx
/**
 * One-time backfill: seeds `data/nepse/NEPSE_INDEX.csv` with the full NEPSE index history from
 * sharesansar's `index-history-data` endpoint, the same public DataTables backend the daily
 * scraper already reads.
 *
 * Why this exists. The daily script asks that endpoint for a trailing 30-day window, which is all
 * it needs to heal a session an earlier run missed. Nothing ever asked for anything older, so the
 * file only ever held about a month: 31 rows starting 2026-07-13, while every scrip file beside it
 * went back years and one back to 1995. That was harmless for correctness, which is why it was
 * left alone, but it makes the index unusable for any chart or comparison over a real time span.
 *
 * How it pages. The endpoint caps a response at 50 rows (`length` above that answers with an empty
 * array) but reports the window's TRUE size in `recordsTotal`, and it honours DataTables' `start`
 * offset with contiguous, non-overlapping, ascending pages. So a year is walked by requesting
 * `start=0,50,100,...` until `recordsTotal` rows have been collected. Truncation keeps the OLDEST
 * rows of a window, so a naive single request per year would have silently kept January to March
 * and dropped the rest of every year.
 *
 * Range. Verified by probing: the endpoint holds nothing before 1997, and the earliest session it
 * serves is 1997-07-20. Years before that return `recordsTotal: 0` rather than an error, so the
 * lower bound is a constant here only to avoid ~30 pointless requests per run.
 *
 * Early rows are thin, and that is faithful rather than broken: 1997 sessions come back with
 * `open`/`high`/`low` all equal to the close and `turnover` of `0.00`, because the source only has
 * the index level for that era. Those values are passed through as the source states them rather
 * than blanked, matching what the daily script writes, since `appendRows` dedups on
 * `published_date` and a row written differently here could never be reconciled with one written
 * by the daily path.
 *
 * Idempotent, like every backfill here: `appendRows` only ever adds dates not already on file, so
 * this is safe to re-run at any time and cannot disturb the rows the daily runs have written.
 *
 * Run with: npx tsx scripts/backfill/backfill-nepse-index.ts
 */

import { join } from 'node:path';
import { appendRows } from '../lib/csv-store';

const INDEX_HISTORY_URL = 'https://www.sharesansar.com/index-history-data';
const NEPSE_INDEX_ID = 12; // sharesansar's own id for the headline NEPSE index among its ~18 indices
const INDEX_FILE = join(process.cwd(), 'data', 'nepse', 'NEPSE_INDEX.csv');
const HEADER = ['published_date', 'open', 'high', 'low', 'close', 'per_change', 'traded_quantity', 'traded_amount', 'status'];
const STATUS = 'A';

/** The endpoint's hard response cap: `length` above this answers with an empty data array. */
const PAGE_SIZE = 50;

/** Earliest year the endpoint holds anything for; its first session is 1997-07-20. */
const EARLIEST_YEAR = 1997;

/**
 * A year of trading is at most ~250 sessions, so 5 pages covers a real year and 20 is an order of
 * magnitude of headroom. The bound exists so a change to `recordsTotal` cannot turn the loop into
 * an unbounded crawl of sharesansar.
 */
const MAX_PAGES_PER_YEAR = 20;

const PACING_MS = 250;
const MAX_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface IndexHistoryRow {
  open: string;
  high: string;
  low: string;
  current: string;
  per_change: string;
  turnover: string;
  published_date: string;
}

/** A numeric cell the source could not express as a number becomes an empty field, never text. */
function numericField(value: string | undefined): string {
  const trimmed = (value ?? '').trim();
  return trimmed !== '' && Number.isFinite(Number(trimmed)) ? trimmed : '';
}

/** One page of a window, plus the window's true total so the caller knows when to stop. */
async function fetchPage(
  from: string,
  to: string,
  start: number
): Promise<{ rows: IndexHistoryRow[]; total: number }> {
  const params = new URLSearchParams({
    index_id: String(NEPSE_INDEX_ID),
    from,
    to,
    draw: '1',
    start: String(start),
    length: String(PAGE_SIZE)
  });

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(`${INDEX_HISTORY_URL}?${params}`, {
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'User-Agent': 'Mozilla/5.0 (compatible; NepalMarketData/1.0)'
        }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const json = (await response.json()) as { data?: IndexHistoryRow[]; recordsTotal?: number };
      return { rows: json.data ?? [], total: json.recordsTotal ?? 0 };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === MAX_ATTEMPTS) {
        throw new Error(`${from}..${to} start=${start} failed after ${MAX_ATTEMPTS} attempts: ${message}`);
      }
      const wait = PACING_MS * 4 * attempt;
      console.warn(`  ${from}..${to} start=${start}: ${message}; retrying in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
  return { rows: [], total: 0 }; // unreachable, the loop either returns or throws
}

/** Every session the endpoint holds for one calendar year, walking `start` offsets. */
async function fetchYear(year: number): Promise<IndexHistoryRow[]> {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;

  const collected: IndexHistoryRow[] = [];
  for (let page = 0; page < MAX_PAGES_PER_YEAR; page++) {
    await sleep(PACING_MS);
    const { rows, total } = await fetchPage(from, to, page * PAGE_SIZE);
    if (rows.length === 0) break;

    // Defensive: the window is explicit in the query, but a param change that made it be ignored
    // would otherwise fold another year's sessions into this one's count and stop the loop early.
    collected.push(...rows.filter(row => (row.published_date ?? '').startsWith(`${year}-`)));
    if (collected.length >= total) break;
  }
  return collected;
}

async function main() {
  const currentYear = new Date().getUTCFullYear();
  console.log(`Backfilling NEPSE index history, ${EARLIEST_YEAR} to ${currentYear}.`);

  let totalAdded = 0;
  let totalFetched = 0;

  for (let year = EARLIEST_YEAR; year <= currentYear; year++) {
    const rows = await fetchYear(year);
    if (rows.length === 0) {
      console.log(`${year}: the endpoint holds no sessions.`);
      continue;
    }

    const mapped = rows.map(row => ({
      published_date: row.published_date,
      open: numericField(row.open),
      high: numericField(row.high),
      low: numericField(row.low),
      close: numericField(row.current),
      per_change: numericField(row.per_change),
      traded_quantity: '', // an index has no share count of its own, only the market-wide turnover
      traded_amount: numericField(row.turnover),
      status: STATUS
    }));

    // A session with no index level is not a session; without `close` the row means nothing.
    const usable = mapped.filter(row => row.close !== '');
    const { added, skippedInvalid } = appendRows(INDEX_FILE, HEADER, usable);
    if (skippedInvalid > 0) {
      console.warn(`${year}: ${skippedInvalid} row(s) carried an unusable date and were not filed.`);
    }
    console.log(
      `${year}: fetched ${usable.length} session(s), added ${added}.` +
        (usable.length < rows.length ? ` ${rows.length - usable.length} had no index level.` : '')
    );
    totalAdded += added;
    totalFetched += usable.length;
  }

  console.log(`\nDone. Added ${totalAdded} new session(s) from ${totalFetched} fetched.`);
}

main().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});
