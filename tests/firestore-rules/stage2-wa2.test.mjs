// Stage 2, Windows Agent activity, devices, access, notifications and settings: each read follows
// canViewActivityOf / the page's own permission (src/lib/windows-agent-permissions.ts), with the
// query shapes src/lib/windows-agent-service.ts actually sends.
import test, { after, before } from 'node:test';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { as, rulesEnv, seed } from './helpers.mjs';

const perms = (userDocId, p, extra = {}) => ({
  v: 1, p, active: true, userDocId, roleNames: [], projectIds: [], departmentIds: [], ...extra,
});

const FROM = '2026-10-01';
const TO = '2026-10-31';
const device = (status) => ({
  status, deviceName: 'PC-' + status, deviceSecretHash: 'hash', secretVersion: 1, updateRing: 'BROAD',
  assignedUserIds: [], securityPosture: { ok: true }, lastSecurityCheckAt: 'x', securityPolicy: { a: 1 },
  maintenanceAccess: null,
});

let env;
before(async () => {
  env = await rulesEnv();
  await seed(env, {
    'userPermissions/emp': perms('u-emp', { 'Site Account Statement.Expenses': ['View'] }),
    'userPermissions/ownonly': perms('u-own', { 'Windows Agent.Activity': ['View Own'] }),
    'userPermissions/mgr': perms('u-mgr', { 'Windows Agent.Activity': ['View Department'], 'Windows Agent.Reports': ['View'] }, { departmentIds: ['d1'] }),
    'userPermissions/lead': perms('u-lead', { 'Windows Agent.Activity': ['View Team'], 'Windows Agent.Sessions': ['View'] }, { departmentIds: ['d1'] }),
    'userPermissions/nodept': perms('u-nodept', { 'Windows Agent.Activity': ['View Department'] }),
    'userPermissions/all': perms('u-all', { 'Windows Agent.Activity': ['View All'] }),
    'userPermissions/attendance': perms('u-att', { 'Windows Agent.Attendance': ['View'], 'Windows Agent.Sessions': ['View'] }),
    'userPermissions/live': perms('u-live', { 'Windows Agent.Live Users': ['View'] }),
    'userPermissions/gone': { ...perms('u-gone', {}), active: false },
    'userPermissions/devEdit': perms('u-devEdit', { 'Windows Agent.Devices': ['View', 'Edit'] }),
    'userPermissions/devBlock': perms('u-devBlock', { 'Windows Agent.Devices': ['View', 'Block'] }),
    'userPermissions/devAssign': perms('u-devAssign', { 'Windows Agent.Devices': ['View', 'Assign Users'] }),
    'userPermissions/devForce': perms('u-devForce', { 'Windows Agent.Devices': ['Force Re-authentication', 'Sign Out User'] }),
    'userPermissions/devAll': perms('u-devAll', { 'Windows Agent.Devices': ['View', 'Edit', 'Assign Users', 'Block', 'Retire', 'Force Re-authentication', 'Sign Out User'] }),
    'userPermissions/notif': perms('u-notif', { 'Windows Agent.Notifications': ['View'] }),
    'userPermissions/sender': perms('u-sender', { 'Windows Agent.Notifications': ['Send'] }),
    'userPermissions/delivery': perms('u-delivery', { 'Windows Agent.Notifications': ['View Delivery'] }),
    'userPermissions/policy': perms('u-policy', { 'Windows Agent.Monitoring Policy': ['Edit', 'View'] }),
    // `nodoc` has no permissions document at all.

    'users/u-emp': { name: 'Emp', status: 'Active', departmentId: 'd2' },
    'users/u-a': { name: 'A', status: 'Active', departmentId: 'd1' },
    'users/u-b': { name: 'B', status: 'Active', departmentId: 'd2' },
    'users/u-mgr': { name: 'Mgr', status: 'Active', departmentId: 'd1' },
    'users/u-lead': { name: 'Lead', status: 'Active', departmentId: 'd9' },
    'departments/d1': { name: 'Design' },

    'windowsSessions/s-emp': { userId: 'u-emp', departmentId: 'd2', workDate: '2026-10-02', status: 'CLOSED' },
    'windowsSessions/s-a': { userId: 'u-a', departmentId: 'd1', workDate: '2026-10-02', status: 'OPEN' },
    // u-a's earlier day, filed under the department they were in then.
    'windowsSessions/s-a-old': { userId: 'u-a', departmentId: 'd3', workDate: '2026-10-01', status: 'CLOSED' },
    'windowsSessions/s-b': { userId: 'u-b', departmentId: 'd2', workDate: '2026-10-02', status: 'OPEN' },
    'windowsSessions/s-lead': { userId: 'u-lead', departmentId: 'd9', workDate: '2026-10-02', status: 'CLOSED' },
    'windowsDailyActivity/u-emp__2026-10-02': { userId: 'u-emp', departmentId: 'd2', workDate: '2026-10-02' },
    'windowsDailyActivity/u-a__2026-10-02': { userId: 'u-a', departmentId: 'd1', workDate: '2026-10-02' },
    'windowsDailyActivity/u-a__2026-10-01': { userId: 'u-a', departmentId: 'd3', workDate: '2026-10-01' },
    'windowsDailyActivity/u-b__2026-10-02': { userId: 'u-b', departmentId: 'd2', workDate: '2026-10-02' },
    'windowsActivityEvents/e-emp': { userId: 'u-emp', workDate: '2026-10-02', startedAt: '09:00', sessionId: 's-emp' },
    'windowsActivityEvents/e-a': { userId: 'u-a', workDate: '2026-10-02', startedAt: '09:00', sessionId: 's-a' },
    'windowsActivityEvents/e-b': { userId: 'u-b', workDate: '2026-10-02', startedAt: '09:00', sessionId: 's-b' },

    'windowsDevices/pending': device('PENDING'),
    'windowsDevices/pending2': device('PENDING'),
    'windowsDevices/active': device('ACTIVE'),
    'windowsDevices/blocked': device('BLOCKED'),
    'windowsUserAccess/u-b': { userId: 'u-b', userName: 'B', allowedDeviceIds: ['active'] },
    'windowsNotifications/n1': { title: 'Hello', createdAtIso: '2026-10-02T09:00:00Z', deliveryCounts: { recipients: 3 } },
    'windowsNotificationReceipts/n1__u-emp': { notificationId: 'n1', userId: 'u-emp' },
    'windowsApplicationUsage/s-emp__chrome': { userId: 'u-emp', sessionId: 's-emp' },
    'windowsDeviceAssignments/x': { deviceId: 'active' },
    'windowsAgentSettings/default': { employeeSelfViewEnabled: true, monitoringPolicyText: 'We record…', minimumFullDaySeconds: 28800 },
  });
});
after(async () => env?.cleanup());

