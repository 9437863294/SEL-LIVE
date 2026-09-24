/**
 * IMAP/SMTP adapter — the company mailbox behind Roundcube, or any standards-compliant server.
 *
 * ── Change detection, without push ─────────────────────────────────────────────────────────────
 *
 * Serverless workers cannot hold an IDLE connection open, so IMAP is polled by the worker on a
 * controlled schedule (every few minutes, backing off when idle; see `worker.ts`). Each poll is made
 * as cheap as the server allows:
 *
 *   1. `STATUS` on every synced folder first. If UIDNEXT, the message count and (with CONDSTORE)
 *      HIGHESTMODSEQ are unchanged, the folder is skipped without being opened.
 *   2. A changed UIDVALIDITY means every UID in the folder was renumbered: the cursor is expired,
 *      and the engine runs a recovery listing.
 *   3. New mail is every UID above the highest one the cursor knows.
 *   4. Flag changes come from `FETCH … CHANGEDSINCE <modseq>` when the server has CONDSTORE; without
 *      it, the flags of the most recent 200 known messages are re-read.
 *   5. Removals are the known UIDs no longer present (`UID SEARCH ALL`, diffed against the cursor's
 *      compressed UID set).
 *
 * ── Identity ───────────────────────────────────────────────────────────────────────────────────
 *
 * A message is its location: `imap:<folder>:<UIDVALIDITY>:<UID>`. A move is a removal plus an
 * arrival, and conversation identity (for links, notes, assignment) comes from the References root,
 * which a move does not change.
 *
 * ── Security ───────────────────────────────────────────────────────────────────────────────────
 *
 * TLS is mandatory: implicit TLS or required STARTTLS, with certificate verification left on. The
 * host and ports come from an administrator's preset, never from the request (`resolveImapPreset`).
 */

import { ImapFlow, type FetchMessageObject, type ListResponse, type MessageStructureObject } from 'imapflow';
import nodemailer from 'nodemailer';

import type { MailFolderRole, MailImapServerPreset, MailProviderCapabilities } from '../model.ts';
import { imapThreadRoot, normalizeEmail, normalizeMessageId, parseReferences, parseSearchQuery } from '../rules.ts';
import { envelopeOf, stripBccHeader } from '../mime.ts';
import { extractAttachment, parseRawMessage } from './mime-parse.ts';
import {
  DEFAULT_CAPABILITIES,
  ProviderAuthError,
  ProviderCursorExpiredError,
  ProviderNotFoundError,
  ProviderUnavailableError,
  type MailProviderAdapter,
  type ProviderChange,
  type ProviderChangePage,
  type ProviderCursor,
  type ProviderFolder,
  type ProviderGrantCheck,
  type ProviderListPage,
  type ProviderMessageAction,
  type ProviderMessageHeader,
  type ProviderProfile,
  type ProviderSendInput,
} from './types.ts';

/* ── UID sets ─────────────────────────────────────────────────────────────────────────────── */

/** `[1,2,3,5,7,8]` → `1:3,5,7:8`. Keeps a cursor for a 50,000-message folder a few hundred bytes. */
export function compressUids(uids: number[]): string {
  const sorted = [...new Set(uids)].filter((uid) => Number.isInteger(uid) && uid > 0).sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i += 1) {
    const uid = sorted[i];
    if (uid === prev + 1) {
      prev = uid;
      continue;
    }
    if (start !== undefined) parts.push(start === prev ? String(start) : `${start}:${prev}`);
    start = uid;
    prev = uid;
  }
  return parts.join(',');
}

export function expandUids(value: string): number[] {
  const out: number[] = [];
  for (const part of value.split(',').filter(Boolean)) {
    const [a, b] = part.split(':').map(Number);
    if (!Number.isFinite(a)) continue;
    if (!Number.isFinite(b)) out.push(a);
    else for (let uid = a; uid <= b && out.length < 2_000_000; uid += 1) out.push(uid);
  }
  return out;
}

