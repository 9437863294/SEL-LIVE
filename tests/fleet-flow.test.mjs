/**
 * SEL Fleet — the server end to end (src/lib/fleet/server): starting, tracking and ending trips,
 * the vehicle lock, the daily limit, over-limit approvals and their chain, emergency starts,
 * manager review, force-close, fuel entries, the payment report and photo access — run against an
 * in-memory Firestore and Storage (tests/helpers).
 *
 * The flows build on each other in order, on one fixed clock (NOW is 09:30 IST on 25 Oct 2026).
 * Run: npm run test:fleet
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { FakeFirestore } from './helpers/fake-firestore.mjs';

globalThis.__db = new FakeFirestore();
const db = globalThis.__db;

const { fleetErrorResponse } = await import('../src/lib/fleet/server/context.ts');
const { startTrip, addPoints, addGeofenceEvents, endTrip, changeTrip, reviewTrip, forceCloseTrip, resolveTripException, listMyTrips, listTrips, tripDetail, runningTrips, settle } = await import('../src/lib/fleet/server/trips.ts');
const { requestApproval, actOnApproval, myApprovals, approvalInbox, approvalDetail, tickApprovals } = await import('../src/lib/fleet/server/approvals.ts');
const { createFuelEntry, listMyFuel, resolveFuelException } = await import('../src/lib/fleet/server/fuel.ts');
const { saveUpload, readUpload } = await import('../src/lib/fleet/server/uploads.ts');
const { generateReport, generateReportFor, approveReport, listReports, getReport, reportFile } = await import('../src/lib/fleet/server/reports.ts');
const { fleetBootstrap, fleetDashboard, fleetExceptions } = await import('../src/lib/fleet/server/overview.ts');
const { forgetVehicles } = await import('../src/lib/fleet/server/lookups.ts');
const { istDateKey } = await import('../src/lib/fleet/dates.ts');

const NOW = '2026-10-25T04:00:00.000Z';
const TODAY = '2026-10-25';
const at = (minutes) => new Date(Date.parse(NOW) + minutes * 60_000).toISOString();

const NONE = { viewAll: false, review: false, forceClose: false, exportTrips: false, reportsView: false, reportsGenerate: false, reportsApprove: false, settingsView: false, settingsEdit: false };

const ctx = (userId, { now = NOW, fleet = {} } = {}) => ({
  userId,
  userName: db.read('users', userId)?.name ?? userId,
  userEmail: `${userId}@example.com`,
  role: 'User',
  organizationId: 'default',
  access: {},
  permissions: {},
  roleNames: [],
  projectIds: [],
  departmentIds: [],
  fleet: { ...NONE, ...fleet },
  now,
  today: istDateKey(now),
});

const runAfter = async () => {
  const tasks = (globalThis.__after ?? []).splice(0);
  await Promise.all(tasks.map((task) => task()));
};
const takeNotices = async () => {
  await runAfter();
  return (globalThis.__notices ?? []).splice(0);
};

/** Expects a refusal with the HTTP status the route would answer (fleetRoute's mapping). */
const rejects = (promise, status, pattern, code) =>
  assert.rejects(promise, (error) => {
    const answered = fleetErrorResponse(error)?.status ?? error.status;
    assert.equal(answered, status, `expected ${status}, got ${answered} — ${error.name}: ${error.message}`);
    if (pattern) assert.match(error.message, pattern);
    if (code) assert.equal(error.details?.code, code);
    return true;
  });

let sequence = 0;
const cid = (tag) => `${tag}-${String(++sequence).padStart(6, '0')}`;

const uploadRequest = (kind, vehicleId) => {
  const form = new FormData();
  form.append('file', new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])], 'photo.jpg', { type: 'image/jpeg' }));
  form.append('kind', kind);
  if (vehicleId) form.append('vehicleId', vehicleId);
  return new Request('http://localhost/api/fleet/uploads', { method: 'POST', body: form });
};
const photo = async (userId, kind = 'odometer', vehicleId = '') => (await saveUpload(ctx(userId), uploadRequest(kind, vehicleId))).uploadId;

const startBody = async (userId, vehicleId, km, extra = {}) => ({
  clientStartId: cid('start'),
  vehicleId,
  purposeId: 'default-client-meeting',
  expectedKm: 10,
  startOdometer: { km, uploadId: await photo(userId, 'odometer', vehicleId) },
  position: { lat: 20.3, lng: 85.8, accuracyM: 10 },
  ...extra,
});
const start = async (userId, vehicleId, km, extra = {}, now = NOW) => (await startTrip(ctx(userId, { now }), await startBody(userId, vehicleId, km, extra))).trip;

/** Northward fixes one minute and ~1.11 km apart: lat 20.3 + 0.01·i at minute `offset + i`. */
const track = (tag, from, count, offset, firstIndex = 1) =>
  Array.from({ length: count }, (_, index) => {
    const step = firstIndex + index;
    return { clientPointId: `pt-${tag}-${String(step).padStart(4, '0')}`, lat: Number((20.3 + 0.01 * step).toFixed(4)), lng: 85.8, accuracyM: 8, speedKmph: 60, headingDeg: 0, recordedAt: at(offset + step - from + 1) };
  });

const end = async (userId, tripId, km, now, extra = {}) =>
  (await endTrip(ctx(userId, { now }), tripId, { clientEndId: cid('end'), endOdometer: { km, uploadId: await photo(userId) }, position: null, endedAt: now, remark: '', ...extra })).trip;

/* ── seed ─────────────────────────────────────────────────────────────── */

