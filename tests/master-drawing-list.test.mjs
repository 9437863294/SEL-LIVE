// Master Drawing List: the status and date rules, the step list the item page offers, the register's
// headings, days, pending lists and Excel sheet, and project-scoped access. Pure functions only — the
// Admin-SDK flow is in tests/master-drawing-list-flow.test.mjs.
//
// The items below are abstract fixtures (codes like "T1", descriptions like "item a"), not drawing data.

import test from 'node:test';
import assert from 'node:assert/strict';

import { addApproval, addComments, addSubmission, derive, todayIst } from '../src/lib/master-drawing-list/derive.ts';
import { availableSteps, lastEventDate, nextRevision, stepError } from '../src/lib/master-drawing-list/steps.ts';
import {
  countByStatus,
  daysFor,
  filterItems,
  groupForRegister,
  matchesSearch,
  pendingLists,
  registerSheet,
  summarise,
} from '../src/lib/master-drawing-list/register.ts';
import { resolveMdlAccess } from '../src/lib/master-drawing-list/access.ts';
import { detailsInputSchema, newItemInputSchema, submissionInputSchema } from '../src/lib/master-drawing-list/schemas.ts';
import { buildWorkbookBuffer } from '../src/lib/report-excel.ts';

const TODAY = '2026-06-30';

const rev = (n, submittedOn, commentedOn = null) => ({ rev: n, submittedOn, commentedOn, transmittalNo: null });

let nextOrder = 0;
function item(overrides = {}) {
  const core = {
    projectCode: 'T1',
    schedule: 'Supply',
    scope: 'Substation',
    group: null,
    order: ++nextOrder,
    slNo: String(nextOrder),
    description: `item ${nextOrder}`,
    drgNo: null,
    plannedSubmission: null,
    targetApproval: null,
    vendorFinalised: true,
    onHold: false,
    revisions: [],
    approved: false,
    approvedOn: null,
    remarks: null,
    legacy: null,
    ...overrides,
  };
  return { ...core, ...derive(core), id: `i${core.order}`, updatedAt: null, updatedBy: null };
}

test('status follows the last dated event', () => {
  assert.equal(item({ vendorFinalised: false }).status, 'vendor_not_finalised');
  assert.equal(item({ vendorFinalised: false }).heldBy, 'Procurement');
  assert.equal(item().status, 'not_submitted');
  assert.equal(item().heldBy, 'SEL');
  assert.equal(item({ revisions: [rev(0, '2026-01-10')] }).status, 'under_review');
  assert.equal(item({ revisions: [rev(0, '2026-01-10')] }).heldBy, 'Client');
  assert.equal(item({ revisions: [rev(0, '2026-01-10', '2026-02-01')] }).status, 'comments_received');
  assert.equal(item({ revisions: [rev(0, '2026-01-10', '2026-02-01'), rev(1, '2026-03-01')] }).status, 'under_review');
  assert.equal(item({ revisions: [rev(0, '2026-01-10')], approved: true, approvedOn: '2026-02-01' }).status, 'approved');
  assert.equal(item({ revisions: [rev(0, '2026-01-10')], onHold: true }).status, 'on_hold');
});

test('a new submission is the last revision plus one, R0 first', () => {
  const fresh = item();
  const first = addSubmission(fresh, '2026-01-10', 'T/1', TODAY);
  assert.equal(first.ok, true);
  assert.deepEqual(first.value, [{ rev: 0, submittedOn: '2026-01-10', commentedOn: null, transmittalNo: 'T/1' }]);
  const later = addSubmission(item({ revisions: [rev(0, '2026-01-10', '2026-02-01'), rev(1, '2026-03-01', '2026-03-20')] }), '2026-04-01', null, TODAY);
  assert.equal(later.value.at(-1).rev, 2);
  assert.equal(nextRevision(item({ revisions: [rev(0, '2026-01-10', '2026-02-01')] })), 1);
});

