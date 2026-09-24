import { mailRoute, readJson } from '@/lib/mail-hub/route';
import { MailHubError } from '@/lib/mail-hub/server';
import { removeMember, verifyMemberGrant } from '@/lib/mail-hub/workflow-service';

/**
 * `POST {action:'verify', memberAccountId?}` — check this member's provider grant with their own
 * connected account (the member themselves, or an administrator).
 * `DELETE` — remove the membership (administrators).
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export const POST = mailRoute<{ sharedMailboxId: string; userId: string }>('members.verify', async ({ request, context, params }) => {
  const body = await readJson<{ action?: string; memberAccountId?: string | null }>(request, 2_000);
  if (body.action !== 'verify') throw new MailHubError('Unknown action.', 400);
  const grant = await verifyMemberGrant(
    { userId: context.userId, userName: context.userName, isAdmin: context.caps.canAdministerConnections },
    params.sharedMailboxId,
    params.userId,
    // Only the member may choose which of their own accounts to verify with.
    params.userId === context.userId ? (body.memberAccountId ?? null) : null,
  );
  return { grant };
});

export const DELETE = mailRoute<{ sharedMailboxId: string; userId: string }>('members.remove', async ({ context, params }) => {
  await removeMember(context, params.sharedMailboxId, params.userId);
  return { ok: true };
});
