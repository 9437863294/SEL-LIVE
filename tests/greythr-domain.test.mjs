import test from 'node:test';
import assert from 'node:assert/strict';
// Imported from the pure rules module rather than the client or the service, which pull in `fetch`
// against greytHR and the Admin SDK respectively.
import {
  DEFAULT_DETAIL_GROUPS,
  DEFAULT_EMPLOYMENT_TYPE_LABELS,
  DEFAULT_SYNC_SETTINGS,
  EMPLOYEE_DETAIL_GROUPS,
  GREYTHR_ADDRESS_TYPES,
  GREYTHR_IDENTITY_CODES,
  EXIT_ACCESS_POLICIES,
  GREYTHR_CATEGORY,
  GREYTHR_CATEGORY_LOV_KEYS,
  buildCategoryIdMaps,
  buildCategoryWriteBody,
  buildOperationalDetail,
  buildSensitiveDetail,
  buildSyncedEmployee,
  describeSchedule,
  employeeSearchText,
  hasSensitiveDetail,
  indexUsersByEmployeeId,
  isOfferableForNewUser,
  isSensitiveGroup,
  maskIdentifier,
  resolveReportingManager,
  offerExclusionReason,
  toLinkableEmployee,
  deriveEmploymentState,
  diffSyncedEmployee,
  employmentSignals,
  employmentTypeLabel,
  employmentTypeLabels,
  hasExited,
  indexUsersByEmail,
  isSyncDue,
  isWorkingState,
  matchUserForEmployee,
  modifiedSinceFor,
  normalizeCategories,
  normalizeSyncSettings,
  resolveAccessDecision,
  resolveAllCategoriesAt,
  resolveCategoryAt,
  sanitizeGreytHRDate,
  shouldDeactivateOnResignation,
  summarizeRun,
  todayIso,
} from '../src/lib/greythr.ts';

const TODAY = '2026-08-25';

/* ------------------------------------------------------------------------------------------------
 * The four bugs this integration replaces
 * ---------------------------------------------------------------------------------------------- */

test('BUG 1: a numeric greytHR status never means Inactive', () => {
  // The previous sync did `empData.status === 'Active' ? 'Active' : 'Inactive'` against a number,
  // so every employee in the system was written Inactive. Employment type must not touch state.
  for (const code of [1, 2, 3, 4]) {
    const record = buildSyncedEmployee({
      employee: { employeeId: 1, name: 'Working Person', status: code, leftorg: false },
      onDate: TODAY,
    });
    assert.equal(record.status, 'Active', `status code ${code} must not imply Inactive`);
    assert.equal(record.employmentState, 'Active');
  }
});

test('BUG 1b: employment type is resolved through lov::status, not compared to a string', () => {
  const labels = employmentTypeLabels({
    'lov::status': [
      [2, 'Confirmed'],
      [3, 'Contract'],
      [1, 'Probation'],
      [4, 'Trainee'],
    ],
  });
  assert.deepEqual(labels, { 1: 'Probation', 2: 'Confirmed', 3: 'Contract', 4: 'Trainee' });

  const record = buildSyncedEmployee({
    employee: { employeeId: 7, name: 'Contractor', status: 3 },
    employmentTypeLabels: labels,
    onDate: TODAY,
  });
  assert.equal(record.employmentType, 'Contract');
  assert.equal(record.employmentTypeCode, '3');
  assert.equal(record.status, 'Active', 'employment type says nothing about access');
});

test('lov::status falls back to greytHR defaults when the LOV call fails', () => {
  assert.deepEqual(employmentTypeLabels(null), DEFAULT_EMPLOYMENT_TYPE_LABELS);
  assert.deepEqual(employmentTypeLabels({ 'lov::status': [] }), DEFAULT_EMPLOYMENT_TYPE_LABELS);
  assert.equal(employmentTypeLabel(2, DEFAULT_EMPLOYMENT_TYPE_LABELS), 'Confirmed');
  // An unknown code shows the code rather than an empty cell — the reader can look it up.
  assert.equal(employmentTypeLabel(99, DEFAULT_EMPLOYMENT_TYPE_LABELS), '99');
  assert.equal(employmentTypeLabel(null, DEFAULT_EMPLOYMENT_TYPE_LABELS), '');
});

test('BUG 2: an existing employee record is diffed and updated, not skipped', () => {
  const stored = {
    employeeId: '83',
    name: 'Nandish Shetty',
    designation: 'Engineer',
    department: 'Projects',
    status: 'Active',
  };
  const fresh = buildSyncedEmployee({
    employee: { employeeId: 83, name: 'Nandish Shetty', status: 2 },
    categories: [
      { categoryDesc: 'Designation', valueDesc: 'Senior Engineer', effectiveFrom: '2026-04-01', effectiveTo: null },
      { categoryDesc: 'Department', valueDesc: 'Projects', effectiveFrom: '2020-01-01', effectiveTo: null },
    ],
    onDate: TODAY,
  });

  const deltas = diffSyncedEmployee(stored, fresh);
  const fields = deltas.map((d) => d.field);
  assert.ok(fields.includes('designation'), 'a promotion must be detected');
  assert.ok(!fields.includes('department'), 'an unchanged field must not be reported');
  assert.deepEqual(
    deltas.find((d) => d.field === 'designation'),
    { field: 'designation', from: 'Engineer', to: 'Senior Engineer' },
  );
});

test('BUG 2b: an unchanged employee produces no writes', () => {
  const fresh = buildSyncedEmployee({
    employee: { employeeId: 5, name: 'Steady Person', email: 'a@b.com', status: 2 },
    onDate: TODAY,
    syncedAt: '2026-08-25T02:00:00.000Z',
  });
  // syncedAt always changes and must never on its own count as a change.
  const again = { ...fresh, syncedAt: '2026-08-26T02:00:00.000Z' };
  assert.deepEqual(diffSyncedEmployee(again, fresh), []);
});

test('BUG 3: a resigned employee is fetched and reflected, not invisible', () => {
  const record = buildSyncedEmployee({
    employee: { employeeId: 20, name: 'Gone Person', status: 2, leftorg: true, leavingDate: '2026-08-01' },
    separation: { employeeId: 20, leftOrg: true, leavingDate: '2026-08-01', finalSettlementDate: null },
    onDate: TODAY,
  });
  assert.equal(record.employmentState, 'Relieved');
  assert.equal(record.status, 'Inactive');
  assert.equal(record.exitDate, '2026-08-01');
});

/* ------------------------------------------------------------------------------------------------
 * Employment state derivation
 * ---------------------------------------------------------------------------------------------- */

