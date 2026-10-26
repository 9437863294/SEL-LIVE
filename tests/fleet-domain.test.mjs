/**
 * SEL Fleet — the pure rules (src/lib/fleet): IST dates, geofence hysteresis, track measurement,
 * the billable-distance rule, limits, the approval chain, fuel mileage and the payment report.
 *
 * Run: npm run test:fleet
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { addDays, istDateKey, istDayStartIso, monthRange, previousMonthKey } from '../src/lib/fleet/dates.ts';
import { attributeKm, detectGeofenceEvents, geofenceAt, measureTrack, visitsFromEvents } from '../src/lib/fleet/geo.ts';
import { billableDecision, checkEndOdometer, checkStartOdometer, endFlags, finishFigures, resolveReview, tripAbilities, tripCost, FleetRuleError } from '../src/lib/fleet/trips.ts';
import { dayAllowance, kmUsedOn, startLimitCheck, tripKmOn } from '../src/lib/fleet/limits.ts';
import { buildChain, cancelApproval, createApproval, decideApproval, tickApproval, useApproval, ApprovalError } from '../src/lib/fleet/approvals.ts';
import { checkFuel, fuelRowFrom, fullToFullMileage } from '../src/lib/fleet/fuel.ts';
import { pickOdometer } from '../src/lib/fleet/ocr.ts';
import { shortPlace } from '../src/lib/fleet/places.ts';
import { buildPaymentReport } from '../src/lib/fleet/reports.ts';
import { DEFAULT_FLEET_SETTINGS, categoryFromType, normaliseFleetSettings, normaliseVehicle, serviceDueInKm } from '../src/lib/fleet/settings.ts';
import { legacyTripStatus, stripUndefined } from '../src/lib/fleet/types.ts';

const settings = DEFAULT_FLEET_SETTINGS;

/* ── dates ─────────────────────────────────────────────────────────────── */

test('the fleet day is the IST calendar day', () => {
  assert.equal(istDateKey('2026-10-24T18:29:00.000Z'), '2026-10-24');
  assert.equal(istDateKey('2026-10-24T18:30:00.000Z'), '2026-10-25');
  assert.equal(istDayStartIso('2026-10-25'), '2026-10-24T18:30:00.000Z');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.deepEqual(monthRange('2026-02'), { from: '2026-02-01', to: '2026-02-28' });
  assert.equal(previousMonthKey('2026-01'), '2025-12');
});

/* ── settings and vehicles ─────────────────────────────────────────────── */

test('a vehicle without fleet fields takes its category defaults', () => {
  assert.equal(categoryFromType('Two Wheeler'), 'bike');
  assert.equal(categoryFromType('Pickup'), 'pickup');
  assert.equal(categoryFromType('Car'), 'car');
  const bike = normaliseVehicle('v1', { vehicleNumber: 'OD02AB1234', vehicleType: 'Two Wheeler', currentOdometerKm: 12000 }, settings);
  assert.equal(bike.category, 'bike');
  assert.equal(bike.dailyKmLimit, 80);
  assert.equal(bike.costBasis, 'per_km');
  assert.equal(bike.active, true);
  const car = normaliseVehicle('v2', { vehicleType: 'Car', dailyKmLimit: 200, vehicleStatus: 'Sold' }, settings);
  assert.equal(car.dailyKmLimit, 200);
  assert.equal(car.active, false);
});

test('settings read defensively: junk falls back to defaults', () => {
  const read = normaliseFleetSettings({ mismatchAbsKm: -4, reportEmails: ['a@b.co', 'nope'], dailyKmLimitByCategory: { bike: 60 } });
  assert.equal(read.mismatchAbsKm, 3);
  assert.deepEqual(read.reportEmails, ['a@b.co']);
  assert.equal(read.dailyKmLimitByCategory.bike, 60);
  assert.equal(read.dailyKmLimitByCategory.car, 120);
});

