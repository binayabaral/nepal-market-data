#!/usr/bin/env tsx
/**
 * One-time backfill: imports full historical daily OHLC data from the MIT-licensed
 * github.com/Aabishkar2/nepse-data repo (per-symbol CSVs, `data/company-wise/<SYMBOL>.csv`,
 * back to 2011) into `nepse/<SYMBOL>.csv`. That repo's CSV schema,
 * `published_date,open,high,low,close,per_change,traded_quantity,traded_amount,status`, is exactly
 * the schema this repo uses, so prices are copied through rather than recomputed. Two fields are
 * deliberately NOT copied verbatim:
 *
 * - `status`: the source uses `-1`/`0`/`1`, documented nowhere in that repo or anywhere else, while
 *   the daily scraper writes `A` because its page publishes no status at all. Copying the source
 *   codes would leave one column holding two incompatible vocabularies with no way for a consumer
 *   to tell which row came from which path, so every row written here gets the same `A` placeholder
 *   and the undocumented codes are dropped.
 * - numeric fields: the source's first row per symbol has `per_change=nan` (there is no previous
 *   close to compare against), and any `nan`/`-`/blank in a numeric column would otherwise be
 *   written as text into a numeric field. Those become empty fields instead.
 *
 * Backfills every scrip available in the source repo (~372 symbols, listed dynamically via the
 * GitHub Contents API, not hardcoded), matching the market-wide scope the daily scraper covers.
 *
 * Idempotent: dedupes against every existing date already in each symbol's CSV (not just "before
 * the earliest one"), so a broken daily run for a few days and re-running this script heals the
 * gap, not just extends history backwards. Safe to re-run any time.
 *
 * Run with: npx tsx scripts/backfill/backfill-nepse.ts
 */

import { join } from 'node:path';
import { appendRows, symbolToFileName } from '../lib/csv-store';

const RAW_CSV_URL = (symbol: string) =>
  `https://raw.githubusercontent.com/Aabishkar2/nepse-data/main/data/company-wise/${symbol}.csv`;
const REPO_CONTENTS_URL = 'https://api.github.com/repos/Aabishkar2/nepse-data/contents/data/company-wise';
const NEPSE_DIR = join(process.cwd(), 'data', 'nepse');
const HEADER = ['published_date', 'open', 'high', 'low', 'close', 'per_change', 'traded_quantity', 'traded_amount', 'status'];
const NUMERIC_COLUMNS = ['open', 'high', 'low', 'close', 'per_change', 'traded_quantity', 'traded_amount'];
const STATUS = 'A'; // see the header: the source's own -1/0/1 codes are undocumented and deliberately dropped

async function fetchAllRepoSymbols(): Promise<string[]> {
  const response = await fetch(REPO_CONTENTS_URL, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'NepalMarketDataBackfill/1.0' }
  });
  if (!response.ok) throw new Error(`GitHub Contents API error: ${response.status} ${response.statusText}`);
  const entries: Array<{ name: string }> = await response.json();
  return entries.filter(e => e.name.endsWith('.csv')).map(e => e.name.replace(/\.csv$/, ''));
}

/** A source row that has been checked to carry the two fields this script depends on. */
type SourceRow = Record<string, string> & { published_date: string };

/** A numeric cell the source could not express as a number becomes an empty field, never text. */
function numericField(value: string): string {
  const trimmed = value.trim();
  return trimmed !== '' && Number.isFinite(Number(trimmed)) ? trimmed : '';
}

function parseCsv(text: string): SourceRow[] {
  const lines = text.trim().split('\n');
  const header = lines[0]?.split(',') ?? [];

  const rows: SourceRow[] = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cells = line.split(',');
    const row: Record<string, string> = {};
    header.forEach((col, i) => (row[col] = cells[i] ?? ''));
    for (const col of NUMERIC_COLUMNS) row[col] = numericField(row[col] ?? '');
    row.status = STATUS;

    const publishedDate = row.published_date;
    const close = row.close;
    if (publishedDate && close && !isNaN(parseFloat(close)) && parseFloat(close) > 0) {
      rows.push({ ...row, published_date: publishedDate });
    }
  }
  return rows;
}

async function main() {
  console.log('Fetching full scrip list from the source repo...');
  const symbols = await fetchAllRepoSymbols();
  console.log(`Backfilling history for all ${symbols.length} scrip(s) available in the repo.`);

  let totalInserted = 0;
  let totalSkippedSymbols = 0;

  for (const symbol of symbols) {
    const response = await fetch(RAW_CSV_URL(symbol));
    if (!response.ok) {
      console.warn(`No data file for ${symbol} (HTTP ${response.status}), skipping.`);
      totalSkippedSymbols++;
      continue;
    }

    const rows = parseCsv(await response.text());
    const sorted = rows.sort((a, b) => a.published_date.localeCompare(b.published_date));
    const { added: inserted } = appendRows(join(NEPSE_DIR, symbolToFileName(symbol)), HEADER, sorted);
    if (inserted > 0) console.log(`${symbol}: inserted ${inserted} row(s) (of ${rows.length} fetched).`);
    totalInserted += inserted;
  }

  console.log(`\nDone. Inserted ${totalInserted} row(s) total across ${symbols.length - totalSkippedSymbols} symbol(s).`);
  if (totalSkippedSymbols > 0) console.log(`${totalSkippedSymbols} symbol(s) had no matching file in the repo.`);
}

main().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});
