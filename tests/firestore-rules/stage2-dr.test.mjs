// Stage 2, Daily Requisition (`dailyRequisitions`, `dailyRequisitionSettings`) and Site Fund
// Requisition (`requisitions`): Daily Requisition follows the page permission its screens check
// (`Daily Requisition.<Page>`), Site Fund Requisition the requisition's own `raisedById` and
// `assignees`, read from userPermissions/{authUid}. Query shapes are the screens' own
// (src/app/(protected)/daily-requisition, src/components/daily-requisition,
// src/components/site-fund-requisition, src/app/(protected)/site-fund-requisition-2) and those of the
// readers outside the modules (Bank Balance, Expenses, the header, the work dashboard, Billing Recon).
import test, { after, before } from 'node:test';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  addDoc, arrayRemove, arrayUnion, collection, deleteDoc, deleteField, doc, documentId, getCountFromServer, getDoc,
  getDocs, limit, orderBy, query, runTransaction, setDoc, Timestamp, updateDoc, where,
} from 'firebase/firestore';
import { as, rulesEnv, seed } from './helpers.mjs';

const DR = 'Daily Requisition';
const perms = (userDocId, p = {}, roleNames = []) => ({ v: 1, p, active: true, userDocId, roleNames, projectIds: [], departmentIds: [] });

const now = Timestamp.fromDate(new Date('2026-10-01T12:00:00Z'));
const req = (status, extra = {}) => ({
  receptionNo: `RN-${status}`, depNo: '', date: now, projectId: 'P1', departmentId: 'D1', description: 'x',
  partyName: 'ABC', grossAmount: 100, netAmount: 100, createdAt: now, status, attachments: [], ...extra,
});
const sfr = (extra = {}) => ({
  projectId: 'P1', departmentId: 'D1', amount: 500, partyName: 'ABC', description: 'x', date: '2026-10-01',
  raisedBy: 'Raiser', raisedById: 'uRaiser', status: 'Pending', stage: 'Request Receiving', requisitionId: 'SFR-0001',
  createdAt: now, currentStepId: 'step1', assignees: ['uAssignee'], deadline: now,
  history: [{ action: 'Created', userId: 'uRaiser', stepName: 'Creation', timestamp: now }], attachments: [], ...extra,
});

