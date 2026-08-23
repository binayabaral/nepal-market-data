#!/usr/bin/env tsx
/**
 * One-time backfill: seeds `data/reference/nepse-symbols.csv`, mapping every tracked NEPSE symbol to
 * its company name, instrument type, industry and listing status.
 *
 * Why this exists. The price files are named by ticker and contain nothing but dates and numbers, so
 * the dataset could tell you what `NABIL` closed at but not that `NABIL` is Nabil Bank Limited, or
 * that it is a commercial bank. That is a real gap for anyone consuming the data, and it is the kind
 * of mapping that is otherwise scattered across web pages rather than published anywhere free.
 *
 * Two sources with very different costs, both in `scripts/lib/nepse-symbols.ts`: names arrive for the
 * whole market in one request, categories take one request per symbol. So this script fetches names
 * first and then visits only the symbols still missing a category, which makes a re-run after an
 * interruption cheap: it picks up exactly where it stopped rather than refetching everything.
 *
 * The source's one "Sector" field conflates industry, instrument type and lifecycle status, so it is
 * stored verbatim as `source_category` and decomposed by `classifyCategory`. See that function and the
 * README for why, and why no industry is guessed for a promoter share.
 *
 * Scope. Only symbols that have a `data/nepse/<SYMBOL>.csv` get a row, so this table joins one-to-one
 * with the price files. The source's list is much larger (~1630 entries including long-delisted
 * instruments) and carrying those would mean reference rows pointing at data that does not exist.
 *
 * Progress is written every `WRITE_EVERY` sectors rather than only at the end, so a network failure
 * partway through a ~430-request run keeps everything already fetched.
 *
 * Run with: npx tsx scripts/backfill/backfill-nepse-symbols.ts
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readRows, symbolToKey, upsertRows } from '../lib/csv-store';
import { classifyCategory, fetchSector, fetchSymbolNames } from '../lib/nepse-symbols';

const NEPSE_DIR = join(process.cwd(), 'data', 'nepse');
const REFERENCE_FILE = join(process.cwd(), 'data', 'reference', 'nepse-symbols.csv');
const HEADER = ['symbol', 'name', 'source_category', 'instrument_type', 'sector', 'status'];

/** Not a real scrip: the market index shares the directory but has no company behind it. */
const NOT_A_COMPANY = new Set(['NEPSE_INDEX']);

const WRITE_EVERY = 25;

/** The symbol keys this repo actually holds price history for. */
function trackedSymbolKeys(): Set<string> {
  const keys = readdirSync(NEPSE_DIR)
    .filter(name => name.endsWith('.csv'))
    .map(name => name.replace(/\.csv$/, ''))
    .filter(key => !NOT_A_COMPANY.has(key));
  return new Set(keys);
}

async function main() {
  const tracked = trackedSymbolKeys();
  console.log(`${tracked.size} tracked symbol(s) in data/nepse.`);

  // Step 1: names for the whole market in a single request, narrowed to what we track.
  const sourceNames = await fetchSymbolNames();
  console.log(`Source lists ${sourceNames.length} symbol(s); matching against tracked files.`);

  // Keyed by the repo's own file-name form, since that is what a consumer joins on. The source symbol
  // is kept alongside because the company URL needs it verbatim, slash and all.
  const sourceByKey = new Map<string, { symbol: string; name: string }>();
  for (const entry of sourceNames) {
    const key = symbolToKey(entry.symbol);
    if (tracked.has(key)) sourceByKey.set(key, entry);
  }

  // Every tracked symbol gets a row, even one the source cannot name yet, so that it is visible here
  // and eligible for the category pass below. See the same note in the daily scraper: keying this off
  // the source's list let a freshly listed scrip fall through with no row at all.
  const nameResult = upsertRows(
    REFERENCE_FILE,
    HEADER,
    'symbol',
    [...tracked].sort().map((key): Record<string, string> => {
      const entry = sourceByKey.get(key);
      return entry ? { symbol: key, name: entry.name } : { symbol: key };
    })
  );
  console.log(`Names: ${nameResult.added} added, ${nameResult.updated} updated, ${sourceByKey.size} matched.`);

  const unmatched = [...tracked].filter(key => !sourceByKey.has(key)).sort();
  if (unmatched.length > 0) {
    console.warn(`${unmatched.length} tracked symbol(s) have no name in the source: ${unmatched.join(', ')}`);
  }

  // Step 2: categories, one request each, only for rows that still lack one.
  const missing = readRows(REFERENCE_FILE).filter(row => row.symbol && !row.source_category);
  console.log(`\n${missing.length} symbol(s) still need a category; fetching one page each.`);

  const pending: Array<Record<string, string>> = [];
  let fetched = 0;
  let absent = 0;

  const flush = () => {
    if (pending.length === 0) return;
    const { updated } = upsertRows(REFERENCE_FILE, HEADER, 'symbol', pending);
    console.log(`  ...wrote ${updated} category(s) (${fetched}/${missing.length} fetched)`);
    pending.length = 0;
  };

  for (const row of missing) {
    const key = row.symbol ?? '';
    // The source's own symbol, needed verbatim for the URL; falls back to the key for anything the
    // name step could not match, which is the best guess available.
    const sourceSymbol = sourceByKey.get(key)?.symbol ?? key;

    let sector: string | null = null;
    try {
      sector = await fetchSector(sourceSymbol);
    } catch (error) {
      console.warn(`  ${key}: ${error instanceof Error ? error.message : error}`);
    }
    fetched++;

    if (sector) {
      const { instrumentType, sector: industry, status } = classifyCategory(sector);
      pending.push({
        symbol: key,
        source_category: sector,
        instrument_type: instrumentType,
        sector: industry,
        status
      });
    } else {
      absent++;
    }
    if (pending.length >= WRITE_EVERY) flush();
  }
  flush();

  const final = readRows(REFERENCE_FILE);
  const withName = final.filter(row => row.name).length;
  const withCategory = final.filter(row => row.source_category).length;
  const withSector = final.filter(row => row.sector).length;
  console.log(
    `\nDone. ${final.length} row(s): ${withName} named, ${withCategory} categorised, ${withSector} with an industry.` +
      (absent > 0 ? ` ${absent} page(s) had no Sector field.` : '')
  );
}

main().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});
