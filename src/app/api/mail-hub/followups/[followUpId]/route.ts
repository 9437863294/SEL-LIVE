import type { MailFollowUp, MailPriority } from '@/lib/mail-hub/model';
import { mailRoute, readJson } from '@/lib/mail-hub/route';
import { updateFollowUp } from '@/lib/mail-hub/workflow-service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const PATCH = mailRoute<{ followUpId: string }>('followups.update', async ({ request, context, params }) => {
  const body = await readJson<{ status?: MailFollowUp['status']; dueAt?: string; priority?: MailPriority; officeHubTaskId?: string | null }>(request, 5_000);
  return { followUp: await updateFollowUp(context, params.followUpId, body) };
});
