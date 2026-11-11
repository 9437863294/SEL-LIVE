import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_DEDUCTION_TYPES } from '../src/lib/bill-tracking/defaults.ts';
import { computeDeductions, keepsIssuedLines, splitGst } from '../src/lib/bill-tracking/gst.ts';
import { grossAmount, netReceivable, protectedChanges, totalDeduction } from '../src/lib/bill-tracking/calculations.ts';
import { billRetentionSlabs, retentionLineRate, retentionSource } from '../src/lib/bill-tracking/retention.ts';
import {
  billValueBase,
  certifiedValueBase,
  describeTerms,
  normaliseValueBasisRules,
  taxableFromValue,
  valueBasisProblem,
  valueBasisRuleFor,
  valueBasisRulesProblem,
  valueFigures,
  valueFromTaxable,
} from '../src/lib/bill-tracking/value-basis.ts';

// Retention heads taken "% of Value"; Income TDS stays on the taxable.
const types = DEFAULT_DEDUCTION_TYPES.map((type) => (type.id === 'dt-ret-inv' || type.id === 'dt-ret-cpbg' ? { ...type, percentBase: 'value' } : type));
const lines = (amounts) => amounts.map(([id, deductionTypeId, percentage]) => ({ id, deductionTypeId, percentage }));
const work = (basis, taxable, gstRate, inputs, roundToRupee = false) => {
  const gst = splitGst(taxable, 'cgst-sgst', gstRate);
  const gross = grossAmount(taxable, gst.cgstAmount + gst.sgstAmount);
  const deductions = computeDeductions(inputs, types, { taxable, gross, value: billValueBase({ taxableAmount: taxable, valueBasis: basis }), roundToRupee, gstType: 'cgst-sgst' });
  return { gst, gross, deductions, total: totalDeduction(deductions), net: netReceivable(gross, totalDeduction(deductions), true) };
};

test('format 1: 0.35% discount, 90% billed, retention 20% + 10% on the discounted 100%', () => {
  // TOTAL (A) 44,65,672.38 · discount 0.35% · less 10% of the value · taxable E · retention on C.
  const basis = { executedValue: 4465672.38, discountPercent: 0.35, taxableShare: 90, valueShare: 100 };
  assert.deepEqual(valueFigures(basis), {
    executedValue: 4465672.38,
    discount: 15629.85,
    discountedValue: 4450042.53,
    heldBack: 445004.25,
    taxable: 4005038.27,
    valueBase: 4450042.53,
  });
  const result = work(basis, 4005038.27, 18, lines([['r20', 'dt-ret-inv', 20], ['r10', 'dt-ret-cpbg', 10]]));
  assert.deepEqual([result.gst.cgstAmount, result.gst.sgstAmount], [360453.44, 360453.44]);
  assert.deepEqual(result.deductions.map((line) => [line.amount, line.calculationBase]), [
    [890008.51, 4450042.53],
    [445004.25, 4450042.53],
  ]);
  assert.equal(result.total, 1335012.76);
  assert.equal(result.net, 3390932, 'Now claim 33,90,932.00');
});

test('format 2: taxable 90% of the value executed, retention 10% of the 100% value', () => {
  const basis = { executedValue: 2102237.16, discountPercent: 0, taxableShare: 90, valueShare: 100 };
  assert.equal(valueFigures(basis).taxable, 1892013.44);
  const result = work(basis, 1892013.44, 18, lines([['r', 'dt-ret-inv', 10]]));
  assert.deepEqual([result.gst.cgstAmount, result.gross], [170281.21, 2232575.86]);
  assert.equal(result.deductions[0].amount, 210223.72);
  assert.equal(result.net, 2022352, 'Now claim 20,22,352.00');
  // With percentage deductions rounded to the rupee, as the sheet's total deduction (C) is.
  assert.equal(work(basis, 1892013.44, 18, lines([['r', 'dt-ret-inv', 10]]), true).total, 210224);
});

