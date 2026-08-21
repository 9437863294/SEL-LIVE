import test from 'node:test';
import assert from 'node:assert/strict';
// Imported from the policy module rather than `tour-travel.ts`, which re-exports Firestore-client
// types that only resolve inside the bundler.
import {
  advanceAgeingBucket,
  billFingerprint,
  calculateDailyAllowance,
  calculateMileage,
  calculateSegmentedDailyAllowance,
  daUnits,
  estimateTourCost,
  evaluateExpenseAgainstPolicy,
  evaluateOutstandingAdvances,
  evaluateTourClosure,
  exceedsClassEntitlement,
  financialYearForTravelDate,
  findDuplicateBills,
  isExpenseWithinTourWindow,
  resolveApprovalChain,
  resolveCityClass,
  resolveEmployeeGrade,
  resolveEntitlement,
  resolveStageApprovers,
  summarizeAdvanceAgeing,
  summarizeSettlement,
  travelDocumentNumber,
} from '../src/lib/tour-travel-policy.ts';

/** Every case pins its own dates rather than depending on today. */
const at = (value) => new Date(value);

/* ── financial year & numbering ──────────────────────────────────────────────────────────────── */

test('financial year runs April to March', () => {
  assert.equal(financialYearForTravelDate(at('2026-04-01T10:00:00')), '2026-27');
  assert.equal(financialYearForTravelDate(at('2027-03-31T10:00:00')), '2026-27');
  assert.equal(financialYearForTravelDate(at('2026-03-31T10:00:00')), '2025-26');
});

test('document numbers are six digits and carry the org code', () => {
  assert.equal(
    travelDocumentNumber({ kind: 'request', orgCode: 'SEL', financialYear: '2026-27', sequence: 124 }),
    'TR/SEL/2026-27/000124',
  );
  assert.equal(
    travelDocumentNumber({ kind: 'claim', orgCode: 'SEL', financialYear: '2026-27', sequence: 98 }),
    'TC/SEL/2026-27/000098',
  );
});

test('a blank or punctuated org code still yields a usable number', () => {
  assert.equal(
    travelDocumentNumber({ kind: 'advance', orgCode: 'S.E.L!', financialYear: '2026-27', sequence: 67 }),
    'TA/SEL/2026-27/000067',
  );
  assert.equal(
    travelDocumentNumber({ kind: 'advance', orgCode: '', financialYear: '2026-27', sequence: 1 }),
    'TA/SEL/2026-27/000001',
  );
});

/* ── city classification ─────────────────────────────────────────────────────────────────────── */

const cities = [
  { id: '1', organizationId: 'org', city: 'Mumbai', cityClass: 'Metro', active: true },
  { id: '2', organizationId: 'org', city: 'Bhubaneswar', cityClass: 'Tier 2', active: true },
  { id: '3', organizationId: 'org', city: 'Rayagada', cityClass: 'Remote Project Site', active: true },
  { id: '4', organizationId: 'org', city: 'Angul', cityClass: 'Metro', active: false },
];

test('city lookup ignores case and surrounding whitespace', () => {
  assert.equal(resolveCityClass(cities, '  rayagada '), 'Remote Project Site');
  assert.equal(resolveCityClass(cities, 'MUMBAI'), 'Metro');
});

test('an unmapped or deactivated city falls back to the lowest domestic cap, never the highest', () => {
  // A typo must not be able to buy a Metro hotel limit.
  assert.equal(resolveCityClass(cities, 'Raygada'), 'Tier 3');
  assert.equal(resolveCityClass(cities, 'Angul'), 'Tier 3');
  assert.equal(resolveCityClass(cities, ''), 'Tier 3');
});

/* ── grade resolution ────────────────────────────────────────────────────────────────────────── */

const gradeMappings = [
  { id: '1', organizationId: 'org', designation: 'Site Engineer', grade: 'Engineer' },
  { id: '2', organizationId: 'org', designation: 'General Manager', grade: 'GM' },
  { id: '3', organizationId: 'org', designation: 'Site Engineer', grade: 'Manager', employeeId: 'EMP-7' },
];

