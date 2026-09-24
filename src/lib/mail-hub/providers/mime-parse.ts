/**
 * Parse a raw RFC 5322 message into a body and attachments.
 *
 * Used by the Graph adapter (`/messages/{id}/$value`) and the IMAP adapter (`FETCH BODY[]`). One
 * parser for both means one set of decoding quirks rather than two, and it yields inline images
 * directly — so `cid:` references can be turned into `data:` URIs without a second fetch.
 */

import { simpleParser, type Attachment } from 'mailparser';

import { normalizeMessageId } from '../rules.ts';
import type { ProviderAttachmentContent, ProviderAttachmentMeta, ProviderMessageBody } from './types.ts';

/** Inline images larger than this are left as blocked placeholders rather than embedded. */
export const MAX_INLINE_IMAGE_BYTES = 1024 * 1024;
const INLINE_TYPES = /^image\/(png|jpe?g|gif|webp)$/i;

export function attachmentKey(attachment: Pick<Attachment, 'checksum' | 'filename' | 'size'>, index: number): string {
  // mailparser's checksum is an MD5 of the content: stable across fetches of the same message.
  return attachment.checksum ? `md5:${attachment.checksum}` : `idx:${index}:${attachment.size}`;
}

export async function parseRawMessage(raw: Buffer | Uint8Array): Promise<ProviderMessageBody & { inlineImages: Record<string, string> }> {
  const parsed = await simpleParser(Buffer.from(raw), { skipImageLinks: true, skipTextToHtml: true });
  const inlineImages: Record<string, string> = {};
  let inlineBytes = 0;
  const attachments: ProviderAttachmentMeta[] = parsed.attachments.map((attachment, index) => {
    const contentId = normalizeMessageId(attachment.contentId ?? attachment.cid ?? null);
    const inline = attachment.contentDisposition === 'inline' || Boolean(attachment.related && contentId);
    if (contentId && INLINE_TYPES.test(attachment.contentType) && attachment.size <= MAX_INLINE_IMAGE_BYTES && inlineBytes < 5 * MAX_INLINE_IMAGE_BYTES) {
      inlineImages[contentId] = `data:${attachment.contentType.toLowerCase()};base64,${attachment.content.toString('base64')}`;
      inlineBytes += attachment.size;
    }
    return {
      providerAttachmentId: attachmentKey(attachment, index),
      filename: attachment.filename || (inline ? 'inline-image' : 'attachment'),
      contentType: attachment.contentType || 'application/octet-stream',
      size: attachment.size,
      inline,
      contentId,
    };
  });
  return {
    html: typeof parsed.html === 'string' ? parsed.html : null,
    text: parsed.text ?? null,
    attachments,
    inlineImages,
  };
}

export async function extractAttachment(raw: Buffer | Uint8Array, providerAttachmentId: string): Promise<ProviderAttachmentContent | null> {
  const parsed = await simpleParser(Buffer.from(raw), { skipImageLinks: true, skipTextToHtml: true });
  const index = parsed.attachments.findIndex((attachment, i) => attachmentKey(attachment, i) === providerAttachmentId);
  if (index < 0) return null;
  const attachment = parsed.attachments[index];
  return {
    filename: attachment.filename || 'attachment',
    contentType: attachment.contentType || 'application/octet-stream',
    content: new Uint8Array(attachment.content),
  };
}