for (const [id, name] of [['drv1', 'Ravi'], ['drv2', 'Sita'], ['boss', 'Boss'], ['backup', 'Backup'], ['mgr', 'Manager'], ['admin', 'Fleet Admin'], ['acct', 'Accounts'], ['stranger', 'Stranger']]) {
  db.seed('users', id, { name, email: `${id}@example.com`, status: 'Active' });
}
// Both drivers report to the manager (Access Management); v1 and v5 have their own approver.
db.seed('accessGrants', 'drv1', { reportingManagerId: 'mgr' });
db.seed('accessGrants', 'drv2', { reportingManagerId: 'mgr' });
db.seed('vehicleManagementDriver', 'd1', { driverName: 'Ravi K', linkedUserId: 'drv1', assignedVehicleId: 'v1' });
db.seed('projects', 'p1', { projectName: 'Site A', siteCode: 'SA', status: 'Active' });
// A trip's projects are the values of Employee › Category's source category (Project Name by default).
db.seed('categories', 'p1', { id: 1, name: 'Site A', type: 'Project Name' });
// The value is linked to the Settings › Projects record: it lends the site code, and its vehicles are listed for it.
db.seed('employeeProjectLinks', 'p1', { categoryType: 'Project Name', valueName: 'Site A', projectIds: ['p1'] });
db.seed('vehicleManagementVehicles', 'v1', { vehicleNumber: 'OD02AB0001', vehicleType: 'Two Wheeler', fuelType: 'Petrol', vehicleStatus: 'Active', assignedProjectId: 'p1', currentOdometerKm: 10000, ratePerKm: 5, approverUid: 'boss', backupApproverUid: 'backup', stdMileageKmpl: 40, tankCapacityL: 12 });
db.seed('vehicleManagementVehicles', 'v2', { vehicleNumber: 'OD02AB0002', vehicleType: 'Car', fuelType: 'Diesel', vehicleStatus: 'Active', currentOdometerKm: 50000, ratePerKm: 12 });
db.seed('vehicleManagementVehicles', 'v3', { vehicleNumber: 'OD02AB0003', vehicleType: 'Pickup', fuelType: 'Diesel', vehicleStatus: 'Active', currentOdometerKm: 70000, costBasis: 'fixed_plus_fuel', fixedMonthlyCost: 30000 });
db.seed('vehicleManagementVehicles', 'v4', { vehicleNumber: 'OD02AB0004', vehicleType: 'Car', fuelType: 'Petrol', vehicleStatus: 'Active', currentOdometerKm: 30000, ratePerKm: 10 });
db.seed('vehicleManagementVehicles', 'v5', { vehicleNumber: 'OD02AB0005', vehicleType: 'Car', fuelType: 'Petrol', vehicleStatus: 'Active', currentOdometerKm: 20000, ratePerKm: 10, stdMileageKmpl: 15, tankCapacityL: 40, approverUid: 'boss' });
db.seed('fleetSettings', 'default', { escalationUserIds: ['admin'], emergencyMonthlyMax: 1, reportEmails: ['accounts@example.com'] });
db.seed('fleetGeofences', 'g-office', { organizationId: 'default', name: 'Head office', kind: 'office', lat: 20.3, lng: 85.8, radiusM: 150, projectId: null, address: '', active: true, deletedAt: null });
db.seed('fleetGeofences', 'g-site', { organizationId: 'default', name: 'Site A gate', kind: 'project_site', lat: 20.6, lng: 85.8, radiusM: 300, projectId: 'p1', address: '', active: true, deletedAt: null });
// A September full tank on v5: the window October's fill-up measures mileage from.
db.seed('vehicleManagementFuelLogs', 'fl-1', { vehicleId: 'v5', fuelDate: '2026-09-20', odometerReadingKm: 20000, quantityLiters: 30, ratePerUnit: 100, totalAmount: 3000, fillType: 'Full Tank' });

const trips = {};

/* ── starting ─────────────────────────────────────────────────────────── */

test('a start is refused for a lower odometer, a missing reason, project or photo', async () => {
  await rejects(startTrip(ctx('drv1'), await startBody('drv1', 'v1', 9990)), 400, /cannot go down/);
  await rejects(startTrip(ctx('drv1'), await startBody('drv1', 'v1', 10005, { purposeId: 'default-other' })), 400, /what the trip is for/);
  await rejects(startTrip(ctx('drv1'), await startBody('drv1', 'v1', 10005, { purposeId: 'default-site-visit' })), 400, /project/);
  await rejects(startTrip(ctx('drv1'), { ...(await startBody('drv1', 'v1', 10005)), startOdometer: { km: 10005, uploadId: null } }), 400, /photo/);
  await rejects(startTrip(ctx('drv1'), { ...(await startBody('drv1', 'v1', 10005)), startOdometer: { km: 10005, uploadId: await photo('drv2') } }), 403, /someone else/);
  assert.equal(db.read('vehicleManagementVehicles', 'v1').currentTripId, undefined);
});

test('starting takes the vehicle lock, at the start geofence, and a retry returns the same trip', async () => {
  const body = await startBody('drv1', 'v1', 10005, { expectedKm: 15 });
  const { trip } = await startTrip(ctx('drv1'), body);
  trips.a = trip;
  assert.equal(trip.status, 'running');
  assert.equal(trip.driverId, 'd1');
  assert.equal(trip.driverName, 'Ravi K');
  assert.equal(trip.startGeofenceName, 'Head office');
  assert.deepEqual(trip.flagCodes, []);
  assert.deepEqual(trip.managerIds.sort(), ['backup', 'boss']);
  const vehicle = db.read('vehicleManagementVehicles', 'v1');
  assert.equal(vehicle.currentTripId, trip.id);
  assert.equal(vehicle.currentOdometerKm, 10005);
  const stored = db.read('vehicleManagementTrips', trip.id);
  assert.equal(stored.fleet, true);
  assert.equal(stored.tripStatus, 'In Progress');
  assert.equal(stored.reportedIn, null);
  assert.equal(db.read('fleetUploads', body.startOdometer.uploadId).attachedId, trip.id);

  const again = await startTrip(ctx('drv1'), body);
  assert.equal(again.trip.id, trip.id);
});

test('one trip per vehicle and one per driver', async () => {
  await rejects(startTrip(ctx('drv2'), await startBody('drv2', 'v1', 10005)), 409, /must be ended first/, 'vehicle_busy');
  await rejects(startTrip(ctx('drv1'), await startBody('drv1', 'v2', 50000)), 409, /already have a trip running/, 'driver_busy');
});

/* ── tracking ─────────────────────────────────────────────────────────── */

test('points: idempotent by client id, live GPS km, only the driver, at most 200', async () => {
  const points = track('a', 1, 10, 0);
  const first = await addPoints(ctx('drv1', { now: at(11) }), trips.a.id, { points });
  assert.equal(first.accepted, 10);
  assert.ok(first.gpsDistanceKm > 9.8 && first.gpsDistanceKm < 10.2, String(first.gpsDistanceKm));
  const repeat = await addPoints(ctx('drv1', { now: at(11) }), trips.a.id, { points });
  assert.equal(repeat.accepted, 0);
  assert.equal(repeat.duplicates, 10);
  assert.equal(repeat.pointCount, 10);
  await rejects(addPoints(ctx('drv2', { now: at(11) }), trips.a.id, { points }), 403, /not yours/);
  await rejects(addPoints(ctx('drv1', { now: at(11) }), trips.a.id, { points: track('big', 1, 201, 0) }), 400, /200/);
  assert.equal(db.read('vehicleManagementTrips', trips.a.id).totalPoints, 10);

  const events = await addGeofenceEvents(ctx('drv1', { now: at(11) }), trips.a.id, { events: [{ clientEventId: 'ev-0000001', geofenceId: 'g-office', type: 'exit', at: at(2), lat: 20.32, lng: 85.8 }, { clientEventId: 'ev-0000002', geofenceId: 'nope', type: 'enter', at: at(3), lat: 20.33, lng: 85.8 }] });
  assert.equal(events.accepted, 1);
});