test('an employee-specific grade override beats the designation map', () => {
  assert.equal(resolveEmployeeGrade(gradeMappings, { employeeId: 'EMP-7', designation: 'Site Engineer' }, 'Staff'), 'Manager');
  assert.equal(resolveEmployeeGrade(gradeMappings, { employeeId: 'EMP-8', designation: 'Site Engineer' }, 'Staff'), 'Engineer');
});

test('an unmapped designation falls back to the default grade rather than going undefined', () => {
  assert.equal(resolveEmployeeGrade(gradeMappings, { employeeId: 'EMP-9', designation: 'Storekeeper' }, 'Staff'), 'Staff');
  assert.equal(resolveEmployeeGrade(gradeMappings, {}, 'Staff'), 'Staff');
});

/* ── entitlement ─────────────────────────────────────────────────────────────────────────────── */

const entitlements = [
  { id: '1', organizationId: 'org', grade: 'Manager', cityClass: 'Any', flightClass: 'Economy', trainClass: '2A', hotelLimitPerNight: 3500, daPerDay: 1000, mileage: { bike: 4, car: 10 }, localConveyancePerDay: 600, active: true },
  { id: '2', organizationId: 'org', grade: 'Manager', cityClass: 'Metro', flightClass: 'Economy', trainClass: '2A', hotelLimitPerNight: 4500, daPerDay: 1200, mileage: { bike: 4, car: 10 }, localConveyancePerDay: 800, active: true },
  { id: '3', organizationId: 'org', grade: 'Engineer', cityClass: 'Any', flightClass: 'None', trainClass: '2A', hotelLimitPerNight: 2500, daPerDay: 800, mileage: { bike: 4, car: 10 }, localConveyancePerDay: 500, active: true },
];

test('an exact city-class row beats the grade baseline', () => {
  assert.equal(resolveEntitlement(entitlements, { grade: 'Manager', cityClass: 'Metro' }).hotelLimitPerNight, 4500);
  assert.equal(resolveEntitlement(entitlements, { grade: 'Manager', cityClass: 'Tier 2' }).hotelLimitPerNight, 3500);
});

test('a grade with no configured row resolves to undefined instead of borrowing another grade', () => {
  // Silently entitling a Director to the Manager row would be a quiet over-payment.
  assert.equal(resolveEntitlement(entitlements, { grade: 'Director', cityClass: 'Metro' }), undefined);
});

test('travelled class above entitlement is flagged, at or below is not', () => {
  const manager = resolveEntitlement(entitlements, { grade: 'Manager', cityClass: 'Tier 2' });
  assert.equal(exceedsClassEntitlement('Train', '1A', manager), true);
  assert.equal(exceedsClassEntitlement('Train', '2A', manager), false);
  assert.equal(exceedsClassEntitlement('Train', '3A', manager), false);
  assert.equal(exceedsClassEntitlement('Flight', 'Business', manager), true);
  assert.equal(exceedsClassEntitlement('Flight', 'Economy', manager), false);
  const engineer = resolveEntitlement(entitlements, { grade: 'Engineer', cityClass: 'Any' });
  assert.equal(exceedsClassEntitlement('Flight', 'Economy', engineer), true);
});

test('modes without a class entitlement are never flagged', () => {
  const manager = resolveEntitlement(entitlements, { grade: 'Manager', cityClass: 'Tier 2' });
  assert.equal(exceedsClassEntitlement('Taxi', 'AC', manager), false);
  assert.equal(exceedsClassEntitlement('Train', undefined, manager), false);
});

/* ── daily allowance ─────────────────────────────────────────────────────────────────────────── */

test('whole days pay in full and only the remainder is banded', () => {
  // 2026-08-21 20:30 → 2026-08-24 04:30 is 56 hours: two full days plus 8 hours.
  const units = daUnits('2026-08-21T20:30', '2026-08-24T04:30');
  assert.equal(units.totalHours, 56);
  assert.equal(units.fullDays, 2);
  assert.equal(units.remainderHours, 8);
  assert.equal(units.remainderFactor, 0.5);
  assert.equal(units.totalUnits, 2.5);
});