let env;
before(async () => {
  env = await rulesEnv();
  await seed(env, {
    // Daily Requisition, page by page.
    'userPermissions/entry': perms('uEntry', { [DR]: ['View Module'], [`${DR}.Entry Sheet`]: ['View', 'Add', 'Edit', 'Delete'] }),
    'userPermissions/entryView': perms('uEntryV', { [`${DR}.Entry Sheet`]: ['View'] }),
    'userPermissions/receiving': perms('uRecv', { [`${DR}.Receiving at Finance`]: ['View', 'Mark as Received', 'Return to Pending', 'Reject', 'Cancel'] }),
    'userPermissions/verifier': perms('uVer', { [`${DR}.GST & TDS Verification`]: ['View', 'Verify', 'Re-verify', 'Return to Pending'] }),
    'userPermissions/payer': perms('uPay', { [`${DR}.Processed for Payment`]: ['View', 'Mark as Received for Payment', 'Approve'] }),
    'userPermissions/documents': perms('uDoc', { [`${DR}.Manage Documents`]: ['View', 'Mark as Missing', 'Not Required', 'Move to Pending'] }),
    'userPermissions/uploader': perms('uUp', { [`${DR}.Manage Documents`]: ['View', 'Upload'] }),
    'userPermissions/reports': perms('uRep', { [`${DR}.Reports`]: ['View'] }),
    'userPermissions/fieldControl': perms('uFc', { [`${DR}.Field Control`]: ['View', 'Edit'] }),
    'userPermissions/dataControl': perms('uDc', { [`${DR}.Data Control`]: ['View', 'Edit'] }),
    'userPermissions/drSettingsView': perms('uDs', { [DR]: ['View Module'], [`${DR}.Settings`]: ['View'], [`${DR}.Field Control`]: ['View'] }),
    // Readers outside the module.
    'userPermissions/gstReg': perms('uGst', { 'Expenses.GST Registrations': ['View'] }),
    'userPermissions/expDept': perms('uExpD', { 'Expenses.Departments.D1': ['View', 'Create'] }),
    'userPermissions/expNamed': perms('uExpN', { 'Windows Agent.Reports': ['View'] }),
    'userPermissions/expRole': perms('uExpR', {}, ['Site Accountant']),
    'userPermissions/bbAdd': perms('uBbA', { 'Bank Balance.Expenses': ['View', 'Add'] }),
    'userPermissions/bbDel': perms('uBbD', { 'Bank Balance.Expenses': ['View', 'Delete'] }),
    'userPermissions/bbView': perms('uBbV', { 'Bank Balance.Expenses': ['View'], 'Bank Balance': ['View Module'] }),
    // Site Fund Requisition.
    'userPermissions/raiser': perms('uRaiser', { 'Site Fund Requisition': ['Create Requisition'] }),
    'userPermissions/assignee': perms('uAssignee', {}),
    // The assignee again, signed in through an email-matched account with another auth uid.
    'userPermissions/assigneeLegacy': perms('uAssignee', {}),
    'userPermissions/sfrViewAll': perms('uSva', { 'Site Fund Requisition': ['View All', 'Create Requisition'] }),
    'userPermissions/sfrModule': perms('uSm', { 'Site Fund Requisition 2': ['View Module'] }),
    'userPermissions/sfrRequests': perms('uSr', { 'Site Fund Requisition 2.Requests': ['View'] }),
    'userPermissions/sfrAdd': perms('uSa', { 'Site Fund Requisition 2.Requests': ['View', 'Add'] }),
    'userPermissions/sfrReport': perms('uSrep', { 'Site Fund Requisition 2.Reports.Site Fund Summary': ['View'] }),
    'userPermissions/billing': perms('uBill', { 'Billing Recon': ['View Module'] }),
    'userPermissions/stranger': perms('uX', { 'Windows Agent.Reports': ['View'] }),
    'userPermissions/gone': { ...perms('uGone'), active: false },
    // `nodoc` has no permissions document at all.

    'expensesSettings/user-roles': {
      actions: {
        'raise-request': { mode: 'assigned-too', type: 'users', users: { primary: ['uExpN'], alternates: [] } },
        'view-reports': { mode: 'assigned-only', type: 'roles', roles: { primary: ['Site Accountant'], alternates: [] } },
        'edit-request': { mode: 'roles-only', type: 'users', users: { primary: ['uX'], alternates: [] } },
      },
    },

    'dailyRequisitions/pending': req('Pending'),
    'dailyRequisitions/received': req('Received', { receivedById: 'uRecv', receivedAt: now }),
    'dailyRequisitions/verified': req('Verified', { verifiedAt: now, igstAmount: 18, gstNo: '22AAA' }),
    'dailyRequisitions/rfp': req('Received for Payment', { paidAmount: 0, payments: [] }),
    'dailyRequisitions/part': req('Partially Paid', { paidAmount: 10, payments: [{ bankPaymentId: 'V2', lineId: 'L1', amount: 10 }], lastPaidAt: now }),
    'dailyRequisitions/paid': req('Paid', { paidAmount: 100, payments: [{ bankPaymentId: 'V3', lineId: 'L1', amount: 100 }], paidAt: now, lastPaidAt: now }),
    'dailyRequisitions/cancelled': req('Cancelled'),
    // Sent back to verification after a voucher part-paid it: Bank Balance's cancel keeps its status.
    'dailyRequisitions/sentBack': req('Received', { paidAmount: 10, payments: [{ bankPaymentId: 'V4', lineId: 'L1', amount: 10 }] }),
    'dailyRequisitionSettings/module-config': { fields: {}, columns: [], data: {} },

    'requisitions/r1': sfr(),
    'requisitions/r2': sfr({ raisedById: 'uOther', assignees: ['uOther2'], requisitionId: 'SFR-0002', status: 'In Progress', stage: 'Approval', currentStepId: 'step2' }),
    'requisitions/r3': sfr({ raisedById: 'uOther', assignees: [], requisitionId: 'SFR-0003', status: 'Completed', stage: 'Completed', currentStepId: null }),
  });
});
after(async () => env?.cleanup());

