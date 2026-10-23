// Stage 2, Expenses: expense requests, the department serial series, account heads and the module's
// settings documents. Authority is the permission map (`Expenses.<Page>`, department-scoped as
// `Expenses.Departments.<id>` / `Expenses.Settings.<id>`) or being named in Settings › User Roles
// (`expensesSettings/user-roles`, src/lib/expenses-roles.ts), read from userPermissions/{authUid}.
// Query shapes are the screens' own (src/app/(protected)/expenses, src/components/expenses) and
// the other modules' that read expense requests (Daily Requisition, Site Fund Request, Loan).
import test, { after, before } from 'node:test';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  addDoc, collection, deleteDoc, deleteField, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, setDoc,
  updateDoc, where, writeBatch,
} from 'firebase/firestore';
import { as, rulesEnv, seed } from './helpers.mjs';

const perms = (userDocId, p = {}, roleNames = []) => ({ v: 1, p, active: true, userDocId, roleNames, projectIds: [], departmentIds: [] });

const request = (extra) => ({
  requestNo: 'ACC/0001', departmentId: 'D1', projectId: 'P1', amount: 500, headOfAccount: 'Admin',
  subHeadOfAccount: 'Stationery', partyName: 'Acme', description: 'Paper', remarks: '', generatedByDepartment: 'Accounts',
  generatedByUser: 'Raiser', generatedByUserId: 'uRaise', receptionNo: '', receptionDate: '', createdAt: '2026-10-01T10:00:00.000Z',
  gstRegistrationId: '', ...extra,
});

const pair = (primary = [], alternates = []) => ({ primary, alternates });
const assignment = (extra) => ({
  mode: 'roles-only', type: 'users', users: pair(), roles: pair(), byDepartment: {}, bands: [], ...extra,
});

