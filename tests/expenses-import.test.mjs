import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPENSE_IMPORT_COLUMNS,
  EXPENSE_IMPORT_TEMPLATE_HEADERS,
  allocateRequestNos,
  buildExpenseColumnMap,
  buildExpenseTemplateInstructions,
  detectHeaderRow,
  expenseFingerprint,
  formatRequestNo,
  localDateKeyOf,
  parseExpenseAmount,
  parseExpenseDate,
  parseExpenseImportRows,
  readExpenseSheet,
  resolveProject,
  resolveSubAccountHead,
  toDateKey,
  unmappedHeadings,
} from '../src/lib/expenses-import.ts';

const MASTERS = {
  projects: [
    { id: 'p1', projectName: '400kV Bhadla Line', siteCode: 'BHD-01' },
    { id: 'p2', projectName: 'Jaipur Substation', siteCode: 'JPR-02' },
  ],
  accountHeads: [
    { id: 'h1', name: 'Direct Expenses' },
    { id: 'h2', name: 'Administrative Expenses' },
  ],
  subAccountHeads: [
    { id: 's1', name: 'Site Consumables', headId: 'h1' },
    { id: 's2', name: 'Printing & Stationery', headId: 'h2' },
    { id: 's3', name: 'Orphan Sub-Head', headId: 'missing' },
  ],
};

const TODAY = new Date(2026, 8, 16); // 16 Sep 2026, local

/** Builds a sheet grid: heading row followed by the given data rows. */
const gridOf = (headings, ...rows) => [headings, ...rows];

const HEADINGS = [
  'Expense Date',
  'Project Name',
  'Amount',
  'Sub-Head of A/c',
  'Name of the Party',
  'Description',
  'Remarks',
];

const dataRow = (overrides = {}) => {
  const base = {
    'Expense Date': '15-07-2026',
    'Project Name': '400kV Bhadla Line',
    Amount: '25,000',
    'Sub-Head of A/c': 'Site Consumables',
    'Name of the Party': 'ABC Traders',
    Description: 'Cement for foundation',
    Remarks: '',
  };
  const merged = { ...base, ...overrides };
  return HEADINGS.map((heading) => merged[heading] ?? '');
};

/** Reads a grid and validates it in one go, the way the dialog does. */
const run = (grid, options = {}, mapOverrides = {}) => {
  const sheet = readExpenseSheet(grid);
  const columnMap = { ...buildExpenseColumnMap(sheet.headings), ...mapOverrides };
  return parseExpenseImportRows(sheet, columnMap, MASTERS, { today: TODAY, ...options });
};

/* ── column catalogue ────────────────────────────────────────────────────── */

test('the template headers are the column labels, in order', () => {
  assert.deepEqual(
    EXPENSE_IMPORT_TEMPLATE_HEADERS,
    EXPENSE_IMPORT_COLUMNS.map((column) => column.label),
  );
});

test('every column documents itself on the Instructions sheet', () => {
  const instructions = buildExpenseTemplateInstructions();
  assert.equal(instructions.length, EXPENSE_IMPORT_COLUMNS.length);
  assert.ok(instructions.every((row) => row.Notes && row['Accepted Values']));
  const required = instructions.filter((row) => row.Requirement === 'Mandatory').map((row) => row.Column);
  assert.deepEqual(required, ['Project Name', 'Amount', 'Sub-Head of A/c', 'Name of the Party', 'Description']);
});

test('Request No becomes mandatory when numbers come from the file', () => {
  const instructions = buildExpenseTemplateInstructions('file');
  const requestNo = instructions.find((row) => row.Column === 'Request No');
  assert.equal(requestNo.Requirement, 'Mandatory');
});

/* ── auto-mapping ────────────────────────────────────────────────────────── */

test('auto-mapping matches exact labels, aliases and near-misses', () => {
  const map = buildExpenseColumnMap([
    'Amount',
    'Particulars',
    'Vendor Name',
    'Site',
    'Sub-Head of A/c',
    'Voucher Date',
  ]);
  assert.equal(map.amount, 'Amount');
  assert.equal(map.description, 'Particulars');
  assert.equal(map.partyName, 'Vendor Name');
  assert.equal(map.projectName, 'Site');
  assert.equal(map.subHeadOfAccount, 'Sub-Head of A/c');
  assert.equal(map.date, 'Voucher Date');
});

