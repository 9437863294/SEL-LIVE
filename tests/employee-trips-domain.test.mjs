import test from 'node:test';
import assert from 'node:assert/strict';

import { normaliseRevision, odometerDistance, ownVehicleTypes, priceTrip, rateFor, revisionOn } from '../src/lib/employee-trips/rates.ts';
import { daysLeftToClaim, isClaimable, tripFlags, validateTrip, withinClaimWindow } from '../src/lib/employee-trips/trips.ts';
import {
  DEFAULT_RULES,
  applyDecisions,
  claimAbilities,
  claimNumberFor,
  claimTotals,
  namedStageKinds,
  normaliseSettings,
  rerouteClaim,
  resolveClaimStages,
  routingFields,
  stageAge,
  stageAssignees,
} from '../src/lib/employee-trips/workflow.ts';
import { resolveTripAccess } from '../src/lib/employee-trips/access.ts';
import { daysBetween, financialYearOf } from '../src/lib/employee-trips/types.ts';

const revisions = [
  { id: 'r2', effectiveFrom: '2026-10-01', rates: [{ vehicleType: 'Two Wheeler', own: 4.5, company: null }, { vehicleType: 'Car', own: 10, company: 2 }] },
  { id: 'r1', effectiveFrom: '2026-04-01', rates: [{ vehicleType: 'Two Wheeler', own: 4, company: null }] },
];

/* ── rates ──────────────────────────────────────────────────────────────── */

test('a trip is priced by the revision in effect on its date', () => {
  assert.equal(revisionOn(revisions, '2026-03-31'), null);
  assert.equal(revisionOn(revisions, '2026-04-01').id, 'r1');
  assert.equal(revisionOn(revisions, '2026-09-30').id, 'r1');
  assert.equal(revisionOn(revisions, '2026-10-01').id, 'r2');
  assert.deepEqual(rateFor(revisions, '2026-09-15', 'two wheeler', 'own'), { ratePerKm: 4, revisionId: 'r1', effectiveFrom: '2026-04-01' });
  assert.equal(rateFor(revisions, '2026-10-15', 'Two Wheeler', 'own').ratePerKm, 4.5);
  // No company rate for a two-wheeler, and no Car row before October.
  assert.equal(rateFor(revisions, '2026-10-15', 'Two Wheeler', 'company').ratePerKm, null);
  assert.equal(rateFor(revisions, '2026-09-15', 'Car', 'own').ratePerKm, null);
  assert.equal(rateFor(revisions, '2026-10-15', 'Car', 'company').ratePerKm, 2);
});

test('pricing adds toll and parking at cost, in paise', () => {
  assert.deepEqual(priceTrip({ distanceKm: 12.3, ratePerKm: 4.5, tollAmount: 20, parkingAmount: 10.1, allowTollParking: true }), { distanceAmount: 55.35, extrasAmount: 30.1, totalAmount: 85.45 });
  assert.deepEqual(priceTrip({ distanceKm: 12.3, ratePerKm: null, tollAmount: 20, allowTollParking: true }), { distanceAmount: 0, extrasAmount: 20, totalAmount: 20 });
  assert.equal(priceTrip({ distanceKm: 10, ratePerKm: 4, tollAmount: 20, allowTollParking: false }).totalAmount, 40);
  assert.equal(odometerDistance(1000, 1012.34), 12.3);
  assert.equal(odometerDistance(1000, 990), 0);
});

test('rate revisions are cleaned and own-vehicle types lead with the rated ones', () => {
  const clean = normaliseRevision({ id: 'x', effectiveFrom: '2026-11-01', rates: [{ vehicleType: ' Car ', own: '9.999', company: '' }, { vehicleType: 'car', own: 1, company: 1 }, { vehicleType: '', own: 3, company: 3 }, { vehicleType: 'Bike', own: -1, company: null }] });
  assert.deepEqual(clean.rates, [{ vehicleType: 'Car', own: 10, company: null }, { vehicleType: 'Bike', own: null, company: null }]);
  assert.deepEqual(ownVehicleTypes(revisions, '2026-10-05', ['Car', 'Truck', 'Two Wheeler']), [
    { type: 'Two Wheeler', rate: 4.5 },
    { type: 'Car', rate: 10 },
    { type: 'Truck', rate: null },
  ]);
});

/* ── recording a trip ───────────────────────────────────────────────────── */

