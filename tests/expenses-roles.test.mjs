import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPENSES_ACTIONS,
  actorsFor,
  assignmentFor,
  bandMatches,
  emptyAssignment,
  expensesAction,
  flattenExpensesRoles,
  hasActors,
  mayAct,
  resolveExpensesRolesDoc,
  validateExpensesRoles,
} from '../src/lib/expenses-roles.ts';

const docOf = (actions) => resolveExpensesRolesDoc({ actions });
const assign = (patch) => ({ ...emptyAssignment(), ...patch });

test('the action registry covers the module and nothing invented', () => {
  assert.equal(EXPENSES_ACTIONS.length, 11);
  assert.equal(expensesAction('raise-request').permission.action, 'Create');
  assert.equal(expensesAction('raise-request').departmentScoped, true);
  assert.equal(expensesAction('manage-accounts').departmentScoped, false);
  assert.equal(expensesAction('nope'), undefined);
  // Only a department- or amount-capable action may carry those assignment types.
  assert.equal(docOf({ 'manage-accounts': { type: 'department' } }).actions['manage-accounts'].type, 'users');
  assert.equal(docOf({ 'manage-accounts': { type: 'amount' } }).actions['manage-accounts'].type, 'users');
  assert.equal(docOf({ 'raise-request': { type: 'department' } }).actions['raise-request'].type, 'department');
});

test('a stored document is read back safely', () => {
  const doc = resolveExpensesRolesDoc(undefined);
  assert.equal(Object.keys(doc.actions).length, 11, 'every action is present even when nothing is stored');
  assert.deepEqual(assignmentFor(doc, 'raise-request'), emptyAssignment());
  assert.equal(assignmentFor(doc, 'raise-request').mode, 'roles-only', 'the default never changes who may act');

  const messy = docOf({
    'raise-request': { mode: 'nonsense', type: 'users', users: { primary: ['u1', '', 7], alternates: null } },
    'made-up-action': { mode: 'assigned-only' },
    'edit-request': { type: 'amount', bands: [null, { id: 'b1', from: '1000', to: '', primary: ['u2'] }] },
  });
  assert.equal(messy.actions['raise-request'].mode, 'roles-only');
  assert.deepEqual(messy.actions['raise-request'].users, { primary: ['u1'], alternates: [] });
  assert.equal(messy.actions['made-up-action'], undefined, 'an action the registry does not know is dropped');
  assert.deepEqual(messy.actions['edit-request'].bands, [{ id: 'b1', from: 1000, to: null, primary: ['u2'], alternates: [] }]);
});

test('who acts, by people, role, department and amount', () => {
  const byUsers = assign({ type: 'users', users: { primary: ['u1'], alternates: ['u2', 'u3'] } });
  assert.deepEqual(actorsFor(byUsers), { primary: ['u1'], alternates: ['u2', 'u3'], roleIds: [] });

  const byRole = assign({ type: 'roles', roles: { primary: ['r-finance'], alternates: ['u9'] } });
  assert.deepEqual(actorsFor(byRole), { primary: [], alternates: ['u9'], roleIds: ['r-finance'] });

  const byDept = assign({
    type: 'department',
    byDepartment: { 'd-hr': { primary: ['u-hr'], alternates: ['u-alt'] } },
  });
  assert.deepEqual(actorsFor(byDept, { departmentId: 'd-hr' }).primary, ['u-hr']);
  assert.deepEqual(actorsFor(byDept, { departmentId: 'd-other' }).primary, [], 'an unmapped department names nobody');

  const byAmount = assign({
    type: 'amount',
    bands: [
      { id: 'small', from: null, to: 100000, primary: ['u-clerk'], alternates: [] },
      { id: 'large', from: 100001, to: null, primary: ['u-director'], alternates: ['u-cfo'] },
    ],
  });
  assert.deepEqual(actorsFor(byAmount, { amount: 50000 }).primary, ['u-clerk']);
  assert.deepEqual(actorsFor(byAmount, { amount: 500000 }).primary, ['u-director']);
  assert.deepEqual(actorsFor(byAmount, { amount: 500000 }).alternates, ['u-cfo']);
  assert.equal(actorsFor(byAmount, { amount: 100000 }).band.id, 'small', 'the ceiling is inclusive');
  assert.equal(bandMatches({ id: 'x', from: null, to: null, primary: [], alternates: [] }, 7), true);
  assert.equal(hasActors(assign({})), false);
  assert.equal(hasActors(byUsers), true);
});

test('roles-only leaves authority exactly as it was', () => {
  const assignment = assign({ mode: 'roles-only', users: { primary: ['u1'], alternates: [] } });
  assert.equal(mayAct(assignment, { userId: 'u1' }, false).allowed, false, 'being assigned grants nothing on its own');
  assert.equal(mayAct(assignment, { userId: 'u9' }, true).allowed, true);
  assert.equal(mayAct(assignment, { userId: 'u1' }, true).basis, 'role');
});

