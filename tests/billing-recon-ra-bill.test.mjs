import test from 'node:test';
import assert from 'node:assert/strict';

import {
  billedBefore,
  billedQtyByLine,
  canCancelRaBill,
  canEditRaBill,
  canSubmitRaBill,
  computeBillableLines,
  formatRaBillNo,
  isDuplicateBillNo,
  lineRef,
  nextRaSequence,
  summarizeRaBills,
  unbilledCertifiedValue,
  validateRaBillDraft,
} from '../src/lib/billing-recon/ra-bill.ts';
import { compositeKey, lineKey, parseQtyInput, readBoqSlNo, readScope, roundTo } from '../src/lib/billing-recon/lines.ts';

const jmcLine = (over = {}) => ({
  boqSlNo: '1.1',
  scope1: 'Civil',
  scope2: 'Foundation',
  description: 'Excavation',
  unit: 'Cum',
  rate: 250,
  executedQty: 100,
  certifiedQty: 100,
  totalAmount: 25000,
  ...over,
});

const jmc = (id, no, date, items, status = 'Completed') => ({ id, jmcNo: no, jmcDate: date, status, items });
const mvac = (id, no, date, items, status = 'Certified') => ({ id, mvacNo: no, mvacDate: date, status, items });

const billItem = (source, entryId, itemIndex, billedQty, over = {}) => ({
  source,
  entryId,
  entryNo: '',
  itemIndex,
  boqSlNo: '1.1',
  scope1: 'Civil',
  scope2: 'Foundation',
  description: '',
  unit: 'Cum',
  rate: 250,
  certifiedQty: 100,
  previouslyBilledQty: 0,
  billedQty,
  amount: billedQty * 250,
  ...over,
});

const bill = (id, status, raSequence, items, over = {}) => ({
  id,
  billNo: `RA-${String(raSequence).padStart(2, '0')}`,
  billDate: '2026-11-01',
  status,
  raSequence,
  items,
  totalAmount: items.reduce((s, i) => s + i.amount, 0),
  ...over,
});

const draft = (lines, over = {}) => ({ billNo: 'RA-09', billDate: '2026-11-03', lines, ...over });

test('only certified lines on entries that still count are billable', () => {
  const lines = computeBillableLines({
    jmcEntries: [
      jmc('j1', 'JMC-001', '2026-10-01', [jmcLine(), jmcLine({ boqSlNo: '1.2', certifiedQty: 0 }), jmcLine({ boqSlNo: '1.3', certifiedQty: undefined })]),
      jmc('j2', 'JMC-002', '2026-10-05', [jmcLine()], 'Rejected'),
      jmc('j3', 'JMC-003', '2026-10-06', [jmcLine()], 'cancelled'),
    ],
    mvacEntries: [mvac('m1', 'MVAC-001', '2026-10-02', [jmcLine({ certifiedQty: '12.5' })])],
  });
  assert.deepEqual(
    lines.map((l) => l.ref),
    [lineRef('JMC', 'j1', 0), lineRef('MVAC', 'm1', 0)],
  );
  assert.equal(lines[1].certifiedQty, 12.5);
  assert.equal(lines[0].entryNo, 'JMC-001');
  assert.equal(lines[0].balanceQty, 100);
});

test('partial billing across two bills leaves the right balance', () => {
  const entries = [jmc('j1', 'JMC-001', '2026-10-01', [jmcLine()])];
  const bills = [
    bill('b1', 'Submitted', 1, [billItem('JMC', 'j1', 0, 30)]),
    bill('b2', 'Draft', 2, [billItem('JMC', 'j1', 0, 45.5)]),
  ];
  const [line] = computeBillableLines({ jmcEntries: entries, bills });
  assert.equal(line.previouslyBilledQty, 75.5);
  assert.equal(line.balanceQty, 24.5);

  const ok = validateRaBillDraft(draft([{ ref: line.ref, billedQty: '24.5' }]), [line], bills);
  assert.equal(ok.ok, true, ok.errors.join(' '));
  assert.equal(ok.items.length, 1);
  assert.equal(ok.items[0].billedQty, 24.5);
  assert.equal(ok.items[0].previouslyBilledQty, 75.5);
  assert.equal(ok.items[0].amount, 6125);
  assert.equal(ok.totalAmount, 6125);
});

