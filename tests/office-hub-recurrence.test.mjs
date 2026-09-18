import test from 'node:test';
import assert from 'node:assert/strict';

import {
  describeRecurrence,
  expandRecurrence,
  isRecurring,
  nextOccurrenceOnOrAfter,
  normalizeRecurrence,
  pendingOccurrences,
  planSeriesEdit,
  seriesCoverage,
  OfficeHubRecurrenceError,
  OFFICE_HUB_MAX_OCCURRENCES,
  OFFICE_HUB_RECURRENCE_HORIZON_DAYS,
} from '../src/lib/office-hub-recurrence.ts';
import { utcToZonedParts, zonedTimeToUtc } from '../src/lib/office-hub-time.ts';

const dates = (occurrences) => occurrences.map((occurrence) => occurrence.date);

test('a non-recurring meeting expands to itself', () => {
  const rule = { frequency: 'None', interval: 1, endMode: 'never' };
  assert.equal(isRecurring(rule), false);
  assert.deepEqual(expandRecurrence(rule, '2026-09-21'), [
    { occurrenceKey: '2026-09-21', date: '2026-09-21', occurrenceNumber: 1 },
  ]);
});

test('normalizeRecurrence fills in what the form left blank from the start date', () => {
  // 21 Sep 2026 is a Monday.
  const weekly = normalizeRecurrence({ frequency: 'Weekly', endMode: 'never' }, '2026-09-21');
  assert.deepEqual(weekly.weekdays, [1], 'defaults to the weekday it starts on');
  assert.equal(weekly.interval, 1);

  const monthly = normalizeRecurrence({ frequency: 'Monthly', endMode: 'never' }, '2026-09-07');
  assert.equal(monthly.monthlyMode, 'day-of-month');
  assert.equal(monthly.dayOfMonth, 7);

  // A date in the last week of its month is stored as "last <weekday>", not "4th".
  const lastFriday = normalizeRecurrence(
    { frequency: 'Monthly', monthlyMode: 'weekday-of-month', endMode: 'never' },
    '2026-09-25',
  );
  assert.equal(lastFriday.weekdayOrdinal, -1);
  assert.equal(lastFriday.weekday, 5);

  // Custom with no weekdays is the same thing as Daily with an interval, and is stored as such.
  const custom = normalizeRecurrence({ frequency: 'Custom', interval: 3, endMode: 'never' }, '2026-09-21');
  assert.equal(custom.frequency, 'Daily');
  assert.equal(custom.interval, 3);

  // A negative or fractional interval cannot produce an infinite loop.
  assert.equal(normalizeRecurrence({ frequency: 'Daily', interval: 0, endMode: 'never' }, '2026-09-21').interval, 1);
  assert.equal(normalizeRecurrence({ frequency: 'Daily', interval: -5, endMode: 'never' }, '2026-09-21').interval, 1);
});

test('daily recurrence honours the interval and the occurrence count', () => {
  const rule = { frequency: 'Daily', interval: 2, endMode: 'after-occurrences', occurrences: 4 };
  assert.deepEqual(dates(expandRecurrence(rule, '2026-09-21')), [
    '2026-09-21',
    '2026-09-23',
    '2026-09-25',
    '2026-09-27',
  ]);
});

test('weekly recurrence selects the chosen weekdays, and the interval means whole weeks', () => {
  // Mon/Wed/Fri, starting Monday 21 Sep 2026.
  const weekly = {
    frequency: 'Weekly',
    interval: 1,
    weekdays: [1, 3, 5],
    endMode: 'after-occurrences',
    occurrences: 6,
  };
  assert.deepEqual(dates(expandRecurrence(weekly, '2026-09-21')), [
    '2026-09-21',
    '2026-09-23',
    '2026-09-25',
    '2026-09-28',
    '2026-09-30',
    '2026-10-02',
  ]);

  // Fortnightly Mon/Wed means those two days, every other week — not every other selected day.
  const fortnightly = {
    frequency: 'Weekly',
    interval: 2,
    weekdays: [1, 3],
    endMode: 'after-occurrences',
    occurrences: 4,
  };
  assert.deepEqual(dates(expandRecurrence(fortnightly, '2026-09-21')), [
    '2026-09-21',
    '2026-09-23',
    '2026-10-05',
    '2026-10-07',
  ]);
});

