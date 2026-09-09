import test from 'node:test';
import assert from 'node:assert/strict';
import {
  eApprovalHtmlIsEmpty,
  eApprovalHtmlToText,
  eApprovalHtmlWithinLimit,
  hardenEApprovalHtmlLinks,
  E_APPROVAL_RICH_TEXT_MAX_LENGTH,
} from '../src/lib/e-approval-rich-text.ts';

/* ── the plain-text rendition, which is what the fingerprint hashes ──────────────────────────── */

test('formatting is dropped but the words survive', () => {
  assert.equal(
    eApprovalHtmlToText('<p>Approval is <strong>requested</strong> for <em>120 helmets</em>.</p>'),
    'Approval is requested for 120 helmets.',
  );
});

test('changing only the formatting leaves the text — and so the fingerprint — identical', () => {
  const plain = eApprovalHtmlToText('<p>Purchase 10 helmets for the Rayagada site.</p>');
  const bolded = eApprovalHtmlToText('<p>Purchase <b>10 helmets</b> for the <i>Rayagada</i> site.</p>');
  assert.equal(plain, bolded, 'making a word bold must not supersede an approval');
});

test('changing a word does change the text, so approvals are still superseded', () => {
  assert.notEqual(
    eApprovalHtmlToText('<p>Purchase 10 helmets.</p>'),
    eApprovalHtmlToText('<p>Purchase 10 vehicles.</p>'),
  );
});

test('blocks and line breaks become newlines', () => {
  assert.equal(eApprovalHtmlToText('<p>One</p><p>Two</p>'), 'One\nTwo');
  assert.equal(eApprovalHtmlToText('First<br>Second'), 'First\nSecond');
  assert.equal(eApprovalHtmlToText('<h2>Heading</h2><div>Body</div>'), 'Heading\nBody');
});

test('a pasted table keeps its shape: cells as tabs, rows as newlines', () => {
  const table =
    '<table><tbody>' +
    '<tr><th>Item</th><th>Qty</th></tr>' +
    '<tr><td>Helmets</td><td>120</td></tr>' +
    '<tr><td>Harnesses</td><td>120</td></tr>' +
    '</tbody></table>';
  assert.equal(eApprovalHtmlToText(table), 'Item\tQty\nHelmets\t120\nHarnesses\t120');
});

test('two different tables do not flatten to the same text', () => {
  const a = eApprovalHtmlToText('<table><tr><td>10</td><td>20</td></tr></table>');
  const b = eApprovalHtmlToText('<table><tr><td>1020</td></tr></table>');
  assert.notEqual(a, b, 'cell boundaries have to survive or the fingerprint cannot tell these apart');
});

test('list items keep a bullet so a list still reads as one', () => {
  assert.equal(eApprovalHtmlToText('<ul><li>First</li><li>Second</li></ul>'), '• First\n• Second');
});

test('script and style contents never surface as text', () => {
  assert.equal(eApprovalHtmlToText('<p>Real</p><script>alert(1)</script>'), 'Real');
  assert.equal(eApprovalHtmlToText('<style>.x{color:red}</style><p>Real</p>'), 'Real');
  assert.equal(eApprovalHtmlToText('<!-- a comment --><p>Real</p>'), 'Real');
});

test('entities are decoded, including the rupee sign and numeric forms', () => {
  assert.equal(eApprovalHtmlToText('<p>Cost &amp; freight &lt; &#8377;5,00,000</p>'), 'Cost & freight < ₹5,00,000');
  assert.equal(eApprovalHtmlToText('<p>A&nbsp;B</p>'), 'A B');
  assert.equal(eApprovalHtmlToText('<p>&#x20B9;100</p>'), '₹100');
});

test('an unknown entity is left as written rather than guessed at', () => {
  assert.equal(eApprovalHtmlToText('<p>&notanentity;</p>'), '&notanentity;');
});

test("Word's runs of empty paragraphs collapse to at most one blank line", () => {
  assert.equal(eApprovalHtmlToText('<p>One</p><p></p><p></p><p>&nbsp;</p><p>Two</p>'), 'One\n\nTwo');
});

/* ── emptiness, which contenteditable never reports honestly ─────────────────────────────────── */

test('the shapes an emptied editor actually leaves behind all count as empty', () => {
  for (const html of ['', '<p><br></p>', '<div><br></div>', '<p>&nbsp;</p>', '<p></p>', '<ul><li></li></ul>', '   ']) {
    assert.equal(eApprovalHtmlIsEmpty(html), true, JSON.stringify(html));
  }
});

test('a proposal with any real content is not empty', () => {
  assert.equal(eApprovalHtmlIsEmpty('<p>x</p>'), false);
  assert.equal(eApprovalHtmlIsEmpty('<table><tr><td>1</td></tr></table>'), false);
});

/* ── size limit, so a pasted Word page cannot fail the whole write ───────────────────────────── */

test('the length cap is enforced against the markup, not the text', () => {
  assert.equal(eApprovalHtmlWithinLimit('<p>short</p>'), true);
  assert.equal(eApprovalHtmlWithinLimit(null), true);
  assert.equal(eApprovalHtmlWithinLimit('x'.repeat(E_APPROVAL_RICH_TEXT_MAX_LENGTH)), true);
  assert.equal(eApprovalHtmlWithinLimit('x'.repeat(E_APPROVAL_RICH_TEXT_MAX_LENGTH + 1)), false);
});

/* ── links ───────────────────────────────────────────────────────────────────────────────────── */

test('links are forced to open in a new tab without a live opener', () => {
  const hardened = hardenEApprovalHtmlLinks('<a href="https://example.com">x</a>');
  assert.match(hardened, /target="_blank"/);
  assert.match(hardened, /rel="noopener noreferrer nofollow"/);
  assert.match(hardened, /href="https:\/\/example\.com"/);
});

test('a pasted target or rel is replaced, not appended to', () => {
  const hardened = hardenEApprovalHtmlLinks('<a href="https://x.test" target="_self" rel="opener">x</a>');
  assert.equal((hardened.match(/target=/g) ?? []).length, 1);
  assert.equal((hardened.match(/rel=/g) ?? []).length, 1);
  assert.doesNotMatch(hardened, /_self/);
  assert.doesNotMatch(hardened, /rel="opener"/);
});

test('an anchor with no href is left alone — it is not a link', () => {
  assert.equal(hardenEApprovalHtmlLinks('<a name="top">x</a>'), '<a name="top">x</a>');
});