test('the remainder band picks the highest matching slab regardless of array order', () => {
  const slabs = [{ minHours: 6, percent: 50 }, { minHours: 12, percent: 100 }];
  // A 13-hour remainder qualifies for both bands; it must earn the 100% one.
  assert.equal(daUnits('2026-08-21T06:00', '2026-08-21T19:00', slabs).remainderFactor, 1);
  assert.equal(daUnits('2026-08-21T06:00', '2026-08-21T13:00', slabs).remainderFactor, 0.5);
  assert.equal(daUnits('2026-08-21T06:00', '2026-08-21T11:00', slabs).remainderFactor, 0);
});

test('banding the remainder rather than the total keeps a long trip worth more than a short one', () => {
  const long = daUnits('2026-08-21T06:00', '2026-08-22T12:00'); // 30 hours
  const short = daUnits('2026-08-21T06:00', '2026-08-21T19:00'); // 13 hours
  assert.equal(long.totalUnits, 1.5);
  assert.equal(short.totalUnits, 1);
  assert.ok(long.totalUnits > short.totalUnits);
});

test('DA amount is units times rate', () => {
  const da = calculateDailyAllowance({ departureAt: '2026-08-21T20:30', returnAt: '2026-08-24T04:30', ratePerDay: 1000 });
  assert.equal(da.totalUnits, 2.5);
  assert.equal(da.amount, 2500);
});

test('missing or reversed journey times yield zero DA, never a negative allowance', () => {
  assert.equal(calculateDailyAllowance({ departureAt: '2026-08-24T10:00', returnAt: '2026-08-21T10:00', ratePerDay: 1000 }).amount, 0);
  assert.equal(calculateDailyAllowance({ departureAt: null, returnAt: '2026-08-21T10:00', ratePerDay: 1000 }).amount, 0);
  assert.equal(calculateDailyAllowance({ departureAt: '2026-08-21T10:00', returnAt: undefined, ratePerDay: 1000 }).amount, 0);
});

test('segmented DA pays each city its own rate and the balance at the default', () => {
  // 3 full days; 2 days in a Metro at 1200, the remaining 1 at the 1000 default.
  const da = calculateSegmentedDailyAllowance({
    departureAt: '2026-08-21T06:00',
    returnAt: '2026-08-24T06:00',
    segments: [{ cityClass: 'Metro', units: 2, ratePerDay: 1200 }],
    defaultRate: 1000,
  });
  assert.equal(da.totalUnits, 3);
  assert.equal(da.unallocatedUnits, 1);
  assert.equal(da.amount, 3400);
});

test('segments cannot claim more days than the journey lasted', () => {
  const da = calculateSegmentedDailyAllowance({
    departureAt: '2026-08-21T06:00',
    returnAt: '2026-08-22T06:00',
    segments: [{ cityClass: 'Metro', units: 5, ratePerDay: 1200 }],
    defaultRate: 1000,
  });
  assert.equal(da.unallocatedUnits, 0);
});

/* ── mileage ─────────────────────────────────────────────────────────────────────────────────── */

test('mileage is distance times the approved rate for the vehicle type', () => {
  const claim = calculateMileage({ startKm: 12000, endKm: 12182, vehicleType: 'car', rates: { bike: 4, car: 10 } });
  assert.equal(claim.distanceKm, 182);
  assert.equal(claim.ratePerKm, 10);
  assert.equal(claim.amount, 1820);
  assert.equal(calculateMileage({ startKm: 0, endKm: 100, vehicleType: 'bike', rates: { bike: 4, car: 10 } }).amount, 400);
});

test('a reversed odometer pair yields zero, not a negative reimbursement', () => {
  assert.equal(calculateMileage({ startKm: 12182, endKm: 12000, vehicleType: 'car', rates: { bike: 4, car: 10 } }).amount, 0);
});

test('a negotiated project rate overrides the grade rate', () => {
  const claim = calculateMileage({ startKm: 0, endKm: 100, vehicleType: 'car', rates: { bike: 4, car: 10 }, overrideRatePerKm: 12 });
  assert.equal(claim.amount, 1200);
});

/* ── per-line policy evaluation ──────────────────────────────────────────────────────────────── */

const manager = entitlements[0];

test('a hotel claim within entitlement is fully allowed', () => {
  const result = evaluateExpenseAgainstPolicy({ category: 'Hotel', claimedAmount: 3000, entitlement: manager, quantity: 1 });
  assert.equal(result.limit, 3500);
  assert.equal(result.allowedAmount, 3000);
  assert.equal(result.disallowedAmount, 0);
  assert.equal(result.exceedsLimit, false);
});