test('a heading is claimed once, so Head of A/c cannot also answer for the sub-head', () => {
  const map = buildExpenseColumnMap(['Head of A/c', 'Sub-Head of A/c', 'Amount']);
  assert.equal(map.headOfAccount, 'Head of A/c');
  assert.equal(map.subHeadOfAccount, 'Sub-Head of A/c');
});

test('a sheet with only a head column leaves the sub-head unmapped rather than guessing', () => {
  const map = buildExpenseColumnMap(['Head of A/c', 'Amount']);
  assert.equal(map.headOfAccount, 'Head of A/c');
  assert.equal(map.subHeadOfAccount, undefined);
});

test('headings the mapping does not use are reported', () => {
  const headings = ['Amount', 'Sl No', 'Approved By'];
  const map = buildExpenseColumnMap(headings);
  assert.deepEqual(unmappedHeadings(headings, map), ['Sl No', 'Approved By']);
});

/* ── sheet reading ───────────────────────────────────────────────────────── */

test('the header row is found below a title and a blank line', () => {
  const grid = [['Expense Register — July 2026'], [], HEADINGS, dataRow()];
  assert.equal(detectHeaderRow(grid), 3);
  const sheet = readExpenseSheet(grid);
  assert.equal(sheet.headerRow, 3);
  assert.equal(sheet.rows.length, 1);
  assert.equal(sheet.rows[0].row, 4, 'row numbers match what the user sees in Excel');
});

test('blank spacer rows are skipped and a repeated heading stays addressable', () => {
  const sheet = readExpenseSheet([
    ['Amount', 'Amount', 'Description'],
    ['100', '200', 'first'],
    ['', '', ''],
    ['300', '400', 'second'],
  ]);
  assert.deepEqual(sheet.headings, ['Amount', 'Amount (2)', 'Description']);
  assert.equal(sheet.rows.length, 2);
  assert.equal(sheet.rows[1].row, 4);
  assert.equal(sheet.rows[0].cells['Amount (2)'], '200');
});

/* ── cell parsing ────────────────────────────────────────────────────────── */

test('amounts tolerate rupee symbols, lakh grouping and a trailing /-', () => {
  assert.equal(parseExpenseAmount('₹1,25,000/-'), 125000);
  assert.equal(parseExpenseAmount('Rs. 2500.50'), 2500.5);
  assert.equal(parseExpenseAmount('  0 '), 0);
  assert.equal(parseExpenseAmount(''), undefined);
  assert.equal(parseExpenseAmount('   '), undefined);
  assert.equal(parseExpenseAmount('n/a'), null);
});

test('a bracketed amount keeps its negative sign so it is rejected as one', () => {
  assert.equal(parseExpenseAmount('(500)'), -500);
});

test('dates are read in every format a register uses', () => {
  assert.equal(toDateKey(parseExpenseDate('2026-07-15')), '2026-07-15');
  assert.equal(toDateKey(parseExpenseDate('15-07-2026')), '2026-07-15');
  assert.equal(toDateKey(parseExpenseDate('15/07/2026')), '2026-07-15');
  assert.equal(toDateKey(parseExpenseDate('15-Jul-2026')), '2026-07-15');
  assert.equal(toDateKey(parseExpenseDate('15 July 2026')), '2026-07-15');
  assert.equal(toDateKey(parseExpenseDate('Jul 15, 2026')), '2026-07-15');
  assert.equal(toDateKey(parseExpenseDate('15-07-26')), '2026-07-15');
});

test('a date is built at local midnight, so the pivot report buckets it in the right month', () => {
  const parsed = parseExpenseDate('01-09-2026');
  assert.equal(parsed.getHours(), 0);
  assert.equal(parsed.getMonth(), 8);
  assert.equal(new Date(parsed.toISOString()).getMonth(), 8, 'survives the ISO round trip');
});

test('an Excel date serial is recognised', () => {
  assert.equal(toDateKey(parseExpenseDate('46218')), '2026-07-15');
});

