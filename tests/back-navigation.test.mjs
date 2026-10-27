import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hrefPath,
  isBackDestination,
  isFormPath,
  resolveBack,
  returnToFromSearch,
  safeReturnTo,
  withReturnTo,
} from '../src/lib/back-navigation.ts';

test('returnTo: in-app paths only, carried encoded, never to the page itself', () => {
  assert.equal(safeReturnTo('/hr/settings'), '/hr/settings');
  for (const unsafe of ['https://evil.example', '//evil.example', '/\\evil', 'settings', '', null]) {
    assert.equal(safeReturnTo(unsafe), null, String(unsafe));
  }
  assert.equal(
    withReturnTo('/settings/access-management/roles/new', '/settings/access-management?tab=roles'),
    '/settings/access-management/roles/new?returnTo=%2Fsettings%2Faccess-management%3Ftab%3Droles',
  );
  assert.equal(withReturnTo('/settings/profile', '/settings/profile?x=1'), '/settings/profile');
  assert.equal(returnToFromSearch('?returnTo=%2Fexpenses%2Fsettings'), '/expenses/settings');
  assert.equal(returnToFromSearch('?returnTo=%2F%2Fevil.example'), null);
});

test('paths: the query, the hash and a trailing slash do not count', () => {
  assert.equal(hrefPath('/settings/access-management?tab=users#x'), '/settings/access-management');
  assert.equal(hrefPath('/settings/'), '/settings');
  assert.equal(hrefPath('/'), '/');
});

test('a back arrow never leads into a form, or to the page it is on', () => {
  assert.equal(isFormPath('/settings/access-management/users/new'), true);
  assert.equal(isFormPath('/e-approval/create?x=1'), true);
  assert.equal(isFormPath('/e-approval/A1/edit'), true);
  assert.equal(isFormPath('/settings/access-management/roles/R1'), false);
  assert.equal(isBackDestination('/settings/access-management/users/new', '/settings/access-management'), false);
  assert.equal(isBackDestination('/settings/profile?tab=x', '/settings/profile'), false);
  // A page beneath the one being left is somewhere a person can have come from: a user's profile,
  // left for "Add access" on the Control Center.
  assert.equal(isBackDestination('/settings/access-management/users/U1', '/settings/access-management'), true);
  assert.equal(isBackDestination('/hr/settings', '/settings/department'), true);
});

test('the page it was opened from wins, and is reached by going back', () => {
  assert.deepEqual(
    resolveBack({ leaving: '/settings/department', origin: '/hr/settings', returnTo: '/x', fallback: '/settings' }),
    { href: '/hr/settings', viaHistory: true },
  );
});

test('without a usable origin, returnTo; without either, the fallback', () => {
  assert.deepEqual(
    resolveBack({ leaving: '/settings/project', origin: null, returnTo: '/site-account-statement/settings/projects', fallback: '/settings' }),
    { href: '/site-account-statement/settings/projects', viaHistory: false },
  );
  // A form left on the way here (a user just created) is not somewhere to go back to.
  assert.deepEqual(
    resolveBack({
      leaving: '/settings/access-management',
      origin: '/settings/access-management/users/new',
      returnTo: null,
      fallback: '/settings',
    }),
    { href: '/settings', viaHistory: false },
  );
  // A module's own rule replaces the shared one.
  assert.deepEqual(
    resolveBack({
      leaving: '/settings/access-management',
      origin: '/settings/access-management/users/U1',
      returnTo: null,
      fallback: '/settings',
      isDestination: () => false,
    }),
    { href: '/settings', viaHistory: false },
  );
});
