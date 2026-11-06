import test from 'node:test';
import assert from 'node:assert/strict';

import {
  endDatePresets,
  holidaySkipsActive,
  repeatPreview,
  repeatWarnings,
  toggleSkip,
  withHolidaySkips,
} from '../src/lib/office-hub-repeat-builder.ts';

const START = '2026-11-06'; // a Friday
const HOLIDAYS = [
  { date: '2026-11-13', name: 'Some Friday holiday' },
  { date: '2026-12-25', name: 'Christmas' },
  { date: '2026-11-08', name: 'Diwali' }, // a Sunday — never hit by a Friday rule
];
const weeklyFriday = { frequency: 'Weekly', interval: 1, weekdays: [5], endMode: 'on-date', endDate: '2026-12-31' };

test('preview lists every date, marks skipped and holiday ones, counts only real meetings', () => {
  const preview = repeatPreview({ ...weeklyFriday, exceptions: ['2026-11-20'] }, START, HOLIDAYS);
  assert.equal(preview.dates[0].date, START);
  assert.equal(preview.dates[0].first, true);
  assert.equal(preview.dates.length, 8, 'eight Fridays from 6 Nov to 25 Dec');
  assert.deepEqual(preview.dates.find((entry) => entry.date === '2026-11-20'), { date: '2026-11-20', skipped: true, holiday: null, first: false });
  assert.equal(preview.dates.find((entry) => entry.date === '2026-12-25').holiday, 'Christmas');
  assert.equal(preview.meetings, 7);
  assert.equal(preview.openEnded, false);
});

test('holiday skips are added and removed without touching dates skipped by hand', () => {
  const manual = { ...weeklyFriday, exceptions: ['2026-11-20'] };
  const skipped = withHolidaySkips(manual, START, HOLIDAYS, true);
  assert.deepEqual(skipped.exceptions, ['2026-11-13', '2026-11-20', '2026-12-25']);
  assert.equal(holidaySkipsActive(skipped, START, HOLIDAYS), true);
  const unskipped = withHolidaySkips(skipped, START, HOLIDAYS, false);
  assert.deepEqual(unskipped.exceptions, ['2026-11-20']);
  assert.equal(holidaySkipsActive(unskipped, START, HOLIDAYS), false);
  assert.equal(withHolidaySkips({ ...weeklyFriday }, START, [], true).exceptions, undefined, 'no holidays, no exceptions key');
});

test('the start date is never skipped, even on a holiday', () => {
  const onHoliday = withHolidaySkips(weeklyFriday, '2026-11-13', HOLIDAYS, true);
  assert.ok(!(onHoliday.exceptions ?? []).includes('2026-11-13'));
  assert.deepEqual(toggleSkip(weeklyFriday, START, START), weeklyFriday);
  assert.deepEqual(toggleSkip(weeklyFriday, START, '2026-11-27').exceptions, ['2026-11-27']);
  assert.equal(toggleSkip({ ...weeklyFriday, exceptions: ['2026-11-27'] }, START, '2026-11-27').exceptions, undefined);
});

test('end presets: calendar year, Indian financial year, 3 and 6 months', () => {
  assert.deepEqual(endDatePresets(START), [
    { label: 'End of Dec 2026', date: '2026-12-31' },
    { label: 'End of FY 26-27', date: '2027-03-31' },
    { label: '3 months', date: '2027-02-05' },
    { label: '6 months', date: '2027-05-05' },
  ]);
  assert.equal(endDatePresets('2027-02-10').find((preset) => preset.label.startsWith('End of FY')).date, '2027-03-31');
  assert.ok(!endDatePresets('2026-12-31').some((preset) => preset.date === '2026-12-31'), 'not a preset that ends on the start');
});

test('warnings: no end, a non-working day, start not on a chosen day, day 29+', () => {
  const never = repeatWarnings({ ...weeklyFriday, endMode: 'never' }, START);
  assert.equal(never[0].tone, 'caution');
  const sunday = repeatWarnings({ ...weeklyFriday, weekdays: [0, 5] }, START, { workingDays: [1, 2, 3, 4, 5, 6] });
  assert.ok(sunday.some((warning) => warning.text.includes('non-working day')));
  const notStart = repeatWarnings({ ...weeklyFriday, weekdays: [1] }, START, { formatDate: () => 'Fri, 6 Nov' });
  assert.ok(notStart.some((warning) => warning.text.includes('stays on Fri, 6 Nov')));
  const late = repeatWarnings({ frequency: 'Monthly', interval: 1, monthlyMode: 'day-of-month', dayOfMonth: 31, endMode: 'after-occurrences', occurrences: 6 }, '2026-10-31');
  assert.ok(late.some((warning) => warning.text.includes('last day')));
  assert.deepEqual(repeatWarnings({ frequency: 'None', interval: 1, endMode: 'never' }, START), []);
});
