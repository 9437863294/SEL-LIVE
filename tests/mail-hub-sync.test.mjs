import test from 'node:test';
import assert from 'node:assert/strict';

import { runMailSync } from '../src/lib/mail-hub/sync-engine.ts';
import { messageDocId } from '../src/lib/mail-hub/rules.ts';
import { FakeGmailAdapter, FakeGraphAdapter, MemoryStore, makeAccount, manualClock, providerMessage } from './mail-hub-fakes.mjs';

const days = (n) => new Date(Date.parse('2026-09-24T09:00:00.000Z') - n * 86_400_000).toISOString();

function seeded(count) {
  return Array.from({ length: count }, (_, i) => providerMessage(`m${i + 1}`, { receivedAt: days(i % 30) }));
}

async function syncToCompletion(deps, accountId, maxRuns = 20) {
  const outcomes = [];
  for (let i = 0; i < maxRuns; i += 1) {
    const outcome = await runMailSync(deps, accountId);
    outcomes.push(outcome);
    if (outcome.result !== 'continue') return outcomes;
  }
  throw new Error('sync did not converge');
}

/* ── initial sync ────────────────────────────────────────────────────────────────────────── */

test('initial sync lists every page, records a cursor captured before listing, and goes active', async () => {
  const store = new MemoryStore(makeAccount());
  const adapter = new FakeGmailAdapter(seeded(250));
  const outcomes = await syncToCompletion({ store, adapter, pageSize: 100, now: manualClock() }, 'acc1');

  assert.equal(outcomes.at(-1).result, 'complete');
  assert.equal(store.live().length, 250);
  const account = store.accounts.get('acc1');
  assert.equal(account.status, 'active');
  assert.equal(account.sync.initialSyncComplete, true);
  assert.equal(account.sync.phase, 'incremental');
  assert.equal(account.sync.messagesSynced, 250);
  assert.equal(adapter.calls.listPage, 3);
  assert.equal([...store.cursors.values()].length, 1);
});

test('a run that exhausts its time budget resumes from the saved page instead of starting over', async () => {
  const store = new MemoryStore(makeAccount());
  const adapter = new FakeGmailAdapter(seeded(300));
  const clock = manualClock();
  // Every listing call costs 20 seconds of wall clock; the budget allows two per run.
  const original = adapter.listPage.bind(adapter);
  adapter.listPage = async (input) => {
    clock.advance(20_000);
    return original(input);
  };
  const deps = { store, adapter, pageSize: 100, budgetMs: 35_000, now: clock };

  const first = await runMailSync(deps, 'acc1');
  assert.equal(first.result, 'continue');
  const afterFirst = store.live().length;
  assert.ok(afterFirst >= 100 && afterFirst < 300);
  assert.ok(store.accounts.get('acc1').sync.listing.pageToken, 'listing position is saved');

  const rest = await syncToCompletion(deps, 'acc1');
  assert.equal(rest.at(-1).result, 'complete');
  assert.equal(store.live().length, 300);
  assert.equal(adapter.calls.listPage, 3, 'no page was listed twice');
});

test('mail that arrives while the first sync is listing is not lost', async () => {
  const store = new MemoryStore(makeAccount());
  const adapter = new FakeGmailAdapter(seeded(150));
  const original = adapter.listPage.bind(adapter);
  let delivered = false;
  adapter.listPage = async (input) => {
    const page = await original(input);
    if (!delivered) {
      delivered = true;
      // Arrives after the listing snapshot of page one, and is older-sorted out of later pages.
      adapter.deliver(providerMessage('late', { receivedAt: days(40) }));
    }
    return page;
  };
  await syncToCompletion({ store, adapter, pageSize: 100, now: manualClock() }, 'acc1');
  assert.ok(store.messages.has(messageDocId('acc1', 'late')), 'picked up by the first incremental pass');
});

/* ── incremental sync and idempotency ────────────────────────────────────────────────────── */

