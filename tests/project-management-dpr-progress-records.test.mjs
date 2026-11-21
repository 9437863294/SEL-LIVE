import assert from 'node:assert/strict';
import test from 'node:test';

const {
  dprRecordBoqLines,
  dprProgressRecordState,
  dprRecordDeleteAction,
  dprRecordEditAction,
  dprRecordLineFigures,
  dprRecordMatches,
  dprRecordSlNos,
  sortDprProgressRecords,
} = await import('../src/lib/project-management-dpr-progress-records.ts');

const line = (over = {}) => ({
  id: 'l',
  boqItemId: 'pcc',
  boqSlNo: '2.2',
  erpSlNo: '',
  description: 'PCC M10',
  unit: 'Cum',
  plannedQty: 10,
  actualQty: 10,
  ...over,
});

const entry = (over = {}) => ({
  id: 'Civil-2026-11-20',
  scope: 'Civil',
  date: '2026-11-20',
  status: 'Draft',
  lines: [line()],
  manpower: [],
  equipment: [],
  ...over,
});

test('a record is a draft, a reopened draft or submitted', () => {
  assert.equal(dprProgressRecordState(entry()), 'draft');
  assert.equal(dprProgressRecordState(entry({ status: 'Submitted' })), 'submitted');
  assert.equal(dprProgressRecordState(entry({ reopenedBy: 'u1' })), 'reopened');
  // Submitted again after a reopen: locked, whatever the reopen stamp says.
  assert.equal(dprProgressRecordState(entry({ status: 'Submitted', reopenedBy: 'u1' })), 'submitted');
});

test('records list newest day first, Civil before Erection on one day', () => {
  const sorted = sortDprProgressRecords([
    entry({ id: 'a', date: '2026-11-18', scope: 'Erection' }),
    entry({ id: 'b', date: '2026-11-20', scope: 'Erection' }),
    entry({ id: 'c', date: '2026-11-20', scope: 'Civil' }),
    entry({ id: 'd', date: '2026-11-19', scope: 'Civil' }),
  ]);
  assert.deepEqual(sorted.map((record) => record.id), ['c', 'b', 'd', 'a']);
});

test('SL Nos list each BOQ line once, in recorded order', () => {
  const slNos = dprRecordSlNos(
    entry({
      lines: [
        line({ boqItemId: 'b', boqSlNo: '3.1' }),
        line({ boqItemId: 'a', boqSlNo: '2.2' }),
        // The same line at a second location.
        line({ boqItemId: 'b', boqSlNo: '3.1', location: 'Block B' }),
        line({ boqItemId: 'c', boqSlNo: '', erpSlNo: 'E-7' }),
        line({ boqItemId: 'd', boqSlNo: '', erpSlNo: '' }),
      ],
    }),
  );
  assert.deepEqual(slNos, ['3.1', '2.2', 'E-7', '—']);
  assert.deepEqual(dprRecordSlNos({ lines: undefined }), []);
});

test('BOQ lines carry their description and how many rows they have on the sheet', () => {
  const lines = dprRecordBoqLines(
    entry({
      lines: [
        line({ boqItemId: 'b', boqSlNo: '3.1', description: ' Excavation ' }),
        line({ boqItemId: 'b', boqSlNo: '3.1', location: 'Block B' }),
        line({ boqItemId: 'a', boqSlNo: '2.2' }),
      ],
    }),
  );
  assert.deepEqual(lines, [
    { key: 'b', slNo: '3.1', description: 'Excavation', rows: 2 },
    { key: 'a', slNo: '2.2', description: 'PCC M10', rows: 1 },
  ]);
});

test('search matches date, scope, people, notes and lines; every word must match', () => {
  const record = entry({ preparedByName: 'R. Das', remarks: 'Slab cast', lines: [line()] });
  assert.equal(dprRecordMatches(record, ''), true);
  assert.equal(dprRecordMatches(record, '2026-11'), true);
  assert.equal(dprRecordMatches(record, 'civil pcc'), true);
  assert.equal(dprRecordMatches(record, 'das'), true);
  assert.equal(dprRecordMatches(record, 'slab'), true);
  assert.equal(dprRecordMatches(record, '2.2'), true);
  assert.equal(dprRecordMatches(record, 'civil erection'), false);
});

test('a line is read against the plan snapshot saved with it', () => {
  assert.deepEqual(dprRecordLineFigures(line({ plannedQty: 10, actualQty: 10 })), {
    planned: 10,
    actual: 10,
    entered: true,
    variance: 0,
    standing: 'met',
  });
  assert.equal(dprRecordLineFigures(line({ plannedQty: 10, actualQty: 12 })).standing, 'ahead');
  const behind = dprRecordLineFigures(line({ plannedQty: 10, actualQty: 7.5 }));
  assert.equal(behind.standing, 'behind');
  assert.equal(behind.variance, -2.5);
  assert.equal(dprRecordLineFigures(line({ plannedQty: 0, actualQty: 4 })).standing, 'unplanned');
  assert.equal(dprRecordLineFigures(line({ plannedQty: 0, actualQty: 0 })).standing, 'none');
  // A draft saved with the Actual box left empty.
  const blank = dprRecordLineFigures(line({ plannedQty: 10, actualQty: 0, actualEntered: false }));
  assert.equal(blank.standing, 'not-entered');
  assert.equal(blank.variance, null);
  // Older lines carry no actualEntered and read as entered.
  assert.equal(dprRecordLineFigures(line({ actualEntered: undefined })).entered, true);
  // Rounding noise reads as met.
  assert.equal(dprRecordLineFigures(line({ plannedQty: 0.1 + 0.2, actualQty: 0.3 })).standing, 'met');
});

test('editing: open sheets need Add; submitted ones a DPR approver, reopened first', () => {
  const all = { canRecord: true, canReopen: true, canDelete: true };
  assert.deepEqual(dprRecordEditAction(entry(), all), { allowed: true, reopenFirst: false, reason: null });
  assert.equal(dprRecordEditAction(entry(), { ...all, canRecord: false }).allowed, false);

  const submitted = entry({ status: 'Submitted' });
  assert.deepEqual(dprRecordEditAction(submitted, all), { allowed: true, reopenFirst: true, reason: null });
  const noReopen = dprRecordEditAction(submitted, { ...all, canReopen: false });
  assert.equal(noReopen.allowed, false);
  assert.match(noReopen.reason, /DPR approver/);
  // Reopening alone is not enough: the sheet is then edited, which is the Add action.
  const noAdd = dprRecordEditAction(submitted, { ...all, canRecord: false });
  assert.equal(noAdd.allowed, false);
  assert.match(noAdd.reason, /Add action/);
});

test('deleting needs the Delete action and never takes a submitted sheet', () => {
  const all = { canRecord: true, canReopen: true, canDelete: true };
  assert.equal(dprRecordDeleteAction(entry(), all).allowed, true);
  assert.equal(dprRecordDeleteAction(entry({ reopenedBy: 'u1' }), all).allowed, true);
  const noDelete = dprRecordDeleteAction(entry(), { ...all, canDelete: false });
  assert.equal(noDelete.allowed, false);
  assert.match(noDelete.reason, /Delete action/);
  const locked = dprRecordDeleteAction(entry({ status: 'Submitted' }), all);
  assert.equal(locked.allowed, false);
  assert.match(locked.reason, /reopens it/);
});
