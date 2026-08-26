import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { readRows } from '../lib/csv-store';
import { loadFundRefs, loadSymbolRefs } from './load-symbols';
import type { Kind, Manifest, ManifestEntry } from './manifest-types';

/** The index lives in `data/nepse/` alongside the scrips but is not one of them. */
const INDEX_SYMBOL = 'NEPSE_INDEX';

/** Rounds to two decimals without leaving 1.9800000000000002 in the JSON. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function titleiseMetal(slug: string): string {
  return slug
    .split('-')
    .map(part => (/^\d/.test(part) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ');
}

/**
 * Wraps `summarise`, warning by file path when a CSV has no data rows.
 *
 * An empty file is the same shape of failure as a missing reference row: a scraper bug can drop a
 * symbol from the site leaving no trace in the build log unless something says so out loud.
 */
function summariseOrWarn(filePath: string, valueColumn: string): Series | null {
  const series = summarise(filePath, valueColumn);
  if (!series) {
    console.warn(`No data rows in ${filePath}; skipping.`);
  }
  return series;
}

function csvStems(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(name => name.endsWith('.csv'))
    .map(name => name.slice(0, -'.csv'.length))
    .sort();
}

type Series = {
  rows: number;
  firstDate: string;
  latestDate: string;
  latestValue: number;
  prevValue: number | null;
  hasVolume: boolean;
};

/**
 * Reduces one CSV to just the numbers the manifest needs.
 *
 * `valueColumn` differs per shape: `close` for NEPSE, `price` for metals, `nav` for funds.
 * Returns null for an empty file rather than throwing, so one bad file cannot fail the whole build;
 * the caller is responsible for warning about that case, since only it knows the file's path.
 */
function summarise(filePath: string, valueColumn: string): Series | null {
  const rows = readRows(filePath);
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (!first || !last) return null;

  const prev = rows.length >= 2 ? rows[rows.length - 2] : undefined;
  const prevRaw = prev?.[valueColumn];
  const prevValue = prevRaw ? Number(prevRaw) : null;

  return {
    rows: rows.length,
    firstDate: first.published_date ?? '',
    latestDate: last.published_date ?? '',
    latestValue: Number(last[valueColumn] ?? '0'),
    prevValue: prevValue !== null && Number.isFinite(prevValue) ? prevValue : null,
    // Volume is a property of the whole series, so every row is checked, not just the last one: the
    // index has no volume in any of its 6,685 rows, every scrip row has volume, and a halt or
    // suspension can leave the LATEST row blank while earlier rows carry real volume. Trusting only
    // the last row would wrongly demote such a scrip to hasVolume: false. readRows has already
    // loaded every row into memory, so this scan costs one in-memory pass and zero extra I/O.
    hasVolume: rows.some(row => (row.traded_quantity ?? '').length > 0)
  };
}

/** The non-numeric identity fields of a manifest entry, filled in per loop before the numbers are folded in. */
type EntryMeta = {
  symbol: string;
  name: string;
  kind: Kind;
  instrumentType: string;
  sector: string;
  status: string;
};

/** Combines a file's identity (`meta`) with its computed numbers (`series`) into a full manifest entry. */
function toEntry(meta: EntryMeta, series: Series): ManifestEntry {
  const changePct =
    series.prevValue !== null && series.prevValue !== 0
      ? round2(((series.latestValue - series.prevValue) / series.prevValue) * 100)
      : null;
  return {
    symbol: meta.symbol,
    name: meta.name,
    kind: meta.kind,
    instrumentType: meta.instrumentType,
    sector: meta.sector,
    status: meta.status,
    latestDate: series.latestDate,
    latestClose: series.latestValue,
    prevClose: series.prevValue,
    changePct,
    rows: series.rows,
    firstDate: series.firstDate,
    hasVolume: series.hasVolume
  };
}

export function buildManifest(dataDir: string): Manifest {
  const entries: ManifestEntry[] = [];
  const symbolRefs = new Map(loadSymbolRefs(dataDir).map(ref => [ref.symbol, ref]));
  const fundRefs = new Map(loadFundRefs(dataDir).map(ref => [ref.symbol, ref]));

  for (const stem of csvStems(join(dataDir, 'nepse'))) {
    const series = summariseOrWarn(join(dataDir, 'nepse', `${stem}.csv`), 'close');
    if (!series) continue;
    const isIndex = stem === INDEX_SYMBOL;
    const ref = symbolRefs.get(stem);
    if (!isIndex && !ref) {
      // A price file with no reference row means the reference refresh has not caught up with a new
      // listing. Loud, because a silently unnamed symbol is how a new scrip goes missing from the site.
      console.warn(`No reference row for ${stem}; using the symbol as its name.`);
    }
    entries.push(
      toEntry(
        {
          symbol: stem,
          name: isIndex ? 'NEPSE Index' : (ref?.name ?? stem),
          kind: isIndex ? 'index' : 'stock',
          instrumentType: isIndex ? 'index' : (ref?.instrumentType ?? ''),
          sector: isIndex ? '' : (ref?.sector ?? ''),
          status: isIndex ? 'listed' : (ref?.status ?? '')
        },
        series
      )
    );
  }

  for (const stem of csvStems(join(dataDir, 'sip-mutual-funds'))) {
    const series = summariseOrWarn(join(dataDir, 'sip-mutual-funds', `${stem}.csv`), 'nav');
    if (!series) continue;
    entries.push(
      toEntry(
        {
          symbol: stem,
          name: fundRefs.get(stem)?.name ?? stem,
          kind: 'fund',
          instrumentType: 'open_end_fund',
          sector: '',
          status: 'listed'
        },
        series
      )
    );
  }

  for (const stem of csvStems(join(dataDir, 'precious-metals'))) {
    const series = summariseOrWarn(join(dataDir, 'precious-metals', `${stem}.csv`), 'price');
    if (!series) continue;
    entries.push(
      toEntry(
        {
          symbol: stem,
          name: titleiseMetal(stem),
          kind: 'metal',
          instrumentType: 'metal',
          sector: '',
          status: 'listed'
        },
        series
      )
    );
  }

  // `generatedAt` is the build time, deliberately not a data date. Data freshness is per-entry.
  return { generatedAt: new Date().toISOString(), entries };
}

function main(): void {
  const manifest = buildManifest('data');
  const outDir = join('site', 'src', 'data');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const counts = manifest.entries.reduce<Record<string, number>>((acc, e) => {
    acc[e.kind] = (acc[e.kind] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`Wrote ${manifest.entries.length} manifest entries:`, counts);
}

if (process.argv[1]?.endsWith('build-manifest.ts')) main();
