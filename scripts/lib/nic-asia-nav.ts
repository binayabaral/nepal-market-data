/**
 * Shared fetch/parse for NIC Asia Capital's NAV Details page (nicasiacapital.com), used by both
 * NIC Asia schemes tracked here (NADDF/Dynamic Debt Fund, NICAELIS/Equity Linked Investment
 * Scheme). Same AMC, same page, same query-string shape, only the `category` id differs.
 *
 * The page is plain server-rendered HTML (no bot-protection, no AJAX/JS needed): a GET request
 * with `category`+`year`+`type=3` (Daily) query params returns a `<table class="tablefull">` of
 * daily NAV rows. Out-of-range years and pages past the end render a "No record found." row
 * instead of erroring, which is how an empty page is detected.
 *
 * That table is PAGINATED at 30 rows a page, newest first, with an undocumented `page` param. A
 * request without `page` answers as page 1, so reading only that gave the 30 most recent rows of
 * the requested year and nothing else, which is why both funds looked like sparse disclosers
 * publishing exactly 30 times a year. `fetchNicAsiaYear` walks the pages; `fetchNicAsiaPage` is
 * exposed for the daily scripts, which only need the newest page.
 */

import { isoDateFromLabel } from './nepal-time';

const NAV_DETAILS_URL = 'https://www.nicasiacapital.com/nav-details';

/**
 * A year of daily NAV is at most ~366 rows, so 30 pages is already an order of magnitude of
 * headroom. The bound exists so a markup change that stops the "No record found." sentinel from
 * appearing cannot turn the loop into an infinite crawl of the AMC's site.
 */
const MAX_PAGES_PER_YEAR = 30;

export type NicAsiaNavRow = { publishedDate: string; nav: number };

/** One page (up to 30 rows) of a year's daily NAV, newest first. Page 1 row 0 is the latest row. */
export async function fetchNicAsiaPage(categoryId: number, year: number, page: number): Promise<NicAsiaNavRow[]> {
  const response = await fetch(`${NAV_DETAILS_URL}?category=${categoryId}&year=${year}&type=3&page=${page}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NepalMarketData/1.0)' }
  });
  if (!response.ok) {
    throw new Error(
      `HTTP error fetching NIC Asia NAV details (category=${categoryId}, year=${year}, page=${page}): ${response.status}`
    );
  }

  const html = await response.text();
  const tableBody = html.match(/<table class="tablefull">([\s\S]*?)<\/table>/)?.[1];
  if (!tableBody || tableBody.includes('No record found')) return [];

  const rows: NicAsiaNavRow[] = [];
  const rowRegex = /<tr>\s*<td>([^<]+)<\/td>\s*<td>[\s\S]*?<\/td>\s*<td>([^<]+)<\/td>\s*<\/tr>/g;
  let match: RegExpExecArray | null;
  while ((match = rowRegex.exec(tableBody))) {
    const [, englishDate, navRaw] = match;
    if (!englishDate || !navRaw) continue;
    const publishedDate = isoDateFromLabel(englishDate);
    const nav = parseFloat(navRaw.trim());
    if (!publishedDate || isNaN(nav) || nav <= 0) continue;
    if (!publishedDate.startsWith(`${year}-`)) continue; // defensive: a different AMC's API was seen returning the wrong year's rows for an out-of-range request
    rows.push({ publishedDate, nav });
  }
  return rows;
}

/** Every daily NAV row the site holds for one year, walking pages until one comes back empty. */
export async function fetchNicAsiaYear(categoryId: number, year: number): Promise<NicAsiaNavRow[]> {
  const rows: NicAsiaNavRow[] = [];
  for (let page = 1; page <= MAX_PAGES_PER_YEAR; page++) {
    const pageRows = await fetchNicAsiaPage(categoryId, year, page);
    if (pageRows.length === 0) break;
    rows.push(...pageRows);
  }
  return rows;
}