test('an impossible date is rejected rather than rolled forward', () => {
  assert.equal(parseExpenseDate('31-02-2026'), null);
  assert.equal(parseExpenseDate('15-13-2026'), null);
  assert.equal(parseExpenseDate('sometime in July'), null);
  assert.equal(parseExpenseDate(''), undefined);
});

/* ── master resolution ───────────────────────────────────────────────────── */

test('a project resolves by name, site code or id, ignoring case and punctuation', () => {
  assert.equal(resolveProject('400KV BHADLA LINE', MASTERS.projects).id, 'p1');
  assert.equal(resolveProject('bhd 01', MASTERS.projects).id, 'p1');
  assert.equal(resolveProject('p2', MASTERS.projects).id, 'p2');
  assert.equal(resolveProject('Nowhere Line', MASTERS.projects), undefined);
  assert.equal(resolveProject('', MASTERS.projects), undefined);
});

test('a sub-head resolves by name, ignoring the ampersand and spacing', () => {
  assert.equal(resolveSubAccountHead('printing and stationery', MASTERS.subAccountHeads), undefined);
  assert.equal(resolveSubAccountHead('Printing &  Stationery', MASTERS.subAccountHeads).id, 's2');
});

/* ── row validation ──────────────────────────────────────────────────────── */

test('a clean sheet validates, derives the head of account and totals the amounts', () => {
  const result = run(gridOf(HEADINGS, dataRow(), dataRow({ Amount: '1,000', Description: 'Diesel' })));
  assert.equal(result.issues.length, 0);
  assert.equal(result.duplicates.length, 0);
  assert.equal(result.rows.length, 2);
  assert.equal(result.totalAmount, 26000);

  const [first] = result.rows;
  assert.equal(first.row, 2);
  assert.equal(first.draft.projectId, 'p1');
  assert.equal(first.draft.projectName, '400kV Bhadla Line');
  assert.equal(first.draft.subHeadOfAccount, 'Site Consumables');
  assert.equal(first.draft.headOfAccount, 'Direct Expenses');
  assert.equal(first.draft.amount, 25000);
  assert.equal(first.draft.receptionNo, '');
  assert.equal(first.draft.requestNo, undefined, 'numbers are allocated at import time, not here');
  assert.deepEqual(first.warnings, []);
  assert.equal(toDateKey(new Date(first.draft.createdAt)), '2026-07-15', 'reads back as the sheet date locally');
});

test('a blank expense date falls back to the date of the import', () => {
  const result = run(gridOf(HEADINGS, dataRow({ 'Expense Date': '' })));
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].draft.createdAt, TODAY.toISOString());
});

test('an unknown project or sub-head is rejected by name, not imported as Unknown', () => {
  const result = run(
    gridOf(
      HEADINGS,
      dataRow({ 'Project Name': 'Nowhere Line' }),
      dataRow({ 'Sub-Head of A/c': 'Tea & Snacks' }),
    ),
  );
  assert.equal(result.rows.length, 0);
  assert.equal(result.issues.length, 2);
  assert.match(result.issues[0].message, /Project "Nowhere Line" is not in SEL Live/);
  assert.equal(result.issues[0].field, 'Project Name');
  assert.match(result.issues[1].message, /Sub-head "Tea & Snacks" is not in the chart of accounts/);
});

test('a sub-head whose head of account is missing is reported instead of writing a blank head', () => {
  const result = run(gridOf(HEADINGS, dataRow({ 'Sub-Head of A/c': 'Orphan Sub-Head' })));
  assert.equal(result.rows.length, 0);
  assert.match(result.issues[0].message, /has no head of account/);
});

test('blank and unreadable required cells are each rejected with the reason', () => {
  const result = run(
    gridOf(
      HEADINGS,
      dataRow({ Amount: '' }),
      dataRow({ Amount: 'about 500' }),
      dataRow({ Amount: '(500)' }),
      dataRow({ 'Name of the Party': '' }),
      dataRow({ Description: '' }),
      dataRow({ 'Expense Date': '31-02-2026' }),
    ),
  );
  assert.equal(result.rows.length, 0);
  assert.deepEqual(
    result.issues.map((issue) => issue.message),
    [
      'Amount is blank.',
      'Amount "about 500" is not a number.',
      'Amount -500 is negative.',
      'Party name is blank.',
      'Description is blank.',
      'Expense date "31-02-2026" is not a date.',
    ],
  );
});

