import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  daysBetween,
  inDaysLabel,
  recentDays,
  relativeTime,
  settingsChecks,
  summarizeChecks,
  upcomingHolidays,
} from '../src/lib/settings-overview.ts';

const ids = (checks) => checks.map((check) => check.id);
const issue = (checks, id) => checks.find((check) => check.id === id)?.issue;

test('a source that is absent makes no check at all', () => {
  assert.deepEqual(settingsChecks({ today: '2026-11-02' }), []);
  assert.deepEqual(ids(settingsChecks({ today: '2026-11-02', workingWeekSaved: true })), ['working-week']);
  assert.deepEqual(summarizeChecks([]), { total: 0, passing: 0, issues: [], score: 100 });
});

test('document numbers: one check per series, each linking to its own page', () => {
  const checks = settingsChecks({
    today: '2026-11-02',
    series: [
      { id: 'sfr', name: 'Site Fund Requisition', href: '/sfr/settings/serial-numbers', configured: false, valid: false },
      { id: 'grn', name: 'Store Stock GRN', href: '/store/settings/serial-numbers', configured: true, valid: false },
      { id: 'dr', name: 'Daily Requisition', href: '/dr/settings/serial-numbers', configured: true, valid: true },
    ],
  });
  assert.deepEqual(ids(checks), ['series:sfr', 'series:grn', 'series:dr']);
  assert.equal(issue(checks, 'series:sfr').title, 'Site Fund Requisition numbering not set up');
  assert.equal(issue(checks, 'series:sfr').tone, 'warning');
  assert.equal(checks[0].href, '/sfr/settings/serial-numbers');
  assert.equal(issue(checks, 'series:grn').tone, 'danger');
  assert.equal(checks[1].action, 'Fix');
  assert.equal(issue(checks, 'series:dr'), undefined);
});

test("holidays: this year's list is required; next year's from November", () => {
  assert.equal(issue(settingsChecks({ today: '2026-05-10', holidayDates: [] }), 'holidays').title, 'No holidays for 2026');
  assert.equal(issue(settingsChecks({ today: '2026-10-31', holidayDates: ['2026-01-26'] }), 'holidays'), undefined);
  assert.equal(issue(settingsChecks({ today: '2026-11-02', holidayDates: ['2026-01-26'] }), 'holidays').title, '2027 holidays not entered');
  assert.equal(issue(settingsChecks({ today: '2026-11-02', holidayDates: ['2026-01-26', '2027-01-26'] }), 'holidays'), undefined);
});

test('company, departments, theme and the reporting copy each check what they hold', () => {
  const checks = settingsChecks({
    today: '2026-11-02',
    company: { gstins: 7, pan: false, logo: false },
    departments: { active: 9, withoutHead: 2 },
    themePublished: false,
    reporting: { status: 'failed' },
  });
  assert.equal(issue(checks, 'company-gst'), undefined);
  assert.equal(issue(checks, 'company-pan').tone, 'warning');
  assert.equal(issue(checks, 'company-logo').tone, 'info');
  assert.equal(issue(checks, 'department-heads').title, '2 active departments without a head');
  assert.equal(issue(checks, 'theme').tone, 'info');
  assert.equal(issue(checks, 'reporting').tone, 'danger');
  assert.equal(issue(settingsChecks({ today: '2026-11-02', reporting: null }), 'reporting').title, 'Reporting copy has never run');
  assert.equal(issue(settingsChecks({ today: '2026-11-02', reporting: { status: 'running' } }), 'reporting'), undefined);

  const summary = summarizeChecks(checks);
  assert.equal(summary.total, 6);
  assert.equal(summary.passing, 1);
  assert.equal(summary.score, 17);
  assert.deepEqual(summary.issues.map((check) => check.issue.tone), ['danger', 'warning', 'warning', 'info', 'info']);
});

test('holiday countdowns and the 14-day window use local calendar days', () => {
  assert.equal(daysBetween('2026-11-02', '2026-11-14'), 12);
  assert.equal(daysBetween('2026-03-28', '2026-03-30'), 2);
  assert.ok(Number.isNaN(daysBetween('2026-11-02', 'soon')));
  const holidays = [
    { name: 'Christmas', date: '2026-12-25' },
    { name: 'Diwali', date: '2026-11-08' },
    { name: 'Gone', date: '2026-10-02' },
    { name: 'Bad', date: '8 Nov' },
    { name: 'Today', date: '2026-11-02' },
  ];
  assert.deepEqual(upcomingHolidays(holidays, '2026-11-02', 2), [
    { name: 'Today', date: '2026-11-02', inDays: 0 },
    { name: 'Diwali', date: '2026-11-08', inDays: 6 },
  ]);
  assert.deepEqual([0, 1, 6].map(inDaysLabel), ['Today', 'Tomorrow', 'In 6 days']);

  const days = recentDays(new Date(2026, 10, 2, 15, 30), 14);
  assert.equal(days.length, 14);
  assert.equal(days[0].day, '2026-10-20');
  assert.equal(days[13].day, '2026-11-02');
  assert.equal(days[13].start.getHours(), 0);
  assert.equal(days[13].end.getDate(), 3);
});

test('recent changes read as relative times', () => {
  const now = new Date(2026, 10, 2, 15, 0).getTime();
  assert.equal(relativeTime(now - 20_000, now), 'Just now');
  assert.equal(relativeTime(now - 12 * 60_000, now), '12 min ago');
  assert.equal(relativeTime(now - 3 * 3_600_000, now), '3 h ago');
  assert.equal(relativeTime(new Date(2026, 10, 1, 9).getTime(), now), 'Yesterday');
  assert.equal(relativeTime(new Date(2026, 9, 28, 9).getTime(), now), '28 Oct');
});
