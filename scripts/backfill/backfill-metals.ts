#!/usr/bin/env tsx
/**
 * One-time backfill: imports historical daily gold (24K/22K) and silver rates (NPR per tola)
 * into `precious-metals/*.csv`, merged from two sources:
 * 1. Primary: dhirajraut1/gold-prices-nepal's `gold_silver_prices.json` on GitHub (single JSON
 *    file, ~2,700 rows, 2017-04-16 -> present).
 * 2. Fallback: notifynepal.com's public history API, used only to fill dates the JSON source is
 *    missing or has a zero/null value for. This API ignores `page_size` (always 50/page) and has
 *    ~4,038 total records back to 2010-06-01, further back than the JSON source.
 *
 * Neither source alone is complete, so both are fetched in full and merged per calendar day
 * (GitHub JSON preferred, notifynepal.com filling gaps), independently per metal.
 *
 * Gold 22K is derived from the merged Gold 24K value via the same 0.9167 multiplier the daily
 * scraper uses.
 *
 * Idempotent: dedupes against every existing date already on file per metal, safe to re-run.
 *
 * Run with: npx tsx scripts/backfill/backfill-metals.ts
 */

import { join } from 'node:path';
import { appendRows } from '../lib/csv-store';

const GITHUB_JSON_URL = 'https://raw.githubusercontent.com/dhirajraut1/gold-prices-nepal/main/scraper/gold_silver_prices.json';
const NOTIFYNEPAL_API_URL = 'https://be.notifynepal.com/api/gold-silver/prices/history/';
const GOLD_22K_MULTIPLIER = 0.9167;
const METALS_DIR = join(process.cwd(), 'data', 'precious-metals');
const HEADER = ['published_date', 'price'];

type MetalRates = { date: string; gold: number; silver: number };

async function fetchGithubJsonRates(): Promise<Map<string, MetalRates>> {
  console.log(`Fetching ${GITHUB_JSON_URL}...`);
  const response = await fetch(GITHUB_JSON_URL);
  if (!response.ok) throw new Error(`HTTP error fetching GitHub JSON: ${response.status}`);

  const rows: Array<{ ad: string; fineGold: number | null; silver: number | null }> = await response.json();
  const byDate = new Map<string, MetalRates>();
  for (const row of rows) {
    const gold = row.fineGold && row.fineGold > 0 ? row.fineGold : 0;
    const silver = row.silver && row.silver > 0 ? row.silver : 0;
    if (!gold && !silver) continue;
    byDate.set(row.ad, { date: row.ad, gold, silver });
  }
  console.log(`Parsed ${byDate.size} usable row(s) from the GitHub JSON.`);
  return byDate;
}

async function fetchNotifyNepalRates(): Promise<Map<string, MetalRates>> {
  console.log(`Fetching ${NOTIFYNEPAL_API_URL} (paginated)...`);
  const byDate = new Map<string, MetalRates>();

  let page = 1;
  let totalPages = 1;
  do {
    const response = await fetch(`${NOTIFYNEPAL_API_URL}?page=${page}`);
    if (!response.ok) throw new Error(`HTTP error fetching notifynepal.com page ${page}: ${response.status}`);

    const json: {
      pages: number;
      results: Array<{ date_ad: string; hallmark_gold_per_tola: number | null; silver_per_tola: number | null }>;
    } = await response.json();
    totalPages = json.pages;

    for (const row of json.results) {
      const gold = row.hallmark_gold_per_tola && row.hallmark_gold_per_tola > 0 ? row.hallmark_gold_per_tola : 0;
      const silver = row.silver_per_tola && row.silver_per_tola > 0 ? row.silver_per_tola : 0;
      if (!gold && !silver) continue;
      byDate.set(row.date_ad, { date: row.date_ad, gold, silver });
    }

    page++;
  } while (page <= totalPages);

  console.log(`Parsed ${byDate.size} usable row(s) from notifynepal.com.`);
  return byDate;
}

/** Merges two per-date rate maps, preferring `primary`'s value when present and non-zero, falling
 * back to `fallback` independently per metal (a day can take gold from one source, silver from the other). */
function mergeRates(primary: Map<string, MetalRates>, fallback: Map<string, MetalRates>) {
  const merged = new Map<string, MetalRates>();
  const allDates = new Set([...primary.keys(), ...fallback.keys()]);
  for (const date of allDates) {
    const p = primary.get(date);
    const f = fallback.get(date);
    const gold = p?.gold || f?.gold || 0;
    const silver = p?.silver || f?.silver || 0;
    if (!gold && !silver) continue;
    merged.set(date, { date, gold, silver });
  }
  return merged;
}

async function main() {
  const [primary, fallback] = await Promise.all([fetchGithubJsonRates(), fetchNotifyNepalRates()]);
  const merged = mergeRates(primary, fallback);
  console.log(`Merged: ${merged.size} total day(s).`);

  const sortedRates = Array.from(merged.values()).sort((a, b) => a.date.localeCompare(b.date));

  const gold24kRows = sortedRates.filter(r => r.gold > 0).map(r => ({ published_date: r.date, price: r.gold }));
  const gold22kRows = sortedRates.filter(r => r.gold > 0).map(r => ({ published_date: r.date, price: Math.round(r.gold * GOLD_22K_MULTIPLIER * 100) / 100 }));
  const silverRows = sortedRates.filter(r => r.silver > 0).map(r => ({ published_date: r.date, price: r.silver }));

  const { added: gold24kInserted } = appendRows(join(METALS_DIR, 'gold-24k.csv'), HEADER, gold24kRows);
  const { added: gold22kInserted } = appendRows(join(METALS_DIR, 'gold-22k.csv'), HEADER, gold22kRows);
  const { added: silverInserted } = appendRows(join(METALS_DIR, 'silver.csv'), HEADER, silverRows);

  console.log(`gold-24k: inserted ${gold24kInserted} row(s).`);
  console.log(`gold-22k: inserted ${gold22kInserted} row(s).`);
  console.log(`silver: inserted ${silverInserted} row(s).`);
}

main().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});
