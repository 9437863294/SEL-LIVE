import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLedgers } from '../src/lib/bank-balance-ledger.ts';
import {
  accountPositions,
  bankInitials,
  drawnHistory,
  flowBetween,
  lastEntryAt,
  monthEndPoints,
  normaliseDashboardDesign,
  positionTotals,
  recentMovements,
  upcomingItems,
} from '../src/lib/bank-balance-dashboard.ts';

// Mid-morning local time, so no test depends on how the machine's time zone treats midnight.
const at = (day) => new Date(`${day}T10:00:00`);
const txn = (accountId, day, type, amount, extra = {}) => ({ accountId, date: at(day), type, amount, ...extra });

const cc = {
  id: 'cc',
  shortName: 'SBI-CC',
  bankName: 'State Bank of India',
  accountType: 'Cash Credit',
  openingUtilization: 100,
  openingDate: '2026-10-01',
  drawingPower: [{ fromDate: '2026-10-01', toDate: null, amount: 1000 }],
  interestRateLog: [{ fromDate: '2026-10-01', toDate: null, rate: 10 }],
};
const ca = { id: 'ca', shortName: 'CANARA-CA', bankName: 'Canara Bank', accountType: 'Current Account', openingBalance: 50, openingDate: '2026-10-01' };
const limitOn = (account, day) => {
  const entry = [...(account.drawingPower || [])]
    .sort((a, b) => b.fromDate.localeCompare(a.fromDate))
    .find((e) => new Date(`${e.fromDate}T00:00:00`) <= day && (!e.toDate || new Date(`${e.toDate}T23:59:59`) >= day));
  return entry ? Number(entry.amount) || 0 : 0;
};

test('normaliseDashboardDesign keeps known designs and falls back to classic', () => {
  assert.equal(normaliseDashboardDesign('position'), 'position');
  assert.equal(normaliseDashboardDesign('accounts'), 'accounts');
  assert.equal(normaliseDashboardDesign('fancy'), 'classic');
  assert.equal(normaliseDashboardDesign(undefined), 'classic');
});

test('bankInitials uses a short abbreviation, else the bank name’s initials', () => {
  assert.equal(bankInitials({ shortName: 'PNB', bankName: 'Punjab National Bank' }), 'PNB');
  assert.equal(bankInitials({ shortName: 'SBI-8893', bankName: 'State Bank of India' }), 'SBI');
  assert.equal(bankInitials({ shortName: 'CANARA-CC', bankName: 'Canara Bank' }), 'CB');
  assert.equal(bankInitials({ shortName: 'AXIS-CC', bankName: 'Axis Bank' }), 'AB');
  assert.equal(bankInitials({ shortName: '', bankName: 'Federal' }), 'FE');
  assert.equal(bankInitials({}), '?');
});

test('accountPositions and positionTotals: headroom plus current balance is the headline', () => {
  const over = { ...cc, id: 'over' };
  const rows = accountPositions([cc, ca, over], { cc: 400, ca: -20, over: 1200 }, (account) => limitOn(account, at('2026-11-02')));
  assert.deepEqual(rows.map((row) => [row.drawn, row.available, Math.round(row.pct)]), [[400, 600, 40], [0, -20, 0], [1200, -200, 120]]);
  const totals = positionTotals(rows);
  assert.equal(totals.ccLimit, 2000);
  assert.equal(totals.ccDrawn, 1600);
  assert.equal(totals.ccHeadroom, 400);
  assert.equal(totals.currentBalance, -20);
  assert.equal(totals.available, totals.ccHeadroom + totals.currentBalance);
  assert.equal(totals.drawnPct, 80);
});

test('accountPositions: a Cash Credit account in credit draws nothing and adds the credit to headroom', () => {
  const [row] = accountPositions([cc], { cc: -30 }, () => 1000);
  assert.equal(row.drawn, 0);
  assert.equal(row.available, 1030);
  assert.equal(row.pct, 0);
});

test('drawnHistory sums each day’s closing utilisation against the limit in force, skipping current accounts', () => {
  const ledgers = [...buildLedgers([cc, ca], [txn('cc', '2026-10-02', 'Debit', 300), txn('ca', '2026-10-02', 'Credit', 999)]).values()];
  const points = drawnHistory(ledgers, limitOn, at('2026-09-30'), at('2026-10-03'));
  assert.deepEqual(points.map((p) => [p.drawn, p.limit]), [[0, 0], [100, 1000], [400, 1000], [400, 1000]]);
});

test('monthEndPoints keeps the last day of each month and the latest day', () => {
  const days = ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-31', '2026-11-01', '2026-11-02'].map((d) => ({ day: at(d) }));
  assert.deepEqual(monthEndPoints(days).map((p) => p.day.getDate()), [30, 31, 2]);
});

