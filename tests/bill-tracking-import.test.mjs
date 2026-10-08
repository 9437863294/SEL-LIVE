import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildColumnMap,
  classifyDuplicate,
  detectHeaderRow,
  excelSerialToDateKey,
  excelTotals,
  matchProject,
  parseAmount,
  parseDateCell,
  parseImportRows,
  readSheetLayout,
  provisionalBillType,
  nameSimilarity,
} from '../src/lib/bill-tracking/import.ts';
import { flattenCellValue, pickBillSheet } from '../src/lib/bill-tracking/workbook.ts';
import { DEFAULT_CONFIG } from '../src/lib/bill-tracking/defaults.ts';

/** The legacy headings exactly as the 2026-27 workbook writes them, quirks included. */
const LEGACY_HEADINGS = [
  'Time Stamp', 'Sl. No.', ' Bill Sl No.', 'GST INVOICE No.', 'Date', 'Project Name', 'Description', 'Type of Bill Status',
  'Taxable Amount', 'GST Amount', 'Building Cess', 'Income TDS', 'CGST TDS', 'SGST TDS', 'Mob Adv', 'Int. on Mob',
  'RETENTION AGAINST \nCPBG', 'RETENTION AGAINST \nINVOICE', 'Ret. Time Ext.', 'LC Comm.', 'Other', 'Total Deduction', 'Net Amount',
  'Net Amount Received', 'Shortfall/ Surplus (Difference in Net Amount)', 'Date of Receipt of Payment', 'STATUS', 'TARGET WEEK',
  'RECEIVED WEEK', 'STAGES', 'REMARKS', 'TYPE OF V2', 'TAXABLE  / ADVANCE',
];
const col = (heading) => LEGACY_HEADINGS.findIndex((entry) => entry.replace(/\s+/g, ' ').trim() === heading);

const row = (values) => {
  const cells = Array(LEGACY_HEADINGS.length).fill(null);
  for (const [heading, value] of Object.entries(values)) cells[col(heading)] = value;
  return cells;
};

const PROJECTS = [
  { id: 'p-barmunda', name: 'TPNODL Baramunda' },
  { id: 'p-bag', name: 'BAGWWADDI,VIJAPURA & TARAVI', clientName: 'KPTCL' },
  { id: 'p-ghat', name: 'GHATTANATI,SANKARATI AND YELAPARRTI' },
];
const masters = {
  projects: PROJECTS,
  billTypes: DEFAULT_CONFIG.billTypes,
  billCategories: DEFAULT_CONFIG.billCategories,
  deductionTypes: DEFAULT_CONFIG.deductionTypes,
  projectMappings: [],
  tolerance: 1,
  roundNetToRupee: true,
  piMarker: 'PI',
};

const grid = (...rows) => [[{ date: '2026-10-03' }, null, null], LEGACY_HEADINGS, ...rows];

/* ── cells ───────────────────────────────────────────────────────────────── */

test('parses Indian number formats, signs and brackets', () => {
  assert.equal(parseAmount('1,25,00,000'), 12500000);
  assert.equal(parseAmount('12500000'), 12500000);
  assert.equal(parseAmount('₹1,25,00,000'), 12500000);
  assert.equal(parseAmount('-1,25,000'), -125000);
  assert.equal(parseAmount('(1,25,000)'), -125000);
  assert.equal(parseAmount('Rs. 500/-'), 500);
  assert.equal(parseAmount(1688145.42), 1688145.42);
  assert.equal(parseAmount(''), undefined);
  assert.equal(parseAmount('NA'), undefined);
  assert.equal(parseAmount({ formula: true }), undefined);
  assert.equal(parseAmount('12 lakh'), null);
  assert.equal(parseAmount('#REF!'), null);
});

test('converts Excel serials and every accepted date format', () => {
  assert.equal(excelSerialToDateKey(46133), '2026-04-21');
  assert.equal(parseDateCell(46133), '2026-04-21');
  assert.equal(parseDateCell('46133'), '2026-04-21');
  assert.equal(parseDateCell({ date: '2026-04-21' }), '2026-04-21');
  assert.equal(parseDateCell('2026-04-21T00:00:00.000Z'), '2026-04-21');
  assert.equal(parseDateCell('21-04-2026'), '2026-04-21');
  assert.equal(parseDateCell('21/04/2026'), '2026-04-21');
  assert.equal(parseDateCell('21-Apr-2026'), '2026-04-21');
  assert.equal(parseDateCell('31-02-2026'), null);
  assert.equal(parseDateCell(1500), null, 'a small number is not a date');
  assert.equal(parseDateCell(''), undefined);
});

