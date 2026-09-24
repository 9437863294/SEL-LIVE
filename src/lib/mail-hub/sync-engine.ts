/**
 * Mail Hub — the sync engine.
 *
 * One function, `runMailSync`, that brings the ERP's copy of one mailbox up to date and returns
 * what the worker should do next. It knows nothing about Firestore or any provider: it speaks to a
 * `MailSyncStore` and a `MailProviderAdapter`, both injected, which is what lets
 * `tests/mail-hub-sync.test.mjs` run it end to end against a scripted fake provider.
 *
 * ── The properties it is built to keep ─────────────────────────────────────────────────────────
 *
 *  **Idempotent.** Applying a change is "make the stored copy look like this", never "add one".
 *  Replaying a page, receiving the same Gmail notification twice or re-running a job that died
 *  half-way converges on the same documents. Cursors are saved *after* the changes they cover are
 *  applied, so a crash between the two replays a page rather than skipping one.
 *
 *  **Resumable.** Initial and recovery listings save their position (folder queue + page token)
 *  after every page. A run that hits its time budget returns `continue`; one that hits a rate
 *  limit returns `backoff` with the provider's delay. Neither starts over.
 *
 *  **Nothing lost during the first sync.** Change cursors are captured *before* a listing starts,
 *  so mail that arrives while ten thousand old messages are being listed is picked up by the first
 *  incremental pass instead of falling into the gap between "listed" and "watched".
 *
 *  **Expired cursors recover.** Gmail forgets history after about a week, Graph delta tokens expire,
 *  an IMAP server can change UIDVALIDITY. Any of those raises `ProviderCursorExpiredError`, which
 *  switches the account to a *recovery* listing: a fresh generation number, a full relisting of the
 *  sync window, and afterwards every message in the window that was not seen again is tombstoned —
 *  it was deleted or moved out of reach while the ERP could not see changes.
 *
 *  **Moves are not deletions.** Graph (with immutable ids) reports a move as "removed from A" plus
 *  "present in B", in either order. Folder-scoped removals subtract one folder; the document is only
 *  tombstoned when no folder is left, and a later upsert revives it.
 *
 *  **Partial failures do not block the cursor forever, and do not lose messages.** A message whose
 *  metadata fetch failed is remembered in `pendingRefetch` and retried at the start of the next run.
 *
 *  **Disconnection wins.** The account is re-read before every page; once it says `disconnected`
 *  the run stops writing and returns, leaving the purge job to clear what is there.
 */

import type {
  MailAccount,
  MailAddress,
  MailAssignment,
  MailFolder,
  MailMessage,
  MailRoutingRule,
  MailSharedMailbox,
  MailSyncCursor,
  MailSyncState,
  MailThread,
} from './model.ts';
import {
  ProviderAuthError,
  ProviderCursorExpiredError,
  ProviderRateLimitError,
  type MailProviderAdapter,
  type ProviderChange,
  type ProviderCursor,
  type ProviderFolder,
  type ProviderMessageHeader,
} from './providers/types.ts';
import {
  addHours,
  aggregateThread,
  attachmentMetaFrom,
  folderDocId,
  matchRoutingRule,
  messageDocId,
  messageSearchTokens,
  normalizeEmail,
  retryDelayMs,
  threadDocId,
  viewKeysFor,
} from './rules.ts';

/* ── the store the engine writes through ───────────────────────────────────────────────────── */

export interface MailSyncStore {
  getAccount(accountId: string): Promise<MailAccount | null>;
  updateAccount(accountId: string, patch: Partial<Pick<MailAccount, 'status' | 'statusReason' | 'sync' | 'updatedAt'>>): Promise<void>;
  getFolders(accountId: string): Promise<MailFolder[]>;
  putFolders(folders: MailFolder[]): Promise<void>;
  getCursors(accountId: string): Promise<MailSyncCursor[]>;
  putCursors(cursors: MailSyncCursor[]): Promise<void>;
  deleteCursors(accountId: string): Promise<void>;
  getMessages(ids: string[]): Promise<Map<string, MailMessage>>;
  putMessages(messages: MailMessage[]): Promise<void>;
  getThread(threadId: string): Promise<MailThread | null>;
  getThreadMessages(threadId: string): Promise<MailMessage[]>;
  putThreads(threads: MailThread[]): Promise<void>;
  /** Live messages received on or after `sinceIso` whose `syncGeneration` is below `generation`. */
  staleMessageIds(accountId: string, generation: number, sinceIso: string | null, limit: number): Promise<string[]>;
  getSharedMailboxByAccount(accountId: string): Promise<MailSharedMailbox | null>;
  getRoutingRules(sharedMailboxId: string): Promise<MailRoutingRule[]>;
}

