import test from 'node:test';
import assert from 'node:assert/strict';

import {
  breakClaims,
  recordedWorkSeconds,
  resolveWorkday,
} from '../src/lib/work-activity-resolution.ts';
import { instantOfClock } from '../src/lib/windows-agent-rules.ts';

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * The configured lunch break
 *
 * Everybody stops for lunch and the agent cannot tell: a still keyboard at 13:20 looks exactly
 * like a still keyboard at 11:20. Before this, every employee's day carried an hour of
 * UNEXPLAINED_IDLE that nobody could explain — so these tests are mostly about what the window
 * must *not* do: take work away from somebody who worked through it, or turn into paid time.
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

const WORK_DATE = '2026-09-24';
const POLICY = { lunchBreakEnabled: true, lunchBreakStart: '13:00', lunchBreakEnd: '13:45' };

/** The real converter, so the tests exercise the office timezone rather than a stand-in. */
const toInstant = (workDate, clock) => instantOfClock(workDate, clock);

function at(clock) {
  return instantOfClock(WORK_DATE, clock);
}

function appClaim(from, to, name = 'Microsoft Excel') {
  return {
    source: 'WINDOWS',
    category: 'COMPUTER_APP',
    startAt: at(from),
    endAt: at(to),
    contextName: name,
  };
}

function totalsOf(resolved) {
  return resolved.totals;
}

test('the configured window becomes one break claim, in the office timezone', () => {
  const claims = breakClaims(POLICY, WORK_DATE, toInstant);

  assert.equal(claims.length, 1);
  assert.equal(claims[0].category, 'BREAK');
  assert.equal(claims[0].contextName, 'Lunch break');
  // 13:00 Asia/Kolkata is 07:30 UTC. If this ever reads 13:00Z the conversion has been lost.
  assert.equal(claims[0].startAt, '2026-09-24T07:30:00.000Z');
  assert.equal(claims[0].endAt, '2026-09-24T08:15:00.000Z');
});

test('an idle lunch is reported as a break, not as unexplained idle', () => {
  const resolved = resolveWorkday(
    [
      appClaim('12:00', '13:00'),
      ...breakClaims(POLICY, WORK_DATE, toInstant),
      appClaim('13:45', '15:00'),
    ],
    { presenceStart: at('12:00'), presenceEnd: at('15:00') },
  );

  const totals = totalsOf(resolved);
  assert.equal(totals.BREAK, 45 * 60);
  assert.equal(totals.UNEXPLAINED_IDLE, 0, 'the hour nobody could explain');
});

test('somebody who works through lunch keeps the work', () => {
  // The whole reason this is a claim and not a subtraction. Excel had the foreground at 13:20;
  // COMPUTER_APP outranks BREAK, so the time stays work and the break shrinks to what is left.
  const resolved = resolveWorkday(
    [
      ...breakClaims(POLICY, WORK_DATE, toInstant),
      appClaim('13:10', '13:40'),
    ],
    { presenceStart: at('13:00'), presenceEnd: at('13:45') },
  );

  const totals = totalsOf(resolved);
  assert.equal(totals.COMPUTER_APP, 30 * 60);
  assert.equal(totals.BREAK, 15 * 60, '10 minutes before and 5 after');
  assert.equal(recordedWorkSeconds(totals), 30 * 60);
});

test('the break is not paid time', () => {
  const resolved = resolveWorkday(
    [appClaim('09:00', '13:00'), ...breakClaims(POLICY, WORK_DATE, toInstant)],
    { presenceStart: at('09:00'), presenceEnd: at('13:45') },
  );

  const totals = totalsOf(resolved);
  assert.equal(recordedWorkSeconds(totals), 4 * 60 * 60, 'four hours of work, not four and three quarters');
  assert.equal(totals.BREAK, 45 * 60, 'and the break is still reported rather than hidden');
});

test('a break explains a locked screen', () => {
  // BREAK outranks PC_LOCKED: somebody who locks their PC and goes to lunch has taken lunch,
  // which is the more useful of the two true statements.
  const resolved = resolveWorkday(
    [
      { source: 'WINDOWS', category: 'PC_LOCKED', startAt: at('13:00'), endAt: at('13:45') },
      ...breakClaims(POLICY, WORK_DATE, toInstant),
    ],
    { presenceStart: at('13:00'), presenceEnd: at('13:45') },
  );

  assert.equal(totalsOf(resolved).BREAK, 45 * 60);
  assert.equal(totalsOf(resolved).PC_LOCKED, 0);
});

test('a meeting over lunch is still a meeting', () => {
  const resolved = resolveWorkday(
    [
      ...breakClaims(POLICY, WORK_DATE, toInstant),
      { source: 'MEETING', category: 'MEETING', startAt: at('13:15'), endAt: at('13:45'), contextName: 'Client review' },
    ],
    { presenceStart: at('13:00'), presenceEnd: at('13:45') },
  );

  const totals = totalsOf(resolved);
  assert.equal(totals.MEETING, 30 * 60);
  assert.equal(totals.BREAK, 15 * 60);
});

/* ── When no break should be produced ─────────────────────────────────────────────────────── */

test('switched off produces nothing', () => {
  assert.deepEqual(breakClaims({ ...POLICY, lunchBreakEnabled: false }, WORK_DATE, toInstant), []);
});

test('a missing or unusable time produces nothing rather than a broken interval', () => {
  assert.deepEqual(breakClaims({ lunchBreakEnabled: true }, WORK_DATE, toInstant), []);
  assert.deepEqual(
    breakClaims({ lunchBreakEnabled: true, lunchBreakStart: '13:00', lunchBreakEnd: '' }, WORK_DATE, toInstant),
    [],
  );
  assert.deepEqual(
    breakClaims({ lunchBreakEnabled: true, lunchBreakStart: 'noon', lunchBreakEnd: '13:45' }, WORK_DATE, toInstant),
    [],
  );
  assert.deepEqual(breakClaims(null, WORK_DATE, toInstant), []);
});

test('an end before the start is a typo, not an overnight break', () => {
  assert.deepEqual(
    breakClaims({ lunchBreakEnabled: true, lunchBreakStart: '13:45', lunchBreakEnd: '13:00' }, WORK_DATE, toInstant),
    [],
  );
  assert.deepEqual(
    breakClaims({ lunchBreakEnabled: true, lunchBreakStart: '13:00', lunchBreakEnd: '13:00' }, WORK_DATE, toInstant),
    [],
  );
});

test('a break outside the recorded day contributes nothing to it', () => {
  // The agent was only running in the morning. The break is claimed but nothing was present to
  // explain, so it must not invent forty-five minutes of anything.
  const resolved = resolveWorkday(
    [appClaim('09:00', '11:00'), ...breakClaims(POLICY, WORK_DATE, toInstant)],
    { presenceStart: at('09:00'), presenceEnd: at('11:00') },
  );

  assert.equal(totalsOf(resolved).BREAK, 0);
  assert.equal(recordedWorkSeconds(totalsOf(resolved)), 2 * 60 * 60);
});
