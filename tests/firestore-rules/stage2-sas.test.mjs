// Stage 2, Site Account Statement and Site Fund Request: ledgers and budgets follow project
// membership (siteAccountProjects assignedPersonId / altUserId / viewerId == users-document id) or
// `Site Account Statement.All Projects`, read from userPermissions/{authUid}.
import test, { after, before } from 'node:test';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  collection, count, deleteDoc, doc, getAggregateFromServer, getCountFromServer, getDoc, getDocs, limit,
  orderBy, query, runTransaction, setDoc, sum, updateDoc, addDoc, where, writeBatch,
} from 'firebase/firestore';
import { as, rulesEnv, seed } from './helpers.mjs';

const SAS = 'Site Account Statement';
const perms = (userDocId, p = {}) => ({ v: 1, p, active: true, userDocId, roleNames: [], projectIds: [], departmentIds: [] });

// SAS_IN_CHUNK in src/lib/site-account-statement-scope.ts.
const SAS_IN_CHUNK = 9;
const MANY = Array.from({ length: 12 }, (_, i) => `M${i}`);

let env;
before(async () => {
  env = await rulesEnv();
  const docs = {
    'userPermissions/all': perms('uAll', { [`${SAS}.All Projects`]: ['View'] }),
    'userPermissions/site': perms('uSite'),
    // An email-matched legacy account: signs in under another uid, same users document.
    'userPermissions/legacyAuth': perms('uSite'),
    'userPermissions/viewer': perms('uView'),
    'userPermissions/stranger': perms('uX', { 'Windows Agent.Reports': ['View'] }),
    'userPermissions/expAdd': perms('uAdd', { [`${SAS}.Expenses`]: ['Add', 'View'], [`${SAS}.Payments`]: ['Add'] }),
    'userPermissions/deleter': perms('uDel', { [`${SAS}.Expenses`]: ['Delete'] }),
    'userPermissions/catEdit': perms('uCat', { [`${SAS}.Expense Categories`]: ['Add', 'Delete', 'Edit', 'View'] }),
    'userPermissions/closer': perms('uClose', { [`${SAS}.Month Closure`]: ['Close', 'View'] }),
    'userPermissions/budget': perms('uBud', { [`${SAS}.Budget`]: ['Add', 'Edit', 'View'] }),
    'userPermissions/budgetDel': perms('uBudDel', { [`${SAS}.Monthly Budget`]: ['Delete'] }),
    'userPermissions/verifier': perms('uVer', { [`${SAS}.Budget Allocation`]: ['Verify', 'View'] }),
    'userPermissions/allocDel': perms('uAD', { [`${SAS}.Budget Allocation`]: ['Delete'] }),
    'userPermissions/alerts': perms('uAl', { [`${SAS}.Budget Alerts`]: ['Edit', 'View'] }),
    'userPermissions/fieldCtl': perms('uFc', { [`${SAS}.Field Control`]: ['Edit', 'View'] }),
    'userPermissions/psAdmin': perms('uPs', { [`${SAS}.Project Settings`]: ['Add', 'Delete', 'Edit', 'View'] }),
    'userPermissions/sfrAdmin': perms('uSfr', { 'Site Fund Request.Settings': ['Edit', 'View'] }),
    'userPermissions/gone': { ...perms('uGone'), active: false },
    // `nodoc` has no permissions document at all.

    'siteAccountProjects/P1': { projectName: 'One', assignedPersonId: 'uSite', viewerId: 'uView' },
    'siteAccountProjects/P2': { projectName: 'Two', assignedPersonId: 'uOther', altUserId: 'uSite' },
    'siteAccountProjects/P3': { projectName: 'Three', assignedPersonId: 'uOther', viewerId: 'uSite' },
    'siteAccountProjects/Q': { projectName: 'Other', assignedPersonId: 'uOther', viewerId: 'uBud' },
  };
  for (const id of MANY) {
    docs[`siteAccountProjects/${id}`] = { projectName: id, assignedPersonId: 'uSite' };
    docs[`siteAccountExpenses/e${id}`] = { projectId: id, expenseDate: '2026-05-01', expenseAmount: 1, expenseCategory: 'Fuel' };
  }
  for (const p of ['P1', 'P2', 'P3', 'Q']) {
    docs[`siteAccountExpenses/e${p}`] = { projectId: p, expenseDate: '2026-05-02', expenseAmount: 10, expenseCategory: 'Fuel' };
    docs[`siteAccountPayments/r${p}`] = { projectId: p, receiptDate: '2026-05-02', receivedAmount: 50 };
    docs[`siteAccountBudgets/b${p}`] = { projectId: p, budgetType: 'monthly', period: '2026-05', budgetAmount: 100 };
    docs[`siteAccountCategoryBudgets/c${p}`] = { projectId: p, period: '2026-05', categoryName: 'Fuel', budgetAmount: 5 };
    docs[`siteAccountBudgetApprovals/a${p}`] = { projectId: p, period: '2026-05', fileName: 'x.pdf' };
    docs[`siteAccountBudgetAllocations/al${p}`] = { projectId: p, period: '2026-05', amount: 9, status: 'pending' };
    docs[`siteAccountBudgetAllocations/ok${p}`] = { projectId: p, period: '2026-04', amount: 9, status: 'approved' };
    docs[`siteAccountTenderBudgets/t${p}`] = { projectId: p, tenderAmount: 1000, startMonth: '2026-04', endMonth: '2027-03' };
    docs[`siteAccountBudgetAlertState/${p}_2026-05`] = { projectId: p, period: '2026-05', sentThresholds: [] };
    docs[`siteAccountBudgetAlertConfigs/${p}`] = { projectId: p, enabled: true };
  }
  Object.assign(docs, {
    'siteAccountBudgetAlertConfigs/_module_wide_': { enabled: true },
    'siteAccountCategories/fuel': { name: 'Fuel', isActive: true },
    'siteAccountSettings/fieldControl': { x: 1 },
    'siteAccountSettings/monthClosure': { months: {} },
    'siteFundRequestProjects/row1': { centralProjectId: 'C1', assignedPersonId: 'uSite', status: 'Active' },
    'siteFundRequests/s1': { projectId: 'C1', status: 'In Progress', stage: 'HOD Approval', assignees: ['uSite'], raisedById: 'uView' },
    'siteFundRequests/s2': { projectId: 'C1', status: 'Pending', stage: 'Request Receiving', assignees: ['uOther'], raisedById: 'uView', amount: 5 },
  });
  await seed(env, docs);
});
after(async () => env?.cleanup());

