import { composePrefill } from '@/lib/mail-hub/compose-service';
import { MAIL_HUB_COLLECTIONS, type MailMessage } from '@/lib/mail-hub/model';
import { mailRoute } from '@/lib/mail-hub/route';
import { MailHubError, requireMailbox } from '@/lib/mail-hub/server';
import { getOne } from '@/lib/mail-hub/store';

/** Recipients, subject and quoted text for a reply, reply-all or forward of one message. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = mailRoute('compose.prefill', async ({ context, url }) => {
  const mode = url.searchParams.get('mode');
  if (mode !== 'reply' && mode !== 'replyAll' && mode !== 'forward') throw new MailHubError('Unknown mode.', 400);
  const message = await getOne<MailMessage>(MAIL_HUB_COLLECTIONS.messages, url.searchParams.get('messageId') ?? '');
  if (!message || message.deleted) throw new MailHubError('Message not found.', 404);
  const resolved = await requireMailbox(context, message.accountId, 'read');
  return composePrefill(resolved, message, mode);
});
