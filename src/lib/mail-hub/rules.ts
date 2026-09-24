/**
 * Mail Hub — the pure rules.
 *
 * Addresses, subjects, reply recipients, quoting, threading keys, search tokens, the attachment
 * policy, deadlines, routing rules, reports and recovery advice. No I/O and no framework imports,
 * so every rule the module depends on is exercised directly by `tests/mail-hub-*.test.mjs`.
 */

import type {
  MailAccount,
  MailAddress,
  MailFolderRole,
  MailFollowUp,
  MailImapServerPreset,
  MailMessage,
  MailPriority,
  MailRecoveryAdvice,
  MailRoutingRule,
  MailThread,
} from './model.ts';

/* ── addresses ────────────────────────────────────────────────────────────────────────────── */

const EMAIL_PATTERN = /^[^\s@<>(),;:"[\]]+@[^\s@<>(),;:"[\]]+\.[^\s@<>(),;:"[\]]{2,}$/;

export function isValidEmail(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.length <= 254 && EMAIL_PATTERN.test(value.trim());
}

export function normalizeEmail(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

export function emailDomain(value: string | null | undefined): string {
  const at = normalizeEmail(value).lastIndexOf('@');
  return at >= 0 ? normalizeEmail(value).slice(at + 1) : '';
}

/**
 * Parse `"Name" <a@b.com>, c@d.com; Other <e@f.com>` into addresses.
 *
 * Deliberately forgiving on input (commas or semicolons, quoted names containing commas) and strict
 * on output: anything that does not end up as a valid address is returned in `invalid` so the
 * composer can underline it rather than silently dropping a recipient.
 */
export function parseAddressList(input: string | null | undefined): { addresses: MailAddress[]; invalid: string[] } {
  const text = (input ?? '').trim();
  if (!text) return { addresses: [], invalid: [] };

  const parts: string[] = [];
  let current = '';
  let quoted = false;
  let angle = 0;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === '<') angle += 1;
    else if (!quoted && char === '>') angle = Math.max(0, angle - 1);
    if ((char === ',' || char === ';') && !quoted && angle === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);

  const addresses: MailAddress[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const raw of parts) {
    const part = raw.trim();
    if (!part) continue;
    const angled = part.match(/^(.*)<([^<>]+)>\s*$/);
    const address = normalizeEmail(angled ? angled[2] : part);
    const name = angled ? angled[1].trim().replace(/^"(.*)"$/, '$1').trim() || null : null;
    if (!isValidEmail(address)) {
      invalid.push(part);
      continue;
    }
    if (seen.has(address)) continue;
    seen.add(address);
    addresses.push({ name, address });
  }
  return { addresses, invalid };
}

export function formatAddress(address: MailAddress | null | undefined): string {
  if (!address) return '';
  if (!address.name) return address.address;
  const name = /[",;<>@()]/.test(address.name) ? `"${address.name.replace(/"/g, "'")}"` : address.name;
  return `${name} <${address.address}>`;
}

export function displayAddress(address: MailAddress | null | undefined): string {
  if (!address) return 'Unknown sender';
  return address.name?.trim() || address.address;
}

function dedupeAddresses(list: MailAddress[], exclude: Set<string>): MailAddress[] {
  const out: MailAddress[] = [];
  const seen = new Set(exclude);
  for (const entry of list) {
    const key = normalizeEmail(entry.address);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ name: entry.name ?? null, address: key });
  }
  return out;
}

/* ── subjects ─────────────────────────────────────────────────────────────────────────────── */

/** Reply/forward prefixes in the languages this organisation's correspondents actually use. */
const SUBJECT_PREFIX = /^\s*((re|fw|fwd|aw|wg|sv|vs|rv|tr|antw|réf|ref)\s*(\[\d+\])?\s*:\s*)+/i;

export function normalizeSubject(subject: string | null | undefined): string {
  return (subject ?? '').replace(SUBJECT_PREFIX, '').replace(/\s+/g, ' ').trim();
}

export function replySubject(subject: string | null | undefined): string {
  const base = normalizeSubject(subject);
  return base ? `Re: ${base}` : 'Re:';
}

export function forwardSubject(subject: string | null | undefined): string {
  const base = normalizeSubject(subject);
  return base ? `Fwd: ${base}` : 'Fwd:';
}

/* ── reply recipients ─────────────────────────────────────────────────────────────────────── */

/**
 * Who a reply goes to.
 *
 * Reply: the Reply-To if the sender set one, else the sender. When the message being answered is
 * one *we* sent (replying to your own sent mail to add something), the original recipients are
 * the natural audience, which is what every mail client does.
 *
 * Reply all: the above, plus every To and Cc — minus every address that is ours, so a reply-all
 * never mails yourself, and never includes a Bcc (which a recipient is not supposed to know of).
 */
export function replyRecipients(
  message: Pick<MailMessage, 'from' | 'to' | 'cc' | 'replyTo' | 'direction'>,
  ownAddresses: string[],
  mode: 'reply' | 'replyAll',
): { to: MailAddress[]; cc: MailAddress[] } {
  const own = new Set(ownAddresses.map(normalizeEmail));
  const fromIsOwn = message.from ? own.has(normalizeEmail(message.from.address)) : false;

  const primary: MailAddress[] =
    message.direction === 'outbound' || fromIsOwn
      ? message.to
      : message.replyTo.length
        ? message.replyTo
        : message.from
          ? [message.from]
          : [];

  const to = dedupeAddresses(primary, own);
  if (mode === 'reply') return { to, cc: [] };

  const toKeys = new Set([...own, ...to.map((entry) => entry.address)]);
  const others = [...message.to, ...message.cc];
  const cc = dedupeAddresses(others, toKeys);
  return { to, cc };
}

/* ── quoting ──────────────────────────────────────────────────────────────────────────────── */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatMailDate(iso: string | null | undefined, timeZone = 'Asia/Kolkata'): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(date);
}

/**
 * The quoted part of a reply or forward.
 *
 * Built from the **message body only**. Its inputs are the source message and its sanitised body;
 * there is no parameter through which an internal note, an assignment or any other ERP-side text
 * could enter, which is the structural half of the "notes can never be sent" guarantee.
 */
export function quotedBlock(
  message: Pick<MailMessage, 'from' | 'to' | 'cc' | 'subject' | 'sentAt' | 'receivedAt'>,
  bodyHtml: string,
  mode: 'reply' | 'replyAll' | 'forward',
  timeZone?: string,
): string {
  const when = formatMailDate(message.sentAt ?? message.receivedAt, timeZone);
  if (mode === 'forward') {
    const rows = [
      ['From', formatAddress(message.from)],
      ['Date', when],
      ['Subject', message.subject],
      ['To', message.to.map(formatAddress).join(', ')],
      ...(message.cc.length ? [['Cc', message.cc.map(formatAddress).join(', ')]] : []),
    ]
      .map(([label, value]) => `<b>${label}:</b> ${escapeHtml(value)}<br>`)
      .join('');
    return `<br><div data-mail-quote="forward">---------- Forwarded message ----------<br>${rows}<br>${bodyHtml}</div>`;
  }
  const who = escapeHtml(formatAddress(message.from) || 'the sender');
  return (
    `<br><div data-mail-quote="reply">On ${escapeHtml(when)}, ${who} wrote:<br>` +
    `<blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${bodyHtml}</blockquote></div>`
  );
}

/** Plain text of an HTML fragment, for the `text/plain` alternative and for snippets. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<(script|style|head|title)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|table)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function plainTextToHtml(text: string | null | undefined): string {
  return escapeHtml(text ?? '')
    .split(/\r?\n/)
    .join('<br>');
}

export function snippetOf(text: string | null | undefined, max = 180): string {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/* ── signatures and templates ─────────────────────────────────────────────────────────────── */

/**
 * The outgoing HTML: what the user wrote, then the signature, then the quoted message.
 *
 * The composer keeps the three apart and joins them only here, at send time. Keeping the signature
 * out of the editable body means changing the From account swaps the signature cleanly instead of
 * pattern-matching it out of whatever the editor's sanitiser left of a marker.
 */
export function assembleOutgoingHtml(parts: {
  bodyHtml: string;
  signatureHtml?: string | null;
  quotedHtml?: string | null;
}): string {
  const signature = parts.signatureHtml?.trim() ? `<div data-mail-signature="1"><br>-- <br>${parts.signatureHtml}</div>` : '';
  return `${parts.bodyHtml}${signature}${parts.quotedHtml ?? ''}`;
}

export interface TemplateVariables {
  recipientName?: string | null;
  recipientEmail?: string | null;
  senderName?: string | null;
  senderEmail?: string | null;
  subject?: string | null;
  date?: string | null;
}

/**
 * Fill `{{recipient.name}}`-style placeholders. Values are HTML-escaped: a template is trusted,
 * but the name of whoever wrote to us is not.
 */
export function applyTemplate(html: string, vars: TemplateVariables): string {
  const map: Record<string, string | null | undefined> = {
    'recipient.name': vars.recipientName,
    'recipient.email': vars.recipientEmail,
    'sender.name': vars.senderName,
    'sender.email': vars.senderEmail,
    subject: vars.subject,
    date: vars.date,
  };
  return html.replace(/\{\{\s*([a-z.]+)\s*\}\}/gi, (whole, key: string) => {
    const value = map[key.toLowerCase()];
    return value == null ? '' : escapeHtml(value);
  });
}

/* ── threading ────────────────────────────────────────────────────────────────────────────── */

export function normalizeMessageId(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return null;
  const inner = trimmed.match(/<([^<>]+)>/);
  return (inner ? inner[1] : trimmed).trim().toLowerCase() || null;
}

export function parseReferences(value: string | string[] | null | undefined): string[] {
  const text = Array.isArray(value) ? value.join(' ') : (value ?? '');
  const found = text.match(/<[^<>]+>/g) ?? text.split(/\s+/);
  return found.map(normalizeMessageId).filter((entry): entry is string => Boolean(entry));
}

/**
 * The conversation key for a provider without native threads (IMAP).
 *
 * The root of the References chain identifies a conversation, so a reply that arrives before the
 * message it answers still lands in the same thread: the reply's `References[0]` *is* the
 * original's Message-ID. Falls back to In-Reply-To, then to the message's own id.
 */
export function imapThreadRoot(input: {
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
}): string | null {
  return input.references[0] ?? normalizeMessageId(input.inReplyTo) ?? normalizeMessageId(input.messageId);
}

/** A short, Firestore-safe digest (FNV-1a, 64 bits as hex). Not cryptographic; used for ids only. */
export function stableHash(value: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ code, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

export const messageDocId = (accountId: string, stableKey: string) => `${accountId}__m${stableHash(stableKey)}`;
export const threadDocId = (accountId: string, threadKey: string) => `${accountId}__t${stableHash(threadKey)}`;
export const folderDocId = (accountId: string, providerFolderId: string) => `${accountId}__f${stableHash(providerFolderId)}`;

/* ── query keys ───────────────────────────────────────────────────────────────────────────── */

/**
 * The keys a message or thread is listed under.
 *
 * Firestore allows one `array-contains-any` per query, so "the inboxes of these three accounts,
 * newest first" has to be a single array field. Role keys (`r:inbox`) make the unified inbox one
 * query across accounts; folder keys make a custom folder or label one query too.
 */
export function viewKeysFor(
  accountId: string,
  folderIds: string[],
  roleOf: (folderId: string) => MailFolderRole | null,
  flags: { isFlagged?: boolean; isDraft?: boolean } = {},
): string[] {
  const keys = new Set<string>();
  for (const folderId of folderIds) {
    keys.add(`a:${accountId}:f:${folderId}`);
    const role = roleOf(folderId);
    if (role && role !== 'custom') keys.add(`a:${accountId}:r:${role}`);
  }
  if (flags.isFlagged) keys.add(`a:${accountId}:r:starred`);
  if (flags.isDraft) keys.add(`a:${accountId}:r:drafts`);
  // Gmail's archive is "no INBOX label", not a folder. Everything not in inbox/trash/spam/drafts
  // is archived, which is what Gmail's own "All mail minus inbox" means.
  const roles = new Set(folderIds.map(roleOf));
  const hasAll = roles.has('all');
  if (hasAll && !roles.has('inbox') && !roles.has('trash') && !roles.has('spam') && !flags.isDraft) {
    keys.add(`a:${accountId}:r:archive`);
  }
  return [...keys].sort();
}

export const roleKey = (accountId: string, role: MailFolderRole | 'starred') => `a:${accountId}:r:${role}`;
export const folderKey = (accountId: string, folderId: string) => `a:${accountId}:f:${folderId}`;

/* ── search ───────────────────────────────────────────────────────────────────────────────── */

const STOP_WORDS = new Set(['the', 'and', 'for', 'you', 'your', 'are', 'with', 'this', 'that', 'from', 're', 'fw', 'fwd']);
export const MAX_SEARCH_TOKENS = 120;

export function tokenize(text: string | null | undefined): string[] {
  return (text ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9ऀ-ॿ]+/)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

/**
 * Search tokens for a message: subject, snippet, and every address, name and domain on it.
 *
 * Headers and the snippet only — never the full body. Indexing bodies would mean storing them in a
 * form that outlives the body cache's retention, which is exactly what retention is meant to stop.
 * Full-text search of bodies goes to the provider (`scope=provider` on the search API).
 */
export function messageSearchTokens(message: Pick<MailMessage, 'subject' | 'snippet' | 'from' | 'to' | 'cc'>): string[] {
  const tokens = new Set<string>();
  const add = (value: string | null | undefined) => tokenize(value).forEach((token) => tokens.add(token));
  add(message.subject);
  add(message.snippet);
  for (const address of [message.from, ...message.to, ...message.cc]) {
    if (!address) continue;
    add(address.name);
    const email = normalizeEmail(address.address);
    if (email) {
      tokens.add(email);
      add(email.split('@')[0]);
      const domain = emailDomain(email);
      if (domain) tokens.add(domain);
    }
  }
  return [...tokens].slice(0, MAX_SEARCH_TOKENS);
}

export interface ParsedSearch {
  terms: string[];
  from: string | null;
  to: string | null;
  hasAttachment: boolean;
  unread: boolean;
  after: string | null;
  before: string | null;
}

/** `invoice from:vendor.com has:attachment is:unread after:2026-01-01` */
export function parseSearchQuery(query: string): ParsedSearch {
  const result: ParsedSearch = { terms: [], from: null, to: null, hasAttachment: false, unread: false, after: null, before: null };
  for (const part of query.trim().split(/\s+/).filter(Boolean)) {
    const [key, ...rest] = part.split(':');
    const value = rest.join(':').toLowerCase();
    if (rest.length && key === 'from') result.from = value;
    else if (rest.length && key === 'to') result.to = value;
    else if (part.toLowerCase() === 'has:attachment') result.hasAttachment = true;
    else if (part.toLowerCase() === 'is:unread') result.unread = true;
    else if (rest.length && key === 'after' && /^\d{4}-\d{2}-\d{2}$/.test(value)) result.after = value;
    else if (rest.length && key === 'before' && /^\d{4}-\d{2}-\d{2}$/.test(value)) result.before = value;
    else result.terms.push(...tokenize(part));
  }
  return result;
}

export function matchesSearch(
  message: Pick<MailMessage, 'searchTokens' | 'from' | 'to' | 'cc' | 'hasAttachments' | 'isRead' | 'receivedAt'>,
  search: ParsedSearch,
): boolean {
  const tokens = new Set(message.searchTokens);
  // Prefix match on the last term, so "invo" finds "invoice" while typing.
  for (let i = 0; i < search.terms.length; i += 1) {
    const term = search.terms[i];
    const last = i === search.terms.length - 1;
    if (!tokens.has(term) && !(last && [...tokens].some((token) => token.startsWith(term)))) return false;
  }
  if (search.from && !normalizeEmail(message.from?.address).includes(search.from) &&
      !(message.from?.name ?? '').toLowerCase().includes(search.from)) return false;
  if (search.to && ![...message.to, ...message.cc].some((entry) => normalizeEmail(entry.address).includes(search.to as string))) return false;
  if (search.hasAttachment && !message.hasAttachments) return false;
  if (search.unread && message.isRead) return false;
  if (search.after && message.receivedAt.slice(0, 10) < search.after) return false;
  if (search.before && message.receivedAt.slice(0, 10) >= search.before) return false;
  return true;
}

/* ── thread aggregation ───────────────────────────────────────────────────────────────────── */

export function aggregateThread(
  messages: MailMessage[],
  base: Pick<MailThread, 'id' | 'accountId' | 'ownerUserId' | 'sharedMailboxId' | 'assignment' | 'linkCount' | 'noteCount'>,
  now: string,
): MailThread {
  const live = messages.filter((message) => !message.deleted).sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  const newest = live[live.length - 1];
  const inbound = live.filter((message) => message.direction === 'inbound');
  const outbound = live.filter((message) => message.direction === 'outbound' && !message.isDraft);
  const firstInbound = inbound[0]?.receivedAt ?? null;
  const firstResponse = firstInbound ? outbound.find((message) => message.receivedAt > firstInbound)?.receivedAt ?? null : null;

  const participants: MailAddress[] = [];
  const seen = new Set<string>();
  for (const message of live) {
    for (const address of [message.from, ...message.to, ...message.cc]) {
      const key = normalizeEmail(address?.address);
      if (!address || !key || seen.has(key)) continue;
      seen.add(key);
      participants.push({ name: address.name ?? null, address: key });
    }
  }

  const union = <T,>(pick: (message: MailMessage) => T[]) => [...new Set(live.flatMap(pick))];
  const nonDraft = live.filter((message) => !message.isDraft);
  const latestReal = nonDraft[nonDraft.length - 1];

  return {
    ...base,
    providerThreadId: newest?.providerThreadId ?? null,
    subject: normalizeSubject(live[0]?.subject) || live[0]?.subject || '(no subject)',
    snippet: newest?.snippet ?? '',
    participants: participants.slice(0, 50),
    messageCount: live.length,
    unreadCount: live.filter((message) => !message.isRead).length,
    hasAttachments: live.some((message) => message.hasAttachments),
    isFlagged: live.some((message) => message.isFlagged),
    lastMessageAt: newest?.receivedAt ?? now,
    lastInboundAt: inbound[inbound.length - 1]?.receivedAt ?? null,
    lastOutboundAt: outbound[outbound.length - 1]?.receivedAt ?? null,
    firstInboundAt: firstInbound,
    firstResponseAt: firstResponse,
    awaitingReply: latestReal?.direction === 'inbound',
    folderIds: union((message) => message.folderIds),
    viewKeys: union((message) => message.viewKeys),
    searchTokens: union((message) => message.searchTokens).slice(0, MAX_SEARCH_TOKENS * 2),
    deleted: live.length === 0,
    updatedAt: now,
  };
}

/* ── attachments ──────────────────────────────────────────────────────────────────────────── */

/**
 * Extensions that execute on a double-click on Windows or macOS, plus containers that are the usual
 * wrapper for them. Blocked in both directions — nobody should send them from the ERP, and nobody
 * should download one through it.
 */
export const BLOCKED_ATTACHMENT_EXTENSIONS = new Set([
  'exe', 'com', 'bat', 'cmd', 'msi', 'msp', 'scr', 'pif', 'cpl', 'dll', 'sys', 'drv',
  'js', 'jse', 'vbs', 'vbe', 'wsf', 'wsh', 'ps1', 'psm1', 'hta', 'jar', 'lnk', 'reg',
  'iso', 'img', 'vhd', 'vhdx', 'appx', 'msix', 'app', 'dmg', 'pkg', 'sh', 'command', 'scf',
  'xll', 'docm', 'xlsm', 'pptm', 'dotm', 'xltm', 'one', 'chm', 'gadget', 'application', 'url',
]);

const EXECUTABLE_CONTENT_TYPES = /^(application\/(x-msdownload|x-dosexec|x-msdos-program|x-sh|x-bat|java-archive|x-ms-installer|hta|x-msi))/i;

export interface AttachmentPolicy {
  maxBytes: number;
}

export function fileExtension(filename: string): string {
  const clean = filename.trim().toLowerCase().replace(/[\s.]+$/, '');
  const dot = clean.lastIndexOf('.');
  return dot >= 0 ? clean.slice(dot + 1) : '';
}

export function sanitizeFilename(filename: string | null | undefined): string {
  const cleaned = (filename ?? '')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*‮‭‎‏]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 180);
  return cleaned || 'attachment';
}

