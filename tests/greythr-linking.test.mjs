import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO_LINK_METHODS,
  ERP_PROTECTED_USER_FIELDS,
  GREYTHR_OWNED_USER_FIELDS,
  LINK_METHOD_RANK,
  LINK_STATUS_ORDER,
  assertNoProtectedFields,
  buildLinkAudit,
  buildLinkReport,
  buildLinkWrite,
  buildUnlinkWrite,
  isAutoLinkable,
  linkAuditId,
  linkRowSearchText,
  normalizeEmail,
  normalizeEmployeeNo,
  normalizeName,
  normalizePhone,
  pickGreytHRFields,
  planBulkLink,
  sortLinkRows,
} from '../src/lib/greythr-linking.ts';

/* ------------------------------------------------------------------------------------------------
 * Field ownership — the guard that protects the additive permission layer
 * ---------------------------------------------------------------------------------------------- */

test('assertNoProtectedFields accepts a normal sync payload', () => {
  assert.doesNotThrow(() =>
    assertNoProtectedFields({
      status: 'Inactive',
      deactivatedBy: 'greythr-sync',
      deactivationReason: 'Relieved on 31 Jul 2026',
    }),
  );
});

test('assertNoProtectedFields throws on every authorization field', () => {
  for (const field of ERP_PROTECTED_USER_FIELDS) {
    assert.throws(
      () => assertNoProtectedFields({ [field]: 'anything' }),
      /protected authorization field/,
      `${field} must be rejected`,
    );
  }
});

test('assertNoProtectedFields names every offender, not just the first', () => {
  assert.throws(
    () => assertNoProtectedFields({ name: 'ok', permissions: {}, roles: [] }),
    (error) => /permissions/.test(error.message) && /roles/.test(error.message),
  );
});

test('assertNoProtectedFields rejects a permissions key even when it is empty or falsy', () => {
  // The dangerous case: `{ permissions: {} }` merged onto a user wipes their additive grants and
  // looks like a no-op to anyone reading the payload.
  assert.throws(() => assertNoProtectedFields({ permissions: {} }), /permissions/);
  assert.throws(() => assertNoProtectedFields({ roles: [] }), /roles/);
  assert.throws(() => assertNoProtectedFields({ role: '' }), /role/);
});

test('the owned and protected lists cannot overlap', () => {
  const owned = new Set(GREYTHR_OWNED_USER_FIELDS);
  for (const field of ERP_PROTECTED_USER_FIELDS) {
    assert.equal(owned.has(field), false, `${field} is both owned and protected`);
  }
});

test('pickGreytHRFields drops anything not explicitly owned', () => {
  const picked = pickGreytHRFields({
    name: 'A Person',
    designation: 'Site Engineer',
    permissions: { 'HR.View': ['View'] },
    role: 'Super Admin',
    somethingNew: 'unrecognised',
  });
  assert.deepEqual(picked, { name: 'A Person', designation: 'Site Engineer' });
});

/* ------------------------------------------------------------------------------------------------
 * Normalising join keys
 * ---------------------------------------------------------------------------------------------- */

test('normalizePhone compares the last ten digits', () => {
  assert.equal(normalizePhone('+91 98765 43210'), '9876543210');
  assert.equal(normalizePhone('09876543210'), '9876543210');
  assert.equal(normalizePhone('9876543210'), '9876543210');
  assert.equal(normalizePhone('(+91)-98765-43210'), '9876543210');
});

test('normalizePhone rejects anything too short to identify a person', () => {
  assert.equal(normalizePhone('12345'), '');
  assert.equal(normalizePhone('—'), '');
  assert.equal(normalizePhone(null), '');
  assert.equal(normalizePhone(undefined), '');
});

test('normalizeEmployeeNo ignores case and separators but not padding', () => {
  assert.equal(normalizeEmployeeNo('e-1401'), 'E1401');
  assert.equal(normalizeEmployeeNo(' E 1401 '), 'E1401');
  assert.equal(normalizeEmployeeNo('E_1401'), 'E1401');
  // Padded numbers are different people in organisations that pad, so they must not collapse.
  assert.notEqual(normalizeEmployeeNo('E014'), normalizeEmployeeNo('E14'));
});

test('normalizeName is word-order independent', () => {
  assert.equal(normalizeName('Debaprasad Bhoi'), normalizeName('Bhoi Debaprasad'));
  assert.equal(normalizeName('  A.  PERSON '), normalizeName('person a'));
  assert.notEqual(normalizeName('Amit Kumar'), normalizeName('Amit Kumari'));
});

