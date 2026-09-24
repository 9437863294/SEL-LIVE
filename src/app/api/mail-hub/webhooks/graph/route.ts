import { graphClientState } from '@/lib/mail-hub/accounts-service';
import { MAIL_HUB_COLLECTIONS } from '@/lib/mail-hub/model';
import { enqueueSync } from '@/lib/mail-hub/server';
import { db, jobQueue } from '@/lib/mail-hub/store';
import { safeEqual } from '@/lib/mail-hub/webhook-auth';

/**
 * Microsoft Graph change and lifecycle notifications.
 *
 * - **Validation**: when a subscription is created or renewed, Graph calls with `?validationToken=`
 *   and expects it echoed as `text/plain` within ten seconds. Nothing else happens on that call.
 * - **Change notifications**: each carries the subscription id and the `clientState` the ERP set —
 *   an HMAC of the account id, compared in constant time. A notification whose clientState does
 *   not match is ignored. A matching one enqueues a delta sync; the notification's own content is
 *   never used, so duplicates and reordering are harmless.
 * - **Lifecycle** (`?lifecycle=1`): `reauthorizationRequired` renews the subscription,
 *   `subscriptionRemoved` re-creates it, and `missed` just syncs — delta catches up on its own.
 *
 * Always answers 202 promptly for authenticated traffic; Graph drops subscriptions whose endpoint
 * is slow or failing.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface GraphNotification {
  subscriptionId?: string;
  clientState?: string;
  changeType?: string;
  lifecycleEvent?: 'reauthorizationRequired' | 'subscriptionRemoved' | 'missed';
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const validationToken = url.searchParams.get('validationToken');
  if (validationToken) {
    return new Response(validationToken.slice(0, 1024), { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }

  const body = (await request.json().catch(() => null)) as { value?: GraphNotification[] } | null;
  const notifications = (body?.value ?? []).slice(0, 100);
  const seen = new Set<string>();
  for (const notification of notifications) {
    if (!notification.subscriptionId || seen.has(notification.subscriptionId)) continue;
    seen.add(notification.subscriptionId);
    const match = await db().collection(MAIL_HUB_COLLECTIONS.accounts).where('watch.subscriptionId', '==', notification.subscriptionId).limit(1).get();
    const doc = match.docs[0];
    if (!doc) continue;
    if (!notification.clientState || !safeEqual(notification.clientState, graphClientState(doc.id))) continue;

    if (notification.lifecycleEvent === 'reauthorizationRequired' || notification.lifecycleEvent === 'subscriptionRemoved') {
      await jobQueue.enqueue({ type: 'watch.renew', accountId: doc.id, dedupeKey: `watch:${doc.id}:lifecycle` });
    }
    await enqueueSync(doc.id, notification.lifecycleEvent ? `graph-${notification.lifecycleEvent}` : 'graph-push');
    await doc.ref.set({ watch: { lastNotificationAt: new Date().toISOString() } }, { merge: true });
  }
  return new Response(null, { status: 202 });
}
