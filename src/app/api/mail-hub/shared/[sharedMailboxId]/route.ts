import type { MailSharedMailbox } from '@/lib/mail-hub/model';
import { mailRoute, readJson } from '@/lib/mail-hub/route';
import { updateSharedMailbox } from '@/lib/mail-hub/workflow-service';

/** Rename, set the department and default response time, or enable/disable a shared mailbox. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const PATCH = mailRoute<{ sharedMailboxId: string }>('shared.update', async ({ request, context, params }) => ({
  sharedMailbox: await updateSharedMailbox(
    context,
    params.sharedMailboxId,
    await readJson<Partial<Pick<MailSharedMailbox, 'name' | 'departmentId' | 'departmentName' | 'responseHours' | 'active'>>>(request, 5_000),
  ),
}));
