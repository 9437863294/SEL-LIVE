import 'server-only';

/**
 * Mail Hub — reading mail and acting on it.
 *
 * Every function here takes a `ResolvedMailbox` — the output of `requireMailbox` — rather than an
 * account id, so it cannot be called on a mailbox whose access has not been decided.
 *
 * ── Bodies ─────────────────────────────────────────────────────────────────────────────────────
 *
 * Bodies are fetched from the provider when a message is opened, sanitised (`sanitize.ts`), and —
 * if the account caches bodies — stored in `mailHubBodies` with an expiry (`bodyCacheDays`,
 * default 14). What is cached is the *sanitised, remote-content-blocked* rendering, never the raw
 * provider HTML. "Load remote images" is a fresh provider fetch that is not cached, so allowing
 * images once does not quietly allow them forever.
 */

import { getFirebaseAdminBucket } from '../firebase-admin';
import {
  MAIL_HUB_COLLECTIONS as C,
  type MailAttachmentMeta,
  type MailFolder,
  type MailFolderRole,
  type MailMessage,
  type MailMessageBody,
  type MailThread,
} from './model';
import type { ProviderMessageAction } from './providers/types';
import {
  MAX_DOWNLOAD_BYTES,
  attachmentMetaFrom,
  deadlineState,
  emailDomain,
  folderKey,
  matchesSearch,
  parseSearchQuery,
  previewKind,
  roleKey,
  sanitizeFilename,
  snippetOf,
  validateAttachment,
} from './rules';
import { sanitizeMailHtml } from './sanitize';
import { scanBytes } from './scan';
import { MailHubError, adminSettings, audit, enqueueSync, userSettings, withAdapter, type MailContext, type ResolvedMailbox } from './server';
import { chunk, clean, db, getMany, getOne, syncStore } from './store';
import { ingestHeaders, rebuildThreads, withFoldersFor } from './sync-engine';

export const LIST_VIEWS = ['inbox', 'sent', 'drafts', 'archive', 'trash', 'spam', 'starred'] as const;
export type ListView = (typeof LIST_VIEWS)[number];

export interface ThreadSummary {
  id: string;
  accountId: string;
  sharedMailboxId: string | null;
  subject: string;
  snippet: string;
  participants: MailThread['participants'];
  messageCount: number;
  unreadCount: number;
  hasAttachments: boolean;
  isFlagged: boolean;
  lastMessageAt: string;
  awaitingReply: boolean;
  assignment: MailThread['assignment'];
  deadline: ReturnType<typeof deadlineState>;
  linkCount: number;
  noteCount: number;
}

export function summarize(thread: MailThread, now = new Date()): ThreadSummary {
  return {
    id: thread.id,
    accountId: thread.accountId,
    sharedMailboxId: thread.sharedMailboxId,
    subject: thread.subject,
    snippet: thread.snippet,
    participants: thread.participants.slice(0, 6),
    messageCount: thread.messageCount,
    unreadCount: thread.unreadCount,
    hasAttachments: thread.hasAttachments,
    isFlagged: thread.isFlagged,
    lastMessageAt: thread.lastMessageAt,
    awaitingReply: thread.awaitingReply,
    assignment: thread.assignment,
    deadline: deadlineState(thread, now),
    linkCount: thread.linkCount,
    noteCount: thread.noteCount,
  };
}

/* ── listing ──────────────────────────────────────────────────────────────────────────────── */