test('an employee with nothing on file is Active', () => {
  const result = deriveEmploymentState({ leftOrg: false }, TODAY);
  assert.equal(result.state, 'Active');
  assert.equal(result.exitDate, null);
  assert.ok(isWorkingState(result.state));
});

test('a future leaving date is Notice Period, even when leftOrg is already true', () => {
  // greytHR flips leftOrg when the resignation is recorded, not when the person actually leaves.
  // Treating that as gone would lock out a colleague who is still at their desk.
  const result = deriveEmploymentState(
    { leftOrg: true, leavingDate: '2026-09-30', submittedResignation: true, submissionDate: '2026-08-01' },
    TODAY,
  );
  assert.equal(result.state, 'Notice Period');
  assert.equal(result.exitDate, '2026-09-30');
  assert.equal(result.resignationDate, '2026-08-01');
  assert.ok(isWorkingState(result.state));
});

test('a past leaving date is Relieved', () => {
  const result = deriveEmploymentState({ leftOrg: true, leavingDate: '2026-08-01' }, TODAY);
  assert.equal(result.state, 'Relieved');
  assert.ok(hasExited(result.state));
});

test('the leaving date boundary is inclusive — the last working day is still Relieved', () => {
  assert.equal(deriveEmploymentState({ leavingDate: TODAY }, TODAY).state, 'Relieved');
  assert.equal(deriveEmploymentState({ leavingDate: '2026-08-26' }, TODAY).state, 'Notice Period');
});

test('a completed settlement is Settled and outranks Relieved', () => {
  const result = deriveEmploymentState(
    { leftOrg: true, leavingDate: '2026-07-01', finalSettlementDate: '2026-07-20' },
    TODAY,
  );
  assert.equal(result.state, 'Settled');
  assert.match(result.reason, /settlement completed on 2026-07-20/);
});

test('a retirement date with no leaving date is Retired', () => {
  const result = deriveEmploymentState({ retirementDate: '2026-06-30' }, TODAY);
  assert.equal(result.state, 'Retired');
  assert.equal(result.exitDate, '2026-06-30');
});

test('a submitted resignation with no dates at all is Notice Period', () => {
  const result = deriveEmploymentState({ submittedResignation: true }, TODAY);
  assert.equal(result.state, 'Notice Period');
  assert.equal(result.exitDate, null);
  assert.ok(isWorkingState(result.state), 'they are still working — access must not be cut');
});

test('a passed tentative date without a confirmed leaving date stays Notice Period', () => {
  // greytHR calls it tentative; this integration does not cut access on a date the source system
  // has not confirmed.
  const result = deriveEmploymentState({ tentativeLeavingDate: '2026-08-10', submittedResignation: true }, TODAY);
  assert.equal(result.state, 'Notice Period');
  assert.match(result.reason, /tentative/i);
});

test('leftOrg with no usable date is Left, not Active', () => {
  const result = deriveEmploymentState({ leftOrg: true }, TODAY);
  assert.equal(result.state, 'Left');
  assert.ok(hasExited(result.state));
});

test('a missing record is Unknown, never Active', () => {
  assert.equal(deriveEmploymentState(null, TODAY).state, 'Unknown');
  assert.equal(deriveEmploymentState(undefined, TODAY).state, 'Unknown');
});

test('employmentSignals reconciles leftorg and leftOrg across the two endpoints', () => {
  // The roster spells it `leftorg`; the separation endpoint spells it `leftOrg`.
  const fromRoster = employmentSignals({ employeeId: 1, leftorg: true }, null);
  assert.equal(fromRoster.leftOrg, true);

  const fromSeparation = employmentSignals({ employeeId: 1, leftorg: false }, { employeeId: 1, leftOrg: true });
  assert.equal(fromSeparation.leftOrg, true, 'the separation record is the more specific source');

  assert.equal(employmentSignals(null, null), null);
});

test('separation data wins over the roster for the leaving date', () => {
  const signals = employmentSignals(
    { employeeId: 1, leavingDate: '2026-01-01' },
    { employeeId: 1, leavingDate: '2026-09-30' },
  );
  assert.equal(signals.leavingDate, '2026-09-30');
});

/* ------------------------------------------------------------------------------------------------
 * Corrupt dates — real values from greytHR's own documented samples
 * ---------------------------------------------------------------------------------------------- */

test('a year outside a sane range is treated as absent, not as the first century', () => {
  // "0018-05-31" and "0014-02-17" appear in greytHR's own published response samples.
  assert.equal(sanitizeGreytHRDate('0018-05-31'), null);
  assert.equal(sanitizeGreytHRDate('0014-02-17'), null);
  assert.equal(sanitizeGreytHRDate('2018-05-31'), '2018-05-31');
});

test('a corrupt confirm date does not relieve a working employee', () => {
  const result = deriveEmploymentState({ leavingDate: '0014-02-17' }, TODAY);
  assert.equal(result.state, 'Active', 'a nonsense date must not read as an exit fourteen centuries ago');
});

test('sanitizeGreytHRDate rejects malformed and blank input', () => {
  for (const bad of [null, undefined, '', '  ', 'not-a-date', '2026-13-01', '2026-00-10', '2026-01-32']) {
    assert.equal(sanitizeGreytHRDate(bad), null, `${JSON.stringify(bad)} must be rejected`);
  }
  assert.equal(sanitizeGreytHRDate('2026-08-25T10:00:00.000'), '2026-08-25', 'a timestamp yields its date');
});

test('todayIso is a civil date, not a UTC instant', () => {
  assert.match(todayIso(new Date(2026, 7, 25, 23, 30)), /^2026-08-25$/);
});

/* ------------------------------------------------------------------------------------------------
 * Categories — designation, department, project
 * ---------------------------------------------------------------------------------------------- */

const PROMOTED = [
  { categoryDesc: 'Designation', valueDesc: 'Engineer', effectiveFrom: '2022-01-01', effectiveTo: '2026-03-31' },
  { categoryDesc: 'Designation', valueDesc: 'Senior Engineer', effectiveFrom: '2026-04-01', effectiveTo: null },
  { categoryDesc: 'Department', valueDesc: 'Projects', effectiveFrom: '2022-01-01', effectiveTo: null },
  { categoryDesc: 'Project Name', valueDesc: 'Rayagada', effectiveFrom: '2025-06-01', effectiveTo: null },
  { categoryDesc: 'Location', valueDesc: 'Bhubaneswar', effectiveFrom: '2022-01-01', effectiveTo: null },
];

