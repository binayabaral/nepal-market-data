/**
 * Post-build smoke assertions for the static site.
 *
 * Runs against `site/dist` after `pnpm site:build`. Every check fails loudly with a message naming
 * the offending file, so a broken build fails a CI step instead of silently deploying.
 *
 * This script is invoked as `pnpm tsx scripts/site/smoke-test.ts` from a root package.json script,
 * and it assumes the process cwd is the REPO ROOT (same assumption `scripts/site/sync-data.ts`
 * makes). All paths below ('data/...', 'site/dist/...', 'site/src/data/manifest.json') are plain
 * relative paths for that reason. That is NOT safe inside `site/`: `pnpm --dir site build` changes
 * cwd to `site/` for that one step, which is exactly the bug `site/src/lib/dataDir.ts` documents
 * (a bare relative 'data/...' resolved against `site/` and silently produced an empty accessibility
 * table). This script never runs with that cwd, so no DATA_DIR-style resolution is needed here.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { Kind, Manifest, ManifestEntry } from './manifest-types';

const DIST = 'site/dist';
const DATA = 'data';

let failures = 0;

function fail(message: string): void {
  failures++;
  console.error(`FAIL: ${message}`);
}

function ok(message: string): void {
  console.log(`ok  - ${message}`);
}

/** Mirrors `site/src/lib/format.ts`'s `formatNumber`, kept local so this script needs no Astro types. */
function formatNumber(value: number, dp = 2): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function readManifest(): Manifest {
  const path = 'site/src/data/manifest.json';
  if (!existsSync(path)) {
    fail(`${path} does not exist. Run \`pnpm site:build\` first.`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, 'utf8')) as Manifest;
}

/** Every `index.html` under `dist`, as paths relative to `dist`. */
function listDistPages(dir: string, base = dir): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...listDistPages(full, base));
    } else if (name === 'index.html') {
      out.push(full.slice(base.length + 1));
    }
  }
  return out;
}

function csvStems(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(name => name.endsWith('.csv'))
    .map(name => name.slice(0, -'.csv'.length));
}

/**
 * Maps a manifest `kind` to its site route segment and data subdirectory. The index has its own
 * dedicated page at `/nepse-index/` (added so the deepest series in the dataset, 6,687 rows back
 * to 1997, has a page and a CSV link like every stock, fund and metal). Unlike the other kinds it
 * is not `<segment>/<symbol>/`, since there is exactly one index and no symbol directory for it;
 * `distPagePath` below special-cases it instead of going through `ROUTE_DIR`. Its data still lives
 * in `nepse/` alongside the stock CSVs (see `DATA_SUBDIR`).
 */
const ROUTE_DIR: Record<Exclude<Kind, 'index'>, string> = { stock: 'stocks', fund: 'funds', metal: 'metals' };
const DATA_SUBDIR: Record<Kind, string> = {
  stock: 'nepse',
  index: 'nepse',
  fund: 'sip-mutual-funds',
  metal: 'precious-metals'
};

function distPagePath(entry: ManifestEntry): string | null {
  if (entry.kind === 'index') return join('nepse-index', 'index.html');
  return join(ROUTE_DIR[entry.kind], entry.symbol, 'index.html');
}

function csvPath(entry: ManifestEntry): string {
  return join(DATA, DATA_SUBDIR[entry.kind], `${entry.symbol}.csv`);
}

/**
 * Where the built site serves an entry's CSV from, i.e. exactly what the page's runtime fetch
 * requests. Shares `DATA_SUBDIR` with `csvPath` above, which is the same kind-to-directory mapping
 * `csvPath` in `site/src/lib/format.ts` uses to build the `data-csv-url` the chart fetches
 * (metal -> precious-metals, fund -> sip-mutual-funds, stock/index -> nepse). Deriving both from one
 * constant means this assertion and the runtime agree by construction, not by coincidence.
 */
function distDataPath(entry: ManifestEntry): string {
  return join(DIST, 'data', DATA_SUBDIR[entry.kind], `${entry.symbol}.csv`);
}

function valueColumn(kind: Kind): string {
  return kind === 'fund' ? 'nav' : kind === 'metal' ? 'price' : 'close';
}