const rules = { ...DEFAULT_RULES };
const ownTrip = { tripDate: '2026-10-20', ownership: 'own', vehicleType: 'Two Wheeler', vehicleNumber: 'mh 12 ab-1234', fromPlace: ' Office ', toPlace: 'Site A', purpose: 'Site inspection', startOdometer: 1000, endOdometer: 1024.5, tollAmount: 0, parkingAmount: 10, notes: '' };
const today = '2026-10-23';

test('a valid own-vehicle trip is cleaned up', () => {
  const result = validateTrip(ownTrip, { rules, today, companyVehicle: null });
  assert.equal(result.ok, true);
  assert.equal(result.value.vehicleNumber, 'MH12AB1234');
  assert.equal(result.value.fromPlace, 'Office');
  assert.equal(result.value.distanceKm, 24.5);
  assert.equal(result.value.parkingAmount, 10);
});

test('dates: none in the future, none past the claim window', () => {
  assert.match(validateTrip({ ...ownTrip, tripDate: '2026-10-24' }, { rules, today, companyVehicle: null }).errors.tripDate, /future/);
  assert.match(validateTrip({ ...ownTrip, tripDate: '2026-08-01' }, { rules, today, companyVehicle: null }).errors.tripDate, /60 days/);
  assert.equal(validateTrip({ ...ownTrip, tripDate: '2026-08-01' }, { rules: { ...rules, claimWindowDays: null }, today, companyVehicle: null }).ok, true);
  assert.equal(withinClaimWindow('2026-08-24', today, rules), true);
  assert.equal(withinClaimWindow('2026-08-23', today, rules), false);
  assert.equal(daysLeftToClaim('2026-10-20', today, rules), 57);
  assert.equal(daysLeftToClaim('2026-10-20', today, { claimWindowDays: null }), null);
  // Only unclaimed trips inside the window can go on a claim.
  assert.equal(isClaimable({ status: 'draft', tripDate: '2026-10-20' }, today, rules), true);
  assert.equal(isClaimable({ status: 'submitted', tripDate: '2026-10-20' }, today, rules), false);
  assert.equal(isClaimable({ status: 'draft', tripDate: '2026-08-01' }, today, rules), false);
});

test('odometer: required by default, closing above opening; typed distance only when allowed', () => {
  assert.match(validateTrip({ ...ownTrip, endOdometer: 990 }, { rules, today, companyVehicle: null }).errors.endOdometer, /higher/);
  assert.ok(validateTrip({ ...ownTrip, startOdometer: null, endOdometer: null, distanceKm: 12 }, { rules, today, companyVehicle: null }).errors.startOdometer);
  const loose = { ...rules, requireOdometer: false };
  const typed = validateTrip({ ...ownTrip, startOdometer: null, endOdometer: null, distanceKm: 12.34 }, { rules: loose, today, companyVehicle: null });
  assert.equal(typed.ok, true);
  assert.equal(typed.value.distanceKm, 12.3);
  assert.equal(typed.value.startOdometer, null);
  assert.ok(validateTrip({ ...ownTrip, startOdometer: null, endOdometer: null, distanceKm: 0 }, { rules: loose, today, companyVehicle: null }).errors.distance);
  assert.match(validateTrip({ ...ownTrip, endOdometer: 4000 }, { rules, today, companyVehicle: null }).errors.distance, /2000 km/);
});

test('a company-vehicle trip takes its type and number from Vehicle Master', () => {
  const vehicle = { id: 'v1', vehicleNumber: 'OD 02 X 9', vehicleType: 'Pickup' };
  const result = validateTrip({ ...ownTrip, ownership: 'company', vehicleId: 'v1', vehicleType: 'Car', vehicleNumber: 'WRONG' }, { rules, today, companyVehicle: vehicle });
  assert.equal(result.ok, true);
  assert.equal(result.value.vehicleType, 'Pickup');
  assert.equal(result.value.vehicleNumber, 'OD02X9');
  assert.ok(validateTrip({ ...ownTrip, ownership: 'company', vehicleId: 'v2' }, { rules, today, companyVehicle: vehicle }).errors.vehicleId);
  assert.ok(validateTrip({ ...ownTrip, ownership: 'company', vehicleId: 'v1' }, { rules: { ...rules, allowCompanyVehicle: false }, today, companyVehicle: vehicle }).errors.ownership);
});