test('the first instance is always the start date, even when the rule would not select it', () => {
  // A Mon/Wed series that the organizer started on a Tuesday. The Tuesday is what they scheduled.
  const rule = { frequency: 'Weekly', interval: 1, weekdays: [1, 3], endMode: 'after-occurrences', occurrences: 4 };
  const expanded = dates(expandRecurrence(rule, '2026-09-22'));
  assert.equal(expanded[0], '2026-09-22', 'the Tuesday survives');
  assert.deepEqual(expanded, ['2026-09-22', '2026-09-23', '2026-09-28', '2026-09-30']);
});

test('monthly by day-of-month clamps to short months rather than skipping them', () => {
  const rule = { frequency: 'Monthly', interval: 1, monthlyMode: 'day-of-month', dayOfMonth: 31, endMode: 'after-occurrences', occurrences: 5 };
  assert.deepEqual(dates(expandRecurrence(rule, '2025-12-31')), [
    '2025-12-31',
    '2026-01-31',
    '2026-02-28',
    '2026-03-31',
    '2026-04-30',
  ]);
});

test('monthly by weekday ordinal tracks "last Friday" across a 5-Friday month', () => {
  const rule = {
    frequency: 'Monthly',
    interval: 1,
    monthlyMode: 'weekday-of-month',
    weekday: 5,
    weekdayOrdinal: -1,
    endMode: 'after-occurrences',
    occurrences: 4,
  };
  const expanded = dates(expandRecurrence(rule, '2026-09-25'));
  assert.deepEqual(expanded, ['2026-09-25', '2026-10-30', '2026-11-27', '2026-12-25']);

  const firstMonday = {
    frequency: 'Monthly',
    interval: 1,
    monthlyMode: 'weekday-of-month',
    weekday: 1,
    weekdayOrdinal: 1,
    endMode: 'after-occurrences',
    occurrences: 3,
  };
  assert.deepEqual(dates(expandRecurrence(firstMonday, '2026-09-07')), ['2026-09-07', '2026-10-05', '2026-11-02']);
});

test('yearly recurrence keeps the date across a leap year', () => {
  const rule = { frequency: 'Yearly', interval: 1, endMode: 'after-occurrences', occurrences: 3 };
  assert.deepEqual(dates(expandRecurrence(rule, '2024-02-29')), ['2024-02-29', '2025-02-28', '2026-02-28']);
});

test('an end date stops the series, and "never" stops at the horizon', () => {
  const untilDate = { frequency: 'Weekly', interval: 1, weekdays: [1], endMode: 'on-date', endDate: '2026-10-12' };
  assert.deepEqual(dates(expandRecurrence(untilDate, '2026-09-21')), [
    '2026-09-21',
    '2026-09-28',
    '2026-10-05',
    '2026-10-12',
  ]);

  const forever = { frequency: 'Daily', interval: 1, endMode: 'never' };
  const expanded = expandRecurrence(forever, '2026-09-21');
  assert.ok(expanded.length > 0);
  assert.ok(expanded.length <= OFFICE_HUB_RECURRENCE_HORIZON_DAYS + 1, 'bounded by the horizon');
  assert.ok(expanded.length <= OFFICE_HUB_MAX_OCCURRENCES);
  assert.equal(expanded[expanded.length - 1].date <= '2026-12-14', true);
});

test('exceptions remove an instance without renumbering the rest of the series', () => {
  const rule = {
    frequency: 'Weekly',
    interval: 1,
    weekdays: [1],
    endMode: 'after-occurrences',
    occurrences: 4,
    exceptions: ['2026-09-28'],
  };
  const expanded = expandRecurrence(rule, '2026-09-21');
  assert.deepEqual(dates(expanded), ['2026-09-21', '2026-10-05', '2026-10-12']);
  // Cancelling the second meeting of four must not produce a fifth: the numbering counts what the
  // rule selected, so the series still ends at occurrence 4.
  assert.deepEqual(expanded.map((o) => o.occurrenceNumber), [1, 3, 4]);
});

test('pendingOccurrences is idempotent and never proposes deleting an existing instance', () => {
  const rule = { frequency: 'Weekly', interval: 1, weekdays: [1], endMode: 'after-occurrences', occurrences: 4 };
  const all = dates(expandRecurrence(rule, '2026-09-21'));

  assert.deepEqual(dates(pendingOccurrences(rule, '2026-09-21', [])), all, 'nothing exists yet');
  assert.deepEqual(
    dates(pendingOccurrences(rule, '2026-09-21', all)),
    [],
    'running generation twice creates nothing — §86',
  );
  assert.deepEqual(dates(pendingOccurrences(rule, '2026-09-21', [all[0], all[2]])), [all[1], all[3]]);

  // An instance that was individually rescheduled out of the pattern is simply not in the rule's
  // output; the function has no mechanism to delete it, which is the point.
  const withStray = pendingOccurrences(rule, '2026-09-21', [...all, '2026-11-30']);
  assert.deepEqual(dates(withStray), []);
});