test('service due counts down from the last service', () => {
  assert.equal(serviceDueInKm({ currentOdometerKm: 14800, lastServiceKm: 10000, serviceIntervalKm: 5000 }), 200);
  assert.equal(serviceDueInKm({ currentOdometerKm: 14800, lastServiceKm: null, serviceIntervalKm: 5000 }), null);
});

/* ── geofences ─────────────────────────────────────────────────────────── */

const office = { id: 'g-office', name: 'Head office', kind: 'office', lat: 20.3, lng: 85.8, radiusM: 150 };
const site = { id: 'g-site', name: 'Site A', kind: 'project_site', lat: 20.35, lng: 85.8, radiusM: 200 };
const fix = (minute, lat, lng, accuracyM = 10) => ({ lat, lng, accuracyM, at: new Date(Date.UTC(2026, 9, 25, 4, minute)).toISOString() });

test('the smallest fence containing a point is the one it is at', () => {
  const pump = { id: 'g-pump', name: 'Pump', kind: 'fuel_station', lat: 20.3, lng: 85.8, radiusM: 40 };
  assert.equal(geofenceAt({ lat: 20.3, lng: 85.8 }, [office, pump]).id, 'g-pump');
  assert.equal(geofenceAt({ lat: 20.31, lng: 85.8 }, [office, pump]), null);
});

test('one fix across a boundary is not an arrival; two are, timed at the first', () => {
  const points = [
    fix(0, 20.3, 85.8), // starts inside the office: no event
    fix(5, 20.32, 85.8), // left (1)
    fix(6, 20.33, 85.8), // left (2) → exit at minute 5
    fix(20, 20.35, 85.8), // at site (1)
    fix(21, 20.33, 85.8), // a wander back out resets the count
    fix(22, 20.35, 85.8), // at site (1)
    fix(23, 20.3501, 85.8), // at site (2) → enter at minute 22
    fix(60, 20.33, 85.8),
    fix(61, 20.32, 85.8), // exit site at minute 60
  ];
  const { events } = detectGeofenceEvents(points, [office, site]);
  assert.deepEqual(
    events.map((event) => `${event.type}:${event.geofenceId}@${(Date.parse(event.at) - Date.UTC(2026, 9, 25, 4, 0)) / 60_000}`),
    ['exit:g-office@5', 'enter:g-site@22', 'exit:g-site@60'],
  );
  const visits = visitsFromEvents(events, fix(90, 20.3, 85.8).at);
  assert.equal(visits.length, 1);
  assert.equal(visits[0].minutes, 38);
});

test('leaving needs a margin outside the circle; inaccurate fixes are ignored', () => {
  // 160 m north of the office centre: outside the 150 m circle but inside the 25 m exit margin.
  const edge = 20.3 + 160 / 111_195;
  const { events } = detectGeofenceEvents([fix(0, 20.3, 85.8), fix(1, edge, 85.8), fix(2, edge, 85.8), fix(3, 20.33, 85.8, 500), fix(4, 20.33, 85.8, 500)], [office]);
  assert.deepEqual(events, []);
});

/* ── track ─────────────────────────────────────────────────────────────── */

const point = (iso, lat, lng) => ({ lat, lng, accuracyMeters: 10, recordedAtIso: iso });

test('km are attributed to the IST day each leg was driven, across midnight', () => {
  // 23:50 IST to 00:10 IST, northwards ~1.1 km per leg.
  const points = [
    point('2026-10-24T18:20:00.000Z', 20.0, 85.0),
    point('2026-10-24T18:25:00.000Z', 20.01, 85.0),
    point('2026-10-24T18:35:00.000Z', 20.02, 85.0),
    point('2026-10-24T18:40:00.000Z', 20.03, 85.0),
  ];
  const measure = measureTrack(points, { gapMinutes: 15 });
  assert.ok(measure.gpsKm > 3.2 && measure.gpsKm < 3.5, String(measure.gpsKm));
  assert.deepEqual(Object.keys(measure.kmByDate).sort(), ['2026-10-24', '2026-10-25']);
  assert.ok(measure.kmByDate['2026-10-25'] > measure.kmByDate['2026-10-24']);
  assert.equal(measure.gapCount, 0);
});

