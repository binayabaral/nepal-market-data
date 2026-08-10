#!/usr/bin/env tsx
/**
 * Daily scraper: fetches recent NAV for NIMB Ace Capital's "NIBL Sahabhagita Fund"
 * (internally NIBLSAHABHAGITA at the source, published here as NIBLSF), via the shared
 * nimbacecapital.com fetcher (scripts/lib/niblsf-nav.ts), which is also what the backfill uses.
 *
 * A page of 30 rows is requested and appended whole rather than a page of 5 with only its first row
 * kept, so a day no run happened to cover is still filed. See backfill-niblsf-nav.ts for full
 * history.
 *
 * Run with: npx tsx scripts/daily/scrape-niblsf-nav.ts
 */

import { join } from 'node:path';
import { writeDailyRows } from '../lib/csv-store';
import { fetchNiblsfNonce, fetchNiblsfPage } from '../lib/niblsf-nav';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const ENTRIES_PER_PAGE = 30;
const OUTPUT_FILE = join(process.cwd(), 'data', 'sip-mutual-funds', 'NIBLSF.csv');
const HEADER = ['published_date', 'nav'];

async function main() {
  await writeDailyRows(OUTPUT_FILE, HEADER, 'NIBLSF', async () => {
    const nonce = await fetchNiblsfNonce(USER_AGENT);
    const { rows } = await fetchNiblsfPage(nonce, 1, ENTRIES_PER_PAGE, USER_AGENT);
    return rows;
  });
}

main().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});
