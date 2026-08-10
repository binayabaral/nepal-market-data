/**
 * Shared fetch/parse for NIMB Ace Capital's NAV table (nimbacecapital.com), used by both the daily
 * and the backfill path for "NIBL Sahabhagita Fund" (NIBLSF).
 *
 * The site's NAV page renders its Daily tab from a WordPress AJAX endpoint
 * (`POST /wp-admin/admin-ajax.php`, `action=load_mutual_fund_table`) rather than from the page HTML,
 * and the request needs a `nonce` scraped out of that page. WordPress nonces rotate, so it is
 * re-extracted per run. No bot-protection.
 *
 * Both paths go through this file so the row parsing cannot drift between them: the two used to
 * carry near-identical but separately maintained regexes, and a markup change would have been
 * "fixed" in one place only, silently dating daily rows differently from backfilled ones.
 *
 * Everything here throws on an HTTP or nonce failure rather than reporting "no rows". Those two
 * outcomes mean opposite things: no rows is the source saying it published nothing, a failure is
 * this code being broken, and only the caller of a daily script can decide what to do about that.
 */

import { isoDateFromLabel } from './nepal-time';

const NAV_PAGE_URL = 'https://nimbacecapital.com/nav-nibl-sahabhagita-fund/';
const AJAX_URL = 'https://nimbacecapital.com/wp-admin/admin-ajax.php';
const FUND_SLUG = 'nibl-sahabhagita-fund-nav';

export type NiblsfNavRow = { published_date: string; nav: number };

export async function fetchNiblsfNonce(userAgent: string): Promise<string> {
  const response = await fetch(NAV_PAGE_URL, { headers: { 'User-Agent': userAgent } });
  if (!response.ok) throw new Error(`HTTP error fetching the NIBLSF NAV page: ${response.status}`);

  const nonce = (await response.text()).match(/nonce:\s*'([a-f0-9]+)'/i)?.[1];
  if (!nonce) throw new Error('Could not find a nonce on the NIBLSF NAV page, the site structure may have changed.');
  return nonce;
}

/** Rows look like: <tr><td>28/July/2026</td><td>12/Shrawan/2083</td><td>10.27</td></tr>, newest first. */
export function parseNiblsfRows(tableHtml: string): NiblsfNavRow[] {
  const rows: NiblsfNavRow[] = [];
  const rowRegex = /<tr>\s*<td>([^<]+)<\/td>\s*<td>[^<]*<\/td>\s*<td>([^<]+)<\/td>\s*<\/tr>/g;
  let match: RegExpExecArray | null;
  while ((match = rowRegex.exec(tableHtml))) {
    const [, englishDate, navRaw] = match;
    if (!englishDate || !navRaw) continue;
    // Column 1 is the AD date; column 2 is the same day in Bikram Sambat and is ignored.
    const publishedDate = isoDateFromLabel(englishDate);
    const nav = parseFloat(navRaw.trim());
    if (!publishedDate || isNaN(nav) || nav <= 0) continue;
    rows.push({ published_date: publishedDate, nav });
  }
  return rows;
}

/**
 * One page of the Daily tab. `type: 'daily'` matters: the weekly tab dates its rows to week-ends
 * instead, which would file the same NAV under a different date than the daily tab does.
 * `total_items` is the endpoint's own count of available rows, used by the backfill to know when to
 * stop paging.
 */
export async function fetchNiblsfPage(
  nonce: string,
  page: number,
  entries: number,
  userAgent: string
): Promise<{ rows: NiblsfNavRow[]; totalItems: number }> {
  const response = await fetch(AJAX_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': userAgent },
    body: new URLSearchParams({
      action: 'load_mutual_fund_table',
      nonce,
      mutual_fund: FUND_SLUG,
      type: 'daily',
      page: String(page),
      search: '',
      entries: String(entries)
    })
  });
  if (!response.ok) throw new Error(`HTTP error fetching NIBLSF NAV page ${page}: ${response.status}`);

  const json: { success: boolean; data?: { html: string; total_items: number } } = await response.json();
  if (!json.success || !json.data) return { rows: [], totalItems: 0 };

  return { rows: parseNiblsfRows(json.data.html), totalItems: json.data.total_items };
}