const db = (uid) => as(env, uid);
const col = (uid, name) => collection(db(uid), name);
const ledgerPage = (uid, name, dateField, ids, extra = []) => query(col(uid, name),
  ids.length === 1 ? where('projectId', '==', ids[0]) : where('projectId', 'in', ids),
  ...extra, where(dateField, '>=', '2026-04-01'), where(dateField, '<=', '2027-03-31'),
  orderBy(dateField, 'desc'), limit(51));

test('projects and categories: readable by anyone signed in, written from Settings', async () => {
  for (const uid of ['site', 'stranger', 'nodoc', 'gone']) {
    await assertSucceeds(getDocs(query(col(uid, 'siteAccountProjects'), orderBy('projectName'))));
    await assertSucceeds(getDocs(query(col(uid, 'siteAccountProjects'), where('viewerId', '==', 'uSite'))));
    await assertSucceeds(getDocs(query(col(uid, 'siteAccountCategories'), orderBy('name'))));
  }
  await assertFails(getDocs(col(null, 'siteAccountProjects')));
  await assertSucceeds(addDoc(col('psAdmin', 'siteAccountProjects'), { projectName: 'New' }));
  await assertSucceeds(updateDoc(doc(db('psAdmin'), 'siteAccountProjects/Q'), { status: 'Active' }));
  await assertFails(updateDoc(doc(db('site'), 'siteAccountProjects/P1'), { viewerId: 'uX' }));
  await assertFails(deleteDoc(doc(db('all'), 'siteAccountProjects/Q')));
  await assertSucceeds(addDoc(col('catEdit', 'siteAccountCategories'), { name: 'Tea' }));
  await assertFails(addDoc(col('site', 'siteAccountCategories'), { name: 'Tea' }));
});

