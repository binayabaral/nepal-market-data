/**
 * Minimal CSV read/append helpers shared by every daily and backfill script in this repo.
 * There is no database here, the CSV files themselves ARE the data store, so every script
 * goes through these instead of hand-rolling file I/O.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Wraps a field in quotes and escapes embedded quotes if it contains a comma, quote, or newline. */
function escapeCsvField(value: string | number): string {
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Parses one CSV line into raw field strings, honoring quoted fields (RFC 4180-ish). */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

function readNonEmptyLines(filePath: string): string[] {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf8').split('\n').filter(line => line.length > 0);
}

/**
 * True only for a real calendar date written exactly as `YYYY-MM-DD`.
 *
 * Sources do emit impossible dates: Nabil's history served `2024-00-03` (month zero) alongside a
 * separate, legitimate `2024-01-03`. A bad date is worse than a missing row, because dedup keys on
 * `published_date`, so once written it can never be corrected. The round-trip through `Date.UTC`
 * rejects overflow like `2024-02-30`, which a regex alone would accept.
 */
function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
  );
}

/** The last row in the file as a header-keyed object, or null if the file doesn't exist or has no data rows. */
function readLastRow(filePath: string): Record<string, string> | null {
  const lines = readNonEmptyLines(filePath);
  const headerLine = lines[0];
  const lastLine = lines[lines.length - 1];
  if (lines.length < 2 || headerLine === undefined || lastLine === undefined) return null;

  const header = parseCsvLine(headerLine);
  const values = parseCsvLine(lastLine);
  const row: Record<string, string> = {};
  header.forEach((col, i) => {
    row[col] = values[i] ?? '';
  });
  return row;
}

/**
 * The file-name-safe form of a market symbol, for the one-file-per-symbol layout.
 *
 * Three NEPSE debentures are named after a fiscal-year span and carry a slash: `GBILD84/85`,
 * `MND84/85`, `NICAD85/86`. Passing those straight to `join()` silently produced a DIRECTORY
 * (`data/nepse/GBILD84/85.csv`), because `appendRows` creates missing parents, which split the
 * symbol across a folder and a file name and hid those scrips from any `data/nepse/*.csv` glob.
 *
 * A slash becomes a hyphen, so `GBILD84/85` lives in `GBILD84-85.csv`. Anything else outside
 * `[A-Za-z0-9._-]` is replaced too, so a new symbol shape cannot reintroduce the same class of bug.
 * The upstream history repo has no name needing this, so nothing has to match its convention.
 */