test('duplicate notifications and replayed pages converge on the same state', async () => {
  const store = new MemoryStore(makeAccount());
  const adapter = new FakeGmailAdapter(seeded(5));
  const deps = { store, adapter, now: manualClock() };
  await syncToCompletion(deps, 'acc1');

  adapter.deliver(providerMessage('new1', { threadId: 't-m1' }));
  await runMailSync(deps, 'acc1');
  const snapshot = JSON.stringify([...store.messages.values()].map(({ syncedAt, ...rest }) => rest));

  // The same notification delivered three more times: three more syncs with nothing new.
  for (let i = 0; i < 3; i += 1) await runMailSync(deps, 'acc1');
  assert.equal(JSON.stringify([...store.messages.values()].map(({ syncedAt, ...rest }) => rest)), snapshot);

  // Replaying an old cursor (a crash between apply and cursor save) re-applies without duplication.
  const cursor = [...store.cursors.values()][0];
  store.cursors.set(cursor.id, { ...cursor, value: '100' });
  await runMailSync(deps, 'acc1');
  assert.equal(store.live().length, 6);
  const thread = store.threads.get(store.messages.get(messageDocId('acc1', 'new1')).threadId);
  assert.equal(thread.messageCount, 2, 'the reply joined the existing conversation');
});

test('label changes, reads and deletions flow through incremental sync', async () => {
  const store = new MemoryStore(makeAccount());
  const adapter = new FakeGmailAdapter(seeded(3));
  const deps = { store, adapter, now: manualClock() };
  await syncToCompletion(deps, 'acc1');

  adapter.change('m1', { labels: [], isRead: true }); // archived and read
  adapter.remove('m2');
  await runMailSync(deps, 'acc1');

  const m1 = store.messages.get(messageDocId('acc1', 'm1'));
  assert.equal(m1.isRead, true);
  assert.ok(m1.viewKeys.some((key) => key.endsWith(':r:archive')), 'archived = in All Mail but not the inbox');
  assert.ok(!m1.viewKeys.some((key) => key.endsWith(':r:inbox')));
  assert.equal(store.messages.get(messageDocId('acc1', 'm2')).deleted, true);
  assert.equal(store.threads.get(store.messages.get(messageDocId('acc1', 'm2')).threadId).deleted, true);
});

/* ── recovery ────────────────────────────────────────────────────────────────────────────── */

test('an expired cursor triggers a recovery listing that tombstones what vanished meanwhile', async () => {
  const store = new MemoryStore(makeAccount());
  const adapter = new FakeGmailAdapter(seeded(10));
  const deps = { store, adapter, now: manualClock() };
  await syncToCompletion(deps, 'acc1');

  // While the ERP could not see changes: two messages deleted, one delivered, history discarded.
  adapter.mailbox.delete('m3');
  adapter.mailbox.delete('m4');
  adapter.mailbox.set('fresh', providerMessage('fresh'));
  adapter.expireHistory();

  const outcomes = await syncToCompletion(deps, 'acc1');
  assert.equal(outcomes[0].result, 'continue', 'the expiry switches to recovery rather than failing');
  assert.equal(outcomes.at(-1).result, 'complete');
  assert.equal(store.messages.get(messageDocId('acc1', 'm3')).deleted, true);
  assert.equal(store.messages.get(messageDocId('acc1', 'm4')).deleted, true);
  assert.equal(store.messages.get(messageDocId('acc1', 'fresh')).deleted, false);
  assert.equal(store.live().length, 9);
  const account = store.accounts.get('acc1');
  assert.equal(account.sync.phase, 'incremental');
  assert.equal(account.sync.generation, 2);
});

/* ── moves ───────────────────────────────────────────────────────────────────────────────── */

async function graphMoveScenario(order) {
  const store = new MemoryStore(makeAccount({ provider: 'microsoft' }));
  const adapter = new FakeGraphAdapter();
  adapter.put(providerMessage('g1'), 'inbox-id');
  const deps = { store, adapter, now: manualClock() };
  await syncToCompletion(deps, 'acc1');

  adapter.put(providerMessage('g1'), 'archive-id');
  const removal = { kind: 'remove', stableKey: 'g1', scope: { folder: 'inbox-id' } };
  const arrival = { kind: 'upsert', header: adapter.header(adapter.mailbox.get('g1')), scope: 'authoritative' };
  if (order === 'removal-first') {
    adapter.queue('inbox-id', removal);
    adapter.queue('archive-id', arrival);
  } else {
    // Archive's delta is walked after Inbox's, so an arrival-first move is modelled by the arrival
    // coming in an earlier run.
    adapter.queue('archive-id', arrival);
    await runMailSync(deps, 'acc1');
    adapter.queue('inbox-id', removal);
  }
  await runMailSync(deps, 'acc1');
  return store;
}