/* The service's query shapes. */
const sessions = (uid, ...where) => {
  let q = as(env, uid).collection('windowsSessions');
  for (const [f, op, v] of where) q = q.where(f, op, v);
  return q.where('workDate', '>=', FROM).where('workDate', '<=', TO).orderBy('workDate', 'desc').limit(500).get();
};
const days = (uid, max, ...where) => {
  let q = as(env, uid).collection('windowsDailyActivity');
  for (const [f, op, v] of where) q = q.where(f, op, v);
  return q.where('workDate', '>=', FROM).where('workDate', '<=', TO).orderBy('workDate', 'desc').limit(max).get();
};
const dayEvents = (uid, userId) => as(env, uid).collection('windowsActivityEvents')
  .where('userId', '==', userId).where('workDate', '==', '2026-10-02').orderBy('startedAt').limit(3000).get();
const liveSessions = (uid) => as(env, uid).collection('windowsSessions').where('status', '==', 'OPEN').get();

test('my own day: anybody signed in, by their users id, while self-view is on', async () => {
  for (const uid of ['emp', 'attendance']) {
    const me = uid === 'emp' ? 'u-emp' : 'u-att';
    await assertSucceeds(sessions(uid, ['userId', '==', me]));
    await assertSucceeds(days(uid, 1000, ['userId', '==', me]));
    await assertSucceeds(dayEvents(uid, me));
  }
  await assertSucceeds(as(env, 'emp').doc('windowsSessions/s-emp').get());
  await assertSucceeds(as(env, 'emp').doc('windowsDailyActivity/u-emp__2026-10-02').get());
  // Somebody else's, or everybody's, is refused.
  await assertFails(sessions('emp', ['userId', '==', 'u-b']));
  await assertFails(days('emp', 1000, ['userId', '==', 'u-b']));
  await assertFails(dayEvents('emp', 'u-b'));
  await assertFails(sessions('emp'));
  await assertFails(days('attendance', 2000));
  await assertFails(as(env, 'emp').doc('windowsSessions/s-b').get());
  // No permissions document, or a deactivated one, is nobody.
  await assertFails(sessions('nodoc', ['userId', '==', 'u-emp']));
  await assertFails(sessions('gone', ['userId', '==', 'u-gone']));
  await assertFails(as(env, null).collection('windowsSessions').where('userId', '==', 'u-emp').get());
});

