import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allocateReceptionNos,
  buildRequisitionColumnMap,
  formatReceptionNo,
  parseDelimitedGrid,
  parseRequisitionDateTime,
  parseRequisitionImportRows,
  readRequisitionSheet,
  requisitionFingerprint,
  resolveRequisitionDepartment,
  resolveRequisitionProject,
} from '../src/lib/daily-requisition-import.ts';

/* ── the real register ───────────────────────────────────────────────────────────────────────────
 *
 * Verbatim from a live export, tabs and all. Kept exactly as pasted — including the header spelling
 * ("RECEPTION NO.", "DEP NO"), the thousands separators, the `DD/MM/YYYY HH:mm` timestamps and the
 * project name with a comma in it — because every one of those is something the importer has to
 * handle and a tidied-up fixture would stop testing.
 * ------------------------------------------------------------------------------------------------ */

const PASTED = [
  'TIMESTAMP\tRECEPTION NO.\tDEP NO\tDATE\tNARRATION\tGROSS AMOUNT\tPROJECT NAME\tDEPARTMENT\tNET AMOUNT',
  '26/03/2026 11:49\tSEL/2026-27/1\tPR NO-01\t01/04/2026\tHIMANSHU SAHOO\t4,000.00\tMADANPUR-RAMPUR\tPROJECT\t4,000.00',
  '26/03/2026 11:49\tSEL/2026-27/2\tPR NO-02\t01/04/2026\tMURALI KRISHANA\t28,500.00\tGHATTANATI,SANKARATI AND YELAPARRTI\tPROJECT\t28,500.00',
  '03/04/2026 12:12\tSEL/2026-27/3\tAD NO-01\t03/04/2026\tS K ENTERPRISES FOR THE MONTH OF MARCH 2026\t13,747.00\tHO\tADMIN\t13,747.00',
  '03/04/2026 12:13\tSEL/2026-27/4\tAD NO-02\t03/04/2026\tPAMOGLOX FACILITIES PVT LTD FOR THE MONTH OF MARCH 2026\t11,020.00\tHO\tADMIN\t11,020.00',
  '03/04/2026 12:13\tSEL/2026-27/5\tAD NO-03\t03/04/2026\tCHARCHIKA MANPOWER SERVICES FOR THE MONTH OF MARCH 2026\t12,760.00\tHO\tADMIN\t12,760.00',
  '03/04/2026 17:25\tSEL/2026-27/6\tPUR NO-01\t03/04/2026\tDIGAMBARI ROADWAYS\t35,000.00\tMADANPUR-RAMPUR\tPROCUREMENT\t35,000.00',
  '03/04/2026 17:46\tSEL/2026-27/7\tAD NO-04\t03/04/2026\tROYAL PEST SOLUTION FOR THE MONTH OF MARCH 2026\t2,950.00\tHO\tADMIN\t2,950.00',
  '04/04/2026 15:59\tSEL/2026-27/8\tTND NO-01\t04/04/2026\tPROCESSING FEE FOR CPC-59\t6,005.00\tHO\tTENDER\t6,005.00',
  '04/04/2026 17:00\tSEL/2026-27/9\tPR NO-03\t04/04/2026\tRELEASING OF ROW PAYMENT\t1,392,283.00\tGHATTANATI,SANKARATI AND YELAPARRTI\tPROJECT\t1,392,283.00',
  '04/04/2026 18:41\tSEL/2026-27/10\tPR NO-04\t04/04/2026\tHIMANSHU SAHOO\t4,000.00\tMADANPUR-RAMPUR\tPROJECT\t4,000.00',
  '06/04/2026 13:13\tSEL/2026-27/11\tPR NO-05\t06/04/2026\tM/S RAS ENGINEERING\t65,340.00\tBOUDH-PHULBANI\tPROJECT\t65,340.00',
].join('\n');

const MASTERS = {
  projects: [
    { id: 'p-madanpur', projectName: 'MADANPUR-RAMPUR' },
    { id: 'p-ghattanati', projectName: 'GHATTANATI,SANKARATI AND YELAPARRTI' },
    { id: 'p-ho', projectName: 'HO' },
    { id: 'p-boudh', projectName: 'BOUDH-PHULBANI' },
  ],
  departments: [
    { id: 'd-project', name: 'PROJECT' },
    { id: 'd-admin', name: 'ADMIN' },
    { id: 'd-procurement', name: 'PROCUREMENT' },
    { id: 'd-tender', name: 'TENDER' },
  ],
};

