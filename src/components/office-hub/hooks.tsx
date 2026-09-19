'use client';

/**
 * The module's shared client state.
 *
 * One provider at the layout, so that the four things every Office Hub screen needs — who the
 * viewer is, what they may do, the office settings, and the employee/team/department directory —
 * are loaded once per navigation rather than once per component. Before a provider, a page with a
 * register, a filter bar and three dialogs would each load the directory, which is four collection
 * reads per screen for data that changes when somebody joins the company.
 *
 * Everything returned from these hooks is memoised. `OfficeHubProvider` builds its context value
 * from these objects, so an unstable return here means a fresh context value on every provider
 * render — and that re-renders every consumer in the module, including the register table and the
 * calendar grid.
 */

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
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import {
  DEFAULT_OFFICE_HUB_SETTINGS,
  EMPTY_VIEWER,
  resolveOfficeHubCapabilities,
  startOfMonth,
  startOfWeek,
  endOfMonth,
  addDays,
  todayInZone,
  widestMeetingScope,
  widestTaskScope,
  type OfficeHubCapabilities,
  type OfficeHubSettings,
  type OfficeHubViewer,
} from '@/lib/office-hub';
import {
  loadOfficeHubDirectory,
  loadOfficeHubUserSettings,
  loadOfficeHubViewerContext,
  officeHubActorFromUser,
  subscribeOfficeHubSettings,
  clearOfficeHubDirectoryCache,
  type OfficeHubActor,
  type OfficeHubDirectory,
} from '@/lib/office-hub-service';
import {
  UNCONFIGURED_GOOGLE_STATUS,
  disconnectGoogleMeet,
  fetchGoogleMeetStatus,
  googleStatusUnavailable,
  startGoogleConnect,
  type GoogleMeetStatus,
} from '@/lib/office-hub-google-client';
import type { OfficeHubUserSettings } from '@/lib/office-hub-model';

const EMPTY_DIRECTORY: OfficeHubDirectory = { people: [], departments: [], projects: [], teams: [] };

interface OfficeHubContextValue {
  /** Null until the auth session resolves, or for a signed-out user. */
  actor: OfficeHubActor | null;
  viewer: OfficeHubViewer;
  capabilities: OfficeHubCapabilities;
  settings: OfficeHubSettings;
  userSettings: OfficeHubUserSettings | null;
  directory: OfficeHubDirectory;
  /** True while any of the four are still loading. Screens render a skeleton on it. */
  isLoading: boolean;
  /** Today, in the viewer's own zone — every "is this overdue" comparison uses this. */
  today: string;
  /** Week and month bounds in the viewer's zone, for the dashboard tiles. */
  periods: { weekStart: string; weekEnd: string; monthStart: string; monthEnd: string };
  /** The widest scope this viewer's grants allow, for choosing the Firestore query. */
  meetingScope: ReturnType<typeof widestMeetingScope>;
  taskScope: ReturnType<typeof widestTaskScope>;
  refreshDirectory: () => Promise<void>;
  refreshUserSettings: () => Promise<void>;
}

const OfficeHubContext = createContext<OfficeHubContextValue | null>(null);

