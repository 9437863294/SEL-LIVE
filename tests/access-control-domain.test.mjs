import test from 'node:test';
import assert from 'node:assert/strict';
// Imported from the pure resolver rather than the service, which pulls in the Firestore client and
// only resolves inside the bundler.
import {
  applyAssignmentToGrant,
  assertAdditive,
  buildAccessDashboard,
  canAssignAccess,
  canManageRoles,
  canOpenAccessManagement,
  canRevokeAccess,
  checkerFor,
  buildCopyAccessRequest,
  buildPermissionMatrix,
  canAccessModule,
  canAccessPage,
  countPermissions,
  countRoleUsage,
  daysUntilExpiry,
  describeAuditEntry,
  detectPrivilegedAccess,
  detectSodConflicts,
  diffPermissionMaps,
  explainPermission,
  expiringTemporaryGrants,
  flattenPermissionRegistry,
  formatBatchId,
  getEffectivePermissions,
  getPermissionSources,
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  intersectPermissionMaps,
  isGrantActive,
  isProtectedRole,
  mergePermissionMaps,
  normalizePermissionMap,
  normalizeUserAccessGrant,
  permissionKey,
  previewAssignment,
  registryActions,
  registryPermissionCount,
  removeAccessFromGrant,
  resolveEffectiveAccess,
  scopePermissionMap,
  searchRegistry,
  subtractPermissionMaps,
  temporaryGrantState,
  wouldStrandAdministration,
} from '../src/lib/access-control.ts';
import { permissionModules } from '../src/lib/permissions.ts';

/* ------------------------------------------------------------------------------------------------
 * Fixtures
 * ---------------------------------------------------------------------------------------------- */

const NOW = '2026-08-25T10:00:00.000Z';

const ROLES = [
  {
    id: 'role-hr',
    name: 'HR Executive',
    permissions: {
      'HR & Recruitment': ['View Module'],
      'HR & Recruitment.Candidates': ['View', 'Add'],
      Employee: ['View Module'],
      'Employee.Manage': ['View'],
    },
  },
  {
    id: 'role-pm',
    name: 'Project Manager',
    permissions: {
      'Project Management': ['View Module'],
      'Project Management.BOQ': ['View', 'Import'],
      'Project Management.Tower Progress': ['View', 'Update Progress'],
    },
  },
  {
    id: 'role-viewer',
    name: 'Project Viewer',
    permissions: {
      'Project Management': ['View Module'],
      'Project Management.Tower Progress': ['View'],
    },
  },
  {
    id: 'role-finance',
    name: 'Finance Manager',
    permissions: {
      'Recurring Payments': ['View Module'],
      'Recurring Payments.Payments': ['View', 'Add'],
      'Recurring Payments.Approvals': ['View', 'Approve'],
    },
  },
  {
    id: 'role-disabled',
    name: 'Retired Role',
    status: 'Inactive',
    permissions: { 'Bank Balance': ['View Module'] },
  },
];

const actor = { userId: 'admin-1', userName: 'Debaprasad' };

const userWith = (role) => ({ id: 'user-1', name: 'Amit Kumar', role, status: 'Active' });

const resolve = (user, grant, extra = {}) =>
  resolveEffectiveAccess({ user, roles: ROLES, grant, now: NOW, ...extra });

/* ------------------------------------------------------------------------------------------------
 * §49 — the non-negotiable test
 * ---------------------------------------------------------------------------------------------- */

test('§49: assigning an additional role adds to existing permissions and removes nothing', () => {
  // "User A" — HR.View, Attendance.View, Attendance.Edit, expressed in this app's registry shape.
  const roles = [
    {
      id: 'role-base',
      name: 'HR Base',
      permissions: {
        'HR & Recruitment': ['View'],
        'HR & Recruitment.Attendance': ['View', 'Edit'],
      },
    },
    {
      id: 'role-project-viewer',
      name: 'Project Viewer',
      permissions: {
        'Project Management': ['View'],
        'Project Management.Dashboard': ['View'],
        'Project Management.Towers': ['View'],
      },
    },
  ];
  const user = { id: 'user-a', name: 'User A', role: 'HR Base', status: 'Active' };

  const before = resolveEffectiveAccess({ user, roles, grant: null, now: NOW });
  assert.equal(before.permissionCount, 3);
  assert.ok(hasPermission(before, 'HR & Recruitment', 'View'));
  assert.ok(hasPermission(before, 'HR & Recruitment.Attendance', 'View'));
  assert.ok(hasPermission(before, 'HR & Recruitment.Attendance', 'Edit'));

  const grant = applyAssignmentToGrant(
    normalizeUserAccessGrant(user.id, null),
    { roleIds: ['role-project-viewer'] },
    { roles, actor, now: NOW },
  );

  const after = resolveEffectiveAccess({ user, roles, grant, now: NOW });

  // Everything that was there is still there.
  assert.ok(hasPermission(after, 'HR & Recruitment', 'View'), 'HR.View must survive');
  assert.ok(hasPermission(after, 'HR & Recruitment.Attendance', 'View'), 'Attendance.View must survive');
  assert.ok(hasPermission(after, 'HR & Recruitment.Attendance', 'Edit'), 'Attendance.Edit must survive');

  // And the new role's permissions are present as well.
  assert.ok(hasPermission(after, 'Project Management', 'View'));
  assert.ok(hasPermission(after, 'Project Management.Dashboard', 'View'));
  assert.ok(hasPermission(after, 'Project Management.Towers', 'View'));

  assert.equal(after.permissionCount, 6);

  const diff = diffPermissionMaps(before.permissions, after.permissions);
  assert.equal(diff.removedCount, 0, 'existing permissions removed must be 0');
  assert.equal(diff.addedCount, 3);

  // The failure mode the specification names explicitly: the user must NOT become only the new role.
  assert.notDeepEqual(getEffectivePermissions(after), roles[1].permissions);
});

/* ------------------------------------------------------------------------------------------------
 * Merging
 * ---------------------------------------------------------------------------------------------- */

