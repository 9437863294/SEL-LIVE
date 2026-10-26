/**
 * SEL Fleet — the scheduled jobs (src/lib/fleet/server/jobs.ts) and their cron route, run against
 * the in-memory Firestore and Storage (helpers/server-module-hooks.mjs).
 *
 * Run: node --experimental-strip-types --no-warnings --import ./tests/helpers/server-module-hooks.mjs --test tests/fleet-jobs.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { FakeFirestore } from './helpers/fake-firestore.mjs';

globalThis.__db = new FakeFirestore();

const jobs = await import('../src/lib/fleet/server/jobs.ts');
const lookups = await import('../src/lib/fleet/server/lookups.ts');
const cron = await import('../src/app/api/fleet/cron/[job]/route.ts');

const runAfter = async () => {
  const tasks = (globalThis.__after ?? []).splice(0);
  await Promise.all(tasks.map((task) => task()));
};

/** A fresh database with the people, settings and vehicles every test starts from. */
function fresh() {
  globalThis.__db = new FakeFirestore();
  globalThis.__notices = [];
  globalThis.__emails = [];
  globalThis.__logs = [];
  globalThis.__after = [];
  globalThis.__sentKeys = new Set();
  globalThis.__bucket = undefined;
  lookups.forgetVehicles();
  lookups.forgetGeofences();
  lookups.forgetPurposes();
  lookups.forgetProjects();
  lookups.forgetFleetSettings('default');
  const db = globalThis.__db;
  for (const [id, name] of [['drv', 'Ravi'], ['drv2', 'Sita'], ['boss', 'Boss'], ['backup', 'Backup'], ['admin', 'Fleet Admin'], ['digest', 'Digest Reader']]) {
    db.seed('users', id, { name, email: `${id}@example.com`, status: 'Active' });
  }
  db.seed('fleetSettings', 'default', { escalationUserIds: ['admin'], digestUserIds: ['digest'], reportEmails: ['accounts@example.com'] });
  const vehicle = { vehicleType: 'Two Wheeler', vehicleStatus: 'Active', currentOdometerKm: 12000, approverUid: 'boss', backupApproverUid: 'backup', ratePerKm: 9 };
  db.seed('vehicleManagementVehicles', 'v1', { ...vehicle, vehicleNumber: 'OD02AB0001' });
  db.seed('vehicleManagementVehicles', 'v2', { ...vehicle, vehicleNumber: 'OD02AB0002' });
  db.seed('vehicleManagementVehicles', 'v3', { ...vehicle, vehicleNumber: 'OD02AB0003' });
  db.seed('vehicleManagementVehicles', 'v4', { ...vehicle, vehicleNumber: 'OD02AB0004' });
  return db;
}

const trip = (over = {}) => ({
  fleet: true,
  fleetVersion: 1,
  organizationId: 'default',
  status: 'running',
  vehicleId: 'v1',
  vehicleNumber: 'OD02AB0001',
  vehicleCategory: 'bike',
  driverUserId: 'drv',
  driverId: null,
  driverName: 'Ravi',
  dateKey: '2026-10-25',
  monthKey: '2026-10',
  startedAt: '2026-10-25T04:00:00.000Z',
  endedAt: null,
  startOdometer: { km: 12000, photoPath: null, ocrKm: null, ocrRaw: null, at: '2026-10-25T04:00:00.000Z' },
  endOdometer: null,
  gpsDistanceKm: 0,
  odoDistanceKm: null,
  billableDistanceKm: null,
  kmByDate: {},
  gpsKmByDate: {},
  pointCount: 0,
  lastPointAt: null,
  flagCodes: [],
  flagged: false,
  exceptionStatus: 'none',
  managerIds: ['boss', 'backup'],
  pauses: [],
  reportedIn: null,
  approvalId: null,
  approvedKmCap: null,
  clientStartId: 'start-0001',
  ...over,
});

const point = (tripId, index, iso, lat) => [`${tripId}_pt${index}`, { tripId, fleet: true, lat, lng: 85.8, accuracyMeters: 10, speedKmph: 30, headingDeg: 0, recordedAtIso: iso }];

/* ── approvals ─────────────────────────────────────────────────────────── */

