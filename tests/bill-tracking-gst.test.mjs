import test from 'node:test';
import assert from 'node:assert/strict';

import { computeDeductions, deductionBase, splitGst, splitInclusiveTotal, suggestGst, totalFromComponents } from '../src/lib/bill-tracking/gst.ts';
import { againstInvoiceFromDescription } from '../src/lib/bill-tracking/import.ts';
import { DEFAULT_DEDUCTION_TYPES, withConfigDefaults } from '../src/lib/bill-tracking/defaults.ts';
import { DEFAULT_ATTRIBUTION } from '../src/lib/gst-registrations.ts';

const types = DEFAULT_DEDUCTION_TYPES;
const id = (code) => types.find((type) => type.code === code).id;

/* ── bill GST ────────────────────────────────────────────────────────────── */

test('CGST + SGST take half the rate each; IGST the whole rate', () => {
  assert.deepEqual(splitGst(1000000, 'cgst-sgst', 18), { gstType: 'cgst-sgst', gstPercent: 18, cgstRate: 9, sgstRate: 9, igstRate: 0, cgstAmount: 90000, sgstAmount: 90000, igstAmount: 0, gstAmount: 180000 });
  assert.deepEqual(splitGst(1000000, 'igst', 18), { gstType: 'igst', gstPercent: 18, cgstRate: 0, sgstRate: 0, igstRate: 18, cgstAmount: 0, sgstAmount: 0, igstAmount: 180000, gstAmount: 180000 });
  assert.equal(splitGst(1000000, 'none', 18).gstAmount, 0);
  assert.equal(splitGst(1688145.42, 'cgst-sgst', 18).cgstAmount, 151933.09, 'components to the paisa');
});

test('a credit note’s GST is negative', () => {
  const split = splitGst(-70170, 'cgst-sgst', 18);
  assert.equal(split.cgstAmount, -6315.3);
  assert.equal(split.gstAmount, -12630.6);
});

test('the total follows the components entered (they may differ from the computed ones)', () => {
  assert.equal(totalFromComponents('cgst-sgst', { cgstAmount: 90000.5, sgstAmount: 90000.5 }), 180001);
  assert.equal(totalFromComponents('igst', { igstAmount: 180000, cgstAmount: 5 }), 180000, 'IGST ignores stray CGST');
  assert.equal(totalFromComponents('none', { igstAmount: 10 }), 0);
});

test('the split is suggested from the issuing registration and the client’s state', () => {
  const setup = {
    registrations: [
      { id: 'od', gstin: '21AAPFU0939F1Z7', stateCode: '21', stateName: 'Odisha', label: 'Odisha', active: true },
      { id: 'mh', gstin: '27AAPFU0939F1ZV', stateCode: '27', stateName: 'Maharashtra', label: 'Maharashtra', active: true },
    ],
    attribution: { ...DEFAULT_ATTRIBUTION, defaultRegistrationId: 'od' },
    maps: { byProject: { 'p-mh': 'mh' }, byDepartment: {} },
  };
  const maharashtraClient = '27AAPFU0939F1ZV';
  // Maharashtra project (its registration), Maharashtra client → intra-state.
  assert.equal(suggestGst(setup, { projectId: 'p-mh', clientGstin: maharashtraClient }).gstType, 'cgst-sgst');
  // Odisha registration (the default), Maharashtra client → inter-state.
  const inter = suggestGst(setup, { projectId: 'p-od', clientGstin: maharashtraClient });
  assert.equal(inter.gstType, 'igst');
  assert.equal(inter.registration.id, 'od');
  assert.match(inter.reason, /IGST/);
  // A registration chosen on the bill wins.
  assert.equal(suggestGst(setup, { projectId: 'p-od', chosenRegistrationId: 'mh', clientGstin: maharashtraClient }).gstType, 'cgst-sgst');
  // No client GSTIN → CGST + SGST, and says why.
  assert.match(suggestGst(setup, { projectId: 'p-mh' }).reason, /no valid GSTIN/);
  // No registrations at all → still a sensible default with a reason.
  assert.equal(suggestGst(undefined, {}).gstType, 'cgst-sgst');
});

/* ── deductions ──────────────────────────────────────────────────────────── */

const context = { taxable: 1000000, gross: 1180000, roundToRupee: true };

