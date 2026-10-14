import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_REPORTING_COPY_CONFIG,
  describeReportingCopySchedule,
  isDirectChildOf,
  latestReportingCopySlot,
  makeValueConverter,
  nextReportingCopySlot,
  normalizeReportingCopyConfig,
  parseReportingCopySettings,
  reportingCopyDue,
  reportingCopyNextDueAt,
} from '../src/lib/reporting-copy.ts';

/** Every case pins `now`; Asia/Kolkata is UTC+05:30 all year, so local times are easy to check. */
const config = (overrides = {}) => ({ ...DEFAULT_REPORTING_COPY_CONFIG, enabled: true, ...overrides });
const ist = (local) => new Date(`${local}+05:30`);
const fresh = { lastScheduledSlot: null, handledRequestAt: null };

test('daily: the newest slot is today once its time has passed, otherwise yesterday', () => {
  const daily = config({ frequency: 'daily', timeOfDay: '02:00' });
  assert.equal(latestReportingCopySlot(daily, ist('2026-10-14T03:00:00')).toISOString(), ist('2026-10-14T02:00:00').toISOString());
  assert.equal(latestReportingCopySlot(daily, ist('2026-10-14T01:59:00')).toISOString(), ist('2026-10-13T02:00:00').toISOString());
  assert.equal(nextReportingCopySlot(daily, ist('2026-10-14T03:00:00')).toISOString(), ist('2026-10-15T02:00:00').toISOString());
});

test('every N hours counts from the time of day, the same times every day', () => {
  const sixHourly = config({ frequency: 'everyHours', everyHours: 6, timeOfDay: '02:00' });
  // 02:00, 08:00, 14:00, 20:00 local.
  assert.equal(latestReportingCopySlot(sixHourly, ist('2026-10-14T13:59:00')).toISOString(), ist('2026-10-14T08:00:00').toISOString());
  assert.equal(nextReportingCopySlot(sixHourly, ist('2026-10-14T21:00:00')).toISOString(), ist('2026-10-15T02:00:00').toISOString());
  // A start late in the day still yields the earlier slots of the cycle: 23:30 every 12 hours is 11:30 too.
  const late = config({ frequency: 'everyHours', everyHours: 12, timeOfDay: '23:30' });
  assert.equal(latestReportingCopySlot(late, ist('2026-10-14T12:00:00')).toISOString(), ist('2026-10-14T11:30:00').toISOString());
  const hourly = config({ frequency: 'everyHours', everyHours: 1, timeOfDay: '00:15' });
  assert.equal(nextReportingCopySlot(hourly, ist('2026-10-14T10:20:00')).toISOString(), ist('2026-10-14T11:15:00').toISOString());
});

test('weekly runs only on the chosen days', () => {
  // 2026-10-14 is a Wednesday.
  const weekly = config({ frequency: 'weekly', weekDays: [1, 5], timeOfDay: '06:00' });
  assert.equal(latestReportingCopySlot(weekly, ist('2026-10-14T12:00:00')).toISOString(), ist('2026-10-12T06:00:00').toISOString());
  assert.equal(nextReportingCopySlot(weekly, ist('2026-10-14T12:00:00')).toISOString(), ist('2026-10-16T06:00:00').toISOString());
  assert.equal(latestReportingCopySlot(config({ frequency: 'weekly', weekDays: [] }), ist('2026-10-14T12:00:00')), null);
});

test('other timezones, across a daylight-saving change', () => {
  const london = config({ frequency: 'daily', timeOfDay: '02:30', timezone: 'Europe/London' });
  // BST (UTC+1) on 24 October, GMT after the 25 October change.
  assert.equal(latestReportingCopySlot(london, new Date('2026-10-24T12:00:00Z')).toISOString(), '2026-10-24T01:30:00.000Z');
  assert.equal(latestReportingCopySlot(london, new Date('2026-10-26T12:00:00Z')).toISOString(), '2026-10-26T02:30:00.000Z');
});

test('a passed slot is due once; a late tick still starts it; missed slots start one run', () => {
  const daily = config({ frequency: 'daily', timeOfDay: '02:00' });
  const now = ist('2026-10-14T02:40:00');
  const due = reportingCopyDue(daily, fresh, now);
  assert.equal(due.due, true);
  assert.equal(due.trigger, 'schedule');
  assert.equal(due.slot, ist('2026-10-14T02:00:00').toISOString());
  assert.equal(reportingCopyDue(daily, { ...fresh, lastScheduledSlot: due.slot }, now).due, false);
  // Three days without a tick: the newest slot is the one that starts, once.
  const after = reportingCopyDue(daily, { ...fresh, lastScheduledSlot: ist('2026-10-11T02:00:00').toISOString() }, now);
  assert.equal(after.slot, ist('2026-10-14T02:00:00').toISOString());
});

