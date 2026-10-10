import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  buildEApprovalExportSheets,
  eApprovalExportFilename,
  EXCEL_CELL_LIMIT,
  EXPORT_DATE_TIME_FORMAT,
  EXPORT_MONEY_FORMAT,
  fitExcelText,
  formatExportStamp,
  toExcelDate,
} from '../src/lib/e-approval-export.ts';
import { buildWorkbookBuffer } from '../src/lib/report-excel.ts';

/*
 * The register as an Excel workbook. What these tests pin: dates and amounts arrive as real dates
 * and numbers, every detail sheet follows the request sheet, and a confidential request the viewer
 * could not open gives up nothing beyond the summary the register already shows them.
 */

const user = (userId, userName) => ({ kind: 'User', userId, userName });

const request = (over = {}) => ({
  id: 'r1',
  referenceNo: 'EA/PRO/2026-27/00017',
  subject: 'Truck hire for tower materials',
  body: 'Vehicle hire charges for shifting tower materials.',
  approvalTypeName: 'Site Expense',
  status: 'Approved',
  pendingLabel: 'Approved',
  priority: 'Normal',
  requesterId: 'u-req',
  requesterName: 'Banamali Dash',
  departmentName: 'PROJECT',
  projectName: 'BOUDH-PHULBANI',
  amount: 23350,
  approvedAmount: 23350,
  requiredBy: '2026-09-30',
  createdAt: '2026-09-29T10:35:00.000Z',
  submittedAt: '2026-09-29T10:35:00.000Z',
  completedAt: '2026-09-30T13:01:00.000Z',
  ccUserIds: ['u-cc'],
  commentCount: 1,
  attachmentCount: 1,
  version: 1,
  ...over,
});

const step = (over = {}) => ({
  id: 's1',
  approvalId: 'r1',
  type: 'APPROVAL',
  name: 'SHAIKH ABDUR RAHEMAN',
  sequence: 1,
  depth: 0,
  parentStepId: null,
  originStepId: null,
  assignment: user('u2', 'Sidhartha Palo'),
  status: 'Completed',
  outcome: 'Approved',
  actedByName: 'Sidhartha Palo',
  startedAt: '2026-09-29T10:35:00.000Z',
  completedAt: '2026-09-30T13:01:00.000Z',
  approvedAmount: 23350,
  ...over,
});

const source = (over = {}) => ({
  requests: [request()],
  steps: [step()],
  events: [{ approvalId: 'r1', at: '2026-09-29T10:35:00.000Z', actorId: 'u-req', actorName: 'Banamali Dash', kind: 'Submit', summary: 'Submitted' }],
  comments: [{ id: 'c1', approvalId: 'r1', body: 'Please check the rate.', authorName: 'Sidhartha Palo', createdAt: '2026-09-30T06:30:00.000Z' }],
  attachments: [{ id: 'a1', approvalId: 'r1', name: 'quotation.pdf', uploadedByName: 'Banamali Dash', uploadedAt: '2026-09-29T10:30:00.000Z', size: 20480, url: 'https://storage.example/quotation.pdf?token=SECRET' }],
  ...over,
});

const options = (over = {}) => ({
  openable: new Set(['r1']),
  nameOf: (id) => ({ 'u-cc': 'Accounts Officer' })[id],
  linkFor: (id) => `https://app.example/e-approval/${id}`,
  listName: 'All Approvals',
  exportedBy: 'Ashish',
  exportedAt: new Date(2026, 9, 10, 14, 5),
  ...over,
});

const sheet = (sheets, name) => sheets.find((entry) => entry.name === name);

/* ── values ─────────────────────────────────────────────────────────────────────────────────── */

test('a timestamp lands in Excel at the same wall-clock time the app shows', () => {
  // exceljs writes a Date's UTC fields; shifted first, the UTC fields carry the local time.
  const local = new Date(2026, 3, 1, 10, 0);
  const cell = toExcelDate(local.toISOString());
  assert.equal(cell.getUTCHours(), 10);
  assert.equal(cell.getUTCMinutes(), 0);
  assert.equal(cell.getUTCDate(), 1);
});

test('a bare calendar day stays on its own day', () => {
  const cell = toExcelDate('2026-09-30');
  assert.equal(cell.getUTCFullYear(), 2026);
  assert.equal(cell.getUTCMonth(), 8);
  assert.equal(cell.getUTCDate(), 30);
  assert.equal(cell.getUTCHours(), 0);
});