export async function listThreads(input: {
  mailboxes: ResolvedMailbox[];
  view: ListView | null;
  folderId: string | null;
  before: string | null;
  limit: number;
  filter: string | null;
  viewerId: string;
}): Promise<{ threads: ThreadSummary[]; nextBefore: string | null }> {
  const readable = input.mailboxes.filter((entry) => entry.decision.canRead);
  if (!readable.length) return { threads: [], nextBefore: null };
  const keys = input.folderId
    ? readable.map((entry) => folderKey(entry.account.id, input.folderId as string))
    : readable.map((entry) => roleKey(entry.account.id, (input.view ?? 'inbox') as MailFolderRole | 'starred'));

  const limit = Math.min(Math.max(input.limit, 1), 100);
  const out: MailThread[] = [];
  let before = input.before;
  // In-memory filters thin a page; keep fetching (bounded) until the page is full.
  for (let round = 0; round < 4 && out.length < limit; round += 1) {
    let query = db()
      .collection(C.threads)
      .where('viewKeys', 'array-contains-any', keys.slice(0, 30))
      .where('deleted', '==', false)
      .orderBy('lastMessageAt', 'desc')
      .limit(limit * 2);
    if (before) query = query.where('lastMessageAt', '<', before);
    const snapshot = await query.get();
    const page = snapshot.docs.map((doc) => ({ ...(doc.data() as MailThread), id: doc.id }));
    const now = new Date();
    out.push(
      ...page.filter((thread) => {
        switch (input.filter) {
          case 'unread':
            return thread.unreadCount > 0;
          case 'attachments':
            return thread.hasAttachments;
          case 'mine':
            return thread.assignment?.assigneeId === input.viewerId;
          case 'unassigned':
            return !thread.assignment?.assigneeId && thread.assignment?.status !== 'closed';
          case 'overdue':
            return deadlineState(thread, now) === 'overdue';
          case 'open':
            return thread.assignment?.status !== 'closed';
          default:
            return true;
        }
      }),
    );
    if (page.length < limit * 2) {
      before = null;
      break;
    }
    before = page[page.length - 1].lastMessageAt;
  }
  const threads = out.slice(0, limit);
  const nextBefore = before ? (threads[threads.length - 1]?.lastMessageAt ?? before) : null;
  return { threads: threads.map((thread) => summarize(thread)), nextBefore };
}

export async function foldersFor(mailboxes: ResolvedMailbox[]): Promise<Record<string, MailFolder[]>> {
  const out: Record<string, MailFolder[]> = {};
  for (const entry of mailboxes.filter((item) => item.decision.canRead)) {
    const folders = await syncStore.getFolders(entry.account.id);
    const order: MailFolderRole[] = ['inbox', 'drafts', 'sent', 'archive', 'spam', 'trash', 'custom', 'all'];
    out[entry.account.id] = folders.sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role) || a.name.localeCompare(b.name));
  }
  return out;
}

/* ── one conversation ─────────────────────────────────────────────────────────────────────── */

export type MessageView = Omit<MailMessage, 'searchTokens' | 'viewKeys' | 'syncGeneration' | 'ownerUserId'>;

export function messageView(message: MailMessage): MessageView {
  const { searchTokens: _s, viewKeys: _v, syncGeneration: _g, ownerUserId: _o, ...rest } = message;
  return rest;
}