test('Income TDS is taken of taxable less the mobilisation advance', () => {
  const lines = computeDeductions(
    [
      { id: 'mob', deductionTypeId: id('MOBADV'), baseAmount: 200000 },
      { id: 'tds', deductionTypeId: id('ITDS'), percentage: 2 },
    ],
    types,
    context,
  );
  const tds = lines.find((line) => line.id === 'tds');
  assert.equal(tds.calculationBase, 800000);
  assert.equal(tds.amount, 16000);
  assert.equal(tds.percentage, 2);
});

test('percentage lines are rounded to the rupee unless switched off', () => {
  const [rounded] = computeDeductions([{ id: 't', deductionTypeId: id('ITDS'), percentage: 2 }], types, { taxable: 1688145.42, gross: 0, roundToRupee: true });
  assert.equal(rounded.amount, 33763);
  const [exact] = computeDeductions([{ id: 't', deductionTypeId: id('ITDS'), percentage: 2 }], types, { taxable: 1688145.42, gross: 0, roundToRupee: false });
  assert.equal(exact.amount, 33762.91);
});

test('GST on a GST-applicable deduction is added to it', () => {
  const lcWithGst = types.map((type) => (type.code === 'LCCOMM' ? { ...type, gstApplicable: true, gstRate: 18 } : type));
  const [line] = computeDeductions([{ id: 'lc', deductionTypeId: id('LCCOMM'), baseAmount: 10000, gstRate: 18 }], lcWithGst, context);
  assert.deepEqual({ base: line.baseAmount, gst: line.gstAmount, total: line.amount }, { base: 10000, gst: 1800, total: 11800 });
  // Split like the bill's GST: CGST + SGST at half the rate each…
  assert.deepEqual({ cgst: [line.cgstRate, line.cgstAmount], sgst: [line.sgstRate, line.sgstAmount], igst: line.igstAmount }, { cgst: [9, 900], sgst: [9, 900], igst: undefined });
  // …or IGST at the full rate on an IGST bill.
  const [inter] = computeDeductions([{ id: 'lc', deductionTypeId: id('LCCOMM'), baseAmount: 10000, gstRate: 18 }], lcWithGst, { ...context, gstType: 'igst' });
  assert.deepEqual({ igst: [inter.igstRate, inter.igstAmount], cgst: inter.cgstAmount, total: inter.amount }, { igst: [18, 1800], cgst: undefined, total: 11800 });
  // The screenshot case: ₹10 at 18% → CGST 9% ₹0.90 + SGST 9% ₹0.90.
  const [small] = computeDeductions([{ id: 'm', deductionTypeId: id('LCCOMM'), baseAmount: 10, gstRate: 18 }], lcWithGst, context);
  assert.deepEqual([small.cgstAmount, small.sgstAmount, small.amount], [0.9, 0.9, 11.8]);
  // A line saved without GST keeps none even though the type now carries GST.
  const [legacy] = computeDeductions([{ id: 'lc', deductionTypeId: id('LCCOMM'), baseAmount: 10000, gstRate: 0 }], lcWithGst, context);
  assert.equal(legacy.amount, 10000);
  // A type without GST never adds it, whatever the line says.
  const [plain] = computeDeductions([{ id: 'o', deductionTypeId: id('OTHER'), baseAmount: 10000, gstRate: 18 }], types, context);
  assert.equal(plain.amount, 10000);
});

test('GST amounts typed to match the client win over the computed split', () => {
  const lcWithGst = types.map((type) => (type.code === 'LCCOMM' ? { ...type, gstApplicable: true, gstRate: 18 } : type));
  const [line] = computeDeductions([{ id: 'lc', deductionTypeId: id('LCCOMM'), baseAmount: 100, gstRate: 18, cgstAmount: 9.01, sgstAmount: 9 }], lcWithGst, context);
  assert.deepEqual([line.cgstAmount, line.sgstAmount, line.gstAmount, line.amount, line.gstManual], [9.01, 9, 18.01, 118.01, true]);
  // On an IGST bill only the IGST figure is read.
  const [inter] = computeDeductions([{ id: 'lc', deductionTypeId: id('LCCOMM'), baseAmount: 100, gstRate: 18, igstAmount: 18.2, cgstAmount: 5 }], lcWithGst, { ...context, gstType: 'igst' });
  assert.deepEqual([inter.igstAmount, inter.amount, inter.cgstAmount], [18.2, 118.2, undefined]);
});