test('points: the native recorder’s gap records ride on a batch — alone or with points, kept once, the track untouched', async () => {
  const before = db.read('vehicleManagementTrips', trips.a.id);
  const first = { fromAt: at(4), toAt: at(6) };
  const second = { fromAt: at(7), toAt: at(8) };
  // With points already sent (duplicates): the gap is kept, nothing else moves.
  const withPoints = await addPoints(ctx('drv1', { now: at(12) }), trips.a.id, { points: track('a', 1, 10, 0), gaps: [first] });
  assert.equal(withPoints.accepted, 0);
  // Alone (the app restarted and no fix has come yet), and the first one again.
  const alone = await addPoints(ctx('drv1', { now: at(12) }), trips.a.id, { points: [], gaps: [second, first] });
  assert.equal(alone.accepted, 0);
  const after = db.read('vehicleManagementTrips', trips.a.id);
  assert.deepEqual(after.trackingGaps, [first, second]);
  assert.equal(after.totalPoints, before.totalPoints);
  assert.equal(after.gpsDistanceKm, before.gpsDistanceKm);
  // Neither points nor gaps: refused, as an empty batch always was.
  await rejects(addPoints(ctx('drv1', { now: at(12) }), trips.a.id, { points: [] }), 400, /at least one point/);
});

/* ── ending ───────────────────────────────────────────────────────────── */

test('GPS agrees with the odometer: completed, billed on the odometer, lock released', async () => {
  await rejects(endTrip(ctx('drv1', { now: at(16) }), trips.a.id, { clientEndId: cid('end'), endOdometer: { km: 10015, uploadId: null }, endedAt: at(15) }), 400, /photo/);
  await rejects(endTrip(ctx('drv1', { now: at(16) }), trips.a.id, { clientEndId: cid('end'), endOdometer: { km: 10000, uploadId: await photo('drv1') }, endedAt: at(15) }), 400, /must not be below/);
  const clientEndId = cid('end');
  const endPhoto = await photo('drv1');
  const done = (await endTrip(ctx('drv1', { now: at(16) }), trips.a.id, { clientEndId, endOdometer: { km: 10015, uploadId: endPhoto }, endedAt: at(15) })).trip;
  assert.equal(done.status, 'completed');
  assert.equal(done.billableDistanceKm, 10);
  assert.equal(done.billableSource, 'odometer');
  assert.equal(done.odoDistanceKm, 10);
  assert.equal(done.costSnapshot.amount, 50);
  assert.deepEqual(done.kmByDate, { [TODAY]: 10 });
  assert.equal(done.endedBy, 'driver');
  assert.equal(done.exceptionStatus, 'none');
  assert.deepEqual(done.geofenceEvents.map((event) => `${event.type}:${event.geofenceId}`), ['exit:g-office']);
  const vehicle = db.read('vehicleManagementVehicles', 'v1');
  assert.equal(vehicle.currentTripId, null);
  assert.equal(vehicle.currentOdometerKm, 10015);
  assert.equal(db.read('vehicleManagementTrips', trips.a.id).tripStatus, 'Completed');

  // The same end again is the same answer; a different end is refused.
  const again = await endTrip(ctx('drv1', { now: at(17) }), trips.a.id, { clientEndId, endOdometer: { km: 10015, uploadId: endPhoto }, endedAt: at(15) });
  assert.equal(again.trip.billableDistanceKm, 10);
  await rejects(endTrip(ctx('drv1', { now: at(17) }), trips.a.id, { clientEndId: cid('end'), endOdometer: { km: 10016, uploadId: await photo('drv1') } }), 409, /already ended/);
  // A photo already on a record cannot go on another.
  await rejects(startTrip(ctx('drv1', { now: at(18) }), { ...(await startBody('drv1', 'v2', 50000)), startOdometer: { km: 50000, uploadId: endPhoto } }), 409, /another record/);
  trips.a = done;
  await takeNotices();
});

test('a GPS/odometer mismatch waits for review; late points that close the gap settle it', async () => {
  const trip = await start('drv2', 'v2', 50000, {}, at(20));
  assert.deepEqual(trip.managerIds, ['mgr']);
  await addPoints(ctx('drv2', { now: at(31) }), trip.id, { points: track('b', 1, 10, 20) });
  const pending = await end('drv2', trip.id, 50030, at(50));
  assert.equal(pending.status, 'pending_review');
  assert.equal(pending.billableDistanceKm, null);
  assert.ok(pending.flagCodes.includes('gps_odo_mismatch'));
  assert.ok(pending.flagCodes.includes('gps_gap'));
  assert.equal(pending.review.status, 'pending');
  assert.match(pending.review.reason, /GPS/);
  const notices = await takeNotices();
  assert.ok(notices.some((notice) => notice.userIds.includes('mgr') && /Review trip/.test(notice.title)));

  // The phone flushes the rest of its queue after the end: the whole track now matches.
  const late = await addPoints(ctx('drv2', { now: at(55) }), trip.id, { points: track('b', 1, 19, 20, 11) });
  assert.equal(late.accepted, 19);
  const settled = db.read('vehicleManagementTrips', trip.id);
  assert.equal(settled.status, 'completed');
  assert.equal(settled.billableDistanceKm, 30);
  assert.equal(settled.exceptionStatus, 'none');
  assert.equal(settled.review, null);
  assert.deepEqual(settled.flagCodes, []);
  trips.b = settled;
});

test('a manager settles a review — never their own trip, and a typed figure needs a note', async () => {
  const trip = await start('drv2', 'v2', 50030, {}, at(60));
  await addPoints(ctx('drv2', { now: at(71) }), trip.id, { points: track('c', 1, 10, 60) });
  const pending = await end('drv2', trip.id, 50050, at(72));
  assert.equal(pending.status, 'pending_review');
  await rejects(reviewTrip(ctx('drv2', { now: at(80), fleet: { review: true } }), trip.id, { choice: 'gps' }), 403, /own/);
  await rejects(reviewTrip(ctx('stranger', { now: at(80) }), trip.id, { choice: 'gps' }), 403);
  await rejects(reviewTrip(ctx('mgr', { now: at(80) }), trip.id, { choice: 'manager', km: 15 }), 400, /how the km/);
  const reviewed = (await reviewTrip(ctx('mgr', { now: at(80) }), trip.id, { choice: 'gps', note: 'Odometer photo is blurred' })).trip;
  assert.equal(reviewed.status, 'completed');
  assert.equal(reviewed.billableSource, 'gps');
  assert.ok(reviewed.billableDistanceKm > 9.8 && reviewed.billableDistanceKm < 10.2);
  assert.equal(reviewed.review.status, 'resolved');
  assert.equal(reviewed.review.byId, 'mgr');
  assert.equal(reviewed.exceptionStatus, 'resolved');
  assert.equal(reviewed.costSnapshot.amount, Math.round(reviewed.billableDistanceKm * 12 * 100) / 100);
  const notices = await takeNotices();
  assert.ok(notices.some((notice) => notice.userIds.includes('drv2') && /reviewed/.test(notice.title)));
  await rejects(reviewTrip(ctx('mgr', { now: at(81) }), trip.id, { choice: 'gps', note: 'again' }), 403);
  trips.c = reviewed;
});

