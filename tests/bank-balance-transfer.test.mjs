import test from 'node:test';
import assert from 'node:assert/strict';
import { batchEffects, modeWarning, parseAmountInput, rupeesInWords, transferKind } from '../src/lib/bank-balance-transfer.ts';

test('transferKind names what a transfer does', () => {
  assert.equal(transferKind('Cash Credit', 'Current Account'), 'draw');
  assert.equal(transferKind('Current Account', 'Cash Credit'), 'repay');
  assert.equal(transferKind('Cash Credit', 'Cash Credit'), 'cc');
  assert.equal(transferKind('Current Account', 'Current Account'), 'move');
  assert.equal(transferKind(undefined, 'Cash Credit'), null);
});

test('batchEffects nets every row per account and skips incomplete rows', () => {
  const effects = batchEffects([
    { fromAccountId: 'a', toAccountId: 'b', amount: 100 },
    { fromAccountId: 'a', toAccountId: 'c', amount: 50 },
    { fromAccountId: 'c', toAccountId: 'a', amount: 30 },
    { fromAccountId: 'a', toAccountId: 'a', amount: 999 },
    { fromAccountId: 'b', toAccountId: '', amount: 10 },
    { fromAccountId: 'b', toAccountId: 'c', amount: 0 },
  ]);
  assert.deepEqual(Object.fromEntries(effects), { a: -120, b: 100, c: 20 });
});

test('parseAmountInput keeps digits and two decimals', () => {
  assert.equal(parseAmountInput('12,50,000'), '1250000');
  assert.equal(parseAmountInput('₹ 1,000.505'), '1000.50');
  assert.equal(parseAmountInput('1.2.3'), '1.23');
  assert.equal(parseAmountInput('abc'), '');
});

test('modeWarning flags the IMPS cap and the RTGS minimum', () => {
  assert.match(modeWarning('IMPS', 500001), /capped at ₹5 lakh/);
  assert.equal(modeWarning('IMPS', 500000), null);
  assert.match(modeWarning('RTGS', 199999), /₹2 lakh and above/);
  assert.equal(modeWarning('RTGS', 200000), null);
  assert.equal(modeWarning('NEFT', 99999999), null);
});

test('rupeesInWords reads the Indian way', () => {
  assert.equal(rupeesInWords(0), '');
  assert.equal(rupeesInWords(1), 'One rupee only');
  assert.equal(rupeesInWords(125000), 'One lakh twenty-five thousand rupees only');
  assert.equal(rupeesInWords(449400000), 'Forty-four crore ninety-four lakh rupees only');
  assert.equal(rupeesInWords(1012.5), 'One thousand twelve rupees and fifty paise only');
  assert.equal(rupeesInWords(123456789012), 'Twelve thousand three hundred forty-five crore sixty-seven lakh eighty-nine thousand twelve rupees only');
});