test('normalizeEmail trims and lowercases', () => {
  assert.equal(normalizeEmail('  Person@Company.COM '), 'person@company.com');
  assert.equal(normalizeEmail(null), '');
});

/* ------------------------------------------------------------------------------------------------
 * Method confidence
 * ---------------------------------------------------------------------------------------------- */

test('name and phone are never automatic', () => {
  assert.equal(isAutoLinkable('name'), false);
  assert.equal(isAutoLinkable('phone'), false);
  assert.equal(isAutoLinkable('employeeId'), true);
  assert.equal(isAutoLinkable('employeeNo'), true);
  assert.equal(isAutoLinkable('email'), true);
  assert.equal(isAutoLinkable('manual'), true);
  assert.equal(AUTO_LINK_METHODS.includes('name'), false);
});

test('manual outranks every inferred method', () => {
  const ranks = Object.entries(LINK_METHOD_RANK);
  for (const [method, rank] of ranks) {
    if (method === 'manual') continue;
    assert.ok(LINK_METHOD_RANK.manual < rank, `manual must outrank ${method}`);
  }
});

/* ------------------------------------------------------------------------------------------------
 * The link payloads
 * ---------------------------------------------------------------------------------------------- */

test('buildLinkWrite keeps employeeId top level for the existing joins', () => {
  const write = buildLinkWrite({
    employeeId: '123456',
    employeeNo: 'E1401',
    method: 'manual',
    actor: 'uid_admin',
    at: '2026-08-25T10:00:00.000Z',
  });
  assert.equal(write.employeeId, '123456');
  assert.equal(write.employeeNo, 'E1401');
  assert.equal(write.greytHR.linked, true);
  assert.equal(write.greytHR.method, 'manual');
  assert.equal(write.greytHR.linkedBy, 'uid_admin');
  // The one that matters: a link write can never carry an authorization field.
  assert.doesNotThrow(() => assertNoProtectedFields(write));
});

test('buildUnlinkWrite clears the join but keeps the history', () => {
  const write = buildUnlinkWrite({
    previous: {
      linked: true,
      employeeId: '123456',
      employeeNo: 'E1401',
      method: 'email',
      linkedAt: '2026-01-01T00:00:00.000Z',
      linkedBy: 'uid_admin',
    },
    actor: 'uid_admin2',
    at: '2026-08-25T10:00:00.000Z',
    reason: 'Wrong employee',
  });

  assert.equal(write.employeeId, '', 'the join must be cleared or the sync keeps matching');
  assert.equal(write.greytHR.linked, false);
  assert.equal(write.greytHR.employeeId, '123456', 'what it used to point at is still answerable');
  assert.equal(write.greytHR.unlinkReason, 'Wrong employee');
  assert.doesNotThrow(() => assertNoProtectedFields(write));
});

test('buildUnlinkWrite survives a user with no previous link block', () => {
  const write = buildUnlinkWrite({ previous: null, actor: 'a', at: '2026-08-25T10:00:00.000Z', reason: 'x' });
  assert.equal(write.greytHR.linked, false);
  assert.equal(write.employeeId, '');
});

/* ------------------------------------------------------------------------------------------------
 * The reconciliation report
 * ---------------------------------------------------------------------------------------------- */

const employee = (over = {}) => ({
  employeeId: '1',
  employeeNo: 'E1401',
  name: 'A Person',
  email: 'a.person@company.com',
  phone: '9876543210',
  department: 'MIS',
  designation: 'ERP Developer',
  employmentState: 'Active',
  ...over,
});

const user = (over = {}) => ({
  id: 'uid_1',
  name: 'A Person',
  email: 'a.person@company.com',
  phone: '9876543210',
  employeeId: null,
  employeeNo: null,
  status: 'Active',
  ...over,
});

test('an existing link is reported as linked', () => {
  const report = buildLinkReport([user({ employeeId: '1' })], [employee()]);
  assert.equal(report.rows[0].status, 'linked');
  assert.equal(report.rows[0].employee.employeeNo, 'E1401');
  assert.equal(report.counts.linked, 1);
});

test('a link pointing at a missing employee is a conflict, not silently dropped', () => {
  const report = buildLinkReport([user({ employeeId: '999' })], [employee()]);
  assert.equal(report.rows[0].status, 'conflict');
  assert.match(report.rows[0].reason, /not in the employee mirror/);
});