test('ledger reads: All Projects reads everything, everyone else only their projects', async () => {
  for (const [name, dateField] of [['siteAccountExpenses', 'expenseDate'], ['siteAccountPayments', 'receiptDate']]) {
    // All Projects: no project filter at all (queries.ts with projectIds null).
    await assertSucceeds(getDocs(query(col('all', name), where(dateField, '>=', '2026-04-01'), orderBy(dateField, 'desc'), limit(5001))));
    await assertSucceeds(getDocs(ledgerPage('site', name, dateField, ['P1'])));
    await assertSucceeds(getDocs(ledgerPage('site', name, dateField, ['P1', 'P2', 'P3'])));
    await assertSucceeds(getDocs(ledgerPage('legacyAuth', name, dateField, ['P1', 'P2', 'P3'])));
    await assertSucceeds(getDocs(ledgerPage('viewer', name, dateField, ['P1'])));
    await assertFails(getDocs(ledgerPage('site', name, dateField, ['P1', 'Q'])));
    await assertFails(getDocs(query(col('site', name))));
    await assertFails(getDocs(ledgerPage('viewer', name, dateField, ['P2'])));
    for (const uid of ['stranger', 'nodoc', 'gone', 'expAdd']) {
      await assertFails(getDocs(ledgerPage(uid, name, dateField, ['P1'])));
    }
    // Aggregates: totals and the cumulative opening balance.
    const scoped = query(col('site', name), where('projectId', 'in', ['P1', 'P2']), where(dateField, '<=', '2026-12-31'));
    await assertSucceeds(getAggregateFromServer(scoped, { total: sum(dateField === 'expenseDate' ? 'expenseAmount' : 'receivedAmount'), rows: count() }));
    await assertSucceeds(getAggregateFromServer(query(col('site', name), where('projectId', '==', 'P1'), where(dateField, '<', '2026-05-01')), { total: sum('x') }));
    await assertFails(getAggregateFromServer(query(col('site', name), where(dateField, '<', '2026-05-01')), { total: sum('x') }));
    // Unindexed fallback: project filter alone.
    await assertSucceeds(getDocs(query(col('site', name), where('projectId', 'in', ['P1', 'P3']))));
    // Month Closure counts the whole year across projects.
    await assertSucceeds(getDocs(query(col('closer', name), where(dateField, '>=', '2026-04-01'), where(dateField, '<=', '2027-03-31'))));
  }
  // The expense table with its category filter.
  await assertSucceeds(getDocs(ledgerPage('site', 'siteAccountExpenses', 'expenseDate', ['P1', 'P2'], [where('expenseCategory', '==', 'Fuel')])));
});

test(`an in-chunk of ${SAS_IN_CHUNK} projects fits the rules' document budget; one more does not`, async () => {
  await assertSucceeds(getDocs(ledgerPage('site', 'siteAccountExpenses', 'expenseDate', MANY.slice(0, SAS_IN_CHUNK))));
  await assertSucceeds(getAggregateFromServer(
    query(col('site', 'siteAccountExpenses'), where('projectId', 'in', MANY.slice(0, SAS_IN_CHUNK))),
    { total: sum('expenseAmount'), rows: count() }));
  await assertFails(getDocs(ledgerPage('site', 'siteAccountExpenses', 'expenseDate', MANY.slice(0, SAS_IN_CHUNK + 1))));
});