let env;
before(async () => {
  env = await rulesEnv();
  await seed(env, {
    'userPermissions/deptView': perms('uDV', { 'Expenses.Departments.D1': ['View'] }),
    'userPermissions/raiser': perms('uRaise', { 'Expenses.Departments.D1': ['Create', 'View'] }),
    // Unscoped Create: every department.
    'userPermissions/raiserAll': perms('uRaiseAll', { 'Expenses.Departments': ['Create', 'View'] }),
    'userPermissions/editor': perms('uEdit', { 'Expenses.Departments.D1': ['Edit', 'View'] }),
    'userPermissions/viewAll': perms('uVA', { 'Expenses.Expense Requests': ['View All'] }),
    'userPermissions/moduleOnly': perms('uMod', { Expenses: ['View Module'] }),
    'userPermissions/reports': perms('uRep', { 'Expenses.Reports': ['View'] }),
    'userPermissions/serials': perms('uSer', { 'Expenses.Settings': ['View'], 'Expenses.Settings.D1': ['Edit Serial Nos'] }),
    'userPermissions/serialsAll': perms('uSerA', { 'Expenses.Settings': ['Edit Serial Nos', 'View'] }),
    'userPermissions/accounts': perms('uAcc', { 'Expenses.Settings': ['Manage Accounts', 'View'] }),
    'userPermissions/fieldControl': perms('uFc', { 'Expenses.Field Control': ['Edit', 'View'] }),
    'userPermissions/fieldView': perms('uFv', { 'Expenses.Field Control': ['View'] }),
    'userPermissions/gst': perms('uGst', { 'Expenses.GST Registrations': ['Edit', 'View'] }),
    'userPermissions/userRoles': perms('uUr', { 'Expenses.User Roles': ['Edit', 'View'] }),
    // Named in User Roles and holding nothing in the module.
    'userPermissions/bandLow': perms('uBandLow'),
    'userPermissions/bandHigh': perms('uBandHigh'),
    'userPermissions/deptAssignee': perms('uDeptA'),
    'userPermissions/editAlt': perms('uEditAlt', { 'Expenses.Departments.D1': ['View'] }),
    'userPermissions/roleHolder': perms('uRole', { 'Expenses.Departments.D1': ['View'] }, ['Accountant']),
    'userPermissions/accAssignee': perms('uAccA'),
    'userPermissions/gstAssignee': perms('uGstA'),
    'userPermissions/rolesOnly': perms('uRolesOnly'),
    // An email-matched legacy account: another auth uid, the same users document.
    'userPermissions/legacyRaiser': perms('uRaise', { 'Expenses.Departments.D1': ['Create', 'View'] }),
    // Other modules' readers.
    'userPermissions/dr': perms('uDr', { 'Daily Requisition.Entry Sheet': ['Add', 'View'] }),
    'userPermissions/drStep': perms('uDrS', { 'Daily Requisition.Verification': ['Verify', 'View'] }),
    'userPermissions/sfr': perms('uSfr', { 'Site Fund Request.Requests': ['View'] }),
    'userPermissions/sfr2': perms('uSfr2', { 'Site Fund Requisition 2.Site Fund Summary': ['View'] }),
    'userPermissions/loan': perms('uLoan', { 'Loan.Dashboard': ['View'] }),
    // Not readers: names that merely contain "Expenses" or another module's prefix.
    'userPermissions/bank': perms('uBank', { 'Bank Balance.Expenses': ['Add', 'View'] }),
    'userPermissions/tour': perms('uTour', { 'Tour, Travel & Expense.Expenses': ['View'] }),
    'userPermissions/loanLike': perms('uLL', { 'Loans Desk.Reports': ['View'] }),
    'userPermissions/stranger': perms('uX', { 'HR & Recruitment': ['View Module'] }),
    // On a Site Fund Request project-access row, which no permission records: why reads stay wide.
    'userPermissions/sfrMember': perms('uSfrM'),
    'userPermissions/gone': { ...perms('uGone'), active: false },
    // `nodoc` has no permissions document at all.

    'roles/roleAcc': { name: 'Accountant' },
    'expensesSettings/user-roles': {
      actions: {
        'raise-request': assignment({
          mode: 'assigned-too', type: 'amount',
          bands: [
            { id: 'b1', from: null, to: 1000, primary: ['uBandLow'], alternates: [] },
            { id: 'b2', from: 1001, to: null, primary: ['uBandHigh'], alternates: [] },
          ],
        }),
        'import-requests': assignment({ mode: 'assigned-too', type: 'department', byDepartment: { D2: pair(['uDeptA']) } }),
        'edit-request': assignment({ mode: 'assigned-only', type: 'roles', roles: pair(['roleAcc'], ['uEditAlt']) }),
        'manage-accounts': assignment({ mode: 'assigned-too', users: pair(['uAccA']) }),
        'gst-registrations': assignment({ mode: 'assigned-too', users: pair([], ['uGstA']) }),
        // Recorded for reference only: names nobody with authority.
        'view-reports': assignment({ users: pair(['uRolesOnly']) }),
        'manage-serials': assignment({ users: pair(['uRolesOnly']) }),
      },
    },
    'expensesSettings/module-config': { fields: {}, data: { gstTdsCapture: true } },
    'expensesSettings/gst-registrations': { registrations: [{ id: 'g1', gstin: '18AAAAA0000A1Z5' }] },

    'departmentSerialConfigs/D1': { prefix: 'ACC/', format: '', suffix: '', startingIndex: 2 },
    'departmentSerialConfigs/D2': { prefix: 'PUR/', format: '', suffix: '', startingIndex: 7 },
    'accountHeads/H1': { name: 'Admin' },
    'subAccountHeads/S1': { name: 'Stationery', headId: 'H1' },

    'expenseRequests/E1': request(),
    'expenseRequests/E2': request({ requestNo: 'ACC/0002', amount: 5000 }),
    'expenseRequests/E3': request({ requestNo: 'PUR/0006', departmentId: 'D2', generatedByUserId: 'uOther' }),
    'expenseRequests/E4': request({ requestNo: 'ACC/0003', receptionNo: 'DR/0009', receptionDate: '2026-10-02' }),
  });
});
after(async () => env?.cleanup());

const db = (uid) => as(env, uid);
const OUTSIDERS = ['bank', 'tour', 'loanLike', 'stranger', 'sfrMember', 'rolesOnly', 'gone', 'nodoc'];
const requests = (fs) => collection(fs, 'expenseRequests');

/*
 * Requests are read by any signed-in user until Site Fund Request's registers survive a refusal;
 * EXP_READS=narrow runs these against the second step, where only `expRequestReader()` reads them.
 */