test('a hotel claim above entitlement splits into allowed and disallowed without touching the claim', () => {
  const result = evaluateExpenseAgainstPolicy({ category: 'Hotel', claimedAmount: 5000, entitlement: manager, quantity: 1 });
  assert.equal(result.claimedAmount, 5000);
  assert.equal(result.allowedAmount, 3500);
  assert.equal(result.disallowedAmount, 1500);
  assert.equal(result.exceedsLimit, true);
});

test('the hotel cap scales with nights', () => {
  const result = evaluateExpenseAgainstPolicy({ category: 'Hotel', claimedAmount: 9000, entitlement: manager, quantity: 3 });
  assert.equal(result.limit, 10500);
  assert.equal(result.disallowedAmount, 0);
});

test('a category with no cap basis is uncapped and left to approval', () => {
  const result = evaluateExpenseAgainstPolicy({ category: 'Taxi', claimedAmount: 800, entitlement: manager });
  assert.equal(result.limit, null);
  assert.equal(result.allowedAmount, 800);
  assert.equal(result.disallowedAmount, 0);
});

test('a missing entitlement row is reported as needing an exception, not treated as unlimited', () => {
  const result = evaluateExpenseAgainstPolicy({ category: 'Hotel', claimedAmount: 5000, entitlement: undefined });
  assert.equal(result.limit, null);
  assert.match(result.note, /exception approval/i);
});

test('an explicit category cap overrides the entitlement basis', () => {
  const result = evaluateExpenseAgainstPolicy({ category: 'Hotel', claimedAmount: 5000, entitlement: manager, quantity: 1, categoryCap: 2000 });
  assert.equal(result.limit, 2000);
  assert.equal(result.disallowedAmount, 3000);
});

test('a zero local-conveyance entitlement means uncapped, not zero allowed', () => {
  const director = { ...manager, grade: 'Director', localConveyancePerDay: 0 };
  const result = evaluateExpenseAgainstPolicy({ category: 'Local Conveyance', claimedAmount: 2500, entitlement: director, quantity: 2 });
  assert.equal(result.limit, null);
  assert.equal(result.allowedAmount, 2500);
});

/* ── duplicate bills ─────────────────────────────────────────────────────────────────────────── */

test('bill fingerprints ignore punctuation and case in the vendor and invoice number', () => {
  const a = billFingerprint({ vendor: 'Hotel Blue Sky', invoiceNumber: 'INV-4471', invoiceDate: '2026-08-22', amount: 5000 });
  const b = billFingerprint({ vendor: 'hotel blue sky', invoiceNumber: 'inv 4471', invoiceDate: '2026-08-22', amount: 5000 });
  assert.equal(a, b);
});

test('the same invoice submitted twice is grouped as a duplicate', () => {
  const groups = findDuplicateBills([
    { id: 'a', vendor: 'Hotel Blue Sky', invoiceNumber: 'INV-4471', invoiceDate: '2026-08-22', amount: 5000 },
    { id: 'b', vendor: 'Hotel Blue Sky', invoiceNumber: 'INV-4471', invoiceDate: '2026-08-22', amount: 5000 },
    { id: 'c', vendor: 'Hotel Blue Sky', invoiceNumber: 'INV-4472', invoiceDate: '2026-08-23', amount: 5000 },
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].records.map(r => r.id), ['a', 'b']);
});

test('an identical uploaded image is caught even when the typed details differ', () => {
  const groups = findDuplicateBills([
    { id: 'a', vendor: 'Blue Sky', invoiceNumber: 'INV-1', invoiceDate: '2026-08-22', amount: 5000, fileHash: 'h1' },
    { id: 'b', vendor: 'Blue Sky Hotel', invoiceNumber: 'INV-2', invoiceDate: '2026-08-23', amount: 5100, fileHash: 'h1' },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].records.length, 2);
});

test('bills with no invoice identity are not duplicates of each other', () => {
  const groups = findDuplicateBills([
    { id: 'a', vendor: '', invoiceNumber: '', amount: 300 },
    { id: 'b', vendor: '', invoiceNumber: '', amount: 300 },
  ]);
  assert.equal(groups.length, 0);
});

