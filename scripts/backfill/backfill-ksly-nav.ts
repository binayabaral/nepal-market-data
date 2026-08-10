#!/usr/bin/env tsx
/**
 * One-time backfill: imports historical daily NAV for Kumari Capital's "Kumari Sunaulo Lagani
 * Yojana" (KSLY) into `sip-mutual-funds/KSLY.csv`.
 *
 * Kumari's SIP subscription portal (`mutualfund.kumaricapital.com`) has every NAV/history
 * endpoint 401-gated behind a login (see scrape-ksly-nav.ts, which uses that portal's one
 * public `/navs/latest` endpoint instead). Kumari's MAIN corporate site (`kumaricapital.com`, a
 * completely separate app) has its own NAV Details page backed by a fully public,
 * unauthenticated Directus API: `GET https://api-web.kumaricapital.com/items/navs?filter=
 * {"scheme":{"_eq":1},"frequency":{"_eq":"daily"}}&sort=-date_ad&limit=-1` (KSLY is `scheme=1`
 * on this API; `limit=-1` returns every row in one call, no pagination needed).
 *
 * Run with: npx tsx scripts/backfill/backfill-ksly-nav.ts
 */

import { join } from 'node:path';
import { appendRows } from '../lib/csv-store';

const SCHEME_ID = 1;
const API_URL = 'https://api-web.kumaricapital.com/items/navs';
const OUTPUT_FILE = join(process.cwd(), 'data', 'sip-mutual-funds', 'KSLY.csv');
const HEADER = ['published_date', 'nav'];

type KumariNavRow = { date_ad: string; value: string };

async function main() {
  const filter = JSON.stringify({ scheme: { _eq: SCHEME_ID }, frequency: { _eq: 'daily' } });
  const response = await fetch(`${API_URL}?filter=${encodeURIComponent(filter)}&sort=-date_ad&limit=-1`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NepalMarketDataBackfill/1.0)' }
  });
  if (!response.ok) throw new Error(`HTTP error fetching KSLY NAV: ${response.status}`);

  const json: { data: KumariNavRow[] } = await response.json();
  console.log(`Fetched ${json.data.length} row(s) from api-web.kumaricapital.com.`);

  const rows = json.data
    .filter(row => !isNaN(parseFloat(row.value)) && parseFloat(row.value) > 0)
    .sort((a, b) => a.date_ad.localeCompare(b.date_ad))
    .map(row => ({ published_date: row.date_ad, nav: parseFloat(row.value) }));

  const { added: inserted } = appendRows(OUTPUT_FILE, HEADER, rows);
  console.log(`\nKSLY: inserted ${inserted} row(s).`);
}

main().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});