const NARROW = process.env.EXP_READS === 'narrow';
const outsiderReads = (promise) => (NARROW ? assertFails(promise) : assertSucceeds(promise));

/* ── reading the register ── */

test('requests: the module, Daily Requisition, Site Fund Request/Requisition, Loan and named people read the register whole', async () => {
  for (const uid of [
    'deptView', 'raiser', 'raiserAll', 'editor', 'viewAll', 'moduleOnly', 'reports', 'serials', 'fieldView',
    'bandLow', 'bandHigh', 'editAlt', 'dr', 'drStep', 'sfr', 'sfr2', 'loan', 'legacyRaiser',
  ]) {
    await assertSucceeds(getDocs(requests(db(uid))));
  }
  for (const uid of OUTSIDERS) await outsiderReads(getDocs(requests(db(uid))));
  await assertFails(getDocs(requests(db(null))));
});

test('requests: every narrower shape the screens use', async () => {
  // Department register; reports' `departmentId in` chunks.
  await assertSucceeds(getDocs(query(requests(db('deptView')), where('departmentId', '==', 'D1'))));
  await assertSucceeds(getDocs(query(requests(db('reports')), where('departmentId', 'in', ['D1', 'D2']))));
  // Daily Requisition: by DEP No, DEP No + Reception No, `requestNo in` chunks (import, print).
  await assertSucceeds(getDocs(query(requests(db('drStep')), where('requestNo', '==', 'ACC/0001'))));
  await assertSucceeds(getDocs(query(requests(db('dr')), where('requestNo', '==', 'ACC/0003'), where('receptionNo', '==', 'DR/0009'))));
  await assertSucceeds(getDocs(query(requests(db('dr')), where('requestNo', 'in', ['ACC/0001', 'ACC/0002', 'PUR/0006']))));
  await assertSucceeds(getDoc(doc(db('dr'), 'expenseRequests/E1')));
  await assertSucceeds(getDoc(doc(db('loan'), 'expenseRequests/E3')));
  for (const uid of OUTSIDERS) {
    await outsiderReads(getDocs(query(requests(db(uid)), where('requestNo', '==', 'ACC/0001'))));
    await outsiderReads(getDoc(doc(db(uid), 'expenseRequests/E1')));
  }
  await assertFails(getDoc(doc(db(null), 'expenseRequests/E1')));
});

/* ── raising ── */

/** The create form: the request and the serial number it takes, in one transaction. */
const raise = (uid, data, departmentId = data.departmentId) => {
  const fs = db(uid);
  return runTransaction(fs, async (tx) => {
    const configRef = doc(fs, 'departmentSerialConfigs', departmentId);
    const config = await tx.get(configRef);
    const index = config.data().startingIndex;
    tx.update(configRef, { startingIndex: index + 1 });
    tx.set(doc(requests(fs)), { ...data, requestNo: `X/${index}` });
  });
};

test('raise: Create on the department (scoped or unscoped), as yourself', async () => {
  await assertSucceeds(raise('raiser', request()));
  await assertSucceeds(raise('legacyRaiser', request()));
  await assertSucceeds(raise('raiserAll', request({ departmentId: 'D2', generatedByUserId: 'uRaiseAll' })));
  // Another department, someone else's name, no department, or no Create at all.
  await assertFails(raise('raiser', request({ departmentId: 'D2' })));
  await assertFails(raise('raiser', request({ generatedByUserId: 'uSomeoneElse' })));
  await assertFails(addDoc(requests(db('raiser')), request({ departmentId: '' })));
  for (const uid of ['deptView', 'viewAll', 'editor', 'moduleOnly', ...OUTSIDERS]) {
    await assertFails(raise(uid, request({ generatedByUserId: `u-${uid}` })));
  }
});

test('raise: an amount-banded assignment lets its people raise inside their band only', async () => {
  await assertSucceeds(raise('bandLow', request({ amount: 1000, generatedByUserId: 'uBandLow' })));
  await assertFails(raise('bandLow', request({ amount: 1500, generatedByUserId: 'uBandLow' })));
  await assertSucceeds(raise('bandHigh', request({ departmentId: 'D2', amount: 1500, generatedByUserId: 'uBandHigh' })));
  await assertFails(raise('bandHigh', request({ amount: 900, generatedByUserId: 'uBandHigh' })));
  // A reference-only assignment names nobody with authority.
  await assertFails(raise('rolesOnly', request({ generatedByUserId: 'uRolesOnly' })));
});

