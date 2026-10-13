// Stage 2, Insurance: each collection is read by whoever holds a page that reads it and written by
// the action that page checks (src/lib/permissions.ts "Insurance"); workflow tasks are also read and
// worked by their current assignees (users document ids), read from userPermissions/{authUid}.
import test, { after, before } from 'node:test';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  addDoc, arrayUnion, collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, runTransaction,
  serverTimestamp, setDoc, Timestamp, updateDoc, where, writeBatch,
} from 'firebase/firestore';
import { as, rulesEnv, seed } from './helpers.mjs';

const perms = (userDocId, p = {}) => ({ v: 1, p, active: true, userDocId, roleNames: [], projectIds: [], departmentIds: [] });
const I = (page) => `Insurance.${page}`;
const audit = (who) => ({ updatedAt: serverTimestamp(), updatedBy: who, updatedByName: 'X' });

let env;
before(async () => {
  env = await rulesEnv();
  await seed(env, {
    'userPermissions/pAll': perms('uP', { Insurance: ['View Module'], [I('Personal Insurance')]: ['Add', 'Delete', 'Edit', 'Renew', 'View', 'View History'] }),
    'userPermissions/pRenew': perms('uPR', { [I('Personal Insurance')]: ['Renew', 'View'] }),
    'userPermissions/pEdit': perms('uPE', { [I('Personal Insurance')]: ['Edit', 'View'] }),
    'userPermissions/pView': perms('uPV', { [I('Personal Insurance')]: ['View'] }),
    'userPermissions/premDue': perms('uPD', { [I('Premium Due')]: ['View'] }),
    'userPermissions/jAll': perms('uJ', { [I('Project Insurance')]: ['Add', 'Delete', 'Edit', 'Mark as Not Required', 'Renew', 'View', 'View History'] }),
    'userPermissions/jRenew': perms('uJR', { [I('Project Insurance')]: ['Renew', 'View'] }),
    'userPermissions/jNotReq': perms('uJN', { [I('Project Insurance')]: ['Mark as Not Required', 'View'] }),
    'userPermissions/jView': perms('uJV', { [I('Project Insurance')]: ['View'] }),
    'userPermissions/tasks': perms('uT', { [I('My Tasks')]: ['View'] }),
    'userPermissions/assignee': perms('uA', { 'Windows Agent.Reports': ['View'] }),
    // An email-matched legacy account: another auth uid, the same users document.
    'userPermissions/legacyA': perms('uA'),
    'userPermissions/moduleOnly': perms('uM', { Insurance: ['View Module'] }),
    'userPermissions/reports': perms('uR', { [I('Reports')]: ['View Reports'] }),
    'userPermissions/holders': perms('uH', { [I('Settings.Holders')]: ['Add', 'Delete', 'Edit', 'View'] }),
    'userPermissions/holdersView': perms('uHV', { [I('Settings.Holders')]: ['View'] }),
    'userPermissions/companies': perms('uC', { [I('Settings.Companies')]: ['Add', 'Delete', 'Edit', 'View'] }),
    'userPermissions/cats': perms('uK', { [I('Settings.Categories')]: ['Add', 'Delete', 'Edit', 'View'] }),
    'userPermissions/assets': perms('uS', { [I('Settings.Assets')]: ['Add', 'Delete', 'Edit', 'View'] }),
    'userPermissions/store': perms('uSt', { 'Store & Stock Management': ['View Module'] }),
    'userPermissions/storeSettings': perms('uSS', { 'Store & Stock Management.Settings': ['Manage Properties'] }),
    'userPermissions/stranger': perms('uX', { 'Site Account Statement.Expenses': ['View'] }),
    'userPermissions/gone': { ...perms('uGone'), active: false },
    // `nodoc` has no permissions document at all.

    'insurance_policies/pp1': { policy_no: 'A1', insured_person: 'Asha', insurance_company: 'LIC', policy_category: 'Life', due_date: Timestamp.fromDate(new Date('2026-10-20')), premium: 100 },
    'insurance_policies/pp1/renewals/r1': { policyId: 'pp1', amount: 100 },
    'project_insurance_policies/jp1': { policy_no: 'B1', assetId: 'as1', assetName: 'Tower', insurance_company: 'LIC', policy_category: 'CAR', status: 'Active', insurance_start_date: Timestamp.fromDate(new Date('2025-10-20')), insured_until: Timestamp.fromDate(new Date('2026-10-20')), premium: 5 },
    'project_insurance_policies/jp1/history/h1': { renewedBy: 'uJ', premium: 4 },
    'insuranceTasks/t1': { uniqueCheckId: 'pp1_2026-10-20', policyId: 'pp1', status: 'Pending', assignees: ['uA'], currentStepId: '1', currentStage: 'Check', history: [], policyKind: 'personal' },
    'insuranceTasks/t2': { uniqueCheckId: 'jp1_2026-10-20', policyId: 'jp1', status: 'Pending', assignees: ['uOther'], currentStepId: '1', currentStage: 'Check', history: [], policyKind: 'project' },
    'insuranceCompanies/c1': { name: 'LIC', status: 'Active' },
    'policyCategories/k1': { name: 'Life', status: 'Active' },
    'policyHolders/h1': { name: 'Asha', date_of_birth: null },
    'insuredAssets/as1': { name: 'Tower', type: 'Project', projectId: 'P1' },
    'insuredAssets/as2': { name: 'Office', type: 'Property', location: 'Delhi' },
  });
});
after(async () => env?.cleanup());

