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
import type {
  EmployeeDocumentTree,
  GreytHRSyncRun,
  GreytHRSyncSettings,
  LinkableEmployee,
} from './greythr';
import type { BulkLinkPlan, LinkAuditEntry, LinkReport } from './greythr-linking';

export interface SyncReport {
  ok: boolean;
  /** Whether GREYTHR_USERNAME / GREYTHR_PASSWORD are set on the server. */
  configured: boolean;
  settings: GreytHRSyncSettings;
  runs: GreytHRSyncRun[];
  nextRun: { due: boolean; reason: string };
  /**
   * What the mirror holds right now, as opposed to what the last run did.
   *
   * Separate because they answer different questions and only one of them was being asked. A healthy
   * incremental run over three changed records says nothing about whether the other 1,300 employees
   * are present.
   */
  mirror: {
    employees: number;
    working: number;
    salaryRows: number;
    byState: Record<string, number>;
  };
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
  /**
   * Unlinked employees greytHR says have left.
   *
   * Offered behind an explicit toggle so a wrong employment state cannot leave an administrator with
   * no way to create a legitimate account.
   */
  otherEmployees: LinkableEmployeeRow[];
  totalEmployees: number;
  /** Reason → count, for "showing 412 of 1,306". */
  excluded: Record<string, number>;
  /** When the local mirror was last refreshed from greytHR. */
  mirrorSyncedAt: string | null;
  /**
   * When a full run last completed, or `null` if none ever has.
   *
   * Distinct from `mirrorSyncedAt`: a mirror kept up to date by incremental runs alone is fresh and
   * still missing most of the workforce, because incremental runs only return records that changed.
   */
  baselineCompletedAt: string | null;
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

/* ------------------------------------------------------------------------------------------------
 * Documents
 * ---------------------------------------------------------------------------------------------- */

export interface DocumentTreeResponse extends EmployeeDocumentTree {
  ok: boolean;
  canDownload: boolean;
  categoriesAreUnnamed: boolean;
}

/** One employee's document tree, fetched live from greytHR through the proxy. */
export const fetchEmployeeDocumentTree = (employeeId: string): Promise<DocumentTreeResponse> =>
  authorizedFetch<DocumentTreeResponse>(
    `/api/greythr/documents?employeeId=${encodeURIComponent(employeeId)}`,
  );

/**
 * Open a document file.
 *
 * Fetched as a blob rather than linked to directly, because the route needs an `Authorization`
 * header and a plain `<a href>` cannot carry one. The object URL is revoked on the next tick — long
 * enough for the browser to have opened it, short enough not to pin the file in memory.
 */
export async function openEmployeeDocument(
  employeeId: string,
  file: { documentId: string; fileId: string; name: string },
): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Your session has expired. Please sign in again.');
  const token = await user.getIdToken();

  const query = new URLSearchParams({
    employeeId,
    documentId: file.documentId,
    fileId: file.fileId,
    name: file.name,
  });

  const response = await fetch(`/api/greythr/documents?${query.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    // The error body is JSON even though a success body is binary.
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `The document could not be opened (${response.status}).`);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  window.open(objectUrl, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

/* ------------------------------------------------------------------------------------------------
 * Linking users to employees
 * ---------------------------------------------------------------------------------------------- */

export interface LinkReportResponse extends LinkReport {
  ok: boolean;
  mirrorSyncedAt: string | null;
  plan: BulkLinkPlan;
  recent: LinkAuditEntry[];
}

export const fetchLinkReport = (): Promise<LinkReportResponse> =>
  authorizedFetch<LinkReportResponse>('/api/greythr/link');

export const linkUserToEmployee = (
  userId: string,
  employeeId: string,
): Promise<{ ok: boolean; audit: LinkAuditEntry }> =>
  authorizedFetch('/api/greythr/link', {
    method: 'POST',
    body: JSON.stringify({ action: 'link', userId, employeeId }),
  });

export const unlinkUserFromEmployee = (
  userId: string,
  reason: string,
): Promise<{ ok: boolean; audit: LinkAuditEntry }> =>
  authorizedFetch('/api/greythr/link', {
    method: 'POST',
    body: JSON.stringify({ action: 'unlink', userId, reason }),
  });

/** Apply every confident match. Preview with `fetchLinkReport().plan` first. */
export const bulkLinkUsers = (): Promise<{
  ok: boolean;
  batchId: string;
  linked: number;
  failed: Array<{ userId: string; userName: string; error: string }>;
  plan: BulkLinkPlan;
}> =>
  authorizedFetch('/api/greythr/link', {
    method: 'POST',
    body: JSON.stringify({ action: 'bulk-link' }),
  });

export const testConnection = (): Promise<{ ok: boolean; message: string; totalEmployees?: number }> =>
  authorizedFetch('/api/greythr/sync', {
    method: 'POST',
    body: JSON.stringify({ action: 'test-connection' }),
  });