test('ledger writes: primary/alt on that project, or Add/Edit, or All Projects', async () => {
  const row = (projectId) => ({ projectId, expenseDate: '2026-05-03', expenseAmount: 4, createdBy: 'uSite' });
  await assertSucceeds(addDoc(col('site', 'siteAccountExpenses'), row('P1')));
  await assertSucceeds(setDoc(doc(db('site'), 'siteAccountExpenses/pre1'), row('P2')));
  await assertFails(addDoc(col('site', 'siteAccountExpenses'), row('P3')));
  await assertFails(addDoc(col('site', 'siteAccountExpenses'), row('Q')));
  await assertFails(addDoc(col('viewer', 'siteAccountExpenses'), row('P1')));
  await assertFails(addDoc(col('stranger', 'siteAccountExpenses'), row('P1')));
  await assertSucceeds(addDoc(col('expAdd', 'siteAccountExpenses'), row('Q')));
  await assertSucceeds(addDoc(col('all', 'siteAccountExpenses'), row('Q')));
  await assertSucceeds(updateDoc(doc(db('site'), 'siteAccountExpenses/eP1'), { attachments: [] }));
  await assertFails(updateDoc(doc(db('site'), 'siteAccountExpenses/eP1'), { projectId: 'Q' }));
  await assertFails(updateDoc(doc(db('site'), 'siteAccountExpenses/eQ'), { expenseAmount: 1 }));
  await assertFails(updateDoc(doc(db('viewer'), 'siteAccountExpenses/eP1'), { expenseAmount: 1 }));
  await assertSucceeds(deleteDoc(doc(db('site'), 'siteAccountExpenses/pre1')));
  await assertFails(deleteDoc(doc(db('viewer'), 'siteAccountExpenses/eP1')));
  await assertSucceeds(deleteDoc(doc(db('deleter'), 'siteAccountExpenses/eM11')));

  await assertSucceeds(addDoc(col('site', 'siteAccountPayments'), { projectId: 'P2', receiptDate: '2026-05-03', receivedAmount: 1 }));
  await assertFails(addDoc(col('site', 'siteAccountPayments'), { projectId: 'P3', receiptDate: '2026-05-03', receivedAmount: 1 }));
  await assertSucceeds(addDoc(col('expAdd', 'siteAccountPayments'), { projectId: 'Q', receiptDate: '2026-05-03', receivedAmount: 1 }));
  await assertFails(deleteDoc(doc(db('deleter'), 'siteAccountPayments/rQ')));
});

test('renaming a category rewrites it on every project, and nothing else', async () => {
  const cat = db('catEdit');
  await assertSucceeds(getDocs(query(collection(cat, 'siteAccountExpenses'), where('expenseCategory', '==', 'Fuel'))));
  await assertSucceeds(getCountFromServer(query(collection(cat, 'siteAccountExpenses'), where('expenseSubCategory', '==', 'Diesel'))));
  await assertSucceeds(getDocs(query(collection(cat, 'siteAccountCategoryBudgets'), where('categoryName', '==', 'Fuel'))));
  await assertSucceeds(getDocs(query(collection(cat, 'siteAccountCategories'), where('parentName', '==', 'Fuel'))));
  const batch = writeBatch(cat);
  for (const id of ['eQ', 'eP1', 'eP2', 'eP3', 'eM0', 'eM1']) batch.update(doc(cat, `siteAccountExpenses/${id}`), { expenseCategory: 'Fuel & Oil' });
  for (const id of ['cQ', 'cP1']) batch.update(doc(cat, `siteAccountCategoryBudgets/${id}`), { categoryName: 'Fuel & Oil' });
  batch.update(doc(cat, 'siteAccountCategories/fuel'), { name: 'Fuel & Oil' });
  await assertSucceeds(batch.commit());
  await assertFails(updateDoc(doc(cat, 'siteAccountExpenses/eQ'), { expenseAmount: 0 }));
  await assertFails(updateDoc(doc(cat, 'siteAccountCategoryBudgets/cQ'), { budgetAmount: 0 }));
  await assertFails(getDocs(query(col('site', 'siteAccountExpenses'), where('expenseCategory', '==', 'Fuel'))));
});

