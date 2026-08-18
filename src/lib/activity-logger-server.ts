import 'server-only';

import { FieldValue } from 'firebase-admin/firestore';

import { getFirebaseAdminFirestore } from './firebase-admin';
import { canonicalModuleName } from './activity-modules';
import type { ActivityLogData } from './activity-logger';

/**
 * Server-side twin of @/lib/activity-logger.
 *
 * The client logger imports the browser Firebase SDK, so nothing running on the
 * server could use it — which meant every admin-SDK service write and every API
 * route mutated data without leaving an audit trail. Those are exactly the writes
 * a reviewer most wants to see, because they include the scheduled jobs that move
 * money without anyone clicking a button.
 *
 * Writes to the same `userLogs` collection as the client logger and with the same
 * field names, so the audit viewer needs no changes to show both.
 */

/** Same payload as the client logger, minus the browser-only session fields. */
export type ServerActivityLogData = Omit<ActivityLogData, 'sessionId' | 'userAgent'> & {
  /** Set when the action originated from a request carrying a session. */
  sessionId?: string;
  /** Set from the request's user-agent header when available. */
  userAgent?: string;
  /**
   * What triggered the write, so a reviewer can tell a user action from an
   * automated one. Defaults to 'server'.
   */
  source?: 'server' | 'api' | 'cron' | 'webhook';
};

export async function logServerActivity(logData: ServerActivityLogData): Promise<void> {
  try {
    const db = getFirebaseAdminFirestore();
    await db.collection('userLogs').add({
      userId: logData.userId,
      userName: logData.userName ?? null,
      userEmail: logData.userEmail ?? null,
      module: canonicalModuleName(logData.module),
      action: logData.action,
      details: logData.details ?? {},
      sessionId: logData.sessionId ?? null,
      ipAddress: logData.ipAddress ?? null,
      userAgent: logData.userAgent ?? null,
      source: logData.source ?? 'server',
      timestamp: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    // Logging must never crash the calling feature — matches the client logger.
    console.error('[activity-logger-server] Failed to write log:', err);
  }
}

/**
 * The actor recorded for writes with no human behind them. Kept identical to
 * SYSTEM_ACTOR in @/lib/audit-fields-server so a cron-written record and its log
 * row name the same author.
 */
export const SYSTEM_LOG_ACTOR = {
  userId: 'system',
  userName: 'System',
} as const;

/**
 * Pull the caller's IP and user-agent off an incoming request, so an API-route log
 * row carries the same provenance a client-logged row does.
 *
 * Reads x-forwarded-for first because the app runs behind Vercel's proxy, where
 * the socket address is the proxy's, not the caller's.
 */
export function requestProvenance(request: Request): {
  ipAddress: string | null;
  userAgent: string | null;
} {
  const forwarded = request.headers.get('x-forwarded-for');
  return {
    ipAddress: forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || null,
    userAgent: request.headers.get('user-agent') || null,
  };
}