test('the current designation is the window containing today, not the first row', () => {
  const categories = normalizeCategories(PROMOTED);
  assert.equal(resolveCategoryAt(categories, 'Designation', TODAY).value, 'Senior Engineer');
  // And history still resolves correctly for an as-at date.
  assert.equal(resolveCategoryAt(categories, 'Designation', '2023-06-01').value, 'Engineer');
});

test('a closed window does not apply after its effectiveTo', () => {
  const categories = normalizeCategories([
    { categoryDesc: 'Project Name', valueDesc: 'Phulbani', effectiveFrom: '2024-01-01', effectiveTo: '2025-12-31' },
  ]);
  assert.equal(resolveCategoryAt(categories, 'Project Name', TODAY), null);
  assert.equal(resolveCategoryAt(categories, 'Project Name', '2025-06-01').value, 'Phulbani');
});

test('among overlapping open windows the latest effectiveFrom wins', () => {
  const categories = normalizeCategories([
    { categoryDesc: 'Designation', valueDesc: 'Old', effectiveFrom: '2020-01-01', effectiveTo: null },
    { categoryDesc: 'Designation', valueDesc: 'New', effectiveFrom: '2026-01-01', effectiveTo: null },
  ]);
  assert.equal(resolveCategoryAt(categories, 'Designation', TODAY).value, 'New');
});

test('category lookup is case-insensitive', () => {
  const categories = normalizeCategories(PROMOTED);
  assert.equal(resolveCategoryAt(categories, 'designation', TODAY).value, 'Senior Engineer');
});

test('resolveAllCategoriesAt returns one current value per category', () => {
  const resolved = resolveAllCategoriesAt(normalizeCategories(PROMOTED), TODAY);
  assert.deepEqual(resolved, {
    Designation: 'Senior Engineer',
    Department: 'Projects',
    'Project Name': 'Rayagada',
    Location: 'Bhubaneswar',
  });
});

test('normalizeCategories drops rows it cannot name rather than emitting numeric ids', () => {
  const rows = normalizeCategories([
    { category: 6, value: 12, effectiveFrom: '2026-01-01', effectiveTo: null },
    { categoryDesc: 'Designation', valueDesc: 'Engineer', effectiveFrom: '2026-01-01', effectiveTo: null },
  ]);
  assert.equal(rows.length, 1, 'the id-only row is dropped without a LOV map');
  assert.equal(rows[0].value, 'Engineer');
});

test('normalizeCategories can resolve ids through a LOV map when descRequired was not used', () => {
  const rows = normalizeCategories([{ category: 6, value: 12, effectiveFrom: '2026-01-01', effectiveTo: null }], {
    categoryNamesById: { 6: 'Designation' },
    valueNamesByCategory: { Designation: { 12: 'Site Engineer' } },
  });
  assert.deepEqual(rows, [
    { category: 'Designation', value: 'Site Engineer', effectiveFrom: '2026-01-01', effectiveTo: null },
  ]);
});

test('normalizeCategories tolerates null and non-array input', () => {
  assert.deepEqual(normalizeCategories(null), []);
  assert.deepEqual(normalizeCategories(undefined), []);
});

test('the tenant category keys include the project categories this org uses', () => {
  assert.ok(GREYTHR_CATEGORY_LOV_KEYS.includes('cat::Project Name'));
  assert.ok(GREYTHR_CATEGORY_LOV_KEYS.includes('cat::Project Division'));
  assert.ok(GREYTHR_CATEGORY_LOV_KEYS.includes('cat::Designation'));
  assert.equal(GREYTHR_CATEGORY.projectName, 'Project Name');
});

/* ------------------------------------------------------------------------------------------------
 * The full record
 * ---------------------------------------------------------------------------------------------- */

test('buildSyncedEmployee folds every source into one record', () => {
  const record = buildSyncedEmployee({
    employee: {
      employeeId: 11,
      employeeNo: 'CON-005',
      name: 'Amit Kumar',
      email: '  Amit.Kumar@SELIndia.net ',
      mobile: '9876543210',
      status: 2,
      dateOfJoin: '2018-06-20',
      dateOfBirth: '1989-04-01',
      gender: 'M',
      lastModified: '2026-08-20T03:57:59.402',
    },
    separation: { employeeId: 11, leftOrg: false },
    categories: PROMOTED,
    work: { employeeId: 11, confirmDate: '2019-01-01', noticePeriod: 30 },
    onDate: TODAY,
    syncedAt: '2026-08-25T02:00:00.000Z',
  });

  assert.equal(record.employeeId, '11');
  assert.equal(record.employeeNo, 'CON-005');
  assert.equal(record.email, 'amit.kumar@selindia.net', 'email is trimmed and lower-cased for joining');
  assert.equal(record.status, 'Active');
  assert.equal(record.employmentState, 'Active');
  assert.equal(record.employmentType, 'Confirmed');
  assert.equal(record.designation, 'Senior Engineer');
  assert.equal(record.department, 'Projects');
  assert.equal(record.projectName, 'Rayagada');
  assert.equal(record.location, 'Bhubaneswar');
  assert.equal(record.confirmDate, '2019-01-01');
  assert.equal(record.noticePeriodDays, 30);
  assert.equal(record.greytHRLastModified, '2026-08-20T03:57:59.402');
  assert.equal(record.phone, '9876543210');
});

test('buildSyncedEmployee keeps the legacy field names the existing screens read', () => {
  const record = buildSyncedEmployee({ employee: { employeeId: 1, name: 'X', status: 2 }, onDate: TODAY });
  for (const field of ['employeeId', 'name', 'email', 'phone', 'department', 'designation', 'status', 'dateOfJoin', 'leavingDate', 'dateOfBirth', 'gender', 'employeeNo']) {
    assert.ok(field in record, `${field} must still exist for the Employee Management screens`);
  }
});

test('a missing category leaves the field blank rather than undefined', () => {
  const record = buildSyncedEmployee({ employee: { employeeId: 1, name: 'X', status: 2 }, onDate: TODAY });
  assert.equal(record.designation, '');
  assert.equal(record.projectName, '');
  assert.deepEqual(record.categories, {});
});

test('cost centre falls back to the tenant\'s alternate spelling', () => {
  const record = buildSyncedEmployee({
    employee: { employeeId: 1, name: 'X', status: 2 },
    categories: [{ categoryDesc: 'COST CENTER CODE', valueDesc: 'CC-42', effectiveFrom: '2020-01-01', effectiveTo: null }],
    onDate: TODAY,
  });
  assert.equal(record.costCenter, 'CC-42');
});

/* ------------------------------------------------------------------------------------------------
 * Access policy
 * ---------------------------------------------------------------------------------------------- */