export async function threadMessages(threadId: string): Promise<MailMessage[]> {
  const messages = await syncStore.getThreadMessages(threadId);
  // IMAP location keys can list the same message twice (a copy in two folders). Show it once.
  const seen = new Set<string>();
  return messages
    .filter((message) => !message.deleted)
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
    .filter((message) => {
      const key = message.internetMessageId ?? message.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/* ── bodies ───────────────────────────────────────────────────────────────────────────────── */

const MAX_CACHED_BODY_CHARS = 900_000;

export interface BodyView {
  html: string | null;
  text: string | null;
  remoteContentBlocked: number;
  suspiciousLinks: number;
  remoteAllowed: boolean;
  attachments: MailAttachmentMeta[];
  cached: boolean;
}

export async function loadBody(resolved: ResolvedMailbox, message: MailMessage, input: { allowRemote: boolean; viewerId: string }): Promise<BodyView> {
  const settings = await userSettings(input.viewerId);
  const trusted = settings.trustedImageDomains.map((domain) => domain.toLowerCase());
  const allowRemote = input.allowRemote || (message.from ? trusted.includes(emailDomain(message.from.address)) : false);

  if (!allowRemote) {
    const cached = await getOne<MailMessageBody & { suspiciousLinks?: number }>(C.bodies, message.id);
    if (cached && cached.expiresAt > new Date().toISOString()) {
      return {
        html: cached.html,
        text: cached.text,
        remoteContentBlocked: cached.remoteContentCount,
        suspiciousLinks: cached.suspiciousLinks ?? 0,
        remoteAllowed: false,
        attachments: message.attachments,
        cached: true,
      };
    }
  }

  const fetched = await withAdapter(resolved.account, async (adapter) => {
    const body = await adapter.fetchBody(message.providerMessageId);
    const inline = { ...(body.inlineImages ?? {}) };
    // Gmail returns inline parts by reference; fetch the small ones so cid: images render.
    if (resolved.account.provider === 'gmail') {
      for (const part of body.attachments.filter((entry) => entry.inline && entry.contentId && entry.size <= 1_048_576 && /^image\/(png|jpe?g|gif|webp)$/i.test(entry.contentType)).slice(0, 6)) {
        const content = await adapter.fetchAttachment(message.providerMessageId, part.providerAttachmentId).catch(() => null);
        if (content) inline[part.contentId as string] = `data:${part.contentType.toLowerCase()};base64,${Buffer.from(content.content).toString('base64')}`;
      }
    }
    return { body, inline };
  });

  const sanitized = fetched.body.html
    ? sanitizeMailHtml(fetched.body.html, { allowRemoteContent: allowRemote, inlineImages: fetched.inline })
    : { html: null, remoteContentBlocked: 0, suspiciousLinks: 0 };
  const attachments = fetched.body.attachments.map((entry, index) => attachmentMetaFrom(entry, index));
  const text = fetched.body.text ? fetched.body.text.slice(0, 500_000) : null;

  const patch: Partial<MailMessage> = {
    attachments,
    hasAttachments: attachments.some((entry) => !entry.inline) || message.hasAttachments,
    ...(message.snippet ? {} : { snippet: snippetOf(text ?? '') }),
  };

  const admin = await adminSettings();
  const cacheable =
    !allowRemote &&
    resolved.account.settings.cacheBodies &&
    (sanitized.html?.length ?? 0) + (text?.length ?? 0) < MAX_CACHED_BODY_CHARS;
  if (cacheable) {
    const now = new Date();
    await db()
      .collection(C.bodies)
      .doc(message.id)
      .set(
        clean({
          messageId: message.id,
          accountId: message.accountId,
          ownerUserId: message.ownerUserId,
          html: sanitized.html,
          text,
          remoteContentCount: sanitized.remoteContentBlocked,
          suspiciousLinks: sanitized.suspiciousLinks,
          cachedAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + admin.bodyCacheDays * 86_400_000).toISOString(),
        }),
      );
    patch.bodyState = 'cached';
  }
  await db().collection(C.messages).doc(message.id).set(clean(patch), { merge: true });

  return {
    html: sanitized.html,
    text,
    remoteContentBlocked: sanitized.remoteContentBlocked,
    suspiciousLinks: sanitized.suspiciousLinks,
    remoteAllowed: allowRemote,
    attachments,
    cached: false,
  };
}

/* ── attachments ──────────────────────────────────────────────────────────────────────────── */

export async function downloadAttachment(
  context: MailContext,
  resolved: ResolvedMailbox,
  message: MailMessage,
  attachmentId: string,
): Promise<{ filename: string; contentType: string; content: Uint8Array; scanStatus: MailAttachmentMeta['scanStatus']; preview: ReturnType<typeof previewKind> }> {
  let meta = message.attachments.find((entry) => entry.id === attachmentId);
  if (!meta) {
    // Metadata arrives with the body; open it once if the list has never been fetched.
    const body = await loadBody(resolved, message, { allowRemote: false, viewerId: context.userId });
    meta = body.attachments.find((entry) => entry.id === attachmentId);
  }
  if (!meta) throw new MailHubError('Attachment not found.', 404);
  if (meta.blocked) {
    await audit(context, 'attachment.blocked', `Blocked download of ${meta.filename}`, { accountId: message.accountId, messageId: message.id, detail: { reason: meta.blockedReason } });
    throw new MailHubError(meta.blockedReason ?? 'This file type is blocked.', 403);
  }
  if (meta.size > MAX_DOWNLOAD_BYTES) throw new MailHubError('This attachment is too large to open in the ERP. Open it in your mail provider.', 413);

  const file = await withAdapter(resolved.account, (adapter) => adapter.fetchAttachment(message.providerMessageId, meta.providerAttachmentId));
  // Validate again against what actually arrived, not what the header claimed.
  const verdict = validateAttachment({ filename: file.filename, contentType: file.contentType, size: file.content.byteLength }, { maxBytes: MAX_DOWNLOAD_BYTES });
  if (!verdict.ok) throw new MailHubError(verdict.reason, 403);
  const scan = await scanBytes(file.content, file.filename);
  if (scan.status === 'infected') {
    await audit(context, 'attachment.blocked', `Malware detected in ${meta.filename}`, { accountId: message.accountId, messageId: message.id, detail: { signature: scan.signature } });
    await db()
      .collection(C.messages)
      .doc(message.id)
      .set({ attachments: message.attachments.map((entry) => (entry.id === meta.id ? { ...entry, blocked: true, blockedReason: 'Malware detected.', scanStatus: 'infected' } : entry)) }, { merge: true });
    throw new MailHubError('This attachment contains malware and has been blocked.', 403);
  }
  return {
    filename: sanitizeFilename(file.filename),
    contentType: file.contentType,
    content: file.content,
    scanStatus: scan.status,
    preview: previewKind(file.contentType, file.filename),
  };
}

/* ── actions ──────────────────────────────────────────────────────────────────────────────── */

export type MailAction =
  | { type: 'markRead'; value: boolean }
  | { type: 'flag'; value: boolean }
  | { type: 'archive' }
  | { type: 'trash' }
  | { type: 'untrash' }
  | { type: 'delete' }
  | { type: 'move'; folderId: string };

export async function applyAction(resolved: ResolvedMailbox, messages: MailMessage[], action: MailAction): Promise<{ applied: number; failed: string[] }> {
  const { account } = resolved;
  const caps = account.capabilities;
  if ((action.type === 'archive' && !caps.archive) || (action.type === 'move' && !caps.move) || (action.type === 'delete' && !caps.permanentDelete)) {
    throw new MailHubError('This mailbox does not support that action.', 400);
  }
  const folders = await syncStore.getFolders(account.id);
  const byRole = (role: MailFolderRole) => folders.find((folder) => folder.role === role);
  let providerAction: ProviderMessageAction;
  if (action.type === 'move') {
    const target = folders.find((folder) => folder.id === action.folderId);
    if (!target) throw new MailHubError('That folder no longer exists.', 404);
    providerAction = { type: 'move', providerFolderId: target.providerFolderId };
  } else {
    providerAction = action;
  }

  const providerFolders = folders.map((folder) => ({
    providerFolderId: folder.providerFolderId,
    name: folder.name,
    role: folder.role,
    kind: folder.kind,
    parentProviderFolderId: null,
    unreadCount: folder.unreadCount,
    totalCount: folder.totalCount,
    synced: folder.synced,
  }));

  const failed: string[] = [];
  const updated: MailMessage[] = [];
  await withAdapter(account, async (adapter) => {
    for (const message of messages) {
      try {
        await adapter.modify(message.providerMessageId, providerAction, providerFolders);
      } catch (error) {
        if (error instanceof Error && error.name === 'ProviderAuthError') throw error;
        failed.push(message.id);
        continue;
      }
      // Optimistic local copy, so the list reflects the action before the next sync confirms it.
      const inbox = byRole('inbox')?.id;
      const all = byRole('all')?.id;
      let folderIds = message.folderIds;
      if (action.type === 'archive') folderIds = account.provider === 'gmail' ? folderIds.filter((id) => id !== inbox) : [byRole('archive')?.id].filter((id): id is string => Boolean(id));
      if (action.type === 'trash') folderIds = [byRole('trash')?.id].filter((id): id is string => Boolean(id));
      if (action.type === 'untrash') folderIds = [inbox, account.provider === 'gmail' ? all : undefined].filter((id): id is string => Boolean(id));
      if (action.type === 'delete') folderIds = [];
      if (action.type === 'move') {
        folderIds = account.provider === 'gmail' ? [...new Set([...folderIds.filter((id) => id !== inbox), action.folderId])] : [action.folderId];
      }
      const flags = action.type === 'markRead' ? { isRead: action.value } : action.type === 'flag' ? { isFlagged: action.value } : {};
      updated.push(await withFoldersFor(syncStore, account, message, folderIds, flags));
    }
  });
  await syncStore.putMessages(updated);
  await rebuildThreads(syncStore, account, updated.map((message) => message.threadId));
  // IMAP moves renumber messages; Graph and Gmail confirm through their own notifications.
  if (['archive', 'trash', 'untrash', 'move', 'delete'].includes(action.type)) await enqueueSync(account.id, `action:${action.type}`, 2_000);
  return { applied: updated.length, failed };
}

/* ── search ───────────────────────────────────────────────────────────────────────────────── */

export async function searchMail(input: {
  mailboxes: ResolvedMailbox[];
  query: string;
  scope: 'local' | 'provider';
  limit: number;
}): Promise<{ threads: ThreadSummary[]; searchedProvider: boolean; notes: string[] }> {
  const parsed = parseSearchQuery(input.query);
  const readable = input.mailboxes.filter((entry) => entry.decision.canRead);
  const notes: string[] = [];
  const limit = Math.min(input.limit, 100);

  if (input.scope === 'provider') {
    for (const entry of readable) {
      if (!entry.account.capabilities.serverSearch || entry.account.status === 'disconnected') continue;
      try {
        const headers = await withAdapter(entry.account, async (adapter) => (adapter.search ? adapter.search(input.query, limit) : []));
        await ingestHeaders(syncStore, entry.account, headers);
      } catch (error) {
        notes.push(`${entry.account.emailAddress}: ${error instanceof Error ? error.message : 'search failed'}`);
      }
    }
  }

  // The most selective token goes to the index; the rest are filtered in memory.
  const indexed = parsed.terms.sort((a, b) => b.length - a.length)[0] ?? parsed.from ?? parsed.to ?? null;
  const matches: MailMessage[] = [];
  for (const entry of readable) {
    let query = db().collection(C.messages).where('accountId', '==', entry.account.id).where('deleted', '==', false);
    if (indexed) query = query.where('searchTokens', 'array-contains', indexed.toLowerCase());
    const snapshot = await query.orderBy('receivedAt', 'desc').limit(300).get();
    matches.push(...snapshot.docs.map((doc) => ({ ...(doc.data() as MailMessage), id: doc.id })).filter((message) => matchesSearch(message, parsed)));
  }
  const threadIds = [...new Set(matches.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).map((message) => message.threadId))].slice(0, limit);
  const threads = await getMany<MailThread>(C.threads, threadIds);
  return {
    threads: threadIds.map((id) => threads.get(id)).filter((thread): thread is MailThread => Boolean(thread && !thread.deleted)).map((thread) => summarize(thread)),
    searchedProvider: input.scope === 'provider',
    notes,
  };
}

/* ── retention ────────────────────────────────────────────────────────────────────────────── */

/** Delete expired cached bodies and abandoned uploads. Run daily by the worker. */
export async function retentionSweep(): Promise<{ bodies: number; uploads: number }> {
  const now = new Date().toISOString();
  let bodies = 0;
  for (let round = 0; round < 20; round += 1) {
    const snapshot = await db().collection(C.bodies).where('expiresAt', '<', now).limit(400).get();
    if (snapshot.empty) break;
    const batch = db().batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    bodies += snapshot.size;
    for (const group of chunk(snapshot.docs.map((doc) => doc.id), 400)) {
      const msgBatch = db().batch();
      group.forEach((id) => msgBatch.set(db().collection(C.messages).doc(id), { bodyState: 'none' }, { merge: true }));
      await msgBatch.commit().catch(() => {});
    }
  }
  let uploads = 0;
  const expired = await db().collection(C.uploads).where('expiresAt', '<', now).limit(200).get();
  for (const doc of expired.docs) {
    const path = doc.get('storagePath') as string | undefined;
    if (path) await getFirebaseAdminBucket().file(path).delete({ ignoreNotFound: true }).catch(() => {});
    await doc.ref.delete();
    uploads += 1;
  }
  return { bodies, uploads };
}