/* ── settlement ──────────────────────────────────────────────────────────────────────────────── */

test('scenario A — the company owes the employee', () => {
  const summary = summarizeSettlement({
    items: [{ claimedAmount: 25000, approvedAmount: 25000 }],
    advancePaid: 20000,
  });
  assert.equal(summary.net, 5000);
  assert.equal(summary.payableToEmployee, 5000);
  assert.equal(summary.recoverableFromEmployee, 0);
  assert.equal(summary.outcome, 'Payable to employee');
});

test('scenario B — nil settlement', () => {
  const summary = summarizeSettlement({ items: [{ claimedAmount: 20000, approvedAmount: 20000 }], advancePaid: 20000 });
  assert.equal(summary.net, 0);
  assert.equal(summary.outcome, 'Nil settlement');
});

test('scenario C — the employee owes the company', () => {
  const summary = summarizeSettlement({ items: [{ claimedAmount: 16000, approvedAmount: 16000 }], advancePaid: 20000 });
  assert.equal(summary.net, -4000);
  assert.equal(summary.recoverableFromEmployee, 4000);
  assert.equal(summary.payableToEmployee, 0);
  assert.equal(summary.outcome, 'Recoverable from employee');
});

test('settlement is driven by the approved amount, not the claimed amount', () => {
  // Claimed 25,000 but only 22,000 allowed against a 20,000 advance: the employee gets 2,000,
  // not the 5,000 they asked for.
  const summary = summarizeSettlement({
    items: [{ claimedAmount: 25000, approvedAmount: 22000 }],
    advancePaid: 20000,
  });
  assert.equal(summary.totalClaimed, 25000);
  assert.equal(summary.totalApproved, 22000);
  assert.equal(summary.totalDisallowed, 3000);
  assert.equal(summary.payableToEmployee, 2000);
});

test('company-paid lines count toward the tour cost but are deducted, never reimbursed', () => {
  const summary = summarizeSettlement({
    items: [
      { claimedAmount: 17100, approvedAmount: 17100 },
      { claimedAmount: 5000, approvedAmount: 5000, paidByCompany: true },
    ],
    advancePaid: 15000,
  });
  assert.equal(summary.totalApproved, 22100);
  assert.equal(summary.companyPaid, 5000);
  assert.equal(summary.payableToEmployee, 2100);
});

test('an unverified line settles at its claimed value so a draft statement is not zero', () => {
  const summary = summarizeSettlement({ items: [{ claimedAmount: 8000, approvedAmount: null }], advancePaid: 0 });
  assert.equal(summary.totalApproved, 8000);
  assert.equal(summary.payableToEmployee, 8000);
});

test('a fully disallowed line drops out of the approved total', () => {
  const summary = summarizeSettlement({
    items: [{ claimedAmount: 8000, approvedAmount: 8000 }, { claimedAmount: 2000, approvedAmount: 0 }],
    advancePaid: 0,
  });
  assert.equal(summary.totalClaimed, 10000);
  assert.equal(summary.totalApproved, 8000);
  assert.equal(summary.totalDisallowed, 2000);
});

/* ── estimate ────────────────────────────────────────────────────────────────────────────────── */

test('the tour estimate derives hotel from nights and DA from the journey window', () => {
  const estimate = estimateTourCost({
    travel: 8000,
    nights: 2,
    entitlement: manager,
    departureAt: '2026-08-21T20:30',
    returnAt: '2026-08-23T18:00',
    localTransport: 2000,
    miscellaneous: 1000,
  });
  assert.equal(estimate.hotel, 7000); // 2 nights × 3500
  assert.equal(estimate.dailyAllowance, 2000); // 45.5h → 1 full day + 100% of 21.5h remainder
  assert.equal(estimate.total, 20000);
});

test('an explicit hotel tariff overrides the entitlement-derived one', () => {
  const estimate = estimateTourCost({ travel: 0, nights: 2, hotelRatePerNight: 3000, entitlement: manager });
  assert.equal(estimate.hotel, 6000);
});

/* ── approval matrix ─────────────────────────────────────────────────────────────────────────── */

