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
  EmploymentState,
  GreytHRSyncRun,
  GreytHRSyncSettings,
  LinkableEmployee,
  SyncedEmployee,
} from './greythr';
import type { BulkLinkPlan, LinkAuditEntry, LinkReport } from './greythr-linking';

export interface SyncReport {
  ok: boolean;
  /** Whether GREYTHR_USERNAME / GREYTHR_PASSWORD are set on the server. */
  configured: boolean;
  settings: GreytHRSyncSettings;
  runs: GreytHRSyncRun[];
  nextRun: { due: boolean; reason: string };
  /** Whether the stored roster needs one full rebuild before incremental sync is trustworthy. */
  mirrorRefresh: { force: boolean; reason: string | null };
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
  /** Number of current employees, including those who already have a login. */
  totalEmployees: number;
  /** Current employees excluded because they already have a platform login. */
  excluded: Record<string, number>;
  /** Live CURRENT roster when greytHR was reachable, otherwise the last synced mirror. */
  activeRosterSource: 'greythr-current' | 'mirror';
  /**
   * How many offerable employees came straight from greytHR's live roster rather than the Firestore
   * mirror — already included in `employees` above, not excluded from it. Purely informational: the
   * local mirror will not have these people until a sync runs, so screens that read the mirror
   * directly lag this list until then, even though a login can be created right now.
   */
  employeesFromLiveRosterOnly: number;
  /** When the local mirror was last refreshed from greytHR. */
  mirrorSyncedAt: string | null;
  /**
   * When a full run last completed, or `null` if none ever has.
   *
   * Distinct from `mirrorSyncedAt`: a mirror kept up to date by incremental runs alone is fresh and
   * still missing most of the workforce, because incremental runs only return records that changed.
   */
  baselineCompletedAt: string | null;
  /** Derivation version used for the current full mirror. */
  mirrorVersion: number;
  /** True when unchanged employees still need a full pass (for example after a status-rule fix). */
  mirrorRefreshRequired: boolean;
  mirrorRefreshReason: string | null;
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
/** Resolved from the mirror's synced org data, not fetched live — see the API route for why. */
export interface ReportingManagerInfo {
  employeeId: string;
  name: string | null;
  /** Set only if the manager already has a platform login. */
  userId: string | null;
}

export const fetchEmployeeDetail = (
  employeeId: string,
): Promise<{
  ok: boolean;
  employee: LinkableEmployeeRow;
  allCategories: Record<string, string>;
  linkedUserName: string | null;
  reportingManager: ReportingManagerInfo | null;
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

/* ------------------------------------------------------------------------------------------------
 * Current employees, live from greytHR
 * ---------------------------------------------------------------------------------------------- */

export interface LiveCurrentEmployeesResponse {
  ok: boolean;
  employees: SyncedEmployee[];
  totalCurrent: number;
  fetchedAt: string;
  /** `'snapshot'` when greytHR was unreachable and the stored roster was served instead. */
  source: 'greythr-live' | 'snapshot';
  stale?: boolean;
  staleReason?: string;
  /**
   * What happened to the stored snapshot on this fetch.
   *
   * `replaced: false` with a `refusedReason` means the fetch was served but not persisted — a guard
   * in the store declined to prune against data it could not vouch for. Surfaced rather than logged,
   * because a snapshot that has quietly stopped updating is the failure worth noticing.
   */
  snapshot?: {
    replaced: boolean;
    written: number;
    deleted: number;
    refusedReason: string | null;
    fetchedAt: string | null;
    count: number;
  };
}

/**
 * greytHR's `state=CURRENT` roster, fetched fresh on every call — no Firestore mirror involved.
 *
 * For the times the mirror itself is suspect: every field here is derived from this request alone,
 * so it cannot show a stale or placeholder-date-corrupted result.
 */
export const fetchCurrentEmployeesLive = (): Promise<LiveCurrentEmployeesResponse> =>
  authorizedFetch<LiveCurrentEmployeesResponse>('/api/greythr/employees/current');

/* ------------------------------------------------------------------------------------------------
 * The full roster — mirror, corrected against the live roster
 * ---------------------------------------------------------------------------------------------- */

export interface RosterEmployeeRow extends Partial<SyncedEmployee> {
  employeeId: string;
  employmentState: EmploymentState;
  employmentStateReason: string;
  employmentStateCorrected: boolean;
  awaitingSync: boolean;
  categories: Record<string, string>;
}

export interface EmployeeRosterResponse {
  ok: boolean;
  employees: RosterEmployeeRow[];
  /** Category name → the values actually present, for the filter dropdowns. */
  filterOptions: Record<string, string[]>;
  counts: {
    total: number;
    working: number;
    departed: number;
    awaitingSync: number;
    corrected: number;
    salaryRows: number;
  };
  /** False when greytHR was unreachable, so the states shown are mirror-only and unverified. */
  liveRoster: boolean;
  mirrorSyncedAt: string | null;
  baselineCompletedAt: string | null;
  mirrorRefresh: { force: boolean; reason: string | null };
  fetchedAt: string;
}

/**
 * Every employee — current and departed — with stored states corrected against greytHR.
 *
 * What Manage Employee reads. Distinct from `fetchCurrentEmployeesLive`, which deliberately omits
 * anyone who has left, and from reading the `employees` collection directly, which is how that
 * screen came to report a whole workforce as departed.
 */
export const fetchEmployeeRoster = (): Promise<EmployeeRosterResponse> =>
  authorizedFetch<EmployeeRosterResponse>('/api/greythr/employees/roster');
