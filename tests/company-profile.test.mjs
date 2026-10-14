import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gstinCheckChar } from '../src/lib/statutory.ts';
import {
  DEFAULT_COMPANY_PROFILE,
  UI_TEXT_DEFAULTS,
  UI_TEXT_KEYS,
  companyEmailSignature,
  companyLetterheadHtml,
  formatCompanyAddress,
  primaryGstin,
  sanitizeCompanyProfile,
  signatureLabelsFor,
  uiText,
  STANDARD_LETTERHEAD_FOOTER_HTML,
  STANDARD_LETTERHEAD_HEADER_HTML,
  companyFooterHtml,
  filterLetterheadStyle,
  isAllowedLetterheadImage,
  renderLetterheadTemplate,
} from '../src/lib/company-profile.ts';
import { sanitizeLetterheadHtml } from '../src/lib/letterhead-sanitize.ts';

/** A GSTIN with a correct check character, for state code `state`. */
const gstin = (state, pan = 'ABCDE1234F') => {
  const first14 = `${state}${pan}1Z`;
  return first14 + gstinCheckChar(first14);
};

test('the defaults are the values printed on the JMC and MVAC sheets', () => {
  assert.equal(DEFAULT_COMPANY_PROFILE.legalName, 'Siddhartha Engineering Limited');
  assert.equal(DEFAULT_COMPANY_PROFILE.city, 'Bhubaneswar');
  assert.equal(DEFAULT_COMPANY_PROFILE.pincode, '751012');
  assert.equal(DEFAULT_COMPANY_PROFILE.email, 'sel.techhead@gmail.com');
  assert.deepEqual(Object.keys(DEFAULT_COMPANY_PROFILE.labels).sort(), [...UI_TEXT_KEYS].sort());
  // Today's look: no company override of table rows or dialog sizes.
  assert.equal(DEFAULT_COMPANY_PROFILE.design.tables.density, 'auto');
  assert.equal(DEFAULT_COMPANY_PROFILE.design.dialogs.defaultSize, 'auto');
  assert.equal(DEFAULT_COMPANY_PROFILE.design.sidebar.collapsible, false);
  assert.equal(DEFAULT_COMPANY_PROFILE.labels.noPermissionModule, 'You do not have permission to access {module}.');
});

test('sanitize: junk input gives the defaults; a stored profile round-trips', () => {
  assert.deepEqual(sanitizeCompanyProfile(null), DEFAULT_COMPANY_PROFILE);
  assert.deepEqual(sanitizeCompanyProfile('nope'), DEFAULT_COMPANY_PROFILE);
  assert.deepEqual(sanitizeCompanyProfile(DEFAULT_COMPANY_PROFILE), DEFAULT_COMPANY_PROFILE);
});

test('sanitize: trims, collapses whitespace, caps lengths, blanks clear optional fields', () => {
  const p = sanitizeCompanyProfile({ legalName: '  Acme   Ltd  ', shortName: 'x'.repeat(100), tagline: '   ', phone: null, addressLines: [' a ', '', 'b', 'c', 'd', 'e'] });
  assert.equal(p.legalName, 'Acme Ltd');
  assert.equal(p.shortName.length, 40);
  assert.equal(p.tagline, null);
  assert.equal(p.phone, null);
  assert.deepEqual(p.addressLines, ['a', 'b', 'c', 'd']);
  // A required field left blank keeps the fallback.
  assert.equal(sanitizeCompanyProfile({ legalName: '' }).legalName, DEFAULT_COMPANY_PROFILE.legalName);
});

test('sanitize: tax ids, email and logo are validated', () => {
  const p = sanitizeCompanyProfile({ pan: 'abcde1234f', cin: 'u31200or1990plc002345', email: 'not-an-email', logoUrl: 'javascript:alert(1)' });
  assert.equal(p.pan, 'ABCDE1234F');
  assert.equal(p.cin, 'U31200OR1990PLC002345');
  assert.equal(p.email, null);
  assert.equal(p.logoUrl, null);
  assert.equal(sanitizeCompanyProfile({ pan: 'BAD' }).pan, null);
  assert.equal(sanitizeCompanyProfile({ logoUrl: 'https://firebasestorage.googleapis.com/x.png' }).logoUrl, 'https://firebasestorage.googleapis.com/x.png');
});

