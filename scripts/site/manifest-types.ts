/**
 * Shapes shared by the manifest builder and the Astro pages that read its output.
 *
 * Kept apart from `build-manifest.ts` so the site can import these types without dragging in
 * Node-only file I/O.
 */

export type Kind = 'stock' | 'fund' | 'metal' | 'index';

export type SymbolRef = {
  symbol: string;
  name: string;
  sourceCategory: string;
  instrumentType: string;
  sector: string;
  status: string;
};

export type FundRef = {
  symbol: string;
  name: string;
  amc: string;
};

export type ManifestEntry = {
  symbol: string;
  name: string;
  kind: Kind;
  instrumentType: string;
  sector: string;
  status: string;
  latestDate: string;
  latestClose: number;
  prevClose: number | null;
  changePct: number | null;
  rows: number;
  firstDate: string;
  hasVolume: boolean;
};

export type Manifest = {
  generatedAt: string;
  entries: ManifestEntry[];
};
