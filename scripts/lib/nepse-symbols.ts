/**
 * Shared fetch/parse for NEPSE symbol reference data: a symbol's full company name and its sector.
 *
 * Used by both the one-off backfill and the daily NEPSE scraper, which need the same two sources at
 * very different cadences. The two differ enormously in cost, which is the whole reason they are
 * separate functions rather than one "fetch a symbol's details" call:
 *
 * - **Names are one request for the entire market.** `/company-list` embeds a `cmpjson` array of
 *   ~1630 `{id, symbol, companyname}` objects for its search box, covering listed, delisted and
 *   debenture symbols alike. Scraping the rendered table, or reading the `title` attribute off the
 *   daily price table, would both have been worse: the price table only carries what traded that day.
 * - **Sectors are one request per symbol.** A sector appears only on that symbol's own company page,
 *   as a `Sector` label cell followed by its value. `/sectorwise-share-price` looked like a bulk
 *   shortcut but exposes a partial list, so there is no cheaper route.
 *
 * Symbols here are the source's own, which for a dozen fiscal-year debentures contain a slash
 * (`GBILD84/85`). That slash matters twice over: it must be passed through literally to build a
 * working company URL (`/company/gbild84/85` resolves; the hyphenated form 404s), and it must be run
 * through `symbolToKey` before being used to key anything in this repo, whose file layout stores that
 * instrument as `GBILD84-85.csv`.
 */

import * as cheerio from 'cheerio';

const COMPANY_LIST_URL = 'https://www.sharesansar.com/company-list';
const USER_AGENT = 'Mozilla/5.0 (compatible; NepalMarketData/1.0)';

const PACING_MS = 250;
const MAX_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** One symbol as the source names it, before any file-name transform. */
export type NepseSymbolName = { symbol: string; name: string };

/**
 * The source's single "Sector" field answers four different questions at once, so it is recorded
 * verbatim as `source_category` and decomposed into three narrower columns beside it.
 *
 * Of 432 tracked symbols, only 274 are ordinary listed equities. The rest are debentures, government
 * bonds, promoter shares, closed-end funds, or shells of merged companies, and their prices are not
 * comparable to a share's. Anything ranking "top movers" or filtering by industry needs to exclude
 * them, which a single conflated column cannot express.
 *
 * Every value here is derived from the source string alone, with no inference. In particular no
 * industry is guessed for a promoter share: only 6 of the 15 have a base symbol that is both
 * derivable (the suffix varies between `PO` and `P`) and tracked here, so the other 9 would be
 * fabrication. `sector` is left blank instead, which is the honest answer.
 */
const INSTRUMENT_BY_CATEGORY: Record<string, string> = {
  'Corporate Debentures': 'debenture',
  'Government Bonds': 'government_bond',
  'Mutual Fund': 'mutual_fund',
  'Promoter Share': 'promoter_share'
};

/** Source categories that answer something other than "what industry is this company in". */
const NOT_AN_INDUSTRY = new Set([...Object.keys(INSTRUMENT_BY_CATEGORY), 'Merged', 'Others', 'Non Category']);

export type SymbolClassification = { instrumentType: string; sector: string; status: string };

export function classifyCategory(sourceCategory: string): SymbolClassification {
  const category = sourceCategory.trim();
  return {
    instrumentType: INSTRUMENT_BY_CATEGORY[category] ?? 'ordinary',
    sector: NOT_AN_INDUSTRY.has(category) ? '' : category,
    status: category === 'Merged' ? 'merged' : 'listed'
  };
}

async function fetchText(url: string, label: string): Promise<string> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === MAX_ATTEMPTS) throw new Error(`${label} failed after ${MAX_ATTEMPTS} attempts: ${message}`);
      const wait = PACING_MS * 4 * attempt;
      console.warn(`  ${label}: ${message}; retrying in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
  throw new Error(`${label}: unreachable`);
}

/**
 * Every symbol/name pair the company-list page knows about, in one request.
 *
 * The array is read out of the inline `cmpjson` assignment rather than the rendered table: it is the
 * same data the page's own search box uses, already structured, so there is no markup to track.
 */
export async function fetchSymbolNames(): Promise<NepseSymbolName[]> {
  const html = await fetchText(COMPANY_LIST_URL, 'company-list');

  const match = html.match(/cmpjson\s*=\s*(\[[\s\S]*?\])\s*;/);
  if (!match?.[1]) {
    throw new Error('company-list: could not find the inline cmpjson array; the page markup has changed');
  }

  const parsed = JSON.parse(match[1]) as Array<{ symbol?: string; companyname?: string }>;
  const names: NepseSymbolName[] = [];
  for (const entry of parsed) {
    const symbol = (entry.symbol ?? '').trim();
    const name = (entry.companyname ?? '').trim();
    if (symbol && name) names.push({ symbol, name });
  }
  if (names.length === 0) throw new Error('company-list: cmpjson parsed but held no usable entries');
  return names;
}

/**
 * One symbol's sector, or null when the page has no `Sector` row.
 *
 * Null is a normal answer, not a failure: a delisted or otherwise unusual symbol can resolve to a
 * page without that field. Callers should leave the column blank rather than guess, and `upsertRows`
 * will not clear an existing value when handed a blank.
 */
export async function fetchSector(symbol: string): Promise<string | null> {
  await sleep(PACING_MS);
  // The slash in a fiscal-year debenture symbol is a real path separator in the company URL and must
  // not be encoded; `encodeURIComponent` here would turn a working page into a 404.
  const html = await fetchText(`https://www.sharesansar.com/company/${symbol.toLowerCase()}`, `company/${symbol}`);

  const $ = cheerio.load(html);
  let sector: string | null = null;
  $('td').each((_index, element) => {
    if ($(element).text().trim() !== 'Sector') return;
    sector = $(element).next('td').text().trim() || null;
    return false; // stop at the first match
  });
  return sector;
}
