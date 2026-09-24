import test from 'node:test';
import assert from 'node:assert/strict';

import { cleanCss, linkTextMismatch, mailFrameDocument, sanitizeMailHtml } from '../src/lib/mail-hub/sanitize.ts';

test('scripts, handlers, frames, forms, SVG and dangerous schemes are removed', () => {
  const { html } = sanitizeMailHtml(`
    <p onclick="steal()" onmouseover="x">Hi</p><script>alert(1)</script><iframe src="https://x"></iframe>
    <form action="https://evil"><input name=p></form><object data=x></object><embed src=x>
    <svg><script>alert(2)</script></svg><math><mi>x</mi></math><base href="https://evil/">
    <meta http-equiv="refresh" content="0;url=https://evil"><a href="javascript:alert(3)">js</a>
    <a href="data:text/html,<script>alert(4)</script>">data</a><a href="vbscript:x">vb</a>`);
  for (const bad of ['onclick', 'onmouseover', '<script', '<iframe', '<form', '<input', '<object', '<embed', '<svg', '<base', 'http-equiv', 'javascript:', 'data:text', 'vbscript:']) {
    assert.equal(html.toLowerCase().includes(bad), false, `${bad} survived`);
  }
  assert.match(html, /<p>Hi<\/p>/);
});

test('remote images are blocked by default, counted, and allowed on request (https only)', () => {
  const input = '<img src="https://tracker.example/p.gif"><img src="http://plain.example/i.png"><div style="background:url(https://t.example/b.png)">x</div>';
  const blocked = sanitizeMailHtml(input);
  assert.equal(blocked.remoteContentBlocked, 3);
  assert.equal(/\ssrc="https?:/.test(blocked.html), false);
  assert.match(blocked.html, /data-remote-src="https:\/\/tracker.example\/p.gif"/);
  assert.match(blocked.html, /background:none/);

  const allowed = sanitizeMailHtml(input, { allowRemoteContent: true });
  assert.match(allowed.html, /\ssrc="https:\/\/tracker.example\/p.gif"/);
  assert.equal(/\ssrc="http:\/\/plain/.test(allowed.html), false, 'plain http is never loaded');
  assert.ok(allowed.html.includes('url(&quot;https://t.example/b.png&quot;)'));
});

test('inline cid images become data URIs only when the server supplied them, and SVG data is refused', () => {
  const { html } = sanitizeMailHtml('<img src="cid:logo@sel"><img src="cid:missing@sel"><img src="data:image/svg+xml;base64,PHN2Zz4=">', {
    inlineImages: { 'logo@sel': 'data:image/png;base64,iVBORw0KGgo=' },
  });
  assert.match(html, /src="data:image\/png;base64,iVBORw0KGgo="/);
  assert.match(html, /data-blocked="inline"/);
  assert.equal(html.includes('svg'), false);
});

test('links go through the interstitial, open safely, and phishing-shaped ones are flagged', () => {
  const { html, suspiciousLinks } = sanitizeMailHtml(
    '<a href="https://evil.example/login">https://www.mybank.com/login</a> <a href="https://docs.sel.in/x">docs.sel.in</a> <a href="https://sub.sel.in">sel.in</a>',
  );
  assert.equal(suspiciousLinks, 1);
  assert.match(html, /href="\/mail\/link\?u=https%3A%2F%2Fevil.example%2Flogin&amp;w=text-mismatch"/);
  assert.match(html, /rel="noopener noreferrer nofollow"/);
  assert.match(html, /target="_blank"/);
  assert.equal(linkTextMismatch('sel.in', 'https://sub.sel.in'), false, 'a subdomain of the shown domain is fine');
  assert.equal(linkTextMismatch('Click here', 'https://evil.example'), false, 'plain text is not a claim about the destination');
});

test('style blocks survive with loads and escapes stripped, and cannot break out of the element', () => {
  const { html } = sanitizeMailHtml('<style>@import url(https://x/a.css); p{color:red;behavior:url(x.htc)} </style ><img src=x onerror=alert(1)></style><p style="position:fixed;top:0">x</p>');
  assert.equal(html.includes('@import'), false);
  assert.equal(html.includes('onerror'), false);
  assert.equal(/behavior\s*:/.test(html), false);
  assert.match(html, /position:static/);
  assert.equal(cleanCss('a{b:expression(alert(1))}', false).css.includes('expression('), false);
});

test('the display frame forbids scripts, connections and forms by CSP', () => {
  const doc = mailFrameDocument('<p>x</p>', false);
  assert.match(doc, /default-src 'none'/);
  assert.match(doc, /img-src data:;/);
  assert.match(doc, /form-action 'none'/);
  assert.equal(doc.includes('script-src'), false, 'no script source is allowed at all');
  assert.match(mailFrameDocument('<p>x</p>', true), /img-src data: https:/);
});
