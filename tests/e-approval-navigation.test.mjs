import test from 'node:test';
import assert from 'node:assert/strict';
import {
  eApprovalBackButtonText,
  eApprovalBackLabel,
  eApprovalHomeList,
  eApprovalRequestHref,
  eApprovalReturnToFromSearch,
  isEApprovalBackDestination,
  resolveEApprovalBack,
  safeEApprovalReturnTo,
  withEApprovalReturnTo,
} from '../src/lib/e-approval-navigation.ts';

/* ── returnTo ─────────────────────────────────────────────────────────────────────────────────── */

test('returnTo: in-app paths only', () => {
  assert.equal(safeEApprovalReturnTo('/e-approval/all'), '/e-approval/all');
  assert.equal(safeEApprovalReturnTo('  /e-approval/inbox  '), '/e-approval/inbox');
  assert.equal(safeEApprovalReturnTo('/recurring-payments/abc?tab=2'), '/recurring-payments/abc?tab=2');
  for (const unsafe of ['https://evil.example', '//evil.example/x', '/\\evil.example', 'e-approval/all', '', null, undefined, '/a\nb']) {
    assert.equal(safeEApprovalReturnTo(unsafe), null, String(unsafe));
  }
});

test('returnTo: added to a link, encoded, and never pointing at the page itself', () => {
  assert.equal(eApprovalRequestHref('A1', '/e-approval/all'), '/e-approval/A1?returnTo=%2Fe-approval%2Fall');
  assert.equal(eApprovalRequestHref('A1', null), '/e-approval/A1');
  assert.equal(eApprovalRequestHref('A1', 'https://evil.example'), '/e-approval/A1');
  assert.equal(withEApprovalReturnTo('/e-approval/A1/edit?x=1', '/e-approval/all'), '/e-approval/A1/edit?x=1&returnTo=%2Fe-approval%2Fall');
  assert.equal(withEApprovalReturnTo('/e-approval/A1#top', '/e-approval/all'), '/e-approval/A1?returnTo=%2Fe-approval%2Fall#top');
  assert.equal(withEApprovalReturnTo('/e-approval/A1', '/e-approval/A1?returnTo=%2Fx'), '/e-approval/A1');
});

test('returnTo: read back from the query string it was written to', () => {
  const href = eApprovalRequestHref('A1', '/e-approval/reports/aging');
  assert.equal(eApprovalReturnToFromSearch(href.slice(href.indexOf('?'))), '/e-approval/reports/aging');
  assert.equal(eApprovalReturnToFromSearch('?returnTo=https%3A%2F%2Fevil.example'), null);
  assert.equal(eApprovalReturnToFromSearch(''), null);
});

/* ── destinations and labels ──────────────────────────────────────────────────────────────────── */

test('a back arrow never leads into a form, or into a page beneath the one it leaves', () => {
  assert.equal(isEApprovalBackDestination('/e-approval/create', '/e-approval/A1'), false);
  assert.equal(isEApprovalBackDestination('/e-approval/B2/edit', '/e-approval/A1'), false);
  assert.equal(isEApprovalBackDestination('/e-approval/A1/print', '/e-approval/A1'), false);
  assert.equal(isEApprovalBackDestination('/e-approval/A1?returnTo=%2Fx', '/e-approval/A1'), false);
  assert.equal(isEApprovalBackDestination('/e-approval/A1?returnTo=%2Fx', '/e-approval/A1/edit'), true);
  assert.equal(isEApprovalBackDestination('/e-approval/copied-to-me', '/e-approval/A1'), true);
  assert.equal(isEApprovalBackDestination('/recurring-payments/x', '/e-approval/A1'), true);
});

test('labels name the page the arrow leads to', () => {
  assert.equal(eApprovalBackLabel('/e-approval'), 'Dashboard');
  assert.equal(eApprovalBackLabel('/e-approval/inbox'), 'My Inbox');
  assert.equal(eApprovalBackLabel('/e-approval/all'), 'All Approvals');
  assert.equal(eApprovalBackLabel('/e-approval/copied-to-me'), 'Copied to Me');
  assert.equal(eApprovalBackLabel('/e-approval/reports/aging'), 'Reports');
  assert.equal(eApprovalBackLabel('/e-approval/settings/types'), 'Settings');
  assert.equal(eApprovalBackLabel('/e-approval/A1?returnTo=%2Fe-approval%2Fall'), 'Back to the approval');
  assert.equal(eApprovalBackLabel('/recurring-payments/x'), 'Back');
  assert.equal(eApprovalBackButtonText('My Inbox'), 'Back to My Inbox');
  assert.equal(eApprovalBackButtonText('Back to the approval'), 'Back to the approval');
  assert.equal(eApprovalBackButtonText('Back'), 'Back');
});

