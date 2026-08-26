import type { ManifestEntry } from '../../../scripts/site/manifest-types';

export function formatNumber(value: number, dp = 2): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** Always prefixed, so direction survives greyscale and colourblindness. Blank data reads as a plain dash. */
export function formatChange(pct: number | null): string {
  if (pct === null) return '-';
  const sign = pct > 0 ? '+' : pct < 0 ? '-' : '';
  return `${sign}${formatNumber(Math.abs(pct))}%`;
}

export function changeClass(pct: number | null): string {
  if (pct === null || pct === 0) return '';
  return pct > 0 ? 'up' : 'down';
}

export function formatDate(iso: string): string {
  return iso;
}

/** Where the raw CSV for an entry lives, relative to the site base. */
export function csvPath(entry: ManifestEntry): string {
  const dir =
    entry.kind === 'metal' ? 'precious-metals' : entry.kind === 'fund' ? 'sip-mutual-funds' : 'nepse';
  return `${import.meta.env.BASE_URL}data/${dir}/${entry.symbol}.csv`;
}