export function OfficeHubProvider({ children }: { children: ReactNode }) {
  const { user, permissions, loading: authLoading } = useAuth();
  const { isLoading: permissionsLoading } = useAuthorization();

  const [settings, setSettings] = useState<OfficeHubSettings>(DEFAULT_OFFICE_HUB_SETTINGS);
  const [userSettings, setUserSettings] = useState<OfficeHubUserSettings | null>(null);
  const [directory, setDirectory] = useState<OfficeHubDirectory>(EMPTY_DIRECTORY);
  const [context, setContext] = useState<{
    headsDepartmentIds: string[];
    teamIds: string[];
    leadsTeamIds: string[];
    departmentId: string | null;
    departmentName: string | null;
  } | null>(null);
  const [contextLoading, setContextLoading] = useState(true);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const actor = useMemo(() => officeHubActorFromUser(user), [user]);

  /**
   * Settings are a live listener, not a read.
   *
   * An administrator changing the default reminder or the meeting-type list expects it to take
   * effect without everybody re-logging in — the same reasoning `AuthProvider` applies to role
   * documents. It is one document, so the listener is cheap (§52).
   */
  useEffect(() => {
    if (!actor) return;
    return subscribeOfficeHubSettings((next) => {
      if (mounted.current) setSettings(next);
    });
  }, [actor]);

  const refreshUserSettings = useCallback(async () => {
    if (!actor) return;
    try {
      const next = await loadOfficeHubUserSettings(actor.userId);
      if (mounted.current) setUserSettings(next);
    } catch (error) {
      // The defaults are a complete, working answer, so a failed read degrades rather than blocks.
      console.error('[office-hub] Could not load your preferences; using defaults', error);
    }
  }, [actor]);

  const refreshDirectory = useCallback(async () => {
    if (!actor) return;
    clearOfficeHubDirectoryCache();
    try {
      const [next, viewerContext] = await Promise.all([
        loadOfficeHubDirectory({ force: true }),
        loadOfficeHubViewerContext(actor.userId),
      ]);
      if (!mounted.current) return;
      setDirectory(next);
      setContext(viewerContext);
    } catch (error) {
      console.error('[office-hub] Could not load the directory', error);
    }
  }, [actor]);

  useEffect(() => {
    if (!actor) {
      setContextLoading(false);
      return;
    }
    let cancelled = false;
    setContextLoading(true);

    void (async () => {
      try {
        const [nextDirectory, viewerContext, preferences] = await Promise.all([
          loadOfficeHubDirectory(),
          loadOfficeHubViewerContext(actor.userId),
          loadOfficeHubUserSettings(actor.userId).catch(() => null),
        ]);
        if (cancelled || !mounted.current) return;
        setDirectory(nextDirectory);
        setContext(viewerContext);
        setUserSettings(preferences);
      } catch (error) {
        console.error('[office-hub] Could not load module context', error);
        if (!cancelled && mounted.current) {
          // Fall back to what the session alone knows. The user can still see and act on anything
          // assigned to them directly, which is the common case — the same degradation E-Approval's
          // actor context makes.
          setContext({
            headsDepartmentIds: [],
            teamIds: [],
            leadsTeamIds: [],
            departmentId: null,
            departmentName: null,
          });
        }
      } finally {
        if (!cancelled && mounted.current) setContextLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [actor]);

  const viewer = useMemo<OfficeHubViewer>(() => {
    if (!actor) return EMPTY_VIEWER;
    const me = directory.people.find((person) => person.userId === actor.userId);
    return {
      userId: actor.userId,
      name: actor.userName,
      email: actor.userEmail ?? null,
      departmentId: context?.departmentId ?? me?.departmentId ?? null,
      departmentName: context?.departmentName ?? me?.departmentName ?? null,
      headsDepartmentIds: context?.headsDepartmentIds ?? [],
      teamIds: context?.teamIds ?? [],
      leadsTeamIds: context?.leadsTeamIds ?? [],
      employeeId: me?.employeeId ?? null,
      designation: me?.designation ?? actor.role ?? null,
      timeZone: userSettings?.timeZone ?? settings.defaultTimeZone,
    };
  }, [actor, context, directory.people, settings.defaultTimeZone, userSettings?.timeZone]);

  const capabilities = useMemo(
    () => resolveOfficeHubCapabilities(permissions, viewer),
    [permissions, viewer],
  );

  /**
   * Today, and the period bounds, in the viewer's own zone.
   *
   * Recomputed only when the zone changes — not on every render, and deliberately *not* on a timer.
   * A dashboard open across midnight showing yesterday's date for a few minutes is a far smaller
   * problem than every list in the module re-deriving its overdue counts every second.
   */
  const { today, periods } = useMemo(() => {
    const zone = viewer.timeZone ?? settings.defaultTimeZone;
    const date = todayInZone(zone);
    const weekStart = startOfWeek(date);
    return {
      today: date,
      periods: {
        weekStart,
        weekEnd: addDays(weekStart, 6),
        monthStart: startOfMonth(date),
        monthEnd: endOfMonth(date),
      },
    };
  }, [viewer.timeZone, settings.defaultTimeZone]);

  const value = useMemo<OfficeHubContextValue>(
    () => ({
      actor,
      viewer,
      capabilities,
      settings,
      userSettings,
      directory,
      isLoading: authLoading || permissionsLoading || contextLoading,
      today,
      periods,
      meetingScope: widestMeetingScope(capabilities),
      taskScope: widestTaskScope(capabilities),
      refreshDirectory,
      refreshUserSettings,
    }),
    [
      actor,
      viewer,
      capabilities,
      settings,
      userSettings,
      directory,
      authLoading,
      permissionsLoading,
      contextLoading,
      today,
      periods,
      refreshDirectory,
      refreshUserSettings,
    ],
  );

  return <OfficeHubContext.Provider value={value}>{children}</OfficeHubContext.Provider>;
}

/**
 * The module's context.
 *
 * Throws outside the provider rather than returning a default, because a screen that silently reads
 * `EMPTY_VIEWER` would render as "you have no permissions" — a bug that looks exactly like correct
 * behaviour and is therefore never reported.
 */
export function useOfficeHub(): OfficeHubContextValue {
  const context = useContext(OfficeHubContext);
  if (!context) {
    throw new Error('useOfficeHub must be used inside OfficeHubProvider (see the office-hub layout).');
  }
  return context;
}

/** Just the capabilities, for the many components that only gate buttons. */
export function useOfficeHubCapabilities(): OfficeHubCapabilities {
  return useOfficeHub().capabilities;
}

/** Department and project name lookups, which every register needs and nothing else provides. */
export function useOfficeHubLookups(): {
  departmentNames: Record<string, string>;
  projectNames: Record<string, string>;
  peopleById: Record<string, OfficeHubDirectory['people'][number]>;
  teamsById: Record<string, OfficeHubDirectory['teams'][number]>;
} {
  const { directory } = useOfficeHub();
  return useMemo(() => {
    const departmentNames: Record<string, string> = {};
    for (const department of directory.departments) departmentNames[department.id] = department.name;
    const projectNames: Record<string, string> = {};
    for (const project of directory.projects) projectNames[project.id] = project.name;
    const peopleById: Record<string, OfficeHubDirectory['people'][number]> = {};
    for (const person of directory.people) peopleById[person.userId] = person;
    const teamsById: Record<string, OfficeHubDirectory['teams'][number]> = {};
    for (const team of directory.teams) teamsById[team.id] = team;
    return { departmentNames, projectNames, peopleById, teamsById };
  }, [directory]);
}

/* ── async plumbing ──────────────────────────────────────────────────────────────────────────── */

/**
 * A one-shot async load with loading and error state, cancelled on unmount.
 *
 * Every register in this module needs exactly this, and hand-rolling it per screen is how a
 * component ends up calling `setState` after unmount — which React reports as a warning pointing at
 * the wrong file. `deps` behaves like a `useEffect` dependency list.
 */
export function useOfficeHubQuery<T>(
  loader: () => Promise<T>,
  deps: readonly unknown[],
  options: { enabled?: boolean; initial?: T } = {},
): { data: T | undefined; isLoading: boolean; error: Error | null; reload: () => void } {
  const [data, setData] = useState<T | undefined>(options.initial);
  const [isLoading, setIsLoading] = useState(options.enabled !== false);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    if (options.enabled === false) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    void loaderRef
      .current()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        const failure = caught instanceof Error ? caught : new Error(String(caught));
        console.error('[office-hub] Query failed', failure);
        setError(failure);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce, options.enabled]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);
  return { data, isLoading, error, reload };
}

/**
 * Run a write with a busy flag, a success toast and a failure toast (§79, §56).
 *
 * The failure path is the reason this exists: a raw Firestore error message ("Missing or
 * insufficient permissions") is a stack trace as far as a user is concerned, and §56 says not to
 * show those. `OfficeHubServiceError` and `OfficeHubRuleError` carry messages written for a person,
 * so those pass through; anything else is replaced with a sentence that says what failed and what
 * to do, and the real error goes to the console for whoever is debugging it.
 */
export function useOfficeHubAction(): {
  isBusy: boolean;
  run: <T>(
    operation: () => Promise<T>,
    messages: { success?: string; failure?: string; describe?: string },
  ) => Promise<T | null>;
} {
  const { toast } = useToast();
  const [isBusy, setIsBusy] = useState(false);

  const run = useCallback(
    async <T,>(
      operation: () => Promise<T>,
      messages: { success?: string; failure?: string; describe?: string },
    ): Promise<T | null> => {
      setIsBusy(true);
      try {
        const result = await operation();
        if (messages.success) toast({ title: messages.success });
        return result;
      } catch (caught: unknown) {
        console.error(`[office-hub] ${messages.describe ?? 'Action'} failed`, caught);
        const written =
          caught instanceof Error &&
          (caught.name === 'OfficeHubServiceError' || caught.name === 'OfficeHubRuleError')
            ? caught.message
            : null;
        toast({
          variant: 'destructive',
          title: messages.failure ?? 'That did not work',
          description:
            written ??
            'Something went wrong saving your change. Check your connection and try again — nothing was saved.',
        });
        return null;
      } finally {
        setIsBusy(false);
      }
    },
    [toast],
  );

  return { isBusy, run };
}

/**
 * A debounced value, for search boxes (§58).
 *
 * 250ms: long enough that a normal typing speed produces one query rather than one per keystroke,
 * short enough that the list does not feel like it is lagging behind the cursor.
 */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/**
 * Browser notification permission and delivery (§34).
 *
 * Permission is never requested on load. A permission prompt nobody asked for is the fastest way to
 * get it denied permanently, and a denial cannot be undone from the page — so the prompt is behind
 * an explicit control in Settings, and denial simply leaves the in-app bell as the only channel,
 * which §34 says is the correct fallback.
 */
export function useBrowserNotifications(): {
  supported: boolean;
  permission: NotificationPermission | 'unsupported';
  request: () => Promise<NotificationPermission | 'unsupported'>;
  show: (title: string, body: string, link?: string) => void;
} {
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('unsupported');

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setPermission('unsupported');
      return;
    }
    setPermission(Notification.permission);
  }, []);

  const request = useCallback(async (): Promise<NotificationPermission | 'unsupported'> => {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      return result;
    } catch {
      return Notification.permission;
    }
  }, []);

  const show = useCallback(
    (title: string, body: string, link?: string) => {
      if (typeof window === 'undefined' || !('Notification' in window)) return;
      if (Notification.permission !== 'granted') return;
      try {
        const notification = new Notification(title, { body, icon: '/favicon.ico', tag: link ?? title });
        if (link) {
          notification.onclick = () => {
            window.focus();
            window.location.href = link;
          };
        }
      } catch (error) {
        // Some browsers throw when constructing a Notification outside a service worker. The in-app
        // bell has the same notification already, so this is a degraded channel, not a failure.
        console.warn('[office-hub] Browser notification could not be shown', error);
      }
    },
    [],
  );

  return {
    supported: permission !== 'unsupported',
    permission,
    request,
    show,
  };
}