test('a head of account that disagrees with the sub-head is a warning, not a rejection', () => {
  const headings = [...HEADINGS, 'Head of A/c'];
  const grid = [
    headings,
    [...dataRow(), 'Administrative Expenses'],
    [...dataRow({ Description: 'Rebar' }), 'Direct Expenses'],
  ];
  const result = run(grid);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].draft.headOfAccount, 'Direct Expenses');
  assert.deepEqual(result.rows[0].warnings, [
    'Head "Administrative Expenses" replaced with "Direct Expenses" from the sub-head.',
  ]);
  assert.deepEqual(result.rows[1].warnings, [], 'a head that agrees is silent');
});

test('a zero amount, a future date and a half-filled reception are warned about', () => {
  const headings = [...HEADINGS, 'Reception No'];
  const grid = [
    headings,
    [...dataRow({ Amount: '0', 'Expense Date': '20-12-2026' }), 'REC/9'],
  ];
  const result = run(grid);
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0].warnings, [
    'Amount is zero.',
    'Expense date is in the future.',
    'Reception No has no reception date.',
  ]);
});

test("today's date is not treated as the future", () => {
  const result = run(gridOf(HEADINGS, dataRow({ 'Expense Date': '16-09-2026' })));
  assert.deepEqual(result.rows[0].warnings, []);
});

test('a required column that is not mapped stops the import with one message', () => {
  const grid = gridOf(['Expense Date', 'Amount', 'Description'], ['15-07-2026', '100', 'x']);
  const result = run(grid);
  assert.equal(result.rows.length, 0);
  assert.equal(result.issues.length, 1);
  assert.match(result.issues[0].message, /"Project Name", "Sub-Head of A\/c", "Name of the Party"/);
});

test('a sheet with headings but no rows says so', () => {
  const result = run([HEADINGS]);
  assert.equal(result.issues.length, 1);
  assert.match(result.issues[0].message, /no data rows/);
});

test('a mapping override is what gets validated, not the auto-map', () => {
  const grid = gridOf(
    ['Expense Date', 'Project Name', 'Amount', 'Sub-Head of A/c', 'Vendor', 'Payee', 'Description'],
    ['15-07-2026', '400kV Bhadla Line', '100', 'Site Consumables', 'Wrong Party', 'Right Party', 'x'],
  );
  const autoMapped = run(grid);
  assert.equal(autoMapped.rows[0].draft.partyName, 'Wrong Party');

  const overridden = run(grid, {}, { partyName: 'Payee' });
  assert.equal(overridden.rows[0].draft.partyName, 'Right Party');
  assert.deepEqual(overridden.unmappedHeadings, ['Vendor']);
});

/* ── duplicates ──────────────────────────────────────────────────────────── */

test('the same row twice in one file imports once', () => {
  const result = run(gridOf(HEADINGS, dataRow(), dataRow()));
  assert.equal(result.rows.length, 1);
  assert.equal(result.duplicates.length, 1);
  assert.equal(result.duplicates[0].row, 3);
  assert.match(result.duplicates[0].message, /already recorded/);
});

test('re-importing a sheet whose rows are already recorded imports nothing', () => {
  const first = run(gridOf(HEADINGS, dataRow(), dataRow({ Description: 'Diesel' })));
  const again = run(gridOf(HEADINGS, dataRow(), dataRow({ Description: 'Diesel' })), {
    existingFingerprints: first.rows.map((row) => row.fingerprint),
  });
  assert.equal(again.rows.length, 0);
  assert.equal(again.duplicates.length, 2);
});

test('two payments that differ in any field are both real', () => {
  const result = run(
    gridOf(
      HEADINGS,
      dataRow(),
      dataRow({ Amount: '25,001' }),
      dataRow({ 'Expense Date': '16-07-2026' }),
      dataRow({ 'Name of the Party': 'XYZ Traders' }),
    ),
  );
  assert.equal(result.rows.length, 4);
  assert.equal(result.duplicates.length, 0);
});

