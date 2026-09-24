import test from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregateThread,
  applyTemplate,
  buildMailReport,
  deadlineState,
  dueFollowUpReminders,
  imapThreadRoot,
  matchRoutingRule,
  matchesSearch,
  messageSearchTokens,
  parseAddressList,
  parseReferences,
  parseSearchQuery,
  previewKind,
  recoveryAdvice,
  resolveImapPreset,
  retryDelayMs,
  safeMailReturnTo,
  validateAttachment,
  validateCompose,
  viewKeysFor,
} from '../src/lib/mail-hub/rules.ts';

test('address lists: quoted names with commas, semicolons, duplicates and junk', () => {
  const { addresses, invalid } = parseAddressList('"Kumar, Ravi" <Ravi@Vendor.com>; asha@sel.in, ASHA@sel.in, not an address, <bad@>');
  assert.deepEqual(addresses, [{ name: 'Kumar, Ravi', address: 'ravi@vendor.com' }, { name: null, address: 'asha@sel.in' }]);
  assert.deepEqual(invalid, ['not an address', '<bad@>']);
});

test('view keys: Gmail archive is "all mail, not inbox"; trash is never archive', () => {
  const roles = { f_all: 'all', f_inbox: 'inbox', f_trash: 'trash', f_label: 'custom' };
  const roleOf = (id) => roles[id] ?? null;
  assert.ok(viewKeysFor('a', ['f_all', 'f_label'], roleOf).includes('a:a:r:archive'));
  assert.ok(!viewKeysFor('a', ['f_all', 'f_inbox'], roleOf).includes('a:a:r:archive'));
  assert.ok(!viewKeysFor('a', ['f_trash'], roleOf).includes('a:a:r:archive'));
  assert.ok(viewKeysFor('a', ['f_label'], roleOf).includes('a:a:f:f_label'), 'custom folders are listable');
  assert.ok(viewKeysFor('a', ['f_inbox'], roleOf, { isFlagged: true }).includes('a:a:r:starred'));
});

test('threading without native ids follows the References root', () => {
  const original = imapThreadRoot({ messageId: '<root@x>', inReplyTo: null, references: [] });
  const reply = imapThreadRoot({ messageId: '<r2@x>', inReplyTo: '<r1@x>', references: parseReferences('<root@x> <r1@x>') });
  const early = imapThreadRoot({ messageId: '<r1@x>', inReplyTo: '<root@x>', references: [] });
  assert.equal(original, 'root@x');
  assert.equal(reply, 'root@x');
  assert.equal(early, 'root@x');
});

test('search: operators, prefix matching on the last word, and date bounds', () => {
  const message = {
    searchTokens: messageSearchTokens({ subject: 'Invoice 2041 for steel', snippet: 'Please pay', from: { name: 'Tata Steel', address: 'billing@tatasteel.com' }, to: [{ name: null, address: 'asha@sel.in' }], cc: [] }),
    from: { name: 'Tata Steel', address: 'billing@tatasteel.com' },
    to: [{ name: null, address: 'asha@sel.in' }],
    cc: [],
    hasAttachments: true,
    isRead: false,
    receivedAt: '2026-09-20T10:00:00.000Z',
  };
  assert.ok(matchesSearch(message, parseSearchQuery('invoice from:tatasteel has:attachment is:unread')));
  assert.ok(matchesSearch(message, parseSearchQuery('stee')), 'prefix of the last word');
  assert.ok(!matchesSearch(message, parseSearchQuery('invoice before:2026-09-01')));
  assert.ok(!matchesSearch(message, parseSearchQuery('invoice to:ravi')));
  assert.ok(message.searchTokens.includes('tatasteel.com'), 'domains are searchable');
});

test('attachments: executables, disguised names and oversize files are refused; SVG never previews', () => {
  const policy = { maxBytes: 10 * 1024 * 1024 };
  assert.equal(validateAttachment({ filename: 'po.pdf', contentType: 'application/pdf', size: 1000 }, policy).ok, true);
  assert.equal(validateAttachment({ filename: 'invoice.pdf.exe', contentType: 'application/pdf', size: 1000 }, policy).ok, false);
  assert.equal(validateAttachment({ filename: 'invoice‮fdp.exe', contentType: 'application/pdf', size: 1000 }, policy).ok, false);
  assert.equal(validateAttachment({ filename: 'macro.xlsm', contentType: 'application/vnd.ms-excel', size: 1000 }, policy).ok, false);
  assert.equal(validateAttachment({ filename: 'photo.jpg', contentType: 'application/x-msdownload', size: 1000 }, policy).ok, false);
  assert.equal(validateAttachment({ filename: 'big.zip', contentType: 'application/zip', size: 11 * 1024 * 1024 }, policy).ok, false);
  assert.equal(previewKind('image/svg+xml', 'logo.svg'), 'none');
  assert.equal(previewKind('text/html', 'page.html'), 'none');
  assert.equal(previewKind('application/pdf', 'po.pdf'), 'pdf');
});

