'use client';

/**
 * Browser side of the Bill Tracking API.
 *
 * Every screen talks to `/api/bill-tracking/*` with the signed-in user's ID token — never to
 * Firestore directly. `BillTrackingProvider` (mounted by the module shell) loads the lookups once:
 * configuration, the projects this user may see, clients, users and the user's Bill Tracking
 * permissions as the server resolved them, so buttons are shown exactly when the API would accept
 * the action.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { auth } from '@/lib/firebase';
import { financialYearOf } from '@/lib/bill-tracking/calculations';
import type { BillTrackingConfig } from '@/lib/bill-tracking/types';
import { stepLabel, type WorkflowActor } from '@/lib/bill-tracking/workflow';
import type { RegistrationSetup } from '@/lib/bill-tracking/gst';

export class BtApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'BtApiError';
  }
}

async function authHeader(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) throw new BtApiError('You are signed out. Sign in again.', 401);
  return { Authorization: `Bearer ${await user.getIdToken()}` };
}

/** JSON request to the module API. Throws `BtApiError` with the server's message on failure. */
export async function btFetch<T>(path: string, init: { method?: string; body?: unknown; form?: FormData; signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = await authHeader();
  let body: BodyInit | undefined;
  if (init.form) body = init.form;
  else if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.body);
  }
  const response = await fetch(`/api/bill-tracking/${path.replace(/^\//, '')}`, { method: init.method ?? (body ? 'POST' : 'GET'), headers, body, signal: init.signal, cache: 'no-store' });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const payload = (data ?? {}) as { error?: string; details?: unknown };
    throw new BtApiError(payload.error || `Request failed (${response.status}).`, response.status, payload.details);
  }
  return data as T;
}

/** Downloads a protected file (an attachment) through the API and opens or saves it. */
export async function btDownload(path: string, fileName: string, inline = false): Promise<void> {
  const response = await fetch(`/api/bill-tracking/${path}${inline ? '?inline=1' : ''}`, { headers: await authHeader() });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new BtApiError(payload.error || 'Download failed.', response.status);
  }
  const url = URL.createObjectURL(await response.blob());
  if (inline) window.open(url, '_blank', 'noopener');
  else {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/* ── lookups ─────────────────────────────────────────────────────────────── */

export interface ProjectOption {
  id: string;
  name: string;
  code?: string;
  status?: string;
  clientId?: string;
  clientName?: string;
  location?: string;
  dgmOffice?: string;
  creditDays?: number;
}

export interface Lookups {
  config: BillTrackingConfig;
  projects: ProjectOption[];
  clients: { id: string; name: string; gstin?: string; paymentTermsDays?: number; status?: string }[];
  users: { id: string; name: string; email?: string }[];
  /** SEL's active GST registrations and the attribution chain (Expenses → GST registrations). */
  gstSetup: RegistrationSetup;
  dgmOffices: string[];
  permissions: Record<string, string[]>;
  allProjects: boolean;
  today: string;
  currentFy: string;
  user: { id: string; name: string };
  /** Named on a Settings → Workflow stage: the register offers "Waiting for me". */
  workflowAssigned?: boolean;
  /** In only because of that naming (no module permission) — they see their workflow bills only. */
  workflowOnly?: boolean;
}

interface LookupState {
  lookups: Lookups | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  /** Server-resolved permission check (project scope already applied to the lists). */
  can: (resource: string, action: string) => boolean;
}

const LookupContext = createContext<LookupState | null>(null);

export function BillTrackingProvider({ children }: { children: React.ReactNode }) {
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setLookups(await btFetch<Lookups>('lookups'));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load Bill Tracking.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // The ID token is only available once Firebase Auth has restored the session.
    return auth.onAuthStateChanged((user) => {
      if (!user) return;
      // The page's own figures start loading alongside the lookups rather than after them.
      prefetchLandingQuery();
      void reload();
    });
  }, [reload]);

  const value = useMemo<LookupState>(
    () => ({
      lookups,
      loading,
      error,
      reload,
      can: (resource, action) => Boolean(lookups?.permissions[resource]?.includes(action)),
    }),
    [lookups, loading, error, reload],
  );
  return <LookupContext.Provider value={value}>{children}</LookupContext.Provider>;
}

export function useBt(): LookupState {
  const value = useContext(LookupContext);
  if (!value) throw new Error('useBt must be used inside BillTrackingProvider');
  return value;
}

