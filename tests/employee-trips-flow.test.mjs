/**
 * The trip-claims server end to end — recording, submitting, every workflow action, payment and
 * the settings consequences — run against an in-memory Firestore (helpers/fake-firestore.mjs).
 * Run with the server-module hooks: `npm run test:driver-management`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { FakeFirestore } from './helpers/fake-firestore.mjs';

globalThis.__db = new FakeFirestore();
const db = globalThis.__db;

const { saveTrip, deleteTrip } = await import('../src/lib/employee-trips/server/trips.ts');
const { submitClaims, actOnClaim, payClaims, getClaim, listClaims } = await import('../src/lib/employee-trips/server/claims.ts');
const { saveSettings } = await import('../src/lib/employee-trips/server/settings.ts');
const { dashboard, bootstrap } = await import('../src/lib/employee-trips/server/overview.ts');
const { resolveTripAccess } = await import('../src/lib/employee-trips/access.ts');
const { indiaToday, financialYearOf, ET_COLLECTIONS } = await import('../src/lib/employee-trips/types.ts');
const { forgetFleetSettings } = await import('../src/lib/fleet/server/lookups.ts');
const { forgetSettings } = await import('../src/lib/employee-trips/server/lookups.ts');

const today = indiaToday();
const daysAgo = (days) => {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
};
const fy = financialYearOf(today);

const context = (userId, permissions = {}) => ({
  userId,
  userName: db.read('users', userId)?.name ?? userId,
  userEmail: `${userId}@example.com`,
  organizationId: 'default',
  trip: resolveTripAccess(permissions),
  today,
});

const runAfter = async () => {
  const tasks = (globalThis.__after ?? []).splice(0);
  await Promise.all(tasks.map((task) => task()));
};
const takeNotices = async () => {
  await runAfter();
  return (globalThis.__notices ?? []).splice(0);
};
/** Expects a refusal with the HTTP status the route would answer (tripRoute maps DecisionError and zod issues to 400). */
const rejects = async (promise, status, pattern) => {
  await assert.rejects(promise, (error) => {
    const answered = error.status ?? (error.name === 'DecisionError' || Array.isArray(error.issues) ? 400 : undefined);
    assert.equal(answered, status, `expected ${status}, got ${answered}: ${error.message}`);
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
};

/* ── seed ─────────────────────────────────────────────────────────────── */

for (const [id, name, employeeId] of [['emp1', 'Asha'], ['emp2', 'Ravi', 'E2'], ['emp3', 'Meena'], ['appr1', 'Verifier One'], ['appr2', 'Verifier Two'], ['dir1', 'Director'], ['mgr9', 'Site Manager', 'E9'], ['hr', 'HR Desk'], ['pay1', 'Accounts'], ['admin', 'Admin']]) {
  db.seed('users', id, { name, email: `${id}@example.com`, status: 'Active', ...(employeeId ? { employeeId } : {}) });
}
// The reporting line, as the organisation records it: Asha's manager set on her login in Access
// Management; Ravi's manager in greytHR's org tree (employee E2 reports to E9, whose login is mgr9).
db.seed('accessGrants', 'emp1', { reportingManagerId: 'dir1' });
db.seed('employees', 'E2', { reportingManagerEmployeeId: 'E9', reportingManagerName: 'Site Manager' });
db.seed('projects', 'p1', { projectName: 'Site A' });
db.seed('projects', 'p2', { projectName: 'Site B' });
db.seed('departments', 'd1', { name: 'Civil' });
db.seed('vehicleManagementVehicles', 'v1', { vehicleNumber: 'OD 02 X 9', vehicleType: 'Two Wheeler', fuelType: 'Petrol', vehicleStatus: 'Active' });
db.seed('vehicleManagementVehicles', 'v9', { vehicleNumber: 'OD 02 OLD 1', vehicleType: 'Car', vehicleStatus: 'Sold' });
// Company-vehicle trips stay on claims for these tests; the last test turns fleet routing (D1) on.
db.seed('fleetSettings', 'default', { companyTripsInFleet: false });
// Most tests type trips in; the GPS-only rule (the default) has its own test below.
db.seed(ET_COLLECTIONS.settings, 'default', {
  rules: { allowTypedTrips: true },
  rateRevisions: [
    { id: 'r1', effectiveFrom: daysAgo(200), rates: [{ vehicleType: 'Two Wheeler', own: 4, company: null }, { vehicleType: 'Car', own: 10, company: 2 }] },
    { id: 'r2', effectiveFrom: daysAgo(10), rates: [{ vehicleType: 'Two Wheeler', own: 4.5, company: null }, { vehicleType: 'Car', own: 10, company: 2 }] },
  ],
  stages: [
    { id: 'verify', name: 'Verification', kind: 'approval', routing: 'users', userIds: ['appr1'], routes: [] },
    { id: 'director', name: 'Director', kind: 'approval', routing: 'users', userIds: ['dir1'], routes: [], minAmount: 500 },
    { id: 'payment', name: 'Accounts', kind: 'payment', routing: 'users', userIds: ['pay1'], routes: [] },
  ],
});

const ownTrip = (extra = {}) => ({ tripDate: daysAgo(3), ownership: 'own', vehicleType: 'Two Wheeler', vehicleNumber: 'OD02AB1234', fromPlace: 'Office', toPlace: 'Site A', purpose: 'Inspection', startOdometer: 1000, endOdometer: 1024.5, parkingAmount: 10, ...extra });

const ids = {};

/* ── recording ────────────────────────────────────────────────────────── */

test('recording prices each trip by the rate on its date, server-side', async () => {
  const one = (await saveTrip(context('emp1'), ownTrip({ distanceKm: 999, totalAmount: 1 }))).trip;
  assert.equal(one.distanceKm, 24.5);
  assert.equal(one.ratePerKm, 4.5);
  assert.equal(one.totalAmount, 120.25, '24.5 km × ₹4.5 + ₹10 parking; the client figures are ignored');
  assert.deepEqual(one.flags, []);
  ids.t1 = one.id;

  const company = (await saveTrip(context('emp1'), { tripDate: daysAgo(2), ownership: 'company', vehicleId: 'v1', vehicleType: 'Car', vehicleNumber: 'X', fromPlace: 'Office', toPlace: 'Bank', purpose: 'Bank work', startOdometer: 1500, endOdometer: 1530, tollAmount: 20 })).trip;
  assert.equal(company.vehicleType, 'Two Wheeler');
  assert.equal(company.vehicleNumber, 'OD02X9');
  assert.deepEqual(company.flags, ['no_rate']);
  assert.equal(company.totalAmount, 20, 'no company rate for a two-wheeler: only the toll');
  assert.equal(db.read(ET_COLLECTIONS.counters, 'default_odometer').readings.v1.km, 1530);
  ids.t2 = company.id;

  const older = (await saveTrip(context('emp1'), ownTrip({ tripDate: daysAgo(30), startOdometer: 2000, endOdometer: 2010, parkingAmount: 0 }))).trip;
  assert.equal(older.totalAmount, 40, 'priced by the earlier rate card (₹4/km)');
  ids.t3 = older.id;
});

test('recording refuses what the rules forbid, field by field', async () => {
  await rejects(saveTrip(context('emp1'), ownTrip({ tripDate: daysAgo(-1) })), 400, /highlighted/);
  try {
    await saveTrip(context('emp1'), ownTrip({ tripDate: daysAgo(-1), endOdometer: 900 }));
  } catch (error) {
    assert.match(error.details.fields.tripDate, /future/);
    assert.match(error.details.fields.endOdometer, /higher/);
  }
  await rejects(saveTrip(context('emp1'), { ...ownTrip(), ownership: 'company', vehicleId: 'v9' }), 400);
  await rejects(saveTrip(context('emp2'), ownTrip(), ids.t1), 404, /among yours/);
  await rejects(deleteTrip(context('emp2'), ids.t1), 403);
});

test('bootstrap offers active vehicles only and tells nobody about workflow they are not on', async () => {
  const boot = await bootstrap(context('emp1'));
  assert.deepEqual(boot.vehicles.map((vehicle) => vehicle.id), ['v1']);
  assert.deepEqual(boot.named, { approval: false, payment: false });
  assert.equal(boot.odometer.v1.km, 1530);
  const verifier = await bootstrap(context('appr1'));
  assert.deepEqual(verifier.named, { approval: true, payment: false });
});

/* ── submission and approval ──────────────────────────────────────────── */

test('submitting freezes the trips on a numbered claim routed to the first stage', async () => {
  const { claims } = await submitClaims(context('emp1'), { tripIds: [ids.t1, ids.t2, ids.t3], remarks: 'October', declaration: true });
  assert.equal(claims.length, 1);
  assert.equal(claims[0].claimNumber, `TC-${fy}-0001`);
  assert.equal(claims[0].amount, 180.25);
  ids.c1 = claims[0].id;

  const claim = db.read(ET_COLLECTIONS.claims, ids.c1);
  assert.deepEqual(claim.stages.map((stage) => stage.id), ['verify', 'payment'], 'below ₹500: no director');
  assert.deepEqual(claim.currentAssigneeIds, ['appr1']);
  assert.equal(db.read(ET_COLLECTIONS.trips, ids.t1).status, 'submitted');

  const notices = await takeNotices();
  assert.deepEqual(notices.map((notice) => notice.userIds), [['appr1']]);
  assert.match(notices[0].title, /needs your approval/);
  assert.equal(notices[0].link, `/driver-management/claims/${ids.c1}`);
});

test('submitted trips are locked, and cannot be claimed twice', async () => {
  await rejects(saveTrip(context('emp1'), ownTrip(), ids.t1), 409);
  await rejects(deleteTrip(context('emp1'), ids.t1), 409);
  await rejects(submitClaims(context('emp1'), { tripIds: [ids.t1], declaration: true }), 409);
  await assert.rejects(submitClaims(context('emp1'), { tripIds: [ids.t1], declaration: false }));
});

test('only the claimant, the workflow and wider grants can open a claim', async () => {
  await rejects(getClaim(context('emp2'), ids.c1), 403);
  assert.equal((await getClaim(context('appr1'), ids.c1)).abilities.decide, true);
  assert.equal((await getClaim(context('pay1'), ids.c1)).abilities.pay, false);
  assert.equal((await getClaim(context('emp2', { 'Driver Management.Trip Claims': ['View All'] }), ids.c1)).abilities.decide, false);
  assert.equal((await listClaims(context('appr1'), 'inbox')).claims.length, 1);
  await rejects(actOnClaim(context('pay1'), ids.c1, { action: 'approve', decisions: [] }), 403);
  await rejects(actOnClaim(context('emp1'), ids.c1, { action: 'approve', decisions: [] }), 403);
});

test('the approver cuts one trip, sends one back and approves the rest', async () => {
  await rejects(actOnClaim(context('appr1'), ids.c1, { action: 'approve', decisions: [{ tripId: ids.t1, decision: 'adjust', approvedKm: 30, remarks: 'x' }] }), 400, /below 24.5 km/);
  const { claim } = await actOnClaim(context('appr1'), ids.c1, {
    action: 'approve',
    remarks: 'Checked',
    decisions: [
      { tripId: ids.t1, decision: 'adjust', approvedKm: 20, remarks: 'Map shows 20 km' },
      { tripId: ids.t2, decision: 'return', remarks: 'Use the right vehicle' },
    ],
  });
  assert.equal(claim.status, 'approved');
  assert.equal(claim.currentStageIndex, 1);
  assert.deepEqual(claim.currentAssigneeIds, ['pay1']);
  assert.deepEqual(claim.tripIds.sort(), [ids.t1, ids.t3].sort());
  assert.equal(claim.totals.approvedAmount, 140, '20 × 4.5 + 10 parking, plus 40');
  assert.equal(claim.history.at(-1).lineSummary, '1 cut, 1 sent back');

  const cut = db.read(ET_COLLECTIONS.trips, ids.t1);
  assert.equal(cut.status, 'approved');
  assert.equal(cut.totalAmount, 120.25, 'the claimed figure is never overwritten');
  assert.equal(cut.decision.approvedAmount, 100);
  const back = db.read(ET_COLLECTIONS.trips, ids.t2);
  assert.equal(back.status, 'draft');
  assert.equal(back.claimId, null);
  assert.equal(back.returnNote.remarks, 'Use the right vehicle');
  assert.deepEqual(back.previousClaims, [`TC-${fy}-0001`]);

  const notices = await takeNotices();
  assert.deepEqual(notices.map((notice) => notice.userIds).sort(), [['emp1'], ['pay1']]);
  await rejects(actOnClaim(context('emp1'), ids.c1, { action: 'withdraw' }), 403, /untouched/);
});

test('the payer records the payment; a bank transfer needs its reference', async () => {
  const missing = await payClaims(context('pay1'), { claimIds: [ids.c1], payment: { paidOn: today, mode: 'NEFT', reference: '' } });
  assert.equal(missing.paid.length, 0);
  assert.match(missing.failed[0].error, /reference/);
  const paid = await payClaims(context('pay1'), { claimIds: [ids.c1, 'nope'], payment: { paidOn: today, mode: 'NEFT', reference: 'UTR123', remarks: 'Batch 1' } });
  assert.deepEqual(paid.paid.map((entry) => entry.amount), [140]);
  assert.equal(paid.failed.length, 1, 'a missing claim is reported, the rest still paid');
  const claim = db.read(ET_COLLECTIONS.claims, ids.c1);
  assert.equal(claim.status, 'paid');
  assert.deepEqual(claim.currentAssigneeIds, []);
  assert.equal(claim.payment.reference, 'UTR123');
  assert.equal(db.read(ET_COLLECTIONS.trips, ids.t3).status, 'paid');
  const notices = await takeNotices();
  assert.match(notices[0].title, /paid — ₹140/);
  assert.ok((globalThis.__logs ?? []).some((log) => log.action === 'Pay Trip Claim' && log.recordRef === `TC-${fy}-0001`));
});

test('a sent-back trip is corrected and claimed again on a new claim', async () => {
  await saveTrip(context('emp1'), { tripDate: daysAgo(2), ownership: 'own', vehicleType: 'Two Wheeler', vehicleNumber: 'OD02AB1234', fromPlace: 'Office', toPlace: 'Bank', purpose: 'Bank work', startOdometer: 1500, endOdometer: 1530, tollAmount: 20 }, ids.t2);
  const { claims } = await submitClaims(context('emp1'), { tripIds: [ids.t2], declaration: true });
  assert.equal(claims[0].claimNumber, `TC-${fy}-0002`);
  const old = await getClaim(context('emp1'), ids.c1);
  assert.deepEqual(old.returnedTrips.map((trip) => trip.claimNumber), [`TC-${fy}-0002`]);
  ids.c2 = claims[0].id;
  await takeNotices();
});

test('the claimant may withdraw a claim nobody has acted on', async () => {
  const { claim } = await actOnClaim(context('emp1'), ids.c2, { action: 'withdraw', remarks: '' });
  assert.equal(claim.status, 'withdrawn');
  const trip = db.read(ET_COLLECTIONS.trips, ids.t2);
  assert.equal(trip.status, 'draft');
  assert.equal(trip.returnNote, null);
  assert.deepEqual(trip.previousClaims, [`TC-${fy}-0001`, `TC-${fy}-0002`]);
});

test('a large claim goes through the director, who can reject it', async () => {
  const big = (await saveTrip(context('emp2'), { tripDate: daysAgo(1), ownership: 'own', vehicleType: 'Car', vehicleNumber: 'OD05CAR1', fromPlace: 'Office', toPlace: 'Site B', purpose: 'Audit', startOdometer: 0, endOdometer: 60 })).trip;
  assert.equal(big.totalAmount, 600);
  const { claims } = await submitClaims(context('emp2'), { tripIds: [big.id], declaration: true });
  const claimId = claims[0].id;
  assert.deepEqual(db.read(ET_COLLECTIONS.claims, claimId).stages.map((stage) => stage.id), ['verify', 'director', 'payment']);
  const step = await actOnClaim(context('appr1'), claimId, { action: 'approve', decisions: [] });
  assert.equal(step.claim.status, 'pending');
  assert.deepEqual(step.claim.currentAssigneeIds, ['dir1']);
  await rejects(actOnClaim(context('dir1'), claimId, { action: 'reject', remarks: '' }), 400);
  const rejected = await actOnClaim(context('dir1'), claimId, { action: 'reject', remarks: 'Not official' });
  assert.equal(rejected.claim.status, 'rejected');
  assert.equal(db.read(ET_COLLECTIONS.trips, big.id).status, 'rejected');
  const notices = await takeNotices();
  assert.ok(notices.some((notice) => notice.userIds.includes('emp2') && /rejected/.test(notice.title)));
});

test('nobody approves their own claim; Override acts for the absent, and says so', async () => {
  const own = (await saveTrip(context('appr1'), ownTrip({ vehicleNumber: 'OD02APPR1', startOdometer: 5000, endOdometer: 5010 }))).trip;
  const { claims } = await submitClaims(context('appr1'), { tripIds: [own.id], declaration: true });
  const claim = db.read(ET_COLLECTIONS.claims, claims[0].id);
  assert.deepEqual(claim.currentAssigneeIds, [], 'the verifier is the claimant, so nobody else is named');
  await rejects(actOnClaim(context('appr1', { 'Driver Management.Trip Claims': ['Override Workflow'] }), claims[0].id, { action: 'approve', decisions: [] }), 403);
  const done = await actOnClaim(context('admin', { 'Driver Management.Trip Claims': ['Override Workflow'] }), claims[0].id, { action: 'approve', decisions: [] });
  assert.equal(done.claim.history.at(-1).override, true);
  await takeNotices();
});

/* ── settings ─────────────────────────────────────────────────────────── */

test('settings need Trip Settings · Edit (or the fleet settings grant)', async () => {
  await rejects(saveSettings(context('emp1'), { part: 'rules', rules: { allowOwnVehicle: true, allowCompanyVehicle: true, requireOdometer: true, allowTollParking: true, requireProject: false, maxKmPerTrip: null, maxKmPerDay: null, claimWindowDays: 60 } }), 403);
  await rejects(saveSettings(context('admin', { 'Vehicle Management.Settings': ['Edit'] }), { part: 'stages', stages: [{ id: 'verify', name: 'Verification', kind: 'approval', routing: 'users', userIds: [], routes: [], minAmount: null, tatHours: 48 }, { id: 'payment', name: 'Accounts', kind: 'payment', routing: 'users', userIds: ['pay1'], routes: [], minAmount: null, tatHours: 72 }] }), 400, /Name at least one person/);
});

test('saving the workflow re-routes claims in process and tells the new approver', async () => {
  const trip = (await saveTrip(context('emp2'), ownTrip({ vehicleNumber: 'OD02EMP2', startOdometer: 7000, endOdometer: 7012 }))).trip;
  const { claims } = await submitClaims(context('emp2'), { tripIds: [trip.id], declaration: true });
  await takeNotices();
  const admin = context('admin', { 'Driver Management.Trip Settings': ['Edit'] });
  const result = await saveSettings(admin, {
    part: 'stages',
    stages: [
      { id: 'verify', name: 'Verification', kind: 'approval', routing: 'project', userIds: ['appr2'], routes: [{ key: 'p1', userIds: ['appr1'] }], minAmount: null, tatHours: 48 },
      { id: 'payment', name: 'Accounts', kind: 'payment', routing: 'users', userIds: ['pay1'], routes: [], minAmount: null, tatHours: 72 },
    ],
  });
  assert.ok(result.rerouted >= 1);
  const claim = db.read(ET_COLLECTIONS.claims, claims[0].id);
  assert.deepEqual(claim.currentAssigneeIds, ['appr2'], 'no project on the claim: the fallback people');
  assert.equal(claim.history.at(-1).action, 'rerouted');
  const notices = await takeNotices();
  assert.ok(notices.some((notice) => notice.userIds.includes('appr2') && /reassigned/.test(notice.body)));
});

test('with routing by project, one submission becomes one claim per project', async () => {
  const a = (await saveTrip(context('emp1'), ownTrip({ vehicleNumber: 'OD02P', startOdometer: 100, endOdometer: 110, projectId: 'p1' }))).trip;
  const b = (await saveTrip(context('emp1'), ownTrip({ vehicleNumber: 'OD02P', startOdometer: 110, endOdometer: 125, projectId: 'p2', toPlace: 'Site B' }))).trip;
  const { claims } = await submitClaims(context('emp1'), { tripIds: [a.id, b.id], declaration: true });
  assert.equal(claims.length, 2);
  const byProject = Object.fromEntries(claims.map((entry) => { const claim = db.read(ET_COLLECTIONS.claims, entry.id); return [claim.projectName, claim.currentAssigneeIds]; }));
  assert.deepEqual(byProject, { 'Site A': ['appr1'], 'Site B': ['appr2'] });
  await takeNotices();
});

test('a rate card that priced a claim is locked; a new one re-prices unclaimed trips', async () => {
  const admin = context('admin', { 'Driver Management.Trip Settings': ['Edit'] });
  await rejects(saveSettings(admin, { part: 'rate-revision', revision: { id: 'r2', effectiveFrom: daysAgo(10), rates: [{ vehicleType: 'Two Wheeler', own: 9, company: null }] } }), 409, /cannot change/);
  await rejects(saveSettings(admin, { part: 'delete-rate-revision', revisionId: 'r1' }), 409);
  await rejects(saveSettings(admin, { part: 'rate-revision', revision: { effectiveFrom: daysAgo(10), rates: [{ vehicleType: 'Car', own: 1, company: 1 }] } }), 400, /already exists/);

  const draft = (await saveTrip(context('emp2'), ownTrip({ vehicleNumber: 'OD02NEW', startOdometer: 9000, endOdometer: 9010, parkingAmount: 0 }))).trip;
  assert.equal(draft.totalAmount, 45);
  const saved = await saveSettings(admin, { part: 'rate-revision', revision: { effectiveFrom: daysAgo(5), note: 'Fuel price', rates: [{ vehicleType: 'Two Wheeler', own: 5, company: null }] } });
  assert.ok(saved.repriced >= 1);
  assert.equal(db.read(ET_COLLECTIONS.trips, draft.id).totalAmount, 50, 're-priced at ₹5/km');
  assert.equal(db.read(ET_COLLECTIONS.trips, ids.t1).ratePerKm, 4.5, 'a paid trip keeps its rate');
});

test('the dashboard adds up what each person sees', async () => {
  const mine = await dashboard(context('emp1'));
  assert.equal(mine.personal.paidThisYear.amount, 140);
  assert.ok(mine.personal.unclaimed.trips >= 1);
  assert.equal(mine.workflow, null);
  assert.equal(mine.organisation, null);
  const payer = await dashboard(context('pay1'));
  assert.ok(payer.workflow);
  const all = await dashboard(context('admin', { 'Driver Management.Trip Claims': ['View All'] }));
  assert.equal(all.organisation.paid.amount, 140);
  assert.ok(all.organisation.byProject.length >= 1);
});

/* ── the reporting line ───────────────────────────────────────────────── */

test("each employee's claim goes to their own reporting authority", async () => {
  const admin = context('admin', { 'Driver Management.Trip Settings': ['Edit'] });
  await saveSettings(admin, {
    part: 'stages',
    stages: [
      { id: 'verify', name: 'Reporting Authority Approval', kind: 'approval', routing: 'reporting', userIds: ['hr'], routes: [{ key: 'emp3', userIds: ['admin'] }], minAmount: null, tatHours: 48 },
      { id: 'payment', name: 'Accounts', kind: 'payment', routing: 'users', userIds: ['pay1'], routes: [], minAmount: null, tatHours: 72 },
    ],
  });
  await takeNotices();

  let reading = 20000;
  const claimFor = async (userId) => {
    const trip = (await saveTrip(context(userId), ownTrip({ vehicleNumber: `OD02${userId.toUpperCase()}`, startOdometer: reading, endOdometer: reading + 12 }))).trip;
    reading += 100;
    const { claims } = await submitClaims(context(userId), { tripIds: [trip.id], declaration: true });
    return { id: claims[0].id, ...db.read(ET_COLLECTIONS.claims, claims[0].id) };
  };

  const asha = await claimFor('emp1');
  assert.deepEqual(asha.currentAssigneeIds, ['dir1'], 'her manager from Access Management');
  assert.deepEqual(asha.reportingAuthorityIds, ['dir1']);
  assert.deepEqual(asha.stages[0].assigneeNames, ['Director']);
  const ravi = await claimFor('emp2');
  assert.deepEqual(ravi.currentAssigneeIds, ['mgr9'], 'his manager from greytHR');
  const meena = await claimFor('emp3');
  assert.deepEqual(meena.currentAssigneeIds, ['admin'], 'the exception set for her');
  const accounts = await claimFor('pay1');
  assert.deepEqual(accounts.currentAssigneeIds, ['hr'], 'nobody on record: the fallback');

  const notices = await takeNotices();
  assert.ok(notices.some((notice) => notice.userIds.includes('mgr9') && /needs your approval/.test(notice.title)));

  // The employee is told who it goes to; authorities get Approvals without being named in Settings.
  const boot = await bootstrap(context('emp1'));
  assert.deepEqual(boot.firstApproval, { stageName: 'Reporting Authority Approval', names: ['Director'], reportingSource: 'access', dependsOnTrips: false });
  assert.equal((await bootstrap(context('emp2'))).firstApproval.reportingSource, 'greythr');
  assert.equal((await bootstrap(context('mgr9'))).named.approval, true);
  assert.equal((await bootstrap(context('dir1'))).named.approval, true);
  assert.equal((await bootstrap(context('emp3'))).named.approval, false);

  // The authority approves; the claim moves on to payment.
  // Ravi's new claim — and his older one still in process, re-routed up his reporting line when the
  // workflow was saved.
  const inbox = (await listClaims(context('mgr9'), 'inbox')).claims;
  assert.ok(inbox.some((entry) => entry.id === ravi.id));
  assert.ok(inbox.every((entry) => entry.employeeId === 'emp2'));
  const { claim } = await actOnClaim(context('mgr9'), ravi.id, { action: 'approve', decisions: [] });
  assert.equal(claim.status, 'approved');
  assert.deepEqual(claim.currentAssigneeIds, ['pay1']);
});

/* ── company vehicles are fleet trips (SEL Fleet, decision D1) ─────────── */

test('with fleet routing on, company vehicles leave My Trips but their drafts can still be finished', async () => {
  const company = { tripDate: daysAgo(1), ownership: 'company', vehicleId: 'v1', fromPlace: 'Office', toPlace: 'Store', purpose: 'Stores run', startOdometer: 4000, endOdometer: 4012 };
  const draft = (await saveTrip(context('emp3'), company)).trip;

  db.seed('fleetSettings', 'default', { companyTripsInFleet: true });
  forgetFleetSettings('default');
  const boot = await bootstrap(context('emp3'));
  assert.equal(boot.settings.rules.allowCompanyVehicle, false, 'the form offers own vehicles only');
  assert.equal(boot.settings.rules.allowOwnVehicle, true);

  // A new company-vehicle trip is refused, pointing to Fleet Trip.
  try {
    await saveTrip(context('emp3'), { ...company, startOdometer: 4100, endOdometer: 4110 });
    assert.fail('a new company-vehicle trip should be refused');
  } catch (error) {
    assert.equal(error.status, 400);
    assert.match(error.details.fields.ownership, /fleet trips/i);
  }

  // The draft recorded before stays editable, claimable and deletable; own vehicles are unaffected.
  const edited = (await saveTrip(context('emp3'), { ...company, purpose: 'Stores run (cement)' }, draft.id)).trip;
  assert.equal(edited.ownership, 'company');
  assert.equal(edited.purpose, 'Stores run (cement)');
  await deleteTrip(context('emp3'), draft.id);
  assert.equal(db.read(ET_COLLECTIONS.trips, draft.id), undefined);
  const own = (await saveTrip(context('emp3'), ownTrip({ vehicleNumber: 'OD02EMP3', startOdometer: 9000, endOdometer: 9010 }))).trip;
  assert.equal(own.ownership, 'own');

  db.seed('fleetSettings', 'default', { companyTripsInFleet: false });
  forgetFleetSettings('default');
});

/* ── trips are recorded by GPS (Fleet Trip › Own vehicle) ──────────────── */

test('with typed trips off (the default), a new trip needs its GPS recording; editing is unaffected', async () => {
  const typed = (await saveTrip(context('emp3'), ownTrip({ vehicleNumber: 'OD02GPS1', startOdometer: 12000, endOdometer: 12010 }))).trip;
  const stored = db.read(ET_COLLECTIONS.settings, 'default');
  db.seed(ET_COLLECTIONS.settings, 'default', { ...stored, rules: { ...(stored.rules ?? {}), allowTypedTrips: false } });
  forgetSettings('default');
  try {
    await rejects(saveTrip(context('emp3'), ownTrip({ vehicleNumber: 'OD02GPS1', startOdometer: 12020, endOdometer: 12030 })), 400, /recorded by GPS/);
    const gps = { measuredKm: 10.2, startedAtIso: `${daysAgo(3)}T04:00:00.000Z`, endedAtIso: `${daysAgo(3)}T04:30:00.000Z`, movingMinutes: 25, idleMinutes: 5, stopCount: 1, fixes: 120, droppedFixes: 2, path: [{ lat: 20.3, lng: 85.8 }, { lat: 20.35, lng: 85.8 }] };
    const recorded = (await saveTrip(context('emp3'), { ...ownTrip({ vehicleNumber: 'OD02GPS1', startOdometer: 12020, endOdometer: 12030 }), gps })).trip;
    assert.equal(recorded.source, 'gps');
    // A trip already recorded (typed before the rule changed) can still be corrected.
    const edited = (await saveTrip(context('emp3'), ownTrip({ vehicleNumber: 'OD02GPS1', startOdometer: 12000, endOdometer: 12010, purpose: 'Inspection (corrected)' }), typed.id)).trip;
    assert.equal(edited.purpose, 'Inspection (corrected)');
    assert.equal(edited.source, 'manual');

    // A save queued on a phone without signal is sent again: one trip, under its client id, untouched.
    const offline = { ...ownTrip({ vehicleNumber: 'OD02GPS1', startOdometer: 12030, endOdometer: 12040 }), gps, clientTripId: 'own_offline0001' };
    const first = (await saveTrip(context('emp3'), offline)).trip;
    assert.equal(first.id, 'own_offline0001');
    const again = (await saveTrip(context('emp3'), { ...offline, purpose: 'Changed on the second send' })).trip;
    assert.equal(again.id, first.id);
    assert.equal(again.purpose, first.purpose, 'the replay returns the saved trip, not an edit');
    assert.equal(db.read(ET_COLLECTIONS.trips, 'own_offline0001').purpose, first.purpose);
    // Somebody else's id cannot be taken over.
    await rejects(saveTrip(context('emp1'), { ...offline, vehicleNumber: 'OD02OTHER' }), 403, /not yours/);
  } finally {
    db.seed(ET_COLLECTIONS.settings, 'default', stored);
    forgetSettings('default');
  }
});