test('switched off, nothing scheduled is due — but Refresh now still is', () => {
  const off = config({ enabled: false });
  const now = ist('2026-10-14T12:00:00');
  assert.equal(reportingCopyDue(off, fresh, now).due, false);
  assert.equal(reportingCopyNextDueAt(off, fresh, now), null);
  const requested = { ...off, requestedAt: ist('2026-10-14T11:58:00').toISOString() };
  assert.deepEqual(
    [reportingCopyDue(requested, fresh, now).due, reportingCopyDue(requested, fresh, now).trigger],
    [true, 'manual'],
  );
  assert.equal(reportingCopyDue(requested, { ...fresh, handledRequestAt: requested.requestedAt }, now).due, false);
});

test('slots before the schedule was saved are not missed runs', () => {
  const daily = config({ frequency: 'daily', timeOfDay: '02:00', scheduleFrom: ist('2026-10-14T10:00:00').toISOString() });
  const now = ist('2026-10-14T10:15:00');
  assert.equal(reportingCopyDue(daily, fresh, now).due, false);
  assert.equal(reportingCopyNextDueAt(daily, fresh, now), ist('2026-10-15T02:00:00').toISOString());
  assert.equal(reportingCopyDue(daily, fresh, ist('2026-10-15T02:05:00')).due, true);
});

test('settings are validated strictly and normalised leniently', () => {
  const good = { enabled: true, frequency: 'weekly', everyHours: 6, weekDays: [5, 1, 1], timeOfDay: '06:30', timezone: 'Asia/Kolkata' };
  assert.deepEqual(parseReportingCopySettings(good), { ok: true, value: { ...good, weekDays: [1, 5] } });
  for (const bad of [
    { ...good, enabled: 'yes' },
    { ...good, frequency: 'monthly' },
    { ...good, everyHours: 5 },
    { ...good, weekDays: [] },
    { ...good, weekDays: [7] },
    { ...good, timeOfDay: '6:30' },
    { ...good, timeOfDay: '24:00' },
    { ...good, timezone: 'Mars/Olympus' },
    null,
  ]) {
    assert.equal(parseReportingCopySettings(bad).ok, false, JSON.stringify(bad));
  }
  const normalized = normalizeReportingCopyConfig({ frequency: 'hourly', everyHours: 5, timezone: 'nowhere', timeOfDay: 'noon' });
  assert.equal(normalized.enabled, false);
  assert.equal(normalized.frequency, 'daily');
  assert.equal(normalized.everyHours, 6);
  assert.equal(normalized.timezone, 'Asia/Kolkata');
  assert.equal(normalized.timeOfDay, '02:00');
  assert.equal(normalizeReportingCopyConfig({ timeOfDay: '7:05' }).timeOfDay, '07:05');
});

test('the schedule reads as a sentence', () => {
  assert.equal(describeReportingCopySchedule(config({ frequency: 'daily', timeOfDay: '02:00' })), 'Daily at 02:00 (Asia/Kolkata)');
  assert.equal(describeReportingCopySchedule(config({ frequency: 'everyHours', everyHours: 4 })), 'Every 4 hours from 02:00 (Asia/Kolkata)');
  assert.equal(describeReportingCopySchedule(config({ frequency: 'weekly', weekDays: [1, 4] })), 'Weekly on Mon, Thu at 02:00 (Asia/Kolkata)');
  assert.equal(describeReportingCopySchedule(config({ enabled: false })), 'Off');
});

test('Firestore values become BSON-friendly ones, excluded fields dropped at every depth', () => {
  class Timestamp { constructor(ms) { this.ms = ms; } toDate() { return new Date(this.ms); } }
  class GeoPoint { constructor(latitude, longitude) { this.latitude = latitude; this.longitude = longitude; } }
  class DocumentReference { constructor(path) { this.path = path; } }
  const convert = makeValueConverter({ Timestamp, GeoPoint, DocumentReference }, ['secret']);
  const bytes = Buffer.from('hi');
  const out = convert({
    at: new Timestamp(0),
    where: new GeoPoint(26.1, 91.7),
    ref: new DocumentReference('projects/p1'),
    bytes,
    list: [new Timestamp(1000), { secret: 'x', keep: 1 }],
    nested: { secret: 'y', missing: undefined, n: null },
  });
  assert.deepEqual(out, {
    at: new Date(0),
    where: { latitude: 26.1, longitude: 91.7 },
    ref: 'projects/p1',
    bytes,
    list: [new Date(1000), { keep: 1 }],
    nested: { missing: null, n: null },
  });
});

test('a collection-group document belongs to a root only when it sits directly under it', () => {
  assert.equal(isDirectChildOf('projects/p1/bills/b1', 'projects'), true);
  assert.equal(isDirectChildOf('users/u1/bills/b1', 'projects'), false);
  assert.equal(isDirectChildOf('projects/p1/stages/s1/bills/b1', 'projects'), false);
});