test('mergePermissionMaps unions keys and actions without dropping either', () => {
  const merged = mergePermissionMaps(
    { A: ['View'], B: ['Edit'] },
    { A: ['Edit'], C: ['Delete'] },
  );
  assert.deepEqual(merged, { A: ['Edit', 'View'], B: ['Edit'], C: ['Delete'] });
});

test('mergePermissionMaps is idempotent — assigning the same role twice adds nothing', () => {
  const once = mergePermissionMaps({ A: ['View', 'Edit'] });
  const twice = mergePermissionMaps(once, { A: ['View', 'Edit'] });
  assert.deepEqual(once, twice);
});

test('mergePermissionMaps tolerates null, undefined and empty inputs', () => {
  assert.deepEqual(mergePermissionMaps(null, undefined, {}, { A: [] }), {});
  assert.deepEqual(mergePermissionMaps({ A: ['View'] }, null), { A: ['View'] });
});

test('normalizePermissionMap flattens a nested role document into dotted keys', () => {
  const nested = { 'E-Approval': { Settings: { 'Approval Types': ['View', 'Add'] } } };
  assert.deepEqual(normalizePermissionMap(nested), {
    'E-Approval.Settings.Approval Types': ['View', 'Add'],
  });
});

test('diffPermissionMaps reports added, removed and unchanged pairs', () => {
  const diff = diffPermissionMaps({ A: ['View', 'Edit'] }, { A: ['View'], B: ['Delete'] });
  assert.deepEqual(diff.added, ['B::Delete']);
  assert.deepEqual(diff.removed, ['A::Edit']);
  assert.deepEqual(diff.unchanged, ['A::View']);
});

test('assertAdditive throws when a projected set would lose a permission', () => {
  assert.throws(
    () => assertAdditive({ A: ['View', 'Edit'] }, { A: ['View'] }, 'test assignment'),
    /would remove 1 existing permission/,
  );
  assert.doesNotThrow(() => assertAdditive({ A: ['View'] }, { A: ['View', 'Edit'] }));
});

test('subtractPermissionMaps drops a key once its last action goes', () => {
  assert.deepEqual(subtractPermissionMaps({ A: ['View'], B: ['Edit'] }, { A: ['View'] }), { B: ['Edit'] });
});

test('intersectPermissionMaps finds what both sides already grant', () => {
  assert.deepEqual(
    intersectPermissionMaps({ A: ['View', 'Edit'] }, { A: ['View'], B: ['Delete'] }),
    { A: ['View'] },
  );
});

test('countPermissions counts resource::action pairs, not keys', () => {
  assert.equal(countPermissions({ A: ['View', 'Edit'], B: ['View'] }), 3);
});

/* ------------------------------------------------------------------------------------------------
 * Resolution
 * ---------------------------------------------------------------------------------------------- */

test('a user with no grant document has exactly their base role permissions', () => {
  const access = resolve(userWith('HR Executive'), null);
  assert.deepEqual(getEffectivePermissions(access), mergePermissionMaps(ROLES[0].permissions));
  assert.equal(access.baseRoleName, 'HR Executive');
  assert.deepEqual(access.additionalRoleNames, []);
});

test('a user whose base role no longer exists gets an empty set rather than a crash', () => {
  const access = resolve(userWith('Deleted Role'), null);
  assert.equal(access.permissionCount, 0);
  assert.equal(access.baseRoleName, 'Deleted Role');
});

test('multiple additional roles all contribute (§7)', () => {
  const grant = {
    additionalRoles: [
      { roleId: 'role-pm', roleName: 'Project Manager' },
      { roleId: 'role-finance', roleName: 'Finance Manager' },
    ],
    directPermissions: [{ resource: 'Bank Guarantee Management.Reports', actions: ['View', 'Export'] }],
  };
  const access = resolve(userWith('HR Executive'), grant);

  assert.ok(hasPermission(access, 'HR & Recruitment.Candidates', 'Add'), 'base role kept');
  assert.ok(hasPermission(access, 'Project Management.BOQ', 'Import'), 'additional role 1');
  assert.ok(hasPermission(access, 'Recurring Payments.Approvals', 'Approve'), 'additional role 2');
  assert.ok(hasPermission(access, 'Bank Guarantee Management.Reports', 'Export'), 'direct permission');
  assert.deepEqual(access.additionalRoleNames, ['Project Manager', 'Finance Manager']);
  assert.deepEqual(access.effectiveRoleNames, ['HR Executive', 'Project Manager', 'Finance Manager']);
});

test('a disabled role stops granting, but an absent status never does', () => {
  const withDisabled = resolve(userWith('HR Executive'), {
    additionalRoles: [{ roleId: 'role-disabled', roleName: 'Retired Role' }],
  });
  assert.equal(hasPermission(withDisabled, 'Bank Balance', 'View Module'), false);
  // Every role document that exists today has no status field at all.
  const noStatus = resolve(userWith('Project Manager'), null);
  assert.ok(hasPermission(noStatus, 'Project Management.BOQ', 'View'));
});

test('suspending the additive layer never touches the base role', () => {
  const grant = {
    status: 'Suspended',
    additionalRoles: [{ roleId: 'role-pm', roleName: 'Project Manager' }],
  };
  const access = resolve(userWith('HR Executive'), grant);
  assert.ok(hasPermission(access, 'HR & Recruitment.Candidates', 'View'), 'base role survives suspension');
  assert.equal(hasPermission(access, 'Project Management.BOQ', 'View'), false);
});

test('project access expands into the scoped keys the existing checker understands', () => {
  const grant = {
    projectAccess: [
      {
        projectId: 'rayagada',
        projectName: 'Rayagada',
        permissions: { 'Project Management.Tower Progress': ['View'] },
      },
    ],
  };
  const access = resolve(userWith('HR Executive'), grant);
  assert.deepEqual(access.projectIds, ['rayagada']);
  assert.ok(
    hasPermission(access, 'Project Management.Tower Progress', 'View', 'rayagada'),
    'scoped check resolves',
  );
  assert.equal(
    hasPermission(access, 'Project Management.Tower Progress', 'View', 'phulbani'),
    false,
    'a different project is not granted',
  );
});

