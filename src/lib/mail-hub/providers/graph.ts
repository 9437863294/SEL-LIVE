/**
 * Microsoft Graph adapter (Microsoft 365 / Outlook).
 *
 * ── Identity ───────────────────────────────────────────────────────────────────────────────────
 *
 * Every request sends `Prefer: IdType="ImmutableId"`. Without it, a Graph message id changes when
 * the message moves folder, and "archive" would look like a delete followed by an unrelated new
 * message — taking the ERP's links and notes with it. Immutable ids survive moves, so the sync
 * engine sees a move as what it is.
 *
 * ── Change detection ───────────────────────────────────────────────────────────────────────────
 *
 * Per-folder delta queries (`mailFolders/{id}/messages/delta`). The first listing *is* a delta
 * round, bounded by `receivedDateTime ge <window>`; it ends in a delta link, which is the folder's
 * cursor from then on. A `410 Gone` / `syncStateNotFound` means the delta token expired, which
 * becomes a recovery listing. Change notifications (`/subscriptions`) only enqueue a sync; they
 * expire after at most seven days and are renewed by the worker, and lifecycle notifications
 * (`reauthorizationRequired`, `missed`) are handled by the webhook route.
 *
 * ── Shared mailboxes ───────────────────────────────────────────────────────────────────────────
 *
 * `mailbox` is `null` for the signed-in user's own mailbox, or a shared mailbox address reached
 * with `Mail.ReadWrite.Shared`. Sending "as" a shared mailbox always uses the *member's* own
 * token against `/users/{shared}/sendMail`, so Exchange itself enforces SendAs/SendOnBehalf — the
 * ERP cannot send as a mailbox the member has not been granted.
 */

import type { MailFolderRole, MailProviderCapabilities } from '../model.ts';
import { normalizeEmail, normalizeMessageId, parseSearchQuery, snippetOf } from '../rules.ts';
import { mapLimit, providerRequest, type TokenSource } from './http.ts';
import { extractAttachment, parseRawMessage } from './mime-parse.ts';
import {
  DEFAULT_CAPABILITIES,
  ProviderCursorExpiredError,
  ProviderError,
  ProviderNotFoundError,
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
  type ProviderWatchResult,
} from './types.ts';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const SELECT = [
  'id', 'conversationId', 'internetMessageId', 'subject', 'bodyPreview', 'from', 'toRecipients', 'ccRecipients',
  'bccRecipients', 'replyTo', 'sentDateTime', 'receivedDateTime', 'isRead', 'isDraft', 'flag', 'hasAttachments',
  'parentFolderId', 'changeKey',
].join(',');
const WELL_KNOWN: [string, MailFolderRole][] = [
  ['inbox', 'inbox'],
  ['sentitems', 'sent'],
  ['drafts', 'drafts'],
  ['archive', 'archive'],
  ['deleteditems', 'trash'],
  ['junkemail', 'spam'],
];
/** Subscriptions on messages may last at most 10,080 minutes. Six days leaves room to renew. */
const SUBSCRIPTION_LIFETIME_MS = 6 * 24 * 60 * 60_000;

interface GraphRecipient {
  emailAddress?: { name?: string; address?: string };
}

interface GraphMessage {
  id: string;
  conversationId?: string;
  internetMessageId?: string;
  subject?: string;
  bodyPreview?: string;
  from?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  bccRecipients?: GraphRecipient[];
  replyTo?: GraphRecipient[];
  sentDateTime?: string;
  receivedDateTime?: string;
  isRead?: boolean;
  isDraft?: boolean;
  flag?: { flagStatus?: string };
  hasAttachments?: boolean;
  parentFolderId?: string;
  changeKey?: string;
  '@removed'?: { reason?: string };
}

interface GraphFolder {
  id: string;
  displayName: string;
  parentFolderId?: string;
  childFolderCount?: number;
  unreadItemCount?: number;
  totalItemCount?: number;
}