test('flowBetween counts receipts and payments, transfers apart', () => {
  const ledgers = [...buildLedgers([cc, ca], [
    txn('ca', '2026-11-01', 'Credit', 120),
    txn('cc', '2026-11-02', 'Debit', 40),
    txn('ca', '2026-11-02', 'Debit', 25, { isContra: true }),
    txn('cc', '2026-11-02', 'Credit', 25, { isContra: true }),
    txn('ca', '2026-10-31', 'Credit', 7),
  ]).values()];
  const flow = flowBetween(ledgers, at('2026-11-01'), at('2026-11-30'));
  assert.deepEqual({ ...flow, lastAt: flow.lastAt?.getDate() }, {
    receipts: 120, payments: 40, net: 80, transfers: 25, receiptCount: 1, paymentCount: 1, count: 4, lastAt: 2,
  });
  assert.equal(flowBetween(ledgers, at('2026-11-03'), at('2026-11-03')).lastAt, null);
});

test('lastEntryAt finds the latest entry up to the cutoff, or null', () => {
  const ledgers = buildLedgers([cc, ca], [txn('cc', '2026-10-20', 'Debit', 1), txn('cc', '2026-11-09', 'Debit', 1)]);
  assert.equal(lastEntryAt(ledgers.get('cc'), new Date('2026-11-02T23:59:59'))?.getDate(), 20);
  assert.equal(lastEntryAt(ledgers.get('ca'), new Date('2026-11-02T23:59:59')), null);
  assert.equal(lastEntryAt(undefined, new Date()), null);
});

test('recentMovements: newest first, nothing dated ahead', () => {
  const ledgers = [...buildLedgers([cc, ca], [
    txn('ca', '2026-11-01', 'Credit', 1),
    txn('cc', '2026-11-02', 'Debit', 2),
    txn('cc', '2026-11-09', 'Debit', 3),
  ]).values()];
  const rows = recentMovements(ledgers, new Date('2026-11-02T23:59:59'), 5);
  assert.deepEqual(rows.map((row) => row.txn.amount), [2, 1]);
  assert.equal(rows[0].account.id, 'cc');
});

test('upcomingItems lists entries dated ahead, limit and rate changes, and month-end interest, soonest first', () => {
  const scheduled = {
    ...cc,
    drawingPower: [
      { fromDate: '2026-10-01', toDate: '2026-11-19', amount: 1000 },
      { fromDate: '2026-11-20', toDate: null, amount: 1500 },
    ],
    interestRateLog: [
      { fromDate: '2026-10-01', toDate: '2026-11-14', rate: 10 },
      { fromDate: '2026-11-15', toDate: null, rate: 9.5 },
    ],
  };
  const ledgers = [...buildLedgers([scheduled, ca], [
    txn('cc', '2026-11-05', 'Debit', 840000),
    txn('ca', '2026-11-05', 'Credit', 120000),
    txn('cc', '2026-11-02', 'Debit', 1),
    txn('ca', '2026-12-30', 'Credit', 5),
  ]).values()];
  const items = upcomingItems({
    ledgers,
    nameOf: (account) => account.shortName,
    limitOn,
    today: at('2026-11-02'),
    horizonDays: 45,
    interestAccrued: 1234,
  });
  assert.deepEqual(items.map((item) => [item.day.getDate(), item.kind]), [[5, 'entries'], [15, 'rate'], [20, 'limit'], [30, 'interest']]);
  assert.equal(items[0].title, 'Payments and receipts dated ahead');
  assert.equal(items[0].detail, 'Payments ₹8,40,000 · Receipts ₹1,20,000 · SBI-CC and CANARA-CA');
  assert.equal(items[0].amount, undefined);
  assert.equal(items[1].title, 'SBI-CC rate falls to 9.5%');
  assert.equal(items[1].detail, 'From 10% a year');
  assert.equal(items[2].title, 'SBI-CC limit rises');
  assert.equal(items[2].amount, 1500);
  assert.equal(items[3].amount, 1234);
});

test('upcomingItems: a day with one kind of entry carries its amount', () => {
  const ledgers = [...buildLedgers([cc], [txn('cc', '2026-11-06', 'Debit', 500), txn('cc', '2026-11-06', 'Debit', 250)]).values()];
  const [item] = upcomingItems({ ledgers, nameOf: (a) => a.shortName, limitOn, today: at('2026-11-02'), horizonDays: 30 });
  assert.equal(item.title, 'Payments dated ahead');
  assert.equal(item.detail, '2 entries · SBI-CC');
  assert.equal(item.amount, 750);
});

test('upcomingItems leaves month-end interest out when nothing is accruing', () => {
  const ledgers = [...buildLedgers([cc], []).values()];
  assert.deepEqual(upcomingItems({ ledgers, nameOf: (a) => a.shortName, limitOn, today: at('2026-11-02'), horizonDays: 45 }), []);
});