test('the approvals job moves an undecided request up the chain, then expires it', async () => {
  const db = fresh();
  db.seed('fleetApprovals', 'a1', {
    organizationId: 'default',
    status: 'pending',
    vehicleId: 'v1',
    vehicleNumber: 'OD02AB0001',
    driverUserId: 'drv',
    driverName: 'Ravi',
    dateKey: '2026-10-25',
    usedKm: 70,
    limitKm: 80,
    requestedKm: 40,
    reason: 'Material run',
    purposeName: 'Material delivery',
    projectName: '',
    level: 1,
    assigneeIds: ['boss'],
    notifiedIds: ['boss'],
    escalateAt: '2026-10-25T04:30:00.000Z',
    expiresAt: '2026-10-25T06:00:00.000Z',
    history: [],
    createdAt: '2026-10-25T04:00:00.000Z',
    updatedAt: '2026-10-25T04:00:00.000Z',
  });
  assert.deepEqual(await jobs.approvalsJob('2026-10-25T04:10:00.000Z'), { pending: 1, escalated: 0, expired: 0 });
  assert.deepEqual(await jobs.approvalsJob('2026-10-25T04:31:00.000Z'), { pending: 1, escalated: 1, expired: 0 });
  assert.equal(db.read('fleetApprovals', 'a1').level, 2);
  assert.deepEqual(db.read('fleetApprovals', 'a1').notifiedIds, ['boss', 'backup']);
  assert.deepEqual(globalThis.__notices.map((notice) => notice.userIds), [['backup']]);

  assert.equal((await jobs.approvalsJob('2026-10-25T06:01:00.000Z')).expired, 1);
  assert.equal(db.read('fleetApprovals', 'a1').status, 'expired');
  assert.deepEqual(globalThis.__notices.at(-1).userIds, ['drv']);
});

/* ── idle ──────────────────────────────────────────────────────────────── */

test('idle: a quiet trip is reminded once an hour; a silent or endless one is closed for review', async () => {
  const db = fresh();
  const now = '2026-10-25T08:00:00.000Z';
  db.seed('vehicleManagementTrips', 'tA', trip({ lastPointAt: '2026-10-25T07:10:00.000Z' }));
  db.seed('vehicleManagementTrips', 'tB', trip({ vehicleId: 'v2', vehicleNumber: 'OD02AB0002', driverUserId: 'drv2', driverName: 'Sita', lastPointAt: '2026-10-25T04:30:00.000Z', clientStartId: 'start-0002' }));
  db.seed('vehicleManagementTrips', 'tC', trip({ vehicleId: 'v3', vehicleNumber: 'OD02AB0003', driverUserId: 'drv3', startedAt: '2026-10-24T19:00:00.000Z', dateKey: '2026-10-25', lastPointAt: '2026-10-25T07:55:00.000Z', clientStartId: 'start-0003' }));
  db.seed('vehicleManagementTrips', 'tD', trip({ vehicleId: 'v4', vehicleNumber: 'OD02AB0004', driverUserId: 'drv4', status: 'paused', pausedAt: '2026-10-25T05:00:00.000Z', lastPointAt: '2026-10-25T04:59:00.000Z', pauses: [{ from: '2026-10-25T05:00:00.000Z', to: null }], clientStartId: 'start-0004' }));
  db.seed('vehicleManagementVehicles', 'v2', { ...db.read('vehicleManagementVehicles', 'v2'), currentTripId: 'tB' });

  const first = await jobs.idleJob(now);
  await runAfter();
  assert.deepEqual(first, { open: 4, reminded: 2, closed: 2, failed: 0 });

  const silent = db.read('vehicleManagementTrips', 'tB');
  assert.equal(silent.status, 'pending_review');
  assert.equal(silent.endedBy, 'auto_idle');
  assert.ok(silent.flagCodes.includes('auto_closed'));
  assert.equal(silent.endedAt, '2026-10-25T04:30:00.000Z');
  assert.equal(db.read('vehicleManagementVehicles', 'v2').currentTripId, null);

  const endless = db.read('vehicleManagementTrips', 'tC');
  assert.equal(endless.status, 'pending_review');
  assert.equal(endless.endedBy, 'auto_max');

  // The paused trip is quiet for 180 min — reminded, not closed (it closes at twice the silence).
  assert.equal(db.read('vehicleManagementTrips', 'tD').status, 'paused');
  const reminded = globalThis.__notices.filter((notice) => notice.dedupeKey?.startsWith('fleet-idle-')).map((notice) => notice.userIds[0]).sort();
  assert.deepEqual(reminded, ['drv', 'drv4']);
  assert.ok(globalThis.__notices.some((notice) => notice.userIds.includes('drv2') && /was closed/.test(notice.title)));

  // Again within the hour: no second reminder, nothing left to close.
  assert.deepEqual(await jobs.idleJob('2026-10-25T08:15:00.000Z'), { open: 2, reminded: 0, closed: 0, failed: 0 });

  // Paused past twice the auto-close silence: closed too.
  assert.equal((await jobs.idleJob('2026-10-25T11:01:00.000Z')).closed, 2);
  assert.equal(db.read('vehicleManagementTrips', 'tD').status, 'pending_review');
});

