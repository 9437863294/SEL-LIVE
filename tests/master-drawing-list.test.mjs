// Master Drawing List, pure parts: the drawing record and its roll-up, the Drawing Details save
// rules, the register's groups, filters, numbering and Excel sheet, the workbook reader and its
// conversion to the register's record, access, and the API schemas. The Admin-SDK flow is in
// tests/master-drawing-list-flow.test.mjs.
//
// The records below are abstract fixtures (codes like "T1", descriptions like "item a"), not drawing data.

import test from 'node:test';
import assert from 'node:assert/strict';

import { derive, todayIst } from '../src/lib/master-drawing-list/derive.ts';
import {
  canEditSubDrawing,
  cycleAgeDays,
  drawingStage,
  formRevisions,
  isOverdue,
  latestRevisionAcrossItem,
  rollUpStatuses,
  rollup,
  storedRevisions,
  summariseItems,
} from '../src/lib/master-drawing-list/drawings.ts';
import { drawingFormError, recordFromForm } from '../src/lib/master-drawing-list/steps.ts';
import { filterItems, groupItems, nextNumbers, registerSheet } from '../src/lib/master-drawing-list/register.ts';
import { resolveMdlAccess } from '../src/lib/master-drawing-list/access.ts';
import { drawingSaveInputSchema, newItemInputSchema } from '../src/lib/master-drawing-list/schemas.ts';
import { ITEM_COLUMNS, PROJECT_COLUMNS, REVISION_COLUMNS, cellText, gridFromWorkbook, parseImport, summariseImport, toDrawingItem, ImportFormatError } from '../src/lib/master-drawing-list/import.ts';
import { buildWorkbookBuffer } from '../src/lib/report-excel.ts';

const TODAY = '2026-06-30';

const round = (r, submissionDate = '', status = '', commentsDate = '', extra = {}) => ({ round: r, submissionDate, status, comments: '', commentsDate, ...extra });

let order = 0;
function item(overrides = {}) {
  order += 1;
  return {
    id: `i${order}`,
    projectCode: 'T1',
    schedule: 'Supply',
    scope: 'Substation',
    group: null,
    order,
    slNo: String(order),
    description: `item ${order}`,
    docNo: '',
    drawingNo: '',
    plannedStartDate: '',
    plannedEndDate: '',
    revisions: formRevisions([]),
    approveDate: '',
    status: 'Pending',
    remark: '',
    subDrawings: [],
    legacy: null,
    updatedAt: null,
    updatedBy: null,
    ...overrides,
  };
}
const sub = (overrides = {}) => ({ id: `s${(order += 1)}`, title: 'sub a', docNo: '', drawingNo: '', plannedStartDate: '', plannedEndDate: '', revisions: formRevisions([]), approveDate: '', status: 'Pending', remark: '', ...overrides });

