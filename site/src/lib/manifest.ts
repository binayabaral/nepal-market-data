import type { Kind, Manifest, ManifestEntry } from '../../../scripts/site/manifest-types';
import raw from '../data/manifest.json';

export const manifest = raw as Manifest;
export const entries: ManifestEntry[] = manifest.entries;

export function byKind(kind: Kind): ManifestEntry[] {
  return entries.filter(entry => entry.kind === kind);
}

/**
 * The symbols any market-wide view may aggregate: top movers, breadth, sector rollups.
 * Filters on instrument type and status, never on "has a sector". See the plan's global constraints.
 */
export function marketWide(): ManifestEntry[] {
  return entries.filter(entry => entry.instrumentType === 'ordinary' && entry.status === 'listed');
}

export function findEntry(symbol: string): ManifestEntry | undefined {
  return entries.find(entry => entry.symbol === symbol);
}
