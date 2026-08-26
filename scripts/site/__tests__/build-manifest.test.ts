import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildManifest } from '../build-manifest';

const PRICE_HEADER =
  'published_date,open,high,low,close,per_change,traded_quantity,traded_amount,status';

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nmd-man-'));
  for (const sub of ['reference', 'nepse', 'precious-metals', 'sip-mutual-funds']) {
    mkdirSync(join(dir, sub), { recursive: true });
  }
  writeFileSync(
    join(dir, 'reference', 'nepse-symbols.csv'),
    [
      'symbol,name,source_category,instrument_type,sector,status',
      'NABIL,Nabil Bank Limited,Commercial Bank,ordinary,Commercial Bank,listed',
      'BOKL,Bank of Kathmandu Limited,Merged,ordinary,,merged',
      'ONEROW,One Row Company,Commercial Bank,ordinary,Commercial Bank,listed',
      'HALTED,Halted Company,Commercial Bank,ordinary,Commercial Bank,listed',
      ''
    ].join('\n')
  );
  writeFileSync(join(dir, 'reference', 'sip-mutual-funds.csv'), ['symbol,name,amc', 'NI31,NIC Asia Fund,NIC Asia Capital', ''].join('\n'));
  writeFileSync(
    join(dir, 'nepse', 'NABIL.csv'),
    [
      PRICE_HEADER,
      '2026-08-19,495,500,490,500,0.00,800,400000,A',
      '2026-08-20,500,510,495,505,1.00,1000,505000,A',
      '2026-08-21,505,520,500,515,1.98,2000,1030000,A',
      ''
    ].join('\n')
  );
  writeFileSync(join(dir, 'nepse', 'BOKL.csv'), [PRICE_HEADER, '2020-01-02,100,100,100,100,0.00,10,1000,A', ''].join('\n'));
  writeFileSync(join(dir, 'nepse', 'ONEROW.csv'), [PRICE_HEADER, '2026-08-21,10,10,10,10,0.00,5,50,A', ''].join('\n'));
  // Earlier rows carry real volume; the latest row (a halt) is blank. The series must still be
  // hasVolume: true, since a blank on the last row alone must not demote a scrip.
  writeFileSync(
    join(dir, 'nepse', 'HALTED.csv'),
    [
      PRICE_HEADER,
      '2026-08-19,200,205,198,202,0.00,300,60600,A',
      '2026-08-20,202,204,200,203,0.50,150,30450,A',
      '2026-08-21,203,203,203,203,0.00,,,H',
      ''
    ].join('\n')
  );
  // The real index carries no volume in any of its rows.
  writeFileSync(
    join(dir, 'nepse', 'NEPSE_INDEX.csv'),
    [PRICE_HEADER, '2026-08-20,2600,2610,2590,2605,0.10,,4000000,A', '2026-08-21,2605,2631,2614,2618.72,-0.40,,4167618882.31,A', ''].join('\n')
  );
  writeFileSync(join(dir, 'precious-metals', 'gold-24k.csv'), ['published_date,price', '2026-08-20,200000', '2026-08-21,201000', ''].join('\n'));
  writeFileSync(join(dir, 'sip-mutual-funds', 'NI31.csv'), ['published_date,nav', '2026-08-20,10.00', '2026-08-21,10.50', ''].join('\n'));
  return dir;
}

test('one entry per data file, with the index counted separately from stocks', () => {
  const m = buildManifest(fixture());
  const byKind = (k: string) => m.entries.filter(e => e.kind === k).map(e => e.symbol).sort();
  assert.deepEqual(byKind('stock'), ['BOKL', 'HALTED', 'NABIL', 'ONEROW']);
  assert.deepEqual(byKind('index'), ['NEPSE_INDEX']);
  assert.deepEqual(byKind('fund'), ['NI31']);
  assert.deepEqual(byKind('metal'), ['gold-24k']);
});

test('latest and previous close come from the last two rows', () => {
  const nabil = buildManifest(fixture()).entries.find(e => e.symbol === 'NABIL');
  assert.equal(nabil?.latestDate, '2026-08-21');
  assert.equal(nabil?.latestClose, 515);
  assert.equal(nabil?.prevClose, 505);
  assert.equal(nabil?.changePct, 1.98);
  assert.equal(nabil?.firstDate, '2026-08-19');
  assert.equal(nabil?.rows, 3);
});

test('a single-row symbol yields a null previous close rather than a fabricated zero', () => {
  const one = buildManifest(fixture()).entries.find(e => e.symbol === 'ONEROW');
  assert.equal(one?.rows, 1);
  assert.equal(one?.prevClose, null);
  assert.equal(one?.changePct, null);
});

test('the index is marked as having no volume, scrips as having it', () => {
  const m = buildManifest(fixture());
  assert.equal(m.entries.find(e => e.symbol === 'NEPSE_INDEX')?.hasVolume, false);
  assert.equal(m.entries.find(e => e.symbol === 'NABIL')?.hasVolume, true);
});

test('a blank traded_quantity on only the latest row does not demote hasVolume to false', () => {
  const m = buildManifest(fixture());
  assert.equal(m.entries.find(e => e.symbol === 'HALTED')?.hasVolume, true);
});

test('funds and metals carry their latest value as latestClose', () => {
  const m = buildManifest(fixture());
  assert.equal(m.entries.find(e => e.symbol === 'NI31')?.latestClose, 10.5);
  assert.equal(m.entries.find(e => e.symbol === 'gold-24k')?.latestClose, 201000);
});

test('a fund keeps its reference name and a metal gets a readable one', () => {
  const m = buildManifest(fixture());
  assert.equal(m.entries.find(e => e.symbol === 'NI31')?.name, 'NIC Asia Fund');
  assert.equal(m.entries.find(e => e.symbol === 'gold-24k')?.name, 'Gold 24K');
});

test('merged status is carried through so the page can show its banner', () => {
  const bokl = buildManifest(fixture()).entries.find(e => e.symbol === 'BOKL');
  assert.equal(bokl?.status, 'merged');
});