export function validateAttachment(
  file: { filename: string; contentType: string; size: number },
  policy: AttachmentPolicy,
): { ok: true } | { ok: false; reason: string } {
  const filename = sanitizeFilename(file.filename);
  // Right-to-left override characters are how "invoice‮fdp.exe" displays as "invoiceexe.pdf".
  if (/[‮‭]/.test(file.filename)) return { ok: false, reason: 'The file name contains hidden direction characters.' };
  const extension = fileExtension(filename);
  if (BLOCKED_ATTACHMENT_EXTENSIONS.has(extension)) {
    return { ok: false, reason: `.${extension} files are blocked because they can run programs.` };
  }
  // "statement.pdf.exe" is caught above; "statement.exe.pdf" is odd but harmless. What matters is
  // the final extension, plus any executable type the sender declared regardless of the name.
  if (EXECUTABLE_CONTENT_TYPES.test(file.contentType)) return { ok: false, reason: 'Executable files are blocked.' };
  if (!Number.isFinite(file.size) || file.size < 0) return { ok: false, reason: 'The file size is invalid.' };
  if (file.size > policy.maxBytes) {
    return { ok: false, reason: `The file is larger than the ${Math.round(policy.maxBytes / 1024 / 1024)} MB limit.` };
  }
  return { ok: true };
}

