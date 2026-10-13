import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUserPermissionsDoc, rulesPermissionMap } from '../src/lib/access-rules-permissions.ts';

test('flat permissions pass through, sorted and de-duplicated', () => {
  assert.deepEqual(
    rulesPermissionMap({ 'Site Account Statement.Expenses': ['View', 'Add', 'View'] }),
    { 'Site Account Statement.Expenses': ['Add', 'View'] },
  );
});

test('legacy nested permission objects become dotted keys', () => {
  assert.deepEqual(
    rulesPermissionMap({ 'Office Hub': { Meetings: ['Create'], Tasks: { Board: ['View'] } } }),
    { 'Office Hub.Meetings': ['Create'], 'Office Hub.Tasks.Board': ['View'] },
  );
});

test('a grant under a legacy name is filed under the canonical name, and the reverse', () => {
  const fromLegacy = rulesPermissionMap({ 'LC Module.LC Request': ['View'] });
  assert.deepEqual(fromLegacy['Letter of Credit Management.LC Requests'], ['View']);
  assert.deepEqual(fromLegacy['Letter of Credit Management.Pending Approvals'], ['View']);

  const fromCanonical = rulesPermissionMap({ 'E-Approval.Settings': ['Edit'] });
  assert.deepEqual(fromCanonical['E-Approval.Administration'], ['Edit']);
});

test('aliases merge actions instead of overwriting them', () => {
  const map = rulesPermissionMap({
    'Bank Balance.Expenses': ['View'],
    'Bank Balance.Expenses Log': ['Add'],
  });
  assert.deepEqual(map['Bank Balance.Expenses'], ['Add', 'View']);
  assert.deepEqual(map['Bank Balance.Expenses Log'], ['Add', 'View']);
});

test('empty and malformed entries are dropped', () => {
  assert.deepEqual(rulesPermissionMap({ A: [], B: [''], C: null, D: 'View', E: [1, 'Edit'] }), { E: ['Edit'] });
  assert.deepEqual(rulesPermissionMap(null), {});
});

test('an inactive user holds nothing, whatever their roles say', () => {
  const doc = buildUserPermissionsDoc({
    userDocId: 'u1',
    permissions: { Settings: ['Edit'] },
    roleNames: ['Admin'],
    projectIds: ['p2', 'p1', 'p1'],
    departmentIds: [],
    active: false,
    now: new Date('2026-10-13T00:00:00Z'),
  });
  assert.deepEqual(doc.p, {});
  assert.equal(doc.active, false);
  assert.deepEqual(doc.projectIds, ['p1', 'p2']);
  assert.equal(doc.computedAtIso, '2026-10-13T00:00:00.000Z');
});
