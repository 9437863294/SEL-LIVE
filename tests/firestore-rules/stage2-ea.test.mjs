// Stage 2, E-Approval: requests and their records are read by anyone in the module (the engine's
// visibility rests on routing documents, designations and delegations the rules cannot see), and by
// whoever works a Recurring Payments obligation for the request mirroring it. Writes follow stamped
// identities, draft ownership, the delete grants and each settings page's permission.
import test, { after, before } from 'node:test';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { as, rulesEnv, seed } from './helpers.mjs';

// `userDocId` deliberately differs from the auth uid, as it does for email-matched accounts.
const perms = (userDocId, p) => ({ v: 1, p, active: true, userDocId, roleNames: [], projectIds: [], departmentIds: [] });
const ORG = 'org1';
const MIRROR_SOURCE = { module: 'Recurring Payments', recordId: 'pay1', recordLabel: 'Rent', recordPath: '/recurring-payments/payments/pay1' };

let env;
before(async () => {
  env = await rulesEnv();
  await seed(env, {
    'userPermissions/requester': perms('u-req', {
      'E-Approval': ['View Module'],
      'E-Approval.Requests': ['Create', 'Delete Draft'],
      'E-Approval.Comments': ['Add'],
    }),
    // An approver: the module gate and nothing else. Being assigned is the authority to act.
    'userPermissions/approver': perms('u-appr', { 'E-Approval.Inbox': ['View'], 'E-Approval.Delegations': ['Add'] }),
    'userPermissions/admin': perms('u-admin', {
      'E-Approval': ['View Module'],
      'E-Approval.Requests': ['Create', 'Delete', 'View All'],
      'E-Approval.Delegations': ['Add', 'Manage Others'],
      'E-Approval.Settings.Policies': ['Edit', 'View'],
      'E-Approval.Settings.Department Routing': ['Edit'],
      'E-Approval.Settings.Project Routing': ['Edit'],
      'E-Approval.Settings.Workflow Templates': ['Add'],
      'E-Approval.Settings.Approval Matrix': ['Edit'],
    }),
    // A role granted under the pre-rename name: the server files it under both names.
    'userPermissions/legacy': perms('u-legacy', {
      'E-Approval.Administration.Approval Types': ['Edit'],
      'E-Approval.Settings.Approval Types': ['Edit'],
    }),
    // "Run now" on the escalation ladder needs only View on Policies.
    'userPermissions/policyViewer': perms('u-pol', { 'E-Approval.Settings.Policies': ['View'] }),
    'userPermissions/rpUser': perms('u-rp', { 'Recurring Payments.Payments': ['View'] }),
    // Named on obligation pay1, holding nothing in either module.
    'userPermissions/rpNamed': perms('u-named', { 'Site Account Statement.Expenses': ['View'] }),
    'userPermissions/other': perms('u-other', { 'Site Account Statement.Expenses': ['View'] }),
    'userPermissions/gone': { ...perms('u-gone', {}), active: false },
    // `nodoc` has no permissions document at all.

    'paymentObligations/pay1': { organizationId: ORG, assignedTo: 'u-named', assignees: ['u-named'] },
    'paymentObligations/pay2': { organizationId: ORG, assignedTo: 'u-someone', assignees: [] },

    'eApprovalRequests/r1': {
      organizationId: ORG, status: 'Pending Approval', requesterId: 'u-req', subject: 'Cement', version: 1,
      currentAssigneeIds: ['u-appr'], currentDepartmentIds: ['d1'], currentRoles: ['Engineer'],
      currentDesignations: ['JR. ACCOUNTANT'], currentProjectIds: ['p1'], participantUserIds: ['u-cc'],
      stateRevision: 2, createdAt: 2,
    },
    'eApprovalRequests/draft1': {
      organizationId: ORG, status: 'Draft', requesterId: 'u-req', subject: 'Steel', version: 1, createdAt: 3,
    },
    'eApprovalRequests/m1': {
      organizationId: ORG, status: 'Pending Approval', requesterId: 'u-owner', subject: 'Rent', version: 1,
      currentAssigneeIds: ['u-named'], source: MIRROR_SOURCE, stateRevision: 1, createdAt: 1,
    },
    'eApprovalRequests/m2': {
      organizationId: ORG, status: 'Pending Approval', requesterId: 'u-someone', subject: 'Power', version: 1,
      source: { ...MIRROR_SOURCE, recordId: 'pay2' }, createdAt: 1,
    },
    'eApprovalSteps/s1': { approvalId: 'r1', organizationId: ORG, status: 'Active', assignment: { kind: 'User', userId: 'u-appr' } },
    'eApprovalSteps/sm1': { approvalId: 'm1', organizationId: ORG, status: 'Active', assignment: { kind: 'User', userId: 'u-x' } },
    'eApprovalHistory/h1': { approvalId: 'r1', organizationId: ORG, actorId: 'u-appr', recordedAt: 1 },
    'eApprovalHistory/hd1': { approvalId: 'draft1', organizationId: ORG, actorId: 'u-req', recordedAt: 1 },
    'eApprovalHistory/hm1': { approvalId: 'm1', organizationId: ORG, actorId: 'u-owner', recordedAt: 1 },
    'eApprovalComments/c1': { approvalId: 'r1', organizationId: ORG, authorId: 'u-req', body: 'Please', editHistory: [] },
    'eApprovalAttachments/a1': { approvalId: 'draft1', organizationId: ORG, uploadedById: 'u-req', name: 'q.pdf' },
    'eApprovalAttachments/a2': { approvalId: 'r1', organizationId: ORG, uploadedById: 'u-req', name: 'po.pdf' },
    'eApprovalVersions/v1': { approvalId: 'r1', organizationId: ORG, version: 1 },
    'eApprovalCounters/org1__2026-27__ALL': { organizationId: ORG, nextSequence: 7 },
    'eApprovalSettings/org1': { organizationId: ORG, amountTolerancePct: 5 },
    'eApprovalSettings/default': { amountTolerancePct: 0 },
    'eApprovalDepartmentRouting/d1': { departmentId: 'd1', organizationId: ORG, memberUserIds: ['u-appr'] },
    'eApprovalProjectRouting/p1': { projectId: 'p1', organizationId: ORG, memberUserIds: ['u-appr'] },
    'eApprovalDelegations/dl1': { organizationId: ORG, fromUserId: 'u-appr', toUserId: 'u-req', active: true },
    'eApprovalTypes/t1': { organizationId: ORG, name: 'Purchase' },
    'eApprovalTemplates/w1': { organizationId: ORG, name: 'Purchase Approval' },
    'eApprovalRules/x1': { organizationId: ORG, name: 'Above 1L' },
    'eApprovalSignatures/u-req': { organizationId: ORG, url: 'https://x/sig.png' },
  });
});
after(async () => env?.cleanup());

