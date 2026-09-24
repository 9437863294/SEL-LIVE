import { cancelScheduled, discardDraft } from '@/lib/mail-hub/compose-service';
import { MAIL_HUB_COLLECTIONS, type MailOutbound } from '@/lib/mail-hub/model';
import { mailRoute, readJson } from '@/lib/mail-hub/route';
import { MailHubError } from '@/lib/mail-hub/server';
import { getOne } from '@/lib/mail-hub/store';

/**
 * `GET` — one of your drafts, to reopen in the composer.
 * `POST {action:'cancel'}` — unschedule (back to a draft), if it has not started sending.
 * `DELETE` — discard a draft (and its uploads, and its provider-side draft copy).
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = mailRoute<{ outboundId: string }>('outbound.get', async ({ context, params }) => {
  const outbound = await getOne<MailOutbound>(MAIL_HUB_COLLECTIONS.outbound, params.outboundId);
  if (!outbound || outbound.ownerUserId !== context.userId) throw new MailHubError('Not found.', 404);
  return { outbound };
});

export const POST = mailRoute<{ outboundId: string }>('outbound.cancel', async ({ request, context, params }) => {
  const body = await readJson<{ action?: string }>(request, 1_000);
  if (body.action !== 'cancel') throw new MailHubError('Unknown action.', 400);
  await cancelScheduled(context, params.outboundId);
  return { ok: true, message: 'Unscheduled. It is back in your drafts.' };
});

export const DELETE = mailRoute<{ outboundId: string }>('outbound.discard', async ({ context, params }) => {
  await discardDraft(context, params.outboundId);
  return { ok: true };
});
