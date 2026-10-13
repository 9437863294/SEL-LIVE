// The guarantees every version of the ruleset must keep, whatever the per-module blocks say.
import test, { after, before } from 'node:test';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { as, rulesEnv, seed } from './helpers.mjs';

let env;
before(async () => {
  env = await rulesEnv();
  await seed(env, {
    'users/u1': { name: 'One', email: 'one@example.com', role: 'Staff' },
    'settings/appearance': { version: 1 },
    'settings/printing': { margin: 10 },
  });
});
after(async () => env?.cleanup());

test('a signed-in user can read their own user document', async () => {
  await assertSucceeds(as(env, 'u1').doc('users/u1').get());
});

test('nobody signed out can read or write user documents', async () => {
  await assertFails(as(env, null).doc('users/u1').get());
  await assertFails(as(env, null).collection('users').get());
  await assertFails(as(env, null).doc('users/u2').set({ name: 'x' }));
});

test('the sign-in page can read the published appearance before anyone signs in', async () => {
  await assertSucceeds(as(env, null).doc('settings/appearance').get());
});

test('no other settings document is readable signed out', async () => {
  await assertFails(as(env, null).doc('settings/printing').get());
});

test('deadline calculation can read office hours and holidays signed out, and change neither', async () => {
  await seed(env, { 'settings/workingHours': { schedule: {} }, 'holidays/h1': { date: '2026-10-20' } });
  await assertSucceeds(as(env, null).doc('settings/workingHours').get());
  await assertSucceeds(as(env, null).collection('holidays').get());
  await assertFails(as(env, null).doc('settings/workingHours').set({ schedule: {} }));
  await assertFails(as(env, null).doc('holidays/h2').set({ date: '2026-12-25' }));
  await assertFails(as(env, null).collection('settings').get());
});
