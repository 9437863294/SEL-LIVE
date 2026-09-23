#!/usr/bin/env node
/**
 * Fetch a window of greytHR's daily muster and run it through the real normaliser.
 *
 *   node --experimental-strip-types scripts/check-greythr-swipes.mjs [start] [end]
 *
 * Read-only: it calls greytHR and prints what the swipe register would store. Written because the
 * swipe feature's whole risk is in the wire shape — greytHR mixes timezones within a single record
 * (shift times UTC, punches local) and publishes no raw punch list — and a unit test against a
 * captured fixture cannot tell you the live response still looks like the fixture.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildSwipeMonth, hasSwipeData, swipeHours, swipeMonthKey } from '../src/lib/greythr.ts';

const loadEnv = (path) => {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[trimmed.slice(0, index).trim()] = value;
  }
  return out;
};

const env = {
  ...loadEnv(resolve(process.cwd(), '.env')),
  ...loadEnv(resolve(process.cwd(), '.env.local')),
};
const domain = (process.env.GREYTHR_DOMAIN || env.GREYTHR_DOMAIN || 'siddhartha.greythr.com').trim();
const username = (process.env.GREYTHR_USERNAME || env.GREYTHR_USERNAME || '').trim();
const password = (process.env.GREYTHR_PASSWORD || env.GREYTHR_PASSWORD || '').trim();

if (!username || !password) {
  console.error('GREYTHR_USERNAME / GREYTHR_PASSWORD are not set.');
  process.exit(1);
}

const start = process.argv[2] ?? `${swipeMonthKey()}-01`;
const end = process.argv[3] ?? start;

const tokenResponse = await fetch(`https://${domain}/uas/v1/oauth2/client-token`, {
  method: 'POST',
  headers: { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` },
});
if (!tokenResponse.ok) {
  console.error(`greytHR authentication failed (${tokenResponse.status}).`);
  process.exit(1);
}
const token = (await tokenResponse.json()).access_token;

const url = new URL('https://api.greythr.com/attendance/v2/employee/muster');
for (const [key, value] of Object.entries({ start, end, page: 0, size: 100 })) {
  url.searchParams.set(key, String(value));
}
const response = await fetch(url.toString(), {
  headers: { 'ACCESS-TOKEN': token, 'x-greythr-domain': domain },
});
if (!response.ok) {
  console.error(`muster returned ${response.status}: ${(await response.text()).slice(0, 200)}`);
  process.exit(1);
}
const payload = await response.json();
const rows = Array.isArray(payload?.data) ? payload.data : [];

console.log(`\nmuster ${start} → ${end}`);
console.log(`rows on page 0: ${rows.length} of ${payload?.pages?.totalElements ?? '?'}\n`);

const month = swipeMonthKey(new Date(`${start}T00:00:00`));
const normalized = rows.map((row) =>
  buildSwipeMonth(row, { month, periodStart: start, periodEnd: end, syncedAt: new Date().toISOString() }),
);
const worthStoring = normalized.filter(hasSwipeData);

console.log(`would store ${worthStoring.length} of ${normalized.length} employee-months`);
console.log(
  `days: ${normalized.reduce((sum, m) => sum + m.totals.daysRecorded, 0)}, ` +
    `with a punch: ${normalized.reduce((sum, m) => sum + m.totals.swiped, 0)}`,
);

const withPunches = normalized.filter((m) => m.totals.swiped > 0).slice(0, 5);
console.log('\nemployees with punches in this window:');
for (const employeeMonth of withPunches) {
  for (const day of employeeMonth.days.filter((d) => d.firstIn)) {
    console.log(
      `  emp ${employeeMonth.employeeId.padEnd(5)} ${day.date}  ${day.status.padEnd(4)} ` +
        `in ${String(day.firstIn).padEnd(6)} out ${String(day.lastOut ?? '—').padEnd(6)} ` +
        `worked ${String(day.workHrs ?? '—').padEnd(6)} ${day.exceptions.join(', ')}`,
    );
  }
}

const totalMinutes = normalized.reduce((sum, m) => sum + m.totals.workMinutes, 0);
console.log(`\ntotal worked across the window: ${swipeHours(totalMinutes)}`);
console.log(
  `flags — late: ${normalized.reduce((sum, m) => sum + m.totals.lateIn, 0)}, ` +
    `early: ${normalized.reduce((sum, m) => sum + m.totals.earlyOut, 0)}`,
);
console.log(
  '\nNote: a punch time is printed exactly as greytHR sent it. greytHR reports shift times in UTC\n' +
    'and punches in local time within the same record, so these are never passed through Date.\n',
);
