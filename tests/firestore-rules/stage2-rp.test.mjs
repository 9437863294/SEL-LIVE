// Stage 2, Recurring Payments: module users read the register and write by the action their screen
// checks; the people an obligation names read their own and its current assignees work the step;
// E-Approval approvers move a mirrored obligation through the bridge. Every query below is a shape
// the code really issues.
import test, { after, before } from 'node:test';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  arrayUnion, collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, runTransaction,
  serverTimestamp, setDoc, updateDoc, where, writeBatch,
} from 'firebase/firestore';
import { as, rulesEnv, seed } from './helpers.mjs';

const perms = (userDocId, p) => ({ v: 1, p, active: true, userDocId, roleNames: [], projectIds: [], departmentIds: [] });
const ORG = 'default';

let env;
before(async () => {
  env = await rulesEnv();
  await seed(env, {
    'userPermissions/viewer': perms('viewer', { 'Recurring Payments.Payments': ['View'] }),
    'userPermissions/reports': perms('reports', { 'Recurring Payments.Reports': ['View'] }),
    'userPermissions/recorder': perms('recorder', {
      'Recurring Payments.Payments': ['View'], 'Recurring Payments.Payment Processing': ['Record Payment', 'View'],
    }),
    'userPermissions/editor': perms('editor', {
      'Recurring Payments.Payments': ['Add', 'Add Comment', 'Delete', 'Edit', 'View'],
    }),
    'userPermissions/settings': perms('settings', {
      'Recurring Payments.Settings': ['Edit', 'Manage Field Control', 'View'],
    }),
    'userPermissions/masters': perms('masters', { 'Recurring Payments.Recurring Masters': ['Add', 'Edit', 'View'] }),
    'userPermissions/module': perms('module', { 'Recurring Payments': ['View Module'] }),
    // Hold nothing in the module: named on obligations only. Auth uid differs from the users id.
    'userPermissions/asg-auth': perms('asg', { 'Site Account Statement.Expenses': ['View'] }),
    'userPermissions/ver': perms('ver', {}),
    'userPermissions/lvl': perms('lvl', {}),
    'userPermissions/blank': perms('', {}),
    'userPermissions/ea': perms('ea', { 'E-Approval.Inbox': ['View'] }),
    'userPermissions/lc': perms('lc', { 'Letter of Credit Management.LC Requests': ['Add', 'View'] }),
    'userPermissions/other': perms('other', { 'Site Account Statement.Expenses': ['View'] }),
    'userPermissions/gone': { ...perms('gone', {}), active: false },

    'paymentObligations/p1': {
      organizationId: ORG, masterId: 'm1', cycleKey: 'default_m1_2026-10', title: 'Rent — Oct', vendorName: 'Landlord',
      status: 'Under Verification', workflowStatus: 'In Progress', stage: 'Bill Verification', currentStepId: '2',
      assignees: ['asg'], assignedTo: 'own', backupAssignedTo: '', verifierId: 'ver', approverId: '', accountsProcessorId: '',
      approvalLevels: ['lvl'], approvalCompletedBy: [], workflowHistory: [{ action: 'Submit Bill', userId: 'own' }],
      expectedAmount: 100, paidAmount: 0,
    },
    'paymentObligations/p2': {
      organizationId: ORG, masterId: 'm2', cycleKey: 'default_m2_2026-10', title: 'Power — Oct',
      status: 'Pending Approval', stage: 'Payment Approval', currentStepId: '3', assignees: ['zed'],
      assignedTo: '', verifierId: '', approverId: '', accountsProcessorId: '', approvalLevels: [], approvalCompletedBy: [],
      workflowHistory: [], eApproval: { requestId: 'r1', detachedAt: null, status: 'Pending Approval' },
    },
    'paymentObligations/p3': {
      organizationId: ORG, masterId: 'm3', title: 'Linked elsewhere', currentStepId: '3', assignees: [], assignedTo: '',
      workflowHistory: [], eApproval: { requestId: 'r2', detachedAt: null },
    },
    'paymentObligations/p4': {
      organizationId: ORG, title: 'Detached', currentStepId: '3', assignees: [], assignedTo: '', workflowHistory: [],
      eApproval: { requestId: 'r4', detachedAt: new Date('2026-10-01') },
    },
    'eApprovalRequests/r1': { source: { module: 'Recurring Payments', recordId: 'p2' }, currentAssigneeIds: ['ea'] },
    'eApprovalRequests/r2': { source: { module: 'Recurring Payments', recordId: 'somewhere-else' } },
    'eApprovalRequests/r4': { source: { module: 'Recurring Payments', recordId: 'p4' } },
    'paymentObligations/p1/transactions/t1': { organizationId: ORG, paymentId: 'p1', amount: 10, transactionReference: 'UTR1', createdAt: 1 },
    'paymentObligations/p1/auditLogs/a1': { organizationId: ORG, paymentId: 'p1', action: 'x', createdAt: 1 },
    'paymentObligations/p1/comments/c1': { organizationId: ORG, paymentId: 'p1', message: 'hi', createdAt: 1 },
    'paymentObligations/p2/auditLogs/a1': { organizationId: ORG, paymentId: 'p2', action: 'x', createdAt: 1 },
    'recurringPaymentSettings/default': { organizationId: ORG },
    'recurringPaymentSettings/fieldControl_default': { forms: {} },
    'recurringPaymentApprovalRules/r1': { organizationId: ORG, name: 'Default' },
    'recurringPaymentCategories/c1': { organizationId: ORG, name: 'Rent' },
    'recurringPaymentVendors/v1': { organizationId: ORG, name: 'Landlord' },
    'recurringPaymentVendors/v1/auditLogs/a1': { action: 'x', createdAt: 1 },
    'recurringPaymentMasters/m1': { organizationId: ORG, title: 'Rent' },
    'recurringPaymentMasters/m1/auditLogs/a1': { action: 'x', createdAt: 1 },
    'recurringPaymentAutomationLogs/l1': { organizationId: 'all' },
    'recurringPaymentNotificationQueue/q1': { paymentId: 'p1' },
    'recurringPaymentAutomationRuns/default_2026-10-13': { at: 1 },
    'workflows/recurring-payments-workflow': { steps: [] },
    'transactions/fd1': { amount: 1 },
  });
});
after(async () => env?.cleanup());

