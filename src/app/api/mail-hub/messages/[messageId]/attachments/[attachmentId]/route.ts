import { downloadAttachment } from '@/lib/mail-hub/mailbox-service';
import { MAIL_HUB_COLLECTIONS, type MailMessage } from '@/lib/mail-hub/model';
import { mailRoute } from '@/lib/mail-hub/route';
import { MailHubError, requireMailbox } from '@/lib/mail-hub/server';
import { getOne } from '@/lib/mail-hub/store';

/**
 * Download (or preview) an attachment, relayed from the provider.
 *
 * Blocked types are refused, the bytes are validated against what actually arrived, and scanned
 * when a scanner is configured. The response never lets the browser guess: `nosniff`, a download
 * disposition unless `inline=1` was asked for a previewable type (images, PDF, plain text — never
 * HTML or SVG), and a CSP that forbids the file from running anything if opened directly.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

export const GET = mailRoute<{ messageId: string; attachmentId: string }>('messages.attachment', async ({ context, params, url }) => {
  const message = await getOne<MailMessage>(MAIL_HUB_COLLECTIONS.messages, params.messageId);
  if (!message || message.deleted) throw new MailHubError('Message not found.', 404);
  const resolved = await requireMailbox(context, message.accountId, 'read');
  const file = await downloadAttachment(context, resolved, message, params.attachmentId);
  const inline = url.searchParams.get('inline') === '1' && file.preview !== 'none';
  const contentType = inline
    ? file.preview === 'pdf'
      ? 'application/pdf'
      : file.preview === 'text'
        ? 'text/plain; charset=utf-8'
        : file.contentType
    : 'application/octet-stream';
  return new Response(Buffer.from(file.content), {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(file.content.byteLength),
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
      'Cache-Control': 'private, no-store',
      'X-Mail-Scan-Status': file.scanStatus,
    },
  });
});