function readLastCsvValue(path: string, column: string): number | null {
  if (!existsSync(path)) return null;
  const lines = readFileSync(path, 'utf8').split('\n').filter(l => l.length > 0);
  const header = lines[0];
  const last = lines[lines.length - 1];
  if (!header || !last || lines.length < 2) return null;
  const cols = header.split(',');
  const idx = cols.indexOf(column);
  if (idx === -1) return null;
  const fields = last.split(',');
  const raw = fields[idx];
  if (raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// --- Load inputs -----------------------------------------------------------------------------

const manifest = readManifest();
const entries = manifest.entries;
// Every kind gets a page now, the index included (its own /nepse-index/ page), so pageEntries is
// just all manifest entries; distPagePath handles the index's different route shape.
const pageEntries = entries;

// --- Assertion (a): page count matches the manifest ------------------------------------------

function checkPageCount(): void {
  // The three section browse pages (/stocks/, /funds/, /metals/) are real index routes alongside
  // the per-symbol [symbol].astro routes in the same directories, not derived per manifest entry,
  // so they are listed explicitly here rather than falling out of the pageEntries loop below.
  const expectedPaths = new Set<string>([
    'index.html',
    join('about', 'index.html'),
    join('stocks', 'index.html'),
    join('funds', 'index.html'),
    join('metals', 'index.html')
  ]);
  for (const entry of pageEntries) {
    const p = distPagePath(entry);
    if (p) expectedPaths.add(p);
  }

  for (const expected of expectedPaths) {
    const full = join(DIST, expected);
    if (!existsSync(full)) fail(`expected page missing: ${full}`);
  }

  const actualPaths = listDistPages(DIST);
  const actualSet = new Set(actualPaths);
  for (const actual of actualPaths) {
    if (!expectedPaths.has(actual)) fail(`unexpected page in dist with no manifest entry: ${join(DIST, actual)}`);
  }

  if (expectedPaths.size !== actualSet.size) {
    fail(
      `page count mismatch: manifest implies ${expectedPaths.size} pages (stock+fund+metal+index entries plus landing and about), dist has ${actualSet.size} index.html files`
    );
  } else {
    ok(`page count matches the manifest (${actualSet.size} pages)`);
  }
}

// --- Assertion (b): every CSV in data/ is covered, and every entry has a file ------------------

function checkCsvCoverage(): void {
  const bySubdir: Record<string, ManifestEntry[]> = {};
  for (const entry of entries) {
    const subdir = DATA_SUBDIR[entry.kind];
    (bySubdir[subdir] ??= []).push(entry);
  }

  for (const subdir of new Set(Object.values(DATA_SUBDIR))) {
    const stems = new Set(csvStems(join(DATA, subdir)));
    const covered = new Set((bySubdir[subdir] ?? []).map(e => e.symbol));

    for (const stem of stems) {
      if (!covered.has(stem)) {
        fail(`${join(DATA, subdir, `${stem}.csv`)} has no manifest entry (a scrip the reference refresh hasn't picked up yet)`);
      }
    }
    for (const entry of bySubdir[subdir] ?? []) {
      const path = csvPath(entry);
      if (!existsSync(path)) fail(`manifest entry "${entry.symbol}" (${entry.kind}) has no backing file at ${path}`);
    }
  }
  if (failures === 0) ok('every CSV in data/ is covered by a manifest entry, and vice versa');
}

// --- Assertion (c): every symbol page has a chart container and a populated table -------------

/** Tolerant of Astro's `data-astro-cid-*` scoping attribute on `<tbody>`/`<tr>`, e.g. `<tbody data-astro-cid-xrtzpylp>`. A bare `<tbody>` pattern does not match that and would false-pass an empty table. */
const TBODY_RE = /<tbody[^>]*>([\s\S]*?)<\/tbody>/;
const TR_RE = /<tr[ >]/g;

function checkTablesPopulated(): void {
  let checked = 0;
  for (const entry of pageEntries) {
    const p = distPagePath(entry);
    if (!p) continue;
    const full = join(DIST, p);
    if (!existsSync(full)) continue; // already reported by checkPageCount
    const html = readFileSync(full, 'utf8');

    if (!html.includes('data-price-chart')) {
      fail(`${full}: missing the chart container (no data-price-chart)`);
      continue;
    }

    const bodyMatch = TBODY_RE.exec(html);
    if (!bodyMatch) {
      fail(`${full}: no <tbody> found for the OHLC/value table`);
      continue;
    }
    const rowCount = ((bodyMatch[1] ?? '').match(TR_RE) ?? []).length;
    const expectedRows = Math.min(60, entry.rows);
    if (rowCount !== expectedRows) {
      fail(`${full}: table has ${rowCount} row(s), expected ${expectedRows} (min(60, ${entry.rows}))`);
      continue;
    }
    checked++;
  }
  if (failures === 0) ok(`every symbol page (${checked}) has a chart container and a populated table`);
}

// --- Assertion (d): a sampled page's prerendered latest close matches its CSV's last row ------

function extractStatValue(html: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<div[^>]*>${escaped}</div><div class="num" style="font-size:24px[^"]*">([^<]+)</div>`);
  const m = re.exec(html);
  return m?.[1] ?? null;
}

function checkPrerenderedLatestClose(entry: ManifestEntry, htmlPath: string, label: string): void {
  if (!existsSync(htmlPath)) return; // already reported by checkPageCount
  const html = readFileSync(htmlPath, 'utf8');
  const rendered = extractStatValue(html, label);
  if (rendered === null) {
    fail(`${htmlPath}: could not find the "${label}" stat to check against the CSV`);
    return;
  }

  const csv = csvPath(entry);
  const column = valueColumn(entry.kind);
  const lastValue = readLastCsvValue(csv, column);
  if (lastValue === null) {
    fail(`${csv}: could not read a last "${column}" value to compare against ${htmlPath}`);
    return;
  }

  const expected = formatNumber(lastValue);
  if (rendered !== expected) {
    fail(`${htmlPath}: rendered "${label}" is ${rendered}, but the last row of ${csv} is ${expected}`);
  }
}

/** Picks a spread of at least 20 pages across all four manifest kinds, always including the merged symbol (BOKL) and the single-row symbol (BOKD86). */
function sampleEntries(): ManifestEntry[] {
  const stocks = entries.filter(e => e.kind === 'stock').sort((a, b) => a.symbol.localeCompare(b.symbol));
  const funds = entries.filter(e => e.kind === 'fund');
  const metals = entries.filter(e => e.kind === 'metal');

  const mustHave = ['BOKL', 'BOKD86'];
  const chosen = new Map<string, ManifestEntry>();
  for (const symbol of mustHave) {
    const found = stocks.find(e => e.symbol === symbol);
    if (!found) fail(`sample setup: required symbol "${symbol}" not found in the manifest`);
    else chosen.set(symbol, found);
  }
  // Spread across the sorted stock list so the sample isn't clustered alphabetically.
  const step = Math.max(1, Math.floor(stocks.length / 10));
  for (let i = 0; i < stocks.length && chosen.size < 12; i += step) {
    const entry = stocks[i];
    if (entry) chosen.set(entry.symbol, entry);
  }
  for (const entry of funds) chosen.set(entry.symbol, entry);
  for (const entry of metals) chosen.set(entry.symbol, entry);

  return [...chosen.values()];
}

function checkSampledLatestClose(): void {
  const sample = sampleEntries();
  for (const entry of sample) {
    const p = distPagePath(entry);
    if (!p) continue;
    const label = entry.kind === 'fund' ? 'Last NAV' : entry.kind === 'metal' ? 'Last price' : 'Last close';
    checkPrerenderedLatestClose(entry, join(DIST, p), label);
  }

  // The index has a KPI card on the landing page AND its own dedicated page at /nepse-index/
  // (added so the deepest series in the dataset has a page and a CSV link like every other
  // symbol); both prerendered stats are checked against the same CSV.
  const indexEntry = entries.find(e => e.symbol === 'NEPSE_INDEX');
  if (indexEntry) {
    checkPrerenderedLatestClose(indexEntry, join(DIST, 'index.html'), 'NEPSE Index');
    checkPrerenderedLatestClose(indexEntry, join(DIST, 'nepse-index', 'index.html'), 'Last level');
  } else {
    fail('sample setup: NEPSE_INDEX entry not found in the manifest');
  }

  const total = sample.length + (indexEntry ? 1 : 0);
  if (total < 20) fail(`sample size is only ${total}, expected at least 20 pages across all four kinds`);
  if (failures === 0) ok(`sampled ${total} pages across all four kinds, including BOKL (merged) and BOKD86 (single-row); prerendered latest close matches the CSV`);
}

// --- Assertion (e): site/dist/data/ has every manifest entry's CSV, at the exact fetch path ---

/**
 * A spot check on just one file per dataset ("is the sync step populated at all") cannot catch a
 * single missing symbol: a partial copy, a symbol newly added to the manifest whose CSV never got
 * synced, or a filename mismatch on one of the slash-derived symbols (GBILD84-85 and friends). That
 * gap is exactly the realistic failure mode, so every manifest entry's CSV is checked at the exact
 * path its page fetches from, via `distDataPath` (which shares its kind-to-directory mapping with
 * `csvPath` above and with the site's own `csvPath` in `site/src/lib/format.ts`). ~456 existsSync
 * calls, negligible next to the rest of the build.
 */
function checkDistDataPopulated(): void {
  let checked = 0;
  for (const entry of entries) {
    const path = distDataPath(entry);
    if (!existsSync(path)) {
      fail(`${path} is missing from the built site's data directory; ${entry.symbol}'s page runtime fetch would 404`);
      continue;
    }
    const size = statSync(path).size;
    if (size === 0) fail(`${path} exists but is empty; ${entry.symbol}'s page runtime fetch would load no data`);
    else checked++;
  }
  if (failures === 0) ok(`site/dist/data/ has every manifest entry's CSV at its fetch path (checked ${checked})`);
}

// --- Assertion (f): no page renders NaN, undefined, or Unknown --------------------------------

function checkNoBadStrings(): void {
  const badStrings = ['NaN', 'undefined', 'Unknown'];
  const pages = listDistPages(DIST);
  for (const page of pages) {
    const full = join(DIST, page);
    const html = readFileSync(full, 'utf8');
    for (const bad of badStrings) {
      if (html.includes(bad)) fail(`${full} renders the literal string "${bad}"`);
    }
  }
  if (failures === 0) ok(`no page (of ${pages.length}) renders NaN, undefined, or Unknown`);
}

// --- Assertion (g): landing page movers are market-wide only ----------------------------------

function checkMoversAreMarketWide(): void {
  const landingPath = join(DIST, 'index.html');
  if (!existsSync(landingPath)) return; // already reported
  const html = readFileSync(landingPath, 'utf8');

  function moversBlock(heading: string): string {
    const start = html.indexOf(`>${heading}</h2>`);
    if (start === -1) {
      fail(`${landingPath}: could not find the "${heading}" section`);
      return '';
    }
    const end = html.indexOf('</table>', start);
    return html.slice(start, end === -1 ? undefined : end);
  }

  const byId = new Map(entries.map(e => [e.symbol, e]));
  for (const heading of ['Top gainers', 'Top losers']) {
    const block = moversBlock(heading);
    const symbols = [...block.matchAll(/\/stocks\/([A-Za-z0-9._-]+)"/g)]
      .map(m => m[1])
      .filter((s): s is string => s !== undefined);
    if (symbols.length === 0) {
      fail(`${landingPath}: "${heading}" section listed no symbols`);
      continue;
    }
    for (const symbol of symbols) {
      const entry = byId.get(symbol);
      if (!entry) {
        fail(`${landingPath}: "${heading}" lists "${symbol}", which has no manifest entry`);
        continue;
      }
      if (entry.instrumentType !== 'ordinary' || entry.status !== 'listed') {
        fail(
          `${landingPath}: "${heading}" lists "${symbol}" (instrumentType=${entry.instrumentType}, status=${entry.status}), which is not ordinary+listed; the market-wide filter was skipped`
        );
      }
    }
  }
  if (failures === 0) ok('landing page movers contain only ordinary, listed symbols');
}

// --- Run ----------------------------------------------------------------------------------------

checkPageCount();
checkCsvCoverage();
checkTablesPopulated();
checkSampledLatestClose();
checkDistDataPopulated();
checkNoBadStrings();
checkMoversAreMarketWide();

if (failures > 0) {
  console.error(`\n${failures} smoke check(s) failed.`);
  process.exit(1);
}
console.log('\nAll smoke checks passed.');