/** The signed-in user for the shared workflow rules (`workflow.ts`): who they are and what their roles allow. */
export function useWorkflowActor(): WorkflowActor {
  const { lookups, can } = useBt();
  return { userId: lookups?.user.id ?? '', can: (resource, action) => can(resource, action) };
}

/** The workflow as configured once loaded, else undefined (read as the default) — safe outside the shell. */
export function useWorkflowSettings(): Lookups['config']['settings'] | undefined {
  return useContext(LookupContext)?.lookups?.config.settings;
}

/** A workflow step's name as configured in Settings → Workflow ("Submitted", or a step added there). */
export function useStepLabel(): (status: string | undefined | null) => string {
  const settings = useWorkflowSettings();
  return (status) => stepLabel(settings, status);
}

/** Lookups once loaded; screens render inside the shell, which waits for them. */
export function useLookups(): Lookups {
  const { lookups } = useBt();
  if (!lookups) throw new Error('Bill Tracking lookups are not loaded yet.');
  return lookups;
}

/* ── queries ─────────────────────────────────────────────────────────────── */

/**
 * Requests started before the screen that wants them has mounted, by path. A screen waits for the
 * lookups before it renders, so without this its own request would only start once they arrive —
 * two round trips one after the other. Used only while fresh, and dropped once a screen has shown
 * its answer (kept until then: in development React runs an effect twice on mount).
 */
const prefetched = new Map<string, { promise: Promise<unknown>; at: number }>();
const PREFETCH_FRESH_MS = 30_000;

function takePrefetched<T>(path: string): Promise<T> | null {
  const entry = prefetched.get(path);
  if (!entry) return null;
  if (Date.now() - entry.at < PREFETCH_FRESH_MS) return entry.promise as Promise<T>;
  prefetched.delete(path);
  return null;
}

/** The financial year of today in India (`2026-27`), as the server's lookups give it. */
const currentFinancialYear = (): string => financialYearOf(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()));

/**
 * On the dashboard — where the module opens — its figures are asked for at once, with the same query
 * the screen will build (`useUrlFilters().apiQuery()`: the URL's filters plus the FY). Should the
 * two ever differ, the screen just fetches its own.
 */
function prefetchLandingQuery() {
  if (typeof window === 'undefined' || window.location.pathname !== '/bill-tracking/dashboard') return;
  const query = new URLSearchParams(window.location.search);
  if (!query.get('fy')) query.set('fy', currentFinancialYear());
  const path = `dashboard?${query.toString()}`;
  const promise = btFetch(path);
  promise.catch(() => undefined);
  prefetched.set(path, { promise, at: Date.now() });
}

export interface QueryState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * GETs a module endpoint and re-runs when `path` changes. A newer request supersedes an older one,
 * so typing into a filter never shows results for the previous keystroke.
 */
export function useBtQuery<T>(path: string | null): QueryState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // The request whose answer is on screen. Loading = the wanted request is not that one, so no
  // state is set synchronously when a request starts.
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const sequence = useRef(0);
  const key = path ? `${tick}|${path}` : null;

  useEffect(() => {
    if (!path || !key) return;
    const id = ++sequence.current;
    const controller = new AbortController();
    // A first load may already be on its way (`prefetchLandingQuery`); a reload always asks afresh.
    const early = key.startsWith('0|') ? takePrefetched<T>(path) : null;
    (early ?? btFetch<T>(path, { signal: controller.signal }))
      .then((result) => {
        if (id !== sequence.current) return;
        if (early) prefetched.delete(path);
        setData(result);
        setError(null);
        setSettledKey(key);
      })
      .catch((caught: unknown) => {
        if (id !== sequence.current || (caught instanceof DOMException && caught.name === 'AbortError')) return;
        if (early) prefetched.delete(path);
        setError(caught instanceof Error ? caught.message : 'Could not load.');
        setSettledKey(key);
      });
    return () => controller.abort();
  }, [path, key]);

  // A null path is a query that is not wanted yet (a report waiting for its project): never loading.
  return { data, loading: key !== null && key !== settledKey, error, reload: () => setTick((value) => value + 1) };
}

/** `useState` that settles `delay` ms after the last change — for search boxes. */
export function useDebounced<T>(value: T, delay = 350): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}