test('a silence longer than the gap threshold is a gap, including before the first fix', () => {
  const measure = measureTrack([point('2026-10-25T05:00:00.000Z', 20, 85), point('2026-10-25T05:05:00.000Z', 20.01, 85)], { gapMinutes: 15, startedAt: '2026-10-25T04:30:00.000Z' });
  assert.equal(measure.gapCount, 1);
  assert.equal(measure.longestGapMinutes, 30);
});

test('billable km are spread over days in GPS proportion, and add up exactly', () => {
  const split = attributeKm(10, { '2026-10-24': 3, '2026-10-25': 6 }, '2026-10-24');
  assert.equal(split['2026-10-24'] + split['2026-10-25'], 10);
  assert.ok(split['2026-10-25'] > split['2026-10-24']);
  assert.deepEqual(attributeKm(12.3, {}, '2026-10-24'), { '2026-10-24': 12.3 });
});

/* ── billable rule ─────────────────────────────────────────────────────── */

test('the odometer is billed when GPS agrees within max(3 km, 5%)', () => {
  assert.deepEqual(billableDecision({ gpsKm: 41, odoKm: 43, usablePoints: 100 }, settings), { source: 'odometer', km: 43, mismatch: false, noGps: false, diffKm: 2, toleranceKm: 3 });
  // 5% of 200 is 10 km: a 9 km difference is still agreement.
  assert.equal(billableDecision({ gpsKm: 191, odoKm: 200, usablePoints: 100 }, settings).source, 'odometer');
  const disagree = billableDecision({ gpsKm: 30, odoKm: 45, usablePoints: 100 }, settings);
  assert.equal(disagree.mismatch, true);
  assert.equal(disagree.km, null);
});

test('without a track the odometer stands, flagged; without a closing reading GPS stands', () => {
  const noTrack = billableDecision({ gpsKm: 0, odoKm: 18, usablePoints: 1 }, settings);
  assert.equal(noTrack.source, 'odometer');
  assert.equal(noTrack.noGps, true);
  assert.equal(billableDecision({ gpsKm: 12.4, odoKm: null, usablePoints: 50 }, settings).source, 'gps');
  assert.equal(billableDecision({ gpsKm: 0, odoKm: null, usablePoints: 0 }, settings).km, null);
});

test('the odometer never runs backwards, and a jump is unlogged running', () => {
  const vehicle = { currentOdometerKm: 12000, vehicleNumber: 'OD02AB1234' };
  assert.throws(() => checkStartOdometer(11990, vehicle, settings), FleetRuleError);
  assert.deepEqual(checkStartOdometer(12003, vehicle, settings).flags, []);
  assert.deepEqual(checkStartOdometer(12040, vehicle, settings).flags, ['unlogged_km']);
  assert.throws(() => checkEndOdometer(12000, 11999), /must not be below/);
  assert.throws(() => checkEndOdometer(12000, 15000), /check the reading/);
  assert.equal(checkEndOdometer(12000, 12012.34), 12.3);
});

