import test from 'node:test';
import assert from 'node:assert/strict';

import { inferCategoryId, isEnabledForProject, normaliseBillType, subCategoriesFor, summaryColumnOf, validateCategoryConfig } from '../src/lib/bill-tracking/categories.ts';
import { matchBillType, parseImportRows, provisionalBillType, readSheetLayout } from '../src/lib/bill-tracking/import.ts';
import { monthlySummary } from '../src/lib/bill-tracking/reports.ts';
import { DEFAULT_BILL_CATEGORIES, DEFAULT_CONFIG, withConfigDefaults } from '../src/lib/bill-tracking/defaults.ts';

const sub = (id, name, categoryId, projectIds = [], extra = {}) => ({ id, name, code: name, categoryId, projectIds, isRetentionBill: false, isPriceVariation: false, active: true, ...extra });

test('a sub category with no projects is offered everywhere; otherwise only on its projects', () => {
  assert.equal(isEnabledForProject(sub('a', 'RA-1', 'civil'), 'p1'), true);
  assert.equal(isEnabledForProject(sub('a', 'RA-1', 'civil', ['p1']), 'p1'), true);
  assert.equal(isEnabledForProject(sub('a', 'RA-1', 'civil', ['p1']), 'p2'), false);
});

test('the bill form offers the main category’s sub categories enabled for the project', () => {
  const types = [sub('a', 'CIVIL', 'civil'), sub('b', 'CIVIL-RA-1', 'civil', ['p1']), sub('c', 'CIVIL-RA-1', 'civil', ['p2']), sub('d', 'SUPPLY', 'supply'), sub('e', 'CIVIL-OLD', 'civil', [], { active: false })];
  assert.deepEqual(subCategoriesFor(types, 'civil', 'p1').map((type) => type.id), ['a', 'b']);
  assert.deepEqual(subCategoriesFor(types, 'civil', 'p2').map((type) => type.id), ['a', 'c']);
  assert.deepEqual(subCategoriesFor(types, 'civil', 'p2', 'e').map((type) => type.id), ['a', 'e', 'c'], 'a bill keeps its own inactive sub category (listed by name)');
  assert.deepEqual(subCategoriesFor(types, undefined, 'p1'), [], 'nothing until a main category is chosen');
});

test('validation: unique main names, every sub has a main, no ambiguous sub on the same project', () => {
  const categories = DEFAULT_BILL_CATEGORIES;
  assert.equal(validateCategoryConfig(categories, [sub('a', 'RA-1', 'civil', ['p1']), sub('b', 'RA-1', 'civil', ['p2'])]), null, 'same name on different projects is fine');
  assert.match(validateCategoryConfig(categories, [sub('a', 'RA-1', 'civil', ['p1']), sub('b', 'ra 1', 'civil', ['p1', 'p3'])]), /defined twice/);
  assert.match(validateCategoryConfig(categories, [sub('a', 'RA-1', 'civil'), sub('b', 'RA-1', 'civil', ['p3'])]), /defined twice/, '"all projects" overlaps every project');
  assert.equal(validateCategoryConfig(categories, [sub('a', 'RA-1', 'civil'), sub('b', 'RA-1', 'supply')]), null, 'different main categories may share a name');
  assert.match(validateCategoryConfig(categories, [sub('a', 'RA-1', 'deleted-main')]), /no main category/);
  assert.match(validateCategoryConfig([...categories, { ...categories[0], id: 'x' }], []), /appears twice/);
  assert.match(validateCategoryConfig([], []), /at least one/);
});

test('older configurations migrate: fixed category becomes the main category, all projects', () => {
  const migrated = normaliseBillType({ id: 'bt-1', name: 'CIVIL-PV', code: 'CIVIL-PV', category: 'civil', isRetentionBill: false, isPriceVariation: true, active: true });
  assert.equal(migrated.categoryId, 'civil');
  assert.deepEqual(migrated.projectIds, []);
  const config = withConfigDefaults({ billTypes: [{ id: 'bt-1', name: 'SUPPLY-60%', code: 'SUPPLY-60%', category: 'supply', isRetentionBill: false, isPriceVariation: false, active: true }] });
  assert.equal(config.billCategories.length, DEFAULT_BILL_CATEGORIES.length);
  assert.equal(config.billTypes[0].categoryId, 'supply');
  assert.ok(DEFAULT_CONFIG.billTypes.every((type) => type.projectIds.length === 0 && DEFAULT_BILL_CATEGORIES.some((category) => category.id === type.categoryId)));
});

test('new sub categories land under a configured main category by name', () => {
  const categories = [...DEFAULT_BILL_CATEGORIES, { id: 'bc-svc', name: 'Services', code: 'SVC', summaryColumn: 'other', sequence: 7, active: true }];
  assert.equal(inferCategoryId('SERVICES-AMC', categories), 'bc-svc');
  assert.equal(inferCategoryId('SVC-1', categories), 'bc-svc');
  assert.equal(inferCategoryId('ERECTION-35%', categories), 'erection');
  assert.equal(inferCategoryId('MISC CHARGES', categories), 'other');
  assert.equal(inferCategoryId('MISC CHARGES', categories.filter((category) => category.id !== 'other')), 'compensation', 'else the first category reporting under Other');
  assert.deepEqual(provisionalBillType('ERECTION-35%', categories, ['p9']).projectIds, ['p9']);
});

test('the importer prefers the sub category enabled for the row’s project', () => {
  const types = [sub('b', 'RA-1', 'civil', ['p1']), sub('c', 'RA-1', 'erection', ['p2'])];
  assert.equal(matchBillType('ra-1', types, 'p2').id, 'c');
  assert.equal(matchBillType('ra-1', types, 'p1').id, 'b');
  assert.equal(matchBillType('ra-1', types, 'p3').id, 'b', 'falls back to the first match (and the row is warned)');

  const grid = [
    ['Date', 'Project Name', 'Type of Bill Status', 'Taxable Amount'],
    [{ date: '2026-05-01' }, 'Project Three', 'RA-1', 100],
  ];
  const [row] = parseImportRows(grid, readSheetLayout(grid, 1), { projects: [{ id: 'p3', name: 'Project Three' }], billTypes: types, billCategories: DEFAULT_BILL_CATEGORIES, deductionTypes: DEFAULT_CONFIG.deductionTypes, projectMappings: [], tolerance: 1, piMarker: 'PI' }).rows;
  assert.ok(row.issues.some((issue) => issue.code === 'bill_type_not_in_project'));
  assert.equal(row.billCategory, 'civil');
});

test('month-wise summary places a bill by its main category’s configured column', () => {
  const bill = (id, billCategory, taxableAmount) => ({ id, billCategory, taxableAmount, gstAmount: 0, netReceivable: taxableAmount, totalReceived: 0, deductions: [], collections: [], billDate: '2026-04-10', isRetentionBill: false, isDeleted: false });
  const categories = [{ id: 'bc-svc', summaryColumn: 'erection' }];
  const [april] = monthlySummary([bill('a', 'bc-svc', 100), bill('b', 'supply', 50), bill('c', 'deleted', 7)], '2026-27', categories);
  assert.equal(april.taxableErection, 100, 'custom main category reports where configured');
  assert.equal(april.taxableSupply, 50, 'legacy ids still resolve');
  assert.equal(april.taxableOther, 7, 'a deleted main category falls to Other');
  assert.equal(summaryColumnOf('compensation', DEFAULT_BILL_CATEGORIES), 'other');
});
