import { mailRoute } from '@/lib/mail-hub/route';
import { removeLink } from '@/lib/mail-hub/workflow-service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const DELETE = mailRoute<{ linkId: string }>('links.remove', async ({ context, params }) => {
  await removeLink(context, params.linkId);
  return { ok: true };
});
