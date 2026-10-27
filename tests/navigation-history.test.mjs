import test from 'node:test';
import assert from 'node:assert/strict';

// The tracker reads `window.location` and listens for `popstate`; this is just enough of a window.
const location = { pathname: '/', search: '' };
const handlers = new Map();
globalThis.window = { location, addEventListener: (type, handler) => handlers.set(type, handler) };

const { markNextNavigationAsReplace, navigationOrigin, noteNavigation, subscribeNavigation } = await import(
  '../src/lib/navigation-history.ts'
);

const visit = (href) => {
  const [pathname, query = ''] = href.split('?');
  location.pathname = pathname;
  location.search = query ? `?${query}` : '';
};
/** A link or `router.push`. */
const push = (href) => {
  visit(href);
  noteNavigation(location.pathname);
};
/** `router.replace`, made the way the app makes it. */
const replace = (href) => {
  markNextNavigationAsReplace();
  push(href);
};
/** The browser's Back or Forward button, or `router.back()`. */
const traverse = (href) => {
  visit(href);
  handlers.get('popstate')?.();
  noteNavigation(location.pathname);
};

// One tab, one history: the steps below run in order and build on each other.

test('a page opened by a push was opened from the page before it', () => {
  push('/e-approval/inbox');
  push('/e-approval/all');
  push('/e-approval/A1?returnTo=%2Fe-approval%2Fall');
  assert.equal(navigationOrigin('/e-approval/A1'), '/e-approval/all');
  // Only ever answered for the page actually on screen.
  assert.equal(navigationOrigin('/e-approval/all'), null);
});

test('coming back through the history keeps where the page was first opened from', () => {
  push('/e-approval/A1/edit?returnTo=%2Fe-approval%2Fall');
  assert.equal(navigationOrigin('/e-approval/A1/edit'), '/e-approval/A1?returnTo=%2Fe-approval%2Fall');
  traverse('/e-approval/A1?returnTo=%2Fe-approval%2Fall');
  assert.equal(navigationOrigin('/e-approval/A1'), '/e-approval/all');
});

test('a replaced page hands its origin to the page that replaces it', () => {
  push('/e-approval/drafts');
  push('/e-approval/create');
  assert.equal(navigationOrigin('/e-approval/create'), '/e-approval/drafts');
  replace('/e-approval/B2?returnTo=%2Fe-approval%2Fdrafts');
  assert.equal(navigationOrigin('/e-approval/B2'), '/e-approval/drafts');
});

test('a replace from a page with no known origin leaves the new page with none', () => {
  // A stale record from an earlier visit must not survive being replaced into.
  push('/e-approval/C3');
  push('/e-approval/C3/print');
  traverse('/e-approval/C3');
  // C3 was opened from B2 above; replace into it from a page whose origin is unknown.
  traverse('/e-approval/unknown-origin');
  replace('/e-approval/C3');
  assert.equal(navigationOrigin('/e-approval/C3'), null);
});

test('Back or Forward within one page (a hash, a query) is not a move between pages', () => {
  push('/e-approval/settings');
  visit('/e-approval/settings?tab=types');
  handlers.get('popstate')?.();
  push('/e-approval/settings/types');
  assert.equal(navigationOrigin('/e-approval/settings/types'), '/e-approval/settings');
});

test('subscribers hear about each page change, and only page changes', () => {
  let calls = 0;
  const stop = subscribeNavigation(() => {
    calls += 1;
  });
  push('/e-approval/reports');
  noteNavigation('/e-approval/reports');
  push('/e-approval/reports/aging');
  stop();
  push('/e-approval');
  assert.equal(calls, 2);
});
