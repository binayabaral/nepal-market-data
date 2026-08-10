#!/usr/bin/env tsx
/**
 * One-time backfill: imports historical NAV for NIC Asia Capital's "NIC Asia Dynamic Debt Fund"
 * (internally NICADF at the source, published here as NADDF) into
 * `sip-mutual-funds/NADDF.csv`, via the shared nicasiacapital.com fetcher
 * (scripts/lib/nic-asia-nav.ts).
 *
 * The fund discloses NAV on nearly every calendar day. It once looked like a sparse discloser
 * publishing ~30 times a year, which was an artifact of the shared fetcher reading only the first
 * page of the site's 30-rows-a-page table. Confirmed real data starts around 2021 AD, so this loops
 * from 2016 (the site's earliest selectable year) and just skips empty years.
 *
 * Run with: npx tsx scripts/backfill/backfill-naddf-nav.ts
 */

import { join } from 'node:path';
import { appendRows } from '../lib/csv-store';
import { fetchNicAsiaYear } from '../lib/nic-asia-nav';

const CATEGORY_ID = 5;
const START_YEAR = 2016;
const CURRENT_YEAR = new Date().getUTCFullYear();
const OUTPUT_FILE = join(process.cwd(), 'data', 'sip-mutual-funds', 'NADDF.csv');
const HEADER = ['published_date', 'nav'];

async function main() {
  const allRows: Array<{ published_date: string; nav: number }> = [];
  for (let year = START_YEAR; year <= CURRENT_YEAR; year++) {
    const rows = await fetchNicAsiaYear(CATEGORY_ID, year);
    if (rows.length > 0) console.log(`${year}: ${rows.length} row(s)`);
    allRows.push(...rows.map(r => ({ published_date: r.publishedDate, nav: r.nav })));
  }

  const sorted = allRows.sort((a, b) => a.published_date.localeCompare(b.published_date));
  const { added: inserted } = appendRows(OUTPUT_FILE, HEADER, sorted);
  console.log(`\nNADDF: fetched ${allRows.length} total row(s), inserted ${inserted}.`);
}

main().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});