/* ── the daily limit and approvals ────────────────────────────────────── */

test('past the daily limit a start needs approval; the request goes to the vehicle approver', async () => {
  await rejects(startTrip(ctx('drv1', { now: at(80) }), await startBody('drv1', 'v1', 10015, { expectedKm: 100 })), 409, /needs approval/, 'over_limit');
  const { approval, reused } = await requestApproval(ctx('drv1', { now: at(81) }), { vehicleId: 'v1', requestedKm: 100, reason: 'Material to Site A', projectId: 'p1', purposeId: 'default-material-delivery' });
  assert.equal(reused, false);
  assert.equal(approval.status, 'pending');
  assert.equal(approval.level, 1);
  assert.deepEqual(approval.assigneeIds, ['boss']);
  assert.equal(approval.usedKm, 10);
  assert.equal(approval.limitKm, 80);
  assert.equal(approval.projectName, 'Site A');
  assert.equal(approval.expiresAt, at(201));
  const notices = await takeNotices();
  assert.ok(notices.some((notice) => notice.userIds.includes('boss') && /over its limit/.test(notice.title)));

  const again = await requestApproval(ctx('drv1', { now: at(82) }), { vehicleId: 'v1', requestedKm: 100, reason: 'Material to Site A', purposeId: 'default-material-delivery' });
  assert.equal(again.reused, true);
  assert.equal(again.approval.id, approval.id);
  await rejects(requestApproval(ctx('drv2', { now: at(82) }), { vehicleId: 'v3', requestedKm: 20, reason: 'Short hop', purposeId: 'default-client-meeting' }), 400, /No approval is needed/, 'within_limit');
  trips.approvalA = approval;
});

test('deciding: not your own, only those it reached, reject needs a note, a cap above what is left', async () => {
  const id = trips.approvalA.id;
  await rejects(actOnApproval(ctx('drv1', { now: at(83) }), id, { action: 'approve' }), 400, /your own/);
  await rejects(actOnApproval(ctx('stranger', { now: at(83) }), id, { action: 'approve' }), 400, /not with you/);
  await rejects(actOnApproval(ctx('boss', { now: at(83) }), id, { action: 'reject' }), 400, /why/);
  // 70 km are left under the limit: a cap at or below that would allow less than no approval.
  await rejects(actOnApproval(ctx('boss', { now: at(83) }), id, { action: 'approve_cap', capKm: 50 }), 400, /70 km are left/);
  const { approval } = await actOnApproval(ctx('boss', { now: at(83) }), id, { action: 'approve_cap', capKm: 80, note: 'Not the full 100' });
  assert.equal(approval.status, 'approved');
  assert.equal(approval.allowedKm, 90);
  const notices = await takeNotices();
  assert.ok(notices.some((notice) => notice.userIds.includes('drv1') && /Approved/.test(notice.title)));
  await rejects(actOnApproval(ctx('boss', { now: at(84) }), id, { action: 'approve' }), 400, /already approved/);
});

test('a start inside the approved allowance uses the approval; running past it waits for review', async () => {
  await rejects(startTrip(ctx('drv1', { now: at(85) }), await startBody('drv1', 'v1', 10015, { expectedKm: 100 })), 409, undefined, 'over_limit');
  const trip = await start('drv1', 'v1', 10015, { expectedKm: 45 }, at(85));
  assert.equal(trip.approvalId, trips.approvalA.id);
  assert.equal(trip.approvedKmCap, 90);
  const approval = db.read('fleetApprovals', trips.approvalA.id);
  assert.equal(approval.status, 'used');
  assert.equal(approval.tripId, trip.id);

  // No track at all, and 90 km on the odometer: 100 km today against 90 allowed.
  const ended = await end('drv1', trip.id, 10105, at(95));
  assert.equal(ended.status, 'pending_review');
  assert.equal(ended.billableDistanceKm, 90);
  assert.ok(ended.flagCodes.includes('no_gps'));
  assert.ok(ended.flagCodes.includes('over_cap'));
  assert.match(ended.review.reason, /beyond the km/);
  trips.overCap = ended;
  await takeNotices();
});

test('approve and raise lifts the vehicle limit; a cancelled start gives the approval back', async () => {
  const { approval } = await requestApproval(ctx('drv1', { now: at(100) }), { vehicleId: 'v3', requestedKm: 200, reason: 'Long haul to the quarry', purposeId: 'default-material-delivery' });
  // v3 has no approver of its own: the driver's reporting authority, then the escalation list.
  assert.deepEqual(approval.assigneeIds, ['mgr']);
  assert.equal(approval.escalateAt, at(130));
  await rejects(actOnApproval(ctx('mgr', { now: at(101) }), approval.id, { action: 'approve_raise', newLimitKm: 100 }), 400, /above 120/);
  const raised = (await actOnApproval(ctx('mgr', { now: at(101) }), approval.id, { action: 'approve_raise', newLimitKm: 250 })).approval;
  assert.equal(raised.allowedKm, 250);
  assert.equal(db.read('vehicleManagementVehicles', 'v3').dailyKmLimit, 250);

  const trip = await start('drv1', 'v3', 70000, { expectedKm: 200 }, at(102));
  assert.equal(trip.approvalId, approval.id);
  assert.equal(db.read('fleetApprovals', approval.id).status, 'used');
  const cancelled = (await changeTrip(ctx('drv1', { now: at(105) }), trip.id, { action: 'cancel', reason: 'Wrong vehicle' })).trip;
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(db.read('vehicleManagementVehicles', 'v3').currentTripId, null);
  const back = db.read('fleetApprovals', approval.id);
  assert.equal(back.status, 'approved');
  assert.equal(back.tripId, null);
  await takeNotices();
});

test('pause and resume; an old or moving trip cannot be cancelled', async () => {
  const trip = await start('drv1', 'v4', 30000, {}, at(110));
  const paused = (await changeTrip(ctx('drv1', { now: at(112) }), trip.id, { action: 'pause', reason: 'Lunch' })).trip;
  assert.equal(paused.status, 'paused');
  await rejects(changeTrip(ctx('drv1', { now: at(113) }), trip.id, { action: 'pause' }), 409);
  const resumed = (await changeTrip(ctx('drv1', { now: at(120) }), trip.id, { action: 'resume' })).trip;
  assert.equal(resumed.status, 'running');
  assert.deepEqual(resumed.pauses, [{ from: at(112), to: at(120) }]);
  await rejects(changeTrip(ctx('drv1', { now: at(140) }), trip.id, { action: 'cancel' }), 409, /first 15 minutes/);
  await rejects(changeTrip(ctx('drv2', { now: at(121) }), trip.id, { action: 'pause' }), 409);
  const ended = await end('drv1', trip.id, 30004, at(141));
  assert.equal(ended.status, 'completed');
  assert.deepEqual(ended.pauses, [{ from: at(112), to: at(120) }]);
  trips.v4a = ended;
  await takeNotices();
});

