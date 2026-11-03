import test from 'node:test';
import assert from 'node:assert/strict';
import {
  billStatus,
  buildSubcontractorsDashboard,
  dateMs,
  lastMonthKeys,
  stampMs,
} from '../src/lib/subcontractors-dashboard.ts';

const NOW = new Date(2026, 10, 3, 12).getTime(); // 3 Nov 2026
const day = (y, m, d) => new Date(y, m - 1, d).getTime();

const register = [
  {
    id: 'acme',
    legalName: 'Acme Builders',
    status: 'Active',
    gstNumber: '21AAAAA0000A1Z5',
    contacts: [
      { type: 'Billing', name: 'Billing Desk', mobile: '1' },
      { type: 'Project', name: 'Ravi', mobile: '98765' },
    ],
  },
  { id: 'beta', legalName: 'Beta Civil', status: 'Inactive' },
  { id: 'idle', legalName: 'Idle Co' }, // in the register, nothing on this project
];

const workOrders = [
  { id: 'wo1', workOrderNo: 'WO-1', subcontractorId: 'acme', totalAmount: 100000, date: '2026-06-01' },
  { id: 'wo2', workOrderNo: 'WO-2', subcontractorId: 'acme', totalAmount: 50000, date: '2026-07-01' },
  { id: 'wo3', workOrderNo: 'WO-3', subcontractorId: 'beta', totalAmount: 40000, status: 'Cancelled' },
];

const bills = [
  // Acme, WO-1: approved, retention 5,000 not yet claimed, recovers 10,000 of advance.
  {
    id: 'b1', billNo: 'B-1', billDate: '2026-09-10', workOrderId: 'wo1', subcontractorId: 'acme',
    subtotal: 60000, grossAmount: 70800, retentionAmount: 3000, netPayable: 57800,
    advanceDeductions: [{ reference: 'pf1', amount: 10000 }], status: 'Completed',
  },
  // Acme, WO-1: in approval, overdue, retention already claimed.
  {
    id: 'b2', billNo: 'B-2', billDate: '2026-10-20', workOrderId: 'wo1', subcontractorId: 'acme',
    subtotal: 20000, grossAmount: 23600, retentionAmount: 1000, netPayable: 22600, status: 'In Progress',
    stage: 'QS Check', currentStepId: 's2', deadline: { seconds: day(2026, 10, 25) / 1000 }, retentionClaimed: true,
  },
  // Rejected: counted in the status tally only.
  { id: 'b3', billNo: 'B-3', billDate: '2026-10-21', workOrderId: 'wo2', subcontractorId: 'acme', subtotal: 99999, netPayable: 99999, status: 'Rejected' },
  // Retention bill: releases retention, is not work billed.
  { id: 'r1', billNo: 'RET-1', billDate: '2026-10-28', subcontractorId: 'acme', subtotal: 1000, netPayable: 1000, isRetentionBill: true, status: 'Pending', stage: 'Site', currentStepId: 's1' },
  // No subcontractor id: grouped by name.
  { id: 'b4', billNo: 'B-4', billDate: 'not a date', createdAt: { seconds: day(2026, 8, 5) / 1000 }, subcontractorName: 'Walk-in Labour', subtotal: 5000, netPayable: 5000, status: 'Completed' },
];

const proformas = [
  { id: 'pf1', proformaNo: 'PF-1', date: '2026-08-15', subcontractorId: 'acme', payableAmount: 25000, status: 'Completed' },
  { id: 'pf2', proformaNo: 'PF-2', date: '2026-11-01', subcontractorId: 'beta', payableAmount: 8000 }, // no status → Pending
];

const dash = buildSubcontractorsDashboard({ subcontractors: register, workOrders, bills, proformas, now: NOW });
const acme = dash.subcontractors.find((r) => r.id === 'acme');
const beta = dash.subcontractors.find((r) => r.id === 'beta');

test('only subcontractors with something on the project appear', () => {
  assert.deepEqual(dash.subcontractors.map((r) => r.name).sort(), ['Acme Builders', 'Beta Civil', 'Walk-in Labour']);
  assert.equal(dash.totals.subcontractors, 3);
  // Beta's only work order is cancelled; Walk-in has none.
  assert.equal(dash.totals.activeSubcontractors, 1);
});

test('register details: name, GST and the project contact first', () => {
  assert.equal(acme.gstNumber, '21AAAAA0000A1Z5');
  assert.equal(acme.contact, 'Ravi · 98765');
  assert.equal(acme.inRegister, true);
  const walkIn = dash.subcontractors.find((r) => r.name === 'Walk-in Labour');
  assert.equal(walkIn.inRegister, false);
  assert.equal(walkIn.id, 'name:Walk-in Labour');
});

