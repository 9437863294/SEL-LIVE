import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changedPaths } from '../src/lib/appearance/diff.ts';
import { assetProblems, probeImage } from '../src/lib/appearance/image-probe.ts';
import { appearanceAdminRights, canOpenAppearanceAdmin } from '../src/lib/appearance/permissions.ts';

// ── Image probing: formats are read from the bytes, never from names or MIME types ─────────────

function png(width, height, extra = 0) {
  const b = new Uint8Array(33 + extra);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.set([0, 0, 0, 13], 8);
  b.set([...'IHDR'].map((c) => c.charCodeAt(0)), 12);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

function jpeg(width, height) {
  // SOI, an APP0 segment to skip, then SOF0 with the frame size.
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);
}

function webpVp8x(width, height) {
  const b = new Uint8Array(30);
  b.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0);
  b.set([...'WEBP'].map((c) => c.charCodeAt(0)), 8);
  b.set([...'VP8X'].map((c) => c.charCodeAt(0)), 12);
  const w = width - 1;
  const h = height - 1;
  b.set([w & 255, (w >> 8) & 255, (w >> 16) & 255, h & 255, (h >> 8) & 255, (h >> 16) & 255], 24);
  return b;
}

test('PNG, JPEG and WebP are recognised with their true dimensions', () => {
  assert.deepEqual(probeImage(png(512, 128)), { type: 'image/png', width: 512, height: 128 });
  assert.deepEqual(probeImage(jpeg(800, 200)), { type: 'image/jpeg', width: 800, height: 200 });
  assert.deepEqual(probeImage(webpVp8x(640, 160)), { type: 'image/webp', width: 640, height: 160 });
});

test('SVG, HTML and anything else is refused, whatever it claims to be', () => {
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');
  const html = new TextEncoder().encode('<!doctype html><script>alert(1)</script>');
  assert.equal(probeImage(svg), null);
  assert.equal(probeImage(html), null);
  assert.deepEqual(assetProblems('logoLight', svg, null), ['Only PNG, JPEG or WebP images are accepted.']);
});

test('each kind of brand image has its own rules', () => {
  assert.deepEqual(assetProblems('logoLight', png(512, 128), probeImage(png(512, 128))), []);
  // A favicon must be a square PNG.
  assert.ok(assetProblems('favicon', png(64, 32), probeImage(png(64, 32))).some((p) => /square/.test(p)));
  assert.ok(assetProblems('favicon', jpeg(64, 64), probeImage(jpeg(64, 64))).some((p) => /PNG/.test(p)));
  // Too small, too large, too wide.
  assert.ok(assetProblems('logoDark', png(32, 8), probeImage(png(32, 8))).some((p) => /at least/.test(p)));
  assert.ok(assetProblems('appIcon', png(2048, 2048), probeImage(png(2048, 2048))).some((p) => /at most/.test(p)));
  assert.ok(assetProblems('logoLight', png(2000, 100), probeImage(png(2000, 100))).some((p) => /too wide/.test(p)));
  // Oversized files are refused on size alone.
  const big = png(512, 128, 2 * 1024 * 1024);
  assert.ok(assetProblems('logoLight', big, probeImage(big)).some((p) => /KB or smaller/.test(p)));
});

// ── The audit trail's list of what changed ─────────────────────────────────────────────────────

test('changed paths name each differing leaf, and a brand asset as one thing', () => {
  const before = { defaults: { accent: 'violet', density: 'standard' }, branding: { logoLight: { path: 'a', url: 'u1' }, companyName: 'SEL' } };
  const after = { defaults: { accent: 'teal', density: 'standard' }, branding: { logoLight: { path: 'b', url: 'u2' }, companyName: 'SEL' } };
  assert.deepEqual(changedPaths(before, after).sort(), ['branding.logoLight', 'defaults.accent']);
  assert.deepEqual(changedPaths(before, before), []);
  assert.deepEqual(changedPaths({ list: ['a', 'b'] }, { list: ['b', 'a'] }), ['list']);
});

// ── Who may manage company appearance ──────────────────────────────────────────────────────────

const checker = (grants) => (action, resource) => (grants[resource] ?? []).includes(action);

test('an ordinary user gets no company rights at all', () => {
  const rights = appearanceAdminRights(checker({ 'Settings.Appearance': ['View', 'Edit'] }));
  assert.deepEqual(rights, { viewBranding: false, editBranding: false, viewThemes: false, editThemes: false, publishThemes: false });
  assert.equal(canOpenAppearanceAdmin(rights), false);
});

test('drafting and publishing are separate powers', () => {
  const editor = appearanceAdminRights(checker({ 'Settings.Theme Management': ['Edit'] }));
  assert.equal(editor.editThemes, true);
  assert.equal(editor.publishThemes, false);
  const publisher = appearanceAdminRights(checker({ 'Settings.Theme Management': ['Publish'] }));
  assert.equal(publisher.publishThemes, true);
  assert.equal(publisher.editThemes, true, 'who may publish may edit the draft they publish');
  assert.equal(publisher.editBranding, false, 'theme rights say nothing about branding');
});

test('branding view-only holders can look but not change', () => {
  const rights = appearanceAdminRights(checker({ 'Settings.Company Branding': ['View'] }));
  assert.equal(rights.viewBranding, true);
  assert.equal(rights.editBranding, false);
});

test('existing access administrators can bootstrap before anyone holds the new resources', () => {
  const administer = appearanceAdminRights(checker({ 'Settings.Access Management': ['Administer'] }));
  assert.equal(administer.publishThemes && administer.editBranding, true);
  const pair = appearanceAdminRights(checker({ 'Settings.User Management': ['Edit'], 'Settings.Role Management': ['Edit'] }));
  assert.equal(pair.publishThemes && pair.editBranding, true);
  const half = appearanceAdminRights(checker({ 'Settings.User Management': ['Edit'] }));
  assert.equal(half.publishThemes || half.editBranding, false);
});