const form = (overrides = {}) => ({
  title: '',
  assignedToId: '',
  description: 'item a',
  group: '',
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
const rounds = (...list) => formRevisions(list);
const noUploads = new Set();

/* ── the record ─────────────────────────────────────────────────────────── */

test('roll-up: an item with sub-drawings takes the widest window and the combined status', () => {
  const parent = item({
    plannedStartDate: '2026-02-01',
    plannedEndDate: '2026-03-01',
    subDrawings: [sub({ status: 'Approved', plannedStartDate: '2026-01-15', plannedEndDate: '2026-04-01', approveDate: '2026-03-20' }), sub({ status: 'In Progress', plannedEndDate: '2026-05-01' })],
  });
  const r = rollup(parent, TODAY);
  assert.equal(r.plannedStartDate, '2026-01-15');
  assert.equal(r.plannedEndDate, '2026-05-01');
  assert.equal(r.status, 'In Progress');
  assert.equal(r.subTotal, 2);
  assert.equal(r.subApproved, 1);
  assert.equal(r.overdue, true);
  assert.equal(rollUpStatuses(['Approved', 'Approved with Comments']), 'Approved with Comments');
  assert.equal(rollUpStatuses(['Approved', 'Rejected']), 'Rejected');
  assert.equal(rollUpStatuses(['Pending', 'Pending']), 'Pending');
  assert.deepEqual(summariseItems([parent, item({ status: 'Approved' })]), { drawings: 3, approved: 2 });
});

test('stage, overdue and cycle age', () => {
  assert.equal(drawingStage(item()), 'Planned');
  assert.equal(drawingStage(item({ revisions: rounds(round('R0', '2026-01-10', 'Under Review')) })), 'With Client');
  assert.equal(drawingStage(item({ status: 'Approved with Comments' })), 'Approved');
  assert.equal(drawingStage(item({ status: 'Rejected', revisions: rounds(round('R0', '2026-01-10', 'Rejected')) })), 'Rejected');
  assert.equal(isOverdue({ plannedEndDate: '2026-06-29', status: 'In Progress' }, TODAY), true);
  assert.equal(isOverdue({ plannedEndDate: '2026-06-29', status: 'Approved' }, TODAY), false);
  assert.equal(isOverdue({ plannedEndDate: '2026-06-30', status: 'Pending' }, TODAY), false);
  assert.equal(cycleAgeDays({ firstSubmittedOn: '2026-06-01' }, TODAY), 29);
  assert.equal(cycleAgeDays({}, TODAY), null);
});

test('rounds: the form always has R0–R3 and one empty round past the last used; storage drops trailing empties', () => {
  assert.deepEqual(formRevisions([]).map((r) => r.round), ['R0', 'R1', 'R2', 'R3']);
  const deep = formRevisions([round('R0', '2026-01-01', 'Rejected'), round('R4', '2026-05-01', 'Under Review')]);
  assert.deepEqual(deep.map((r) => r.round), ['R0', 'R1', 'R2', 'R3', 'R4', 'R5']);
  assert.equal(deep[4].submissionDate, '2026-05-01');
  assert.deepEqual(storedRevisions(deep).map((r) => r.round), ['R0', 'R1', 'R2', 'R3', 'R4']);
  assert.deepEqual(storedRevisions(formRevisions([])).map((r) => r.round), ['R0', 'R1', 'R2', 'R3']);
  const parent = item({ revisions: rounds(round('R0', '2026-01-01', 'Rejected'), round('R1', '2026-02-01', 'Under Review')), subDrawings: [sub({ revisions: rounds(round('R0', '2026-01-05', 'Rejected'), round('R1', '2026-02-01', 'Rejected'), round('R2', '2026-03-01', 'Under Review')) })] });
  assert.equal(latestRevisionAcrossItem(parent).round, 'R2');
});

test('the assignee may update their sub-drawing without Edit; nobody else may', () => {
  assert.equal(canEditSubDrawing({ assignedToId: 'u2' }, 'u2', false), true);
  assert.equal(canEditSubDrawing({ assignedToId: 'u2' }, 'u3', false), false);
  assert.equal(canEditSubDrawing({}, 'u3', true), true);
});

/* ── the save rules ─────────────────────────────────────────────────────── */

test('save rules: titles, planned window, dates in order and not in the future', () => {
  assert.match(drawingFormError(form(), { isSub: true, today: TODAY, uploads: noUploads }), /sub-drawing a title/);
  assert.match(drawingFormError(form({ description: 'x' }), { isSub: false, today: TODAY, uploads: noUploads }), /item description/);
  assert.match(drawingFormError(form({ plannedStartDate: '2026-05-01', plannedEndDate: '2026-04-01' }), { isSub: false, today: TODAY, uploads: noUploads }), /end date cannot be before/);
  assert.match(drawingFormError(form({ revisions: rounds(round('R0', '2026-07-01', 'Under Review')) }), { isSub: false, today: TODAY, uploads: new Set(['R0']) }), /R0 submission date cannot be in the future/);
  assert.match(drawingFormError(form({ revisions: rounds(round('R0', '2026-05-10', 'Under Review', '2026-05-01')) }), { isSub: false, today: TODAY, uploads: new Set(['R0']) }), /comments date cannot be before its submission date \(10\.05\.2026\)/);
  assert.match(drawingFormError(form({ revisions: rounds(round('R0', '', '', '2026-05-01')) }), { isSub: false, today: TODAY, uploads: noUploads }), /submission date before its comments date/);
  assert.match(drawingFormError(form({ approveDate: '2026-04-01', revisions: rounds(round('R0', '2026-05-01', 'Approved')) }), { isSub: false, today: TODAY, uploads: new Set(['R0']) }), /approve date cannot be before the first submission/);
  assert.match(drawingFormError(form({ approveDate: '2026-07-01' }), { isSub: false, today: TODAY, uploads: noUploads }), /approve date cannot be in the future/);
  assert.match(drawingFormError(form({ plannedStartDate: '2026-02-30' }), { isSub: false, today: TODAY, uploads: noUploads }), /valid date/);
});

test('save rules: the next round opens only after a rejection, and follows the round before it', () => {
  const twoRounds = (status) => form({ revisions: rounds(round('R0', '2026-05-01', status, '2026-05-10'), round('R1', '2026-05-20', 'Under Review')) });
  assert.match(drawingFormError(twoRounds('Under Review'), { isSub: false, today: TODAY, uploads: new Set(['R0', 'R1']) }), /Mark R0 as Rejected or Resubmission Required before recording R1/);
  assert.equal(drawingFormError(twoRounds('Resubmission Required'), { isSub: false, today: TODAY, uploads: new Set(['R0', 'R1']) }), null);
  const early = form({ revisions: rounds(round('R0', '2026-05-01', 'Rejected', '2026-05-10'), round('R1', '2026-05-05', 'Under Review')) });
  assert.match(drawingFormError(early, { isSub: false, today: TODAY, uploads: new Set(['R0', 'R1']) }), /R1 cannot be submitted before 10\.05\.2026/);
});

test('save rules: a new submission needs its drawing file; rounds already on record do not', () => {
  const submitted = form({ revisions: rounds(round('R0', '2026-05-01', 'Under Review')) });
  assert.match(drawingFormError(submitted, { isSub: false, today: TODAY, uploads: noUploads }), /Upload the drawing for R0/);
  assert.equal(drawingFormError(submitted, { isSub: false, today: TODAY, uploads: new Set(['R0']) }), null);
  const imported = { revisions: [round('R0', '2026-05-01', 'Under Review')] };
  assert.equal(drawingFormError(submitted, { isSub: false, previous: imported, today: TODAY, uploads: noUploads }), null);
  const withFile = form({ revisions: rounds(round('R0', '2026-05-01', 'Under Review', '', { filePath: 'x', fileName: 'a.pdf' })) });
  assert.equal(drawingFormError(withFile, { isSub: false, today: TODAY, uploads: noUploads }), null);
});

test('the stored record: trimmed, trailing rounds dropped, first submission set once and never moved', () => {
  const record = recordFromForm(form({ docNo: ' D-1 ', remark: ' r ', status: 'In Progress', revisions: rounds(round('R0', '2026-05-01', 'Under Review')) }), null);
  assert.equal(record.docNo, 'D-1');
  assert.equal(record.remark, 'r');
  assert.equal(record.firstSubmittedOn, '2026-05-01');
  assert.deepEqual(record.revisions.map((r) => r.round), ['R0', 'R1', 'R2', 'R3']);
  assert.equal(record.revisions[1].status, undefined);
  assert.equal(recordFromForm(form({ revisions: rounds(round('R0', '2026-05-01')) }), { firstSubmittedOn: '2026-04-01' }).firstSubmittedOn, '2026-04-01');
});

/* ── the register ───────────────────────────────────────────────────────── */

test('groups keep first-appearance order and gather late items; filters use the rolled-up status', () => {
  const a = item({ group: 'G1' });
  const b = item({ group: 'G2', status: 'Approved' });
  const c = item({ schedule: 'Civil' });
  const d = item({ group: 'G1', subDrawings: [sub({ title: 'foundation plan', status: 'Approved' })] });
  const groups = groupItems([a, b, c, d]);
  assert.deepEqual(groups.map((g) => [g.key, g.items.length]), [['Supply|Substation|G1', 2], ['Supply|Substation|G2', 1], ['Civil|Substation|', 1]]);
  assert.deepEqual(filterItems([a, b, c, d], { status: 'Approved' }, TODAY).map((x) => x.id), [b.id, d.id]);
  assert.deepEqual(filterItems([a, b, c, d], { q: 'foundation' }, TODAY).map((x) => x.id), [d.id]);
  assert.deepEqual(filterItems([a, b, c, d], { schedule: 'Civil' }, TODAY).map((x) => x.id), [c.id]);
  assert.deepEqual(nextNumbers([a, b, c, d], 'Supply', 'Substation'), { order: d.order + 1, slNo: String(Math.max(Number(a.slNo), Number(b.slNo), Number(d.slNo)) + 1) });
});

test('Excel: a row per item and per sub-drawing, a column set per round reached', async () => {
  const a = item({ revisions: rounds(round('R0', '2026-01-01', 'Resubmission Required', '2026-01-15'), round('R1', '2026-02-01', 'Under Review')), subDrawings: [sub({ title: 'sub a', assignedToName: 'user x' })] });
  const sheet = registerSheet([a, item()], { short: 'T1' }, TODAY);
  const headers = sheet.columns.map((column) => column.header);
  assert.ok(headers.includes('R1 status'));
  assert.ok(!headers.includes('R2 submitted'));
  assert.equal(sheet.rows.length, 3);
  assert.equal(sheet.rows[0].R0st, 'Resubmission Required');
  assert.ok(sheet.rows[0].R0s instanceof Date);
  assert.match(sheet.rows[1].description, /sub a/);
  assert.equal(sheet.rows[1].assignedTo, 'user x');
  assert.ok((await buildWorkbookBuffer([sheet])).byteLength > 1000);
});

/* ── access and schemas ─────────────────────────────────────────────────── */

test('access: All Projects sees every list; others only lists linked to a granted ERP project', () => {
  const engineer = resolveMdlAccess({ 'Master Drawing List.Drawings': ['View', 'Edit'] }, ['p1']);
  assert.equal(engineer.hasModule, true);
  assert.equal(engineer.inScope({ projectId: 'p1' }), true);
  assert.equal(engineer.inScope({ projectId: null }), false);
  assert.equal(engineer.can('Drawings', 'Edit', { projectId: 'p1' }), true);
  assert.equal(engineer.can('Drawings', 'Delete', { projectId: 'p1' }), false);
  assert.equal(engineer.can('Drawings', 'Edit', { projectId: 'p2' }), false);
  const scoped = resolveMdlAccess({ 'Master Drawing List': ['View Module'], 'Master Drawing List.Drawings.p1': ['Delete'] }, ['p1', 'p2']);
  assert.equal(scoped.can('Drawings', 'Delete', { projectId: 'p1' }), true);
  assert.equal(scoped.can('Drawings', 'Delete', { projectId: 'p2' }), false);
  const director = resolveMdlAccess({ 'Master Drawing List.All Projects': ['View'], 'Master Drawing List.Drawings': ['View'] }, []);
  assert.equal(director.inScope({ projectId: null }), true);
  assert.equal(resolveMdlAccess({}, ['p1']).hasModule, false);
});

test('API schemas', () => {
  const save = drawingSaveInputSchema.parse({ target: { kind: 'sub', subId: 's1', isNew: true }, form: form({ title: 'a' }) });
  assert.equal(save.target.kind, 'sub');
  assert.equal(drawingSaveInputSchema.safeParse({ target: { kind: 'item' }, form: form({ status: 'Done' }) }).success, false);
  assert.equal(drawingSaveInputSchema.safeParse({ target: { kind: 'item' }, form: form({ revisions: [round('R0', '01.05.2026')] }) }).success, false);
  const added = newItemInputSchema.parse({ projectCode: 'T1', schedule: 'Civil', scope: 'Substation', description: ' item a ', group: '' });
  assert.deepEqual(added, { projectCode: 'T1', schedule: 'Civil', scope: 'Substation', group: null, description: 'item a', docNo: '', drawingNo: '', plannedStartDate: '', plannedEndDate: '' });
});

test('today is the date in India', () => {
  assert.equal(todayIst(new Date('2026-06-30T20:00:00Z')), '2026-07-01');
  assert.equal(todayIst(new Date('2026-06-30T10:00:00Z')), '2026-06-30');
});

/* ── Excel import ───────────────────────────────────────────────────────── */

const sheetOf = (headings, rows) => ({ headings, rows: rows.map((cells, index) => ({ n: index + 2, cells })) });
const itemRow = (overrides) => ({
  'Item ID': 'a1', Project: 'S1', Schedule: 'Supply', Scope: 'Substation', Group: 'g1', 'Sl. No. (as in workbook)': '1', Description: 'item a',
  'Drg / Doc No.': null, 'Planning date': null, 'Proposed approval date': null, 'Approved on': null, 'Status in workbook': null,
  'Status (derived from dates)': null, Remarks: null, 'Entries to correct': null, Source: 'book › sheet › 5', ...overrides,
});
const grid = () => ({
  Projects: sheetOf(PROJECT_COLUMNS, [{ Code: 'T1', 'Short name': 'S1', 'Full name': 'list one', Client: null, 'Drawing no. prefix': null }]),
  Items: sheetOf(ITEM_COLUMNS, [
    itemRow({ 'Item ID': 'a1', 'Status (derived from dates)': 'Under review', 'Planning date': '01.01.2026', 'Proposed approval date': '01.03.2026', 'Drg / Doc No.': 'D-1' }),
    itemRow({ 'Item ID': 'a2', 'Status in workbook': 'APPROVED', 'Approved on': '05.03.2026' }),
    itemRow({ 'Item ID': 'a3', 'Status in workbook': 'VENDOR NOT FINALISED', 'Planning date': '31.02.2026' }),
    itemRow({ 'Item ID': 'a1', Description: 'duplicate' }),
    itemRow({ 'Item ID': 'a4', Project: 'nowhere' }),
    itemRow({ 'Item ID': 'a5', Schedule: 'Other' }),
    itemRow({ 'Item ID': 'a/6' }),
    itemRow({ 'Item ID': 'a7' }),
  ]),
  Revisions: sheetOf(REVISION_COLUMNS, [
    { 'Item ID': 'a1', Revision: 'R0', 'Submitted on': '2026-01-10', 'Comments received on': null },
    { 'Item ID': 'a2', Revision: 'R0', 'Submitted on': '10.01.2026', 'Comments received on': '20.01.2026' },
    { 'Item ID': 'a2', Revision: 'R1', 'Submitted on': '01.02.2026', 'Comments received on': null },
    { 'Item ID': 'a7', Revision: 'R0', 'Submitted on': '2026-02-01', 'Comments received on': '2026-02-15' },
    { 'Item ID': 'zz', Revision: 'R0', 'Submitted on': '2026-01-01', 'Comments received on': null },
    { 'Item ID': 'a1', Revision: 'first', 'Submitted on': null, 'Comments received on': null },
  ]),
});

test('import reads the three sheets with the reference rules and reports what it skipped', () => {
  const parsed = parseImport(grid());
  assert.deepEqual(parsed.items.map((entry) => entry.id), ['a1', 'a2', 'a3', 'a7']);
  assert.equal(parsed.revisionCount, 5);
  assert.equal(derive(parsed.items[1].core).status, 'approved');
  const problems = parsed.problems.join('\n');
  assert.match(problems, /"31\.02\.2026" is not a date/);
  assert.match(problems, /\(a1\): duplicate Item ID/);
  assert.match(problems, /\(a4\): project is not on the Projects sheet/);
  assert.match(problems, /\(a5\): schedule, scope or description/);
  assert.match(problems, /\(a\/6\): the Item ID contains "\/"/);
  assert.match(problems, /zz is not on the Items sheet/);
  assert.match(problems, /Revisions row 7: needs an Item ID and a revision such as R0/);
  assert.throws(() => parseImport({ Items: grid().Items, Revisions: grid().Revisions }), (error) => error instanceof ImportFormatError && /Sheet "Projects" is missing/.test(error.message));
});

test('import becomes the register record: round statuses and the overall status from the dates', () => {
  const [a1, a2, a3, a7] = parseImport(grid()).items.map((entry) => toDrawingItem(entry.core));
  assert.deepEqual(a1.revisions.map((r) => [r.round, r.submissionDate, r.status]), [['R0', '2026-01-10', 'Under Review']]);
  assert.equal(a1.status, 'In Progress');
  assert.equal(a1.plannedStartDate, '2026-01-01');
  assert.equal(a1.plannedEndDate, '2026-03-01');
  assert.equal(a1.drawingNo, 'D-1');
  assert.equal(a1.firstSubmittedOn, '2026-01-10');
  assert.deepEqual(a2.revisions.map((r) => [r.round, r.status, r.commentsDate]), [['R0', 'Resubmission Required', '2026-01-20'], ['R1', 'Approved', '']]);
  assert.equal(a2.status, 'Approved');
  assert.equal(a2.approveDate, '2026-03-05');
  assert.equal(a3.status, 'Pending');
  assert.deepEqual(a3.revisions, []);
  assert.equal(a3.legacy.status, 'VENDOR NOT FINALISED');
  assert.equal(a7.revisions[0].status, 'Resubmission Required');
  const summary = summariseImport(parseImport(grid()));
  assert.deepEqual([summary.totals.approved, summary.totals.under_review, summary.totals.comments_received, summary.totals.vendor_not_finalised], [1, 1, 1, 1]);
  assert.deepEqual([summary.overall.Approved, summary.overall['In Progress'], summary.overall.Pending], [1, 2, 1]);
});

test('the grid is read from a real exceljs workbook: dates, rich text and formula results', async () => {
  const ExcelJS = (await import('exceljs')).default;
  const book = new ExcelJS.Workbook();
  const projects = book.addWorksheet('Projects');
  projects.addRow(PROJECT_COLUMNS);
  projects.addRow(['T1', { richText: [{ text: 'S' }, { text: '1' }] }, 'list one', null, { formula: '"P"&"-"', result: 'P-' }]);
  const items = book.addWorksheet('Items');
  items.addRow(ITEM_COLUMNS);
  const values = { 'Item ID': 'a1', Project: 'S1', Schedule: 'Civil', Scope: 'Transmission Line', 'Sl. No. (as in workbook)': 7, Description: ' item a ', 'Approved on': new Date(Date.UTC(2026, 2, 5)) };
  items.addRow(ITEM_COLUMNS.map((h) => values[h] ?? null));
  book.addWorksheet('Revisions').addRow(REVISION_COLUMNS);
  const read = gridFromWorkbook(book);
  assert.equal(read.Projects.rows[0].cells['Short name'], 'S1');
  assert.equal(read.Projects.rows[0].cells['Drawing no. prefix'], 'P-');
  assert.equal(read.Items.rows[0].cells['Approved on'], '2026-03-05');
  assert.equal(read.Items.rows[0].cells['Sl. No. (as in workbook)'], '7');
  assert.equal(parseImport(read).items[0].core.description, 'item a');
  assert.equal(cellText({ error: '#N/A' }), null);
});
