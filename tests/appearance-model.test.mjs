import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { contrastRatio, ensureContrast, hexToHsl, hslToHex, isHex, readableOn } from '../src/lib/appearance/color.ts';
import {
  ACCENTS,
  BUILT_IN_ACCENTS,
  DEFAULT_CONFIG,
  cleanText,
  sanitizeAsset,
  sanitizeConfig,
  sanitizePreferences,
} from '../src/lib/appearance/model.ts';
import { SEL_CLASSIC, SEL_MIDNIGHT } from '../src/lib/appearance/presets.ts';
import { accentFor, appearanceAttributes, buildAppearanceCss, resolveAppearance, themeContrastReport } from '../src/lib/appearance/resolve.ts';
import { APPEARANCE_USER_KEY, COMPANY_CACHE_KEY, appearanceInitScript, userCacheKey } from '../src/lib/appearance/init-script.ts';

const hex = ([h, s, l]) => hslToHex(h, s, l);

// ── Colour ─────────────────────────────────────────────────────────────────────────────────────

test('only strict six-digit hex colours are accepted', () => {
  assert.ok(isHex('#1a2B3c'));
  for (const bad of ['#fff', 'red', 'rgb(0,0,0)', '#12345g', '#123456;}', 'var(--x)', '', null]) assert.equal(isHex(bad), false, String(bad));
});

test('hex ↔ hsl round-trips within a unit', () => {
  for (const sample of ['#7c3aed', '#0f766e', '#b45309', '#ffffff', '#000000']) {
    const back = hslToHex(...hexToHsl(sample));
    assert.ok(contrastRatio(sample, back) < 1.02, `${sample} → ${back}`);
  }
});

test('ensureContrast moves a colour until it reads, in the right direction', () => {
  const onWhite = ensureContrast('#fde68a', '#ffffff', 4.5);
  assert.ok(contrastRatio(onWhite, '#ffffff') >= 4.5);
  const onBlack = ensureContrast('#1e1b4b', '#000000', 4.5);
  assert.ok(contrastRatio(onBlack, '#000000') >= 4.5);
});

// ── Accents and presets ────────────────────────────────────────────────────────────────────────

test('every built-in accent carries readable text and reads on its own scheme', () => {
  const lightCard = hex(SEL_CLASSIC.card);
  const darkCard = hex(SEL_MIDNIGHT.card);
  for (const id of BUILT_IN_ACCENTS) {
    const { light, dark } = ACCENTS[id];
    assert.ok(contrastRatio(readableOn(light), light) >= 4.5, `${id} button label`);
    assert.ok(contrastRatio(light, lightCard) >= 4.5, `${id} as text on light cards`);
    assert.ok(contrastRatio(dark, darkCard) >= 4.5, `${id} as text on dark cards`);
  }
});

test('the shipped themes pass their own contrast report', () => {
  for (const scheme of ['light', 'dark']) {
    const failures = themeContrastReport(DEFAULT_CONFIG, scheme).filter((check) => !check.pass);
    assert.deepEqual(failures, [], `${scheme}: ${JSON.stringify(failures)}`);
  }
});

test('a pale company colour is darkened on light and a deep one lightened on dark, never used raw', () => {
  const company = sanitizeConfig({ theme: { brandColor: '#fff3b0', approvedAccents: ['brand', 'violet'] } });
  const light = accentFor(company, 'brand', 'light', '#ffffff');
  assert.ok(contrastRatio(light, '#ffffff') >= 4.5);
  const deep = sanitizeConfig({ theme: { brandColor: '#1a1030', approvedAccents: ['brand'] } });
  const dark = accentFor(deep, 'brand', 'dark', hex(SEL_MIDNIGHT.card));
  assert.ok(contrastRatio(dark, hex(SEL_MIDNIGHT.card)) >= 4.5);
});

// ── Validation ─────────────────────────────────────────────────────────────────────────────────

