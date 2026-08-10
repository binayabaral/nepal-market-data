#!/usr/bin/env tsx
/**
 * One-time backfill: imports historical NAV for NIC Asia Capital's "NIC Asia Equity Linked
 * Investment Scheme" (internally NICAES at the source, published here as NICAELIS) into
 * `sip-mutual-funds/NICAELIS.csv`, via the shared nicasiacapital.com fetcher
 * (scripts/lib/nic-asia-nav.ts). Same AMC/page as NADDF, different `category` id.
 *
 * Confirmed real data starts 2025 AD (a young fund), loops from 2016 (the site's earliest
 * selectable year) and just skips empty years. Like NADDF this fund publishes on nearly every
 * calendar day; the sparse-looking history it used to produce was a pagination artifact in the
 * shared fetcher, not the AMC's disclosure schedule.
 *
 * Run with: npx tsx scripts/backfill/backfill-nicaelis-nav.ts
 */

import { join } from 'node:path';
import { appendRows } from '../lib/csv-store';
import { fetchNicAsiaYear } from '../lib/nic-asia-nav';

const CATEGORY_ID = 11;
const START_YEAR = 2016;
const CURRENT_YEAR = new Date().getUTCFullYear();
const OUTPUT_FILE = join(process.cwd(), 'data', 'sip-mutual-funds', 'NICAELIS.csv');
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
  console.log(`\nNICAELIS: fetched ${allRows.length} total row(s), inserted ${inserted}.`);
}

main().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});