test('the occurrence key is the date, which is what makes generation deterministic', () => {
  const rule = { frequency: 'Weekly', interval: 1, weekdays: [2], endMode: 'after-occurrences', occurrences: 3 };
  const first = expandRecurrence(rule, '2026-09-22');
  const second = expandRecurrence(rule, '2026-09-22');
  assert.deepEqual(first, second);
  for (const occurrence of first) {
    assert.equal(occurrence.occurrenceKey, occurrence.date);
  }
});

test('a weekly series keeps its local hour when the zone changes offset mid-series', () => {
  // Europe/London falls back on 25 October 2026. A Monday 09:00 series spanning it must stay 09:00.
  const rule = { frequency: 'Weekly', interval: 1, weekdays: [1], endMode: 'on-date', endDate: '2026-11-02' };
  const expanded = dates(expandRecurrence(rule, '2026-10-19'));
  assert.deepEqual(expanded, ['2026-10-19', '2026-10-26', '2026-11-02']);

  const instants = expanded.map((date) => zonedTimeToUtc(date, '09:00', 'Europe/London'));
  // The UTC instants differ by an hour across the boundary — which is correct, and is exactly what
  // adding 7×86400 seconds to the first instant would have got wrong.
  assert.equal(instants[0].toISOString(), '2026-10-19T08:00:00.000Z');
  assert.equal(instants[1].toISOString(), '2026-10-26T09:00:00.000Z');
  // What the participants see never moves.
  for (const instant of instants) {
    assert.equal(utcToZonedParts(instant, 'Europe/London').time, '09:00');
  }
});

test('nextOccurrenceOnOrAfter finds the next meeting in the series', () => {
  const rule = { frequency: 'Weekly', interval: 1, weekdays: [1], endMode: 'never' };
  const next = nextOccurrenceOnOrAfter(rule, '2026-09-21', '2026-09-30');
  assert.equal(next.date, '2026-10-05');
  assert.equal(nextOccurrenceOnOrAfter(rule, '2026-09-21', '2026-09-21').date, '2026-09-21');
});

test('describeRecurrence puts the rule into words so a mistake is visible', () => {
  assert.equal(describeRecurrence(null), 'Does not repeat');
  assert.equal(describeRecurrence({ frequency: 'None', interval: 1, endMode: 'never' }), 'Does not repeat');
  assert.equal(
    describeRecurrence({ frequency: 'Daily', interval: 1, endMode: 'never' }),
    'Every day',
  );
  assert.equal(
    describeRecurrence({ frequency: 'Weekly', interval: 2, weekdays: [1, 3], endMode: 'on-date', endDate: '2026-12-31' }),
    'Every 2 weeks on Monday, Wednesday, until 31 Dec 2026',
  );
  assert.equal(
    describeRecurrence({ frequency: 'Monthly', interval: 1, monthlyMode: 'weekday-of-month', weekday: 5, weekdayOrdinal: -1, endMode: 'after-occurrences', occurrences: 12 }),
    'Every month on the last Friday, 12 times',
  );
  assert.equal(
    describeRecurrence({ frequency: 'Monthly', interval: 1, monthlyMode: 'day-of-month', dayOfMonth: 7, endMode: 'never' }),
    'Every month on day 7',
  );
});

test('editing one occurrence cannot silently change the whole series', () => {
  const single = planSeriesEdit({ scope: 'occurrence', changesRule: false, instanceCount: 10, instanceDate: '2026-09-28' });
  assert.equal(single.scope, 'occurrence');
  assert.match(single.confirmation, /only the meeting on 28 Sep 2026/);

  const series = planSeriesEdit({ scope: 'series', changesRule: true, instanceCount: 10 });
  assert.match(series.confirmation, /all 10 meetings/);

  assert.throws(
    () => planSeriesEdit({ scope: 'occurrence', changesRule: true, instanceCount: 10 }),
    OfficeHubRecurrenceError,
  );
});

test('seriesCoverage reports how far ahead a series is materialised', () => {
  const coverage = seriesCoverage(['2026-09-01', '2026-09-21', '2026-10-05'], '2026-09-18');
  assert.equal(coverage.lastDate, '2026-10-05');
  assert.equal(coverage.daysCovered, 17);
  assert.deepEqual(seriesCoverage(['2026-01-01'], '2026-09-18'), { lastDate: null, daysCovered: 0 });
});