export interface MailSyncDeps {
  store: MailSyncStore;
  adapter: MailProviderAdapter;
  now?: () => Date;
  /** Wall-clock budget for one run. The worker re-enqueues on `continue`. */
  budgetMs?: number;
  pageSize?: number;
  random?: () => number;
}

export type MailSyncEvent = {
  type: 'thread.assigned';
  threadId: string;
  sharedMailboxId: string;
  assigneeId: string;
  assigneeName: string | null;
  subject: string;
  dueAt: string | null;
};

export interface MailSyncOutcome {
  result: 'complete' | 'continue' | 'backoff' | 'reauth' | 'disconnected' | 'skipped';
  retryAfterMs?: number;
  applied: number;
  events: MailSyncEvent[];
  error?: string;
}

export const MAX_PENDING_REFETCH = 200;
const STALE_BATCH = 400;

export function emptySyncState(): MailSyncState {
  return {
    phase: 'initial',
    initialSyncComplete: false,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastError: null,
    consecutiveFailures: 0,
    nextAttemptAt: null,
    messagesSynced: 0,
    listing: null,
    pendingRefetch: [],
    generation: 0,
  };
}

/* ── applying changes ──────────────────────────────────────────────────────────────────────── */

interface ApplyContext {
  account: MailAccount;
  foldersByProviderId: Map<string, MailFolder>;
  foldersById: Map<string, MailFolder>;
  ownAddresses: Set<string>;
  generation: number;
  mode: 'listing' | 'incremental';
  sharedMailbox: MailSharedMailbox | null;
  rules: MailRoutingRule[];
  nowIso: string;
}

function toFolder(account: MailAccount, folder: ProviderFolder, nowIso: string): MailFolder {
  return {
    id: folderDocId(account.id, folder.providerFolderId),
    accountId: account.id,
    ownerUserId: account.ownerUserId,
    providerFolderId: folder.providerFolderId,
    name: folder.name,
    role: folder.role,
    kind: folder.kind,
    parentId: folder.parentProviderFolderId ? folderDocId(account.id, folder.parentProviderFolderId) : null,
    unreadCount: folder.unreadCount,
    totalCount: folder.totalCount,
    synced: folder.synced,
    imap: folder.imap ?? null,
    updatedAt: nowIso,
  };
}

function toCursor(accountId: string, cursor: ProviderCursor, nowIso: string): MailSyncCursor {
  return {
    id: `${accountId}__c${cursor.scope.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 200)}`,
    accountId,
    scope: cursor.scope,
    kind: cursor.kind,
    value: cursor.value,
    updatedAt: nowIso,
  };
}

