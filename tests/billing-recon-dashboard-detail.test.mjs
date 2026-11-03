import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ageingBuckets,
  billRows,
  billsForRegister,
  exceptionList,
  financialYearLabel,
  financialYearStart,
  periodComparison,
  statusBreakdown,
  topScopes,
} from '../src/lib/billing-recon/dashboard-detail.ts';
import { buildReconciliation } from '../src/lib/billing-recon/reconciliation.ts';

const NOW = Date.UTC(2026, 10, 3, 12); // 3 Nov 2026
const DAY = 86_400_000;
const ts = (ms) => ({ toMillis: () => ms });

const pending = (over) => ({ kind: 'JMC', id: 'x', number: 'J', stage: 's', status: 'Pending', woNo: '', deadline: null, createdAt: null, overdue: false, ageDays: 0, executedValue: 10, ...over });

test('open entries fall into the right age bucket', () => {
  const { buckets, undated } = ageingBuckets([
    pending({ ageDays: 0 }),
    pending({ ageDays: 7, kind: 'MVAC' }),
    pending({ ageDays: 8, overdue: true }),
    pending({ ageDays: 30 }),
    pending({ ageDays: 61, executedValue: 5 }),
    pending({ ageDays: null }),
  ]);
  assert.deepEqual(buckets.map((b) => b.count), [2, 1, 1, 0, 1]);
  assert.equal(buckets[0].jmc, 1);
  assert.equal(buckets[0].mvac, 1);
  assert.equal(buckets[1].overdue, 1);
  assert.equal(buckets[4].value, 5);
  assert.equal(undated, 1);
});

test('the financial year runs April to March', () => {
  assert.equal(financialYearStart(Date.UTC(2026, 3, 1)), 2026);
  assert.equal(financialYearStart(Date.UTC(2026, 2, 31)), 2025);
  assert.equal(financialYearLabel(2026), 'FY 2026–27');
  assert.equal(financialYearLabel(2099), 'FY 2099–00');
});

test('period figures split this month, last month and the financial year', () => {
  const line = (exec, cert) => [{ rate: 10, executedQty: exec, certifiedQty: cert }];
  const result = periodComparison(
    [
      {
        jmcEntries: [
          { id: 'a', jmcDate: '2026-11-02', status: 'Pending', items: line(1, 0) },
          { id: 'b', jmcDate: '2026-10-15', status: 'Completed', items: line(2, 2) },
          { id: 'c', jmcDate: '2026-04-01', status: 'Completed', items: line(3, 3) },
          { id: 'd', jmcDate: '2026-03-31', status: 'Completed', items: line(100, 100) }, // previous FY
          { id: 'e', jmcDate: '2026-11-01', status: 'Rejected', items: line(50, 50) }, // void
        ],
        mvacEntries: [{ id: 'm', createdAt: ts(NOW - DAY), status: 'Pending', items: line(4, 1) }],
        bills: [
          { status: 'Submitted', totalAmount: 20, billDate: '2026-11-01' },
          { status: 'Cancelled', totalAmount: 999, billDate: '2026-11-01' },
          { status: 'Draft', totalAmount: 5, billDate: '2026-10-20' },
        ],
      },
    ],
    NOW,
  );
  assert.equal(result.thisMonthLabel, 'Nov 2026');
  assert.equal(result.lastMonthLabel, 'Oct 2026');
  assert.equal(result.financialYearLabel, 'FY 2026–27');
  assert.deepEqual(result.thisMonth, { jmcRaised: 1, mvacRaised: 1, executed: 50, certified: 10, bills: 1, billed: 20 });
  assert.deepEqual(result.lastMonth, { jmcRaised: 1, mvacRaised: 0, executed: 20, certified: 20, bills: 1, billed: 5 });
  assert.deepEqual(result.financialYear, { jmcRaised: 3, mvacRaised: 1, executed: 100, certified: 60, bills: 2, billed: 25 });
});

test('last month wraps into the previous year in January', () => {
  const jan = Date.UTC(2027, 0, 10);
  const r = periodComparison([{ jmcEntries: [{ id: 'a', jmcDate: '2026-12-05', status: 'Pending', items: [] }], mvacEntries: [], bills: [] }], jan);
  assert.equal(r.lastMonthLabel, 'Dec 2026');
  assert.equal(r.lastMonth.jmcRaised, 1);
  assert.equal(r.financialYear.jmcRaised, 1);
});

test('statuses are listed in workflow order with unknown ones last', () => {
  const rows = statusBreakdown([
    { jmcEntries: [{ id: '1', status: 'Completed' }, { id: '2', status: 'Pending' }, { id: '3', status: 'Odd' }, { id: '4' }], mvacEntries: [{ id: 'm', status: 'Pending' }] },
  ]);
  assert.deepEqual(rows.map((r) => r.status), ['Pending', 'Completed', 'Odd']);
  assert.deepEqual(rows[0], { status: 'Pending', jmc: 2, mvac: 1 });
});

