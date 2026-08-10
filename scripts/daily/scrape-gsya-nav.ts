#!/usr/bin/env tsx
/**
 * Daily scraper: fetches NAV for Garima Capital's "Garima Subarna Yojana" (GSYA) from
 * garimacapital.com's `/nav/category-data/{id}` JSON API (no bot-protection). See
 * backfill-gsya-nav.ts, which reads the same endpoint.
 *
 * The endpoint serves the fund's entire daily series in one response, so the whole thing is handed
 * over and only the missing dates are appended. Keeping one row out of it lost every day the cron
 * did not happen to cover.
 *
 * Run with: npx tsx scripts/daily/scrape-gsya-nav.ts
 */

import { join } from 'node:path';
import { writeDailyRows } from '../lib/csv-store';
import { isoDateFromLabel } from '../lib/nepal-time';

const CATEGORY_ID = 10;
const API_URL = `https://garimacapital.com/nav/category-data/${CATEGORY_ID}`;
const OUTPUT_FILE = join(process.cwd(), 'data', 'sip-mutual-funds', 'GSYA.csv');
const HEADER = ['published_date', 'nav'];

type GarimaResponse = {
  success: boolean;
  charts: { daily: { xAxis: { data: string[] }; series: Array<{ data: number[] }> } };
};

async function main() {
  await writeDailyRows(OUTPUT_FILE, HEADER, 'GSYA', async () => {
    const response = await fetch(API_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!response.ok) throw new Error(`HTTP error fetching GSYA NAV: ${response.status}`);

    const json: GarimaResponse = await response.json();
    if (!json.success) return null;

    // `xAxis.data` holds the dates for `series[0].data`, same parallel arrays the backfill reads.
    const dates = json.charts.daily.xAxis.data;
    const navs = json.charts.daily.series[0]?.data;
    if (!navs) return null;

    // flatMap rather than map+filter so an unparseable label is dropped with the narrowing intact.
    return dates.flatMap((label, i) => {
      const published_date = isoDateFromLabel(label);
      const nav = navs[i];
      if (!published_date || typeof nav !== 'number' || nav <= 0) return [];
      return [{ published_date, nav }];
    });
  });
}

main().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});