test('dates may not be in the future or earlier than the last recorded date', () => {
  const sent = item({ revisions: [rev(0, '2026-03-01')] });
  assert.match(addComments(sent, '2026-07-01', TODAY).error, /future/);
  assert.match(addComments(sent, '2026-02-28', TODAY).error, /earlier than the last recorded date \(01\.03\.2026\)/);
  assert.equal(addComments(sent, '2026-03-01', TODAY).ok, true);
  assert.match(addSubmission(item(), '2026-02-30', null, TODAY).error, /valid date/);
  assert.equal(lastEventDate(sent), '2026-03-01');
});

test('comments only on a revision under review; approval needs a submission and closes the item', () => {
  assert.match(addComments(item(), '2026-01-01', TODAY).error, /submission before recording comments/);
  assert.match(addComments(item({ revisions: [rev(0, '2026-01-10', '2026-02-01')] }), '2026-03-01', TODAY).error, /already recorded/);
  assert.match(addApproval(item(), '2026-01-01', TODAY).error, /submission before recording the approval/);
  const approved = item({ revisions: [rev(0, '2026-01-10')], approved: true, approvedOn: '2026-02-01' });
  for (const result of [addSubmission(approved, '2026-03-01', null, TODAY), addComments(approved, '2026-03-01', TODAY), addApproval(approved, '2026-03-01', TODAY)]) {
    assert.match(result.error, /already approved/);
  }
});

test('the item page offers exactly the steps derive accepts', () => {
  const states = [
    item(),
    item({ vendorFinalised: false }),
    item({ revisions: [rev(0, '2026-01-10')] }),
    item({ revisions: [rev(0, '2026-01-10', '2026-02-01')] }),
    item({ revisions: [rev(0, '2026-01-10', '2026-02-01'), rev(1, '2026-03-01')] }),
    item({ revisions: [rev(0, null)] }),
    item({ revisions: [rev(0, '2026-01-10')], onHold: true }),
    item({ revisions: [rev(0, '2026-01-10')], approved: true, approvedOn: '2026-02-01' }),
  ];
  for (const state of states) {
    const offered = new Set(availableSteps(state));
    for (const step of ['submission', 'comments', 'approval']) {
      // A date that passes the date rules for every state above, so only the state decides.
      const accepted = stepError(state, step, TODAY, TODAY) === null;
      assert.equal(offered.has(step), accepted, `${step} on ${state.status} with revisions ${JSON.stringify(state.revisions)}`);
    }
  }
  assert.deepEqual(availableSteps(item({ revisions: [rev(0, '2026-01-10')] })), ['comments', 'approval', 'submission']);
  assert.deepEqual(availableSteps(item({ revisions: [rev(0, '2026-01-10', '2026-02-01')] })), ['submission', 'approval']);
  assert.deepEqual(availableSteps(item()), ['submission']);
});

test('register headings keep first-appearance order and gather late rows under their group', () => {
  const rows = [
    item({ schedule: 'Supply', scope: 'Substation', group: 'G1' }),
    item({ schedule: 'Supply', scope: 'Substation', group: 'G2' }),
    item({ schedule: 'Civil', scope: 'Substation', group: null }),
    item({ schedule: 'Supply', scope: 'Substation', group: 'G1' }),
  ];
  const sections = groupForRegister(rows);
  assert.deepEqual(sections.map((section) => section.key), ['Supply|Substation', 'Civil|Substation']);
  assert.deepEqual(sections[0].groups.map((group) => [group.group, group.items.length]), [['G1', 2], ['G2', 1]]);
  assert.equal(sections[0].count, 3);
  assert.equal(sections[1].groups[0].group, null);
});

test('search covers description, drawing number and group; filters combine', () => {
  const a = item({ description: 'Control panel', drgNo: 'D-100', group: 'Panels', schedule: 'Electrical' });
  assert.equal(matchesSearch(a, 'control d-100'), true);
  assert.equal(matchesSearch(a, 'PANELS'), true);
  assert.equal(matchesSearch(a, 'cable'), false);
  const b = item({ revisions: [rev(0, '2026-01-10')] });
  assert.deepEqual(filterItems([a, b], { schedule: 'Electrical' }).map((row) => row.id), [a.id]);
  assert.deepEqual(filterItems([a, b], { status: 'under_review' }).map((row) => row.id), [b.id]);
  assert.equal(countByStatus([a, b]).under_review, 1);
  assert.equal(countByStatus([a, b]).not_submitted, 1);
});

