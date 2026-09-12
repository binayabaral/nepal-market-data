/**
 * Publishes one JSON history file per symbol next to the CSVs, at
 * `site/public/data/<dir>/<SYMBOL>.json`.
 *
 * Why this exists when the CSVs are already served:
 *
 * 1. Cloudflare serves `text/csv` UNCOMPRESSED but gzips `application/json`. Measured on the live
 *    site, NABIL.csv costs 218KB on the wire as CSV and about 92KB as JSON, so the larger format is
 *    roughly 2.4x cheaper to actually transfer. On GitHub Pages, which did gzip CSV, this was the
 *    other way round.
 * 2. A consumer gets typed numbers from `res.json()` with no parsing step at all.
 *
 * The CSVs stay exactly as they are. This is purely additive: the site's own chart still fetches
 * CSV, and every "Download as CSV" link still works.
 *
 * Runs AFTER `sync-data.ts`, which deletes and recreates the whole `site/public/data` tree. Writing
 * these before that would throw them away with no error, the same trap the manifest copy hits.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { readRows } from '../lib/csv-store';
import type { Kind } from './manifest-types';
import type { Manifest } from './manifest-types';
import { readFileSync } from 'node:fs';

const DATA_SUBDIR: Record<Kind, string> = {
  stock: 'nepse',
  index: 'nepse',
  fund: 'sip-mutual-funds',
  metal: 'precious-metals'
};

/**
 * CSV column -> JSON field. Renamed to match the manifest's camelCase, so a consumer meets one
 * naming convention across every file this site publishes rather than two.
 *
 * `status` is deliberately absent: it is the literal 'A' on all 515,661 price rows and carries no
 * information. The reference table's `status` (listed/merged) is a DIFFERENT column and is not this
 * one; see the manifest for that.
 */
const FIELD: Record<string, string> = {
  published_date: 'date',
  open: 'open',
  high: 'high',
  low: 'low',
  close: 'close',
  per_change: 'changePct',
  traded_quantity: 'volume',
  traded_amount: 'turnover',
  nav: 'nav',
  price: 'price'
};

/** Blank CSV cells become null, never 0: a missing volume and a real zero are different facts. */
function toNumber(value: string): number | null {
  if (value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function main(): void {
  const manifestPath = join('site', 'src', 'data', 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;

  let files = 0;
  let totalRows = 0;
  for (const entry of manifest.entries) {
    const dir = DATA_SUBDIR[entry.kind];
    const rows = readRows(join('data', dir, `${entry.symbol}.csv`));
    if (rows.length === 0) {
      console.warn(`  ${entry.symbol}: no rows, skipping`);
      continue;
    }

    const history = rows.map(row => {
      const out: Record<string, string | number | null> = {};
      for (const [csvCol, jsonField] of Object.entries(FIELD)) {
        if (!(csvCol in row)) continue;
        const raw = row[csvCol] ?? '';
        out[jsonField] = jsonField === 'date' ? raw : toNumber(raw);
      }
      return out;
    });

    const payload = {
      symbol: entry.symbol,
      name: entry.name,
      kind: entry.kind,
      rows: history.length,
      firstDate: entry.firstDate,
      latestDate: entry.latestDate,
      history
    };

    const outDir = join('site', 'public', 'data', dir);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, `${entry.symbol}.json`), JSON.stringify(payload), 'utf8');
    files += 1;
    totalRows += history.length;
  }
  console.log(`Wrote ${files} history JSON file(s), ${totalRows.toLocaleString()} rows total`);
}

main();
