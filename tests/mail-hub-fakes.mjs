/**
 * Test doubles for Mail Hub's integration tests: an in-memory `MailSyncStore` with the same
 * semantics as the Firestore one, and a scriptable provider adapter whose mailbox the test mutates
 * between sync runs — mail arriving, moving, being deleted, the cursor expiring, the provider
 * rate-limiting or refusing the grant.
 */

import { emptySyncState } from '../src/lib/mail-hub/sync-engine.ts';
import {
  DEFAULT_CAPABILITIES,
  ProviderAuthError,
  ProviderCursorExpiredError,
  ProviderRateLimitError,
} from '../src/lib/mail-hub/providers/types.ts';

export function makeAccount(overrides = {}) {
  return {
    id: 'acc1',
    ownerUserId: 'u1',
    ownerName: 'Asha',
    organizationId: 'default',
    provider: 'gmail',
    kind: 'personal',
    emailAddress: 'asha@sel.in',
    displayName: 'Asha',
    providerAccountId: 'asha@sel.in',
    status: 'connecting',
    statusReason: null,
    capabilities: DEFAULT_CAPABILITIES.gmail,
    grantedScopes: [],
    identities: [],
    imapServerId: null,
    sync: emptySyncState(),
    watch: { kind: 'none', subscriptionId: null, expiresAt: null, nextPollAt: null, lastNotificationAt: null, lastError: null },
    settings: { syncWindowDays: 90, cacheBodies: true },
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    disconnectedAt: null,
    ...overrides,
  };
}

export class MemoryStore {
  constructor(account, extras = {}) {
    this.accounts = new Map([[account.id, structuredClone(account)]]);
    this.folders = new Map();
    this.cursors = new Map();
    this.messages = new Map();
    this.threads = new Map();
    this.sharedMailboxes = extras.sharedMailboxes ?? [];
    this.rules = extras.rules ?? [];
    this.writes = 0;
    /** Hook run before every account read, so a test can disconnect mid-run. */
    this.onGetAccount = null;
  }
  async getAccount(id) {
    this.onGetAccount?.(this);
    const account = this.accounts.get(id);
    return account ? structuredClone(account) : null;
  }
  async updateAccount(id, patch) {
    const account = this.accounts.get(id);
    this.accounts.set(id, { ...account, ...structuredClone(patch) });
  }
  async getFolders(accountId) {
    return [...this.folders.values()].filter((folder) => folder.accountId === accountId);
  }
  async putFolders(folders) {
    folders.forEach((folder) => this.folders.set(folder.id, structuredClone(folder)));
  }
  async getCursors(accountId) {
    return [...this.cursors.values()].filter((cursor) => cursor.accountId === accountId).map((cursor) => structuredClone(cursor));
  }
  async putCursors(cursors) {
    cursors.forEach((cursor) => this.cursors.set(cursor.id, structuredClone(cursor)));
  }
  async deleteCursors(accountId) {
    for (const [id, cursor] of this.cursors) if (cursor.accountId === accountId) this.cursors.delete(id);
  }
  async getMessages(ids) {
    const out = new Map();
    ids.forEach((id) => {
      if (this.messages.has(id)) out.set(id, structuredClone(this.messages.get(id)));
    });
    return out;
  }
  async putMessages(messages) {
    this.writes += messages.length;
    messages.forEach((message) => this.messages.set(message.id, structuredClone(message)));
  }
  async getThread(id) {
    return this.threads.has(id) ? structuredClone(this.threads.get(id)) : null;
  }
  async getThreadMessages(threadId) {
    return [...this.messages.values()].filter((message) => message.threadId === threadId).map((message) => structuredClone(message));
  }
  async putThreads(threads) {
    threads.forEach((thread) => this.threads.set(thread.id, structuredClone(thread)));
  }
  async staleMessageIds(accountId, generation, since, limit) {
    return [...this.messages.values()]
      .filter((message) => message.accountId === accountId && !message.deleted && message.syncGeneration < generation && (!since || message.receivedAt >= since))
      .slice(0, limit)
      .map((message) => message.id);
  }
  async getSharedMailboxByAccount(accountId) {
    return this.sharedMailboxes.find((mailbox) => mailbox.accountId === accountId) ?? null;
  }
  async getRoutingRules(sharedMailboxId) {
    return this.rules.filter((rule) => rule.sharedMailboxId === sharedMailboxId);
  }

