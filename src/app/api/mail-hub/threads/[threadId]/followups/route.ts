import type { MailPriority } from '@/lib/mail-hub/model';
import { mailRoute, readJson } from '@/lib/mail-hub/route';
import { createFollowUp } from '@/lib/mail-hub/workflow-service';

/**
 * Create a follow-up from a conversation: owner, due date, priority and reminders. The composer
 * can also create an Office Hub task in the browser (through Office Hub's own service and
 * permissions) and pass its id here, so the two stay linked.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = mailRoute<{ threadId: string }>('followups.create', async ({ request, context, params }) => {
  const body = await readJson<{ title?: string; ownerId?: string | null; dueAt?: string; priority?: MailPriority; reminderOffsets?: number[]; officeHubTaskId?: string | null }>(request, 10_000);
  return {
    followUp: await createFollowUp(context, params.threadId, {
      title: String(body.title ?? ''),
      ownerId: body.ownerId ?? null,
      dueAt: String(body.dueAt ?? ''),
      priority: body.priority,
      reminderOffsets: Array.isArray(body.reminderOffsets) ? body.reminderOffsets.map(Number) : undefined,
      officeHubTaskId: body.officeHubTaskId ?? null,
    }),
  };
});
