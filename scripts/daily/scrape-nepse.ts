#!/usr/bin/env tsx
/**
 * Daily scraper: fetches today's NEPSE stock prices from sharesansar.com's `#headFixed` table
 * plus the NEPSE index from sharesansar's index-history endpoint, appending one row per symbol to
 * `nepse/<SYMBOL>.csv` (and the index to `nepse/NEPSE_INDEX.csv`).
 *
 * The `#headFixed` table has 24 columns (verified against the live page): S.No, Symbol, Conf.,
 * Open, High, Low, Close, LTP, Close-LTP, Close-LTP%, VWAP, Vol, Prev. Close, Turnover, Trans.,
 * Diff, Range, Diff%, Range%, VWAP%, 120 Days, 180 Days, 52 Weeks High, 52 Weeks Low. There is no
 * explicit per-row "status" column on this page, so every row gets the constant `A`. The backfill
 * writes the same constant rather than the source repo's undocumented -1/0/1 codes, so the column
 * holds one vocabulary across both paths.
 *
 * New symbols not yet tracked (first time they appear in the table) get their own CSV file
 * auto-created with the header row.
 *
 * Rows are dated by the trading session the page says it is showing ("As of : YYYY-MM-DD" above the
 * table), never by the day the scraper ran. sharesansar keeps serving the last completed session's
 * table on a holiday and until the current session's numbers post, so stamping the run date would
 * fabricate a trading day that never happened and then block the backfill from ever correcting it.
 * On such a day the date is already on file, dedup no-ops, and the run appends nothing.
 *
 * Run with: npx tsx scripts/daily/scrape-nepse.ts
 */

import * as cheerio from 'cheerio';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { appendRows, symbolToFileName } from '../lib/csv-store';

const SHARESANSAR_URL = 'https://www.sharesansar.com/today-share-price';
const NEPSE_INDEX_URL = 'https://www.sharesansar.com/index-history-data';
const NEPSE_INDEX_ID = 12; // sharesansar's own id for the headline NEPSE Index among its ~18 indices
const NEPSE_INDEX_LOOKBACK_DAYS = 30;
const NEPSE_DIR = join(process.cwd(), 'data', 'nepse');
const HEADER = ['published_date', 'open', 'high', 'low', 'close', 'per_change', 'traded_quantity', 'traded_amount', 'status'];
const STATUS = 'A';

interface StockRow {
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  perChange: number;
  tradedQuantity: number;
  tradedAmount: number;
}

function parseNumber(text: string): number {
  return parseFloat(text.replace(/,/g, ''));
}

/**
 * A numeric cell rendered for the CSV, or an empty field when the page had nothing usable there.
 *
 * A thin scrip can show a dash or a blank for `open`/`high`/`low`/`Vol`/`Turnover`, which
 * `parseNumber` turns into NaN, and `String(NaN)` would put the literal text `NaN` into a numeric
 * column. An empty field is honestly "not published"; `NaN` is a parse error masquerading as data.
 * Only `close` is worth rejecting the whole row over, since without it the row means nothing.
 */
function numericField(value: number): string {
  return Number.isFinite(value) ? String(value) : '';
}

async function scrapeStockRows(): Promise<{ tradingDate: string | null; rows: StockRow[] }> {
  const response = await fetch(SHARESANSAR_URL);
  if (!response.ok) throw new Error(`HTTP error fetching ${SHARESANSAR_URL}: ${response.status}`);

  const html = await response.text();
  const $ = cheerio.load(html);
  const table = $('#headFixed');
  if (table.length === 0) throw new Error('Could not find table with id="headFixed"');

  // The results block is headed by "As of : YYYY-MM-DD", naming the session the table belongs to.
  const tradingDate = $('#todayshareprice_data').text().match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;

  const rows: StockRow[] = [];
  table.find('tbody tr').each((_index, row) => {
    const cells = $(row).find('td');
    if (cells.length < 18) return;

    const symbol = $(cells[1]).find('a').text().trim();
    const open = parseNumber($(cells[3]).text());
    const high = parseNumber($(cells[4]).text());
    const low = parseNumber($(cells[5]).text());
    const close = parseNumber($(cells[6]).text());
    const perChange = parseNumber($(cells[17]).text());
    const tradedQuantity = parseNumber($(cells[11]).text());
    const tradedAmount = parseNumber($(cells[13]).text());

    if (!symbol || isNaN(close) || close <= 0) return;

    rows.push({ symbol, open, high, low, close, perChange, tradedQuantity, tradedAmount });
  });

  return { tradingDate, rows };
}

interface IndexHistoryRow {
  open: string;
  high: string;
  low: string;
  current: string;
  per_change: string;
  turnover: string;
  published_date: string;
}

