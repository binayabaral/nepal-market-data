#!/usr/bin/env tsx
/**
 * Daily scraper: fetches the latest NAV for Kumari Capital's "Kumari Sunaulo Lagani Yojana"
 * (KSLY) from api-mutualfund.kumaricapital.com's one public endpoint, `GET /navs/latest` (every
 * other endpoint on that API is auth-gated). See backfill-ksly-nav.ts, which sources full
 * history from Kumari's separate main-site API instead.
 *
 * Run with: npx tsx scripts/daily/scrape-ksly-nav.ts
 */

import { join } from 'node:path';
import { writeDailyRow } from '../lib/csv-store';
import { todayInNepal } from '../lib/nepal-time';

const API_URL = 'https://api-mutualfund.kumaricapital.com/api/v1/navs/latest';
const OUTPUT_FILE = join(process.cwd(), 'data', 'sip-mutual-funds', 'KSLY.csv');
const HEADER = ['published_date', 'nav'];

type KumariLatestNav = { value: string; date: string };

async function main() {
  const today = todayInNepal();
  await writeDailyRow(OUTPUT_FILE, HEADER, today, 'KSLY', async () => {
    const response = await fetch(API_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!response.ok) throw new Error(`HTTP error fetching KSLY NAV: ${response.status}`);

    const json: KumariLatestNav = await response.json();
    const nav = parseFloat(json.value);
    // `date` is the NAV's own effective date, the same `date_ad` the backfill reads off Kumari's
    // other API, so a daily row and a backfilled row for that day land on the same key.
    return !isNaN(nav) && nav > 0 ? { published_date: json.date, nav } : null;
  });
}

main().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});