/** After the last row in the fixture, so nothing is flagged as future-dated. */
const TODAY = new Date(2026, 8, 18);

const runImport = (text = PASTED, options = {}, masters = MASTERS) => {
  const sheet = readRequisitionSheet(parseDelimitedGrid(text));
  return parseRequisitionImportRows(sheet, buildRequisitionColumnMap(sheet.headings), masters, {
    today: TODAY,
    ...options,
  });
};

/* ── pasting ─────────────────────────────────────────────────────────────────────────────────── */

test('a tab-separated paste becomes a grid', () => {
  const grid = parseDelimitedGrid(PASTED);
  assert.equal(grid.length, 12, 'one heading row and eleven entries');
  assert.equal(grid[0].length, 9);
  assert.equal(grid[1][1], 'SEL/2026-27/1');
});

test('a comma in a cell does not split it when the paste is tab-separated', () => {
  const grid = parseDelimitedGrid(PASTED);
  assert.equal(
    grid[2][6],
    'GHATTANATI,SANKARATI AND YELAPARRTI',
    'tabs are the delimiter here, so the commas inside the project name are content',
  );
  assert.equal(grid[2].length, 9, 'and the row still has nine cells, not ten');
});

test('quoted CSV keeps an embedded comma and unescapes doubled quotes', () => {
  const grid = parseDelimitedGrid('A,B\n"GHATTANATI,SANKARATI",2\n"say ""hi""",3');
  assert.deepEqual(grid[1], ['GHATTANATI,SANKARATI', '2']);
  assert.deepEqual(grid[2], ['say "hi"', '3']);
});

test('trailing blank lines and CRLF are tolerated', () => {
  assert.deepEqual(parseDelimitedGrid('A\tB\r\n1\t2\r\n\r\n'), [['A', 'B'], ['1', '2']]);
  assert.deepEqual(parseDelimitedGrid('   '), []);
});

/* ── mapping ─────────────────────────────────────────────────────────────────────────────────── */

test('every column of the real register maps itself, with nothing left over', () => {
  const sheet = readRequisitionSheet(parseDelimitedGrid(PASTED));
  const map = buildRequisitionColumnMap(sheet.headings);
  assert.deepEqual(map, {
    timestamp: 'TIMESTAMP',
    receptionNo: 'RECEPTION NO.',
    depNo: 'DEP NO',
    date: 'DATE',
    description: 'NARRATION',
    grossAmount: 'GROSS AMOUNT',
    projectName: 'PROJECT NAME',
    departmentName: 'DEPARTMENT',
    netAmount: 'NET AMOUNT',
  });
  assert.deepEqual(runImport().unmappedHeadings, []);
});

test('NARRATION goes to the narration, not to the party — the exact label claims it first', () => {
  const map = buildRequisitionColumnMap(['NARRATION', 'PARTY NAME']);
  assert.equal(map.description, 'NARRATION');
  assert.equal(map.partyName, 'PARTY NAME');
});

test('GROSS AMOUNT and NET AMOUNT are told apart rather than both taking "amount"', () => {
  const map = buildRequisitionColumnMap(['GROSS AMOUNT', 'NET AMOUNT']);
  assert.equal(map.grossAmount, 'GROSS AMOUNT');
  assert.equal(map.netAmount, 'NET AMOUNT');
});

test('a register with a single Amount column fills gross, and net follows it', () => {
  const result = runImport(
    ['RECEPTION NO.\tDATE\tNARRATION\tAMOUNT\tPROJECT NAME\tDEPARTMENT',
      'SEL/1\t01/04/2026\tHIMANSHU SAHOO\t4,000.00\tHO\tADMIN'].join('\n'),
  );
  assert.deepEqual(result.issues, []);
  assert.equal(result.rows[0].draft.grossAmount, 4000);
  assert.equal(result.rows[0].draft.netAmount, 4000, 'unverified entries start with net equal to gross');
});

/* ── the timestamp with a time in it ─────────────────────────────────────────────────────────── */

test('DD/MM/YYYY HH:mm parses, and keeps the time', () => {
  const parsed = parseRequisitionDateTime('26/03/2026 11:49');
  assert.equal(parsed.getFullYear(), 2026);
  assert.equal(parsed.getMonth(), 2, 'March — day first, not month first');
  assert.equal(parsed.getDate(), 26);
  assert.equal(parsed.getHours(), 11);
  assert.equal(parsed.getMinutes(), 49);
});

