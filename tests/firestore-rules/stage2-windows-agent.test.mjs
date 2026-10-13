// Stage 2, Windows Agent administration: each collection follows the permission its screen checks
// (src/lib/windows-agent-permissions.ts), read from userPermissions/{authUid}.
import test, { after, before } from 'node:test';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { as, rulesEnv, seed } from './helpers.mjs';

const perms = (p) => ({ v: 1, p, active: true, userDocId: 'x', roleNames: [], projectIds: [], departmentIds: [] });

let env;
before(async () => {
  env = await rulesEnv();
  await seed(env, {
    'userPermissions/admin': perms({
      'Windows Agent.Live Users': ['View'],
      'Windows Agent.Enrollment Codes': ['Create'],
      'Windows Agent.Policies': ['Edit', 'View'],
      'Windows Agent.Applications': ['Categorise', 'View'],
      'Windows Agent.Agent Versions': ['Publish'],
      'Windows Agent.Audit Logs': ['View'],
    }),
    'userPermissions/live': perms({ 'Windows Agent.Live Users': ['View'] }),
    'userPermissions/reports': perms({ 'Windows Agent.Reports': ['View'] }),
    'userPermissions/other': perms({ 'Site Account Statement.Expenses': ['View'] }),
    'userPermissions/gone': { ...perms({}), active: false },
    // `nodoc` has no permissions document at all.
    'windowsHeartbeats/d1': { userId: 'u9', app: 'chrome.exe' },
    'windowsEnrollmentCodes/ABC123': { enabled: true, registrationCount: 3 },
    'windowsAgentPolicies/p1': { scopeKind: 'global', settings: {} },
    'windowsAppCatalog/chrome': { displayName: 'Chrome', category: 'Browser' },
    'windowsAgentVersions/1.2.3': { channel: 'stable' },
    'windowsAuditLogs/a1': { action: 'x' },
  });
});
after(async () => env?.cleanup());

test('the live board: Live Users View only', async () => {
  await assertSucceeds(as(env, 'live').collection('windowsHeartbeats').get());
  await assertSucceeds(as(env, 'admin').doc('windowsHeartbeats/d1').get());
  for (const uid of ['reports', 'other', 'gone', 'nodoc']) {
    await assertFails(as(env, uid).collection('windowsHeartbeats').get());
  }
  await assertFails(as(env, 'admin').doc('windowsHeartbeats/d1').set({ app: 'x' }));
});

test('enrolment codes: Enrollment Codes Create, and the usage counter is untouchable', async () => {
  const admin = as(env, 'admin');
  await assertSucceeds(admin.collection('windowsEnrollmentCodes').get());
  await assertSucceeds(admin.doc('windowsEnrollmentCodes/NEW1').set({ enabled: true, registrationCount: 0 }));
  await assertSucceeds(admin.doc('windowsEnrollmentCodes/ABC123').update({ enabled: false }));
  await assertFails(admin.doc('windowsEnrollmentCodes/NEW2').set({ enabled: true, registrationCount: -5 }));
  await assertFails(admin.doc('windowsEnrollmentCodes/ABC123').update({ registrationCount: 0 }));
  await assertFails(admin.doc('windowsEnrollmentCodes/ABC123').delete());
  for (const uid of ['live', 'reports', 'other', 'nodoc']) {
    await assertFails(as(env, uid).collection('windowsEnrollmentCodes').get());
    await assertFails(as(env, uid).doc('windowsEnrollmentCodes/NEW3').set({ enabled: true, registrationCount: 0 }));
  }
});

test('policies, catalogue and versions: readable in the module, written by their own permission', async () => {
  for (const uid of ['live', 'reports', 'admin']) {
    await assertSucceeds(as(env, uid).collection('windowsAgentPolicies').get());
    await assertSucceeds(as(env, uid).collection('windowsAppCatalog').orderBy('displayName').get());
    await assertSucceeds(as(env, uid).collection('windowsAgentVersions').get());
  }
  for (const uid of ['other', 'gone', 'nodoc']) {
    await assertFails(as(env, uid).collection('windowsAgentPolicies').get());
    await assertFails(as(env, uid).collection('windowsAppCatalog').get());
    await assertFails(as(env, uid).collection('windowsAgentVersions').get());
  }
  const admin = as(env, 'admin');
  await assertSucceeds(admin.collection('windowsAgentPolicies').add({ scopeKind: 'department' }));
  await assertSucceeds(admin.doc('windowsAgentPolicies/p1').delete());
  await assertSucceeds(admin.doc('windowsAppCatalog/chrome').update({ category: 'Work' }));
  await assertSucceeds(admin.doc('windowsAgentVersions/1.2.4').set({ channel: 'beta' }));
  const reports = as(env, 'reports');
  await assertFails(reports.collection('windowsAgentPolicies').add({ scopeKind: 'department' }));
  await assertFails(reports.doc('windowsAppCatalog/chrome').update({ category: 'Games' }));
  await assertFails(reports.doc('windowsAgentVersions/9.9.9').set({ channel: 'stable' }));
});

test('the audit trail: added to by anyone in the module, read with Audit Logs View, never edited', async () => {
  await assertSucceeds(as(env, 'reports').collection('windowsAuditLogs').add({ action: 'viewed' }));
  await assertSucceeds(as(env, 'admin').collection('windowsAuditLogs').orderBy('action').limit(300).get());
  await assertFails(as(env, 'reports').collection('windowsAuditLogs').get());
  await assertFails(as(env, 'other').collection('windowsAuditLogs').add({ action: 'x' }));
  await assertFails(as(env, 'admin').doc('windowsAuditLogs/a1').update({ action: 'y' }));
  await assertFails(as(env, 'admin').doc('windowsAuditLogs/a1').delete());
});