// One client per user, so a transaction's references and the transaction share an instance.
const clients = new Map();
const db = (uid) => {
  if (!clients.has(uid)) clients.set(uid, as(env, uid));
  return clients.get(uid);
};
const col = (uid, ...path) => collection(db(uid), ...path);
const NOBODY = ['stranger', 'gone', 'nodoc', null];

test('personal policies: the personal pages, the task sync and the master checks read them; project users do not', async () => {
  for (const uid of ['pAll', 'pRenew', 'pView', 'premDue', 'tasks']) {
    await assertSucceeds(getDocs(col(uid, 'insurance_policies')));
  }
  await assertSucceeds(getDoc(doc(db('pEdit'), 'insurance_policies/pp1')));
  await assertSucceeds(getDocs(col('pView', 'insurance_policies', 'pp1', 'renewals')));
  // Holder rename and the in-use counts before a master is deleted (countPolicyReferences).
  await assertSucceeds(getDocs(query(col('holders', 'insurance_policies'), where('insured_person', '==', 'Asha'))));
  await assertSucceeds(getDocs(query(col('companies', 'insurance_policies'), where('insurance_company', '==', 'LIC'))));
  await assertSucceeds(getDocs(query(col('cats', 'insurance_policies'), where('policy_category', '==', 'Life'))));
  for (const uid of ['jAll', 'assets', 'holdersView', 'moduleOnly', 'reports', 'store', 'assignee', ...NOBODY]) {
    await assertFails(getDocs(col(uid, 'insurance_policies')));
    await assertFails(getDocs(col(uid, 'insurance_policies', 'pp1', 'renewals')));
  }
});

test('personal policies: Add creates, Edit edits and settles, Renew records a premium, Delete deletes', async () => {
  const ref = doc(col('pAll', 'insurance_policies'));
  await assertSucceeds(setDoc(ref, { policy_no: 'N1', createdBy: 'uP' }));
  await assertFails(setDoc(doc(col('pEdit', 'insurance_policies')), { policy_no: 'N2' }));
  await assertSucceeds(updateDoc(doc(db('pEdit'), 'insurance_policies/pp1'), { premium: 120, ...audit('uPE') }));
  // SettlementDialog.
  await assertSucceeds(updateDoc(doc(db('pEdit'), 'insurance_policies/pp1'), { status: 'Surrendered', due_date: null, settlement: { netAmount: 1 }, closed_on: Timestamp.now(), closure_amount: 1, ...audit('uPE') }));
  await assertFails(updateDoc(doc(db('pRenew'), 'insurance_policies/pp1'), { status: 'Lapsed' }));
  await assertFails(updateDoc(doc(db('pView'), 'insurance_policies/pp1'), { premium: 1 }));

  // RenewalDialog: the renewal and the next due date in one transaction.
  const policyRef = doc(db('pRenew'), 'insurance_policies/pp1');
  await assertSucceeds(runTransaction(db('pRenew'), async (tx) => {
    await tx.get(policyRef);
    tx.set(doc(col('pRenew', 'insurance_policies', 'pp1', 'renewals')), { policyId: 'pp1', amount: 100, renewedBy: 'uPR' });
    tx.update(policyRef, { due_date: Timestamp.fromDate(new Date('2027-10-20')), last_renewed_at: Timestamp.now(), last_payment_type: 'NEFT', ...audit('uPR') });
  }));
  await assertFails(runTransaction(db('pRenew'), async (tx) => {
    await tx.get(policyRef);
    tx.update(policyRef, { due_date: null, premium: 1 });
  }));
  // Editing or back-filling a payment: Renew or Edit (canManagePayments).
  await assertSucceeds(updateDoc(doc(db('pEdit'), 'insurance_policies/pp1/renewals/r1'), { amount: 110, ...audit('uPE') }));
  await assertSucceeds(setDoc(doc(col('pRenew', 'insurance_policies', 'pp1', 'renewals')), { policyId: 'pp1', amount: 90 }));
  await assertFails(setDoc(doc(col('pView', 'insurance_policies', 'pp1', 'renewals')), { policyId: 'pp1', amount: 90 }));

  // Holder rename follows onto the policies, and nothing else.
  const batch = writeBatch(db('holders'));
  batch.update(doc(db('holders'), 'insurance_policies/pp1'), { insured_person: 'Asha K' });
  await assertSucceeds(batch.commit());
  await assertFails(updateDoc(doc(db('holders'), 'insurance_policies/pp1'), { insured_person: 'Asha', premium: 0 }));
  await assertFails(updateDoc(doc(db('holdersView'), 'insurance_policies/pp1'), { insured_person: 'Asha' }));

  // Delete: renewals first, then the policy (personal/[policyId]/page.tsx).
  const del = writeBatch(db('pAll'));
  del.delete(doc(db('pAll'), `insurance_policies/${ref.id}/renewals/none`));
  await assertSucceeds(del.commit());
  await assertSucceeds(deleteDoc(ref));
  await assertFails(deleteDoc(doc(db('pEdit'), 'insurance_policies/pp1')));
  await assertFails(deleteDoc(doc(db('pEdit'), 'insurance_policies/pp1/renewals/r1')));
  for (const uid of NOBODY) await assertFails(setDoc(doc(db(uid), 'insurance_policies/x'), { policy_no: 'Z' }));
});

