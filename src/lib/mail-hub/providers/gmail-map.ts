/**
 * Gmail API JSON → the common model. Pure, and tested against recorded response shapes.
 *
 * Gmail has labels, not folders. The mapping:
 *
 *   INBOX/SENT/DRAFT/TRASH/SPAM → the matching role; user labels → `custom` labels.
 *   A synthetic `__all__` folder (role `all`) stands for All Mail: every message that is not in
 *   Trash or Spam carries it, which is what lets "archived" be computed as "in All Mail and not in
 *   the inbox" (see `viewKeysFor`).
 *   UNREAD and STARRED are flags, not folders. CATEGORY_* and IMPORTANT are hidden.
 */

import type { MailAddress, MailFolderRole } from '../model.ts';
import { normalizeMessageId, parseReferences, snippetOf, normalizeEmail } from '../rules.ts';
import type { ProviderAttachmentMeta, ProviderFolder, ProviderMessageHeader, ProviderMessageBody } from './types.ts';

export const GMAIL_ALL_MAIL = '__all__';

const SYSTEM_ROLES: Record<string, MailFolderRole> = {
  INBOX: 'inbox',
  SENT: 'sent',
  DRAFT: 'drafts',
  TRASH: 'trash',
  SPAM: 'spam',
};
const HIDDEN = new Set(['UNREAD', 'STARRED', 'IMPORTANT', 'CHAT', 'YELLOW_STAR']);

export interface GmailLabel {
  id: string;
  name: string;
  type?: 'system' | 'user';
  messagesUnread?: number;
  messagesTotal?: number;
  labelListVisibility?: string;
}

export function gmailFolders(labels: GmailLabel[]): ProviderFolder[] {
  const folders: ProviderFolder[] = [
    { providerFolderId: GMAIL_ALL_MAIL, name: 'All Mail', role: 'all', kind: 'label', parentProviderFolderId: null, unreadCount: null, totalCount: null, synced: true },
  ];
  for (const label of labels) {
    if (HIDDEN.has(label.id) || label.id.startsWith('CATEGORY_')) continue;
    const role = SYSTEM_ROLES[label.id];
    if (label.type === 'system' && !role) continue;
    if (label.labelListVisibility === 'labelHide' && !role) continue;
    folders.push({
      providerFolderId: label.id,
      name: role ? label.name.charAt(0) + label.name.slice(1).toLowerCase() : label.name,
      role: role ?? 'custom',
      kind: 'label',
      parentProviderFolderId: null,
      unreadCount: label.messagesUnread ?? null,
      totalCount: label.messagesTotal ?? null,
      synced: true,
    });
  }
  return folders;
}

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: GmailPart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  internalDate?: string;
  sizeEstimate?: number;
  payload?: GmailPart;
}

export function headerValue(headers: GmailHeader[] | undefined, name: string): string | null {
  const wanted = name.toLowerCase();
  return headers?.find((header) => header.name.toLowerCase() === wanted)?.value ?? null;
}

/** RFC 5322 address lists as they appear in headers. Handles quoted names containing commas. */
export function parseHeaderAddresses(value: string | null): MailAddress[] {
  if (!value) return [];
  const out: MailAddress[] = [];
  let current = '';
  let quoted = false;
  let angle = 0;
  const flush = () => {
    const part = current.trim();
    current = '';
    if (!part) return;
    const angled = part.match(/^(.*)<([^<>]+)>\s*$/);
    const address = normalizeEmail(angled ? angled[2] : part.replace(/^mailto:/i, ''));
    if (!address.includes('@')) return;
    const name = angled ? angled[1].trim().replace(/^"(.*)"$/, '$1').replace(/\\"/g, '"').trim() || null : null;
    out.push({ name, address });
  };
  for (const char of value) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === '<') angle += 1;
    else if (!quoted && char === '>') angle = Math.max(0, angle - 1);
    if (char === ',' && !quoted && angle === 0) flush();
    else current += char;
  }
  flush();
  return out;
}