test('the driver withdraws a request; Fleet Trips · Review decides for an absent approver', async () => {
  const first = (await requestApproval(ctx('drv2', { now: at(150) }), { vehicleId: 'v1', requestedKm: 20, reason: 'Bank deposit', purposeId: 'default-client-meeting' })).approval;
  assert.deepEqual(first.assigneeIds, ['boss']);
  await rejects(actOnApproval(ctx('drv1', { now: at(151) }), first.id, { action: 'cancel' }), 400, /driver who asked/);
  assert.equal((await actOnApproval(ctx('drv2', { now: at(151) }), first.id, { action: 'cancel' })).approval.status, 'cancelled');

  const second = (await requestApproval(ctx('drv2', { now: at(152) }), { vehicleId: 'v1', requestedKm: 20, reason: 'Bank deposit', purposeId: 'default-client-meeting' })).approval;
  assert.notEqual(second.id, first.id);
  const decided = (await actOnApproval(ctx('acct', { now: at(153), fleet: { review: true } }), second.id, { action: 'approve' })).approval;
  assert.equal(decided.status, 'approved');
  assert.equal(decided.allowedKm, 120);
  assert.match(decided.history.at(-1).note, /override/);
  await takeNotices();
});

test('an emergency start past the limit is allowed, flagged, reported — and counted per month', async () => {
  await rejects(startTrip(ctx('drv2', { now: at(160) }), await startBody('drv2', 'v1', 10105, { expectedKm: 30 })), 409, undefined, 'over_limit');
  const trip = await start('drv2', 'v1', 10105, { expectedKm: 30, emergency: { reason: 'Site accident, carrying first aid' } }, at(160));
  assert.equal(trip.isEmergency, true);
  assert.ok(trip.flagCodes.includes('emergency'));
  const notices = await takeNotices();
  const alert = notices.find((notice) => /Emergency start/.test(notice.title));
  assert.ok(alert && alert.userIds.includes('boss') && alert.userIds.includes('admin'));
  const ended = await end('drv2', trip.id, 10110, at(170));
  assert.ok(ended.flagCodes.includes('emergency'));
  trips.emergency = ended;
  await rejects(startTrip(ctx('drv2', { now: at(175) }), await startBody('drv2', 'v1', 10110, { expectedKm: 30, emergency: { reason: 'Another urgent run' } })), 403, /emergency starts/, 'no_emergency_left');
  await takeNotices();
});

test('the clock escalates a waiting request, then expires it', async () => {
  const { approval } = await requestApproval(ctx('drv1', { now: at(200) }), { vehicleId: 'v2', requestedKm: 100, reason: 'Client visit far away', purposeId: 'default-client-meeting' });
  assert.deepEqual(approval.assigneeIds, ['mgr']);
  await takeNotices();
  assert.equal((await tickApprovals(at(210))).escalated, 0);
  const escalated = await tickApprovals(at(231));
  assert.equal(escalated.escalated, 1);
  const stored = db.read('fleetApprovals', approval.id);
  assert.equal(stored.level, 3);
  assert.deepEqual(stored.notifiedIds, ['mgr', 'admin']);
  let notices = await takeNotices();
  assert.ok(notices.some((notice) => notice.userIds.includes('admin') && /Escalated/.test(notice.title)));
  // Anyone it reached may decide — here nobody does.
  const expired = await tickApprovals(at(321));
  assert.equal(expired.expired, 1);
  assert.equal(db.read('fleetApprovals', approval.id).status, 'expired');
  notices = await takeNotices();
  assert.ok(notices.some((notice) => notice.userIds.includes('drv1') && /expired/.test(notice.title)));
  await rejects(actOnApproval(ctx('mgr', { now: at(322) }), approval.id, { action: 'approve' }), 400, /already expired/);
});

/* ── force-close ──────────────────────────────────────────────────────── */

test('a manager force-closes: with a reading it stands, without one it waits for review', async () => {
  const trip = await start('drv2', 'v4', 30004, {}, at(330));
  await rejects(forceCloseTrip(ctx('drv2', { now: at(331), fleet: { forceClose: true } }), trip.id, { reason: 'Forgot to end it' }), 403, /End your own/);
  await rejects(forceCloseTrip(ctx('stranger', { now: at(331) }), trip.id, { reason: 'Not mine at all' }), 403);
  const closed = (await forceCloseTrip(ctx('mgr', { now: at(340) }), trip.id, { endOdometerKm: 30016, reason: 'Driver phone died' })).trip;
  assert.equal(closed.status, 'completed');
  assert.equal(closed.endedBy, 'force');
  assert.equal(closed.billableDistanceKm, 12);
  assert.ok(!closed.flagCodes.includes('auto_closed'));
  assert.equal(db.read('vehicleManagementVehicles', 'v4').currentTripId, null);
  assert.equal(db.read('vehicleManagementVehicles', 'v4').currentOdometerKm, 30016);
  const notices = await takeNotices();
  assert.ok(notices.some((notice) => notice.userIds.includes('drv2') && /was closed/.test(notice.title)));
  trips.forced = closed;

  const second = await start('drv2', 'v4', 30016, {}, at(345));
  const unread = (await forceCloseTrip(ctx('mgr', { now: at(350) }), second.id, { reason: 'Left running overnight' })).trip;
  assert.equal(unread.status, 'pending_review');
  assert.ok(unread.flagCodes.includes('auto_closed'));
  assert.equal(unread.billableDistanceKm, null);
  trips.forcedPending = unread;
  await takeNotices();
});