test('project policies: the project pages, the task sync and the master checks read them; personal users do not', async () => {
  for (const uid of ['jAll', 'jView', 'jRenew', 'tasks']) {
    await assertSucceeds(getDocs(col(uid, 'project_insurance_policies')));
    await assertSucceeds(getDocs(col(uid, 'project_insurance_policies', 'jp1', 'history')));
  }
  await assertSucceeds(getDocs(query(col('jView', 'project_insurance_policies'), where('assetId', '==', 'as1'))));
  // Project history page.
  await assertSucceeds(getDocs(query(col('jView', 'project_insurance_policies'), orderBy('insurance_start_date', 'desc'))));
  await assertSucceeds(getDocs(query(col('assets', 'project_insurance_policies'), where('assetId', '==', 'as1'))));
  await assertSucceeds(getDocs(query(col('companies', 'project_insurance_policies'), where('insurance_company', '==', 'LIC'))));
  for (const uid of ['pAll', 'premDue', 'holders', 'moduleOnly', 'reports', 'store', 'assignee', ...NOBODY]) {
    await assertFails(getDocs(col(uid, 'project_insurance_policies')));
  }
});

test('project policies: Add, Edit, Renew, Mark as Not Required and Delete each do their own write', async () => {
  const ref = doc(col('jAll', 'project_insurance_policies'));
  await assertSucceeds(setDoc(ref, { policy_no: 'N1', assetId: 'as1' }));
  await assertFails(setDoc(doc(col('jRenew', 'project_insurance_policies')), { policy_no: 'N2' }));
  await assertSucceeds(updateDoc(doc(db('jAll'), 'project_insurance_policies/jp1'), { premium: 6, ...audit('uJ') }));

  const policyRef = doc(db('jRenew'), 'project_insurance_policies/jp1');
  await assertSucceeds(runTransaction(db('jRenew'), async (tx) => {
    await tx.get(policyRef);
    tx.set(doc(col('jRenew', 'project_insurance_policies', 'jp1', 'history')), { renewedBy: 'uJR', premium: 6 });
    tx.update(policyRef, {
      policy_no: 'B2', insurance_company: 'LIC', premium: 7, sum_insured: 9, insurance_start_date: Timestamp.now(),
      insured_until: Timestamp.now(), tenure_years: 1, tenure_months: 0, status: 'Active', attachments: [], ...audit('uJR'),
    });
  }));
  await assertFails(updateDoc(policyRef, { assetId: 'as2' }));
  await assertFails(setDoc(doc(col('jView', 'project_insurance_policies', 'jp1', 'history')), { premium: 1 }));
  await assertFails(updateDoc(doc(db('jAll'), 'project_insurance_policies/jp1/history/h1'), { premium: 1 }));

  await assertSucceeds(updateDoc(doc(db('jNotReq'), 'project_insurance_policies/jp1'), { status: 'Not Required' }));
  await assertFails(updateDoc(doc(db('jNotReq'), 'project_insurance_policies/jp1'), { status: 'Active' }));
  await assertFails(updateDoc(doc(db('jView'), 'project_insurance_policies/jp1'), { status: 'Not Required' }));

  const del = writeBatch(db('jAll'));
  del.delete(doc(db('jAll'), 'project_insurance_policies/jp1/history/h1'));
  await assertSucceeds(del.commit());
  await assertSucceeds(deleteDoc(ref));
  await assertFails(deleteDoc(doc(db('jRenew'), 'project_insurance_policies/jp1')));
  for (const uid of NOBODY) await assertFails(setDoc(doc(db(uid), 'project_insurance_policies/x'), { policy_no: 'Z' }));
});