test('scopePermissionMap produces `${resource}.${scope}` keys', () => {
  assert.deepEqual(scopePermissionMap({ 'A.B': ['View'] }, 'proj-1'), { 'A.B.proj-1': ['View'] });
});

test('department scope grants reach every member (§21)', () => {
  const scopeGrants = [
    {
      id: 'sg-1',
      scopeType: 'Department',
      scopeId: 'dept-finance',
      scopeName: 'Finance',
      roleIds: ['role-finance'],
    },
  ];
  const access = resolve(userWith('HR Executive'), { departmentIds: ['dept-finance'] }, { scopeGrants });
  assert.ok(hasPermission(access, 'Recurring Payments.Approvals', 'Approve'));
  assert.deepEqual(getPermissionSources(access, 'Recurring Payments.Approvals', 'Approve')[0].kind, 'Department');
});

test('designation scope grants work the same way', () => {
  const scopeGrants = [
    { id: 'sg-2', scopeType: 'Designation', scopeId: 'Project Manager', roleIds: ['role-pm'] },
  ];
  const access = resolve(userWith('HR Executive'), { designations: ['Project Manager'] }, { scopeGrants });
  assert.ok(hasPermission(access, 'Project Management.BOQ', 'Import'));
});

test('an inactive scope grant contributes nothing', () => {
  const scopeGrants = [
    { id: 'sg-3', scopeType: 'Department', scopeId: 'd1', roleIds: ['role-finance'], active: false },
  ];
  const access = resolve(userWith('HR Executive'), { departmentIds: ['d1'] }, { scopeGrants });
  assert.equal(hasPermission(access, 'Recurring Payments.Approvals', 'Approve'), false);
});

/* ------------------------------------------------------------------------------------------------
 * Temporary access (§22)
 * ---------------------------------------------------------------------------------------------- */

const temporaryGrant = (overrides = {}) => ({
  id: 'temp-1',
  roleId: 'role-finance',
  roleName: 'Finance Manager',
  startAt: '2026-08-25T00:00:00.000Z',
  expiresAt: '2026-09-10T00:00:00.000Z',
  reason: 'BG approval cover',
  ...overrides,
});

test('temporary access grants while in force and lapses without deletion', () => {
  const grant = { temporaryAccess: [temporaryGrant()] };

  const during = resolve(userWith('HR Executive'), grant);
  assert.ok(hasPermission(during, 'Recurring Payments.Approvals', 'Approve'));
  assert.equal(during.temporaryActive.length, 1);

  const after = resolveEffectiveAccess({
    user: userWith('HR Executive'),
    roles: ROLES,
    grant,
    now: '2026-09-11T00:00:00.000Z',
  });
  assert.equal(hasPermission(after, 'Recurring Payments.Approvals', 'Approve'), false);
  assert.equal(after.temporaryExpired.length, 1, 'the record survives so the audit history does');
  assert.ok(hasPermission(after, 'HR & Recruitment.Candidates', 'View'), 'base role unaffected');
});

test('a temporary grant that has not started yet is Upcoming, not Active', () => {
  const grant = { temporaryAccess: [temporaryGrant({ startAt: '2026-09-01T00:00:00.000Z' })] };
  const access = resolve(userWith('HR Executive'), grant);
  assert.equal(access.temporaryUpcoming.length, 1);
  assert.equal(hasPermission(access, 'Recurring Payments.Approvals', 'Approve'), false);
});

test('temporaryGrantState covers all four states', () => {
  assert.equal(temporaryGrantState(temporaryGrant(), NOW), 'Active');
  assert.equal(temporaryGrantState(temporaryGrant({ startAt: '2026-09-01T00:00:00.000Z' }), NOW), 'Upcoming');
  assert.equal(temporaryGrantState(temporaryGrant({ expiresAt: '2026-08-01T00:00:00.000Z' }), NOW), 'Expired');
  assert.equal(temporaryGrantState(temporaryGrant({ revokedAt: NOW }), NOW), 'Revoked');
});

test('daysUntilExpiry and expiringTemporaryGrants drive the expiry dashboard', () => {
  const soon = temporaryGrant({ id: 'soon', expiresAt: '2026-08-28T10:00:00.000Z' });
  const later = temporaryGrant({ id: 'later', expiresAt: '2026-10-01T10:00:00.000Z' });
  assert.equal(daysUntilExpiry(soon, NOW), 3);
  assert.deepEqual(expiringTemporaryGrants([soon, later], 7, NOW).map((g) => g.id), ['soon']);
});

test('isGrantActive treats an unbounded grant as permanent', () => {
  assert.equal(isGrantActive({}, NOW), true);
  assert.equal(isGrantActive({ expiresAt: '2026-01-01T00:00:00.000Z' }, NOW), false);
  assert.equal(isGrantActive({ revokedAt: NOW }, NOW), false);
});

/* ------------------------------------------------------------------------------------------------
 * Source attribution (§8, §44)
 * ---------------------------------------------------------------------------------------------- */

test('every permission records where it came from', () => {
  const grant = {
    additionalRoles: [
      {
        roleId: 'role-pm',
        roleName: 'Project Manager',
        assignedBy: 'admin-1',
        assignedByName: 'Debaprasad',
        assignedAt: '2026-08-20T09:00:00.000Z',
      },
    ],
  };
  const access = resolve(userWith('HR Executive'), grant);

  const baseSources = getPermissionSources(access, 'HR & Recruitment.Candidates', 'View');
  assert.equal(baseSources.length, 1);
  assert.equal(baseSources[0].kind, 'Base Role');
  assert.equal(baseSources[0].label, 'HR Executive');

  const addedSources = getPermissionSources(access, 'Project Management.BOQ', 'Import');
  assert.equal(addedSources[0].kind, 'Additional Role');
  assert.equal(addedSources[0].assignedByName, 'Debaprasad');
});

