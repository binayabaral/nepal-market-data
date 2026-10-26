/**
 * Shared fetch/parse for NIC Asia Capital's NAV history (nicasiacapital.com), used by both NIC Asia
 * schemes tracked here (NADDF/Dynamic Debt Fund, NICAELIS/Equity Linked Investment Scheme). Same AMC,
 * same endpoint, only the `category` id differs (5 and 11).
 *
 * Since the site's redesign (noticed 2026-10-26, broken since about 2026-10-05) the NAV Details page
 * ships empty "-" placeholders and fills its tables with jQuery from a JSON endpoint:
 *
 *   GET /nav-details/daily-data?page=N&year=YYYY&category=ID
 *   -> { data: [{ publish_at: "Oct 16, 2026", value: 9.97, nepali_date: "..." }, ...],
 *        current_page, last_page, total, pagination: "<html>" }
 *
 * Newest first, 8 rows a page. The old parser looked for a server-rendered `<table class="tablefull">`
 * and returned [] when it was missing, so the redesign looked exactly like a quiet source for three
 * weeks. Hence the rule here: an unexpected response shape THROWS (the run goes red); only a
 * well-formed response with an empty `data` array means "no rows".
 *
 * The new site's history is shorter than ours (NADDF has only rows from 2026-09-23 there), so callers
 * must keep appending, never treat a fetch as the complete series.
 */

import { isoDateFromLabel } from './nepal-time';

const DAILY_DATA_URL = 'https://www.nicasiacapital.com/nav-details/daily-data';

/**
 * A year of daily NAV is at most ~366 rows, about 46 pages of 8. The bound exists so a response that
 * keeps reporting more pages cannot turn the loop into an endless crawl of the AMC's site.
 */
const MAX_PAGES_PER_YEAR = 60;

export type NicAsiaNavRow = { publishedDate: string; nav: number };
export type NicAsiaPage = { rows: NicAsiaNavRow[]; lastPage: number };

/**
 * Validates one page of the JSON endpoint and maps it to rows for `year`. Throws on any shape the
 * endpoint is not known to return, so a future redesign fails loudly instead of silently.
 */
export function parseNicAsiaPage(body: unknown, year: number, context: string): NicAsiaPage {
  const page = body as { data?: unknown; last_page?: unknown } | null;
  if (!page || typeof page !== 'object' || !Array.isArray(page.data) || typeof page.last_page !== 'number') {
    throw new Error(`Unexpected NIC Asia NAV response shape (${context}): ${JSON.stringify(body).slice(0, 200)}`);
  }

  const rows: NicAsiaNavRow[] = [];
  for (const item of page.data as Array<{ publish_at?: unknown; value?: unknown }>) {
    if (typeof item?.publish_at !== 'string' || (typeof item.value !== 'number' && typeof item.value !== 'string')) {
      throw new Error(`Unexpected NIC Asia NAV row shape (${context}): ${JSON.stringify(item).slice(0, 200)}`);
    }
    const publishedDate = isoDateFromLabel(item.publish_at);
    const nav = Number(item.value);
    if (!publishedDate || !Number.isFinite(nav) || nav <= 0) continue;
    if (!publishedDate.startsWith(`${year}-`)) continue; // defensive: never let an out-of-range year leak in
    rows.push({ publishedDate, nav });
  }
  return { rows, lastPage: page.last_page };
}

async function fetchPage(categoryId: number, year: number, page: number): Promise<NicAsiaPage> {
  const context = `category=${categoryId}, year=${year}, page=${page}`;
  const response = await fetch(`${DAILY_DATA_URL}?page=${page}&year=${year}&category=${categoryId}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; NepalMarketData/1.0)',
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest'
    }
  });
  if (!response.ok) throw new Error(`HTTP error fetching NIC Asia NAV (${context}): ${response.status}`);

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`NIC Asia NAV response is not JSON (${context}); the endpoint may have moved again`);
  }
  return parseNicAsiaPage(body, year, context);
}

/** One page (up to 8 rows) of a year's daily NAV, newest first. Page 1 row 0 is the latest row. */
export async function fetchNicAsiaPage(categoryId: number, year: number, page: number): Promise<NicAsiaNavRow[]> {
  return (await fetchPage(categoryId, year, page)).rows;
}

/** Every row the source still has for `year`, walking pages up to the reported `last_page`. */
export async function fetchNicAsiaYear(categoryId: number, year: number): Promise<NicAsiaNavRow[]> {
  const rows: NicAsiaNavRow[] = [];
  for (let page = 1; page <= MAX_PAGES_PER_YEAR; page++) {
    const result = await fetchPage(categoryId, year, page);
    rows.push(...result.rows);
    if (page >= result.lastPage || result.rows.length === 0) break;
  }
  return rows;
}
