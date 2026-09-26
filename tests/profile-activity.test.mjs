import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  clipText,
  compareActivityDesc,
  decodeActivityCursor,
  encodeActivityCursor,
  maskIpAddress,
  normalizeActivitySource,
  summarizeUserAgent,
} from '../src/components/profile/activity-format.ts';

/**
 * The profile's Recent activity shows a person their own audit rows. What reaches the browser is
 * deliberately reduced — a recognisable device name, not the raw user agent; a masked address, not
 * the full one — and the list pages by a cursor that must never skip or repeat a row.
 */

test('user agents become a short, recognisable device name', () => {
  const chromeWin = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
  assert.equal(summarizeUserAgent(chromeWin), 'Chrome on Windows');
  const androidApp = 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0 Mobile Safari/537.36';
  assert.equal(summarizeUserAgent(androidApp), 'Android app');
  assert.equal(summarizeUserAgent('curl/8.4.0'), 'curl');
  assert.equal(summarizeUserAgent(''), null);
  assert.equal(summarizeUserAgent(42), null);
});

test('addresses are masked, and anything that is not an address is dropped', () => {
  assert.equal(maskIpAddress('203.0.113.47'), '203.0.113.x');
  assert.equal(maskIpAddress('203.0.113.47, 10.0.0.1'), '203.0.113.x', 'first hop of a forwarded list');
  assert.equal(maskIpAddress('203.0.113.47:5678'), '203.0.113.x', 'port stripped');
  assert.equal(maskIpAddress('::ffff:198.51.100.7'), '198.51.100.x', 'IPv4-mapped IPv6');
  assert.equal(maskIpAddress('2001:db8:85a3::8a2e:370:7334'), '2001:db8:85a3:…');
  assert.equal(maskIpAddress('999.1.1.1'), null);
  assert.equal(maskIpAddress('<script>'), null);
  assert.equal(maskIpAddress(undefined), null);
});

test('the cursor round-trips at full precision and rejects anything malformed', () => {
  const cursor = { seconds: 1790000000, nanoseconds: 123456000, id: 'AbC_12-x' };
  assert.deepEqual(decodeActivityCursor(encodeActivityCursor(cursor)), cursor);
  assert.deepEqual(decodeActivityCursor('2026-09-26T10:15:02.5Z'), { seconds: Date.parse('2026-09-26T10:15:02Z') / 1000, nanoseconds: 500000000, id: null });
  for (const bad of ['yesterday', '2026-09-26', '2026-09-26T10:15:02Z~bad id', '', null]) assert.equal(decodeActivityCursor(bad), null, String(bad));
});

test('rows sort newest first with a stable tie-break, the same order the query pages in', () => {
  const rows = [
    { seconds: 10, nanoseconds: 0, id: 'a' },
    { seconds: 20, nanoseconds: 5, id: 'b' },
    { seconds: 20, nanoseconds: 5, id: 'c' },
    { seconds: 20, nanoseconds: 1, id: 'd' },
  ];
  assert.deepEqual(rows.sort(compareActivityDesc).map((r) => r.id), ['c', 'b', 'd', 'a']);
});

test('sources and summaries are normalised', () => {
  assert.equal(normalizeActivitySource('cron'), 'cron');
  assert.equal(normalizeActivitySource(undefined), 'user');
  // Browser rows carry no source; an unrecognised one is reported as a server write, not as the user.
  assert.equal(normalizeActivitySource('evil'), 'server');
  assert.equal(clipText('  PO-2024-001  ', 80), 'PO-2024-001');
  assert.equal(clipText('x'.repeat(200), 10)?.length <= 11, true);
  assert.equal(clipText(null, 10), null);
});
