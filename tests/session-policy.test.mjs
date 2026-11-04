import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SESSION_POLICY,
  classifySession,
  effectiveIdleMinutes,
  idleTimeoutApplies,
  normalizeSessionPolicy,
  resumeHasExpired,
  sessionPresence,
  sessionsToEnforce,
  sessionsToSweep,
} from '../src/lib/session-policy.ts';

const H = 3_600_000;
const NOW = 1_800_000_000_000;
const policy = (over = {}) => ({ ...DEFAULT_SESSION_POLICY, ...over });
const s = (id, { userId = 'u1', startedAgoH = 1, lastAgoH = 0, client = 'browser', deviceClass = 'desktop' } = {}) => ({
  id, userId, startedMs: NOW - startedAgoH * H, lastActiveMs: NOW - lastAgoH * H, client, deviceClass,
});
const app = (id, over = {}) => s(id, { client: 'app', deviceClass: 'mobile', ...over });
const phone = (id, over = {}) => s(id, { deviceClass: 'mobile', ...over });

const APP_UA =
  'Mozilla/5.0 (Linux; Android 13; SM-A536E Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.163 Mobile Safari/537.36';
const PHONE_CHROME_UA =
  'Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36';

test('defaults change nothing', () => {
  const p = normalizeSessionPolicy(null);
  assert.deepEqual(sessionsToEnforce([s('a'), s('b'), s('c')], 'a', NOW, p).size, 0);
  assert.equal(effectiveIdleMinutes(240, p), 240);
  assert.equal(effectiveIdleMinutes(undefined, p), 60);
  assert.equal(resumeHasExpired(NOW - 10 * H, NOW, 60, p), false);
});

test('normalize clamps and coerces', () => {
  const p = normalizeSessionPolicy({ maxDesktopSessions: '3', maxMobileSessions: 99, staleAfterHours: 0, idleTimeoutCapMinutes: -5, autoSweepStale: 'yes' });
  assert.equal(p.maxDesktopSessions, 3);
  assert.equal(p.maxMobileSessions, 50);
  assert.equal(p.staleAfterHours, 1);
  assert.equal(p.idleTimeoutCapMinutes, 0);
  assert.equal(p.autoSweepStale, false);
});

test('the mobile app is kept signed in by default, and the switch is honoured', () => {
  assert.equal(normalizeSessionPolicy(null).keepAppSignedIn, true);
  assert.equal(normalizeSessionPolicy({ keepAppSignedIn: false }).keepAppSignedIn, false);
  assert.equal(normalizeSessionPolicy({ keepAppSignedIn: 'no' }).keepAppSignedIn, true);
});

test('a saved single limit applies to each pool until split limits replace it', () => {
  const legacy = normalizeSessionPolicy({ maxConcurrentSessions: 2 });
  assert.equal(legacy.maxDesktopSessions, 2);
  assert.equal(legacy.maxMobileSessions, 2);
  const split = normalizeSessionPolicy({ maxConcurrentSessions: 2, maxDesktopSessions: 1, maxMobileSessions: 0 });
  assert.equal(split.maxDesktopSessions, 1);
  assert.equal(split.maxMobileSessions, 0);
});

test('classify: recorded client wins, else the Android WebView is the app', () => {
  assert.deepEqual(classifySession({ client: 'app', deviceType: 'Mobile' }), { client: 'app', deviceClass: 'mobile' });
  assert.deepEqual(classifySession({ deviceType: 'Mobile', userAgent: APP_UA }), { client: 'app', deviceClass: 'mobile' });
  assert.deepEqual(classifySession({ deviceType: 'Mobile', userAgent: PHONE_CHROME_UA }), { client: 'browser', deviceClass: 'mobile' });
  assert.deepEqual(classifySession({ deviceType: 'Tablet', userAgent: '' }), { client: 'browser', deviceClass: 'mobile' });
  assert.deepEqual(classifySession({ deviceType: 'Desktop', userAgent: 'Mozilla/5.0 (Windows NT 10.0)' }), { client: 'browser', deviceClass: 'desktop' });
  // An explicit "browser" overrides a WebView-looking agent (an in-app browser inside another app).
  assert.equal(classifySession({ client: 'browser', userAgent: APP_UA }).client, 'browser');
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
  const out = sessionsToEnforce(sessions, 'cur', NOW, policy({ maxDesktopSessions: 2 }));
  assert.deepEqual([...out.keys()].sort(), ['mid', 'old']);
  assert.ok([...out.values()].every((r) => r === 'policy'));
});