export type PreviewKind = 'image' | 'pdf' | 'text' | 'none';

/** Types the browser may render inline. SVG is excluded — it is a document that can carry script. */
export function previewKind(contentType: string, filename: string): PreviewKind {
  const type = contentType.toLowerCase();
  const extension = fileExtension(filename);
  if (/^image\/(png|jpe?g|gif|webp|bmp)$/.test(type)) return 'image';
  if (type === 'application/pdf' || extension === 'pdf') return 'pdf';
  if (/^text\/(plain|csv)$/.test(type) || ['txt', 'csv', 'log'].includes(extension)) return 'text';
  return 'none';
}

/* ── deadlines and follow-ups ─────────────────────────────────────────────────────────────── */

export function addHours(iso: string, hours: number): string {
  return new Date(Date.parse(iso) + hours * 3_600_000).toISOString();
}

export type DeadlineState = 'none' | 'on-track' | 'due-soon' | 'overdue' | 'answered';

export function deadlineState(
  thread: Pick<MailThread, 'awaitingReply' | 'assignment'>,
  now: Date,
  warningMinutes = 120,
): DeadlineState {
  const due = thread.assignment?.dueAt;
  if (thread.assignment?.status === 'closed') return 'answered';
  if (!due) return 'none';
  if (!thread.awaitingReply) return 'answered';
  const remaining = Date.parse(due) - now.getTime();
  if (remaining < 0) return 'overdue';
  if (remaining <= warningMinutes * 60_000) return 'due-soon';
  return 'on-track';
}

