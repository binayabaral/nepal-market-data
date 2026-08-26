import { join } from 'node:path';

import { readRows } from '../lib/csv-store';
import type { FundRef, SymbolRef } from './manifest-types';

/**
 * The two reference tables in `data/reference/`, read into typed records.
 *
 * `data/reference/nepse-symbols.csv` already stores the slash-free key form of each symbol
 * (`GBILD84-85`, not `GBILD84/85`), which is also the CSV filename and the URL slug, so nothing
 * here re-derives it.
 */
export function loadSymbolRefs(dataDir: string): SymbolRef[] {
  return readRows(join(dataDir, 'reference', 'nepse-symbols.csv')).map(row => ({
    symbol: row.symbol ?? '',
    name: row.name ?? '',
    sourceCategory: row.source_category ?? '',
    instrumentType: row.instrument_type ?? '',
    sector: row.sector ?? '',
    status: row.status ?? ''
  }));
}

export function loadFundRefs(dataDir: string): FundRef[] {
  return readRows(join(dataDir, 'reference', 'sip-mutual-funds.csv')).map(row => ({
    symbol: row.symbol ?? '',
    name: row.name ?? '',
    amc: row.amc ?? ''
  }));
}

/**
 * Whether a symbol belongs in a market-wide view: top movers, breadth, any sector aggregate.
 *
 * Filters on instrument type and listing status, NEVER on "has a sector". 10 of the 284 symbols
 * this keeps have a blank sector because the source files them under `Others` or `Non Category`,
 * and they include Nepal Doorsanchar (NTC), Nepal Reinsurance and Himalayan Reinsurance. A sector
 * test would silently drop Nepal Telecom from the market view.
 */
export function isMarketWide(ref: SymbolRef): boolean {
  return ref.instrumentType === 'ordinary' && ref.status === 'listed';
}
