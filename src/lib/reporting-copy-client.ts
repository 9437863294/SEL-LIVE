'use client';

/**
 * Browser-side calls into `/api/reporting-copy/*`, for Settings › Reporting Database. The routes
 * authorise with a Firebase ID token; `reportingCopy/*` is server-only in the Firestore rules, so
 * there is no direct read to fall back on.
 */

import { auth } from './firebase';
import type {
  ReportingCopyConfig, ReportingCopyDue, ReportingCopyHistoryEntry, ReportingCopyProgress, ReportingCopyRun, ReportingCopySettingsInput,
} from './reporting-copy';

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
    cancelRequestedAt: string | null;
    cancelRequestedBy: string | null;
    running: boolean;
    working: boolean;
    stopping: boolean;
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

export interface ReportingCopySliceResult {
  ok: boolean;
  action: 'idle' | 'busy' | 'started' | 'continued' | 'finished' | 'stopped' | 'not-configured';
  reason: string;
  error?: string;
}

export const refreshReportingCopyNow = () =>
  authorizedFetch<{ queued: boolean; reason: string; busy: boolean; slice: ReportingCopySliceResult | null; overview: ReportingCopyOverview }>(
    '/api/reporting-copy/run',
    { method: 'POST', body: JSON.stringify({ action: 'start' }) },
  );

/** One more slice of the run in progress; `busy` when another slice (the scheduler, another tab) holds it. */
export const continueReportingCopy = () =>
  authorizedFetch<{ busy: boolean; slice: ReportingCopySliceResult; overview: ReportingCopyOverview }>(
    '/api/reporting-copy/run',
    { method: 'POST', body: JSON.stringify({ action: 'continue' }) },
  );

export const stopReportingCopy = () =>
  authorizedFetch<{ outcome: 'nothing' | 'signalled' | 'stopped'; reason: string; overview: ReportingCopyOverview }>(
    '/api/reporting-copy/stop',
    { method: 'POST' },
  );

export const fetchReportingCopyHistory = (limit = 50) =>
  authorizedFetch<{ runs: ReportingCopyHistoryEntry[] }>(`/api/reporting-copy/history?limit=${limit}`);
