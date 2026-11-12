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
  await assert.rejects(saveDrawing(engineer, id, { target: { kind: 'sub', subId: 's1', isNew: true }, form: form({ title: '' }) }, files({})), /Sub-drawing Title is required/);
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

test('a project workbook imports into an existing drawing list with the mapping shown', async () => {
  const { detectSheet } = await import('../src/lib/master-drawing-list/workbook-import.ts');
  const sheet = { name: 'Supply', rows: [
    { n: 1, cells: ['MASTER DRAWING LIST'] },
    { n: 2, cells: ['SL NO', 'Description', 'R0_submission', 'comments date', 'Approval date', 'Approval Status'] },
    { n: 3, cells: ['1', 'item a', '16.03.2026', null, '20.03.2026', 'APPROVED'] },
    { n: 4, cells: ['2', 'item b', '10.06.2026', null, null, 'SUBMITTED'] },
  ] };
  const source = { kind: 'project', projectCode: 'T1', fileName: 'list.xlsx', sheets: [sheet], mappings: [detectSheet(sheet, 'list.xlsx')] };
  const preview = await runImport(importer(), { mode: 'preview', overwrite: false, source });
  assert.deepEqual(preview.sheets, [{ sheet: 'Supply', items: 2, groups: 0, revisions: 2, sections: [] }]);
  assert.equal(preview.summary.projects[0].code, 'T1');
  assert.equal(preview.summary.totals.approved, 1);
  const first = await runImport(importer(), { mode: 'import', overwrite: false, source });
  assert.deepEqual(first.written, { projects: 0, written: 2, skipped: 0 });
  const rows = (await register(engineer, 'T1')).items;
  assert.deepEqual(rows.map((row) => [row.description, row.status, row.revisions[0].status]), [['item a', 'Approved', 'Approved'], ['item b', 'In Progress', 'Under Review']]);
  assert.equal(globalThis.__db._store.get('mdl_projects/T1').name, 'list one');
  assert.deepEqual((await runImport(importer(), { mode: 'import', overwrite: false, source })).written, { projects: 0, written: 0, skipped: 2 });
  // Outside the importer's scope: refused.
  const scopedImporter = contextOf('si', { [`${M}.Drawings`]: ['View'], [`${M}.Import`]: ['View', 'Import'] }, ['p9']);
  await assert.rejects(runImport(scopedImporter, { mode: 'preview', overwrite: false, source }), /outside your access/);
});

test('review periods are saved on the drawing list and come back with it', async () => {
  await linkProject(director, 'T1', { reviewDays: 21, resubmitDays: 7 });
  const listed = (await lookups(engineer)).projects.find((p) => p.code === 'T1');
  assert.equal(listed.reviewDays, 21);
  assert.equal(listed.resubmitDays, 7);
  assert.equal(listed.projectId, 'p1');
  await linkProject(director, 'T1', { reviewDays: null });
  assert.equal((await lookups(engineer)).projects.find((p) => p.code === 'T1').reviewDays, null);
});

