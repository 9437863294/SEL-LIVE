// Master Drawing List server flow on the in-memory Firestore and Storage doubles: add an item, save
// its Drawing Details with round files, the round cascade, sub-drawings and the assignee's own
// authority, deletes, file access, the Excel import and drawing lists — through the same functions
// the API routes call, with access checked per drawing list. Run with
//   node --import ./tests/helpers/server-module-hooks.mjs --test tests/master-drawing-list-flow.test.mjs
//
// Abstract fixtures only (list codes "T1"/"T2", ERP project "p1", users "eng"/"asg"); no drawing data.

import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { FakeFirestore } from './helpers/fake-firestore.mjs';

const { contextFor } = await import('../src/lib/master-drawing-list/server/context.ts');
const { createItem, createProject, deleteItem, deleteSubDrawing, linkProject, readDrawingFile, saveDrawing } = await import('../src/lib/master-drawing-list/server/items.ts');
const { groupsFor, lookups, register, settingsProjects } = await import('../src/lib/master-drawing-list/server/queries.ts');
const { runImport } = await import('../src/lib/master-drawing-list/server/import.ts');
const { formRevisions } = await import('../src/lib/master-drawing-list/drawings.ts');
const { PROJECT_COLUMNS, ITEM_COLUMNS, REVISION_COLUMNS } = await import('../src/lib/master-drawing-list/import.ts');

// 06:00 UTC on 30 June 2026 is 11:30 in India: "today" is 2026-06-30.
const NOW = new Date('2026-06-30T06:00:00Z');
const M = 'Master Drawing List';

function contextOf(userId, permissions, projectIds = []) {
  return contextFor({ userId, userName: `user ${userId}`, userEmail: null, role: 'r', organizationId: 'default', access: permissions, permissions, roleNames: [], projectIds, departmentIds: [] }, NOW);
}

let engineer;
let director;
let assignee;

beforeEach(() => {
  globalThis.__db = new FakeFirestore();
  globalThis.__bucket = undefined;
  const store = globalThis.__db._store;
  store.set('mdl_projects/T1', { code: 'T1', short: 'T1', name: 'list one', client: null, drgPrefix: null, projectId: 'p1' });
  store.set('mdl_projects/T2', { code: 'T2', short: 'T2', name: 'list two', client: null, drgPrefix: null });
  store.set('projects/p1', { projectName: 'erp one', clientName: 'client one' });
  store.set('users/asg', { name: 'user asg' });
  engineer = contextOf('eng', { [`${M}.Drawings`]: ['View', 'Add', 'Edit'] }, ['p1']);
  director = contextOf('dir', { [`${M}.All Projects`]: ['View'], [`${M}.Drawings`]: ['View', 'Add', 'Edit', 'Delete'], [`${M}.Settings`]: ['View', 'Manage'] });
  assignee = contextOf('asg', { [`${M}.Drawings`]: ['View'] }, ['p1']);
});

const newItem = (overrides = {}) => ({ projectCode: 'T1', schedule: 'Supply', scope: 'Substation', group: 'g1', description: 'item a', docNo: '', drawingNo: '', plannedStartDate: '', plannedEndDate: '', ...overrides });
const form = (overrides = {}) => ({
  title: '',
  assignedToId: '',
  description: 'item a',
  group: 'g1',
  docNo: '',
  drawingNo: '',
  plannedStartDate: '',
  plannedEndDate: '',
  revisions: formRevisions([]),
  approveDate: '',
  status: 'Pending',
  remark: '',
  ...overrides,
});
const rounds = (...list) => formRevisions(list.map(([round, submissionDate = '', status = '', commentsDate = '']) => ({ round, submissionDate, status, comments: '', commentsDate })));
const pdf = (name = 'r0.pdf') => ({ name, bytes: new TextEncoder().encode('%PDF-1.4 test') });
const files = (entries) => new Map(Object.entries(entries));
const asItem = { kind: 'item' };