function messageFromHeader(
  ctx: ApplyContext,
  header: ProviderMessageHeader,
  folderIds: string[],
  existing: MailMessage | undefined,
): MailMessage {
  const { account } = ctx;
  const roleOf = (folderId: string) => ctx.foldersById.get(folderId)?.role ?? null;
  const fromOwn = header.from ? ctx.ownAddresses.has(normalizeEmail(header.from.address)) : false;
  const inSent = folderIds.some((folderId) => roleOf(folderId) === 'sent');
  const clean = (list: MailAddress[]) => list.map((entry) => ({ name: entry.name ?? null, address: normalizeEmail(entry.address) }));

  const base = {
    subject: header.subject,
    snippet: header.snippet,
    from: header.from ? { name: header.from.name ?? null, address: normalizeEmail(header.from.address) } : null,
    to: clean(header.to),
    cc: clean(header.cc),
  };

  return {
    id: messageDocId(account.id, header.stableKey),
    accountId: account.id,
    ownerUserId: account.ownerUserId,
    sharedMailboxId: ctx.sharedMailbox?.id ?? null,
    threadId: threadDocId(account.id, header.threadKey),
    providerMessageId: header.providerMessageId,
    providerThreadId: header.providerThreadId,
    internetMessageId: header.internetMessageId,
    inReplyTo: header.inReplyTo,
    references: header.references.slice(0, 50),
    folderIds,
    viewKeys: viewKeysFor(account.id, folderIds, roleOf, { isFlagged: header.isFlagged, isDraft: header.isDraft }),
    ...base,
    bcc: clean(header.bcc),
    replyTo: clean(header.replyTo),
    sentAt: header.sentAt,
    receivedAt: header.receivedAt,
    isRead: header.isRead,
    isFlagged: header.isFlagged,
    isDraft: header.isDraft,
    direction: fromOwn || inSent ? 'outbound' : 'inbound',
    hasAttachments: header.hasAttachments ?? (header.attachments.some((entry) => !entry.inline) || (existing?.hasAttachments ?? false)),
    // Listing-time metadata when the provider gives it (IMAP BODYSTRUCTURE); otherwise whatever an
    // earlier body fetch recorded, which Gmail's metadata format and Graph's delta do not include.
    attachments: header.attachments.length
      ? header.attachments.map((entry, index) => attachmentMetaFrom(entry, index))
      : (existing?.attachments ?? []),
    sizeBytes: header.sizeBytes,
    providerVersion: header.providerVersion,
    searchTokens: messageSearchTokens(base),
    bodyState: existing?.bodyState ?? 'none',
    deleted: folderIds.length === 0,
    syncGeneration: ctx.generation,
    syncedAt: ctx.nowIso,
  };
}

function withFolders(ctx: ApplyContext, message: MailMessage, folderIds: string[]): MailMessage {
  const roleOf = (folderId: string) => ctx.foldersById.get(folderId)?.role ?? null;
  return {
    ...message,
    folderIds,
    viewKeys: viewKeysFor(message.accountId, folderIds, roleOf, { isFlagged: message.isFlagged, isDraft: message.isDraft }),
    deleted: folderIds.length === 0,
    syncedAt: ctx.nowIso,
  };
}

/**
 * Apply one batch of changes. Later changes in the batch win over earlier ones for the same
 * message, exactly as they would if they had arrived in separate runs.
 */
async function applyChanges(
  store: MailSyncStore,
  ctx: ApplyContext,
  changes: ProviderChange[],
): Promise<{ applied: number; upserts: number; events: MailSyncEvent[] }> {
  if (!changes.length) return { applied: 0, upserts: 0, events: [] };

  const ids = [...new Set(changes.map((change) => messageDocId(ctx.account.id, change.kind === 'upsert' ? change.header.stableKey : change.stableKey)))];
  const existing = await store.getMessages(ids);
  const working = new Map(existing);
  const touchedThreads = new Set<string>();
  const newInboundThreads = new Set<string>();
  let upserts = 0;

  for (const change of changes) {
    if (change.kind === 'upsert') {
      const docId = messageDocId(ctx.account.id, change.header.stableKey);
      const before = working.get(docId);
      const mapped = change.header.providerFolderIds
        .map((providerFolderId) => ctx.foldersByProviderId.get(providerFolderId)?.id)
        .filter((id): id is string => Boolean(id));
      const folderIds =
        change.scope === 'authoritative'
          ? [...new Set(mapped)]
          : [...new Set([...(before && !before.deleted ? before.folderIds : []), ctx.foldersByProviderId.get(change.scope.folder)?.id].filter((id): id is string => Boolean(id)))];
      const next = messageFromHeader(ctx, change.header, folderIds, before);
      if (before && before.threadId !== next.threadId) touchedThreads.add(before.threadId);
      if ((!before || before.deleted) && next.direction === 'inbound' && !next.deleted) newInboundThreads.add(next.threadId);
      working.set(docId, next);
      touchedThreads.add(next.threadId);
      upserts += 1;
    } else {
      const docId = messageDocId(ctx.account.id, change.stableKey);
      const before = working.get(docId);
      // A removal for something the ERP never stored needs nothing — idempotent by construction.
      if (!before) continue;
      const scopedFolderId = change.scope === 'global' ? null : ctx.foldersByProviderId.get(change.scope.folder)?.id;
      const folderIds = change.scope === 'global' ? [] : before.folderIds.filter((folderId) => folderId !== scopedFolderId);
      working.set(docId, withFolders(ctx, before, folderIds));
      touchedThreads.add(before.threadId);
    }
  }

  const changed = [...working.entries()].filter(([id, message]) => existing.get(id) !== message).map(([, message]) => message);
  await store.putMessages(changed);
  const events = await recomputeThreads(store, ctx, [...touchedThreads], newInboundThreads);
  return { applied: changed.length, upserts, events };
}

