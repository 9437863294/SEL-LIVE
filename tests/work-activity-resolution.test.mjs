/**
 * The Activity Resolution Engine, tested against the brief's own worked examples.
 *
 * The examples are the specification, so they are the tests: §X's meeting-overrides-idle, §Z's
 * no-double-counting, §U's call-during-an-idle-desk, §BE's raw-to-final walkthrough. If these
 * pass the engine does what was asked; if one fails, the failure names the rule it broke.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CATEGORY_PRIORITY,
  recordedWorkSeconds,
  resolveWorkday,
} from '../src/lib/work-activity-resolution.ts';

/** Every instant here is UTC so the arithmetic in the assertions is readable. */
const at = (time) => `2026-09-21T${time}:00.000Z`;
const minutes = (count) => count * 60;

const claim = (category, from, to, extra = {}) => ({
  source: extra.source ?? 'WINDOWS',
  category,
  startAt: at(from),
  endAt: at(to),
  contextName: extra.contextName ?? null,
  contextId: extra.contextId ?? null,
  detail: extra.detail ?? null,
});

const sumTotals = (day) => Object.values(day.totals).reduce((sum, value) => sum + value, 0);

/* ── §X. A confirmed meeting overrides an idle desk ──────────────────────────────────────── */

test('a meeting overrides idle, and the remainder stays idle', () => {
  // The brief's example: PC idle 11:30-12:30, meeting attendance 11:30-12:15.
  const day = resolveWorkday([
    claim('UNEXPLAINED_IDLE', '11:30', '12:30'),
    claim('MEETING', '11:30', '12:15', { source: 'MEETING', contextName: 'Project Review' }),
  ]);

  assert.equal(day.totals.MEETING, minutes(45));
  assert.equal(day.totals.UNEXPLAINED_IDLE, minutes(15));

  assert.equal(day.intervals.length, 2);
  assert.equal(day.intervals[0].category, 'MEETING');
  assert.equal(day.intervals[0].contextName, 'Project Review');
  assert.equal(day.intervals[1].category, 'UNEXPLAINED_IDLE');
});

test('a meeting starting after the desk went idle leaves that first minute idle', () => {
  // §BE's walkthrough: idle at 11:30, check-in 11:31, locked 11:38, meeting ends 12:20.
  const day = resolveWorkday([
    claim('UNEXPLAINED_IDLE', '11:30', '11:38'),
    claim('PC_LOCKED', '11:38', '12:25'),
    claim('MEETING', '11:31', '12:20', { source: 'MEETING', contextName: 'Project Review' }),
  ]);

  assert.equal(day.intervals[0].category, 'UNEXPLAINED_IDLE');
  assert.equal(day.intervals[0].durationSeconds, minutes(1));
  assert.equal(day.totals.MEETING, minutes(49));
  // The lock outlived the meeting; its tail is still a locked screen.
  assert.equal(day.totals.PC_LOCKED, minutes(5));
});

/* ── §U. A work call explains an idle desk ───────────────────────────────────────────────── */

test('a work call beats an idle desk rather than being lost to it', () => {
  const day = resolveWorkday([
    claim('UNEXPLAINED_IDLE', '15:12', '15:31'),
    claim('WORK_CALL', '15:12', '15:31', {
      source: 'ANDROID',
      contextName: 'Mr ABC - TPSODL',
      detail: 'Material Approval',
    }),
  ]);

  assert.equal(day.totals.WORK_CALL, minutes(19));
  assert.equal(day.totals.UNEXPLAINED_IDLE, 0);
  assert.equal(day.intervals[0].detail, 'Material Approval');
});

test('a meeting outranks a call that overlaps it', () => {
  // Somebody taking a call from a meeting room. Counting both would invent 19 minutes.
  const day = resolveWorkday([
    claim('MEETING', '11:00', '12:00', { source: 'MEETING', contextName: 'Finance Review' }),
    claim('WORK_CALL', '11:30', '11:49', { source: 'ANDROID', contextName: 'Vendor' }),
  ]);

  assert.equal(day.totals.MEETING, minutes(60));
  assert.equal(day.totals.WORK_CALL, 0);
  assert.equal(day.presenceSeconds, minutes(60));
});

/* ── §Z. No double counting ──────────────────────────────────────────────────────────────── */

test('a browser tab adds no time on top of the browser application', () => {
  // The agent records chrome.exe in the foreground; the extension records the tab inside it.
  // Both are true, and the hour must stay an hour.
  const day = resolveWorkday([
    claim('COMPUTER_APP', '10:00', '11:00', { contextName: 'Google Chrome' }),
    claim('WEBSITE', '10:00', '11:00', {
      source: 'BROWSER',
      contextName: 'vendorportal.com',
      detail: '/orders/pending',
    }),
  ]);

  assert.equal(day.totals.COMPUTER_APP + day.totals.WEBSITE, minutes(60));
  assert.equal(day.presenceSeconds, minutes(60));
});

test('overlapping spells never exceed the wall clock', () => {
  const day = resolveWorkday([
    claim('COMPUTER_APP', '10:00', '10:30', { contextName: 'Excel', detail: 'Project Cost.xlsx' }),
    claim('WEBSITE', '10:15', '10:45', { source: 'BROWSER', contextName: 'docs.google.com' }),
  ]);

  assert.equal(sumTotals(day), minutes(45));
  assert.equal(day.presenceSeconds, minutes(45));
});

/* ── Presence accounting ─────────────────────────────────────────────────────────────────── */

test('time nothing claimed inside the session becomes unexplained idle', () => {
  const day = resolveWorkday(
    [claim('COMPUTER_APP', '09:30', '10:00', { contextName: 'Excel' })],
    { presenceStart: at('09:00'), presenceEnd: at('10:30') },
  );

  assert.equal(day.totals.UNEXPLAINED_IDLE, minutes(60));
  assert.equal(day.totals.COMPUTER_APP, minutes(30));
  assert.equal(day.presenceSeconds, minutes(90));
});