test('closed by the server while the phone was offline: the driver’s own end still settles it — once, and not over a manager', async () => {
  const system = { organizationId: 'default', now: at(600), userId: 'system', userName: 'System' };
  const trip = await start('drv2', 'v4', 30016, {}, at(360));
  await addPoints(ctx('drv2', { now: at(366) }), trip.id, { points: track('off', 1, 3, 360) });
  // No signal for hours: the idle job closes it at its last fix, for review, and frees the vehicle.
  const auto = await settle(system, trip.id, { reason: 'auto_idle', autoClosed: true, endedAt: at(363) });
  assert.equal(auto.status, 'pending_review');
  assert.equal(auto.endedBy, 'auto_idle');
  assert.ok(auto.flagCodes.includes('auto_closed'));
  assert.equal(db.read('vehicleManagementVehicles', 'v4').currentTripId, null);
  // The phone comes back: what it recorded offline, then the driver's end with the reading and photo.
  await addPoints(ctx('drv2', { now: at(610) }), trip.id, { points: track('off', 1, 9, 360, 4) });
  const clientEndId = cid('end');
  const ended = await end('drv2', trip.id, 30029, at(612), { clientEndId, endedAt: at(375) });
  assert.equal(ended.endedBy, 'driver');
  assert.equal(ended.endOdometer.km, 30029);
  assert.equal(ended.endedAt, at(375));
  assert.ok(!ended.flagCodes.includes('auto_closed'), ended.flagCodes.join(','));
  assert.ok(ended.gpsDistanceKm > 12, `the offline stretch counts: ${ended.gpsDistanceKm}`);
  assert.equal(db.read('vehicleManagementVehicles', 'v4').currentOdometerKm, 30029);
  // The same end again is the same answer; a different one is refused.
  assert.equal((await end('drv2', trip.id, 30029, at(613), { clientEndId, endedAt: at(375) })).id, trip.id);
  await rejects(end('drv2', trip.id, 30030, at(614)), 409, /already ended/, 'already_ended');

  // A manager who settled the auto-closed trip first keeps the last word.
  const second = await start('drv2', 'v4', 30029, {}, at(620));
  await settle(system, second.id, { reason: 'auto_idle', autoClosed: true, endedAt: at(621) });
  await reviewTrip(ctx('mgr', { now: at(700) }), second.id, { choice: 'manager', km: 4, note: 'Phone was off; driver confirmed 4 km' });
  await rejects(end('drv2', second.id, 30035, at(710)), 409, /already ended/, 'already_ended');
  await takeNotices();
});

/* ── fuel ─────────────────────────────────────────────────────────────── */

const fuelBody = async (over = {}) => ({
  clientEntryId: cid('fuel'),
  vehicleId: 'v5',
  fuelDate: TODAY,
  odometerKm: 20300,
  litres: 25,
  amount: 2550,
  fullTank: true,
  paidBy: 'driver',
  paymentMode: 'Cash',
  stationName: 'HP Patia',
  billNumber: 'B-778',
  billUploadId: await photo('drv1', 'fuel_bill', 'v5'),
  odometerUploadId: await photo('drv1', 'odometer', 'v5'),
  position: null,
  ...over,
});

test('fuel: both photos, the right kinds, a recent date', async () => {
  await rejects(createFuelEntry(ctx('drv1'), await fuelBody({ billUploadId: await photo('drv1', 'odometer') })), 400, /wrong kind/);
  await rejects(createFuelEntry(ctx('drv1'), await fuelBody({ billUploadId: 'nope-0000' })), 400, /not found/);
  await rejects(createFuelEntry(ctx('drv1'), await fuelBody({ fuelDate: '2026-10-26' })), 400, /future/);
  await rejects(createFuelEntry(ctx('drv1'), await fuelBody({ fuelDate: '2026-10-17' })), 400, /older than a week/);
  await rejects(createFuelEntry(ctx('drv1'), { ...(await fuelBody()), billUploadId: undefined }), 400);
});

test('fuel: full-to-full mileage, flags, the vehicle reading, idempotent', async () => {
  const body = await fuelBody();
  const { entry, reused } = await createFuelEntry(ctx('drv1'), body);
  assert.equal(reused, false);
  assert.equal(entry.mileageKmpl, 12);
  assert.equal(entry.distanceSincePreviousKm, 300);
  assert.equal(entry.expectedLitres, 20);
  assert.deepEqual([...entry.flagCodes].sort(), ['low_mileage', 'no_trip_between_fills']);
  assert.equal(entry.exceptionStatus, 'open');
  assert.equal(entry.paidBy, 'driver');
  const stored = db.read('vehicleManagementFuelLogs', entry.id);
  assert.equal(stored.fillType, 'Full Tank');
  assert.equal(stored.ratePerUnit, 102);
  assert.equal(stored.sourceApp, 'SEL Fleet');
  assert.deepEqual(stored.managerIds, ['boss']);
  assert.equal(db.read('vehicleManagementVehicles', 'v5').currentOdometerKm, 20300);
  assert.equal(db.read('fleetUploads', body.billUploadId).attachedId, entry.id);
  const notices = await takeNotices();
  assert.ok(notices.some((notice) => notice.userIds.includes('boss') && /Low mileage/.test(notice.title)));

  const again = await createFuelEntry(ctx('drv1'), body);
  assert.equal(again.reused, true);
  assert.equal(again.entry.id, entry.id);
  assert.equal((await listMyFuel(ctx('drv1'))).filter((row) => row.vehicleId === 'v5').length, 1);

  await rejects(resolveFuelException(ctx('drv1'), { kind: 'fuel', id: entry.id, note: 'All fine' }), 403, /own/);
  await rejects(resolveFuelException(ctx('stranger'), { kind: 'fuel', id: entry.id, note: 'All fine' }), 403);
  await resolveFuelException(ctx('boss'), { kind: 'fuel', id: entry.id, note: 'Tyre pressure was low; checked' });
  assert.equal(db.read('vehicleManagementFuelLogs', entry.id).exceptionStatus, 'resolved');
  await rejects(resolveFuelException(ctx('boss'), { kind: 'fuel', id: entry.id, note: 'again' }), 409);
  trips.fuel = entry;
});

/* ── exceptions and the screens' reads ────────────────────────────────── */

test('trip exceptions are resolved by a manager, not the driver; pending reviews are reviewed instead', async () => {
  await rejects(resolveTripException(ctx('drv2'), { kind: 'trip', id: trips.emergency.id, note: 'Fine' }), 403);
  await rejects(resolveTripException(ctx('boss'), { kind: 'trip', id: trips.overCap.id, note: 'Fine' }), 403, /Review the trip/);
  await resolveTripException(ctx('boss'), { kind: 'trip', id: trips.emergency.id, note: 'Accident confirmed by the site' });
  assert.equal(db.read('vehicleManagementTrips', trips.emergency.id).exceptionStatus, 'resolved');
  const { trips: open } = await fleetExceptions(ctx('boss'));
  assert.ok(open.some((trip) => trip.id === trips.overCap.id));
  assert.ok(!open.some((trip) => trip.id === trips.emergency.id));
});

