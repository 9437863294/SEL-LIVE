import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDetailBreakdown,
  sanitizeDocumentName,
} from '../src/lib/windows-agent-rules.ts';

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * Time per website and per document (§13, §14)
 *
 * The collection half lives in the agent and is tested there. This is the half that decides what
 * a manager reads: which rows appear, what the percentages are a share of, and — the part worth
 * the most care — what a *document name* is allowed to contain by the time it is stored.
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

function span(overrides) {
  return {
    eventType: 'APP_ACTIVE',
    applicationName: 'Google Chrome',
    durationSeconds: 600,
    activeSeconds: 600,
    browserDomain: null,
    documentName: null,
    ...overrides,
  };
}

test('time per website is grouped by host and counts the visits', () => {
  const { rows, totalActiveSeconds } = buildDetailBreakdown([
    span({ browserDomain: 'seltech.store', activeSeconds: 1200, durationSeconds: 1200 }),
    span({ browserDomain: 'drive.google.com', activeSeconds: 900, durationSeconds: 900 }),
    span({ browserDomain: 'seltech.store', activeSeconds: 600, durationSeconds: 600 }),
  ], { detail: 'browserDomain' });

  assert.equal(totalActiveSeconds, 2700);
  assert.equal(rows[0].label, 'seltech.store');
  assert.equal(rows[0].activeSeconds, 1800);
  assert.equal(rows[0].visits, 2, 'two separate visits, not one long one');
  assert.equal(rows[0].percentOfActive, 66.7);
  assert.equal(rows[1].label, 'drive.google.com');
  assert.equal(rows[1].visits, 1);
});

test('percentages are a share of the browsing, not of the whole day', () => {
  // Two hours at a desk, twenty minutes of it in a browser. The site was all of the browsing,
  // and a report saying it was 14% of the day would be answering a question nobody asked.
  const { rows } = buildDetailBreakdown([
    span({ browserDomain: 'seltech.store', activeSeconds: 1200, durationSeconds: 1200 }),
    span({ applicationName: 'Microsoft Excel', activeSeconds: 6000, durationSeconds: 6000 }),
  ], { detail: 'browserDomain' });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].percentOfActive, 100);
});

test('documents are grouped by file name and carry the application', () => {
  const { rows } = buildDetailBreakdown([
    span({ applicationName: 'Microsoft Excel', documentName: 'Q3 Budget.xlsx', activeSeconds: 2400, durationSeconds: 2400 }),
    span({ applicationName: 'Microsoft Word', documentName: 'Tender Letter.docx', activeSeconds: 600, durationSeconds: 600 }),
    span({ applicationName: 'Microsoft Excel', documentName: 'Q3 Budget.xlsx', activeSeconds: 300, durationSeconds: 300 }),
  ], { detail: 'documentName' });

  assert.equal(rows[0].label, 'Q3 Budget.xlsx');
  assert.equal(rows[0].activeSeconds, 2700);
  assert.equal(rows[0].visits, 2);
  assert.equal(rows[0].applicationName, 'Microsoft Excel');
  assert.equal(rows[1].label, 'Tender Letter.docx');
});

test('spans with no detail are ignored rather than grouped under a blank row', () => {
  const { rows, totalActiveSeconds } = buildDetailBreakdown([
    span({ browserDomain: null }),
    span({ browserDomain: '' }),
  ], { detail: 'browserDomain' });

  assert.deepEqual(rows, []);
  assert.equal(totalActiveSeconds, 0);
});

test('only foreground spans count, so locked and idle rows cannot inflate a site', () => {
  const { rows } = buildDetailBreakdown([
    span({ browserDomain: 'seltech.store', activeSeconds: 600, durationSeconds: 600 }),
    span({ eventType: 'LOCK', browserDomain: 'seltech.store', activeSeconds: 3600, durationSeconds: 3600 }),
  ], { detail: 'browserDomain' });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].activeSeconds, 600);
});

test('a long tail is folded into one row that still adds up', () => {
  const spans = [];
  for (let index = 0; index < 14; index += 1) {
    spans.push(span({ browserDomain: `site-${index}.example`, activeSeconds: 100 * (14 - index), durationSeconds: 100 }));
  }
  const { rows, totalActiveSeconds } = buildDetailBreakdown(spans, { detail: 'browserDomain', topN: 10 });

  assert.equal(rows.length, 11);
  assert.equal(rows[10].label, '4 more');
  assert.equal(rows[10].visits, 4);
  assert.equal(rows.reduce((sum, row) => sum + row.activeSeconds, 0), totalActiveSeconds);
});

test('an empty day is zero rows rather than a throw', () => {
  const { rows, totalActiveSeconds } = buildDetailBreakdown([], { detail: 'documentName' });
  assert.deepEqual(rows, []);
  assert.equal(totalActiveSeconds, 0);
});

/* ── What a document name is allowed to be ───────────────────────────────────────────────────── */

test('a document name is a file name, never a path into somebody private folders', () => {
  assert.equal(
    sanitizeDocumentName('C:\\Users\\ashish\\Personal\\Resignation.docx'),
    'Resignation.docx',
  );
  assert.equal(sanitizeDocumentName('/home/ashish/payroll/March.xlsx'), 'March.xlsx');
  assert.equal(sanitizeDocumentName('Q3 Budget.xlsx'), 'Q3 Budget.xlsx');
});

test('a document name gets the same redactions a window title does', () => {
  assert.ok(!sanitizeDocumentName('password hunter2.txt').includes('hunter2'));
  assert.ok(!sanitizeDocumentName('api-key sk-live-9f2.txt').includes('sk-live-9f2'));
  assert.equal(sanitizeDocumentName('Mail to priya.das@selindia.net.msg'), 'Mail to [email]');
  assert.ok(!sanitizeDocumentName('card 4111 1111 1111 1111.xlsx').includes('4111'));
});

test('an ordinary number in a file name survives, because it is the file name', () => {
  // The redactions deliberately do not chase short digit runs: "Invoice 448291.pdf" and
  // "MB-104 Rev 3.xlsx" are what the files are called, and a report that printed them as
  // "Invoice [number].pdf" would be useless for the thing it exists to do.
  assert.equal(sanitizeDocumentName('Invoice 448291.pdf'), 'Invoice 448291.pdf');
  assert.equal(sanitizeDocumentName('MB-104 Rev 3.xlsx'), 'MB-104 Rev 3.xlsx');
});

test('an empty or absurd document name is no name at all', () => {
  assert.equal(sanitizeDocumentName('   '), null);
  assert.equal(sanitizeDocumentName(null), null);
  assert.equal(sanitizeDocumentName(undefined), null);
  assert.equal(sanitizeDocumentName(42), null);
  assert.ok(sanitizeDocumentName('x'.repeat(400)).length <= 120);
});