test('days: pending with client or SEL for open items, first submission to approval for approved ones', () => {
  assert.deepEqual(daysFor(item({ revisions: [rev(0, '2026-06-01')] }), TODAY), { days: 29, kind: 'client', since: '2026-06-01' });
  assert.deepEqual(daysFor(item({ revisions: [rev(0, '2026-05-01', '2026-06-20')] }), TODAY), { days: 10, kind: 'sel', since: '2026-06-20' });
  assert.deepEqual(
    daysFor(item({ revisions: [rev(0, '2026-01-01', '2026-01-15'), rev(1, '2026-02-01')], approved: true, approvedOn: '2026-03-02' }), TODAY),
    { days: 60, kind: 'cycle', since: '2026-01-01' },
  );
  assert.equal(daysFor(item(), TODAY), null);
});

test('pending lists: longest waiting first; vendor not finalised by project and group', () => {
  const older = item({ revisions: [rev(0, '2026-01-01')] });
  const newer = item({ revisions: [rev(0, '2026-06-01')] });
  const comments = item({ revisions: [rev(0, '2026-01-01', '2026-02-01')] });
  const v1 = item({ vendorFinalised: false, group: 'G1', projectCode: 'T2' });
  const v2 = item({ vendorFinalised: false, group: 'G1', projectCode: 'T1' });
  const lists = pendingLists([newer, older, comments, v1, v2], TODAY);
  assert.deepEqual(lists.review.map((entry) => entry.item.id), [older.id, newer.id]);
  assert.deepEqual(lists.comments.map((entry) => entry.item.id), [comments.id]);
  assert.deepEqual(lists.vendor.map((project) => [project.projectCode, project.count]), [['T1', 1], ['T2', 1]]);
});

test('dashboard summary bands waiting items and takes the median approval cycle', () => {
  const summary = summarise('T1', [
    item({ revisions: [rev(0, '2026-06-20')] }),
    item({ revisions: [rev(0, '2026-01-01')] }),
    item({ revisions: [rev(0, '2026-05-01', '2026-06-10')] }),
    item({ revisions: [rev(0, '2026-01-01')], approved: true, approvedOn: '2026-01-11' }),
    item({ revisions: [rev(0, '2026-01-01')], approved: true, approvedOn: '2026-01-31' }),
  ], TODAY);
  assert.equal(summary.total, 5);
  assert.deepEqual(summary.withClient, [1, 0, 0, 0, 1]);
  assert.deepEqual(summary.withSel, [0, 1, 0, 0, 0]);
  assert.equal(summary.oldestWithClient, 180);
  assert.equal(summary.medianCycleDays, 20);
});

test('Excel sheet: one submitted / comments / transmittal trio per revision, real dates', async () => {
  const rows = [item({ revisions: [rev(0, '2026-01-01', '2026-01-15'), { ...rev(1, '2026-02-01'), transmittalNo: 'T/9' }] }), item()];
  const sheet = registerSheet(rows, { short: 'T1' }, TODAY);
  const headers = sheet.columns.map((column) => column.header);
  assert.ok(headers.includes('R1 transmittal'));
  assert.ok(!headers.includes('R2 submitted'));
  assert.equal(sheet.rows.length, 2);
  assert.ok(sheet.rows[0].r0s instanceof Date);
  assert.equal(sheet.rows[0].r1t, 'T/9');
  assert.equal(sheet.name, 'MDL T1');
  const buffer = await buildWorkbookBuffer([sheet]);
  assert.ok(buffer.byteLength > 1000);
});