test('a mismatch, an auto-close or running past the cap waits for review', () => {
  const vehicle = { costBasis: 'per_km', ratePerKm: 9 };
  const agreed = billableDecision({ gpsKm: 20, odoKm: 21, usablePoints: 50 }, settings);
  const flags = endFlags({ decision: agreed, gapCount: 0, longestStopMinutes: 5, kmByDate: { '2026-10-25': 21 }, startDateKey: '2026-10-25', otherKmByDate: { '2026-10-25': 70 }, limitKm: 80, allowedKm: null, siteInternal: false, isEmergency: false, ocrMismatch: false, autoClosed: false, carried: [] });
  assert.deepEqual(flags, ['over_limit']);
  const done = finishFigures({ decision: agreed, gpsKmByDate: { '2026-10-25': 20 }, startDateKey: '2026-10-25', vehicle, flags });
  assert.equal(done.status, 'completed');
  assert.equal(done.costSnapshot.amount, 189);
  assert.equal(done.exceptionStatus, 'open');

  const capped = endFlags({ decision: agreed, gapCount: 0, longestStopMinutes: 5, kmByDate: { '2026-10-25': 21 }, startDateKey: '2026-10-25', otherKmByDate: { '2026-10-25': 70 }, limitKm: 80, allowedKm: 85, siteInternal: false, isEmergency: false, ocrMismatch: false, autoClosed: false, carried: [] });
  assert.deepEqual(capped, ['over_cap']);
  assert.equal(finishFigures({ decision: agreed, gpsKmByDate: {}, startDateKey: '2026-10-25', vehicle, flags: capped }).status, 'pending_review');

  // Site-internal running is not held to the limit.
  assert.deepEqual(endFlags({ decision: agreed, gapCount: 0, longestStopMinutes: 5, kmByDate: { '2026-10-25': 21 }, startDateKey: '2026-10-25', otherKmByDate: { '2026-10-25': 70 }, limitKm: 80, allowedKm: null, siteInternal: true, isEmergency: false, ocrMismatch: false, autoClosed: false, carried: [] }), []);
});

test('a fixed-plus-fuel vehicle has no per-trip cost', () => {
  assert.deepEqual(tripCost({ costBasis: 'fixed_plus_fuel', ratePerKm: 0 }, 40), { basis: 'fixed_plus_fuel', ratePerKm: 0, amount: 0 });
});

test('a manager settles a review with the odometer, GPS or their own figure', () => {
  const trip = { status: 'pending_review', odoDistanceKm: 45, gpsDistanceKm: 30 };
  assert.deepEqual(resolveReview(trip, { choice: 'gps' }), { km: 30, source: 'gps' });
  assert.deepEqual(resolveReview(trip, { choice: 'manager', km: 38 }), { km: 38, source: 'manager' });
  assert.throws(() => resolveReview({ ...trip, status: 'completed' }, { choice: 'gps' }), /not waiting/);
});

test('nobody reviews or force-closes their own trip', () => {
  const trip = { status: 'pending_review', driverUserId: 'u1', exceptionStatus: 'open', startedAt: '2026-10-25T04:00:00.000Z', pointCount: 100 };
  const now = '2026-10-25T09:00:00.000Z';
  assert.equal(tripAbilities(trip, { userId: 'u1', isManager: true, canReview: true, canForceClose: true }, now).review, false);
  assert.equal(tripAbilities(trip, { userId: 'm1', isManager: true, canReview: false, canForceClose: false }, now).review, true);
  const running = { ...trip, status: 'running', startedAt: '2026-10-25T08:55:00.000Z', pointCount: 3 };
  const mine = tripAbilities(running, { userId: 'u1', isManager: false, canReview: false, canForceClose: false }, now);
  assert.equal(mine.end, true);
  assert.equal(mine.cancel, true);
  assert.equal(mine.forceClose, false);
});

/* ── limits ────────────────────────────────────────────────────────────── */

