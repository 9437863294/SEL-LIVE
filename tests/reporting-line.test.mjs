/**
 * The reporting line Fleet & Travel's claim workflow follows (`reportingLine` / `reportingAuthorityOf`
 * in src/lib/employee-trips/server/lookups.ts): the same greytHR links Employee › Reporting shows,
 * matched to logins — and what happens to a claim when the line names nobody.
 * Run with the server-module hooks: `npm run test:driver-management`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { FakeFirestore } from './helpers/fake-firestore.mjs';

globalThis.__db = new FakeFirestore();
const db = globalThis.__db;

const { saveTrip } = await import('../src/lib/employee-trips/server/trips.ts');
const { submitClaims } = await import('../src/lib/employee-trips/server/claims.ts');
const { getSettingsForEditing, saveSettings } = await import('../src/lib/employee-trips/server/settings.ts');
const { hasReportees, reportingAuthorityOf, reportingLine } = await import('../src/lib/employee-trips/server/lookups.ts');
const { resolveTripAccess } = await import('../src/lib/employee-trips/access.ts');
const { indiaToday, ET_COLLECTIONS } = await import('../src/lib/employee-trips/types.ts');

const today = indiaToday();
const daysAgo = (days) => {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
};
const context = (userId, permissions = {}) => ({
  userId,
  userName: db.read('users', userId)?.name ?? userId,
  userEmail: `${userId}@example.com`,
  organizationId: 'default',
  trip: resolveTripAccess(permissions),
  today,
});
const admin = context('admin', { 'Driver Management.Trip Settings': ['Edit'] });

/* ── seed: one employee per way a reporting line can end ──────────────── */

for (const [id, name, employeeId] of [
  ['emp1', 'Asha', 'E1'], // → Site Manager (greytHR)
  ['emp2', 'Ravi', 'E2'], // → manager has left, though their login is still active
  ['emp3', 'Meena', 'E3'], // → manager has no login
  ['emp4', 'Kiran'], // login linked to no employee
  ['emp5', 'Sunil', 'E5'], // Access Management names Admin (over a manager with two logins)
  ['emp6', 'Self', 'E6'], // their own manager
  ['emp7', 'Bina', 'E7'], // manager has two logins
  ['mgr1', 'Site Manager', 'E10'],
  ['mgr2', 'Old Manager', 'E20'],
  ['mgr3', 'New Manager', 'E50'],
  ['dup1', 'Twin One', 'E30'],
  ['dup2', 'Twin Two', 'E30'],
  ['admin', 'Admin'],
  ['pay1', 'Accounts'],
]) {
  db.seed('users', id, { name, email: `${id}@example.com`, status: 'Active', ...(employeeId ? { employeeId } : {}) });
}
const employee = (id, managerId, employmentState = 'Active') => db.seed('employees', id, { name: id, employmentState, ...(managerId ? { reportingManagerEmployeeId: managerId } : {}) });
employee('E1', 'E10');
employee('E10');
employee('E2', 'E20');
employee('E20', null, 'Left');
employee('E3', 'E40');
employee('E40');
employee('E5', 'E30');
employee('E6', 'E6');
employee('E7', 'E30');
employee('E30');
employee('E50');
db.seed('accessGrants', 'emp5', { reportingManagerId: 'admin' });

db.seed('fleetSettings', 'default', { companyTripsInFleet: false });
db.seed(ET_COLLECTIONS.settings, 'default', {
  rules: { allowTypedTrips: true },
  rateRevisions: [{ id: 'r1', effectiveFrom: daysAgo(200), rates: [{ vehicleType: 'Two Wheeler', own: 4, company: null }] }],
  stages: [
    // The fallback names only Ravi: his own claims would have nobody to go to.
    { id: 'verify', name: 'Reporting Authority Approval', kind: 'approval', routing: 'reporting', userIds: ['emp2'], routes: [], minAmount: null, tatHours: 48 },
    { id: 'payment', name: 'Accounts', kind: 'payment', routing: 'users', userIds: ['pay1'], routes: [], minAmount: null, tatHours: 72 },
  ],
});

