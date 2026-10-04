/**
 * Dry run of the Bill Tracking workbook import — no database, no writes.
 *
 *   node --experimental-strip-types scripts/bill-tracking-dry-run.mjs "C:\path\BILL TRACKING-2026-27.xlsx"
 *
 * Parses the workbook with exactly the code the import wizard uses and prints what it found: the
 * sheet and header row, the column mapping, rows by validation state, the issues by kind, and the
 * Excel-vs-calculated totals the reconciliation screen will show. Projects are matched against the
 * workbook's own project names (every name maps to itself), so project-mapping errors are not
 * reported here — the wizard resolves those against the live project master.
 */

import ExcelJS from 'exceljs';
import { readFile } from 'node:fs/promises';

import { worksheetToGrid, pickBillSheet } from '../src/lib/bill-tracking/workbook.ts';
import { IMPORT_COLUMNS, excelTotals, parseImportRows, readSheetLayout, classifyDuplicate, projectKey } from '../src/lib/bill-tracking/import.ts';
import { DEFAULT_CONFIG } from '../src/lib/bill-tracking/defaults.ts';
import { sumMoney } from '../src/lib/bill-tracking/money.ts';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node --experimental-strip-types scripts/bill-tracking-dry-run.mjs <workbook.xlsx>');
  process.exit(1);
}

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.load(await readFile(file));
const names = workbook.worksheets.map((sheet) => sheet.name);
const sheetName = pickBillSheet(names);
const grid = worksheetToGrid(workbook.getWorksheet(sheetName));
const layout = readSheetLayout(grid);

// First pass only to collect the project names, so every name can map to itself.
const firstPass = parseImportRows(grid, layout, { projects: [], billTypes: DEFAULT_CONFIG.billTypes, deductionTypes: DEFAULT_CONFIG.deductionTypes, projectMappings: [], tolerance: 1, piMarker: 'PI' });
const projects = [...new Set(firstPass.rows.map((row) => row.projectExcelName).filter(Boolean))].map((name) => ({ id: projectKey(name), name }));
const parsed = parseImportRows(grid, layout, {
  projects,
  billTypes: DEFAULT_CONFIG.billTypes,
  deductionTypes: DEFAULT_CONFIG.deductionTypes,
  projectMappings: [],
  tolerance: DEFAULT_CONFIG.settings.tolerance,
  roundNetToRupee: DEFAULT_CONFIG.settings.roundNetToRupee,
  piMarker: DEFAULT_CONFIG.settings.piMarker,
});

console.log(`Sheets: ${names.join(' | ')}`);
console.log(`Importing sheet "${sheetName}", headings on row ${layout.headerRow}`);
const mapped = IMPORT_COLUMNS.map((column) => `${column.key} ← ${layout.columnMap[column.key] === undefined ? '(unmapped)' : JSON.stringify(layout.headings[layout.columnMap[column.key]])}`);
console.log(mapped.join('\n'));
if (layout.unmapped.length) console.log(`Unmapped headings: ${layout.unmapped.join(' | ')}`);

const byState = { valid: 0, warning: 0, error: 0 };
const issues = new Map();
parsed.rows.forEach((row) => {
  byState[row.validation] += 1;
  row.issues.forEach((issue) => issues.set(issue.code, (issues.get(issue.code) ?? 0) + 1));
});
const duplicates = { exact: 0, possible: 0, new: 0 };
parsed.rows.forEach((row, index) => (duplicates[classifyDuplicate(row, [], parsed.rows.slice(0, index)).kind] += 1));

console.log(`\nRows: ${parsed.rows.length} bills, ${parsed.blankRows} blank/template rows ignored`);
parsed.rows.forEach((row, index) => { const d = classifyDuplicate(row, [], parsed.rows.slice(0, index)); if (d.kind !== 'new') console.log(`  row ${row.row} ${d.kind}: ${d.reason}`); });
console.log(`Validation: ${JSON.stringify(byState)}  Duplicates within file: ${JSON.stringify(duplicates)}`);
console.log(`Issues: ${JSON.stringify(Object.fromEntries(issues))}`);
parsed.rows.filter((row) => row.netMismatch).forEach((row) => console.log(`  net mismatch row ${row.row}: sheet ${row.imported.netAmount} vs calculated ${row.calculated.net}`));
console.log(`Unknown bill types: ${parsed.unknownBillTypes.join(', ') || 'none'}`);
console.log(`Receipts that would be created: ${parsed.rows.filter((row) => (row.imported.received ?? 0) !== 0).length}`);
console.log(`Credit notes (negative gross): ${parsed.rows.filter((row) => row.transactionType === 'credit_note').length}`);

const excel = excelTotals(parsed.rows);
const calc = {
  taxable: sumMoney(parsed.rows.map((row) => row.taxableAmount)),
  gst: sumMoney(parsed.rows.map((row) => row.gstAmount)),
  deduction: sumMoney(parsed.rows.map((row) => row.calculated.totalDeduction)),
  net: sumMoney(parsed.rows.map((row) => row.calculated.net)),
  received: sumMoney(parsed.rows.map((row) => row.calculated.received)),
  outstanding: sumMoney(parsed.rows.map((row) => row.calculated.outstanding)),
};
console.log('\nMetric        Excel              Calculated         Difference');
for (const key of Object.keys(calc)) {
  const difference = sumMoney([calc[key], -excel[key]]);
  console.log(`${key.padEnd(13)} ${String(excel[key]).padEnd(18)} ${String(calc[key]).padEnd(18)} ${difference}`);
}
console.log('\nNote: calculated outstanding is 0 for bills within tolerance of fully paid; the sheet keeps any rupee difference.');