const stage = (name) => ({ id: name, name, assignmentType: 'User-based', assignedTo: [`user-${name}`], tat: 24 });

const approvalRules = [
  { id: 'small', organizationId: 'org', name: 'Up to 10k', minAmount: 0, maxAmount: 10000, tourTypes: [], international: null, stages: [stage('Manager'), stage('HOD')], active: true },
  { id: 'mid', organizationId: 'org', name: '10k to 50k', minAmount: 10000, maxAmount: 50000, tourTypes: [], international: null, stages: [stage('Manager'), stage('HOD'), stage('Finance')], active: true },
  { id: 'large', organizationId: 'org', name: 'Above 50k', minAmount: 50000, maxAmount: null, tourTypes: [], international: null, stages: [stage('Manager'), stage('HOD'), stage('Finance'), stage('Director')], active: true },
  { id: 'intl', organizationId: 'org', name: 'International', minAmount: 0, maxAmount: null, tourTypes: [], international: true, stages: [stage('HOD'), stage('Finance'), stage('Director'), stage('MD')], active: true },
];

test('the amount band selects the chain', () => {
  assert.equal(resolveApprovalChain(approvalRules, { amount: 8000 }).length, 2);
  assert.equal(resolveApprovalChain(approvalRules, { amount: 24700 }).length, 3);
  assert.equal(resolveApprovalChain(approvalRules, { amount: 90000 }).length, 4);
});

test('a narrow override beats a broad band regardless of creation order', () => {
  // An 8,000 international tour matches both "Up to 10k" and "International"; the more specific
  // international rule has to win, or a foreign trip would clear on two approvals.
  const chain = resolveApprovalChain(approvalRules, { amount: 8000, isInternational: true });
  assert.deepEqual(chain.map(s => s.name), ['HOD', 'Finance', 'Director', 'MD']);
});

test('a domestic tour does not pick up the international rule', () => {
  const chain = resolveApprovalChain(approvalRules, { amount: 8000, isInternational: false });
  assert.deepEqual(chain.map(s => s.name), ['Manager', 'HOD']);
});

test('band boundaries are inclusive at both ends', () => {
  assert.equal(resolveApprovalChain(approvalRules, { amount: 10000 }).length, 2);
  assert.equal(resolveApprovalChain(approvalRules, { amount: 50000 }).length, 3);
});

test('an inactive rule is ignored and an unmatched tour returns an empty chain', () => {
  const inactive = approvalRules.map(rule => ({ ...rule, active: false }));
  assert.deepEqual(resolveApprovalChain(inactive, { amount: 8000 }), []);
  assert.deepEqual(resolveApprovalChain([], { amount: 8000 }), []);
});

test('a project-scoped rule beats an equally-broad unscoped one', () => {
  const rules = [
    { id: 'a', organizationId: 'org', name: 'Any project', minAmount: 0, maxAmount: null, tourTypes: [], international: null, stages: [stage('Manager')], active: true },
    { id: 'b', organizationId: 'org', name: 'TPSODL only', minAmount: 0, maxAmount: null, tourTypes: [], international: null, projectId: 'p1', stages: [stage('Manager'), stage('PM')], active: true },
  ];
  assert.equal(resolveApprovalChain(rules, { amount: 5000, projectId: 'p1' }).length, 2);
  assert.equal(resolveApprovalChain(rules, { amount: 5000, projectId: 'p2' }).length, 1);
});

/* ── stage approvers ─────────────────────────────────────────────────────────────────────────── */

const tour = { employeeUserId: 'u-emp', reportingManagerId: 'u-mgr', hodId: 'u-hod', projectManagerId: 'u-pm' };

test('each assignment type resolves to the right person', () => {
  assert.deepEqual(resolveStageApprovers({ id: '1', name: 'RM', assignmentType: 'Reporting Manager', assignedTo: [], tat: 24 }, tour), ['u-mgr']);
  assert.deepEqual(resolveStageApprovers({ id: '2', name: 'HOD', assignmentType: 'HOD', assignedTo: [], tat: 24 }, tour), ['u-hod']);
  assert.deepEqual(resolveStageApprovers({ id: '3', name: 'PM', assignmentType: 'Project Manager', assignedTo: [], tat: 24 }, tour), ['u-pm']);
  assert.deepEqual(resolveStageApprovers({ id: '4', name: 'Users', assignmentType: 'User-based', assignedTo: ['u-a', 'u-b'], tat: 24 }, tour), ['u-a', 'u-b']);
});