test('a missing or broken date is an empty cell, not "Invalid Date"', () => {
  assert.equal(toExcelDate(null), null);
  assert.equal(toExcelDate(''), null);
  assert.equal(toExcelDate('not a date'), null);
});

test('a text longer than Excel accepts is cut, and says so', () => {
  const long = 'x'.repeat(EXCEL_CELL_LIMIT + 500);
  const cut = fitExcelText(long);
  assert.ok(cut.length <= EXCEL_CELL_LIMIT);
  assert.match(cut, /full text is on the request/);
  assert.equal(fitExcelText('short'), 'short');
});

test('the file is named after the list and the local date', () => {
  assert.equal(eApprovalExportFilename('All Approvals', new Date(2026, 9, 10)), 'E-Approval - All Approvals - 2026-10-10.xlsx');
  assert.equal(eApprovalExportFilename('Copied to Me', new Date(2026, 0, 5)), 'E-Approval - Copied to Me - 2026-01-05.xlsx');
  assert.equal(formatExportStamp(new Date(2026, 9, 10, 14, 5)), '10-Oct-2026 14:05');
});

/* ── the request sheet ──────────────────────────────────────────────────────────────────────── */

test('every request is a row, with amounts as numbers and people by name', () => {
  const [row] = sheet(buildEApprovalExportSheets(source(), options()), 'Requests').rows;
  assert.equal(row.reference, 'EA/PRO/2026-27/00017');
  assert.equal(row.amount, 23350);
  assert.equal(typeof row.amount, 'number', 'a number, so the column can be summed');
  assert.equal(row.currency, 'INR');
  assert.equal(row.cc, 'Accounts Officer');
  assert.equal(row.details, 'Yes');
  assert.match(row.proposal, /Vehicle hire/);
  assert.ok(row.created instanceof Date);
  assert.equal(row.link, 'https://app.example/e-approval/r1');
});

test('a request with no amount has no currency either', () => {
  const [row] = sheet(buildEApprovalExportSheets(source({ requests: [request({ amount: undefined, approvedAmount: undefined })] }), options()), 'Requests').rows;
  assert.equal(row.amount, null);
  assert.equal(row.currency, '');
});

test('an unsubmitted request is labelled Draft rather than left without a reference', () => {
  const [row] = sheet(buildEApprovalExportSheets(source({ requests: [request({ referenceNo: undefined, status: 'Draft' })] }), options()), 'Requests').rows;
  assert.equal(row.reference, 'Draft');
});

/* ── confidentiality ────────────────────────────────────────────────────────────────────────── */

test('a confidential request the viewer cannot open is listed but gives up nothing more', () => {
  const sheets = buildEApprovalExportSheets(
    source({ requests: [request({ confidential: true, rejectionReason: 'Salary revision not approved' })] }),
    options({ openable: new Set() }),
  );
  const [row] = sheet(sheets, 'Requests').rows;
  assert.equal(row.subject, 'Truck hire for tower materials', 'the summary the register already shows');
  assert.equal(row.details, 'No — not visible to you');
  assert.equal(row.proposal, '');
  assert.equal(row.rejectionReason, '');
  for (const name of ['Workflow', 'Activity', 'Comments', 'Attachments']) {
    assert.equal(sheet(sheets, name).rows.length, 0, `${name} must not carry a row for it`);
  }
  const about = sheet(sheets, 'About this export').rows.find((entry) => entry.field === 'Not visible to you');
  assert.match(about.value, /1 confidential request is listed with their summary only/);
});

test('details for a request not in the list are never written', () => {
  // A stray row from a broad query must not leak into the file.
  const sheets = buildEApprovalExportSheets(
    source({ steps: [step(), step({ id: 'sX', approvalId: 'other' })] }),
    options({ openable: new Set(['r1', 'other']) }),
  );
  assert.equal(sheet(sheets, 'Workflow').rows.length, 1);
});

test('attachments are listed by name, never by their download address', () => {
  const sheets = buildEApprovalExportSheets(source(), options());
  const [row] = sheet(sheets, 'Attachments').rows;
  assert.equal(row.file, 'quotation.pdf');
  assert.equal(row.sizeKb, 20);
  assert.ok(!JSON.stringify(sheets).includes('token=SECRET'), 'a storage URL carries its own access token');
});