test('explainPermission answers "why does this user have this?"', () => {
  const grant = {
    additionalRoles: [
      {
        roleId: 'role-finance',
        roleName: 'Finance Manager',
        assignedByName: 'Admin',
        assignedAt: '2026-08-20T00:00:00.000Z',
      },
    ],
  };
  const access = resolve(userWith('HR Executive'), grant);
  const why = explainPermission(access, 'Recurring Payments.Approvals', 'Approve');
  assert.equal(why.granted, true);
  assert.match(why.summary, /Finance Manager \(Additional Role\)/);
  assert.match(why.summary, /assigned by Admin/);
  assert.match(why.summary, /20-Aug-2026/);
});

test('explainPermission says so plainly when the permission is not held', () => {
  const access = resolve(userWith('HR Executive'), null);
  const why = explainPermission(access, 'Recurring Payments.Approvals', 'Approve');
  assert.equal(why.granted, false);
  assert.match(why.summary, /Not granted/);
});

test('a permission held through two sources says removing one will not revoke it', () => {
  // Project Viewer and Project Manager both grant Tower Progress · View.
  const grant = {
    additionalRoles: [
      { roleId: 'role-pm', roleName: 'Project Manager' },
      { roleId: 'role-viewer', roleName: 'Project Viewer' },
    ],
  };
  const access = resolve(userWith('HR Executive'), grant);
  const why = explainPermission(access, 'Project Management.Tower Progress', 'View');
  assert.equal(why.sources.length, 2);
  assert.match(why.summary, /Removing one will not revoke it/);
});

/* ------------------------------------------------------------------------------------------------
 * §17 — source-aware removal
 * ---------------------------------------------------------------------------------------------- */

test('§17: removing an additional role keeps permissions the base role still grants', () => {
  const user = userWith('Project Manager'); // base already grants Tower Progress · View
  const grant = applyAssignmentToGrant(
    normalizeUserAccessGrant(user.id, null),
    { roleIds: ['role-viewer'] },
    { roles: ROLES, actor, now: NOW },
  );

  const withBoth = resolve(user, grant);
  assert.ok(hasPermission(withBoth, 'Project Management.Tower Progress', 'View'));

  const outcome = removeAccessFromGrant(user, grant, { roleIds: ['role-viewer'] }, { roles: ROLES, actor, now: NOW });
  const after = resolve(user, outcome.grant);

  assert.ok(
    hasPermission(after, 'Project Management.Tower Progress', 'View'),
    'still granted by the base role',
  );
  assert.deepEqual(outcome.permissionsLost, [], 'nothing was actually lost');
  assert.ok(outcome.permissionsRetainedByOtherSources.includes('Project Management.Tower Progress::View'));
});

test('removing an additional role does take away what only it granted', () => {
  const user = userWith('HR Executive');
  const grant = applyAssignmentToGrant(
    normalizeUserAccessGrant(user.id, null),
    { roleIds: ['role-finance'] },
    { roles: ROLES, actor, now: NOW },
  );
  const outcome = removeAccessFromGrant(user, grant, { roleIds: ['role-finance'] }, { roles: ROLES, actor, now: NOW });
  assert.ok(outcome.permissionsLost.includes('Recurring Payments.Approvals::Approve'));

  const after = resolve(user, outcome.grant);
  assert.ok(hasPermission(after, 'HR & Recruitment.Candidates', 'View'), 'base role untouched');
});

test('removal revokes temporary grants rather than deleting them', () => {
  const user = userWith('HR Executive');
  const grant = normalizeUserAccessGrant(user.id, { temporaryAccess: [temporaryGrant()] });
  const outcome = removeAccessFromGrant(user, grant, { temporaryIds: ['temp-1'] }, { roles: ROLES, actor, now: NOW });
  assert.equal(outcome.grant.temporaryAccess.length, 1);
  assert.ok(outcome.grant.temporaryAccess[0].revokedAt);
  assert.equal(outcome.grant.temporaryAccess[0].revokedBy, 'admin-1');
});

test('removal never touches the base role field', () => {
  const user = userWith('Project Manager');
  const grant = normalizeUserAccessGrant(user.id, {
    additionalRoles: [{ roleId: 'role-finance', roleName: 'Finance Manager' }],
  });
  const outcome = removeAccessFromGrant(
    user,
    grant,
    { roleIds: ['role-finance', 'role-pm'] },
    { roles: ROLES, actor, now: NOW },
  );
  const after = resolve(user, outcome.grant);
  assert.ok(hasPermission(after, 'Project Management.BOQ', 'Import'), 'base role survives even if named');
});

/* ------------------------------------------------------------------------------------------------
 * Assignment application
 * ---------------------------------------------------------------------------------------------- */

test('applyAssignmentToGrant appends and never replaces', () => {
  const start = normalizeUserAccessGrant('user-1', {
    additionalRoles: [{ roleId: 'role-viewer', roleName: 'Project Viewer' }],
  });
  const next = applyAssignmentToGrant(start, { roleIds: ['role-finance'] }, { roles: ROLES, actor, now: NOW });
  assert.deepEqual(next.additionalRoles.map((r) => r.roleId), ['role-viewer', 'role-finance']);
});

test('assigning a role the user already holds additionally is a no-op (§16)', () => {
  const start = normalizeUserAccessGrant('user-1', {
    additionalRoles: [{ roleId: 'role-finance', roleName: 'Finance Manager' }],
  });
  const next = applyAssignmentToGrant(start, { roleIds: ['role-finance'] }, { roles: ROLES, actor, now: NOW });
  assert.equal(next.additionalRoles.length, 1);
});

test('direct permissions merge into an existing permanent grant for the same resource', () => {
  let grant = normalizeUserAccessGrant('user-1', null);
  grant = applyAssignmentToGrant(
    grant,
    { directPermissions: { 'Insurance.Reports': ['View Reports'] } },
    { roles: ROLES, actor, now: NOW },
  );
  grant = applyAssignmentToGrant(
    grant,
    { directPermissions: { 'Insurance.Reports': ['View Reports'] } },
    { roles: ROLES, actor, now: NOW },
  );
  assert.equal(grant.directPermissions.length, 1);
  assert.deepEqual(grant.directPermissions[0].actions, ['View Reports']);
});

