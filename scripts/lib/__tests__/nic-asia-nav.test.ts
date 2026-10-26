import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseNicAsiaPage } from '../nic-asia-nav';

const page = (data: unknown[], last_page = 1) => ({ data, current_page: 1, last_page, total: data.length, pagination: '' });

test('maps rows from the daily-data JSON endpoint, newest first', () => {
  const result = parseNicAsiaPage(
    page(
      [
        { id: 2, publish_at: 'Oct 16, 2026', value: 9.97, nepali_date: '30 Ashwin, 2083' },
        { id: 1, publish_at: 'Oct 15, 2026', value: '9.96', nepali_date: '29 Ashwin, 2083' }
      ],
      4
    ),
    2026,
    'test'
  );
  assert.deepEqual(result, {
    rows: [
      { publishedDate: '2026-10-16', nav: 9.97 },
      { publishedDate: '2026-10-15', nav: 9.96 }
    ],
    lastPage: 4
  });
});

test('an empty data array is a legitimate empty page', () => {
  assert.deepEqual(parseNicAsiaPage(page([]), 2026, 'test'), { rows: [], lastPage: 1 });
});

test('drops rows from another year and non-positive NAVs', () => {
  const result = parseNicAsiaPage(
    page([
      { publish_at: 'Dec 31, 2025', value: 9.5 },
      { publish_at: 'Jan 1, 2026', value: 0 },
      { publish_at: 'Jan 2, 2026', value: 9.6 }
    ]),
    2026,
    'test'
  );
  assert.deepEqual(result.rows, [{ publishedDate: '2026-01-02', nav: 9.6 }]);
});

test('throws on a response shape the endpoint is not known to return', () => {
  assert.throws(() => parseNicAsiaPage('<html>redesigned</html>', 2026, 'test'), /Unexpected NIC Asia NAV response shape/);
  assert.throws(() => parseNicAsiaPage({ rows: [] }, 2026, 'test'), /Unexpected NIC Asia NAV response shape/);
  assert.throws(() => parseNicAsiaPage({ data: [] }, 2026, 'test'), /Unexpected NIC Asia NAV response shape/);
});

test('throws on a row shape the endpoint is not known to return', () => {
  assert.throws(() => parseNicAsiaPage(page([{ date: 'Oct 16, 2026', nav: 9.97 }]), 2026, 'test'), /Unexpected NIC Asia NAV row shape/);
});