test('toll and parking are dropped when switched off; a project can be required', () => {
  const result = validateTrip({ ...ownTrip, tollAmount: 50 }, { rules: { ...rules, allowTollParking: false }, today, companyVehicle: null });
  assert.equal(result.value.tollAmount, 0);
  assert.equal(result.value.parkingAmount, 0);
  assert.ok(validateTrip(ownTrip, { rules: { ...rules, requireProject: true }, today, companyVehicle: null }).errors.projectId);
  assert.ok(validateTrip({ ...ownTrip, tollAmount: -5 }, { rules, today, companyVehicle: null }).errors.tollAmount);
});

/* ── flags ──────────────────────────────────────────────────────────────── */

const flagTrip = (id, extra = {}) => ({ id, tripDate: '2026-10-20', fromPlace: 'Office', toPlace: 'Site A', distanceKm: 24.5, startOdometer: 1000, endOdometer: 1024.5, vehicleNumber: 'MH12AB1234', status: 'draft', ratePerKm: 4.5, ...extra });

test('flags point the approver at what to check', () => {
  const trip = flagTrip('t1');
  assert.deepEqual(tripFlags(trip, { rules, sameEmployee: [], sameVehicle: [] }), []);
  assert.deepEqual(tripFlags({ ...trip, ratePerKm: null }, { rules, sameEmployee: [], sameVehicle: [] }), ['no_rate']);
  assert.deepEqual(tripFlags({ ...trip, distanceKm: 350 }, { rules, sameEmployee: [], sameVehicle: [] }), ['over_trip_limit']);
  const other = flagTrip('t2', { fromPlace: 'Site A', toPlace: 'Office', distanceKm: 380, startOdometer: 1024.5, endOdometer: 1404.5 });
  assert.deepEqual(tripFlags(trip, { rules, sameEmployee: [other], sameVehicle: [other] }), ['over_day_limit']);
  // Touching ranges are fine; overlapping ones are flagged. Rejected trips and the trip itself are ignored.
  const overlapping = flagTrip('t3', { fromPlace: 'X', toPlace: 'Y', startOdometer: 1020, endOdometer: 1030, tripDate: '2026-10-19' });
  assert.deepEqual(tripFlags(trip, { rules, sameEmployee: [], sameVehicle: [overlapping, flagTrip('t1')] }), ['odometer_overlap']);
  assert.deepEqual(tripFlags(trip, { rules, sameEmployee: [], sameVehicle: [{ ...overlapping, status: 'rejected' }] }), []);
  const twin = flagTrip('t4', { fromPlace: 'office', toPlace: 'Site-A', distanceKm: 25, startOdometer: null, endOdometer: null });
  assert.deepEqual(tripFlags(trip, { rules, sameEmployee: [twin], sameVehicle: [] }), ['possible_duplicate']);
});

/* ── workflow configuration ─────────────────────────────────────────────── */

test('settings are repaired: one approval stage at least, one payment stage last', () => {
  const defaults = normaliseSettings(null);
  assert.deepEqual(defaults.stages.map((stage) => stage.kind), ['approval', 'payment']);
  assert.equal(defaults.rules.claimWindowDays, 60);

  const messy = normaliseSettings({
    rules: { maxKmPerTrip: 0, allowOwnVehicle: false, allowCompanyVehicle: false },
    stages: [
      { id: 'pay', name: 'Old pay', kind: 'payment', userIds: ['p0'] },
      { id: 'a', name: 'HOD', kind: 'approval', routing: 'project', userIds: ['u1', 'u1', ''], routes: [{ key: 'p1', userIds: ['u2'] }, { key: 'p1', userIds: ['u3'] }, { key: 'p2', userIds: [] }], minAmount: '0' },
      { id: 'a', name: 'Director', kind: 'approval', minAmount: 5000 },
      { id: 'pay2', name: 'Accounts', kind: 'payment', userIds: ['p1'] },
    ],
  });
  assert.equal(messy.rules.maxKmPerTrip, null);
  assert.equal(messy.rules.allowOwnVehicle, true);
  assert.deepEqual(messy.stages.map((stage) => [stage.id, stage.kind]), [['a', 'approval'], ['a-2', 'approval'], ['pay2', 'payment']]);
  assert.deepEqual(messy.stages[0].userIds, ['u1']);
  assert.deepEqual(messy.stages[0].routes, [{ key: 'p1', userIds: ['u2'] }]);
  assert.equal(messy.stages[0].minAmount, null);
  assert.equal(messy.stages[1].minAmount, 5000);
  assert.deepEqual(routingFields(messy.stages), { project: true, department: false });
});