test('two accounts claiming one employee are both flagged', () => {
  const report = buildLinkReport(
    [user({ id: 'uid_1', employeeId: '1' }), user({ id: 'uid_2', employeeId: '1' })],
    [employee()],
  );
  assert.equal(report.counts.conflict, 2);
  for (const row of report.rows) assert.match(row.reason, /Only one may be/);
});

test('a single email match is ready to link', () => {
  const report = buildLinkReport([user()], [employee({ employeeNo: 'DIFFERENT' })]);
  assert.equal(report.rows[0].status, 'suggested');
  assert.equal(report.rows[0].employee.method, 'email');
});

test('employee number beats email when both point at the same person', () => {
  const report = buildLinkReport([user({ employeeNo: 'E1401' })], [employee()]);
  assert.equal(report.rows[0].status, 'suggested');
  assert.equal(report.rows[0].employee.method, 'employeeNo', 'the strongest method is reported');
});

test('a name-only match needs review and is never offered as ready', () => {
  const report = buildLinkReport(
    [user({ email: null, phone: null })],
    [employee({ email: 'someone.else@company.com', phone: '9999999999' })],
  );
  assert.equal(report.rows[0].status, 'review');
  assert.equal(report.rows[0].employee, null, 'nothing is pre-selected for a name match');
  assert.equal(report.rows[0].candidates[0].method, 'name');
});

test('a phone-only match needs review', () => {
  const report = buildLinkReport(
    [user({ email: null, name: 'Totally Different' })],
    [employee()],
  );
  assert.equal(report.rows[0].status, 'review');
  assert.equal(report.rows[0].candidates[0].method, 'phone');
});

test('two different employees matching one user is always a review, even on a strong method', () => {
  const report = buildLinkReport(
    [user({ employeeNo: 'E1401' })],
    [
      employee({ employeeId: '1', employeeNo: 'E1401', email: 'other@company.com', phone: null }),
      employee({ employeeId: '2', employeeNo: 'E9999' }),
    ],
  );
  const row = report.rows[0];
  assert.equal(row.status, 'review', 'disagreement between joins is itself the signal');
  assert.equal(row.candidates.length, 2);
  assert.equal(row.candidates[0].method, 'employeeNo', 'candidates are ordered by confidence');
});

test('a duplicate employee number is dropped from matching and reported', () => {
  const report = buildLinkReport(
    [user({ employeeNo: 'E1401', email: null, phone: null, name: 'Nobody' })],
    [
      employee({ employeeId: '1', employeeNo: 'E1401' }),
      employee({ employeeId: '2', employeeNo: 'E-1401', email: 'b@company.com', phone: null, name: 'B Person' }),
    ],
  );
  assert.equal(report.rows[0].status, 'unlinked', 'an ambiguous key must not produce a confident link');
  assert.deepEqual(report.ambiguous.employeeNos, ['E1401']);
});

test('an employee already claimed by another login is not offered to anybody else', () => {
  const report = buildLinkReport(
    [user({ id: 'uid_1', employeeId: '1' }), user({ id: 'uid_2', email: 'a.person@company.com' })],
    [employee()],
  );
  const second = report.rows.find((row) => row.user.id === 'uid_2');
  assert.equal(second.status, 'unlinked');
  assert.equal(second.candidates.length, 0);
});

test('a user with nothing in common with any employee is simply unlinked', () => {
  const report = buildLinkReport(
    [user({ name: 'Contractor Login', email: 'ops@vendor.com', phone: null })],
    [employee()],
  );
  assert.equal(report.rows[0].status, 'unlinked');
  assert.equal(report.counts.unlinked, 1);
});

test('employees without a login are counted separately, not treated as a problem', () => {
  const report = buildLinkReport(
    [user({ employeeId: '1' })],
    [employee(), employee({ employeeId: '2', employeeNo: 'E1402', email: 'b@company.com', name: 'B Person' })],
  );
  assert.equal(report.counts.unlinkedEmployees, 1);
  assert.equal(report.unlinkedEmployees[0].employeeNo, 'E1402');
});

test('resigned employees are still linkable — the exit policy needs the link to act on', () => {
  // A relieved employee with no link is exactly the case where an account fails to be deactivated,
  // so they must not be filtered out of the report.
  const report = buildLinkReport([user()], [employee({ employmentState: 'Relieved' })]);
  assert.equal(report.rows[0].status, 'suggested');
  assert.equal(report.rows[0].employee.employmentState, 'Relieved');
});