/** Reminder offsets (minutes before due) that have become due since the last sweep. */
export function dueFollowUpReminders(
  followUp: Pick<MailFollowUp, 'dueAt' | 'reminderOffsets' | 'status'>,
  now: Date,
  sweepWindowMinutes = 90,
): number[] {
  if (followUp.status !== 'open') return [];
  const due = Date.parse(followUp.dueAt);
  if (!Number.isFinite(due)) return [];
  return [...new Set([...followUp.reminderOffsets, 0])]
    .filter((offset) => {
      const at = due - offset * 60_000;
      return at <= now.getTime() && now.getTime() - at <= sweepWindowMinutes * 60_000;
    })
    .sort((a, b) => b - a);
}

export const PRIORITY_RANK: Record<MailPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

/* ── routing rules ────────────────────────────────────────────────────────────────────────── */

export function matchRoutingRule(
  rules: MailRoutingRule[],
  message: Pick<MailMessage, 'from' | 'to' | 'cc' | 'subject'>,
): MailRoutingRule | null {
  const from = `${message.from?.name ?? ''} ${message.from?.address ?? ''}`.toLowerCase();
  const to = [...message.to, ...message.cc].map((entry) => entry.address).join(' ').toLowerCase();
  const subject = (message.subject ?? '').toLowerCase();
  const contains = (haystack: string, needle: string | null) => !needle || haystack.includes(needle.trim().toLowerCase());
  return (
    [...rules]
      .filter((rule) => rule.enabled)
      .sort((a, b) => a.order - b.order)
      .find((rule) => {
        const { fromContains, subjectContains, toContains } = rule.conditions;
        // A rule with no conditions would match everything, which is never what somebody meant.
        if (!fromContains && !subjectContains && !toContains) return false;
        return contains(from, fromContains) && contains(subject, subjectContains) && contains(to, toContains);
      }) ?? null
  );
}

