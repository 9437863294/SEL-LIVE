// Project Management's MDL register read as Master Drawing List drawing items (src/lib/mdl-drawing-items.ts):
// the mapping the PM page's Reports, ball in court and register export are built on.
//
// The records below are abstract fixtures (ids like "b1", descriptions like "item a"), not drawing data.

import test from 'node:test';
import assert from 'node:assert/strict';

import { PM_MDL_LEVELS, pmRegisterSheet, toDrawingItem, toDrawingItems } from '../src/lib/mdl-drawing-items.ts';
import { dashboardStats, progressOf, progressSheet, progressTree } from '../src/lib/master-drawing-list/analytics.ts';
import { ballInCourt, latestRevision, rollup } from '../src/lib/master-drawing-list/drawings.ts';

const TODAY = '2026-11-17';

const revision = (round, fields = {}) => ({ round, submissionDate: '', comments: '', commentsDate: '', ...fields });

const drawing = (fields = {}) => ({
  id: 'b1',
  boqItemId: 'b1',
  boqSlNo: '1',
  docNo: '',
  drawingNo: '',
  plannedStartDate: '',
  plannedEndDate: '',
  revisions: [revision('R0'), revision('R1'), revision('R2'), revision('R3')],
  approveDate: '',
  status: 'Pending',
  remark: '',
  ...fields,
});

const sub = (id, fields = {}) => ({
  id,
  title: `sub ${id}`,
  docNo: '',
  drawingNo: '',
  plannedStartDate: '',
  plannedEndDate: '',
  revisions: [revision('R0'), revision('R1'), revision('R2'), revision('R3')],
  approveDate: '',
  status: 'Pending',
  remark: '',
  ...fields,
});

test('a BOQ item becomes a drawing item: Scope 1 › Scope 2 › Category 1, its BOQ SL No, and its record', () => {
  const item = toDrawingItem(
    {
      item: { id: 'b1', Description: ' item a ', 'BOQ SL No': 7, 'Scope 1': 'S1', 'Scope 2': 'Supply', 'Category 1': 'C1' },
      drawing: drawing({ docNo: 'D-1', plannedEndDate: '2026-11-01', revisions: [revision('R0', { submissionDate: '2026-10-01', status: 'Under Review' })] }),
    },
    3,
    'p1',
  );
  assert.equal(item.id, 'b1');
  assert.equal(item.projectCode, 'p1');
  assert.deepEqual([item.scope, item.schedule, item.group, item.order, item.slNo, item.description], ['S1', 'Supply', 'C1', 3, '7', 'item a']);
  assert.equal(item.docNo, 'D-1');
  assert.equal(rollup(item, TODAY).overdue, true);
  assert.deepEqual(ballInCourt(item, TODAY), { court: 'client', since: '2026-10-01', days: 47, round: 'R0' });
});

test('an item never touched reads as an empty record, not submitted; blank scopes fall under Ungrouped', () => {
  const item = toDrawingItem({ item: { id: 'b2', Description: 'item b' } }, 0, 'p1');
  assert.deepEqual([item.scope, item.schedule, item.group], ['Ungrouped', 'Ungrouped', null]);
  assert.equal(item.status, 'Pending');
  assert.deepEqual(item.revisions, []);
  assert.deepEqual(item.subDrawings, []);
  assert.equal(ballInCourt(item, TODAY).court, 'not_started');
});

test('a round keeps its file (PM may hold only the download URL); a file alone is not a submission', () => {
  const item = toDrawingItem(
    { item: { id: 'b3' }, drawing: drawing({ revisions: [revision('R0', { fileUrl: 'https://example.test/f', fileName: 'f.pdf' })] }) },
    0,
    'p1',
  );
  assert.equal(item.revisions[0].filePath, 'https://example.test/f');
  assert.equal(item.revisions[0].fileName, 'f.pdf');
  assert.equal(latestRevision(item.revisions)?.round, 'R0');
  // The module's rule: the client holds a drawing from its submission date (or a verdict), not from an upload.
  assert.equal(ballInCourt(item, TODAY).court, 'not_started');
});

test('the dashboard counts sub-drawings, each with its own court; PM-only fields stay behind', () => {
  const rows = [
    {
      item: { id: 'b1', Description: 'item a', 'Scope 1': 'S1', 'Scope 2': 'Supply' },
      drawing: drawing({
        subDrawings: [
          sub('s1', { status: 'Approved', approveDate: '2026-11-10', revisions: [revision('R0', { submissionDate: '2026-11-01', status: 'Approved' })], collection: { receivedOn: '2026-10-20' } }),
          sub('s2', { revisions: [revision('R0', { submissionDate: '2026-11-01', status: 'Resubmission Required', commentsDate: '2026-11-07' })], assignedToId: 'u1', assignedToName: 'someone' }),
        ],
      }),
    },
    { item: { id: 'b2', Description: 'item b', 'Scope 1': 'S1', 'Scope 2': 'Civil' } },
  ];
  const items = toDrawingItems(rows, 'p1');
  assert.equal(items[0].subDrawings[1].assignedToName, 'someone');
  assert.equal('collection' in items[0].subDrawings[0], false);

  const stats = dashboardStats(items, TODAY);
  assert.equal(stats.items, 2);
  assert.equal(stats.units, 3);
  assert.deepEqual(stats.courts, { client: 0, sel: 1, not_started: 1, closed: 1 });
  assert.equal(stats.firstTime.pct, 100);

  const tree = progressTree(items, TODAY);
  assert.deepEqual(tree.map((scope) => [scope.name, scope.children.map((schedule) => schedule.name)]), [['S1', ['Supply', 'Civil']]]);
  const sheet = progressSheet(tree, progressOf(items, TODAY), { short: 'T1' }, PM_MDL_LEVELS);
  assert.deepEqual(sheet.columns.slice(1, 4).map((column) => column.header), ['Scope 1', 'Scope 2', 'Category 1']);
  assert.deepEqual([...new Set(sheet.rows.map((row) => row.level))], ['Scope 1', 'Scope 2', 'Category 1', 'Total']);
});

test('the register export: a row per item and sub-drawing, with its purchase orders, PM stage and ball in court', () => {
  const row = {
    item: { id: 'b1', Description: 'item a', 'BOQ SL No': '4', 'Scope 1': 'S1', 'Scope 2': 'Supply' },
    drawing: drawing({ subDrawings: [sub('s1'), sub('s2', { collection: { receivedOn: '2026-11-01' } })] }),
  };
  const sheet = pmRegisterSheet([{ row, item: toDrawingItem(row, 0, 'p1'), poNumbers: ['PO-1', 'PO-2'] }], 'Project T', TODAY);
  assert.equal(sheet.rows.length, 3);
  const [parent, first, second] = sheet.rows;
  assert.deepEqual([parent.slNo, parent.po, parent.stage, parent.court], ['4', 'PO-1, PO-2', '', '']);
  assert.deepEqual([first.description.trim(), first.stage, first.court, first.po], ['↳ sub s1', 'Awaiting Vendor', 'Not submitted', '']);
  assert.equal(second.stage, 'Ready for Review');
  assert.ok(sheet.columns.some((column) => column.header === 'R0 submitted'));
  assert.equal(sheet.columns.some((column) => column.header === 'R1 submitted'), false);
});