test('budget collections: read by project scope; written by budget grants or the project\'s recorders', async () => {
  for (const name of ['siteAccountBudgets', 'siteAccountCategoryBudgets', 'siteAccountBudgetApprovals',
    'siteAccountBudgetAllocations', 'siteAccountTenderBudgets']) {
    await assertSucceeds(getDocs(col('all', name)));
    await assertSucceeds(getDocs(query(col('site', name), where('projectId', 'in', ['P1', 'P2', 'P3']))));
    await assertSucceeds(getDocs(query(col('viewer', name), where('projectId', '==', 'P1'))));
    await assertFails(getDocs(col('site', name)));
    await assertFails(getDocs(query(col('site', name), where('projectId', 'in', ['P1', 'Q']))));
    // A Budget grant without All Projects sees what the page shows it: its own projects.
    await assertFails(getDocs(col('budget', name)));
    await assertSucceeds(getDocs(query(col('budget', name), where('projectId', '==', 'Q'))));
    await assertFails(getDocs(query(col('stranger', name), where('projectId', '==', 'P1'))));
  }
  // The All-Projects monthly-comparison window, and sas-budget-alerts' lookups as the expense writer.
  await assertSucceeds(getDocs(query(col('all', 'siteAccountBudgets'), where('period', '>=', '2026-01'), where('period', '<=', '2026-12'))));
  await assertSucceeds(getDocs(query(col('site', 'siteAccountBudgets'), where('projectId', '==', 'P1'),
    where('budgetType', '==', 'monthly'), where('period', 'in', ['2026-04', '2026-05']))));
  await assertSucceeds(getDocs(query(col('site', 'siteAccountCategoryBudgets'), where('projectId', '==', 'P1'),
    where('categoryName', '==', 'Fuel'), where('period', '==', '2026-05'))));

  const budget = (projectId) => ({ projectId, budgetType: 'monthly', period: '2026-06', budgetAmount: 1 });
  await assertSucceeds(addDoc(col('site', 'siteAccountBudgets'), budget('P1')));
  await assertFails(addDoc(col('site', 'siteAccountBudgets'), budget('P3')));
  await assertFails(addDoc(col('viewer', 'siteAccountBudgets'), budget('P1')));
  await assertSucceeds(addDoc(col('budget', 'siteAccountBudgets'), budget('P3')));
  await assertSucceeds(updateDoc(doc(db('site'), 'siteAccountBudgets/bP2'), { budgetAmount: 2 }));
  await assertFails(deleteDoc(doc(db('site'), 'siteAccountBudgets/bP1')));
  await assertSucceeds(deleteDoc(doc(db('budgetDel'), 'siteAccountBudgets/bP3')));
  await assertSucceeds(addDoc(col('site', 'siteAccountCategoryBudgets'), { projectId: 'P1', period: '2026-06', categoryName: 'Fuel', budgetAmount: 1 }));
  await assertSucceeds(deleteDoc(doc(db('budget'), 'siteAccountCategoryBudgets/cP3')));
  await assertFails(deleteDoc(doc(db('site'), 'siteAccountCategoryBudgets/cP1')));
  await assertSucceeds(addDoc(col('site', 'siteAccountBudgetApprovals'), { projectId: 'P1', period: '2026-06' }));
  await assertFails(addDoc(col('site', 'siteAccountBudgetApprovals'), { projectId: 'Q', period: '2026-06' }));
  await assertSucceeds(addDoc(col('site', 'siteAccountTenderBudgets'), { projectId: 'P2', tenderAmount: 1 }));
  await assertFails(addDoc(col('viewer', 'siteAccountTenderBudgets'), { projectId: 'P1', tenderAmount: 1 }));
  await assertFails(deleteDoc(doc(db('site'), 'siteAccountTenderBudgets/tP1')));
});

