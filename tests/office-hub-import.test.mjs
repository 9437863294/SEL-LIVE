import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EMPLOYEE_IMPORT_COLUMNS,
  buildEmployeeImportPreview,
  buildEmployeeImportTemplate,
  buildImportErrorReport,
  buildEmployeeColumnMap,
  committableRows,
  detectEmployeeHeaderRow,
  employeeImportInstructions,
  errorReportToCsv,
  missingRequiredColumns,
  normalizeToken,
  parseEmployeeGrid,
  parseImportDate,
  parseImportStatus,
  unmappedEmployeeHeadings,
} from '../src/lib/office-hub-import.ts';

const directory = {
  employees: [
    {
      id: 'emp-1',
      employeeId: 'SEL-1042',
      name: 'Asha Rao',
      email: 'asha.rao@example.com',
      mobile: '9876543210',
      designation: 'Finance Manager',
      departmentId: 'd-finance',
      departmentName: 'Finance',
      location: 'Head Office',
      status: 'Active',
      joiningDate: '2024-04-01',
    },
    {
      id: 'emp-2',
      employeeId: 'SEL-1043',
      name: 'Ben Shah',
      email: 'ben.shah@example.com',
      designation: 'Analyst',
      departmentId: 'd-finance',
      departmentName: 'Finance',
      status: 'Active',
    },
  ],
  departments: [
    { id: 'd-finance', name: 'Finance', status: 'Active' },
    { id: 'd-projects', name: 'Projects', status: 'Active' },
    { id: 'd-closed', name: 'Old Division', status: 'Inactive' },
  ],
};

const HEADER = 'Employee ID,Name,Email,Mobile,Designation,Department,Location,Reporting Manager,Status,Joining Date';

/* ── parsing ───────────────────────────────────────────────────────────────────────────────────── */

test('parseEmployeeGrid honours quoted fields and detects the delimiter per paste', () => {
  const csv = `${HEADER}\nSEL-1,Asha,a@x.com,,"Manager, Finance",Finance,HO,,Active,2024-04-01`;
  const grid = parseEmployeeGrid(csv);
  assert.equal(grid.length, 2);
  // The embedded comma in the designation must not be read as a delimiter.
  assert.equal(grid[1][4], 'Manager, Finance');

  const pasted = 'Employee ID\tName\tEmail\nSEL-1\tAsha\ta@x.com';
  const tabGrid = parseEmployeeGrid(pasted);
  assert.deepEqual(tabGrid[1], ['SEL-1', 'Asha', 'a@x.com'], 'a spreadsheet paste is tab-separated');

  assert.deepEqual(parseEmployeeGrid(''), []);
  assert.deepEqual(parseEmployeeGrid('   '), []);

  const doubled = parseEmployeeGrid('a,b\n"say ""hello""",x');
  assert.equal(doubled[1][0], 'say "hello"');
});

test('the header row is found, not assumed to be row zero', () => {
  const grid = parseEmployeeGrid(
    `Employee Master Export\nGenerated 18 Sep 2026\n\n${HEADER}\nSEL-1,Asha,a@x.com,,,Finance,,,Active,`,
  );
  assert.equal(detectEmployeeHeaderRow(grid), 3);

  // With nothing recognisable, it falls back to the first row rather than guessing.
  assert.equal(detectEmployeeHeaderRow(parseEmployeeGrid('x,y,z\n1,2,3')), 0);
});

test('columns map by alias, in any order, and unmapped headings are reported', () => {
  const map = buildEmployeeColumnMap(['Name', 'Emp No', 'E-Mail', 'Dept', 'Cost Centre']);
  assert.equal(map.name, 0);
  assert.equal(map.employeeId, 1, '"Emp No" is an alias');
  assert.equal(map.email, 2, '"E-Mail" is an alias');
  assert.equal(map.department, 3, '"Dept" is an alias');
  assert.deepEqual(unmappedEmployeeHeadings(['Name', 'Emp No', 'E-Mail', 'Dept', 'Cost Centre'], map), [
    'Cost Centre',
  ]);

  assert.deepEqual(missingRequiredColumns(map), []);
  assert.deepEqual(missingRequiredColumns({ name: 0 }), ['Employee ID', 'Email', 'Department']);

  assert.equal(normalizeToken('  Reporting-Manager  '), 'reporting manager');
});

test('dates are read day-first, and an unreadable one is distinguished from a blank one', () => {
  assert.equal(parseImportDate('2024-04-01'), '2024-04-01');
  assert.equal(parseImportDate('01/04/2024'), '2024-04-01', 'day first, matching the locale');
  assert.equal(parseImportDate('1-4-2024'), '2024-04-01');
  assert.equal(parseImportDate('2024/4/1'), '2024-04-01');
  assert.equal(parseImportDate(''), undefined, 'blank is "no opinion"');
  assert.equal(parseImportDate('   '), undefined);
  assert.equal(parseImportDate('next Tuesday'), null, 'unreadable is an error, not a blank');
  assert.equal(parseImportDate('31/02/2024'), null, 'and so is an impossible date');
});