export function symbolToFileName(symbol: string): string {
  const safe = symbol.trim().replace(/\//g, '-').replace(/[^A-Za-z0-9._-]/g, '-');
  if (!safe || safe === '.' || safe === '..') throw new Error(`Symbol "${symbol}" has no usable file name`);
  return `${safe}.csv`;
}

/**
 * What one `appendRows` call did: how many rows it actually added, and how many it refused because
 * the source dated them with something that is not a real `YYYY-MM-DD` calendar date.
 *
 * The two are reported separately because they mean opposite things. `added: 0` is the normal,
 * healthy outcome of a daily run on a day the source published nothing new. `skippedInvalid > 0`
 * means the source changed shape and the value could not be filed at all, which used to be
 * indistinguishable from a dedup no-op and so was reported as "already on file, nothing to do".
 */
export type AppendResult = { added: number; skippedInvalid: number };

/**
 * Adds only the rows whose `published_date` isn't already on file, and leaves the file sorted
 * ascending by date. Creates the file with its header row (and parent directory) if needed.
 * Callers don't need to pre-sort.
 *
 * Rows already on file are never modified or replaced, so this only ever fills in missing dates.
 * That is what makes a backfill safe to re-run at any time, in any order relative to the daily
 * scripts: seeding history after a daily run has already written today merges the history in
 * around it instead of dumping 2011-onward rows underneath today's.
 *
 * A merge-and-rewrite is used rather than a plain append because the two can produce an
 * out-of-order file: a daily run writes the newest date first, and a backfill run afterwards
 * would append every older date below it. Rewriting also repairs a file that is already
 * out of order. Files here are at most a few thousand short rows, so the cost is trivial, and
 * git still sees a one-line change when a daily run adds one row at the end.
 */
export function appendRows(
  filePath: string,
  header: string[],
  rows: Array<Record<string, string | number>>
): AppendResult {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const lines = readNonEmptyLines(filePath);
  const existingHeader = lines[0] ?? header.join(',');

  // Existing rows get re-parsed and trimmed rather than carried through verbatim, so a value that
  // arrived with stray whitespace gets repaired instead of lingering. Kumari served ten dates as
  // "2024-11-20\t", which would have become a second row for the same day as soon as the source
  // sent that date cleanly.
  let mutated = false;
  const existing: Array<{ date: string; line: string }> = [];
  for (const line of lines.slice(1)) {
    const fields = parseCsvLine(line).map(field => field.trim());
    const date = fields[0] ?? '';
    if (!isValidIsoDate(date)) {
      console.warn(`${filePath}: dropping row with unusable date "${date}"`);
      mutated = true;
      continue;
    }
    const normalized = fields.map(escapeCsvField).join(',');
    if (normalized !== line) mutated = true;
    existing.push({ date, line: normalized });
  }
  const onFile = new Set(existing.map(row => row.date));

  const added: Array<{ date: string; line: string }> = [];
  let skippedInvalid = 0;
  for (const row of rows) {
    const values = header.map(col => String(row[col] ?? '').trim());
    const date = String(row.published_date ?? '').trim();
    if (!isValidIsoDate(date)) {
      console.warn(`${filePath}: skipping row the source dated "${date}"`);
      skippedInvalid++;
      continue;
    }
    if (onFile.has(date)) continue;
    onFile.add(date); // also dedups repeated dates inside a single batch
    added.push({ date, line: values.map(escapeCsvField).join(',') });
  }

  const isSorted = existing.every((row, i) => {
    const previous = existing[i - 1];
    return previous === undefined || previous.date <= row.date;
  });
  if (added.length === 0 && isSorted && !mutated) return { added: 0, skippedInvalid };

  const merged = [...existing, ...added].sort((a, b) => a.date.localeCompare(b.date));
  writeFileSync(filePath, [existingHeader, ...merged.map(row => row.line)].join('\n') + '\n');
  return { added: added.length, skippedInvalid };
}

/**
 * Runs the daily "fetch the latest published value and append it if it's new" pattern shared by
 * every daily script in this repo.
 *
 * `published_date` always means the date the value APPLIES to, never the date we happened to look.
 * So `fetchLatest` should return the source's own date whenever the source exposes one; `today`
 * is only the fallback for sources that publish a bare latest value with no date attached. This
 * has to match what the backfill scripts write, otherwise the same value lands under two
 * different dates and re-running a backfill to heal a gap gets blocked by the dedup in
 * `appendRows` (it keys on `published_date`), silently keeping the wrong row forever.
 *
 * Nothing is fabricated for days the source didn't publish. On a market holiday the source still
 * serves the previous session's value under its own earlier date, so dedup sees that date already
 * on file and appends nothing, which is the correct outcome rather than inventing a row.
 *
 * A failed fetch is therefore never fatal on its own: the next run or a backfill re-run fills it
 * in. Only a failure with no prior data at all is a real problem (first-ever run broke) worth a
 * non-zero exit.
 */
export async function writeDailyRow(
  filePath: string,
  header: string[],
  today: string,
  label: string,
  fetchLatest: () => Promise<Record<string, string | number> | null>
): Promise<void> {
  let row: Record<string, string | number> | null = null;
  try {
    row = await fetchLatest();
  } catch (error) {
    console.warn(`${label}: fetch failed (${error instanceof Error ? error.message : error})`);
  }

  if (row) {
    // A source-supplied published_date wins; `today` only fills in when the source gave none.
    const dated = { published_date: today, ...row };
    const { added, skippedInvalid } = appendRows(filePath, header, [dated]);
    if (skippedInvalid > 0) {
      console.error(
        `${label}: the source dated its latest value "${dated.published_date}", which is not a usable YYYY-MM-DD calendar date, so nothing could be filed. The source's date format has probably changed.`
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      added > 0
        ? `${label}: appended ${dated.published_date}`
        : `${label}: ${dated.published_date} already on file, nothing to do`
    );
    return;
  }

  if (!readLastRow(filePath)) {
    console.error(`${label}: fetch returned nothing and there is no prior data on file at all.`);
    process.exitCode = 1;
    return;
  }

  console.warn(`${label}: no fresh value available, leaving the file as-is (a later run or a backfill re-run will fill this in).`);
}

/**
 * The multi-row sibling of `writeDailyRow`, for the daily scripts whose source hands back a whole
 * window (a month, a year, the fund's entire history) rather than just the latest value.
 *
 * Those scripts used to keep one row out of the window and drop the rest, which quietly lost every
 * date the cron did not happen to land on: the workflow runs once a day, but a value published on a
 * day the run did not cover was never asked for again. Handing the whole window to `appendRows`
 * instead means each run also heals whatever earlier runs missed, exactly as the NEPSE index window
 * already does, and it costs nothing extra because the source returned those rows anyway.
 *
 * Rows must already carry their own `published_date`; unlike `writeDailyRow` there is no single
 * `today` to fall back to, and a source that serves a list always dates its entries.
 *
 * Same failure contract as `writeDailyRow`: a failed fetch or an empty window writes nothing and
 * exits 0, and only a failure with no prior data at all is treated as a genuine first-run break.
 */
export async function writeDailyRows(
  filePath: string,
  header: string[],
  label: string,
  fetchWindow: () => Promise<Array<Record<string, string | number>> | null>
): Promise<void> {
  let rows: Array<Record<string, string | number>> | null = null;
  try {
    rows = await fetchWindow();
  } catch (error) {
    console.warn(`${label}: fetch failed (${error instanceof Error ? error.message : error})`);
  }

  if (rows && rows.length > 0) {
    const { added, skippedInvalid } = appendRows(filePath, header, rows);
    if (skippedInvalid > 0) {
      console.error(
        `${label}: ${skippedInvalid} of ${rows.length} row(s) carried a date that is not a usable YYYY-MM-DD calendar date and could not be filed. The source's date format has probably changed.`
      );
      process.exitCode = 1;
    }
    // Computed rather than read off the last element: sources here disagree on ordering, some serve
    // the window newest-first and some oldest-first.
    const newest = rows.reduce((max, row) => {
      const date = String(row.published_date ?? '');
      return date > max ? date : max;
    }, '');
    console.log(
      added > 0
        ? `${label}: appended ${added} row(s) of the ${rows.length} the source offered, newest ${newest}`
        : `${label}: all ${rows.length} row(s) the source offered are already on file, nothing to do`
    );
    return;
  }

  if (!readLastRow(filePath)) {
    console.error(`${label}: fetch returned nothing and there is no prior data on file at all.`);
    process.exitCode = 1;
    return;
  }

  console.warn(`${label}: no fresh values available, leaving the file as-is (a later run or a backfill re-run will fill this in).`);
}