test('the default policy changes nobody\'s access', () => {
  assert.equal(DEFAULT_SYNC_SETTINGS.exitPolicy, 'Flag for review');
  const decision = resolveAccessDecision({
    state: 'Relieved',
    policy: 'Flag for review',
    currentUserStatus: 'Active',
  });
  assert.equal(decision.action, 'none');
  assert.ok(decision.flagForReview);
  assert.match(decision.reason, /review-only/);
});

test('On last working day deactivates a relieved employee', () => {
  const decision = resolveAccessDecision({
    state: 'Relieved',
    policy: 'On last working day',
    currentUserStatus: 'Active',
  });
  assert.equal(decision.action, 'deactivate');
  assert.ok(decision.flagForReview);
});

test('On last working day leaves a notice-period employee working', () => {
  const decision = resolveAccessDecision({
    state: 'Notice Period',
    policy: 'On last working day',
    currentUserStatus: 'Active',
  });
  assert.equal(decision.action, 'none');
  assert.equal(decision.flagForReview, false);
  assert.equal(shouldDeactivateOnResignation('Notice Period', 'On last working day'), false);
});

test('On resignation is the only policy that cuts access during notice', () => {
  assert.ok(shouldDeactivateOnResignation('Notice Period', 'On resignation'));
  assert.equal(shouldDeactivateOnResignation('Active', 'On resignation'), false);
  assert.equal(shouldDeactivateOnResignation('Relieved', 'On resignation'), false, 'already covered by the main path');
});

test('the last administrator is never deactivated automatically', () => {
  const decision = resolveAccessDecision({
    state: 'Relieved',
    policy: 'On last working day',
    currentUserStatus: 'Active',
    wouldStrandAdministration: true,
  });
  assert.equal(decision.action, 'none');
  assert.ok(decision.flagForReview);
  assert.match(decision.reason, /last user who can administer access/);
});

test('the sync only reverses its own deactivations', () => {
  const rehired = resolveAccessDecision({
    state: 'Active',
    policy: 'On last working day',
    currentUserStatus: 'Inactive',
    deactivatedBySync: true,
  });
  assert.equal(rehired.action, 'reactivate');

  const disabledByAdmin = resolveAccessDecision({
    state: 'Active',
    policy: 'On last working day',
    currentUserStatus: 'Inactive',
    deactivatedBySync: false,
  });
  assert.equal(disabledByAdmin.action, 'none');
  assert.ok(disabledByAdmin.flagForReview);
  assert.match(disabledByAdmin.reason, /disabled by an administrator/);
});

test('an already-disabled leaver is not re-disabled and not flagged', () => {
  const decision = resolveAccessDecision({
    state: 'Relieved',
    policy: 'On last working day',
    currentUserStatus: 'Inactive',
  });
  assert.equal(decision.action, 'none');
  assert.equal(decision.flagForReview, false, 'nothing to review — it is already correct');
});

test('an employee who vanished from greytHR is flagged, never auto-deactivated', () => {
  const decision = resolveAccessDecision({
    state: 'Unknown',
    policy: 'On resignation',
    currentUserStatus: 'Active',
  });
  assert.equal(decision.action, 'none');
  assert.ok(decision.flagForReview);
  assert.match(decision.reason, /not proof of an exit/);
});

test('a working employee with no user account produces no action', () => {
  const decision = resolveAccessDecision({ state: 'Active', policy: 'On resignation', currentUserStatus: null });
  assert.equal(decision.action, 'none');
  assert.equal(decision.flagForReview, false);
});

test('every policy is reachable from the settings list', () => {
  assert.deepEqual(EXIT_ACCESS_POLICIES, ['Flag for review', 'On last working day', 'On resignation']);
});

/* ------------------------------------------------------------------------------------------------
 * Scheduling
 * ---------------------------------------------------------------------------------------------- */

const at = (iso) => new Date(iso);

test('a disabled schedule is never due', () => {
  const result = isSyncDue(
    { enabled: false, frequency: 'Hourly', hourOfDay: 2, dayOfWeek: 1 },
    null,
    at('2026-08-25T10:00:00'),
  );
  assert.equal(result.due, false);
  assert.match(result.reason, /switched off/);
});

test('Manual frequency is never due on its own', () => {
  const result = isSyncDue(
    { enabled: true, frequency: 'Manual', hourOfDay: 2, dayOfWeek: 1 },
    null,
    at('2026-08-25T10:00:00'),
  );
  assert.equal(result.due, false);
});

test('a schedule with no previous run is due immediately', () => {
  const result = isSyncDue({ enabled: true, frequency: 'Hourly', hourOfDay: 2, dayOfWeek: 1 }, null);
  assert.equal(result.due, true);
  assert.match(result.reason, /No successful run/);
});

test('Hourly waits an hour', () => {
  const schedule = { enabled: true, frequency: 'Hourly', hourOfDay: 2, dayOfWeek: 1 };
  assert.equal(isSyncDue(schedule, '2026-08-25T10:00:00', at('2026-08-25T10:30:00')).due, false);
  assert.equal(isSyncDue(schedule, '2026-08-25T10:00:00', at('2026-08-25T11:00:00')).due, true);
});

test('a cron firing seconds early does not skip the window', () => {
  // 02:00:03 one day, 01:59:58 the next: without tolerance the second tick is 5s short and the
  // whole day is skipped.
  const schedule = { enabled: true, frequency: 'Daily', hourOfDay: 2, dayOfWeek: 1 };
  const result = isSyncDue(schedule, '2026-08-24T02:00:03', at('2026-08-25T01:59:58'));
  assert.equal(result.due, false, 'still before the configured hour');
  assert.equal(isSyncDue(schedule, '2026-08-24T02:00:03', at('2026-08-25T02:00:00')).due, true);
});

test('Daily holds until the configured hour', () => {
  const schedule = { enabled: true, frequency: 'Daily', hourOfDay: 2, dayOfWeek: 1 };
  assert.equal(isSyncDue(schedule, '2026-08-24T02:00:00', at('2026-08-25T01:00:00')).due, false);
  assert.equal(isSyncDue(schedule, '2026-08-24T02:00:00', at('2026-08-25T02:00:00')).due, true);
  assert.equal(isSyncDue(schedule, '2026-08-24T02:00:00', at('2026-08-25T23:00:00')).due, true);
});

test('Weekly holds for both the day and the hour', () => {
  const schedule = { enabled: true, frequency: 'Weekly', hourOfDay: 2, dayOfWeek: 1 };
  // 2026-08-25 is a Tuesday; 2026-08-31 is a Monday.
  assert.equal(isSyncDue(schedule, '2026-08-17T02:00:00', at('2026-08-25T03:00:00')).due, false, 'wrong day');
  assert.equal(isSyncDue(schedule, '2026-08-17T02:00:00', at('2026-08-31T03:00:00')).due, true);
});