const requests = (db) => db.collection('eApprovalRequests');
const MODULE_USERS = ['requester', 'approver', 'admin', 'policyViewer'];
const OUTSIDERS = ['rpUser', 'rpNamed', 'other', 'gone', 'nodoc'];

test('every queue, register and report query the module runs, for anyone in the module', async () => {
  for (const uid of MODULE_USERS) {
    const db = as(env, uid);
    const org = requests(db).where('organizationId', '==', ORG);
    // buildEApprovalListQuery: one array predicate, then orderBy createdAt desc, optional limit.
    await assertSucceeds(org.where('currentAssigneeIds', 'array-contains', 'u-appr').orderBy('createdAt', 'desc').limit(300).get());
    // A delegate's inbox asks for the delegator's id.
    await assertSucceeds(org.where('currentAssigneeIds', 'array-contains', 'u-someone-else').orderBy('createdAt', 'desc').get());
    await assertSucceeds(org.where('currentDepartmentIds', 'array-contains-any', ['d1', 'd2']).orderBy('createdAt', 'desc').get());
    await assertSucceeds(org.where('currentRoles', 'array-contains', 'Engineer').orderBy('createdAt', 'desc').get());
    await assertSucceeds(org.where('currentDesignations', 'array-contains', 'JR. ACCOUNTANT').orderBy('createdAt', 'desc').get());
    await assertSucceeds(org.where('currentProjectIds', 'array-contains-any', ['p1']).orderBy('createdAt', 'desc').get());
    await assertSucceeds(org.where('participantUserIds', 'array-contains', 'u-cc').orderBy('createdAt', 'desc').get());
    await assertSucceeds(org.where('requesterId', '==', 'u-req').where('status', 'in', ['Draft']).orderBy('createdAt', 'desc').get());
    // All / Completed for View All, the analytics sweep, and the escalation run.
    await assertSucceeds(org.orderBy('createdAt', 'desc').limit(400).get());
    await assertSucceeds(org.orderBy('createdAt', 'desc').limit(2000).get());
    await assertSucceeds(org.where('status', 'in', ['Pending Approval', 'Resubmitted']).orderBy('createdAt', 'desc').limit(200).get());
    // A user with no organisation: the filter is dropped.
    await assertSucceeds(requests(db).where('requesterId', '==', 'u-req').orderBy('createdAt', 'desc').get());
    await assertSucceeds(db.doc('eApprovalRequests/r1').get());
    await assertSucceeds(db.doc('eApprovalRequests/m1').get());
  }
});