test('stage people: routed by project with fallback, never the claimant', () => {
  const stage = { id: 'a', name: 'HOD', kind: 'approval', routing: 'project', userIds: ['u1', 'emp'], routes: [{ key: 'p1', userIds: ['u2', 'emp'] }], minAmount: null, tatHours: null };
  assert.deepEqual(stageAssignees(stage, { employeeId: 'emp', projectId: 'p1', departmentId: null }), ['u2']);
  assert.deepEqual(stageAssignees(stage, { employeeId: 'emp', projectId: 'p9', departmentId: null }), ['u1']);
  assert.deepEqual(stageAssignees(stage, { employeeId: 'emp', projectId: null, departmentId: null }), ['u1']);
  assert.deepEqual(namedStageKinds({ stages: [stage] }, 'u2'), { approval: true, payment: false });
  // A route that names only the claimant falls back to the stage's people instead of nobody.
  assert.deepEqual(stageAssignees({ ...stage, routes: [{ key: 'p1', userIds: ['emp'] }] }, { employeeId: 'emp', projectId: 'p1', departmentId: null }), ['u1']);
});

test('reporting authority: an exception for the employee, else their profile, else the fallback', () => {
  const stage = { id: 'a', name: 'RA', kind: 'approval', routing: 'reporting', userIds: ['hr'], routes: [{ key: 'emp2', userIds: ['director'] }], minAmount: null, tatHours: null };
  assert.deepEqual(stageAssignees(stage, { employeeId: 'emp1', projectId: null, departmentId: null, reportingAuthorityIds: ['mgr1'] }), ['mgr1']);
  assert.deepEqual(stageAssignees(stage, { employeeId: 'emp2', projectId: null, departmentId: null, reportingAuthorityIds: ['mgr2'] }), ['director'], 'the exception wins');
  assert.deepEqual(stageAssignees(stage, { employeeId: 'emp3', projectId: null, departmentId: null, reportingAuthorityIds: [] }), ['hr'], 'nobody on the profile: the fallback');
  assert.deepEqual(stageAssignees(stage, { employeeId: 'boss', projectId: null, departmentId: null, reportingAuthorityIds: ['boss'] }), ['hr'], 'never the claimant');
  assert.equal(normaliseSettings(null).stages[0].routing, 'reporting', 'the default first stage');
  assert.deepEqual(normaliseSettings({ stages: [{ ...stage }, { id: 'pay', kind: 'payment', userIds: ['acc'] }] }).stages[0].routes, [{ key: 'emp2', userIds: ['director'] }], 'exceptions are kept');
});

test('a claim skips approval stages below their amount', () => {
  const settings = normaliseSettings({ stages: [
    { id: 'a', name: 'Verify', kind: 'approval', userIds: ['u1'] },
    { id: 'b', name: 'Director', kind: 'approval', userIds: ['d1'], minAmount: 5000 },
    { id: 'pay', name: 'Accounts', kind: 'payment', userIds: ['acc'] },
  ] });
  const names = { u1: 'Verifier', d1: 'Director', acc: 'Accounts' };
  const small = resolveClaimStages(settings, { employeeId: 'emp', projectId: null, departmentId: null, amount: 1200 }, (id) => names[id]);
  assert.deepEqual(small.map((stage) => stage.id), ['a', 'pay']);
  assert.deepEqual(small[0].assigneeNames, ['Verifier']);
  const large = resolveClaimStages(settings, { employeeId: 'emp', projectId: null, departmentId: null, amount: 5000 }, (id) => names[id]);
  assert.deepEqual(large.map((stage) => stage.id), ['a', 'b', 'pay']);
  // The first approval stage always applies, whatever amount it was given.
  const guarded = normaliseSettings({ stages: [{ id: 'a', kind: 'approval', userIds: ['u1'], minAmount: 10000 }, { id: 'pay', kind: 'payment', userIds: ['acc'] }] });
  assert.equal(guarded.stages[0].minAmount, null);
  assert.deepEqual(resolveClaimStages(guarded, { employeeId: 'emp', projectId: null, departmentId: null, amount: 10 }, String).map((stage) => stage.id), ['a', 'pay']);
});

/* ── who may act ────────────────────────────────────────────────────────── */