test('deadlines and follow-up reminders', () => {
  const now = new Date('2026-09-24T09:00:00.000Z');
  const thread = (dueAt, awaitingReply = true, status = 'open') => ({ awaitingReply, assignment: { dueAt, status } });
  assert.equal(deadlineState(thread('2026-09-24T08:00:00.000Z'), now), 'overdue');
  assert.equal(deadlineState(thread('2026-09-24T10:00:00.000Z'), now, 120), 'due-soon');
  assert.equal(deadlineState(thread('2026-09-25T10:00:00.000Z'), now), 'on-track');
  assert.equal(deadlineState(thread('2026-09-24T08:00:00.000Z', false), now), 'answered', 'a reply clears the deadline');
  assert.equal(deadlineState(thread('2026-09-24T08:00:00.000Z', true, 'closed'), now), 'answered');

  const followUp = { dueAt: '2026-09-24T10:00:00.000Z', reminderOffsets: [60, 1440], status: 'open' };
  assert.deepEqual(dueFollowUpReminders(followUp, now), [60], 'the one-hour reminder fires now');
  // The window tolerates a missed sweep, so an earlier offset may still be listed; the per-offset
  // dedupe key in `notificationSweep` is what stops it being sent twice.
  assert.ok(dueFollowUpReminders(followUp, new Date('2026-09-24T10:05:00.000Z')).includes(0), 'then the due-now one');
  assert.deepEqual(dueFollowUpReminders(followUp, new Date('2026-09-24T11:00:00.000Z')), [0], 'the hour-before one has aged out of the window');
  assert.deepEqual(dueFollowUpReminders({ ...followUp, status: 'done' }, now), []);
});

test('routing: first enabled matching rule in order; a rule with no conditions matches nothing', () => {
  const rule = (id, order, conditions, enabled = true) => ({ id, order, enabled, name: id, sharedMailboxId: 's', conditions: { fromContains: null, subjectContains: null, toContains: null, ...conditions }, actions: {} });
  const rules = [rule('empty', 0, {}), rule('late', 5, { subjectContains: 'invoice' }), rule('first', 1, { fromContains: 'vendor.com', subjectContains: 'INVOICE' }), rule('off', 0, { subjectContains: 'invoice' }, false)];
  const message = { from: { name: 'V', address: 'ar@vendor.com' }, to: [], cc: [], subject: 'Invoice 7' };
  assert.equal(matchRoutingRule(rules, message)?.id, 'first');
  assert.equal(matchRoutingRule(rules, { ...message, from: { name: null, address: 'x@other.com' } })?.id, 'late');
  assert.equal(matchRoutingRule([rule('empty', 0, {})], message), null);
});

test('thread aggregation: response time, awaiting-reply and ERP fields preserved', () => {
  const base = { id: 't', accountId: 'a', ownerUserId: 'u', sharedMailboxId: 's', assignment: { assigneeId: 'u2', status: 'open' }, linkCount: 2, noteCount: 1 };
  const message = (id, direction, receivedAt, extra = {}) => ({ id, direction, receivedAt, deleted: false, isRead: true, isDraft: false, isFlagged: false, hasAttachments: false, from: { name: null, address: `${id}@x.com` }, to: [], cc: [], subject: 'Re: Quote', snippet: id, folderIds: ['f'], viewKeys: ['k'], searchTokens: [], providerThreadId: null, ...extra });
  const thread = aggregateThread([message('m1', 'inbound', '2026-09-20T10:00:00Z'), message('m2', 'outbound', '2026-09-20T13:00:00Z'), message('m3', 'inbound', '2026-09-21T09:00:00Z', { isRead: false })], base, 'now');
  assert.equal(thread.firstResponseAt, '2026-09-20T13:00:00Z');
  assert.equal(thread.awaitingReply, true);
  assert.equal(thread.unreadCount, 1);
  assert.equal(thread.subject, 'Quote');
  assert.equal(thread.linkCount, 2);
  assert.deepEqual(thread.assignment, base.assignment);
});

