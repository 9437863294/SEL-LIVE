// Stage 1: server-only collections are closed to browsers, browser-read-only collections cannot be
// written, cross-project searches still work, and everything else is unchanged for signed-in users.
import test, { after, before } from 'node:test';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { as, rulesEnv, seed } from './helpers.mjs';

let env;
before(async () => {
  env = await rulesEnv();
  await seed(env, {
    'employeeSensitive/e1': { pan: 'ABCDE1234F' },
    'mailHubCredentials/m1': { sealed: 'x' },
    'mailHubAccounts/a1/folders/f1': { name: 'Inbox' },
    'officeHubGoogleConnections/u1': { envelope: 'x' },
    'billTrackingBills/b1': { amount: 1 },
    'userPermissions/u1': { p: { 'Settings': ['View'] } },
    'userPermissions/u2': { p: {} },
    'windowsSessions/s1': { userId: 'u1' },
    'categories/c1': { name: 'Fuel' },
    'inventoryItems/i1': { name: 'Cement' },
    'projects/p1': { name: 'Tower A' },
    'projects/p1/jmcEntries/j1': { status: 'Pending' },
    'projects/p1/indents/i1': { status: 'Pending' },
    'projects/p1/bills/b1': { amount: 10 },
    'paymentObligations/o1': { organizationId: 'default' },
    'paymentObligations/o1/transactions/t1': { amount: 5 },
    'siteAccountExpenses/x1': { projectId: 'p1' },
  });
});
after(async () => env?.cleanup());

const signedIn = () => as(env, 'u1');

test('server-only collections refuse a signed-in browser, read and write', async () => {
  for (const path of ['employeeSensitive/e1', 'mailHubCredentials/m1', 'officeHubGoogleConnections/u1', 'billTrackingBills/b1']) {
    await assertFails(signedIn().doc(path).get());
    await assertFails(signedIn().doc(path).set({ x: 1 }));
  }
  await assertFails(signedIn().collection('employeeSensitive').get());
  await assertFails(signedIn().collection('mailHubThreads').limit(1).get());
});

test("a closed collection's subcollections are closed with it", async () => {
  await assertFails(signedIn().doc('mailHubAccounts/a1/folders/f1').get());
  await assertFails(signedIn().collection('mailHubAccounts/a1/folders').get());
});

test('a person can read only their own permissions document, and write none', async () => {
  await assertSucceeds(signedIn().doc('userPermissions/u1').get());
  await assertFails(signedIn().doc('userPermissions/u2').get());
  await assertFails(signedIn().collection('userPermissions').get());
  await assertFails(signedIn().doc('userPermissions/u1').set({ p: { Settings: ['Edit'] } }));
  await assertFails(as(env, null).doc('userPermissions/u1').get());
});

test('browser-read-only collections can be read but not written', async () => {
  await assertSucceeds(signedIn().doc('windowsSessions/s1').get());
  await assertSucceeds(signedIn().collection('windowsSessions').where('userId', '==', 'u1').get());
  await assertSucceeds(signedIn().collection('categories').get());
  await assertSucceeds(signedIn().collection('inventoryItems').get());
  await assertFails(signedIn().doc('windowsSessions/s1').update({ totalMinutes: 999 }));
  await assertFails(signedIn().doc('windowsSessions/s9').set({ userId: 'u1' }));
  await assertFails(signedIn().doc('categories/c1').delete());
  await assertFails(signedIn().doc('inventoryItems/i2').set({ name: 'x' }));
});

test('the searches across projects still work', async () => {
  for (const group of ['jmcEntries', 'indents', 'bills', 'transactions']) {
    await assertSucceeds(signedIn().collectionGroup(group).get());
  }
  await assertFails(as(env, null).collectionGroup('jmcEntries').get());
});

test('every other collection is unchanged for signed-in users', async () => {
  await assertSucceeds(signedIn().doc('projects/p1').get());
  await assertSucceeds(signedIn().doc('projects/p1/jmcEntries/j1').update({ status: 'Approved' }));
  await assertSucceeds(signedIn().collection('siteAccountExpenses').get());
  await assertSucceeds(signedIn().doc('siteAccountExpenses/x2').set({ projectId: 'p1' }));
  await assertSucceeds(signedIn().doc('paymentObligations/o1/transactions/t2').set({ amount: 1 }));
  await assertSucceeds(signedIn().collection('users').get());
});

test('and still closed to anyone signed out', async () => {
  await assertFails(as(env, null).doc('projects/p1').get());
  await assertFails(as(env, null).collection('siteAccountExpenses').get());
  await assertFails(as(env, null).doc('siteAccountExpenses/x3').set({ projectId: 'p1' }));
});
