#!/usr/bin/env tsx
/**
 * One-time backfill: imports historical daily NAV for Nabil Investment Banking's "Nabil Flexi Cap
 * Fund" (NFCF) into `sip-mutual-funds/NFCF.csv`, via the shared Nabil WordPress fetcher
 * (scripts/lib/nabil-wp-nav.ts), which documents why this endpoint is the only route to NAV history
 * and why it no longer needs a headless browser.
 *
 * NFCF's `scheme_id` here is 5, separate from NI-31's 6 and also separate from the numeric `id` NFCF
 * has on Nabil's OTHER, unprotected investor-portal API used by the daily cron instead.
 *
 * Loops BS (Bikram Sambat) years from NFCF's launch year until a year comes back empty, with the
 * current BS year as the ceiling.
 *
 * Run with: npx tsx scripts/backfill/backfill-nfcf-nav.ts
 */

import { join } from 'node:path';
import { appendRows } from '../lib/csv-store';
import { fetchNabilBsYear, type NabilNavRow } from '../lib/nabil-wp-nav';
import { currentBsYear } from '../lib/nepal-time';

const SCHEME_ID = 5;
const REFERER_URL = 'https://nabilinvest.com.np/investment-banking/mutual-funds/nabil-flexi-cap-fund/';
const START_BS_YEAR = 2079; // NFCF launched 2022-11-09 AD ~ BS 2079
const OUTPUT_FILE = join(process.cwd(), 'data', 'sip-mutual-funds', 'NFCF.csv');
const HEADER = ['published_date', 'nav'];

async function main() {
  const allRows: NabilNavRow[] = [];
  // Ceiling derived from today's BS year rather than a fixed try count, which would otherwise stop
  // short of the present a few years from now and quietly write nothing new.
  const endBsYear = currentBsYear();
  for (let year = START_BS_YEAR; year <= endBsYear; year++) {
    const rows = await fetchNabilBsYear(SCHEME_ID, REFERER_URL, year);
    console.log(`BS ${year}: ${rows.length} row(s)`);
    if (rows.length === 0 && year > START_BS_YEAR) break;
    allRows.push(...rows);
  }

  if (allRows.length === 0) {
    console.error('No NAV rows fetched at all, aborting.');
    process.exit(1);
  }

  // Same duplicate-date quirk as NI-31 on this endpoint, so dedupe by calendar day before appending.
  const byDay = new Map<string, NabilNavRow>();
  for (const row of allRows) byDay.set(row.published_date, row);

  const rows = Array.from(byDay.values()).sort((a, b) => a.published_date.localeCompare(b.published_date));

  const { added: inserted } = appendRows(OUTPUT_FILE, HEADER, rows);
  console.log(`\nNFCF: fetched ${allRows.length} total row(s), inserted ${inserted}.`);
}

main().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});