test('tasks: My Tasks reads them all; an assignee reads their own, holding nothing (My Work)', async () => {
  await assertSucceeds(getDocs(col('tasks', 'insuranceTasks')));
  // work-dashboard-sources.ts: fetchWhere('insuranceTasks', 'assignees', 'array-contains', user.id), cap 100.
  for (const uid of ['assignee', 'legacyA']) {
    await assertSucceeds(getDocs(query(col(uid, 'insuranceTasks'), where('assignees', 'array-contains', 'uA'), limit(100))));
    await assertSucceeds(getDoc(doc(db(uid), 'insuranceTasks/t1')));
    await assertFails(getDoc(doc(db(uid), 'insuranceTasks/t2')));
    await assertFails(getDocs(col(uid, 'insuranceTasks')));
  }
  await assertFails(getDocs(query(col('assignee', 'insuranceTasks'), where('assignees', 'array-contains', 'uOther'), limit(100))));
  // completeTasksForDue: whoever pays, renews or settles finds the open task by its check id.
  for (const uid of ['pRenew', 'pEdit', 'jRenew']) {
    await assertSucceeds(getDocs(query(col(uid, 'insuranceTasks'), where('uniqueCheckId', '==', 'pp1_2026-10-20'))));
  }
  for (const uid of ['pView', 'jView', 'moduleOnly', 'reports', ...NOBODY]) {
    await assertFails(getDocs(col(uid, 'insuranceTasks')));
    await assertFails(getDocs(query(col(uid, 'insuranceTasks'), where('uniqueCheckId', '==', 'pp1_2026-10-20'))));
  }
  await assertFails(getDocs(query(col(null, 'insuranceTasks'), where('assignees', 'array-contains', 'uA'), limit(100))));
});

test('tasks: the sync raises them; the assignee moves them; a payment closes them', async () => {
  const task = (over = {}) => ({
    uniqueCheckId: 'pp9_2026-11-01', policyId: 'pp9', status: 'Pending', assignees: ['uA'], currentStepId: '1',
    currentStage: 'Check', deadline: Timestamp.now(), history: [], policyKind: 'personal', ...over,
  });
  await assertSucceeds(addDoc(col('tasks', 'insuranceTasks'), task()));
  await assertFails(addDoc(col('tasks', 'insuranceTasks'), task({ assignees: [] })));
  await assertFails(addDoc(col('tasks', 'insuranceTasks'), task({ status: 'Completed' })));
  await assertFails(addDoc(col('pAll', 'insuranceTasks'), task()));
  await assertFails(addDoc(col('assignee', 'insuranceTasks'), task()));

  // my-tasks/page.tsx handleAction: a transaction read then update, as the assignee.
  const log = (userId) => ({ action: 'Approve', comment: '', userId, userName: 'A', timestamp: Timestamp.now(), stepName: 'Check' });
  const ref = doc(db('assignee'), 'insuranceTasks/t1');
  await assertSucceeds(runTransaction(db('assignee'), async (tx) => {
    await tx.get(ref);
    tx.update(ref, { status: 'In Progress', currentStage: 'Approve', currentStepId: '2', assignees: ['uB'], deadline: Timestamp.now(), history: arrayUnion(log('uA')) });
  }));
  // No longer theirs.
  await assertFails(updateDoc(ref, { status: 'Completed', currentStage: 'Completed', currentStepId: null, assignees: [], deadline: null, history: arrayUnion(log('uA')) }));
  // Not the assignee, and no rewriting of anything else.
  await assertFails(updateDoc(doc(db('tasks'), 'insuranceTasks/t2'), { status: 'Rejected', currentStage: 'Rejected', currentStepId: null, assignees: [], deadline: null, history: arrayUnion(log('uT')) }));
  await seed(env, { 'insuranceTasks/t3': task({ uniqueCheckId: 'pp1_2026-10-20' }) });
  await assertFails(updateDoc(doc(db('assignee'), 'insuranceTasks/t3'), { policyId: 'other', history: arrayUnion(log('uA')) }));
  await assertFails(updateDoc(doc(db('assignee'), 'insuranceTasks/t3'), { status: 'Completed', history: [] }));

  // completeTasksForDue.
  const close = (uid) => ({ status: 'Completed', currentStage: 'Completed', currentStepId: null, assignees: [], deadline: null, history: arrayUnion(log(uid)) });
  await assertFails(updateDoc(doc(db('pView'), 'insuranceTasks/t3'), close('uPV')));
  await assertFails(updateDoc(doc(db('pRenew'), 'insuranceTasks/t3'), { ...close('uPR'), status: 'Rejected' }));
  await assertSucceeds(updateDoc(doc(db('pRenew'), 'insuranceTasks/t3'), close('uPR')));
  await assertSucceeds(updateDoc(doc(db('jRenew'), 'insuranceTasks/t2'), close('uJR')));
  await assertFails(deleteDoc(doc(db('pAll'), 'insuranceTasks/t2')));
});

