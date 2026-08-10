#!/usr/bin/env tsx
/**
 * Daily scraper: fetches the latest NAV for NMB Capital's "NMB Saral Bachat Fund - E"
 * (internally NMBSBFE at the source, published here as NMBSBF) from nmbcl.com.np's
 * `/frontapi/en/getMutualFund` JSON API (no bot-protection). See backfill-nmbsbf-nav.ts for
 * full history.
 *
 * Run with: npx tsx scripts/daily/scrape-nmbsbf-nav.ts
 */

import { join } from 'node:path';
import { writeDailyRows } from '../lib/csv-store';
import { isoDateFromLabel, todayInNepal } from '../lib/nepal-time';

const SCHEME_ID = 4;
const API_URL = 'https://www.nmbcl.com.np/frontapi/en/getMutualFund';
const OUTPUT_FILE = join(process.cwd(), 'data', 'sip-mutual-funds', 'NMBSBF.csv');
const HEADER = ['published_date', 'nav'];

type NmbResponse = { date: string[]; data: number[] };

async function main() {
  await writeDailyRows(OUTPUT_FILE, HEADER, 'NMBSBF', async () => {
    // Nepal's year, not the runner's: between 00:00 and 05:45 NPT a UTC year is still last year's,
    // so a 1 January run would request last year and then filter out everything from this one.
    const year = Number(todayInNepal().slice(0, 4));
    const response = await fetch(`${API_URL}?schemeId=${SCHEME_ID}&year=${year}&type=daily`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!response.ok) throw new Error(`HTTP error fetching NMBSBF NAV: ${response.status}`);

    const json: NmbResponse = await response.json();
    if (!json.date || json.date.length === 0) return null;

    // The `date[]` labels are the NAVs' own dates, normalised exactly as the backfill does it.
    // flatMap rather than map+filter so an unparseable label is dropped with the narrowing intact:
    // `published_date` is a plain string from here on, no assertion needed to convince the compiler.
    // The whole year is handed over rather than just its newest row, so a day no run covered still
    // gets filed; `appendRows` adds only the dates missing from the file.
    return json.date.flatMap((label, i) => {
      const published_date = isoDateFromLabel(label);
      const nav = json.data[i];
      if (!published_date || typeof nav !== 'number' || nav <= 0) return [];
      if (!published_date.startsWith(`${year}-`)) return [];
      return [{ published_date, nav }];
    });
  });
}

main().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});