/* ── which destination wins ───────────────────────────────────────────────────────────────────── */

test('the page it was opened from wins, and is reached by going back', () => {
  const back = resolveEApprovalBack({
    leaving: '/e-approval/A1',
    origin: '/e-approval/copied-to-me',
    returnTo: '/e-approval/all',
    fallback: '/e-approval/inbox',
  });
  assert.deepEqual(back, { href: '/e-approval/copied-to-me', label: 'Copied to Me', viaHistory: true });
});

test('without a usable origin, returnTo; without either, the fallback — both by navigating', () => {
  assert.deepEqual(
    resolveEApprovalBack({ leaving: '/e-approval/A1', origin: null, returnTo: '/e-approval/all', fallback: '/e-approval/inbox' }),
    { href: '/e-approval/all', label: 'All Approvals', viaHistory: false },
  );
  // An origin that is a form (the request was just submitted from it) does not count.
  assert.deepEqual(
    resolveEApprovalBack({ leaving: '/e-approval/A1', origin: '/e-approval/create', returnTo: null, fallback: '/e-approval/drafts' }),
    { href: '/e-approval/drafts', label: 'Drafts', viaHistory: false },
  );
  // Nor does a returnTo pointing below the page being left.
  assert.deepEqual(
    resolveEApprovalBack({ leaving: '/e-approval/A1', origin: null, returnTo: '/e-approval/A1/print', fallback: '/e-approval' }),
    { href: '/e-approval', label: 'Dashboard', viaHistory: false },
  );
});

/* ── the list a request belongs in ────────────────────────────────────────────────────────────── */

const actor = (userId, extra = {}) => ({ userId, name: userId, ...extra });
const request = (extra = {}) => ({ id: 'A1', status: 'Pending', requesterId: 'req', ...extra });

test('home list: a draft is under Drafts for its requester', () => {
  assert.equal(eApprovalHomeList(request({ status: 'Draft' }), [], { actor: actor('req') }), '/e-approval/drafts');
  assert.equal(eApprovalHomeList(request({ status: 'Draft' }), [], { actor: actor('admin'), canViewAll: true }), '/e-approval/all');
});

test('home list: a file waiting on you is in your inbox — by name, department or delegation', () => {
  assert.equal(eApprovalHomeList(request({ currentAssigneeIds: ['ap1'] }), [], { actor: actor('ap1') }), '/e-approval/inbox');
  assert.equal(
    eApprovalHomeList(request({ currentDepartmentIds: ['fin'] }), [], { actor: actor('ap2', { departmentIds: ['fin'] }) }),
    '/e-approval/inbox',
  );
  // Returned to its requester: waiting on them, so their inbox, not Created by Me.
  assert.equal(
    eApprovalHomeList(request({ status: 'Returned', currentAssigneeIds: ['req'] }), [], { actor: actor('req') }),
    '/e-approval/inbox',
  );
  // A closed file is never "waiting", whatever the stale pointer says.
  assert.equal(
    eApprovalHomeList(request({ status: 'Approved', currentAssigneeIds: ['ap1'] }), [], { actor: actor('ap1') }),
    '/e-approval',
  );
});

test('home list: requester, CC reader, past approver, register viewer, anybody else', () => {
  assert.equal(eApprovalHomeList(request({ status: 'Approved' }), [], { actor: actor('req') }), '/e-approval/created-by-me');
  assert.equal(eApprovalHomeList(request({ ccUserIds: ['cc1'] }), [], { actor: actor('cc1') }), '/e-approval/copied-to-me');
  assert.equal(
    eApprovalHomeList(request({ participantUserIds: ['cc2'] }), [], { actor: actor('cc2') }),
    '/e-approval/copied-to-me',
  );
  assert.equal(
    eApprovalHomeList(request({ status: 'Approved' }), [{ actedByUserId: 'ap1', assignment: { kind: 'User', userId: 'ap1' } }], {
      actor: actor('ap1'),
    }),
    '/e-approval/my-activity',
  );
  assert.equal(eApprovalHomeList(request(), [], { actor: actor('md'), canViewAll: true }), '/e-approval/all');
  assert.equal(eApprovalHomeList(request(), [], { actor: actor('someone') }), '/e-approval');
  assert.equal(eApprovalHomeList(request(), [], { actor: null }), '/e-approval');
});