test('flattens exceljs values: UTC dates, cached formula results, rich text', () => {
  assert.deepEqual(flattenCellValue(new Date(Date.UTC(2026, 3, 21))), { date: '2026-04-21' });
  assert.equal(flattenCellValue({ formula: 'W3-X3', result: 1735750 }), 1735750);
  assert.deepEqual(flattenCellValue({ sharedFormula: 'J3' }), { formula: true });
  assert.equal(flattenCellValue({ richText: [{ text: 'TPNODL-' }, { text: 'BARMUNDA' }] }), 'TPNODL-BARMUNDA');
  assert.equal(flattenCellValue({ formula: 'X', result: { error: '#REF!' } }), '#REF!');
});

/* ── layout ──────────────────────────────────────────────────────────────── */

test('finds the heading row below the title row and maps every legacy heading', () => {
  const sheet = grid();
  assert.equal(detectHeaderRow(sheet), 2);
  const layout = readSheetLayout(sheet);
  assert.equal(layout.unmapped.length, 0);
  assert.equal(layout.columnMap.importedNetAmount, col('Net Amount'));
  assert.equal(layout.columnMap.importedReceived, col('Net Amount Received'));
  assert.equal(layout.columnMap.otherDeduction, col('Other'));
  assert.equal(layout.columnMap.retentionCpbg, col('RETENTION AGAINST CPBG'));
  assert.equal(layout.columnMap.taxableOrAdvance, col('TAXABLE / ADVANCE'));
});

test('header variations still map', () => {
  const map = buildColumnMap(['bill no', 'INVOICE NUMBER', 'bill date', 'site', 'Taxable Value', 'gst', 'net receivable', 'amount received']);
  assert.deepEqual(
    { bill: map.billSerialNumber, invoice: map.gstInvoiceNumber, date: map.billDate, project: map.project, taxable: map.taxableAmount, gst: map.gstAmount, net: map.importedNetAmount, received: map.importedReceived },
    { bill: 0, invoice: 1, date: 2, project: 3, taxable: 4, gst: 5, net: 6, received: 7 },
  );
});

/* ── rows ────────────────────────────────────────────────────────────────── */

test('a normal legacy row parses, validates and reconciles', () => {
  const sheet = grid(
    row({
      'Sl. No.': 2, 'Bill Sl No.': 78, 'GST INVOICE No.': 'KA-001', Date: { date: '2026-04-24' }, 'Project Name': 'BAGWWADDI,VIJAPURA & TARAVI',
      Description: 'CIVIL', 'Type of Bill Status': 'CIVIL', 'Taxable Amount': 1688145.42, 'GST Amount': 303866, 'Building Cess': 19920,
      'Income TDS': 33763, 'CGST TDS': 16881.5, 'SGST TDS': 16881.5, 'RETENTION AGAINST INVOICE': 168815, 'Total Deduction': 256261,
      'Net Amount': 1735750, 'Shortfall/ Surplus (Difference in Net Amount)': 1735750, STATUS: 'NOT RECEIVED', 'TAXABLE / ADVANCE': 'BILL',
    }),
  );
  const { rows } = parseImportRows(sheet, readSheetLayout(sheet), masters);
  assert.equal(rows.length, 1);
  const [parsed] = rows;
  assert.equal(parsed.validation, 'valid', JSON.stringify(parsed.issues));
  assert.equal(parsed.projectId, 'p-bag');
  assert.equal(parsed.clientName, 'KPTCL');
  assert.equal(parsed.financialYear, '2026-27');
  assert.equal(parsed.billSerialNumber, '78');
  assert.equal(parsed.deductions.length, 5);
  assert.equal(parsed.calculated.net, 1735750);
  assert.equal(parsed.transactionType, 'invoice');
  assert.equal(parsed.billCategory, 'civil');
});