const db = (uid) => as(env, uid);
const byOrg = (uid) => query(collection(db(uid), 'paymentObligations'), where('organizationId', '==', ORG));

test('the register: every module user reads it whole; nobody else can', async () => {
  for (const uid of ['viewer', 'reports', 'recorder', 'editor', 'settings', 'masters', 'module']) {
    await assertSucceeds(getDocs(byOrg(uid)));
    await assertSucceeds(getDocs(query(collection(db(uid), 'paymentObligations'), where('organizationId', '==', ORG), where('masterId', '==', 'm1'))));
    await assertSucceeds(getDoc(doc(db(uid), 'paymentObligations/p2')));
  }
  for (const uid of ['asg-auth', 'ver', 'lvl', 'ea', 'lc', 'other', 'gone', 'nodoc', null]) {
    await assertFails(getDocs(byOrg(uid)));
  }
});

test('the people an obligation names read their own, by the field that names them', async () => {
  // use-assigned-workflow / stage queue / approval centre
  await assertSucceeds(getDocs(query(collection(db('asg-auth'), 'paymentObligations'), where('assignees', 'array-contains', 'asg'))));
  await assertSucceeds(getDocs(query(collection(db('lvl'), 'paymentObligations'), where('approvalLevels', 'array-contains', 'lvl'))));
  await assertSucceeds(getDocs(query(collection(db('lvl'), 'paymentObligations'), where('approvalCompletedBy', 'array-contains', 'lvl'))));
  // My Work: four equality queries, limit 50, no organization filter.
  for (const field of ['assignedTo', 'verifierId', 'approverId', 'accountsProcessorId', 'backupAssignedTo']) {
    await assertSucceeds(getDocs(query(collection(db('ver'), 'paymentObligations'), where(field, '==', 'ver'), limit(50))));
  }
  await assertSucceeds(getDoc(doc(db('asg-auth'), 'paymentObligations/p1')));
  await assertSucceeds(getDoc(doc(db('ver'), 'paymentObligations/p1')));
  await assertSucceeds(getDoc(doc(db('lvl'), 'paymentObligations/p1')));
  // Someone else's id, an obligation that does not name them, a blank id against blank fields.
  await assertFails(getDocs(query(collection(db('asg-auth'), 'paymentObligations'), where('assignees', 'array-contains', 'zed'))));
  await assertFails(getDocs(query(collection(db('ver'), 'paymentObligations'), where('assignedTo', '==', 'own'))));
  await assertFails(getDoc(doc(db('asg-auth'), 'paymentObligations/p2')));
  await assertFails(getDocs(query(collection(db('blank'), 'paymentObligations'), where('assignedTo', '==', ''))));
  await assertSucceeds(getDocs(query(collection(db('other'), 'paymentObligations'), where('assignees', 'array-contains', 'other'))));
  await assertFails(getDoc(doc(db('other'), 'paymentObligations/p1')));
});

