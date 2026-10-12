import test from 'node:test';
import assert from 'node:assert/strict';

const {
  findMainCategory,
  activeSubCategories,
  subCategoryRequirement,
  validateSubCategoryChoice,
  subCategoryRuleSummary,
} = await import('../src/lib/site-account-statement-subcategory-rule.ts');

const CATS = [
  { id: 'lab', name: 'Labour Payment', requireSubCategory: true },
  { id: 'lab-s', name: 'Skilled', parentId: 'lab' },
  { id: 'lab-u', name: 'Unskilled', parentId: 'lab' },
  { id: 'lab-x', name: 'Retired trade', parentId: 'lab', isActive: false },
  { id: 'mat', name: 'Material Purchase' },
  { id: 'mat-c', name: 'Cement', parentId: 'mat' },
  { id: 'food', name: 'Food / Refreshment' },             // no sub-categories at all
  { id: 'veh', name: 'Vehicle', requireSubCategory: true }, // required, but nothing to choose
  { id: 'veh-old', name: 'Old truck', parentId: 'veh', isActive: false },
];

const req = (category, requiredEverywhere = false) => subCategoryRequirement({ category, categories: CATS, requiredEverywhere });
const check = (category, subCategory, requiredEverywhere = false) =>
  validateSubCategoryChoice({ category, subCategory, categories: CATS, requiredEverywhere });

// ── Finding the category ───────────────────────────────────────────────────────

test('a main category is found by name, trimmed and in any case', () => {
  assert.equal(findMainCategory(CATS, '  labour payment ').id, 'lab');
  assert.equal(findMainCategory(CATS, 'Nope'), null);
  assert.equal(findMainCategory(CATS, ''), null);
});

test('a sub-category name is never mistaken for a main category', () => {
  assert.equal(findMainCategory(CATS, 'Skilled'), null);
});

test('only active sub-categories count', () => {
  assert.deepEqual(activeSubCategories(CATS, CATS[0]).map(c => c.name), ['Skilled', 'Unskilled']);
});

// ── The requirement ────────────────────────────────────────────────────────────

test("a category's own rule makes its sub-category required", () => {
  assert.deepEqual(req('Labour Payment'), {
    required: true, source: 'category', options: ['Skilled', 'Unskilled'], unsatisfiable: false,
  });
});

test('without its own rule, a category follows Field Control', () => {
  assert.equal(req('Material Purchase').required, false);
  assert.equal(req('Material Purchase', true).required, true);
  assert.equal(req('Material Purchase', true).source, 'all');
});

test("the category's own rule is named even when Field Control also requires it", () => {
  assert.equal(req('Labour Payment', true).source, 'category');
});

test('a requirement with nothing to choose is suspended, not enforced', () => {
  // Vehicle requires one, but its only sub-category is inactive: the form must still save.
  const r = req('Vehicle');
  assert.equal(r.required, false);
  assert.equal(r.unsatisfiable, true);
  assert.equal(r.source, 'category');
});

test('Field Control requiring a sub-category does not trap a category that has none', () => {
  const r = req('Food / Refreshment', true);
  assert.equal(r.required, false);
  assert.equal(r.unsatisfiable, true);
});

test('an unknown or empty category requires nothing', () => {
  assert.deepEqual(req('Ghost'), { required: false, source: null, options: [], unsatisfiable: false });
  assert.equal(req('').required, false);
});

// ── Checking a recorded expense ────────────────────────────────────────────────

test('a required sub-category left blank is refused, naming what can be chosen', () => {
  const r = check('Labour Payment', '');
  assert.equal(r.ok, false);
  assert.match(r.reason, /Labour Payment needs a sub-category/);
  assert.match(r.reason, /Skilled, Unskilled/);
});

test('whitespace is not a sub-category', () => {
  assert.equal(check('Labour Payment', '   ').ok, false);
});

test('a valid sub-category passes, in any case', () => {
  assert.equal(check('Labour Payment', 'skilled').ok, true);
});

test('a sub-category from another category is refused, required or not', () => {
  assert.match(check('Labour Payment', 'Cement').reason, /not a sub-category of Labour Payment/);
  assert.equal(check('Material Purchase', 'Skilled').ok, false);
});

test('an inactive sub-category cannot be chosen', () => {
  assert.equal(check('Labour Payment', 'Retired trade').ok, false);
});

test('an optional sub-category may be left blank', () => {
  assert.equal(check('Material Purchase', '').ok, true);
});

test('the Field Control requirement gives a plain message', () => {
  assert.equal(check('Material Purchase', '', true).reason, 'Sub-category is required.');
});

test('a suspended requirement lets a blank sub-category through', () => {
  assert.equal(check('Vehicle', '').ok, true);
  assert.equal(check('Food / Refreshment', '', true).ok, true);
});

test('a long list of choices is shortened in the message', () => {
  const many = [{ id: 'm', name: 'Many', requireSubCategory: true },
    ...Array.from({ length: 7 }, (_, i) => ({ id: `s${i}`, name: `S${i}`, parentId: 'm' }))];
  const r = validateSubCategoryChoice({ category: 'Many', subCategory: '', categories: many, requiredEverywhere: false });
  assert.match(r.reason, /S0, S1, S2, S3 or 3 more/);
});

test('an unknown category is left to the category check itself', () => {
  assert.equal(check('Ghost', 'Anything').ok, true);
});

// ── The settings summary ───────────────────────────────────────────────────────

test('the summary lists categories with the rule, and those it cannot be met for', () => {
  assert.deepEqual(subCategoryRuleSummary(CATS), {
    required: ['Labour Payment', 'Vehicle'],
    unsatisfiable: ['Vehicle'],
  });
});