test('a temporary request routes a role into temporaryAccess, not additionalRoles', () => {
  const grant = applyAssignmentToGrant(
    normalizeUserAccessGrant('user-1', null),
    {
      roleIds: ['role-finance'],
      temporary: { startAt: '2026-08-25T00:00:00.000Z', expiresAt: '2026-09-10T00:00:00.000Z', reason: 'cover' },
    },
    { roles: ROLES, actor, now: NOW },
  );
  assert.equal(grant.additionalRoles.length, 0);
  assert.equal(grant.temporaryAccess.length, 1);
  assert.equal(grant.temporaryAccess[0].reason, 'cover');
});

test('applyAssignmentToGrant stamps provenance on every entry', () => {
  const grant = applyAssignmentToGrant(
    normalizeUserAccessGrant('user-1', null),
    { roleIds: ['role-pm'], projectIds: ['rayagada'] },
    { roles: ROLES, actor: { ...actor, batchId: 'ACCESS-BATCH-20260825-001' }, now: NOW },
  );
  assert.equal(grant.additionalRoles[0].assignedByName, 'Debaprasad');
  assert.equal(grant.additionalRoles[0].batchId, 'ACCESS-BATCH-20260825-001');
  assert.equal(grant.projectAccess[0].projectId, 'rayagada');
  assert.equal(grant.createdBy, 'admin-1');
});

/* ------------------------------------------------------------------------------------------------
 * Preview (§15, §16, §26, §34)
 * ---------------------------------------------------------------------------------------------- */

test('previewAssignment reports zero removals and counts what is genuinely new', () => {
  const subjects = [
    { user: { id: 'u1', name: 'Rahul', role: 'HR Executive' }, grant: null },
    { user: { id: 'u2', name: 'Sita', role: 'Project Manager' }, grant: null },
  ];
  const preview = previewAssignment(subjects, { roleIds: ['role-viewer'] }, { roles: ROLES, now: NOW });

  assert.equal(preview.userCount, 2);
  assert.equal(preview.permissionsRemoved, 0);
  assert.deepEqual(preview.blockingIssues, []);

  // Rahul gains all 2 of Project Viewer's pairs; Sita's base role already grants both.
  const rahul = preview.plans.find((p) => p.userId === 'u1');
  const sita = preview.plans.find((p) => p.userId === 'u2');
  assert.equal(rahul.diff.addedCount, 2);
  assert.equal(sita.diff.addedCount, 0);
  assert.equal(preview.permissionsAdded, 2);
});

test('previewAssignment marks a role the user already holds as already assigned', () => {
  const subjects = [
    {
      user: { id: 'u1', name: 'Rahul', role: 'HR Executive' },
      grant: { additionalRoles: [{ roleId: 'role-finance', roleName: 'Finance Manager' }] },
    },
  ];
  const preview = previewAssignment(
    subjects,
    { roleIds: ['role-finance', 'role-viewer'] },
    { roles: ROLES, now: NOW },
  );
  const plan = preview.plans[0];
  assert.deepEqual(plan.rolesAlreadyHeld.map((r) => r.name), ['Finance Manager']);
  assert.deepEqual(plan.rolesToAdd.map((r) => r.name), ['Project Viewer']);
});

test('previewAssignment counts users who already had everything', () => {
  const subjects = [{ user: { id: 'u2', name: 'Sita', role: 'Project Manager' }, grant: null }];
  const preview = previewAssignment(subjects, { roleIds: ['role-viewer'] }, { roles: ROLES, now: NOW });
  // Project Manager already grants everything Project Viewer does, but the role assignment itself
  // is still new — so the user is affected, just not by any new permission.
  assert.equal(preview.permissionsAdded, 0);
  assert.equal(preview.roleAssignmentsAdded, 1);
});

test('previewAssignment blocks an empty or malformed request', () => {
  assert.ok(previewAssignment([], { roleIds: ['role-pm'] }, { roles: ROLES }).blockingIssues.length);
  const noGrant = previewAssignment(
    [{ user: { id: 'u1', role: 'HR Executive' } }],
    {},
    { roles: ROLES },
  );
  assert.ok(noGrant.blockingIssues.some((issue) => /at least one role/.test(issue)));

  const badWindow = previewAssignment(
    [{ user: { id: 'u1', role: 'HR Executive' } }],
    {
      roleIds: ['role-pm'],
      temporary: { startAt: '2026-09-10T00:00:00.000Z', expiresAt: '2026-08-25T00:00:00.000Z', reason: 'x' },
    },
    { roles: ROLES, now: NOW },
  );
  assert.ok(badWindow.blockingIssues.some((issue) => /expiry must be after/.test(issue)));
});

test('previewAssignment warns about a role that no longer exists instead of failing', () => {
  const preview = previewAssignment(
    [{ user: { id: 'u1', role: 'HR Executive' } }],
    { roleIds: ['role-pm', 'role-gone'] },
    { roles: ROLES, now: NOW },
  );
  assert.ok(preview.warnings.some((warning) => /no longer exist/.test(warning)));
  assert.deepEqual(preview.blockingIssues, []);
});

test('previewAssignment expands templates into roles and permissions (§24)', () => {
  const templates = [
    {
      id: 'tpl-site-engineer',
      name: 'Site Engineer',
      roleIds: ['role-viewer'],
      permissions: { 'Project Management.Survey': ['Record'] },
    },
  ];
  const preview = previewAssignment(
    [{ user: { id: 'u1', name: 'New Hire', role: 'HR Executive' } }],
    { templateIds: ['tpl-site-engineer'] },
    { roles: ROLES, templates, now: NOW },
  );
  assert.equal(preview.permissionsRemoved, 0);
  assert.ok(preview.plans[0].diff.added.includes('Project Management.Survey::Record'));
  assert.deepEqual(preview.plans[0].rolesToAdd.map((r) => r.name), ['Project Viewer']);
});

