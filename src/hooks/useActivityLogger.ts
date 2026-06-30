'use client';

import { useCallback } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';

/**
 * useActivityLogger — one-line audit logging from any client component.
 *
 * Usage:
 *   const { log } = useActivityLogger('Vehicle Management');
 *   await log('Add Vehicle', { vehicleNumber: 'MH-01-AB-1234', vehicleType: 'Truck' });
 *
 * The hook automatically fills in userId, userName, userEmail, sessionId,
 * userAgent, and ipAddress (from the active session in localStorage/Firestore).
 */
export function useActivityLogger(module: string) {
  const { user } = useAuth();

  const log = useCallback(
    async (action: string, details: Record<string, any> = {}): Promise<void> => {
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
