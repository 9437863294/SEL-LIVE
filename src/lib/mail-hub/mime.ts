/**
 * Mail Hub — building RFC 5322 messages.
 *
 * One builder for every provider: Gmail's `messages.send` takes the raw message, Graph's
 * `sendMail` accepts it as MIME, and the SMTP path transmits it. Building the bytes once, in one
 * place, is what makes the Message-ID (and so the duplicate-send check) identical on every path.
 *
 * nodemailer's MailComposer does the encoding — header folding, RFC 2047 words, quoted-printable,
 * attachment boundaries — which is exactly the code that should not be written twice.
 */

import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import addressparser from 'nodemailer/lib/addressparser/index.js';

import type { MailAddress } from './model.ts';
import { formatAddress, htmlToText } from './rules.ts';

export interface RawMessageInput {
  from: MailAddress;
  /** Sender header, when a member sends on behalf of a shared mailbox the provider allows it for. */
  sender?: MailAddress | null;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  replyTo?: MailAddress[];
  subject: string;
  html: string;
  text?: string | null;
  messageId: string;
  inReplyTo?: string | null;
  references?: string[];
  date?: Date;
  attachments?: { filename: string; contentType: string; content: Uint8Array }[];
  /** Keep the Bcc header in the bytes. Gmail and Graph need it to deliver; SMTP must not transmit it. */
  keepBcc?: boolean;
}

const bracket = (id: string) => (id.startsWith('<') ? id : `<${id}>`);

export async function buildRawMessage(input: RawMessageInput): Promise<Buffer> {
  const composer = new MailComposer({
    from: formatAddress(input.from),
    sender: input.sender ? formatAddress(input.sender) : undefined,
    to: input.to.map(formatAddress),
    cc: input.cc.length ? input.cc.map(formatAddress) : undefined,
    bcc: input.bcc.length ? input.bcc.map(formatAddress) : undefined,
    replyTo: input.replyTo?.length ? input.replyTo.map(formatAddress) : undefined,
    subject: input.subject,
    html: input.html,
    text: input.text ?? htmlToText(input.html),
    messageId: bracket(input.messageId),
    inReplyTo: input.inReplyTo ? bracket(input.inReplyTo) : undefined,
    references: input.references?.length ? input.references.map(bracket).join(' ') : undefined,
    date: input.date ?? new Date(),
    attachments: (input.attachments ?? []).map((entry) => ({
      filename: entry.filename,
      contentType: entry.contentType,
      content: Buffer.from(entry.content),
    })),
    headers: { 'X-Mailer': 'SEL LIVE ERP Mail Hub' },
  });
  const node = composer.compile();
  if (input.keepBcc) (node as unknown as { keepBcc: boolean }).keepBcc = true;
  return new Promise((resolve, reject) => {
    node.build((error: Error | null, message: Buffer) => (error ? reject(error) : resolve(message)));
  });
}

/** Split a raw message into its header block and body. */
function splitHeaders(raw: Buffer): { headers: string; body: Buffer } {
  const text = raw.toString('latin1');
  const end = text.search(/\r?\n\r?\n/);
  if (end < 0) return { headers: text, body: Buffer.alloc(0) };
  const separator = text.slice(end).startsWith('\r\n\r\n') ? 4 : 2;
  return { headers: text.slice(0, end), body: raw.subarray(end + separator) };
}

/** The same message with any Bcc header (including folded continuation lines) removed. */
export function stripBccHeader(raw: Uint8Array): Buffer {
  const buffer = Buffer.from(raw);
  const { headers, body } = splitHeaders(buffer);
  const lines = headers.split(/\r?\n/);
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (/^[ \t]/.test(line)) {
      if (!skipping) kept.push(line);
      continue;
    }
    skipping = /^bcc\s*:/i.test(line);
    if (!skipping) kept.push(line);
  }
  return Buffer.concat([Buffer.from(`${kept.join('\r\n')}\r\n\r\n`, 'latin1'), body]);
}

/** Every envelope recipient (To, Cc and Bcc) of a raw message, for SMTP's RCPT TO. */
export function envelopeOf(raw: Uint8Array): { from: string | null; to: string[] } {
  const { headers } = splitHeaders(Buffer.from(raw));
  const unfolded = headers.replace(/\r?\n[ \t]+/g, ' ');
  const read = (name: string) =>
    unfolded
      .split(/\r?\n/)
      .filter((line) => line.toLowerCase().startsWith(`${name}:`))
      .map((line) => line.slice(name.length + 1));
  const addresses = (values: string[]) =>
    values
      .flatMap((value) => addressparser(value, { flatten: true }) as { address?: string }[])
      .map((entry) => (entry.address ?? '').toLowerCase())
      .filter(Boolean);
  return {
    from: addresses(read('from'))[0] ?? null,
    to: [...new Set([...addresses(read('to')), ...addresses(read('cc')), ...addresses(read('bcc'))])],
  };
}
