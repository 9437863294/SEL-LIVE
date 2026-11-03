'use client';

import { logUserActivity } from '@/lib/activity-logger';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';

/**
 * Recurring Payments' entries in the app-wide audit trail (`userLogs`, read by Settings › Audit Logs
 * and by the module's own Audit Log page).
 *
 * The module also keeps a per-record trail — `auditLogs` under each payment and master — which its
 * own record pages show. That trail never reached the system log, so Settings › Audit Logs showed
 * nothing for Recurring Payments at all: every generation, approval, payment and settings change was
 * invisible to anyone auditing the system. Each action now writes both; this is the one place that
 * decides how the system-log half looks, so the module's rows read consistently.
 *
 * Fire-and-forget by design, like `logUserActivity` beneath it: an action that succeeded must never
 * be reported as failed because its log line could not be written.
 */

export interface RecurringActivityActor {
  id: string;
  name?: string | null;
  email?: string | null;
}

export interface RecurringActivityTarget {
  /** Firestore id of the payment, master, vendor or rule the action touched. */
  recordId?: string;
  /** What a reviewer reads — the payment or master title, the vendor name. */
  recordRef?: string;
}

export function logRecurringActivity(
  actor: RecurringActivityActor | null | undefined,
  action: string,
  details: Record<string, unknown> = {},
  target: RecurringActivityTarget = {},
): void {
  if (!actor?.id) return;
  let sessionId: string | undefined;
  try {
    sessionId = typeof window !== 'undefined' ? (localStorage.getItem('sessionId') ?? undefined) : undefined;
  } catch {
    sessionId = undefined;
  }
  void logUserActivity({
    userId: actor.id,
    userName: actor.name ?? undefined,
    userEmail: actor.email ?? undefined,
    module: ACTIVITY_MODULES.RECURRING_PAYMENTS,
    action,
    // Firestore rejects `undefined`, and a log row must never fail on an optional detail.
    details: Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined)),
    recordId: target.recordId,
    recordRef: target.recordRef,
    sessionId,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
  });
}
