import { messageView, summarize, threadMessages } from '@/lib/mail-hub/mailbox-service';
import { MAIL_HUB_COLLECTIONS, type MailFollowUp } from '@/lib/mail-hub/model';
import { mailRoute } from '@/lib/mail-hub/route';
import { auditSharedView } from '@/lib/mail-hub/server';
import { db } from '@/lib/mail-hub/store';
import { linksForThread, notesForThread, requireThread } from '@/lib/mail-hub/workflow-service';

/**
 * One conversation: its messages (headers — bodies load separately), ERP links, internal notes,
 * follow-ups, assignment, and what the caller may do with it. Opening a shared-mailbox thread is
 * recorded (at most once per person, thread and hour).
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = mailRoute<{ threadId: string }>('threads.get', async ({ context, params }) => {
  const { thread, resolved } = await requireThread(context, params.threadId, 'read');
  const [messages, links, notes, followUps] = await Promise.all([
    threadMessages(thread.id),
    linksForThread(thread.id),
    notesForThread(thread.id),
    db().collection(MAIL_HUB_COLLECTIONS.followUps).where('threadId', '==', thread.id).limit(50).get(),
  ]);
  await auditSharedView(context, resolved, thread.id);
  const d = resolved.decision;
  return {
    thread: summarize(thread),
    account: {
      id: resolved.account.id,
      emailAddress: resolved.account.emailAddress,
      provider: resolved.account.provider,
      kind: resolved.account.kind,
      capabilities: resolved.account.capabilities,
      status: resolved.account.status,
    },
    sharedMailbox: resolved.sharedMailbox ? { id: resolved.sharedMailbox.id, name: resolved.sharedMailbox.name, address: resolved.sharedMailbox.address } : null,
    access: { canModify: d.canModify, canSend: d.canSend, canAssign: d.canAssign, canWorkOwnAssignment: d.canWorkOwnAssignment, canAddNotes: d.canAddNotes },
    messages: messages.map(messageView),
    links,
    notes,
    followUps: followUps.docs.map((doc) => ({ ...(doc.data() as MailFollowUp), id: doc.id })),
  };
});