const recipient = (entry: GraphRecipient | undefined) =>
  entry?.emailAddress?.address ? { name: entry.emailAddress.name?.trim() || null, address: normalizeEmail(entry.emailAddress.address) } : null;
const recipients = (list: GraphRecipient[] | undefined) =>
  (list ?? []).map(recipient).filter((entry): entry is NonNullable<ReturnType<typeof recipient>> => Boolean(entry));

export function graphHeader(message: GraphMessage): ProviderMessageHeader {
  return {
    stableKey: message.id,
    providerMessageId: message.id,
    providerThreadId: message.conversationId ?? null,
    threadKey: message.conversationId ?? message.id,
    // A Graph message is in exactly one folder, so its parent folder is the whole truth.
    providerFolderIds: message.parentFolderId ? [message.parentFolderId] : [],
    internetMessageId: normalizeMessageId(message.internetMessageId),
    inReplyTo: null,
    references: [],
    from: recipient(message.from),
    to: recipients(message.toRecipients),
    cc: recipients(message.ccRecipients),
    bcc: recipients(message.bccRecipients),
    replyTo: recipients(message.replyTo),
    subject: message.subject ?? '',
    snippet: snippetOf(message.bodyPreview ?? ''),
    sentAt: message.sentDateTime ?? null,
    receivedAt: message.receivedDateTime ?? message.sentDateTime ?? new Date().toISOString(),
    isRead: Boolean(message.isRead),
    isFlagged: message.flag?.flagStatus === 'flagged',
    isDraft: Boolean(message.isDraft),
    attachments: [],
    hasAttachments: Boolean(message.hasAttachments),
    sizeBytes: null,
    providerVersion: message.changeKey ?? null,
  };
}

/** Delta page → changes. `@removed` in a folder's delta means "no longer in this folder". */
export function graphDeltaChanges(values: GraphMessage[], folderId: string): ProviderChange[] {
  return values.map((value): ProviderChange =>
    value['@removed']
      ? { kind: 'remove', stableKey: value.id, scope: { folder: folderId } }
      : { kind: 'upsert', header: graphHeader(value), scope: 'authoritative' },
  );
}

export class GraphAdapter implements MailProviderAdapter {
  readonly provider = 'microsoft' as const;
  readonly capabilities: MailProviderCapabilities = DEFAULT_CAPABILITIES.microsoft;
  private readonly base: string;
  private readonly tokens: TokenSource;
  private readonly mailbox: string | null;

  constructor(tokens: TokenSource, mailbox: string | null = null) {
    this.tokens = tokens;
    this.mailbox = mailbox;
    this.base = mailbox ? `${GRAPH}/users/${encodeURIComponent(mailbox)}` : `${GRAPH}/me`;
  }

  private request<T>(url: string, init: Parameters<typeof providerRequest>[2] = {}) {
    return providerRequest<T>(this.tokens, url.startsWith('http') ? url : `${this.base}${url}`, {
      ...init,
      headers: { Prefer: 'IdType="ImmutableId", odata.maxpagesize=100', ...(init.headers ?? {}) },
    });
  }

  async getProfile(): Promise<ProviderProfile> {
    if (this.mailbox) {
      await this.request('/mailFolders/inbox?$select=id');
      return { emailAddress: normalizeEmail(this.mailbox), displayName: null, providerAccountId: normalizeEmail(this.mailbox), identities: [] };
    }
    const { data } = await this.request<{ id: string; displayName?: string; mail?: string; userPrincipalName?: string }>(
      `${GRAPH}/me?$select=id,displayName,mail,userPrincipalName,proxyAddresses`,
    );
    const email = normalizeEmail(data.mail || data.userPrincipalName || '');
    return { emailAddress: email, displayName: data.displayName ?? null, providerAccountId: data.id, identities: [] };
  }