/**
 * The caller's Google Meet connection, and the controls to change it (§63).
 *
 * Shared between the Settings card and the meeting form, because both need the same three facts —
 * is the integration configured, is this user connected, and what should the button say — and a
 * second copy of that logic would let the two screens disagree about whether Google works.
 *
 * ── A failed read is its own state, not "not configured" ───────────────────────────────────────
 *
 * This hook used to swallow a failed status read into `UNCONFIGURED_GOOGLE_STATUS`, on the theory
 * that the user's next action was the same either way. That was wrong, and it cost real debugging
 * time: an expired session or a 503 from the Admin SDK rendered as "Google Meet is not set up on
 * this server", sending somebody to check environment variables that were correct all along.
 *
 * So a failure now carries its reason in `status.unavailable`, and the screens say "could not be
 * checked" rather than asserting something about the server they do not know.
 */
export function useGoogleMeetStatus(options: { enabled?: boolean } = {}): {
  status: GoogleMeetStatus;
  isLoading: boolean;
  reload: () => void;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  isBusy: boolean;
} {
  const { toast } = useToast();
  const [isBusy, setIsBusy] = useState(false);

  const { data, isLoading, reload } = useOfficeHubQuery(
    () =>
      fetchGoogleMeetStatus().catch((error: unknown) => {
        console.error('[office-hub] Could not read the Google Meet status', error);
        return googleStatusUnavailable(error);
      }),
    [],
    { enabled: options.enabled !== false, initial: UNCONFIGURED_GOOGLE_STATUS },
  );

  const connect = useCallback(async () => {
    setIsBusy(true);
    try {
      // On success this navigates away, so there is no state to reset on the happy path.
      await startGoogleConnect();
    } catch (error) {
      setIsBusy(false);
      toast({
        variant: 'destructive',
        title: 'Could not start the Google connection',
        description: error instanceof Error ? error.message : 'Try again in a moment.',
      });
    }
  }, [toast]);

  const disconnect = useCallback(async () => {
    setIsBusy(true);
    try {
      const message = await disconnectGoogleMeet();
      toast({ title: 'Google disconnected', description: message });
      reload();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Could not disconnect Google',
        description: error instanceof Error ? error.message : 'Try again in a moment.',
      });
    } finally {
      setIsBusy(false);
    }
  }, [reload, toast]);

  return {
    status: data ?? UNCONFIGURED_GOOGLE_STATUS,
    isLoading,
    reload,
    connect,
    disconnect,
    isBusy,
  };
}