test('NA invoice, negative deductions and receipts on a compensation row', () => {
  const sheet = grid(
    row({
      'Sl. No.': 3, 'Bill Sl No.': 173, 'GST INVOICE No.': 'NA', Date: 46133, 'Project Name': 'GHATTANATI,SANKARATI AND YELAPARRTI',
      'Type of Bill Status': 'CROP COMPENSATION', 'GST Amount': { formula: true }, 'Mob Adv': -522037, 'Total Deduction': -522037, 'Net Amount': 522037,
      'Net Amount Received': 522037, 'Date of Receipt of Payment': { date: '2026-05-06' }, STATUS: 'RECEIVED',
    }),
  );
  const [parsed] = parseImportRows(sheet, readSheetLayout(sheet), masters).rows;
  assert.equal(parsed.gstInvoiceNumber, undefined);
  assert.equal(parsed.billDate, '2026-04-21');
  assert.equal(parsed.validation, 'valid', JSON.stringify(parsed.issues));
  assert.equal(parsed.calculated.net, 522037);
  assert.equal(parsed.calculated.status, 'received');
  assert.equal(parsed.receiptDate, '2026-05-06');
  assert.equal(parsed.billCategory, 'compensation');
});

test('credit notes are recognised from negative values', () => {
  const sheet = grid(
    row({ 'Bill Sl No.': '01', 'GST INVOICE No.': 'KA/CRN-01', Date: { date: '2026-07-30' }, 'Project Name': 'GHATTANATI,SANKARATI AND YELAPARRTI', 'Type of Bill Status': 'ERECTION', 'Taxable Amount': -70170, 'GST Amount': -12631, 'Net Amount': -82801 }),
  );
  const [parsed] = parseImportRows(sheet, readSheetLayout(sheet), masters).rows;
  assert.equal(parsed.transactionType, 'credit_note');
  assert.equal(parsed.calculated.net, -82801);
});

test('flags net mismatch, legacy status mismatch and errors without hiding them', () => {
  const sheet = grid(
    row({ Date: '24/04/2026', 'Project Name': 'BAGWWADDI,VIJAPURA & TARAVI', 'Type of Bill Status': 'SUPPLY', 'Taxable Amount': 100000, 'GST Amount': 18000, 'Net Amount': 117995, 'Net Amount Received': 83000, STATUS: 'RECEIVED' }),
    row({ Date: 'not a date', 'Project Name': '', 'Taxable Amount': 'twelve' }),
  );
  const { rows } = parseImportRows(sheet, readSheetLayout(sheet), masters);
  const codes = rows.map((parsed) => parsed.issues.map((issue) => issue.code));
  assert.ok(codes[0].includes('net_mismatch'));
  assert.ok(codes[0].includes('legacy_status_mismatch'));
  assert.equal(rows[0].validation, 'warning');
  assert.ok(codes[1].includes('invalid_date'));
  assert.ok(codes[1].includes('missing_project'));
  assert.ok(codes[1].includes('non_numeric'));
  assert.equal(rows[1].validation, 'error');
});

test('blank template rows and stale formula totals are not bills', () => {
  const sheet = grid(
    row({ 'GST Amount': { formula: true }, 'Total Deduction': { formula: true }, 'TAXABLE / ADVANCE': 'BILL' }),
    row({ 'Time Stamp': { date: '2023-11-24' }, 'Net Amount': 850228, 'Shortfall/ Surplus (Difference in Net Amount)': 850228, 'TAXABLE / ADVANCE': 'BILL' }),
  );
  const parsed = parseImportRows(sheet, readSheetLayout(sheet), masters);
  assert.equal(parsed.rows.length, 0);
  assert.equal(parsed.blankRows, 2);
  assert.deepEqual(parsed.staleRows, [{ row: 4, netAmount: 850228 }]);
});

/* ── projects ────────────────────────────────────────────────────────────── */