const db = (uid) => as(env, uid);
const OUTSIDERS = ['stranger', 'gone', 'nodoc'];
const DR_READERS = ['entry', 'entryView', 'receiving', 'verifier', 'payer', 'documents', 'uploader', 'reports', 'gstReg'];
const reqs = (d) => collection(d, 'dailyRequisitions');

/* ── Daily Requisition: reading ── */

test('the module reads the register whole, as each page asks', async () => {
  for (const uid of DR_READERS) {
    const d = db(uid);
    // Dashboard and the reports; Entry Sheet and Manage Documents (orderBy createdAt desc).
    await assertSucceeds(getDocs(reqs(d)));
    await assertSucceeds(getDocs(query(reqs(d), orderBy('createdAt', 'desc'))));
    // Each stage queue (`status in` its statuses) and a transaction's re-read by id.
    await assertSucceeds(getDocs(query(reqs(d), where('status', 'in', ['Pending', 'Received', 'Cancelled']))));
    await assertSucceeds(getDoc(doc(d, 'dailyRequisitions/paid')));
    // The checklist print (`documentId() in` chunks of 30).
    await assertSucceeds(getDocs(query(reqs(d), where(documentId(), 'in', ['pending', 'paid']))));
  }
  // The work dashboard's shared-queue tile: a count of the statuses this person can move.
  await assertSucceeds(getCountFromServer(query(reqs(db('receiving')), where('status', 'in', ['Pending']))));
  await assertSucceeds(getCountFromServer(query(reqs(db('payer')), where('status', 'in', ['Verified', 'Received for Payment', 'Partially Paid']))));
});

test('Expenses reads it for its register, raise form, import and reports', async () => {
  // A department grant; named on raise-request (assigned-too); a role named on view-reports.
  for (const uid of ['expDept', 'expNamed', 'expRole']) {
    const d = db(uid);
    await assertSucceeds(getDocs(reqs(d)));
    await assertSucceeds(getDocs(query(reqs(d), where('depNo', '==', 'DEP-1'))));
    await assertSucceeds(getDocs(query(reqs(d), where('departmentId', 'in', ['D1', 'D2']))));
    await assertSucceeds(getDocs(query(reqs(d), where('depNo', 'in', ['DEP-1', 'DEP-2']))));
  }
  // Named on an action left at roles-only carries nothing.
  await assertFails(getDocs(reqs(db('stranger'))));
});

test('Bank Balance: New Payment lists what awaits payment; a voucher re-reads by id', async () => {
  const add = db('bbAdd');
  await assertSucceeds(getDocs(query(reqs(add), where('status', 'in', ['Received for Payment', 'Partially Paid']))));
  await assertFails(getDocs(query(reqs(add), where('status', 'in', ['Received for Payment', 'Partially Paid', 'Paid']))));
  await assertFails(getDocs(reqs(add)));
  for (const id of ['rfp', 'part', 'paid', 'pending']) {
    await assertSucceeds(getDoc(doc(add, 'dailyRequisitions', id)));
    await assertSucceeds(getDoc(doc(db('bbDel'), 'dailyRequisitions', id)));
  }
  await assertFails(getDocs(query(reqs(db('bbDel')), where('status', 'in', ['Received for Payment', 'Partially Paid']))));
  await assertFails(getDoc(doc(db('bbView'), 'dailyRequisitions/rfp')));
});

test('everybody else is refused, the settings pages included', async () => {
  for (const uid of [...OUTSIDERS, 'fieldControl', 'dataControl', 'drSettingsView', 'bbView', 'raiser', 'sfrModule', null]) {
    await assertFails(getDocs(reqs(db(uid))));
    await assertFails(getDoc(doc(db(uid), 'dailyRequisitions/pending')));
  }
});

/* ── Daily Requisition: Entry Sheet ── */

