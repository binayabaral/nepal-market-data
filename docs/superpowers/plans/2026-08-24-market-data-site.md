# Nepal Market Data Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a static site over this repo's CSVs so any symbol can be searched, charted and downloaded without cloning the dataset.

**Architecture:** An Astro project in `site/` prerenders 451 pages from a build-time manifest. The only hydrated island is the chart, which fetches the raw CSV from the same origin at runtime. A GitHub Actions workflow builds the site, copies `data/` in alongside it, and deploys the pair to GitHub Pages.

**Tech Stack:** Astro 5 (static output), lightweight-charts 5, TypeScript, tsx, pnpm 11.14.0, Node 22. Tests use Node's built-in `node:test`; no test dependency is added.

**Spec:** `docs/superpowers/specs/2026-08-24-market-data-site-design.md`

## Global Constraints

- **Package manager is pnpm**, version `11.14.0` per `packageManager`. Never npm or yarn.
- **Node 22.** `engines.node` is `>=22`; every workflow pins `node-version: '22'`.
- **No em dashes** anywhere in code, comments, copy or commit messages.
- **No `Co-Authored-By` trailer** in any commit.
- **Root `tsconfig.json` is strict**, including `noUncheckedIndexedAccess`, `noUnusedLocals` and `noUnusedParameters`. Indexing an array yields `T | undefined` and must be narrowed. It covers `scripts/**/*.ts`, so `scripts/site/*.ts` is typechecked by `pnpm typecheck` with no config change.
- **Imports carry no file extension.** `tsconfig.json` does not set `allowImportingTsExtensions`, so
  `from '../lib/csv-store.ts'` fails `pnpm typecheck` with TS5097. Write `from '../lib/csv-store'`,
  matching every existing script. The exceptions are a runtime `tsx -e` one-liner and an Astro inline
  `<script>` import, both of which are resolved by tsx and Vite rather than tsc.
- **Reuse `scripts/lib/csv-store.ts`; do not write a second CSV parser.** `readRows(filePath): Array<Record<string, string>>` is quote-aware and already survives a comma inside `"9% Shangrila Development Bank Debenture, 2087"`.
- **The market-wide filter is `instrument_type === 'ordinary' && status === 'listed'`, giving 284 of 432 symbols. Never filter on "has a sector".** 10 of the 284 have a blank `sector`, including Nepal Doorsanchar (NTC), Nepal Reinsurance and Himalayan Reinsurance. 274 is the sector-having subset and is the wrong number.
- **Design tokens come from `design-system/nepal-market-data/MASTER.md` verbatim.** No raw hex in components.
- **Green is both brand and "up".** Two non-optional rules: no green chrome inside a data region, and direction is never carried by colour alone.
- **`data/` is never modified by any task in this plan.** The site only reads it.
- **Do not commit `site/node_modules`, `site/dist`, `site/public/data`, or `site/src/data/manifest.json`.** All are build artifacts.

## Verified facts about the data (audited 2026-08-24, rely on these)

| Fact | Value | Consequence |
|---|---|---|
| Files in `data/nepse/` | 433 | 432 symbols plus `NEPSE_INDEX.csv` |
| Rows in `data/reference/nepse-symbols.csv` | 432 plus header | every one has a matching CSV; no gaps |
| Total NEPSE rows | 511,468 | grows daily; never hardcode this |
| Rows with a blank OHLC field | **0** | candlesticks are safe for every scrip |
| Rows with a blank `traded_quantity` | **6,685** | exactly the index's row count |
| Index rows with volume | **0 of 6,685** | **the index has no volume, ever. Render no volume pane on it.** |
| Scrip rows with blank volume | 0 | every scrip gets a volume pane |
| Distinct `status` values in price CSVs | `A` only | carries no information; never render it |
| Symbols with fewer than 5 rows | 42, minimum 1 row | a single-row chart is a real case |
| Largest CSV | `NEPSE_INDEX.csv`, 372KB | served gzipped |
| `data/` total | 31MB | the artifact size |

**The two `status` columns are different and must never be conflated.** In `data/nepse/*.csv`, `status` is always `A` and is meaningless. In `data/reference/nepse-symbols.csv`, `status` is `listed` or `merged` and drives the banner and the market-wide filter. Reading the price CSV's `status` would put a "no longer trades" banner on every live company.

**Symbols are stored slash-free.** `scripts/lib/csv-store.ts`'s `symbolToKey` maps `GBILD84/85` to `GBILD84-85`, and `data/reference/nepse-symbols.csv` already stores that key form. So the reference `symbol`, the CSV filename and the URL slug are the same string, and no extra mapping is needed. The four affected rows are `GBILD84-85`, `GBILD86-87`, `MND84-85`, `NICAD85-86`.

## File Structure

```
scripts/site/
  manifest-types.ts      shared types, imported by the builder and its tests
  load-symbols.ts        reads the two reference CSVs into typed records
  build-manifest.ts      composes the manifest and writes it; the CLI entry
  sync-data.ts           copies data/ into site/public/data for dev and build
  smoke-test.ts          post-build assertions against dist/
scripts/site/__tests__/
  load-symbols.test.ts
  build-manifest.test.ts
site/
  astro.config.mjs
  tsconfig.json
  package.json
  src/styles/tokens.css      the MASTER.md palette and spacing, light and dark
  src/layouts/Base.astro     html shell, header, footer, provenance
  src/lib/manifest.ts        typed read of the generated manifest
  src/lib/format.ts          number, date and change formatting
  src/components/PriceChart.ts       the only client island
  src/components/ChartMount.astro    markup plus the island's script tag
  src/components/OhlcTable.astro     the accessibility fallback
  src/components/SymbolTable.astro   landing table plus client-side search
  src/pages/index.astro
  src/pages/about.astro
  src/pages/stocks/[symbol].astro
  src/pages/funds/[symbol].astro
  src/pages/metals/[slug].astro
.github/workflows/deploy-site.yml
```

`manifest-types.ts` is separate from `build-manifest.ts` so the Astro side can import the types without pulling in Node-only file I/O.

---

### Task 1: Test harness and the reference-CSV loader

**Files:**
- Create: `scripts/site/manifest-types.ts`
- Create: `scripts/site/load-symbols.ts`
- Create: `scripts/site/__tests__/load-symbols.test.ts`
- Modify: `package.json` (add the `test` script)

**Interfaces:**
- Consumes: `readRows` from `scripts/lib/csv-store.ts`.
- Produces: `type SymbolRef`, `type FundRef`, `type Kind`; `loadSymbolRefs(dataDir: string): SymbolRef[]`, `loadFundRefs(dataDir: string): FundRef[]`, `isMarketWide(ref: SymbolRef): boolean`.

This repo has no test framework and `package.json` has only `typecheck`. Rather than add a dependency, use Node 22's built-in `node:test` run through the `tsx` that is already a dependency. That keeps the "zero extra tooling" character of the repo while still allowing real tests.

- [ ] **Step 1: Add the test script**

In `package.json`, add to `scripts`:

```json
"test": "node --import tsx --test \"scripts/**/__tests__/*.test.ts\""
```

- [ ] **Step 2: Write the failing test**

Create `scripts/site/__tests__/load-symbols.test.ts`:

```ts
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadSymbolRefs, loadFundRefs, isMarketWide } from '../load-symbols';

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nmd-ref-'));
  mkdirSync(join(dir, 'reference'), { recursive: true });
  writeFileSync(
    join(dir, 'reference', 'nepse-symbols.csv'),
    [
      'symbol,name,source_category,instrument_type,sector,status',
      'NABIL,Nabil Bank Limited,Commercial Bank,ordinary,Commercial Bank,listed',
      'NTC,Nepal Doorsanchar Company Limited,Others,ordinary,,listed',
      'BOKL,Bank of Kathmandu Limited,Merged,ordinary,,merged',
      'ADBLD83,10.35% Agricultural Bank Debenture 2083,Corporate Debentures,debenture,,listed',
      'SDBD87,"9% Shangrila Development Bank Debenture, 2087",Corporate Debentures,debenture,,listed',
      ''
    ].join('\n')
  );
  writeFileSync(
    join(dir, 'reference', 'sip-mutual-funds.csv'),
    ['symbol,name,amc', 'NI31,NIC Asia Dynamic Debt Fund,NIC Asia Capital', 'SLK,Sanima Large Cap Fund,', ''].join('\n')
  );
  return dir;
}

test('loads every symbol row with its reference fields', () => {
  const refs = loadSymbolRefs(fixture());
  assert.equal(refs.length, 5);
  const nabil = refs.find(r => r.symbol === 'NABIL');
  assert.deepEqual(nabil, {
    symbol: 'NABIL',
    name: 'Nabil Bank Limited',
    sourceCategory: 'Commercial Bank',
    instrumentType: 'ordinary',
    sector: 'Commercial Bank',
    status: 'listed'
  });
});

test('a quoted name containing a comma survives parsing', () => {
  const refs = loadSymbolRefs(fixture());
  const sdbd = refs.find(r => r.symbol === 'SDBD87');
  assert.equal(sdbd?.name, '9% Shangrila Development Bank Debenture, 2087');
});

test('the market-wide filter keeps ordinary listed symbols including those with no sector', () => {
  const refs = loadSymbolRefs(fixture());
  const kept = refs.filter(isMarketWide).map(r => r.symbol);
  assert.deepEqual(kept, ['NABIL', 'NTC']);
});

test('the market-wide filter excludes merged shells and debentures', () => {
  const refs = loadSymbolRefs(fixture());
  const kept = refs.filter(isMarketWide).map(r => r.symbol);
  assert.ok(!kept.includes('BOKL'));
  assert.ok(!kept.includes('ADBLD83'));
});

test('a blank amc stays blank rather than becoming a placeholder', () => {
  const funds = loadFundRefs(fixture());
  assert.equal(funds.find(f => f.symbol === 'SLK')?.amc, '');
  assert.equal(funds.find(f => f.symbol === 'NI31')?.amc, 'NIC Asia Capital');
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test`
Expected: FAIL, unable to resolve `../load-symbols.ts`.

- [ ] **Step 4: Write the types**

Create `scripts/site/manifest-types.ts`:

```ts
/**
 * Shapes shared by the manifest builder and the Astro pages that read its output.
 *
 * Kept apart from `build-manifest.ts` so the site can import these types without dragging in
 * Node-only file I/O.
 */

export type Kind = 'stock' | 'fund' | 'metal' | 'index';

export type SymbolRef = {
  symbol: string;
  name: string;
  sourceCategory: string;
  instrumentType: string;
  sector: string;
  status: string;
};

export type FundRef = {
  symbol: string;
  name: string;
  amc: string;
};

export type ManifestEntry = {
  symbol: string;
  name: string;
  kind: Kind;
  instrumentType: string;
  sector: string;
  status: string;
  latestDate: string;
  latestClose: number;
  prevClose: number | null;
  changePct: number | null;
  rows: number;
  firstDate: string;
  hasVolume: boolean;
};

export type Manifest = {
  generatedAt: string;
  entries: ManifestEntry[];
};
```

`prevClose` and `changePct` are nullable on purpose: 42 symbols have fewer than 5 rows and one has a single row, so there is not always a previous close to compare against. `hasVolume` exists because the index has no volume in any of its 6,685 rows while every scrip row has it.

- [ ] **Step 5: Write the loader**

Create `scripts/site/load-symbols.ts`:

```ts
import { join } from 'node:path';

import { readRows } from '../lib/csv-store';
import type { FundRef, SymbolRef } from './manifest-types';

/**
 * The two reference tables in `data/reference/`, read into typed records.
 *
 * `data/reference/nepse-symbols.csv` already stores the slash-free key form of each symbol
 * (`GBILD84-85`, not `GBILD84/85`), which is also the CSV filename and the URL slug, so nothing
 * here re-derives it.
 */
export function loadSymbolRefs(dataDir: string): SymbolRef[] {
  return readRows(join(dataDir, 'reference', 'nepse-symbols.csv')).map(row => ({
    symbol: row.symbol ?? '',
    name: row.name ?? '',
    sourceCategory: row.source_category ?? '',
    instrumentType: row.instrument_type ?? '',
    sector: row.sector ?? '',
    status: row.status ?? ''
  }));
}

export function loadFundRefs(dataDir: string): FundRef[] {
  return readRows(join(dataDir, 'reference', 'sip-mutual-funds.csv')).map(row => ({
    symbol: row.symbol ?? '',
    name: row.name ?? '',
    amc: row.amc ?? ''
  }));
}

/**
 * Whether a symbol belongs in a market-wide view: top movers, breadth, any sector aggregate.
 *
 * Filters on instrument type and listing status, NEVER on "has a sector". 10 of the 284 symbols
 * this keeps have a blank sector because the source files them under `Others` or `Non Category`,
 * and they include Nepal Doorsanchar (NTC), Nepal Reinsurance and Himalayan Reinsurance. A sector
 * test would silently drop Nepal Telecom from the market view.
 */
export function isMarketWide(ref: SymbolRef): boolean {
  return ref.instrumentType === 'ordinary' && ref.status === 'listed';
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm test`
Expected: PASS, 5 tests.

- [ ] **Step 7: Verify against the real data**

Run:

```bash
pnpm tsx -e "import {loadSymbolRefs,isMarketWide} from './scripts/site/load-symbols.ts'; const r=loadSymbolRefs('data'); console.log('total',r.length,'marketWide',r.filter(isMarketWide).length, 'ntcKept', r.filter(isMarketWide).some(x=>x.symbol==='NTC'));"
```

Expected output exactly: `total 432 marketWide 284 ntcKept true`

If `marketWide` reads 274, the filter is wrong: it is testing the sector. Fix it before continuing.

- [ ] **Step 8: Typecheck and commit**

```bash
pnpm typecheck
git add package.json scripts/site
git commit -m "feat: add reference-table loader and the market-wide symbol filter"
```

---

### Task 2: The manifest builder

**Files:**
- Create: `scripts/site/build-manifest.ts`
- Create: `scripts/site/__tests__/build-manifest.test.ts`

**Interfaces:**
- Consumes: `loadSymbolRefs`, `loadFundRefs` from Task 1; `ManifestEntry`, `Manifest`, `Kind` from `manifest-types.ts`; `readRows` from `scripts/lib/csv-store.ts`.
- Produces: `buildManifest(dataDir: string): Manifest`, and a CLI that writes `site/src/data/manifest.json`.

- [ ] **Step 1: Write the failing test**

Create `scripts/site/__tests__/build-manifest.test.ts`:

```ts
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildManifest } from '../build-manifest';

const PRICE_HEADER =
  'published_date,open,high,low,close,per_change,traded_quantity,traded_amount,status';

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nmd-man-'));
  for (const sub of ['reference', 'nepse', 'precious-metals', 'sip-mutual-funds']) {
    mkdirSync(join(dir, sub), { recursive: true });
  }
  writeFileSync(
    join(dir, 'reference', 'nepse-symbols.csv'),
    [
      'symbol,name,source_category,instrument_type,sector,status',
      'NABIL,Nabil Bank Limited,Commercial Bank,ordinary,Commercial Bank,listed',
      'BOKL,Bank of Kathmandu Limited,Merged,ordinary,,merged',
      'ONEROW,One Row Company,Commercial Bank,ordinary,Commercial Bank,listed',
      ''
    ].join('\n')
  );
  writeFileSync(join(dir, 'reference', 'sip-mutual-funds.csv'), ['symbol,name,amc', 'NI31,NIC Asia Fund,NIC Asia Capital', ''].join('\n'));
  writeFileSync(
    join(dir, 'nepse', 'NABIL.csv'),
    [
      PRICE_HEADER,
      '2026-08-20,500,510,495,505,1.00,1000,505000,A',
      '2026-08-21,505,520,500,515,1.98,2000,1030000,A',
      ''
    ].join('\n')
  );
  writeFileSync(join(dir, 'nepse', 'BOKL.csv'), [PRICE_HEADER, '2020-01-02,100,100,100,100,0.00,10,1000,A', ''].join('\n'));
  writeFileSync(join(dir, 'nepse', 'ONEROW.csv'), [PRICE_HEADER, '2026-08-21,10,10,10,10,0.00,5,50,A', ''].join('\n'));
  // The real index carries no volume in any of its rows.
  writeFileSync(
    join(dir, 'nepse', 'NEPSE_INDEX.csv'),
    [PRICE_HEADER, '2026-08-20,2600,2610,2590,2605,0.10,,4000000,A', '2026-08-21,2605,2631,2614,2618.72,-0.40,,4167618882.31,A', ''].join('\n')
  );
  writeFileSync(join(dir, 'precious-metals', 'gold-24k.csv'), ['published_date,price', '2026-08-20,200000', '2026-08-21,201000', ''].join('\n'));
  writeFileSync(join(dir, 'sip-mutual-funds', 'NI31.csv'), ['published_date,nav', '2026-08-20,10.00', '2026-08-21,10.50', ''].join('\n'));
  return dir;
}

test('one entry per data file, with the index counted separately from stocks', () => {
  const m = buildManifest(fixture());
  const byKind = (k: string) => m.entries.filter(e => e.kind === k).map(e => e.symbol).sort();
  assert.deepEqual(byKind('stock'), ['BOKL', 'NABIL', 'ONEROW']);
  assert.deepEqual(byKind('index'), ['NEPSE_INDEX']);
  assert.deepEqual(byKind('fund'), ['NI31']);
  assert.deepEqual(byKind('metal'), ['gold-24k']);
});

test('latest and previous close come from the last two rows', () => {
  const nabil = buildManifest(fixture()).entries.find(e => e.symbol === 'NABIL');
  assert.equal(nabil?.latestDate, '2026-08-21');
  assert.equal(nabil?.latestClose, 515);
  assert.equal(nabil?.prevClose, 505);
  assert.equal(nabil?.changePct, 1.98);
  assert.equal(nabil?.firstDate, '2026-08-20');
  assert.equal(nabil?.rows, 2);
});

test('a single-row symbol yields a null previous close rather than a fabricated zero', () => {
  const one = buildManifest(fixture()).entries.find(e => e.symbol === 'ONEROW');
  assert.equal(one?.rows, 1);
  assert.equal(one?.prevClose, null);
  assert.equal(one?.changePct, null);
});

test('the index is marked as having no volume, scrips as having it', () => {
  const m = buildManifest(fixture());
  assert.equal(m.entries.find(e => e.symbol === 'NEPSE_INDEX')?.hasVolume, false);
  assert.equal(m.entries.find(e => e.symbol === 'NABIL')?.hasVolume, true);
});

test('funds and metals carry their latest value as latestClose', () => {
  const m = buildManifest(fixture());
  assert.equal(m.entries.find(e => e.symbol === 'NI31')?.latestClose, 10.5);
  assert.equal(m.entries.find(e => e.symbol === 'gold-24k')?.latestClose, 201000);
});

test('a fund keeps its reference name and a metal gets a readable one', () => {
  const m = buildManifest(fixture());
  assert.equal(m.entries.find(e => e.symbol === 'NI31')?.name, 'NIC Asia Fund');
  assert.equal(m.entries.find(e => e.symbol === 'gold-24k')?.name, 'Gold 24K');
});

test('merged status is carried through so the page can show its banner', () => {
  const bokl = buildManifest(fixture()).entries.find(e => e.symbol === 'BOKL');
  assert.equal(bokl?.status, 'merged');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test`
Expected: FAIL, unable to resolve `../build-manifest.ts`.

- [ ] **Step 3: Write the builder**

Create `scripts/site/build-manifest.ts`:

```ts
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
 * Returns null for an empty file rather than throwing, so one bad file cannot fail the whole build.
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
    // Volume is a property of the whole series, not of one row: the index has none in any of its
    // 6,685 rows while every scrip row has one. Checking the last row is enough to tell them apart
    // and avoids walking thousands of rows per symbol.
    hasVolume: (last.traded_quantity ?? '').length > 0
  };
}

function entryFrom(series: Series, base: Omit<ManifestEntry, keyof ReturnType<typeof numbersFrom>>): ManifestEntry {
  return { ...base, ...numbersFrom(series) };
}

function numbersFrom(series: Series) {
  const changePct =
    series.prevValue !== null && series.prevValue !== 0
      ? round2(((series.latestValue - series.prevValue) / series.prevValue) * 100)
      : null;
  return {
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
    const series = summarise(join(dataDir, 'nepse', `${stem}.csv`), 'close');
    if (!series) continue;
    const isIndex = stem === INDEX_SYMBOL;
    const ref = symbolRefs.get(stem);
    if (!isIndex && !ref) {
      // A price file with no reference row means the reference refresh has not caught up with a new
      // listing. Loud, because a silently unnamed symbol is how a new scrip goes missing from the site.
      console.warn(`No reference row for ${stem}; using the symbol as its name.`);
    }
    entries.push(
      entryFrom(series, {
        symbol: stem,
        name: isIndex ? 'NEPSE Index' : (ref?.name ?? stem),
        kind: (isIndex ? 'index' : 'stock') as Kind,
        instrumentType: isIndex ? 'index' : (ref?.instrumentType ?? ''),
        sector: isIndex ? '' : (ref?.sector ?? ''),
        status: isIndex ? 'listed' : (ref?.status ?? '')
      } as never)
    );
  }

  for (const stem of csvStems(join(dataDir, 'sip-mutual-funds'))) {
    const series = summarise(join(dataDir, 'sip-mutual-funds', `${stem}.csv`), 'nav');
    if (!series) continue;
    entries.push(
      entryFrom(series, {
        symbol: stem,
        name: fundRefs.get(stem)?.name ?? stem,
        kind: 'fund' as Kind,
        instrumentType: 'open_end_fund',
        sector: '',
        status: 'listed'
      } as never)
    );
  }

  for (const stem of csvStems(join(dataDir, 'precious-metals'))) {
    const series = summarise(join(dataDir, 'precious-metals', `${stem}.csv`), 'price');
    if (!series) continue;
    entries.push(
      entryFrom(series, {
        symbol: stem,
        name: titleiseMetal(stem),
        kind: 'metal' as Kind,
        instrumentType: 'metal',
        sector: '',
        status: 'listed'
      } as never)
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
```

Note on the `as never` casts in the three `entryFrom` calls: they exist only because `entryFrom` splits a `ManifestEntry` into a reference half and a numeric half. If the implementer finds a cleaner factoring that keeps full type checking, prefer it. Do not leave `as never` in place if it hides a real mismatch, and never widen it to `as any`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test`
Expected: PASS, all tests in both files.

- [ ] **Step 5: Build the real manifest and check it**

Run:

```bash
pnpm tsx scripts/site/build-manifest.ts
```

Expected: `Wrote 452 manifest entries: { stock: 432, index: 1, fund: 14, metal: 3 }` and no `No reference row` warnings.

452 entries produce 451 pages: the index has no page of its own, it is the landing chart.

Then confirm the audited facts survive the real run:

```bash
pnpm tsx -e "
import m from './site/src/data/manifest.json' with { type: 'json' };
const e = m.entries;
const idx = e.find(x => x.symbol === 'NEPSE_INDEX');
console.log('index hasVolume', idx.hasVolume);
console.log('scrips without volume', e.filter(x => x.kind === 'stock' && !x.hasVolume).length);
console.log('null changePct', e.filter(x => x.changePct === null).length);
console.log('marketWide', e.filter(x => x.instrumentType === 'ordinary' && x.status === 'listed').length);
"
```

Expected: `index hasVolume false`, `scrips without volume 0`, `marketWide 284`. `null changePct` should be small and non-zero, matching the single-row symbols.

- [ ] **Step 6: Typecheck and commit**

```bash
pnpm typecheck
git add scripts/site/build-manifest.ts scripts/site/__tests__/build-manifest.test.ts
git commit -m "feat: build a site manifest from the CSV dataset"
```

---

### Task 3: Astro scaffold, tokens, layout and the about page

**Files:**
- Create: `site/package.json`, `site/astro.config.mjs`, `site/tsconfig.json`
- Create: `site/src/styles/tokens.css`, `site/src/layouts/Base.astro`, `site/src/lib/manifest.ts`, `site/src/lib/format.ts`
- Create: `site/src/pages/about.astro`
- Create: `scripts/site/sync-data.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `site/src/data/manifest.json` from Task 2; `ManifestEntry`, `Manifest`, `Kind` types from `scripts/site/manifest-types.ts`.
- Produces: `site/src/lib/manifest.ts` exporting `manifest: Manifest`, `entries: ManifestEntry[]`, `byKind(kind: Kind): ManifestEntry[]`, `marketWide(): ManifestEntry[]`, `findEntry(symbol: string): ManifestEntry | undefined`; `site/src/lib/format.ts` exporting `formatNumber(value: number, dp?: number): string`, `formatChange(pct: number | null): string`, `formatDate(iso: string): string`, `csvPath(entry: ManifestEntry): string`. `Base.astro` accepts props `{ title: string; description: string }` and renders a `<slot />`.