test('Every 6 and 12 hours honour their intervals', () => {
  const six = { enabled: true, frequency: 'Every 6 hours', hourOfDay: 2, dayOfWeek: 1 };
  assert.equal(isSyncDue(six, '2026-08-25T00:00:00', at('2026-08-25T05:00:00')).due, false);
  assert.equal(isSyncDue(six, '2026-08-25T00:00:00', at('2026-08-25T06:00:00')).due, true);

  const twelve = { enabled: true, frequency: 'Every 12 hours', hourOfDay: 2, dayOfWeek: 1 };
  assert.equal(isSyncDue(twelve, '2026-08-25T00:00:00', at('2026-08-25T11:00:00')).due, false);
  assert.equal(isSyncDue(twelve, '2026-08-25T00:00:00', at('2026-08-25T12:00:00')).due, true);
});

test('an unparseable last-run timestamp is treated as never run', () => {
  const result = isSyncDue({ enabled: true, frequency: 'Daily', hourOfDay: 2, dayOfWeek: 1 }, 'not-a-date');
  assert.equal(result.due, true);
});

test('describeSchedule reads as a sentence for every frequency', () => {
  assert.match(describeSchedule({ enabled: false, frequency: 'Daily', hourOfDay: 2, dayOfWeek: 1 }), /off/);
  assert.match(describeSchedule({ enabled: true, frequency: 'Hourly', hourOfDay: 2, dayOfWeek: 1 }), /every hour/);
  assert.match(describeSchedule({ enabled: true, frequency: 'Daily', hourOfDay: 2, dayOfWeek: 1 }), /02:00/);
  assert.match(describeSchedule({ enabled: true, frequency: 'Weekly', hourOfDay: 6, dayOfWeek: 1 }), /Monday.*06:00/);
  assert.match(describeSchedule({ enabled: true, frequency: 'Manual', hourOfDay: 2, dayOfWeek: 1 }), /manual/);
});

/* ------------------------------------------------------------------------------------------------
 * Incremental sync
 * ---------------------------------------------------------------------------------------------- */

test('modifiedSince overlaps the previous run by an hour', () => {
  const value = modifiedSinceFor('2026-08-25T10:00:00.000Z');
  assert.equal(value, '2026-08-25T09:00:00', 'an hour of overlap, seconds precision, no timezone suffix');
});

test('a first run and an explicit full resync fetch everything', () => {
  assert.equal(modifiedSinceFor(null), null);
  assert.equal(modifiedSinceFor(undefined), null);
  assert.equal(modifiedSinceFor('2026-08-25T10:00:00.000Z', { fullResync: true }), null);
  assert.equal(modifiedSinceFor('not-a-date'), null);
});

/* ------------------------------------------------------------------------------------------------
 * Settings
 * ---------------------------------------------------------------------------------------------- */

test('normalizeSyncSettings fills a document written before any field existed', () => {
  const settings = normalizeSyncSettings(null);
  assert.deepEqual(settings.schedule, { enabled: false, frequency: 'Daily', hourOfDay: 2, dayOfWeek: 1 });
  assert.equal(settings.exitPolicy, 'Flag for review');
  assert.equal(settings.mapping.syncEmployeeFacts, true);
  assert.equal(settings.mapping.syncProjectAccess, false, 'granting project access is opt-in');
});

test('normalizeSyncSettings rejects out-of-range and unknown values', () => {
  const settings = normalizeSyncSettings({
    schedule: { enabled: true, frequency: 'Fortnightly', hourOfDay: 99, dayOfWeek: -1 },
    exitPolicy: 'Delete the account',
  });
  assert.equal(settings.schedule.frequency, 'Daily');
  assert.equal(settings.schedule.hourOfDay, 2);
  assert.equal(settings.schedule.dayOfWeek, 1);
  assert.equal(settings.exitPolicy, 'Flag for review');
  assert.equal(settings.schedule.enabled, true, 'the valid field is kept');
});

test('syncEmployeeFacts cannot be switched off', () => {
  const settings = normalizeSyncSettings({ mapping: { syncEmployeeFacts: false, syncAccessMembership: false } });
  assert.equal(settings.mapping.syncEmployeeFacts, true);
  assert.equal(settings.mapping.syncAccessMembership, false, 'but membership can be');
});

/* ------------------------------------------------------------------------------------------------
 * User linking
 * ---------------------------------------------------------------------------------------------- */

test('employees link to users by email, case- and whitespace-insensitively', () => {
  const { index } = indexUsersByEmail([
    { id: 'u1', email: 'Amit.Kumar@SELIndia.net' },
    { id: 'u2', email: 'ravi@selindia.net' },
  ]);
  assert.equal(matchUserForEmployee({ email: 'amit.kumar@selindia.net' }, index), 'u1');
  assert.equal(matchUserForEmployee({ email: ' RAVI@SELINDIA.NET ' }, index), 'u2');
});

test('an employee with no email is never linked', () => {
  const { index } = indexUsersByEmail([{ id: 'u1', email: 'a@b.com' }]);
  assert.equal(matchUserForEmployee({ email: '' }, index), null);
  assert.equal(matchUserForEmployee({ email: '   ' }, index), null);
});

test('a duplicated email links to nobody rather than guessing', () => {
  // Applying one person's resignation to another person's login is the failure being avoided.
  const { index, duplicates } = indexUsersByEmail([
    { id: 'u1', email: 'shared@selindia.net' },
    { id: 'u2', email: 'shared@selindia.net' },
    { id: 'u3', email: 'unique@selindia.net' },
  ]);
  assert.deepEqual(duplicates, ['shared@selindia.net']);
  assert.equal(matchUserForEmployee({ email: 'shared@selindia.net' }, index), null);
  assert.equal(matchUserForEmployee({ email: 'unique@selindia.net' }, index), 'u3');
});

test('users with no email are skipped without breaking the index', () => {
  const { index, duplicates } = indexUsersByEmail([
    { id: 'u1', email: null },
    { id: 'u2', email: '' },
    { id: 'u3', email: 'real@selindia.net' },
  ]);
  assert.equal(index.size, 1);
  assert.deepEqual(duplicates, []);
});

/* ------------------------------------------------------------------------------------------------
 * Run summary
 * ---------------------------------------------------------------------------------------------- */

/* ------------------------------------------------------------------------------------------------
 * Explicit employee ↔ user linking
 * ---------------------------------------------------------------------------------------------- */

