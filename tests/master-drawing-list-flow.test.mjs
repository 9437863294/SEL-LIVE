// Master Drawing List server flow on the in-memory Firestore double: add an item, record a
// submission, comments, a resubmission and the approval through the same functions the API routes
// call, with access checked per drawing list. Run with
//   node --import ./tests/helpers/server-module-hooks.mjs --test tests/master-drawing-list-flow.test.mjs
//
// Abstract fixtures only (list codes "T1"/"T2", ERP project "p1"); no drawing data.

import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { FakeFirestore } from './helpers/fake-firestore.mjs';

const { contextFor } = await import('../src/lib/master-drawing-list/server/context.ts');
const { createItem, linkProject, recordStep, updateDetails } = await import('../src/lib/master-drawing-list/server/items.ts');
const { dashboard, groupsFor, itemView, lookups, pending, register, settingsProjects } = await import('../src/lib/master-drawing-list/server/queries.ts');
const { runImport } = await import('../src/lib/master-drawing-list/server/import.ts');
const { createProject } = await import('../src/lib/master-drawing-list/server/items.ts');
const { PROJECT_COLUMNS, ITEM_COLUMNS, REVISION_COLUMNS } = await import('../src/lib/master-drawing-list/import.ts');

// 06:00 UTC on 30 June 2026 is 11:30 in India: "today" is 2026-06-30.
const NOW = new Date('2026-06-30T06:00:00Z');

function contextOf(userId, permissions, projectIds = []) {
  return contextFor(
    { userId, userName: `user ${userId}`, userEmail: null, role: 'r', organizationId: 'default', access: permissions, permissions, roleNames: [], projectIds, departmentIds: [] },
    NOW,
  );
}

const M = 'Master Drawing List';
let engineer;
let director;

beforeEach(() => {
  globalThis.__db = new FakeFirestore();
  const store = globalThis.__db._store;
  store.set('mdl_projects/T1', { code: 'T1', short: 'T1', name: 'list one', client: null, drgPrefix: null, projectId: 'p1' });
  store.set('mdl_projects/T2', { code: 'T2', short: 'T2', name: 'list two', client: null, drgPrefix: null });
  store.set('projects/p1', { projectName: 'erp one', clientName: 'client one' });
  engineer = contextOf('eng', { [`${M}.Drawings`]: ['View', 'Add', 'Edit'], [`${M}.Submissions`]: ['Record'] }, ['p1']);
  director = contextOf('dir', { [`${M}.All Projects`]: ['View'], [`${M}.Drawings`]: ['View', 'Add'], [`${M}.Approval`]: ['Record'], [`${M}.Settings`]: ['View', 'Manage'] });
});

const newItem = (overrides = {}) => ({
  projectCode: 'T1',
  schedule: 'Supply',
  scope: 'Substation',
  group: 'g1',
  description: 'item a',
  drgNo: null,
  plannedSubmission: null,
  targetApproval: null,
  vendorFinalised: true,
  ...overrides,
});

test('submission → comments → resubmission → approval, status recalculated on every write', async () => {
  const { id, slNo } = await createItem(engineer, newItem());
  assert.equal(slNo, '1');
  let view = await itemView(engineer, id);
  assert.equal(view.item.status, 'not_submitted');
  assert.equal(view.item.updatedByName, 'user eng');
  assert.deepEqual(view.steps.map((s) => s.step), ['submission']);

  await assert.rejects(recordStep(engineer, id, 'submission', { date: '2026-07-01', transmittalNo: null }), /future/);
  let item = await recordStep(engineer, id, 'submission', { date: '2026-05-01', transmittalNo: 'T/1' });
  assert.equal(item.status, 'under_review');
  assert.equal(item.currentRev, 0);
  assert.equal(item.heldBy, 'Client');

  await assert.rejects(recordStep(engineer, id, 'comments', { date: '2026-04-30' }), /earlier than the last recorded date \(01\.05\.2026\)/);
  item = await recordStep(engineer, id, 'comments', { date: '2026-05-20' });
  assert.equal(item.status, 'comments_received');
  assert.equal(item.lastCommentedOn, '2026-05-20');
  await assert.rejects(recordStep(engineer, id, 'comments', { date: '2026-05-21' }), /already recorded/);

  item = await recordStep(engineer, id, 'submission', { date: '2026-06-01', transmittalNo: null });
  assert.equal(item.currentRev, 1);
  assert.equal(item.status, 'under_review');

  // The engineer may not approve; the director (All Projects + Approval) may.
  view = await itemView(engineer, id);
  assert.deepEqual(view.steps.map((s) => s.step), ['comments', 'submission']);
  await assert.rejects(recordStep(engineer, id, 'approval', { date: '2026-06-10' }), /Approval is required/);
  item = await recordStep(director, id, 'approval', { date: '2026-06-10' });
  assert.equal(item.status, 'approved');
  assert.equal(item.approvedOn, '2026-06-10');
  await assert.rejects(recordStep(engineer, id, 'submission', { date: '2026-06-11', transmittalNo: null }), /already approved/);
  // Submissions need their own permission, whatever else the caller holds.
  await assert.rejects(recordStep(director, id, 'submission', { date: '2026-06-11', transmittalNo: null }), /Submissions is required/);
  assert.deepEqual((await itemView(engineer, id)).steps, []);

  const stored = globalThis.__db._store.get(`mdl_items/${id}`);
  assert.equal(stored.status, 'approved');
  assert.equal(stored.revisions.length, 2);
  assert.equal(stored.updatedBy, 'dir');
});

