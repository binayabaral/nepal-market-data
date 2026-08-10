#!/usr/bin/env tsx
/**
 * Daily scraper: fetches the latest NAV for Prabhu Capital's "Prabhu Systematic Investment
 * Scheme" (PSIS) from www.prabhucapital.com's public `/adminapi/v1/public/hist-nav` JSON API
 * (no bot-protection). See backfill-psis-nav.ts for full history.
 *
 * Run with: npx tsx scripts/daily/scrape-psis-nav.ts
 */

import { join } from 'node:path';
import { writeDailyRows } from '../lib/csv-store';

const API_URL = 'https://www.prabhucapital.com/adminapi/v1/public/hist-nav?ticker=PSIS';
const OUTPUT_FILE = join(process.cwd(), 'data', 'sip-mutual-funds', 'PSIS.csv');
const HEADER = ['published_date', 'nav'];

type PsisRow = [string, number, string, string];
type PsisResponse = { data: { dailyNavData: PsisRow[] } };

async function main() {
  await writeDailyRows(OUTPUT_FILE, HEADER, 'PSIS', async () => {
    const response = await fetch(API_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!response.ok) throw new Error(`HTTP error fetching PSIS NAV: ${response.status}`);

    const json: PsisResponse = await response.json();
    // The endpoint returns the fund's whole daily series, so all of it is handed over and only the
    // dates missing from the file are appended. This host is the flakiest of the fourteen, so a run
    // that gets through also heals whatever the failed runs before it missed.
    return json.data.dailyNavData.flatMap(([publishedDate, nav]) =>
      !isNaN(nav) && nav > 0 ? [{ published_date: publishedDate, nav }] : []
    );
  });
}

main().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});