test('an explicit employeeId link beats an email match', () => {
  // The account was created by picking this employee, so that decision outranks any inference.
  const { index: byEmail } = indexUsersByEmail([{ id: 'wrong-user', email: 'shared@selindia.net' }]);
  const { index: byEmployeeId } = indexUsersByEmployeeId([{ id: 'right-user', employeeId: '83' }]);

  assert.equal(
    matchUserForEmployee({ employeeId: '83', email: 'shared@selindia.net' }, byEmail, byEmployeeId),
    'right-user',
  );
});

test('email is still used when there is no explicit link', () => {
  const { index: byEmail } = indexUsersByEmail([{ id: 'u1', email: 'amit@selindia.net' }]);
  const { index: byEmployeeId } = indexUsersByEmployeeId([]);
  assert.equal(matchUserForEmployee({ employeeId: '99', email: 'amit@selindia.net' }, byEmail, byEmployeeId), 'u1');
});

test('an employee whose email changed still matches through the explicit link', () => {
  // The failure this exists to prevent: the address changes, the email match silently stops working,
  // and nobody notices until an exit does not take effect.
  const { index: byEmail } = indexUsersByEmail([{ id: 'u1', email: 'old.address@selindia.net' }]);
  const { index: byEmployeeId } = indexUsersByEmployeeId([{ id: 'u1', employeeId: '83' }]);
  assert.equal(matchUserForEmployee({ employeeId: '83', email: 'new.address@selindia.net' }, byEmail, byEmployeeId), 'u1');
});

test('two accounts claiming one employee link to neither', () => {
  const { index, duplicates } = indexUsersByEmployeeId([
    { id: 'u1', employeeId: '83' },
    { id: 'u2', employeeId: '83' },
    { id: 'u3', employeeId: '84' },
  ]);
  assert.deepEqual(duplicates, ['83']);
  assert.equal(index.get('83'), undefined);
  assert.equal(index.get('84'), 'u3');
});

test('indexUsersByEmployeeId skips users with no link', () => {
  const { index } = indexUsersByEmployeeId([
    { id: 'u1' },
    { id: 'u2', employeeId: null },
    { id: 'u3', employeeId: '  ' },
    { id: 'u4', employeeId: '83' },
  ]);
  assert.equal(index.size, 1);
});

test('matchUserForEmployee works without the employeeId index at all', () => {
  const { index: byEmail } = indexUsersByEmail([{ id: 'u1', email: 'a@b.com' }]);
  assert.equal(matchUserForEmployee({ employeeId: '1', email: 'a@b.com' }, byEmail), 'u1');
});

/* ------------------------------------------------------------------------------------------------
 * The employee picker
 * ---------------------------------------------------------------------------------------------- */

const linkable = (overrides = {}) =>
  toLinkableEmployee({
    employeeId: '83',
    employeeNo: 'CON-005',
    name: 'Amit Kumar',
    email: 'amit@selindia.net',
    designation: 'Site Engineer',
    department: 'Projects',
    projectName: 'Rayagada',
    employmentState: 'Active',
    ...overrides,
  });

test('an active employee with no login is offerable', () => {
  assert.equal(isOfferableForNewUser(linkable()), true);
  assert.equal(offerExclusionReason(linkable()), null);
});

test('an employee who already has a login is not offerable', () => {
  const employee = toLinkableEmployee(
    { employeeId: '83', name: 'Amit', employmentState: 'Active' },
    { userId: 'u1', via: 'employeeId' },
  );
  assert.equal(isOfferableForNewUser(employee), false);
  assert.equal(offerExclusionReason(employee), 'Already has a platform login');
});

test('a relieved employee is not offerable', () => {
  const employee = linkable({ employmentState: 'Relieved' });
  assert.equal(isOfferableForNewUser(employee), false);
  assert.match(offerExclusionReason(employee), /Not currently working \(Relieved\)/);
});

test('a notice-period employee is still offerable', () => {
  // They are still working; there are legitimate reasons to create their login during notice.
  assert.equal(isOfferableForNewUser(linkable({ employmentState: 'Notice Period' })), true);
});

test('an employee with no email is still offerable', () => {
  // Excluding them would hide site staff whose address is being created alongside their login.
  assert.equal(isOfferableForNewUser(linkable({ email: '' })), true);
});

test('toLinkableEmployee fills every field so the picker never renders undefined', () => {
  const employee = toLinkableEmployee({ employeeId: '7' });
  assert.equal(employee.name, '');
  assert.equal(employee.designation, '');
  assert.equal(employee.employmentState, 'Unknown');
  assert.equal(employee.linkedUserId, null);
  assert.equal(employee.dateOfJoin, null);
});

test('employeeSearchText matches on every field an administrator might type', () => {
  const text = employeeSearchText(linkable());
  for (const term of ['amit', 'con-005', '83', 'selindia', 'site engineer', 'projects', 'rayagada']) {
    assert.ok(text.includes(term), `search text must contain "${term}"`);
  }
});

/* ------------------------------------------------------------------------------------------------
 * Category id maps and write-back bodies
 * ---------------------------------------------------------------------------------------------- */

const LOV = {
  'lov::transitiontype': [
    [1, 'Location'],
    [2, 'Department'],
    [6, 'Designation'],
    [8, 'Grade'],
  ],
  'cat::Designation': [
    [31, 'Site Engineer'],
    [12, 'Senior Engineer'],
  ],
  'cat::Department': [[28, 'Projects']],
  'cat::Location': [[4, 'Bangalore']],
};

test('buildCategoryIdMaps produces both directions', () => {
  const maps = buildCategoryIdMaps(LOV);
  assert.equal(maps.categoryIdByName.Designation, 6);
  assert.equal(maps.categoryNameById['6'], 'Designation');
  assert.equal(maps.valueNamesByCategory.Designation['31'], 'Site Engineer');
  assert.equal(maps.valueIdsByCategory.Designation['site engineer'], 31);
});

test('buildCategoryIdMaps tolerates a missing or malformed LOV', () => {
  const empty = buildCategoryIdMaps(null);
  assert.deepEqual(empty.categoryIdByName, {});
  const messy = buildCategoryIdMaps({ 'lov::transitiontype': [[null, 'X'], ['nope'], [6, 'Designation']] });
  assert.deepEqual(messy.categoryIdByName, { Designation: 6 });
});