test('cancelled bills do not count as billed', () => {
  const entries = [jmc('j1', 'JMC-001', '2026-10-01', [jmcLine()])];
  const bills = [
    bill('b1', 'Cancelled', 1, [billItem('JMC', 'j1', 0, 100)]),
    bill('b2', 'Submitted', 2, [billItem('JMC', 'j1', 0, 10)]),
  ];
  const [line] = computeBillableLines({ jmcEntries: entries, bills });
  assert.equal(line.previouslyBilledQty, 10);
  assert.equal(line.balanceQty, 90);
  assert.equal(billedQtyByLine(bills).get(lineRef('JMC', 'j1', 0)), 10);
});

test('editing a draft leaves its own quantities out of the balance', () => {
  const entries = [jmc('j1', 'JMC-001', '2026-10-01', [jmcLine()])];
  const bills = [
    bill('b1', 'Submitted', 1, [billItem('JMC', 'j1', 0, 60)]),
    bill('b2', 'Draft', 2, [billItem('JMC', 'j1', 0, 40)]),
  ];
  const without = computeBillableLines({ jmcEntries: entries, bills });
  assert.equal(without[0].balanceQty, 0);

  const editing = computeBillableLines({ jmcEntries: entries, bills, excludeBillId: 'b2' });
  assert.equal(editing[0].previouslyBilledQty, 60);
  assert.equal(editing[0].balanceQty, 40);

  const result = validateRaBillDraft(
    draft([{ ref: editing[0].ref, billedQty: 40 }], { billNo: 'RA-02' }),
    editing,
    bills,
    { editingBillId: 'b2' },
  );
  assert.equal(result.ok, true, result.errors.join(' '));
});

test('billing more than the balance is rejected', () => {
  const entries = [jmc('j1', 'JMC-001', '2026-10-01', [jmcLine({ certifiedQty: 10 })])];
  const bills = [bill('b1', 'Submitted', 1, [billItem('JMC', 'j1', 0, 4)])];
  const lines = computeBillableLines({ jmcEntries: entries, bills });
  const result = validateRaBillDraft(draft([{ ref: lines[0].ref, billedQty: 6.01 }]), lines, bills);
  assert.equal(result.ok, false);
  assert.match(result.lineErrors[lines[0].ref], /Only 6 Cum is left/);
  assert.equal(result.items.length, 0);

  // Float noise within the tolerance is not over-billing.
  const noisy = validateRaBillDraft(draft([{ ref: lines[0].ref, billedQty: 0.1 + 0.2 + 5.7 }]), lines, bills);
  assert.equal(noisy.ok, true, noisy.errors.join(' '));
  assert.equal(noisy.items[0].billedQty, 6);
});

test('a draft needs a quantity, a number and a date, and checks every line', () => {
  const lines = computeBillableLines({ jmcEntries: [jmc('j1', 'JMC-001', '2026-10-01', [jmcLine(), jmcLine({ boqSlNo: '1.2' })])] });
  const empty = validateRaBillDraft(draft([{ ref: lines[0].ref, billedQty: '' }]), lines, []);
  assert.equal(empty.ok, false);
  assert.ok(empty.errors.some((e) => /at least one line/.test(e)));

  const bad = validateRaBillDraft(
    draft(
      [
        { ref: lines[0].ref, billedQty: '12a' },
        { ref: lines[1].ref, billedQty: '-3' },
      ],
      { billNo: '  ', billDate: '2026-02-30', periodFrom: '2026-10-31', periodTo: '2026-10-01' },
    ),
    lines,
    [],
  );
  assert.equal(bad.ok, false);
  assert.equal(bad.lineErrors[lines[0].ref], 'Enter a number.');
  assert.match(bad.lineErrors[lines[1].ref], /negative/);
  assert.ok(bad.errors.includes('Enter the bill number.'));
  assert.ok(bad.errors.includes('Enter the bill date.'));
  assert.ok(bad.errors.includes('The period ends before it starts.'));
});

