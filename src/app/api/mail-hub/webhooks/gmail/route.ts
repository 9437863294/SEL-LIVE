import { gmailPushAudience, gmailPushServiceAccount } from '@/lib/mail-hub/config';
import { MAIL_HUB_COLLECTIONS, type MailAccount } from '@/lib/mail-hub/model';
import { enqueueSync } from '@/lib/mail-hub/server';
import { db } from '@/lib/mail-hub/store';
import { decodeGmailPush, safeEqual, verifyGoogleOidcToken } from '@/lib/mail-hub/webhook-auth';

/**
 * Gmail change notifications, pushed by Cloud Pub/Sub (`users.watch` → topic → push subscription).
 *
 * The notification says only "this mailbox changed, history is now at N". It is never trusted for
 * content: it enqueues a `sync` job (deduplicated per account, so a burst collapses to one run),
 * and the sync reads `history.list` from the ERP's own stored cursor. A duplicated, delayed or
 * out-of-order notification therefore costs nothing.
 *
 * Authentication: the Pub/Sub push subscription's OIDC token (preferred), or a shared token in the
 * push URL for subscriptions that cannot use OIDC. With neither configured the endpoint refuses.
 * The response is 2xx for anything authenticated, so Pub/Sub does not redeliver a message the ERP
 * has already queued.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const sharedToken = process.env.MAIL_HUB_GMAIL_PUSH_TOKEN?.trim();
  const serviceAccount = gmailPushServiceAccount();
  const bearer = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const urlToken = new URL(request.url).searchParams.get('token') ?? '';

  let authenticated = false;
  if (bearer && serviceAccount) {
    const verified = await verifyGoogleOidcToken(bearer, { audience: gmailPushAudience(), email: serviceAccount }).catch(() => ({ ok: false as const, reason: 'verification error' }));
    authenticated = verified.ok;
  }
  if (!authenticated && sharedToken && urlToken) authenticated = safeEqual(urlToken, sharedToken);
  if (!serviceAccount && !sharedToken) return Response.json({ error: 'Gmail push is not configured (MAIL_HUB_GMAIL_PUSH_SERVICE_ACCOUNT or MAIL_HUB_GMAIL_PUSH_TOKEN).' }, { status: 503 });
  if (!authenticated) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const payload = decodeGmailPush(await request.json().catch(() => null));
  if (!payload) return new Response(null, { status: 204 });

  const accounts = await db().collection(MAIL_HUB_COLLECTIONS.accounts).where('provider', '==', 'gmail').where('loginIdentity', '==', payload.emailAddress).limit(20).get();
  const now = new Date().toISOString();
  for (const doc of accounts.docs) {
    const account = doc.data() as MailAccount;
    if (!['active', 'connecting', 'error'].includes(account.status)) continue;
    await enqueueSync(doc.id, 'gmail-push');
    await doc.ref.set({ watch: { lastNotificationAt: now } }, { merge: true });
  }
  return new Response(null, { status: 204 });
}