test('raise: the counter only moves forward, and only for someone raising in that department', async () => {
  const ref = (uid, id) => doc(db(uid), 'departmentSerialConfigs', id);
  await assertFails(updateDoc(ref('raiser', 'D1'), { startingIndex: 1 }));
  await assertFails(updateDoc(ref('raiser', 'D1'), { prefix: 'HACK/' }));
  await assertFails(updateDoc(ref('raiser', 'D2'), { startingIndex: 999 }));
  await assertFails(updateDoc(ref('deptView', 'D1'), { startingIndex: 999 }));
});

/** The register's import: the block of numbers in one transaction, then the rows in batches. */
const importRows = async (uid, departmentId, me, count = 2) => {
  const fs = db(uid);
  const configRef = doc(fs, 'departmentSerialConfigs', departmentId);
  const first = await runTransaction(fs, async (tx) => {
    const index = (await tx.get(configRef)).data().startingIndex;
    tx.update(configRef, { startingIndex: index + count });
    return index;
  });
  const batch = writeBatch(fs);
  for (let i = 0; i < count; i++) {
    batch.set(doc(requests(fs)), request({
      requestNo: `IMP/${first + i}`, departmentId, generatedByUserId: me, receptionNo: i ? 'DR/OLD' : '',
    }));
  }
  await batch.commit();
};

test('import: Create on the department, or the by-department assignment for it', async () => {
  await assertSucceeds(importRows('raiser', 'D1', 'uRaise'));
  await assertSucceeds(importRows('deptAssignee', 'D2', 'uDeptA'));
  await assertFails(importRows('deptAssignee', 'D1', 'uDeptA'));
  await assertFails(importRows('editor', 'D1', 'uEdit'));
});

/* ── editing ── */

test('edit: Edit on the department changes the request, never its department, number or reception', async () => {
  const fs = db('editor');
  await assertSucceeds(runTransaction(fs, async (tx) => {
    const ref = doc(fs, 'expenseRequests/E1');
    await tx.get(ref);
    tx.update(ref, { amount: 750, partyName: 'Acme Ltd', statutory: { taxableAmount: 750, netPayable: 700 } });
  }));
  // The edit carries New Request's GST & TDS section, registration included.
  await assertSucceeds(updateDoc(doc(fs, 'expenseRequests/E1'), { statutory: deleteField(), gstRegistrationId: 'R2' }));
  await assertSucceeds(updateDoc(doc(fs, 'expenseRequests/E1'), { remarks: 'checked', description: 'A4 paper' }));
  for (const change of [{ departmentId: 'D2' }, { requestNo: 'ACC/9999' }, { receptionNo: 'DR/1' }, { generatedByUserId: 'uEdit' }]) {
    await assertFails(updateDoc(doc(fs, 'expenseRequests/E1'), change));
  }
  await assertFails(updateDoc(doc(fs, 'expenseRequests/E3'), { remarks: 'not my department' }));
  for (const uid of ['deptView', 'raiser', 'viewAll', 'dr', ...OUTSIDERS]) {
    await assertFails(updateDoc(doc(db(uid), 'expenseRequests/E1'), { remarks: uid }));
  }
});

test('edit: a by-role assignment works for the role (by its document id) and its named alternative', async () => {
  await assertSucceeds(updateDoc(doc(db('roleHolder'), 'expenseRequests/E2'), { remarks: 'by role' }));
  await assertSucceeds(updateDoc(doc(db('editAlt'), 'expenseRequests/E3'), { remarks: 'alternative' }));
  await assertFails(updateDoc(doc(db('roleHolder'), 'expenseRequests/E2'), { departmentId: 'D2' }));
});

/* ── Daily Requisition's reception link ── */