test('sanitize: GSTINs are format-checked, de-duplicated, and at most one is primary', () => {
  const odisha = gstin('21');
  const bengal = gstin('19');
  const p = sanitizeCompanyProfile({
    gstRegistrations: [
      { gstin: odisha.toLowerCase(), label: 'HO', primary: true },
      { gstin: odisha, label: 'dupe' },
      { gstin: '21ABCDE1234F1Z0', label: 'bad check char' },
      { gstin: bengal, primary: true },
      'junk',
    ],
  });
  assert.equal(p.gstRegistrations.length, 2);
  assert.deepEqual(p.gstRegistrations[0], { gstin: odisha, state: 'Odisha', label: 'HO', primary: true });
  assert.equal(p.gstRegistrations[1].state, 'West Bengal');
  assert.equal(p.gstRegistrations[1].label, 'West Bengal');
  assert.equal(p.gstRegistrations.filter((r) => r.primary).length, 1);
});

test('primaryGstin: the primary, else the first, else null', () => {
  const a = gstin('21');
  const b = gstin('19');
  assert.equal(primaryGstin(DEFAULT_COMPANY_PROFILE), null);
  assert.equal(primaryGstin(sanitizeCompanyProfile({ gstRegistrations: [{ gstin: a }, { gstin: b }] })), a);
  assert.equal(primaryGstin(sanitizeCompanyProfile({ gstRegistrations: [{ gstin: a }, { gstin: b, primary: true }] })), b);
});

test('formatCompanyAddress: multi-line and single-line', () => {
  assert.equal(formatCompanyAddress(DEFAULT_COMPANY_PROFILE, { singleLine: true }), 'Plot No. 1015, Nayapalli, N.H. 5, Bhubaneswar - 751012, Odisha');
  assert.equal(formatCompanyAddress(DEFAULT_COMPANY_PROFILE), 'Plot No. 1015, Nayapalli, N.H. 5\nBhubaneswar - 751012, Odisha');
  assert.match(formatCompanyAddress(DEFAULT_COMPANY_PROFILE, { singleLine: true, includeCountry: true }), /Odisha, India$/);
});

test('design and labels: invalid values fall back, unknown label keys are dropped, blanks filled', () => {
  const p = sanitizeCompanyProfile({
    design: { letterhead: { layout: 'diagonal', accentColor: 'red', divider: 'bar' }, tables: { density: 'compact', striped: 'yes' }, sidebar: { width: 'wide', style: 'neon' } },
    labels: { save: '  Submit ', cancel: '', bogus: 'x' },
  });
  assert.equal(p.design.letterhead.layout, DEFAULT_COMPANY_PROFILE.design.letterhead.layout);
  assert.equal(p.design.letterhead.accentColor, DEFAULT_COMPANY_PROFILE.design.letterhead.accentColor);
  assert.equal(p.design.letterhead.divider, 'bar');
  assert.equal(p.design.tables.density, 'compact');
  assert.equal(p.design.tables.striped, false);
  assert.equal(p.design.sidebar.width, 'wide');
  assert.equal(p.design.sidebar.style, DEFAULT_COMPANY_PROFILE.design.sidebar.style);
  assert.equal(p.labels.save, 'Submit');
  assert.equal(p.labels.cancel, UI_TEXT_DEFAULTS.cancel);
  assert.equal('bogus' in p.labels, false);
});

test('uiText: a caller fallback wins until the admin changes the label', () => {
  assert.equal(uiText(UI_TEXT_DEFAULTS, 'save'), 'Save');
  assert.equal(uiText(UI_TEXT_DEFAULTS, 'save', 'Save voucher'), 'Save voucher');
  assert.equal(uiText({ ...UI_TEXT_DEFAULTS, save: 'Submit' }, 'save', 'Save voucher'), 'Submit');
});

