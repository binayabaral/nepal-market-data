import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadSymbolRefs, loadFundRefs, isMarketWide } from '../load-symbols';

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nmd-ref-'));
  mkdirSync(join(dir, 'reference'), { recursive: true });
  writeFileSync(
    join(dir, 'reference', 'nepse-symbols.csv'),
    [
      'symbol,name,source_category,instrument_type,sector,status',
      'NABIL,Nabil Bank Limited,Commercial Bank,ordinary,Commercial Bank,listed',
      'NTC,Nepal Doorsanchar Company Limited,Others,ordinary,,listed',
      'BOKL,Bank of Kathmandu Limited,Merged,ordinary,,merged',
      'ADBLD83,10.35% Agricultural Bank Debenture 2083,Corporate Debentures,debenture,,listed',
      'SDBD87,"9% Shangrila Development Bank Debenture, 2087",Corporate Debentures,debenture,,listed',
      ''
    ].join('\n')
  );
  writeFileSync(
    join(dir, 'reference', 'sip-mutual-funds.csv'),
    ['symbol,name,amc', 'NI31,NIC Asia Dynamic Debt Fund,NIC Asia Capital', 'SLK,Sanima Large Cap Fund,', ''].join('\n')
  );
  return dir;
}

test('loads every symbol row with its reference fields', () => {
  const refs = loadSymbolRefs(fixture());
  assert.equal(refs.length, 5);
  const nabil = refs.find(r => r.symbol === 'NABIL');
  assert.deepEqual(nabil, {
    symbol: 'NABIL',
    name: 'Nabil Bank Limited',
    sourceCategory: 'Commercial Bank',
    instrumentType: 'ordinary',
    sector: 'Commercial Bank',
    status: 'listed'
  });
});

test('a quoted name containing a comma survives parsing', () => {
  const refs = loadSymbolRefs(fixture());
  const sdbd = refs.find(r => r.symbol === 'SDBD87');
  assert.equal(sdbd?.name, '9% Shangrila Development Bank Debenture, 2087');
});

test('the market-wide filter keeps ordinary listed symbols including those with no sector', () => {
  const refs = loadSymbolRefs(fixture());
  const kept = refs.filter(isMarketWide).map(r => r.symbol);
  assert.deepEqual(kept, ['NABIL', 'NTC']);
});

test('the market-wide filter excludes merged shells and debentures', () => {
  const refs = loadSymbolRefs(fixture());
  const kept = refs.filter(isMarketWide).map(r => r.symbol);
  assert.ok(!kept.includes('BOKL'));
  assert.ok(!kept.includes('ADBLD83'));
});

test('a blank amc stays blank rather than becoming a placeholder', () => {
  const funds = loadFundRefs(fixture());
  assert.equal(funds.find(f => f.symbol === 'SLK')?.amc, '');
  assert.equal(funds.find(f => f.symbol === 'NI31')?.amc, 'NIC Asia Capital');
});
