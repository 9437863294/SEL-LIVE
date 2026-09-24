import { mailRoute } from '@/lib/mail-hub/route';
import { listAudit } from '@/lib/mail-hub/workflow-service';

/**
 * The Mail Hub audit trail. Administrators (Audit › View or Settings › Administer) see shared-mailbox
 * activity and configuration changes; everybody sees their own activity with `mine=1`. Personal-
 * mailbox events are never in the administrators' view.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = mailRoute('audit', async ({ context, url }) => ({
  events: await listAudit(context, {
    sharedMailboxId: url.searchParams.get('sharedMailboxId'),
    mineOnly: url.searchParams.get('mine') === '1',
    before: url.searchParams.get('before'),
    limit: Number(url.searchParams.get('limit') ?? 100),
  }),
}));