test('a negative rate on the entry line blocks billing it', () => {
  const lines = computeBillableLines({ jmcEntries: [jmc('j1', 'JMC-001', '2026-10-01', [jmcLine({ rate: -5 })])] });
  const result = validateRaBillDraft(draft([{ ref: lines[0].ref, billedQty: 1 }]), lines, []);
  assert.equal(result.ok, false);
  assert.match(result.lineErrors[lines[0].ref], /rate is negative/);
});

test('a quantity on a line that is no longer certified is flagged, not silently dropped', () => {
  const lines = computeBillableLines({ jmcEntries: [jmc('j1', 'JMC-001', '2026-10-01', [jmcLine()], 'Rejected')] });
  assert.equal(lines.length, 0);
  const stale = lineRef('JMC', 'j1', 0);
  const result = validateRaBillDraft(draft([{ ref: stale, billedQty: 5 }]), lines, []);
  assert.equal(result.ok, false);
  assert.match(result.lineErrors[stale], /no longer certified/);
  // A blank quantity on such a line is just ignored.
  const blank = validateRaBillDraft(draft([{ ref: stale, billedQty: '' }]), lines, []);
  assert.equal(blank.lineErrors[stale], undefined);
});

test('amounts round to paise and the total adds the rounded lines', () => {
  const lines = computeBillableLines({
    jmcEntries: [jmc('j1', 'JMC-001', '2026-10-01', [jmcLine({ rate: 33.335, certifiedQty: 3 }), jmcLine({ boqSlNo: '1.2', rate: 0.005, certifiedQty: 1 })])],
  });
  const result = validateRaBillDraft(
    draft([
      { ref: lines[0].ref, billedQty: 1 },
      { ref: lines[1].ref, billedQty: 1 },
    ]),
    lines,
    [],
  );
  assert.equal(result.ok, true, result.errors.join(' '));
  assert.equal(result.items[0].amount, 33.34);
  assert.equal(result.items[1].amount, 0.01);
  assert.equal(result.totalAmount, 33.35);
  assert.equal(roundTo(1.005, 2), 1.01);
});

test('RA numbering continues after the highest number, cancelled bills included', () => {
  assert.equal(nextRaSequence([]), 1);
  assert.equal(nextRaSequence([{ id: 'a', raSequence: 1 }, { id: 'b', raSequence: 3, status: 'Cancelled' }, { id: 'c', raSequence: '2' }]), 4);
  assert.equal(formatRaBillNo(1), 'RA-01');
  assert.equal(formatRaBillNo(12, 'SEL/220KV/'), 'SEL/220KV/RA-12');
  assert.equal(formatRaBillNo(105), 'RA-105');
  assert.equal(formatRaBillNo(0), 'RA-01');
});

test('bill numbers are unique ignoring case and spacing, cancelled bills included', () => {
  const bills = [
    { id: 'a', billNo: 'RA-01', status: 'Submitted' },
    { id: 'b', billNo: 'ra-02 ', status: 'Cancelled' },
  ];
  assert.equal(isDuplicateBillNo(' ra-01', bills), true);
  assert.equal(isDuplicateBillNo('RA-02', bills), true);
  assert.equal(isDuplicateBillNo('RA-01', bills, 'a'), false);
  assert.equal(isDuplicateBillNo('RA-03', bills), false);
  const result = validateRaBillDraft(draft([], { billNo: 'Ra-02' }), [], bills);
  assert.ok(result.errors.some((e) => /already used/.test(e)));
});

