/**
 * Mail Hub — sending, exactly once.
 *
 * The hard part of sending mail from a worker is not sending it; it is *not sending it twice*. A
 * send can succeed at the provider and then the process dies before the ERP records it — a
 * timeout, a redeploy, a lease that ran out. A naive retry then mails the customer again.
 *
 * The rule this file implements:
 *
 *   1. Every outbound message is given its RFC 5322 Message-ID **once, at creation**, and every
 *      attempt sends that same Message-ID.
 *   2. Claiming a message for sending is a compare-and-set (`claimOutbound`): only one attempt holds
 *      the lease at a time, and a scheduled message cancelled a second before its time is not sent.
 *   3. **Any attempt after the first asks the provider first** whether a message with that
 *      Message-ID is already in the mailbox's sent mail. If it is, the earlier attempt succeeded
 *      and this one records the success instead of sending.
 *
 * That makes retries safe without distributed locks and without trusting the ERP's own record of
 * what happened — the provider's sent mail is the source of truth.
 *
 * Scheduled sends re-check authorization at send time (`authorize`): somebody removed from a
 * shared mailbox on Monday does not get their Friday-scheduled message sent from it.
 */

import type { MailOutbound } from './model.ts';
import {
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderUnavailableError,
  type MailProviderAdapter,
} from './providers/types.ts';

export type SendPlan =
  | 'send'
  | 'verify-then-send'
  | 'already-sent'
  | 'cancelled'
  | 'not-ready'
  | 'not-due'
  | 'in-progress';

export function planSendAttempt(outbound: Pick<MailOutbound, 'status' | 'scheduledAt' | 'leaseUntil' | 'attempts'>, now: Date): SendPlan {
  const at = now.toISOString();
  switch (outbound.status) {
    case 'sent':
      return 'already-sent';
    case 'cancelled':
      return 'cancelled';
    case 'draft':
      return 'not-ready';
    case 'scheduled':
      if (outbound.scheduledAt && outbound.scheduledAt > at) return 'not-due';
      break;
    case 'sending':
      if (outbound.leaseUntil && outbound.leaseUntil > at) return 'in-progress';
      // The previous attempt died holding the lease. It may or may not have reached the provider.
      return 'verify-then-send';
    default:
      break;
  }
  return outbound.attempts > 0 ? 'verify-then-send' : 'send';
}

export interface SendStore {
  /**
   * Compare-and-set: move the outbound to `sending` iff `planSendAttempt` still says to send.
   * Returns the plan that was acted on.
   */
  claimOutbound(outboundId: string, now: Date, leaseMs: number): Promise<{ outbound: MailOutbound | null; plan: SendPlan }>;
  markOutbound(outboundId: string, patch: Partial<MailOutbound>): Promise<void>;
}

export interface SendDeps {
  store: SendStore;
  adapterFor(outbound: MailOutbound): Promise<MailProviderAdapter>;
  buildRaw(outbound: MailOutbound): Promise<Uint8Array>;
  /** Re-check, at send time, that the owner may still send this from this mailbox. */
  authorize(outbound: MailOutbound): Promise<{ ok: true } | { ok: false; reason: string }>;
  onSent?(outbound: MailOutbound, detail: { providerMessageId: string | null; verifiedDuplicate: boolean }): Promise<void>;
  onFailed?(outbound: MailOutbound, reason: string, permanent: boolean): Promise<void>;
  now?: () => Date;
  leaseMs?: number;
}

export type SendOutcome =
  | { status: 'sent'; providerMessageId: string | null }
  /** A previous attempt had already delivered it; nothing was sent this time. */
  | { status: 'duplicate-prevented' }
  | { status: 'skipped'; plan: SendPlan }
  | { status: 'retry'; error: string; retryAfterMs: number | null }
  | { status: 'failed'; error: string };

export async function executeSend(deps: SendDeps, outboundId: string): Promise<SendOutcome> {
  const now = deps.now ?? (() => new Date());
  const { outbound, plan } = await deps.store.claimOutbound(outboundId, now(), deps.leaseMs ?? 3 * 60_000);
  if (!outbound || (plan !== 'send' && plan !== 'verify-then-send')) return { status: 'skipped', plan };

  const authorized = await deps.authorize(outbound);
  if (!authorized.ok) {
    await deps.store.markOutbound(outboundId, { status: 'failed', lastError: authorized.reason, leaseUntil: null, updatedAt: now().toISOString() });
    await deps.onFailed?.(outbound, authorized.reason, true);
    return { status: 'failed', error: authorized.reason };
  }

  let adapter: MailProviderAdapter | null = null;
  let delivered: { providerMessageId: string | null; verifiedDuplicate: boolean };
  try {
    adapter = await deps.adapterFor(outbound);

    if (plan === 'verify-then-send' && (await adapter.findSentByMessageId(outbound.messageIdHeader, outbound.sharedMailboxId ? outbound.fromAddress : null))) {
      delivered = { providerMessageId: null, verifiedDuplicate: true };
    } else {
      const raw = await deps.buildRaw(outbound);
      const result = await adapter.send({
        raw,
        messageIdHeader: outbound.messageIdHeader,
        providerThreadId: outbound.providerThreadId,
        sendAsMailbox: outbound.sharedMailboxId ? outbound.fromAddress : null,
      });
      delivered = { providerMessageId: result.providerMessageId, verifiedDuplicate: false };
    }
  } catch (error) {
    await adapter?.close?.().catch(() => {});
    const message = error instanceof Error ? error.message : String(error);
    const transient = error instanceof ProviderRateLimitError || error instanceof ProviderUnavailableError;
    const updatedAt = now().toISOString();
    if (transient) {
      // Back to `queued`, keeping `attempts`, so the next attempt verifies before sending.
      await deps.store.markOutbound(outboundId, { status: 'queued', lastError: message, leaseUntil: null, updatedAt });
      return {
        status: 'retry',
        error: message,
        retryAfterMs: error instanceof ProviderRateLimitError ? error.retryAfterMs : null,
      };
    }
    const reason =
      error instanceof ProviderAuthError
        ? 'The mailbox needs to be reconnected before this message can be sent.'
        : message;
    await deps.store.markOutbound(outboundId, { status: 'failed', lastError: reason, leaseUntil: null, updatedAt });
    await deps.onFailed?.(outbound, reason, true);
    return { status: 'failed', error: reason };
  }
  await adapter?.close?.().catch(() => {});

  // Outside the provider try/catch on purpose. The provider has the message; if recording that
  // fails, the error propagates, the lease lapses, and the next attempt finds the Message-ID in
  // Sent and records success — rather than this attempt calling a delivered message "failed".
  const sentAt = now().toISOString();
  await deps.store.markOutbound(outboundId, {
    status: 'sent',
    sentAt,
    ...(delivered.providerMessageId ? { providerMessageId: delivered.providerMessageId } : {}),
    leaseUntil: null,
    lastError: null,
    updatedAt: sentAt,
  });
  await deps.onSent?.(outbound, delivered);
  return delivered.verifiedDuplicate ? { status: 'duplicate-prevented' } : { status: 'sent', providerMessageId: delivered.providerMessageId };
}