test('the dashboards on / and /my-work (no organisation filter, limit 100)', async () => {
  const db = as(env, 'approver');
  await assertSucceeds(requests(db).where('currentAssigneeIds', 'array-contains', 'u-appr').limit(100).get());
  await assertSucceeds(requests(db).where('currentDepartmentIds', 'array-contains-any', ['d1']).limit(100).get());
  await assertSucceeds(requests(db).where('currentRoles', 'array-contains', 'Engineer').limit(100).get());
  await assertSucceeds(requests(db).where('currentDesignations', 'array-contains', 'JR. ACCOUNTANT').limit(100).get());
  await assertSucceeds(requests(db).where('requesterId', '==', 'u-appr').limit(100).get());
  // The actor context those dashboards build reads routing and delegations for any signed-in user.
  for (const uid of ['other', 'rpNamed', 'nodoc', 'approver']) {
    const any = as(env, uid);
    await assertSucceeds(any.collection('eApprovalDepartmentRouting').where('organizationId', '==', ORG).get());
    await assertSucceeds(any.collection('eApprovalDepartmentRouting').get());
    await assertSucceeds(any.collection('eApprovalProjectRouting').where('organizationId', '==', ORG).get());
    await assertSucceeds(any.collection('eApprovalDelegations').where('organizationId', '==', ORG).get());
    await assertSucceeds(any.doc('eApprovalDepartmentRouting/d1').get());
    await assertSucceeds(any.doc('eApprovalSettings/default').get());
  }
  await assertFails(as(env, null).collection('eApprovalDelegations').get());
  await assertFails(as(env, null).doc('eApprovalSettings/org1').get());
});

test('outside the module, requests and their records are closed', async () => {
  for (const uid of OUTSIDERS) {
    const db = as(env, uid);
    await assertFails(requests(db).where('organizationId', '==', ORG).orderBy('createdAt', 'desc').limit(400).get());
    await assertFails(requests(db).where('currentAssigneeIds', 'array-contains', 'u-named').limit(100).get());
    await assertFails(db.doc('eApprovalRequests/r1').get());
    await assertFails(db.collection('eApprovalSteps').where('approvalId', '==', 'r1').get());
    await assertFails(db.collection('eApprovalHistory').where('approvalId', '==', 'r1').get());
    await assertFails(db.collection('eApprovalComments').where('approvalId', '==', 'r1').get());
    await assertFails(db.collection('eApprovalAttachments').where('approvalId', '==', 'r1').get());
    await assertFails(db.collection('eApprovalVersions').where('approvalId', '==', 'r1').get());
    await assertFails(db.doc('eApprovalSignatures/u-req').get());
  }
  await assertFails(as(env, null).doc('eApprovalRequests/r1').get());
});

test('the detail, edit and print pages, the export and My Activity read the child records', async () => {
  const db = as(env, 'approver');
  for (const name of ['eApprovalSteps', 'eApprovalHistory', 'eApprovalComments', 'eApprovalAttachments', 'eApprovalVersions']) {
    await assertSucceeds(db.collection(name).where('approvalId', '==', 'r1').get());
    await assertSucceeds(db.collection(name).where('approvalId', 'in', ['r1', 'draft1', 'm1']).get());
  }
  await assertSucceeds(db.collection('eApprovalSteps').where('organizationId', '==', ORG).limit(8000).get());
  await assertSucceeds(db.collection('eApprovalHistory').where('organizationId', '==', ORG).limit(8000).get());
  await assertSucceeds(
    db.collection('eApprovalHistory').where('organizationId', '==', ORG).where('actorId', '==', 'u-appr')
      .orderBy('recordedAt', 'desc').limit(500).get(),
  );
  await assertSucceeds(db.doc('eApprovalComments/c1').get());
});