/* ── reports ──────────────────────────────────────────────────────────────────────────────── */

export interface MailReportInput {
  threads: Pick<MailThread, 'id' | 'sharedMailboxId' | 'assignment' | 'awaitingReply' | 'firstInboundAt' | 'firstResponseAt' | 'lastMessageAt'>[];
  followUps: Pick<MailFollowUp, 'ownerId' | 'ownerName' | 'status' | 'dueAt'>[];
  departmentOf: (userId: string) => string | null;
  from: string;
  to: string;
  now: Date;
}

export interface MailReport {
  assignedVolume: number;
  openWork: number;
  overdue: number;
  answered: number;
  medianResponseHours: number | null;
  averageResponseHours: number | null;
  byAssignee: { userId: string; name: string; open: number; overdue: number; closed: number; medianResponseHours: number | null }[];
  byDepartment: { department: string; open: number; overdue: number; assigned: number }[];
  followUps: { open: number; overdue: number; done: number };
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const round1 = (value: number | null) => (value == null ? null : Math.round(value * 10) / 10);

export function buildMailReport(input: MailReportInput): MailReport {
  const inRange = (iso: string | null | undefined) => Boolean(iso) && (iso as string) >= input.from && (iso as string) < input.to;
  const assigned = input.threads.filter((thread) => thread.assignment?.assigneeId && inRange(thread.assignment.assignedAt ?? thread.lastMessageAt));
  const isOverdue = (thread: MailReportInput['threads'][number]) =>
    thread.assignment?.status !== 'closed' &&
    thread.awaitingReply &&
    Boolean(thread.assignment?.dueAt) &&
    Date.parse(thread.assignment?.dueAt as string) < input.now.getTime();
  const isOpen = (thread: MailReportInput['threads'][number]) => thread.assignment?.status !== 'closed';

  const responseHours = (thread: MailReportInput['threads'][number]) =>
    thread.firstInboundAt && thread.firstResponseAt
      ? (Date.parse(thread.firstResponseAt) - Date.parse(thread.firstInboundAt)) / 3_600_000
      : null;
  const responses = input.threads
    .filter((thread) => inRange(thread.firstInboundAt))
    .map(responseHours)
    .filter((value): value is number => value != null && value >= 0);

  const byAssignee = new Map<string, MailReport['byAssignee'][number] & { samples: number[] }>();
  const byDepartment = new Map<string, MailReport['byDepartment'][number]>();
  for (const thread of assigned) {
    const id = thread.assignment?.assigneeId as string;
    const row = byAssignee.get(id) ?? {
      userId: id,
      name: thread.assignment?.assigneeName ?? id,
      open: 0,
      overdue: 0,
      closed: 0,
      medianResponseHours: null,
      samples: [],
    };
    if (isOpen(thread)) row.open += 1;
    else row.closed += 1;
    if (isOverdue(thread)) row.overdue += 1;
    const hours = responseHours(thread);
    if (hours != null && hours >= 0) row.samples.push(hours);
    byAssignee.set(id, row);

    const department = thread.assignment?.departmentId ?? input.departmentOf(id) ?? 'Unassigned department';
    const dept = byDepartment.get(department) ?? { department, open: 0, overdue: 0, assigned: 0 };
    dept.assigned += 1;
    if (isOpen(thread)) dept.open += 1;
    if (isOverdue(thread)) dept.overdue += 1;
    byDepartment.set(department, dept);
  }

  const followUpsInRange = input.followUps;
  return {
    assignedVolume: assigned.length,
    openWork: assigned.filter(isOpen).length,
    overdue: assigned.filter(isOverdue).length,
    answered: assigned.filter((thread) => !thread.awaitingReply || thread.assignment?.status === 'closed').length,
    medianResponseHours: round1(median(responses)),
    averageResponseHours: round1(responses.length ? responses.reduce((sum, value) => sum + value, 0) / responses.length : null),
    byAssignee: [...byAssignee.values()]
      .map(({ samples, ...row }) => ({ ...row, medianResponseHours: round1(median(samples)) }))
      .sort((a, b) => b.open - a.open || a.name.localeCompare(b.name)),
    byDepartment: [...byDepartment.values()].sort((a, b) => b.open - a.open),
    followUps: {
      open: followUpsInRange.filter((entry) => entry.status === 'open').length,
      overdue: followUpsInRange.filter((entry) => entry.status === 'open' && Date.parse(entry.dueAt) < input.now.getTime()).length,
      done: followUpsInRange.filter((entry) => entry.status === 'done').length,
    },
  };
}

/* ── recovery advice ──────────────────────────────────────────────────────────────────────── */

/** What to tell the user about an account's state, in words they can act on. */
export function recoveryAdvice(
  account: Pick<MailAccount, 'status' | 'statusReason' | 'provider' | 'sync' | 'kind'>,
  now: Date = new Date(),
): MailRecoveryAdvice | null {
  const providerName = account.provider === 'gmail' ? 'Google' : account.provider === 'microsoft' ? 'Microsoft' : 'your mail server';
  switch (account.status) {
    case 'reauth_required':
      return {
        severity: 'error',
        title: 'Sign in again to keep this mailbox in sync',
        steps: [
          account.statusReason ?? `${providerName} no longer accepts the ERP's access to this mailbox.`,
          account.provider === 'imap'
            ? 'If your mailbox password changed, choose Reconnect and enter the new password.'
            : `Choose Reconnect and approve access in the ${providerName} window.`,
          'Mail already in the ERP stays visible; nothing new arrives until you reconnect.',
        ],
        action: 'reconnect',
      };
    case 'error': {
      const next = account.sync.nextAttemptAt ? Date.parse(account.sync.nextAttemptAt) : NaN;
      const minutes = Number.isFinite(next) ? Math.max(1, Math.round((next - now.getTime()) / 60_000)) : null;
      return {
        severity: 'warning',
        title: `${providerName} is not responding`,
        steps: [
          account.sync.lastError ?? 'The last sync attempts failed.',
          minutes ? `The ERP retries automatically — the next attempt is in about ${minutes} minute(s).` : 'The ERP retries automatically.',
          account.sync.consecutiveFailures >= 5
            ? 'This has failed repeatedly. Check the provider status page, or ask your administrator.'
            : 'You can also choose Retry now.',
        ],
        action: account.sync.consecutiveFailures >= 5 ? 'contact-admin' : 'retry',
      };
    }
    case 'connecting':
      return {
        severity: 'info',
        title: 'First sync in progress',
        steps: [`${account.sync.messagesSynced} message(s) synced so far. New mail appears as the sync continues.`],
        action: 'wait',
      };
    case 'disconnected':
      return {
        severity: 'info',
        title: 'Disconnected',
        steps: ['The ERP no longer has access to this mailbox. Connect it again to resume.'],
        action: 'reconnect',
      };
    default:
      if (account.sync.phase === 'recovery') {
        return {
          severity: 'info',
          title: 'Resynchronising',
          steps: ['The provider asked the ERP to rebuild its copy of this mailbox. This runs in the background.'],
          action: 'wait',
        };
      }
      return null;
  }
}

/* ── retry and idempotency ────────────────────────────────────────────────────────────────── */

/** Exponential backoff with full jitter, honouring a provider `Retry-After` as a floor. */
export function retryDelayMs(attempt: number, retryAfterMs: number | null = null, random: () => number = Math.random): number {
  const base = Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempt - 1));
  const jittered = Math.round(base / 2 + (random() * base) / 2);
  return Math.max(jittered, retryAfterMs ?? 0);
}

