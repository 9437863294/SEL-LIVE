/**
 * Switch User on the server (src/lib/view-as-header.ts): whom a Fleet & Travel request is answered
 * as when an administrator is viewing as someone — and that viewing never writes.
 *
 * Run: npm run test:fleet
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { VIEW_AS_HEADER, viewAsDecision } from '../src/lib/view-as-header.ts';

const ask = (over = {}) => viewAsDecision({ callerUserId: 'admin', canSwitchUsers: true, target: 'ravi', method: 'GET', ...over });

test('without the header, or with the caller’s own id, the caller is answered as themselves', () => {
  assert.deepEqual(ask({ target: null }), { kind: 'self' });
  assert.deepEqual(ask({ target: '   ' }), { kind: 'self' });
  assert.deepEqual(ask({ target: 'admin' }), { kind: 'self' });
  // Even someone without Switch User is unaffected when nothing asks to view as another.
  assert.deepEqual(ask({ target: undefined, canSwitchUsers: false, method: 'POST' }), { kind: 'self' });
});

test('an administrator with Switch User reads as the user they switched to', () => {
  assert.deepEqual(ask(), { kind: 'view', userId: 'ravi' });
  assert.deepEqual(ask({ method: 'head' }), { kind: 'view', userId: 'ravi' });
  assert.deepEqual(ask({ target: ' ravi ' }), { kind: 'view', userId: 'ravi' });
  assert.equal(VIEW_AS_HEADER, 'x-view-as');
});

test('viewing never writes, and nobody without Switch User may view as another', () => {
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
    const decision = ask({ method });
    assert.equal(decision.kind, 'refuse', method);
    assert.equal(decision.status, 403);
    assert.match(decision.message, /switch back/);
  }
  const outsider = ask({ canSwitchUsers: false });
  assert.equal(outsider.kind, 'refuse');
  assert.match(outsider.message, /Switch User/);
});