test('allocations: the site records, a role verifies, a verified one is never deleted', async () => {
  const pending = { projectId: 'P1', period: '2026-06', amount: 5, status: 'pending' };
  await assertSucceeds(addDoc(col('site', 'siteAccountBudgetAllocations'), pending));
  await assertFails(addDoc(col('site', 'siteAccountBudgetAllocations'), { ...pending, status: 'approved' }));
  await assertFails(addDoc(col('viewer', 'siteAccountBudgetAllocations'), pending));
  await assertFails(updateDoc(doc(db('site'), 'siteAccountBudgetAllocations/alP1'), { status: 'approved' }));
  await assertSucceeds(updateDoc(doc(db('verifier'), 'siteAccountBudgetAllocations/alQ'), { status: 'approved', verifiedBy: 'uVer' }));
  await assertSucceeds(updateDoc(doc(db('budget'), 'siteAccountBudgetAllocations/alP2'), { approval: { name: 'a.pdf' } }));
  await assertFails(deleteDoc(doc(db('allocDel'), 'siteAccountBudgetAllocations/okP1')));
  await assertSucceeds(deleteDoc(doc(db('allocDel'), 'siteAccountBudgetAllocations/alP3')));
  // Month Closure counts pending instalments across every project; the dashboard reads its own.
  await assertSucceeds(getDocs(query(col('closer', 'siteAccountBudgetAllocations'), where('status', '==', 'pending'))));
  await assertSucceeds(getDocs(query(col('all', 'siteAccountBudgetAllocations'), where('status', '==', 'approved'))));
  await assertFails(getDocs(query(col('site', 'siteAccountBudgetAllocations'), where('status', '==', 'approved'))));
});

test('budget alerts: configs read by every expense writer, state kept per project', async () => {
  await assertSucceeds(getDoc(doc(db('site'), 'siteAccountBudgetAlertConfigs/P1')));
  await assertSucceeds(getDoc(doc(db('site'), 'siteAccountBudgetAlertConfigs/_module_wide_')));
  await assertFails(getDocs(col('site', 'siteAccountBudgetAlertConfigs')));
  await assertSucceeds(getDocs(col('alerts', 'siteAccountBudgetAlertConfigs')));
  await assertSucceeds(setDoc(doc(db('alerts'), 'siteAccountBudgetAlertConfigs/P1'), { enabled: false }, { merge: true }));
  await assertFails(setDoc(doc(db('site'), 'siteAccountBudgetAlertConfigs/P1'), { enabled: false }, { merge: true }));

  const site = db('site');
  await assertSucceeds(runTransaction(site, async (tx) => {
    const ref = doc(site, 'siteAccountBudgetAlertState/P1_2026-07_cat_Fuel');
    await tx.get(ref);
    tx.set(ref, { projectId: 'P1', period: '2026-07', sentThresholds: [80] }, { merge: true });
  }));
  await assertFails(runTransaction(site, async (tx) => {
    const ref = doc(site, 'siteAccountBudgetAlertState/Q_2026-07');
    await tx.get(ref);
    tx.set(ref, { projectId: 'Q' }, { merge: true });
  }));
  await assertSucceeds(getDocs(query(col('site', 'siteAccountBudgetAlertState'), where('projectId', '==', 'P2'))));
  const batch = writeBatch(site);
  batch.delete(doc(site, 'siteAccountBudgetAlertState/P2_2026-05'));
  await assertSucceeds(batch.commit());
  await assertSucceeds(getDocs(query(col('expAdd', 'siteAccountBudgetAlertState'), where('projectId', '==', 'Q'))));
  await assertFails(getDocs(query(col('stranger', 'siteAccountBudgetAlertState'), where('projectId', '==', 'Q'))));
});