const claim = (extra = {}) => ({
  status: 'pending',
  employeeId: 'emp',
  currentAssigneeIds: ['u1'],
  currentStageIndex: 0,
  history: [{ action: 'submitted' }],
  stages: [{ id: 'a', kind: 'approval' }, { id: 'pay', kind: 'payment' }],
  ...extra,
});

test('the named person decides; override acts for them; nobody acts on their own claim', () => {
  assert.equal(claimAbilities(claim(), { userId: 'u1', override: false }).decide, true);
  assert.equal(claimAbilities(claim(), { userId: 'u9', override: false }).decide, false);
  const viaOverride = claimAbilities(claim(), { userId: 'u9', override: true });
  assert.equal(viaOverride.decide, true);
  assert.equal(viaOverride.viaOverride, true);
  assert.equal(claimAbilities(claim({ currentAssigneeIds: ['emp'] }), { userId: 'emp', override: true }).decide, false);
  // The claimant may withdraw until someone acts.
  assert.equal(claimAbilities(claim(), { userId: 'emp', override: false }).withdraw, true);
  assert.equal(claimAbilities(claim({ history: [{ action: 'submitted' }, { action: 'approved' }], currentStageIndex: 1 }), { userId: 'emp', override: false }).withdraw, false);
});

test('at the payment stage the payer records payment; final claims offer nothing', () => {
  const atPayment = claim({ status: 'approved', currentStageIndex: 1, currentAssigneeIds: ['acc'] });
  assert.deepEqual(claimAbilities(atPayment, { userId: 'acc', override: false }), { decide: false, pay: true, withdraw: false, viaOverride: false, reason: null });
  assert.equal(claimAbilities(claim({ status: 'paid', currentAssigneeIds: [] }), { userId: 'acc', override: true }).pay, false);
});

test('a claim past its TAT is overdue', () => {
  const at = claim({ stageEnteredAt: '2026-10-20T00:00:00.000Z', stages: [{ id: 'a', kind: 'approval', tatHours: 48 }] });
  assert.equal(stageAge(at, new Date('2026-10-21T00:00:00.000Z')).overdue, false);
  assert.equal(stageAge(at, new Date('2026-10-23T00:00:00.000Z')).overdue, true);
});

/* ── decisions ──────────────────────────────────────────────────────────── */

const line = (id, extra = {}) => ({ id, distanceKm: 20, ratePerKm: 4, tollAmount: 10, parkingAmount: 0, distanceAmount: 80, totalAmount: 90, decision: null, status: 'submitted', ...extra });
const who = { stageName: 'Verify', byId: 'u1', byName: 'Verifier', at: '2026-10-23T10:00:00.000Z' };

test('approve, cut, reject and send back trips in one action', () => {
  const outcome = applyDecisions([line('a'), line('b'), line('c'), line('d')], [
    { tripId: 'b', decision: 'adjust', approvedKm: 15, remarks: 'Map shows 15 km' },
    { tripId: 'c', decision: 'reject', remarks: 'Personal trip' },
    { tripId: 'd', decision: 'return', remarks: 'Wrong project' },
  ], who);
  const decided = Object.fromEntries(outcome.kept.map((entry) => [entry.tripId, entry.decision]));
  assert.equal(decided.a.decision, 'approve');
  assert.equal(decided.a.approvedAmount, 90);
  assert.equal(decided.b.approvedKm, 15);
  assert.equal(decided.b.approvedAmount, 70);
  assert.equal(decided.c.approvedAmount, 0);
  assert.deepEqual(outcome.returned, [{ tripId: 'd', remarks: 'Wrong project' }]);
  assert.equal(outcome.summary, '1 rejected, 1 cut, 1 sent back');
});

test('decisions need reasons and leave at least one trip approved', () => {
  assert.throws(() => applyDecisions([line('a')], [{ tripId: 'a', decision: 'reject' }], who), /why/);
  assert.throws(() => applyDecisions([line('a')], [{ tripId: 'a', decision: 'adjust', approvedKm: 25, remarks: 'x' }], who), /below 20 km/);
  assert.throws(() => applyDecisions([line('a')], [{ tripId: 'a', decision: 'reject', remarks: 'No' }], who), /No trip would stay approved/);
  assert.throws(() => applyDecisions([line('a')], [{ tripId: 'zz', decision: 'approve' }], who), /not on this claim/);
});