test("the step's assignee works it: payment, instalment and trail in one transaction", async () => {
  await seed(env, { 'paymentObligations/p7': { organizationId: ORG, masterId: 'm1', assignees: ['asg'], currentStepId: '4', workflowHistory: [], expectedAmount: 100 } });
  const asg = db('asg-auth');
  const paymentRef = doc(asg, 'paymentObligations/p7');
  await assertSucceeds(getDocs(query(collection(asg, 'paymentObligations/p1/transactions'), where('transactionReference', '==', 'UTR9'))));
  await assertSucceeds(runTransaction(asg, async (tx) => {
    const snap = await tx.get(paymentRef);
    if (!snap.exists()) throw new Error('missing');
    tx.update(paymentRef, {
      workflowHistory: arrayUnion({ action: 'Record Payment', userId: 'asg' }), status: 'Paid', stage: 'Receipt & Closure',
      currentStepId: '5', assignees: ['closer'], paidAmount: 100, settledAmount: 100, outstandingAmount: 0, updatedAt: serverTimestamp(),
    });
    tx.set(doc(collection(paymentRef, 'transactions')), { organizationId: ORG, paymentId: 'p7', amount: 100, paidBy: 'asg' });
    tx.set(doc(collection(paymentRef, 'auditLogs')), { organizationId: ORG, paymentId: 'p7', action: 'Record Payment', userId: 'asg' });
  }));
  // Moved on: no longer theirs to act on, or to read.
  await assertFails(updateDoc(paymentRef, { status: 'Closed' }));
  await assertFails(getDoc(paymentRef));
});

test('an assignee cannot change what the obligation is, nor hide it', async () => {
  await seed(env, { 'paymentObligations/p5': { organizationId: ORG, masterId: 'm1', assignees: ['asg'], currentStepId: '1', workflowHistory: [] } });
  const ref = doc(db('asg-auth'), 'paymentObligations/p5');
  await assertSucceeds(updateDoc(ref, { billAmount: 120, billNumber: 'B-1' }));
  await assertFails(updateDoc(ref, { organizationId: 'elsewhere' }));
  await assertFails(updateDoc(ref, { masterId: 'm9' }));
  await assertFails(updateDoc(ref, { deleted: true }));
  await assertFails(deleteDoc(ref));
  // Named, but not on the current step.
  await assertFails(updateDoc(doc(db('ver'), 'paymentObligations/p5'), { billAmount: 1 }));
});

test('module writes follow the screen permissions', async () => {
  const editor = db('editor');
  await assertSucceeds(updateDoc(doc(editor, 'paymentObligations/p1'), { title: 'Rent — October' }));
  await assertSucceeds(updateDoc(doc(editor, 'paymentObligations/p1'), { deleted: true, deletedBy: 'editor', deletedAt: serverTimestamp() }));
  await assertFails(deleteDoc(doc(editor, 'paymentObligations/p1')));
  await assertFails(updateDoc(doc(editor, 'paymentObligations/p1'), { organizationId: 'x' }));
  // A recorder is an editor but cannot delete.
  await assertFails(updateDoc(doc(db('recorder'), 'paymentObligations/p2'), { deleted: true }));
  for (const uid of ['viewer', 'reports', 'module', 'settings']) {
    await assertFails(updateDoc(doc(db(uid), 'paymentObligations/p1'), { title: 'x' }));
  }
  // Manual payment: a batch with its trail entry.
  const batch = writeBatch(editor);
  const ref = doc(collection(editor, 'paymentObligations'));
  batch.set(ref, { organizationId: ORG, sourceType: 'Manual', assignees: ['ver'], title: 'Manual' });
  batch.set(doc(collection(ref, 'auditLogs')), { organizationId: ORG, paymentId: ref.id, action: 'Created' });
  await assertSucceeds(batch.commit());
  await assertFails(setDoc(doc(db('viewer'), 'paymentObligations/new1'), { organizationId: ORG }));
  await assertFails(setDoc(doc(editor, 'paymentObligations/new2'), { title: 'no org' }));
});