test('the maps resolve a single-employee category response, which carries ids only', () => {
  // GET /employees/{id}/categories returns [{category: 6, value: 31}] with no descriptions.
  const maps = buildCategoryIdMaps(LOV);
  const rows = normalizeCategories(
    [{ category: 6, value: 31, effectiveFrom: '2021-02-19', effectiveTo: null }],
    { categoryNamesById: maps.categoryNameById, valueNamesByCategory: maps.valueNamesByCategory },
  );
  assert.deepEqual(rows, [
    { category: 'Designation', value: 'Site Engineer', effectiveFrom: '2021-02-19', effectiveTo: null },
  ]);
});

test('buildCategoryWriteBody produces the numeric shape greytHR expects', () => {
  const maps = buildCategoryIdMaps(LOV);
  const { list, unresolved } = buildCategoryWriteBody(
    { Designation: 'Site Engineer', Department: 'Projects' },
    maps,
    '2026-08-25',
  );
  assert.deepEqual(unresolved, []);
  assert.deepEqual(list, [
    { category: 6, value: 31, effectiveDate: '2026-08-25' },
    { category: 2, value: 28, effectiveDate: '2026-08-25' },
  ]);
});

test('buildCategoryWriteBody matches value names case-insensitively', () => {
  const { list } = buildCategoryWriteBody({ Designation: '  SITE ENGINEER ' }, buildCategoryIdMaps(LOV), '2026-08-25');
  assert.deepEqual(list, [{ category: 6, value: 31, effectiveDate: '2026-08-25' }]);
});

test('buildCategoryWriteBody reports what it could not resolve rather than dropping it', () => {
  // Writing three of four requested categories and reporting success is worse than refusing.
  const { list, unresolved } = buildCategoryWriteBody(
    { Designation: 'Chief Astronaut', Nonsense: 'X', Department: 'Projects' },
    buildCategoryIdMaps(LOV),
    '2026-08-25',
  );
  assert.deepEqual(list, [{ category: 2, value: 28, effectiveDate: '2026-08-25' }]);
  assert.equal(unresolved.length, 2);
  assert.match(unresolved.find((row) => row.category === 'Designation').reason, /not a configured value/);
  assert.match(unresolved.find((row) => row.category === 'Nonsense').reason, /Unknown category/);
});

test('buildCategoryWriteBody skips blank values silently', () => {
  const { list, unresolved } = buildCategoryWriteBody(
    { Designation: '', Department: 'Projects' },
    buildCategoryIdMaps(LOV),
    '2026-08-25',
  );
  assert.equal(list.length, 1);
  assert.deepEqual(unresolved, []);
});

/* ------------------------------------------------------------------------------------------------
 * Detail groups, and the operational / restricted split
 * ---------------------------------------------------------------------------------------------- */

test('every sensitive group is off by default and every operational one is on', () => {
  // The whole point of the split: nobody's Aadhaar number arrives because a sync was switched on.
  for (const spec of EMPLOYEE_DETAIL_GROUPS) {
    if (spec.destination === 'sensitive') {
      assert.equal(spec.defaultEnabled, false, `${spec.group} is sensitive and must default off`);
    } else {
      assert.equal(spec.defaultEnabled, true, `${spec.group} is operational and should default on`);
    }
    assert.equal(DEFAULT_DETAIL_GROUPS[spec.group], spec.defaultEnabled);
  }
});

test('identity, bank, statutory, address and travel data are all classed restricted', () => {
  for (const group of ['identities', 'bank', 'statutory', 'addresses', 'travel']) {
    assert.equal(isSensitiveGroup(group), true, `${group} must be restricted`);
  }
  for (const group of ['profile', 'personal', 'reporting', 'qualifications', 'assets']) {
    assert.equal(isSensitiveGroup(group), false, `${group} should be operational`);
  }
});

test('a settings document written before a group existed picks up that group\'s default', () => {
  // Critically: it must not default a *sensitive* group on just because it is absent.
  const settings = normalizeSyncSettings({ detailGroups: { profile: false } });
  assert.equal(settings.detailGroups.profile, false, 'an explicit choice is kept');
  assert.equal(settings.detailGroups.personal, true, 'a missing operational group defaults on');
  assert.equal(settings.detailGroups.identities, false, 'a missing sensitive group defaults off');
  assert.equal(settings.detailGroups.bank, false);
});

test('an explicitly enabled sensitive group stays enabled', () => {
  const settings = normalizeSyncSettings({ detailGroups: { bank: true } });
  assert.equal(settings.detailGroups.bank, true);
});

test('the address and identity type lists match what greytHR documents', () => {
  assert.deepEqual([...GREYTHR_ADDRESS_TYPES], [
    'presentaddress',
    'contactaddress',
    'emergencyaddress',
    'spouseaddress',
    'permanentaddress',
  ]);
  for (const code of ['PAN', 'AADHAR', 'PASSPORT', 'BANKACCNO', 'PRAN', 'NPR', 'LWF', 'DL', 'RC', 'EC']) {
    assert.ok(GREYTHR_IDENTITY_CODES.includes(code), `${code} must be requested`);
  }
});

test('buildOperationalDetail assembles the non-restricted half', () => {
  const detail = buildOperationalDetail({
    profile: { employeeId: 11, nickname: 'Amit', biography: ' Site lead ', linkedIn: 'in/amit' },
    personal: { employeeId: 11, bloodGroup: 3, maritalStatus: 1, spouseName: 'Priya' },
    qualifications: [
      { employee: 11, qualDescription: 'B.Tech Civil', institute: 'NIT', qualCompletionYear: 2011, grade: 'First' },
      { employee: 11, qualDescription: '', institute: 'Nowhere' },
    ],
    assets: [
      { employeeId: 11, assetType: 'Laptop', assetId: 'LAP-9', issuedDate: '2024-01-10', returnedOn: null },
      { employeeId: 11, assetType: '', assetId: '' },
    ],
    labels: { bloodGroup: { 3: 'B+' }, maritalStatus: { 1: 'Married' } },
  });

  assert.equal(detail.nickname, 'Amit');
  assert.equal(detail.biography, 'Site lead', 'values are trimmed');
  assert.equal(detail.bloodGroup, 'B+', 'numeric codes resolve through the LOV');
  assert.equal(detail.maritalStatus, 'Married');
  assert.equal(detail.qualifications.length, 1, 'a row with no description is dropped');
  assert.equal(detail.assets.length, 1, 'an empty asset row is dropped');
  assert.equal(detail.assets[0].assetId, 'LAP-9');
});

test('buildOperationalDetail omits empty collections rather than storing []', () => {
  const detail = buildOperationalDetail({});
  assert.equal('qualifications' in detail, false);
  assert.equal('assets' in detail, false);
  assert.deepEqual(detail, {});
});

