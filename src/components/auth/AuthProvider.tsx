
'use client';

import * as React from 'react';
import {
  createContext,
  useContext,
  useMemo,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { onAuthStateChanged, User as FirebaseUser, signOut } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  onSnapshot,
} from 'firebase/firestore';
import type { User, Role, SavedUser } from '@/lib/types';
import {
  deactivationHasLapsed,
  mergePermissionMaps,
  resolveEffectiveAccess,
  type EffectiveAccess,
  type RoleLike,
  type ScopeGrantConfig,
  type UserAccessGrant,
} from '@/lib/access-control';
import {
  ACCESS_COLLECTIONS,
  listenToUserAccessGrant,
  reactivateLapsedDeactivations,
} from '@/lib/access-control-service';
import { useToast } from '@/hooks/use-toast';
import { PinSetupDialog } from './PinSetupDialog';
import {
  createOrResumeSession,
  getOrCreateSessionId,
  listenToSession,
  terminateSession,
  updateSessionActivity,
} from '@/lib/session-manager';
import { unregisterCurrentPushDevice } from '@/lib/chat-push-client';
import { unregisterWebPushDevice } from '@/lib/web-push-client';
import { stopNativeAndroidUserLocation } from '@/lib/native-user-location';

/** Upper bound on how long the app shell waits for the first permissions read. */
const ROLE_SNAPSHOT_TIMEOUT_MS = 5000;

/**
 * How often ordinary pointer/keyboard activity is allowed to refresh the session.
 *
 * The activity listeners below include `mousemove` and `scroll`, which fire at the display's refresh
 * rate. Each one ran `extendSession`, and `extendSession` writes to `localStorage` — a *synchronous*
 * call that blocks the main thread — then clears and re-arms two timers. At 60Hz that is sixty
 * blocking storage writes and two hundred and forty timer operations per second of mouse movement,
 * on every screen in the application. It is felt most on the pages that are already doing work while
 * you scroll them, which is how a long approval register comes to stutter.
 *
 * Thirty seconds is far finer than the session needs: the timeout is an hour, so the worst effect of
 * the throttle is that a session expires up to thirty seconds earlier than the last twitch of the
 * mouse. Activity while the expiry warning is actually on screen bypasses it entirely.
 */
const ACTIVITY_THROTTLE_MS = 30_000;

/* ---------------- types ---------------- */

interface AuthContextType {
  user: User | null;
  users: User[];
  /**
   * The user's effective permissions — base role, plus anything the access-management layer adds
   * on top (`src/lib/access-control.ts`).
   *
   * A union, always. Before that layer existed this was the base role's permission map verbatim,
   * and for every user who has never been given additional access it still is, byte for byte. Any
   * code reading this keeps working unchanged; it just sees more when there is more to see.
   */
  permissions: Record<string, string[]>;
  /**
   * The same answer with provenance attached — which role or grant gives each permission.
   * Consumed by the access-management screens; ordinary permission checks want `permissions` or,
   * better, `useAuthorization().can`.
   */
  effectiveAccess: EffectiveAccess | null;
  loading: boolean;
  isImpersonating: boolean;
  originalUser: User | null;
  refreshUserData: () => Promise<void>;
  isSessionExpired: boolean;
  setIsSessionExpired: (isExpired: boolean) => void;
  extendSession: () => void;
  handleSignOut: (isSessionExpired?: boolean) => Promise<void>;
  savedUsers: SavedUser[];
  setShouldRemember: (shouldRemember: boolean) => void;
  clearSavedUsers: () => void;
  loadSavedUsers: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  users: [],
  permissions: {},
  effectiveAccess: null,
  loading: true,
  isImpersonating: false,
  originalUser: null,
  refreshUserData: async () => {},
  isSessionExpired: false,
  setIsSessionExpired: () => {},
  extendSession: () => {},
  handleSignOut: async () => {},
  savedUsers: [],
  setShouldRemember: () => {},
  clearSavedUsers: () => {},
  loadSavedUsers: () => {},
});