test('receive: Daily Requisition links, releases and relinks the reception number, and nothing else', async () => {
  const fs = db('dr');
  const batch = writeBatch(fs);
  batch.set(doc(collection(fs, 'dailyRequisitions')), { receptionNo: 'DR/0010', depNo: 'ACC/0002', status: 'Pending' });
  batch.update(doc(fs, 'expenseRequests/E2'), { receptionNo: 'DR/0010', receptionDate: '2026-10-03' });
  await assertSucceeds(batch.commit());
  // Release (Cancel) and restore from a step page, inside its transaction.
  const step = db('drStep');
  await assertSucceeds(runTransaction(step, async (tx) => {
    const ref = doc(step, 'expenseRequests/E4');
    await tx.get(ref);
    tx.update(ref, { receptionNo: '', receptionDate: '' });
  }));
  await assertSucceeds(updateDoc(doc(step, 'expenseRequests/E4'), { receptionNo: 'DR/0009', receptionDate: '2026-10-02' }));
  await assertFails(updateDoc(doc(fs, 'expenseRequests/E2'), { receptionNo: 'DR/0011', amount: 1 }));
  for (const uid of ['raiser', 'editor', 'viewAll', 'sfr', 'loan', 'bank', 'stranger']) {
    await assertFails(updateDoc(doc(db(uid), 'expenseRequests/E2'), { receptionNo: 'DR/0012', receptionDate: '2026-10-04' }));
  }
});

test('requests are never deleted from the browser', async () => {
  for (const uid of ['raiserAll', 'editor', 'viewAll', 'dr']) await assertFails(deleteDoc(doc(db(uid), 'expenseRequests/E3')));
});

/* ── the serial series ── */

test('serials: any signed-in user reads a department series (Loan, Site Fund Request preview it)', async () => {
  for (const uid of ['raiser', 'serials', 'loan', 'sfr', 'stranger', 'nodoc']) {
    await assertSucceeds(getDoc(doc(db(uid), 'departmentSerialConfigs/D1')));
  }
  await assertSucceeds(getDoc(doc(db('serials'), 'departmentSerialConfigs/none')));
  await assertFails(getDoc(doc(db(null), 'departmentSerialConfigs/D1')));
  await assertFails(getDocs(collection(db('serials'), 'departmentSerialConfigs')));
});

test('serials: Edit Serial Nos for the department sets its series', async () => {
  const fs = db('serials');
  await assertSucceeds(setDoc(doc(fs, 'departmentSerialConfigs/D1'), { prefix: 'AC/', format: '26-', suffix: '', startingIndex: 40 }));
  // Rewinding is the administrator's to do.
  await assertSucceeds(setDoc(doc(fs, 'departmentSerialConfigs/D1'), { prefix: 'AC/', format: '26-', suffix: '', startingIndex: 30 }));
  await assertFails(setDoc(doc(fs, 'departmentSerialConfigs/D9'), { prefix: 'NEW/', format: '', suffix: '', startingIndex: 1 }));
  // Unscoped Edit Serial Nos sets any department's, a new one included.
  await assertSucceeds(setDoc(doc(db('serialsAll'), 'departmentSerialConfigs/D9'), { prefix: 'NEW/', format: '', suffix: '', startingIndex: 1 }));
  await assertFails(setDoc(doc(fs, 'departmentSerialConfigs/D1'), { prefix: 'AC/', format: '', suffix: '', startingIndex: 0 }));
  await assertFails(setDoc(doc(fs, 'departmentSerialConfigs/D2'), { prefix: 'X/', format: '', suffix: '', startingIndex: 1 }));
  for (const uid of ['raiser', 'accounts', 'rolesOnly', 'stranger']) {
    await assertFails(setDoc(doc(db(uid), 'departmentSerialConfigs/D1'), { prefix: 'X/', format: '', suffix: '', startingIndex: 1 }));
  }
});

/* ── account heads ── */

test('heads: any signed-in user reads them (pickers in Loan, Recurring Payments, Site Fund Request)', async () => {
  for (const uid of ['raiser', 'loan', 'sfr', 'stranger', 'rolesOnly', 'nodoc']) {
    await assertSucceeds(getDocs(collection(db(uid), 'accountHeads')));
    await assertSucceeds(getDocs(collection(db(uid), 'subAccountHeads')));
  }
  await assertFails(getDocs(collection(db(null), 'accountHeads')));
});