test('self-view switched off: only an Activity grant still reads its own', async () => {
  await seed(env, { 'windowsAgentSettings/default': { employeeSelfViewEnabled: false, monitoringPolicyText: null, minimumFullDaySeconds: 28800 } });
  try {
    await assertFails(days('emp', 1000, ['userId', '==', 'u-emp']));
    await assertFails(dayEvents('emp', 'u-emp'));
    await assertSucceeds(days('ownonly', 1000, ['userId', '==', 'u-own']));
    await assertSucceeds(days('mgr', 1000, ['userId', '==', 'u-mgr']));
  } finally {
    await seed(env, { 'windowsAgentSettings/default': { employeeSelfViewEnabled: true, monitoringPolicyText: 'We record…', minimumFullDaySeconds: 28800 } });
  }
});

test('View All: every list the reports, dashboard and registers run', async () => {
  await assertSucceeds(sessions('all'));
  for (const max of [1000, 2000, 3000]) await assertSucceeds(days('all', max));
  await assertSucceeds(dayEvents('all', 'u-b'));
  await assertSucceeds(sessions('all', ['userId', '==', 'u-b']));
  await assertSucceeds(as(env, 'all').doc('windowsSessions/s-b').get());
});

test('View Department: the department lists, and one named colleague by their current department', async () => {
  await assertSucceeds(sessions('mgr', ['departmentId', 'in', ['d1']]));
  await assertSucceeds(days('mgr', 1000, ['departmentId', 'in', ['d1']]));
  // The person page: userId == X, X currently in d1 — including X's day filed under d3.
  await assertSucceeds(sessions('mgr', ['userId', '==', 'u-a']));
  await assertSucceeds(days('mgr', 1000, ['userId', '==', 'u-a']));
  await assertSucceeds(dayEvents('mgr', 'u-a'));
  await assertSucceeds(sessions('mgr', ['userId', '==', 'u-mgr']));
  // Another department, a wider list, or everybody.
  await assertFails(sessions('mgr', ['departmentId', 'in', ['d1', 'd2']]));
  await assertFails(days('mgr', 1000, ['departmentId', 'in', ['d2']]));
  await assertFails(sessions('mgr', ['userId', '==', 'u-b']));
  await assertFails(dayEvents('mgr', 'u-b'));
  await assertFails(days('mgr', 2000));
  // A user id that is not in `users` at all.
  await assertFails(sessions('mgr', ['userId', '==', 'u-ghost']));
  // No departments: own rows only.
  await assertSucceeds(days('nodept', 1000, ['userId', '==', 'u-nodept']));
  await assertFails(days('nodept', 1000, ['userId', '==', 'u-a']));
});

test('View Team: asked by department plus self (the new query); a user-id list is refused', async () => {
  // teamConstraints: userId == self, then departmentId in chunks.
  await assertSucceeds(sessions('lead', ['userId', '==', 'u-lead']));
  await assertSucceeds(sessions('lead', ['departmentId', 'in', ['d1']]));
  await assertSucceeds(days('lead', 2000, ['userId', '==', 'u-lead']));
  await assertSucceeds(days('lead', 2000, ['departmentId', 'in', ['d1']]));
  await assertSucceeds(dayEvents('lead', 'u-a'));
  // The deployed code's `userId in [...]` shape is checked one `users` read per id, so it passes
  // only up to nine colleagues (10 reads with the permissions document) and fails on a real team;
  // and any id outside the departments refuses it.
  await assertSucceeds(sessions('lead', ['userId', 'in', ['u-a', 'u-mgr', 'u-lead']]));
  await assertFails(sessions('lead', ['userId', 'in', ['u-a', 'u-b', 'u-lead']]));
  await assertFails(days('lead', 2000, ['userId', 'in', ['u-b', 'u-lead']]));
  await assertFails(dayEvents('lead', 'u-b'));
  await assertFails(days('lead', 2000, ['departmentId', 'in', ['d2']]));
});