/* ── midnight ──────────────────────────────────────────────────────────── */

test('midnight: an open trip gets its km so far split by IST day; a finished one is left alone', async () => {
  const db = fresh();
  db.seed('vehicleManagementTrips', 'tM', trip({ startedAt: '2026-10-24T18:15:00.000Z', dateKey: '2026-10-24', monthKey: '2026-10' }));
  db.seed('vehicleManagementTrips', 'tDone', trip({ vehicleId: 'v2', status: 'completed', billableDistanceKm: 12, kmByDate: { '2026-10-24': 12 }, clientStartId: 'start-0005' }));
  for (const [id, data] of [
    point('tM', 1, '2026-10-24T18:20:00.000Z', 20.0),
    point('tM', 2, '2026-10-24T18:25:00.000Z', 20.01),
    point('tM', 3, '2026-10-24T18:35:00.000Z', 20.02),
    point('tM', 4, '2026-10-24T18:40:00.000Z', 20.03),
  ]) {
    db.seed('vehicleManagementTripLocations', id, data);
  }
  assert.deepEqual(await jobs.midnightJob('2026-10-24T18:40:00.000Z'), { open: 1, measured: 1 });
  const measured = db.read('vehicleManagementTrips', 'tM');
  assert.deepEqual(Object.keys(measured.kmByDate).sort(), ['2026-10-24', '2026-10-25']);
  assert.ok(measured.gpsDistanceKm > 3 && measured.gpsDistanceKm < 3.6, String(measured.gpsDistanceKm));
  assert.deepEqual(measured.gpsKmByDate, measured.kmByDate);
  assert.deepEqual(db.read('vehicleManagementTrips', 'tDone').kmByDate, { '2026-10-24': 12 });
});

/* ── daily summary ─────────────────────────────────────────────────────── */

test("the daily summary records yesterday's km, the limit overrun and fuel per vehicle", async () => {
  const db = fresh();
  db.seed('vehicleManagementTrips', 't1', trip({ status: 'completed', billableDistanceKm: 50, kmByDate: { '2026-10-25': 50 }, flagged: true, flagCodes: ['gps_gap'] }));
  db.seed('vehicleManagementTrips', 't2', trip({ status: 'completed', billableDistanceKm: 40, kmByDate: { '2026-10-25': 40 }, clientStartId: 'start-0006' }));
  db.seed('vehicleManagementTrips', 't3', trip({ status: 'cancelled', gpsDistanceKm: 9, clientStartId: 'start-0007' }));
  db.seed('vehicleManagementFuelLogs', 'f1', { vehicleId: 'v3', vehicleNumber: 'OD02AB0003', fuelDate: '2026-10-25', quantityLiters: 3, totalAmount: 315 });

  // 00:30 IST on the 26th.
  const result = await jobs.dailySummaryJob('2026-10-25T19:00:00.000Z');
  assert.deepEqual(result, { dateKey: '2026-10-25', vehicles: 2, km: 90 });
  const v1 = db.read('fleetDailySummary', 'v1_2026-10-25');
  assert.equal(v1.tripCount, 2);
  assert.equal(v1.km, 90);
  assert.equal(v1.limitKm, 80);
  assert.equal(v1.overLimitKm, 10);
  assert.equal(v1.flaggedTrips, 1);
  const v3 = db.read('fleetDailySummary', 'v3_2026-10-25');
  assert.equal(v3.tripCount, 0);
  assert.equal(v3.fuelLitres, 3);
  assert.equal(v3.fuelAmount, 315);
});

/* ── digest ────────────────────────────────────────────────────────────── */