- [ ] **Step 1: Scaffold the Astro project**

```bash
cd site && pnpm init && pnpm add astro lightweight-charts && cd ..
```

Then set `site/package.json` to exactly:

```json
{
  "name": "nepal-market-data-site",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "pnpm tsx ../scripts/site/build-manifest.ts && pnpm tsx ../scripts/site/sync-data.ts && astro dev",
    "build": "astro build",
    "check": "astro check"
  }
}
```

Keep whatever `dependencies` block `pnpm add` produced. Pin nothing by hand; the lockfile is the record. Verify `lightweight-charts` resolved to a 5.x version, because Task 5's API depends on it:

```bash
cd site && pnpm list lightweight-charts && cd ..
```

- [ ] **Step 2: Ignore the build artifacts**

Append to `.gitignore`:

```
# Site build artifacts. The manifest and the data copy are generated from data/ on every build,
# and committing 31MB of duplicated CSV into a repo whose whole point is the original would be absurd.
site/node_modules
site/dist
site/.astro
site/public/data
site/src/data/manifest.json
```

- [ ] **Step 3: Write the data sync script**

Create `scripts/site/sync-data.ts`:

```ts
import { cpSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Copies `data/` into `site/public/data` so the CSVs are served from the site's own origin.
 *
 * The charts fetch CSVs at runtime, so the files have to sit under the site's base path. Astro copies
 * everything in `public/` into `dist/`, which means one copy here covers both `astro dev` and the
 * deployed artifact, and the deploy workflow needs no separate assembly step.
 *
 * A symlink would avoid the 31MB copy, but symlinks in `public/` behave inconsistently across Astro
 * versions and platforms, and a wrong answer here is a site with no data at all.
 */
const target = join('site', 'public', 'data');
if (existsSync(target)) rmSync(target, { recursive: true });
cpSync('data', target, { recursive: true });
console.log(`Copied data/ to ${target}`);
```

- [ ] **Step 4: Configure Astro**

Create `site/astro.config.mjs`:

```js
import { defineConfig } from 'astro/config';

// GitHub reports this repo's Pages site at https://binayabaral.github.io/nepal-market-data/, so the
// base path is the repo name. Moving to a custom domain means setting SITE_BASE=/ and nothing else:
// every link and fetch in the site is built from import.meta.env.BASE_URL.
export default defineConfig({
  site: process.env.SITE_URL ?? 'https://binayabaral.github.io',
  base: process.env.SITE_BASE ?? '/nepal-market-data/',
  output: 'static',
  trailingSlash: 'ignore'
});
```

Create `site/tsconfig.json`:

```json
{
  "extends": "astro/tsconfigs/strict",
  "include": [".astro/types.d.ts", "**/*", "../scripts/site/manifest-types.ts"],
  "exclude": ["dist"]
}
```

The root `tsconfig.json` is not touched. It includes only `scripts/**/*.ts`, which already covers `scripts/site/`, so `pnpm typecheck` keeps working and the Astro side is checked separately by `astro check`.

- [ ] **Step 5: Write the tokens**

Create `site/src/styles/tokens.css`, copying the palette from `design-system/nepal-market-data/MASTER.md` without re-deriving any value:

```css
/*
 * Taken verbatim from design-system/nepal-market-data/MASTER.md, which took them from expensesync's
 * app/globals.css. Do not re-derive these values. No component may use a raw hex.
 */
:root {
  --background: #ffffff;
  --foreground: #09090b;
  --card: #ffffff;
  --primary: #16a34a;
  --muted: #f4f4f5;
  --muted-foreground: #71717a;
  --border: #e4e4e7;
  --destructive: #ef4444;
  --radius: 0.5rem;

  --space-xs: 2px;
  --space-sm: 4px;
  --space-md: 8px;
  --space-lg: 12px;
  --space-xl: 16px;
  --space-2xl: 24px;
  --space-3xl: 32px;

  --table-row-height: 36px;
  --card-padding: 12px;
  --grid-gap: 8px;
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);

  --font-sans: 'Geist', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-mono: 'Geist Mono', ui-monospace, 'SFMono-Regular', 'Menlo', monospace;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    --background: #0c0a09;
    --foreground: #f2f2f2;
    --card: #1c1917;
    --primary: #22c55e;
    --muted: #262626;
    --muted-foreground: #a1a1aa;
    --border: #27272a;
    --destructive: #f77373;
  }
}

:root[data-theme='dark'] {
  --background: #0c0a09;
  --foreground: #f2f2f2;
  --card: #1c1917;
  --primary: #22c55e;
  --muted: #262626;
  --muted-foreground: #a1a1aa;
  --border: #27272a;
  --destructive: #f77373;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.5;
}

.num {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

/* Direction is never carried by colour alone: every change value also has a + or - prefix. */
.up { color: var(--primary); }
.down { color: var(--destructive); }

.table-wrap { overflow-x: auto; }

table { border-collapse: collapse; width: 100%; }
th, td { padding: 0 var(--space-lg); height: var(--table-row-height); border-bottom: 1px solid var(--border); text-align: left; }
thead th { position: sticky; top: 0; background: var(--card); z-index: 1; }
tbody tr:hover { background: var(--muted); }

a { color: var(--primary); }
/* No green chrome inside a data region: inside data, green means "up" and nothing else. */
td a, th a { color: var(--foreground); }

:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
}
```

Fonts: load Geist and Geist Mono from Google Fonts in `Base.astro` with a real fallback stack, which is already in the token above. Do not self-host in this task.

- [ ] **Step 6: Write the manifest and format helpers**

Create `site/src/lib/manifest.ts`:

```ts
import type { Kind, Manifest, ManifestEntry } from '../../../scripts/site/manifest-types';
import raw from '../data/manifest.json';

export const manifest = raw as Manifest;
export const entries: ManifestEntry[] = manifest.entries;

export function byKind(kind: Kind): ManifestEntry[] {
  return entries.filter(entry => entry.kind === kind);
}

/**
 * The symbols any market-wide view may aggregate: top movers, breadth, sector rollups.
 * Filters on instrument type and status, never on "has a sector". See the plan's global constraints.
 */
export function marketWide(): ManifestEntry[] {
  return entries.filter(entry => entry.instrumentType === 'ordinary' && entry.status === 'listed');
}

export function findEntry(symbol: string): ManifestEntry | undefined {
  return entries.find(entry => entry.symbol === symbol);
}
```

Create `site/src/lib/format.ts`:

```ts
import type { ManifestEntry } from '../../../scripts/site/manifest-types';

export function formatNumber(value: number, dp = 2): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** Always prefixed, so direction survives greyscale and colourblindness. Blank data reads as an em-free dash. */
export function formatChange(pct: number | null): string {
  if (pct === null) return '-';
  const sign = pct > 0 ? '+' : pct < 0 ? '-' : '';
  return `${sign}${formatNumber(Math.abs(pct))}%`;
}

export function changeClass(pct: number | null): string {
  if (pct === null || pct === 0) return '';
  return pct > 0 ? 'up' : 'down';
}

export function formatDate(iso: string): string {
  return iso;
}

/** Where the raw CSV for an entry lives, relative to the site base. */
export function csvPath(entry: ManifestEntry): string {
  const dir =
    entry.kind === 'metal' ? 'precious-metals' : entry.kind === 'fund' ? 'sip-mutual-funds' : 'nepse';
  return `${import.meta.env.BASE_URL}data/${dir}/${entry.symbol}.csv`;
}
```

`formatDate` returns the ISO string unchanged on purpose: the dataset's dates are source-dated calendar days with no timezone, and reformatting them through `Date` would shift some of them by a day.

- [ ] **Step 7: Write the layout**

Create `site/src/layouts/Base.astro`:

```astro
---
import '../styles/tokens.css';

interface Props {
  title: string;
  description: string;
}

const { title, description } = Astro.props;
const base = import.meta.env.BASE_URL;
---

<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
    <meta name="description" content={description} />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap"
    />
  </head>
  <body>
    <header style="border-bottom:1px solid var(--border);padding:var(--space-lg) var(--space-xl);display:flex;gap:var(--space-xl);align-items:baseline">
      <a href={base} style="font-weight:600;text-decoration:none">Nepal Market Data</a>
      <nav style="display:flex;gap:var(--space-lg)">
        <a href={base}>Dashboard</a>
        <a href={`${base}about`}>About</a>
      </nav>
    </header>
    <main style="max-width:1440px;margin:0 auto;padding:var(--space-2xl) var(--space-xl)">
      <slot />
    </main>
    <footer style="border-top:1px solid var(--border);padding:var(--space-xl);color:var(--muted-foreground);font-size:12px">
      <p>
        Open data, MIT licensed. Source and raw CSVs:
        <a href="https://github.com/binayabaral/nepal-market-data">github.com/binayabaral/nepal-market-data</a>.
      </p>
      <p>Prices are as published by their sources. Nothing here is investment advice.</p>
    </footer>
  </body>
</html>
```

- [ ] **Step 8: Write the about page**

Create `site/src/pages/about.astro`. It uses `Base.astro`, and must state: what the three datasets are and their columns; that rows are source-dated, not run-dated; that NAV data is inherently at least one day behind because every source posts day D's NAV on D+1; that `CSBY` and `SFF` publish on weekdays only, so their weekend gaps are expected; that weekend and holiday gaps are real and no row is ever fabricated; that `sector` is the source's own vocabulary rather than a standard taxonomy, and that `government_bond` is a known misnomer where both rows are in fact bank bonds; the licence; and a link to the repo. Use prose at 16px on this page rather than the 14px used on data pages.

- [ ] **Step 9: Verify the build**

```bash
pnpm tsx scripts/site/build-manifest.ts
pnpm tsx scripts/site/sync-data.ts
cd site && pnpm build && pnpm check && cd ..
ls site/dist/data/nepse/NABIL.csv
```

Expected: the build succeeds, `astro check` reports 0 errors, and the CSV exists in `dist`, which proves the runtime fetch path will resolve.

- [ ] **Step 10: Commit**

```bash
git add .gitignore site scripts/site/sync-data.ts
git commit -m "feat: scaffold the Astro site with design tokens, layout and about page"
```

---

### Task 4: The chart island

**Files:**
- Create: `site/src/components/PriceChart.ts`
- Create: `site/src/components/ChartMount.astro`

**Interfaces:**
- Consumes: `lightweight-charts` 5.x.
- Produces: `ChartMount.astro` with props `{ csvUrl: string; kind: 'ohlc' | 'line'; hasVolume: boolean; label: string }`. `PriceChart.ts` exports `mountChart(root: HTMLElement): void`, driven entirely by `data-` attributes on `root` so no props cross the island boundary as JS.

This is the only hydrated component on the site. Everything else stays static markup.

- [ ] **Step 1: Write the chart module**

Create `site/src/components/PriceChart.ts`:

```ts
import {
  AreaSeries,
  CandlestickSeries,
  HistogramSeries,
  createChart,
  type IChartApi,
  type UTCTimestamp
} from 'lightweight-charts';

type Row = { time: UTCTimestamp; open: number; high: number; low: number; close: number; volume: number | null };

const RANGES = [
  { label: '1M', days: 31 },
  { label: '6M', days: 186 },
  { label: '1Y', days: 366 },
  { label: '5Y', days: 1827 },
  { label: 'All', days: Infinity }
] as const;

type RangeLabel = (typeof RANGES)[number]['label'];

/** Beyond this many bars candlesticks stop being legible, so wide ranges switch to a line. */
const CANDLE_RANGES: RangeLabel[] = ['1M', '6M', '1Y'];
const DEFAULT_RANGE: RangeLabel = '6M';

function toTimestamp(isoDate: string): UTCTimestamp {
  return (Date.parse(`${isoDate}T00:00:00Z`) / 1000) as UTCTimestamp;
}

/**
 * Parses the dataset's CSVs with a plain splitter rather than a library.
 *
 * Safe only because these three schemas are fixed and contain no quoted fields: dates and numbers
 * only. The reference tables DO contain quoted commas, but they are never fetched at runtime, they
 * are baked into the manifest at build time by the quote-aware reader in scripts/lib/csv-store.ts.
 */
function parse(text: string, valueColumn: string): Row[] {
  const lines = text.trim().split('\n');
  const header = (lines[0] ?? '').trim().split(',');
  const at = (name: string) => header.indexOf(name);
  const iDate = at('published_date');
  const iValue = at(valueColumn);
  const iOpen = at('open');
  const iHigh = at('high');
  const iLow = at('low');
  const iVol = at('traded_quantity');

  const rows: Row[] = [];
  for (const line of lines.slice(1)) {
    const f = line.trim().split(',');
    const date = f[iDate];
    const raw = f[iValue];
    if (!date || !raw) continue;
    const close = Number(raw);
    if (!Number.isFinite(close)) continue;
    const vol = iVol >= 0 ? Number(f[iVol] ?? '') : NaN;
    rows.push({
      time: toTimestamp(date),
      open: iOpen >= 0 ? Number(f[iOpen] ?? raw) : close,
      high: iHigh >= 0 ? Number(f[iHigh] ?? raw) : close,
      low: iLow >= 0 ? Number(f[iLow] ?? raw) : close,
      close,
      volume: Number.isFinite(vol) ? vol : null
    });
  }
  return rows;
}

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function mountChart(root: HTMLElement): void {
  const csvUrl = root.dataset.csvUrl ?? '';
  const valueColumn = root.dataset.valueColumn ?? 'close';
  const canCandle = root.dataset.kind === 'ohlc';
  const hasVolume = root.dataset.hasVolume === 'true';
  const container = root.querySelector<HTMLElement>('[data-chart-canvas]');
  const status = root.querySelector<HTMLElement>('[data-chart-status]');
  const caption = root.querySelector<HTMLElement>('[data-chart-caption]');
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-range]'));
  if (!container || !status) return;

  let chart: IChartApi | null = null;
  let rows: Row[] = [];
  let active: RangeLabel = DEFAULT_RANGE;

  function render(): void {
    if (!chart || rows.length === 0) return;
    const range = RANGES.find(r => r.label === active) ?? RANGES[1];
    const cutoff = rows[rows.length - 1]!.time - range.days * 86400;
    const visible = range.days === Infinity ? rows : rows.filter(r => r.time >= cutoff);
    const useCandles = canCandle && CANDLE_RANGES.includes(active);

    for (const s of chart.series?.() ?? []) chart.removeSeries(s);

    if (useCandles) {
      const s = chart.addSeries(CandlestickSeries, {
        upColor: token('--primary'),
        downColor: token('--destructive'),
        borderUpColor: token('--primary'),
        borderDownColor: token('--destructive'),
        wickUpColor: token('--primary'),
        wickDownColor: token('--destructive')
      });
      s.setData(visible);
      if (hasVolume) {
        const v = chart.addSeries(HistogramSeries, { priceScaleId: '', priceFormat: { type: 'volume' } });
        v.setData(
          visible
            .filter(r => r.volume !== null)
            .map(r => ({
              time: r.time,
              value: r.volume as number,
              color: r.close >= r.open ? `${token('--primary')}66` : `${token('--destructive')}66`
            }))
        );
        v.priceScale().applyOptions({ scaleMargins: { top: 0.75, bottom: 0 } });
      }
    } else {
      const s = chart.addSeries(AreaSeries, { lineColor: token('--primary'), topColor: 'transparent', bottomColor: 'transparent' });
      s.setData(visible.map(r => ({ time: r.time, value: r.close })));
    }

    chart.timeScale().fitContent();
    if (caption) {
      caption.textContent = useCandles
        ? `${visible.length} sessions, shown as candles.`
        : `${visible.length} sessions, shown as a closing-price line: this range holds more sessions than candles can show legibly.`;
    }
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.range === active));
  }

  async function load(): Promise<void> {
    try {
      const res = await fetch(csvUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      rows = parse(await res.text(), valueColumn);
      if (rows.length === 0) throw new Error('no rows');
      status.hidden = true;
      chart = createChart(container, {
        height: 420,
        layout: { background: { color: 'transparent' }, textColor: token('--muted-foreground') },
        grid: { vertLines: { color: token('--border') }, horzLines: { color: token('--border') } },
        rightPriceScale: { borderColor: token('--border') },
        timeScale: { borderColor: token('--border') }
      });

      // A range wider than the available history would render an identical view, so disable rather
      // than hide it: 42 symbols have fewer than 5 rows and one has a single row.
      const span = (rows[rows.length - 1]!.time - rows[0]!.time) / 86400;
      for (const b of buttons) {
        const r = RANGES.find(x => x.label === b.dataset.range);
        if (r && r.days !== Infinity && r.days > span) b.disabled = true;
      }
      if (RANGES.find(r => r.label === DEFAULT_RANGE)!.days > span) active = 'All';

      render();
      new ResizeObserver(() => chart?.applyOptions({ width: container.clientWidth })).observe(container);
    } catch (error) {
      // The prerendered latest numbers and the OHLC table are already on the page, so a failed
      // fetch degrades the chart only. The page is never blank.
      status.hidden = false;
      status.textContent = 'The chart could not load. The table below has the same data.';
      console.error(`Chart data failed for ${csvUrl}`, error);
    }
  }

  for (const b of buttons) {
    b.addEventListener('click', () => {
      active = (b.dataset.range as RangeLabel) ?? DEFAULT_RANGE;
      render();
    });
  }

  void load();
}

for (const el of document.querySelectorAll<HTMLElement>('[data-price-chart]')) mountChart(el);
```