test("the day's km count settled trips by day and a running trip's live GPS", () => {
  const trips = [
    { id: 't1', vehicleId: 'v1', status: 'completed', kmByDate: { '2026-10-25': 50 }, siteInternal: false, gpsDistanceKm: 48, dateKey: '2026-10-25' },
    { id: 't2', vehicleId: 'v1', status: 'running', kmByDate: {}, siteInternal: false, gpsDistanceKm: 12, dateKey: '2026-10-25' },
    { id: 't3', vehicleId: 'v1', status: 'completed', kmByDate: { '2026-10-25': 30 }, siteInternal: true, gpsDistanceKm: 30, dateKey: '2026-10-25' },
    { id: 't4', vehicleId: 'v1', status: 'cancelled', kmByDate: {}, siteInternal: false, gpsDistanceKm: 9, dateKey: '2026-10-25' },
    { id: 't5', vehicleId: 'v2', status: 'completed', kmByDate: { '2026-10-25': 99 }, siteInternal: false, gpsDistanceKm: 99, dateKey: '2026-10-25' },
  ];
  assert.equal(kmUsedOn(trips, 'v1', '2026-10-25'), 62);
  const allowance = dayAllowance({ id: 'v1', dailyKmLimit: 80 }, '2026-10-25', [{ id: 'a1', vehicleId: 'v1', dateKey: '2026-10-25', status: 'approved', allowedKm: 110 }]);
  assert.deepEqual(allowance, { limitKm: 80, allowedKm: 110, approvalId: 'a1' });
  const check = startLimitCheck({ usedKm: 62, expectedKm: 30, ...dayAllowance({ id: 'v1', dailyKmLimit: 80 }, '2026-10-25', []) });
  assert.equal(check.ok, false);
  assert.equal(check.overByKm, 12);
  assert.equal(check.remainingKm, 18);
});

test('a trip still running after midnight counts its running since the split on the new day', () => {
  // The midnight job wrote 30 km for the 24th; GPS has measured 42 km in all.
  const overnight = { id: 'n1', vehicleId: 'v1', status: 'running', kmByDate: { '2026-10-24': 30 }, siteInternal: false, gpsDistanceKm: 42, dateKey: '2026-10-24' };
  assert.equal(tripKmOn(overnight, '2026-10-24'), 30);
  assert.equal(tripKmOn(overnight, '2026-10-25'), 12);
  assert.equal(tripKmOn(overnight, '2026-10-23'), 0);
  assert.equal(kmUsedOn([overnight], 'v1', '2026-10-25'), 12);
  // Paused, or waiting for review without a billable figure, it is still open.
  assert.equal(tripKmOn({ ...overnight, status: 'paused' }, '2026-10-25'), 12);
  assert.equal(tripKmOn({ ...overnight, status: 'pending_review', billableDistanceKm: null }, '2026-10-25'), 12);
  // A GPS figure behind the split (fixes still queued on the phone) is not negative.
  assert.equal(tripKmOn({ ...overnight, gpsDistanceKm: 25 }, '2026-10-25'), 0);
  // Settled trips count only their split days.
  assert.equal(tripKmOn({ ...overnight, status: 'completed', billableDistanceKm: 44 }, '2026-10-25'), 0);
  assert.equal(tripKmOn({ ...overnight, status: 'pending_review', billableDistanceKm: 44 }, '2026-10-25'), 0);
  // Before any split, everything is on the start day.
  assert.equal(tripKmOn({ ...overnight, kmByDate: {} }, '2026-10-24'), 42);
  assert.equal(tripKmOn({ ...overnight, kmByDate: {} }, '2026-10-25'), 0);
});

/* ── approvals ─────────────────────────────────────────────────────────── */

const request = {
  id: 'a1',
  organizationId: 'org',
  vehicleId: 'v1',
  vehicleNumber: 'OD02AB1234',
  driverUserId: 'driver',
  driverName: 'Ravi',
  dateKey: '2026-10-25',
  usedKm: 70,
  limitKm: 80,
  requestedKm: 40,
  reason: 'Material to Site A',
  projectId: 'p1',
  projectName: 'Site A',
  purposeId: 'pu1',
  purposeName: 'Material delivery',
};