test('desktop and phone sessions are counted apart', () => {
  const sessions = [s('desk-old', { lastAgoH: 3 }), s('desk-new'), app('app'), phone('phone-web', { lastAgoH: 1 })];
  const p = policy({ maxDesktopSessions: 1, maxMobileSessions: 1 });
  // Signing in at a desk ends only the older desk session — the phone pool is untouched.
  assert.deepEqual([...sessionsToEnforce(sessions, 'desk-new', NOW, p).keys()].sort(), ['desk-old', 'phone-web']);
  // Signing in on the phone browser ends the other phone session; the desktop pool is held to its own limit.
  assert.deepEqual([...sessionsToEnforce(sessions, 'phone-web', NOW, p).keys()].sort(), ['app', 'desk-old']);
  // An unlimited pool is never trimmed, however full the other is.
  assert.deepEqual([...sessionsToEnforce(sessions, 'desk-new', NOW, policy({ maxDesktopSessions: 1 })).keys()], ['desk-old']);
});

test('lifetime ends sessions before the limit is counted', () => {
  const sessions = [s('ancient', { startedAgoH: 30 }), s('a'), s('b')];
  const out = sessionsToEnforce(sessions, 'a', NOW, policy({ maxDesktopSessions: 2, maxSessionHours: 24 }));
  assert.deepEqual([...out.keys()], ['ancient']);
});

test('the kept app session outlives the maximum session age', () => {
  const sessions = [app('app', { startedAgoH: 500 }), phone('web', { startedAgoH: 500 })];
  const kept = sessionsToEnforce(sessions, 'app', NOW, policy({ maxSessionHours: 24 }));
  assert.deepEqual([...kept.keys()], ['web']);
  const notKept = sessionsToEnforce(sessions, 'app', NOW, policy({ maxSessionHours: 24, keepAppSignedIn: false }));
  assert.deepEqual([...notKept.keys()].sort(), ['app', 'web']);
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

test('reopening the kept app never expires it; a phone browser still does', () => {
  const p = policy({ expireOnResumeAfterIdle: true });
  assert.equal(resumeHasExpired(NOW - 72 * H, NOW, 60, p, 'app'), false);
  assert.equal(resumeHasExpired(NOW - 72 * H, NOW, 60, p, 'browser'), true);
  assert.equal(resumeHasExpired(NOW - 72 * H, NOW, 60, policy({ expireOnResumeAfterIdle: true, keepAppSignedIn: false }), 'app'), true);
});

test('the idle timeout runs in browsers, and in the app only when the switch is off', () => {
  assert.equal(idleTimeoutApplies('browser', policy()), true);
  assert.equal(idleTimeoutApplies('app', policy()), false);
  assert.equal(idleTimeoutApplies('app', policy({ keepAppSignedIn: false })), true);
});

test('a kept app session is never stale and never swept', () => {
  const p = policy({ staleAfterHours: 24, maxSessionHours: 72 });
  assert.equal(sessionPresence(NOW - 30 * H, NOW, p, true), 'idle');
  assert.equal(sessionPresence(null, NOW, p, true), 'idle');
  assert.equal(sessionPresence(NOW - 60_000, NOW, p, true), 'online');
  const sessions = [app('app', { lastAgoH: 30, startedAgoH: 100 }), phone('web', { lastAgoH: 30, startedAgoH: 40 })];
  const out = sessionsToSweep(sessions, NOW, p);
  assert.deepEqual([...out.keys()], ['web']);
  const off = sessionsToSweep(sessions, NOW, policy({ staleAfterHours: 24, maxSessionHours: 72, keepAppSignedIn: false }));
  assert.equal(off.get('app'), 'policy');
});
