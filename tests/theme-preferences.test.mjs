import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import {
  ACCENT_STYLE_STORAGE_KEY,
  DEFAULT_THEME_MODE,
  THEME_MODES,
  THEME_MODE_STORAGE_KEY,
  isThemeMode,
  resolveThemeMode,
  themeInitScript,
} from '../src/components/theme/theme-preferences.ts';
import { FLOATING_NAV_THEMES } from '../src/components/navigation/themes.ts';

/**
 * The inline script is the part that runs before React exists, in every browser, on every full page
 * load — including the login screen — and nothing type-checks the string it is built from. So it is
 * executed here against a stand-in page, for each stored value it can meet.
 */
function runInitScript({ mode, accent, systemDark = false, storageThrows = false } = {}) {
  const classes = new Set();
  const attributes = {};
  const documentElement = {
    classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)) },
    style: {},
    setAttribute: (name, value) => {
      attributes[name] = value;
    },
  };
  const store = { [THEME_MODE_STORAGE_KEY]: mode ?? null, [ACCENT_STYLE_STORAGE_KEY]: accent ?? null };
  const window = {
    localStorage: {
      getItem: (key) => {
        if (storageThrows) throw new Error('SecurityError');
        return store[key] ?? null;
      },
    },
    matchMedia: (query) => ({ matches: query === '(prefers-color-scheme: dark)' && systemDark }),
  };
  vm.runInNewContext(themeInitScript(), { window, document: { documentElement } });
  return { dark: classes.has('dark'), colorScheme: documentElement.style.colorScheme, accent: attributes['data-nav-style'] };
}

test('system mode follows the device; explicit modes ignore it', () => {
  assert.equal(resolveThemeMode('system', true), 'dark');
  assert.equal(resolveThemeMode('system', false), 'light');
  assert.equal(resolveThemeMode('light', true), 'light');
  assert.equal(resolveThemeMode('dark', false), 'dark');
});

test('only the three modes are accepted', () => {
  for (const mode of THEME_MODES) assert.ok(isThemeMode(mode));
  for (const junk of ['Dark', 'auto', '', null, undefined, 1]) assert.equal(isThemeMode(junk), false);
  assert.ok(isThemeMode(DEFAULT_THEME_MODE));
});

test('the init script applies each stored mode before paint', () => {
  assert.deepEqual(runInitScript({ mode: 'dark' }), { dark: true, colorScheme: 'dark', accent: undefined });
  assert.deepEqual(runInitScript({ mode: 'light', systemDark: true }), { dark: false, colorScheme: 'light', accent: undefined });
  assert.equal(runInitScript({ mode: 'system', systemDark: true }).dark, true);
  assert.equal(runInitScript({ mode: 'system', systemDark: false }).dark, false);
});

test('nothing stored, or something unexpected, falls back to the default mode', () => {
  const expectedDark = resolveThemeMode(DEFAULT_THEME_MODE, true) === 'dark';
  assert.equal(runInitScript({ systemDark: true }).dark, expectedDark);
  assert.equal(runInitScript({ mode: '"><script>', systemDark: true }).dark, expectedDark);
});

test('the accent is restored only when it is one of the real styles', () => {
  assert.equal(runInitScript({ accent: 'teal' }).accent, 'teal');
  assert.equal(runInitScript({ accent: 'purple' }).accent, undefined);
});

test('blocked storage cannot break the page', () => {
  assert.doesNotThrow(() => runInitScript({ storageThrows: true }));
});

test('the script and the bottom nav agree on the accent styles', () => {
  const script = themeInitScript();
  for (const style of FLOATING_NAV_THEMES) assert.ok(script.includes(`"${style}"`), style);
});
