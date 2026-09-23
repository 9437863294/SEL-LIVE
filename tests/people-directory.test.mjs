import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_EMPLOYEE_FACTS_INDEX,
  attachDesignations,
  buildEmployeeFactsIndex,
  employeeFactsFor,
  personJobTitle,
  personOptionLabel,
  personSearchText,
  personSubtitle,
  resolveDesignation,
} from '../src/lib/people-directory.ts';

/*
 * The rule under test, in one sentence: a person picker names somebody by the job title greytHR
 * holds, and never by `users.role` — the permission bundle.
 *
 * The fixtures mirror the shape of the real data, because the shape is what the bug was made of:
 *
 *   greythrCurrentRoster/{numericId}   keyed "313", `employeeId: "313"`, designation POPULATED
 *   employees/{randomDocId}            `employeeId: "E1597"`,            designation BLANK
 *   users/{uid}                        `employeeId: "313"`, `employeeNo: "E1597"`
 *
 * Joining only against the mirror finds the right person and reads an empty title off them.
 */

const roster = [
  {
    id: '313',
    employeeId: '313',
    employeeNo: 'E1597',
    department: 'HR',
    designation: 'HR Asst.',
    status: 'Active',
  },
  {
    id: '142',
    employeeId: '142',
    employeeNo: 'E1193',
    department: 'PROJECT',
    designation: 'Manager-Store & Purchase',
    status: 'Active',
  },
];

const mirror = [
  { id: 'PLz9r3uVWLKKEuE327Bl', employeeId: 'E1597', designation: '', department: '', status: 'Active' },
  // The mirror holds duplicates for some people; at most one copy is populated.
  { id: 'EGOUt94nmS753F0xRcvV', employeeId: 'E1193', designation: '', department: '', status: 'Active' },
  { id: 'Plnqmh9vBeGJAeXvFvnN', employeeId: 'E1193', designation: '', department: '', status: 'Active' },
  // Somebody who has left: in the mirror only, and the mirror does carry their title.
  {
    id: 'leaver-doc',
    employeeId: 'E0900',
    email: 'Left.Person@example.com',
    department: 'FINANCE',
    designation: 'Accounts Officer',
    status: 'Inactive',
  },
];

const index = buildEmployeeFactsIndex(roster, mirror);

/* ------------------------------------------------------------------------------------------------
 * The join — the two collections do not share a key space
 * ---------------------------------------------------------------------------------------------- */

test('a login joins the roster on the numeric employeeId it stores', () => {
  assert.equal(employeeFactsFor({ employeeId: '313', employeeNo: 'E1597' }, index)?.designation, 'HR Asst.');
});

test('the roster is reachable by employee number too, for a login that stored that instead', () => {
  assert.equal(employeeFactsFor({ employeeId: 'E1193' }, index)?.designation, 'Manager-Store & Purchase');
});

test('email is the fallback join, case-insensitively', () => {
  assert.equal(employeeFactsFor({ email: 'LEFT.PERSON@example.com' }, index)?.employeeId, 'E0900');
});

test('an unlinked user matches nothing rather than guessing', () => {
  assert.equal(employeeFactsFor({ name: 'Contractor' }, index), null);
  assert.equal(employeeFactsFor(null, index), null);
});

/* ------------------------------------------------------------------------------------------------
 * Which record wins — this is the whole fix
 * ---------------------------------------------------------------------------------------------- */

test('the roster beats the mirror when the mirror has a blank designation', () => {
  // The exact failure from the screenshot: the right person was found, with an empty title.
  const resolved = resolveDesignation({ employeeId: '313', employeeNo: 'E1597', role: 'HR INTERN' }, index);
  assert.equal(resolved.designation, 'HR Asst.');
  assert.equal(resolved.department, 'HR');
});

test('a populated record beats a blank one regardless of which collection it came from', () => {
  // Same two rows, mirror first. The answer must not depend on read order.
  const reversed = buildEmployeeFactsIndex(mirror, roster);
  assert.equal(resolveDesignation({ employeeId: '313' }, reversed).designation, 'HR Asst.');
});