test('work order value leaves cancelled orders out', () => {
  assert.equal(acme.workOrders, 2);
  assert.equal(acme.workOrderValue, 150000);
  assert.equal(beta.workOrders, 0);
  assert.equal(beta.workOrderValue, 0);
  assert.equal(dash.totals.workOrderValue, 150000);
  assert.equal(dash.totals.workOrders, 2);
});

test('billed is regular bills’ work value; rejected and retention bills are not', () => {
  assert.equal(acme.bills, 2);
  assert.equal(acme.billedValue, 80000);
  assert.equal(acme.grossBilled, 94400);
  assert.equal(acme.netPayable, 80400);
  assert.equal(acme.balanceToBill, 70000);
  assert.equal(acme.billedPercent, 53.3);
  assert.equal(acme.lastBillDate, '2026-10-20');
});

test('retention held excludes claimed retention; retention bills count as released', () => {
  assert.equal(acme.retentionHeld, 3000);
  assert.equal(acme.retentionReleased, 1000);
});

test('advance outstanding is proforma paid less what bills recovered', () => {
  assert.equal(acme.advancePaid, 25000);
  assert.equal(acme.advanceRecovered, 10000);
  assert.equal(acme.advanceOutstanding, 15000);
  assert.equal(beta.advancePaid, 8000);
  assert.equal(dash.totals.advanceOutstanding, 23000);
});

test('open bills: in approval, overdue first, with age and the step to act at', () => {
  assert.deepEqual(dash.open.map((r) => r.number), ['B-2', 'RET-1', 'PF-2']);
  const b2 = dash.open[0];
  assert.equal(b2.overdue, true);
  assert.equal(b2.stage, 'QS Check');
  assert.equal(b2.currentStepId, 's2');
  assert.equal(b2.ageDays, 14);
  assert.equal(dash.open[2].kind, 'Proforma');
  assert.equal(dash.totals.openBills, 3);
  assert.equal(dash.totals.overdue, 1);
  assert.equal(dash.totals.openValue, 22600 + 1000 + 8000);
  assert.equal(acme.openBills, 2);
});

test('status tally counts every bill, rejected included; no status reads as Pending', () => {
  assert.deepEqual(dash.statusCounts, { Pending: 2, 'In Progress': 1, Completed: 3, Rejected: 1 });
  assert.equal(billStatus(undefined), 'Pending');
  assert.equal(billStatus('Completed'), 'Completed');
});

test('work order rows carry what has been billed against each', () => {
  const wo1 = dash.workOrders.find((w) => w.id === 'wo1');
  assert.equal(wo1.billedValue, 80000);
  assert.equal(wo1.bills, 2);
  assert.equal(wo1.balance, 20000);
  assert.equal(wo1.billedPercent, 80);
  const wo3 = dash.workOrders.find((w) => w.id === 'wo3');
  assert.equal(wo3.status, 'Cancelled');
  assert.equal(wo3.balance, 0);
  assert.equal(dash.workOrders[0].id, 'wo1'); // largest first
});

test('months: last 12, billed by bill date and advances by proforma date', () => {
  assert.equal(dash.byMonth.length, 12);
  assert.equal(dash.byMonth[11].month, '2026-11');
  assert.equal(dash.byMonth[0].month, '2025-12');
  const oct = dash.byMonth.find((m) => m.month === '2026-10');
  assert.equal(oct.billed, 22600 + 1000); // B-2 and the retention bill; B-3 rejected
  assert.equal(dash.byMonth.find((m) => m.month === '2026-08').billed, 5000); // B-4 by createdAt
  assert.equal(dash.byMonth.find((m) => m.month === '2026-08').advance, 25000);
  assert.equal(dash.byMonth.find((m) => m.month === '2026-11').advance, 8000);
});

test('recent bills: newest first, at most eight', () => {
  assert.equal(dash.recent[0].number, 'PF-2');
  assert.ok(dash.recent.length <= 8);
});

test('date helpers', () => {
  assert.equal(dateMs('2026-01-31'), day(2026, 1, 31));
  assert.equal(dateMs(''), null);
  assert.equal(stampMs({ seconds: 10 }), 10000);
  assert.equal(stampMs({ toMillis: () => 5 }), 5);
  assert.equal(stampMs(null), null);
  assert.deepEqual(lastMonthKeys(day(2026, 1, 15), 3), ['2025-11', '2025-12', '2026-01']);
});

test('an empty project', () => {
  const empty = buildSubcontractorsDashboard({ subcontractors: register, workOrders: [], bills: [], proformas: [], now: NOW });
  assert.equal(empty.totals.subcontractors, 0);
  assert.equal(empty.totals.billedPercent, null);
  assert.equal(empty.byMonth.every((m) => m.billed === 0), true);
});