test('project mapping: normalised exact, fuzzy needs confirmation, remembered, unmatched', () => {
  assert.equal(matchProject('tpnodl baramunda', PROJECTS).kind, 'exact');
  const fuzzy = matchProject('TPNODL-BARMUNDA', PROJECTS);
  assert.equal(fuzzy.kind, 'fuzzy');
  assert.equal(fuzzy.project.id, 'p-barmunda');
  assert.ok(nameSimilarity('TPNODL-BARMUNDA', 'TPNODL Baramunda') > 0.8);
  assert.equal(matchProject('TPNODL-BARMUNDA', PROJECTS, [{ key: 'tpnodlbarmunda', excelName: 'TPNODL-BARMUNDA', projectId: 'p-barmunda', projectName: 'x' }]).kind, 'remembered');
  assert.equal(matchProject('MIZORAM SS-01', PROJECTS).kind, 'unmatched');

  const sheet = grid(row({ Date: { date: '2026-04-25' }, 'Project Name': 'TPNODL-BARMUNDA', 'Taxable Amount': 239231.78, 'GST Amount': 43062 }));
  const unconfirmed = parseImportRows(sheet, readSheetLayout(sheet), masters).rows[0];
  assert.equal(unconfirmed.validation, 'error', 'a fuzzy match is never applied silently');
  const confirmed = parseImportRows(sheet, readSheetLayout(sheet), masters, { confirmedFuzzy: ['tpnodlbarmunda'] }).rows[0];
  assert.equal(confirmed.projectId, 'p-barmunda');
  assert.equal(confirmed.validation, 'warning');
});

test('unknown bill types are proposed with an inferred category', () => {
  assert.deepEqual(
    { category: provisionalBillType('supply-35%').categoryId, retention: provisionalBillType('CIVIL-10%').isRetentionBill, pv: provisionalBillType('CIVIL-PV').isPriceVariation },
    { category: 'supply', retention: true, pv: true },
  );
});

/* ── duplicates ──────────────────────────────────────────────────────────── */

test('duplicates: exact, possible and statement lines that are not duplicates', () => {
  const line = (sl, type, amount, extra = {}) =>
    row({ 'Sl. No.': sl, 'Bill Sl No.': 12, 'GST INVOICE No.': 'Statement No-12', Date: { date: '2026-08-13' }, 'Project Name': 'BAGWWADDI,VIJAPURA & TARAVI', 'Type of Bill Status': type, 'RETENTION AGAINST INVOICE': amount, ...extra });
  const sheet = grid(line(108, 'SUPPLY-10%', -1556284.3), line(109, 'CIVIL-10%', -59579.97), line(110, 'ERECTION-10%', -59579.97), line(108, 'SUPPLY-10%', -1556284.3));
  const { rows } = parseImportRows(sheet, readSheetLayout(sheet), masters);
  const kinds = rows.map((parsed, index) => classifyDuplicate(parsed, [], rows.slice(0, index)).kind);
  assert.deepEqual(kinds, ['new', 'new', 'new', 'exact']);

  const existing = [{ id: 'b1', projectId: 'p-bag', billSerialNumber: '12', gstInvoiceNumber: 'Statement No-12', billDate: '2026-08-12', billTypeName: 'SUPPLY-10%', taxableAmount: 0, netReceivable: 1556284 }];
  assert.equal(classifyDuplicate(rows[0], existing, []).kind, 'possible');
  assert.equal(classifyDuplicate(rows[0], [{ ...existing[0], importFingerprint: rows[0].fingerprint }], []).kind, 'exact');
});

test('excel totals use the sheet’s own computed columns', () => {
  const sheet = grid(row({ Date: { date: '2026-04-24' }, 'Project Name': 'BAGWWADDI,VIJAPURA & TARAVI', 'Taxable Amount': 100, 'GST Amount': 18, 'Total Deduction': 0, 'Net Amount': 120, 'Net Amount Received': 20, 'Shortfall/ Surplus (Difference in Net Amount)': 100 }));
  const totals = excelTotals(parseImportRows(sheet, readSheetLayout(sheet), masters).rows);
  assert.deepEqual({ net: totals.net, received: totals.received, outstanding: totals.outstanding }, { net: 120, received: 20, outstanding: 100 });
});

test('picks the Bill Tracking sheet among the report sheets', () => {
  assert.equal(pickBillSheet(['Month wise summary report', 'Bill Tracking', 'NOT RECEIVED']), 'Bill Tracking');
});
