import { mailRoute } from '@/lib/mail-hub/route';
import { listSharedMailboxes } from '@/lib/mail-hub/workflow-service';

/** Shared mailboxes: every one for an administrator; otherwise those you are a member of, with your access. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = mailRoute('shared.list', async ({ context }) => ({ sharedMailboxes: await listSharedMailboxes(context) }));
