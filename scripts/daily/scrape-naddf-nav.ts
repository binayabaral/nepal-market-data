#!/usr/bin/env tsx
/**
 * Daily scraper: fetches recent NAV for NIC Asia Capital's "NIC Asia Dynamic Debt Fund"
 * (internally NICADF at the source, published here as NADDF) via the shared
 * nicasiacapital.com fetcher (scripts/lib/nic-asia-nav.ts).
 *
 * The newest page of the current year is handed over whole rather than just its first row, so any
 * day an earlier run missed is filled in too. The fund does publish on days the cron cannot cover
 * on its own: sources here post day D's NAV on D+1, so a run only ever sees yesterday.
 *
 * Run with: npx tsx scripts/daily/scrape-naddf-nav.ts
 */

import { join } from 'node:path';
import { writeDailyRows } from '../lib/csv-store';
import { todayInNepal } from '../lib/nepal-time';
import { fetchNicAsiaPage } from '../lib/nic-asia-nav';

const CATEGORY_ID = 5;
const OUTPUT_FILE = join(process.cwd(), 'data', 'sip-mutual-funds', 'NADDF.csv');
const HEADER = ['published_date', 'nav'];

async function main() {
  await writeDailyRows(OUTPUT_FILE, HEADER, 'NADDF', async () => {
    // Nepal's year, not the runner's: between 00:00 and 05:45 NPT a UTC year is still last year's,
    // which on 1 January would ask for a year whose rows are all filtered out as out of range.
    const year = Number(todayInNepal().slice(0, 4));
    const rows = await fetchNicAsiaPage(CATEGORY_ID, year, 1);
    return rows.map(row => ({ published_date: row.publishedDate, nav: row.nav }));
  });
}

main().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});