test('an undecided request climbs the chain, then expires at two hours', () => {
  const chain = buildChain({ approverIds: ['boss'], backupIds: ['backup'], escalationIds: ['admin', 'driver'], driverUserId: 'driver' });
  assert.deepEqual(chain.levels[2], ['admin']);
  const start = '2026-10-25T04:00:00.000Z';
  let approval = createApproval(request, chain, settings, start);
  assert.equal(approval.level, 1);
  assert.deepEqual(approval.notifiedIds, ['boss']);
  assert.equal(tickApproval(approval, chain, settings, '2026-10-25T04:10:00.000Z').action, null);
  approval = tickApproval(approval, chain, settings, '2026-10-25T04:31:00.000Z').approval;
  assert.equal(approval.level, 2);
  assert.deepEqual(approval.notifiedIds, ['boss', 'backup']);
  approval = tickApproval(approval, chain, settings, '2026-10-25T05:02:00.000Z').approval;
  assert.equal(approval.level, 3);
  assert.equal(approval.escalateAt, null);
  const expired = tickApproval(approval, chain, settings, '2026-10-25T06:00:00.000Z');
  assert.equal(expired.action, 'expired');
  assert.equal(expired.approval.status, 'expired');
});

test('an empty level is skipped; no approver anywhere is refused up front', () => {
  const chain = buildChain({ approverIds: [], backupIds: [], escalationIds: ['admin'], driverUserId: 'driver' });
  assert.equal(createApproval(request, chain, settings, '2026-10-25T04:00:00.000Z').level, 3);
  assert.throws(() => createApproval(request, buildChain({ approverIds: ['driver'], backupIds: [], escalationIds: [], driverUserId: 'driver' }), settings, '2026-10-25T04:00:00.000Z'), ApprovalError);
});

test('decisions: approve, cap, raise, reject — and never your own', () => {
  const chain = buildChain({ approverIds: ['boss'], backupIds: [], escalationIds: [], driverUserId: 'driver' });
  const now = '2026-10-25T04:05:00.000Z';
  const approval = createApproval(request, chain, settings, '2026-10-25T04:00:00.000Z');
  const boss = { id: 'boss', name: 'Boss', override: false };
  assert.equal(decideApproval(approval, { decision: 'approve' }, boss, now).allowedKm, 110);
  assert.equal(decideApproval(approval, { decision: 'approve_cap', capKm: 20 }, boss, now).allowedKm, 90);
  const raised = decideApproval(approval, { decision: 'approve_raise', newLimitKm: 120 }, boss, now);
  assert.equal(raised.newLimitKm, 120);
  assert.equal(raised.allowedKm, 120);
  assert.throws(() => decideApproval(approval, { decision: 'approve_raise', newLimitKm: 60 }, boss, now), /above 80/);
  assert.throws(() => decideApproval(approval, { decision: 'reject' }, boss, now), /why/);
  assert.equal(decideApproval(approval, { decision: 'reject', note: 'Use the pickup' }, boss, now).status, 'rejected');
  assert.throws(() => decideApproval(approval, { decision: 'approve' }, { id: 'someone', name: 'X', override: false }, now), /not with you/);
  assert.equal(decideApproval(approval, { decision: 'approve' }, { id: 'someone', name: 'X', override: true }, now).status, 'approved');
  assert.throws(() => decideApproval(approval, { decision: 'approve' }, { id: 'driver', name: 'Ravi', override: true }, now), /your own/);
  assert.throws(() => decideApproval(approval, { decision: 'approve' }, boss, '2026-10-25T06:30:00.000Z'), /expired/);
  assert.equal(cancelApproval(approval, { id: 'driver', name: 'Ravi' }, now).status, 'cancelled');
  const used = useApproval(decideApproval(approval, { decision: 'approve' }, boss, now), 'trip1', now);
  assert.equal(used.status, 'used');
  assert.equal(used.tripId, 'trip1');
});

/* ── fuel ──────────────────────────────────────────────────────────────── */

const fill = (id, odometerReadingKm, quantityLiters, fillType = 'Full Tank', ratePerUnit = 100) =>
  fuelRowFrom(id, { vehicleId: 'v1', fuelDate: '2026-10-01', odometerReadingKm, quantityLiters, ratePerUnit, totalAmount: quantityLiters * ratePerUnit, fillType });