test('drafts: raised as yourself with Create, edited and submitted only by their requester', async () => {
  const req = as(env, 'requester');
  await assertSucceeds(requests(req).add({ status: 'Draft', requesterId: 'u-req', organizationId: ORG, subject: 'A', version: 1 }));
  await assertFails(requests(req).add({ status: 'Draft', requesterId: 'u-appr', organizationId: ORG, subject: 'A' }));
  await assertFails(requests(req).add({ status: 'Approved', requesterId: 'u-req', organizationId: ORG, subject: 'A' }));
  // No Create grant.
  await assertFails(requests(as(env, 'approver')).add({ status: 'Draft', requesterId: 'u-appr', subject: 'A' }));
  // A draft cannot pretend to be a mirror to escape the requester check.
  await assertFails(requests(req).add({ status: 'Draft', requesterId: 'u-x', source: { ...MIRROR_SOURCE, recordId: 'pay2' } }));

  await assertSucceeds(req.doc('eApprovalRequests/draft1').update({ subject: 'Steel bars', participantUserIds: ['u-cc'] }));
  await assertFails(as(env, 'approver').doc('eApprovalRequests/draft1').update({ subject: 'Hijacked' }));
  await assertFails(as(env, 'admin').doc('eApprovalRequests/draft1').update({ status: 'Pending Approval' }));
});

test('transitions: anyone in the module, who raised it and where it belongs never change', async () => {
  const appr = as(env, 'approver');
  // commitEApprovalTransition: read the request, then set-merge request, steps and history together.
  await assertSucceeds(appr.runTransaction(async (tx) => {
    await tx.get(appr.doc('eApprovalRequests/r1'));
    tx.set(appr.doc('eApprovalRequests/r1'), { status: 'Partially Approved', currentAssigneeIds: ['u-next'], stateRevision: 3 }, { merge: true });
    tx.set(appr.doc('eApprovalSteps/s1'), { approvalId: 'r1', status: 'Completed', actedByUserId: 'u-appr' }, { merge: true });
    tx.set(appr.doc('eApprovalSteps/s2'), { approvalId: 'r1', status: 'Active', requesterId: 'u-req' }, { merge: true });
    tx.set(appr.collection('eApprovalHistory').doc(), { approvalId: 'r1', actorId: 'u-appr', kind: 'Approve' });
    tx.set(appr.collection('eApprovalVersions').doc(), { approvalId: 'r1', version: 1 });
  }));
  // A recall deletes the steps its action created.
  await assertSucceeds(appr.doc('eApprovalSteps/s2').delete());
  await assertFails(appr.doc('eApprovalRequests/r1').update({ requesterId: 'u-appr' }));
  await assertFails(appr.doc('eApprovalRequests/r1').update({ organizationId: 'org2' }));
  await assertFails(appr.doc('eApprovalRequests/r1').update({ source: MIRROR_SOURCE }));
  await assertFails(appr.doc('eApprovalSteps/s1').update({ approvalId: 'draft1' }));
  // History is append-only.
  await assertFails(appr.doc('eApprovalHistory/h1').update({ actorId: 'u-x' }));
  await assertFails(as(env, 'admin').doc('eApprovalHistory/h1').update({ actorId: 'u-x' }));
  for (const uid of OUTSIDERS) {
    await assertFails(as(env, uid).doc('eApprovalRequests/r1').update({ status: 'Approved' }));
    await assertFails(as(env, uid).doc('eApprovalSteps/s1').update({ status: 'Completed' }));
    await assertFails(as(env, uid).collection('eApprovalHistory').add({ approvalId: 'r1', actorId: 'u-x' }));
  }
});

test('the escalation "Run now": Policies View lists open requests and records the sends', async () => {
  const db = as(env, 'policyViewer');
  await assertSucceeds(requests(db).where('organizationId', '==', ORG).where('status', 'in', ['Pending Approval']).orderBy('createdAt', 'desc').limit(200).get());
  const batch = db.batch();
  batch.set(db.doc('eApprovalSteps/s1'), { escalationsSent: ['l1'] }, { merge: true });
  batch.set(db.collection('eApprovalHistory').doc(), { approvalId: 'r1', actorId: 'system', kind: 'Escalation Fired' });
  await assertSucceeds(batch.commit());
});