test('Entry Sheet: Add creates (form, Receive Multiple, import), Edit the form fields, Delete', async () => {
  const e = db('entry');
  const created = await assertSucceeds(addDoc(reqs(e), req('Pending')));
  // The import brings paid history with it.
  await assertSucceeds(setDoc(doc(reqs(e)), req('Paid', { paidAmount: 100, manualPaid: true, documentStatus: 'Pending' })));
  for (const uid of ['entryView', 'receiving', 'payer', 'bbAdd', ...OUTSIDERS]) {
    await assertFails(addDoc(reqs(db(uid)), req('Pending')));
  }

  await assertSucceeds(runTransaction(e, async (tx) => {
    await tx.get(doc(e, 'dailyRequisitions/pending'));
    tx.update(doc(e, 'dailyRequisitions/pending'), { partyName: 'XYZ', grossAmount: 120, netAmount: 120, date: now });
  }));
  // The edit form never moves a requisition, nor pays it.
  await assertFails(updateDoc(doc(e, 'dailyRequisitions/pending'), { status: 'Received' }));
  await assertFails(updateDoc(doc(e, 'dailyRequisitions/pending'), { paidAmount: 5 }));
  // Once money is recorded, only the description.
  await assertSucceeds(updateDoc(doc(e, 'dailyRequisitions/part'), { description: 'clarified' }));
  await assertFails(updateDoc(doc(e, 'dailyRequisitions/part'), { netAmount: 90 }));
  await assertFails(updateDoc(doc(db('entryView'), 'dailyRequisitions/pending'), { description: 'y' }));

  await assertSucceeds(deleteDoc(created));
  await assertFails(deleteDoc(doc(e, 'dailyRequisitions/part')));
  await assertFails(deleteDoc(doc(e, 'dailyRequisitions/paid')));
  await assertFails(deleteDoc(doc(db('receiving'), 'dailyRequisitions/cancelled')));
});

/* ── Daily Requisition: the workflow stages ── */

const move = (uid, id, fields) => {
  const d = db(uid);
  return runTransaction(d, async (tx) => {
    await tx.get(doc(d, 'dailyRequisitions', id));
    tx.update(doc(d, 'dailyRequisitions', id), fields);
  });
};

test('Receiving at Finance: receive, return, cancel', async () => {
  await assertFails(move('verifier', 'pending', { status: 'Received', receivedAt: now, receivedById: 'uVer' }));
  await assertFails(move('entry', 'pending', { status: 'Received', receivedAt: now, receivedById: 'uEntry' }));
  await assertSucceeds(move('receiving', 'pending', { status: 'Received', receivedAt: now, receivedById: 'uRecv' }));
  await assertSucceeds(move('receiving', 'pending', { status: 'Pending', receivedAt: null, receivedById: null }));
  await assertSucceeds(move('receiving', 'cancelled', { status: 'Pending' }));
  await assertSucceeds(move('receiving', 'cancelled', { status: 'Cancelled' }));
  // A move carries the status and its stamps, nothing else.
  await assertFails(move('receiving', 'pending', { status: 'Received', netAmount: 1, partyName: 'Z' }));
});

test('GST & TDS Verification: verify or flag, send back, and Send for Payment', async () => {
  const tax = { verifiedAt: now, igstAmount: 18, tdsAmount: 2, cgstAmount: 0, sgstAmount: 0, retentionAmount: 0, otherDeduction: 0, verificationNotes: '', gstNo: '22AAA', gstType: 'igst', gstRate: 18, gstRegistrationId: 'G1', netAmount: 116 };
  await assertSucceeds(move('verifier', 'received', { status: 'Verified', ...tax }));
  await assertSucceeds(move('verifier', 'received', { status: 'Needs Review', ...tax }));
  await assertFails(move('receiving', 'received', { status: 'Verified', ...tax }));
  // Back to Received, the verification cleared.
  await assertSucceeds(move('verifier', 'verified', { status: 'Received', verifiedAt: null, igstAmount: 0, tdsAmount: 0, cgstAmount: 0, sgstAmount: 0, retentionAmount: 0, otherDeduction: 0, verificationNotes: '', gstNo: '' }));
  // Send for Payment needs Processed for Payment's grant (canSendForPayment).
  await assertFails(move('verifier', 'verified', { status: 'Received for Payment' }));
  await assertSucceeds(move('payer', 'verified', { status: 'Received for Payment' }));
  // Nothing on a requisition with money recorded against it.
  await assertFails(move('verifier', 'sentBack', { status: 'Verified', ...tax }));
});