test('the screens read without error and see what they should', async () => {
  const boot = await fleetBootstrap(ctx('drv1', { now: at(360) }));
  assert.equal(boot.canDrive, true);
  assert.equal(boot.driver.id, 'd1');
  assert.equal(boot.openTrip, null);
  const v1 = boot.vehicles.find((vehicle) => vehicle.id === 'v1');
  assert.equal(v1.assignedToMe, true);
  assert.equal(v1.usedTodayKm, 105);
  // The start lists a project's vehicles: v1 is Vehicle Master's on Site A, the value linked to it.
  assert.equal(v1.projectId, 'p1');
  assert.deepEqual(boot.projects.map((project) => [project.id, project.name, project.code, project.linkedProjectIds]), [['p1', 'Site A', 'SA', ['p1']]]);
  assert.equal(boot.purposes.length, 7);
  assert.equal(boot.geofences.length, 2);
  assert.ok(boot.recentTrips.length >= 3);

  const bossBoot = await fleetBootstrap(ctx('boss', { now: at(360) }));
  assert.equal(bossBoot.isApprover, true);
  assert.equal(bossBoot.inbox.reviews, 1);

  const dashboard = await fleetDashboard(ctx('admin', { now: at(360) }));
  assert.equal(dashboard.scope, 'all');
  assert.ok(dashboard.todayFigures.km > 0);
  assert.equal(dashboard.byDay.length, 14);
  await rejects(fleetDashboard(ctx('stranger', { now: at(360) })), 403);

  const inbox = await approvalInbox(ctx('boss'));
  assert.ok(inbox.approvals.some((approval) => approval.id === trips.approvalA.id));
  assert.ok((await myApprovals(ctx('drv1'))).length >= 3);
  const detail = await approvalDetail(ctx('boss'), trips.approvalA.id);
  assert.ok(detail.todaysTrips.some((trip) => trip.id === trips.a.id));
  await rejects(approvalDetail(ctx('stranger'), trips.approvalA.id), 403);

  const mine = await listMyTrips(ctx('drv2'));
  assert.ok(mine.some((trip) => trip.id === trips.b.id));
  const managed = await listTrips(ctx('mgr'), { from: TODAY, to: TODAY });
  assert.ok(managed.some((trip) => trip.id === trips.b.id) && !managed.some((trip) => trip.id === trips.a.id));
  const all = await listTrips(ctx('acct', { fleet: { viewAll: true } }), { from: TODAY, to: TODAY, status: 'pending_review' });
  assert.deepEqual(all.map((trip) => trip.id).sort(), [trips.forcedPending.id, trips.overCap.id].sort());
  assert.equal((await runningTrips()).length, 0);

  const view = await tripDetail(ctx('boss'), trips.a.id);
  assert.equal(view.points.length, 10);
  assert.ok(view.photos.start && view.photos.end);
  assert.equal(view.deviceEvents.length, 1);
  assert.equal(view.abilities.review, false);
  await rejects(tripDetail(ctx('stranger'), trips.a.id), 403);
});

/* ── photos ───────────────────────────────────────────────────────────── */

test('a photo is shown to its taker, the record’s managers and fleet viewers — no one else', async () => {
  const { photos } = await tripDetail(ctx('drv1'), trips.a.id);
  const mine = await readUpload(ctx('drv1'), photos.start);
  assert.equal(mine.status, 200);
  assert.equal(mine.headers.get('content-type'), 'image/jpeg');
  assert.equal((await readUpload(ctx('boss'), photos.start)).status, 200);
  assert.equal((await readUpload(ctx('acct', { fleet: { reportsView: true } }), photos.start)).status, 200);
  await rejects(readUpload(ctx('stranger'), photos.start), 403);
  await rejects(readUpload(ctx('drv1'), 'missing-upload'), 404);
  await rejects(saveUpload(ctx('drv1'), (() => {
    const form = new FormData();
    form.append('file', new File(['hello'], 'note.txt', { type: 'text/plain' }));
    form.append('kind', 'odometer');
    return new Request('http://localhost/api/fleet/uploads', { method: 'POST', body: form });
  })()), 400, /JPEG/);
});

/* ── the payment report ───────────────────────────────────────────────── */

const accounts = (now = at(400)) => ctx('acct', { now, fleet: { reportsView: true, reportsGenerate: true } });

test('the October report pays settled trips, holds those waiting, and lists reimbursements', async () => {
  await rejects(generateReportFor(ctx('stranger'), { monthKey: '2026-10' }), 403);
  const { report } = await generateReportFor(accounts(), { monthKey: '2026-10' });
  assert.equal(report.id, '2026-10');
  assert.equal(report.status, 'draft');
  for (const trip of [trips.a, trips.b, trips.c, trips.v4a, trips.emergency, trips.forced]) assert.ok(report.tripIds.includes(trip.id), trip.id);
  assert.ok(!report.tripIds.includes(trips.overCap.id));
  assert.equal(report.totals.heldTrips, 2);
  assert.deepEqual(report.reportC.filter((row) => row.held).map((row) => row.tripId).sort(), [trips.forcedPending.id, trips.overCap.id].sort());
  // v1: trips a (10 km) and the emergency (5 km) at ₹5.
  const v1 = report.reportB.find((row) => row.vehicleId === 'v1');
  assert.equal(v1.km, 15);
  assert.equal(v1.cost, 75);
  const v5 = report.reportB.find((row) => row.vehicleId === 'v5');
  assert.equal(v5.fuelAmount, 2550);
  assert.deepEqual(report.reportD.map((row) => [row.driverUserId, row.driverPaid]), [['drv1', 2550]]);
  assert.equal(report.totals.reimbursements, 2550);
  assert.equal(report.version, 1);
  for (const path of Object.values(report.files)) assert.ok(globalThis.__bucket.files.has(path), path);

  const xlsx = await reportFile(accounts(), '2026-10', 'xlsx');
  assert.equal(Buffer.from(await xlsx.arrayBuffer()).subarray(0, 2).toString(), 'PK');
  const pdf = await reportFile(accounts(), '2026-10', 'pdf');
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
  await rejects(reportFile(accounts(), '2026-10', 'exe'), 404);

  const again = await generateReportFor(accounts(), { monthKey: '2026-10' });
  assert.equal(again.report.version, 2);
  assert.equal((await listReports(accounts())).length, 1);
  await rejects(generateReportFor(accounts(), { monthKey: '2026-12' }), 400, /not started/);
});

test('approving locks the report and marks what it paid; a late review is carried, never paid twice', async () => {
  await rejects(approveReport(accounts(), '2026-10'), 403);
  const approver = ctx('acct', { now: at(410), fleet: { reportsView: true, reportsGenerate: true, reportsApprove: true } });
  const { report } = await approveReport(approver, '2026-10');
  assert.equal(report.status, 'approved');
  assert.equal(db.read('vehicleManagementTrips', trips.a.id).reportedIn, '2026-10');
  assert.equal(db.read('vehicleManagementTrips', trips.overCap.id).reportedIn, null);
  await rejects(generateReportFor(approver, { monthKey: '2026-10' }), 409, /locked/);

  // Points arriving now do not change a trip a report has paid.
  await addPoints(ctx('drv1', { now: at(420) }), trips.a.id, { points: track('a', 1, 3, 0, 11) });
  assert.equal(db.read('vehicleManagementTrips', trips.a.id).billableDistanceKm, 10);

  // The over-cap trip is settled after October was approved…
  const reviewed = (await reviewTrip(ctx('boss', { now: at(430) }), trips.overCap.id, { choice: 'odometer', note: 'Approved extra run on site' })).trip;
  assert.equal(reviewed.billableDistanceKm, 90);
  // …and November's report carries it, alone.
  const november = (await generateReport({ id: 'acct', name: 'Accounts', organizationId: 'default', now: at(440) }, { monthKey: '2026-11', email: false })).report;
  assert.deepEqual(november.tripIds, [trips.overCap.id]);
  const row = november.reportA.find((entry) => entry.trips === 1);
  assert.equal(row.carriedTrips, 1);
  assert.equal(row.perKmCost, 450);
  assert.equal(november.totals.reimbursements, 0);
});