test('the buckets always sum to presence', () => {
  const day = resolveWorkday(
    [
      claim('COMPUTER_APP', '09:04', '09:32', { contextName: 'Chrome' }),
      claim('COMPUTER_APP', '09:32', '10:18', { contextName: 'Excel', detail: 'April.xlsx' }),
      claim('WORK_CALL', '10:18', '10:37', { source: 'ANDROID', contextName: 'Site Manager' }),
      claim('ERP_ACTIVITY', '10:39', '11:24', { source: 'ERP', contextName: 'Site Account' }),
      claim('MEETING', '11:30', '12:25', { source: 'MEETING', contextName: 'Finance Review' }),
      claim('BREAK', '12:45', '13:30', { source: 'MANUAL' }),
    ],
    { presenceStart: at('09:04'), presenceEnd: at('13:30') },
  );

  assert.equal(sumTotals(day), day.presenceSeconds);
  assert.equal(day.presenceSeconds, minutes(266));
});

test('a claim outside the session is clipped rather than inflating presence', () => {
  const day = resolveWorkday(
    [claim('MEETING', '17:00', '19:00', { source: 'MEETING', contextName: 'Late review' })],
    { presenceStart: at('09:00'), presenceEnd: at('18:00') },
  );

  assert.equal(day.totals.MEETING, minutes(60));
  assert.equal(day.presenceSeconds, minutes(540));
});

/* ── Readability ─────────────────────────────────────────────────────────────────────────── */

test('consecutive spells of the same document merge into one row', () => {
  const day = resolveWorkday([
    claim('COMPUTER_APP', '10:00', '10:20', { contextName: 'Excel', detail: 'Project Cost.xlsx' }),
    claim('COMPUTER_APP', '10:20', '10:50', { contextName: 'Excel', detail: 'Project Cost.xlsx' }),
  ]);

  assert.equal(day.intervals.length, 1);
  assert.equal(day.intervals[0].durationSeconds, minutes(50));
});

test('two different workbooks stay two rows', () => {
  // The distinction is most of the value of document tracking, so it must survive merging.
  const day = resolveWorkday([
    claim('COMPUTER_APP', '10:00', '10:20', { contextName: 'Excel', detail: 'Project Cost.xlsx' }),
    claim('COMPUTER_APP', '10:20', '10:50', { contextName: 'Excel', detail: 'Salary Sheet.xlsx' }),
  ]);

  assert.equal(day.intervals.length, 2);
  assert.equal(day.intervals[1].detail, 'Salary Sheet.xlsx');
});

test('alt-tab flicker is folded away without losing the time', () => {
  const day = resolveWorkday([
    claim('COMPUTER_APP', '10:00', '10:30', { contextName: 'Excel' }),
    {
      source: 'WINDOWS',
      category: 'COMPUTER_APP',
      startAt: at('10:30'),
      endAt: '2026-09-21T10:30:04.000Z',
      contextName: 'Explorer',
    },
    claim('COMPUTER_APP', '10:31', '11:00', { contextName: 'Word' }),
  ]);

  assert.ok(day.intervals.length <= 3, 'the sliver should not survive as its own row');
  assert.equal(sumTotals(day), day.presenceSeconds, 'folding must not lose time');
});

/* ── Bad input is visible, not silent ────────────────────────────────────────────────────── */

test('reversed and unparseable claims are rejected with a reason', () => {
  const day = resolveWorkday([
    claim('COMPUTER_APP', '11:00', '10:00'),
    { source: 'WINDOWS', category: 'COMPUTER_APP', startAt: 'not a date', endAt: at('10:00') },
    { source: 'WINDOWS', category: 'NONSENSE', startAt: at('10:00'), endAt: at('10:05') },
    claim('COMPUTER_APP', '10:00', '10:30', { contextName: 'Excel' }),
  ]);

  assert.equal(day.rejected.length, 3);
  assert.ok(day.rejected.some((entry) => entry.reason.includes('End is not after start')));
  assert.ok(day.rejected.some((entry) => entry.reason.includes('Unparseable')));
  assert.ok(day.rejected.some((entry) => entry.reason.includes('Unknown category')));
  assert.equal(day.totals.COMPUTER_APP, minutes(30));
});

test('no claims at all resolves to an empty day rather than throwing', () => {
  const day = resolveWorkday([]);
  assert.deepEqual(day.intervals, []);
  assert.equal(day.presenceSeconds, 0);
  assert.equal(recordedWorkSeconds(day.totals), 0);
});

/* ── The priority table itself ───────────────────────────────────────────────────────────── */

test('the priority order is the one the brief specifies', () => {
  const order = Object.entries(CATEGORY_PRIORITY)
    .sort((left, right) => left[1] - right[1])
    .map(([category]) => category);

  assert.deepEqual(order, [
    'MEETING',
    'WORK_CALL',
    'FIELD_WORK',
    'ERP_ACTIVITY',
    'COMPUTER_APP',
    'WEBSITE',
    'BREAK',
    'PC_LOCKED',
    'UNEXPLAINED_IDLE',
    'OFFLINE',
  ]);
});

test('recorded work excludes break, locked, idle and offline', () => {
  const day = resolveWorkday([
    claim('COMPUTER_APP', '09:00', '10:00', { contextName: 'Excel' }),
    claim('BREAK', '10:00', '10:30', { source: 'MANUAL' }),
    claim('PC_LOCKED', '10:30', '10:45'),
  ]);

  assert.equal(recordedWorkSeconds(day.totals), minutes(60));
  assert.equal(day.presenceSeconds, minutes(105));
});