export interface ImapCursorValue {
  uidValidity: string;
  highestModSeq: string | null;
  uidNext: number;
  messages: number;
  uids: string;
}

export const imapMessageId = (path: string, uidValidity: string, uid: number) =>
  `imap:${encodeURIComponent(path)}:${uidValidity}:${uid}`;

export function parseImapMessageId(id: string): { path: string; uidValidity: string; uid: number } | null {
  const match = id.match(/^imap:([^:]+):(\d+):(\d+)$/);
  if (!match) return null;
  return { path: decodeURIComponent(match[1]), uidValidity: match[2], uid: Number(match[3]) };
}

function roleFromSpecialUse(entry: Pick<ListResponse, 'specialUse' | 'path'>): MailFolderRole {
  switch (entry.specialUse) {
    case '\\Inbox':
      return 'inbox';
    case '\\Sent':
      return 'sent';
    case '\\Drafts':
      return 'drafts';
    case '\\Trash':
      return 'trash';
    case '\\Junk':
      return 'spam';
    case '\\Archive':
      return 'archive';
    case '\\All':
      return 'all';
    default:
      return entry.path.toUpperCase() === 'INBOX' ? 'inbox' : 'custom';
  }
}

function hasAttachmentParts(node: MessageStructureObject | undefined): boolean {
  if (!node) return false;
  const disposition = (node.disposition ?? '').toLowerCase();
  if (disposition === 'attachment') return true;
  if (node.dispositionParameters?.filename || (node.parameters?.name && !node.type?.startsWith('text/'))) return true;
  return (node.childNodes ?? []).some(hasAttachmentParts);
}

export function imapHeaderFrom(path: string, uidValidity: string, message: FetchMessageObject): ProviderMessageHeader {
  const envelope = message.envelope ?? {};
  const headerText = message.headers?.toString('utf8') ?? '';
  const references = parseReferences(headerText.match(/^references:\s*([\s\S]*?)(?:\r?\n(?!\s)|$)/im)?.[1] ?? null);
  const messageId = normalizeMessageId(envelope.messageId);
  const inReplyTo = normalizeMessageId(envelope.inReplyTo);
  const address = (list: { name?: string; address?: string }[] | undefined) =>
    (list ?? []).filter((entry) => entry.address).map((entry) => ({ name: entry.name?.trim() || null, address: normalizeEmail(entry.address) }));
  const flags = message.flags ?? new Set<string>();
  const internal = message.internalDate ? new Date(message.internalDate) : new Date();
  const sent = envelope.date ? new Date(envelope.date) : null;
  const id = imapMessageId(path, uidValidity, message.uid);
  return {
    stableKey: id,
    providerMessageId: id,
    providerThreadId: null,
    threadKey: imapThreadRoot({ messageId, inReplyTo, references }) ?? id,
    providerFolderIds: [path],
    internetMessageId: messageId,
    inReplyTo,
    references,
    from: address(envelope.from)[0] ?? null,
    to: address(envelope.to),
    cc: address(envelope.cc),
    bcc: address(envelope.bcc),
    replyTo: address(envelope.replyTo),
    subject: envelope.subject ?? '',
    snippet: '',
    sentAt: sent && !Number.isNaN(sent.getTime()) ? sent.toISOString() : null,
    receivedAt: internal.toISOString(),
    isRead: flags.has('\\Seen'),
    isFlagged: flags.has('\\Flagged'),
    isDraft: flags.has('\\Draft'),
    attachments: [],
    hasAttachments: hasAttachmentParts(message.bodyStructure),
    sizeBytes: message.size ?? null,
    providerVersion: message.modseq != null ? String(message.modseq) : null,
  };
}

/* ── the adapter ──────────────────────────────────────────────────────────────────────────── */

export interface ImapConnectionConfig {
  preset: MailImapServerPreset;
  username: string;
  password: string;
  emailAddress: string;
}

const FETCH_QUERY = { uid: true, envelope: true, flags: true, bodyStructure: true, internalDate: true, size: true, headers: ['references'] };

