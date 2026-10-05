import test from 'node:test';
import assert from 'node:assert/strict';
import {
  balanceAt,
  buildLedgers,
  compactInr,
  dailyInterest,
  dailyRows,
  formatDay,
  formatInr,
  getApplicableRate,
  lowestAvailableFrom,
  normaliseDatedLog,
  utilisationLevel,
} from '../src/lib/bank-balance-ledger.ts';

// Mid-morning local time, so no test depends on how the machine's time zone treats midnight.
const at = (day) => new Date(`${day}T10:00:00`);

const cc = {
  id: 'cc',
  accountType: 'Cash Credit',
  openingUtilization: 1000,
  openingDate: '2026-09-10',
  interestRateLog: [
    { fromDate: '2026-09-01', toDate: '2026-09-14', rate: 10 },
    { fromDate: '2026-09-15', toDate: null, rate: 12 },
  ],
};
const ca = { id: 'ca', accountType: 'Current Account', openingBalance: 500, openingDate: '' };
const txns = [
  { accountId: 'cc', amount: 999, type: 'Debit', date: at('2026-09-05') },
  { accountId: 'cc', amount: 200, type: 'Debit', date: at('2026-09-10') },
  { accountId: 'cc', amount: 50, type: 'Credit', isContra: true, date: at('2026-09-12') },
  { accountId: 'cc', amount: 30, type: 'Credit', date: at('2026-09-12') },
  { accountId: 'ca', amount: 100, type: 'Credit', date: at('2026-01-01') },
  { accountId: 'ca', amount: 40, type: 'Debit', date: at('2026-09-12') },
];

test('balances start at the opening date and ignore entries before it', () => {
  const ledgers = buildLedgers([cc, ca], txns);
  assert.equal(balanceAt(ledgers.get('cc'), at('2026-09-09')), 0);
  assert.equal(balanceAt(ledgers.get('cc'), at('2026-09-10')), 1200);
});

test('internal transfers count toward Cash Credit utilisation', () => {
  const ledgers = buildLedgers([cc, ca], txns);
  assert.equal(balanceAt(ledgers.get('cc'), at('2026-09-30')), 1120);
});

test('an account without an opening date counts every entry', () => {
  const ledgers = buildLedgers([cc, ca], txns);
  assert.equal(balanceAt(ledgers.get('ca'), at('2026-09-30')), 560);
});

test('daily rows split receipts, payments and transfers and carry the balance', () => {
  const rows = dailyRows(buildLedgers([cc], txns).get('cc'), at('2026-09-09'), at('2026-09-12'));
  assert.deepEqual(
    rows.map((r) => [r.key, r.open, r.opening, r.closing]),
    [
      ['2026-09-09', false, 0, 0],
      ['2026-09-10', true, 1000, 1200],
      ['2026-09-11', true, 1200, 1200],
      ['2026-09-12', true, 1200, 1120],
    ],
  );
  assert.equal(rows[1].payments, 200);
  assert.equal(rows[3].transfersIn, 50);
  assert.equal(rows[3].receipts, 30);
  assert.equal(rows[3].count, 2);
});

test('a rate applies from its own start day through its end day', () => {
  assert.equal(getApplicableRate(cc, at('2026-09-14')), 10);
  assert.equal(getApplicableRate(cc, at('2026-09-15')), 12);
  assert.equal(getApplicableRate(cc, at('2026-08-31')), 0);
});

test('daily interest is zero on a credit balance', () => {
  assert.equal(dailyInterest(-5, 10), 0);
  assert.equal(Math.round(dailyInterest(365000, 10)), 100);
});

test('a dated log is re-chained newest first with no gaps', () => {
  const log = normaliseDatedLog([
    { fromDate: '2026-09-01', toDate: null },
    { fromDate: '2026-09-20', toDate: null },
    { fromDate: '2026-09-10', toDate: '2026-12-31' },
  ]);
  assert.deepEqual(
    log.map((e) => [e.fromDate, e.toDate]),
    [
      ['2026-09-20', null],
      ['2026-09-10', '2026-09-19'],
      ['2026-09-01', '2026-09-09'],
    ],
  );
});

