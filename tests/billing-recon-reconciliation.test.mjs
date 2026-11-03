import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildReconciliation,
  filterReconciliationRows,
  scopeOptions,
  totalsOf,
} from '../src/lib/billing-recon/reconciliation.ts';

const boqRow = (id, over = {}) => ({
  id,
  'Scope 1': 'Civil',
  'Scope 2': 'Foundation',
  'BOQ SL No': '1.1',
  'ERP SL NO': '',
  Description: 'Excavation',
  Unit: 'Cum',
  QTY: 100,
  'Unit Rate': 250,
  'Total Amount': 25000,
  ...over,
});

const line = (over = {}) => ({
  boqSlNo: '1.1',
  scope1: 'Civil',
  scope2: 'Foundation',
  description: 'Excavation',
  unit: 'Cum',
  rate: 250,
  executedQty: 0,
  certifiedQty: 0,
  ...over,
});

const jmc = (id, items, status = 'Completed') => ({ id, jmcNo: `JMC-${id}`, jmcDate: '2026-10-01', status, items });
const mvac = (id, items, status = 'Certified') => ({ id, mvacNo: `MVAC-${id}`, mvacDate: '2026-10-02', status, items });
const bill = (id, status, items) => ({ id, billNo: `RA-${id}`, billDate: '2026-10-10', status, raSequence: 1, items });
const billLine = (billedQty, over = {}) => ({ ...line(), source: 'JMC', entryId: 'j1', itemIndex: 0, billedQty, amount: billedQty * 250, ...over });

test('quantities flow BOQ → executed → certified → billed with balances and values', () => {
  const { rows, totals, unmatched } = buildReconciliation({
    boqItems: [boqRow('b1')],
    jmcEntries: [jmc('j1', [line({ executedQty: 40, certifiedQty: 30 })]), jmc('j2', [line({ executedQty: 20, certifiedQty: 20 })])],
    mvacEntries: [mvac('m1', [line({ executedQty: 10, certifiedQty: 5 })])],
    bills: [bill('r1', 'Submitted', [billLine(25)]), bill('r2', 'Draft', [billLine(10)])],
  });
  assert.equal(unmatched.length, 0);
  const [row] = rows;
  assert.equal(row.jmcExecutedQty, 60);
  assert.equal(row.jmcCertifiedQty, 50);
  assert.equal(row.mvacExecutedQty, 10);
  assert.equal(row.mvacCertifiedQty, 5);
  assert.equal(row.executedQty, 70);
  assert.equal(row.certifiedQty, 55);
  assert.equal(row.billedQty, 35);
  assert.equal(row.toExecuteQty, 30);
  assert.equal(row.toCertifyQty, 15);
  assert.equal(row.toBillQty, 20);
  assert.equal(row.toBillValue, 5000);
  assert.equal(row.hasGap, true);
  assert.equal(row.isException, false);
  assert.equal(totals.boqValue, 25000);
  assert.equal(totals.executedValue, 17500);
  assert.equal(totals.certifiedValue, 13750);
  assert.equal(totals.billedValue, 8750);
  assert.equal(totals.toCertifyValue, 3750);
  assert.equal(totals.toBillValue, 5000);
});

test('cancelled bills and rejected / cancelled entries do not count', () => {
  const { rows } = buildReconciliation({
    boqItems: [boqRow('b1')],
    jmcEntries: [jmc('j1', [line({ executedQty: 40, certifiedQty: 40 })]), jmc('j2', [line({ executedQty: 99, certifiedQty: 99 })], 'Rejected')],
    mvacEntries: [mvac('m1', [line({ executedQty: 50, certifiedQty: 50 })], 'Cancelled')],
    bills: [bill('r1', 'Cancelled', [billLine(40)]), bill('r2', 'Submitted', [billLine(15)])],
  });
  assert.equal(rows[0].executedQty, 40);
  assert.equal(rows[0].certifiedQty, 40);
  assert.equal(rows[0].billedQty, 15);
});

test('over-executed and over-billed items are flagged and their excess kept out of the outstanding values', () => {
  const { rows, totals } = buildReconciliation({
    boqItems: [boqRow('b1', { QTY: 10, 'Total Amount': 2500 }), boqRow('b2', { 'BOQ SL No': '1.2' })],
    jmcEntries: [jmc('j1', [line({ executedQty: 12, certifiedQty: 8 }), line({ boqSlNo: '1.2', executedQty: 10, certifiedQty: 10 })])],
    bills: [bill('r1', 'Submitted', [billLine(9), billLine(4, { boqSlNo: '1.2', itemIndex: 1 })])],
  });
  const [over, fine] = rows;
  assert.equal(over.overExecuted, true);
  assert.equal(over.overBilled, true);
  assert.equal(over.toExecuteQty, -2);
  assert.equal(over.toBillQty, -1);
  assert.equal(over.toExecuteValue, 0);
  assert.equal(over.toBillValue, 0);
  assert.equal(over.isException, true);
  assert.equal(fine.isException, false);
  assert.equal(fine.toBillQty, 6);
  assert.equal(totals.toBillValue, 1500);
  assert.equal(totals.overBilledValue, 250);
  assert.equal(totals.overExecutedValue, 500);
  assert.equal(totals.overExecutedItems, 1);
  assert.equal(totals.overBilledItems, 1);
});