test('Settings: schedules and scopes, Field Control and Date Control are saved, and the writes follow them', async () => {
  const { saveMasterData, saveFieldControl, saveDateControl, settingsView, loadSettings } = await import('../src/lib/master-drawing-list/server/settings.ts');
  await createItem(engineer, newItem());
  await assert.rejects(settingsView(contextOf('x', { [`${M}.Drawings`]: ['View'] }, ['p1'])), /Settings is required/);
  const view = await settingsView(director);
  assert.equal(view.usage.schedules.Supply, 1);
  const schedules = view.settings.masterData.schedules;

  // Supply is on a drawing: it cannot be renamed or removed, only switched off.
  await assert.rejects(saveMasterData(director, { schedules: schedules.map((v) => (v.name === 'Supply' ? { ...v, name: 'Supplies' } : v)), scopes: view.settings.masterData.scopes }), /cannot be renamed/);
  await assert.rejects(saveMasterData(engineer, view.settings.masterData), /Manage permission/);
  await saveMasterData(director, { schedules: [...schedules.map((v) => (v.name === 'Supply' ? { ...v, active: false } : v)), { id: 'mech', name: 'Mechanical', active: true }], scopes: view.settings.masterData.scopes });
  await assert.rejects(createItem(engineer, newItem()), /not a schedule in use/);
  const { slNo } = await createItem(engineer, newItem({ schedule: 'Mechanical' }));
  assert.equal(slNo, '1');
  assert.equal((await settingsView(director)).history.masterData[0].byName, 'user dir');

  // Field Control: Doc No. required on items and drawings.
  await saveFieldControl(director, { forms: { drawing: { docNo: { required: true } } } });
  await assert.rejects(createItem(engineer, newItem({ schedule: 'Mechanical' })), /Doc No\. is required/);
  const { id } = await createItem(engineer, newItem({ schedule: 'Mechanical', docNo: 'D-9' }));
  await assert.rejects(saveDrawing(engineer, id, { target: { kind: 'item' }, form: form({ docNo: '' }) }, files({})), /Doc No\. is required/);

  // Date Control: three days back for list T1.
  await saveDateControl(director, { enabled: false, backdateDays: 7, futureDays: 0, applySubmission: true, applyComments: true, applyApproval: true, projects: { T1: { enabled: true, backdateDays: 3, futureDays: 0, applySubmission: true, applyComments: true, applyApproval: true } } });
  await assert.rejects(saveDrawing(engineer, id, { target: { kind: 'item' }, form: form({ docNo: 'D-9', revisions: rounds(['R0', '2026-06-20', 'Under Review']) }) }, files({ R0: pdf() })), /cannot be earlier than 27\.06\.2026/);
  const saved = await saveDrawing(engineer, id, { target: { kind: 'item' }, form: form({ docNo: 'D-9', revisions: rounds(['R0', '2026-06-28', 'Under Review']) }) }, files({ R0: pdf() }));
  assert.equal(saved.revisions[0].submissionDate, '2026-06-28');
  const settings = await loadSettings();
  assert.equal(settings.dateControl.projects.T1.backdateDays, 3);
  assert.equal(settings.fieldControl.drawing.docNo.required, true);
  assert.equal((await lookups(engineer)).settings.masterData.schedules.find((v) => v.name === 'Mechanical').active, true);
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

test('import history and undo: the record of each import; undo removes what it added unless edited since, once', async () => {
  const { importHistory, undoImport } = await import('../src/lib/master-drawing-list/server/import.ts');
  const { detectSheet } = await import('../src/lib/master-drawing-list/workbook-import.ts');
  const sheet = { name: 'Supply', rows: [
    { n: 1, cells: ['SL NO', 'Description', 'R0_submission'] },
    { n: 2, cells: ['1', 'item a', '16.03.2026'] },
    { n: 3, cells: ['2', 'item b', '10.06.2026'] },
  ] };
  const source = { kind: 'project', projectCode: 'T1', fileName: 'list.xlsx', sheets: [sheet], mappings: [detectSheet(sheet, 'list.xlsx')] };
  const done = await runImport(importer(), { mode: 'import', overwrite: false, rememberMappings: false, source });
  assert.ok(done.importId);
  const [record] = await importHistory(importer());
  assert.deepEqual([record.id, record.fileName, record.kind, record.projectCodes, record.written, record.created, record.replaced, record.byName, record.undoneAt], [done.importId, 'list.xlsx', 'project', ['T1'], 2, 2, 0, 'user imp', null]);
  const ids = (await register(engineer, 'T1')).items.map((item) => item.id);
  assert.equal(ids.length, 2);
  for (const id of ids) assert.equal(globalThis.__db._store.get(`mdl_items/${id}`).importId, done.importId);

  // Someone records comments on one of them: Undo keeps it.
  const edited = ids[0];
  await saveDrawing(importer(), edited, { target: asItem, form: form({ description: globalThis.__db._store.get(`mdl_items/${edited}`).description, group: '', status: 'In Progress', revisions: rounds(['R0', '2026-03-16', 'Resubmission Required', '2026-03-20']) }) }, files({}));

  await assert.rejects(undoImport(contextOf('v', { [`${M}.Drawings`]: ['View'], [`${M}.All Projects`]: ['View'], [`${M}.Import`]: ['View'] }), done.importId), /Import is required/);
  const undone = await undoImport(importer(), done.importId);
  assert.deepEqual([undone.removed, undone.kept, undone.undoneByName], [1, 1, 'user imp']);
  assert.deepEqual((await register(engineer, 'T1')).items.map((item) => item.id), [edited]);
  await assert.rejects(undoImport(importer(), done.importId), /already been undone/);
  await assert.rejects(undoImport(importer(), 'nope'), /does not exist/);
  assert.equal((await importHistory(importer()))[0].removed, 1);

  // History shows only imports into lists the caller can see.
  const scoped = contextOf('sc', { [`${M}.Drawings`]: ['View'], [`${M}.Import`]: ['View'] }, ['p9']);
  assert.deepEqual(await importHistory(scoped), []);
  await assert.rejects(importHistory(engineer), /Import is required/);
});

test('saved column mappings: remembered on import, offered for the same headings, removable', async () => {
  const { listMappings, deleteMapping } = await import('../src/lib/master-drawing-list/server/import.ts');
  const { applyTemplates, detectSheet } = await import('../src/lib/master-drawing-list/workbook-import.ts');
  const sheet = { name: 'Supply', rows: [
    { n: 1, cells: ['SL NO', 'Description', 'R0_submission', 'Extra'] },
    { n: 2, cells: ['1', 'item a', '16.03.2026', 'x'] },
  ] };
  const detected = detectSheet(sheet, 'list.xlsx');
  // The user corrected the mapping before importing: Extra is the remarks column.
  const confirmed = { ...detected, schedule: 'Civil', columns: ['slNo', 'description', 'sub:0', 'remarks'] };
  const source = { kind: 'project', projectCode: 'T1', fileName: 'list.xlsx', sheets: [sheet], mappings: [confirmed] };
  await runImport(importer(), { mode: 'preview', overwrite: false, rememberMappings: true, source });
  assert.deepEqual(await listMappings(importer()), [], 'a dry run remembers nothing');
  await runImport(importer(), { mode: 'import', overwrite: false, rememberMappings: true, source });
  const [saved] = await listMappings(importer());
  assert.deepEqual([saved.projectCode, saved.sheetName, saved.schedule, saved.columns, saved.savedByName], ['T1', 'Supply', 'Civil', ['slNo', 'description', 'sub:0', 'remarks'], 'user imp']);

  // Next month's workbook, same headings: it opens with the confirmed mapping.
  const next = { name: 'Supply', rows: [sheet.rows[0], { n: 2, cells: ['1', 'item a', '16.03.2026', 'y'] }] };
  const { mappings, applied } = applyTemplates([next], [detectSheet(next, 'new.xlsx')], await listMappings(importer()), 'T1');
  assert.equal(applied[0].id, saved.id);
  assert.deepEqual([mappings[0].schedule, mappings[0].columns], ['Civil', ['slNo', 'description', 'sub:0', 'remarks']]);

  // Confirming the same layout again replaces it rather than adding a second.
  await runImport(importer(), { mode: 'import', overwrite: true, rememberMappings: true, source: { ...source, mappings: [{ ...confirmed, schedule: 'Supply' }] } });
  const again = await listMappings(importer());
  assert.equal(again.length, 1);
  assert.equal(again[0].schedule, 'Supply');

  await assert.rejects(deleteMapping(contextOf('v', { [`${M}.Drawings`]: ['View'], [`${M}.All Projects`]: ['View'], [`${M}.Import`]: ['View'] }), again[0].id), /Import is required/);
  await deleteMapping(importer(), again[0].id);
  assert.deepEqual(await listMappings(importer()), []);
  await assert.rejects(deleteMapping(importer(), again[0].id), /no longer exists/);
  // Off: nothing remembered.
  await runImport(importer(), { mode: 'import', overwrite: true, rememberMappings: false, source });
  assert.deepEqual(await listMappings(importer()), []);
});