test('the live board: open sessions only, with Live Users View', async () => {
  await assertSucceeds(liveSessions('live'));
  await assertSucceeds(liveSessions('all'));
  await assertFails(as(env, 'live').collection('windowsSessions').get());
  await assertFails(sessions('live'));
  await assertFails(days('live', 1000));
  for (const uid of ['emp', 'mgr', 'attendance', 'nodoc']) await assertFails(liveSessions(uid));
  // Its devices listener.
  await assertSucceeds(as(env, 'live').collection('windowsDevices').orderBy('deviceName').get());
});

test('activity is never written from a browser', async () => {
  for (const uid of ['all', 'emp']) {
    await assertFails(as(env, uid).doc('windowsSessions/s-emp').update({ activeSeconds: 1 }));
    await assertFails(as(env, uid).doc('windowsSessions/new').set({ userId: 'u-emp' }));
    await assertFails(as(env, uid).doc('windowsDailyActivity/u-emp__2026-10-02').update({ activeSeconds: 1 }));
    await assertFails(as(env, uid).doc('windowsActivityEvents/e-emp').delete());
  }
});

test('devices: read with Devices View, written one action at a time', async () => {
  await assertSucceeds(as(env, 'devEdit').collection('windowsDevices').orderBy('deviceName').get());
  await assertSucceeds(as(env, 'devEdit').doc('windowsDevices/active').get());
  for (const uid of ['emp', 'all', 'devForce', 'nodoc']) {
    await assertFails(as(env, uid).collection('windowsDevices').orderBy('deviceName').get());
  }
  const stamp = (uid) => ({ updatedAt: '2026-10-13T10:00:00Z', updatedBy: uid, updatedByName: 'X' });
  const status = (uid, value) => ({ status: value, statusReason: null, statusChangedAt: '2026-10-13T10:00:00Z', statusChangedBy: uid, ...stamp(uid) });

  // Approve: Edit, PENDING → ACTIVE only.
  await assertSucceeds(as(env, 'devEdit').doc('windowsDevices/pending').update(status('u-devEdit', 'ACTIVE')));
  await assertFails(as(env, 'devEdit').doc('windowsDevices/active').update(status('u-devEdit', 'BLOCKED')));
  await assertFails(as(env, 'devBlock').doc('windowsDevices/pending2').update(status('u-devBlock', 'ACTIVE')));
  await assertFails(as(env, 'devEdit').doc('windowsDevices/pending2').update(status('u-someone', 'ACTIVE')));
  // Block and unblock: Block.
  await assertSucceeds(as(env, 'devBlock').doc('windowsDevices/blocked').update(status('u-devBlock', 'ACTIVE')));
  await assertSucceeds(as(env, 'devBlock').doc('windowsDevices/active').update(status('u-devBlock', 'BLOCKED')));
  await assertFails(as(env, 'devBlock').doc('windowsDevices/pending2').update(status('u-devBlock', 'RETIRED')));
  // Directives.
  await assertSucceeds(as(env, 'devForce').doc('windowsDevices/active').update({ forceReauthAt: 'now', statusReason: 'left', ...stamp('u-devForce') }));
  await assertSucceeds(as(env, 'devForce').doc('windowsDevices/active').update({ forceSignOutAt: 'now', statusReason: null, ...stamp('u-devForce') }));
  await assertFails(as(env, 'devEdit').doc('windowsDevices/active').update({ forceReauthAt: 'later', ...stamp('u-devEdit') }));
  await assertFails(as(env, 'devForce').doc('windowsDevices/active').update({ statusReason: 'only this', ...stamp('u-devForce') }));
  // Assignment.
  await assertSucceeds(as(env, 'devAssign').doc('windowsDevices/active').update({ assignedUserIds: ['u-a'], ...stamp('u-devAssign') }));
  await assertFails(as(env, 'devAssign').doc('windowsDevices/active').update({ assignedUserIds: ['u-a'], ...stamp('u-other') }));
  await assertFails(as(env, 'devEdit').doc('windowsDevices/active').update({ assignedUserIds: ['u-b'], ...stamp('u-devEdit') }));
  // Update ring (Edit; the page stamps only updatedAt) and the name.
  await assertSucceeds(as(env, 'devEdit').doc('windowsDevices/active').update({ updateRing: 'PILOT', updatedAt: 'now' }));
  await assertSucceeds(as(env, 'devEdit').doc('windowsDevices/active').update({ deviceName: 'SEL-HO-1', ...stamp('u-devEdit') }));
  await assertFails(as(env, 'devEdit').doc('windowsDevices/active').update({ updateRing: 'EVERYONE', updatedAt: 'now' }));
  await assertFails(as(env, 'devBlock').doc('windowsDevices/active').update({ updateRing: 'HELD', updatedAt: 'now' }));
  // Never created or deleted here.
  await assertFails(as(env, 'devAll').doc('windowsDevices/new').set(device('ACTIVE')));
  await assertFails(as(env, 'devAll').doc('windowsDevices/active').delete());
});

