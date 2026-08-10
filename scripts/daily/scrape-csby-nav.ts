#!/usr/bin/env tsx
/**
 * Daily scraper: fetches the current month's NAV rows for Citizens Capital's "Citizens Sadabahar
 * Yojana" (CSBY) from citizenscapital.com.np's `/frontapi/en/` JSON API (no bot-protection),
 * falling back to the previous calendar month if the current month has no rows yet (e.g. run on the
 * 1st, before this month's first NAV has posted). See backfill-csby-nav.ts for full history.
 *
 * The whole month is handed over rather than just its newest row: the source returns it anyway, and
 * appending all of it means a day no run happened to cover is filled in rather than lost forever.
 *
 * Run with: npx tsx scripts/daily/scrape-csby-nav.ts
 */

import { join } from 'node:path';
import { writeDailyRows } from '../lib/csv-store';
import { todayInNepal } from '../lib/nepal-time';

const SCHEME_ID = 4;
const API_URL = 'https://citizenscapital.com.np/frontapi/en/getFloorSheet';
const OUTPUT_FILE = join(process.cwd(), 'data', 'sip-mutual-funds', 'CSBY.csv');
const HEADER = ['published_date', 'nav'];

type CsbyRow = { nav_date: string; net_asset_value_per_unit: string };

/** Same `nav_date` field the backfill keys on, so a daily row and a backfilled row agree. */
async function fetchMonth(year: number, month: number): Promise<Array<{ published_date: string; nav: number }>> {
  const monthStr = String(month).padStart(2, '0');
  const response = await fetch(`${API_URL}?scheme_id=${SCHEME_ID}&year=${year}&month=${monthStr}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  if (!response.ok) throw new Error(`HTTP error fetching CSBY NAV for ${year}-${monthStr}: ${response.status}`);

  const json: { error: boolean; data: { floorSheetList: CsbyRow[] } } = await response.json();
  if (json.error) return [];

  return json.data.floorSheetList
    .map((row: CsbyRow) => ({ published_date: row.nav_date, nav: parseFloat(row.net_asset_value_per_unit) }))
    .filter(row => !isNaN(row.nav) && row.nav > 0);
}

async function main() {
  await writeDailyRows(OUTPUT_FILE, HEADER, 'CSBY', async () => {
    // Nepal's calendar month, not the runner's: between 00:00 and 05:45 NPT a UTC month is still
    // last month's, so on the 1st a manual run would ask for the wrong month.
    const [year, month] = todayInNepal().split('-').map(Number) as [number, number, number];
    const rows = await fetchMonth(year, month);
    if (rows.length > 0) return rows;

    const previous = new Date(Date.UTC(year, month - 2, 1));
    return fetchMonth(previous.getUTCFullYear(), previous.getUTCMonth() + 1);
  });
}

main().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});
