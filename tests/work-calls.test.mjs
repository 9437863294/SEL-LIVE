/**
 * Work call rules — mostly about refusing to invent time.
 *
 * The interesting cases are the ones where the honest answer is "we do not know": a dial nobody
 * confirmed, an app reopened the next morning, a five-second misdial. Each of those is a chance
 * to quietly credit somebody with work that may not have happened, so each has a test.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MAX_CALL_SECONDS,
  callsToActivityClaims,
  isDialableMobile,
  normalizeMobile,
  resolveCallDuration,
  summarizeCalls,
} from '../src/lib/work-calls-model.ts';
import { resolveWorkday } from '../src/lib/work-activity-resolution.ts';

const at = (time) => `2026-09-21T${time}:00.000Z`;
const minutes = (count) => count * 60;

const call = (overrides = {}) => ({
  id: overrides.id ?? 'CALL-1',
  userId: 'EMP-014',
  employeeId: '014',
  contactId: 'C-1',
  contactName: overrides.contactName ?? 'Mr ABC',
  contactCompany: overrides.contactCompany ?? 'TPSODL',
  contactType: overrides.contactType ?? 'CLIENT',
  projectId: null,
  projectName: null,
  siteId: null,
  purpose: overrides.purpose ?? 'Material Approval',
  state: overrides.state ?? 'COMPLETED',
  dialledAt: overrides.dialledAt ?? at('15:12'),
  endedAt: overrides.endedAt ?? at('15:31'),
  durationSeconds: overrides.durationSeconds === undefined ? minutes(19) : overrides.durationSeconds,
  durationSource: overrides.durationSource ?? 'RETURN_TO_APP',
  deviceInfo: null,
});

/* ── The directory ───────────────────────────────────────────────────────────────────────── */

test('the same number entered three ways normalises to one', () => {
  // The same site manager, typed by three different people.
  assert.equal(normalizeMobile('+91 98765 43210'), '9876543210');
  assert.equal(normalizeMobile('098765 43210'), '9876543210');
  assert.equal(normalizeMobile('9876543210'), '9876543210');
});

test('an unusual number is kept rather than refused', () => {
  // An extension or an international number is still a number; refusing to store it would be
  // worse than not matching it against anything.
  assert.equal(normalizeMobile('+1 (415) 555-2671'), '14155552671');
  assert.ok(isDialableMobile('+1 (415) 555-2671'));
});

test('something that is not a number is not dialable', () => {
  assert.equal(normalizeMobile('ask reception'), '');
  assert.ok(!isDialableMobile('ask reception'));
  assert.ok(!isDialableMobile('123'));
});

/* ── Duration, and the things it refuses ─────────────────────────────────────────────────── */

test('a confirmed call gets the duration between dialling and confirming', () => {
  const outcome = resolveCallDuration(at('15:12'), at('15:31'));
  assert.equal(outcome.state, 'COMPLETED');
  assert.equal(outcome.seconds, minutes(19));
});

test('an explicit duration wins over the elapsed time', () => {
  // The employee says the call was eight minutes and they then spent eleven writing it up.
  const outcome = resolveCallDuration(at('15:12'), at('15:31'), minutes(8));
  assert.equal(outcome.seconds, minutes(8));
});

test('an app reopened the next morning is not an eighteen-hour call', () => {
  // The commonest failure by far, and left alone it would top every report.
  const outcome = resolveCallDuration('2026-09-21T15:12:00.000Z', '2026-09-22T09:00:00.000Z');
  assert.equal(outcome.state, 'NOT_CONFIRMED');
  assert.equal(outcome.seconds, null);
  assert.match(outcome.reason, /reopened much later/);
});

test('the ceiling is four hours', () => {
  const justUnder = resolveCallDuration(at('09:00'), '2026-09-21T12:59:59.000Z');
  assert.equal(justUnder.state, 'COMPLETED');
  assert.ok(justUnder.seconds <= MAX_CALL_SECONDS);
});

test('a five-second misdial is cancelled, not counted', () => {
  const outcome = resolveCallDuration(at('15:12'), '2026-09-21T15:12:02.000Z');
  assert.equal(outcome.state, 'CANCELLED');
  assert.equal(outcome.seconds, null);
});