**Version check before implementing:** the code above uses the lightweight-charts v5 API (`chart.addSeries(CandlestickSeries, ...)`). If `pnpm list lightweight-charts` from Task 3 shows v4, the calls are `chart.addCandlestickSeries(...)`, `chart.addHistogramSeries(...)` and `chart.addAreaSeries(...)` instead. Check first and use the API that matches the installed version rather than assuming. Likewise confirm `chart.series()` exists for the series-removal loop; if not, hold the created series in local variables and remove those.

- [ ] **Step 2: Write the mount component**

Create `site/src/components/ChartMount.astro`:

```astro
---
interface Props {
  csvUrl: string;
  kind: 'ohlc' | 'line';
  valueColumn: string;
  hasVolume: boolean;
  label: string;
}

const { csvUrl, kind, valueColumn, hasVolume, label } = Astro.props;
const ranges = ['1M', '6M', '1Y', '5Y', 'All'];
---

<section
  data-price-chart
  data-csv-url={csvUrl}
  data-kind={kind}
  data-value-column={valueColumn}
  data-has-volume={String(hasVolume)}
  aria-label={`Price chart for ${label}`}
>
  <div role="group" aria-label="Chart range" style="display:flex;gap:var(--space-sm);margin-bottom:var(--space-md)">
    {ranges.map(r => (
      <button type="button" data-range={r} aria-pressed={r === '6M'} style="cursor:pointer;padding:var(--space-sm) var(--space-lg);border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--foreground);font:inherit">
        {r}
      </button>
    ))}
  </div>
  <p data-chart-status style="color:var(--muted-foreground)">Loading the chart.</p>
  <div data-chart-canvas style="width:100%;min-height:420px"></div>
  <p data-chart-caption style="color:var(--muted-foreground);font-size:12px;margin-top:var(--space-md)"></p>
</section>

<script>
  import '../components/PriceChart.ts';
</script>
```

The range buttons are real `<button>` elements so they are keyboard reachable, and `aria-pressed` conveys which is active without relying on colour.

- [ ] **Step 3: Verify the island is the only script**

```bash
cd site && pnpm build && cd ..
ls site/dist/_astro/*.js | head
```

Expected: a small number of JS chunks, all traceable to the chart and lightweight-charts. If any page ships JS unrelated to the chart, an island boundary has leaked; fix it before continuing.

- [ ] **Step 4: Commit**

```bash
git add site/src/components
git commit -m "feat: add the price chart island with a range selector"
```

---

### Task 5: Stock pages

**Files:**
- Create: `site/src/components/OhlcTable.astro`
- Create: `site/src/pages/stocks/[symbol].astro`

**Interfaces:**
- Consumes: `byKind`, `findEntry` from `site/src/lib/manifest.ts`; `formatNumber`, `formatChange`, `changeClass`, `csvPath` from `site/src/lib/format.ts`; `ChartMount.astro` from Task 4.
- Produces: 432 routes at `/stocks/<SYMBOL>`. `OhlcTable.astro` takes props `{ csvUrl: string; rows: Array<Record<string, string>>; hasVolume: boolean }`.

- [ ] **Step 1: Write the OHLC fallback table**

Create `site/src/components/OhlcTable.astro`. It renders the most recent 60 rows of a price CSV, newest first, in a `.table-wrap` with columns Date, Open, High, Low, Close, Change and, only when `hasVolume` is true, Volume. Every numeric cell gets `class="num"`. Change values go through `formatChange` and `changeClass`, so they carry a sign as well as a colour. This table is prerendered at build time by reading the CSV with `readRows`, not fetched, which is what makes it the accessibility fallback: it is present with JavaScript disabled and when the chart's fetch fails.

Do not render the price CSV's `status` column. It is `A` in all 511,468 rows and carries no information, and it is a different column from the reference table's `status`.

- [ ] **Step 2: Write the stock page**

Create `site/src/pages/stocks/[symbol].astro`:

```astro
---
import { readRows } from '../../../../scripts/lib/csv-store';
import Base from '../../layouts/Base.astro';
import ChartMount from '../../components/ChartMount.astro';
import OhlcTable from '../../components/OhlcTable.astro';
import { byKind } from '../../lib/manifest';
import { changeClass, csvPath, formatChange, formatNumber } from '../../lib/format';

export function getStaticPaths() {
  // Every symbol gets a page, debentures and promoter shares included (reviewed 2026-08-24). The
  // market-wide filter governs aggregates, not who gets a page. The index is excluded: it is the
  // landing chart, not a scrip.
  return byKind('stock').map(entry => ({ params: { symbol: entry.symbol }, props: { entry } }));
}

const { entry } = Astro.props;
// Read from data/, not from the public/ copy, so a page is never built against a stale sync.
const rows = readRows(`data/nepse/${entry.symbol}.csv`);
const merged = entry.status === 'merged';
---

<Base
  title={`${entry.symbol} ${entry.name} price history | Nepal Market Data`}
  description={`Daily open, high, low, close and volume for ${entry.name} (${entry.symbol}) on NEPSE, ${entry.firstDate} to ${entry.latestDate}. Free CSV download.`}
>
  <h1 style="margin:0">{entry.symbol}</h1>
  <p style="margin:var(--space-sm) 0 var(--space-xl);color:var(--muted-foreground)">
    {entry.name}{entry.sector ? ` · ${entry.sector}` : ''} · {entry.instrumentType.replace(/_/g, ' ')}
  </p>

  {merged && (
    <p role="note" style="border:1px solid var(--border);border-left:3px solid var(--destructive);border-radius:var(--radius);padding:var(--space-lg);background:var(--muted)">
      This company no longer trades on NEPSE. Its last recorded session was {entry.latestDate}. It is
      excluded from market-wide views, and the history below is kept for reference.
    </p>
  )}

  <div style="display:flex;gap:var(--space-2xl);flex-wrap:wrap;margin:var(--space-xl) 0">
    <div><div style="color:var(--muted-foreground);font-size:12px">Last close</div><div class="num" style="font-size:24px">{formatNumber(entry.latestClose)}</div></div>
    <div><div style="color:var(--muted-foreground);font-size:12px">Change</div><div class:list={['num', changeClass(entry.changePct)]} style="font-size:24px">{formatChange(entry.changePct)}</div></div>
    <div><div style="color:var(--muted-foreground);font-size:12px">As of</div><div class="num" style="font-size:24px">{entry.latestDate}</div></div>
    <div><div style="color:var(--muted-foreground);font-size:12px">Sessions</div><div class="num" style="font-size:24px">{formatNumber(entry.rows, 0)}</div></div>
  </div>

  <ChartMount csvUrl={csvPath(entry)} kind="ohlc" valueColumn="close" hasVolume={entry.hasVolume} label={`${entry.symbol} ${entry.name}`} />

  <h2>Recent sessions</h2>
  <OhlcTable csvUrl={csvPath(entry)} rows={rows} hasVolume={entry.hasVolume} />

  <p><a href={csvPath(entry)} download>Download the full {entry.symbol} history as CSV</a> ({formatNumber(entry.rows, 0)} rows from {entry.firstDate}).</p>
</Base>
```

- [ ] **Step 3: Verify the page count and the edge cases**

```bash
cd site && pnpm build && cd ..
find site/dist/stocks -name '*.html' | wc -l
```

Expected: `432`.

Then check the four symbols most likely to break, all of which are real cases in this dataset:

```bash
ls site/dist/stocks/ | grep -E 'GBILD84-85|MND84-85' # slash symbols routed correctly
grep -c 'no longer trades' site/dist/stocks/BOKL/index.html   # merged banner present, expect 1
grep -c 'no longer trades' site/dist/stocks/NABIL/index.html  # absent on a live company, expect 0
```

The last check is the one that matters most: a nonzero count on NABIL means the price CSV's `status` was read instead of the reference table's.

Also open the single-row symbol found in Task 2's audit and confirm its page renders with the wide range buttons disabled rather than missing.

- [ ] **Step 4: Commit**

```bash
git add site/src/pages/stocks site/src/components/OhlcTable.astro
git commit -m "feat: add a page for every NEPSE symbol with an OHLC fallback table"
```

---

### Task 6: Fund and metal pages

**Files:**
- Create: `site/src/pages/funds/[symbol].astro`
- Create: `site/src/pages/metals/[slug].astro`

**Interfaces:**
- Consumes: the same helpers as Task 5.
- Produces: 14 routes at `/funds/<SYMBOL>`, 3 at `/metals/<slug>`.

- [ ] **Step 1: Write the fund page**

Model it on the stock page, with these differences: `getStaticPaths` maps `byKind('fund')`; the chart gets `kind="line"`, `valueColumn="nav"` and `hasVolume={false}`, because a NAV series has one value per day and no OHLC; the table has Date and NAV columns only; and the page states that NAV is published a day behind, since every source posts day D's NAV on D+1, so a missing same-day value is normal rather than an error. For `CSBY` and `SFF`, add that they publish on weekdays only, so weekend gaps are expected.

Read the AMC from `loadFundRefs`. **A blank `amc` omits the line entirely rather than rendering an empty label.** `SLK` is the blank one: its managing company is unconfirmed, and inventing one would be worse than saying nothing.

- [ ] **Step 2: Write the metal page**

Same shape: `byKind('metal')`, `kind="line"`, `valueColumn="price"`, `hasVolume={false}`, columns Date and Price. State that prices are NPR per tola as published by FENEGOSIDA, and that rates are published on Sundays and roughly half of Saturdays, so the calendar is not a weekday-only one.

- [ ] **Step 3: Verify**

```bash
cd site && pnpm build && cd ..
find site/dist/funds -name '*.html' | wc -l   # expect 14
find site/dist/metals -name '*.html' | wc -l  # expect 3
grep -ci 'amc\|asset manage' site/dist/funds/SLK/index.html  # expect 0: no empty AMC label
grep -c 'NIC Asia Capital' site/dist/funds/NI31/index.html   # expect 1 or more
```

- [ ] **Step 4: Commit**

```bash
git add site/src/pages/funds site/src/pages/metals
git commit -m "feat: add fund and metal pages with line charts"
```

---

### Task 7: The landing page

**Files:**
- Create: `site/src/components/SymbolTable.astro`
- Create: `site/src/pages/index.astro`

**Interfaces:**
- Consumes: `byKind`, `marketWide`, `findEntry` from `site/src/lib/manifest.ts`; `ChartMount.astro`.
- Produces: the route `/`.

- [ ] **Step 1: Write the symbol table**

Create `site/src/components/SymbolTable.astro`. It renders every entry of kind `stock`, `fund` and `metal`, so every symbol is reachable from the table as reviewed on 2026-08-24. Columns: Symbol (a link to its page), Name, Type, Sector, Last, Change, As of, Sessions.

Two behaviours:

- **A search input filters rows client-side** by symbol and name, case-insensitively. No search backend. Keep the script inline and tiny; it is not worth an island. It must degrade to a full unfiltered table with JavaScript off.
- **The table defaults to the 284 market-wide symbols**, with a toggle that reveals the other 148, each labelled by `instrumentType`. Implement this by rendering all rows and marking the non-market-wide ones with a `data-extra` attribute hidden by CSS, so the toggle needs no re-render and every row stays in the static HTML for search engines and for a no-JS reader.

A blank `sector` renders `-`. Never "Unknown", and never a guess.

- [ ] **Step 2: Write the landing page**

Create `site/src/pages/index.astro`. It contains, in order: an `h1` and one sentence saying what the dataset is; the NEPSE index chart via `ChartMount` with `kind="ohlc"`, `valueColumn="close"` and **`hasVolume={false}`**, because the index has no volume in any of its 6,685 rows; KPI cards for the index level, gold 24K, gold 22K and silver, each showing the latest value, its signed change and its as-of date; top five gainers and top five losers **computed from `marketWide()` only**, each excluding entries whose `changePct` is null; and the symbol table.

State the row count and date span somewhere on the page, read from the manifest rather than hardcoded, since both grow daily.

- [ ] **Step 3: Verify**

```bash
cd site && pnpm build && cd ..
grep -c 'data-has-volume="false"' site/dist/index.html  # expect 1: the index chart has no volume pane
```

Then confirm the movers are drawn from the filtered set: pick the top gainer shown on the page and check its reference row is `ordinary` and `listed`. A debenture or a merged shell appearing in movers means the filter was skipped.

- [ ] **Step 4: Commit**

```bash
git add site/src/pages/index.astro site/src/components/SymbolTable.astro
git commit -m "feat: add the landing dashboard with index chart, movers and symbol table"
```

---

### Task 8: Build assertions and the smoke test

**Files:**
- Create: `scripts/site/smoke-test.ts`
- Modify: `package.json` (add `site:build` and `site:smoke`)

**Interfaces:**
- Consumes: `site/dist/`, `site/src/data/manifest.json`, `data/`.
- Produces: `pnpm site:smoke`, exiting non-zero with a named failure.

- [ ] **Step 1: Write the smoke test**

Create `scripts/site/smoke-test.ts`. It runs against `site/dist` after a build and asserts, failing with a specific message naming the offending file:

1. **Page count matches the manifest.** `stock + fund + metal` entries plus the landing and about pages equals the number of `index.html` files in `dist`. Derive the expected number from the manifest; do not hardcode 451, because it grows as scrips list.
2. **Every CSV in `data/` is covered by a manifest entry**, and every entry has a file. This is the check that catches a new listing that the reference refresh has not picked up.
3. **Every symbol page contains both a chart container and an OHLC table.** Assert on `data-price-chart` and on a `<table` inside the page.
4. **A sampled page's prerendered latest close equals the last row of its CSV.** Sample at least 20 pages across all four kinds, including one merged symbol and the single-row symbol. This is what catches an off-by-one in the manifest.
5. **`dist/data/` is populated**, so the runtime fetch path resolves. Check one file per dataset.
6. **No page renders the string `NaN`, `undefined`, or `Unknown`.** These are the visible symptoms of the blank-field cases in the spec's edge table.

- [ ] **Step 2: Add the scripts**

In the root `package.json`:

```json
"site:build": "pnpm tsx scripts/site/build-manifest.ts && pnpm tsx scripts/site/sync-data.ts && pnpm --dir site build",
"site:smoke": "pnpm tsx scripts/site/smoke-test.ts"
```

- [ ] **Step 3: Run them and confirm they can fail**

```bash
pnpm site:build && pnpm site:smoke
```

Expected: all checks pass.

Then prove the smoke test is not vacuous. Temporarily delete one page from `dist` and re-run:

```bash
rm -rf site/dist/stocks/NABIL && pnpm site:smoke; echo "exit=$?"
```

Expected: a non-zero exit naming the missing page. Then `pnpm site:build` to restore. A smoke test that passes here is not testing anything and must be fixed.

- [ ] **Step 4: Commit**

```bash
git add package.json scripts/site/smoke-test.ts
git commit -m "test: add post-build smoke assertions for the site"
```

---

### Task 9: The deploy workflow

**Files:**
- Create: `.github/workflows/deploy-site.yml`

**Interfaces:**
- Consumes: `pnpm site:build`, `pnpm site:smoke`.
- Produces: a Pages deployment at `https://binayabaral.github.io/nepal-market-data/`.

Pages is already enabled on this repo with source = GitHub Actions, verified 2026-08-24 (`build_type: workflow`). No manual step remains.

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/deploy-site.yml`:

```yaml
name: Deploy Site

on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  # Deliberately NOT the shared `commit-data` group. That group exists to serialise the workflows
  # that push commits to this branch; this one only reads. Joining it would make every deploy queue
  # behind the scrapers for no reason. cancel-in-progress is correct here because deploys are
  # idempotent and only the newest matters, the opposite of the scrapers' cancel-in-progress: false.
  group: deploy-site
  cancel-in-progress: true

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - uses: pnpm/action-setup@v6
        with:
          version: 11.14.0
          run_install: false

      - uses: actions/setup-node@v7
        with:
          node-version: '22'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Install site dependencies
        run: pnpm --dir site install --frozen-lockfile

      - name: Typecheck
        run: pnpm typecheck

      - name: Test
        run: pnpm test

      - name: Build the site
        run: pnpm site:build

      - name: Smoke test the build
        run: pnpm site:smoke

      - uses: actions/upload-pages-artifact@v4
        with:
          path: site/dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deploy.outputs.page_url }}
    steps:
      - id: deploy
        uses: actions/deploy-pages@v4
```

The build job runs the smoke test before uploading, so a broken build fails instead of deploying.

- [ ] **Step 2: Decide the lockfile question before pushing**

`site/` has its own `package.json`, so `pnpm --dir site install --frozen-lockfile` needs `site/pnpm-lock.yaml` committed. Confirm it exists and is committed:

```bash
ls site/pnpm-lock.yaml && git status --short site/
```

If the repo would rather have one lockfile, convert `site/` into a pnpm workspace member instead by adding a root `pnpm-workspace.yaml` with `packages: [site]`, drop the second install step, and re-run `pnpm install`. Either is fine, but pick one deliberately: a `--frozen-lockfile` against a missing lockfile fails the workflow.

- [ ] **Step 3: Commit and push, then verify the real deployment**

```bash
git add .github/workflows/deploy-site.yml site/pnpm-lock.yaml
git commit -m "ci: build and deploy the site to GitHub Pages"
git push
gh run watch
```

Then verify the deployed site rather than trusting a green check:

```bash
gh api repos/binayabaral/nepal-market-data/pages --jq '{status, html_url}'
curl -sSI https://binayabaral.github.io/nepal-market-data/ | head -1
curl -sS https://binayabaral.github.io/nepal-market-data/data/nepse/NABIL.csv | head -2
curl -sSI https://binayabaral.github.io/nepal-market-data/stocks/NABIL | head -1
```

Expected: `status` becomes `built`, the pages return `200`, and the CSV request returns real rows. That last check is the important one: it proves the same-origin runtime fetch works in production, which is the assumption the whole chart design rests on.

- [ ] **Step 4: Manual pass against the design system checklist**

Work through the Pre-Delivery Checklist in `design-system/nepal-market-data/MASTER.md` against the deployed site: contrast in both light and dark, visible focus rings, keyboard access to the range selector and the sortable headers, `prefers-reduced-motion`, no horizontal page scroll at 375 / 768 / 1024 / 1440, tabular numerals on numeric columns, and candles readable in greyscale. Fix what fails, then commit the fixes.

- [ ] **Step 5: Update the context files**

Per `CLAUDE.md`, fold the outcome into `.claude/CONTEXT.md` and prepend a dated entry to `.claude/LOG.md` describing what was built and any decision that changed during implementation. Those two files are gitignored on purpose and stay local.

---

## Self-Review

**Spec coverage.** Walked each spec section against the tasks: architecture and the `site/` layout (Task 3); the deploy-via-Actions decision and its rationale (Task 9); the base path env var (Task 3); the data-flow table and `build-manifest.ts` (Tasks 1 and 2); reuse of `readRows` rather than a second parser (global constraint, Tasks 1, 2, 5); the runtime fetch and small splitter (Task 4); the routes table at 451 pages (Tasks 5, 6, 7 and asserted in Task 8); the 284 filter and the never-filter-on-sector rule (global constraint, Tasks 1, 7); visual design and tokens (Task 3); charts, the range selector, the candle-to-line switch and the required OHLC fallback (Tasks 4, 5); the full error and edge table (merged banner Task 5, blank `amc` Task 6, blank `sector` Task 7, fetch failure Task 4, few rows Task 4, weekend gaps Tasks 3 and 6); testing and verification (Task 8 plus per-task verify steps); deployment and concurrency (Task 9). No spec section is unimplemented.

**Placeholder scan.** No TBDs. Two tasks describe pages in prose rather than full code, Task 6's fund and metal pages and Task 7's table, because both are stated as explicit deltas from the fully-written Task 5 page and listing 200 near-identical lines twice would invite copy errors rather than prevent them. Every behavioural requirement in them is named concretely, including which value is blank for which symbol.

**Type consistency.** `ManifestEntry` field names are camelCase throughout (`latestClose`, `changePct`, `instrumentType`, `hasVolume`) and used identically in `build-manifest.ts`, `site/src/lib/manifest.ts`, `format.ts` and every page. `ChartMount`'s five props match the five `data-` attributes `PriceChart.ts` reads. `isMarketWide(ref: SymbolRef)` in Node and `marketWide()` in the site apply the same two-column predicate; they are separate functions because one takes a `SymbolRef` and the other filters `ManifestEntry`, and both carry the comment explaining why the sector test is wrong.

**Two spec figures corrected against the real data.** The spec says 504,813 NEPSE rows; the audit counted 511,468, since the dataset grows daily. Nothing depends on the literal number, and Task 8 derives counts from the manifest rather than hardcoding them. The spec also says volume bars sit beneath every candlestick chart; that is true for scrips but false for the index, which has no volume in any of its 6,685 rows, so `hasVolume` carries the distinction.

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-08-24-market-data-site.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
