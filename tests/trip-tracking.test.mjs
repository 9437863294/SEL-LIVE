/**
 * Background trip tracking's device-free rules (src/lib/trip-tracking/rules.ts): the native fix in
 * the app's shapes, what the status chip says, which permissions block a start, the phone makers
 * that get the "keep tracking alive" steps, and when a gap brings them back.
 *
 * Run: npm run test:fleet
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEGRADED_AFTER_ERRORS,
  FIRST_FIX_GRACE_MS,
  ageLabel,
  chipView,
  gapsNeedGuide,
  missingRequired,
  oemGuideFor,
  permissionRows,
  toClientPoint,
  toGapRecord,
  toRoutePoint,
} from '../src/lib/trip-tracking/rules.ts';

const T0 = Date.parse('2026-10-26T04:00:00.000Z');

const point = (over = {}) => ({ id: 7, clientPointId: 'pt_trip1_1792987200000', lat: 20.3, lng: 85.8, accuracy: 8, speed: 12.5, bearing: 90, altitude: 30, recordedAt: T0, ...over });

const status = (over = {}) => ({
  activeTripId: 'trip1',
  kind: 'fleet',
  startedAt: T0,
  running: true,
  lastFixAt: T0 + 50_000,
  lastAccuracy: 9,
  accepted: 40,
  pending: 3,
  lastAliveAt: T0 + 60_000,
  consecutiveErrors: 0,
  lastError: null,
  gapsPending: 0,
  ...over,
});

const granted = { location: true, precise: true, background: true, notifications: true, locationServices: true, sdkInt: 34 };

test('a native fix keeps its id as the idempotency key and is converted to km/h and ISO time', () => {
  assert.deepEqual(toClientPoint(point()), { clientPointId: 'pt_trip1_1792987200000', lat: 20.3, lng: 85.8, accuracyM: 8, speedKmph: 45, headingDeg: 90, recordedAt: '2026-10-26T04:00:00.000Z' });
  // Android's "unknown" (negative speed, bearing out of range, no accuracy) is null, not a value.
  const unknown = toClientPoint(point({ speed: -1, bearing: 400, accuracy: null }));
  assert.equal(unknown.speedKmph, null);
  assert.equal(unknown.headingDeg, null);
  assert.equal(unknown.accuracyM, null);
  assert.deepEqual(toRoutePoint(point({ speed: null })), { lat: 20.3, lng: 85.8, accuracyMeters: 8, speedKmph: undefined, headingDeg: 90, recordedAtIso: '2026-10-26T04:00:00.000Z' });
  assert.deepEqual(toGapRecord({ fromMs: T0, toMs: T0 + 600_000 }), { fromAt: '2026-10-26T04:00:00.000Z', toAt: '2026-10-26T04:10:00.000Z' });
});

test('the chip: recording with the fix age, accuracy and what is still on the phone', () => {
  const view = chipView({ paused: false, now: T0 + 62_000, outboxPending: 5, native: status(), permissions: granted });
  assert.equal(view.state, 'recording');
  assert.equal(view.label, 'Recording');
  assert.equal(view.lastFix, '12 s ago');
  assert.equal(view.accuracy, '±9 m');
  assert.equal(view.pending, 8, 'the native buffer plus the outbox');
  assert.equal(ageLabel(T0, T0 + 90 * 60_000), '1 h 30 min ago');
});

test('the chip: paused, permission lost, stopped, degraded — in that order of precedence', () => {
  const now = T0 + 120_000;
  assert.equal(chipView({ paused: true, now, outboxPending: 0, native: status({ running: false }) }).state, 'paused');
  assert.equal(chipView({ paused: false, now, outboxPending: 0, native: status(), permissions: { ...granted, background: false } }).state, 'permission');
  assert.equal(chipView({ paused: false, now, outboxPending: 0, native: status({ lastError: { code: 'NOT_AUTHORIZED', message: 'x', at: now } }) }).state, 'permission');
  assert.equal(chipView({ paused: false, now, outboxPending: 0, native: status({ running: false }), permissions: granted }).state, 'stopped');
  assert.equal(chipView({ paused: false, now, outboxPending: 0, native: status({ consecutiveErrors: DEGRADED_AFTER_ERRORS }), permissions: granted }).state, 'degraded');
  assert.equal(chipView({ paused: false, now, outboxPending: 0, native: status({ consecutiveErrors: DEGRADED_AFTER_ERRORS - 1 }), permissions: granted }).state, 'recording');
});

test('the chip: a parked vehicle is still recording; no fix means Android says so, or none since the start', () => {
  // Twenty minutes without a fix: the 30 m distance filter, not a lost signal.
  assert.equal(chipView({ paused: false, now: T0 + 20 * 60_000, outboxPending: 0, native: status(), permissions: granted }).state, 'recording');
  assert.equal(chipView({ paused: false, now: T0 + 60_000, outboxPending: 0, native: status({ locationAvailable: false }), permissions: granted }).state, 'no_fix');
  const never = status({ lastFixAt: null, lastAccuracy: null });
  assert.equal(chipView({ paused: false, now: T0 + FIRST_FIX_GRACE_MS - 1, outboxPending: 0, native: never, permissions: granted }).state, 'recording');
  assert.equal(chipView({ paused: false, now: T0 + FIRST_FIX_GRACE_MS + 1, outboxPending: 0, native: never, permissions: granted }).state, 'no_fix');
});

test('the chip without a native recorder works from the in-app watcher', () => {
  const now = T0 + 30_000;
  const watching = { tracking: true, error: null, lastFixAt: T0 + 20_000, accuracyM: 12, startedAt: T0 };
  assert.equal(chipView({ paused: false, now, outboxPending: 2, fallback: watching }).state, 'recording');
  assert.equal(chipView({ paused: false, now, outboxPending: 2, fallback: watching }).pending, 2);
  assert.equal(chipView({ paused: false, now, outboxPending: 0, fallback: { ...watching, error: 'Location permission is needed to track the trip.' } }).state, 'permission');
  assert.equal(chipView({ paused: false, now, outboxPending: 0, fallback: { ...watching, error: 'Location is not available.' } }).state, 'stopped');
  assert.equal(chipView({ paused: false, now, outboxPending: 0, fallback: { ...watching, tracking: false } }).state, 'stopped');
});

test('a trip may start only with location, precise, all the time, notifications and the GPS switch; battery is advice', () => {
  assert.deepEqual(missingRequired(permissionRows(granted, false)), []);
  const rows = permissionRows({ ...granted, precise: false, background: false, notifications: false }, false);
  assert.deepEqual(missingRequired(rows), ['precise', 'background', 'notifications']);
  assert.equal(rows.find((row) => row.key === 'battery').required, false);
  // Without location at all, precise cannot count as granted either.
  assert.deepEqual(missingRequired(permissionRows({ ...granted, location: false }, true)), ['location', 'precise']);
  // Android 11+ sends the driver to Settings for "Allow all the time"; the row says so.
  assert.match(permissionRows({ ...granted, background: false, sdkInt: 30 }, true).find((row) => row.key === 'background').hint, /Settings/);
});

test('the makers that kill background apps get their steps; stock Android gets none', () => {
  assert.equal(oemGuideFor('Xiaomi').brand, 'Xiaomi / Redmi / Poco');
  assert.equal(oemGuideFor('POCO').brand, 'Xiaomi / Redmi / Poco');
  assert.equal(oemGuideFor('realme').brand, 'Oppo / Realme / OnePlus');
  assert.equal(oemGuideFor('vivo').brand, 'Vivo / iQOO');
  assert.equal(oemGuideFor('HONOR').brand, 'Huawei / Honor');
  assert.ok(oemGuideFor('samsung').steps.some((step) => /Unrestricted/.test(step)));
  assert.equal(oemGuideFor('Google'), null);
  assert.equal(oemGuideFor(''), null);
  assert.equal(oemGuideFor(undefined), null);
});

test('only a gap of more than ten minutes brings the steps back', () => {
  assert.equal(gapsNeedGuide([]), false);
  assert.equal(gapsNeedGuide([{ fromMs: T0, toMs: T0 + 10 * 60_000 }]), false);
  assert.equal(gapsNeedGuide([{ fromMs: T0, toMs: T0 + 2 * 60_000 }, { fromMs: T0, toMs: T0 + 11 * 60_000 }]), true);
});