test('settings: readable on every page, each document set by its own grant', async () => {
  await assertSucceeds(getDoc(doc(db('viewer'), 'siteAccountSettings/fieldControl')));
  await assertSucceeds(getDoc(doc(db('viewer'), 'siteAccountSettings/monthClosure')));
  await assertSucceeds(setDoc(doc(db('fieldCtl'), 'siteAccountSettings/fieldControl'), { x: 2 }));
  await assertSucceeds(setDoc(doc(db('fieldCtl'), 'siteAccountSettings/sortControl'), { x: 2 }));
  await assertSucceeds(setDoc(doc(db('fieldCtl'), 'siteAccountSettings/dateControl'), { enabled: true }));
  await assertFails(setDoc(doc(db('fieldCtl'), 'siteAccountSettings/monthClosure'), { months: {} }, { merge: true }));
  await assertSucceeds(setDoc(doc(db('closer'), 'siteAccountSettings/monthClosure'), { months: { '2026-04': { closed: true } } }, { merge: true }));
  await assertSucceeds(setDoc(doc(db('psAdmin'), 'siteAccountSettings/monthClosure'), { autoClose: null }, { merge: true }));
  await assertFails(setDoc(doc(db('closer'), 'siteAccountSettings/fieldControl'), { x: 3 }));
  await assertFails(setDoc(doc(db('all'), 'siteAccountSettings/dateControl'), { enabled: false }));
  await assertFails(setDoc(doc(db('fieldCtl'), 'siteAccountSettings/other'), { x: 1 }));
});

test('Site Fund Request: readable as before, raised as yourself, moved on by the step\'s assignees', async () => {
  for (const uid of ['site', 'stranger']) {
    await assertSucceeds(getDocs(col(uid, 'siteFundRequestProjects')));
    await assertSucceeds(getDocs(query(col(uid, 'siteFundRequests'), orderBy('createdAt', 'desc'))));
  }
  await assertSucceeds(getDocs(query(col('site', 'siteFundRequests'), where('assignees', 'array-contains', 'uSite'), limit(100))));
  await assertFails(getDocs(col(null, 'siteFundRequests')));
  await assertSucceeds(updateDoc(doc(db('sfrAdmin'), 'siteFundRequestProjects/row1'), { viewerId: 'uView' }));
  await assertFails(addDoc(col('site', 'siteFundRequestProjects'), { centralProjectId: 'C2', assignedPersonId: 'uSite' }));

  const raised = { projectId: 'C1', amount: 5, status: 'Pending', stage: 'Request Receiving', raisedById: 'uSite', assignees: ['uOther'] };
  await assertSucceeds(addDoc(col('site', 'siteFundRequests'), raised));
  await assertSucceeds(addDoc(col('legacyAuth', 'siteFundRequests'), raised));
  await assertFails(addDoc(col('site', 'siteFundRequests'), { ...raised, raisedById: 'uView' }));
  await assertFails(addDoc(col('site', 'siteFundRequests'), { ...raised, status: 'Completed' }));

  const site = db('site');
  await assertSucceeds(runTransaction(site, async (tx) => {
    const ref = doc(site, 'siteFundRequests/s1');
    await tx.get(ref);
    tx.update(ref, { status: 'In Progress', stage: 'Accounts', assignees: ['uOther'] });
  }));
  await assertFails(updateDoc(doc(db('viewer'), 'siteFundRequests/s1'), { status: 'Completed' }));
  await assertSucceeds(updateDoc(doc(db('viewer'), 'siteFundRequests/s2'), { amount: 7, partyName: 'P', date: '2026-05-01' }));
  await assertFails(updateDoc(doc(db('viewer'), 'siteFundRequests/s2'), { status: 'Completed' }));
  await assertFails(deleteDoc(doc(db('site'), 'siteFundRequests/s2')));
});