/** The Message-ID an outbound message will carry, fixed at creation. */
export function outboundMessageId(outboundId: string, domain: string, nonce: string): string {
  const cleanDomain = domain.replace(/[^a-z0-9.-]/gi, '') || 'mail.local';
  return `<erp.${outboundId}.${nonce}@${cleanDomain}>`;
}

/* ── IMAP presets ─────────────────────────────────────────────────────────────────────────── */

/**
 * The IMAP server a user may connect to — only one an administrator configured.
 *
 * A user-supplied host would make the ERP's server an open TCP client: point it at an internal
 * address and port and the error message tells you what is listening there. So the host never
 * comes from the request; the request names a preset, and the preset may restrict domains.
 */
export function resolveImapPreset(
  presets: MailImapServerPreset[],
  presetId: string,
  emailAddress: string,
): { ok: true; preset: MailImapServerPreset } | { ok: false; reason: string } {
  const preset = presets.find((entry) => entry.id === presetId);
  if (!preset) return { ok: false, reason: 'Choose one of the mail servers your administrator has configured.' };
  if (!isValidEmail(emailAddress)) return { ok: false, reason: 'Enter a valid email address.' };
  const domain = emailDomain(emailAddress);
  if (preset.allowedDomains.length && !preset.allowedDomains.map((entry) => entry.toLowerCase()).includes(domain)) {
    return { ok: false, reason: `${preset.label} only accepts addresses at ${preset.allowedDomains.join(', ')}.` };
  }
  return { ok: true, preset };
}

