import { searchMail } from '@/lib/mail-hub/mailbox-service';
import { mailRoute } from '@/lib/mail-hub/route';
import { MailHubError, readableAccounts, requireMailbox } from '@/lib/mail-hub/server';

/**
 * Search (`GET /api/mail-hub/search?q=…&scope=local|provider&accountId=…`).
 *
 * `local` searches the ERP's index of headers and snippets across every mailbox the caller can
 * read. `provider` additionally asks each mailbox's provider to search full bodies (Gmail `q`,
 * Graph `$search`, IMAP `SEARCH TEXT`), and stores the hits so they open like synced mail.
 * Operators: `from:` `to:` `has:attachment` `is:unread` `after:YYYY-MM-DD` `before:YYYY-MM-DD`.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export const GET = mailRoute('search', async ({ context, url }) => {
  const query = (url.searchParams.get('q') ?? '').trim().slice(0, 300);
  if (!query) throw new MailHubError('Type something to search for.', 400);
  const accountId = url.searchParams.get('accountId');
  const mailboxes = accountId ? [await requireMailbox(context, accountId, 'read')] : await readableAccounts(context);
  return searchMail({
    mailboxes,
    query,
    scope: url.searchParams.get('scope') === 'provider' ? 'provider' : 'local',
    limit: Number(url.searchParams.get('limit') ?? 50),
  });
});
