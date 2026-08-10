#!/usr/bin/env tsx
/**
 * One-time backfill: imports historical daily NAV for Laxmi Sunrise Capital's "Shubha Laxmi
 * Kosh" (SLK) into `sip-mutual-funds/SLK.csv`.
 *
 * lscapital.com.np's scheme page is a Vue app that fetches data client-side, but the real
 * backing API works from a plain fetch, no auth/bot-protection:
 * `GET /frontapi/en/getMutualFund?schemeId=5&year=<AD year>&type=daily` (SLK is `schemeId=5`).
 * `year` here is Gregorian/AD, unlike Nabil Invest's equivalent endpoint (Bikram Sambat).
 * Response has parallel `date`/`data` arrays for the whole requested year. Confirmed real data
 * starts Feb 2024.
 *
 * The API does NOT validate the `year` param, requesting a future year silently returns a stale
 * cached slice of a past year rather than an empty result, so any row whose date doesn't
 * actually fall within the requested year is discarded rather than trusted at face value.
 *
 * Run with: npx tsx scripts/backfill/backfill-slk-nav.ts
 */

import { join } from 'node:path';
import { appendRows } from '../lib/csv-store';
import { isoDateFromLabel } from '../lib/nepal-time';

const SCHEME_ID = 5;
const API_URL = 'https://lscapital.com.np/frontapi/en/getMutualFund';
const START_YEAR = 2024;
const CURRENT_YEAR = new Date().getUTCFullYear();
const OUTPUT_FILE = join(process.cwd(), 'data', 'sip-mutual-funds', 'SLK.csv');
const HEADER = ['published_date', 'nav'];

type SlkResponse = { date: string[]; data: number[] };

async function fetchYear(year: number): Promise<Array<{ published_date: string; nav: number }>> {
  const response = await fetch(`${API_URL}?schemeId=${SCHEME_ID}&year=${year}&type=daily`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NepalMarketDataBackfill/1.0)' }
  });
  if (!response.ok) throw new Error(`HTTP error fetching SLK NAV for ${year}: ${response.status}`);

  const json: SlkResponse = await response.json();
  if (!json.date || json.date.length === 0) return [];

  // flatMap rather than map+filter so a label that fails to parse is dropped with the type
  // narrowing intact, instead of leaving a nullable date to be asserted away later. The
  // year check discards the stale slice this API returns for an out-of-range year.
  return json.date.flatMap((label, i) => {
    const published_date = isoDateFromLabel(label);
    const nav = json.data[i];
    if (!published_date || typeof nav !== 'number' || nav <= 0) return [];
    if (!published_date.startsWith(`${year}-`)) return [];
    return [{ published_date, nav }];
  });
}

async function main() {
  const allRows: Array<{ published_date: string; nav: number }> = [];
  for (let year = START_YEAR; year <= CURRENT_YEAR; year++) {
    const rows = await fetchYear(year);
    if (rows.length > 0) console.log(`${year}: ${rows.length} row(s)`);
    allRows.push(...rows);
  }

  const sorted = allRows.sort((a, b) => a.published_date.localeCompare(b.published_date));
  const { added: inserted } = appendRows(OUTPUT_FILE, HEADER, sorted);
  console.log(`\nSLK: fetched ${allRows.length} total row(s), inserted ${inserted}.`);
}

main().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});