test('a 12-hour clock and seconds are understood', () => {
  assert.equal(parseRequisitionDateTime('03/04/2026 5:25 PM').getHours(), 17);
  assert.equal(parseRequisitionDateTime('03/04/2026 12:05 AM').getHours(), 0);
  assert.equal(parseRequisitionDateTime('03/04/2026 12:05 PM').getHours(), 12);
  assert.equal(parseRequisitionDateTime('03/04/2026 17:25:30').getSeconds(), 30);
});

test('a date with no time still parses, and blank stays blank', () => {
  assert.equal(parseRequisitionDateTime('01/04/2026').getDate(), 1);
  assert.equal(parseRequisitionDateTime('2026-04-01').getMonth(), 3);
  assert.equal(parseRequisitionDateTime('   '), undefined);
});

test('an unreadable value is null, not a silently wrong date', () => {
  assert.equal(parseRequisitionDateTime('not a date'), null);
  assert.equal(parseRequisitionDateTime('31/02/2026'), null, 'February has no 31st');
  assert.equal(parseRequisitionDateTime('01/04/2026 25:00'), null);
});

/* ── the whole import ────────────────────────────────────────────────────────────────────────── */

test('all eleven rows of the real register import, with nothing rejected', () => {
  const result = runImport();
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.duplicates, []);
  assert.equal(result.rows.length, 11);
});

test('the totals match the register', () => {
  const result = runImport();
  // 4,000 + 28,500 + 13,747 + 11,020 + 12,760 + 35,000 + 2,950 + 6,005 + 1,392,283 + 4,000 + 65,340
  assert.equal(result.totalGross, 1575605);
  assert.equal(result.totalNet, 1575605, 'nothing in this register has been deducted yet');
});

test('a row lands with the fields the entry sheet writes by hand', () => {
  const [first] = runImport().rows;
  assert.equal(first.row, 2, 'the row number is the one the user sees in their sheet');
  assert.equal(first.draft.receptionNo, 'SEL/2026-27/1');
  assert.equal(first.draft.depNo, 'PR NO-01');
  assert.equal(first.draft.projectId, 'p-madanpur');
  assert.equal(first.draft.departmentId, 'd-project');
  assert.equal(first.draft.description, 'HIMANSHU SAHOO');
  assert.equal(first.draft.grossAmount, 4000);
  assert.equal(first.draft.netAmount, 4000);
  assert.equal(first.draft.status, 'Pending');
});

test('date is the bill date and createdAt is the keying time — they are not the same day here', () => {
  const [first] = runImport().rows;
  assert.equal(new Date(first.draft.date).getDate(), 1, 'DATE 01/04/2026');
  assert.equal(new Date(first.draft.createdAt).getDate(), 26, 'TIMESTAMP 26/03/2026');
  assert.equal(new Date(first.draft.createdAt).getHours(), 11);
});

test('the narration doubles as the party name, since the register has no party column', () => {
  const rows = runImport().rows;
  assert.equal(rows[0].draft.partyName, 'HIMANSHU SAHOO');
  assert.equal(rows[2].draft.partyName, 'S K ENTERPRISES FOR THE MONTH OF MARCH 2026');
});

test('that can be turned off, leaving the party blank', () => {
  const rows = runImport(PASTED, { partyFromDescription: false }).rows;
  assert.equal(rows[0].draft.partyName, '');
  assert.equal(rows[0].draft.description, 'HIMANSHU SAHOO', 'the narration is still kept');
});

test('a real party column wins over the narration', () => {
  const result = runImport(
    ['RECEPTION NO.\tDATE\tNARRATION\tNAME OF THE PARTY\tGROSS AMOUNT\tPROJECT NAME\tDEPARTMENT',
      'SEL/1\t01/04/2026\tMarch housekeeping\tS K ENTERPRISES\t13,747.00\tHO\tADMIN'].join('\n'),
  );
  assert.equal(result.rows[0].draft.partyName, 'S K ENTERPRISES');
  assert.equal(result.rows[0].draft.description, 'March housekeeping');
});

test('one file spanning four departments imports to four different departments', () => {
  const byDepartment = new Set(runImport().rows.map((row) => row.draft.departmentId));
  assert.deepEqual(
    Array.from(byDepartment).sort(),
    ['d-admin', 'd-procurement', 'd-project', 'd-tender'],
    'the department comes from the row, not from which screen the import was started on',
  );
});

test('the status given to every row is the caller-s choice', () => {
  const rows = runImport(PASTED, { status: 'Paid' }).rows;
  assert.ok(rows.every((row) => row.draft.status === 'Paid'));
});