test('heads: Manage Accounts, or its assignee, keeps the list', async () => {
  for (const uid of ['accounts', 'accAssignee']) {
    const fs = db(uid);
    const head = await assertSucceeds(addDoc(collection(fs, 'accountHeads'), { name: `Travel ${uid}` }));
    const sub = await assertSucceeds(addDoc(collection(fs, 'subAccountHeads'), { name: 'Fuel', headId: head.id }));
    await assertSucceeds(updateDoc(sub, { name: 'Diesel' }));
    await assertSucceeds(deleteDoc(sub));
    // Load defaults: a batch of heads and their sub-heads.
    const batch = writeBatch(fs);
    const h = doc(collection(fs, 'accountHeads'));
    batch.set(h, { name: 'Seeded' });
    batch.set(doc(collection(fs, 'subAccountHeads')), { name: 'Seeded sub', headId: h.id });
    await assertSucceeds(batch.commit());
  }
  for (const uid of ['raiserAll', 'serials', 'fieldControl', 'rolesOnly', 'stranger']) {
    await assertFails(addDoc(collection(db(uid), 'accountHeads'), { name: 'X' }));
    await assertFails(updateDoc(doc(db(uid), 'subAccountHeads/S1'), { name: 'X' }));
    await assertFails(deleteDoc(doc(db(uid), 'accountHeads/H1')));
  }
});

/* ── settings documents ── */

test('settings: every signed-in user reads the three documents (Daily Requisition reads the GSTINs)', async () => {
  for (const uid of ['raiser', 'dr', 'stranger', 'nodoc']) {
    for (const id of ['module-config', 'user-roles', 'gst-registrations']) {
      await assertSucceeds(getDoc(doc(db(uid), 'expensesSettings', id)));
    }
  }
  await assertFails(getDoc(doc(db(null), 'expensesSettings/module-config')));
});

test('settings: Field / Data Control writes the module configuration, stamped as the writer', async () => {
  const save = (uid, me) => {
    const fs = db(uid);
    return runTransaction(fs, async (tx) => {
      const ref = doc(fs, 'expensesSettings/module-config');
      await tx.get(ref);
      tx.set(ref, {
        fields: { partyName: { visible: true } }, updatedAt: serverTimestamp(), updatedBy: me, updatedByName: uid,
        stamps: { fields: { updatedAt: serverTimestamp(), updatedBy: me, updatedByName: uid } },
      }, { merge: true });
    });
  };
  await assertSucceeds(save('fieldControl', 'uFc'));
  await assertSucceeds(save('accounts', 'uAcc'));
  await assertSucceeds(save('serialsAll', 'uSerA'));
  await assertFails(save('fieldControl', 'uSomeoneElse'));
  // Edit Serial Nos for one department is not the page-wide grant the fallback reads.
  for (const [uid, me] of [['serials', 'uSer'], ['fieldView', 'uFv'], ['raiser', 'uRaise'], ['gst', 'uGst'], ['stranger', 'uX']]) {
    await assertFails(save(uid, me));
  }
});

test('settings: GST registrations by their Edit, Manage Accounts or the assignee; User Roles by its own Edit only', async () => {
  const gst = (uid, me) => setDoc(doc(db(uid), 'expensesSettings/gst-registrations'),
    { registrations: [], updatedAt: serverTimestamp(), updatedById: me, updatedByName: uid });
  await assertSucceeds(gst('gst', 'uGst'));
  await assertSucceeds(gst('accounts', 'uAcc'));
  await assertSucceeds(gst('gstAssignee', 'uGstA'));
  await assertFails(gst('gst', 'uAcc'));
  await assertFails(gst('fieldControl', 'uFc'));

  const roles = (uid, me) => setDoc(doc(db(uid), 'expensesSettings/user-roles'),
    { actions: {}, updatedAt: serverTimestamp(), updatedById: me, updatedByName: uid });
  // Being named elsewhere in User Roles is no right to rewrite it.
  for (const [uid, me] of [['accAssignee', 'uAccA'], ['gstAssignee', 'uGstA'], ['gst', 'uGst'], ['raiserAll', 'uRaiseAll']]) {
    await assertFails(roles(uid, me));
  }
  await assertFails(setDoc(doc(db('userRoles'), 'expensesSettings/other'), { updatedById: 'uUr' }));
  // Last: this rewrites the assignments the other tests rely on.
  await assertSucceeds(roles('userRoles', 'uUr'));
});
