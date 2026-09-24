import { loadBody } from '@/lib/mail-hub/mailbox-service';
import { MAIL_HUB_COLLECTIONS, type MailMessage } from '@/lib/mail-hub/model';
import { mailRoute } from '@/lib/mail-hub/route';
import { MailHubError, requireMailbox } from '@/lib/mail-hub/server';
import { getOne } from '@/lib/mail-hub/store';

/**
 * A message body, sanitised (`GET /api/mail-hub/messages/{id}/body?remote=1`).
 *
 * Remote images are blocked unless `remote=1` is asked for this one message, or the sender's domain
 * is on the reader's own trusted list. The response is HTML that has already been through the
 * server allowlist; the browser runs DOMPurify again and renders it in a sandboxed frame.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export const GET = mailRoute<{ messageId: string }>('messages.body', async ({ context, params, url }) => {
  const message = await getOne<MailMessage>(MAIL_HUB_COLLECTIONS.messages, params.messageId);
  if (!message || message.deleted) throw new MailHubError('Message not found.', 404);
  const resolved = await requireMailbox(context, message.accountId, 'read');
  const body = await loadBody(resolved, message, { allowRemote: url.searchParams.get('remote') === '1', viewerId: context.userId });
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  });
});
