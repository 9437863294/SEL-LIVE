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
import { filterItems, groupItems, groupTitle, nestGroups, nextNumbers, registerSheet } from '../src/lib/master-drawing-list/register.ts';
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
  assert.match(drawingFormError(form(), { isSub: true, today: TODAY, uploads: noUploads }), /Sub-drawing Title is required/);
  // What the item is (description, group) is not on the drawing form: a status save never checks or changes it.
  assert.equal(drawingFormError(form({ description: 'x' }), { isSub: false, today: TODAY, uploads: noUploads }), null);
  assert.equal(drawingFormError(form(), { isSub: false, today: TODAY, uploads: noUploads, fields: { item: { group: { required: true } } } }), null);
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
  assert.deepEqual(groups.map((g) => [g.key, g.items.length]), [['Substation|Supply|G1', 2], ['Substation|Supply|G2', 1], ['Substation|Civil|', 1]]);
  assert.deepEqual(filterItems([a, b, c, d], { status: 'Approved' }, TODAY).map((x) => x.id), [b.id, d.id]);
  assert.deepEqual(filterItems([a, b, c, d], { q: 'foundation' }, TODAY).map((x) => x.id), [d.id]);
  assert.deepEqual(filterItems([a, b, c, d], { schedule: 'Civil' }, TODAY).map((x) => x.id), [c.id]);
  assert.deepEqual(nextNumbers([a, b, c, d], 'Supply', 'Substation'), { order: d.order + 1, slNo: String(Math.max(Number(a.slNo), Number(b.slNo), Number(d.slNo)) + 1) });
});

test('register: Scope › Schedule › Group, scopes and schedules in the configured order, groups as first seen', () => {
  const rows = [
    item({ scope: 'Transmission Line', schedule: 'Civil', group: 'T-G1' }),
    item({ schedule: 'Electrical', group: 'E-G1' }),
    item({ schedule: 'Supply', group: 'S-G2' }),
    item({ schedule: 'Supply', group: 'S-G1' }),
    item({ scope: 'Transmission Line', schedule: 'Supply' }),
    item({ scope: 'Unlisted', schedule: 'Civil', group: 'U-G1' }),
    item({ schedule: 'Supply', group: 'S-G2' }),
  ];
  const order = { scopes: ['Substation', 'Transmission Line'], schedules: ['Supply', 'Civil', 'Electrical'] };
  const groups = groupItems(rows, order);
  assert.deepEqual(groups.map((g) => g.key), [
    'Substation|Supply|S-G2',
    'Substation|Supply|S-G1',
    'Substation|Electrical|E-G1',
    'Transmission Line|Supply|',
    'Transmission Line|Civil|T-G1',
    'Unlisted|Civil|U-G1',
  ]);
  assert.equal(groups[0].items.length, 2, 'a late item joins its group');
  const tree = nestGroups(groups);
  assert.deepEqual(
    tree.map((scope) => [scope.scope, scope.items.length, scope.schedules.map((schedule) => [schedule.schedule, schedule.groups.length, schedule.items.length])]),
    [
      ['Substation', 4, [['Supply', 2, 3], ['Electrical', 1, 1]]],
      ['Transmission Line', 2, [['Supply', 1, 1], ['Civil', 1, 1]]],
      ['Unlisted', 1, [['Civil', 1, 1]]],
    ],
  );
  // Without a configured order, scopes and schedules come as first seen — still each scope together.
  assert.deepEqual(nestGroups(groupItems(rows)).map((scope) => scope.scope), ['Transmission Line', 'Substation', 'Unlisted']);
  assert.equal(groupTitle({ group: null }), 'Without a group');
  // The export follows the same order, Scope before Schedule.
  const sheet = registerSheet(rows, { short: 'T1' }, TODAY, order);
  assert.deepEqual(sheet.columns.slice(0, 3).map((column) => column.header), ['Scope', 'Schedule', 'Group']);
  assert.deepEqual(sheet.rows.map((row) => row.group), ['S-G2', 'S-G2', 'S-G1', 'E-G1', '', 'T-G1', 'U-G1']);
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
  assert.match(problems, /\(a4\): project "nowhere" is not on the Projects sheet \(use "S1" or "T1"\)/);
  assert.match(problems, /\(a5\): schedule "Other" is not one of Supply, Civil, Electrical/);
  assert.match(problems, /\(a\/6\): the Item ID contains "\/"/);
  assert.match(problems, /zz is not on the Items sheet/);
  assert.match(problems, /Revisions row 7: needs an Item ID and a revision such as R0/);
  assert.throws(() => parseImport({ Items: grid().Items, Revisions: grid().Revisions }), (error) => error instanceof ImportFormatError && /Sheet "Projects" is missing/.test(error.message));
});