test('a later stage keeps an earlier cut and can cut further', () => {
  const earlier = { decision: 'adjust', approvedKm: 15, approvedAmount: 70, remarks: 'Map', stageName: 'Verify', byId: 'u1', byName: 'Verifier', at: 'x' };
  const kept = applyDecisions([line('a', { decision: earlier })], [], { ...who, stageName: 'Director', byId: 'd1' }).kept;
  assert.equal(kept[0].decision, earlier);
  const further = applyDecisions([line('a', { decision: earlier })], [{ tripId: 'a', decision: 'adjust', approvedKm: 10, remarks: 'Less' }], who).kept;
  assert.equal(further[0].decision.approvedAmount, 50);
  // An earlier rejection stays rejected.
  const rejected = { ...earlier, decision: 'reject', approvedKm: 0, approvedAmount: 0 };
  const outcome = applyDecisions([line('a', { decision: rejected, status: 'rejected' }), line('b')], [], who);
  assert.equal(outcome.kept.find((entry) => entry.tripId === 'a').decision.decision, 'reject');
});

test('claim totals: claimed over every trip, approved over those not rejected', () => {
  const totals = claimTotals([
    { distanceKm: 20, totalAmount: 90, tollAmount: 10, parkingAmount: 0, decision: null },
    { distanceKm: 20, totalAmount: 90, tollAmount: 10, parkingAmount: 0, decision: { decision: 'adjust', approvedKm: 15, approvedAmount: 70 } },
    { distanceKm: 10.05, totalAmount: 40.2, tollAmount: 0, parkingAmount: 0, decision: { decision: 'reject', approvedKm: 0, approvedAmount: 0 } },
  ]);
  assert.deepEqual(totals, { tripCount: 3, distanceKm: 50.1, claimedAmount: 220.2, tollParking: 20, approvedKm: 35, approvedAmount: 160 });
});

test('saving the workflow re-routes claims still in process', () => {
  const settings = normaliseSettings({ stages: [{ id: 'a', name: 'Verify', kind: 'approval', userIds: ['new'] }, { id: 'pay', name: 'Accounts', kind: 'payment', userIds: ['acc'] }] });
  const inProcess = { status: 'pending', employeeId: 'emp', projectId: null, departmentId: null, reportingAuthorityIds: [], currentStageIndex: 0, stages: [{ id: 'a', name: 'Verify', kind: 'approval', assigneeIds: ['old'], assigneeNames: ['Old'], tatHours: 48 }, { id: 'pay', name: 'Accounts', kind: 'payment', assigneeIds: ['acc'], assigneeNames: ['Acc'], tatHours: 72 }] };
  const routed = rerouteClaim(inProcess, settings, (id) => id.toUpperCase());
  assert.deepEqual(routed.currentAssigneeIds, ['new']);
  assert.deepEqual(routed.stages[0].assigneeNames, ['NEW']);
  assert.equal(rerouteClaim({ ...inProcess, status: 'paid' }, settings, String), null);
  assert.equal(rerouteClaim({ ...inProcess, stages: routed.stages }, settings, (id) => id.toUpperCase()), null);
});

/* ── access, numbering, dates ───────────────────────────────────────────── */

test('wider grants, with the retired trip-log grants counting as View All', () => {
  assert.deepEqual(resolveTripAccess({}), { viewAll: false, exportAll: false, override: false, settingsView: false, settingsEdit: false });
  assert.equal(resolveTripAccess({ 'Driver Management.Employee Trip Log': ['Approve'] }).viewAll, true);
  assert.equal(resolveTripAccess({ 'Driver Management.Trip Claims': ['Export'] }).exportAll, false);
  assert.equal(resolveTripAccess({ 'Driver Management.Trip Claims': ['View All', 'Export'] }).exportAll, true);
  const fleetAdmin = resolveTripAccess({ 'Vehicle Management.Settings': ['Edit'] });
  assert.equal(fleetAdmin.settingsEdit, true);
  assert.equal(fleetAdmin.settingsView, true);
});

test('claim numbers and financial years', () => {
  assert.equal(claimNumberFor('2026-27', 42), 'TC-2026-27-0042');
  assert.equal(financialYearOf('2026-10-23'), '2026-27');
  assert.equal(financialYearOf('2027-03-31'), '2026-27');
  assert.equal(financialYearOf('2027-04-01'), '2027-28');
  assert.equal(daysBetween('2026-10-20', '2026-10-23'), 3);
});