async function applyRemovalsByDocId(store: MailSyncStore, ctx: ApplyContext, docIds: string[]): Promise<number> {
  if (!docIds.length) return 0;
  const existing = await store.getMessages(docIds);
  const removed = [...existing.values()].filter((message) => !message.deleted).map((message) => withFolders(ctx, message, []));
  await store.putMessages(removed);
  await recomputeThreads(store, ctx, [...new Set(removed.map((message) => message.threadId))], new Set());
  return removed.length;
}

/**
 * Rebuild the thread documents a batch touched, keeping the ERP-side fields — assignment, link and
 * note counts — that only the ERP writes. For a shared mailbox, a thread that gains an inbound
 * message during incremental sync gets routed: the first matching rule assigns it, and the
 * mailbox's response deadline starts. A closed thread that receives a new inbound message reopens.
 */
async function recomputeThreads(
  store: MailSyncStore,
  ctx: ApplyContext,
  threadIds: string[],
  newInbound: Set<string>,
): Promise<MailSyncEvent[]> {
  const events: MailSyncEvent[] = [];
  const threads: MailThread[] = [];
  for (const threadId of threadIds) {
    const [messages, previous] = await Promise.all([store.getThreadMessages(threadId), store.getThread(threadId)]);
    let assignment: MailAssignment | null = previous?.assignment ?? null;
    const thread = aggregateThread(
      messages,
      {
        id: threadId,
        accountId: ctx.account.id,
        ownerUserId: ctx.account.ownerUserId,
        sharedMailboxId: ctx.sharedMailbox?.id ?? null,
        assignment,
        linkCount: previous?.linkCount ?? 0,
        noteCount: previous?.noteCount ?? 0,
      },
      ctx.nowIso,
    );

    const routable = ctx.sharedMailbox && ctx.mode === 'incremental' && newInbound.has(threadId) && !thread.deleted;
    if (routable && ctx.sharedMailbox) {
      const newest = messages
        .filter((message) => !message.deleted && message.direction === 'inbound')
        .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0];
      if (newest) {
        const hours = ctx.sharedMailbox.responseHours;
        if (!assignment) {
          const rule = matchRoutingRule(ctx.rules, newest);
          const deadlineHours = rule?.actions.deadlineHours ?? (hours > 0 ? hours : null);
          assignment = {
            assigneeId: rule?.actions.assignToUserId ?? null,
            assigneeName: rule?.actions.assignToUserName ?? null,
            status: 'open',
            dueAt: deadlineHours ? addHours(newest.receivedAt, deadlineHours) : null,
            assignedAt: rule?.actions.assignToUserId ? ctx.nowIso : null,
            assignedById: rule ? `rule:${rule.id}` : null,
            assignedByName: rule ? `Rule: ${rule.name}` : null,
            departmentId: ctx.sharedMailbox.departmentId,
          };
          if (assignment.assigneeId) {
            events.push({
              type: 'thread.assigned',
              threadId,
              sharedMailboxId: ctx.sharedMailbox.id,
              assigneeId: assignment.assigneeId,
              assigneeName: assignment.assigneeName,
              subject: thread.subject,
              dueAt: assignment.dueAt,
            });
          }
        } else if (assignment.status === 'closed') {
          assignment = {
            ...assignment,
            status: 'open',
            dueAt: hours > 0 ? addHours(newest.receivedAt, hours) : assignment.dueAt,
          };
          if (assignment.assigneeId) {
            events.push({
              type: 'thread.assigned',
              threadId,
              sharedMailboxId: ctx.sharedMailbox.id,
              assigneeId: assignment.assigneeId,
              assigneeName: assignment.assigneeName,
              subject: thread.subject,
              dueAt: assignment.dueAt,
            });
          }
        }
      }
    }
    threads.push({ ...thread, assignment });
  }
  await store.putThreads(threads);
  return events;
}