test('lines matching no BOQ item are reported as unmatched, not dropped', () => {
  const { rows, unmatched, unmatchedValue } = buildReconciliation({
    boqItems: [boqRow('b1')],
    jmcEntries: [
      jmc('j1', [
        line({ executedQty: 5, certifiedQty: 5 }),
        line({ boqSlNo: '9.9', executedQty: 3, certifiedQty: 2 }),
        line({ boqSlNo: '', executedQty: 1, certifiedQty: 1 }),
        line({ scope2: 'Superstructure', executedQty: 4, certifiedQty: 4 }),
        line({ boqSlNo: '8.8', executedQty: 0, certifiedQty: 0 }),
      ]),
    ],
    mvacEntries: [mvac('m1', [line({ scope1: 'Electrical', executedQty: 2, certifiedQty: 2 })])],
    bills: [bill('r1', 'Submitted', [billLine(1, { boqSlNo: '7.7', amount: 250 })])],
  });
  assert.equal(rows[0].executedQty, 5);
  assert.deepEqual(
    unmatched.map((u) => [u.source, u.boqSlNo, u.reason.startsWith('No BOQ item') ? 'no-item' : 'no-sl']),
    [
      ['JMC', '9.9', 'no-item'],
      ['JMC', '', 'no-sl'],
      ['JMC', '1.1', 'no-item'],
      ['MVAC', '1.1', 'no-item'],
      ['RA Bill', '7.7', 'no-item'],
    ],
  );
  assert.equal(unmatched[0].docNo, 'JMC-j1');
  assert.equal(unmatched[4].docNo, 'RA-r1');
  assert.equal(unmatchedValue, (2 + 1 + 4 + 2 + 1) * 250);
});

test('BOQ rows and lines match across key spellings, case and whitespace', () => {
  const { rows, unmatched } = buildReconciliation({
    boqItems: [
      { id: 'b1', 'scope 1': ' CIVIL ', 'SCOPE 2': 'Foundation  Works', 'boq sl no': '1.1', 'Total Qty': '1,000', Rate: '12.5' },
    ],
    jmcEntries: [
      jmc('j1', [{ scope1: 'civil', scope2: 'foundation works', boqSlNo: '1.1 ', executedQty: '10', certifiedQty: 8, rate: 12.5 }]),
      jmc('j2', [{ 'Scope 1': 'Civil', 'Scope 2': 'FOUNDATION WORKS', 'BOQ SL No': '1.1', executedQty: 5, certifiedQty: 5 }]),
    ],
  });
  assert.equal(unmatched.length, 0);
  assert.equal(rows[0].boqQty, 1000);
  assert.equal(rows[0].rate, 12.5);
  assert.equal(rows[0].boqAmount, 12500);
  assert.equal(rows[0].executedQty, 15);
  assert.equal(rows[0].certifiedQty, 13);
});

test('a duplicate BOQ key gets its quantities once, on the first item, and is flagged', () => {
  const { rows, totals } = buildReconciliation({
    boqItems: [boqRow('b2', { 'ERP SL NO': '20' }), boqRow('b1', { 'ERP SL NO': '3' })],
    jmcEntries: [jmc('j1', [line({ executedQty: 10, certifiedQty: 10 })])],
  });
  assert.deepEqual(rows.map((r) => r.id), ['b1', 'b2']);
  assert.equal(rows[0].executedQty, 10);
  assert.equal(rows[1].executedQty, 0);
  assert.equal(rows[1].duplicateOf, 'b1');
  assert.equal(rows[1].isException, true);
  assert.equal(totals.executedValue, 2500);
  assert.equal(totals.duplicateItems, 1);
});

test('filters by scope, search, gaps and exceptions; scope options follow scope 1', () => {
  const { rows } = buildReconciliation({
    boqItems: [
      boqRow('b1'),
      boqRow('b2', { 'BOQ SL No': '2.1', 'Scope 2': 'Tower', Description: 'Tower erection' }),
      boqRow('b3', { 'BOQ SL No': '3.1', 'Scope 1': 'Electrical', 'Scope 2': 'Stringing', Description: 'Conductor' }),
    ],
    jmcEntries: [jmc('j1', [line({ executedQty: 5, certifiedQty: 5 }), line({ boqSlNo: '2.1', scope2: 'Tower', executedQty: 200, certifiedQty: 200 })])],
  });
  assert.deepEqual(filterReconciliationRows(rows, { scope1: 'civil' }).map((r) => r.id), ['b1', 'b2']);
  assert.deepEqual(filterReconciliationRows(rows, { scope1: 'all', scope2: 'TOWER' }).map((r) => r.id), ['b2']);
  assert.deepEqual(filterReconciliationRows(rows, { search: 'conductor' }).map((r) => r.id), ['b3']);
  assert.deepEqual(filterReconciliationRows(rows, { onlyGaps: true }).map((r) => r.id), ['b1', 'b2']);
  assert.deepEqual(filterReconciliationRows(rows, { onlyExceptions: true }).map((r) => r.id), ['b2']);
  assert.deepEqual(scopeOptions(rows), { scope1: ['Civil', 'Electrical'], scope2: ['Foundation', 'Stringing', 'Tower'] });
  assert.deepEqual(scopeOptions(rows, 'Electrical').scope2, ['Stringing']);
  const visible = totalsOf(filterReconciliationRows(rows, { scope1: 'Electrical' }));
  assert.equal(visible.items, 1);
  assert.equal(visible.boqValue, 25000);
});

test('a BOQ amount left at 0 by an import falls back to qty × rate; a missing rate comes from the amount', () => {
  const { rows } = buildReconciliation({
    boqItems: [
      boqRow('b1', { 'Total Amount': 0 }),
      boqRow('b2', { 'BOQ SL No': '1.2', 'Unit Rate': '', 'Total Amount': '5,000' }),
    ],
  });
  assert.equal(rows[0].boqAmount, 25000);
  assert.equal(rows[1].rate, 50);
});