export class ImapAdapter implements MailProviderAdapter {
  readonly provider = 'imap' as const;
  readonly capabilities: MailProviderCapabilities = DEFAULT_CAPABILITIES.imap;
  private client: ImapFlow | null = null;
  private readonly config: ImapConnectionConfig;

  constructor(config: ImapConnectionConfig) {
    this.config = config;
  }

  private async imap(): Promise<ImapFlow> {
    if (this.client?.usable) return this.client;
    const { preset } = this.config;
    const client = new ImapFlow({
      host: preset.imapHost,
      port: preset.imapPort,
      secure: preset.imapSecurity === 'tls',
      doSTARTTLS: preset.imapSecurity === 'starttls' ? true : undefined,
      auth: { user: this.config.username, pass: this.config.password },
      logger: false,
      qresync: true,
      disableAutoIdle: true,
      connectionTimeout: 20_000,
      greetingTimeout: 15_000,
      socketTimeout: 60_000,
      tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    });
    try {
      await client.connect();
    } catch (error) {
      const text = String((error as { responseText?: string; message?: string })?.responseText ?? (error as Error)?.message ?? error);
      if ((error as { authenticationFailed?: boolean })?.authenticationFailed || /auth|login|credentials|password/i.test(text)) {
        throw new ProviderAuthError('The mail server rejected the username or password.', text.slice(0, 200));
      }
      throw new ProviderUnavailableError('The mail server could not be reached.', text.slice(0, 200));
    }
    this.client = client;
    return client;
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (client?.usable) await client.logout().catch(() => client.close());
  }

  private async withMailbox<T>(path: string, task: (client: ImapFlow, mailbox: { uidValidity: string; highestModSeq: string | null; uidNext: number; exists: number }) => Promise<T>): Promise<T> {
    const client = await this.imap();
    const lock = await client.getMailboxLock(path);
    try {
      const box = client.mailbox;
      if (!box) throw new ProviderNotFoundError(`Folder ${path} could not be opened.`);
      return await task(client, {
        uidValidity: String(box.uidValidity),
        highestModSeq: box.highestModseq != null ? String(box.highestModseq) : null,
        uidNext: box.uidNext,
        exists: box.exists,
      });
    } finally {
      lock.release();
    }
  }

  async getProfile(): Promise<ProviderProfile> {
    await this.imap();
    return {
      emailAddress: normalizeEmail(this.config.emailAddress),
      displayName: null,
      providerAccountId: `imap:${this.config.preset.imapHost}:${this.config.username}`,
      identities: [],
    };
  }

  /** Connect to both servers without syncing anything — the check run before credentials are saved. */
  async verifyCredentials(): Promise<void> {
    await this.imap();
    const transport = this.smtp();
    try {
      await transport.verify();
    } catch (error) {
      const text = String((error as Error)?.message ?? error);
      if (/auth|535|534|credentials/i.test(text)) throw new ProviderAuthError('The outgoing mail server rejected the username or password.', text.slice(0, 200));
      throw new ProviderUnavailableError('The outgoing mail server could not be reached.', text.slice(0, 200));
    } finally {
      transport.close();
    }
  }

  async listFolders(): Promise<ProviderFolder[]> {
    const client = await this.imap();
    const list = await client.list({ statusQuery: { messages: true, unseen: true, uidNext: true, uidValidity: true, highestModseq: true } });
    return list
      .filter((entry) => !entry.flags.has('\\Noselect') && !entry.flags.has('\\NonExistent'))
      .map((entry) => {
        const role = roleFromSpecialUse(entry);
        return {
          providerFolderId: entry.path,
          name: role === 'inbox' ? 'Inbox' : entry.name,
          role,
          kind: 'folder' as const,
          parentProviderFolderId: entry.parentPath || null,
          unreadCount: entry.status?.unseen ?? null,
          totalCount: entry.status?.messages ?? null,
          // `\All` (Gmail-over-IMAP style) duplicates every other folder.
          synced: role !== 'all',
          imap: {
            uidValidity: entry.status?.uidValidity != null ? String(entry.status.uidValidity) : null,
            uidNext: entry.status?.uidNext ?? null,
            highestModSeq: entry.status?.highestModseq != null ? String(entry.status.highestModseq) : null,
          },
        };
      });
  }