test('preferences keep only known fields and values', () => {
  const prefs = sanitizePreferences(
    {
      mode: 'dark',
      accent: 'teal',
      density: 'tiny',
      textSize: 'large',
      font: 'Comic Sans',
      extra: '<script>',
      layout: { breadcrumbs: true, stickyHeader: 'yes', pinnedModules: ['HR & Recruitment', 'Nope', 'HR & Recruitment', '<b>'] },
    },
    ['HR & Recruitment', 'E-Approval'],
  );
  assert.deepEqual(prefs, { mode: 'dark', accent: 'teal', textSize: 'large', layout: { breadcrumbs: true, pinnedModules: ['HR & Recruitment'] } });
});

test('text fields are plain text: no tags, no control characters, capped', () => {
  assert.equal(cleanText('  <b>SEL</b>\u0007 Live  ', 20), 'bSEL/b Live');
  assert.equal(cleanText('x'.repeat(100), 10), 'x'.repeat(10));
  assert.equal(cleanText(42, 10), undefined);
});

test('brand assets must be our own branding/ storage objects with sane metadata', () => {
  const good = {
    path: 'branding/logoLight/1700000000000-ab12.png',
    url: 'https://firebasestorage.googleapis.com/v0/b/demo.appspot.com/o/branding%2FlogoLight%2F1700000000000-ab12.png?alt=media&token=0f1e2d3c-4b5a-6978-8f9e-a0b1c2d3e4f5',
    contentType: 'image/png',
    width: 512,
    height: 128,
    size: 24000,
  };
  assert.deepEqual(sanitizeAsset(good), good);
  assert.equal(sanitizeAsset({ ...good, url: 'https://evil.example.com/logo.png' }), null);
  assert.equal(sanitizeAsset({ ...good, contentType: 'image/svg+xml' }), null);
  assert.equal(sanitizeAsset({ ...good, path: 'users/abc/logo.png' }), null);
  assert.equal(sanitizeAsset({ ...good, size: 50 * 1024 * 1024 }), null);
});

test('a company config is repaired, not trusted', () => {
  const config = sanitizeConfig({
    theme: { lightPreset: 'neon-pink', approvedAccents: ['teal'], custom: { light: { background: '#fff', danger: '#b91c1c', evil: '#000000' } } },
    defaults: { accent: 'violet', font: 'papyrus' },
  });
  assert.equal(config.theme.lightPreset, 'sel-classic');
  assert.deepEqual(config.theme.custom.light, { danger: '#b91c1c' });
  // The default accent must be one users may choose, so an unapproved one falls back.
  assert.equal(config.defaults.accent, 'teal');
  assert.equal(config.defaults.font, 'inter');
});

// ── Precedence ─────────────────────────────────────────────────────────────────────────────────

test('saved preferences beat company defaults; absent preferences follow them', () => {
  const company = sanitizeConfig({ defaults: { density: 'compact', mode: 'system' } });
  const inherited = resolveAppearance(company, {});
  assert.equal(inherited.density, 'compact');
  assert.equal(inherited.mode, 'system');
  const chosen = resolveAppearance(company, { density: 'comfortable', mode: 'dark' });
  assert.equal(chosen.density, 'comfortable');
  assert.equal(chosen.mode, 'dark');
});

test('an accent or font the company withdrew falls back to the company default', () => {
  const company = sanitizeConfig({ theme: { approvedAccents: ['violet', 'blue'], approvedFonts: ['inter'] } });
  const effective = resolveAppearance(company, { accent: 'rose', font: 'roboto' });
  assert.equal(effective.accent, 'violet');
  assert.equal(effective.font, 'inter');
});

test('publishing new defaults never overwrites what a user chose', () => {
  const prefs = { accent: 'blue', textSize: 'large' };
  const before = resolveAppearance(sanitizeConfig({}), prefs);
  const after = resolveAppearance(sanitizeConfig({ defaults: { accent: 'teal', textSize: 'small', density: 'compact' } }), prefs);
  assert.equal(after.accent, before.accent);
  assert.equal(after.textSize, 'large');
  assert.equal(after.density, 'compact');
});

