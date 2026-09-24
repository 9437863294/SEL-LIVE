import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PROVIDER_GRANT_MAX_AGE_MS,
  canEditContent,
  canSeeContent,
  decideMailboxAccess,
  mailHubCapabilities,
  mayUseFromAddress,
} from '../src/lib/mail-hub/permissions.ts';

const EVERYTHING = {
  'Mail Hub': ['View Module'],
  'Mail Hub.Accounts': ['Connect'],
  'Mail Hub.Compose': ['Send'],
  'Mail Hub.Shared Mail': ['Read', 'Assign', 'Send'],
  'Mail Hub.Templates': ['View', 'Manage'],
  'Mail Hub.Reports': ['View'],
  'Mail Hub.Settings': ['Administer'],
  'Mail Hub.AI': ['Use'],
  'Mail Hub.Audit': ['View'],
  // And every ERP administration power there is.
  'Settings.Access Management': ['View', 'Assign', 'Revoke', 'Administer'],
  'Settings.User Management': ['View', 'Add', 'Edit', 'Delete', 'Switch User'],
};

const now = new Date('2026-09-24T09:00:00.000Z');
const fresh = new Date(now.getTime() - 3_600_000).toISOString();
const personal = { id: 'acc1', ownerUserId: 'owner', kind: 'personal', status: 'active' };
const sharedAccount = { id: 'acc-shared', ownerUserId: 'connector', kind: 'shared', status: 'active' };
const mailbox = { id: 'sm1', active: true, accountId: 'acc-shared' };
const member = (overrides = {}) => ({
  userId: 'm1',
  role: 'responder',
  canSend: true,
  memberAccountId: 'acc-m1',
  providerGrant: { read: 'verified', send: 'verified', method: 'graph-delegated', checkedAt: fresh, detail: null },
  ...overrides,
});

test('a personal mailbox is readable by its owner and by nobody else — including a full administrator', () => {
  const admin = decideMailboxAccess({ viewerId: 'admin', capabilities: mailHubCapabilities(EVERYTHING), account: personal, now });
  assert.equal(admin.canRead, false);
  assert.equal(admin.canModify, false);
  assert.equal(admin.canSend, false);
  assert.equal(admin.canManageConnection, false);
  assert.match(admin.reason, /another user/);

  const owner = decideMailboxAccess({ viewerId: 'owner', capabilities: mailHubCapabilities({}), account: personal, now });
  assert.equal(owner.canRead, true, 'reading your own mail needs no permission at all');
  assert.equal(owner.canSend, false, 'sending does');
  const ownerWithSend = decideMailboxAccess({ viewerId: 'owner', capabilities: mailHubCapabilities({ 'Mail Hub.Compose': ['Send'] }), account: personal, now });
  assert.equal(ownerWithSend.canSend, true);
});

test('shared mail needs the ERP permission, a membership and a fresh provider grant — each alone is refused', () => {
  const caps = mailHubCapabilities(EVERYTHING);
  const ok = decideMailboxAccess({ viewerId: 'm1', capabilities: caps, account: sharedAccount, sharedMailbox: mailbox, membership: member(), now });
  assert.equal(ok.canRead, true);
  assert.equal(ok.canSend, true);
  assert.equal(ok.via, 'member');

  const noPermission = decideMailboxAccess({ viewerId: 'm1', capabilities: mailHubCapabilities({}), account: sharedAccount, sharedMailbox: mailbox, membership: member(), now });
  assert.equal(noPermission.canRead, false);

  const noMembership = decideMailboxAccess({ viewerId: 'admin', capabilities: caps, account: sharedAccount, sharedMailbox: mailbox, membership: null, now });
  assert.equal(noMembership.canRead, false, 'administering Mail Hub is not membership');
  assert.equal(noMembership.canManageConnection, true, 'but it does allow managing the connection');

  const someoneElses = decideMailboxAccess({ viewerId: 'm2', capabilities: caps, account: sharedAccount, sharedMailbox: mailbox, membership: member(), now });
  assert.equal(someoneElses.canRead, false, 'a membership row for a different user does not count');

  const noProviderGrant = decideMailboxAccess({
    viewerId: 'm1', capabilities: caps, account: sharedAccount, sharedMailbox: mailbox,
    membership: member({ providerGrant: { read: 'missing', send: 'missing', checkedAt: fresh } }), now,
  });
  assert.equal(noProviderGrant.canRead, false);
  assert.match(noProviderGrant.reason, /provider has not confirmed/);

  const stale = decideMailboxAccess({
    viewerId: 'm1', capabilities: caps, account: sharedAccount, sharedMailbox: mailbox,
    membership: member({ providerGrant: { read: 'verified', send: 'verified', checkedAt: new Date(now.getTime() - PROVIDER_GRANT_MAX_AGE_MS - 1).toISOString() } }), now,
  });
  assert.equal(stale.canRead, false);
  assert.match(stale.reason, /re-verified/);

  const disabled = decideMailboxAccess({ viewerId: 'm1', capabilities: caps, account: sharedAccount, sharedMailbox: { ...mailbox, active: false }, membership: member(), now });
  assert.equal(disabled.canRead, false);
});

