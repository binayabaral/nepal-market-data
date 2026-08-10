#!/usr/bin/env tsx
/**
 * One-time backfill: imports historical daily NAV for NMB Capital's "NMB Saral Bachat Fund - E"
 * (internally NMBSBFE at the source, published here as NMBSBF) into
 * `sip-mutual-funds/NMBSBF.csv`.
 *
 * www.nmbcl.com.np/nav is a Vue SPA; its real backing API uses the same
 * `/frontapi/en/getMutualFund?schemeId&year&type=daily` shape as Laxmi Sunrise Capital's API
 * (see backfill-slk-nav.ts), likely the same vendor platform underneath. No bot-protection.
 * NMBSBFE is `schemeId=4`. `year` is Gregorian/AD. Confirmed real data starts 2021.
 *
 * Run with: npx tsx scripts/backfill/backfill-nmbsbf-nav.ts
 */

import { join } from 'node:path';
import { appendRows } from '../lib/csv-store';
import { isoDateFromLabel } from '../lib/nepal-time';

const SCHEME_ID = 4;
const API_URL = 'https://www.nmbcl.com.np/frontapi/en/getMutualFund';
const START_YEAR = 2021;
const CURRENT_YEAR = new Date().getUTCFullYear();
const OUTPUT_FILE = join(process.cwd(), 'data', 'sip-mutual-funds', 'NMBSBF.csv');
const HEADER = ['published_date', 'nav'];

type NmbResponse = { date: string[]; data: number[] };

async function fetchYear(year: number): Promise<Array<{ published_date: string; nav: number }>> {
  const response = await fetch(`${API_URL}?schemeId=${SCHEME_ID}&year=${year}&type=daily`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NepalMarketDataBackfill/1.0)' }
  });
  if (!response.ok) throw new Error(`HTTP error fetching NMBSBF NAV for ${year}: ${response.status}`);

  const json: NmbResponse = await response.json();
  if (!json.date || json.date.length === 0) return [];

  // flatMap rather than map+filter so a label that fails to parse is dropped with the type
  // narrowing intact, instead of leaving a nullable date to be asserted away later.
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
  console.log(`\nNMBSBF: fetched ${allRows.length} total row(s), inserted ${inserted}.`);
}

main().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});
