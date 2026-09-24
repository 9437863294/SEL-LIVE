import { summarize } from '@/lib/mail-hub/mailbox-service';
import { mailRoute } from '@/lib/mail-hub/route';
import { myWork } from '@/lib/mail-hub/workflow-service';

/** The caller's mail work: open follow-ups they own, and shared-mailbox conversations assigned to them. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = mailRoute('tasks', async ({ context }) => {
  const work = await myWork(context);
  return {
    followUps: work.followUps,
    assigned: work.assigned.map((entry) => ({ ...summarize(entry.thread), deadline: entry.deadline })),
  };
});