test('taxable 100% and retention against 90% of it; TDS stays on the taxable', () => {
  const basis = { executedValue: 1000000, discountPercent: 0, taxableShare: 100, valueShare: 90 };
  const result = work(basis, 1000000, 18, lines([['r', 'dt-ret-inv', 10], ['t', 'dt-itds', 2]]));
  assert.deepEqual(result.deductions.map((line) => line.amount), [90000, 20000]);
});

test('without a basis a "% of Value" head is taken of the taxable, exactly as before', () => {
  const result = work(undefined, 500000, 18, lines([['r', 'dt-ret-inv', 10]]));
  assert.deepEqual([result.deductions[0].amount, result.deductions[0].calculationBase], [50000, 500000]);
  assert.equal(billValueBase({ taxableAmount: 500000 }), 500000);
});

test('the value and the taxable work out from each other; a taxable off its basis is refused', () => {
  const terms = { discountPercent: 0.35, taxableShare: 90, valueShare: 100 };
  assert.equal(taxableFromValue(4465672.38, terms), 4005038.27);
  assert.equal(valueFromTaxable(4005038.27, terms), 4465672.38);
  // A typed taxable rounded back to a value lands within a paisa or two of the taxable — accepted.
  assert.equal(valueBasisProblem({ ...terms, executedValue: valueFromTaxable(1234567.89, terms) }, 1234567.89), null);
  assert.match(valueBasisProblem({ ...terms, executedValue: 4465672.38 }, 4450042.53), /not 90% of the value/);
  assert.match(valueBasisProblem({ ...terms, executedValue: 0 }, 0), /value of the work executed/);
  assert.match(valueBasisProblem({ ...terms, taxableShare: 0, executedValue: 10 }, 0), /share billed as taxable/);
  assert.match(valueBasisProblem({ ...terms, discountPercent: 100, executedValue: 10 }, 0), /discount/);
});

test('certified as raised keeps the bill’s value; certified for less, in proportion', () => {
  const bill = { taxableAmount: 4005038.27, valueBasis: { executedValue: 4465672.38, discountPercent: 0.35, taxableShare: 90, valueShare: 100 } };
  assert.equal(certifiedValueBase(bill, 4005038.27), 4450042.53);
  assert.equal(certifiedValueBase(bill, 3600000), 4000000);
  assert.equal(certifiedValueBase({ taxableAmount: 100 }, 90), 90);
});

test('an amount typed on a "% of Value" retention line reads its rate against the value', () => {
  const type = { percentBase: 'value' };
  // ₹2,10,223.72 on a ₹18,92,013.44 taxable: 11.11% of it, but 10% of the ₹21,02,237.16 value.
  assert.deepEqual(retentionLineRate({ amount: 210223.72 }, { taxableAmount: 1892013.44, grossAmount: 2232575.86, valueBase: 2102237.16 }, type), { rate: 10, basis: 'amount' });
  assert.deepEqual(retentionLineRate({ amount: 210223.72 }, { taxableAmount: 1892013.44, grossAmount: 2232575.86 }, { percentBase: 'taxable' }), { rate: null, basis: 'amount' });
  const bill = { taxableAmount: 1892013.44, grossAmount: 2232575.86, valueBase: 2102237.16, deductions: [{ id: 'r', deductionTypeId: 'dt-ret-inv', deductionTypeName: 'Retention Against Invoice', kind: 'retention_invoice', amount: 210223.72 }] };
  assert.deepEqual(billRetentionSlabs(retentionSource(bill), types).map((entry) => [entry.slab.rate, entry.held]), [[10, 210223.72]]);
  // Certified: the certification's own value base.
  const certified = { ...bill, certification: { taxableAmount: 1800000, grossAmount: 2124000, valueBase: 2000000, deductions: [{ ...bill.deductions[0], amount: 200000 }] } };
  assert.deepEqual(billRetentionSlabs(retentionSource(certified), types).map((entry) => entry.slab.rate), [10]);
});