test('signature captions: configured list, else the three labels', () => {
  assert.deepEqual(signatureLabelsFor(DEFAULT_COMPANY_PROFILE), ['Prepared by', 'Checked by', 'Approved by']);
  const p = sanitizeCompanyProfile({ design: { print: { signatureLabels: ['Site Engineer', ' ', 'GM'] } } });
  assert.deepEqual(signatureLabelsFor(p), ['Site Engineer', 'GM']);
});

test('companyLetterheadHtml escapes every value and honours the toggles', () => {
  const p = sanitizeCompanyProfile({
    legalName: 'A & B <script>alert(1)</script>',
    tagline: '"quoted"',
    gstRegistrations: [{ gstin: gstin('21'), primary: true }],
    logoUrl: 'https://example.com/logo.png?a=1&b=2',
  });
  const html = companyLetterheadHtml(p, { title: 'Voucher <1>', subtitle: "O'Neil" });
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('A &amp; B &lt;script&gt;'));
  assert.ok(html.includes('&quot;quoted&quot;'));
  assert.ok(html.includes('Voucher &lt;1&gt;'));
  assert.ok(html.includes('O&#39;Neil'));
  assert.ok(html.includes(`GSTIN ${gstin('21')}`));
  assert.ok(html.includes('src="https://example.com/logo.png?a=1&amp;b=2"'));
  const hidden = companyLetterheadHtml(sanitizeCompanyProfile({ ...p, design: { letterhead: { showGstin: false, showLogo: false, showAddress: false } } }));
  assert.ok(!hidden.includes('GSTIN'));
  assert.ok(!hidden.includes('<img'));
  assert.ok(!hidden.includes('Nayapalli'));
});

test('companyEmailSignature is plain text with the contacts', () => {
  const text = companyEmailSignature(DEFAULT_COMPANY_PROFILE);
  assert.match(text, /^Siddhartha Engineering Limited\n/);
  assert.match(text, /Email: sel\.techhead@gmail\.com/);
  assert.ok(!text.includes('<'));
});


/* ── the designed letterhead ── */

test('designed letterhead: standard mode by default; old documents without the fields stay standard', () => {
  assert.equal(DEFAULT_COMPANY_PROFILE.design.letterhead.mode, 'standard');
  const old = sanitizeCompanyProfile({ design: { letterhead: { layout: 'left' } } });
  assert.equal(old.design.letterhead.mode, 'standard');
  assert.equal(old.design.letterhead.custom.headerHtml, STANDARD_LETTERHEAD_HEADER_HTML);
  const custom = sanitizeCompanyProfile({ design: { letterhead: { mode: 'custom', custom: { headerHeightMm: 999, footerHeightMm: 'x', headerOn: 'nope', marginMm: '' } } } });
  assert.equal(custom.design.letterhead.mode, 'custom');
  assert.equal(custom.design.letterhead.custom.headerHeightMm, 120);
  assert.equal(custom.design.letterhead.custom.footerHeightMm, null);
  assert.equal(custom.design.letterhead.custom.headerOn, 'first');
  assert.equal(custom.design.letterhead.custom.marginMm, null);
  const tooLong = sanitizeCompanyProfile({ design: { letterhead: { custom: { headerHtml: 'x'.repeat(50_000) } } } });
  assert.equal(tooLong.design.letterhead.custom.headerHtml, STANDARD_LETTERHEAD_HEADER_HTML);
});