for (const order of ['removal-first', 'arrival-first']) {
  test(`a Graph move (${order}) keeps the message and its identity`, async () => {
    const store = await graphMoveScenario(order);
    const message = store.messages.get(messageDocId('acc1', 'g1'));
    assert.equal(message.deleted, false);
    assert.equal(message.folderIds.length, 1);
    assert.ok(message.viewKeys.some((key) => key.endsWith(':r:archive')));
    assert.ok(!message.viewKeys.some((key) => key.endsWith(':r:inbox')));
  });
}

/* ── failures ────────────────────────────────────────────────────────────────────────────── */

test('a rate limit backs off with the provider delay and keeps what was already applied', async () => {
  const store = new MemoryStore(makeAccount());
  const adapter = new FakeGmailAdapter(seeded(150));
  const clock = manualClock();
  const deps = { store, adapter, pageSize: 100, now: clock };
  const original = adapter.listPage.bind(adapter);
  let calls = 0;
  adapter.listPage = async (input) => {
    calls += 1;
    if (calls === 2) adapter.failNext = 'rate';
    return original(input);
  };
  const outcome = await runMailSync(deps, 'acc1');
  assert.equal(outcome.result, 'backoff');
  assert.equal(outcome.retryAfterMs, 30_000);
  assert.equal(store.live().length, 100, 'page one stays applied');
  const account = store.accounts.get('acc1');
  assert.equal(account.sync.consecutiveFailures, 0, 'rate limits are not counted as failures');
  assert.equal(account.status, 'connecting');

  const rest = await syncToCompletion(deps, 'acc1');
  assert.equal(rest.at(-1).result, 'complete');
  assert.equal(store.live().length, 150);
});

test('messages whose fetch failed are retried on the next run instead of being lost', async () => {
  const store = new MemoryStore(makeAccount());
  const adapter = new FakeGmailAdapter(seeded(4));
  adapter.failHeaderFor.add('m2');
  const deps = { store, adapter, now: manualClock() };
  await syncToCompletion(deps, 'acc1');
  assert.equal(store.live().length, 3);
  assert.deepEqual(store.accounts.get('acc1').sync.pendingRefetch, ['m2']);

  adapter.failHeaderFor.clear();
  await runMailSync(deps, 'acc1');
  assert.equal(store.live().length, 4);
  assert.deepEqual(store.accounts.get('acc1').sync.pendingRefetch, []);
});

test('repeated provider errors degrade the account to error with a retry time, then recover', async () => {
  const store = new MemoryStore(makeAccount({ status: 'active' }));
  const adapter = new FakeGmailAdapter(seeded(2));
  const deps = { store, adapter, now: manualClock(), random: () => 0.5 };
  await syncToCompletion(deps, 'acc1');
  for (let i = 0; i < 3; i += 1) {
    adapter.failNext = 'boom';
    const outcome = await runMailSync(deps, 'acc1');
    assert.equal(outcome.result, 'backoff');
  }
  let account = store.accounts.get('acc1');
  assert.equal(account.status, 'error');
  assert.equal(account.sync.consecutiveFailures, 3);
  assert.ok(account.sync.nextAttemptAt);

  await runMailSync(deps, 'acc1');
  account = store.accounts.get('acc1');
  assert.equal(account.status, 'active');
  assert.equal(account.sync.consecutiveFailures, 0);
});

test('a revoked grant stops syncing and asks the user to reconnect', async () => {
  const store = new MemoryStore(makeAccount({ status: 'active' }));
  const adapter = new FakeGmailAdapter(seeded(2));
  const deps = { store, adapter, now: manualClock() };
  await syncToCompletion(deps, 'acc1');
  adapter.failNext = 'auth';
  const outcome = await runMailSync(deps, 'acc1');
  assert.equal(outcome.result, 'reauth');
  assert.equal(store.accounts.get('acc1').status, 'reauth_required');
  // And later runs do not hammer the provider.
  const again = await runMailSync(deps, 'acc1');
  assert.equal(again.result, 'reauth');
});

