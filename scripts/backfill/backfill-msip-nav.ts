#!/usr/bin/env tsx
/**
 * One-time backfill: imports historical daily NAV for Machhapuchchhre Capital's
 * "Machhapuchchhre SIP Yojana" (MSIP) into `sip-mutual-funds/MSIP.csv`.
 *
 * mcl.com.np's `GET /api/v1/public/mutual-funds/{slug}` endpoint's `nav_table` field (a
 * paginated field, `nav_table_meta: {current_page, last_page, per_page, total}`) carries full
 * daily granularity NAV history. No auth/bot-protection.
 *
 * Run with: npx tsx scripts/backfill/backfill-msip-nav.ts
 */

import { join } from 'node:path';
import { appendRows } from '../lib/csv-store';

const SCHEME_SLUG = 'machhapuchchhre-sip-yojana';
const API_URL = `https://mcl.com.np/api/v1/public/mutual-funds/${SCHEME_SLUG}`;
const PER_PAGE = 100;
const OUTPUT_FILE = join(process.cwd(), 'data', 'sip-mutual-funds', 'MSIP.csv');
const HEADER = ['published_date', 'nav'];

type NavTableRow = { value: string; published_date: string };
type MclResponse = {
  data: { scheme: { nav_table: NavTableRow[]; nav_table_meta: { current_page: number; last_page: number } } };
};

async function fetchPage(page: number): Promise<{ rows: Array<{ published_date: string; nav: number }>; lastPage: number }> {
  const response = await fetch(`${API_URL}?type=daily&page=${page}&per_page=${PER_PAGE}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NepalMarketDataBackfill/1.0)' }
  });
  if (!response.ok) throw new Error(`HTTP error fetching MSIP NAV page ${page}: ${response.status}`);

  const json: MclResponse = await response.json();
  const { nav_table, nav_table_meta } = json.data.scheme;

  const rows = nav_table
    .map(row => ({ published_date: row.published_date, nav: parseFloat(row.value) }))
    .filter(row => !isNaN(row.nav) && row.nav > 0);

  return { rows, lastPage: nav_table_meta.last_page };
}

async function main() {
  const allRows: Array<{ published_date: string; nav: number }> = [];
  let page = 1;
  let lastPage = 1;
  do {
    const result = await fetchPage(page);
    allRows.push(...result.rows);
    lastPage = result.lastPage;
    console.log(`Page ${page}/${lastPage}: ${result.rows.length} row(s)`);
    page++;
  } while (page <= lastPage);

  const sorted = allRows.sort((a, b) => a.published_date.localeCompare(b.published_date));
  const { added: inserted } = appendRows(OUTPUT_FILE, HEADER, sorted);
  console.log(`\nMSIP: fetched ${allRows.length} total row(s), inserted ${inserted}.`);
}

main().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});
