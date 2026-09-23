import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_EMPLOYEE_FACTS_INDEX,
  attachDesignations,
  buildEmployeeFactsIndex,
  employeeFactsFor,
  personOptionLabel,
  personSearchText,
  personSubtitle,
  resolveDesignation,
} from '../src/lib/people-directory.ts';

/*
 * The rule under test, in one sentence: a person picker names somebody by the job title greytHR
 * holds, and only falls back to `users.role` — the permission bundle — when there is no HR record
 * to read. Everything below is a case where those two answers differ.
 */

const employees = [
  {
    id: 'E1401',
    employeeId: '1401',
    employeeNo: 'SEL-1401',
    email: 'Sarika.Palo@example.com',
    department: 'Finance',
    designation: 'Finance Manager',
    status: 'Active',
  },
  {
    id: 'E1402',
    employeeId: '1402',
    employeeNo: 'SEL-1402',
    email: 'ramesh@example.com',
    department: 'Projects',
    designation: 'Site Engineer',
    status: 'Active',
  },
  // A field technician with no email address — the case an email-only join used to lose.
  {
    id: 'E1500',
    employeeId: '1500',
    employeeNo: 'SEL-1500',
    department: 'Projects',
    designation: 'Foreman',
    status: 'Active',
  },
];

const index = buildEmployeeFactsIndex(employees);

/* ------------------------------------------------------------------------------------------------
 * The join
 * ---------------------------------------------------------------------------------------------- */

test('a user linked by greytHR employee id resolves to that employee', () => {
  const found = employeeFactsFor({ employeeId: '1402', email: 'someone.else@example.com' }, index);
  assert.equal(found?.id, 'E1402');
});

test('the employee id wins over a conflicting email match', () => {
  // The link is the stated fact; an email can be reassigned when somebody leaves.
  const found = employeeFactsFor({ employeeId: '1402', email: 'sarika.palo@example.com' }, index);
  assert.equal(found?.designation, 'Site Engineer');
});

test('the document id and the employee number are accepted as the link', () => {
  assert.equal(employeeFactsFor({ employeeId: 'E1401' }, index)?.id, 'E1401');
  assert.equal(employeeFactsFor({ employeeId: 'SEL-1401' }, index)?.id, 'E1401');
  assert.equal(employeeFactsFor({ employeeNo: 'SEL-1500' }, index)?.id, 'E1500');
});

test('email is the fallback join, case-insensitively', () => {
  assert.equal(employeeFactsFor({ email: 'SARIKA.PALO@example.com' }, index)?.id, 'E1401');
});

test('an unlinked user matches nothing rather than guessing', () => {
  assert.equal(employeeFactsFor({ name: 'Contractor' }, index), null);
  assert.equal(employeeFactsFor(null, index), null);
});

test('an employee with no email is still reachable by id — the email-only join lost these', () => {
  assert.equal(employeeFactsFor({ employeeId: '1500' }, index)?.designation, 'Foreman');
});

/* ------------------------------------------------------------------------------------------------
 * Which fact wins
 * ---------------------------------------------------------------------------------------------- */

test('the greytHR designation is shown, not the role', () => {
  const resolved = resolveDesignation({ role: 'Admin', employeeId: '1401' }, index);
  assert.equal(resolved.label, 'Finance Manager');
  assert.equal(resolved.source, 'greythr');
  assert.equal(resolved.department, 'Finance');
  assert.equal(resolved.employeeCode, 'SEL-1401');
});

test('a user with no HR record falls back to the role, and says so', () => {
  const resolved = resolveDesignation({ role: 'Site User', email: 'contractor@example.com' }, index);
  assert.equal(resolved.label, 'Site User');
  assert.equal(resolved.source, 'role');
});

test('a user with neither resolves to nothing rather than to an empty-looking title', () => {
  const resolved = resolveDesignation({ email: 'nobody@example.com' }, index);
  assert.equal(resolved.label, '');
  assert.equal(resolved.source, 'none');
});