/**
 * Fetches the NEPSE index's recent SESSION history rather than a live level.
 *
 * The index used to be read off the live-trading page's `.mu-value`, dated by that page's `#dDate`.
 * Two things were wrong with that. `#dDate` is a wall-clock "as of" stamp that ticks during the
 * session (it reads e.g. "2026-08-10 14:17:00" with the market still open), so it is a snapshot
 * time, not a session date: a run before close stamped an intraday level with today's date while
 * the stock rows correctly carried the previous completed session's date, leaving
 * NEPSE_INDEX.csv both inconsistent with every scrip file and holding a level that was never a
 * close. And because `appendRows` dedups on `published_date`, that wrong row could never be
 * corrected afterwards.
 *
 * `index-history-data` is sharesansar's own DataTables backend for its Index History Data page. It
 * is public (no auth, no token), takes `index_id`/`from`/`to`, and returns one row per COMPLETED
 * session with real open/high/low/close, per-change and turnover, keyed by `published_date`. It
 * only ever contains finished sessions, so an intraday level cannot leak in, and the dates it
 * returns are the same session dates the `today-share-price` table reports.
 *
 * A trailing window is requested rather than just the latest row so any session an earlier run
 * missed (a failed run, or a day the index posted later than the stock table) is filled in by the
 * next run: `appendRows` only ever adds dates that aren't on file yet. The window stays well inside
 * the endpoint's 50-row page cap (~22 sessions a month). `draw`/`start`/`length` are required
 * DataTables params; without them the endpoint answers with an empty data array.
 */
async function fetchNepseIndexHistory(): Promise<IndexHistoryRow[]> {
  try {
    const to = new Date();
    const from = new Date(to.getTime() - NEPSE_INDEX_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const params = new URLSearchParams({
      index_id: String(NEPSE_INDEX_ID),
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      draw: '1',
      start: '0',
      length: '50' // the page's own length menu is 10/20/50; anything larger is rejected with an empty data array
    });

    const response = await fetch(`${NEPSE_INDEX_URL}?${params}`, {
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'User-Agent': 'Mozilla/5.0 (compatible; NepalMarketData/1.0)' }
    });
    if (!response.ok) return [];

    const json = (await response.json()) as { data?: IndexHistoryRow[] };
    return json.data ?? [];
  } catch (error) {
    console.warn('Could not fetch NEPSE index history:', error);
    return [];
  }
}

async function main() {
  let tradingDate: string | null = null;
  let rows: StockRow[] = [];
  try {
    ({ tradingDate, rows } = await scrapeStockRows());
  } catch (error) {
    console.warn(`Fetching stock prices failed: ${error instanceof Error ? error.message : error}`);
  }

  if (rows.length === 0) {
    // Nothing is written and nothing is carried forward: a holiday needs no row, and re-running
    // scripts/backfill/backfill-nepse.ts heals a genuine gap with correctly dated history.
    console.warn('No rows scraped from sharesansar.com (holiday or site hiccup), leaving the files as-is.');
  } else if (!tradingDate) {
    console.warn('Scraped rows but found no "As of" trading date on the page, so there is no honest date to file them under; skipping. The page markup may have changed.');
    rows = [];
  }

  let created = 0;
  let appended = 0;
  if (tradingDate) {
    for (const row of rows) {
      const filePath = join(NEPSE_DIR, symbolToFileName(row.symbol));
      const isNewSymbol = !existsSync(filePath);
      const { added } = appendRows(filePath, HEADER, [
        {
          published_date: tradingDate,
          open: numericField(row.open),
          high: numericField(row.high),
          low: numericField(row.low),
          close: numericField(row.close),
          per_change: numericField(row.perChange),
          traded_quantity: numericField(row.tradedQuantity),
          traded_amount: numericField(row.tradedAmount),
          status: STATUS
        }
      ]);
      if (isNewSymbol) created++;
      if (added > 0) appended++;
    }
  }

  if (rows.length > 0) {
    console.log(`Scraped ${rows.length} symbol(s) for ${tradingDate}, appended ${appended} row(s), auto-created ${created} new symbol file(s).`);
  }

  const indexHistory = await fetchNepseIndexHistory();
  if (indexHistory.length === 0) {
    console.warn('NEPSE index: no session rows returned by index-history-data; the endpoint or its params may have changed.');
    return;
  }

  // Every row here is a completed session with its own date, so the whole window is handed to
  // appendRows and only the dates missing from the file are added. Nothing is re-dated to the
  // stock table's session: the two agree because both come from sharesansar's session data.
  const indexRows = indexHistory.map(row => ({
    published_date: row.published_date,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.current,
    per_change: row.per_change,
    traded_quantity: '', // the index has no share count of its own, only the market-wide turnover below
    traded_amount: row.turnover,
    status: STATUS
  }));

  const { added } = appendRows(join(NEPSE_DIR, 'NEPSE_INDEX.csv'), HEADER, indexRows);
  const latest = indexRows[indexRows.length - 1];
  console.log(
    added > 0
      ? `NEPSE index: appended ${added} session(s), latest ${latest?.published_date} at ${latest?.close}`
      : `NEPSE index: all ${indexRows.length} session(s) in the last ${NEPSE_INDEX_LOOKBACK_DAYS} days already on file, nothing to do`
  );
}

main().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});
