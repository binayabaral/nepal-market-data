/**
 * Fails loudly when a dataset has stopped receiving new rows.
 *
 * A green scraper run is NOT evidence of fresh data. On 2026-08-26 the mutual fund workflow succeeded
 * while PSIS had gone six days without a new NAV: the scraper fetched all 416 rows the source offered
 * and every one was already on file. Nothing in the pipeline reports that, because "nothing new to
 * write" is also what a normal quiet day looks like. This check is the only thing that can tell the
 * two apart, and it is the prerequisite for ever dropping the GitHub `schedule:` backstop triggers.
 *
 * Exits 1 with a table naming every stale dataset, so the workflow fails and GitHub emails about it.
 */

import { readRows } from '../lib/csv-store';
import { todayInNepal } from '../lib/nepal-time';

/**
 * Days of silence tolerated per dataset before it counts as stale.
 *
 * Each is the largest gap actually observed in that series over the trailing twelve months, plus a
 * three day margin, floored at five. Calibrated on 2026-08-26 rather than guessed, because a
 * threshold that false-alarms gets ignored, and an ignored check is worse than no check.
 *
 * Deliberately calendar days, not trading days. NEPSE's tolerance is wide because the exchange closes
 * for the Dashain and Tihar festivals: the widest real closure in the last year was ten days, so
 * anything tighter would cry wolf every autumn. That is the cost of avoiding false alarms, and it
 * means a total outage takes up to a fortnight to surface for NEPSE while funds surface in under a
 * week.
 */
const TOLERANCE_DAYS: Record<string, number> = {
  // Observed max gap 10 (festival closure).
  'nepse/NEPSE_INDEX': 13,
  // Observed max gap 4. FENEGOSIDA publishes on Sundays and about half of Saturdays.
  'precious-metals/gold-24k': 7,
  'precious-metals/gold-22k': 7,
  'precious-metals/silver': 7,
  // Funds. Every source posts day D's NAV on D+1, so a healthy fund normally sits one or two days
  // behind. That lag is already inside these numbers.
  'sip-mutual-funds/CSBY': 6, // weekday-only publisher, observed max gap 3
  'sip-mutual-funds/GSYA': 5,
  'sip-mutual-funds/KSLY': 5,
  'sip-mutual-funds/MSIP': 8, // observed max gap 5
  'sip-mutual-funds/NADDF': 5,
  'sip-mutual-funds/NFCF': 6,
  'sip-mutual-funds/NI31': 6,
  'sip-mutual-funds/NIBLSF': 5,
  'sip-mutual-funds/NICAELIS': 5,
  'sip-mutual-funds/NMBSBF': 5,
  'sip-mutual-funds/PSIS': 5,
  'sip-mutual-funds/SFF': 12, // weekday-only and batch-published, observed max gap 9
  'sip-mutual-funds/SLK': 5,
  'sip-mutual-funds/SSIS': 5
};

/**
 * Only the NEPSE index is checked, not the 432 per-scrip files.
 *
 * Merged and suspended scrips are legitimately stale forever: BOKL last traded in 2020 and never
 * will again. Checking each one would produce a permanent wall of expected failures, which is how a
 * check stops being read. The index is the right canary instead: it updates on every trading day the
 * scrape succeeds, so if it is fresh the daily NEPSE run wrote data, and if it is stale the run did
 * not.
 */
type Staleness = { dataset: string; latest: string; behind: number; tolerance: number };

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

function check(): { stale: Staleness[]; fresh: Staleness[]; missing: string[] } {
  const today = todayInNepal();
  const stale: Staleness[] = [];
  const fresh: Staleness[] = [];
  const missing: string[] = [];

  for (const [dataset, tolerance] of Object.entries(TOLERANCE_DAYS)) {
    const rows = readRows(`data/${dataset}.csv`);
    const last = rows[rows.length - 1];
    const latest = last?.published_date;
    if (!latest) {
      missing.push(dataset);
      continue;
    }
    const entry = { dataset, latest, behind: daysBetween(latest, today), tolerance };
    (entry.behind > tolerance ? stale : fresh).push(entry);
  }

  return { stale, fresh, missing };
}

function main(): void {
  const { stale, fresh, missing } = check();
  const width = Math.max(...Object.keys(TOLERANCE_DAYS).map(k => k.length));

  console.log(`Freshness check against Nepal date ${todayInNepal()}\n`);
  for (const e of [...stale, ...fresh].sort((a, b) => b.behind - a.behind)) {
    const flag = e.behind > e.tolerance ? 'STALE' : 'ok   ';
    console.log(`  ${flag} ${e.dataset.padEnd(width)}  latest=${e.latest}  behind=${String(e.behind).padStart(3)}d  tolerance=${e.tolerance}d`);
  }

  if (missing.length > 0) {
    console.error(`\nNo rows at all in: ${missing.join(', ')}`);
  }

  if (stale.length === 0 && missing.length === 0) {
    console.log(`\nAll ${fresh.length} datasets are within tolerance.`);
    return;
  }

  console.error(
    `\n${stale.length} dataset(s) stale, ${missing.length} empty. A green scraper run does not mean ` +
      `fresh data: check whether the SOURCE stopped publishing before assuming the scraper broke.`
  );
  process.exit(1);
}

main();