/* ------------------------------------------------------------------------------------------------
 * Bulk planning
 * ---------------------------------------------------------------------------------------------- */

test('planBulkLink applies only the confident matches', () => {
  const report = buildLinkReport(
    [
      user({ id: 'uid_1', employeeNo: 'E1401' }),
      user({ id: 'uid_2', email: null, phone: null, name: 'B Person' }),
      user({ id: 'uid_3', employeeId: '3' }),
      user({ id: 'uid_4', name: 'Nobody At All', email: 'x@y.com', phone: null }),
    ],
    [
      employee(),
      employee({ employeeId: '2', employeeNo: 'E1402', name: 'B Person', email: 'b@company.com', phone: null }),
      employee({ employeeId: '3', employeeNo: 'E1403', name: 'C Person', email: 'c@company.com', phone: null }),
    ],
  );

  const plan = planBulkLink(report);
  assert.deepEqual(plan.apply.map((entry) => entry.userId), ['uid_1']);
  // uid_3 is already linked, so it is neither applied nor reported as skipped.
  const skipped = plan.skip.map((entry) => entry.userId);
  assert.ok(skipped.includes('uid_2'), 'a name match is skipped for review');
  assert.ok(skipped.includes('uid_4'), 'an unmatched user is accounted for');
  assert.equal(skipped.includes('uid_3'), false, 'an already-linked user is not noise in the plan');
});

test('planBulkLink accounts for every user exactly once', () => {
  const users = Array.from({ length: 6 }, (_, index) =>
    user({ id: `uid_${index}`, employeeNo: `E140${index}`, email: `p${index}@company.com`, phone: null }),
  );
  const employees = Array.from({ length: 4 }, (_, index) =>
    employee({
      employeeId: String(index),
      employeeNo: `E140${index}`,
      email: `p${index}@company.com`,
      phone: null,
      name: `Person ${index}`,
    }),
  );
  const report = buildLinkReport(users, employees);
  const plan = planBulkLink(report);
  const linked = report.rows.filter((row) => row.status === 'linked').length;
  assert.equal(plan.apply.length + plan.skip.length + linked, users.length);
});

/* ------------------------------------------------------------------------------------------------
 * Audit and presentation
 * ---------------------------------------------------------------------------------------------- */

test('linkAuditId sorts chronologically as a string', () => {
  const earlier = linkAuditId('2026-08-25T09:00:00.000Z', 'uid_1');
  const later = linkAuditId('2026-08-25T10:00:00.000Z', 'uid_1');
  assert.ok(earlier < later, 'document-id ordering must be chronological — no composite index needed');
});

test('two links in the same millisecond for different users do not collide', () => {
  const at = '2026-08-25T10:00:00.000Z';
  assert.notEqual(linkAuditId(at, 'uid_1'), linkAuditId(at, 'uid_2'));
});

test('buildLinkAudit records who did it and why', () => {
  const entry = buildLinkAudit({
    action: 'link',
    userId: 'uid_1',
    userName: 'A Person',
    employeeId: '1',
    employeeNo: 'E1401',
    method: 'manual',
    actorId: 'uid_admin',
    actorName: 'Admin',
    at: '2026-08-25T10:00:00.000Z',
    reason: 'Linked to A Person (E1401).',
  });
  assert.ok(entry.id.startsWith('20260825'));
  assert.equal(entry.actorId, 'uid_admin');
});

test('sortLinkRows puts the rows needing work first', () => {
  const rows = LINK_STATUS_ORDER.slice()
    .reverse()
    .map((status) => ({
      user: user({ id: status, name: status }),
      status,
      employee: null,
      candidates: [],
      reason: '',
    }));
  const sorted = sortLinkRows(rows).map((row) => row.status);
  assert.deepEqual(sorted, LINK_STATUS_ORDER);
});

test('linkRowSearchText covers both sides of the pair', () => {
  const text = linkRowSearchText({
    user: user({ name: 'A Person', employeeNo: 'E1401' }),
    status: 'suggested',
    employee: { employeeId: '1', employeeNo: 'E1401', name: 'A Person', department: 'MIS', designation: 'Dev', method: 'email', auto: true },
    candidates: [],
    reason: '',
  });
  assert.ok(text.includes('e1401'));
  assert.ok(text.includes('mis'));
  assert.ok(text.includes('a.person@company.com'));
});