/* ------------------------------------------------------------------------------------------------
 * Copy access (§23)
 * ---------------------------------------------------------------------------------------------- */

test('buildCopyAccessRequest copies additional access but not the base role by default', () => {
  const sourceGrant = normalizeUserAccessGrant('ravi', {
    additionalRoles: [{ roleId: 'role-pm', roleName: 'Project Manager' }],
    directPermissions: [{ resource: 'Insurance.Reports', actions: ['View Reports'] }],
    projectAccess: [{ projectId: 'rayagada' }],
    departmentIds: ['dept-projects'],
  });
  const sourceUser = { id: 'ravi', name: 'Ravi Kumar', role: 'HR Executive' };

  const request = buildCopyAccessRequest(sourceGrant, sourceUser, { roles: ROLES, now: NOW });
  assert.deepEqual(request.roleIds, ['role-pm']);
  assert.deepEqual(request.directPermissions, { 'Insurance.Reports': ['View Reports'] });
  assert.deepEqual(request.projectIds, ['rayagada']);
  assert.deepEqual(request.departmentIds, ['dept-projects']);

  const withBase = buildCopyAccessRequest(sourceGrant, sourceUser, {
    roles: ROLES,
    includeBaseRoleAsAdditional: true,
    now: NOW,
  });
  assert.deepEqual(withBase.roleIds, ['role-pm', 'role-hr']);
});

test('copying access onto a target never removes what the target already had', () => {
  const sourceGrant = normalizeUserAccessGrant('ravi', {
    additionalRoles: [{ roleId: 'role-pm', roleName: 'Project Manager' }],
  });
  const request = buildCopyAccessRequest(sourceGrant, { id: 'ravi', role: 'HR Executive' }, { roles: ROLES, now: NOW });

  const target = { id: 'new-eng', name: 'New Engineer', role: 'Finance Manager' };
  const preview = previewAssignment([{ user: target, grant: null }], request, { roles: ROLES, now: NOW });
  assert.equal(preview.permissionsRemoved, 0);

  const grant = applyAssignmentToGrant(normalizeUserAccessGrant(target.id, null), request, {
    roles: ROLES,
    actor,
    now: NOW,
  });
  const after = resolve(target, grant);
  assert.ok(hasPermission(after, 'Recurring Payments.Approvals', 'Approve'), 'target base role kept');
  assert.ok(hasPermission(after, 'Project Management.BOQ', 'Import'), 'copied access applied');
});

/* ------------------------------------------------------------------------------------------------
 * Checking helpers
 * ---------------------------------------------------------------------------------------------- */

test('hasAnyPermission and hasAllPermissions', () => {
  const access = resolve(userWith('Project Manager'), null);
  assert.ok(hasAnyPermission(access, [
    { resource: 'Nope', action: 'View' },
    { resource: 'Project Management.BOQ', action: 'View' },
  ]));
  assert.equal(
    hasAllPermissions(access, [
      { resource: 'Project Management.BOQ', action: 'View' },
      { resource: 'Nope', action: 'View' },
    ]),
    false,
  );
});

test('canAccessModule accepts a page-level grant without an explicit View Module', () => {
  const access = resolve({ id: 'u', role: 'none' }, {
    directPermissions: [{ resource: 'Vehicle Management.Trip Management', actions: ['View'] }],
  });
  assert.ok(canAccessModule(access, 'Vehicle Management'));
  assert.equal(canAccessModule(access, 'Bank Balance'), false);
});

test('canAccessPage respects scope', () => {
  const access = resolve({ id: 'u', role: 'none' }, {
    projectAccess: [{ projectId: 'p1', permissions: { 'Project Management.Survey': ['Record'] } }],
  });
  assert.ok(canAccessPage(access, 'Project Management.Survey', 'p1'));
  assert.equal(canAccessPage(access, 'Project Management.Survey'), false);
});

test('View All on a module satisfies a scoped View, matching useAuthorization', () => {
  const access = resolve({ id: 'u', role: 'none' }, {
    directPermissions: [{ resource: 'Site Fund Request', actions: ['View All'] }],
  });
  assert.ok(hasPermission(access, 'Site Fund Request.Requests', 'View', 'any-project'));
});

/* ------------------------------------------------------------------------------------------------
 * Registry (§32, §41)
 * ---------------------------------------------------------------------------------------------- */

test('flattenPermissionRegistry covers the real registry, including nested nodes', () => {
  const nodes = flattenPermissionRegistry(permissionModules);
  const byResource = new Map(nodes.map((node) => [node.resource, node]));

  assert.ok(byResource.has('Project Management.Tower Progress'));
  assert.ok(byResource.get('Project Management.Tower Progress').actions.includes('Verify Progress'));

  // Three-level node.
  assert.ok(byResource.has('E-Approval.Settings.Approval Types'));
  assert.equal(byResource.get('E-Approval.Settings.Approval Types').depth, 2);

  // Array-shaped module.
  assert.ok(byResource.get('Site Fund Requisition').actions.includes('Approve Request'));

  // The module node itself is openable.
  assert.deepEqual(byResource.get('Project Management').actions, ['View Module']);

  // The new access-management node registered itself by existing in permissions.ts.
  assert.ok(byResource.get('Settings.Access Management').actions.includes('Assign'));

  assert.ok(registryPermissionCount(nodes) > 500, 'the registry is substantial');
  assert.ok(registryActions(nodes).includes('Approve'));
});

test('searchRegistry finds by module, page and action', () => {
  const nodes = flattenPermissionRegistry(permissionModules);
  assert.ok(searchRegistry(nodes, 'tower progress').length > 0);
  assert.ok(searchRegistry(nodes, 'verify progress').length > 0);
  assert.equal(searchRegistry(nodes, '').length, nodes.length);
});

