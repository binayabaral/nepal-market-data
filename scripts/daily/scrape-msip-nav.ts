#!/usr/bin/env tsx
/**
 * Daily scraper: fetches the latest NAV for Machhapuchchhre Capital's "Machhapuchchhre SIP
 * Yojana" (MSIP) from mcl.com.np's `GET /api/v1/public/mutual-funds/ticker` (no bot-protection,
 * returns every scheme's latest NAV in one call). See backfill-msip-nav.ts for full history.
 *
 * Run with: npx tsx scripts/daily/scrape-msip-nav.ts
 */

import { join } from 'node:path';
import { writeDailyRow } from '../lib/csv-store';
import { todayInNepal } from '../lib/nepal-time';

const SCHEME_SLUG = 'machhapuchchhre-sip-yojana';
const API_URL = 'https://mcl.com.np/api/v1/public/mutual-funds/ticker';
const OUTPUT_FILE = join(process.cwd(), 'data', 'sip-mutual-funds', 'MSIP.csv');
const HEADER = ['published_date', 'nav'];

type TickerResponse = { data: Array<{ slug: string; nav: { value: string; date: string } }> };

async function main() {
  const today = todayInNepal();
  await writeDailyRow(OUTPUT_FILE, HEADER, today, 'MSIP', async () => {
    const response = await fetch(API_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!response.ok) throw new Error(`HTTP error fetching MSIP NAV: ${response.status}`);

    const json: TickerResponse = await response.json();
    const scheme = json.data.find(s => s.slug === SCHEME_SLUG);
    if (!scheme) return null;

    const nav = parseFloat(scheme.nav.value);
    // `nav.date` is the NAV's own date, matching `nav_table`'s `published_date` in the backfill.
    return !isNaN(nav) && nav > 0 ? { published_date: scheme.nav.date, nav } : null;
  });
}

main().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});