test('a duplicate mirror document does not shadow the populated one', () => {
  const duplicates = buildEmployeeFactsIndex([
    { id: 'a', employeeId: 'E1193', designation: '' },
    { id: 'b', employeeId: 'E1193', designation: 'Manager-Store & Purchase' },
  ]);
  assert.equal(resolveDesignation({ employeeId: 'E1193' }, duplicates).designation, 'Manager-Store & Purchase');
});

test('the mirror still answers for somebody who has left and is not on the roster', () => {
  assert.equal(resolveDesignation({ email: 'left.person@example.com' }, index).designation, 'Accounts Officer');
});

test('a designation already on the person wins over both collections', () => {
  // Office Hub and Tour & Travel carry their own resolved designation; it must not be overwritten.
  const resolved = resolveDesignation({ designation: 'Acting Head', employeeId: '313' }, index);
  assert.equal(resolved.designation, 'Acting Head');
  assert.equal(resolved.source, 'person');
});

/* ------------------------------------------------------------------------------------------------
 * The role is never presented as a job title
 * ---------------------------------------------------------------------------------------------- */

test('a user with no HR designation does not borrow their role', () => {
  const resolved = resolveDesignation({ role: 'HO Account', email: 'a@b.com' }, index);
  assert.equal(resolved.designation, '');
  assert.equal(resolved.source, 'none');
});

test('the subtitle falls back to the department, not the role', () => {
  const blankTitle = buildEmployeeFactsIndex([{ id: '9', employeeId: '9', department: 'FINANCE', designation: '' }]);
  assert.equal(personSubtitle({ employeeId: '9', role: 'Recurring Payments' }, blankTitle), 'FINANCE');
});

test('with neither a designation nor a department the subtitle is the email', () => {
  assert.equal(personSubtitle({ role: 'Default', email: 'a@b.com' }, index), 'a@b.com');
});

test('a role that is the holder’s own name never reaches the screen', () => {
  // The real record that made this obvious: users/{uid}.role === "Sharat Kumar Sahoo".
  const label = personOptionLabel(
    { name: 'Sharat Kumar Sahoo', role: 'Sharat Kumar Sahoo', employeeId: '142' },
    index,
  );
  assert.equal(label, 'Sharat Kumar Sahoo — Manager-Store & Purchase');
});

test('personJobTitle refuses the subtitle fallbacks so nothing stores a department as a title', () => {
  const blankTitle = buildEmployeeFactsIndex([{ id: '9', employeeId: '9', department: 'FINANCE', designation: '' }]);
  assert.equal(personJobTitle({ employeeId: '9', role: 'Admin', email: 'a@b.com' }, blankTitle), '');
  assert.equal(personJobTitle({ employeeId: '313' }, index), 'HR Asst.');
});

/* ------------------------------------------------------------------------------------------------
 * What the controls render
 * ---------------------------------------------------------------------------------------------- */

test('the option label reads "Name — Designation"', () => {
  assert.equal(
    personOptionLabel({ name: 'Rukmuni Mohanty', employeeId: '313', role: 'HR INTERN' }, index),
    'Rukmuni Mohanty — HR Asst.',
  );
});

test('the option label separator is configurable and a bare name stays bare', () => {
  assert.equal(
    personOptionLabel({ name: 'Rukmuni Mohanty', employeeId: '313' }, index, { separator: ' · ' }),
    'Rukmuni Mohanty · HR Asst.',
  );
  assert.equal(personOptionLabel({ name: 'Nobody' }, index), 'Nobody');
});

test('a nameless row falls back to the email rather than rendering it twice', () => {
  assert.equal(personOptionLabel({ email: 'a@b.com' }, index), 'a@b.com');
  assert.equal(personOptionLabel(null, index), 'Unnamed user');
});

test('search still matches the role even though it is no longer displayed', () => {
  const haystack = personSearchText({ name: 'Rukmuni', employeeId: '313', role: 'HR INTERN' }, index);
  assert.ok(haystack.includes('hr asst.'));
  assert.ok(haystack.includes('hr intern'), 'the role stays searchable');
  assert.ok(haystack.includes('e1597'));
});

/* ------------------------------------------------------------------------------------------------
 * Attaching to a directory
 * ---------------------------------------------------------------------------------------------- */