test('Sl. No. is the next number in the project for that schedule and scope', async () => {
  await createItem(engineer, newItem());
  await createItem(engineer, newItem({ description: 'item b' }));
  const civil = await createItem(engineer, newItem({ schedule: 'Civil', group: null, description: 'item c' }));
  assert.equal(civil.slNo, '1');
  const groups = await groupsFor(engineer, 'T1');
  assert.equal(groups.nextSlNo['Supply|Substation'], '3');
  assert.equal(groups.nextSlNo['Civil|Substation'], '2');
  assert.deepEqual(groups.groups, [{ schedule: 'Supply', scope: 'Substation', group: 'g1' }]);
});

test('scope: lists not linked to a granted ERP project are refused; All Projects sees them', async () => {
  await assert.rejects(createItem(engineer, newItem({ projectCode: 'T2' })), /outside your access/);
  const { id } = await createItem(director, newItem({ projectCode: 'T2' }));
  await assert.rejects(itemView(engineer, id), /outside your access/);
  await assert.rejects(register(engineer, 'T2'), /outside your access/);
  assert.deepEqual((await lookups(engineer)).projects.map((p) => p.code), ['T1']);
  assert.deepEqual((await lookups(director)).projects.map((p) => p.code), ['T1', 'T2']);
  const own = (await lookups(engineer)).projects[0];
  assert.equal(own.displayName, 'erp one');
  assert.equal(own.displayClient, 'client one');
});

test('lookups report held actions; edit needs Drawings · Edit', async () => {
  const l = await lookups(engineer);
  assert.deepEqual(l.permissions.Drawings, ['View', 'Add', 'Edit']);
  assert.deepEqual(l.permissions.Approval, []);
  assert.equal(l.today, '2026-06-30');
  const { id } = await createItem(director, newItem());
  const edited = await updateDetails(engineer, id, { drgNo: 'D-1', plannedSubmission: '2026-08-01', targetApproval: null, remarks: null, vendorFinalised: false, onHold: false });
  assert.equal(edited.status, 'vendor_not_finalised');
  await assert.rejects(updateDetails(director, id, { drgNo: null, plannedSubmission: null, targetApproval: null, remarks: null, vendorFinalised: true, onHold: true }), /Edit permission/);
});

test('pending and dashboard cover the lists the caller may view', async () => {
  const a = await createItem(engineer, newItem());
  await recordStep(engineer, a.id, 'submission', { date: '2026-06-01', transmittalNo: null });
  await createItem(engineer, newItem({ vendorFinalised: false, description: 'item v' }));
  await createItem(director, newItem({ projectCode: 'T2', vendorFinalised: false }));
  const mine = await pending(engineer, null);
  assert.equal(mine.lists.review.length, 1);
  assert.equal(mine.lists.review[0].days, 29);
  assert.deepEqual(mine.lists.vendor.map((v) => v.projectCode), ['T1']);
  const all = await dashboard(director);
  assert.equal(all.total.total, 3);
  assert.deepEqual(all.projects.map((p) => [p.project.code, p.summary.total]), [['T1', 2], ['T2', 1]]);
});

