'use client';

/**
 * Browser side of the Master Drawing List API.
 *
 * Every screen talks to `/api/master-drawing-list/*` with the signed-in user's ID token, never to
 * Firestore directly (both collections are server-only). `MdlProvider`, mounted by the module shell,
 * loads the lookups once: the drawing lists this user may see, their permissions as the server
 * resolved them, and today's date in India.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { auth } from '@/lib/firebase';
import type { MdlResource } from '@/lib/master-drawing-list/access';
import { DEFAULT_SETTINGS, type MdlSettings } from '@/lib/master-drawing-list/settings';
import type { MdlLookups, RegisterData } from '@/lib/master-drawing-list/server/queries';

export type { MdlLookups, RegisterData };
export type { MdlProjectView } from '@/lib/master-drawing-list/server/store';

export class MdlApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'MdlApiError';
    this.status = status;
  }
}

/** JSON request to the module API. Throws `MdlApiError` with the server's message on failure. */
export async function mdlFetch<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new MdlApiError('You are signed out. Sign in again.', 401);
  const headers: Record<string, string> = { Authorization: `Bearer ${await user.getIdToken()}` };
  let body: string | undefined;
  if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.body);
  }
  const response = await fetch(`/api/master-drawing-list/${path.replace(/^\//, '')}`, {
    method: init.method ?? (body ? 'POST' : 'GET'),
    headers,
    body,
    signal: init.signal,
    cache: 'no-store',
  });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) throw new MdlApiError((data as { error?: string } | null)?.error || `Request failed (${response.status}).`, response.status);
  return data as T;
}

/** Multipart request (the Drawing Details save, with its round files). */
export async function mdlSendForm<T>(path: string, method: string, form: FormData): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new MdlApiError('You are signed out. Sign in again.', 401);
  const response = await fetch(`/api/master-drawing-list/${path.replace(/^\//, '')}`, {
    method,
    headers: { Authorization: `Bearer ${await user.getIdToken()}` },
    body: form,
    cache: 'no-store',
  });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) throw new MdlApiError((data as { error?: string } | null)?.error || `Request failed (${response.status}).`, response.status);
  return data as T;
}

/** Opens a round's drawing file in a new tab, fetched through the API (the files are private). */
export async function openDrawingFile(itemId: string, filePath: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new MdlApiError('You are signed out. Sign in again.', 401);
  // Opened first, while the click still counts as a user gesture, so pop-up blockers allow it.
  const tab = window.open('', '_blank');
  const response = await fetch(`/api/master-drawing-list/items/${encodeURIComponent(itemId)}/file?path=${encodeURIComponent(filePath)}`, {
    headers: { Authorization: `Bearer ${await user.getIdToken()}` },
  });
  if (!response.ok) {
    tab?.close();
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new MdlApiError(payload.error || 'The file could not be opened.', response.status);
  }
  const url = URL.createObjectURL(await response.blob());
  if (tab) tab.location.href = url;
  else window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

/* ── a drawing list's register ───────────────────────────────────────────── */

/**
 * Every view (Reports, Pending Tasks, Register, Calendar, Gantt) reads the same register. It is
 * kept for a minute per drawing list, so moving between views does not reload it; a save replaces
 * the item in place and `reload` asks the server again.
 */
const registerCache = new Map<string, { data: RegisterData; at: number }>();
const REGISTER_FRESH_MS = 60_000;

export function useProjectRegister(code: string | null) {
  // What the server last sent for this drawing list (state), else what another view cached.
  const [state, setState] = useState<{ code: string | null; data: RegisterData | null; error: string | null }>({ code: null, data: null, error: null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!code) return;
    const hit = registerCache.get(code);
    // Fresh enough: render reads it from the cache, no request.
    if (hit && Date.now() - hit.at < REGISTER_FRESH_MS && tick === 0) return;
    const controller = new AbortController();
    mdlFetch<RegisterData>(`items?project=${encodeURIComponent(code)}`, { signal: controller.signal })
      .then((data) => {
        registerCache.set(code, { data, at: Date.now() });
        setState({ code, data, error: null });
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setState({ code, data: null, error: caught instanceof Error ? caught.message : 'Could not load the register.' });
      });
    return () => controller.abort();
  }, [code, tick]);

  const data = (state.code === code ? state.data : null) ?? (code ? (registerCache.get(code)?.data ?? null) : null);
  const replaceItem = useCallback(
    (item: RegisterData['items'][number] | { id: string; removed: true }) => {
      if (!code) return;
      setState((current) => {
        const base = (current.code === code ? current.data : null) ?? registerCache.get(code)?.data;
        if (!base) return current;
        const items = 'removed' in item ? base.items.filter((entry) => entry.id !== item.id) : base.items.some((entry) => entry.id === item.id) ? base.items.map((entry) => (entry.id === item.id ? item : entry)) : [...base.items, item];
        const next = { ...base, items };
        registerCache.set(code, { data: next, at: Date.now() });
        return { code, data: next, error: null };
      });
    },
    [code],
  );
  return {
    data,
    loading: Boolean(code) && !data && !(state.code === code && state.error),
    error: state.code === code ? state.error : null,
    reload: () => {
      if (code) registerCache.delete(code);
      setTick((value) => value + 1);
    },
    replaceItem,
  };
}