test('companies and categories: anyone in the module reads; their settings page writes', async () => {
  for (const uid of ['pAll', 'jRenew', 'moduleOnly', 'reports', 'companies', 'cats']) {
    await assertSucceeds(getDocs(query(col(uid, 'insuranceCompanies'), where('status', '==', 'Active'))));
    await assertSucceeds(getDocs(query(col(uid, 'policyCategories'), where('status', '==', 'Active'))));
  }
  for (const uid of ['store', 'assignee', ...NOBODY]) {
    await assertFails(getDocs(col(uid, 'insuranceCompanies')));
    await assertFails(getDocs(col(uid, 'policyCategories')));
  }
  for (const [uid, name, id] of [['companies', 'insuranceCompanies', 'c1'], ['cats', 'policyCategories', 'k1']]) {
    const added = await addDoc(col(uid, name), { name: 'New', status: 'Active' });
    await assertSucceeds(updateDoc(doc(db(uid), `${name}/${id}`), { status: 'Inactive' }));
    await assertSucceeds(deleteDoc(added));
    await assertFails(addDoc(col('pAll', name), { name: 'X' }));
    await assertFails(updateDoc(doc(db('jAll'), `${name}/${id}`), { status: 'Active' }));
  }
});

test('holders: the holders page and the personal policy form read them', async () => {
  for (const uid of ['holders', 'holdersView', 'pAll', 'pView']) await assertSucceeds(getDocs(col(uid, 'policyHolders')));
  for (const uid of ['jAll', 'tasks', 'moduleOnly', 'premDue', ...NOBODY]) await assertFails(getDocs(col(uid, 'policyHolders')));
  const added = await addDoc(col('holders', 'policyHolders'), { name: 'Ravi', date_of_birth: null });
  await assertSucceeds(updateDoc(doc(db('holders'), 'policyHolders/h1'), { name: 'Asha K' }));
  await assertSucceeds(deleteDoc(added));
  await assertFails(addDoc(col('holdersView', 'policyHolders'), { name: 'X' }));
  await assertFails(updateDoc(doc(db('pAll'), 'policyHolders/h1'), { name: 'Y' }));
});

test('insured assets: project insurance, the sync and Settings; Store & Stock lists the properties', async () => {
  for (const uid of ['assets', 'jView', 'tasks']) {
    await assertSucceeds(getDocs(col(uid, 'insuredAssets')));
    await assertSucceeds(getDoc(doc(db(uid), 'insuredAssets/as1')));
  }
  for (const uid of ['store', 'storeSettings']) {
    await assertSucceeds(getDocs(query(col(uid, 'insuredAssets'), where('type', '==', 'Property'))));
    await assertFails(getDocs(col(uid, 'insuredAssets')));
    await assertFails(getDoc(doc(db(uid), 'insuredAssets/as1')));
  }
  for (const uid of ['pAll', 'moduleOnly', 'holders', 'assignee', ...NOBODY]) {
    await assertFails(getDocs(col(uid, 'insuredAssets')));
    await assertFails(getDocs(query(col(uid, 'insuredAssets'), where('type', '==', 'Property'))));
  }
  const added = await addDoc(col('assets', 'insuredAssets'), { name: 'Site', type: 'Project', projectId: 'P2' });
  await assertSucceeds(updateDoc(doc(db('assets'), 'insuredAssets/as2'), { location: 'Noida' }));
  await assertSucceeds(deleteDoc(added));
  // Inventory switches a property's stock on through api/inventory (Admin SDK), not from here.
  await assertFails(updateDoc(doc(db('storeSettings'), 'insuredAssets/as2'), { inventoryManagementRequired: true }));
  await assertFails(addDoc(col('jAll', 'insuredAssets'), { name: 'X', type: 'Project' }));
});