test('buildPermissionMatrix renders one row per module with canonical action columns', () => {
  const nodes = flattenPermissionRegistry(permissionModules);
  const access = resolve(userWith('Project Manager'), null);
  const rows = buildPermissionMatrix(access, nodes, { access });

  const pm = rows.find((row) => row.module === 'Project Management');
  assert.ok(pm.cells.View.granted, 'View is ticked');
  assert.ok(pm.cells.Create.granted, '"Import" counts as Create');
  assert.equal(pm.cells.Delete.granted, false);
  assert.ok(pm.totalCount > pm.grantedCount);

  const hr = rows.find((row) => row.module === 'HR & Recruitment');
  assert.equal(hr.cells.View.granted, false);
});

test('the matrix marks a cell inherited when nothing in it comes from the base role', () => {
  const nodes = flattenPermissionRegistry(permissionModules);
  const access = resolve(userWith('HR Executive'), {
    additionalRoles: [{ roleId: 'role-pm', roleName: 'Project Manager' }],
  });
  const rows = buildPermissionMatrix(access, nodes, { access });
  assert.ok(rows.find((row) => row.module === 'Project Management').cells.View.inherited);
  assert.equal(rows.find((row) => row.module === 'HR & Recruitment').cells.View.inherited, false);
});

/* ------------------------------------------------------------------------------------------------
 * Risk (§31, §46) and reporting (§36, §37)
 * ---------------------------------------------------------------------------------------------- */

test('detectPrivilegedAccess finds high-risk capability regardless of role name', () => {
  const access = resolve({ id: 'u', role: 'none' }, {
    directPermissions: [{ resource: 'Settings.User Management', actions: ['Edit'] }],
  });
  const findings = detectPrivilegedAccess(access);
  assert.deepEqual(findings.map((f) => f.label), ['Can manage user accounts']);
});

test('detectSodConflicts flags create-and-approve on the same object', () => {
  const access = resolve({ id: 'u', role: 'none' }, {
    directPermissions: [
      { resource: 'Recurring Payments.Payments', actions: ['Add'] },
      { resource: 'Recurring Payments.Approvals', actions: ['Approve'] },
    ],
  });
  const conflicts = detectSodConflicts(access);
  assert.deepEqual(conflicts.map((c) => c.id), ['payment-create-approve']);
});

test('detectSodConflicts is quiet for someone who can only create', () => {
  const access = resolve({ id: 'u', role: 'none' }, {
    directPermissions: [{ resource: 'Recurring Payments.Payments', actions: ['Add'] }],
  });
  assert.deepEqual(detectSodConflicts(access), []);
});

test('isProtectedRole is case- and whitespace-insensitive', () => {
  assert.ok(isProtectedRole('Super Admin'));
  assert.ok(isProtectedRole('  super admin '));
  assert.equal(isProtectedRole('Project Engineer'), false);
});

test('wouldStrandAdministration protects the last administrator (§31)', () => {
  const admins = [
    { userId: 'a1', status: 'Active' },
    { userId: 'a2', status: 'Inactive' },
  ];
  assert.equal(wouldStrandAdministration(admins, ['a2']), false, 'a1 still stands');
  assert.equal(wouldStrandAdministration(admins, ['a1']), true, 'only an inactive admin would remain');
});

test('countRoleUsage counts base and additional holders separately (§4)', () => {
  const users = [
    { id: 'u1', role: 'HR Executive' },
    { id: 'u2', role: 'HR Executive' },
    { id: 'u3', role: 'Project Manager' },
  ];
  const grants = {
    u3: normalizeUserAccessGrant('u3', {
      additionalRoles: [{ roleId: 'role-hr', roleName: 'HR Executive' }],
    }),
  };
  const usage = countRoleUsage(users, grants);
  assert.deepEqual(usage['HR Executive'], { base: 2, additional: 1, total: 3 });
  assert.deepEqual(usage['Project Manager'], { base: 1, additional: 0, total: 1 });
});

test('buildAccessDashboard aggregates the §37 tiles', () => {
  const users = [
    { id: 'u1', role: 'HR Executive', status: 'Active' },
    { id: 'u2', role: '', status: 'Active' },
    { id: 'u3', role: 'Finance Manager', status: 'Inactive' },
  ];
  const grants = {
    u1: normalizeUserAccessGrant('u1', {
      additionalRoles: [{ roleId: 'role-finance', roleName: 'Finance Manager' }],
      temporaryAccess: [temporaryGrant({ expiresAt: '2026-08-27T00:00:00.000Z' })],
    }),
    u2: normalizeUserAccessGrant('u2', null),
    u3: normalizeUserAccessGrant('u3', null),
  };
  const accessByUser = Object.fromEntries(
    users.map((user) => [user.id, resolve(user, grants[user.id])]),
  );

  const stats = buildAccessDashboard({ users, roles: ROLES, grants, accessByUser, now: NOW });
  assert.equal(stats.totalUsers, 3);
  assert.equal(stats.activeUsers, 2);
  assert.equal(stats.usersWithoutRoles, 1);
  assert.equal(stats.usersWithAdditionalAccess, 1);
  assert.equal(stats.temporaryAccessActive, 1);
  assert.equal(stats.temporaryAccessExpiringSoon, 1);
  assert.equal(stats.totalRoles, 5);
  assert.ok(stats.totalPermissions > 0);
});

test('an inactive user contributes nothing from the additive layer', () => {
  const inactive = { id: 'u3', role: 'Finance Manager', status: 'Inactive' };
  const access = resolve(inactive, {
    additionalRoles: [{ roleId: 'role-pm', roleName: 'Project Manager' }],
  });
  assert.equal(hasPermission(access, 'Project Management.BOQ', 'View'), false);
  // The base role is untouched — deactivation is handled by the login path, not by this resolver.
  assert.ok(hasPermission(access, 'Recurring Payments.Payments', 'View'));
});

/* ------------------------------------------------------------------------------------------------
 * Audit (§27, §28)
 * ---------------------------------------------------------------------------------------------- */

test('formatBatchId is chronologically sortable', () => {
  const a = formatBatchId(new Date('2026-08-25T00:00:00.000Z'), 1);
  const b = formatBatchId(new Date('2026-08-25T00:00:00.000Z'), 12);
  const c = formatBatchId(new Date('2026-09-01T00:00:00.000Z'), 1);
  assert.equal(a, 'ACCESS-BATCH-20260825-001');
  assert.deepEqual([c, b, a].sort(), [a, b, c]);
});