/* ---------------- provider ---------------- */

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [originalUser, setOriginalUser] = useState<User | null>(null);
  const [isImpersonating, setIsImpersonating] = useState(false);
  /**
   * What the user's own `users.role` grants, read live from the `roles` collection. Unchanged from
   * before the access layer existed, and still what gates the first paint — the additive layer
   * resolves afterwards and can only widen the result.
   */
  const [basePermissions, setBasePermissions] = useState<Record<string, string[]>>({});
  /**
   * The additive layer's answer, or null while it loads / when there is nothing to add. Null is the
   * normal state for a user who has never been given additional access.
   */
  const [additiveAccess, setAdditiveAccess] = useState<EffectiveAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSessionExpired, setIsSessionExpired] = useState(false);

  const [savedUsers, setSavedUsers] = useState<SavedUser[]>([]);
  const [shouldRemember, setShouldRemember] = useState(false);
  const [isPinSetupOpen, setIsPinSetupOpen] = useState(false);
  const [userForPinSetup, setUserForPinSetup] = useState<User | null>(null);

  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const warningTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const sessionUnsubscribeRef = useRef<(() => void) | null>(null);
  const roleUnsubscribeRef = useRef<(() => void) | null>(null);
  const lastSessionUpdateRef = useRef<number>(0);
  // Holds the configured session duration so resetTimeouts doesn't depend on `user`
  // directly (which would create an infinite render loop via onAuthStateChanged).
  const sessionDurationMinutesRef = useRef<number>(60);

  const { toast } = useToast();

  /* ---------- sign out ---------- */

  const handleSignOut = useCallback(
    async (isExpired = false) => {
      try {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        if (warningTimeoutRef.current) clearTimeout(warningTimeoutRef.current);

        // Unsubscribe listener before terminating to prevent re-entry
        if (sessionUnsubscribeRef.current) {
          sessionUnsubscribeRef.current();
          sessionUnsubscribeRef.current = null;
        }

        // Terminate session record in Firestore
        const sessionId = typeof window !== 'undefined' ? localStorage.getItem('sessionId') : null;
        if (sessionId) {
          await terminateSession(sessionId, isExpired ? 'timeout' : 'user').catch(() => {});
        }

        // Clean up real-time role permissions listener
        if (roleUnsubscribeRef.current) {
          roleUnsubscribeRef.current();
          roleUnsubscribeRef.current = null;
        }

        // Both are no-ops on the platform they don't apply to. Dropping the token on
        // sign-out matters most on shared machines and handsets, where the next user
        // would otherwise keep receiving the previous one's approvals and alerts.
        await unregisterCurrentPushDevice();
        await unregisterWebPushDevice();
        await stopNativeAndroidUserLocation().catch(() => {});
        await signOut(auth);
        localStorage.clear();

        if (isExpired) {
          toast({
            title: 'Session Expired',
            description: 'Your session has expired. Please log in again.',
            variant: 'destructive',
          });
        }

        setUser(null);
        setBasePermissions({});
      } catch (error) {
        console.error('Error signing out:', error);
        toast({
          title: 'Error',
          description: 'Failed to sign out. Please try again.',
          variant: 'destructive',
        });
      }
    },
    [toast]
  );

  /* ---------- session timers ---------- */

  const resetTimeouts = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (warningTimeoutRef.current) clearTimeout(warningTimeoutRef.current);

    const SESSION_TIMEOUT = sessionDurationMinutesRef.current * 60 * 1000;
    const WARNING_TIME = 1 * 60 * 1000;

    warningTimeoutRef.current = setTimeout(() => {
      setIsSessionExpired(true);
    }, SESSION_TIMEOUT - WARNING_TIME);

    timeoutRef.current = setTimeout(() => {
      handleSignOut(true);
    }, SESSION_TIMEOUT);
  }, [handleSignOut]); // no longer depends on `user` — reads via ref instead

  const extendSession = useCallback(() => {
    localStorage.setItem('lastActivity', Date.now().toString());
    setIsSessionExpired(false);
    resetTimeouts();

    // Throttle Firestore heartbeat to once every 2 minutes
    const now = Date.now();
    if (now - lastSessionUpdateRef.current > 2 * 60 * 1000) {
      lastSessionUpdateRef.current = now;
      const sessionId = typeof window !== 'undefined' ? localStorage.getItem('sessionId') : null;
      if (sessionId) updateSessionActivity(sessionId).catch(() => {});
    }
  }, [resetTimeouts]);

  /* ---------- saved users helpers ---------- */

  const loadSavedUsers = useCallback(() => {
    try {
      const stored = localStorage.getItem('savedUsers');
      if (!stored) {
        setSavedUsers([]);
        return;
      }
      const parsed = JSON.parse(stored);
      setSavedUsers(Array.isArray(parsed) ? parsed : []);
    } catch (err) {
      console.error('Failed to load saved users', err);
      setSavedUsers([]);
    }
  }, []);

  const clearSavedUsers = useCallback(() => {
    try {
      localStorage.removeItem('savedUsers');
      setSavedUsers([]);
    } catch (err) {
      console.error('Failed to clear saved users', err);
    }
  }, []);

  /* ---------- fetch user + permissions ---------- */

  const fetchUserData = useCallback(
    async (firebaseUser: FirebaseUser | null): Promise<User | null> => {
      if (!firebaseUser) {
        setUser(null);
        setUsers([]);
        setBasePermissions({});
        setOriginalUser(null);
        setIsImpersonating(false);
        return null;
      }

      try {
        // Impersonation
        const impersonationUserId = localStorage.getItem('impersonationUserId');
        const storedOriginalUser = localStorage.getItem('originalAdminUser');

        let userToLoadId = firebaseUser.uid;
        let impersonating = false;

        if (impersonationUserId && storedOriginalUser) {
          try {
            const original = JSON.parse(storedOriginalUser) as User;
            if (firebaseUser.uid === original.id) {
              userToLoadId = impersonationUserId;
              setOriginalUser(original);
              impersonating = true;
            } else {
              localStorage.removeItem('impersonationUserId');
              localStorage.removeItem('originalAdminUser');
            }
          } catch (err) {
            console.error('Error parsing original user', err);
            localStorage.removeItem('impersonationUserId');
            localStorage.removeItem('originalAdminUser');
          }
        }

        setIsImpersonating(impersonating);

        // User doc
        let snap = await getDoc(doc(db, 'users', userToLoadId));

        if (!snap.exists() && firebaseUser.email) {
          const emailToMatch = String(firebaseUser.email).trim().toLowerCase();
          const byEmailQuery = query(collection(db, 'users'), where('email', '==', emailToMatch));
          const byEmailSnap = await getDocs(byEmailQuery);
          if (!byEmailSnap.empty) {
            snap = byEmailSnap.docs[0];
          }
        }

        if (!snap.exists()) {
          console.error('User doc not found for UID/email:', userToLoadId, firebaseUser.email);
          await handleSignOut();
          toast({
            title: 'Account not registered',
            description: 'This Google account is not linked to any user in the system. Please contact your administrator.',
            variant: 'destructive',
          });
          return null;
        }

        let userData = {
          id: snap.id,
          ...snap.data(),
        } as User;

        /**
         * A temporary deactivation whose end date has passed lifts itself here, at the first
         * sign-in after it — there is no scheduled job for it, and "until 30 September" must not
         * mean "until an administrator remembers". The write is best-effort: the server-side
         * check already treats a lapsed deactivation as active, so a refusal here costs only the
         * tidy-up, and the user still gets in.
         */
        if (deactivationHasLapsed(userData)) {
          try {
            [userData] = await reactivateLapsedDeactivations([userData]);
          } catch (error) {
            console.error('Could not lift a lapsed temporary deactivation', error);
            userData = { ...userData, status: 'Active', deactivation: null };
          }
        }

        /**
         * A deactivated account cannot use the application.
         *
         * This check did not exist before, and its absence was the hole under "resigned employees
         * must lose access": several API routes rejected `status === 'Inactive'`, but the browser
         * never did — so a deactivated user kept a working session and every screen that trusts the
         * client-side permission check kept rendering for them.
         *
         * Deliberately *after* the impersonation resolution above, so an administrator can still
         * open a deactivated user's record; and deliberately before `setUser`, so no permission is
         * ever resolved for an account that should not be here.
         */
        if (userData.status === 'Inactive') {
          await handleSignOut();
          toast({
            title: 'Account deactivated',
            description:
              'This account is no longer active. If you believe this is a mistake, contact your administrator.',
            variant: 'destructive',
          });
          return null;
        }

        setUser(userData);

        // The full directory is needed by admin/chat screens, never by first paint.
        // Load it in the background so it can't gate the app shell.
        void getDocs(collection(db, 'users'))
          .then((allUsersSnap) => {
            setUsers(
              allUsersSnap.docs.map((d) => ({ id: d.id, ...d.data() } as User))
            );
          })
          .catch((err) => console.error('Failed to load users directory', err));

        // Session tracking — skip during impersonation. Fire-and-forget: session
        // bookkeeping must not delay rendering the app.
        if (!impersonating) {
          void (async () => {
            try {
              const sessionId = getOrCreateSessionId();
              await createOrResumeSession(sessionId, {
                id: userData.id,
                name: userData.name || '',
                email: userData.email || '',
                role: userData.role || '',
              });

              // Replace any existing listener
              if (sessionUnsubscribeRef.current) sessionUnsubscribeRef.current();
              sessionUnsubscribeRef.current = listenToSession(sessionId, async () => {
                // Unsubscribe before acting to prevent re-entry
                if (sessionUnsubscribeRef.current) {
                  sessionUnsubscribeRef.current();
                  sessionUnsubscribeRef.current = null;
                }
                toast({
                  title: 'Session Terminated',
                  description: 'An administrator has signed you out from this device.',
                  variant: 'destructive',
                });
                await handleSignOut(false);
              });
            } catch (err) {
              console.error('Session setup failed', err);
            }
          })();
        }

        if (!localStorage.getItem('lastActivity')) {
          extendSession();
        }

        // Remember-me → PIN setup
        if (shouldRemember && !impersonating) {
          try {
            const currentSaved: SavedUser[] = JSON.parse(
              localStorage.getItem('savedUsers') || '[]'
            );
            const exists = currentSaved.some((u) => u.id === userData.id);
            if (!exists) {
              setUserForPinSetup(userData);
              setIsPinSetupOpen(true);
            }
          } catch (err) {
            console.error('Error checking saved users', err);
          }
          setShouldRemember(false);
        }

        // Role & permissions — real-time listener so permission changes
        // in Role Management take effect immediately without re-login.
        if (userData.role) {
          const rolesQuery = query(
            collection(db, 'roles'),
            where('name', '==', userData.role)
          );
          // Unsubscribe any previous role listener before creating a new one
          if (roleUnsubscribeRef.current) {
            roleUnsubscribeRef.current();
            roleUnsubscribeRef.current = null;
          }
          // Permissions gate what the shell renders, so wait for the first
          // snapshot — but only that one. Later snapshots keep flowing so role
          // edits still apply live without a re-login.
          await new Promise<void>((resolve) => {
            let settled = false;
            let timeout: ReturnType<typeof setTimeout> | null = null;
            const settle = () => {
              if (settled) return;
              settled = true;
              if (timeout) clearTimeout(timeout);
              resolve();
            };
            // Don't let a cold cache with no connectivity strand the app on the
            // loading screen — render with whatever permissions we have and let
            // the listener fill them in when it does arrive.
            timeout = setTimeout(settle, ROLE_SNAPSHOT_TIMEOUT_MS);
            roleUnsubscribeRef.current = onSnapshot(rolesQuery, (snap) => {
              if (!snap.empty) {
                const roleData = snap.docs[0].data() as Role;
                setBasePermissions(roleData.permissions || {});
              } else {
                console.warn(`Role '${userData.role}' not found`);
                setBasePermissions({});
              }
              settle();
            }, (err) => {
              console.error('Role permissions listener error:', err);
              settle();
            });
          });
        } else {
          console.warn('User has no role');
          setBasePermissions({});
        }

        return userData;
      } catch (err) {
        console.error('Error fetching user data:', err);
        setUser(null);
        setBasePermissions({});
        toast({
          title: 'Error',
          description: 'Failed to load user data. Please try logging in again.',
          variant: 'destructive',
        });
        return null;
      }
    },
    [extendSession, handleSignOut, shouldRemember, toast]
  );

  const refreshUserData = useCallback(async () => {
    const firebaseUser = auth.currentUser;
    await fetchUserData(firebaseUser);
  }, [fetchUserData]);

  /* ---------- keep session-duration ref in sync ---------- */

  useEffect(() => {
    sessionDurationMinutesRef.current = user?.theme?.sessionDuration || 60;
  }, [user?.theme?.sessionDuration]);

  /* ---------- subscribe to Firebase auth ---------- */

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      await fetchUserData(firebaseUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [fetchUserData]);

  /* ---------- clean up session listener on unmount ---------- */

  useEffect(() => {
    return () => {
      if (sessionUnsubscribeRef.current) {
        sessionUnsubscribeRef.current();
        sessionUnsubscribeRef.current = null;
      }
    };
  }, []);

  /* ---------- session activity ---------- */

  useEffect(() => {
    if (!user) return;

    resetTimeouts();

    let lastBump = Date.now();
    const onActivity = () => {
      const now = Date.now();
      // While the warning dialog is up, any movement dismisses it immediately — that was the
      // behaviour before the throttle, and it is the one moment where responding at once matters.
      if (!isSessionExpired && now - lastBump < ACTIVITY_THROTTLE_MS) return;
      lastBump = now;
      extendSession();
    };

    const events = ['mousemove', 'keydown', 'click', 'scroll'];
    // Passive: none of these handlers calls `preventDefault`, and saying so lets the browser scroll
    // without first waiting to find out.
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (warningTimeoutRef.current) clearTimeout(warningTimeoutRef.current);
      events.forEach((e) => window.removeEventListener(e, onActivity));
    };
  }, [user, extendSession, resetTimeouts, isSessionExpired]);

  /* ---------- additive access layer ---------- */

  /**
   * Subscribe to this user's `accessGrants` document and resolve everything it adds.
   *
   * Three properties this effect must have, in order of importance:
   *
   *   1. **It can only widen access.** The merge below is a union with `basePermissions`, and every
   *      failure path leaves `additiveAccess` null — which resolves to exactly the base role. A
   *      user cannot lose a permission because this layer is unavailable, misconfigured, or slow.
   *
   *   2. **It does not gate the first paint.** The role listener above already resolved before the
   *      shell rendered; this runs afterwards and updates when it arrives. An extra collection read
   *      on every sign-in would be a visible regression for every user in the system, so the roles
   *      collection is fetched only once there is actually something in the grant to resolve.
   *
   *   3. **It stays live.** Grants are assigned by administrators while users are signed in, and
   *      "log out and back in for your new access" is the support ticket this avoids. The same
   *      reasoning that made the role listener a snapshot rather than a read applies here.
   */
  useEffect(() => {
    const userId = user?.id;
    if (!userId) {
      setAdditiveAccess(null);
      return;
    }

    let cancelled = false;
    let resolveToken = 0;

    const resolveGrant = async (grant: UserAccessGrant) => {
      const token = ++resolveToken;
      const hasAdditions =
        grant.additionalRoles.length > 0 ||
        grant.directPermissions.length > 0 ||
        grant.projectAccess.length > 0 ||
        grant.temporaryAccess.length > 0 ||
        grant.departmentIds.length > 0 ||
        grant.designations.length > 0;

      if (!hasAdditions) {
        if (!cancelled && token === resolveToken) setAdditiveAccess(null);
        return;
      }

      try {
        const [roleSnap, scopeSnap] = await Promise.all([
          getDocs(collection(db, ACCESS_COLLECTIONS.roles)),
          // Optional configuration. An installation that has never used department- or
          // designation-based access has none, and a read failure here must not lose the rest.
          getDocs(collection(db, ACCESS_COLLECTIONS.scopeGrants)).catch(() => null),
        ]);
        if (cancelled || token !== resolveToken) return;

        const roles = roleSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() }) as RoleLike);
        const scopeGrants =
          scopeSnap?.docs.map((entry) => ({ id: entry.id, ...entry.data() }) as ScopeGrantConfig) ?? [];

        setAdditiveAccess(
          resolveEffectiveAccess({
            user: { id: userId, name: user?.name, email: user?.email, role: user?.role, status: user?.status },
            roles,
            grant,
            scopeGrants,
          }),
        );
      } catch (err) {
        console.error('[access] Failed to resolve additional access; falling back to base role', err);
        if (!cancelled && token === resolveToken) setAdditiveAccess(null);
      }
    };

    const unsubscribe = listenToUserAccessGrant(
      userId,
      (grant) => {
        void resolveGrant(grant);
      },
      (err) => {
        console.error('[access] Access grant listener error; falling back to base role', err);
        if (!cancelled) setAdditiveAccess(null);
      },
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [user?.id, user?.name, user?.email, user?.role, user?.status]);

  /**
   * Base role ∪ everything the additive layer adds.
   *
   * `basePermissions` is included in the merge even though `additiveAccess` already resolved the
   * base role itself. That is deliberate belt-and-braces: the two are read through different code
   * paths (a live `roles where name ==` query versus a whole-collection read), and if they ever
   * disagree — a role renamed mid-session, a partial read — the union means the user keeps the
   * larger set rather than silently losing the difference.
   */
  const permissions = useMemo(
    () => (additiveAccess ? mergePermissionMaps(basePermissions, additiveAccess.permissions) : basePermissions),
    [basePermissions, additiveAccess],
  );

  /**
   * The provenance-carrying view. When there is no additive layer this is synthesised from the base
   * role, so the access screens can render source badges for every user — including the vast
   * majority who have only ever had one role.
   */
  const effectiveAccess = useMemo<EffectiveAccess | null>(() => {
    if (additiveAccess) return additiveAccess;
    if (!user?.id) return null;
    return resolveEffectiveAccess({
      user: { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status },
      roles: [{ id: 'base-role', name: user.role || '', permissions: basePermissions }],
      grant: null,
    });
  }, [additiveAccess, basePermissions, user?.id, user?.name, user?.email, user?.role, user?.status]);

  /* ---------- context value ---------- */

  /**
   * Memoised, because this is the most widely consumed context in the application.
   *
   * As a plain object literal it was a new value on every render of this provider — and therefore a
   * re-render of every `useAuth()` consumer in the tree, no matter that none of the fields had
   * changed. That is several hundred components, and it happened on each of the ten-or-so state
   * updates the sign-in sequence makes and on every session-activity bump thereafter. The fields are
   * either state or `useCallback`s, so the dependency list holds.
   */
  const value = useMemo<AuthContextType>(
    () => ({
      user,
      users,
      permissions,
      effectiveAccess,
      loading,
      isImpersonating,
      originalUser,
      refreshUserData,
      isSessionExpired,
      setIsSessionExpired,
      extendSession,
      handleSignOut,
      savedUsers,
      setShouldRemember,
      clearSavedUsers,
      loadSavedUsers,
    }),
    [
      user,
      users,
      permissions,
      effectiveAccess,
      loading,
      isImpersonating,
      originalUser,
      refreshUserData,
      isSessionExpired,
      extendSession,
      handleSignOut,
      savedUsers,
      clearSavedUsers,
      loadSavedUsers,
    ],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      {userForPinSetup && (
        <PinSetupDialog
          user={userForPinSetup}
          isOpen={isPinSetupOpen}
          onOpenChange={setIsPinSetupOpen}
          onPinSet={loadSavedUsers}
        />
      )}
    </AuthContext.Provider>
  );
}

/* ---------- hook ---------- */

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
};
