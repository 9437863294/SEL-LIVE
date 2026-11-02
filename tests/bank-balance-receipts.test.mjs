import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  billTracked,
  duplicateRefs,
  fyOf,
  inRange,
  initials,
  isInstrumentMode,
  nameHash,
  payerOf,
  periodRange,
  receiptDescription,
  refLabelFor,
} from '../src/lib/bank-balance-receipts.ts';

test('client-bill money is Bill Tracking’s', () => {
  assert.equal(billTracked('Client bill'), true);
  assert.equal(billTracked('Retention'), true);
  assert.equal(billTracked('Advance'), false);
  assert.equal(billTracked(undefined), false);
});

test('a cheque or DD carries a number, anything else a UTR', () => {
  assert.equal(isInstrumentMode('Cheque'), true);
  assert.equal(isInstrumentMode('DD'), true);
  assert.equal(isInstrumentMode('RTGS'), false);
  assert.equal(refLabelFor('Cheque'), 'Cheque no.');
  assert.equal(refLabelFor('DD'), 'DD no.');
  assert.equal(refLabelFor('NEFT'), 'UTR / Ref no.');
});

test('the description names the payer once', () => {
  assert.equal(receiptDescription('OPTCL', 'RA bill 14'), 'OPTCL — RA bill 14');
  assert.equal(receiptDescription('OPTCL', 'RA bill 14 from optcl'), 'RA bill 14 from optcl');
  assert.equal(receiptDescription('', 'Interest on FD'), 'Interest on FD');
  assert.equal(receiptDescription('  SBI ', '  '), 'SBI');
});

test('the payer: recorded, read from a Bill Tracking credit, or unknown', () => {
  assert.equal(payerOf({ payerName: ' JUSNL ', description: 'x' }), 'JUSNL');
  assert.equal(payerOf({ billCollectionId: 'c1', description: 'Receipt from OPTCL · INV-1, INV-2' }), 'OPTCL');
  assert.equal(payerOf({ billCollectionId: 'c1', description: 'Receipt from Power Grid Corporation' }), 'Power Grid Corporation');
  assert.equal(payerOf({ billCollectionId: 'c1', description: 'Receipt · INV-1' }), '');
  // Only a Bill Tracking credit's wording is trusted; a typed description is not parsed.
  assert.equal(payerOf({ description: 'Receipt from somebody' }), '');
});

test('references typed twice in a batch', () => {
  const twice = duplicateRefs([{ ref: 'SBIN 001' }, { ref: 'sbin001' }, { ref: '' }, { ref: 'N2' }]);
  assert.deepEqual([...twice], ['SBIN001']);
});

test('initials and a stable colour bucket', () => {
  assert.equal(initials('Odisha Power Transmission'), 'OP');
  assert.equal(initials('OPTCL'), 'OP');
  assert.equal(initials('  '), '?');
  assert.equal(nameHash('OPTCL', 8), nameHash(' optcl ', 8));
  assert.ok(nameHash('OPTCL', 8) < 8);
});

test('periods', () => {
  // 2 Nov 2026 is a Monday.
  assert.deepEqual(periodRange('today', '2026-11-02'), { from: '2026-11-02', to: '2026-11-02' });
  assert.deepEqual(periodRange('week', '2026-11-02'), { from: '2026-11-02', to: '2026-11-08' });
  assert.deepEqual(periodRange('week', '2026-11-08'), { from: '2026-11-02', to: '2026-11-08' });
  assert.deepEqual(periodRange('month', '2026-02-10'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(periodRange('month', '2026-12-31'), { from: '2026-12-01', to: '2026-12-31' });
  assert.deepEqual(periodRange('fy', '2026-11-02'), { from: '2026-04-01', to: '2027-03-31' });
  assert.deepEqual(periodRange('fy', '2027-03-31'), { from: '2026-04-01', to: '2027-03-31' });
  assert.deepEqual(periodRange('fy', '2027-04-01'), { from: '2027-04-01', to: '2028-03-31' });
  assert.deepEqual(periodRange('all', '2026-11-02'), { from: null, to: null });
  assert.deepEqual(periodRange('custom', '2026-11-02', { from: '2026-10-20', to: '2026-10-01' }), { from: '2026-10-01', to: '2026-10-20' });
  assert.deepEqual(periodRange('custom', '2026-11-02', { from: '2026-10-20' }), { from: '2026-10-20', to: null });
  assert.equal(fyOf('2026-03-31'), '2025-26');
  assert.equal(fyOf('2026-04-01'), '2026-27');
  assert.equal(fyOf('2099-12-01'), '2099-00');
  assert.equal(inRange('2026-11-02', { from: '2026-11-01', to: null }), true);
  assert.equal(inRange('2026-10-31', { from: '2026-11-01', to: null }), false);
});