test('Processed for Payment: Mark as Paid by hand, from awaiting payment only', async () => {
  const paid = { status: 'Paid', paidAt: now, paidAmount: 100, manualPaid: true, paidById: 'uPay', paidByName: 'P' };
  await assertFails(move('verifier', 'rfp', paid));
  await assertFails(move('receiving', 'rfp', paid));
  // The paid figures go only with Paid.
  await assertFails(move('payer', 'rfp', { status: 'Received for Payment', paidAmount: 100 }));
  await assertFails(move('payer', 'part', paid));
  await assertSucceeds(move('payer', 'rfp', paid));
  await setDocAdmin('dailyRequisitions/rfp', req('Received for Payment', { paidAmount: 0, payments: [] }));
});

async function setDocAdmin(path, data) {
  await env.withSecurityRulesDisabled(async (ctx) => { await ctx.firestore().doc(path).set(data); });
}

/* ── Daily Requisition: Manage Documents ── */

test('Manage Documents: the status by its actions, files by Upload', async () => {
  const statusOnly = { documentStatus: 'Missing', documentStatusUpdatedById: 'uDoc', documentStatusUpdatedAt: now };
  await assertSucceeds(updateDoc(doc(db('documents'), 'dailyRequisitions/paid'), statusOnly));
  await assertFails(updateDoc(doc(db('documents'), 'dailyRequisitions/paid'), { attachments: arrayUnion({ name: 'a.pdf', url: 'u' }) }));
  await assertSucceeds(updateDoc(doc(db('uploader'), 'dailyRequisitions/paid'), {
    attachments: arrayUnion({ name: 'a.pdf', url: 'u' }), documentStatus: 'Uploaded', documentStatusUpdatedAt: now, documentStatusUpdatedById: 'uUp',
  }));
  await assertSucceeds(updateDoc(doc(db('uploader'), 'dailyRequisitions/paid'), {
    attachments: arrayRemove({ name: 'a.pdf', url: 'u' }), documentStatusUpdatedAt: now, documentStatusUpdatedById: 'uUp', documentStatus: 'Pending',
  }));
  await assertFails(updateDoc(doc(db('documents'), 'dailyRequisitions/paid'), { ...statusOnly, status: 'Received for Payment' }));
  for (const uid of ['entry', 'reports', ...OUTSIDERS]) {
    await assertFails(updateDoc(doc(db(uid), 'dailyRequisitions/paid'), statusOnly));
  }
});

/* ── Daily Requisition: Bank Balance's voucher ── */

test('a voucher pays what awaits payment (Expenses Add), and nothing else', async () => {
  const pay = (uid, id, fields) => {
    const d = db(uid);
    return runTransaction(d, async (tx) => {
      await tx.get(doc(d, 'dailyRequisitions', id));
      tx.update(doc(d, 'dailyRequisitions', id), fields);
    });
  };
  const line = { bankPaymentId: 'V9', lineId: 'L1', amount: 10, receptionNo: 'RN' };
  await assertFails(pay('bbDel', 'rfp', { paidAmount: 10, payments: [line], status: 'Partially Paid', lastPaidAt: now }));
  await assertFails(pay('bbAdd', 'rfp', { paidAmount: 10, payments: [line], status: 'Partially Paid', lastPaidAt: now, netAmount: 10 }));
  await assertFails(pay('bbAdd', 'pending', { paidAmount: 10, payments: [line], status: 'Partially Paid', lastPaidAt: now }));
  await assertFails(pay('bbAdd', 'rfp', { paidAmount: 0, status: 'Paid', paidAt: now }));
  await assertSucceeds(pay('bbAdd', 'rfp', { paidAmount: 10, payments: [line], status: 'Partially Paid', lastPaidAt: now }));
  await assertSucceeds(pay('bbAdd', 'part', {
    paidAmount: 100, payments: [{ bankPaymentId: 'V2', lineId: 'L1', amount: 10 }, line], status: 'Paid', lastPaidAt: now, paidAt: now,
  }));
});

