#!/usr/bin/env tsx
/**
 * One-time backfill: imports historical daily NAV for Citizens Capital's "Citizens Sadabahar
 * Yojana" (CSBY) into `sip-mutual-funds/CSBY.csv`.
 *
 * citizenscapital.com.np is a Vue SPA; its real backing API lives at `/frontapi/en/`, no
 * auth/bot-protection. `GET /frontapi/en/getFloorSheet?scheme_id=4&year=<AD year>&month=<MM>`
 * (MM must be zero-padded) returns that whole month's daily NAV rows. Verified that nothing exists
 * before November 2025, so the loop starts there: earlier months are 22 wasted requests against an
 * API that rate-limits by request count.
 *
 * The API enforces a request-count-based rate limit (fails with 422 after ~18-19 requests
 * regardless of spacing, then succeeds again once retried later), so failed requests are retried
 * with growing backoff (5s/15s/30s) rather than a single quick retry. Months that still fail after
 * that are collected, retried once more at the end, and any that remain failed make the script exit
 * non-zero: a rate limit hit mid-run would otherwise leave a truncated file behind a success log.
 *
 * Run with: npx tsx scripts/backfill/backfill-csby-nav.ts
 */

import { join } from 'node:path';
import { appendRows } from '../lib/csv-store';
import { todayInNepal } from '../lib/nepal-time';

const SCHEME_ID = 4;
const API_URL = 'https://citizenscapital.com.np/frontapi/en/getFloorSheet';
const START_YEAR = 2025;
const START_MONTH = 11; // verified: the API holds nothing before 2025-11
const OUTPUT_FILE = join(process.cwd(), 'data', 'sip-mutual-funds', 'CSBY.csv');
const HEADER = ['published_date', 'nav'];

type CsbyRow = { nav_date: string; net_asset_value_per_unit: string };
type NavRow = { published_date: string; nav: number };
type MonthResult = { rows: NavRow[]; failed: boolean };

async function fetchMonth(year: number, month: number): Promise<MonthResult> {
  const monthStr = String(month).padStart(2, '0');
  const url = `${API_URL}?scheme_id=${SCHEME_ID}&year=${year}&month=${monthStr}`;
  const backoffsMs = [5000, 15000, 30000];

  let response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NepalMarketDataBackfill/1.0)' } });
  for (const backoff of backoffsMs) {
    if (response.ok) break;
    await new Promise(resolve => setTimeout(resolve, backoff));
    response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NepalMarketDataBackfill/1.0)' } });
  }
  if (!response.ok) {
    console.warn(`CSBY ${year}-${monthStr}: HTTP ${response.status} after retries.`);
    return { rows: [], failed: true };
  }

  const json: { error: boolean; data: { floorSheetList: CsbyRow[] } } = await response.json();
  if (json.error) return { rows: [], failed: false };

  const rows = json.data.floorSheetList
    .map(row => ({ published_date: row.nav_date, nav: parseFloat(row.net_asset_value_per_unit) }))
    .filter(row => !isNaN(row.nav) && row.nav > 0);
  return { rows, failed: false };
}

/** Every (year, month) pair from the fund's first month through the current Nepal month. */
function monthsToFetch(): Array<[number, number]> {
  const [endYear, endMonth] = todayInNepal().split('-').map(Number) as [number, number, number];
  const months: Array<[number, number]> = [];
  for (let year = START_YEAR, month = START_MONTH; year < endYear || (year === endYear && month <= endMonth); ) {
    months.push([year, month]);
    if (month === 12) {
      year++;
      month = 1;
    } else {
      month++;
    }
  }
  return months;
}

async function main() {
  const allRows: NavRow[] = [];
  const failed: Array<[number, number]> = [];

  for (const [year, month] of monthsToFetch()) {
    const { rows, failed: monthFailed } = await fetchMonth(year, month);
    if (monthFailed) failed.push([year, month]);
    if (rows.length > 0) console.log(`${year}-${String(month).padStart(2, '0')}: ${rows.length} row(s)`);
    allRows.push(...rows);
    await new Promise(resolve => setTimeout(resolve, 2000)); // spacing alone doesn't dodge the rate limit, but keeps request count lower within whatever window it tracks
  }

  // The rate limit clears with time, so a second pass over just the failures usually succeeds.
  const stillFailed: Array<[number, number]> = [];
  if (failed.length > 0) {
    console.log(`\nRetrying ${failed.length} month(s) that failed on the first pass...`);
    for (const [year, month] of failed) {
      const { rows, failed: monthFailed } = await fetchMonth(year, month);
      if (monthFailed) {
        stillFailed.push([year, month]);
      } else if (rows.length > 0) {
        console.log(`${year}-${String(month).padStart(2, '0')}: ${rows.length} row(s) on retry`);
        allRows.push(...rows);
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  const sorted = allRows.sort((a, b) => a.published_date.localeCompare(b.published_date));
  const { added: inserted } = appendRows(OUTPUT_FILE, HEADER, sorted);
  console.log(`\nCSBY: fetched ${allRows.length} total row(s), inserted ${inserted}.`);

  if (stillFailed.length > 0) {
    console.error(
      `CSBY: ${stillFailed.length} month(s) never came back, so this backfill is INCOMPLETE: ${stillFailed
        .map(([year, month]) => `${year}-${String(month).padStart(2, '0')}`)
        .join(', ')}. Re-run to fill them in.`
    );
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});