test('a designation already on the person wins over the index', () => {
  // Office Hub and Tour & Travel carry their own resolved designation; it must not be overwritten.
  const resolved = resolveDesignation({ designation: 'Acting Head', employeeId: '1401' }, index);
  assert.equal(resolved.label, 'Acting Head');
});

test('a blank designation on the employee record does not beat the role', () => {
  const sparse = buildEmployeeFactsIndex([{ id: 'E1', employeeId: '1', designation: '   ' }]);
  assert.equal(resolveDesignation({ employeeId: '1', role: 'Approver' }, sparse).label, 'Approver');
});

/* ------------------------------------------------------------------------------------------------
 * What the controls render
 * ---------------------------------------------------------------------------------------------- */

test('the subtitle is the designation, then the role, then the email', () => {
  assert.equal(personSubtitle({ employeeId: '1402', role: 'Admin' }, index), 'Site Engineer');
  assert.equal(personSubtitle({ role: 'Admin', email: 'a@b.com' }, index), 'Admin');
  assert.equal(personSubtitle({ email: 'a@b.com' }, index), 'a@b.com');
});

test('the option label reads "Name — Designation"', () => {
  assert.equal(
    personOptionLabel({ name: 'Sarika Palo', employeeId: '1401', role: 'Admin' }, index),
    'Sarika Palo — Finance Manager',
  );
});

test('the option label separator is configurable and a bare name stays bare', () => {
  assert.equal(
    personOptionLabel({ name: 'Sarika Palo', employeeId: '1401' }, index, { separator: ' · ' }),
    'Sarika Palo · Finance Manager',
  );
  assert.equal(personOptionLabel({ name: 'Nobody' }, index), 'Nobody');
});

test('a nameless row falls back to the email rather than rendering blank', () => {
  assert.equal(personOptionLabel({ email: 'a@b.com' }, index), 'a@b.com');
  assert.equal(personOptionLabel(null, index), 'Unnamed user');
});

test('search matches the designation, the department and the employee number', () => {
  const haystack = personSearchText({ name: 'Ramesh', employeeId: '1402', role: 'Site User' }, index);
  assert.ok(haystack.includes('site engineer'));
  assert.ok(haystack.includes('projects'));
  assert.ok(haystack.includes('sel-1402'));
  assert.ok(haystack.includes('site user'));
});

/* ------------------------------------------------------------------------------------------------
 * Attaching to a directory
 * ---------------------------------------------------------------------------------------------- */

test('attachDesignations copies the title onto each linked user', () => {
  const [linked, unlinked] = attachDesignations(
    [
      { id: 'u1', name: 'Sarika Palo', role: 'Admin', employeeId: '1401' },
      { id: 'u2', name: 'Contractor', role: 'Site User' },
    ],
    index,
  );
  assert.equal(linked.designation, 'Finance Manager');
  assert.equal(linked.department, 'Finance');
  assert.equal(linked.role, 'Admin', 'the role is untouched — it still decides what they may do');
  assert.equal(unlinked.designation, undefined);
});

test('attachDesignations does not mutate the array it was given', () => {
  const original = [{ id: 'u1', name: 'Sarika Palo', employeeId: '1401' }];
  const next = attachDesignations(original, index);
  assert.equal(original[0].designation, undefined);
  assert.notEqual(next[0], original[0]);
});

test('a failed employee read leaves every row exactly as it was', () => {
  // `loaded: false` is what the client half returns when Firestore refuses the read. Pickers then
  // show the role they showed before this feature existed rather than a column of blanks.
  const rows = [{ id: 'u1', name: 'Sarika Palo', role: 'Admin', employeeId: '1401' }];
  assert.deepEqual(attachDesignations(rows, EMPTY_EMPLOYEE_FACTS_INDEX), rows);
  assert.equal(personSubtitle(rows[0]), 'Admin');
});