test('comments: Comments Add to post as yourself; the author alone edits or retracts the text', async () => {
  const req = as(env, 'requester');
  await assertSucceeds(req.collection('eApprovalComments').add({ approvalId: 'r1', authorId: 'u-req', body: 'Hi', editHistory: [] }));
  await assertFails(req.collection('eApprovalComments').add({ approvalId: 'r1', authorId: 'u-appr', body: 'Not me' }));
  await assertFails(as(env, 'approver').collection('eApprovalComments').add({ approvalId: 'r1', authorId: 'u-appr', body: 'x' }));
  await assertSucceeds(req.doc('eApprovalComments/c1').update({ body: 'Please now', editHistory: [{ previousBody: 'Please' }], updatedAt: 1 }));
  await assertSucceeds(req.doc('eApprovalComments/c1').update({ retracted: true, retractedReason: 'Wrong file' }));
  await assertFails(req.doc('eApprovalComments/c1').update({ authorId: 'u-appr' }));
  await assertFails(req.doc('eApprovalComments/c1').update({ approvalId: 'draft1' }));
  await assertFails(as(env, 'admin').doc('eApprovalComments/c1').update({ body: 'Rewritten' }));
  // commentCount on the request, by the commenter.
  await assertSucceeds(req.doc('eApprovalRequests/r1').update({ commentCount: 1 }));
});

test('attachments: added as yourself by anyone in the module; removed only from your own draft', async () => {
  const appr = as(env, 'approver');
  await assertSucceeds(appr.collection('eApprovalAttachments').add({ approvalId: 'r1', uploadedById: 'u-appr', name: 'reply.pdf' }));
  await assertFails(appr.collection('eApprovalAttachments').add({ approvalId: 'r1', uploadedById: 'u-req', name: 'forged.pdf' }));
  await assertFails(appr.doc('eApprovalAttachments/a2').update({ name: 'swapped.pdf' }));
  await assertFails(appr.doc('eApprovalAttachments/a1').delete());
  await assertFails(as(env, 'requester').doc('eApprovalAttachments/a2').delete());
  await assertSucceeds(as(env, 'requester').doc('eApprovalAttachments/a1').delete());
});

test('deleting: your own draft with Delete Draft, anything with Delete, the record going with it', async () => {
  await seed(env, {
    'eApprovalRequests/draft2': { organizationId: ORG, status: 'Draft', requesterId: 'u-req', subject: 'x' },
    'eApprovalAttachments/ad2': { approvalId: 'draft2', uploadedById: 'u-req' },
    'eApprovalHistory/hd2': { approvalId: 'draft2', actorId: 'u-req' },
    'eApprovalRequests/r9': { organizationId: ORG, status: 'Approved', requesterId: 'u-req', subject: 'x' },
    'eApprovalSteps/s9': { approvalId: 'r9' },
    'eApprovalHistory/h9': { approvalId: 'r9' },
    'eApprovalComments/c9': { approvalId: 'r9', authorId: 'u-req' },
    'eApprovalVersions/v9': { approvalId: 'r9' },
  });
  const req = as(env, 'requester');
  await assertFails(as(env, 'approver').doc('eApprovalRequests/draft2').delete());
  await assertFails(as(env, 'approver').doc('eApprovalHistory/hd2').delete());
  // deleteEApprovalChildren: one batch per collection, then the request last.
  const kids = req.batch();
  kids.delete(req.doc('eApprovalAttachments/ad2'));
  kids.delete(req.doc('eApprovalHistory/hd2'));
  await assertSucceeds(kids.commit());
  await assertSucceeds(req.doc('eApprovalRequests/draft2').delete());
  // A submitted request is not the requester's to delete.
  await assertFails(req.doc('eApprovalHistory/h9').delete());
  await assertFails(req.doc('eApprovalRequests/r9').delete());
  const admin = as(env, 'admin');
  const batch = admin.batch();
  ['eApprovalSteps/s9', 'eApprovalHistory/h9', 'eApprovalComments/c9', 'eApprovalVersions/v9'].forEach((p) => batch.delete(admin.doc(p)));
  await assertSucceeds(batch.commit());
  await assertSucceeds(admin.doc('eApprovalRequests/r9').delete());
});

