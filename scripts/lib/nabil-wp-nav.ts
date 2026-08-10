/**
 * Shared fetch/parse for Nabil Invest's NAV history, used by both Nabil schemes tracked here
 * (NFCF `scheme_id=5`, NI31 `scheme_id=6`). Same AMC, same WordPress AJAX endpoint
 * (`POST /wp-admin/admin-ajax.php`, `action=scheme_data_filter`), only the scheme id differs.
 *
 * `year` is Bikram Sambat, not Gregorian, and one call returns that whole BS year's daily rows.
 *
 * This is history only. The daily scrapers use Nabil's separate `napi.nabilinvest.com.np` JSON API,
 * which exposes the current NAV but no history at all (`/api/navs` is Bearer-gated, and there is no
 * per-scheme navs collection), which is why this endpoint is still the only route to the past.
 *
 * nabilinvest.com.np used to sit behind a SiteGround bot-challenge (SGCaptcha) that blocked plain
 * HTTP requests and forced a headless browser. It no longer does: a plain fetch with a browser
 * User-Agent and a matching Referer works. If that challenge ever comes back, the symptom is an HTML
 * challenge page instead of JSON, and the fix is a headless browser making this request from inside
 * a loaded page (the WAF used to fingerprint Node-side requests even with valid cookies).
 */

const AJAX_URL = 'https://nabilinvest.com.np/wp-admin/admin-ajax.php';

export type NabilNavRow = { published_date: string; nav: number };

export async function fetchNabilBsYear(schemeId: number, refererUrl: string, bsYear: number): Promise<NabilNavRow[]> {
  const response = await fetch(AJAX_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      Referer: refererUrl
    },
    body: new URLSearchParams({
      action: 'scheme_data_filter',
      scheme_id: String(schemeId),
      type: 'daily',
      year: String(bsYear),
      order: 'DESC'
    })
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching Nabil scheme_id=${schemeId} BS year ${bsYear}`);

  const json: { success: boolean; message?: string; data?: Array<{ eng_date: string; nav: string }> } = await response.json();
  if (!json.success) throw new Error(`Nabil API reported failure for BS year ${bsYear}: ${json.message}`);

  return (json.data ?? [])
    .map(row => ({ published_date: row.eng_date, nav: parseFloat(row.nav) }))
    .filter(row => !isNaN(row.nav) && row.nav > 0);
}