test('attachDesignations copies the title onto each linked user and leaves the role alone', () => {
  const [linked, unlinked] = attachDesignations(
    [
      { id: 'u1', name: 'Rukmuni Mohanty', role: 'HR INTERN', employeeId: '313' },
      { id: 'u2', name: 'Contractor', role: 'Default' },
    ],
    index,
  );
  assert.equal(linked.designation, 'HR Asst.');
  assert.equal(linked.department, 'HR');
  assert.equal(linked.role, 'HR INTERN', 'the role still decides what they may do');
  assert.equal(unlinked.designation, undefined);
});

test('attachDesignations does not mutate the array it was given', () => {
  const original = [{ id: 'u1', name: 'Rukmuni Mohanty', employeeId: '313' }];
  const next = attachDesignations(original, index);
  assert.equal(original[0].designation, undefined);
  assert.notEqual(next[0], original[0]);
});

test('a failed read leaves every row as it was, and no role leaks into the subtitle', () => {
  // `loaded: false` is what the client half returns when both collections refuse the read.
  const rows = [{ id: 'u1', name: 'Rukmuni Mohanty', role: 'HR INTERN', employeeId: '313', email: 'r@b.com' }];
  assert.deepEqual(attachDesignations(rows, EMPTY_EMPLOYEE_FACTS_INDEX), rows);
  assert.equal(personSubtitle(rows[0]), 'r@b.com');
});

/* ------------------------------------------------------------------------------------------------
 * The four columns a person picker shows
 * ---------------------------------------------------------------------------------------------- */

test('resolveDesignation returns the whole identity row, not just the title', () => {
  const withPlace = buildEmployeeFactsIndex([
    {
      id: '313',
      employeeId: '313',
      employeeNo: 'E1597',
      department: 'HR',
      designation: 'HR Asst.',
      location: 'HEAD OFFICE',
    },
  ]);
  const resolved = resolveDesignation({ employeeId: '313', role: 'HR INTERN' }, withPlace);
  assert.equal(resolved.designation, 'HR Asst.');
  assert.equal(resolved.location, 'HEAD OFFICE');
  assert.equal(resolved.employeeCode, 'E1597', 'the printed code, not the numeric API id');
});

test('the employee number wins over the numeric id, and the id stands in when there is none', () => {
  const numbered = buildEmployeeFactsIndex([{ id: '7', employeeId: '7', employeeNo: 'E0007' }]);
  assert.equal(resolveDesignation({ employeeId: '7' }, numbered).employeeCode, 'E0007');
  const bare = buildEmployeeFactsIndex([{ id: '8', employeeId: '8' }]);
  assert.equal(resolveDesignation({ employeeId: '8' }, bare).employeeCode, '8');
});

test('attachDesignations carries location and the employee code onto the row', () => {
  const withPlace = buildEmployeeFactsIndex([
    { id: '313', employeeId: '313', employeeNo: 'E1597', designation: 'HR Asst.', location: 'HEAD OFFICE' },
  ]);
  const [row] = attachDesignations([{ id: 'u1', name: 'Rukmuni Mohanty', employeeId: '313' }], withPlace);
  assert.equal(row.location, 'HEAD OFFICE');
  assert.equal(row.employeeNo, 'E1597');
  // ...so the picker can read all four columns off the row with no index in hand.
  const offRow = resolveDesignation(row);
  assert.equal(offRow.designation, 'HR Asst.');
  assert.equal(offRow.location, 'HEAD OFFICE');
  assert.equal(offRow.employeeCode, 'E1597');
});

test('attachDesignations never overwrites an employee code the user document already had', () => {
  const blank = buildEmployeeFactsIndex([{ id: '9', employeeId: '9', designation: 'Foreman' }]);
  const [row] = attachDesignations([{ id: 'u2', employeeId: '9', employeeNo: 'E0009' }], blank);
  assert.equal(row.employeeNo, 'E0009');
});

test('location is searchable alongside the title and the code', () => {
  const withPlace = buildEmployeeFactsIndex([
    { id: '313', employeeId: '313', employeeNo: 'E1597', designation: 'HR Asst.', location: 'HEAD OFFICE' },
  ]);
  assert.ok(personSearchText({ name: 'Rukmuni', employeeId: '313' }, withPlace).includes('head office'));
});
