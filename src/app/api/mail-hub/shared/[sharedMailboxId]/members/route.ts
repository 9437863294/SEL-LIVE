import type { MailMemberRole } from '@/lib/mail-hub/model';
import { mailRoute, readJson } from '@/lib/mail-hub/route';
import { MailHubError } from '@/lib/mail-hub/server';
import { listMembers, upsertMember } from '@/lib/mail-hub/workflow-service';

/**
 * Members of a shared mailbox. Adding someone is the ERP half of access; they still need their own
 * provider grant, verified with their own account, before they can read anything.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = mailRoute<{ sharedMailboxId: string }>('members.list', async ({ context, params }) => ({
  members: await listMembers(context, params.sharedMailboxId),
}));

export const POST = mailRoute<{ sharedMailboxId: string }>('members.upsert', async ({ request, context, params }) => {
  const body = await readJson<{ userId?: string; role?: MailMemberRole; canSend?: boolean }>(request, 5_000);
  if (!body.userId) throw new MailHubError('Choose a user.', 400);
  return { member: await upsertMember(context, params.sharedMailboxId, { userId: body.userId, role: body.role ?? 'reader', canSend: Boolean(body.canSend) }) };
});