test('access: All Projects sees every list; others only lists linked to a granted ERP project', () => {
  const linked = { projectId: 'p1' };
  const other = { projectId: 'p2' };
  const unlinked = { projectId: null };
  const engineer = resolveMdlAccess({ 'Master Drawing List.Drawings': ['View', 'Edit'], 'Master Drawing List.Submissions': ['Record'] }, ['p1']);
  assert.equal(engineer.hasModule, true);
  assert.equal(engineer.inScope(linked), true);
  assert.equal(engineer.inScope(other), false);
  assert.equal(engineer.inScope(unlinked), false);
  assert.equal(engineer.can('Submissions', 'Record', linked), true);
  assert.equal(engineer.can('Approval', 'Record', linked), false);
  assert.equal(engineer.can('Drawings', 'Edit', other), false);

  const scoped = resolveMdlAccess({ 'Master Drawing List.Approval.p1': ['Record'], 'Master Drawing List': ['View Module'] }, ['p1', 'p2']);
  assert.equal(scoped.can('Approval', 'Record', linked), true);
  assert.equal(scoped.can('Approval', 'Record', other), false);

  const director = resolveMdlAccess({ 'Master Drawing List.All Projects': ['View'], 'Master Drawing List.Drawings': ['View'] }, []);
  assert.equal(director.inScope(unlinked), true);
  assert.equal(director.inScope(other), true);
  assert.equal(resolveMdlAccess({}, ['p1']).hasModule, false);
});

test('API schemas trim text, turn blanks into null and refuse bad dates', () => {
  assert.deepEqual(submissionInputSchema.parse({ date: '2026-01-10', transmittalNo: '  ' }), { date: '2026-01-10', transmittalNo: null });
  assert.equal(submissionInputSchema.safeParse({ date: '10.01.2026' }).success, false);
  const details = detailsInputSchema.parse({ drgNo: ' D-1 ', plannedSubmission: '', targetApproval: '2027-01-01', remarks: null, vendorFinalised: true, onHold: false });
  assert.deepEqual(details, { drgNo: 'D-1', plannedSubmission: null, targetApproval: '2027-01-01', remarks: null, vendorFinalised: true, onHold: false });
  const bad = newItemInputSchema.safeParse({ projectCode: 'T1', schedule: 'Other', scope: 'Substation', description: 'ab', vendorFinalised: true });
  assert.equal(bad.success, false);
  assert.deepEqual(bad.error.issues.map((issue) => issue.message).sort(), ['Choose a schedule.', 'Enter a description.']);
});

test('today is the date in India', () => {
  // 20:00 UTC on 30 June is already 1 July in India.
  assert.equal(todayIst(new Date('2026-06-30T20:00:00Z')), '2026-07-01');
  assert.equal(todayIst(new Date('2026-06-30T10:00:00Z')), '2026-06-30');
});

/* ── Excel import: the shared reader ───────────────────────────────────── */

const { parseImport, summariseImport, gridFromWorkbook, cellText, ImportFormatError, PROJECT_COLUMNS, ITEM_COLUMNS, REVISION_COLUMNS } = await import('../src/lib/master-drawing-list/import.ts');

const sheetOf = (headings, rows) => ({ headings, rows: rows.map((cells, index) => ({ n: index + 2, cells })) });
const itemRow = (overrides) => ({
  'Item ID': 'a1', Project: 'S1', Schedule: 'Supply', Scope: 'Substation', Group: 'g1', 'Sl. No. (as in workbook)': '1', Description: 'item a',
  'Drg / Doc No.': null, 'Planning date': null, 'Proposed approval date': null, 'Approved on': null, 'Status in workbook': null,
  'Status (derived from dates)': null, Remarks: null, 'Entries to correct': null, Source: 'book › sheet › 5', ...overrides,
});
const grid = () => ({
  Projects: sheetOf(PROJECT_COLUMNS, [{ Code: 'T1', 'Short name': 'S1', 'Full name': 'list one', Client: null, 'Drawing no. prefix': null }]),
  Items: sheetOf(ITEM_COLUMNS, [
    itemRow({ 'Item ID': 'a1', 'Status (derived from dates)': 'Under review' }),
    itemRow({ 'Item ID': 'a2', 'Status in workbook': 'APPROVED', 'Approved on': '05.03.2026' }),
    itemRow({ 'Item ID': 'a3', 'Status in workbook': 'VENDOR NOT FINALISED', 'Planning date': '31.02.2026' }),
    itemRow({ 'Item ID': 'a1', Description: 'duplicate' }),
    itemRow({ 'Item ID': 'a4', Project: 'nowhere' }),
    itemRow({ 'Item ID': 'a5', Schedule: 'Other' }),
    itemRow({ 'Item ID': 'a/6' }),
  ]),
  Revisions: sheetOf(REVISION_COLUMNS, [
    { 'Item ID': 'a1', Revision: 'R0', 'Submitted on': '2026-01-10', 'Comments received on': null },
    { 'Item ID': 'a2', Revision: 'R0', 'Submitted on': '10.01.2026', 'Comments received on': '20.01.2026' },
    { 'Item ID': 'a2', Revision: 'R1', 'Submitted on': '01.02.2026', 'Comments received on': null },
    { 'Item ID': 'zz', Revision: 'R0', 'Submitted on': '2026-01-01', 'Comments received on': null },
    { 'Item ID': 'a1', Revision: 'first', 'Submitted on': null, 'Comments received on': null },
  ]),
});