function decodeEntities(text: string): string {
  return text.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

export function gmailHeaderFromMessage(message: GmailMessage): ProviderMessageHeader {
  const headers = message.payload?.headers;
  const labels = message.labelIds ?? [];
  const inTrashOrSpam = labels.includes('TRASH') || labels.includes('SPAM');
  const folders = labels.filter((label) => !HIDDEN.has(label) && !label.startsWith('CATEGORY_'));
  if (!inTrashOrSpam) folders.push(GMAIL_ALL_MAIL);
  const received = message.internalDate ? new Date(Number(message.internalDate)) : new Date();
  const dateHeader = headerValue(headers, 'Date');
  const sent = dateHeader ? new Date(dateHeader) : null;
  const messageId = normalizeMessageId(headerValue(headers, 'Message-ID') ?? headerValue(headers, 'Message-Id'));
  const mimeType = message.payload?.mimeType ?? '';

  return {
    stableKey: message.id,
    providerMessageId: message.id,
    providerThreadId: message.threadId,
    threadKey: message.threadId,
    providerFolderIds: [...new Set(folders)],
    internetMessageId: messageId,
    inReplyTo: normalizeMessageId(headerValue(headers, 'In-Reply-To')),
    references: parseReferences(headerValue(headers, 'References')),
    from: parseHeaderAddresses(headerValue(headers, 'From'))[0] ?? null,
    to: parseHeaderAddresses(headerValue(headers, 'To')),
    cc: parseHeaderAddresses(headerValue(headers, 'Cc')),
    bcc: parseHeaderAddresses(headerValue(headers, 'Bcc')),
    replyTo: parseHeaderAddresses(headerValue(headers, 'Reply-To')),
    subject: headerValue(headers, 'Subject') ?? '',
    snippet: snippetOf(decodeEntities(message.snippet ?? '')),
    sentAt: sent && !Number.isNaN(sent.getTime()) ? sent.toISOString() : null,
    receivedAt: received.toISOString(),
    isRead: !labels.includes('UNREAD'),
    isFlagged: labels.includes('STARRED'),
    isDraft: labels.includes('DRAFT'),
    attachments: [],
    // The metadata format carries no parts, but the top-level type says whether there are any.
    hasAttachments: mimeType === 'multipart/mixed',
    sizeBytes: message.sizeEstimate ?? null,
    providerVersion: message.historyId ?? null,
  };
}

/** Walk a `format=full` payload for the best HTML/text bodies and every attachment. */
export function gmailBodyFromMessage(message: GmailMessage, decode: (data: string) => string): ProviderMessageBody {
  let html: string | null = null;
  let text: string | null = null;
  const attachments: ProviderAttachmentMeta[] = [];

  const visit = (part: GmailPart | undefined) => {
    if (!part) return;
    const type = (part.mimeType ?? '').toLowerCase();
    const disposition = (headerValue(part.headers, 'Content-Disposition') ?? '').toLowerCase();
    const contentId = normalizeMessageId(headerValue(part.headers, 'Content-ID'));
    if (part.body?.attachmentId || (part.filename && part.filename.length)) {
      attachments.push({
        providerAttachmentId: part.body?.attachmentId ?? `part:${part.partId ?? ''}`,
        filename: part.filename || 'attachment',
        contentType: type || 'application/octet-stream',
        size: part.body?.size ?? 0,
        inline: disposition.startsWith('inline') || (Boolean(contentId) && type.startsWith('image/')),
        contentId,
      });
    } else if (type === 'text/html' && part.body?.data && html == null) {
      html = decode(part.body.data);
    } else if (type === 'text/plain' && part.body?.data && text == null) {
      text = decode(part.body.data);
    }
    part.parts?.forEach(visit);
  };
  visit(message.payload);
  return { html, text, attachments };
}

export interface GmailHistoryRecord {
  id: string;
  messagesAdded?: { message: { id: string } }[];
  messagesDeleted?: { message: { id: string } }[];
  labelsAdded?: { message: { id: string } }[];
  labelsRemoved?: { message: { id: string } }[];
}

/**
 * Reduce a page of history to "fetch these" and "these are gone". A message deleted after being
 * added in the same page is only deleted; one re-added after deletion (undo) is fetched.
 */
export function reduceGmailHistory(records: GmailHistoryRecord[]): { fetch: string[]; deleted: string[] } {
  const state = new Map<string, 'fetch' | 'deleted'>();
  for (const record of records) {
    for (const entry of record.messagesAdded ?? []) state.set(entry.message.id, 'fetch');
    for (const entry of [...(record.labelsAdded ?? []), ...(record.labelsRemoved ?? [])]) {
      if (state.get(entry.message.id) !== 'deleted') state.set(entry.message.id, 'fetch');
    }
    for (const entry of record.messagesDeleted ?? []) state.set(entry.message.id, 'deleted');
  }
  const fetch: string[] = [];
  const deleted: string[] = [];
  state.forEach((value, id) => (value === 'fetch' ? fetch : deleted).push(id));
  return { fetch, deleted };
}
