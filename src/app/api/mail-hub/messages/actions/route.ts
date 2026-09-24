import { applyAction, threadMessages, type MailAction } from '@/lib/mail-hub/mailbox-service';
import { MAIL_HUB_COLLECTIONS, type MailMessage } from '@/lib/mail-hub/model';
import { mailRoute, readJson } from '@/lib/mail-hub/route';
import { MailHubError, requireMailbox } from '@/lib/mail-hub/server';
import { getMany } from '@/lib/mail-hub/store';
import { requireThread } from '@/lib/mail-hub/workflow-service';

/**
 * Mark read/unread, flag, archive, trash, restore, delete or move — for a list of messages or for
 * every message of a thread. Applied at the provider first; the ERP's copy is updated optimistically
 * and confirmed by the next sync.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const TYPES = ['markRead', 'flag', 'archive', 'trash', 'untrash', 'delete', 'move'];

export const POST = mailRoute('messages.actions', async ({ request, context }) => {
  const body = await readJson<{ threadId?: string; messageIds?: string[]; action?: MailAction }>(request, 50_000);
  const action = body.action;
  if (!action || !TYPES.includes(action.type)) throw new MailHubError('Unknown action.', 400);

  let accountId: string;
  let messages: MailMessage[];
  if (body.threadId) {
    const { thread } = await requireThread(context, body.threadId, 'read');
    accountId = thread.accountId;
    messages = await threadMessages(thread.id);
  } else {
    const ids = (body.messageIds ?? []).slice(0, 200);
    messages = [...(await getMany<MailMessage>(MAIL_HUB_COLLECTIONS.messages, ids)).values()];
    accountId = messages[0]?.accountId ?? '';
    if (messages.some((message) => message.accountId !== accountId)) throw new MailHubError('Act on one mailbox at a time.', 400);
  }
  if (!messages.length) throw new MailHubError('Nothing to change.', 404);
  // Reading state is personal to the reader in a personal mailbox; in a shared one it is visible to
  // the whole team and to the provider, so it needs the same right as any other change.
  const resolved = await requireMailbox(context, accountId, 'modify');
  const targets = action.type === 'markRead' && body.threadId && action.value ? messages.filter((message) => !message.isRead) : messages;
  return applyAction(resolved, targets, action);
});