const boq = [
  { id: 'b1', 'Scope 1': 'Civil', 'Scope 2': 'Sub A', 'BOQ SL No': '1', QTY: 10, Rate: 100 },
  { id: 'b2', 'Scope 1': 'Civil', 'Scope 2': 'Sub A', 'BOQ SL No': '2', QTY: 5, Rate: 10 },
  { id: 'b3', 'Scope 1': 'Elec', 'Scope 2': 'Sub B', 'BOQ SL No': '1', QTY: 1, Rate: 1000 },
];
const jmc = [
  {
    id: 'j1',
    jmcNo: 'J-1',
    status: 'Completed',
    items: [
      { scope1: 'Civil', scope2: 'Sub A', boqSlNo: '1', rate: 100, executedQty: 12, certifiedQty: 8 },
      { scope1: 'Elec', scope2: 'Sub B', boqSlNo: '1', rate: 1000, executedQty: 1, certifiedQty: 1 },
      { scope1: 'Civil', scope2: 'Sub A', boqSlNo: '99', rate: 7, executedQty: 1, certifiedQty: 1 },
    ],
  },
];
const bills = [{ id: 'r1', status: 'Submitted', billNo: 'RA-01', items: [{ source: 'JMC', entryId: 'j1', itemIndex: 1, scope1: 'Elec', scope2: 'Sub B', boqSlNo: '1', billedQty: 1, rate: 1000 }] }];

test('scopes are ranked by certified value waiting to be billed', () => {
  const rec = buildReconciliation({ boqItems: boq, jmcEntries: jmc, mvacEntries: [], bills });
  const scopes = topScopes([{ projectId: 'p', projectName: 'P', rows: rec.rows }]);
  assert.equal(scopes.length, 1); // Sub B is fully billed
  assert.equal(scopes[0].scope2, 'Sub A');
  assert.equal(scopes[0].toBillValue, 800);
  assert.equal(scopes[0].toCertifyValue, 400);
  assert.equal(scopes[0].items, 2);
});

test('exceptions list over-execution and unmatched lines with their value', () => {
  const rec = buildReconciliation({ boqItems: boq, jmcEntries: jmc, mvacEntries: [], bills });
  const { rows, counts } = exceptionList([{ projectId: 'p', projectName: 'P', reconciliation: rec }]);
  assert.equal(counts['Over-executed'], 1);
  assert.equal(counts['Unmatched line'], 1);
  assert.equal(counts['Over-billed'], 0);
  assert.equal(rows[0].kind, 'Over-executed');
  assert.equal(rows[0].value, 200);
  assert.ok(rows.some((r) => r.kind === 'Unmatched line' && r.reference.startsWith('JMC J-1')));
});

test('bills needing attention: old drafts and submitted bills without a Bill Tracking ref', () => {
  const rows = billRows(
    [
      {
        projectId: 'p',
        projectName: 'P',
        bills: [
          { id: 'a', status: 'Draft', billNo: 'RA-01', createdAt: ts(NOW - 10 * DAY), totalAmount: 100 },
          { id: 'b', status: 'Draft', billNo: 'RA-02', createdAt: ts(NOW - 2 * DAY) },
          { id: 'c', status: 'Submitted', billNo: 'RA-03', createdAt: ts(NOW - DAY) },
          { id: 'd', status: 'Submitted', billNo: 'RA-04', billTrackingRef: 'BT/9', createdAt: ts(NOW) },
        ],
      },
    ],
    NOW,
  );
  const issues = Object.fromEntries(rows.map((r) => [r.billNo, r.issue]));
  assert.equal(issues['RA-01'], 'Draft for 10 days');
  assert.equal(issues['RA-02'], '');
  assert.equal(issues['RA-03'], 'Not linked to Bill Tracking');
  assert.equal(issues['RA-04'], '');
  assert.equal(rows[0].billNo, 'RA-04'); // newest first
});

test('the register filter keeps only that register\'s bill lines and re-adds the total', () => {
  const bills = [
    { id: 'a', totalAmount: 30, items: [{ source: 'JMC', amount: 10 }, { source: 'MVAC', amount: 20 }] },
    { id: 'b', totalAmount: 5, items: [{ source: 'MVAC', amount: 5 }] },
  ];
  assert.equal(billsForRegister(bills, 'all').length, 2);
  const jmcOnly = billsForRegister(bills, 'JMC');
  assert.deepEqual(jmcOnly.map((b) => [b.id, b.totalAmount]), [['a', 10]]);
  assert.deepEqual(billsForRegister(bills, 'MVAC').map((b) => [b.id, b.totalAmount]), [['a', 20], ['b', 5]]);
  assert.equal(bills[0].totalAmount, 30, 'input is not mutated');
});