  async listFolders(): Promise<ProviderFolder[]> {
    const roles = new Map<string, MailFolderRole>();
    const known = await mapLimit(WELL_KNOWN, 6, ([name]) => this.request<GraphFolder>(`/mailFolders/${name}?$select=id`));
    known.forEach((result, index) => {
      if (result.status === 'fulfilled') roles.set(result.value.data.id, WELL_KNOWN[index][1]);
    });

    const folders: GraphFolder[] = [];
    let next: string | null = '/mailFolders?$top=100&$select=id,displayName,parentFolderId,childFolderCount,unreadItemCount,totalItemCount';
    while (next) {
      const page: { data: { value: GraphFolder[]; '@odata.nextLink'?: string } } = await this.request(next);
      folders.push(...page.data.value);
      next = page.data['@odata.nextLink'] ?? null;
    }
    // One level of subfolders — enough for the Projects/Vendors style trees people keep, without
    // walking a 300-folder archive on every sync.
    const parents = folders.filter((folder) => (folder.childFolderCount ?? 0) > 0).slice(0, 25);
    const children = await mapLimit(parents, 5, (folder) =>
      this.request<{ value: GraphFolder[] }>(`/mailFolders/${folder.id}/childFolders?$top=100&$select=id,displayName,parentFolderId,unreadItemCount,totalItemCount`),
    );
    children.forEach((result) => {
      if (result.status === 'fulfilled') folders.push(...result.value.data.value);
    });

    return folders.map((folder) => {
      const role = roles.get(folder.id) ?? 'custom';
      return {
        providerFolderId: folder.id,
        name: folder.displayName,
        role,
        kind: 'folder',
        parentProviderFolderId: folder.parentFolderId && folders.some((entry) => entry.id === folder.parentFolderId) ? folder.parentFolderId : null,
        unreadCount: folder.unreadItemCount ?? null,
        totalCount: folder.totalItemCount ?? null,
        // Conversation History, Outbox, Sync Issues and the like are not mail anyone triages.
        synced: role !== 'custom' || !/^(conversation history|outbox|sync issues|rss|clutter)/i.test(folder.displayName),
      };
    });
  }