  listingScopes(folders: ProviderFolder[]): (string | null)[] {
    const order: MailFolderRole[] = ['inbox', 'sent', 'drafts', 'archive', 'custom', 'trash', 'spam'];
    return folders.filter((folder) => folder.synced).sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role)).map((folder) => folder.providerFolderId);
  }

  async baselineCursors(): Promise<ProviderCursor[]> {
    // The last page of each folder's listing records the snapshot it listed; see `listPage`.
    return [];
  }

  private async fetchHeaders(client: ImapFlow, path: string, uidValidity: string, uids: number[]): Promise<ProviderMessageHeader[]> {
    if (!uids.length) return [];
    const headers: ProviderMessageHeader[] = [];
    for await (const message of client.fetch(compressUids(uids), FETCH_QUERY, { uid: true })) {
      headers.push(imapHeaderFrom(path, uidValidity, message));
    }
    return headers;
  }

  /**
   * Newest first, one page at a time. The first page snapshots the window's UIDs (and the
   * mailbox's MODSEQ) into the page token, and the final page turns that snapshot into the folder's
   * cursor — so anything that arrives mid-listing has a UID above the snapshot and is picked up as
   * new by the first incremental pass.
   */
  async listPage(input: { scope: string | null; pageToken: string | null; since: string | null; pageSize: number }): Promise<ProviderListPage> {
    const path = input.scope as string;
    return this.withMailbox(path, async (client, box) => {
      let snapshot: { uids: string; offset: number; uidValidity: string; highestModSeq: string | null; uidNext: number; messages: number };
      if (input.pageToken) snapshot = JSON.parse(input.pageToken);
      else {
        const found = (await client.search(input.since ? { since: new Date(input.since) } : { all: true }, { uid: true })) || [];
        snapshot = { uids: compressUids(found), offset: 0, uidValidity: box.uidValidity, highestModSeq: box.highestModSeq, uidNext: box.uidNext, messages: box.exists };
      }
      if (snapshot.uidValidity !== box.uidValidity) throw new ProviderCursorExpiredError(path);

      const all = expandUids(snapshot.uids).sort((a, b) => b - a);
      const slice = all.slice(snapshot.offset, snapshot.offset + input.pageSize);
      const headers = await this.fetchHeaders(client, path, box.uidValidity, slice);
      const done = snapshot.offset + input.pageSize >= all.length;
      const cursorValue: ImapCursorValue = {
        uidValidity: snapshot.uidValidity,
        highestModSeq: snapshot.highestModSeq,
        uidNext: snapshot.uidNext,
        messages: snapshot.messages,
        uids: snapshot.uids,
      };
      return {
        changes: headers.map((header): ProviderChange => ({ kind: 'upsert', header, scope: 'authoritative' })),
        nextPageToken: done ? null : JSON.stringify({ ...snapshot, offset: snapshot.offset + input.pageSize }),
        cursor: done ? { scope: path, kind: 'imap-modseq', value: JSON.stringify(cursorValue) } : null,
      };
    });
  }

  async changesSince(cursor: ProviderCursor): Promise<ProviderChangePage> {
    const path = cursor.scope;
    const state = JSON.parse(cursor.value) as ImapCursorValue;
    const client = await this.imap();

    const status = await client.status(path, { uidNext: true, uidValidity: true, highestModseq: true, messages: true }).catch((error) => {
      if (/nonexistent|not exist|unknown mailbox/i.test(String(error?.responseText ?? error?.message))) throw new ProviderCursorExpiredError(path, 'The folder no longer exists.');
      throw error;
    });
    if (status.uidValidity != null && String(status.uidValidity) !== state.uidValidity) throw new ProviderCursorExpiredError(path);
    const modseq = status.highestModseq != null ? String(status.highestModseq) : null;
    const unchanged = status.uidNext === state.uidNext && status.messages === state.messages && (modseq === null ? false : modseq === state.highestModSeq);
    // With CONDSTORE an unchanged folder is skipped outright. Without it, flags may still have
    // changed, so the folder is opened for the cheap recent-flags pass below.
    if (unchanged) return { changes: [], cursor, more: false };

    return this.withMailbox(path, async (client) => {
      const known = expandUids(state.uids);
      const knownSet = new Set(known);
      const current = ((await client.search({ all: true }, { uid: true })) || []) as number[];
      const currentSet = new Set(current);
      const maxKnown = known.length ? Math.max(...known) : 0;
      const arrivals = current.filter((uid) => uid > maxKnown && !knownSet.has(uid)).sort((a, b) => a - b);
      const newBatch = arrivals.slice(0, 500);
      const removed = known.filter((uid) => !currentSet.has(uid));

      const changedFlags: number[] = [];
      if (state.highestModSeq && modseq) {
        for await (const message of client.fetch('1:*', { uid: true, flags: true }, { uid: true, changedSince: BigInt(state.highestModSeq) })) {
          if (knownSet.has(message.uid)) changedFlags.push(message.uid);
        }
      } else {
        changedFlags.push(...known.filter((uid) => currentSet.has(uid)).sort((a, b) => b - a).slice(0, 200));
      }

      const uidValidity = state.uidValidity;
      const headers = await this.fetchHeaders(client, path, uidValidity, [...new Set([...newBatch, ...changedFlags])]);
      const changes: ProviderChange[] = [
        ...headers.map((header): ProviderChange => ({ kind: 'upsert', header, scope: 'authoritative' })),
        ...removed.map((uid): ProviderChange => ({ kind: 'remove', stableKey: imapMessageId(path, uidValidity, uid), scope: 'global' })),
      ];
      const nextKnown = [...known.filter((uid) => currentSet.has(uid)), ...newBatch];
      const more = arrivals.length > newBatch.length;
      const next: ImapCursorValue = {
        uidValidity,
        highestModSeq: more ? state.highestModSeq : (modseq ?? state.highestModSeq),
        uidNext: more ? Math.max(...newBatch, 0) + 1 : (status.uidNext ?? state.uidNext),
        messages: more ? state.messages : (status.messages ?? state.messages),
        uids: compressUids(nextKnown),
      };
      return { changes, cursor: { ...cursor, value: JSON.stringify(next) }, more };
    });
  }

  async fetchHeader(providerMessageId: string): Promise<ProviderMessageHeader | null> {
    const ref = parseImapMessageId(providerMessageId);
    if (!ref) return null;
    return this.withMailbox(ref.path, async (client, box) => {
      if (box.uidValidity !== ref.uidValidity) return null;
      const headers = await this.fetchHeaders(client, ref.path, ref.uidValidity, [ref.uid]);
      return headers[0] ?? null;
    });
  }

  private async source(providerMessageId: string): Promise<Buffer> {
    const ref = parseImapMessageId(providerMessageId);
    if (!ref) throw new ProviderNotFoundError();
    return this.withMailbox(ref.path, async (client, box) => {
      if (box.uidValidity !== ref.uidValidity) throw new ProviderNotFoundError();
      const message = await client.fetchOne(String(ref.uid), { source: true }, { uid: true });
      if (!message || !message.source) throw new ProviderNotFoundError();
      return message.source;
    });
  }

  async fetchBody(providerMessageId: string) {
    return parseRawMessage(await this.source(providerMessageId));
  }

  async fetchAttachment(providerMessageId: string, providerAttachmentId: string) {
    const found = await extractAttachment(await this.source(providerMessageId), providerAttachmentId);
    if (!found) throw new ProviderNotFoundError('The attachment is no longer on the message.');
    return found;
  }

  async modify(providerMessageId: string, action: ProviderMessageAction, folders: ProviderFolder[]): Promise<void> {
    const ref = parseImapMessageId(providerMessageId);
    if (!ref) throw new ProviderNotFoundError();
    const byRole = (role: MailFolderRole) => folders.find((folder) => folder.role === role)?.providerFolderId ?? null;
    await this.withMailbox(ref.path, async (client, box) => {
      if (box.uidValidity !== ref.uidValidity) throw new ProviderNotFoundError('The message has moved; refresh and try again.');
      const uid = String(ref.uid);
      switch (action.type) {
        case 'markRead':
          await (action.value ? client.messageFlagsAdd(uid, ['\\Seen'], { uid: true }) : client.messageFlagsRemove(uid, ['\\Seen'], { uid: true }));
          return;
        case 'flag':
          await (action.value ? client.messageFlagsAdd(uid, ['\\Flagged'], { uid: true }) : client.messageFlagsRemove(uid, ['\\Flagged'], { uid: true }));
          return;
        case 'archive': {
          const target = byRole('archive');
          if (!target) throw new ProviderNotFoundError('This mailbox has no Archive folder.');
          await client.messageMove(uid, target, { uid: true });
          return;
        }
        case 'trash': {
          const target = byRole('trash');
          if (target && target !== ref.path) await client.messageMove(uid, target, { uid: true });
          else await client.messageDelete(uid, { uid: true });
          return;
        }
        case 'untrash': {
          await client.messageMove(uid, byRole('inbox') ?? 'INBOX', { uid: true });
          return;
        }
        case 'move':
          await client.messageMove(uid, action.providerFolderId, { uid: true });
          return;
        case 'delete':
          await client.messageDelete(uid, { uid: true });
          return;
        case 'labels':
          return;
      }
    });
  }

  private smtp() {
    const { preset } = this.config;
    return nodemailer.createTransport({
      host: preset.smtpHost,
      port: preset.smtpPort,
      secure: preset.smtpSecurity === 'tls',
      requireTLS: preset.smtpSecurity === 'starttls',
      auth: { user: this.config.username, pass: this.config.password },
      tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
      connectionTimeout: 20_000,
      greetingTimeout: 15_000,
      socketTimeout: 60_000,
    });
  }

  async send(input: ProviderSendInput) {
    const envelope = envelopeOf(input.raw);
    if (!envelope.from || !envelope.to.length) throw new Error('The message has no sender or no recipients.');
    const transport = this.smtp();
    try {
      // Bcc recipients are in the envelope, never in the transmitted headers.
      await transport.sendMail({ envelope: { from: envelope.from, to: envelope.to }, raw: stripBccHeader(input.raw) });
    } catch (error) {
      const text = String((error as Error)?.message ?? error);
      if (/535|534|auth/i.test(text)) throw new ProviderAuthError('The outgoing mail server rejected the stored password.', text.slice(0, 200));
      if (/^4\d\d|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|greeting/i.test(text)) throw new ProviderUnavailableError('The outgoing mail server is unavailable.', text.slice(0, 200));
      throw error;
    } finally {
      transport.close();
    }
    if (this.config.preset.appendSentCopy !== false) {
      // Most IMAP servers do not file SMTP-submitted mail in Sent. The copy keeps its Bcc header,
      // as every mail client's sent copy does — only the sender sees it.
      const folders = await this.listFolders().catch(() => []);
      const sent = folders.find((folder) => folder.role === 'sent')?.providerFolderId;
      if (sent) await (await this.imap()).append(sent, Buffer.from(input.raw), ['\\Seen']).catch(() => false);
    }
    return { providerMessageId: null };
  }

  async findSentByMessageId(messageIdHeader: string): Promise<boolean> {
    const folders = await this.listFolders();
    const sent = folders.find((folder) => folder.role === 'sent')?.providerFolderId;
    if (!sent) return false;
    return this.withMailbox(sent, async (client) => {
      const found = (await client.search({ header: { 'message-id': messageIdHeader } }, { uid: true })) || [];
      return found.length > 0;
    });
  }

  async saveDraft(raw: Uint8Array, existingDraftId: string | null) {
    const folders = await this.listFolders();
    const drafts = folders.find((folder) => folder.role === 'drafts')?.providerFolderId;
    if (!drafts) throw new ProviderNotFoundError('This mailbox has no Drafts folder.');
    if (existingDraftId) await this.deleteDraft(existingDraftId).catch(() => {});
    const client = await this.imap();
    const result = await client.append(drafts, Buffer.from(raw), ['\\Draft', '\\Seen']);
    if (!result || !result.uid) return { providerDraftId: '' };
    return { providerDraftId: imapMessageId(drafts, String(result.uidValidity ?? ''), result.uid) };
  }

  async deleteDraft(providerDraftId: string) {
    const ref = parseImapMessageId(providerDraftId);
    if (!ref) return;
    await this.withMailbox(ref.path, async (client, box) => {
      if (box.uidValidity === ref.uidValidity) await client.messageDelete(String(ref.uid), { uid: true });
    });
  }

  async search(query: string, limit: number): Promise<ProviderMessageHeader[]> {
    const parsed = parseSearchQuery(query);
    const folders = await this.listFolders();
    const results: ProviderMessageHeader[] = [];
    for (const folder of folders.filter((entry) => entry.synced && ['inbox', 'sent', 'archive'].includes(entry.role))) {
      const found = await this.withMailbox(folder.providerFolderId, async (client, box) => {
        const criteria: Record<string, unknown> = {};
        if (parsed.terms.length) criteria.text = parsed.terms.join(' ');
        if (parsed.from) criteria.from = parsed.from;
        if (parsed.to) criteria.to = parsed.to;
        if (parsed.unread) criteria.seen = false;
        if (parsed.after) criteria.since = new Date(parsed.after);
        if (parsed.before) criteria.before = new Date(parsed.before);
        const uids = ((await client.search(Object.keys(criteria).length ? criteria : { all: true }, { uid: true })) || []) as number[];
        return this.fetchHeaders(client, folder.providerFolderId, box.uidValidity, uids.sort((a, b) => b - a).slice(0, limit));
      });
      results.push(...found);
      if (results.length >= limit) break;
    }
    return results.filter((header) => !parsed.hasAttachment || header.hasAttachments).slice(0, limit);
  }

  async revoke(): Promise<boolean> {
    // A password cannot be revoked by the ERP; deleting the sealed copy is the whole of it.
    return false;
  }

  /**
   * On servers with a shared namespace (Dovecot ACLs, Cyrus, Exchange's IMAP), a folder the member
   * has been granted appears in the member's *own* listing. Finding the shared address there is
   * the server saying yes. Sending as it is verified only when the administrator has told the ERP
   * that the SMTP server enforces sender authorization — otherwise the ERP cannot know, and says so.
   */
  async verifyMailboxGrant(sharedAddress: string): Promise<ProviderGrantCheck> {
    const client = await this.imap();
    const list = await client.list();
    const wanted = normalizeEmail(sharedAddress);
    const local = wanted.split('@')[0];
    const visible = list.some((entry) => {
      const path = entry.path.toLowerCase();
      return path.includes(wanted) || (/(^|[./])(shared|public|other users)/i.test(entry.path) && path.split(entry.delimiter || '/').includes(local));
    });
    return {
      read: visible ? 'verified' : 'missing',
      send: visible ? (this.config.preset.smtpEnforcesSender ? 'verified' : 'unverified') : 'missing',
      method: 'imap-shared-namespace',
      detail: visible
        ? this.config.preset.smtpEnforcesSender
          ? 'The shared mailbox is visible to this login, and the SMTP server enforces sender authorization.'
          : 'The shared mailbox is visible to this login. The SMTP server is not marked as enforcing sender authorization, so sending is not verified.'
        : 'The mail server does not show this mailbox to this login.',
    };
  }
}