test('a call that ends before it starts is refused', () => {
  const outcome = resolveCallDuration(at('15:31'), at('15:12'));
  assert.equal(outcome.state, 'NOT_CONFIRMED');
  assert.equal(outcome.seconds, null);
});

/* ── Claims for the resolution engine ────────────────────────────────────────────────────── */

test('a confirmed call becomes one work-call claim', () => {
  const claims = callsToActivityClaims([call()]);
  assert.equal(claims.length, 1);
  assert.equal(claims[0].category, 'WORK_CALL');
  assert.equal(claims[0].source, 'ANDROID');
  assert.equal(claims[0].contextName, 'Mr ABC — TPSODL');
  assert.equal(claims[0].detail, 'Material Approval');
});

test('an unconfirmed dial produces no claim at all', () => {
  // The whole point. Crediting an unconfirmed dial would be a guess dressed as a measurement.
  assert.deepEqual(callsToActivityClaims([call({ state: 'NOT_CONFIRMED', durationSeconds: null })]), []);
  assert.deepEqual(callsToActivityClaims([call({ state: 'DIALLED', durationSeconds: null })]), []);
  assert.deepEqual(callsToActivityClaims([call({ state: 'CANCELLED', durationSeconds: null })]), []);
});

test('the claim length comes from the duration, not from endedAt', () => {
  // endedAt says 19 minutes, the stored duration says 8. The reports add up the duration, so
  // the claim has to agree with it or the timeline and the totals will disagree.
  const claims = callsToActivityClaims([call({ durationSeconds: minutes(8) })]);
  const seconds = (Date.parse(claims[0].endAt) - Date.parse(claims[0].startAt)) / 1000;
  assert.equal(seconds, minutes(8));
});

/* ── §U end to end: the call explains the idle desk ──────────────────────────────────────── */

test('a confirmed call turns nineteen idle minutes into a work call', () => {
  const day = resolveWorkday([
    { source: 'WINDOWS', category: 'UNEXPLAINED_IDLE', startAt: at('15:12'), endAt: at('15:31') },
    ...callsToActivityClaims([call()]),
  ]);

  assert.equal(day.totals.WORK_CALL, minutes(19));
  assert.equal(day.totals.UNEXPLAINED_IDLE, 0);
});

test('an unconfirmed dial leaves those minutes unexplained', () => {
  const day = resolveWorkday([
    { source: 'WINDOWS', category: 'UNEXPLAINED_IDLE', startAt: at('15:12'), endAt: at('15:31') },
    ...callsToActivityClaims([call({ state: 'NOT_CONFIRMED', durationSeconds: null })]),
  ]);

  assert.equal(day.totals.WORK_CALL, 0);
  assert.equal(day.totals.UNEXPLAINED_IDLE, minutes(19));
});

/* ── §AL report ──────────────────────────────────────────────────────────────────────────── */

test('the summary separates dialled from confirmed', () => {
  const summary = summarizeCalls([
    call({ id: 'a', contactType: 'CLIENT', durationSeconds: minutes(17) }),
    call({ id: 'b', contactType: 'CLIENT', durationSeconds: minutes(17) }),
    call({ id: 'c', contactType: 'SITE_MANAGER', durationSeconds: minutes(19) }),
    call({ id: 'd', state: 'NOT_CONFIRMED', durationSeconds: null }),
    call({ id: 'e', state: 'CANCELLED', durationSeconds: null }),
  ]);

  assert.equal(summary.dialled, 5);
  assert.equal(summary.confirmed, 3);
  assert.equal(summary.totalSeconds, minutes(53));

  // Busiest contact type first.
  assert.equal(summary.byType[0].contactType, 'CLIENT');
  assert.equal(summary.byType[0].calls, 2);
  assert.equal(summary.byType[0].seconds, minutes(34));
});

test('a day with no calls summarises to zero rather than throwing', () => {
  const summary = summarizeCalls([]);
  assert.equal(summary.dialled, 0);
  assert.equal(summary.confirmed, 0);
  assert.equal(summary.totalSeconds, 0);
  assert.deepEqual(summary.byType, []);
});
