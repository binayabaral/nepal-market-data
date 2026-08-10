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
 * nabilinvest.com.np sits behind a SiteGround bot-challenge that fires INTERMITTENTLY: it answers
 * with an HTML challenge page instead of JSON, at a 200 status. See the pacing constants below for
 * what was measured and why this is handled with pacing and backoff rather than a headless browser.
 */

const AJAX_URL = 'https://nabilinvest.com.np/wp-admin/admin-ajax.php';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

/**
 * The challenge is intermittent and burst-triggered, not a blanket block, so a paced retry clears it.
 *
 * Measured from a GitHub runner: a single request succeeds, but a backfill's tight loop of one POST
 * per BS year (two funds back to back, no pause) gets an HTML challenge page partway through. Two
 * runs 14 minutes apart, same code and same IP range, gave opposite results. A real browser also got
 * through, so the block is not about the IP; it is about how fast the requests arrive.
 *
 * Hence a small pause between requests plus increasing backoff on a challenge. Puppeteer was
 * considered and rejected: it worked, but a ~300 MB Chromium download in every run is a permanent
 * price for a transient problem.
 */
const PACING_MS = 1_500;
const RETRY_WAITS_MS = [5_000, 15_000, 30_000];

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

let lastRequestAt = 0;

/** Serves the challenge page, or anything else that is not the JSON we asked for. */
class ChallengedError extends Error {}

async function requestBsYear(schemeId: number, refererUrl: string, bsYear: number): Promise<string> {
  const sinceLast = Date.now() - lastRequestAt;
  if (sinceLast < PACING_MS) await sleep(PACING_MS - sinceLast);
  lastRequestAt = Date.now();

  const response = await fetch(AJAX_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': USER_AGENT,
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

  // Read as text rather than calling .json(): the challenge arrives as HTML with a 200, and
  // response.json() would surface it as a bare SyntaxError that reads like a parsing bug and cannot
  // be told apart from one worth retrying.
  const body = await response.text();
  if (!body.trimStart().startsWith('{')) {
    throw new ChallengedError(
      `Nabil served a non-JSON response for BS year ${bsYear} (likely the SiteGround challenge): ${body.slice(0, 80).replace(/\s+/g, ' ')}`
    );
  }
  return body;
}

export type NabilNavRow = { published_date: string; nav: number };

export async function fetchNabilBsYear(schemeId: number, refererUrl: string, bsYear: number): Promise<NabilNavRow[]> {
  let body: string | null = null;
  for (let attempt = 0; attempt <= RETRY_WAITS_MS.length; attempt++) {
    try {
      body = await requestBsYear(schemeId, refererUrl, bsYear);
      break;
    } catch (error) {
      const wait = RETRY_WAITS_MS[attempt];
      if (!(error instanceof ChallengedError) || wait === undefined) throw error;
      console.warn(`${error.message}; retrying in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
  if (body === null) throw new Error(`Nabil kept serving the challenge for BS year ${bsYear}`);

  const json: { success: boolean; message?: string; data?: Array<{ eng_date: string; nav: string }> } = JSON.parse(body);
  if (!json.success) throw new Error(`Nabil API reported failure for BS year ${bsYear}: ${json.message}`);

  return (json.data ?? [])
    .map(row => ({ published_date: row.eng_date, nav: parseFloat(row.nav) }))
    .filter(row => !isNaN(row.nav) && row.nav > 0);
}