test('reports: volume, open, overdue, median response and per-department rollup', () => {
  const now = new Date('2026-09-24T09:00:00.000Z');
  const thread = (id, assigneeId, status, dueAt, awaitingReply, firstInboundAt, firstResponseAt) => ({ id, sharedMailboxId: 's', assignment: { assigneeId, assigneeName: assigneeId, status, dueAt, assignedAt: '2026-09-20T00:00:00.000Z', departmentId: null }, awaitingReply, firstInboundAt, firstResponseAt, lastMessageAt: '2026-09-22T00:00:00.000Z' });
  const report = buildMailReport({
    threads: [
      thread('1', 'ben', 'open', '2026-09-23T00:00:00.000Z', true, '2026-09-20T00:00:00.000Z', null),
      thread('2', 'ben', 'closed', null, false, '2026-09-20T00:00:00.000Z', '2026-09-20T02:00:00.000Z'),
      thread('3', 'ravi', 'open', '2026-09-30T00:00:00.000Z', true, '2026-09-21T00:00:00.000Z', '2026-09-21T06:00:00.000Z'),
    ],
    followUps: [{ ownerId: 'ben', status: 'open', dueAt: '2026-09-23T00:00:00.000Z' }],
    departmentOf: (id) => (id === 'ben' ? 'Accounts' : 'Stores'),
    from: '2026-09-01T00:00:00.000Z',
    to: '2026-10-01T00:00:00.000Z',
    now,
  });
  assert.equal(report.assignedVolume, 3);
  assert.equal(report.openWork, 2);
  assert.equal(report.overdue, 1);
  assert.equal(report.medianResponseHours, 4);
  assert.deepEqual(report.byDepartment.map((row) => [row.department, row.assigned, row.overdue]), [['Accounts', 2, 1], ['Stores', 1, 0]]);
  assert.equal(report.followUps.overdue, 1);
});

test('recovery advice tells the user what to do', () => {
  const sync = { consecutiveFailures: 1, nextAttemptAt: '2026-09-24T09:05:00.000Z', lastError: 'HTTP 503', messagesSynced: 40, phase: 'incremental' };
  assert.equal(recoveryAdvice({ status: 'reauth_required', statusReason: 'invalid_grant', provider: 'gmail', sync, kind: 'personal' }).action, 'reconnect');
  const error = recoveryAdvice({ status: 'error', statusReason: null, provider: 'microsoft', sync, kind: 'personal' }, new Date('2026-09-24T09:00:00.000Z'));
  assert.equal(error.action, 'retry');
  assert.match(error.steps.join(' '), /5 minute/);
  assert.equal(recoveryAdvice({ status: 'error', statusReason: null, provider: 'imap', sync: { ...sync, consecutiveFailures: 6 }, kind: 'personal' }).action, 'contact-admin');
  assert.equal(recoveryAdvice({ status: 'active', statusReason: null, provider: 'gmail', sync, kind: 'personal' }), null);
});

test('redirects after OAuth stay inside Mail Hub', () => {
  assert.equal(safeMailReturnTo('/mail/shared?x=1'), '/mail/shared?x=1');
  for (const bad of ['https://evil.example/mail', '//evil.example', '/office-hub', '/mail\\..\\x', '/mail/x\r\nSet-Cookie: a', 'javascript:alert(1)']) {
    assert.equal(safeMailReturnTo(bad), '/mail/settings/accounts', bad);
  }
});

test('IMAP connections only go to administrator presets, and respect their domains', () => {
  const presets = [{ id: 'sel', label: 'SEL mail', allowedDomains: ['selindia.net'], usernameStyle: 'email' }];
  assert.equal(resolveImapPreset(presets, 'sel', 'asha@selindia.net').ok, true);
  assert.equal(resolveImapPreset(presets, 'sel', 'asha@gmail.com').ok, false);
  assert.equal(resolveImapPreset(presets, 'attacker-host', 'asha@selindia.net').ok, false, 'no free-form hosts');
});

test('compose validation and templates', () => {
  const base = { to: [{ name: null, address: 'a@b.com' }], cc: [], bcc: [], subject: 'Hi', html: '<p>x</p>', attachmentBytes: 0, maxAttachmentBytes: 1000, forSend: true };
  assert.deepEqual(validateCompose(base), []);
  assert.ok(validateCompose({ ...base, to: [] }).some((error) => /recipient/.test(error)));
  assert.ok(validateCompose({ ...base, to: [], forSend: false }).length === 0, 'a draft may have no recipients yet');
  assert.ok(validateCompose({ ...base, attachmentBytes: 2000 }).some((error) => /Attachments/.test(error)));
  assert.equal(applyTemplate('Dear {{recipient.name}}, re {{ subject }}', { recipientName: '<b>Ravi</b>', subject: 'PO' }), 'Dear &lt;b&gt;Ravi&lt;/b&gt;, re PO');
});

test('retry backoff grows, is jittered, and honours Retry-After as a floor', () => {
  assert.equal(retryDelayMs(1, null, () => 0), 15_000);
  assert.equal(retryDelayMs(3, null, () => 1), 120_000);
  assert.equal(retryDelayMs(1, 90_000, () => 0), 90_000);
  assert.ok(retryDelayMs(50, null, () => 1) <= 3_600_000, 'capped at an hour');
});
