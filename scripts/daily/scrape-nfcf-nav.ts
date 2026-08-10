#!/usr/bin/env tsx
/**
 * Daily scraper: fetches the latest NAV for Nabil Investment Banking's "Nabil Flexi Cap Fund"
 * (NFCF) from Nabil's unprotected investor-portal API, `napi.nabilinvest.com.np/api/schemes/1`
 * (id 1 = NFCF on this API, a different numbering scheme than the WP site's `scheme_id=5` used for
 * historical backfill). This API exposes the current NAV but no history, which is why the backfill
 * uses the WP endpoint instead. See backfill-nfcf-nav.ts and scripts/lib/nabil-wp-nav.ts.
 *
 * Run with: npx tsx scripts/daily/scrape-nfcf-nav.ts
 */

import { join } from 'node:path';
import { writeDailyRow } from '../lib/csv-store';
import { nepalDateFromInstant, todayInNepal } from '../lib/nepal-time';

const SCHEME_API_ID = 1;
const API_URL = `https://napi.nabilinvest.com.np/api/schemes/${SCHEME_API_ID}`;
const OUTPUT_FILE = join(process.cwd(), 'data', 'sip-mutual-funds', 'NFCF.csv');
const HEADER = ['published_date', 'nav'];

type NabilSchemeResponse = { latestNav?: { nav: number; from: string } };

async function main() {
  const today = todayInNepal();
  await writeDailyRow(OUTPUT_FILE, HEADER, today, 'NFCF', async () => {
    const response = await fetch(API_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!response.ok) throw new Error(`HTTP error fetching NFCF NAV: ${response.status}`);

    const json: NabilSchemeResponse = await response.json();
    if (!json.latestNav) return null;

    // `from` is an instant sitting on Nepal midnight of the NAV's effective date, so it has to be
    // shifted into Nepal before the date part is taken (slicing the raw UTC string reads a day
    // early). Verified against the WP endpoint the backfill uses: `from` 2026-08-08T18:15:00Z lines
    // up with `eng_date` 2026-08-09, while the sibling `localCreatedAt` is a day later still (that
    // field is when the row was posted, not the day the NAV applies to).
    const { nav, from } = json.latestNav;
    return !isNaN(nav) && nav > 0 ? { published_date: nepalDateFromInstant(from), nav } : null;
  });
}

main().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});