export function imapLogin(preset: Pick<MailImapServerPreset, 'usernameStyle'>, emailAddress: string, override?: string | null): string {
  if (override?.trim()) return override.trim();
  return preset.usernameStyle === 'local-part' ? normalizeEmail(emailAddress).split('@')[0] : normalizeEmail(emailAddress);
}

/* ── compose validation ───────────────────────────────────────────────────────────────────── */

export const MAX_RECIPIENTS = 100;
export const MAX_SUBJECT_LENGTH = 998;
export const MAX_BODY_HTML_LENGTH = 2_000_000;

export function validateCompose(input: {
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  subject: string;
  html: string;
  attachmentBytes: number;
  maxAttachmentBytes: number;
  forSend: boolean;
}): string[] {
  const errors: string[] = [];
  const total = input.to.length + input.cc.length + input.bcc.length;
  if (input.forSend && total === 0) errors.push('Add at least one recipient.');
  if (total > MAX_RECIPIENTS) errors.push(`A message can have at most ${MAX_RECIPIENTS} recipients.`);
  for (const entry of [...input.to, ...input.cc, ...input.bcc]) {
    if (!isValidEmail(entry.address)) errors.push(`${entry.address} is not a valid address.`);
  }
  if (input.subject.length > MAX_SUBJECT_LENGTH) errors.push('The subject is too long.');
  if (/[\r\n]/.test(input.subject)) errors.push('The subject cannot contain line breaks.');
  if (input.html.length > MAX_BODY_HTML_LENGTH) errors.push('The message body is too large.');
  if (input.attachmentBytes > input.maxAttachmentBytes) {
    errors.push(`Attachments exceed this mailbox's ${Math.round(input.maxAttachmentBytes / 1024 / 1024)} MB limit.`);
  }
  return errors;
}
