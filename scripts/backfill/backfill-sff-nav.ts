#!/usr/bin/env tsx
/**
 * One-time backfill: imports historical daily NAV for Sanima Capital's "Sanima Flexi Fund"
 * (SFF) into `sip-mutual-funds/SFF.csv`.
 *
 * Sanima's SIP subscription portal (`sip.sanimacapital.com`) has every endpoint except
 * `/navs/latest` 401-gated (see scrape-sff-nav.ts). Sanima's MAIN corporate site
 * (`www.sanimacapital.com`, same `/frontapi/en/` vendor shape as Citizens Capital/Laxmi Sunrise
 * Capital/NMB Capital) has its own fully public, unauthenticated NAV endpoint:
 * `GET /frontapi/en/fund-data?year=all&type=daily&scheme_id=4` (SFF is `scheme_id=4`). Response
 * is parallel `date[]`/`data[]` arrays, Gregorian/AD dates. Confirmed full daily history,
 * 2025-03-09 -> present.
 *
 * The bare domain (no `www`) and a plain fetch with no `Accept`/`Referer` headers both get
 * blocked with a 406 by the site's mod_security rules, so `www.sanimacapital.com` plus an
 * `Accept: application/json` and matching `Referer` header are required.
 *
 * Run with: npx tsx scripts/backfill/backfill-sff-nav.ts
 */

import { join } from 'node:path';
import { appendRows } from '../lib/csv-store';

const SCHEME_ID = 4;
const API_URL = 'https://www.sanimacapital.com/frontapi/en/fund-data';
const REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json',
  Referer: 'https://www.sanimacapital.com/'
};
const OUTPUT_FILE = join(process.cwd(), 'data', 'sip-mutual-funds', 'SFF.csv');
const HEADER = ['published_date', 'nav'];

type SanimaFundDataResponse = { date: string[]; data: number[] };

async function main() {
  const response = await fetch(`${API_URL}?year=all&type=daily&scheme_id=${SCHEME_ID}`, { headers: REQUEST_HEADERS });
  if (!response.ok) throw new Error(`HTTP error fetching SFF NAV: ${response.status}`);

  const json: SanimaFundDataResponse = await response.json();
  console.log(`Fetched ${json.date.length} row(s) from www.sanimacapital.com.`);

  const rows = json.date
    .flatMap((published_date, i) => {
      const nav = json.data[i];
      if (typeof nav !== 'number' || nav <= 0) return [];
      return [{ published_date, nav }];
    })
    .sort((a, b) => a.published_date.localeCompare(b.published_date));

  const { added: inserted } = appendRows(OUTPUT_FILE, HEADER, rows);
  console.log(`\nSFF: inserted ${inserted} row(s).`);
}

main().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});
