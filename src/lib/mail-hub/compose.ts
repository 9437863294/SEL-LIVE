/**
 * Mail Hub — turning a compose request into an outbound message.
 *
 * The request body is untrusted JSON. `normalizeComposeRequest` copies **only** the fields a
 * message may carry into a fresh object; anything else in the request — an internal note, an
 * assignment, a `html` override, a spoofed `messageIdHeader` — is dropped here, before any other
 * code sees it. This is the enforcement half of "internal notes can never be sent": notes live in
 * their own collection and API (`/api/mail-hub/notes`), and this whitelist is the only door into
 * an outgoing message.
 *
 * Pure, and pinned by `tests/mail-hub-send.test.mjs`.
 */

import type { MailAddress, MailComposeMode } from './model.ts';
import { assembleOutgoingHtml, htmlToText, isValidEmail, normalizeEmail, parseAddressList } from './rules.ts';
import { sanitizeMailHtml } from './sanitize.ts';

export interface ComposeRequest {
  /** Existing draft to update, if any. */
  outboundId: string | null;
  accountId: string;
  sharedMailboxId: string | null;
  fromAddress: string;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  subject: string;
  bodyHtml: string;
  signatureId: string | null;
  includeQuote: boolean;
  mode: MailComposeMode;
  sourceMessageId: string | null;
  uploadIds: string[];
  scheduledAt: string | null;
  aiAssisted: boolean;
}

const MODES: MailComposeMode[] = ['new', 'reply', 'replyAll', 'forward'];

function addresses(value: unknown, invalid: string[]): MailAddress[] {
  if (typeof value === 'string') {
    const parsed = parseAddressList(value);
    invalid.push(...parsed.invalid);
    return parsed.addresses;
  }
  if (!Array.isArray(value)) return [];
  const out: MailAddress[] = [];
  for (const entry of value.slice(0, 200)) {
    const address = normalizeEmail(typeof entry === 'string' ? entry : (entry as { address?: unknown })?.address as string);
    const name = typeof entry === 'object' && entry && typeof (entry as { name?: unknown }).name === 'string' ? ((entry as { name: string }).name.trim().slice(0, 200) || null) : null;
    if (!isValidEmail(address)) invalid.push(String(address || entry));
    else if (!out.some((existing) => existing.address === address)) out.push({ name, address });
  }
  return out;
}

const str = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : '');
const optionalId = (value: unknown) => (typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(value) ? value : null);

export function normalizeComposeRequest(raw: unknown): { ok: true; value: ComposeRequest } | { ok: false; errors: string[] } {
  const body = (raw ?? {}) as Record<string, unknown>;
  const invalid: string[] = [];
  const accountId = optionalId(body.accountId);
  const mode = MODES.includes(body.mode as MailComposeMode) ? (body.mode as MailComposeMode) : 'new';
  const value: ComposeRequest = {
    outboundId: optionalId(body.outboundId),
    accountId: accountId ?? '',
    sharedMailboxId: optionalId(body.sharedMailboxId),
    fromAddress: normalizeEmail(str(body.fromAddress, 320)),
    to: addresses(body.to, invalid),
    cc: addresses(body.cc, invalid),
    bcc: addresses(body.bcc, invalid),
    subject: str(body.subject, 998).replace(/[\r\n]+/g, ' '),
    bodyHtml: str(body.bodyHtml, 2_000_000),
    signatureId: optionalId(body.signatureId),
    includeQuote: body.includeQuote !== false,
    mode,
    sourceMessageId: optionalId(body.sourceMessageId),
    uploadIds: Array.isArray(body.uploadIds) ? body.uploadIds.map(optionalId).filter((id): id is string => Boolean(id)).slice(0, 25) : [],
    scheduledAt: typeof body.scheduledAt === 'string' && !Number.isNaN(Date.parse(body.scheduledAt)) ? new Date(body.scheduledAt).toISOString() : null,
    aiAssisted: body.aiAssisted === true,
  };
  const errors: string[] = [];
  if (!accountId) errors.push('Choose the mailbox to send from.');
  if (mode !== 'new' && !value.sourceMessageId) errors.push('The message being answered is missing.');
  if (invalid.length) errors.push(`These addresses are not valid: ${invalid.slice(0, 5).join(', ')}`);
  return errors.length ? { ok: false, errors } : { ok: true, value };
}

export const MIN_SCHEDULE_LEAD_MS = 60_000;
export const MAX_SCHEDULE_AHEAD_MS = 366 * 86_400_000;

export function validateSchedule(scheduledAt: string | null, now: Date): string | null {
  if (!scheduledAt) return null;
  const at = Date.parse(scheduledAt);
  if (at < now.getTime() + MIN_SCHEDULE_LEAD_MS) return 'Choose a time at least a minute from now.';
  if (at > now.getTime() + MAX_SCHEDULE_AHEAD_MS) return 'Messages can be scheduled up to a year ahead.';
  return null;
}

/**
 * The HTML and text that will be sent: the user's body (sanitised — composed mail is still HTML
 * from a browser), the signature, and the quoted source message. Nothing else.
 */
export function buildOutgoingContent(input: { bodyHtml: string; signatureHtml: string | null; quotedHtml: string | null }): { html: string; text: string } {
  const clean = (html: string | null) => (html ? sanitizeMailHtml(html, { allowRemoteContent: true, rewriteLinks: false }).html : '');
  const html = assembleOutgoingHtml({
    bodyHtml: clean(input.bodyHtml),
    signatureHtml: clean(input.signatureHtml) || null,
    quotedHtml: input.quotedHtml ? clean(input.quotedHtml) : null,
  });
  return { html, text: htmlToText(html) };
}
