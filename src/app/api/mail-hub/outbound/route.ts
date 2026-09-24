import { MAIL_HUB_COLLECTIONS, type MailOutbound, type MailOutboundStatus } from '@/lib/mail-hub/model';
import { mailRoute } from '@/lib/mail-hub/route';
import { db } from '@/lib/mail-hub/store';

/**
 * The caller's own drafts, scheduled and failed messages (`GET /api/mail-hub/outbound?status=…`).
 * Always the caller's own — `ownerUserId` is the query, not a filter applied afterwards.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const STATUSES: MailOutboundStatus[] = ['draft', 'scheduled', 'failed', 'queued', 'sending', 'sent'];

export const GET = mailRoute('outbound.list', async ({ context, url }) => {
  const requested = (url.searchParams.get('status') ?? 'draft').split(',').filter((entry): entry is MailOutboundStatus => STATUSES.includes(entry as MailOutboundStatus));
  const snapshot = await db()
    .collection(MAIL_HUB_COLLECTIONS.outbound)
    .where('ownerUserId', '==', context.userId)
    .where('status', 'in', requested.length ? requested.slice(0, 10) : ['draft'])
    .orderBy('updatedAt', 'desc')
    .limit(100)
    .get();
  return {
    outbound: snapshot.docs.map((doc) => {
      const { html: _html, text: _text, ...rest } = { ...(doc.data() as MailOutbound), id: doc.id };
      return rest;
    }),
  };
});