test('mileage runs from full tank to full tank, partials included', () => {
  const rows = [fill('f1', 10000, 30), fill('f2', 10200, 5, 'Partial Fill'), fill('f3', 10500, 20)];
  assert.deepEqual(fullToFullMileage(rows, rows[2]), { km: 500, litres: 25, kmpl: 20, fromFillId: 'f1' });
  assert.equal(fullToFullMileage(rows, rows[1]), null);
});

test('fuel flags: low mileage, over the tank, odd price, no trip, reading down', () => {
  const vehicle = { tankCapacityL: 12, stdMileageKmpl: 40, mileageTolerancePct: 10, currentOdometerKm: 10500 };
  const rows = [fill('f1', 10000, 10), fill('f2', 10100, 10), fill('f3', 10200, 10), fill('f4', 10300, 14, 'Full Tank', 125)];
  const check = checkFuel({ current: rows[3], rows, vehicle, settings, tripsSincePrevious: 0, tripKmSincePrevious: 0 });
  assert.deepEqual(check.flags.sort(), ['low_mileage', 'no_trip_between_fills', 'over_tank', 'rate_variance']);
  assert.equal(check.distanceSincePreviousKm, 100);

  const back = fill('f5', 10250, 5, 'Partial Fill');
  assert.ok(checkFuel({ current: back, rows: [...rows, back], vehicle, settings, tripsSincePrevious: 1, tripKmSincePrevious: 50 }).flags.includes('odometer_regression'));
});

test('legacy fuel logs are read with the fleet fields', () => {
  const row = fuelRowFrom('x', { vehicleId: 'v1', fuelDate: '2026-10-02', quantityLiters: '4', ratePerUnit: '105', fillType: 'Top-Up', createdAt: { seconds: 1_790_000_000 } });
  assert.equal(row.amount, 420);
  assert.equal(row.fullTank, false);
  assert.equal(row.paidBy, 'company');
  assert.ok(row.createdAt.startsWith('2026'));
});

/* ── OCR ───────────────────────────────────────────────────────────────── */

test('OCR picks the plausible odometer out of everything on the dash', () => {
  assert.equal(pickOdometer('ODO 45,312 TRIP 123.4 12:45', { lastKm: 45290 }).km, 45312);
  assert.equal(pickOdometer('12:45 ODO 045312', { lastKm: null }).km, 45312);
  assert.equal(pickOdometer('TRIP 123', { lastKm: 45290 }).km, null);
});

/* ── payment report ────────────────────────────────────────────────────── */

const reportTrip = (over) => ({
  id: 't',
  status: 'completed',
  vehicleId: 'v1',
  vehicleNumber: 'OD02AB1234',
  driverName: 'Ravi',
  dateKey: '2026-10-10',
  projectId: 'p1',
  projectName: 'Site A',
  projectCode: 'SA',
  gpsDistanceKm: 20,
  odoDistanceKm: 20,
  billableDistanceKm: 20,
  costSnapshot: { basis: 'per_km', ratePerKm: 9, amount: 180 },
  flagCodes: [],
  reportedIn: null,
  ...over,
});

