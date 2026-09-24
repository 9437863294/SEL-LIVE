import { mailRoute, readJson } from '@/lib/mail-hub/route';
import { updateAssignment } from '@/lib/mail-hub/workflow-service';

/** Assign, take, change status or set the response deadline of a shared-mailbox conversation. Audited. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const PATCH = mailRoute<{ threadId: string }>('threads.assignment', async ({ request, context, params }) => {
  const body = await readJson<{ assigneeId?: string | null; status?: 'open' | 'pending' | 'closed'; dueAt?: string | null }>(request, 5_000);
  const input: Parameters<typeof updateAssignment>[2] = {};
  if ('assigneeId' in body) input.assigneeId = body.assigneeId ?? null;
  if (body.status && ['open', 'pending', 'closed'].includes(body.status)) input.status = body.status;
  if ('dueAt' in body) input.dueAt = body.dueAt ?? null;
  return { assignment: await updateAssignment(context, params.threadId, input) };
});