test('the register summary and the unbilled value', () => {
  const bills = [
    bill('b1', 'Submitted', 1, [billItem('JMC', 'j1', 0, 30)]),
    bill('b2', 'Draft', 2, [billItem('JMC', 'j1', 0, 10)]),
    bill('b3', 'Cancelled', 3, [billItem('JMC', 'j1', 0, 50)]),
  ];
  assert.deepEqual(summarizeRaBills(bills), { count: 2, draftCount: 1, submittedCount: 1, cancelledCount: 1, billedValue: 10000 });
  const lines = computeBillableLines({ jmcEntries: [jmc('j1', 'JMC-001', '2026-10-01', [jmcLine()])], bills });
  assert.equal(unbilledCertifiedValue(lines), 60 * 250);
  assert.equal(canEditRaBill(bills[1]), true);
  assert.equal(canEditRaBill(bills[0]), false);
  assert.equal(canSubmitRaBill(bills[1]), true);
  assert.equal(canCancelRaBill(bills[0]), true);
  assert.equal(canCancelRaBill(bills[2]), false);
});

test('"up to previous bill" counts earlier, non-cancelled bills only', () => {
  const ref = lineRef('JMC', 'j1', 0);
  const bills = [
    bill('b1', 'Submitted', 1, [billItem('JMC', 'j1', 0, 10)]),
    bill('b2', 'Cancelled', 2, [billItem('JMC', 'j1', 0, 20)]),
    bill('b3', 'Submitted', 3, [billItem('JMC', 'j1', 0, 5)]),
    bill('b4', 'Draft', 4, [billItem('JMC', 'j1', 0, 7)]),
  ];
  assert.equal(billedBefore(bills[2], bills).get(ref), 10);
  assert.equal(billedBefore(bills[3], bills).get(ref), 15);
  assert.equal(billedBefore(bills[0], bills).get(ref), undefined);
});

test('lines order by source, entry date and number; MVAC lines are keyed apart from JMC', () => {
  const lines = computeBillableLines({
    jmcEntries: [jmc('j2', 'JMC-10', '2026-10-05', [jmcLine()]), jmc('j1', 'JMC-9', '2026-10-05', [jmcLine(), jmcLine({ boqSlNo: '2' })])],
    mvacEntries: [mvac('j1', 'MVAC-1', '2026-09-01', [jmcLine()])],
  });
  assert.deepEqual(
    lines.map((l) => l.ref),
    ['JMC|j1|0', 'JMC|j1|1', 'JMC|j2|0', 'MVAC|j1|0'],
  );
});

test('scope keys match across spellings, case and whitespace', () => {
  assert.equal(readScope({ 'Scope 1': ' Civil ' }, 1), 'Civil');
  assert.equal(readScope({ scope1: 'Civil' }, 1), 'Civil');
  assert.equal(readScope({ 'SCOPE.2': 'Tower' }, 2), 'Tower');
  assert.equal(readScope({ 'Scope 1': '', scope1: 'Civil' }, 1), 'Civil');
  assert.equal(readBoqSlNo({ 'BOQ SL No': ' 1.1 ' }), '1.1');
  assert.equal(readBoqSlNo({ boqSlNo: 7 }), '7');
  assert.equal(readBoqSlNo({ 'SL. No.': '3' }), '3');
  assert.equal(readBoqSlNo({ 'boq sl no': 'A1', 'SL. No.': '3' }), 'A1');
  assert.equal(
    lineKey({ 'Scope 1': 'CIVIL  Works', 'Scope 2': ' Tower ', 'BOQ SL No': '1.1' }),
    lineKey({ scope1: 'civil works', scope2: 'tower', boqSlNo: '1.1 ' }),
  );
  assert.equal(compositeKey('A', 'B', '1'), 'a__b__1');
  assert.equal(parseQtyInput('1,250.5'), 1250.5);
  assert.equal(parseQtyInput(''), 0);
  assert.ok(Number.isNaN(parseQtyInput('1.2.3')));
  assert.ok(Number.isNaN(parseQtyInput('1e3')));
});