/* ── outside the sync loop ────────────────────────────────────────────────────────────────── */

async function contextFor(store: MailSyncStore, account: MailAccount, mode: ApplyContext['mode']): Promise<ApplyContext> {
  const folders = await store.getFolders(account.id);
  const sharedMailbox = account.kind === 'shared' ? await store.getSharedMailboxByAccount(account.id) : null;
  return {
    account,
    foldersByProviderId: new Map(folders.map((folder) => [folder.providerFolderId, folder])),
    foldersById: new Map(folders.map((folder) => [folder.id, folder])),
    ownAddresses: new Set([account.emailAddress, ...account.identities.map((identity) => identity.address)].map(normalizeEmail)),
    generation: account.sync?.generation ?? 0,
    mode,
    sharedMailbox,
    // Headers ingested outside a sync (provider search results) are history, not new mail: no routing.
    rules: [],
    nowIso: new Date().toISOString(),
  };
}

/**
 * Store headers obtained outside a sync run — provider search results older than the sync window —
 * through exactly the same idempotent apply, so they open like any other message.
 */
export async function ingestHeaders(store: MailSyncStore, account: MailAccount, headers: ProviderMessageHeader[]): Promise<number> {
  const ctx = await contextFor(store, account, 'listing');
  const result = await applyChanges(store, ctx, headers.map((header): ProviderChange => ({ kind: 'upsert', header, scope: 'authoritative' })));
  return result.applied;
}

/** Recompute thread documents after an optimistic local change (mark read, archive, move). */
export async function rebuildThreads(store: MailSyncStore, account: MailAccount, threadIds: string[]): Promise<void> {
  const ctx = await contextFor(store, account, 'listing');
  await recomputeThreads(store, ctx, [...new Set(threadIds)], new Set());
}

/** The view keys a message would have with these folders — for optimistic local updates. */
export async function withFoldersFor(store: MailSyncStore, account: MailAccount, message: MailMessage, folderIds: string[], flags: Partial<Pick<MailMessage, 'isRead' | 'isFlagged'>> = {}): Promise<MailMessage> {
  const ctx = await contextFor(store, account, 'listing');
  return withFolders(ctx, { ...message, ...flags }, folderIds);
}

/* ── the run ──────────────────────────────────────────────────────────────────────────────── */