test('designed letterhead: the default templates reproduce the standard letterhead and survive the sanitiser', () => {
  const html = renderLetterheadTemplate(STANDARD_LETTERHEAD_HEADER_HTML, DEFAULT_COMPANY_PROFILE, { documentTitle: 'Payment Voucher' });
  assert.match(html, /Siddhartha Engineering Limited/);
  assert.match(html, /Bhubaneswar - 751012, Odisha/);
  assert.match(html, /Payment Voucher/);
  // No subtitle, no GSTIN/CIN/PAN on the defaults: those paragraphs are dropped, not left empty.
  assert.doesNotMatch(html, /<p[^>]*><\/p>/);
  assert.equal(sanitizeLetterheadHtml(STANDARD_LETTERHEAD_HEADER_HTML), STANDARD_LETTERHEAD_HEADER_HTML);
  assert.equal(sanitizeLetterheadHtml(STANDARD_LETTERHEAD_FOOTER_HTML), STANDARD_LETTERHEAD_FOOTER_HTML);
  const footer = companyFooterHtml(DEFAULT_COMPANY_PROFILE);
  assert.match(footer, /Siddhartha Engineering Limited · Plot No\. 1015/);
  assert.doesNotMatch(footer, / · {2}· /);
});

test('designed letterhead: merge fields are escaped, unknown ones render empty, attributes are left alone', () => {
  const profile = sanitizeCompanyProfile({ legalName: 'A <b>&</b> "Co"', logoUrl: 'https://firebasestorage.googleapis.com/v0/b/x/o/logo.png' });
  const out = renderLetterheadTemplate(
    '<p>{{legalName}}|{{ nope }}|{{meta.Voucher No}}|{{logo}}</p><p title="{{legalName}}">x</p>',
    profile,
    { meta: [{ label: 'Voucher No', value: '<script>1</script>' }] },
  );
  assert.ok(out.includes('A &lt;b&gt;&amp;&lt;/b&gt; &quot;Co&quot;||&lt;script&gt;1&lt;/script&gt;|<img src="https://firebasestorage'), out);
  assert.ok(out.includes('title="{{legalName}}"'));
  assert.equal(renderLetterheadTemplate('<p>{{documentSubtitle}}</p><p>keep</p>', profile), '<p>keep</p>');
  // A non-https logo never becomes an image.
  assert.doesNotMatch(renderLetterheadTemplate('<p>{{logo}}</p>', { ...profile, logoUrl: 'javascript:alert(1)' }), /<img/);
});

test('designed letterhead: the sanitiser strips scripts, handlers, javascript: links, foreign images and CSS urls', () => {
  const dirty =
    '<p onclick="steal()" style="color:#c00;background:url(https://evil.example/x.png);position:fixed;font-family:Calibri,Wingdings">Hi<script>alert(1)</script></p>' +
    '<a href="javascript:alert(1)">bad</a><a href="https://sel.example">good</a>' +
    '<img src="https://evil.example/pixel.png"><img src="https://firebasestorage.googleapis.com/v0/b/sel-bucket/o/seal.png?alt=media" onerror="x()">' +
    '<iframe src="https://evil.example"></iframe><svg><script>1</script></svg><form><input></form>' +
    '<table><tr><td colspan="2" width="50%" onmouseover="x()">c</td></tr></table>';
  const clean = sanitizeLetterheadHtml(dirty, { buckets: ['sel-bucket'] });
  assert.doesNotMatch(clean, /script|onclick|onerror|onmouseover|javascript|iframe|svg|form|input|evil\.example|url\(|position/i);
  assert.ok(clean.includes('style="color:#c00;font-family:Calibri"'), clean);
  assert.ok(clean.includes('<a href="https://sel.example" target="_blank" rel="noopener noreferrer">good</a>'));
  assert.ok(clean.includes('<img src="https://firebasestorage.googleapis.com/v0/b/sel-bucket/'));
  assert.ok(clean.includes('<td colspan="2" width="50%">c</td>'));
  // Another project's bucket is foreign too, and so is plain http.
  assert.equal(isAllowedLetterheadImage('https://firebasestorage.googleapis.com/v0/b/other/o/x.png', { buckets: ['sel-bucket'] }), false);
  assert.equal(isAllowedLetterheadImage('http://firebasestorage.googleapis.com/v0/b/sel-bucket/o/x.png', { buckets: ['sel-bucket'] }), false);
  assert.equal(filterLetterheadStyle('color:red;width:expression(alert(1));margin:0 !important;text-align:center'), 'color:red;text-align:center');
});
