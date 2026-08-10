#!/usr/bin/env tsx
/**
 * Daily scraper: fetches the latest NAV for Sanima Capital's "Sanima Flexi Fund" (SFF) from
 * apisip.sanimacapital.com's one public endpoint, `GET /navs/latest` (every other endpoint on
 * that API is auth-gated). See backfill-sff-nav.ts, which sources full history from Sanima's
 * separate main-site API instead.
 *
 * Run with: npx tsx scripts/daily/scrape-sff-nav.ts
 */

import { join } from 'node:path';
import { writeDailyRow } from '../lib/csv-store';
import { todayInNepal } from '../lib/nepal-time';

const API_URL = 'https://apisip.sanimacapital.com/api/v1/navs/latest';
const OUTPUT_FILE = join(process.cwd(), 'data', 'sip-mutual-funds', 'SFF.csv');
const HEADER = ['published_date', 'nav'];

type SanimaLatestNav = { value: string; date: string };

async function main() {
  const today = todayInNepal();
  await writeDailyRow(OUTPUT_FILE, HEADER, today, 'SFF', async () => {
    const response = await fetch(API_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!response.ok) throw new Error(`HTTP error fetching SFF NAV: ${response.status}`);

    const json: SanimaLatestNav = await response.json();
    const nav = parseFloat(json.value);
    // `date` is the NAV's own effective date, matching the `date[]` entries the backfill reads.
    return !isNaN(nav) && nav > 0 ? { published_date: json.date, nav } : null;
  });
}

main().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});