test('the Recurring Payments bridge, for someone who only works the obligation', async () => {
  for (const uid of ['rpNamed', 'rpUser']) {
    const db = as(env, uid);
    await assertSucceeds(db.doc('eApprovalRequests/m1').get());
    await assertFails(db.doc('eApprovalRequests/r1').get());
    // A linked request that was deleted: the bridge detaches rather than failing.
    await assertSucceeds(db.doc('eApprovalRequests/gone').get());
    await assertSucceeds(db.collection('eApprovalSteps').where('approvalId', '==', 'm1').get());
    await assertFails(db.collection('eApprovalSteps').where('approvalId', '==', 'r1').get());
    await assertSucceeds(db.doc('eApprovalSettings/org1').get());
  }
  // Named on pay1 only; a Recurring Payments grant covers every obligation.
  await assertFails(as(env, 'rpNamed').doc('eApprovalRequests/m2').get());
  await assertSucceeds(as(env, 'rpUser').doc('eApprovalRequests/m2').get());
  await assertFails(as(env, 'other').doc('eApprovalRequests/m1').get());

  const db = as(env, 'rpNamed');
  // createMirroredEApproval: a reference number, the request (raised for the owner), then Submit.
  await assertSucceeds(db.runTransaction(async (tx) => {
    const ref = db.doc('eApprovalCounters/org1__2026-27__ALL');
    const snap = await tx.get(ref);
    tx.set(ref, { organizationId: ORG, nextSequence: Number(snap.data()?.nextSequence || 1) + 1 }, { merge: true });
  }));
  await assertSucceeds(db.runTransaction(async (tx) => {
    const ref = db.doc('eApprovalCounters/org1__2026-27__FIN');
    await tx.get(ref);
    tx.set(ref, { organizationId: ORG, nextSequence: 2 }, { merge: true });
  }));
  const mirror = db.collection('eApprovalRequests').doc('m3');
  await assertSucceeds(mirror.set({ organizationId: ORG, status: 'Draft', requesterId: 'u-owner', subject: 'Rent Nov', version: 1, source: MIRROR_SOURCE }));
  await assertSucceeds(db.runTransaction(async (tx) => {
    await tx.get(mirror);
    tx.set(db.doc('eApprovalSteps/sm3'), { approvalId: 'm3', status: 'Active', requesterId: 'u-owner' }, { merge: true });
    tx.set(mirror, { status: 'Pending Approval', currentAssigneeIds: ['u-named'], stateRevision: 1, source: MIRROR_SOURCE }, { merge: true });
    tx.set(db.collection('eApprovalHistory').doc(), { approvalId: 'm3', actorId: 'u-owner', kind: 'Submit' });
  }));
  // applyMirroredEApprovalAction reassigns the stage first; updateEApprovalSourceLink repoints the source.
  await assertSucceeds(db.doc('eApprovalSteps/sm1').update({ assignment: { kind: 'User', userId: 'u-named' }, reassignments: [] }));
  await assertSucceeds(db.doc('eApprovalRequests/m1').update({ source: { ...MIRROR_SOURCE, stepName: 'Approve' }, updatedAt: 1 }));
  await assertFails(db.doc('eApprovalRequests/m1').update({ requesterId: 'u-named' }));
  // Not for an obligation they do not work, and not by repointing an ordinary request.
  await assertFails(db.collection('eApprovalRequests').doc('m4').set({ status: 'Draft', requesterId: 'u-x', source: { ...MIRROR_SOURCE, recordId: 'pay2' } }));
  await assertFails(db.doc('eApprovalSteps/s1').update({ status: 'Completed' }));
  await assertFails(as(env, 'other').collection('eApprovalRequests').doc('m5').set({ status: 'Draft', requesterId: 'u-x', source: MIRROR_SOURCE }));
  // A reference number never goes backwards.
  await assertFails(db.doc('eApprovalCounters/org1__2026-27__ALL').update({ nextSequence: 1 }));
  await assertFails(as(env, null).doc('eApprovalCounters/org1__2026-27__ALL').get());
});