test('the digest goes once a day, by push and email, to the digest and escalation lists', async () => {
  const db = fresh();
  db.seed('vehicleManagementTrips', 't1', trip({ status: 'completed', billableDistanceKm: 95, kmByDate: { '2026-10-25': 95 } }));
  db.seed('vehicleManagementTrips', 't2', trip({ vehicleId: 'v2', status: 'pending_review', exceptionStatus: 'open', gpsDistanceKm: 30, clientStartId: 'start-0008' }));
  db.seed('fleetApprovals', 'a1', { status: 'pending', vehicleId: 'v1', dateKey: '2026-10-26', notifiedIds: ['boss'] });

  const now = '2026-10-26T02:30:00.000Z';
  const sent = await jobs.digestJob(now);
  assert.equal(sent.sent, true);
  assert.equal(sent.trips, 2);
  assert.equal(sent.overLimit, 1);
  assert.equal(sent.pendingApprovals, 1);
  assert.equal(sent.reviews, 1);
  const notice = globalThis.__notices.find((entry) => entry.dedupeKey === 'fleet-digest-default-2026-10-25');
  assert.deepEqual([...notice.userIds].sort(), ['admin', 'digest']);
  assert.match(notice.body, /OD02AB0001/);
  assert.equal(globalThis.__emails.length, 1);
  assert.deepEqual([...globalThis.__emails[0].to].sort(), ['admin@example.com', 'digest@example.com']);

  assert.deepEqual(await jobs.digestJob(now), { dateKey: '2026-10-25', sent: false, reason: 'Already sent.' });
  assert.equal(globalThis.__emails.length, 1);
});

/* ── service due ───────────────────────────────────────────────────────── */

test('service due is told once per service interval', async () => {
  const db = fresh();
  db.seed('vehicleManagementVehicles', 'v1', { ...db.read('vehicleManagementVehicles', 'v1'), lastServiceKm: 7100, lastServiceDate: '2026-06-01' });
  db.seed('vehicleManagementVehicles', 'v2', { ...db.read('vehicleManagementVehicles', 'v2'), lastServiceKm: 11000 });
  const first = await jobs.serviceDueJob('2026-10-25T01:30:00.000Z');
  assert.deepEqual(first, { vehicles: 4, due: 1, notified: 1 });
  const notice = globalThis.__notices.at(-1);
  assert.match(notice.title, /OD02AB0001 is due for service in 100 km/);
  assert.deepEqual([...notice.userIds].sort(), ['backup', 'boss', 'digest']);
  assert.equal((await jobs.serviceDueJob('2026-10-26T01:30:00.000Z')).notified, 0);
});

/* ── monthly report ────────────────────────────────────────────────────── */

test("on the 1st, last month's payment report is generated, stored and emailed — once", async () => {
  const db = fresh();
  db.seed('vehicleManagementTrips', 't1', trip({ status: 'completed', billableDistanceKm: 20, kmByDate: { '2026-10-25': 20 }, projectId: null, costSnapshot: { basis: 'per_km', ratePerKm: 9, amount: 180 } }));

  assert.equal((await jobs.monthlyReportCronJob('2026-11-10T00:30:00.000Z')).skipped, true);

  const result = await jobs.monthlyReportCronJob('2026-11-01T00:30:00.000Z');
  assert.equal(result.monthKey, '2026-10');
  assert.equal(result.skipped, false);
  const report = db.read('fleetPaymentReports', '2026-10');
  assert.equal(report.totals.trips, 1);
  assert.equal(report.totals.payable, 180);
  assert.equal(report.generatedByName, 'Scheduled');
  assert.equal(globalThis.__bucket.files.size, 3);
  assert.deepEqual(globalThis.__emails.at(-1).to, ['accounts@example.com']);
  assert.deepEqual(report.emailedTo, ['accounts@example.com']);

  assert.deepEqual(await jobs.monthlyReportCronJob('2026-11-02T00:30:00.000Z'), { monthKey: '2026-10', skipped: true });
});

/* ── the cron route ────────────────────────────────────────────────────── */

test('the cron route fails closed, checks the secret and knows its jobs', async () => {
  fresh();
  const call = (job, authorization) => cron.GET(new Request(`http://local/api/fleet/cron/${job}`, { headers: authorization ? { authorization } : {} }), { params: Promise.resolve({ job }) });
  const previous = process.env.CRON_SECRET;
  try {
    delete process.env.CRON_SECRET;
    assert.equal((await call('approvals', 'Bearer x')).status, 503);
    process.env.CRON_SECRET = 'test-secret';
    assert.equal((await call('approvals', 'Bearer wrong')).status, 401);
    assert.equal((await call('constructor', 'Bearer test-secret')).status, 404);
    const ok = await call('approvals', 'Bearer test-secret');
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.job, 'approvals');
    assert.equal(body.pending, 0);
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
});