  live() {
    return [...this.messages.values()].filter((message) => !message.deleted);
  }
}

/** A message as the fake provider holds it. */
export function providerMessage(id, overrides = {}) {
  return {
    id,
    threadId: overrides.threadId ?? `t-${id}`,
    labels: overrides.labels ?? ['INBOX'],
    from: overrides.from ?? { name: 'Vendor', address: 'billing@vendor.com' },
    to: overrides.to ?? [{ name: 'Asha', address: 'asha@sel.in' }],
    subject: overrides.subject ?? `Subject ${id}`,
    receivedAt: overrides.receivedAt ?? '2026-09-20T10:00:00.000Z',
    isRead: overrides.isRead ?? false,
  };
}

/**
 * A Gmail-shaped fake: labels are authoritative, one history cursor for the whole mailbox.
 * `mailbox` is the provider's truth; `history` is a monotonically growing change log.
 */
export class FakeGmailAdapter {
  constructor(messages = []) {
    this.provider = 'gmail';
    this.capabilities = DEFAULT_CAPABILITIES.gmail;
    this.mailbox = new Map(messages.map((message) => [message.id, message]));
    this.historyId = 100;
    this.log = [];
    this.historyFloor = 0;
    this.failNext = null;
    this.failHeaderFor = new Set();
    this.calls = { listPage: 0, changesSince: 0, fetchHeader: 0 };
  }

  // test controls
  deliver(message) {
    this.mailbox.set(message.id, message);
    this.log.push({ at: ++this.historyId, id: message.id });
  }
  change(id, patch) {
    this.mailbox.set(id, { ...this.mailbox.get(id), ...patch });
    this.log.push({ at: ++this.historyId, id });
  }
  remove(id) {
    this.mailbox.delete(id);
    this.log.push({ at: ++this.historyId, id, deleted: true });
  }
  /** Simulate Gmail discarding history older than now. */
  expireHistory() {
    // Any cursor older than the current history id is now unusable; a fresh baseline is fine.
    this.historyId += 1;
    this.historyFloor = this.historyId;
  }

  maybeFail() {
    const failure = this.failNext;
    if (!failure) return;
    this.failNext = null;
    if (failure === 'rate') throw new ProviderRateLimitError(30_000);
    if (failure === 'auth') throw new ProviderAuthError('revoked', 'invalid_grant');
    throw new Error('provider exploded');
  }

  header(message) {
    const folders = [...message.labels];
    if (!folders.includes('TRASH')) folders.push('__all__');
    return {
      stableKey: message.id,
      providerMessageId: message.id,
      providerThreadId: message.threadId,
      threadKey: message.threadId,
      providerFolderIds: folders,
      internetMessageId: `${message.id}@vendor.com`,
      inReplyTo: null,
      references: [],
      from: message.from,
      to: message.to,
      cc: [],
      bcc: [],
      replyTo: [],
      subject: message.subject,
      snippet: `Snippet ${message.id}`,
      sentAt: message.receivedAt,
      receivedAt: message.receivedAt,
      isRead: message.isRead,
      isFlagged: false,
      isDraft: false,
      attachments: [],
      sizeBytes: 1000,
      providerVersion: String(this.historyId),
    };
  }