test('signatures: your own, by your users id, and nobody else\'s', async () => {
  const req = as(env, 'requester');
  await assertSucceeds(req.doc('eApprovalSignatures/u-req').get());
  await assertSucceeds(req.doc('eApprovalSignatures/u-req').set({ url: 'https://x/2.png' }, { merge: true }));
  await assertFails(req.doc('eApprovalSignatures/u-appr').get());
  await assertFails(req.doc('eApprovalSignatures/u-appr').set({ url: 'https://x/forged.png' }));
  await assertFails(req.doc('eApprovalSignatures/u-req').delete());
  // Keyed by the users id, not the auth uid.
  await assertFails(req.doc('eApprovalSignatures/requester').get());
});

test('configuration: each settings page writes with its own Edit or Add', async () => {
  const admin = as(env, 'admin');
  await assertSucceeds(admin.doc('eApprovalSettings/org1').set({ amountTolerancePct: 10 }, { merge: true }));
  await assertSucceeds(admin.doc('eApprovalDepartmentRouting/d2').set({ departmentId: 'd2', memberUserIds: [] }, { merge: true }));
  await assertSucceeds(admin.doc('eApprovalProjectRouting/p2').set({ projectId: 'p2' }, { merge: true }));
  // seedEApprovalTemplates is a batch.
  const seedBatch = admin.batch();
  seedBatch.set(admin.collection('eApprovalTemplates').doc(), { name: 'Finance Clearance' });
  seedBatch.set(admin.collection('eApprovalTemplates').doc(), { name: 'Purchase Approval' });
  await assertSucceeds(seedBatch.commit());
  await assertSucceeds(admin.collection('eApprovalRules').add({ name: 'Above 5L' }));
  await assertFails(admin.collection('eApprovalTypes').add({ name: 'x' }));
  await assertSucceeds(as(env, 'legacy').collection('eApprovalTypes').add({ name: 'Legacy-granted' }));
  await assertSucceeds(as(env, 'legacy').doc('eApprovalTypes/t1').delete());

  const viewer = as(env, 'policyViewer');
  await assertFails(viewer.doc('eApprovalSettings/org1').set({ amountTolerancePct: 99 }, { merge: true }));
  await assertFails(viewer.doc('eApprovalDepartmentRouting/d1').set({ memberUserIds: ['u-pol'] }, { merge: true }));
  await assertFails(as(env, 'other').doc('eApprovalProjectRouting/p1').set({ headUserId: 'u-other' }, { merge: true }));

  // Types, templates and rules: the module, and Recurring Payments' bridge settings page.
  for (const uid of ['approver', 'rpUser']) {
    await assertSucceeds(as(env, uid).collection('eApprovalTypes').get());
    await assertSucceeds(as(env, uid).collection('eApprovalTemplates').where('organizationId', '==', ORG).get());
    await assertSucceeds(as(env, uid).collection('eApprovalRules').where('organizationId', '==', ORG).get());
  }
  for (const uid of ['other', 'rpNamed', 'nodoc']) {
    await assertFails(as(env, uid).collection('eApprovalTypes').get());
  }
});

test('delegations: your own with Add or Edit; somebody else\'s needs Manage Others', async () => {
  const appr = as(env, 'approver');
  await assertSucceeds(appr.collection('eApprovalDelegations').add({ fromUserId: 'u-appr', toUserId: 'u-req', active: true }));
  await assertFails(appr.collection('eApprovalDelegations').add({ fromUserId: 'u-admin', toUserId: 'u-appr', active: true }));
  await assertFails(appr.collection('eApprovalDelegations').add({ fromUserId: 'u-appr', toUserId: 'u-appr' }));
  await assertSucceeds(appr.doc('eApprovalDelegations/dl1').set({ active: false }, { merge: true }));
  await assertFails(appr.doc('eApprovalDelegations/dl1').set({ fromUserId: 'u-admin' }, { merge: true }));
  await assertFails(as(env, 'requester').doc('eApprovalDelegations/dl1').delete());
  const admin = as(env, 'admin');
  await assertSucceeds(admin.collection('eApprovalDelegations').add({ fromUserId: 'u-req', toUserId: 'u-appr', active: true }));
  await assertSucceeds(admin.doc('eApprovalDelegations/dl1').delete());
});
