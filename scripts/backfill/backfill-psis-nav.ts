#!/usr/bin/env tsx
/**
 * One-time backfill: imports historical daily NAV for Prabhu Capital's "Prabhu Systematic
 * Investment Scheme" (PSIS) into `sip-mutual-funds/PSIS.csv`.
 *
 * Prabhu's MAIN corporate site (`www.prabhucapital.com`) has a fully public, unauthenticated
 * endpoint: `GET /adminapi/v1/public/hist-nav?ticker=PSIS`. No headers/auth needed.
 *
 * Response shape: `{data: {dailyNavData: [[date_ad, nav, schemeName, note], ...], weeklyNavData,
 * monthlyNavData}}`, `dailyNavData` already covers the fund's full history in one call, no
 * pagination needed.
 *
 * Run with: npx tsx scripts/backfill/backfill-psis-nav.ts
 */

import { join } from 'node:path';
import { appendRows } from '../lib/csv-store';

const API_URL = 'https://www.prabhucapital.com/adminapi/v1/public/hist-nav?ticker=PSIS';
const OUTPUT_FILE = join(process.cwd(), 'data', 'sip-mutual-funds', 'PSIS.csv');
const HEADER = ['published_date', 'nav'];

type PsisRow = [string, number, string, string];
type PsisResponse = { data: { dailyNavData: PsisRow[] } };

async function main() {
  const response = await fetch(API_URL, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NepalMarketDataBackfill/1.0)' } });
  if (!response.ok) throw new Error(`HTTP error fetching PSIS NAV: ${response.status}`);

  const json: PsisResponse = await response.json();
  console.log(`Fetched ${json.data.dailyNavData.length} row(s) from prabhucapital.com.`);

  const rows = json.data.dailyNavData
    .filter(([, nav]) => !isNaN(nav) && nav > 0)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dateStr, nav]) => ({ published_date: dateStr, nav }));

  const { added: inserted } = appendRows(OUTPUT_FILE, HEADER, rows);
  console.log(`\nPSIS: inserted ${inserted} row(s).`);
}

main().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});
