import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SESSION_POLICY,
  effectiveIdleMinutes,
  normalizeSessionPolicy,
  resumeHasExpired,
  sessionPresence,
  sessionsToEnforce,
  sessionsToSweep,
} from '../src/lib/session-policy.ts';

const H = 3_600_000;
const NOW = 1_800_000_000_000;
const policy = (over = {}) => ({ ...DEFAULT_SESSION_POLICY, ...over });
const s = (id, { userId = 'u1', startedAgoH = 1, lastAgoH = 0 } = {}) => ({
  id, userId, startedMs: NOW - startedAgoH * H, lastActiveMs: NOW - lastAgoH * H,
});

test('defaults change nothing', () => {
  const p = normalizeSessionPolicy(null);
  assert.deepEqual(sessionsToEnforce([s('a'), s('b'), s('c')], 'a', NOW, p).size, 0);
  assert.equal(effectiveIdleMinutes(240, p), 240);
  assert.equal(effectiveIdleMinutes(undefined, p), 60);
  assert.equal(resumeHasExpired(NOW - 10 * H, NOW, 60, p), false);
});

test('normalize clamps and coerces', () => {
  const p = normalizeSessionPolicy({ maxConcurrentSessions: '3', staleAfterHours: 0, idleTimeoutCapMinutes: -5, autoSweepStale: 'yes' });
  assert.equal(p.maxConcurrentSessions, 3);
  assert.equal(p.staleAfterHours, 1);
  assert.equal(p.idleTimeoutCapMinutes, 0);
  assert.equal(p.autoSweepStale, false);
});

test('idle cap limits the user preference', () => {
  assert.equal(effectiveIdleMinutes(240, policy({ idleTimeoutCapMinutes: 30 })), 30);
  assert.equal(effectiveIdleMinutes(15, policy({ idleTimeoutCapMinutes: 30 })), 15);
});

test('presence buckets', () => {
  const p = policy({ staleAfterHours: 24 });
  assert.equal(sessionPresence(NOW - 60_000, NOW, p), 'online');
  assert.equal(sessionPresence(NOW - 2 * H, NOW, p), 'idle');
  assert.equal(sessionPresence(NOW - 25 * H, NOW, p), 'stale');
  assert.equal(sessionPresence(null, NOW, p), 'stale');
});

test('concurrency limit keeps current, then most recent', () => {
  const sessions = [s('old', { lastAgoH: 5 }), s('cur', { lastAgoH: 9 }), s('new', { lastAgoH: 0 }), s('mid', { lastAgoH: 2 })];
  const out = sessionsToEnforce(sessions, 'cur', NOW, policy({ maxConcurrentSessions: 2 }));
  assert.deepEqual([...out.keys()].sort(), ['mid', 'old']);
  assert.ok([...out.values()].every((r) => r === 'policy'));
});

test('lifetime ends sessions before the limit is counted', () => {
  const sessions = [s('ancient', { startedAgoH: 30 }), s('a'), s('b')];
  const out = sessionsToEnforce(sessions, 'a', NOW, policy({ maxConcurrentSessions: 2, maxSessionHours: 24 }));
  assert.deepEqual([...out.keys()], ['ancient']);
});

test('lifetime can end the current session', () => {
  const out = sessionsToEnforce([s('cur', { startedAgoH: 13 })], 'cur', NOW, policy({ maxSessionHours: 12 }));
  assert.equal(out.get('cur'), 'policy');
});

test('sweep ends stale and over-age sessions but never the protected one', () => {
  const sessions = [
    s('fresh'),
    s('stale', { lastAgoH: 30, startedAgoH: 40 }),
    s('me', { lastAgoH: 30, startedAgoH: 40 }),
    s('aged', { startedAgoH: 100 }),
  ];
  const out = sessionsToSweep(sessions, NOW, policy({ staleAfterHours: 24, maxSessionHours: 72 }), 'me');
  assert.equal(out.get('stale'), 'timeout');
  assert.equal(out.get('aged'), 'policy');
  assert.equal(out.has('me'), false);
  assert.equal(out.has('fresh'), false);
});

test('resume expiry only when enabled and past the idle window', () => {
  const p = policy({ expireOnResumeAfterIdle: true });
  assert.equal(resumeHasExpired(NOW - 2 * H, NOW, 60, p), true);
  assert.equal(resumeHasExpired(NOW - 30 * 60_000, NOW, 60, p), false);
  assert.equal(resumeHasExpired(null, NOW, 60, p), false);
});