test('the credential, posture, security policy and maintenance grant are out of every browser’s reach', async () => {
  const db = as(env, 'devAll');
  for (const field of ['deviceSecretHash', 'secretVersion', 'securityPosture', 'lastSecurityCheckAt', 'securityPolicy', 'maintenanceAccess']) {
    await assertFails(db.doc('windowsDevices/active').update({ [field]: 'forged', updatedAt: 'now' }));
    await assertFails(db.doc('windowsDevices/active').update({ updateRing: 'HELD', [field]: 'forged', updatedAt: 'now' }));
    await assertFails(db.doc('windowsDevices/blocked').update({ status: 'BLOCKED', statusChangedBy: 'u-devAll', [field]: 'forged' }));
  }
});

test('per-user computer access: read with Devices View, written with Assign Users', async () => {
  await assertSucceeds(as(env, 'devEdit').collection('windowsUserAccess').get());
  await assertSucceeds(as(env, 'devAssign').doc('windowsUserAccess/u-a').get()); // missing: the pre-write read
  const entry = (userId, by) => ({
    userId, userName: 'A', allowedDeviceIds: ['active'], reason: null, updatedAtIso: 'now',
    updatedAt: 'now', updatedBy: by, updatedByName: 'X',
  });
  await assertSucceeds(as(env, 'devAssign').doc('windowsUserAccess/u-a').set({ ...entry('u-a', 'u-devAssign'), createdAt: 'now', createdBy: 'u-devAssign', createdByName: 'X' }, { merge: true }));
  await assertSucceeds(as(env, 'devAssign').doc('windowsUserAccess/u-b').set(entry('u-b', 'u-devAssign'), { merge: true }));
  await assertFails(as(env, 'devAssign').doc('windowsUserAccess/u-b').set(entry('u-a', 'u-devAssign'), { merge: true }));
  await assertFails(as(env, 'devAssign').doc('windowsUserAccess/u-b').set(entry('u-b', 'u-other'), { merge: true }));
  await assertSucceeds(as(env, 'devAssign').doc('windowsUserAccess/u-a').delete());
  for (const uid of ['devEdit', 'emp']) {
    await assertFails(as(env, uid).doc('windowsUserAccess/u-emp').set(entry('u-emp', uid === 'emp' ? 'u-emp' : 'u-devEdit')));
    await assertFails(as(env, uid).doc('windowsUserAccess/u-b').delete());
  }
  for (const uid of ['emp', 'all', 'live', 'nodoc']) {
    await assertFails(as(env, uid).collection('windowsUserAccess').get());
    await assertFails(as(env, uid).doc('windowsUserAccess/u-b').get());
  }
});

