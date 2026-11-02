import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLedgers } from '../src/lib/bank-balance-ledger.ts';
import { accruedCcInterest, attentionItems, cashOutlook } from '../src/lib/bank-balance-insights.ts';

// Mid-morning local time, so no test depends on how the machine's time zone treats midnight.
const at = (day) => new Date(`${day}T10:00:00`);

const close = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${actual} to be ${expected}`);

test('accruedCcInterest sums each day’s closing utilisation at that day’s rate', () => {
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
  const ledgers = buildLedgers([cc], []);
  // 10–14 Sep: 5 days at 10%; 15–16 Sep: 2 days at 12%. Utilisation 1000 throughout.
  const expected = (5 * 1000 * 0.10 + 2 * 1000 * 0.12) / 365;
  close(accruedCcInterest([...ledgers.values()], at('2026-09-08'), at('2026-09-16')), expected);
});

test('accruedCcInterest ignores current accounts and credit balances', () => {
  const ca = { id: 'ca', accountType: 'Current Account', openingBalance: 5000, openingDate: '2026-09-01' };
  const ccInCredit = {
    id: 'cc',
    accountType: 'Cash Credit',
    openingUtilization: -200, // in credit: earns nothing
    openingDate: '2026-09-01',
    interestRateLog: [{ fromDate: '2026-09-01', toDate: null, rate: 10 }],
  };
  const ledgers = buildLedgers([ca, ccInCredit], []);
  close(accruedCcInterest([...ledgers.values()], at('2026-09-01'), at('2026-09-10')), 0);
});

test('cashOutlook dips where post-dated entries sit and names the lowest point', () => {
  const ca = { id: 'ca', accountType: 'Current Account', openingBalance: 500, openingDate: '2026-09-01' };
  const cc = { id: 'cc', accountType: 'Cash Credit', openingUtilization: 400, openingDate: '2026-09-01' };
  const txns = [
    // A post-dated cheque two days out, and a receipt two days after that.
    { accountId: 'ca', amount: 200, type: 'Debit', date: at('2026-09-12') },
    { accountId: 'ca', amount: 100, type: 'Credit', date: at('2026-09-14') },
  ];
  const ledgers = buildLedgers([ca, cc], txns);
  const { points, lowest } = cashOutlook([...ledgers.values()], () => 1000, at('2026-09-10'), 6);

  assert.equal(points.length, 6);
  // Day 0–1: 500 balance + (1000 − 400) headroom.
  close(points[0].available, 1100);
  close(points[1].available, 1100);
  // The cheque lands on day 2.
  close(points[2].available, 900);
  assert.equal(points[2].entries, 1);
  // The receipt lifts day 4 onward.
  close(points[4].available, 1000);
  close(points[5].available, 1000);
  assert.equal(lowest.available, 900);
  assert.equal(lowest.day.getTime(), points[2].day.getTime());
});

test('cashOutlook contributes nothing before an account opens', () => {
  const ca = { id: 'ca', accountType: 'Current Account', openingBalance: 500, openingDate: '2026-09-13' };
  const ledgers = buildLedgers([ca], []);
  const { points } = cashOutlook([...ledgers.values()], () => 0, at('2026-09-10'), 5);
  close(points[0].available, 0);
  close(points[2].available, 0);
  close(points[3].available, 500);
});

test('attentionItems lists breaches worst first', () => {
  const items = attentionItems({
    cc: [
      { name: 'SBI CC', limit: 1000, utilised: 1100 }, // over limit — critical
      { name: 'PNB CC', limit: 1000, utilised: 750 }, // high — warning
      { name: 'BOI CC', limit: 0, utilised: 100 }, // no limit — info
      { name: 'UBI CC', limit: 1000, utilised: 100 }, // healthy — nothing
    ],
    current: [
      { name: 'HDFC CA', balance: -50 }, // overdrawn — critical
      { name: 'ICICI CA', balance: 200 },
    ],
    cheques: { staleCount: 2, staleAmount: 300, dueSoonCount: 1, dueSoonAmount: 400 },
  });

  assert.deepEqual(items.map((item) => item.severity), ['critical', 'critical', 'warning', 'warning', 'info', 'info']);
  assert.ok(items[0].text.includes('over its limit'));
  assert.ok(items.some((item) => item.text.includes('overdrawn')));
  assert.ok(items.some((item) => item.text.includes('stale cheque')));
  assert.ok(items.some((item) => item.text.includes('post-dated')));
  assert.ok(items.some((item) => item.text.includes('No DP limit set for BOI CC')));
  assert.equal(items.find((item) => item.text.includes('75%')).target, 'utilisation');
});

test('attentionItems is empty when the books are clean', () => {
  const items = attentionItems({
    cc: [{ name: 'SBI CC', limit: 1000, utilised: 400 }],
    current: [{ name: 'HDFC CA', balance: 200 }],
    cheques: { staleCount: 0, staleAmount: 0, dueSoonCount: 0, dueSoonAmount: 0 },
  });
  assert.deepEqual(items, []);
});