test('attributes only ever carry listed values', () => {
  const attrs = appearanceAttributes(resolveAppearance(DEFAULT_CONFIG, { contrast: 'high', motion: 'reduced' }));
  assert.equal(attrs.contrast, 'high');
  assert.equal(attrs.motion, 'reduced');
  for (const value of Object.values(attrs)) assert.match(value, /^[a-z-]+$/);
});

// ── Stylesheet ─────────────────────────────────────────────────────────────────────────────────

test('the stylesheet covers light, dark and both high-contrast variants, dark on screen only', () => {
  const css = buildAppearanceCss(DEFAULT_CONFIG, 'violet');
  assert.match(css, /^html:root\{--background:/);
  assert.match(css, /@media screen\{html\.dark\{/);
  assert.match(css, /html\[data-contrast='high'\]:root\{/);
  assert.match(css, /@media screen\{html\.dark\[data-contrast='high'\]\{/);
  assert.match(css, /--destructive:/);
  assert.match(css, /--success:/);
  assert.match(css, /--chart-5:/);
  assert.doesNotMatch(css, /NaN|undefined|<|url\(/);
});

test("custom colours reach the stylesheet only as validated tokens", () => {
  const company = sanitizeConfig({ theme: { lightPreset: 'custom', custom: { light: { background: '#fafaf5', success: '#15803d' } } } });
  const css = buildAppearanceCss(company, 'violet');
  const [h, s, l] = hexToHsl('#fafaf5').map((n) => Math.round(n * 10) / 10);
  assert.ok(css.includes(`--background:${h} ${s}% ${l}%`));
});

// ── Before-paint script ────────────────────────────────────────────────────────────────────────

function runScript(store, { systemDark = false } = {}) {
  const classes = new Set();
  const attrs = {};
  const styles = [];
  const documentElement = {
    classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)) },
    style: {},
    setAttribute: (k, v) => {
      attrs[k] = v;
    },
    appendChild: (node) => styles.push(node),
  };
  const document = {
    documentElement,
    head: { appendChild: (node) => styles.push(node) },
    createElement: () => ({ id: '', textContent: '' }),
  };
  const window = {
    localStorage: { getItem: (key) => store[key] ?? null },
    matchMedia: (q) => ({ matches: q === '(prefers-color-scheme: dark)' && systemDark }),
  };
  vm.runInNewContext(appearanceInitScript(), { window, document });
  return { dark: classes.has('dark'), attrs, css: styles.map((s) => s.textContent).join('') };
}

const cache = (over) => JSON.stringify({ v: 1, mode: 'light', attrs: {}, css: '', ...over });

test("the signed-in user's cached appearance is on the first frame", () => {
  const result = runScript({
    [APPEARANCE_USER_KEY]: 'u1',
    [userCacheKey('u1')]: cache({ mode: 'dark', attrs: { 'text-size': 'large', density: 'compact' }, css: 'html:root{--x:1}' }),
  });
  assert.equal(result.dark, true);
  assert.equal(result.attrs['data-text-size'], 'large');
  assert.equal(result.attrs['data-density'], 'compact');
  assert.equal(result.css, 'html:root{--x:1}');
});

test('signed out, the company appearance applies — never the last user’s', () => {
  const store = { [userCacheKey('u1')]: cache({ mode: 'dark' }), [COMPANY_CACHE_KEY]: cache({ mode: 'system' }) };
  assert.equal(runScript(store, { systemDark: false }).dark, false);
  assert.equal(runScript(store, { systemDark: true }).dark, true);
});

test('tampered cache values are ignored', () => {
  const result = runScript({
    [APPEARANCE_USER_KEY]: 'u1',
    [userCacheKey('u1')]: cache({ mode: 'purple', attrs: { density: 'zero', onclick: 'x', 'text-size': 'large' } }),
  });
  assert.equal(result.dark, false);
  assert.equal(result.attrs['data-density'], undefined);
  assert.equal(result.attrs['data-onclick'], undefined);
  assert.equal(result.attrs['data-text-size'], 'large');
  assert.doesNotThrow(() => runScript({ [APPEARANCE_USER_KEY]: 'u1', [userCacheKey('u1')]: '{not json' }));
});