test('a role-based stage expands to the role members', () => {
  const stageDef = { id: '5', name: 'Finance', assignmentType: 'Role-based', assignedTo: ['Finance'], tat: 24 };
  assert.deepEqual(resolveStageApprovers(stageDef, tour, { Finance: ['u-fin1', 'u-fin2'] }), ['u-fin1', 'u-fin2']);
});

test('the traveller is removed from their own approval stage', () => {
  // A manager raising their own tour must not be handed their own approval (control rule 51.14).
  const selfTour = { ...tour, reportingManagerId: 'u-emp' };
  assert.deepEqual(resolveStageApprovers({ id: '1', name: 'RM', assignmentType: 'Reporting Manager', assignedTo: [], tat: 24 }, selfTour), []);
});

test('duplicate approvers collapse to one', () => {
  const stageDef = { id: '6', name: 'Finance', assignmentType: 'Role-based', assignedTo: ['Finance', 'Accounts'], tat: 24 };
  assert.deepEqual(resolveStageApprovers(stageDef, tour, { Finance: ['u-fin'], Accounts: ['u-fin'] }), ['u-fin']);
});

test('a stage naming nobody resolves to an empty list rather than a placeholder', () => {
  assert.deepEqual(resolveStageApprovers({ id: '1', name: 'PM', assignmentType: 'Project Manager', assignedTo: [], tat: 24 }, { employeeUserId: 'u-emp' }), []);
});

/* ── outstanding advance control ─────────────────────────────────────────────────────────────── */

const asOf = at('2026-08-21T10:00:00');

test('no open advance allows a new one', () => {
  const check = evaluateOutstandingAdvances([], { asOf, overdueAfterDays: 15, policy: 'Block' });
  assert.equal(check.action, 'Allow');
  assert.equal(check.outstandingAmount, 0);
});

test('a fully settled advance is not outstanding', () => {
  const check = evaluateOutstandingAdvances(
    [{ referenceNumber: 'TA/1', paidAmount: 20000, settledAmount: 20000, paidOn: '2026-06-01', status: 'SETTLED' }],
    { asOf, overdueAfterDays: 15, policy: 'Block' },
  );
  assert.equal(check.action, 'Allow');
});

test('an outstanding but not yet overdue advance only warns', () => {
  const check = evaluateOutstandingAdvances(
    [{ referenceNumber: 'TA/2', paidAmount: 20000, settledAmount: 0, paidOn: '2026-08-15', status: 'PAID' }],
    { asOf, overdueAfterDays: 15, policy: 'Block' },
  );
  assert.equal(check.action, 'Warn');
  assert.equal(check.outstandingAmount, 20000);
});

test('an overdue advance applies the configured policy and reports the age', () => {
  const check = evaluateOutstandingAdvances(
    [{ referenceNumber: 'TR-2026-00341', paidAmount: 18500, settledAmount: 0, paidOn: '2026-07-15', status: 'PAID' }],
    { asOf, overdueAfterDays: 15, policy: 'Require Finance override' },
  );
  assert.equal(check.action, 'Require Finance override');
  assert.equal(check.oldestAgeDays, 37);
  assert.equal(check.oldestReference, 'TR-2026-00341');
  assert.match(check.message, /18500 outstanding from TR-2026-00341 for 37 days/);
});

test('a part-settled advance is outstanding for the balance only', () => {
  const check = evaluateOutstandingAdvances(
    [{ referenceNumber: 'TA/3', paidAmount: 20000, settledAmount: 15000, paidOn: '2026-08-18', status: 'PARTIALLY_SETTLED' }],
    { asOf, overdueAfterDays: 15, policy: 'Block' },
  );
  assert.equal(check.outstandingAmount, 5000);
});

test('an approved but unpaid advance does not block a new one', () => {
  // The employee is not holding this money yet, so blocking on it would stall a legitimate tour.
  const check = evaluateOutstandingAdvances(
    [{ referenceNumber: 'TA/4', paidAmount: 0, settledAmount: 0, paidOn: null, status: 'PAYMENT_PENDING' }],
    { asOf, overdueAfterDays: 15, policy: 'Block' },
  );
  assert.equal(check.action, 'Allow');
});

