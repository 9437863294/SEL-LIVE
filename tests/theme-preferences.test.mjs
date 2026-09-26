import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import {
  DEFAULT_THEME_MODE,
  THEME_MODES,
  THEME_USER_STORAGE_KEY,
  accentStyleStorageKey,
  isThemeMode,
  resolveThemeMode,
  themeInitScript,
  themeModeStorageKey,
} from '../src/components/theme/theme-preferences.ts';
import { FLOATING_NAV_THEMES } from '../src/components/navigation/themes.ts';

/**
 * The inline script is the part that runs before React exists, in every browser, on every full page
 * load — including the login screen — and nothing type-checks the string it is built from. So it is
 * executed here against a stand-in page and a stand-in localStorage.
 */
function runInitScript(store = {}, { systemDark = false, storageThrows = false } = {}) {
  const classes = new Set();
  const attributes = {};
  const documentElement = {
    classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)) },
    style: {},
    setAttribute: (name, value) => {
      attributes[name] = value;
    },
  };
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

/** A device where `userId` is signed in and has chosen `mode` (and optionally an accent). */
const signedIn = (userId, mode, accent) => ({
  [THEME_USER_STORAGE_KEY]: userId,
  [themeModeStorageKey(userId)]: mode,
  ...(accent ? { [accentStyleStorageKey(userId)]: accent } : {}),
});

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

test("the init script applies the signed-in user's own mode before paint", () => {
  assert.deepEqual(runInitScript(signedIn('u1', 'dark')), { dark: true, colorScheme: 'dark', accent: undefined });
  assert.deepEqual(runInitScript(signedIn('u1', 'light'), { systemDark: true }), { dark: false, colorScheme: 'light', accent: undefined });
  assert.equal(runInitScript(signedIn('u1', 'system'), { systemDark: true }).dark, true);
  assert.equal(runInitScript(signedIn('u1', 'system'), { systemDark: false }).dark, false);
});

test("one person's choice never reaches the next on a shared device", () => {
  const defaultDark = resolveThemeMode(DEFAULT_THEME_MODE, true) === 'dark';
  // u1 chose dark and teal; u2 is the one signed in now and chose nothing.
  const device = { ...signedIn('u1', 'dark', 'teal'), [THEME_USER_STORAGE_KEY]: 'u2' };
  assert.deepEqual(runInitScript(device, { systemDark: true }), { dark: defaultDark, colorScheme: defaultDark ? 'dark' : 'light', accent: undefined });
  // Signed out (no current user): the sign-in screen is in the default, whatever anyone chose.
  const signedOut = { ...signedIn('u1', 'dark', 'teal') };
  delete signedOut[THEME_USER_STORAGE_KEY];
  assert.equal(runInitScript(signedOut, { systemDark: true }).dark, defaultDark);
  assert.equal(runInitScript(signedOut).accent, undefined);
});

test('an unexpected stored value falls back to the default mode', () => {
  const defaultDark = resolveThemeMode(DEFAULT_THEME_MODE, true) === 'dark';
  assert.equal(runInitScript(signedIn('u1', '"><script>'), { systemDark: true }).dark, defaultDark);
});

test("the user's accent is restored only when it is one of the real styles", () => {
  assert.equal(runInitScript(signedIn('u1', 'light', 'teal')).accent, 'teal');
  assert.equal(runInitScript(signedIn('u1', 'light', 'purple')).accent, undefined);
});

test('blocked storage cannot break the page', () => {
  assert.doesNotThrow(() => runInitScript({}, { storageThrows: true }));
});

test('the script and the bottom nav agree on the accent styles', () => {
  const script = themeInitScript();
  for (const style of FLOATING_NAV_THEMES) assert.ok(script.includes(`"${style}"`), style);
});
