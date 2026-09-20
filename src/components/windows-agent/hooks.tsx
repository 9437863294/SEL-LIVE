'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import {
  DEFAULT_UI_SETTINGS,
  fetchDepartments,
  fetchDirectory,
  fetchSettings,
  type Actor,
  type DirectoryEntry,
  type WindowsAgentUiSettings,
} from '@/lib/windows-agent-service';
import {
  canOpenWindowsAgent,
  resolveActivityScope,
  type ActivityScope,
  type WindowsAgentViewer,
} from '@/lib/windows-agent-permissions';

/**
 * The module's shared context: who is looking, what they may see, and the master data every
 * screen joins against.
 *
 * Modelled on `useOfficeHub`, and for the same reason — the directory, the department list and
 * the installation settings are needed by almost every page in the module, and fetching them per
 * page means the same few hundred documents read six times while somebody clicks around.
 *
 * ── The viewer is assembled once and passed everywhere ─────────────────────────────────────────
 *
 * `WindowsAgentViewer` is plain data by design (see `windows-agent-permissions.ts`), so the same
 * object the pages use for gating is the one the pure permission functions take. That is what
 * stops the browser and the API routes from disagreeing about what somebody may see: there is one
 * implementation of the rule and two callers.
 */

interface WindowsAgentContextValue {
  viewer: WindowsAgentViewer;
  scope: ActivityScope;
  actor: Actor;
  directory: DirectoryEntry[];
  directoryById: Map<string, DirectoryEntry>;
  departments: { id: string; name: string }[];
  settings: WindowsAgentUiSettings;
  loading: boolean;
  canOpenModule: boolean;
  refresh: () => Promise<void>;
  /** Report a failure to the user once, rather than every render. */
  reportError: (context: string, error: unknown) => void;
}

const WindowsAgentContext = createContext<WindowsAgentContextValue | null>(null);

export function WindowsAgentProvider({ children }: { children: ReactNode }) {
  const { user, permissions, effectiveAccess, loading: authLoading } = useAuth();
  const { toast } = useToast();

  const [directory, setDirectory] = useState<DirectoryEntry[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [settings, setSettings] = useState<WindowsAgentUiSettings>(DEFAULT_UI_SETTINGS);
  const [loading, setLoading] = useState(true);

  /**
   * Errors already surfaced, so a failing subscription does not raise a toast on every retry.
   * A ref rather than state: showing a toast must not itself cause a render.
   */
  const reportedErrors = useRef(new Set<string>());

  const reportError = useCallback(
    (context: string, error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      const key = context + '::' + message;
      if (reportedErrors.current.has(key)) return;
      reportedErrors.current.add(key);
      console.error('[windows-agent] ' + context, error);
      toast({
        variant: 'destructive',
        title: context,
        description: message.includes('permission')
          ? 'Firestore refused the read. The Windows Agent rules may not be deployed yet — see docs/windows-agent.md.'
          : message,
      });
    },
    [toast],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [people, depts, config] = await Promise.all([
        fetchDirectory().catch((error) => {
          reportError('Could not load the user directory', error);
          return [] as DirectoryEntry[];
        }),
        fetchDepartments().catch(() => []),
        fetchSettings().catch(() => DEFAULT_UI_SETTINGS),
      ]);
      setDirectory(people);
      setDepartments(depts);
      setSettings(config);
    } finally {
      setLoading(false);
    }
  }, [reportError]);

  useEffect(() => {
    if (authLoading || !user) return;
    void load();
  }, [authLoading, user, load]);

  const viewer = useMemo<WindowsAgentViewer>(() => {
    return {
      userId: user?.id ?? '',
      userName: user?.name ?? 'User',
      permissions,
      // From the additive access layer, so a user who holds a department through a grant rather
      // than through `users.departmentId` is scoped correctly.
      departmentIds: effectiveAccess?.departmentIds ?? [],
      // No reporting line is modelled in this database, so "team" resolves to the viewer's own
      // department members. Named honestly rather than left as an empty list, which would make
      // `View Team` grant nothing and look broken.
      teamUserIds: directory
        .filter(
          (entry) =>
            entry.departmentId !== null &&
            (effectiveAccess?.departmentIds ?? []).includes(entry.departmentId),
        )
        .map((entry) => entry.id),
      selfViewEnabled: settings.employeeSelfViewEnabled,
    };
  }, [user, permissions, effectiveAccess, directory, settings.employeeSelfViewEnabled]);

  const value = useMemo<WindowsAgentContextValue>(
    () => ({
      viewer,
      scope: resolveActivityScope(viewer),
      actor: { userId: viewer.userId, userName: viewer.userName },
      directory,
      directoryById: new Map(directory.map((entry) => [entry.id, entry])),
      departments,
      settings,
      loading: loading || authLoading,
      canOpenModule: canOpenWindowsAgent(viewer),
      refresh: load,
      reportError,
    }),
    [viewer, directory, departments, settings, loading, authLoading, load, reportError],
  );

  return <WindowsAgentContext.Provider value={value}>{children}</WindowsAgentContext.Provider>;
}