test('import: items may name their list by code or short name; schedule and scope spellings map to the configured names', async () => {
  const { matchListName } = await import('../src/lib/master-drawing-list/settings.ts');
  assert.equal(matchListName(['Supply', 'Civil', 'Electrical'], 'Civil Works'), 'Civil');
  assert.equal(matchListName(['Supply', 'Civil', 'Electrical'], ' electrical works '), 'Electrical');
  assert.equal(matchListName(['Substation', 'Transmission Line'], 'Transmission line'), 'Transmission Line');
  assert.equal(matchListName(['Schedule I Supply', 'Schedule III Civil Works'], 'Supply'), 'Schedule I Supply');
  assert.equal(matchListName(['Civil', 'Civil Works'], 'civil works'), 'Civil Works', 'an exact name wins');
  assert.equal(matchListName(['Civil (Schedule II)', 'Civil (Schedule III)'], 'Civil'), null, 'two candidates: refused, not guessed');
  assert.equal(matchListName(['Supply', 'Civil'], 'Civil Supply'), null);
  assert.equal(matchListName(['Supply'], ''), null);

  const book = grid();
  book.Items = sheetOf(ITEM_COLUMNS, [
    itemRow({ 'Item ID': 'b1', Project: 't1', Schedule: 'Civil Works', Scope: 'substation' }),
    itemRow({ 'Item ID': 'b2', Project: 'S1', Schedule: 'Electrical Works', Scope: 'Transmission line' }),
    itemRow({ 'Item ID': 'b3', Project: 'T1', Schedule: 'Mechanical' }),
  ]);
  book.Revisions = sheetOf(REVISION_COLUMNS, [
    { 'Item ID': 'b1', Revision: 'R0', 'Submitted on': '2026-01-10', 'Comments received on': null },
    { 'Item ID': 'b3', Revision: 'R0', 'Submitted on': '2026-01-10', 'Comments received on': null },
  ]);
  const parsed = parseImport(book);
  assert.deepEqual(parsed.items.map((entry) => [entry.id, entry.core.projectCode, entry.core.schedule, entry.core.scope]), [
    ['b1', 'T1', 'Civil', 'Substation'],
    ['b2', 'T1', 'Electrical', 'Transmission Line'],
  ]);
  // The skipped row is reported once: not again for its revisions.
  assert.deepEqual(parsed.problems, ['Items row 4 (b3): schedule "Mechanical" is not one of Supply, Civil, Electrical (Settings › Schedules & Scopes); row skipped.']);
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

/* ── ball in court, turnaround, dashboard figures ───────────────────────── */

const { ballInCourt, roundTurnarounds } = await import('../src/lib/master-drawing-list/drawings.ts');
const { dashboardStats } = await import('../src/lib/master-drawing-list/analytics.ts');
const { courtCounts } = await import('../src/lib/master-drawing-list/register.ts');

test('ball in court: client while under review, SEL once comments are back, nobody before or after', () => {
  assert.deepEqual(ballInCourt(item(), TODAY), { court: 'not_started', since: null, days: null, round: null });
  assert.deepEqual(ballInCourt(item({ revisions: rounds(round('R0', '2026-06-01', 'Under Review')) }), TODAY), { court: 'client', since: '2026-06-01', days: 29, round: 'R0' });
  assert.deepEqual(ballInCourt(item({ revisions: rounds(round('R0', '2026-06-01', 'Resubmission Required', '2026-06-20')) }), TODAY), { court: 'sel', since: '2026-06-20', days: 10, round: 'R0' });
  assert.equal(ballInCourt(item({ revisions: rounds(round('R0', '2026-06-01', '', '2026-06-20')) }), TODAY).court, 'sel');
  assert.equal(ballInCourt(item({ status: 'Approved with Comments', revisions: rounds(round('R0', '2026-06-01', 'Approved with Comments')) }), TODAY).court, 'closed');
});

test('turnaround per round: client to comments (or approval on the last round), SEL to resubmit', () => {
  const record = { status: 'Approved', approveDate: '2026-03-10', revisions: [round('R0', '2026-01-01', 'Resubmission Required', '2026-01-15'), round('R1', '2026-01-25', 'Approved')] };
  assert.deepEqual(roundTurnarounds(record), [{ round: 'R0', client: 14, sel: 10 }, { round: 'R1', client: 44, sel: null }]);
});

test('dashboard: deliverables, courts, first-time approval, overdue against the review period, S-curve', () => {
  const items = [
    item({ status: 'Approved', approveDate: '2026-02-10', plannedStartDate: '2026-01-01', plannedEndDate: '2026-02-01', revisions: rounds(round('R0', '2026-01-05', 'Approved')) }),
    item({ status: 'In Progress', plannedStartDate: '2026-02-01', plannedEndDate: '2026-04-01', revisions: rounds(round('R0', '2026-05-01', 'Under Review')) }),
    item({ status: 'In Progress', revisions: rounds(round('R0', '2026-04-01', 'Resubmission Required', '2026-06-25')) }),
    item({ plannedStartDate: '2026-06-01' }),
    item({ subDrawings: [sub({ status: 'Approved', approveDate: '2026-03-01', revisions: rounds(round('R0', '2026-02-01', 'Resubmission Required', '2026-02-10'), round('R1', '2026-02-20', 'Approved')) }), sub({ title: 'b' })] }),
  ];
  const stats = dashboardStats(items, TODAY, { reviewDays: 30, resubmitDays: 7 });
  assert.equal(stats.items, 5);
  assert.equal(stats.units, 6);
  assert.deepEqual(stats.courts, { client: 1, sel: 1, not_started: 2, closed: 2 });
  assert.equal(stats.approvedPct, 33);
  assert.deepEqual(stats.firstTime, { approved: 2, atFirst: 1, pct: 50 });
  assert.equal(stats.avgRounds, 1.5);
  assert.equal(stats.overdue, 1);
  assert.equal(stats.lateToSubmit, 1);
  assert.equal(stats.clientOverdue, 1);
  assert.equal(stats.selOverdue, 0);
  assert.equal(dashboardStats(items, TODAY).clientOverdue, null);
  const june = stats.sCurve.find((point) => point.month === '2026-06');
  assert.deepEqual([june.plannedSubmission, june.actualSubmission, june.plannedApproval, june.actualApproval], [3, 4, 2, 2]);
  assert.ok(stats.outcomes.find((entry) => entry.round === 'R1').approved === 1);
  assert.deepEqual(courtCounts(items, TODAY), { client: 1, sel: 1, not_started: 2, closed: 2, overdue: 1 });
});

test('reports: progress per scope, schedule and group in the register order; the summary sheet and its total', async () => {
  const { progressOf, progressTree, progressSheet } = await import('../src/lib/master-drawing-list/analytics.ts');
  const items = [
    item({ scope: 'Transmission Line', schedule: 'Civil', group: 'Towers', plannedEndDate: '2026-01-01' }),
    item({ schedule: 'Supply', group: 'Panels', status: 'Approved', approveDate: '2026-02-10', revisions: rounds(round('R0', '2026-01-05', 'Approved')) }),
    item({ schedule: 'Supply', group: 'Panels', revisions: rounds(round('R0', '2026-05-01', 'Under Review')) }),
    item({ schedule: 'Electrical', subDrawings: [sub({ status: 'Approved', approveDate: '2026-03-01', revisions: rounds(round('R0', '2026-02-01', 'Approved')) }), sub({ title: 'b', revisions: rounds(round('R0', '2026-04-01', 'Resubmission Required', '2026-06-25')) })] }),
  ];
  const order = { scopes: ['Substation', 'Transmission Line'], schedules: ['Supply', 'Civil', 'Electrical'] };
  const tree = progressTree(items, TODAY, order);
  const flat = (rows) => rows.flatMap((row) => [[row.level, row.name, row.progress.drawings, row.progress.approved], ...flat(row.children)]);
  assert.deepEqual(flat(tree), [
    ['scope', 'Substation', 4, 2],
    ['schedule', 'Supply', 2, 1],
    ['group', 'Panels', 2, 1],
    ['schedule', 'Electrical', 2, 1],
    ['group', 'Without a group', 2, 1],
    ['scope', 'Transmission Line', 1, 0],
    ['schedule', 'Civil', 1, 0],
    ['group', 'Towers', 1, 0],
  ]);
  const substation = tree[0].progress;
  assert.deepEqual(substation, { items: 3, drawings: 4, approved: 2, client: 1, sel: 1, notStarted: 0, overdue: 0, pct: 50 });
  assert.equal(tree[1].progress.overdue, 1);

  const total = progressOf(items, TODAY);
  assert.deepEqual([total.items, total.drawings, total.approved, total.pct], [4, 5, 2, 40]);
  const sheet = progressSheet(tree, total, { short: 'T1' });
  assert.equal(sheet.rows.length, 9);
  assert.deepEqual(sheet.rows.map((row) => [row.level, row.scope, row.schedule, row.group]).slice(0, 3), [['Scope', 'Substation', '', ''], ['Schedule', 'Substation', 'Supply', ''], ['Group', 'Substation', 'Supply', 'Panels']]);
  assert.deepEqual(sheet.rows.at(-1), { level: 'Total', scope: '', schedule: '', group: '', items: 4, drawings: 5, approved: 2, client: 1, sel: 1, notStarted: 1, overdue: 1, pct: 0.4 });
  assert.ok((await buildWorkbookBuffer([sheet])).byteLength > 1000);
});

/* ── a project's own workbook ───────────────────────────────────────────── */

const { detectSheet, parseProjectWorkbook, looseDate, rolesForHeader } = await import('../src/lib/master-drawing-list/workbook-import.ts');

const rawSheet = (name, rows) => ({ name, rows: rows.map((cells, index) => ({ n: index + 1, cells })) });

test('workbook columns are worked out from their headings, comments dates belonging to the submission before', () => {
  assert.deepEqual(rolesForHeader(['SL NO', 'Description', 'Planning Date', 'Proposed Approval date', 'Drg/Doc No:', 'R0_submission', 'comments date', 'R1-SUBMISSION', 'R1-COMMENT', 'APPROVE DATE', 'Approval Status', 'REMARKS', 'Remarks']), [
    'slNo', 'description', 'plannedStart', 'plannedEnd', 'drgNo', 'sub:0', 'com:0', 'sub:1', 'com:1', 'approval', 'status', 'remarks', 'ignore',
  ]);
  const sheet = rawSheet('Civil', [['MASTER DRAWING LIST'], ['CIVIL_TRANSMISSION LINE'], ['Sl. No.', 'DESCRIPTION OF ITEMS', 'R0 SUBMISSION', 'COMMENTS DATE', 'R1 SUBMISSION', 'APPROVAL DATE']]);
  const mapping = detectSheet(sheet, 'list.xlsx');
  assert.equal(mapping.headerRow, 3);
  assert.equal(mapping.schedule, 'Civil');
  assert.equal(mapping.scope, 'Transmission Line');
  assert.equal(mapping.include, true);
  assert.equal(detectSheet(rawSheet('Sheet1', [['SL NO', 'Description']]), 'x.xlsx').include, false);
});

test('dates: Excel dates or DD.MM.YYYY text; a typed year 0026 is caught', () => {
  assert.deepEqual(looseDate('16.03.2026'), { date: '2026-03-16', problem: null });
  assert.deepEqual(looseDate('2026-03-16'), { date: '2026-03-16', problem: null });
  assert.deepEqual(looseDate('6/3/26'), { date: '2026-03-06', problem: null });
  assert.match(looseDate('26.03.0026').problem, /year 26/);
  assert.equal(looseDate('AS REQ').problem, null);
  assert.match(looseDate('pending').problem, /not a date/);
});

test('workbook rows: group headings, rounds, approval and the corrections to make', () => {
  const sheet = rawSheet('Supply', [
    ['MASTER DRAWING LIST'],
    ['SL NO', 'Description', 'R0_submission', 'comments date', 'R1_submission', 'Approval date', 'Approval Status'],
    [null, 'SUB-STATION'],
    ['1', 'item a', '16.03.2026', null, null, '20.03.2026', 'APPROVED'],
    ['2', 'item b', '26.03.0026', '04.04.2026', '17.04.2026', null, 'SUBMITTED'],
    ['A', 'EQUIPMENT'],
    ['3', 'item c', null, null, null, null, 'VENDOR NOT FINALISED'],
  ]);
  const mapping = detectSheet(sheet, 'list.xlsx');
  const parsed = parseProjectWorkbook([sheet], [mapping], 'T1', 'list.xlsx');
  assert.deepEqual(parsed.sheets, [{ sheet: 'Supply', items: 3, groups: 2, revisions: 3, sections: [] }]);
  const [a, b, c] = parsed.items;
  assert.equal(a.core.group, 'SUB-STATION');
  assert.equal(c.core.group, 'EQUIPMENT');
  assert.equal(derive(a.core).status, 'approved');
  assert.deepEqual(b.core.revisions.map((r) => [r.rev, r.submittedOn, r.commentedOn]), [[0, null, '2026-04-04'], [1, '2026-04-17', null]]);
  assert.equal(derive(c.core).status, 'vendor_not_finalised');
  assert.match(parsed.problems.join('\n'), /Supply row 5: R0 submission: "26\.03\.0026" has the year 26/);
  assert.ok(b.core.legacy.issues.some((issue) => /comments date without a submission/.test(issue)));
  assert.equal(a.id, parseProjectWorkbook([sheet], [mapping], 'T1', 'list.xlsx').items[0].id);
  assert.match(a.id, /^T1-/);
});

/* ── Settings: Schedules & Scopes, Field Control, Date Control ──────────── */

const settingsLib = await import('../src/lib/master-drawing-list/settings.ts');

test('Field Control: labels, shown and required; locked fields keep their place; hidden is never required', () => {
  const { fieldSetting, resolveFieldControl } = settingsLib;
  assert.deepEqual(fieldSetting({}, 'drawing', 'docNo'), { label: 'Doc No.', visible: true, required: false, locked: false });
  const control = resolveFieldControl({ drawing: { docNo: { label: ' Document No. ', required: true }, remark: { visible: false, required: true } }, item: { description: { label: 'Item', visible: false } }, bogus: { x: {} } });
  assert.deepEqual(fieldSetting(control, 'drawing', 'docNo'), { label: 'Document No.', visible: true, required: true, locked: false });
  assert.deepEqual(fieldSetting(control, 'drawing', 'remark'), { label: 'Remark', visible: false, required: false, locked: false });
  assert.deepEqual(fieldSetting(control, 'item', 'description'), { label: 'Item', visible: true, required: true, locked: true });
  assert.equal(fieldSetting({}, 'round', 'file').required, true);
  assert.equal(control.bogus, undefined);
});

test('Schedules & Scopes: names required and unique, one switched on; values on drawings keep their name', () => {
  const { masterValuesError, usedValueChange, resolveMasterData } = settingsLib;
  assert.deepEqual(resolveMasterData(null).schedules.map((v) => v.name), ['Supply', 'Civil', 'Electrical']);
  assert.match(masterValuesError('schedules', [{ id: 'a', name: 'X', active: true }, { id: 'b', name: 'x', active: true }]), /listed twice/);
  assert.match(masterValuesError('scopes', [{ id: 'a', name: 'X', active: false }]), /at least one scope switched on/);
  assert.equal(masterValuesError('scopes', [{ id: 'a', name: 'X', active: true }]), null);
  const before = [{ id: 's', name: 'Supply', active: true }, { id: 'c', name: 'Civil', active: true }];
  assert.match(usedValueChange(before, [{ id: 's', name: 'Supplies', active: true }, before[1]], { Supply: 3 }), /cannot be renamed/);
  assert.match(usedValueChange(before, [before[1]], { Supply: 3 }), /switch it off instead/);
  assert.equal(usedValueChange(before, [{ id: 's', name: 'Supply', active: false }, { id: 'c', name: 'Civil works', active: true }], { Supply: 3 }), null);
});

test('Date Control: the window, a list\'s own rule, and the wording', () => {
  const { dateWindow, dateRuleFor, describeDateRule, resolveDateControl } = settingsLib;
  const off = resolveDateControl(null);
  assert.deepEqual(dateWindow(off, 'submission', TODAY), { min: null, max: TODAY });
  const control = resolveDateControl({ enabled: true, backdateDays: 10, futureDays: 2, applyComments: false, projects: { T2: { enabled: true, backdateDays: 0, futureDays: 0 } } });
  assert.deepEqual(dateWindow(control, 'submission', TODAY), { min: '2026-06-20', max: '2026-07-02' });
  assert.deepEqual(dateWindow(control, 'comments', TODAY), { min: null, max: TODAY });
  assert.equal(dateRuleFor(control, 'T2').source, 'project');
  assert.deepEqual(dateWindow(dateRuleFor(control, 'T2'), 'approval', TODAY), { min: TODAY, max: TODAY });
  assert.equal(describeDateRule(control), 'Dates within the last 10 days, or up to 2 days ahead.');
});

test('saving: Field Control requirements and the Date Control window, only for dates entered now', () => {
  const { resolveFieldControl, resolveDateControl } = settingsLib;
  const fields = resolveFieldControl({ drawing: { docNo: { required: true } }, round: { transmittalNo: { required: true }, file: { required: false } } });
  const base = form({ docNo: 'D-1', revisions: rounds(round('R0', '2026-06-25', 'Under Review', '', { transmittalNo: 'T/1' })) });
  assert.equal(drawingFormError(base, { isSub: false, today: TODAY, uploads: noUploads, fields }), null);
  assert.match(drawingFormError({ ...base, docNo: '' }, { isSub: false, today: TODAY, uploads: noUploads, fields }), /Doc No\. is required/);
  assert.match(drawingFormError(form({ docNo: 'D-1', revisions: rounds(round('R0', '2026-06-25', 'Under Review')) }), { isSub: false, today: TODAY, uploads: noUploads, fields }), /R0: Transmittal No\. is required/);
  const dateRule = resolveDateControl({ enabled: true, backdateDays: 3 });
  assert.match(drawingFormError(base, { isSub: false, today: TODAY, uploads: noUploads, fields, dateRule }), /R0 submission date cannot be earlier than 27\.06\.2026/);
  // The same old date already on record is not held to the window.
  assert.equal(drawingFormError(base, { isSub: false, previous: { revisions: [round('R0', '2026-06-25', 'Under Review')] }, today: TODAY, uploads: noUploads, fields, dateRule }), null);
  const ahead = resolveDateControl({ enabled: true, backdateDays: 30, futureDays: 5 });
  assert.equal(drawingFormError(form({ revisions: rounds(round('R0', '2026-07-03', 'Under Review')) }), { isSub: false, today: TODAY, uploads: new Set(['R0']), dateRule: ahead }), null);
  assert.match(drawingFormError(form({ revisions: rounds(round('R0', '2026-07-08', 'Under Review')) }), { isSub: false, today: TODAY, uploads: new Set(['R0']), dateRule: ahead }), /cannot be later than 05\.07\.2026/);
});

test('import detection picks the configured schedule and scope names', () => {
  const lists = { schedules: ['Schedule I Supply', 'Schedule III Civil Works'], scopes: ['Substation', 'Transmission Line'] };
  const supply = detectSheet(rawSheet('Supply', [['SL NO', 'Description']]), 'x.xlsx', lists);
  assert.equal(supply.schedule, 'Schedule I Supply');
  const civil = detectSheet(rawSheet('Civil', [['TL'], ['SL NO', 'Description']]), 'x.xlsx', lists);
  assert.equal(civil.schedule, 'Schedule III Civil Works');
  assert.equal(civil.scope, 'Transmission Line');
});

test('a heading merged across the row switches schedule or scope part-way; placeholders are blank, not errors', () => {
  const sheet = rawSheet('civil', [
    ['Civil Works_Substation'],
    ['SL NO', 'Description', 'Planning Date', 'R0_submission', 'Approval date'],
    ['1', 'item a', 'AS REQ', '04.04.2025', '19.05.2025'],
    ['Electrical Works_Substation', 'Electrical Works_Substation', 'Electrical Works_Substation', 'Electrical Works_Substation', null],
    ['2', 'item b', '-', '04.04.2025', null],
    ['Civil Works_Transmission line', 'Civil Works_Transmission line', 'Civil Works_Transmission line', null, null],
    ['3', 'item c', null, '21.04.2025', null],
  ]);
  const parsed = parseProjectWorkbook([sheet], [detectSheet(sheet, 'x.xlsx')], 'T1', 'x.xlsx');
  assert.deepEqual(parsed.items.map((entry) => [entry.core.description, entry.core.schedule, entry.core.scope]), [
    ['item a', 'Civil', 'Substation'],
    ['item b', 'Electrical', 'Substation'],
    ['item c', 'Civil', 'Transmission Line'],
  ]);
  assert.deepEqual(parsed.sheets[0].sections, ['Electrical › Substation from row 4', 'Civil › Transmission Line from row 6']);
  assert.deepEqual(parsed.problems, []);
});

/* ── Excel Import: row check, skipped rows, saved column mappings ──────────── */

const { applyTemplates, headerSignature } = await import('../src/lib/master-drawing-list/workbook-import.ts');

test('the row check: every row read as item, heading or section, with the cells behind each problem; skipped rows stay out', () => {
  const sheet = rawSheet('Supply', [
    ['MASTER DRAWING LIST'],
    ['SL NO', 'Description', 'R0_submission', 'comments date', 'Approval date'],
    [null, 'EQUIPMENT'],
    ['1', 'item a', '16.03.2026', null, '20.03.2026'],
    ['2', 'item b', '26.03.0026', null, null],
    ['3', 'item c', '01.04.2026', null, null],
  ]);
  const mapping = detectSheet(sheet, 'list.xlsx');
  const parsed = parseProjectWorkbook([sheet], [mapping], 'T1', 'list.xlsx');
  assert.deepEqual(parsed.rows.map((row) => [row.n, row.kind, row.description, row.group]), [
    [3, 'group', 'EQUIPMENT', 'EQUIPMENT'],
    [4, 'item', 'item a', 'EQUIPMENT'],
    [5, 'item', 'item b', 'EQUIPMENT'],
    [6, 'item', 'item c', 'EQUIPMENT'],
  ]);
  const flagged = parsed.rows.find((row) => row.n === 5);
  assert.equal(flagged.issues.length, 1);
  assert.match(flagged.issues[0].text, /year 26/);
  assert.deepEqual(flagged.issues[0].cols, [2]);
  assert.deepEqual(parsed.rows.find((row) => row.n === 4).issues, []);

  const skipped = parseProjectWorkbook([sheet], [{ ...mapping, skipRows: [5] }], 'T1', 'list.xlsx');
  assert.deepEqual(skipped.items.map((entry) => entry.core.description), ['item a', 'item c']);
  assert.equal(skipped.rows.find((row) => row.n === 5).kind, 'skipped');
  assert.deepEqual(skipped.problems, []);
  // Ids come from the sheet, Sl. No. and description, so skipping a row does not change the others.
  assert.equal(skipped.items[1].id, parsed.items[2].id);
});

test('saved column mappings: matched by the heading row, same drawing list first, newest first', () => {
  const sheet = rawSheet('Supply', [['MDL'], ['SL NO', 'Item', 'First sent', 'Back on', null, null]]);
  assert.equal(headerSignature(sheet, 2), 'sl no|item|first sent|back on');
  assert.equal(headerSignature(sheet, 9), '');
  const detected = detectSheet(sheet, 'list.xlsx');
  const template = (overrides) => ({
    id: 'x',
    signature: 'sl no|item|first sent|back on',
    headerRow: 2,
    schedule: 'Civil',
    scope: 'Transmission Line',
    columns: ['slNo', 'description', 'sub:0', 'com:0'],
    projectCode: 'T1',
    sheetName: 'Supply',
    fileName: 'old.xlsx',
    savedAt: '2026-06-01T00:00:00.000Z',
    savedByName: 'user a',
    ...overrides,
  });
  const other = template({ id: 'other', projectCode: 'T2', schedule: 'Electrical', savedAt: '2026-06-20T00:00:00.000Z' });
  const own = template({ id: 'own' });
  const { mappings, applied } = applyTemplates([sheet], [detected], [other, own], 'T1');
  assert.equal(applied[0].id, 'own');
  assert.deepEqual([mappings[0].schedule, mappings[0].scope, mappings[0].columns, mappings[0].include], ['Civil', 'Transmission Line', ['slNo', 'description', 'sub:0', 'com:0'], true]);
  // Another list's layout is used when this list has none.
  assert.equal(applyTemplates([sheet], [detected], [other], 'T1').applied[0].id, 'other');
  // Different headings: the detected layout stands.
  const changed = rawSheet('Supply', [['MDL'], ['SL NO', 'Item', 'Sent']]);
  const result = applyTemplates([changed], [detectSheet(changed, 'list.xlsx')], [own], 'T1');
  assert.equal(result.applied[0], null);
  assert.deepEqual(result.mappings[0], detectSheet(changed, 'list.xlsx'));
});