let reading = 1000;
const claimFor = async (userId) => {
  const trip = (
    await saveTrip(context(userId), { tripDate: daysAgo(3), ownership: 'own', vehicleType: 'Two Wheeler', vehicleNumber: `OD02${userId.toUpperCase()}`, fromPlace: 'Office', toPlace: 'Site', purpose: 'Inspection', startOdometer: reading, endOdometer: reading + 12 })
  ).trip;
  reading += 100;
  return submitClaims(context(userId), { tripIds: [trip.id], declaration: true });
};

/* ── the line ─────────────────────────────────────────────────────────── */

test("every login's reporting line, and why it names nobody when it does", async () => {
  const line = await reportingLine();
  const of = (userId) => line.get(userId);
  assert.deepEqual(of('emp1'), { ids: ['mgr1'], source: 'greythr', gap: null });
  assert.deepEqual(of('emp2'), { ids: [], source: null, gap: 'manager-departed' }, 'a manager who has left approves nothing, login or not');
  assert.deepEqual(of('emp3'), { ids: [], source: null, gap: 'manager-no-login' });
  assert.deepEqual(of('emp4'), { ids: [], source: null, gap: 'no-employee' });
  assert.deepEqual(of('emp5'), { ids: ['admin'], source: 'access', gap: null }, 'Access Management comes first');
  assert.deepEqual(of('emp6'), { ids: [], source: null, gap: 'own-manager' });
  assert.deepEqual(of('emp7'), { ids: [], source: null, gap: 'manager-two-logins' });
  // One rule: the single lookup a claim is routed with agrees with the whole line.
  for (const userId of ['emp1', 'emp2', 'emp3', 'emp4', 'emp5', 'emp6', 'emp7']) assert.deepEqual(await reportingAuthorityOf(userId), of(userId), userId);

  assert.equal(await hasReportees('mgr1'), true);
  assert.equal(await hasReportees('admin'), true, 'named in Access Management');
  assert.equal(await hasReportees('mgr2'), false, 'their reportee’s line stops at their leaving');
  assert.equal(await hasReportees('pay1'), false);

  const payload = await getSettingsForEditing(context('admin', { 'Driver Management.Trip Settings': ['View'] }));
  assert.deepEqual(
    payload.reportingLine.find((entry) => entry.userId === 'emp3'),
    { userId: 'emp3', ids: [], source: null, gap: 'manager-no-login' },
  );
  assert.equal(payload.reportingLine.length, 14, 'one entry per active login');
});

/* ── claims ───────────────────────────────────────────────────────────── */

test('a claim the line cannot place goes to the fallback people — never to a manager who has left', async () => {
  const meena = (await claimFor('emp3')).claims[0];
  assert.deepEqual(db.read(ET_COLLECTIONS.claims, meena.id).currentAssigneeIds, ['emp2'], 'no manager login: the fallback');

  // Ravi's manager has left (their login is still active), and the fallback is Ravi himself: the
  // claim waits for Override Workflow, as any claim with nobody else named does — and Settings ›
  // Workflow lists him under "to nobody" so it can be fixed.
  const ravi = db.read(ET_COLLECTIONS.claims, (await claimFor('emp2')).claims[0].id);
  assert.deepEqual(ravi.currentAssigneeIds, []);
  assert.deepEqual(ravi.reportingAuthorityIds, []);
});

test('saving the workflow re-routes claims up the reporting line as it is now', async () => {
  const { claims } = await claimFor('emp1');
  const sent = db.read(ET_COLLECTIONS.claims, claims[0].id);
  assert.deepEqual(sent.currentAssigneeIds, ['mgr1']);
  assert.deepEqual(sent.reportingAuthorityIds, ['mgr1']);

  // greytHR moves Asha to a new manager; the next sync writes it.
  employee('E1', 'E50');
  const stored = db.read(ET_COLLECTIONS.settings, 'default');
  const { rerouted } = await saveSettings(admin, { part: 'stages', stages: stored.stages.map((stage) => (stage.id === 'verify' ? { ...stage, userIds: ['emp2', 'pay1'] } : stage)) });
  assert.ok(rerouted >= 1);
  const moved = db.read(ET_COLLECTIONS.claims, claims[0].id);
  assert.deepEqual(moved.currentAssigneeIds, ['mgr3'], 'her claim now waits for her new manager');
  assert.deepEqual(moved.reportingAuthorityIds, ['mgr3']);
  assert.match(moved.history.at(-1).remarks, /New Manager/);
});