  listingScopes(folders: ProviderFolder[]): (string | null)[] {
    const order: MailFolderRole[] = ['inbox', 'sent', 'drafts', 'archive', 'custom', 'trash', 'spam'];
    return folders
      .filter((folder) => folder.synced)
      .sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role))
      .map((folder) => folder.providerFolderId);
  }

  async baselineCursors(): Promise<ProviderCursor[]> {
    // The delta listing produces each folder's cursor at its end.
    return [];
  }

  private async deltaPage(url: string, folderId: string) {
    try {
      const { data } = await this.request<{ value: GraphMessage[]; '@odata.nextLink'?: string; '@odata.deltaLink'?: string }>(url);
      return {
        changes: graphDeltaChanges(data.value ?? [], folderId),
        nextLink: data['@odata.nextLink'] ?? null,
        deltaLink: data['@odata.deltaLink'] ?? null,
      };
    } catch (error) {
      const detail = error instanceof ProviderError ? `${error.message} ${error.detail ?? ''}` : '';
      if (/HTTP 410|syncStateNotFound|resyncRequired/i.test(detail)) throw new ProviderCursorExpiredError(folderId);
      if (error instanceof ProviderNotFoundError) throw new ProviderCursorExpiredError(folderId, 'The folder no longer exists.');
      throw error;
    }
  }

  async listPage(input: { scope: string | null; pageToken: string | null; since: string | null }): Promise<ProviderListPage> {
    const folderId = input.scope as string;
    const url =
      input.pageToken ??
      `/mailFolders/${encodeURIComponent(folderId)}/messages/delta?$select=${SELECT}` +
        (input.since ? `&$filter=${encodeURIComponent(`receivedDateTime ge ${input.since}`)}` : '');
    const page = await this.deltaPage(url, folderId);
    return {
      changes: page.changes,
      nextPageToken: page.nextLink,
      cursor: page.deltaLink ? { scope: folderId, kind: 'graph-delta', value: page.deltaLink } : null,
    };
  }

  async changesSince(cursor: ProviderCursor): Promise<ProviderChangePage> {
    const page = await this.deltaPage(cursor.value, cursor.scope);
    const nextValue = page.nextLink ?? page.deltaLink ?? cursor.value;
    return { changes: page.changes, cursor: { ...cursor, value: nextValue }, more: Boolean(page.nextLink) };
  }

  async fetchHeader(providerMessageId: string): Promise<ProviderMessageHeader | null> {
    try {
      const { data } = await this.request<GraphMessage>(`/messages/${encodeURIComponent(providerMessageId)}?$select=${SELECT}`);
      return graphHeader(data);
    } catch (error) {
      if (error instanceof ProviderNotFoundError) return null;
      throw error;
    }
  }

  private async mime(providerMessageId: string): Promise<Buffer> {
    const { response } = await this.request(`/messages/${encodeURIComponent(providerMessageId)}/$value`, { raw: true });
    return Buffer.from(await response.arrayBuffer());
  }

  async fetchBody(providerMessageId: string) {
    return parseRawMessage(await this.mime(providerMessageId));
  }

  async fetchAttachment(providerMessageId: string, providerAttachmentId: string) {
    const found = await extractAttachment(await this.mime(providerMessageId), providerAttachmentId);
    if (!found) throw new ProviderNotFoundError('The attachment is no longer on the message.');
    return found;
  }

  async modify(providerMessageId: string, action: ProviderMessageAction): Promise<void> {
    const id = encodeURIComponent(providerMessageId);
    const patch = (body: Record<string, unknown>) =>
      this.request(`/messages/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const move = (destinationId: string) =>
      this.request(`/messages/${id}/move`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ destinationId }) });
    switch (action.type) {
      case 'markRead':
        await patch({ isRead: action.value });
        return;
      case 'flag':
        await patch({ flag: { flagStatus: action.value ? 'flagged' : 'notFlagged' } });
        return;
      case 'archive':
        await move('archive');
        return;
      case 'trash':
        await move('deleteditems');
        return;
      case 'untrash':
        await move('inbox');
        return;
      case 'move':
        await move(action.providerFolderId);
        return;
      case 'delete':
        await this.request(`/messages/${id}`, { method: 'DELETE', raw: true });
        return;
      case 'labels':
        // Outlook categories are not folders; the ERP exposes folders only.
        return;
    }
  }

  async send(input: ProviderSendInput) {
    const base = input.sendAsMailbox ? `${GRAPH}/users/${encodeURIComponent(input.sendAsMailbox)}` : this.base;
    await this.request(`${base}/sendMail`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: Buffer.from(input.raw).toString('base64'),
      raw: true,
    });
    // `sendMail` answers 202 with no body; the sent copy arrives through the next delta.
    return { providerMessageId: null };
  }

  async findSentByMessageId(messageIdHeader: string, sendAsMailbox?: string | null): Promise<boolean> {
    const id = messageIdHeader.startsWith('<') ? messageIdHeader : `<${messageIdHeader}>`;
    const filter = encodeURIComponent(`internetMessageId eq '${id.replace(/'/g, "''")}'`);
    const bases = [this.base, ...(sendAsMailbox ? [`${GRAPH}/users/${encodeURIComponent(sendAsMailbox)}`] : [])];
    for (const base of bases) {
      const { data } = await this.request<{ value: unknown[] }>(`${base}/messages?$filter=${filter}&$select=id&$top=1`).catch(() => ({ data: { value: [] } }));
      if (data.value?.length) return true;
    }
    return false;
  }

  async saveDraft(raw: Uint8Array, existingDraftId: string | null) {
    if (existingDraftId) await this.deleteDraft(existingDraftId);
    const { data } = await this.request<{ id: string }>('/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: Buffer.from(raw).toString('base64'),
    });
    return { providerDraftId: data.id };
  }

  async deleteDraft(providerDraftId: string) {
    await this.request(`/messages/${encodeURIComponent(providerDraftId)}`, { method: 'DELETE', raw: true, allowStatuses: [404] });
  }

  async search(query: string, limit: number): Promise<ProviderMessageHeader[]> {
    const parsed = parseSearchQuery(query);
    const kql = [
      ...parsed.terms,
      parsed.from ? `from:${parsed.from}` : '',
      parsed.to ? `to:${parsed.to}` : '',
      parsed.hasAttachment ? 'hasattachments:true' : '',
      parsed.after ? `received>=${parsed.after}` : '',
      parsed.before ? `received<${parsed.before}` : '',
    ].filter(Boolean).join(' ');
    const { data } = await this.request<{ value: GraphMessage[] }>(
      `/messages?$search=${encodeURIComponent(`"${kql.replace(/"/g, '')}"`)}&$top=${Math.min(100, limit)}&$select=${SELECT}`,
    );
    return (data.value ?? []).map(graphHeader).filter((header) => !parsed.unread || !header.isRead);
  }

  async watch(input: { notificationUrl: string | null; clientState: string; existingSubscriptionId: string | null }): Promise<ProviderWatchResult> {
    if (!input.notificationUrl) return { kind: 'imap-poll', subscriptionId: null, expiresAt: null };
    const expirationDateTime = new Date(Date.now() + SUBSCRIPTION_LIFETIME_MS).toISOString();
    if (input.existingSubscriptionId) {
      try {
        const { data } = await this.request<{ id: string; expirationDateTime: string }>(
          `${GRAPH}/subscriptions/${encodeURIComponent(input.existingSubscriptionId)}`,
          { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expirationDateTime }) },
        );
        return { kind: 'graph-subscription', subscriptionId: data.id, expiresAt: data.expirationDateTime };
      } catch (error) {
        if (!(error instanceof ProviderNotFoundError)) throw error;
      }
    }
    const resource = this.mailbox ? `users/${this.mailbox}/messages` : 'me/messages';
    const { data } = await this.request<{ id: string; expirationDateTime: string }>(`${GRAPH}/subscriptions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        changeType: 'created,updated,deleted',
        notificationUrl: input.notificationUrl,
        lifecycleNotificationUrl: `${input.notificationUrl}?lifecycle=1`,
        resource,
        expirationDateTime,
        clientState: input.clientState,
      }),
    });
    return { kind: 'graph-subscription', subscriptionId: data.id, expiresAt: data.expirationDateTime };
  }

  async stopWatch(subscriptionId: string | null): Promise<void> {
    if (!subscriptionId) return;
    await this.request(`${GRAPH}/subscriptions/${encodeURIComponent(subscriptionId)}`, { method: 'DELETE', raw: true, allowStatuses: [404] });
  }

  async revoke(): Promise<boolean> {
    return false;
  }

  /**
   * Proof of a delegated grant, using the member's own token: Exchange answers the shared
   * mailbox's inbox only if the member has FullAccess (or folder permission) on it. There is no
   * Graph call that tests SendAs without sending, but none is needed — sends go through
   * `/users/{shared}/sendMail` with this same token and Exchange refuses them without SendAs.
   */
  async verifyMailboxGrant(sharedAddress: string): Promise<ProviderGrantCheck> {
    const target = `${GRAPH}/users/${encodeURIComponent(normalizeEmail(sharedAddress))}/mailFolders/inbox?$select=id`;
    try {
      await this.request(target);
      return {
        read: 'verified',
        send: 'verified',
        method: 'graph-delegated',
        detail: 'Exchange granted this account access to the mailbox. Sending is enforced by Exchange SendAs/SendOnBehalf at send time.',
      };
    } catch (error) {
      if (error instanceof ProviderNotFoundError || (error instanceof ProviderError && /permission|denied|forbidden/i.test(`${error.message} ${error.detail}`))) {
        return { read: 'missing', send: 'missing', method: 'graph-delegated', detail: 'Exchange refused this account access to the mailbox.' };
      }
      throw error;
    }
  }
}