test('a changed value basis is a protected change and re-works the lines', () => {
  const basis = { executedValue: 1000000, discountPercent: 0, taxableShare: 90, valueShare: 100 };
  assert.deepEqual(protectedChanges({ taxableAmount: 900000, valueBasis: basis }, { taxableAmount: 900000, valueBasis: { ...basis, ruleName: 'renamed' } }), []);
  assert.deepEqual(protectedChanges({ taxableAmount: 900000, valueBasis: basis }, { taxableAmount: 900000, valueBasis: { ...basis, valueShare: 90 } }), ['valueBasis']);
  assert.deepEqual(protectedChanges({ taxableAmount: 900000 }, { taxableAmount: 900000, valueBasis: basis }), ['valueBasis']);
  const figures = { transactionType: 'invoice', billDate: '2026-11-01', taxableAmount: 900000, gstAmount: 0 };
  assert.equal(keepsIssuedLines({ ...figures, deductions: [] }, { ...figures }, []), true);
  assert.equal(keepsIssuedLines({ ...figures, deductions: [] }, { ...figures, valueBase: 1000000 }, []), false);
  assert.equal(keepsIssuedLines({ ...figures, valueBase: 1000000, deductions: [] }, { ...figures, valueBase: 1000000 }, []), true);
});

test('rules: the project’s own first, a sub category named before "every invoice", invoices only', () => {
  const rule = (id, billTypeIds, taxableShare, extra = {}) => ({ id, name: id, active: true, billTypeIds, discountPercent: 0, taxableShare, valueShare: 100, ...extra });
  const config = {
    settings: { valueBasisRules: [rule('all-90', [], 90), rule('erection', ['bt-erect'], 100, { valueShare: 90 })] },
    projectProfiles: [{ projectId: 'p1', valueBasisRules: [rule('p1-supply', ['bt-supply'], 80), rule('p1-off', ['bt-x'], 70, { active: false })] }],
  };
  const pick = (projectId, billTypeId, type = 'invoice') => valueBasisRuleFor(config, projectId, billTypeId, type);
  assert.deepEqual([pick('p1', 'bt-supply').rule.id, pick('p1', 'bt-supply').own], ['p1-supply', true]);
  assert.deepEqual([pick('p1', 'bt-erect').rule.id, pick('p1', 'bt-erect').own], ['erection', false], 'not set by the project: the default rules');
  assert.equal(pick('p1', 'bt-x').rule.id, 'all-90', 'an inactive rule is skipped');
  assert.equal(pick('p2', 'bt-erect').rule.id, 'erection', 'a named sub category beats "every invoice"');
  assert.equal(pick('p2', 'bt-other').rule.id, 'all-90');
  assert.equal(pick('p2', 'bt-supply', 'debit_note'), undefined, 'notes carry no basis');
  assert.equal(valueBasisRuleFor({ settings: {}, projectProfiles: [] }, 'p1', 'bt-supply', 'invoice'), undefined);
});

test('rules as saved: known sub categories only, ids once, terms checked', () => {
  const saved = normaliseValueBasisRules(
    [
      { id: 'a', name: '  Supply 90% ', active: true, billTypeIds: ['bt-1', 'bt-gone', 'bt-1'], discountPercent: 0.351234567, taxableShare: 90, valueShare: 100 },
      { id: 'a', name: 'duplicate', active: true, billTypeIds: [], discountPercent: 0, taxableShare: 90, valueShare: 100 },
    ],
    [{ id: 'bt-1' }],
  );
  assert.deepEqual(saved, [{ id: 'a', name: 'Supply 90%', active: true, billTypeIds: ['bt-1'], discountPercent: 0.3512, taxableShare: 90, valueShare: 100 }]);
  assert.equal(valueBasisRulesProblem(saved), null);
  assert.match(valueBasisRulesProblem([{ ...saved[0], valueShare: 0 }]), /^Supply 90%: The share deductions are taken of/);
  assert.equal(describeTerms({ discountPercent: 0.35, taxableShare: 90, valueShare: 100 }), '0.35% discount · taxable 90% of the value · “% of Value” deductions on 100%');
});