/* ── the detail sheets ──────────────────────────────────────────────────────────────────────── */

test('every detail sheet follows the order of the request sheet', () => {
  const sheets = buildEApprovalExportSheets(
    source({
      requests: [request({ id: 'r2', referenceNo: 'EA/2' }), request({ id: 'r1', referenceNo: 'EA/1' })],
      steps: [step({ id: 'a', approvalId: 'r1' }), step({ id: 'b', approvalId: 'r2' })],
    }),
    options({ openable: new Set(['r1', 'r2']) }),
  );
  assert.deepEqual(sheet(sheets, 'Workflow').rows.map((row) => row.reference), ['EA/2', 'EA/1']);
});

test('the workflow sheet keeps the trail of who passed the file to whom', () => {
  const sheets = buildEApprovalExportSheets(
    source({
      steps: [
        step({
          reassignments: [
            { at: '2026-09-29T11:53:00.000Z', kind: 'Forward', byUserId: 'u1', byName: 'SHAIKH ABDUR RAHEMAN', from: user('u1', 'SHAIKH ABDUR RAHEMAN'), to: user('u3', 'S. K. Bhanja'), reason: 'Beyond my limit' },
          ],
        }),
        step({ id: 'v1', name: 'Clarification', type: 'CLARIFICATION', depth: 1, parentStepId: 's1' }),
      ],
    }),
    options(),
  );
  const rows = sheet(sheets, 'Workflow').rows;
  assert.match(rows[0].moves, /^Forwarded from SHAIKH ABDUR RAHEMAN to S\. K\. Bhanja by SHAIKH ABDUR RAHEMAN — Beyond my limit$/);
  assert.equal(rows[1].type, 'Clarification');
  assert.equal(rows[1].parent, 'SHAIKH ABDUR RAHEMAN');
  assert.equal(rows[1].level, 1);
});

test('the about sheet says what was exported, by whom and with which filters', () => {
  const rows = sheet(buildEApprovalExportSheets(source(), options({ filterSummary: 'Status: Approved' })), 'About this export').rows;
  const value = (field) => rows.find((row) => row.field === field)?.value;
  assert.equal(value('List'), 'All Approvals');
  assert.equal(value('Exported by'), 'Ashish');
  assert.equal(value('Exported on'), '10-Oct-2026 14:05');
  assert.equal(value('Filters on screen'), 'Status: Approved');
  assert.equal(value('Requests'), 1);
  assert.equal(value('Comments'), 1);
});

/* ── the real file ──────────────────────────────────────────────────────────────────────────── */

test('the workbook opens in Excel with real dates, real amounts and every sheet', async () => {
  const buffer = await buildWorkbookBuffer(buildEApprovalExportSheets(source(), options()));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.deepEqual(
    workbook.worksheets.map((ws) => ws.name),
    ['Requests', 'Workflow', 'Activity', 'Comments', 'Attachments', 'About this export'],
  );

  const requests = workbook.getWorksheet('Requests');
  const headers = requests.getRow(1).values.slice(1);
  const at = (header) => requests.getRow(2).getCell(headers.indexOf(header) + 1);
  assert.equal(at('Reference').value, 'EA/PRO/2026-27/00017');

  assert.equal(typeof at('Amount requested').value, 'number');
  assert.equal(at('Amount requested').numFmt, EXPORT_MONEY_FORMAT);

  assert.ok(at('Submitted').value instanceof Date, 'a date cell, so it sorts and filters by date');
  assert.equal(at('Submitted').numFmt, EXPORT_DATE_TIME_FORMAT);

  // The About sheet's value column mixes text and counts — and must not format a count as a date.
  const about = workbook.getWorksheet('About this export');
  // exceljs 3.x (what the repo pins) has no getRows; walk the rows by number.
  let countRow;
  for (let index = 2; index <= about.rowCount; index += 1) {
    if (about.getRow(index).getCell(1).value === 'Requests') countRow = about.getRow(index);
  }
  assert.equal(countRow.getCell(2).value, 1);
  assert.ok(!countRow.getCell(2).numFmt || !/[dmy]/i.test(countRow.getCell(2).numFmt));
});