/* ── advance ageing ──────────────────────────────────────────────────────────────────────────── */

test('ageing buckets follow the report boundaries', () => {
  assert.equal(advanceAgeingBucket(0), '0-7');
  assert.equal(advanceAgeingBucket(7), '0-7');
  assert.equal(advanceAgeingBucket(8), '8-15');
  assert.equal(advanceAgeingBucket(15), '8-15');
  assert.equal(advanceAgeingBucket(30), '16-30');
  assert.equal(advanceAgeingBucket(60), '31-60');
  assert.equal(advanceAgeingBucket(61), '>60');
});

test('ageing totals only count the unsettled balance', () => {
  const summary = summarizeAdvanceAgeing(
    [
      { paidAmount: 10000, settledAmount: 0, paidOn: '2026-08-18' },
      { paidAmount: 20000, settledAmount: 5000, paidOn: '2026-07-01' },
      { paidAmount: 8000, settledAmount: 8000, paidOn: '2026-05-01' },
    ],
    asOf,
  );
  assert.deepEqual(summary['0-7'], { count: 1, amount: 10000 });
  assert.deepEqual(summary['31-60'], { count: 1, amount: 15000 });
  assert.deepEqual(summary['>60'], { count: 0, amount: 0 });
});

test('an advance with no payment date still appears, so the report reconciles with the dashboard', () => {
  const summary = summarizeAdvanceAgeing([{ paidAmount: 5000, settledAmount: 0, paidOn: null }], asOf);
  assert.equal(summary['0-7'].amount, 5000);
});

/* ── closure gate ────────────────────────────────────────────────────────────────────────────── */

const closureReady = {
  travelCompleted: true,
  claimSubmitted: true,
  claimApproved: true,
  advanceOutstanding: 0,
  recoveryOutstanding: 0,
  reimbursementOutstanding: 0,
  financePosted: true,
};

test('a tour closes only when every component is done', () => {
  assert.equal(evaluateTourClosure(closureReady).ready, true);
  assert.deepEqual(evaluateTourClosure(closureReady).blockers, []);
});

test('an unsettled advance blocks closure', () => {
  const readiness = evaluateTourClosure({ ...closureReady, advanceOutstanding: 5000 });
  assert.equal(readiness.ready, false);
  assert.match(readiness.blockers[0], /advance of 5000 is unsettled/);
});

test('every blocker is reported at once rather than one per attempt', () => {
  const readiness = evaluateTourClosure({
    travelCompleted: false,
    claimSubmitted: false,
    claimApproved: false,
    advanceOutstanding: 1000,
    recoveryOutstanding: 500,
    reimbursementOutstanding: 200,
    financePosted: false,
  });
  assert.equal(readiness.ready, false);
  assert.equal(readiness.blockers.length, 7);
});

/* ── expense window ──────────────────────────────────────────────────────────────────────────── */

const window = { departureDate: '2026-08-21', returnDate: '2026-08-24' };

test('an expense inside the approved window passes', () => {
  assert.equal(isExpenseWithinTourWindow('2026-08-22', window).withinWindow, true);
});

test('the tolerance covers an airport taxi the night before departure', () => {
  assert.equal(isExpenseWithinTourWindow('2026-08-20', window, 1).withinWindow, true);
  assert.equal(isExpenseWithinTourWindow('2026-08-25', window, 1).withinWindow, true);
});

test('an expense well outside the window is flagged with a reason', () => {
  const before = isExpenseWithinTourWindow('2026-08-15', window, 1);
  assert.equal(before.withinWindow, false);
  assert.match(before.reason, /before the approved departure/);
  const after = isExpenseWithinTourWindow('2026-09-02', window, 1);
  assert.equal(after.withinWindow, false);
  assert.match(after.reason, /after the approved return/);
});

test('a tour with unknown dates is not checked rather than being flagged wholesale', () => {
  assert.equal(isExpenseWithinTourWindow('2026-08-22', { departureDate: null, returnDate: null }).withinWindow, true);
});