test('status is read generously and defaults to Active', () => {
  assert.equal(parseImportStatus('Active'), 'Active');
  assert.equal(parseImportStatus(''), 'Active');
  assert.equal(parseImportStatus('inactive'), 'Inactive');
  assert.equal(parseImportStatus('Left'), 'Inactive');
  assert.equal(parseImportStatus('Resigned'), 'Inactive');
  assert.equal(parseImportStatus('N'), 'Inactive');
  assert.equal(parseImportStatus('Confirmed'), 'Active', 'an unrecognised value is not "inactive"');
});

/* ── the preview ───────────────────────────────────────────────────────────────────────────────── */

const preview = (body) => buildEmployeeImportPreview(parseEmployeeGrid(`${HEADER}\n${body}`), directory);

test('an unchanged row is a match, not an update', () => {
  const result = preview(
    'SEL-1042,Asha Rao,asha.rao@example.com,9876543210,Finance Manager,Finance,Head Office,,Active,2024-04-01',
  );
  assert.equal(result.summary.total, 1);
  assert.equal(result.summary.match, 1);
  assert.equal(result.summary.update, 0);
  assert.deepEqual(result.rows[0].changes, []);
  assert.deepEqual(committableRows(result), [], 'nothing to write');
});

test('a changed field produces an update that names the before and after', () => {
  const result = preview(
    'SEL-1042,Asha Rao,asha.rao@example.com,9876543210,Head of Finance,Finance,Head Office,,Active,2024-04-01',
  );
  assert.equal(result.summary.update, 1);
  assert.equal(result.rows[0].existingId, 'emp-1');
  assert.deepEqual(result.rows[0].changes, [
    { field: 'Designation', from: 'Finance Manager', to: 'Head of Finance' },
  ]);
  assert.equal(committableRows(result).length, 1);
});

test('a blank cell means "leave it alone", never "clear it"', () => {
  // Designation and location are blank; the stored values must not be proposed for deletion.
  const result = preview('SEL-1042,Asha Rao,asha.rao@example.com,,,Finance,,,Active,');
  assert.equal(result.summary.match, 1, 'nothing changed, so nothing to do');
  assert.deepEqual(result.rows[0].changes, []);
});

test('an unknown person is a create', () => {
  const result = preview('SEL-9999,Chen Wu,chen.wu@example.com,9000000000,Engineer,Projects,Site,,Active,2026-01-15');
  assert.equal(result.summary.create, 1);
  assert.equal(result.rows[0].existingId, null);
  assert.equal(result.rows[0].departmentId, 'd-projects', 'the department name resolved to an id');
  assert.equal(result.rows[0].joiningDate, '2026-01-15');
});

test('matching falls back to email when the employee ID differs, and says so', () => {
  const result = preview('SEL-OLD-7,Asha Rao,asha.rao@example.com,,,Finance,,,Active,');
  assert.equal(result.rows[0].existingId, 'emp-1', 'matched by email');
  assert.ok(
    result.rows[0].warnings.some((warning) => warning.includes('SEL-1042')),
    'and warns that the IDs disagree',
  );
});

test('duplicates within the sheet are refused, naming the earlier row', () => {
  const result = preview(
    [
      'SEL-2001,First Person,first@example.com,,,Finance,,,Active,',
      'SEL-2001,Second Person,second@example.com,,,Finance,,,Active,',
      'SEL-2002,Third Person,first@example.com,,,Finance,,,Active,',
    ].join('\n'),
  );

  assert.equal(result.summary.error, 2);
  assert.ok(result.rows[1].errors.some((error) => error.includes('row 2')), 'duplicate ID points at row 2');
  assert.ok(result.rows[2].errors.some((error) => error.includes('row 2')), 'duplicate email points at row 2');
  assert.equal(result.rows[0].outcome, 'create', 'the first occurrence is fine');
});

test('required fields, a bad email and an unknown department are each an error', () => {
  const result = preview(
    [
      ',No ID,noid@example.com,,,Finance,,,Active,',
      'SEL-3001,,blank.name@example.com,,,Finance,,,Active,',
      'SEL-3002,Bad Email,not-an-email,,,Finance,,,Active,',
      'SEL-3003,No Dept,nodept@example.com,,,,,,Active,',
      'SEL-3004,Unknown Dept,unknown@example.com,,,Marketing,,,Active,',
      'SEL-3005,Bad Date,baddate@example.com,,,Finance,,,Active,soon',
    ].join('\n'),
  );

  assert.equal(result.summary.error, 6);
  assert.ok(result.rows[0].errors.some((error) => error.includes('Employee ID is blank')));
  assert.ok(result.rows[1].errors.some((error) => error.includes('Name is blank')));
  assert.ok(result.rows[2].errors.some((error) => error.includes('not a valid email')));
  assert.ok(result.rows[3].errors.some((error) => error.includes('Department is blank')));
  assert.ok(result.rows[4].errors.some((error) => error.includes('does not exist')));
  assert.ok(result.rows[5].errors.some((error) => error.includes('not a date')));

  assert.deepEqual(committableRows(result), [], 'no error row is ever committable');
});