test('describeAuditEntry reads as prose and states the removal count', () => {
  const line = describeAuditEntry({
    targetUserId: 'u1',
    targetUserName: 'Rahul Kumar',
    action: 'Grant Access',
    roleNames: ['Project Manager'],
    permissionsAdded: ['a::View'],
    permissionsRemoved: [],
    permissionsSkipped: [],
    sourceKind: 'Additional Role',
    changedBy: 'admin-1',
    changedByName: 'Debaprasad',
    changedAt: NOW,
  });
  assert.equal(line, 'Added Project Manager for Rahul Kumar — existing permissions removed: 0');
});

test('permissionKey round-trips through the source map', () => {
  const access = resolve(userWith('Project Manager'), null);
  assert.ok(access.sources[permissionKey('Project Management.BOQ', 'View')]);
});

/* ------------------------------------------------------------------------------------------------
 * The AuthProvider merge — the property the whole layer's safety rests on
 * ---------------------------------------------------------------------------------------------- */

/**
 * `AuthProvider` computes `permissions` as `mergePermissionMaps(basePermissions, additive)`, where
 * `basePermissions` comes from the original live `roles where name == user.role` listener and
 * `additive` comes from the new resolver. These tests pin the three cases that matter, because a
 * regression in any of them is a user silently losing access.
 */
test('AuthProvider merge: no additive layer means exactly the base role, byte for byte', () => {
  const basePermissions = ROLES[0].permissions;
  // The additive resolver returns null when the grant document is absent or unreadable.
  const additive = null;
  const merged = additive ? mergePermissionMaps(basePermissions, additive) : basePermissions;
  assert.equal(merged, basePermissions, 'the same object, not a copy — no behaviour change at all');
});

test('AuthProvider merge: the union is a superset of the base role', () => {
  const basePermissions = ROLES[0].permissions;
  const additive = resolve(userWith('HR Executive'), {
    additionalRoles: [{ roleId: 'role-pm', roleName: 'Project Manager' }],
  });
  const merged = mergePermissionMaps(basePermissions, additive.permissions);
  assert.deepEqual(diffPermissionMaps(basePermissions, merged).removed, []);
  assert.ok(hasPermission(merged, 'Project Management.BOQ', 'Import'));
});

test('AuthProvider merge: a stale roles read cannot lose the base role', () => {
  // The two paths read differently — a live name query versus a whole-collection read. If the
  // collection read misses the base role (renamed mid-session, partial read), the union with
  // basePermissions is what keeps the user whole.
  const basePermissions = ROLES[0].permissions;
  const additiveWithoutBaseRole = resolveEffectiveAccess({
    user: userWith('HR Executive'),
    roles: ROLES.filter((role) => role.id !== 'role-hr'), // base role absent from this read
    grant: { additionalRoles: [{ roleId: 'role-pm', roleName: 'Project Manager' }] },
    now: NOW,
  });
  assert.equal(
    hasPermission(additiveWithoutBaseRole, 'HR & Recruitment.Candidates', 'View'),
    false,
    'the resolver alone would have dropped it',
  );

  const merged = mergePermissionMaps(basePermissions, additiveWithoutBaseRole.permissions);
  assert.ok(hasPermission(merged, 'HR & Recruitment.Candidates', 'View'), 'the merge restores it');
  assert.ok(hasPermission(merged, 'Project Management.BOQ', 'Import'), 'and keeps the addition');
});

/* ------------------------------------------------------------------------------------------------
 * The administration gate (§6, §30)
 * ---------------------------------------------------------------------------------------------- */

test('an existing administrator can open access management before the new permission exists', () => {
  // The day-one case: no role document holds Settings.Access Management, because the node did not
  // exist when the roles were written.
  const legacyAdmin = checkerFor({
    'Settings.User Management': ['View', 'Add', 'Edit'],
    'Settings.Role Management': ['View', 'Add', 'Edit'],
  });
  assert.ok(canOpenAccessManagement(legacyAdmin));
  assert.ok(canAssignAccess(legacyAdmin));
  assert.ok(canRevokeAccess(legacyAdmin));
  assert.ok(canManageRoles(legacyAdmin));
});

test('the new permission alone is enough', () => {
  const scoped = checkerFor({ 'Settings.Access Management': ['View', 'Assign'] });
  assert.ok(canOpenAccessManagement(scoped));
  assert.ok(canAssignAccess(scoped));
  assert.equal(canRevokeAccess(scoped), false, 'Assign does not imply Revoke');
  assert.equal(canManageRoles(scoped), false, 'nor does it imply editing roles');
});

test('holding only one half of the legacy pair is not enough', () => {
  const halfAdmin = checkerFor({ 'Settings.User Management': ['View', 'Edit'] });
  assert.equal(canOpenAccessManagement(halfAdmin), false);
  assert.equal(canAssignAccess(halfAdmin), false);
});

test('an ordinary user cannot open access management', () => {
  const ordinary = checkerFor(resolve(userWith('HR Executive'), null));
  assert.equal(canOpenAccessManagement(ordinary), false);
  assert.equal(canAssignAccess(ordinary), false);
  assert.equal(canRevokeAccess(ordinary), false);
});

test('a user granted access administration through an additional role passes the gate', () => {
  const roles = [
    ...ROLES,
    {
      id: 'role-access-admin',
      name: 'Access Administrator',
      permissions: { 'Settings.Access Management': ['View', 'Assign', 'Revoke'] },
    },
  ];
  const access = resolveEffectiveAccess({
    user: userWith('HR Executive'),
    roles,
    grant: { additionalRoles: [{ roleId: 'role-access-admin', roleName: 'Access Administrator' }] },
    now: NOW,
  });
  const can = checkerFor(access);
  assert.ok(canOpenAccessManagement(can));
  assert.ok(canRevokeAccess(can));
  // And their original access is intact.
  assert.ok(hasPermission(access, 'HR & Recruitment.Candidates', 'Add'));
});