test("the Cheque Register's cancel or bounce takes the payment back (Expenses Delete)", async () => {
  const reverse = (uid, id, fields) => {
    const d = db(uid);
    return runTransaction(d, async (tx) => {
      await tx.get(doc(d, 'dailyRequisitions', id));
      tx.update(doc(d, 'dailyRequisitions', id), fields);
    });
  };
  await assertFails(reverse('bbAdd', 'paid', { paidAmount: 0, payments: [], status: 'Received for Payment', paidAt: deleteField(), lastPaidAt: deleteField() }));
  await assertFails(reverse('bbDel', 'paid', { paidAmount: 0, payments: [], status: 'Received for Payment', partyName: 'Z' }));
  await assertSucceeds(reverse('bbDel', 'paid', { paidAmount: 0, payments: [], status: 'Received for Payment', paidAt: deleteField(), lastPaidAt: deleteField() }));
  // Out of the payment stage, its status stays.
  await assertFails(reverse('bbDel', 'sentBack', { paidAmount: 0, payments: [], status: 'Received for Payment' }));
  await assertSucceeds(reverse('bbDel', 'sentBack', { paidAmount: 0, payments: [], paidAt: deleteField(), lastPaidAt: deleteField() }));
});

/* ── Daily Requisition: settings ── */

test('Field and Data Control: read by anyone signed in, written by either Edit', async () => {
  for (const uid of ['entry', 'stranger', 'nodoc']) {
    await assertSucceeds(getDoc(doc(db(uid), 'dailyRequisitionSettings/module-config')));
  }
  await assertFails(getDoc(doc(db(null), 'dailyRequisitionSettings/module-config')));
  const whole = { fields: {}, columns: [], data: { dateControl: {} }, meta: {}, updatedAt: now, updatedById: 'u', updatedByName: 'n' };
  await assertSucceeds(setDoc(doc(db('fieldControl'), 'dailyRequisitionSettings/module-config'), whole));
  await assertSucceeds(setDoc(doc(db('dataControl'), 'dailyRequisitionSettings/module-config'), whole));
  await assertFails(setDoc(doc(db('fieldControl'), 'dailyRequisitionSettings/other'), whole));
  for (const uid of ['drSettingsView', 'entry', ...OUTSIDERS]) {
    await assertFails(setDoc(doc(db(uid), 'dailyRequisitionSettings/module-config'), whole));
  }
});

/* ── Site Fund Requisition ── */

const sfrs = (d) => collection(d, 'requisitions');

test('the register: the whole of it for module users, your own for everyone else', async () => {
  for (const uid of ['sfrViewAll', 'sfrModule', 'sfrRequests', 'sfrReport', 'billing']) {
    await assertSucceeds(getDocs(query(sfrs(db(uid)), orderBy('createdAt', 'desc'))));
    await assertSucceeds(getDocs(sfrs(db(uid))));
  }
  // AllRequisitionsTab2 for someone who reads only what they raised.
  await assertSucceeds(getDocs(query(sfrs(db('raiser')), where('raisedById', '==', 'uRaiser'))));
  await assertFails(getDocs(query(sfrs(db('raiser')), where('raisedById', '==', 'uOther'))));
  await assertFails(getDocs(query(sfrs(db('raiser')), orderBy('createdAt', 'desc'))));
  // The stage queue reads the whole stage.
  await assertSucceeds(getDocs(query(sfrs(db('sfrRequests')), where('currentStepId', '==', 'step1'))));
  await assertFails(getDocs(query(sfrs(db('assignee')), where('currentStepId', '==', 'step1'))));
  for (const uid of [...OUTSIDERS, 'entry', null]) {
    await assertFails(getDocs(sfrs(db(uid))));
    await assertFails(getDoc(doc(db(uid), 'requisitions/r1')));
  }
});