test('an inactive department is a warning, not a refusal', () => {
  const result = preview('SEL-4001,Old Timer,old@example.com,,,Old Division,,,Active,');
  assert.equal(result.rows[0].outcome, 'create');
  assert.ok(result.rows[0].warnings.some((warning) => warning.includes('inactive')));
});

test('a reporting manager who is not in the directory warns rather than failing the row', () => {
  // Otherwise the order of rows in a spreadsheet would decide whether an import succeeded.
  const later = preview('SEL-5001,New Person,new@example.com,,,Finance,,Somebody Not Yet Added,Active,');
  assert.equal(later.rows[0].outcome, 'create');
  assert.ok(later.rows[0].warnings.some((warning) => warning.includes('not found')));

  const resolved = preview('SEL-5002,Another Person,another@example.com,,,Finance,,Asha Rao,Active,');
  assert.equal(resolved.rows[0].reportingManagerId, 'emp-1');
  assert.equal(resolved.rows[0].reportingManagerName, 'Asha Rao');
  assert.deepEqual(resolved.rows[0].warnings, []);

  const byId = preview('SEL-5003,Third Person,third@example.com,,,Finance,,SEL-1043,Active,');
  assert.equal(byId.rows[0].reportingManagerId, 'emp-2', 'a manager can be named by employee ID too');
});

test('blank lines in the middle of a paste are skipped, not read as empty rows', () => {
  const result = preview(
    ['SEL-6001,One,one@example.com,,,Finance,,,Active,', '', ',,,,,,,,,', 'SEL-6002,Two,two@example.com,,,Finance,,,Active,'].join('\n'),
  );
  assert.equal(result.summary.total, 2);
});

test('a sheet missing a required column is blocked outright', () => {
  const result = buildEmployeeImportPreview(
    parseEmployeeGrid('Name,Designation\nAsha,Manager'),
    directory,
  );
  assert.equal(result.blocked, true);
  assert.deepEqual(result.missingColumns, ['Employee ID', 'Email', 'Department']);
  assert.deepEqual(committableRows(result), [], 'a blocked sheet commits nothing');
});

test('an empty grid is blocked rather than reported as a successful import of nothing', () => {
  const result = buildEmployeeImportPreview([], directory);
  assert.equal(result.blocked, true);
  assert.equal(result.summary.total, 0);
});

/* ── the error report ──────────────────────────────────────────────────────────────────────────── */

test('the error report carries the original row number and values', () => {
  const result = preview(
    ['SEL-7001,Fine,fine@example.com,,,Finance,,,Active,', 'SEL-7002,Broken,not-an-email,,,Marketing,,,Active,'].join('\n'),
  );

  const report = buildImportErrorReport(result);
  assert.deepEqual(report.headers, ['Sheet Row', 'Employee ID', 'Name', 'Email', 'Department', 'Problem']);
  assert.equal(report.rows.length, 2, 'two problems on the one broken row');
  assert.equal(report.rows[0][0], 3, 'the sheet row number, not the index');
  assert.equal(report.rows[0][1], 'SEL-7002');
  assert.equal(report.rows[0][4], 'Marketing', 'the value as typed, so it can be found in the sheet');

  const csv = errorReportToCsv(report);
  assert.ok(csv.startsWith('Sheet Row,Employee ID,'));
  assert.ok(csv.includes('\r\n'), 'CRLF, so Excel opens it cleanly');
});

test('the error report includes warnings, marked as such', () => {
  const result = preview('SEL-8001,Warned,warned@example.com,,,Old Division,,,Active,');
  const report = buildImportErrorReport(result);
  assert.equal(report.rows.length, 1);
  assert.ok(String(report.rows[0][5]).startsWith('Warning:'));
});

test('a clean sheet produces no error report rows', () => {
  const result = preview('SEL-9001,Clean,clean@example.com,,,Finance,,,Active,');
  assert.deepEqual(buildImportErrorReport(result).rows, []);
});

/* ── the template ──────────────────────────────────────────────────────────────────────────────── */

test('the downloadable template round-trips through the parser', () => {
  const csv = buildEmployeeImportTemplate();
  const grid = parseEmployeeGrid(csv);

  assert.equal(grid.length, 2, 'headers plus one sample row');
  assert.deepEqual(grid[0], EMPLOYEE_IMPORT_COLUMNS.map((column) => column.label));

  const map = buildEmployeeColumnMap(grid[0]);
  assert.deepEqual(missingRequiredColumns(map), [], 'the template satisfies its own requirements');

  // The sample row is valid against a directory that has the department it names.
  const sampleDirectory = { employees: [], departments: [{ id: 'd-finance', name: 'Finance', status: 'Active' }] };
  const result = buildEmployeeImportPreview(grid, sampleDirectory);
  assert.equal(result.blocked, false);
  assert.equal(result.summary.error, 0, 'the sample row is importable as shipped');
  assert.equal(result.summary.create, 1);
});

test('every column has an instruction line', () => {
  const lines = employeeImportInstructions();
  assert.equal(lines.length, EMPLOYEE_IMPORT_COLUMNS.length);
  assert.ok(lines[0].includes('required'), 'required columns say so');
  assert.ok(lines.some((line) => line.includes('Time Zone')));
});