/* ── rows that should not import ─────────────────────────────────────────────────────────────── */

const oneRow = (overrides = {}) => {
  const cells = {
    reception: 'SEL/1',
    date: '01/04/2026',
    narration: 'HIMANSHU SAHOO',
    gross: '4,000.00',
    project: 'HO',
    department: 'ADMIN',
    ...overrides,
  };
  return [
    'RECEPTION NO.\tDATE\tNARRATION\tGROSS AMOUNT\tPROJECT NAME\tDEPARTMENT',
    [cells.reception, cells.date, cells.narration, cells.gross, cells.project, cells.department].join('\t'),
  ].join('\n');
};

test('an unknown project is rejected and named, not imported against nothing', () => {
  const result = runImport(oneRow({ project: 'NOWHERE-SITE' }));
  assert.equal(result.rows.length, 0);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].field, 'PROJECT NAME');
  assert.match(result.issues[0].message, /No project matches "NOWHERE-SITE"/);
});

test('an unknown department is rejected the same way', () => {
  const result = runImport(oneRow({ department: 'FINANCE' }));
  assert.match(result.issues[0].message, /No department matches "FINANCE"/);
});

test('a missing or unreadable gross amount is rejected', () => {
  assert.match(runImport(oneRow({ gross: '' })).issues[0].message, /gross amount is required/i);
  assert.match(runImport(oneRow({ gross: 'four thousand' })).issues[0].message, /is not a number/);
});

test('a negative amount is rejected, brackets included', () => {
  assert.match(runImport(oneRow({ gross: '-4000' })).issues[0].message, /negative/i);
  assert.match(runImport(oneRow({ gross: '(4,000.00)' })).issues[0].message, /negative/i);
});

test('a blank narration is rejected', () => {
  assert.match(runImport(oneRow({ narration: '' })).issues[0].message, /narration is required/i);
});

test('every fault on one row is reported together, not one per re-run', () => {
  const result = runImport(oneRow({ project: 'NOWHERE', department: 'FINANCE', gross: '' }));
  assert.equal(result.issues.length, 3);
  assert.deepEqual(
    result.issues.map((issue) => issue.field).sort(),
    ['DEPARTMENT', 'GROSS AMOUNT', 'PROJECT NAME'],
  );
});

test('a bad row is skipped while its neighbours still import', () => {
  const lines = PASTED.split('\n');
  lines[3] = lines[3].replace('\tHO\t', '\tNOWHERE\t');
  const result = runImport(lines.join('\n'));
  assert.equal(result.rows.length, 10);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].row, 4);
});

test('a future bill date warns but still imports', () => {
  const result = runImport(oneRow({ date: '01/04/2030' }));
  assert.equal(result.rows.length, 1);
  assert.match(result.rows[0].warnings[0], /in the future/);
});

test('net above gross warns but still imports', () => {
  const result = runImport(
    ['RECEPTION NO.\tDATE\tNARRATION\tGROSS AMOUNT\tNET AMOUNT\tPROJECT NAME\tDEPARTMENT',
      'SEL/1\t01/04/2026\tHIMANSHU SAHOO\t4,000.00\t5,000.00\tHO\tADMIN'].join('\n'),
  );
  assert.equal(result.rows.length, 1);
  assert.match(result.rows[0].warnings[0], /higher than gross/);
});

/* ── importing the same sheet twice ──────────────────────────────────────────────────────────── */

test('a reception number already recorded is skipped as a duplicate, not imported again', () => {
  const result = runImport(PASTED, { existingReceptionNos: ['SEL/2026-27/3', 'SEL/2026-27/7'] });
  assert.equal(result.rows.length, 9);
  assert.equal(result.duplicates.length, 2);
  assert.match(result.duplicates[0].message, /already recorded/);
});

test('reception numbers are matched loosely enough to survive re-keying', () => {
  const result = runImport(PASTED, { existingReceptionNos: ['sel / 2026-27 / 1'] });
  assert.equal(result.duplicates.length, 1, 'case, spaces and punctuation should not hide a duplicate');
});

test('the same sheet pasted twice in one go only imports each entry once', () => {
  const lines = PASTED.split('\n');
  const doubled = [...lines, ...lines.slice(1)].join('\n');
  const result = runImport(doubled);
  assert.equal(result.rows.length, 11);
  assert.equal(result.duplicates.length, 11);
});