test('generation from a master: create-if-absent in a transaction, by Payments Add or a master editor', async () => {
  for (const uid of ['editor', 'masters']) {
    const fs = db(uid);
    const ref = doc(fs, `paymentObligations/default_m1_${uid}`);
    await assertSucceeds(runTransaction(fs, async (tx) => {
      if ((await tx.get(ref)).exists()) return;
      tx.set(ref, { organizationId: ORG, masterId: 'm1', status: 'Scheduled', assignees: [] });
      tx.set(doc(collection(ref, 'auditLogs')), { organizationId: ORG, paymentId: ref.id, action: 'Workflow activation skipped' });
    }));
  }
  const fs = db('reports');
  const ref = doc(fs, 'paymentObligations/default_m1_reports');
  await assertFails(runTransaction(fs, async (tx) => {
    await tx.get(ref);
    tx.set(ref, { organizationId: ORG, masterId: 'm1' });
  }));
});

test('subcollections: read with the payment, written by their own action', async () => {
  for (const uid of ['viewer', 'asg-auth', 'ver', 'lvl']) {
    const fs = db(uid);
    await assertSucceeds(getDocs(query(collection(fs, 'paymentObligations/p1/transactions'), orderBy('createdAt', 'desc'))));
    await assertSucceeds(getDocs(query(collection(fs, 'paymentObligations/p1/auditLogs'), orderBy('createdAt', 'desc'))));
    await assertSucceeds(getDocs(query(collection(fs, 'paymentObligations/p1/comments'), orderBy('createdAt', 'desc'))));
  }
  for (const uid of ['other', 'ea', 'nodoc']) {
    await assertFails(getDocs(collection(db(uid), 'paymentObligations/p1/transactions')));
    await assertFails(getDocs(collection(db(uid), 'paymentObligations/p1/auditLogs')));
  }
  await assertFails(getDocs(collection(db('asg-auth'), 'paymentObligations/p2/transactions')));
  await assertFails(getDocs(collection(db('asg-auth'), 'paymentObligations/missing/transactions')));

  // The register's Record Payment: a transaction on the payment, the instalment and the trail.
  const recorder = db('recorder');
  const ref = doc(recorder, 'paymentObligations/p2');
  await assertSucceeds(runTransaction(recorder, async (tx) => {
    await tx.get(ref);
    tx.update(ref, { paidAmount: 10, settledAmount: 10, status: 'Partially Paid' });
    tx.set(doc(collection(ref, 'transactions')), { organizationId: ORG, paymentId: 'p2', amount: 10 });
    tx.set(doc(collection(ref, 'auditLogs')), { organizationId: ORG, paymentId: 'p2', action: 'Payment recorded' });
  }));
  await assertFails(setDoc(doc(recorder, 'paymentObligations/p2/transactions/tx-wrong'), { paymentId: 'p1' }));
  await assertFails(setDoc(doc(db('viewer'), 'paymentObligations/p1/transactions/t9'), { paymentId: 'p1', amount: 1 }));
  // Editing an instalment needs Edit Transaction / Upload Receipt, or Payments' Record Payment.
  await assertFails(updateDoc(doc(recorder, 'paymentObligations/p1/transactions/t1'), { receiptUrl: 'x' }));
  await seed(env, { 'userPermissions/txedit': perms('txedit', { 'Recurring Payments.Payment Processing': ['Edit Transaction'] }) });
  await assertSucceeds(updateDoc(doc(db('txedit'), 'paymentObligations/p1/transactions/t1'), { receiptUrl: 'x' }));
  await assertFails(updateDoc(doc(db('txedit'), 'paymentObligations/p1/transactions/t1'), { paymentId: 'p2' }));

  // Audit trail is append-only.
  await assertFails(updateDoc(doc(db('editor'), 'paymentObligations/p1/auditLogs/a1'), { action: 'y' }));
  await assertFails(deleteDoc(doc(db('editor'), 'paymentObligations/p1/auditLogs/a1')));
  await assertFails(setDoc(doc(db('other'), 'paymentObligations/p1/auditLogs/zz'), { paymentId: 'p1' }));
  await assertFails(setDoc(doc(db('viewer'), 'paymentObligations/p1/auditLogs/zz'), { paymentId: 'p2' }));

  // Comments need Add Comment.
  await assertSucceeds(setDoc(doc(db('editor'), 'paymentObligations/p1/comments/c2'), { paymentId: 'p1', message: 'ok' }));
  await assertFails(setDoc(doc(db('viewer'), 'paymentObligations/p1/comments/c3'), { paymentId: 'p1', message: 'no' }));
});