  async getProfile() {
    return { emailAddress: 'asha@sel.in', displayName: 'Asha', providerAccountId: 'asha@sel.in', identities: [] };
  }
  async listFolders() {
    this.maybeFail();
    const folder = (id, role) => ({ providerFolderId: id, name: id, role, kind: 'label', parentProviderFolderId: null, unreadCount: null, totalCount: null, synced: true });
    return [folder('__all__', 'all'), folder('INBOX', 'inbox'), folder('SENT', 'sent'), folder('TRASH', 'trash'), folder('Label_1', 'custom')];
  }
  listingScopes() {
    return [null];
  }
  async baselineCursors() {
    return [{ scope: 'account', kind: 'gmail-history', value: String(this.historyId) }];
  }
  async listPage({ pageToken, pageSize }) {
    this.calls.listPage += 1;
    this.maybeFail();
    const all = [...this.mailbox.values()].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    const offset = Number(pageToken ?? 0);
    const slice = all.slice(offset, offset + pageSize);
    const changes = [];
    const failedIds = [];
    for (const message of slice) {
      if (this.failHeaderFor.has(message.id)) failedIds.push(message.id);
      else changes.push({ kind: 'upsert', header: this.header(message), scope: 'authoritative' });
    }
    return { changes, nextPageToken: offset + pageSize < all.length ? String(offset + pageSize) : null, failedIds };
  }
  async changesSince(cursor) {
    this.calls.changesSince += 1;
    this.maybeFail();
    const from = Number(cursor.value);
    if (from < this.historyFloor) throw new ProviderCursorExpiredError(cursor.scope);
    const entries = this.log.filter((entry) => entry.at > from);
    const changes = [];
    const seen = new Set();
    for (const entry of [...entries].reverse()) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      const current = this.mailbox.get(entry.id);
      changes.unshift(current ? { kind: 'upsert', header: this.header(current), scope: 'authoritative' } : { kind: 'remove', stableKey: entry.id, scope: 'global' });
    }
    return { changes, cursor: { ...cursor, value: String(this.historyId) }, more: false };
  }
  async fetchHeader(id) {
    this.calls.fetchHeader += 1;
    if (this.failHeaderFor.has(id)) throw new Error('still failing');
    const message = this.mailbox.get(id);
    return message ? this.header(message) : null;
  }
  async revoke() {
    return true;
  }
}

/**
 * A Graph-shaped fake: per-folder delta cursors, removals scoped to a folder, and moves that
 * arrive as "removed from A" and "added to B" in whichever order the test chooses.
 */
export class FakeGraphAdapter {
  constructor() {
    this.provider = 'microsoft';
    this.capabilities = DEFAULT_CAPABILITIES.microsoft;
    this.folders = ['inbox-id', 'archive-id'];
    this.pending = new Map(this.folders.map((folder) => [folder, []]));
    this.mailbox = new Map();
  }
  put(message, folder) {
    this.mailbox.set(message.id, { ...message, folder });
  }
  header(message) {
    return {
      stableKey: message.id,
      providerMessageId: message.id,
      providerThreadId: message.threadId,
      threadKey: message.threadId,
      providerFolderIds: [message.folder],
      internetMessageId: null,
      inReplyTo: null,
      references: [],
      from: message.from,
      to: message.to,
      cc: [],
      bcc: [],
      replyTo: [],
      subject: message.subject,
      snippet: '',
      sentAt: message.receivedAt,
      receivedAt: message.receivedAt,
      isRead: message.isRead,
      isFlagged: false,
      isDraft: false,
      attachments: [],
      sizeBytes: null,
      providerVersion: null,
    };
  }
  queue(folder, change) {
    this.pending.get(folder).push(change);
  }
  async getProfile() {
    return { emailAddress: 'asha@sel.in', displayName: 'Asha', providerAccountId: 'graph-user', identities: [] };
  }
  async listFolders() {
    return [
      { providerFolderId: 'inbox-id', name: 'Inbox', role: 'inbox', kind: 'folder', parentProviderFolderId: null, unreadCount: 0, totalCount: 0, synced: true },
      { providerFolderId: 'archive-id', name: 'Archive', role: 'archive', kind: 'folder', parentProviderFolderId: null, unreadCount: 0, totalCount: 0, synced: true },
    ];
  }
  listingScopes() {
    return this.folders;
  }
  async baselineCursors() {
    return [];
  }
  async listPage({ scope }) {
    const changes = [...this.mailbox.values()].filter((message) => message.folder === scope).map((message) => ({ kind: 'upsert', header: this.header(message), scope: 'authoritative' }));
    return { changes, nextPageToken: null, cursor: { scope, kind: 'graph-delta', value: `delta:${scope}:0` } };
  }
  async changesSince(cursor) {
    const changes = this.pending.get(cursor.scope).splice(0);
    return { changes, cursor: { ...cursor, value: `delta:${cursor.scope}:${Date.now()}` }, more: false };
  }
  async fetchHeader(id) {
    const message = this.mailbox.get(id);
    return message ? this.header(message) : null;
  }
  async revoke() {
    return false;
  }
}

/** A clock the test advances by hand. */
export function manualClock(start = '2026-09-24T09:00:00.000Z') {
  let now = Date.parse(start);
  const clock = () => new Date(now);
  clock.advance = (ms) => {
    now += ms;
  };
  return clock;
}