test('linking a list to an ERP project needs Settings · Manage and an existing project', async () => {
  await assert.rejects(linkProject(engineer, 'T2', { projectId: 'p1' }), /Manage permission/);
  await assert.rejects(linkProject(director, 'T2', { projectId: 'nope' }), /does not exist/);
  await linkProject(director, 'T2', { projectId: 'p1' });
  assert.deepEqual((await lookups(engineer)).projects.map((p) => p.code), ['T1', 'T2']);
  const settings = await settingsProjects(director);
  assert.equal(settings.projects.find((p) => p.code === 'T2').projectId, 'p1');
  assert.equal(settings.canManage, true);
});

const importGrid = () => ({
  Projects: { headings: PROJECT_COLUMNS, rows: [{ n: 2, cells: { Code: 'T3', 'Short name': 'S3', 'Full name': 'list three', Client: null, 'Drawing no. prefix': null } }] },
  Items: {
    headings: ITEM_COLUMNS,
    rows: [{ n: 2, cells: { 'Item ID': 'imp1', Project: 'S3', Schedule: 'Supply', Scope: 'Substation', Description: 'item a', 'Sl. No. (as in workbook)': '1', Source: 'book' } }],
  },
  Revisions: { headings: REVISION_COLUMNS, rows: [{ n: 2, cells: { 'Item ID': 'imp1', Revision: 'R0', 'Submitted on': '2026-06-01', 'Comments received on': null } }] },
});
const importer = () => contextOf('imp', { [`${M}.All Projects`]: ['View'], [`${M}.Drawings`]: ['View'], [`${M}.Import`]: ['View', 'Import'] });

test('Excel import: preview writes nothing; import writes; re-import skips; a Settings link survives', async () => {
  const preview = await runImport(importer(), { grid: importGrid(), mode: 'preview', overwrite: false });
  assert.equal(preview.summary.itemCount, 1);
  assert.equal(preview.summary.totals.under_review, 1);
  assert.equal(globalThis.__db._store.has('mdl_items/imp1'), false);

  await assert.rejects(runImport(engineer, { grid: importGrid(), mode: 'preview', overwrite: false }), /Import is required/);
  const viewer = contextOf('v', { [`${M}.Drawings`]: ['View'], [`${M}.Import`]: ['View'] });
  await assert.rejects(runImport(viewer, { grid: importGrid(), mode: 'import', overwrite: false }), /Import permission/);

  const first = await runImport(importer(), { grid: importGrid(), mode: 'import', overwrite: false });
  assert.deepEqual(first.written, { projects: 1, written: 1, skipped: 0 });
  const stored = globalThis.__db._store.get('mdl_items/imp1');
  assert.equal(stored.status, 'under_review');
  assert.equal(stored.updatedBy, 'import');

  await linkProject(director, 'T3', { projectId: 'p1' });
  const again = await runImport(importer(), { grid: importGrid(), mode: 'import', overwrite: false });
  assert.deepEqual(again.written, { projects: 1, written: 0, skipped: 1 });
  assert.equal(globalThis.__db._store.get('mdl_projects/T3').projectId, 'p1');
  const replaced = await runImport(importer(), { grid: importGrid(), mode: 'import', overwrite: true });
  assert.equal(replaced.written.written, 1);

  await assert.rejects(runImport(importer(), { grid: { Items: importGrid().Items }, mode: 'preview', overwrite: false }), /Sheet "Projects" is missing/);
});

test('a drawing list created in Settings takes items straight away', async () => {
  const input = { projectId: 'p1', code: 'NEW', short: 'new', name: 'new list', client: null, drgPrefix: null };
  await assert.rejects(createProject(engineer, input), /Manage permission/);
  await assert.rejects(createProject(director, { ...input, projectId: 'nope' }), /does not exist/);
  await createProject(director, input);
  await assert.rejects(createProject(director, { ...input, short: 'again' }), /already exists/);
  // Linked to p1, so the engineer granted p1 sees it and can add to it.
  assert.ok((await lookups(engineer)).projects.some((p) => p.code === 'NEW'));
  const { slNo } = await createItem(engineer, newItem({ projectCode: 'NEW' }));
  assert.equal(slNo, '1');
});