test('import reads projects, items and revisions with the reference rules', () => {
  const parsed = parseImport(grid());
  assert.deepEqual(parsed.projects, [{ code: 'T1', short: 'S1', name: 'list one', client: null, drgPrefix: null }]);
  assert.deepEqual(parsed.items.map((entry) => entry.id), ['a1', 'a2', 'a3']);
  assert.equal(parsed.revisionCount, 4);
  const [a1, a2, a3] = parsed.items;
  assert.equal(a1.core.order, 1);
  assert.equal(derive(a1.core).status, 'under_review');
  assert.deepEqual(a2.core.revisions.map((r) => [r.rev, r.submittedOn, r.commentedOn]), [[0, '2026-01-10', '2026-01-20'], [1, '2026-02-01', null]]);
  assert.equal(a2.core.approvedOn, '2026-03-05');
  assert.equal(derive(a2.core).status, 'approved');
  assert.equal(a3.core.vendorFinalised, false);
  assert.equal(a3.core.plannedSubmission, null);
  const problems = parsed.problems.join('\n');
  assert.match(problems, /"31\.02\.2026" is not a date/);
  assert.match(problems, /\(a1\): duplicate Item ID/);
  assert.match(problems, /\(a4\): project is not on the Projects sheet/);
  assert.match(problems, /\(a5\): schedule, scope or description/);
  assert.match(problems, /\(a\/6\): the Item ID contains "\/"/);
  assert.match(problems, /zz is not on the Items sheet/);
  assert.match(problems, /Revisions row 6: needs an Item ID and a revision such as R0/);

  const summary = summariseImport(parsed);
  assert.equal(summary.itemCount, 3);
  assert.equal(summary.totals.approved, 1);
  assert.equal(summary.totals.under_review, 1);
  assert.equal(summary.totals.vendor_not_finalised, 1);
  assert.equal(summary.projects[0].items, 3);
  assert.deepEqual(summary.differs, []);
});

test('import refuses a workbook without its sheets or columns', () => {
  assert.throws(() => parseImport({ Items: grid().Items, Revisions: grid().Revisions }), (error) => error instanceof ImportFormatError && /Sheet "Projects" is missing/.test(error.message));
  const broken = grid();
  broken.Items = sheetOf(ITEM_COLUMNS.filter((h) => h !== 'Description'), []);
  assert.throws(() => parseImport(broken), /Sheet "Items" has no column "Description"/);
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
  const revisions = book.addWorksheet('Revisions');
  revisions.addRow(REVISION_COLUMNS);
  const read = gridFromWorkbook(book);
  assert.deepEqual(Object.keys(read), ['Projects', 'Items', 'Revisions']);
  assert.equal(read.Projects.rows[0].cells['Short name'], 'S1');
  assert.equal(read.Projects.rows[0].cells['Drawing no. prefix'], 'P-');
  assert.equal(read.Items.rows[0].cells['Approved on'], '2026-03-05');
  assert.equal(read.Items.rows[0].cells['Sl. No. (as in workbook)'], '7');
  const parsed = parseImport(read);
  assert.equal(parsed.items[0].core.description, 'item a');
  assert.equal(parsed.items[0].core.approved, true);
  assert.equal(cellText({ error: '#N/A' }), null);
});
