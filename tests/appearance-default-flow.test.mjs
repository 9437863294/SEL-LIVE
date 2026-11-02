/**
 * Making one company default live from My Appearance (src/lib/appearance/server.ts publishDefault)
 * against the in-memory Firestore: the new version, the draft kept in step, and clearing people's
 * own choices only when asked.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./tests/helpers/server-module-hooks.mjs --test tests/appearance-default-flow.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { FakeFirestore } from './helpers/fake-firestore.mjs';

globalThis.__db = new FakeFirestore();
const db = globalThis.__db;
const { countPreference, publishDefault, readDraft, readPublished, saveDraft } = await import('../src/lib/appearance/server.ts');

const actor = { userId: 'admin', userName: 'Admin', userEmail: null };

function reset() {
  db._store.clear();
  db.seed('userAppearance', 'admin', { homeDesign: 'aurora', mode: 'light' });
  db.seed('userAppearance', 'u1', { homeDesign: 'command', tableDensity: 'compact' });
  db.seed('userAppearance', 'u2', { mode: 'dark' });
}

test('with nothing published, one default becomes version 1 and nothing else changes', async () => {
  reset();
  const before = await readPublished();
  const result = await publishDefault(actor, 'homeDesign', 'aurora', { clearChoices: false, note: 'Home page design default set to Aurora Glass' });
  assert.equal(result.published.version, 1);
  assert.deepEqual(result.changes, ['defaults.homeDesign']);
  assert.equal(result.cleared, 0);
  const after = await readPublished();
  assert.equal(after.defaults.homeDesign, 'aurora');
  assert.deepEqual({ ...after.defaults, homeDesign: before.defaults.homeDesign }, before.defaults);
  assert.equal(db.read('settings/appearance/versions', '1').note, 'Home page design default set to Aurora Glass');
  // People's own choices are untouched unless asked.
  assert.equal(db.read('userAppearance', 'u1').homeDesign, 'command');
});

test('a draft in progress gets the same change, and stays up to date if it was', async () => {
  reset();
  await saveDraft(actor, { defaults: { accent: 'violet', tableDensity: 'compact' } });
  await publishDefault(actor, 'homeDesign', 'launchpad', { clearChoices: false, note: null });
  const draft = await readDraft();
  assert.equal(draft.config.defaults.homeDesign, 'launchpad');
  assert.equal(draft.config.defaults.tableDensity, 'compact', 'the draft keeps its own unpublished edits');
  assert.equal(draft.basedOnVersion, 1);
  assert.equal(db.read('settings/appearance/versions', '1').note, 'Company default homeDesign set to launchpad');
});

test('ticking the box removes that setting from everyone who chose it, and only that setting', async () => {
  reset();
  assert.equal(await countPreference('homeDesign'), 2);
  const result = await publishDefault(actor, 'homeDesign', 'aurora', { clearChoices: true, note: null });
  assert.equal(result.cleared, 2);
  assert.equal(await countPreference('homeDesign'), 0);
  assert.deepEqual(db.read('userAppearance', 'admin'), { mode: 'light' });
  assert.deepEqual(db.read('userAppearance', 'u1'), { tableDensity: 'compact' });
  assert.deepEqual(db.read('userAppearance', 'u2'), { mode: 'dark' });
});

test('an unknown setting or value is refused and writes nothing', async () => {
  reset();
  for (const [field, value] of [['homeDesign', 'retro'], ['moduleGroups', []], ['layout', 'x'], ['accent', '#ff0000']]) {
    await assert.rejects(publishDefault(actor, field, value, { clearChoices: true, note: null }), (error) => error.status === 400, `${field}=${value}`);
  }
  assert.equal(db.read('settings', 'appearance'), undefined);
  assert.equal(await countPreference('homeDesign'), 2);
});

test('setting the default it already has publishes nothing', async () => {
  reset();
  const result = await publishDefault(actor, 'homeDesign', 'classic', { clearChoices: false, note: null });
  assert.deepEqual(result.changes, []);
  assert.equal(result.published.version, 0);
  assert.equal(db.read('settings', 'appearance'), undefined);
});
