import test from 'node:test';
import assert from 'node:assert/strict';

import { executeSend, planSendAttempt } from '../src/lib/mail-hub/send-engine.ts';
import { buildOutgoingContent, normalizeComposeRequest, validateSchedule } from '../src/lib/mail-hub/compose.ts';
import { buildRawMessage, envelopeOf, stripBccHeader } from '../src/lib/mail-hub/mime.ts';
import { quotedBlock, replyRecipients, replySubject, forwardSubject } from '../src/lib/mail-hub/rules.ts';
import { ProviderRateLimitError, ProviderUnavailableError } from '../src/lib/mail-hub/providers/types.ts';
import { manualClock } from './mail-hub-fakes.mjs';

function outbound(overrides = {}) {
  return {
    id: 'o1',
    ownerUserId: 'u1',
    ownerName: 'Asha',
    accountId: 'acc1',
    sharedMailboxId: null,
    fromAddress: 'asha@sel.in',
    fromName: 'Asha',
    to: [{ name: null, address: 'ben@vendor.com' }],
    cc: [],
    bcc: [],
    subject: 'PO 1042',
    html: '<p>Please confirm.</p>',
    text: 'Please confirm.',
    attachments: [],
    mode: 'new',
    sourceMessageId: null,
    threadId: null,
    providerThreadId: null,
    inReplyTo: null,
    references: [],
    messageIdHeader: '<erp.o1.abc@sel.in>',
    status: 'queued',
    scheduledAt: null,
    attempts: 0,
    leaseUntil: null,
    lastError: null,
    providerMessageId: null,
    providerDraftId: null,
    sentAt: null,
    aiAssisted: false,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

/** A store with a real compare-and-set, and a provider whose Sent folder is inspectable. */
function harness(initial, clock) {
  const state = { outbound: { ...initial } };
  const sentFolder = [];
  const store = {
    async claimOutbound(id, now, leaseMs) {
      const plan = planSendAttempt(state.outbound, now);
      if (plan !== 'send' && plan !== 'verify-then-send') return { outbound: { ...state.outbound }, plan };
      state.outbound = { ...state.outbound, status: 'sending', attempts: state.outbound.attempts + 1, leaseUntil: new Date(now.getTime() + leaseMs).toISOString() };
      return { outbound: { ...state.outbound }, plan };
    },
    async markOutbound(id, patch) {
      state.outbound = { ...state.outbound, ...patch };
    },
  };
  const adapter = {
    sends: 0,
    failWith: null,
    async send(input) {
      if (this.failWith) {
        const error = this.failWith;
        this.failWith = null;
        throw error;
      }
      this.sends += 1;
      sentFolder.push(input.messageIdHeader);
      return { providerMessageId: `p${this.sends}` };
    },
    async findSentByMessageId(id) {
      return sentFolder.includes(id);
    },
  };
  const deps = {
    store,
    adapterFor: async () => adapter,
    buildRaw: async () => new Uint8Array([1]),
    authorize: async () => ({ ok: true }),
    now: clock,
  };
  return { state, adapter, deps, sentFolder };
}

test('a message is sent once and recorded as sent', async () => {
  const { state, adapter, deps } = harness(outbound(), manualClock());
  const result = await executeSend(deps, 'o1');
  assert.equal(result.status, 'sent');
  assert.equal(adapter.sends, 1);
  assert.equal(state.outbound.status, 'sent');
  const again = await executeSend(deps, 'o1');
  assert.equal(again.status, 'skipped');
  assert.equal(adapter.sends, 1);
});

test('a retry after a crash that happened after the provider accepted the send does not send again', async () => {
  const clock = manualClock();
  const { state, adapter, deps } = harness(outbound(), clock);
  // The first attempt reaches the provider, then the process dies before recording success.
  const original = deps.store.markOutbound;
  deps.store.markOutbound = async (id, patch) => {
    if (patch.status === 'sent') throw new Error('process killed');
    return original(id, patch);
  };
  await assert.rejects(executeSend(deps, 'o1'));
  assert.equal(adapter.sends, 1);
  assert.equal(state.outbound.status, 'sending', 'left holding the lease');

  deps.store.markOutbound = original;
  assert.equal((await executeSend(deps, 'o1')).status, 'skipped', 'the live lease blocks a concurrent attempt');

  clock.advance(4 * 60_000);
  const recovered = await executeSend(deps, 'o1');
  assert.equal(recovered.status, 'duplicate-prevented');
  assert.equal(adapter.sends, 1, 'the customer received exactly one email');
  assert.equal(state.outbound.status, 'sent');
});

test('a transient failure requeues; the retry verifies first and then sends', async () => {
  const { state, adapter, deps } = harness(outbound(), manualClock());
  adapter.failWith = new ProviderRateLimitError(45_000);
  const first = await executeSend(deps, 'o1');
  assert.deepEqual(first, { status: 'retry', error: first.error, retryAfterMs: 45_000 });
  assert.equal(state.outbound.status, 'queued');
  assert.equal(planSendAttempt(state.outbound, new Date()), 'verify-then-send');

  const second = await executeSend(deps, 'o1');
  assert.equal(second.status, 'sent');
  assert.equal(adapter.sends, 1);
});

test('a permanent failure is recorded and not retried', async () => {
  const { state, adapter, deps } = harness(outbound(), manualClock());
  adapter.failWith = new Error('550 mailbox unavailable');
  const result = await executeSend(deps, 'o1');
  assert.equal(result.status, 'failed');
  assert.equal(state.outbound.status, 'failed');
  assert.equal(state.outbound.lastError, '550 mailbox unavailable');
  adapter.failWith = new ProviderUnavailableError();
  assert.equal(planSendAttempt(state.outbound, new Date()), 'verify-then-send', 'a manual retry would still verify first');
});

test('scheduled sends wait for their time, can be cancelled, and re-check authorization when due', async () => {
  const clock = manualClock();
  const at = new Date(clock().getTime() + 3_600_000).toISOString();
  const { state, adapter, deps } = harness(outbound({ status: 'scheduled', scheduledAt: at }), clock);
  assert.equal((await executeSend(deps, 'o1')).status, 'skipped');
  assert.equal(adapter.sends, 0);

  clock.advance(3_600_000);
  deps.authorize = async () => ({ ok: false, reason: 'You are no longer a member of this shared mailbox.' });
  const denied = await executeSend(deps, 'o1');
  assert.equal(denied.status, 'failed');
  assert.equal(adapter.sends, 0);
  assert.match(state.outbound.lastError, /no longer a member/);

  const cancelled = harness(outbound({ status: 'cancelled', scheduledAt: at }), clock);
  assert.deepEqual(await executeSend(cancelled.deps, 'o1'), { status: 'skipped', plan: 'cancelled' });
});

/* ── compose: what can reach an outgoing message ─────────────────────────────────────────── */

test('a compose request cannot smuggle internal notes or ERP fields into the message', () => {
  const result = normalizeComposeRequest({
    accountId: 'acc1',
    fromAddress: 'Asha@SEL.in',
    to: 'Ben <ben@vendor.com>, ben@vendor.com',
    subject: 'Re: PO\r\nBcc: attacker@evil.com',
    bodyHtml: '<p>Thanks</p>',
    mode: 'reply',
    sourceMessageId: 'acc1__mabc',
    internalNotes: 'Vendor is on credit hold — do not tell them',
    notes: [{ body: 'secret' }],
    html: '<p>override</p>',
    messageIdHeader: '<forged@x>',
    assignment: { assigneeId: 'u9' },
  });
  assert.equal(result.ok, true);
  const value = result.value;
  assert.deepEqual(Object.keys(value).sort(), [
    'accountId', 'aiAssisted', 'bcc', 'bodyHtml', 'cc', 'fromAddress', 'includeQuote', 'mode', 'outboundId',
    'scheduledAt', 'sharedMailboxId', 'signatureId', 'sourceMessageId', 'subject', 'to', 'uploadIds',
  ]);
  assert.equal(value.to.length, 1, 'duplicate recipient collapsed');
  assert.equal(value.fromAddress, 'asha@sel.in');
  assert.equal(value.subject.includes('\n'), false, 'header injection through the subject is flattened');
  const serialized = JSON.stringify(value);
  assert.equal(serialized.includes('credit hold'), false);
  assert.equal(serialized.includes('forged'), false);

  const content = buildOutgoingContent({ bodyHtml: value.bodyHtml, signatureHtml: '<b>Asha</b>', quotedHtml: '<p>original</p>' });
  assert.equal(content.html.includes('credit hold'), false);
  assert.ok(content.html.indexOf('Asha') < content.html.indexOf('original'), 'signature sits above the quote');
});

test('invalid addresses and a missing source message are reported', () => {
  const result = normalizeComposeRequest({ accountId: 'acc1', to: 'not-an-address', mode: 'forward' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /not valid/.test(error)));
  assert.ok(result.errors.some((error) => /being answered/.test(error)));
});

test('outgoing HTML is sanitised but carries no ERP bookkeeping', () => {
  const { html } = buildOutgoingContent({ bodyHtml: '<p onclick="x()">Hi <a href="https://vendor.com">vendor.com</a></p><script>alert(1)</script>', signatureHtml: null, quotedHtml: null });
  assert.equal(/onclick|script/.test(html), false);
  assert.equal(/data-original-href|\/mail\/link/.test(html), false);
  assert.match(html, /href="https:\/\/vendor.com"/);
});

test('schedule validation', () => {
  const now = new Date('2026-09-24T09:00:00.000Z');
  assert.equal(validateSchedule(null, now), null);
  assert.match(validateSchedule('2026-09-24T09:00:30.000Z', now), /minute/);
  assert.match(validateSchedule('2028-01-01T00:00:00.000Z', now), /year/);
  assert.equal(validateSchedule('2026-09-25T09:00:00.000Z', now), null);
});

/* ── reply construction ──────────────────────────────────────────────────────────────────── */

test('reply-all excludes every address of ours and never the Bcc', () => {
  const message = {
    direction: 'inbound',
    from: { name: 'Ben', address: 'ben@vendor.com' },
    to: [{ name: 'Asha', address: 'asha@sel.in' }, { name: 'Ravi', address: 'ravi@sel.in' }],
    cc: [{ name: null, address: 'ACCOUNTS@sel.in' }, { name: null, address: 'ben@vendor.com' }],
    replyTo: [],
    bcc: [{ name: null, address: 'hidden@sel.in' }],
  };
  const all = replyRecipients(message, ['asha@sel.in', 'accounts@sel.in'], 'replyAll');
  assert.deepEqual(all.to.map((entry) => entry.address), ['ben@vendor.com']);
  assert.deepEqual(all.cc.map((entry) => entry.address), ['ravi@sel.in']);
  const one = replyRecipients({ ...message, replyTo: [{ name: null, address: 'noreply-handler@vendor.com' }] }, ['asha@sel.in'], 'reply');
  assert.deepEqual(one.to.map((entry) => entry.address), ['noreply-handler@vendor.com']);
  const own = replyRecipients({ ...message, direction: 'outbound', from: { name: 'Asha', address: 'asha@sel.in' } }, ['asha@sel.in'], 'reply');
  assert.deepEqual(own.to.map((entry) => entry.address), ['ravi@sel.in'], 'replying to your own sent mail goes to its recipients');
  assert.equal(replySubject('RE: Fwd: AW: Quote'), 'Re: Quote');
  assert.equal(forwardSubject('Quote'), 'Fwd: Quote');
});

test('the quoted block escapes header values and is built from the message only', () => {
  const block = quotedBlock(
    { from: { name: '<img src=x onerror=1>', address: 'x@y.com' }, to: [], cc: [], subject: 'S', sentAt: '2026-09-20T10:00:00.000Z', receivedAt: '2026-09-20T10:00:00.000Z' },
    '<p>body</p>',
    'reply',
  );
  assert.equal(block.includes('<img src=x'), false);
  assert.ok(block.includes('&lt;img'));
});

/* ── MIME ────────────────────────────────────────────────────────────────────────────────── */

test('the SMTP path transmits no Bcc header but delivers to Bcc recipients', async () => {
  const raw = await buildRawMessage({
    from: { name: 'Asha', address: 'asha@sel.in' },
    to: [{ name: null, address: 'ben@vendor.com' }],
    cc: [],
    bcc: [{ name: null, address: 'audit@sel.in' }],
    subject: 'Re: Invoice',
    html: '<p>Hi</p>',
    messageId: '<erp.o1.abc@sel.in>',
    inReplyTo: '<orig@vendor.com>',
    references: ['<root@vendor.com>', '<orig@vendor.com>'],
    keepBcc: true,
  });
  const text = raw.toString();
  assert.match(text, /^Message-ID: <erp\.o1\.abc@sel\.in>$/m);
  assert.match(text, /^In-Reply-To: <orig@vendor\.com>$/m);
  assert.match(text, /^Bcc: audit@sel\.in$/m, 'kept for Gmail/Graph, which need it to deliver');
  const transmitted = stripBccHeader(raw).toString();
  assert.equal(/^Bcc:/im.test(transmitted), false);
  assert.deepEqual(envelopeOf(raw).to.sort(), ['audit@sel.in', 'ben@vendor.com']);
});