test('sending from a shared mailbox needs every one of its conditions', () => {
  const caps = mailHubCapabilities(EVERYTHING);
  const decide = (overrides, capabilities = caps) =>
    decideMailboxAccess({ viewerId: 'm1', capabilities, account: sharedAccount, sharedMailbox: mailbox, membership: member(overrides), now }).canSend;
  assert.equal(decide({}), true);
  assert.equal(decide({ role: 'reader' }), false);
  assert.equal(decide({ canSend: false }), false);
  assert.equal(decide({ memberAccountId: null }), false, 'shared mail is sent through the member’s own provider login');
  assert.equal(decide({ providerGrant: { read: 'verified', send: 'unverified', checkedAt: fresh } }), false);
  assert.equal(decide({}, mailHubCapabilities({ ...EVERYTHING, 'Mail Hub.Shared Mail': ['Read'] })), false);
  assert.equal(decide({}, mailHubCapabilities({ ...EVERYTHING, 'Mail Hub.Compose': [] })), false);
});

test('assignment and notes are for responders; assigning others needs the Assign permission', () => {
  const withAssign = decideMailboxAccess({ viewerId: 'm1', capabilities: mailHubCapabilities(EVERYTHING), account: sharedAccount, sharedMailbox: mailbox, membership: member(), now });
  assert.equal(withAssign.canAssign, true);
  const without = decideMailboxAccess({
    viewerId: 'm1', capabilities: mailHubCapabilities({ 'Mail Hub.Shared Mail': ['Read'] }), account: sharedAccount, sharedMailbox: mailbox, membership: member(), now,
  });
  assert.equal(without.canAssign, false);
  assert.equal(without.canWorkOwnAssignment, true);
  const reader = decideMailboxAccess({ viewerId: 'm1', capabilities: mailHubCapabilities(EVERYTHING), account: sharedAccount, sharedMailbox: mailbox, membership: member({ role: 'reader' }), now });
  assert.equal(reader.canRead, true);
  assert.equal(reader.canAddNotes, false);
  assert.equal(reader.canModify, false);
});

test('a From address must be the account or a provider-verified identity', () => {
  const account = { emailAddress: 'asha@sel.in', identities: [{ address: 'sales@sel.in', verified: true, name: null }, { address: 'ceo@sel.in', verified: false, name: null }] };
  assert.equal(mayUseFromAddress(account, 'ASHA@sel.in'), true);
  assert.equal(mayUseFromAddress(account, 'sales@sel.in'), true);
  assert.equal(mayUseFromAddress(account, 'ceo@sel.in'), false, 'an unverified alias cannot be used');
  assert.equal(mayUseFromAddress(account, 'someone@else.com'), false);
  assert.equal(mayUseFromAddress(account, ''), false);
});

test('templates: personal ones are the owner’s; department and global ones need Manage', () => {
  const plain = mailHubCapabilities({ 'Mail Hub.Compose': ['Send'] });
  const manager = mailHubCapabilities({ 'Mail Hub.Templates': ['Manage'] });
  const base = { viewerId: 'u1', viewerDepartmentIds: ['fin'] };
  assert.equal(canEditContent({ ...base, capabilities: plain, scope: 'personal', ownerId: 'u1', departmentId: null }), true);
  assert.equal(canEditContent({ ...base, capabilities: manager, scope: 'personal', ownerId: 'u2', departmentId: null }), false);
  assert.equal(canEditContent({ ...base, capabilities: plain, scope: 'department', ownerId: 'u1', departmentId: 'fin' }), false);
  assert.equal(canEditContent({ ...base, capabilities: manager, scope: 'department', ownerId: 'u1', departmentId: 'fin' }), true);
  assert.equal(canEditContent({ ...base, capabilities: manager, scope: 'global', ownerId: null, departmentId: null }), true);
  assert.equal(canSeeContent({ ...base, scope: 'department', ownerId: 'x', departmentId: 'ops' }), false);
  assert.equal(canSeeContent({ ...base, scope: 'department', ownerId: 'x', departmentId: 'fin' }), true);
});

test('capability flags map one to one onto the permission node', () => {
  const caps = mailHubCapabilities({ 'Mail Hub.Settings': ['Administer'] });
  assert.equal(caps.canAdministerConnections, true);
  assert.equal(caps.canViewAudit, true, 'administrators of shared mailboxes see their audit trail');
  assert.equal(caps.canReadShared, false, 'administering connections is not reading mail');
  assert.equal(caps.canOpenModule, true);
  assert.equal(mailHubCapabilities({}).canOpenModule, false);
});
