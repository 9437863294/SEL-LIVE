'use client';

/**
 * Browser-side calls into `/api/reporting-copy/*`, for Settings › Reporting Database. The routes
 * authorise with a Firebase ID token; `reportingCopy/*` is server-only in the Firestore rules, so
 * there is no direct read to fall back on.
 */

import { auth } from './firebase';
import type { ReportingCopyConfig, ReportingCopyDue, ReportingCopyProgress, ReportingCopyRun, ReportingCopySettingsInput } from './reporting-copy';

export interface ReportingCopyOverview {
  /** Whether NEWDATABASE_MONGODB_URI is set on the server. */
  configured: boolean;
  config: ReportingCopyConfig;
  state: {
    lastRun: ReportingCopyRun | null;
    progress: ReportingCopyProgress | null;
    lastScheduledSlot: string | null;
    handledRequestAt: string | null;
    nextDueAt: string | null;
    updatedAt: string | null;
    running: boolean;
    working: boolean;
  };
  due: ReportingCopyDue;
  nextDueAt: string | null;
  checkedAt: string;
}

async function authorizedFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('Your session has expired. Please sign in again.');
  const token = await user.getIdToken();
  const response = await fetch(input, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'The reporting database request failed.');
  return data as T;
}

export const fetchReportingCopy = () => authorizedFetch<ReportingCopyOverview>('/api/reporting-copy/settings');

export const saveReportingCopySettings = (settings: ReportingCopySettingsInput) =>
  authorizedFetch<ReportingCopyOverview>('/api/reporting-copy/settings', { method: 'PUT', body: JSON.stringify(settings) });

export const refreshReportingCopyNow = () =>
  authorizedFetch<{ queued: boolean; reason: string; slice: { ok: boolean; error?: string } | null; overview: ReportingCopyOverview }>(
    '/api/reporting-copy/run',
    { method: 'POST' },
  );
