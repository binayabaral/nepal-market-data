#!/usr/bin/env tsx
/**
 * Daily scraper: fetches recent NAV for Siddhartha Capital's "Siddhartha Systematic
 * Investment Scheme" (SSIS) from siddharthacapital.com's WordPress AJAX endpoint (no
 * bot-protection). Takes a Bikram Sambat (Nepali calendar) year. See backfill-ssis-nav.ts for
 * full history.
 *
 * The BS year is derived from the current Nepal date rather than hardcoded. A hardcoded year makes
 * this script fail silently and permanently the moment it ends: the endpoint answers
 * `{"success":true,"data":[]}` for a year it has nothing for, so nothing errors and the fund just
 * goes quiet. Both the derived year and the one before it are requested unconditionally, so the two
 * days around Nepali new year (which lands on 13 or 14 April) need no special-casing, and each run
 * hands its whole window over so days an earlier run missed are filled in too.
 *
 * Run with: npx tsx scripts/daily/scrape-ssis-nav.ts
 */

import { join } from 'node:path';
import { writeDailyRows } from '../lib/csv-store';
import { currentBsYear } from '../lib/nepal-time';

const SCHEME_ID = 3;
const AJAX_URL = 'https://www.siddharthacapital.com/wp-admin/admin-ajax.php';
const OUTPUT_FILE = join(process.cwd(), 'data', 'sip-mutual-funds', 'SSIS.csv');
const HEADER = ['published_date', 'nav'];

async function fetchBsYear(bsYear: number): Promise<Array<{ published_date: string; nav: number }>> {
  const response = await fetch(AJAX_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' },
    body: new URLSearchParams({
      action: 'scheme_data_filter',
      scheme_id: String(SCHEME_ID),
      type: 'daily',
      year: String(bsYear),
      month: '',
      order: 'DESC'
    })
  });
  if (!response.ok) throw new Error(`HTTP error fetching SSIS NAV for BS ${bsYear}: ${response.status}`);

  const json: { success: boolean; data: Array<{ nav: string; eng_date: string }> } = await response.json();
  if (!json.success) return [];

  // `eng_date` is the field the backfill writes as `published_date`.
  return json.data
    .map(row => ({ published_date: row.eng_date, nav: parseFloat(row.nav) }))
    .filter(row => !isNaN(row.nav) && row.nav > 0);
}

async function main() {
  await writeDailyRows(OUTPUT_FILE, HEADER, 'SSIS', async () => {
    const bsYear = currentBsYear();
    const [current, previous] = await Promise.all([fetchBsYear(bsYear), fetchBsYear(bsYear - 1)]);
    return [...current, ...previous];
  });
}

main().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});