test('typing a GST-inclusive total works out the base and an exact split', () => {
  assert.deepEqual(splitInclusiveTotal(118, 18, 'cgst-sgst'), { baseAmount: 100, cgstAmount: 9, sgstAmount: 9 });
  assert.deepEqual(splitInclusiveTotal(118, 18, 'igst'), { baseAmount: 100, igstAmount: 18 });
  assert.deepEqual(splitInclusiveTotal(50, 0, 'cgst-sgst'), { baseAmount: 50 });
  // Parts always add back to the total typed, odd paisa to SGST.
  const parts = splitInclusiveTotal(1000, 18, 'cgst-sgst');
  assert.equal(Math.round((parts.baseAmount + parts.cgstAmount + parts.sgstAmount) * 100) / 100, 1000);
  const lcWithGst = types.map((type) => (type.code === 'LCCOMM' ? { ...type, gstApplicable: true, gstRate: 18 } : type));
  const [line] = computeDeductions([{ id: 'lc', deductionTypeId: id('LCCOMM'), gstRate: 18, ...parts }], lcWithGst, context);
  assert.equal(line.amount, 1000);
});

test('a percentage line may be based on another percentage line; a cycle settles', () => {
  const custom = [
    ...types,
    { id: 'adv', code: 'ADVPCT', name: 'Advance recovery', kind: 'mobilization_advance', calculation: 'percentage', percentBase: 'taxable', defaultPercent: 10, sequence: 20, active: true },
    { id: 'tdsx', code: 'TDSX', name: 'TDS on net of advance', kind: 'statutory', calculation: 'percentage', percentBase: 'taxable', baseLessTypeIds: ['adv'], defaultPercent: 2, sequence: 21, active: true },
  ];
  const lines = computeDeductions([{ id: 't', deductionTypeId: 'tdsx', percentage: 2 }, { id: 'a', deductionTypeId: 'adv', percentage: 10 }], custom, context);
  assert.equal(lines[1].amount, 100000);
  assert.equal(lines[0].amount, 18000, '2% of (10,00,000 − 1,00,000)');

  const cyclic = [
    { id: 'x', code: 'X', name: 'X', kind: 'other', calculation: 'percentage', percentBase: 'taxable', baseLessTypeIds: ['y'], sequence: 1, active: true },
    { id: 'y', code: 'Y', name: 'Y', kind: 'other', calculation: 'percentage', percentBase: 'taxable', baseLessTypeIds: ['x'], sequence: 2, active: true },
  ];
  const settled = computeDeductions([{ id: '1', deductionTypeId: 'x', percentage: 10 }, { id: '2', deductionTypeId: 'y', percentage: 10 }], cyclic, context);
  assert.equal(settled.length, 2, 'finishes instead of looping');
});

test('gross-based percentage and a fixed legacy line', () => {
  assert.equal(deductionBase({ percentBase: 'gross', baseLessTypeIds: [] }, context, []), 1180000);
  const [legacy] = computeDeductions([{ id: 'l', deductionTypeId: id('MOBADV'), amount: -522037 }], types, context);
  assert.equal(legacy.amount, -522037, 'a legacy line carrying only an amount keeps it, sign included');
});

/* ── configuration & import ──────────────────────────────────────────────── */

test('a saved configuration gets the Income TDS formula and GST settings it lacked', () => {
  const stored = { deductionTypes: DEFAULT_DEDUCTION_TYPES.map(({ baseLessTypeIds: _less, ...type }) => type), settings: { tolerance: 1 } };
  const config = withConfigDefaults(stored);
  assert.deepEqual(config.deductionTypes.find((type) => type.code === 'ITDS').baseLessTypeIds, ['dt-mobadv']);
  assert.equal(config.settings.defaultGstRate, 18);
  assert.equal(config.settings.roundDeductionsToRupee, true);
  const cleared = withConfigDefaults({ deductionTypes: DEFAULT_DEDUCTION_TYPES.map((type) => (type.code === 'ITDS' ? { ...type, baseLessTypeIds: [] } : type)) });
  assert.deepEqual(cleared.deductionTypes.find((type) => type.code === 'ITDS').baseLessTypeIds, [], 'an administrator’s choice is kept');
});

test('legacy notes name their invoice in the description', () => {
  assert.equal(againstInvoiceFromDescription('Against Inv No -OD-168/2025-26'), 'OD-168/2025-26');
  assert.equal(againstInvoiceFromDescription('against invoice KA-001'), 'KA-001');
  assert.equal(againstInvoiceFromDescription('RTN-Supply-10%'), undefined);
});
