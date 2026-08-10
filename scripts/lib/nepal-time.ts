/**
 * Date handling that must never depend on the machine running the script (GitHub Actions runners
 * are UTC, but every script here also has to behave identically run from a laptop in Nepal).
 *
 * Nepal has no DST and sits at a fixed UTC+5:45 offset, so "a date in Nepal" is computed by
 * shifting the UTC instant forward by that offset and reading its UTC calendar fields rather than
 * trusting the local timezone.
 */
const NEPAL_OFFSET_MINUTES = 5 * 60 + 45;

export function todayInNepal(): string {
  return nepalDateFromInstant(new Date());
}

/**
 * The calendar date in Nepal (`YYYY-MM-DD`) for a UTC instant. Some sources timestamp a value with
 * an instant rather than a plain date (Nabil's `latestNav.from`, fenegosida's `todayDate`), and
 * those instants land on Nepal midnight, so slicing the raw UTC string would report the day before.
 */
export function nepalDateFromInstant(instant: string | Date): string {
  const utc = instant instanceof Date ? instant : new Date(instant);
  if (isNaN(utc.getTime())) throw new Error(`Could not parse instant: ${String(instant)}`);
  return new Date(utc.getTime() + NEPAL_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

/**
 * The Bikram Sambat year currently running in Nepal.
 *
 * Several sources (Siddhartha, Nabil's WordPress endpoint) take a BS year rather than an AD one,
 * and a hardcoded constant silently turns those scripts into no-ops the moment the year rolls over:
 * the endpoints answer `success:true` with an empty array for a year they have nothing for, so
 * nothing errors and the fund just goes quiet forever.
 *
 * The Nepali new year falls on 13 or 14 April. Treating 14 April as the boundary can be one day
 * early in a year that starts on the 13th, which is why the SSIS daily script asks for this year and
 * the previous one and lets dedup sort it out rather than trusting this to the day.
 */
export function currentBsYear(): number {
  const [year, month, day] = todayInNepal().split('-').map(Number) as [number, number, number];
  return year + 56 + (month > 4 || (month === 4 && day >= 14) ? 1 : 0);
}

/**
 * Normalises a source's human-readable date label ("09 Aug 2026", "Aug 03, 2026", "17/July/2026")
 * to `YYYY-MM-DD`, or null if it doesn't parse.
 *
 * Anchored at noon UTC deliberately: a bare date string parses as LOCAL midnight, which reads back
 * as the previous day anywhere east of UTC (Nepal included), so the day a source published would
 * otherwise shift depending on which machine ran the script.
 */
export function isoDateFromLabel(label: string): string | null {
  const parsed = new Date(`${label.trim().replace(/\//g, ' ')} 12:00:00 UTC`);
  return isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}
