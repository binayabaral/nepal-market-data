#!/usr/bin/env tsx
/**
 * Daily scraper: fetches recent NAV for NIC Asia Capital's "NIC Asia Equity Linked
 * Investment Scheme" (internally NICAES at the source, published here as NICAELIS) via the
 * shared nicasiacapital.com fetcher (scripts/lib/nic-asia-nav.ts). Same AMC/page as NADDF,
 * different `category` id.
 *
 * The newest page of the current year is handed over whole rather than just its first row, so any
 * day an earlier run missed is filled in too.
 *
 * Run with: npx tsx scripts/daily/scrape-nicaelis-nav.ts
 */

import { join } from 'node:path';
import { writeDailyRows } from '../lib/csv-store';
import { todayInNepal } from '../lib/nepal-time';
import { fetchNicAsiaPage } from '../lib/nic-asia-nav';

const CATEGORY_ID = 11;
const OUTPUT_FILE = join(process.cwd(), 'data', 'sip-mutual-funds', 'NICAELIS.csv');
const HEADER = ['published_date', 'nav'];

async function main() {
  await writeDailyRows(OUTPUT_FILE, HEADER, 'NICAELIS', async () => {
    // Nepal's year, not the runner's: see scrape-naddf-nav.ts for why UTC is wrong here.
    const year = Number(todayInNepal().slice(0, 4));
    const rows = await fetchNicAsiaPage(CATEGORY_ID, year, 1);
    return rows.map(row => ({ published_date: row.publishedDate, nav: row.nav }));
  });
}

main().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});
