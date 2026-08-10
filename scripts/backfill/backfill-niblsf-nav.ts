#!/usr/bin/env tsx
/**
 * One-time backfill: imports historical daily NAV for NIMB Ace Capital's "NIBL Sahabhagita
 * Fund" (internally NIBLSAHABHAGITA at the source, published here as NIBLSF) into
 * `sip-mutual-funds/NIBLSF.csv`, via the shared nimbacecapital.com fetcher
 * (scripts/lib/niblsf-nav.ts), which the daily script uses too.
 *
 * Paginated (`page`+`entries`, capped at 100/page server-side); loops pages until `total_items` is
 * covered. Confirmed daily history starts ~March 2025.
 *
 * Run with: npx tsx scripts/backfill/backfill-niblsf-nav.ts
 */

import { join } from 'node:path';
import { appendRows } from '../lib/csv-store';
import { fetchNiblsfNonce, fetchNiblsfPage, type NiblsfNavRow } from '../lib/niblsf-nav';

const USER_AGENT = 'Mozilla/5.0 (compatible; NepalMarketDataBackfill/1.0)';
const ENTRIES_PER_PAGE = 100;
const OUTPUT_FILE = join(process.cwd(), 'data', 'sip-mutual-funds', 'NIBLSF.csv');
const HEADER = ['published_date', 'nav'];

async function main() {
  const nonce = await fetchNiblsfNonce(USER_AGENT);

  const allRows: NiblsfNavRow[] = [];
  let page = 1;
  let totalItems = Infinity;
  while (allRows.length < totalItems) {
    const { rows, totalItems: total } = await fetchNiblsfPage(nonce, page, ENTRIES_PER_PAGE, USER_AGENT);
    if (rows.length === 0) break;
    totalItems = total;
    allRows.push(...rows);
    console.log(`Page ${page}: ${rows.length} row(s) (${allRows.length}/${totalItems} so far)`);
    page++;
  }

  const sorted = allRows.sort((a, b) => a.published_date.localeCompare(b.published_date));
  const { added: inserted } = appendRows(OUTPUT_FILE, HEADER, sorted);
  console.log(`\nNIBLSF: fetched ${allRows.length} total row(s), inserted ${inserted}.`);
}

main().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});