test('disconnecting mid-sync stops the run before it writes more', async () => {
  const store = new MemoryStore(makeAccount());
  const adapter = new FakeGmailAdapter(seeded(300));
  let reads = 0;
  store.onGetAccount = (self) => {
    reads += 1;
    // Read 1 loads the account, read 2 precedes page one; by read 3 the user has pressed Disconnect.
    if (reads === 3) self.accounts.set('acc1', { ...self.accounts.get('acc1'), status: 'disconnected' });
  };
  const outcome = await runMailSync({ store, adapter, pageSize: 100, now: manualClock() }, 'acc1');
  assert.equal(outcome.result, 'disconnected');
  assert.ok(store.live().length <= 100);
});

/* ── shared mailbox routing ──────────────────────────────────────────────────────────────── */

test('new inbound mail in a shared mailbox is routed, given a deadline, and announced once', async () => {
  const sharedMailboxes = [
    { id: 'sm1', name: 'Accounts', address: 'accounts@sel.in', provider: 'gmail', accountId: 'acc1', departmentId: 'finance', departmentName: 'Finance', responseHours: 8, active: true },
  ];
  const rules = [
    {
      id: 'r1',
      sharedMailboxId: 'sm1',
      name: 'Invoices to Ben',
      enabled: true,
      order: 1,
      conditions: { fromContains: null, subjectContains: 'invoice', toContains: null },
      actions: { assignToUserId: 'u2', assignToUserName: 'Ben', deadlineHours: 4 },
    },
  ];
  const store = new MemoryStore(makeAccount({ kind: 'shared', emailAddress: 'accounts@sel.in' }), { sharedMailboxes, rules });
  const adapter = new FakeGmailAdapter([providerMessage('old', { subject: 'Invoice 1' })]);
  const deps = { store, adapter, now: manualClock() };
  const initial = await syncToCompletion(deps, 'acc1');
  assert.equal(initial.flatMap((outcome) => outcome.events).length, 0, 'historical mail is not routed');

  adapter.deliver(providerMessage('inv', { subject: 'Invoice 2041 overdue', receivedAt: '2026-09-24T08:00:00.000Z' }));
  adapter.deliver(providerMessage('hello', { subject: 'Hello', receivedAt: '2026-09-24T08:30:00.000Z' }));
  const outcome = await runMailSync(deps, 'acc1');

  assert.equal(outcome.events.length, 1);
  assert.equal(outcome.events[0].assigneeId, 'u2');
  const invoice = store.threads.get(store.messages.get(messageDocId('acc1', 'inv')).threadId);
  assert.equal(invoice.assignment.assigneeId, 'u2');
  assert.equal(invoice.assignment.dueAt, '2026-09-24T12:00:00.000Z');
  assert.equal(invoice.sharedMailboxId, 'sm1');
  const hello = store.threads.get(store.messages.get(messageDocId('acc1', 'hello')).threadId);
  assert.equal(hello.assignment.assigneeId, null, 'no rule matched: unassigned, but with the mailbox deadline');
  assert.equal(hello.assignment.dueAt, '2026-09-24T16:30:00.000Z');

  // A second sync with nothing new announces nothing.
  const quiet = await runMailSync(deps, 'acc1');
  assert.equal(quiet.events.length, 0);

  // Closing the thread and receiving a follow-up reopens it for the same assignee.
  store.threads.set(invoice.id, { ...invoice, assignment: { ...invoice.assignment, status: 'closed' } });
  adapter.deliver(providerMessage('inv2', { threadId: 't-inv', subject: 'Re: Invoice 2041 overdue', receivedAt: '2026-09-24T09:00:00.000Z' }));
  const reopened = await runMailSync(deps, 'acc1');
  assert.equal(store.threads.get(invoice.id).assignment.status, 'open');
  assert.equal(reopened.events[0]?.assigneeId, 'u2');
});
