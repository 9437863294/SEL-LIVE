import test from 'node:test';
import assert from 'node:assert/strict';

const { escapeHtml, slugify, buildPrintDocument } =
  await import('../src/lib/print-table-report.ts');

const COLUMNS = [
  { key: 'project', label: 'Project' },
  { key: 'spent', label: 'Spent', align: 'right' },
];

function report(over = {}) {
  return {
    title: 'Project-Wise Summary',
    columns: COLUMNS,
    rows: [{ project: 'Site A', spent: '₹1,00,000' }],
    ...over,
  };
}

/**
 * Counts opening tags of one kind — enough to assert structure without parsing HTML.
 *
 * Matched as `<th>` or `<th ` rather than the bare prefix, which would also count `<thead>`.
 */
function countTags(haystack, tag) {
  return haystack.split(new RegExp(`<${tag}[\\s>]`)).length - 1;
}

// ── Escaping ──────────────────────────────────────────────────────────────────

test('the five HTML-significant characters are escaped', () => {
  assert.equal(escapeHtml(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
});

test('ampersands are escaped before the entities that contain them', () => {
  // A naive order produces &amp;lt; here.
  assert.equal(escapeHtml('&<'), '&amp;&lt;');
});

test('null and undefined become empty text, not the words', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

test('numbers and zero survive as text', () => {
  assert.equal(escapeHtml(0), '0');
  assert.equal(escapeHtml(1500), '1500');
});

test('a project name containing markup cannot inject it into the document', () => {
  const html = buildPrintDocument(report({
    rows: [{ project: '<script>alert(1)</script>', spent: '₹0' }],
  }));
  assert.equal(html.includes('<script>alert(1)</script>'), false);
  assert.ok(html.includes('&lt;script&gt;'));
});

test('a title containing markup is escaped too', () => {
  const html = buildPrintDocument(report({ title: 'Q1 <b>draft</b>' }));
  assert.equal(html.includes('<b>draft</b>'), false);
});

// ── Slugs ─────────────────────────────────────────────────────────────────────

test('slugify produces a safe download name', () => {
  assert.equal(slugify('FY 2026-27'), 'fy-2026-27');
  assert.equal(slugify('April 2026 (FY 2026-27)'), 'april-2026-fy-2026-27');
});

test('slugify never returns an empty or edge-punctuated name', () => {
  assert.equal(slugify(''), 'report');
  assert.equal(slugify('///'), 'report');
  assert.equal(slugify('  spaced  '), 'spaced');
});

// ── Document structure ────────────────────────────────────────────────────────

test('the document is a complete standalone page', () => {
  const html = buildPrintDocument(report());
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('<meta charset="utf-8">'));
  assert.ok(html.includes('<style>'));
  assert.ok(html.trimEnd().endsWith('</html>'));
});

test('the title appears as both document title and heading', () => {
  const html = buildPrintDocument(report());
  assert.ok(html.includes('<title>Project-Wise Summary</title>'));
  assert.ok(html.includes('<h1>Project-Wise Summary</h1>'));
});

test('every column produces one header cell', () => {
  const html = buildPrintDocument(report());
  assert.equal(countTags(html, 'th'), COLUMNS.length);
});

test('each row produces one cell per column, in column order', () => {
  const html = buildPrintDocument(report({
    rows: [
      { project: 'Site A', spent: '1' },
      { project: 'Site B', spent: '2' },
    ],
  }));
  assert.equal(countTags(html, 'td'), 2 * COLUMNS.length);
  assert.ok(html.indexOf('Site A') < html.indexOf('Site B'));
});

test('a right-aligned column is marked on both its header and its cells', () => {
  const html = buildPrintDocument(report());
  assert.ok(html.includes('<th class="right">Spent</th>'));
  assert.ok(html.includes('<td class="right">₹1,00,000</td>'));
});

test('a missing value in a row renders as an empty cell, never as undefined', () => {
  const html = buildPrintDocument(report({ rows: [{ project: 'Site A' }] }));
  assert.equal(html.includes('undefined'), false);
  assert.equal(countTags(html, 'td'), COLUMNS.length);
});

test('a key not matching any column is ignored rather than appended', () => {
  const html = buildPrintDocument(report({
    rows: [{ project: 'Site A', spent: '1', secret: 'should-not-print' }],
  }));
  assert.equal(html.includes('should-not-print'), false);
});

// ── Totals ────────────────────────────────────────────────────────────────────

test('a totals row emits every column so the figures stay aligned', () => {
  const html = buildPrintDocument(report({ totals: { spent: '₹1,00,000' } }));
  const foot = html.slice(html.indexOf('<tfoot>'));
  // The untotalled Project column still gets its cell.
  assert.equal(countTags(foot.slice(0, foot.indexOf('</tfoot>')), 'td'), COLUMNS.length);
});

test('no totals row is emitted when none was given', () => {
  assert.equal(buildPrintDocument(report()).includes('<tfoot>'), false);
});

// ── Empty and optional content ────────────────────────────────────────────────

test('an empty table says so instead of printing a bare header', () => {
  const html = buildPrintDocument(report({ rows: [], totals: { spent: '0' } }));
  assert.ok(html.includes('No records match the current filters.'));
  assert.equal(html.includes('<tbody>'), false);
  // A total over nothing would read as a real figure.
  assert.equal(html.includes('<tfoot>'), false);
});

test('filter captions are printed when supplied', () => {
  const html = buildPrintDocument(report({
    meta: [{ label: 'Period', value: 'FY 2026-27' }],
  }));
  assert.ok(html.includes('Period'));
  assert.ok(html.includes('FY 2026-27'));
});

test('optional blocks are absent rather than empty when not supplied', () => {
  const html = buildPrintDocument(report());
  assert.equal(html.includes('class="meta"'), false);
  assert.equal(html.includes('class="subtitle"'), false);
  assert.equal(html.includes('Generated'), false);
});

test('the generated stamp reads as a sentence with or without an author', () => {
  const withBoth = buildPrintDocument(report({ generatedOn: '30/09/2026', generatedBy: 'A. Bhoi' }));
  assert.ok(withBoth.includes('Generated 30/09/2026 by A. Bhoi'));
  const dateOnly = buildPrintDocument(report({ generatedOn: '30/09/2026' }));
  assert.ok(dateOnly.includes('Generated 30/09/2026'));
  assert.equal(dateOnly.includes(' by '), false);
});

test('a foot note is printed when supplied', () => {
  const html = buildPrintDocument(report({ footNote: 'Figures are partial.' }));
  assert.ok(html.includes('Figures are partial.'));
});

test('the table header repeats across printed sheets', () => {
  // Without this a multi-page table of figures has unlabelled columns after page one.
  assert.ok(buildPrintDocument(report()).includes('thead { display: table-header-group; }'));
});