function daysAgoIso(now: Date, days: number): string {
  return new Date(now.getTime() - Math.max(1, days) * 86_400_000).toISOString();
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runMailSync(deps: MailSyncDeps, accountId: string): Promise<MailSyncOutcome> {
  const { store, adapter } = deps;
  const now = deps.now ?? (() => new Date());
  const budgetMs = deps.budgetMs ?? 45_000;
  const pageSize = deps.pageSize ?? 100;
  const startedAt = now().getTime();
  const overBudget = () => now().getTime() - startedAt >= budgetMs;

  const account = await store.getAccount(accountId);
  if (!account) return { result: 'skipped', applied: 0, events: [], error: 'Account not found.' };
  if (account.status === 'disconnected') return { result: 'disconnected', applied: 0, events: [] };
  if (account.status === 'reauth_required') return { result: 'reauth', applied: 0, events: [] };

  const sync: MailSyncState = { ...emptySyncState(), ...account.sync, lastAttemptAt: now().toISOString() };
  let applied = 0;
  const events: MailSyncEvent[] = [];

  const persist = async (extra: Partial<Pick<MailAccount, 'status' | 'statusReason'>> = {}) => {
    await store.updateAccount(accountId, { sync: { ...sync }, updatedAt: now().toISOString(), ...extra });
  };
  const stillConnected = async () => {
    const fresh = await store.getAccount(accountId);
    return Boolean(fresh && fresh.status !== 'disconnected');
  };

  try {
    const nowIso = now().toISOString();
    const providerFolders = await adapter.listFolders();
    const folders = providerFolders.map((folder) => toFolder(account, folder, nowIso));
    await store.putFolders(folders);

    const sharedMailbox = account.kind === 'shared' ? await store.getSharedMailboxByAccount(accountId) : null;
    const rules = sharedMailbox ? await store.getRoutingRules(sharedMailbox.id) : [];
    const ctxFor = (mode: ApplyContext['mode']): ApplyContext => ({
      account,
      foldersByProviderId: new Map(folders.map((folder) => [folder.providerFolderId, folder])),
      foldersById: new Map(folders.map((folder) => [folder.id, folder])),
      ownAddresses: new Set([account.emailAddress, ...account.identities.map((identity) => identity.address)].map(normalizeEmail)),
      generation: sync.generation,
      mode,
      sharedMailbox,
      rules,
      nowIso: now().toISOString(),
    });

    const needsFull = !sync.initialSyncComplete || sync.phase === 'recovery';
    if (needsFull && !sync.listing) {
      sync.generation += 1;
      if (sync.phase === 'recovery') await store.deleteCursors(accountId);
      const baseline = await adapter.baselineCursors(providerFolders);
      await store.putCursors(baseline.map((cursor) => toCursor(accountId, cursor, nowIso)));
      sync.listing = {
        folderQueue: adapter.listingScopes(providerFolders).map((scope) => scope ?? '*'),
        pageToken: null,
        since: daysAgoIso(now(), account.settings.syncWindowDays),
      };
      sync.phase = sync.initialSyncComplete ? 'recovery' : 'initial';
      await persist();
    } else if (!needsFull && !sync.listing) {
      // A folder created since the last run has no cursor yet: list it, then track it.
      const have = new Set((await store.getCursors(accountId)).map((cursor) => cursor.scope));
      const scopes = adapter.listingScopes(providerFolders).filter((scope): scope is string => scope !== null && !have.has(scope));
      if (scopes.length) {
        const baseline = await adapter.baselineCursors(providerFolders.filter((folder) => scopes.includes(folder.providerFolderId)));
        await store.putCursors(baseline.map((cursor) => toCursor(accountId, cursor, nowIso)));
        sync.listing = { folderQueue: scopes, pageToken: null, since: daysAgoIso(now(), account.settings.syncWindowDays) };
      }
    }

    // ── listing (initial, recovery, or new folders) ──
    while (sync.listing && sync.listing.folderQueue.length) {
      if (overBudget()) {
        await persist();
        return { result: 'continue', applied, events };
      }
      if (!(await stillConnected())) return { result: 'disconnected', applied, events };

      const scopeToken = sync.listing.folderQueue[0];
      const page = await adapter.listPage({
        scope: scopeToken === '*' ? null : scopeToken,
        pageToken: sync.listing.pageToken,
        since: sync.listing.since,
        pageSize,
      });
      const result = await applyChanges(store, ctxFor('listing'), page.changes);
      applied += result.applied;
      sync.messagesSynced += result.upserts;
      if (page.failedIds?.length) sync.pendingRefetch = [...new Set([...sync.pendingRefetch, ...page.failedIds])].slice(-MAX_PENDING_REFETCH);
      if (page.cursor) await store.putCursors([toCursor(accountId, page.cursor, now().toISOString())]);
      if (page.nextPageToken) sync.listing.pageToken = page.nextPageToken;
      else {
        sync.listing.folderQueue.shift();
        sync.listing.pageToken = null;
      }
      await persist();
    }

    if (sync.listing) {
      if (sync.phase === 'recovery') {
        // Everything in the window the relisting did not confirm is gone at the provider.
        for (;;) {
          const stale = await store.staleMessageIds(accountId, sync.generation, sync.listing.since, STALE_BATCH);
          if (!stale.length) break;
          applied += await applyRemovalsByDocId(store, ctxFor('listing'), stale);
          if (stale.length < STALE_BATCH) break;
        }
      }
      sync.listing = null;
      sync.initialSyncComplete = true;
      sync.phase = 'incremental';
      await persist();
    }

    // ── retry messages whose fetch failed earlier ──
    if (sync.pendingRefetch.length) {
      const batch = sync.pendingRefetch.slice(0, 50);
      const changes: ProviderChange[] = [];
      const stillFailing: string[] = [];
      for (const providerMessageId of batch) {
        try {
          const header = await adapter.fetchHeader(providerMessageId);
          changes.push(
            header
              ? { kind: 'upsert', header, scope: 'authoritative' }
              : { kind: 'remove', stableKey: providerMessageId, scope: 'global' },
          );
        } catch (error) {
          if (error instanceof ProviderAuthError || error instanceof ProviderRateLimitError) throw error;
          stillFailing.push(providerMessageId);
        }
      }
      const result = await applyChanges(store, ctxFor('incremental'), changes);
      applied += result.applied;
      events.push(...result.events);
      sync.pendingRefetch = [...stillFailing, ...sync.pendingRefetch.slice(batch.length)];
      await persist();
    }

    // ── incremental changes, per cursor scope ──
    for (const stored of await store.getCursors(accountId)) {
      let cursor: ProviderCursor = { scope: stored.scope, kind: stored.kind, value: stored.value };
      let more = true;
      while (more) {
        if (overBudget()) {
          await persist();
          return { result: 'continue', applied, events };
        }
        if (!(await stillConnected())) return { result: 'disconnected', applied, events };
        const page = await adapter.changesSince(cursor, providerFolders);
        const result = await applyChanges(store, ctxFor('incremental'), page.changes);
        applied += result.applied;
        events.push(...result.events);
        if (page.failedIds?.length) sync.pendingRefetch = [...new Set([...sync.pendingRefetch, ...page.failedIds])].slice(-MAX_PENDING_REFETCH);
        // After the apply, never before: a crash in between replays this page, it never skips it.
        await store.putCursors([toCursor(accountId, page.cursor, now().toISOString())]);
        cursor = page.cursor;
        more = page.more;
      }
    }

    sync.lastSuccessAt = now().toISOString();
    sync.lastError = null;
    sync.consecutiveFailures = 0;
    sync.nextAttemptAt = null;
    await persist(account.status === 'active' ? {} : { status: 'active', statusReason: null });
    return { result: 'complete', applied, events };
  } catch (error) {
    if (!(await stillConnected().catch(() => false))) return { result: 'disconnected', applied, events };

    if (error instanceof ProviderCursorExpiredError) {
      sync.phase = 'recovery';
      sync.listing = null;
      sync.lastError = 'The provider asked for a full resynchronisation.';
      await persist();
      return { result: 'continue', applied, events };
    }
    if (error instanceof ProviderAuthError) {
      sync.lastError = error.message;
      await persist({ status: 'reauth_required', statusReason: error.detail ?? error.message });
      return { result: 'reauth', applied, events, error: error.message };
    }
    const failures = sync.consecutiveFailures + 1;
    const retryAfterMs =
      error instanceof ProviderRateLimitError
        ? Math.max(error.retryAfterMs, 1_000)
        : retryDelayMs(failures, null, deps.random);
    sync.consecutiveFailures = error instanceof ProviderRateLimitError ? sync.consecutiveFailures : failures;
    sync.lastError = errorText(error);
    sync.nextAttemptAt = new Date(now().getTime() + retryAfterMs).toISOString();
    const degrade =
      !(error instanceof ProviderRateLimitError) &&
      failures >= 3 &&
      (account.status === 'active' || account.status === 'connecting');
    await persist(degrade ? { status: 'error', statusReason: sync.lastError } : {});
    return { result: 'backoff', retryAfterMs, applied, events, error: sync.lastError };
  }
}