export function useWindowsAgent(): WindowsAgentContextValue {
  const value = useContext(WindowsAgentContext);
  if (!value) {
    throw new Error('useWindowsAgent must be used inside the Windows Agent module layout.');
  }
  return value;
}

/**
 * A one-shot query with loading, error and manual refresh.
 *
 * Deliberately not a data-fetching library. The module has perhaps fifteen queries, every one of
 * them a read behind an explicit filter, and none of them benefits from cache invalidation
 * across routes — adding React Query here would be more configuration than code.
 *
 * `deps` is the dependency array for the fetcher; the query re-runs when it changes. `enabled`
 * skips the fetch entirely, which is how pages avoid querying before a permission check has
 * resolved — a refused read is a console error and a toast for something nobody asked for.
 */
export function useWindowsAgentQuery<T>(
  key: string,
  fetcher: () => Promise<T>,
  deps: unknown[],
  options: { enabled?: boolean; initial?: T } = {},
): { data: T | undefined; loading: boolean; error: Error | null; refresh: () => void } {
  const { reportError } = useWindowsAgent();
  const [data, setData] = useState<T | undefined>(options.initial);
  const [loading, setLoading] = useState(options.enabled !== false);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);

  const enabled = options.enabled !== false;
  // The fetcher is a new closure every render; depending on it directly would loop for ever.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetcherRef
      .current()
      .then((result) => {
        if (cancelled) return;
        setData(result);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        const asError = caught instanceof Error ? caught : new Error(String(caught));
        setError(asError);
        reportError(key, asError);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, nonce, key, reportError, ...deps]);

  return { data, loading, error, refresh: useCallback(() => setNonce((value) => value + 1), []) };
}

/**
 * A clock that ticks, for "last seen 40 seconds ago" on the live board.
 *
 * One interval shared by every relative timestamp on a page. Without it each of two hundred rows
 * would own a timer, which on the live board is two hundred renders a second.
 */
export function useTickingNow(intervalMs = 15_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** An async action with a pending flag and error toasting, for the admin buttons. */
export function useWindowsAgentAction(): {
  run: (label: string, action: () => Promise<void>) => Promise<boolean>;
  pending: boolean;
} {
  const { toast } = useToast();
  const [pending, setPending] = useState(false);

  const run = useCallback(
    async (label: string, action: () => Promise<void>) => {
      setPending(true);
      try {
        await action();
        toast({ title: label, description: 'Done.' });
        return true;
      } catch (error) {
        toast({
          variant: 'destructive',
          title: label + ' failed',
          description: error instanceof Error ? error.message : String(error),
        });
        return false;
      } finally {
        setPending(false);
      }
    },
    [toast],
  );

  return { run, pending };
}
