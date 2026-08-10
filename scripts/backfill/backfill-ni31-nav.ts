#!/usr/bin/env tsx
/**
 * One-time backfill: imports historical daily NAV for Nabil Investment's "NI-31" scheme
 * (scheme_id=6 on their own site, published here as NI31) into `sip-mutual-funds/NI31.csv`, via the
 * shared Nabil WordPress fetcher (scripts/lib/nabil-wp-nav.ts), which documents why this endpoint is
 * the only route to NAV history and why it no longer needs a headless browser.
 *
 * Loops BS (Bikram Sambat) years from START_BS_YEAR until a year comes back empty, with the current
 * BS year as the ceiling.
 *
 * Run with: npx tsx scripts/backfill/backfill-ni31-nav.ts
 */

import { join } from 'node:path';
import { appendRows } from '../lib/csv-store';
import { fetchNabilBsYear, type NabilNavRow } from '../lib/nabil-wp-nav';
import { currentBsYear } from '../lib/nepal-time';

const SCHEME_ID = 6;
const REFERER_URL = 'https://nabilinvest.com.np/investment-banking/mutual-funds/ni-31/';
const START_BS_YEAR = 2082; // matches the fund's earliest known NAV data (2025-09-01 ~ BS 2082-05-16)
const OUTPUT_FILE = join(process.cwd(), 'data', 'sip-mutual-funds', 'NI31.csv');
const HEADER = ['published_date', 'nav'];

async function main() {
  const allRows: NabilNavRow[] = [];
  console.log(`Fetching NAV history for scheme_id=${SCHEME_ID} (NI31)...`);
  // Ceiling derived from today's BS year rather than a fixed try count, which would otherwise stop
  // short of the present a few years from now and quietly write nothing new.
  const endBsYear = currentBsYear();
  for (let year = START_BS_YEAR; year <= endBsYear; year++) {
    const rows = await fetchNabilBsYear(SCHEME_ID, REFERER_URL, year);
    console.log(`  BS ${year}: ${rows.length} row(s)`);
    if (rows.length === 0 && year > START_BS_YEAR) break;
    allRows.push(...rows);
  }

  if (allRows.length === 0) {
    console.error('No NAV rows fetched at all, aborting.');
    process.exit(1);
  }

  // Dedupe the freshly-fetched rows by calendar day first (keeping the last occurrence), Nabil's own
  // AJAX endpoint has been observed to return the same date twice within one BS year's response
  // (same data-quality issue seen on a different AMC's API, see backfill-slk-nav.ts).
  const byDay = new Map<string, NabilNavRow>();
  for (const row of allRows) byDay.set(row.published_date, row);

  const rows = Array.from(byDay.values()).sort((a, b) => a.published_date.localeCompare(b.published_date));

  const { added: inserted } = appendRows(OUTPUT_FILE, HEADER, rows);
  console.log(`\nNI31: fetched ${allRows.length} total row(s), inserted ${inserted}.`);
}

main().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});