test('Drawing Details: a submission needs its file; the next round opens only after a rejection; status is picked by hand', async () => {
  const { id, slNo } = await createItem(engineer, newItem({ plannedStartDate: '2026-05-01', plannedEndDate: '2026-06-15' }));
  assert.equal(slNo, '1');
  const first = await register(engineer, 'T1');
  assert.equal(first.items[0].status, 'Pending');
  assert.deepEqual(first.can, { add: true, edit: true, delete: false, export: false });

  await assert.rejects(saveDrawing(engineer, id, { target: asItem, form: form({ revisions: rounds(['R0', '2026-06-01', 'Under Review']) }) }, files({})), /Upload the drawing for R0/);
  await assert.rejects(saveDrawing(engineer, id, { target: asItem, form: form({ revisions: rounds(['R0', '2026-06-01', 'Under Review']) }) }, files({ R0: { name: 'r0.exe', bytes: new Uint8Array(3) } })), /attach a PDF/);

  let item = await saveDrawing(engineer, id, { target: asItem, form: form({ docNo: 'D-1', status: 'In Progress', revisions: rounds(['R0', '2026-06-01', 'Under Review']) }) }, files({ R0: pdf() }));
  const r0Path = item.revisions[0].filePath;
  assert.match(r0Path, new RegExp(`^master-drawing-list/T1/${id}/item/R0-\\d+-r0\\.pdf$`));
  assert.equal(item.revisions[0].fileName, 'r0.pdf');
  assert.equal(item.firstSubmittedOn, '2026-06-01');
  assert.ok(globalThis.__bucket.files.has(r0Path));

  // R1 needs R0 rejected first.
  await assert.rejects(saveDrawing(engineer, id, { target: asItem, form: form({ revisions: rounds(['R0', '2026-06-01', 'Under Review', '2026-06-10'], ['R1', '2026-06-20', 'Under Review']) }) }, files({ R1: pdf('r1.pdf') })), /Mark R0 as Rejected or Resubmission Required/);
  // A file path the browser sends is ignored: the stored one is kept.
  const sentRevisions = rounds(['R0', '2026-06-01', 'Resubmission Required', '2026-06-10'], ['R1', '2026-06-20', 'Approved with Comments']);
  sentRevisions[0].filePath = 'master-drawing-list/T2/other/item/x.pdf';
  item = await saveDrawing(engineer, id, { target: asItem, form: form({ approveDate: '2026-06-25', status: 'Approved with Comments', revisions: sentRevisions }) }, files({ R1: pdf('r1.pdf') }));
  assert.equal(item.revisions[0].filePath, r0Path);
  assert.equal(item.status, 'Approved with Comments');
  assert.equal(item.firstSubmittedOn, '2026-06-01');
  assert.equal(globalThis.__db._store.get(`mdl_items/${id}`).updatedBy, 'eng');

  // Dates cannot be in the future (India time).
  await assert.rejects(saveDrawing(engineer, id, { target: asItem, form: form({ approveDate: '2026-07-01', revisions: sentRevisions }) }, files({})), /approve date cannot be in the future/);
});

test('sub-drawings: Edit adds and removes them; the assignee updates their own without Edit but cannot reassign it', async () => {
  const { id } = await createItem(engineer, newItem());
  await assert.rejects(saveDrawing(engineer, id, { target: { kind: 'sub', subId: 's1', isNew: true }, form: form({ title: '' }) }, files({})), /sub-drawing a title/);
  let item = await saveDrawing(engineer, id, { target: { kind: 'sub', subId: 's1', isNew: true }, form: form({ title: 'GA', assignedToId: 'asg' }) }, files({}));
  assert.equal(item.subDrawings[0].assignedToName, 'user asg');
  await assert.rejects(saveDrawing(engineer, id, { target: { kind: 'sub', subId: 's1', isNew: true }, form: form({ title: 'GA' }) }, files({})), /already exists/);
  await assert.rejects(saveDrawing(engineer, id, { target: { kind: 'sub', subId: 's2', isNew: true }, form: form({ title: 'x', assignedToId: 'nobody' }) }, files({})), /not a registered user/);

  // The assignee (View only) updates their sub-drawing…
  item = await saveDrawing(assignee, id, { target: { kind: 'sub', subId: 's1', isNew: false }, form: form({ title: 'GA', assignedToId: 'asg', status: 'In Progress', revisions: rounds(['R0', '2026-06-02', 'Under Review']) }) }, files({ R0: pdf() }));
  assert.equal(item.subDrawings[0].status, 'In Progress');
  assert.match(item.subDrawings[0].revisions[0].filePath, /\/s1\/R0-/);
  // …but cannot hand it to someone else, edit the item's own drawing, or add one.
  await assert.rejects(saveDrawing(assignee, id, { target: { kind: 'sub', subId: 's1', isNew: false }, form: form({ title: 'GA', assignedToId: '' }) }, files({})), /Only someone with Edit permission can reassign/);
  await assert.rejects(saveDrawing(assignee, id, { target: asItem, form: form() }, files({})), /Edit permission/);
  await assert.rejects(saveDrawing(assignee, id, { target: { kind: 'sub', subId: 's9', isNew: true }, form: form({ title: 'x' }) }, files({})), /Edit permission/);

  await assert.rejects(deleteSubDrawing(assignee, id, 's1'), /Edit permission/);
  await deleteSubDrawing(engineer, id, 's1');
  assert.equal((await register(engineer, 'T1')).items[0].subDrawings.length, 0);
});

test('files open only for those who may view the list, and only the paths the item records', async () => {
  const { id } = await createItem(engineer, newItem());
  const item = await saveDrawing(engineer, id, { target: asItem, form: form({ revisions: rounds(['R0', '2026-06-01', 'Under Review']) }) }, files({ R0: pdf() }));
  const path = item.revisions[0].filePath;
  const file = await readDrawingFile(engineer, id, path);
  assert.equal(file.fileName, 'r0.pdf');
  assert.equal(file.contentType, 'application/pdf');
  await assert.rejects(readDrawingFile(engineer, id, 'master-drawing-list/T1/other.pdf'), /not on the drawing item/);
  const outsider = contextOf('out', { [`${M}.Drawings`]: ['View'] }, ['p9']);
  await assert.rejects(readDrawingFile(outsider, id, path), /outside your access/);
});