test('a custom period is a preview: emailed with its files, never approved', async () => {
  const before = (globalThis.__emails ?? []).length;
  const { report } = await generateReportFor(accounts(at(450)), { from: '2026-10-01', to: '2026-10-31', email: true });
  assert.equal(report.id, 'custom_2026-10-01_2026-10-31');
  assert.equal(report.monthKey, null);
  // October's paid trips are already reported, so only the carried review appears.
  assert.deepEqual(report.tripIds, [trips.overCap.id]);
  const email = globalThis.__emails.at(-1);
  assert.equal(globalThis.__emails.length, before + 1);
  assert.deepEqual(email.to, ['accounts@example.com']);
  assert.equal(email.attachments.length, 2);
  assert.deepEqual(report.emailedTo, ['accounts@example.com']);
  const approver = ctx('acct', { now: at(451), fleet: { reportsView: true, reportsApprove: true } });
  await rejects(approveReport(approver, report.id), 400, /preview/);
  assert.equal((await getReport(approver, report.id)).status, 'draft');
});

test('nothing is left running and no vehicle is left locked', async () => {
  forgetVehicles();
  for (const id of ['v1', 'v2', 'v3', 'v4', 'v5']) assert.ok(!db.read('vehicleManagementVehicles', id).currentTripId, id);
  assert.equal((await runningTrips()).length, 0);
});

/* ── trips recorded before SEL Fleet (the Fleet Trips register) ────────── */

test('pre-fleet trips are read-only history for those who see every trip', async () => {
  // The retired browser tracker's shape: no `fleet` marker, no dateKey, a Timestamp createdAt.
  db.seed('vehicleManagementTrips', 'legacy1', {
    tripStatus: 'Completed',
    vehicleId: 'v1',
    vehicleNumber: 'OD02AB0001',
    driverId: 'd1',
    driverName: 'Ravi K',
    linkedUserId: 'drv1',
    startTimeIso: '2026-10-20T05:00:00.000Z',
    endTimeIso: '2026-10-20T06:10:00.000Z',
    startAddress: 'Old office',
    endAddress: 'Old site',
    totalDistanceKm: 12.3,
    totalPoints: 40,
    createdAt: { seconds: 1_792_472_400 },
  });
  db.seed('vehicleManagementTripLocations', 'legacy1-p1', { tripId: 'legacy1', driverId: 'd1', lat: 20.3, lng: 85.8, accuracyMeters: 9, recordedAtIso: '2026-10-20T05:01:00.000Z' });

  const viewer = ctx('acct', { fleet: { viewAll: true } });
  const listed = await listTrips(viewer, { from: '2026-10-01', to: TODAY, includeLegacy: true });
  const legacy = listed.find((trip) => trip.id === 'legacy1');
  assert.ok(legacy, 'the legacy trip is listed');
  assert.equal(legacy.legacy, true);
  assert.equal(legacy.status, 'completed');
  assert.equal(legacy.dateKey, '2026-10-20');
  assert.equal(legacy.startPlace, 'Old office');
  assert.equal(legacy.endPlace, 'Old site');
  assert.equal(legacy.gpsDistanceKm, 12.3);
  assert.equal(legacy.pointCount, 40);
  assert.equal(legacy.billableDistanceKm, null);
  assert.deepEqual(legacy.flagCodes, []);
  // Fleet trips are still there, once each, and unmarked.
  assert.ok(listed.some((trip) => !trip.legacy));
  assert.equal(new Set(listed.map((trip) => trip.id)).size, listed.length);

  // Only when asked for, and only inside the period.
  assert.ok(!(await listTrips(viewer, { from: '2026-10-01', to: TODAY })).some((trip) => trip.id === 'legacy1'));
  assert.ok(!(await listTrips(viewer, { from: '2026-10-21', to: TODAY, includeLegacy: true })).some((trip) => trip.id === 'legacy1'));

  // A driver (or a manager without the grant) never gets them, even asking.
  assert.ok(!(await listTrips(ctx('drv1'), { from: '2026-10-01', to: TODAY, includeLegacy: true })).some((trip) => trip.legacy));
  assert.ok(!(await listTrips(ctx('mgr'), { from: '2026-10-01', to: TODAY, includeLegacy: true })).some((trip) => trip.legacy));
  assert.ok(!(await listMyTrips(ctx('drv1'))).some((trip) => trip.id === 'legacy1'));
});

test('a pre-fleet trip opens with its route and nothing to act on, for viewers only', async () => {
  const detail = await tripDetail(ctx('acct', { fleet: { viewAll: true } }), 'legacy1');
  assert.equal(detail.trip.legacy, true);
  assert.deepEqual(detail.abilities, { end: false, pause: false, resume: false, cancel: false, review: false, forceClose: false, resolve: false });
  assert.equal(detail.points.length, 1);
  assert.deepEqual(detail.photos, { start: null, end: null });
  await rejects(tripDetail(ctx('drv1'), 'legacy1'), 404, /not found/);
  await rejects(tripDetail(ctx('mgr'), 'legacy1'), 404, /not found/);
});

test('nothing changes a pre-fleet trip', async () => {
  const manager = ctx('mgr', { fleet: { review: true, forceClose: true, viewAll: true } });
  await rejects(endTrip(ctx('drv1'), 'legacy1', { clientEndId: cid('end'), endOdometer: { km: 10, uploadId: null }, position: null, remark: '' }), 404, /not found/);
  await rejects(addPoints(ctx('drv1'), 'legacy1', { points: track('legacy', 1, 1, 0) }), 404, /not found/);
  await rejects(changeTrip(ctx('drv1'), 'legacy1', { action: 'pause' }), 404, /not found/);
  await rejects(reviewTrip(manager, 'legacy1', { choice: 'gps', note: 'x' }), 404, /not found/);
  await rejects(forceCloseTrip(manager, 'legacy1', { reason: 'Closing an old trip' }), 404, /not found/);
  await rejects(resolveTripException(manager, { kind: 'trip', id: 'legacy1', note: 'Looked at it' }), 404, /not found/);
  assert.equal(db.read('vehicleManagementTrips', 'legacy1').tripStatus, 'Completed');
  assert.equal(db.read('vehicleManagementTrips', 'legacy1').fleet, undefined);
});