test('notifications: Notifications View or Send reads the list; nobody writes it', async () => {
  const list = (uid) => as(env, uid).collection('windowsNotifications').orderBy('createdAtIso', 'desc').limit(100).get();
  await assertSucceeds(list('notif'));
  await assertSucceeds(list('sender'));
  for (const uid of ['delivery', 'emp', 'all', 'nodoc']) await assertFails(list(uid));
  await assertFails(as(env, 'sender').collection('windowsNotifications').add({ title: 'x' }));
  await assertFails(as(env, 'sender').doc('windowsNotifications/n1').update({ deliveryCounts: {} }));
});

test('receipts, application usage and device assignments stay server-only', async () => {
  for (const uid of ['emp', 'all', 'sender', 'delivery', 'devAll']) {
    await assertFails(as(env, uid).collection('windowsNotificationReceipts').where('notificationId', '==', 'n1').limit(500).get());
    await assertFails(as(env, uid).doc('windowsNotificationReceipts/n1__u-emp').get());
    await assertFails(as(env, uid).doc('windowsApplicationUsage/s-emp__chrome').get());
    await assertFails(as(env, uid).collection('windowsDeviceAssignments').get());
  }
});

test('settings: everybody signed in reads the statement; Monitoring Policy Edit saves the page’s fields', async () => {
  for (const uid of ['emp', 'nodoc', 'gone', 'policy']) {
    await assertSucceeds(as(env, uid).doc('windowsAgentSettings/default').get());
  }
  await assertFails(as(env, null).doc('windowsAgentSettings/default').get());
  await assertFails(as(env, 'emp').collection('windowsAgentSettings').get());

  const save = (by, extra = {}) => ({
    employeeSelfViewEnabled: true, monitoringPolicyText: 'We record applications, not keystrokes.',
    minimumFullDaySeconds: 28800, updatedAt: 'now', updatedBy: by, updatedByName: 'P', ...extra,
  });
  await assertSucceeds(as(env, 'policy').doc('windowsAgentSettings/default').set(save('u-policy'), { merge: true }));
  await assertSucceeds(as(env, 'policy').doc('windowsAgentSettings/default').set(save('u-policy', { monitoringPolicyText: null }), { merge: true }));
  await assertFails(as(env, 'policy').doc('windowsAgentSettings/default').set(save('u-policy', { extra: 1 }), { merge: true }));
  await assertFails(as(env, 'policy').doc('windowsAgentSettings/default').set(save('u-policy', { employeeSelfViewEnabled: 'no' }), { merge: true }));
  await assertFails(as(env, 'policy').doc('windowsAgentSettings/default').set(save('u-policy', { minimumFullDaySeconds: 0 }), { merge: true }));
  await assertFails(as(env, 'policy').doc('windowsAgentSettings/default').set(save('u-other'), { merge: true }));
  await assertFails(as(env, 'policy').doc('windowsAgentSettings/other').set(save('u-policy')));
  await assertFails(as(env, 'policy').doc('windowsAgentSettings/default').delete());
  for (const uid of ['emp', 'all', 'devAll']) {
    const me = { emp: 'u-emp', all: 'u-all', devAll: 'u-devAll' }[uid];
    await assertFails(as(env, uid).doc('windowsAgentSettings/default').set(save(me, { employeeSelfViewEnabled: false }), { merge: true }));
  }
});

test('first save on a fresh installation creates the settings document', async () => {
  await env.withSecurityRulesDisabled((ctx) => ctx.firestore().doc('windowsAgentSettings/default').delete());
  // A missing document means self-view on.
  await assertSucceeds(days('emp', 1000, ['userId', '==', 'u-emp']));
  await assertSucceeds(as(env, 'policy').doc('windowsAgentSettings/default').set({
    employeeSelfViewEnabled: true, monitoringPolicyText: null, minimumFullDaySeconds: 28800,
    updatedAt: 'now', updatedBy: 'u-policy', updatedByName: 'P',
  }, { merge: true }));
});

test('what the module provider loads for any visitor still loads', async () => {
  const db = as(env, 'emp');
  await assertSucceeds(db.collection('users').where('status', '==', 'Active').get());
  await assertSucceeds(db.collection('departments').get());
  await assertSucceeds(db.doc('windowsAgentSettings/default').get());
});