test('formatting', () => {
  assert.equal(compactInr(1_00_00_000), '₹1 Cr');
  assert.equal(compactInr(1_00_00_00_000), '₹100 Cr');
  assert.equal(compactInr(12_50_000), '₹12.5 L');
  assert.equal(formatInr(1234.5), '₹1,234.50');
  assert.equal(formatDay('2026-09-28'), '28 Sep 2026');
  assert.equal(utilisationLevel(70), 'high');
  assert.equal(utilisationLevel(95), 'critical');
});

test('the lowest available figure counts post-dated entries after the date', () => {
  const account = { id: 'ca2', accountType: 'Current Account', openingBalance: 1000, openingDate: '2026-09-01' };
  const ledger = buildLedgers([account], [
    { accountId: 'ca2', amount: 700, type: 'Debit', date: at('2026-10-10') },
    { accountId: 'ca2', amount: 500, type: 'Credit', date: at('2026-10-20') },
  ]).get('ca2');
  const lowest = lowestAvailableFrom(ledger, at('2026-09-29'), (_day, figure) => figure);
  assert.equal(lowest.amount, 300);
  assert.equal(lowest.day.getDate(), 10);
  assert.equal(lowestAvailableFrom(ledger, at('2026-10-25'), (_d, f) => f).amount, 800);
});

test('a row whose date cannot be read is left out, not carried', () => {
  // An Invalid Date compares false against everything: it used to be ADDED by balanceAt (every
  // comparison that would have stopped it failed) while dailyRows stalled its cursor on it and
  // dropped every later entry for that account, so the two disagreed.
  const account = { id: 'bad', accountType: 'Cash Credit', openingUtilization: 1000, openingDate: '2026-09-10' };
  const ledger = buildLedgers([account], [
    { accountId: 'bad', amount: 100, type: 'Debit', date: new Date('nonsense') },
    { accountId: 'bad', amount: 7, type: 'Debit', date: at('2026-09-11') },
  ]).get('bad');
  assert.equal(ledger.entries.length, 1);
  assert.equal(balanceAt(ledger, at('2026-09-11')), 1007);
  assert.deepEqual(dailyRows(ledger, at('2026-09-10'), at('2026-09-11')).map((row) => row.closing), [1000, 1007]);
});

test('a row with no date at all does not throw the ledger', () => {
  const account = { id: 'nd', accountType: 'Current Account', openingBalance: 500, openingDate: '' };
  const ledger = buildLedgers([account], [
    { accountId: 'nd', amount: 100, type: 'Credit', date: undefined },
    { accountId: 'nd', amount: 50, type: 'Credit', date: null },
    { accountId: 'nd', amount: 25, type: 'Credit', date: at('2026-09-11') },
  ]).get('nd');
  assert.equal(ledger.entries.length, 1);
  assert.equal(balanceAt(ledger, at('2026-09-11')), 525);
});

test('the lowest available figure keeps the opening figure when asked from before the opening date', () => {
  // Asked from a day the account does not exist yet, the scan used to start from balanceAt's 0 and
  // so dropped the opening utilisation, overstating the funds available by it.
  const account = { id: 'cc3', accountType: 'Cash Credit', openingUtilization: 1000, openingDate: '2026-09-10' };
  const ledger = buildLedgers([account], [{ accountId: 'cc3', amount: 100, type: 'Debit', date: at('2026-09-20') }]).get('cc3');
  const limitLess = (_day, figure) => 5000 - figure;
  assert.equal(lowestAvailableFrom(ledger, at('2026-09-01'), limitLess).amount, 3900);
  // Unchanged from the opening date on, which is the only case the payment form can reach.
  assert.equal(lowestAvailableFrom(ledger, at('2026-09-10'), limitLess).amount, 3900);
  assert.equal(lowestAvailableFrom(ledger, at('2026-09-01'), limitLess).day.getDate(), 20);
});

test('money reads as rupees even when the figure is unusable', () => {
  assert.equal(compactInr(Number.NaN), '₹0');
  assert.equal(compactInr(undefined), '₹0');
  assert.equal(formatInr(Number.NaN), '₹0.00');
  assert.equal(formatDay(new Date('nonsense')), '—');
  assert.equal(formatDay('nonsense'), '—');
});
