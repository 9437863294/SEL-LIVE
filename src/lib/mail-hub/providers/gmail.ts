/**
 * Gmail API adapter.
 *
 * Change detection: `users.watch` publishes to a Pub/Sub topic whenever the mailbox changes; the
 * push endpoint (`/api/mail-hub/webhooks/gmail`) only enqueues a sync. The sync itself reads
 * `users.history.list` from the stored history id — so a lost or duplicated notification costs a
 * little latency, never a message. History older than about a week returns 404, which becomes
 * `ProviderCursorExpiredError` and a recovery listing. Watches expire after seven days and are
 * renewed daily by the worker.
 *
 * The adapter holds no credentials. It is given a `TokenSource`, which the server factory backs
 * with the sealed refresh token (`oauth.ts#accessTokenFor`).
 */

import type { MailProviderCapabilities } from '../model.ts';
import { normalizeEmail, parseSearchQuery } from '../rules.ts';
import {
  base64UrlDecode,
  base64UrlEncode,
  mapLimit,
  providerRequest,
  type TokenSource,
} from './http.ts';
import {
  GMAIL_ALL_MAIL,
  gmailBodyFromMessage,
  gmailFolders,
  gmailHeaderFromMessage,
  reduceGmailHistory,
  type GmailHistoryRecord,
  type GmailLabel,
  type GmailMessage,
} from './gmail-map.ts';
import {
  DEFAULT_CAPABILITIES,
  ProviderAuthError,
  ProviderCursorExpiredError,
  ProviderNotFoundError,
  ProviderRateLimitError,
  ProviderUnsupportedError,
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

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const UPLOAD = 'https://gmail.googleapis.com/upload/gmail/v1/users/me';
const METADATA_HEADERS = ['From', 'To', 'Cc', 'Bcc', 'Reply-To', 'Subject', 'Date', 'Message-ID', 'In-Reply-To', 'References'];
/** Above this, `raw` in a JSON body gets unwieldy; the media upload endpoint takes the bytes. */
const JSON_SEND_LIMIT = 4 * 1024 * 1024;

export class GmailAdapter implements MailProviderAdapter {
  readonly provider = 'gmail' as const;
  readonly capabilities: MailProviderCapabilities = DEFAULT_CAPABILITIES.gmail;

  private readonly tokens: TokenSource;
  private readonly options: { pubsubTopic?: string | null };

  constructor(tokens: TokenSource, options: { pubsubTopic?: string | null } = {}) {
    this.tokens = tokens;
    this.options = options;
  }

  private request<T>(path: string, init: Parameters<typeof providerRequest>[2] = {}) {
    return providerRequest<T>(this.tokens, path.startsWith('http') ? path : `${API}${path}`, init);
  }

  async getProfile(): Promise<ProviderProfile> {
    const { data } = await this.request<{ emailAddress: string; historyId: string }>('/profile');
    const sendAs = await this.request<{ sendAs?: { sendAsEmail: string; displayName?: string; isPrimary?: boolean; verificationStatus?: string }[] }>(
      '/settings/sendAs',
    ).catch(() => ({ data: { sendAs: [] } }));
    const primary = sendAs.data.sendAs?.find((entry) => entry.isPrimary);
    return {
      emailAddress: normalizeEmail(data.emailAddress),
      displayName: primary?.displayName || null,
      providerAccountId: normalizeEmail(data.emailAddress),
      identities: (sendAs.data.sendAs ?? [])
        .filter((entry) => !entry.isPrimary)
        .map((entry) => ({
          address: normalizeEmail(entry.sendAsEmail),
          name: entry.displayName || null,
          verified: entry.verificationStatus === 'accepted',
        })),
    };
  }

  async listFolders(): Promise<ProviderFolder[]> {
    const { data } = await this.request<{ labels?: GmailLabel[] }>('/labels');
    const labels = data.labels ?? [];
    // Counts are only on labels.get. Fetch them for the labels people look at.
    const wanted = labels.filter((label) => ['INBOX', 'SPAM', 'DRAFT'].includes(label.id) || label.type === 'user').slice(0, 40);
    const detailed = await mapLimit(wanted, 8, (label) => this.request<GmailLabel>(`/labels/${encodeURIComponent(label.id)}`));
    const byId = new Map(labels.map((label) => [label.id, label]));
    detailed.forEach((result) => {
      if (result.status === 'fulfilled') byId.set(result.value.data.id, result.value.data);
    });
    return gmailFolders([...byId.values()]);
  }

  listingScopes(): (string | null)[] {
    // Labels are not locations: one listing over the whole mailbox covers every label.
    return [null];
  }

  async baselineCursors(): Promise<ProviderCursor[]> {
    const { data } = await this.request<{ historyId: string }>('/profile');
    return [{ scope: 'account', kind: 'gmail-history', value: JSON.stringify({ start: data.historyId, pageToken: null }) }];
  }

  private async headersFor(ids: string[]): Promise<{ headers: ProviderMessageHeader[]; missing: string[]; failed: string[] }> {
    const query = METADATA_HEADERS.map((header) => `metadataHeaders=${encodeURIComponent(header)}`).join('&');
    const results = await mapLimit(ids, 10, (id) => this.request<GmailMessage>(`/messages/${encodeURIComponent(id)}?format=metadata&${query}`));
    const headers: ProviderMessageHeader[] = [];
    const missing: string[] = [];
    const failed: string[] = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') headers.push(gmailHeaderFromMessage(result.value.data));
      else if (result.reason instanceof ProviderNotFoundError) missing.push(ids[index]);
      else if (result.reason instanceof ProviderAuthError || result.reason instanceof ProviderRateLimitError) throw result.reason;
      else failed.push(ids[index]);
    });
    return { headers, missing, failed };
  }

  async listPage(input: { pageToken: string | null; since: string | null; pageSize: number }): Promise<ProviderListPage> {
    const params = new URLSearchParams({ maxResults: String(Math.min(500, input.pageSize)) });
    if (input.since) params.set('q', `after:${Math.floor(Date.parse(input.since) / 1000)}`);
    if (input.pageToken) params.set('pageToken', input.pageToken);
    const { data } = await this.request<{ messages?: { id: string }[]; nextPageToken?: string }>(`/messages?${params.toString()}`);
    const { headers, failed } = await this.headersFor((data.messages ?? []).map((entry) => entry.id));
    return {
      changes: headers.map((header) => ({ kind: 'upsert', header, scope: 'authoritative' })),
      nextPageToken: data.nextPageToken ?? null,
      failedIds: failed,
    };
  }

  async changesSince(cursor: ProviderCursor): Promise<ProviderChangePage> {
    const state = JSON.parse(cursor.value) as { start: string; pageToken: string | null };
    const params = new URLSearchParams({ startHistoryId: state.start, maxResults: '500' });
    ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved'].forEach((type) => params.append('historyTypes', type));
    if (state.pageToken) params.set('pageToken', state.pageToken);

    let data: { history?: GmailHistoryRecord[]; nextPageToken?: string; historyId?: string };
    try {
      data = (await this.request<typeof data>(`/history?${params.toString()}`)).data;
    } catch (error) {
      // "Requested entity was not found": the history id is older than Gmail keeps.
      if (error instanceof ProviderNotFoundError) throw new ProviderCursorExpiredError(cursor.scope);
      throw error;
    }

    const { fetch, deleted } = reduceGmailHistory(data.history ?? []);
    const { headers, missing, failed } = await this.headersFor(fetch);
    const changes: ProviderChange[] = [
      ...headers.map((header): ProviderChange => ({ kind: 'upsert', header, scope: 'authoritative' })),
      ...[...deleted, ...missing].map((id): ProviderChange => ({ kind: 'remove', stableKey: id, scope: 'global' })),
    ];
    const more = Boolean(data.nextPageToken);
    // Mid-way through a history walk, keep the original start and the page token; at the end,
    // the response's historyId is the new start.
    const next = more ? { start: state.start, pageToken: data.nextPageToken } : { start: data.historyId ?? state.start, pageToken: null };
    return { changes, cursor: { ...cursor, value: JSON.stringify(next) }, more, failedIds: failed };
  }

  async fetchHeader(providerMessageId: string): Promise<ProviderMessageHeader | null> {
    const { headers, missing, failed } = await this.headersFor([providerMessageId]);
    if (missing.length) return null;
    if (failed.length) throw new Error('The message could not be fetched.');
    return headers[0] ?? null;
  }

  async fetchBody(providerMessageId: string) {
    const { data } = await this.request<GmailMessage>(`/messages/${encodeURIComponent(providerMessageId)}?format=full`);
    return gmailBodyFromMessage(data, (encoded) => base64UrlDecode(encoded).toString('utf8'));
  }

  async fetchAttachment(providerMessageId: string, providerAttachmentId: string) {
    const body = await this.fetchBody(providerMessageId);
    const meta = body.attachments.find((entry) => entry.providerAttachmentId === providerAttachmentId);
    if (!meta) throw new ProviderNotFoundError('The attachment is no longer on the message.');
    const { data } = await this.request<{ data: string }>(
      `/messages/${encodeURIComponent(providerMessageId)}/attachments/${encodeURIComponent(providerAttachmentId)}`,
    );
    return { filename: meta.filename, contentType: meta.contentType, content: base64UrlDecode(data.data) };
  }

  async modify(providerMessageId: string, action: ProviderMessageAction): Promise<void> {
    const id = encodeURIComponent(providerMessageId);
    const labels = (add: string[], remove: string[]) =>
      this.request(`/messages/${id}/modify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }),
      });
    switch (action.type) {
      case 'markRead':
        await (action.value ? labels([], ['UNREAD']) : labels(['UNREAD'], []));
        return;
      case 'flag':
        await (action.value ? labels(['STARRED'], []) : labels([], ['STARRED']));
        return;
      case 'archive':
        await labels([], ['INBOX']);
        return;
      case 'trash':
        await this.request(`/messages/${id}/trash`, { method: 'POST' });
        return;
      case 'untrash':
        await this.request(`/messages/${id}/untrash`, { method: 'POST' });
        return;
      case 'move':
        // "Move" to a label is Gmail's own meaning: gain the label, leave the inbox.
        if (action.providerFolderId === 'INBOX') await labels(['INBOX'], []);
        else if (action.providerFolderId === GMAIL_ALL_MAIL) await labels([], ['INBOX']);
        else await labels([action.providerFolderId], ['INBOX']);
        return;
      case 'labels':
        await labels(action.add.filter((label) => label !== GMAIL_ALL_MAIL), action.remove.filter((label) => label !== GMAIL_ALL_MAIL));
        return;
      case 'delete':
        throw new ProviderUnsupportedError('Gmail messages are moved to Trash; the ERP does not hold permission to delete them permanently.');
    }
  }

  async send(input: ProviderSendInput) {
    if (input.raw.byteLength <= JSON_SEND_LIMIT) {
      const { data } = await this.request<{ id: string }>('/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: base64UrlEncode(input.raw), ...(input.providerThreadId ? { threadId: input.providerThreadId } : {}) }),
      });
      return { providerMessageId: data.id ?? null };
    }
    const { data } = await this.request<{ id: string }>(`${UPLOAD}/messages/send?uploadType=media`, {
      method: 'POST',
      headers: { 'Content-Type': 'message/rfc822' },
      body: Buffer.from(input.raw),
    });
    return { providerMessageId: data.id ?? null };
  }

  async findSentByMessageId(messageIdHeader: string): Promise<boolean> {
    const id = messageIdHeader.replace(/^<|>$/g, '');
    const params = new URLSearchParams({ q: `rfc822msgid:${id}`, includeSpamTrash: 'true', maxResults: '1' });
    const { data } = await this.request<{ messages?: unknown[] }>(`/messages?${params.toString()}`);
    return Boolean(data.messages?.length);
  }

  async saveDraft(raw: Uint8Array, existingDraftId: string | null) {
    const body = JSON.stringify({ message: { raw: base64UrlEncode(raw) } });
    const { data } = existingDraftId
      ? await this.request<{ id: string }>(`/drafts/${encodeURIComponent(existingDraftId)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body })
      : await this.request<{ id: string }>('/drafts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    return { providerDraftId: data.id };
  }

  async deleteDraft(providerDraftId: string) {
    await this.request(`/drafts/${encodeURIComponent(providerDraftId)}`, { method: 'DELETE', allowStatuses: [404], raw: true });
  }

  async search(query: string, limit: number): Promise<ProviderMessageHeader[]> {
    // Gmail's own operators already match ours (from:, to:, has:attachment, is:unread, after:).
    const parsed = parseSearchQuery(query);
    const q = [
      ...parsed.terms,
      parsed.from ? `from:${parsed.from}` : '',
      parsed.to ? `to:${parsed.to}` : '',
      parsed.hasAttachment ? 'has:attachment' : '',
      parsed.unread ? 'is:unread' : '',
      parsed.after ? `after:${parsed.after.replace(/-/g, '/')}` : '',
      parsed.before ? `before:${parsed.before.replace(/-/g, '/')}` : '',
    ].filter(Boolean).join(' ');
    const params = new URLSearchParams({ q, maxResults: String(Math.min(100, limit)) });
    const { data } = await this.request<{ messages?: { id: string }[] }>(`/messages?${params.toString()}`);
    return (await this.headersFor((data.messages ?? []).map((entry) => entry.id))).headers;
  }

  async watch(): Promise<ProviderWatchResult> {
    if (!this.options.pubsubTopic) return { kind: 'imap-poll', subscriptionId: null, expiresAt: null };
    const { data } = await this.request<{ historyId: string; expiration: string }>('/watch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Every label: a notification only triggers a history read, so filtering here saves nothing.
      body: JSON.stringify({ topicName: this.options.pubsubTopic }),
    });
    return {
      kind: 'gmail-watch',
      subscriptionId: null,
      expiresAt: new Date(Number(data.expiration)).toISOString(),
    };
  }

  async stopWatch(): Promise<void> {
    await this.request('/stop', { method: 'POST', raw: true, allowStatuses: [404] });
  }

  async revoke(): Promise<boolean> {
    // Revocation is done by the server with the refresh token (oauth.ts), not with an access token.
    return false;
  }

  /**
   * Gmail offers no API by which a member's *own* token can prove delegated read access to another
   * mailbox. What it does expose is send-as: a Workspace administrator who gives a user a group or
   * shared address grants it as a verified send-as alias, and that alias appears on the user's own
   * `settings/sendAs`. That is the evidence used, and the permissions page names the method.
   */
  async verifyMailboxGrant(sharedAddress: string): Promise<ProviderGrantCheck> {
    const wanted = normalizeEmail(sharedAddress);
    const { data } = await this.request<{ sendAs?: { sendAsEmail: string; verificationStatus?: string; isPrimary?: boolean }[] }>(
      '/settings/sendAs',
    );
    const match = (data.sendAs ?? []).find((entry) => normalizeEmail(entry.sendAsEmail) === wanted);
    const verified = Boolean(match && (match.isPrimary || match.verificationStatus === 'accepted'));
    return {
      read: verified ? 'verified' : 'missing',
      send: verified ? 'verified' : 'missing',
      method: 'gmail-send-as',
      detail: verified
        ? `${wanted} is an accepted send-as address on this Google account.`
        : `${wanted} is not an accepted send-as address on this Google account. Ask your Google Workspace administrator to grant it.`,
    };
  }
}