test('what waits on you: the header, the work dashboard and the view dialog', async () => {
  for (const uid of ['assignee', 'assigneeLegacy']) {
    const d = db(uid);
    await assertSucceeds(getDocs(query(sfrs(d), where('assignees', 'array-contains', 'uAssignee'), where('status', 'in', ['Pending', 'In Progress', 'Needs Review']))));
    await assertSucceeds(getDocs(query(sfrs(d), where('assignees', 'array-contains', 'uAssignee'), limit(100))));
    await assertSucceeds(getDoc(doc(d, 'requisitions/r1')));
    await assertFails(getDoc(doc(d, 'requisitions/r2')));
    await assertFails(getDocs(query(sfrs(d), where('assignees', 'array-contains', 'uOther2'))));
  }
  await assertSucceeds(getDoc(doc(db('raiser'), 'requisitions/r1')));
  await assertFails(getDoc(doc(db('raiser'), 'requisitions/r2')));
});

test('raising one: as yourself, Pending, with Create Requisition', async () => {
  await assertSucceeds(addDoc(sfrs(db('raiser')), sfr()));
  await assertSucceeds(addDoc(sfrs(db('sfrAdd')), sfr({ raisedById: 'uSa' })));
  await assertFails(addDoc(sfrs(db('raiser')), sfr({ raisedById: 'uOther' })));
  await assertFails(addDoc(sfrs(db('raiser')), sfr({ status: 'Completed' })));
  for (const uid of ['assignee', 'sfrModule', 'sfrRequests', ...OUTSIDERS]) {
    const me = { assignee: 'uAssignee', sfrModule: 'uSm', sfrRequests: 'uSr', stranger: 'uX', gone: 'uGone', nodoc: 'uNone' }[uid];
    await assertFails(addDoc(sfrs(db(uid)), sfr({ raisedById: me })));
  }
});

test("the workflow: the current step's assignees move it", async () => {
  const act = (uid, id, extra = {}) => {
    const d = db(uid);
    return runTransaction(d, async (tx) => {
      const ref = doc(d, 'requisitions', id);
      await tx.get(ref);
      tx.update(ref, {
        status: 'In Progress', stage: 'Approval', currentStepId: 'step2', assignees: ['uNext'], deadline: now,
        history: arrayUnion({ action: 'Approve', userId: 'uAssignee', stepName: 'Request Receiving', timestamp: now }), ...extra,
      });
    });
  };
  await assertFails(act('raiser', 'r1'));
  await assertFails(act('sfrViewAll', 'r1'));
  await assertFails(act('assignee', 'r1', { amount: 1 }));
  await assertSucceeds(act('assigneeLegacy', 'r1', { expenseRequestNo: 'EXP-1' }));
  await assertFails(act('assignee', 'r1'));
  await setDocAdmin('requisitions/r1', sfr());
  await assertSucceeds(act('assignee', 'r1'));
  await setDocAdmin('requisitions/r1', sfr());
});

test('correcting it before it is received: whoever sees it in the register', async () => {
  const edit = { projectId: 'P2', departmentId: 'D2', amount: 600, partyName: 'XYZ', description: 'y', date: '2026-10-02' };
  await assertSucceeds(updateDoc(doc(db('raiser'), 'requisitions/r1'), edit));
  await assertSucceeds(updateDoc(doc(db('sfrViewAll'), 'requisitions/r1'), edit));
  await assertFails(updateDoc(doc(db('raiser'), 'requisitions/r1'), { ...edit, status: 'Completed' }));
  await assertFails(updateDoc(doc(db('raiser'), 'requisitions/r1'), { raisedById: 'uOther' }));
  await assertFails(updateDoc(doc(db('sfrViewAll'), 'requisitions/r2'), edit));
  for (const uid of ['sfrModule', 'billing', ...OUTSIDERS]) {
    await assertFails(updateDoc(doc(db(uid), 'requisitions/r1'), edit));
  }
  for (const uid of ['raiser', 'sfrViewAll', 'assignee']) {
    await assertFails(deleteDoc(doc(db(uid), 'requisitions/r1')));
  }
});
