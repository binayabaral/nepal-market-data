#!/usr/bin/env tsx
/**
 * One-time backfill: imports historical daily NAV for Garima Capital's "Garima Subarna
 * Yojana" (GSYA) into `sip-mutual-funds/GSYA.csv`.
 *
 * garimacapital.com's full chart series comes from a JSON API: `GET /nav/category-data/{id}`
 * (GSYA is `categoryId=10`). No auth/bot-protection. The response's `charts.daily.xAxis.data`
 * (dates) and `charts.daily.series[0].data` (NAV values) are parallel arrays covering the
 * fund's entire history in one request, no pagination/year-looping needed.
 *
 * Run with: npx tsx scripts/backfill/backfill-gsya-nav.ts
 */

import { join } from 'node:path';
import { appendRows } from '../lib/csv-store';
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
  const response = await fetch(API_URL, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NepalMarketDataBackfill/1.0)' } });
  if (!response.ok) throw new Error(`HTTP error fetching GSYA NAV: ${response.status}`);

  const json: GarimaResponse = await response.json();
  if (!json.success) throw new Error('GSYA NAV API returned success:false');

  const dates = json.charts.daily.xAxis.data;
  const navs = json.charts.daily.series[0]?.data;
  if (!navs) throw new Error('GSYA NAV API returned no daily series');
  console.log(`Fetched ${dates.length} daily NAV point(s) from garimacapital.com.`);

  // flatMap rather than map+filter so a label that fails to parse is dropped with the type
  // narrowing intact, instead of leaving a nullable date to be asserted away later.
  const rows = dates
    .flatMap((label, i) => {
      const published_date = isoDateFromLabel(label);
      const nav = navs[i];
      if (!published_date || typeof nav !== 'number' || nav <= 0) return [];
      return [{ published_date, nav }];
    })
    .sort((a, b) => a.published_date.localeCompare(b.published_date));

  const { added: inserted } = appendRows(OUTPUT_FILE, HEADER, rows);
  console.log(`\nGSYA: inserted ${inserted} row(s).`);
}

main().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});
