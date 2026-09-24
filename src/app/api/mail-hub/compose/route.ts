import { normalizeComposeRequest } from '@/lib/mail-hub/compose';
import { saveOutbound } from '@/lib/mail-hub/compose-service';
import { mailRoute, readJson } from '@/lib/mail-hub/route';
import { MailHubError } from '@/lib/mail-hub/server';

/**
 * Save a draft, send now, or schedule (`POST /api/mail-hub/compose`, `{ intent, ...message }`).
 *
 * The body goes through `normalizeComposeRequest`, which keeps only the fields a message can carry
 * — so an internal note, an assignment or a forged Message-ID in the request never reaches the
 * outgoing message. Nothing here is ever sent without this request: AI suggestions only fill the
 * composer, and a scheduled message was scheduled by this same request.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

export const POST = mailRoute('compose', async ({ request, context }) => {
  const body = await readJson<Record<string, unknown>>(request);
  const intent = body.intent === 'send' || body.intent === 'schedule' ? body.intent : 'draft';
  const normalized = normalizeComposeRequest(body);
  if (!normalized.ok) throw new MailHubError(normalized.errors[0], 400, normalized.errors.slice(1).join(' ') || null);
  const { outbound, result } = await saveOutbound(context, normalized.value, intent);
  return {
    outbound: { id: outbound.id, status: outbound.status, scheduledAt: outbound.scheduledAt, subject: outbound.subject },
    result,
    message:
      intent === 'draft'
        ? 'Draft saved.'
        : intent === 'schedule'
          ? 'Scheduled.'
          : result?.status === 'sent' || result?.status === 'duplicate-prevented'
            ? 'Sent.'
            : result?.status === 'retry'
              ? 'The provider is busy; the message is queued and will be retried automatically.'
              : result?.status === 'failed'
                ? `Not sent: ${result.error}`
                : 'Queued.',
  };
});