test('the emergency contact is mirrored into the operational record', () => {
  // Deliberate: the reason to hold an emergency contact is that somebody may need it urgently, so
  // putting it behind a data-protection permission would defeat the purpose.
  const detail = buildOperationalDetail({
    addresses: {
      emergencyaddress: {
        employeeId: 11,
        name: 'Priya Kumar',
        mobile: '9998887777',
        address1: '12 Long Road',
        city: 'Bhubaneswar',
      },
    },
  });
  assert.equal(detail.emergencyContactName, 'Priya Kumar');
  assert.equal(detail.emergencyContactPhone, '9998887777');
  // But not the address itself.
  assert.equal(JSON.stringify(detail).includes('Long Road'), false, 'the address must stay restricted');
});

test('buildSensitiveDetail keeps every restricted field and reports emptiness honestly', () => {
  const detail = buildSensitiveDetail({
    employeeId: '11',
    employeeNo: 'CON-005',
    name: 'Amit Kumar',
    addresses: {
      presentaddress: { employeeId: 11, address1: '12 Long Road', city: 'Bhubaneswar', pin: '751001' },
    },
    statutory: { employeeId: 11, fatherName: 'R Kumar', religion: 2, disabled: false },
    identities: {
      PAN: { employeeId: 11, documentNo: 'ABCDE1234F', verified: true, enableMasking: true },
      AADHAR: { employeeId: 11, documentNo: '111122223333' },
      DL: { employeeId: 11, documentNo: '' },
    },
    bank: { employeeId: 11, bankAccountNumber: '1234567890', bankName: 4 },
    pf: { employeeId: 11, uan: '100200300400', pfEligible: true },
    labels: { religion: { 2: 'Hindu' }, bank: { 4: 'AXIS Bank' } },
    syncedAt: '2026-08-25T02:00:00.000Z',
  });

  assert.equal(hasSensitiveDetail(detail), true);
  assert.equal(detail.identities.PAN.documentNo, 'ABCDE1234F');
  assert.equal(detail.identities.PAN.masked, true, "greytHR's own masking flag is preserved");
  assert.equal('DL' in detail.identities, false, 'an identity with no number is dropped');
  assert.equal(detail.statutory.religion, 'Hindu', 'numeric codes resolve through the LOV');
  assert.equal(detail.statutory.disabled, false, 'false survives; it is not the same as absent');
  assert.equal(detail.bank.bankName, 'AXIS Bank');
  assert.equal(detail.pf.uan, '100200300400');
  assert.equal(detail.addresses.presentaddress.city, 'Bhubaneswar');
});

test('an employee with nothing restricted on file produces no restricted record', () => {
  const detail = buildSensitiveDetail({ employeeId: '11' });
  assert.equal(hasSensitiveDetail(detail), false, 'so the sync writes no document at all');
});

test('a travel document with no number is omitted', () => {
  const detail = buildSensitiveDetail({
    employeeId: '11',
    passport: { relation: 11, passportNo: '', country: 'India' },
  });
  assert.equal(detail.passport, undefined);
  assert.equal(hasSensitiveDetail(detail), false);
});

test('maskIdentifier keeps the last four characters and never leaks length', () => {
  assert.equal(maskIdentifier('ABCDE1234F'), '••••••234F');
  assert.equal(maskIdentifier('111122223333'), '••••••••3333');
  assert.equal(maskIdentifier('123'), '•••', 'a short value is fully masked');
  assert.equal(maskIdentifier(''), '');
  assert.equal(maskIdentifier(null), '');
  assert.equal(maskIdentifier('ABCDE1234F', 2), '••••••••4F', 'the *last* two characters survive');
});

/* ------------------------------------------------------------------------------------------------
 * Reporting structure
 * ---------------------------------------------------------------------------------------------- */

test('resolveReportingManager finds the manager in a flat object', () => {
  assert.deepEqual(resolveReportingManager({ supervisorId: 42, supervisorName: 'Ravi' }), {
    employeeId: '42',
    name: 'Ravi',
  });
});

test('resolveReportingManager copes with the several names greytHR uses', () => {
  assert.equal(resolveReportingManager({ managerId: 7 }).employeeId, '7');
  assert.equal(resolveReportingManager({ reportsTo: 8 }).employeeId, '8');
  assert.equal(resolveReportingManager({ reportingTo: 9 }).employeeId, '9');
  assert.equal(resolveReportingManager({ parentEmployeeId: 10 }).employeeId, '10');
});

test('resolveReportingManager walks arrays and nesting', () => {
  assert.equal(resolveReportingManager([{ level: 1 }, { supervisorId: 42 }]).employeeId, '42');
  assert.equal(resolveReportingManager({ node: { chain: { managerId: 5 } } }).employeeId, '5');
  assert.equal(resolveReportingManager({ supervisor: { managerId: 6 } }).employeeId, '6');
});

test('resolveReportingManager returns nothing rather than guessing', () => {
  // A wrong reporting line is worse than a blank one.
  assert.equal(resolveReportingManager(null), null);
  assert.equal(resolveReportingManager(undefined), null);
  assert.equal(resolveReportingManager({}), null);
  assert.equal(resolveReportingManager({ supervisorId: 0 }), null, 'zero is not an employee');
  assert.equal(resolveReportingManager({ supervisorId: '' }), null);
  assert.equal(resolveReportingManager('nonsense'), null);
});

test('resolveReportingManager stops rather than recursing forever', () => {
  const deep = { a: { b: { c: { d: { e: { supervisorId: 99 } } } } } };
  // Bounded depth: a cyclic or pathological tree must not hang the sync.
  assert.equal(resolveReportingManager(deep), null);
});

test('summarizeRun counts created, updated and unchanged without double-counting', () => {
  const outcomes = [
    { employeeId: '1', changes: [{ field: 'name', from: 'a', to: 'b' }], accessAction: 'none', flagged: false },
    { employeeId: '2', changes: [], accessAction: 'none', flagged: false },
    { employeeId: '3', changes: [{ field: 'status', from: 'Active', to: 'Inactive' }], accessAction: 'deactivate', flagged: true },
    { employeeId: '4', changes: [{ field: 'name', from: null, to: 'New' }], accessAction: 'none', flagged: false },
  ].map((row) => ({ employeeNo: '', name: '', email: '', employmentState: 'Active', employmentStateReason: '', accessReason: '', ...row }));

  const summary = summarizeRun(outcomes, new Set(['4']));
  assert.equal(summary.employeesCreated, 1);
  assert.equal(summary.employeesUpdated, 2, 'the created employee is not also counted as updated');
  assert.equal(summary.employeesUnchanged, 1);
  assert.equal(summary.usersDeactivated, 1);
  assert.equal(summary.flaggedForReview, 1);
});
