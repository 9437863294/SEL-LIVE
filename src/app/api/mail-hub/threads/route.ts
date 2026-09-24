import { LIST_VIEWS, listThreads, type ListView } from '@/lib/mail-hub/mailbox-service';
import { mailRoute } from '@/lib/mail-hub/route';
import { MailHubError, readableAccounts, requireMailbox } from '@/lib/mail-hub/server';

/**
 * A page of conversations (`GET /api/mail-hub/threads`).
 *
 * `accountId` narrows to one mailbox (required for shared mailboxes); without it the unified view
 * spans the caller's *personal* mailboxes only — shared mailboxes are worked in /mail/shared, so
 * the inbox is never flooded by a team queue. `view` is a role (inbox, sent, …); `folderId` is a
 * specific folder or label; `filter` is unread | attachments | mine | unassigned | overdue | open;
 * `before` is the pagination cursor from the previous page.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = mailRoute('threads.list', async ({ context, url }) => {
  const params = url.searchParams;
  const view = (params.get('view') ?? 'inbox') as ListView;
  if (!LIST_VIEWS.includes(view)) throw new MailHubError('Unknown view.', 400);
  const accountId = params.get('accountId');
  const mailboxes = accountId
    ? [await requireMailbox(context, accountId, 'read')]
    : (await readableAccounts(context)).filter((entry) => entry.account.kind === 'personal');
  return listThreads({
    mailboxes,
    view,
    folderId: params.get('folderId'),
    before: params.get('before'),
    limit: Number(params.get('limit') ?? 50),
    filter: params.get('filter'),
    viewerId: context.userId,
  });
});