test('report A–D: per-km and pooled costs by project, held and carried trips, reimbursements', () => {
  const vehicles = [
    normaliseVehicle('v1', { vehicleNumber: 'OD02AB1234', vehicleType: 'Two Wheeler', ratePerKm: 9, stdMileageKmpl: 40 }, settings),
    normaliseVehicle('v2', { vehicleNumber: 'OD02CD5678', vehicleType: 'Pickup', costBasis: 'fixed_plus_fuel', fixedMonthlyCost: 30000, stdMileageKmpl: 12 }, settings),
  ];
  const projects = [{ id: 'p1', name: 'Site A', code: 'SA', clientName: '', active: true, siteGeofenceIds: [] }, { id: 'p2', name: 'Site B', code: 'SB', clientName: '', active: true, siteGeofenceIds: [] }];
  const trips = [
    reportTrip({ id: 't1' }),
    reportTrip({ id: 't2', dateKey: '2026-09-28', flagCodes: ['gps_gap'] }), // settled late: carried from September
    reportTrip({ id: 't3', vehicleId: 'v2', vehicleNumber: 'OD02CD5678', billableDistanceKm: 300, costSnapshot: { basis: 'fixed_plus_fuel', ratePerKm: 0, amount: 0 } }),
    reportTrip({ id: 't4', vehicleId: 'v2', vehicleNumber: 'OD02CD5678', projectId: 'p2', projectName: 'Site B', billableDistanceKm: 100, costSnapshot: { basis: 'fixed_plus_fuel', ratePerKm: 0, amount: 0 } }),
    reportTrip({ id: 't5', status: 'pending_review', billableDistanceKm: null, gpsDistanceKm: 30, odoDistanceKm: 45, flagCodes: ['gps_odo_mismatch'] }),
    reportTrip({ id: 't6', reportedIn: '2026-09' }), // already paid
    reportTrip({ id: 't7', dateKey: '2026-11-01' }), // next month
  ];
  const fuel = [
    { ...fill('f1', 50000, 30, 'Full Tank', 100), vehicleId: 'v2', fuelDate: '2026-10-05' },
    { ...fill('f2', 12000, 2, 'Partial Fill', 100), fuelDate: '2026-10-06', paidBy: 'driver', driverUserId: 'u-ravi', driverName: 'Ravi' },
  ];
  const report = buildPaymentReport({ from: '2026-10-01', to: '2026-10-31', trips, fuel, vehicles, projects, months: 1 });

  assert.deepEqual(report.tripIds.sort(), ['t1', 't2', 't3', 't4']);
  const a = Object.fromEntries(report.reportA.map((row) => [row.projectCode, row]));
  assert.equal(a.SA.perKmCost, 360);
  assert.equal(a.SA.carriedTrips, 1);
  // v2's ₹30,000 fixed + ₹3,000 fuel shared 300:100 between Site A and Site B.
  assert.equal(a.SA.fixedShare, 22500);
  assert.equal(a.SB.fixedShare, 7500);
  assert.equal(a.SB.fuelShare, 750);
  assert.equal(report.totals.payable, 360 + 30000 + 3000);

  const b = Object.fromEntries(report.reportB.map((row) => [row.vehicleId, row]));
  assert.equal(b.v2.km, 400);
  assert.equal(b.v2.expectedLitres, 33.33);
  assert.equal(b.v2.varianceLitres, -3.33);
  assert.equal(b.v2.cost, 33000);

  assert.deepEqual(report.reportC.map((row) => [row.tripId, row.held]), [['t5', true], ['t2', false]]);
  assert.equal(report.totals.heldTrips, 1);
  assert.deepEqual(report.reportD.map((row) => [row.driverName, row.driverPaid]), [['Ravi', 200]]);
  assert.equal(report.totals.reimbursements, 200);
});

/* ── small helpers ─────────────────────────────────────────────────────── */

test('legacy status and undefined stripping', () => {
  assert.equal(legacyTripStatus('paused'), 'In Progress');
  assert.equal(legacyTripStatus('pending_review'), 'Completed');
  assert.deepEqual(stripUndefined({ a: 1, b: undefined, c: [{ d: undefined, e: 2 }] }), { a: 1, c: [{ e: 2 }] });
});

/* ── places ────────────────────────────────────────────────────────────── */

test('a list shows the locality, not the whole reverse-geocoded address', () => {
  assert.equal(shortPlace('7RM5+R46, Gopabandhu Nagar, Bhubaneswar, Odisha 751003, India'), 'Gopabandhu Nagar, Bhubaneswar');
  assert.equal(shortPlace('1015/433, Nilakantha Nagar, Nayapalli, Bhubaneswar, Odisha 751012, India'), 'Nilakantha Nagar, Nayapalli');
  assert.equal(shortPlace('Head office'), 'Head office');
  assert.equal(shortPlace('Odisha 751003, India'), 'Odisha 751003, India', 'nothing left: keep the original');
  assert.equal(shortPlace(''), '');
});
