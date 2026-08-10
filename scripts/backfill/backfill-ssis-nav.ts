#!/usr/bin/env tsx
/**
 * One-time backfill: imports historical daily NAV for Siddhartha Capital's "Siddhartha
 * Systematic Investment Scheme" (SSIS) into `sip-mutual-funds/SSIS.csv`.
 *
 * siddharthacapital.com publishes NAV via a WordPress AJAX endpoint (`admin-ajax.php`,
 * `action=scheme_data_filter`, `scheme_id=3` for SSIS) with NO bot-protection at all, a plain
 * fetch works directly, no Puppeteer/cookie/session needed. Takes a Bikram Sambat (Nepali
 * calendar) year and returns that whole year's daily NAV rows in one call. Confirmed real data
 * starts BS 2078 (~2021 AD), even though the year dropdown lists earlier years too, so this
 * loops from BS 2074 through the BS year currently running in Nepal and just skips empty ones.
 *
 * Run with: npx tsx scripts/backfill/backfill-ssis-nav.ts
 */

import { join } from 'node:path';
import { appendRows } from '../lib/csv-store';
import { currentBsYear } from '../lib/nepal-time';

const SCHEME_ID = 3;
const AJAX_URL = 'https://www.siddharthacapital.com/wp-admin/admin-ajax.php';
const START_BS_YEAR = 2074;
const OUTPUT_FILE = join(process.cwd(), 'data', 'sip-mutual-funds', 'SSIS.csv');
const HEADER = ['published_date', 'nav'];

type SsisNavRow = { id: string; nav: string; eng_date: string };

async function fetchYear(bsYear: number): Promise<Array<{ published_date: string; nav: number }>> {
  const response = await fetch(AJAX_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0 (compatible; NepalMarketDataBackfill/1.0)' },
    body: new URLSearchParams({ action: 'scheme_data_filter', scheme_id: String(SCHEME_ID), type: 'daily', year: String(bsYear), month: '', order: 'DESC' })
  });
  if (!response.ok) throw new Error(`HTTP error fetching SSIS NAV for BS ${bsYear}: ${response.status}`);

  const json: { success: boolean; data: SsisNavRow[] } = await response.json();
  if (!json.success) return [];

  return json.data
    .map(row => ({ published_date: row.eng_date, nav: parseFloat(row.nav) }))
    .filter(row => !isNaN(row.nav) && row.nav > 0);
}

async function main() {
  const allRows: Array<{ published_date: string; nav: number }> = [];
  // Derived, not a literal: a hardcoded ceiling makes the heal path go dead the year it passes.
  const endBsYear = currentBsYear();
  for (let year = START_BS_YEAR; year <= endBsYear; year++) {
    const rows = await fetchYear(year);
    if (rows.length > 0) console.log(`BS ${year}: ${rows.length} row(s)`);
    allRows.push(...rows);
  }

  const sorted = allRows.sort((a, b) => a.published_date.localeCompare(b.published_date));
  const { added: inserted } = appendRows(OUTPUT_FILE, HEADER, sorted);
  console.log(`\nSSIS: fetched ${allRows.length} total row(s), inserted ${inserted}.`);
}

main().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});
