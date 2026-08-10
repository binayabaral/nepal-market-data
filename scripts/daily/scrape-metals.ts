#!/usr/bin/env tsx
/**
 * Daily scraper: fetches today's gold/silver rates from fenegosida.org's dashboard JSON API
 * (the same API the fenegosida.org site itself calls client-side) and appends one row each to
 * `precious-metals/gold-24k.csv`, `gold-22k.csv`, and `silver.csv`. Gold 22K is derived from
 * Gold 24K via the standard 0.9167 fineness multiplier, same as the historical backfill.
 *
 * Run with: npx tsx scripts/daily/scrape-metals.ts
 */

import { join } from 'node:path';
import { writeDailyRow } from '../lib/csv-store';
import { nepalDateFromInstant, todayInNepal } from '../lib/nepal-time';

const FENEGOSIDA_API_URL = 'https://api.fenegosida.org/api/website/v1/Dashboard/today';
const GOLD_22K_MULTIPLIER = 0.9167;
const HEADER = ['published_date', 'price'];
const METALS_DIR = join(process.cwd(), 'data', 'precious-metals');

/**
 * fenegosida publishes more than one kind of gold per tola: छापावाल (hallmark/fine gold, the 24K
 * rate everyone quotes) and तेजाबी (a lower-fineness rate). Matching on सुन alone matched both, and
 * whichever row happened to come last in the array silently won.
 */
const GOLD_LABEL = 'छापावाल';
const SILVER_LABEL = 'चाँदी';
const TOLA_LABEL = 'तोला';

type DashboardRateRow = { rateType: string; todayDate: string; todayBaseRatePerGram: number };

/** One rate with the date the API itself says it applies to. */
type DatedRate = { published_date: string; price: number };

/**
 * `todayDate` is the instant the rate was published, which the API keeps serving unchanged until it
 * publishes the next one, so on a day the federation doesn't post a rate the previous day's date
 * comes back and dedup no-ops instead of the previous rate being relabelled as today's.
 */
async function fetchRates(): Promise<{ gold24k: DatedRate | null; silver: DatedRate | null }> {
  const response = await fetch(FENEGOSIDA_API_URL, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`HTTP error fetching ${FENEGOSIDA_API_URL}: ${response.status}`);

  const rows: DashboardRateRow[] = await response.json();
  let gold24k: DatedRate | null = null;
  let silver: DatedRate | null = null;

  for (const row of rows) {
    if (!row.rateType.includes(TOLA_LABEL) || !(row.todayBaseRatePerGram > 0)) continue;
    const rate = { published_date: nepalDateFromInstant(row.todayDate), price: row.todayBaseRatePerGram };
    if (row.rateType.includes(GOLD_LABEL)) {
      // A second match means the API's labelling changed and the pinned pattern is no longer
      // unique, so the first is kept and the ambiguity is reported rather than overwritten away.
      if (gold24k) {
        console.warn(`More than one "${GOLD_LABEL} ... ${TOLA_LABEL}" row came back (latest: "${row.rateType}"); keeping the first and ignoring the rest.`);
        continue;
      }
      gold24k = rate;
    }
    if (row.rateType.includes(SILVER_LABEL)) silver = rate;
  }

  return { gold24k, silver };
}

async function main() {
  const today = todayInNepal();

  let rates: { gold24k: DatedRate | null; silver: DatedRate | null } | null = null;
  try {
    rates = await fetchRates();
  } catch (error) {
    console.warn(`Fetching metal rates failed: ${error instanceof Error ? error.message : error}`);
  }

  const gold24k = rates?.gold24k ?? null;
  const silver = rates?.silver ?? null;

  await writeDailyRow(join(METALS_DIR, 'gold-24k.csv'), HEADER, today, 'gold-24k', async () => gold24k);

  await writeDailyRow(join(METALS_DIR, 'gold-22k.csv'), HEADER, today, 'gold-22k', async () =>
    gold24k
      ? { published_date: gold24k.published_date, price: Math.round(gold24k.price * GOLD_22K_MULTIPLIER * 100) / 100 }
      : null
  );

  await writeDailyRow(join(METALS_DIR, 'silver.csv'), HEADER, today, 'silver', async () => silver);
}

main().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});
