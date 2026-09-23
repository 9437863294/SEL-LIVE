import test from 'node:test';
import assert from 'node:assert/strict';

import { listAgentApprovers } from '../src/lib/windows-agent-permissions.ts';

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * Who can approve closing, removing or stopping the agent
 *
 * All three ask for `Windows Agent / Devices / Edit`. The screen built on this exists because a
 * fresh installation grants that to a *role* and often to no actual person — and five o'clock on
 * the day somebody needs to stop an agent is the wrong moment to discover it.
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

const DEVICES_EDIT = 'Windows Agent.Devices::Edit';

function access(permissions, sources) {
  return { permissions: { permissions }, sources };
}

function canEdit(sources) {
  // A PermissionMap is flat and keyed by the dotted resource, not nested by module.
  return access({ 'Windows Agent.Devices': ['Edit', 'View'] }, sources);
}

test('lists the people who hold the permission, alphabetically', () => {
  const approvers = listAgentApprovers(
    [
      { id: 'u2', name: 'Priya Das', email: 'priya@selindia.net', departmentName: 'IT' },
      { id: 'u1', name: 'Amit Kumar', email: 'amit@selindia.net', departmentName: 'HR' },
      { id: 'u3', name: 'Somebody Else', email: 'else@selindia.net' },
    ],
    {
      u1: canEdit({ [DEVICES_EDIT]: [{ label: 'IT Administrator' }] }),
      u2: canEdit({ [DEVICES_EDIT]: [{ label: 'Office PC' }] }),
      u3: access({ 'Windows Agent.Devices': ['View'] }, {}),
    },
  );

  assert.deepEqual(approvers.map((row) => row.name), ['Amit Kumar', 'Priya Das']);
  assert.deepEqual(approvers[0].via, ['IT Administrator']);
  assert.equal(approvers[0].departmentName, 'HR');
});

test('nobody holding it returns an empty list rather than throwing', () => {
  // The state a fresh installation is in, and the one the screen has to be able to say out loud.
  const approvers = listAgentApprovers(
    [{ id: 'u1', name: 'Amit Kumar' }],
    { u1: access({ 'Windows Agent.Devices': ['View'] }, {}) },
  );
  assert.deepEqual(approvers, []);
});

test('a deactivated account is not an approver', () => {
  // Listing one is worse than listing nobody: somebody would ring them.
  const approvers = listAgentApprovers(
    [
      { id: 'u1', name: 'Amit Kumar', status: 'Inactive' },
      { id: 'u2', name: 'Priya Das', status: 'Active' },
    ],
    {
      u1: canEdit({ [DEVICES_EDIT]: [{ label: 'IT Administrator' }] }),
      u2: canEdit({ [DEVICES_EDIT]: [{ label: 'IT Administrator' }] }),
    },
  );
  assert.deepEqual(approvers.map((row) => row.name), ['Priya Das']);
});

test('a user with no resolved access at all is skipped', () => {
  const approvers = listAgentApprovers([{ id: 'ghost', name: 'Never Resolved' }], {});
  assert.deepEqual(approvers, []);
});

test('every source is shown, de-duplicated', () => {
  const approvers = listAgentApprovers(
    [{ id: 'u1', name: 'Amit Kumar' }],
    {
      u1: canEdit({
        [DEVICES_EDIT]: [
          { label: 'IT Administrator' },
          { label: 'Direct' },
          { label: 'IT Administrator' },
        ],
      }),
    },
  );
  assert.deepEqual(approvers[0].via, ['IT Administrator', 'Direct']);
});

test('an approver whose only grant expires is flagged, with the date', () => {
  const approvers = listAgentApprovers(
    [{ id: 'u1', name: 'Amit Kumar' }],
    { u1: canEdit({ [DEVICES_EDIT]: [{ label: 'Temporary', expiresAt: '2026-09-30T00:00:00.000Z' }] }) },
  );

  assert.equal(approvers[0].temporaryOnly, true);
  assert.equal(approvers[0].expiresAt, '2026-09-30T00:00:00.000Z');
});

test('one permanent source makes the temporary ones noise', () => {
  const approvers = listAgentApprovers(
    [{ id: 'u1', name: 'Amit Kumar' }],
    {
      u1: canEdit({
        [DEVICES_EDIT]: [
          { label: 'IT Administrator' },
          { label: 'Temporary', expiresAt: '2026-09-30T00:00:00.000Z' },
        ],
      }),
    },
  );

  assert.equal(approvers[0].temporaryOnly, false, 'the permanent role outlives the temporary grant');
});

test('the earliest expiry is the one reported', () => {
  const approvers = listAgentApprovers(
    [{ id: 'u1', name: 'Amit Kumar' }],
    {
      u1: canEdit({
        [DEVICES_EDIT]: [
          { label: 'Cover for Priya', expiresAt: '2026-10-15T00:00:00.000Z' },
          { label: 'Audit week', expiresAt: '2026-09-25T00:00:00.000Z' },
        ],
      }),
    },
  );

  assert.equal(approvers[0].expiresAt, '2026-09-25T00:00:00.000Z');
});

test('a holder with no recorded source is still listed', () => {
  // Sources are best-effort provenance; the permission is the fact. Dropping somebody because
  // the resolver did not label their grant would hide a real approver.
  const approvers = listAgentApprovers([{ id: 'u1', name: 'Amit Kumar' }], { u1: canEdit({}) });
  assert.equal(approvers.length, 1);
  assert.deepEqual(approvers[0].via, ['Role']);
  assert.equal(approvers[0].temporaryOnly, false);
});

test('falls back to the email, then the id, when there is no name', () => {
  const approvers = listAgentApprovers(
    [{ id: 'u1', email: 'amit@selindia.net' }, { id: 'u2' }],
    { u1: canEdit({}), u2: canEdit({}) },
  );
  assert.deepEqual(approvers.map((row) => row.name), ['amit@selindia.net', 'u2']);
});
