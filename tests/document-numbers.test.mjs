import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOCUMENT_SERIES, documentSeries, nextDocumentNumber, nextIndexOf } from '../src/lib/document-numbers.ts';

const day = new Date(2026, 9, 30, 10, 0, 0);

test('each series composes its next number the way its module does', () => {
  const sfr = documentSeries('site-fund-requisition');
  const dr = documentSeries('daily-requisition');
  const grn = documentSeries('store-stock-grn');
  // Site Fund Requisition never adds the suffix.
  assert.equal(nextDocumentNumber(sfr, { prefix: 'SEL\\SFR\\', format: '2025-26\\', suffix: '/A', startingIndex: 10 }, day), 'SEL\\SFR\\2025-26\\0010');
  assert.equal(nextDocumentNumber(dr, { prefix: 'SEL\\REC\\', format: '2025-26\\', suffix: '/A', startingIndex: 7340 }, day), 'SEL\\REC\\2025-26\\7340/A');
  // The GRN format is a date pattern; a lowercase m is the month.
  assert.equal(nextDocumentNumber(grn, { prefix: 'GRN-', format: 'yyyymmdd-', suffix: '', startingIndex: 7 }, day), 'GRN-20261030-0007');
  assert.equal(nextDocumentNumber(grn, { prefix: 'GRN-', format: '', suffix: '', startingIndex: 7 }, day), 'GRN-202610300007');
});

test('an unusable counter starts at 1, and a format that is not a date pattern has no number', () => {
  assert.equal(nextIndexOf({ startingIndex: Number.NaN }), 1);
  assert.equal(nextIndexOf({ startingIndex: 0 }), 1);
  assert.equal(nextIndexOf({ startingIndex: 12.9 }), 12);
  assert.equal(nextDocumentNumber(documentSeries('store-stock-grn'), { prefix: '', format: 'yyyy-jj', suffix: '', startingIndex: 1 }, day), null);
});

test('every series has a suggested starting point', () => {
  assert.deepEqual(DOCUMENT_SERIES.map((series) => series.id), ['site-fund-requisition', 'daily-requisition', 'store-stock-grn']);
  for (const series of DOCUMENT_SERIES) assert.ok(nextDocumentNumber(series, series.suggested, day));
});
