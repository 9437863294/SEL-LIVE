'use client';

/**
 * Browser-side calls into `/api/greythr/sync`.
 *
 * A thin wrapper for one reason: the route authorises with a Firebase ID token in an `Authorization`
 * header, and every screen that talks to it needs the same three lines to get one. Following the
 * pattern `inventory-client.ts` established rather than inventing a second one.
 *
 * None of the reconciliation happens here. The browser asks the server to run a sync; the server
 * decides what that means. A client that could write the employee mirror directly would be a second
 * implementation of the rules, and the two would drift.
 */

import { auth } from './firebase';
import type { GreytHRSyncRun, GreytHRSyncSettings, LinkableEmployee } from './greythr';

export interface SyncReport {
  ok: boolean;
  /** Whether GREYTHR_USERNAME / GREYTHR_PASSWORD are set on the server. */
  configured: boolean;
  settings: GreytHRSyncSettings;
  runs: GreytHRSyncRun[];
  nextRun: { due: boolean; reason: string };
}

async function authorizedFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('Your session has expired. Please sign in again.');
  const token = await user.getIdToken();

  const response = await fetch(input, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : 'The greytHR request failed.');
  }
  return data as T;
}

/** Current settings, recent runs, and whether a scheduled run is due. */
export const fetchSyncReport = (): Promise<SyncReport> =>
  authorizedFetch<SyncReport>('/api/greythr/sync?report=1');

export const saveSyncSettings = (
  settings: Partial<GreytHRSyncSettings>,
): Promise<{ ok: boolean; settings: GreytHRSyncSettings }> =>
  authorizedFetch('/api/greythr/sync', {
    method: 'POST',
    body: JSON.stringify({ action: 'save-settings', settings }),
  });

/**
 * Run the sync now.
 *
 * `preview: true` computes the whole run and writes nothing — which is how an administrator sees
 * what the first run would do to 1,300 employee records before it does it.
 */
export const runSyncNow = (
  options: { fullResync?: boolean; preview?: boolean } = {},
): Promise<{ ok: boolean; run: GreytHRSyncRun }> =>
  authorizedFetch('/api/greythr/sync', {
    method: 'POST',
    body: JSON.stringify({
      action: options.preview ? 'preview' : 'run',
      fullResync: options.fullResync === true,
    }),
  });

/* ------------------------------------------------------------------------------------------------
 * The employee picker
 * ---------------------------------------------------------------------------------------------- */

export interface LinkableEmployeeRow extends LinkableEmployee {
  linkedUserName?: string | null;
}

export interface LinkableEmployeeList {
  ok: boolean;
  employees: LinkableEmployeeRow[];
  totalEmployees: number;
  /** Reason → count, for "showing 412 of 1,306". */
  excluded: Record<string, number>;
  /** When the local mirror was last refreshed from greytHR. */
  mirrorSyncedAt: string | null;
}

/** Active employees who do not already have a platform login. */
export const fetchLinkableEmployees = (): Promise<LinkableEmployeeList> =>
  authorizedFetch<LinkableEmployeeList>('/api/greythr/employees');

/**
 * One employee, refreshed live from greytHR.
 *
 * Called when an administrator picks somebody, so the prefilled designation and project are current
 * rather than as at the last nightly run — which is exactly the case that matters for a new joiner.
 */
export const fetchEmployeeDetail = (
  employeeId: string,
): Promise<{
  ok: boolean;
  employee: LinkableEmployeeRow;
  allCategories: Record<string, string>;
  linkedUserName: string | null;
}> => authorizedFetch(`/api/greythr/employees?id=${encodeURIComponent(employeeId)}`);

export const testConnection = (): Promise<{ ok: boolean; message: string; totalEmployees?: number }> =>
  authorizedFetch('/api/greythr/sync', {
    method: 'POST',
    body: JSON.stringify({ action: 'test-connection' }),
  });