test('assigned-too widens, naming why', () => {
  const assignment = assign({ mode: 'assigned-too', users: { primary: ['u1'], alternates: ['u2'] } });
  const primary = mayAct(assignment, { userId: 'u1' }, false);
  assert.equal(primary.allowed, true);
  assert.equal(primary.basis, 'primary');
  assert.match(primary.reason, /Assigned to you/);

  const alternate = mayAct(assignment, { userId: 'u2' }, false);
  assert.equal(alternate.allowed, true);
  assert.equal(alternate.basis, 'alternate');
  assert.match(alternate.reason, /alternative/);

  assert.equal(mayAct(assignment, { userId: 'u9' }, true).allowed, true, 'the role still works');
  assert.equal(mayAct(assignment, { userId: 'u9' }, false).allowed, false);

  const byRole = assign({ mode: 'assigned-too', type: 'roles', roles: { primary: ['r1'], alternates: [] } });
  assert.equal(mayAct(byRole, { userId: 'u5', roleIds: ['r1'] }, false).basis, 'assigned-role');
  assert.equal(mayAct(byRole, { userId: 'u5', roleIds: ['r2'] }, false).allowed, false);
});

test('assigned-only narrows, but never locks everyone out', () => {
  const assignment = assign({ mode: 'assigned-only', users: { primary: ['u1'], alternates: ['u2'] } });
  assert.equal(mayAct(assignment, { userId: 'u1' }, false).allowed, true);
  assert.equal(mayAct(assignment, { userId: 'u2' }, false).allowed, true);
  const refused = mayAct(assignment, { userId: 'u9' }, true);
  assert.equal(refused.allowed, false, 'a role permission alone is no longer enough');
  assert.match(refused.reason, /restricted to the people assigned/);

  // Nobody named: the action falls back to the permission rather than disappearing from the app.
  const nobody = assign({ mode: 'assigned-only' });
  assert.equal(mayAct(nobody, { userId: 'u9' }, true).allowed, true);
  assert.match(mayAct(nobody, { userId: 'u9' }, true).reason, /Nobody is assigned/);
  assert.equal(mayAct(nobody, { userId: 'u9' }, false).allowed, false);

  // Per department: restricted where mapped, permission-driven where not.
  const byDept = assign({ mode: 'assigned-only', type: 'department', byDepartment: { 'd-hr': { primary: ['u-hr'], alternates: [] } } });
  assert.equal(mayAct(byDept, { userId: 'u9' }, true, { departmentId: 'd-hr' }).allowed, false);
  assert.equal(mayAct(byDept, { userId: 'u-hr' }, false, { departmentId: 'd-hr' }).allowed, true);
  assert.equal(mayAct(byDept, { userId: 'u9' }, true, { departmentId: 'd-free' }).allowed, true);
});

test('the set-up is checked for gaps that would bite', () => {
  const clean = validateExpensesRoles(resolveExpensesRolesDoc(undefined));
  assert.deepEqual(clean, [], 'nothing configured is nothing to complain about');

  const enforcedButEmpty = validateExpensesRoles(docOf({ 'manage-accounts': { mode: 'assigned-only' } }));
  assert.equal(enforcedButEmpty.filter((issue) => issue.severity === 'error').length, 1);
  assert.match(enforcedButEmpty[0].message, /nobody is assigned/);

  const noAlternate = validateExpensesRoles(docOf({ 'manage-accounts': { mode: 'assigned-only', users: { primary: ['u1'], alternates: [] } } }));
  assert.match(noAlternate.find((issue) => issue.severity === 'warning').message, /no alternative/);

  const openTop = validateExpensesRoles(
    docOf({ 'raise-request': { mode: 'assigned-too', type: 'amount', bands: [{ id: 'b', from: 0, to: 1000, primary: ['u1'], alternates: [] }] } }),
  );
  assert.ok(openTop.some((issue) => /no band covers the largest/.test(issue.message)));

  const backwards = validateExpensesRoles(
    docOf({ 'raise-request': { type: 'amount', bands: [{ id: 'b', from: 900, to: 100, primary: ['u1'], alternates: [] }] } }),
  );
  assert.ok(backwards.some((issue) => /floor is above its ceiling/.test(issue.message)));

  const gone = validateExpensesRoles(docOf({ 'manage-accounts': { users: { primary: ['ghost'], alternates: [] } } }), { userIds: ['u1'] });
  assert.ok(gone.some((issue) => /no longer exists/.test(issue.message)));
});

test('the audit log gets readable before/after lines', () => {
  const flat = flattenExpensesRoles(
    docOf({ 'manage-accounts': { mode: 'assigned-only', users: { primary: ['u1'], alternates: ['u2'] } } }),
    (id) => ({ u1: 'Asha', u2: 'Bimal' })[id] ?? id,
    (id) => id,
  );
  assert.equal(flat['Manage Head / Sub-Head of A/c · authority'], 'Only assigned people');
  assert.equal(flat['Manage Head / Sub-Head of A/c · people'], 'Asha');
  assert.equal(flat['Manage Head / Sub-Head of A/c · alternatives'], 'Bimal');
  assert.equal(flat['Raise an expense request · people'], '—');
});