test('the cross-obligation instalment search is for module users; root transactions are untouched', async () => {
  await assertSucceeds(getDocs(query(collectionGroup(db('reports'), 'transactions'), where('organizationId', '==', ORG))));
  for (const uid of ['asg-auth', 'other', 'ea', null]) {
    await assertFails(getDocs(query(collectionGroup(db(uid), 'transactions'), where('organizationId', '==', ORG))));
  }
  await assertSucceeds(getDocs(collection(db('other'), 'transactions')));
  await assertSucceeds(setDoc(doc(db('other'), 'transactions/fd2'), { amount: 2 }));
});

test('E-Approval approvers move a mirrored obligation, and only that, only as the bridge does', async () => {
  const ea = db('ea');
  await assertSucceeds(getDoc(doc(ea, 'paymentObligations/p2')));
  await assertFails(getDoc(doc(ea, 'paymentObligations/p1')));   // not mirrored
  await assertFails(getDoc(doc(ea, 'paymentObligations/p3')));   // the request points elsewhere
  await assertFails(getDoc(doc(ea, 'paymentObligations/p4')));   // detached
  await assertFails(getDocs(byOrg('ea')));
  await assertSucceeds(getDoc(doc(ea, 'recurringPaymentSettings/default')));

  // stampMirror
  await assertSucceeds(updateDoc(doc(ea, 'paymentObligations/p2'), { 'eApproval.status': 'Approved', 'eApproval.syncedAt': serverTimestamp(), updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(ea, 'paymentObligations/p3'), { 'eApproval.status': 'Approved', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(ea, 'paymentObligations/p1'), { 'eApproval.lastError': 'x', updatedAt: serverTimestamp() }));

  // advancePayment
  const ref = doc(ea, 'paymentObligations/p2');
  await assertSucceeds(runTransaction(ea, async (tx) => {
    await tx.get(ref);
    tx.update(ref, {
      workflowHistory: arrayUnion({ action: 'Approve', userId: 'ea', stepId: '3' }), workflowStatus: 'In Progress',
      status: 'Payment Processing', stage: 'Payment Processing', currentStepId: '4', assignees: ['proc'],
      currentApprovalLevel: 1, approvalCompletedBy: ['ea'], stepEnteredAt: serverTimestamp(), workflowDeadline: null, updatedAt: serverTimestamp(),
    });
    tx.set(doc(collection(ref, 'auditLogs')), { organizationId: ORG, paymentId: 'p2', action: 'Approve', userId: 'ea' });
  }));
  // Anything beyond the bridge's fields, or a move that leaves no history entry.
  await assertFails(updateDoc(ref, { status: 'Paid', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref, { billAmount: 1, workflowHistory: arrayUnion({ action: 'x' }) }));
  await assertFails(updateDoc(ref, { deleted: true }));
  await assertFails(setDoc(doc(ea, 'paymentObligations/p1/auditLogs/zz'), { paymentId: 'p1' }));

  // Someone without E-Approval cannot use the same door.
  await assertFails(updateDoc(doc(db('other'), 'paymentObligations/p2'), { 'eApproval.status': 'x', updatedAt: serverTimestamp() }));
});

test('module screens run the bridge too: stamp anything they show, advance only a mirrored one', async () => {
  const viewer = db('viewer');
  await assertSucceeds(updateDoc(doc(viewer, 'paymentObligations/p1'), { 'eApproval.lastError': 'Not mirrored', updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(db('asg-auth'), 'paymentObligations/p5'), { 'eApproval.requestId': 'rX', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(viewer, 'paymentObligations/p1'), { status: 'Approved', workflowHistory: arrayUnion({ action: 'Approve' }) }));
  await seed(env, { 'paymentObligations/p6': { organizationId: ORG, workflowHistory: [], eApproval: { requestId: 'r6', detachedAt: null } },
    'eApprovalRequests/r6': { source: { module: 'Recurring Payments', recordId: 'p6' } } });
  await assertSucceeds(updateDoc(doc(viewer, 'paymentObligations/p6'), { status: 'Approved', workflowHistory: arrayUnion({ action: 'Approve' }) }));
});

test('settings: readable by anyone signed in, written by their own permission', async () => {
  for (const uid of ['other', 'asg-auth', 'ea', 'viewer']) {
    await assertSucceeds(getDoc(doc(db(uid), 'recurringPaymentSettings/default')));
    await assertSucceeds(getDoc(doc(db(uid), 'recurringPaymentSettings/fieldControl_default')));
  }
  await assertFails(getDoc(doc(db(null), 'recurringPaymentSettings/default')));
  const settings = db('settings');
  await assertSucceeds(setDoc(doc(settings, 'recurringPaymentSettings/default'), { organizationId: ORG, eApproval: { enabled: true } }, { merge: true }));
  await assertSucceeds(setDoc(doc(settings, 'recurringPaymentSettings/fieldControl_default'), { forms: { a: 1 } }));
  await seed(env, { 'userPermissions/settingsedit': perms('se', { 'Recurring Payments.Settings': ['Edit'] }) });
  await assertFails(setDoc(doc(db('settingsedit'), 'recurringPaymentSettings/fieldControl_default'), { forms: {} }));
  await assertFails(setDoc(doc(db('viewer'), 'recurringPaymentSettings/default'), { x: 1 }, { merge: true }));

  await assertSucceeds(getDocs(query(collection(db('masters'), 'recurringPaymentApprovalRules'), where('organizationId', '==', ORG))));
  await assertSucceeds(updateDoc(doc(settings, 'recurringPaymentApprovalRules/r1'), { active: false }));
  await assertFails(updateDoc(doc(db('masters'), 'recurringPaymentApprovalRules/r1'), { active: true }));
  await assertFails(getDocs(collection(db('asg-auth'), 'recurringPaymentApprovalRules')));
});

test('masters, vendors, categories, logs and the queue', async () => {
  const masters = db('masters');
  await assertSucceeds(getDocs(query(collection(masters, 'recurringPaymentMasters'), where('organizationId', '==', ORG))));
  await assertSucceeds(getDocs(query(collection(masters, 'recurringPaymentMasters/m1/auditLogs'), orderBy('createdAt', 'desc'))));
  await assertSucceeds(updateDoc(doc(masters, 'recurringPaymentMasters/m1'), { status: 'Paused' }));
  await assertSucceeds(setDoc(doc(masters, 'recurringPaymentMasters/m1/auditLogs/a2'), { action: 'Paused' }));
  await assertFails(deleteDoc(doc(masters, 'recurringPaymentMasters/m1')));
  await assertFails(updateDoc(doc(db('viewer'), 'recurringPaymentMasters/m1'), { status: 'Active' }));
  await assertFails(getDocs(collection(db('other'), 'recurringPaymentMasters')));

  // LC's request form reads the whole vendor list, without any Recurring Payments grant.
  await assertSucceeds(getDocs(collection(db('lc'), 'recurringPaymentVendors')));
  await assertSucceeds(getDocs(query(collection(db('masters'), 'recurringPaymentVendors'), where('organizationId', '==', ORG))));
  await assertFails(getDocs(collection(db('other'), 'recurringPaymentVendors')));
  await assertFails(setDoc(doc(db('masters'), 'recurringPaymentVendors/v2'), { name: 'x' }));
  await seed(env, { 'userPermissions/vendors': perms('vendors', { 'Recurring Payments.Vendors': ['Add', 'Edit', 'View'] }) });
  const vendors = db('vendors');
  const vb = writeBatch(vendors);
  vb.set(doc(vendors, 'recurringPaymentVendors/v2'), { organizationId: ORG, name: 'New' });
  vb.set(doc(vendors, 'recurringPaymentVendors/v2/auditLogs/a1'), { action: 'Created' });
  await assertSucceeds(vb.commit());

  await assertSucceeds(getDocs(query(collection(db('viewer'), 'recurringPaymentCategories'), where('organizationId', '==', ORG))));
  await assertFails(setDoc(doc(db('viewer'), 'recurringPaymentCategories/c2'), { name: 'x' }));
  await seed(env, { 'userPermissions/cats': perms('cats', { 'Recurring Payments.Categories': ['Add', 'View'] }) });
  await assertSucceeds(setDoc(doc(db('cats'), 'recurringPaymentCategories/c2'), { organizationId: ORG, name: 'x' }));

  await assertSucceeds(getDocs(query(collection(db('reports'), 'recurringPaymentAutomationLogs'), where('organizationId', 'in', [ORG, 'all']))));
  await assertSucceeds(getDocs(query(collection(db('settings'), 'recurringPaymentAutomationLogs'), where('organizationId', '==', 'all'))));
  await assertFails(getDocs(collection(db('other'), 'recurringPaymentAutomationLogs')));
  await assertFails(setDoc(doc(db('settings'), 'recurringPaymentAutomationLogs/l2'), { organizationId: ORG }));
  await assertSucceeds(getDocs(query(collection(db('viewer'), 'recurringPaymentNotificationQueue'), where('paymentId', '==', 'p1'))));
  await assertFails(getDocs(query(collection(db('asg-auth'), 'recurringPaymentNotificationQueue'), where('paymentId', '==', 'p1'))));
  await assertFails(setDoc(doc(db('editor'), 'recurringPaymentNotificationQueue/q2'), { paymentId: 'p1' }));
  await assertFails(getDoc(doc(db('settings'), 'recurringPaymentAutomationRuns/default_2026-10-13')));

  // The shared workflow document stays on the catch-all.
  await assertSucceeds(getDoc(doc(db('asg-auth'), 'workflows/recurring-payments-workflow')));
});

test('a production-sized obligation stays within the rules evaluation limits on every path', async () => {
  const entry = (i) => ({ action: 'Step ' + i, comment: 'x'.repeat(200), userId: 'u' + i, userName: 'User ' + i, stepId: String(i % 5), stepName: 'Step', timestamp: new Date(2026, 0, 1 + i) });
  const big = {
    organizationId: ORG, masterId: 'm1', cycleKey: 'k', title: 'Big', vendorName: 'V', currentStepId: '3',
    assignees: ['asg', 'a2', 'a3'], assignedTo: 'own', backupAssignedTo: 'b', verifierId: 'v', approverId: 'ap', accountsProcessorId: 'pr',
    approvalLevels: ['l1', 'l2', 'l3', 'lvl'], approvalCompletedBy: ['l1', 'l2'], status: 'Pending Approval',
    workflowHistory: Array.from({ length: 60 }, (_, i) => entry(i)),
    documentReferences: Array.from({ length: 30 }, (_, i) => ({ stepId: '1', action: 'Submit Bill', reference: 'https://x/' + i, addedBy: 'u', addedAt: new Date(), version: i })),
    varianceComparisons: { previous: 1, average3: 2, average6: 3, estimated: 4, maximum: 5 },
    eApproval: { requestId: 'r8', detachedAt: null, status: 'Pending Approval', referenceNo: 'EA-1', lastError: null },
    ...Object.fromEntries(Array.from({ length: 50 }, (_, i) => ['extra' + i, 'value ' + i])),
  };
  await seed(env, { 'paymentObligations/p8': big, 'eApprovalRequests/r8': { source: { module: 'Recurring Payments', recordId: 'p8' } } });
  // The last-tried path for each kind of caller.
  const ea = db('ea');
  const ref = doc(ea, 'paymentObligations/p8');
  await assertSucceeds(getDoc(ref));
  await assertSucceeds(runTransaction(ea, async (tx) => {
    await tx.get(ref);
    tx.update(ref, { workflowHistory: arrayUnion(entry(99)), status: 'Payment Processing', stage: 'Payment Processing', currentStepId: '4', assignees: ['pr'], updatedAt: serverTimestamp() });
    tx.set(doc(collection(ref, 'auditLogs')), { organizationId: ORG, paymentId: 'p8', action: 'Approve' });
  }));
  await assertSucceeds(updateDoc(doc(db('lvl'), 'paymentObligations/p8'), { 'eApproval.lastError': 'x', updatedAt: serverTimestamp() }));
  await assertSucceeds(getDocs(query(collection(db('lvl'), 'paymentObligations'), where('approvalLevels', 'array-contains', 'lvl'))));
  await seed(env, { 'paymentObligations/p8': big });
  await assertSucceeds(updateDoc(doc(db('asg-auth'), 'paymentObligations/p8'), { billAmount: 5, workflowHistory: arrayUnion(entry(100)) }));
  await assertSucceeds(updateDoc(doc(db('editor'), 'paymentObligations/p8'), { deleted: true, deletedBy: 'editor' }));
});