test('two genuinely separate payments to the same party on the same day both import', () => {
  const rows = runImport().rows;
  const himanshu = rows.filter((row) => row.draft.description === 'HIMANSHU SAHOO');
  assert.equal(himanshu.length, 2, 'rows 1 and 10 are the same party and amount on different dates');
  assert.notEqual(himanshu[0].draft.receptionNo, himanshu[1].draft.receptionNo);
});

test('with numbers generated, the fingerprint catches a re-import', () => {
  const first = runImport(PASTED, { receptionNoSource: 'generate' });
  assert.equal(first.rows.length, 11);
  const again = runImport(PASTED, {
    receptionNoSource: 'generate',
    existingFingerprints: first.rows.map((row) => row.fingerprint),
  });
  assert.equal(again.rows.length, 0);
  assert.equal(again.duplicates.length, 11);
});

test('a row with no reception number is refused when numbers come from the file', () => {
  const result = runImport(oneRow({ reception: '' }));
  assert.match(result.issues[0].message, /reception number is required/i);
});

test('the fingerprint ignores case and punctuation in the party and narration', () => {
  const base = {
    projectId: 'p-ho',
    departmentId: 'd-admin',
    grossAmount: 4000,
    partyName: 'S K Enterprises',
    description: 'March',
    date: new Date(2026, 3, 1).toISOString(),
  };
  assert.equal(
    requisitionFingerprint(base),
    requisitionFingerprint({ ...base, partyName: 's.k. enterprises' }),
  );
});

/* ── master resolution ───────────────────────────────────────────────────────────────────────── */

test('a project resolves by name, site code or id, whichever the sheet carries', () => {
  const projects = [{ id: 'p-1', projectName: 'MADANPUR-RAMPUR', siteCode: 'MDR' }];
  assert.equal(resolveRequisitionProject(projects, 'MADANPUR-RAMPUR').id, 'p-1');
  assert.equal(resolveRequisitionProject(projects, 'madanpur rampur').id, 'p-1');
  assert.equal(resolveRequisitionProject(projects, 'MDR').id, 'p-1');
  assert.equal(resolveRequisitionProject(projects, 'p-1').id, 'p-1');
  assert.equal(resolveRequisitionProject(projects, ''), undefined);
});

test('a department resolves case-insensitively', () => {
  assert.equal(resolveRequisitionDepartment(MASTERS.departments, 'procurement').id, 'd-procurement');
  assert.equal(resolveRequisitionDepartment(MASTERS.departments, 'Unknown'), undefined);
});

/* ── reception numbers when they are not in the file ─────────────────────────────────────────── */

test('a generated block is contiguous and leaves the counter past it', () => {
  const config = { prefix: 'SEL\\REC\\', format: '2026-27\\', suffix: '', startingIndex: 7340 };
  const { receptionNos, nextIndex } = allocateReceptionNos(config, 3);
  assert.deepEqual(receptionNos, ['SEL\\REC\\2026-27\\7340', 'SEL\\REC\\2026-27\\7341', 'SEL\\REC\\2026-27\\7342']);
  assert.equal(nextIndex, 7343, 'the next hand-keyed entry must not be handed 7342 again');
});

test('the generated format is the one the entry sheet uses', () => {
  const config = { prefix: 'SEL\\REC\\', format: '2026-27\\', suffix: '', startingIndex: 1 };
  assert.equal(formatReceptionNo(config, 1), 'SEL\\REC\\2026-27\\0001', 'four-digit pad, as the entry sheet does');
});

test('allocating none leaves the counter alone', () => {
  const { receptionNos, nextIndex } = allocateReceptionNos({ startingIndex: 42 }, 0);
  assert.deepEqual(receptionNos, []);
  assert.equal(nextIndex, 42);
});

/* ── messy sheets ────────────────────────────────────────────────────────────────────────────── */

test('a title row above the headings does not become the headings', () => {
  const withTitle = ['DAILY REQUISITION REGISTER', '', PASTED].join('\n');
  const sheet = readRequisitionSheet(parseDelimitedGrid(withTitle));
  assert.equal(sheet.headerRow, 3);
  assert.ok(sheet.headings.includes('RECEPTION NO.'));
  const result = parseRequisitionImportRows(sheet, buildRequisitionColumnMap(sheet.headings), MASTERS, {
    today: TODAY,
  });
  assert.equal(result.rows.length, 11);
});

test('an empty sheet is an empty result, not a crash', () => {
  const result = runImport('TIMESTAMP\tRECEPTION NO.\tNARRATION\tGROSS AMOUNT\tPROJECT NAME\tDEPARTMENT');
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.issues, []);
  assert.equal(result.totalGross, 0);
});