test('the fingerprint ignores case and punctuation in the party and description', () => {
  const base = {
    projectId: 'p1',
    amount: 100,
    partyName: 'ABC Traders',
    description: 'Cement bags',
    createdAt: new Date(2026, 6, 15, 9, 20).toISOString(),
  };
  assert.equal(
    expenseFingerprint(base),
    expenseFingerprint({ ...base, partyName: 'abc  traders.', description: 'Cement, bags' }),
  );
});

test('the fingerprint keys on the local calendar day, so a hand-keyed request and an imported one match', () => {
  const base = { projectId: 'p1', amount: 100, partyName: 'ABC Traders', description: 'Cement bags' };
  const handKeyed = expenseFingerprint({ ...base, createdAt: new Date(2026, 6, 15, 9, 20).toISOString() });
  const imported = expenseFingerprint({ ...base, createdAt: new Date(2026, 6, 15).toISOString() });
  assert.equal(handKeyed, imported);
  assert.notEqual(handKeyed, expenseFingerprint({ ...base, createdAt: new Date(2026, 6, 16).toISOString() }));
});

test('localDateKeyOf hands back an unparseable timestamp untouched rather than NaN', () => {
  assert.equal(localDateKeyOf('not a date'), 'not a date');
  assert.equal(localDateKeyOf(''), '');
  assert.equal(localDateKeyOf(new Date(2026, 6, 15, 23, 45).toISOString()), '2026-07-15');
});

/* ── numbers from the file ───────────────────────────────────────────────── */

test('in file mode the Request No column is required and read through', () => {
  const headings = ['Request No', ...HEADINGS];
  const grid = [headings, ['ACC/0007', ...dataRow()], ['', ...dataRow({ Description: 'Diesel' })]];
  const result = run(grid, { requestNoSource: 'file' });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].draft.requestNo, 'ACC/0007');
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].message, 'Request No is blank.');
});

test('file mode rejects a request number that already exists, or repeats in the file', () => {
  const headings = ['Request No', ...HEADINGS];
  const grid = [
    headings,
    ['ACC/0001', ...dataRow()],
    ['acc-0002', ...dataRow({ Description: 'Diesel' })],
    ['ACC/0002', ...dataRow({ Description: 'Sand' })],
  ];
  const result = run(grid, { requestNoSource: 'file', existingRequestNos: ['ACC/0001'] });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].draft.requestNo, 'acc-0002');
  assert.equal(result.duplicates.length, 2);
  assert.match(result.duplicates[0].message, /already exists/);
});

test('file mode does not fingerprint-skip two identically-keyed historical entries', () => {
  const headings = ['Request No', ...HEADINGS];
  const grid = [headings, ['ACC/0001', ...dataRow()], ['ACC/0002', ...dataRow()]];
  const result = run(grid, { requestNoSource: 'file' });
  assert.equal(result.rows.length, 2);
  assert.equal(result.duplicates.length, 0);
});

test('a missing Request No column in file mode stops the import', () => {
  const result = run(gridOf(HEADINGS, dataRow()), { requestNoSource: 'file' });
  assert.equal(result.rows.length, 0);
  assert.match(result.issues[0].message, /"Request No"/);
});

/* ── numbering ───────────────────────────────────────────────────────────── */

test('a request number is formatted exactly as the create form formats one', () => {
  const config = { prefix: 'ACC/', format: '2026-', suffix: '/A', startingIndex: 7 };
  assert.equal(formatRequestNo(config, 7), 'ACC/2026-0007/A');
  assert.equal(formatRequestNo({ startingIndex: 1 }, 12345), '12345');
});

test('a block of numbers is contiguous and reports where the counter lands', () => {
  const { requestNos, nextIndex } = allocateRequestNos({ prefix: 'ACC/', startingIndex: 9 }, 3);
  assert.deepEqual(requestNos, ['ACC/0009', 'ACC/0010', 'ACC/0011']);
  assert.equal(nextIndex, 12);
});

test('an unset counter starts at 1 and an empty import leaves it alone', () => {
  assert.deepEqual(allocateRequestNos({}, 2), { requestNos: ['0001', '0002'], nextIndex: 3 });
  assert.deepEqual(allocateRequestNos({ startingIndex: 5 }, 0), { requestNos: [], nextIndex: 5 });
});