/* ── lookups ─────────────────────────────────────────────────────────────── */

interface MdlState {
  lookups: MdlLookups | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  /** The server-resolved check: held unscoped, or on at least one drawing list the user can see. */
  can: (resource: MdlResource, action: string) => boolean;
}

const MdlContext = createContext<MdlState | null>(null);

export function MdlProvider({ children }: { children: React.ReactNode }) {
  const [lookups, setLookups] = useState<MdlLookups | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setLookups(await mdlFetch<MdlLookups>('lookups'));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load the Master Drawing List.');
    } finally {
      setLoading(false);
    }
  }, []);

  // The ID token is only there once Firebase Auth has restored the session.
  useEffect(() => auth.onAuthStateChanged((user) => (user ? void reload() : undefined)), [reload]);

  const value = useMemo<MdlState>(
    () => ({ lookups, loading, error, reload, can: (resource, action) => Boolean(lookups?.permissions[resource]?.includes(action)) }),
    [lookups, loading, error, reload],
  );
  return <MdlContext.Provider value={value}>{children}</MdlContext.Provider>;
}

export function useMdl(): MdlState {
  const value = useContext(MdlContext);
  if (!value) throw new Error('useMdl must be used inside MdlProvider');
  return value;
}

/** Schedules & Scopes, Field Control and Date Control as configured (the defaults until loaded). */
export function useMdlSettings(): MdlSettings {
  return useMdl().lookups?.settings ?? DEFAULT_SETTINGS;
}

/** Lookups once loaded; the screens render inside the shell, which waits for them. */
export function useMdlLookups(): MdlLookups {
  const { lookups } = useMdl();
  if (!lookups) throw new Error('Master Drawing List lookups are not loaded yet.');
  return lookups;
}

/* ── queries ─────────────────────────────────────────────────────────────── */

export interface QueryState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * GETs a module endpoint and re-runs when `path` changes; a newer request supersedes an older one.
 * A null path is a query not wanted yet (no project chosen): never loading.
 */
export function useMdlQuery<T>(path: string | null): QueryState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const sequence = useRef(0);
  const key = path ? `${tick}|${path}` : null;

  useEffect(() => {
    if (!path || !key) return;
    const id = ++sequence.current;
    const controller = new AbortController();
    mdlFetch<T>(path, { signal: controller.signal })
      .then((result) => {
        if (id !== sequence.current) return;
        setData(result);
        setError(null);
        setSettledKey(key);
      })
      .catch((caught: unknown) => {
        if (id !== sequence.current || (caught instanceof DOMException && caught.name === 'AbortError')) return;
        setError(caught instanceof Error ? caught.message : 'Could not load.');
        setSettledKey(key);
      });
    return () => controller.abort();
  }, [path, key]);

  return { data, loading: key !== null && key !== settledKey, error, reload: () => setTick((value) => value + 1) };
}

/** A value that settles `delay` ms after the last change — for search boxes. */
export function useDebounced<T>(value: T, delay = 250): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

/* ── URL state ───────────────────────────────────────────────────────────── */

const LAST_PROJECT_KEY = 'mdl:lastProject';

function rememberedProject(): string | null {
  try {
    return window.localStorage.getItem(LAST_PROJECT_KEY);
  } catch {
    return null;
  }
}

/**
 * The register's filters live in the URL (`?project=&schedule=&scope=&status=&q=`), so a filtered
 * view can be shared, survives a reload, and Back returns to it from an item. The project falls back
 * to the last one opened on this device, then the first the user may see.
 */
export function useRegisterParams() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { lookups } = useMdl();

  const codes = useMemo(() => new Set((lookups?.projects ?? []).map((project) => project.code)), [lookups]);
  const fromUrl = params.get('project');
  const fallback = (() => {
    if (typeof window === 'undefined') return null;
    const remembered = rememberedProject();
    if (remembered && codes.has(remembered)) return remembered;
    return lookups?.projects[0]?.code ?? null;
  })();
  const project = fromUrl && codes.has(fromUrl) ? fromUrl : fallback;

  useEffect(() => {
    if (!project) return;
    try {
      window.localStorage.setItem(LAST_PROJECT_KEY, project);
    } catch {
      // Storage may be blocked (private window); the URL still carries the project.
    }
  }, [project]);

  const set = useCallback(
    (changes: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [name, value] of Object.entries(changes)) {
        if (value) next.set(name, value);
        else next.delete(name);
      }
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  return {
    project,
    schedule: params.get('schedule'),
    scope: params.get('scope'),
    status: params.get('status'),
    q: params.get('q') ?? '',
    set,
    /** The current query string, for links that should come back to this view. */
    search: params.toString(),
  };
}