test('deleting an item needs Drawings · Delete', async () => {
  const { id } = await createItem(engineer, newItem());
  await assert.rejects(deleteItem(engineer, id), /Delete permission/);
  await deleteItem(director, id);
  assert.equal(globalThis.__db._store.has(`mdl_items/${id}`), false);
});

test('Sl. No. is the next number for the schedule and scope; scope follows the ERP project link', async () => {
  await createItem(engineer, newItem());
  await createItem(engineer, newItem({ description: 'item b' }));
  const civil = await createItem(engineer, newItem({ schedule: 'Civil', group: null }));
  assert.equal(civil.slNo, '1');
  assert.equal((await groupsFor(engineer, 'T1')).nextSlNo['Supply|Substation'], '3');
  await assert.rejects(createItem(engineer, newItem({ projectCode: 'T2' })), /outside your access/);
  await assert.rejects(register(engineer, 'T2'), /outside your access/);
  assert.deepEqual((await lookups(engineer)).projects.map((p) => p.code), ['T1']);
  assert.deepEqual((await lookups(director)).projects.map((p) => p.code), ['T1', 'T2']);
  assert.deepEqual((await lookups(engineer)).permissions.Drawings, ['View', 'Add', 'Edit']);
});

const importGrid = () => ({
  Projects: { headings: PROJECT_COLUMNS, rows: [{ n: 2, cells: { Code: 'T3', 'Short name': 'S3', 'Full name': 'list three', Client: null, 'Drawing no. prefix': null } }] },
  Items: { headings: ITEM_COLUMNS, rows: [{ n: 2, cells: { 'Item ID': 'imp1', Project: 'S3', Schedule: 'Supply', Scope: 'Substation', Description: 'item a', 'Sl. No. (as in workbook)': '1', Source: 'book' } }] },
  Revisions: { headings: REVISION_COLUMNS, rows: [{ n: 2, cells: { 'Item ID': 'imp1', Revision: 'R0', 'Submitted on': '2026-06-01', 'Comments received on': null } }] },
});
const importer = () => contextOf('imp', { [`${M}.All Projects`]: ['View'], [`${M}.Drawings`]: ['View', 'Edit'], [`${M}.Import`]: ['View', 'Import'] });

test('Excel import: preview writes nothing; import writes the register record; re-import skips; imported rounds need no file', async () => {
  const preview = await runImport(importer(), { grid: importGrid(), mode: 'preview', overwrite: false });
  assert.equal(preview.summary.itemCount, 1);
  assert.equal(preview.summary.overall['In Progress'], 1);
  assert.equal(globalThis.__db._store.has('mdl_items/imp1'), false);
  await assert.rejects(runImport(engineer, { grid: importGrid(), mode: 'preview', overwrite: false }), /Import is required/);

  const first = await runImport(importer(), { grid: importGrid(), mode: 'import', overwrite: false });
  assert.deepEqual(first.written, { projects: 1, written: 1, skipped: 0 });
  const stored = globalThis.__db._store.get('mdl_items/imp1');
  assert.equal(stored.status, 'In Progress');
  assert.equal(stored.revisions[0].status, 'Under Review');
  assert.equal(stored.updatedBy, 'import');

  // Recording comments on the imported R0 needs no file for it.
  const item = await saveDrawing(importer(), 'imp1', { target: asItem, form: form({ group: '', status: 'In Progress', revisions: rounds(['R0', '2026-06-01', 'Resubmission Required', '2026-06-20']) }) }, files({}));
  assert.equal(item.revisions[0].commentsDate, '2026-06-20');

  await linkProject(director, 'T3', { projectId: 'p1' });
  const again = await runImport(importer(), { grid: importGrid(), mode: 'import', overwrite: true });
  // Edited in the ERP since, so even --overwrite leaves it alone; the link survives.
  assert.deepEqual(again.written, { projects: 1, written: 0, skipped: 1 });
  assert.equal(globalThis.__db._store.get('mdl_projects/T3').projectId, 'p1');
});

test('drawing lists: created and linked in Settings', async () => {
  const input = { projectId: 'p1', code: 'NEW', short: 'new', name: 'new list', client: null, drgPrefix: null };
  await assert.rejects(createProject(engineer, input), /Manage permission/);
  await assert.rejects(createProject(director, { ...input, projectId: 'nope' }), /does not exist/);
  await createProject(director, input);
  await assert.rejects(createProject(director, { ...input, short: 'again' }), /already exists/);
  assert.ok((await lookups(engineer)).projects.some((p) => p.code === 'NEW'));
  assert.equal((await createItem(engineer, newItem({ projectCode: 'NEW' }))).slNo, '1');
  await assert.rejects(linkProject(engineer, 'T2', { projectId: 'p1' }), /Manage permission/);
  await linkProject(director, 'T2', { projectId: 'p1' });
  assert.equal((await settingsProjects(director)).projects.find((p) => p.code === 'T2').projectId, 'p1');
});
