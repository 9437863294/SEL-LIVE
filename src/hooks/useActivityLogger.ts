'use client';

import { useCallback } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';

/** Identifies the record an action touched, so the log can be filtered by it. */
export interface ActivityTarget {
  /** Firestore document ID of the affected record. */
  recordId?: string;
  /** Human-readable reference — a vehicle number, PO number, requisition ID. */
  recordRef?: string;
}

/**
 * useActivityLogger — one-line audit logging from any client component.
 *
 * Usage:
 *   const { log } = useActivityLogger(ACTIVITY_MODULES.VEHICLE_MANAGEMENT);
 *   await log('Add Vehicle', { vehicleType: 'Truck' }, { recordId: id, recordRef: 'MH-01-AB-1234' });
 *
 * The hook automatically fills in userId, userName, userEmail, sessionId,
 * userAgent, and ipAddress (from the active session in localStorage/Firestore).
 *
 * Prefer a constant from @/lib/activity-modules for `module` over a bare string —
 * a typo silently files the action under a module of its own.
 */
export function useActivityLogger(module: string) {
  const { user } = useAuth();

  const log = useCallback(
    async (
      action: string,
      details: Record<string, any> = {},
      target: ActivityTarget = {},
    ): Promise<void> => {
      if (!user?.id) return; // Don't log if no authenticated user

      const sessionId =
        typeof window !== 'undefined'
          ? (localStorage.getItem('sessionId') ?? undefined)
          : undefined;

      const userAgent =
        typeof navigator !== 'undefined' ? navigator.userAgent : undefined;

      await logUserActivity({
        userId:    user.id,
        userName:  user.name  ?? undefined,
        userEmail: user.email ?? undefined,
        module,
        action,
        details,
        recordId: target.recordId,
        recordRef: target.recordRef,
        sessionId,
        userAgent,
        // ipAddress is not available client-side without a fetch;
        // it will be filled in from the session document on the audit viewer side.
      });
    },
    [user, module]
  );

  return { log };
}
