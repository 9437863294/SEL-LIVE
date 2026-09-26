'use client';

/**
 * The Security card on the user's Profile page: a checklist, then password / PIN / two-factor,
 * sign-in details, sessions and login expiry. Self-contained — it loads everything it shows.
 *
 * Where each fact comes from, so nothing here claims more than it can see:
 *  - Sign-in methods, email verification, second factors and sign-in times come from Firebase Auth's
 *    live user. It is copied into state from `onIdTokenChanged` and copied again after every action
 *    here, because `user.reload()` updates the object in place without firing any auth event.
 *  - The PIN is the `savedUsers` record in this browser's localStorage — what `PinSetupDialog` writes
 *    and `SessionExpiryDialog` reads. It is read through `useSyncExternalStore` so the server render
 *    (no storage) and the first client render agree.
 *  - Sessions are the same `userSessions` query `/settings/session-management` already runs for a
 *    non-administrator (own active sessions only), read once rather than listened to.
 *  - The idle-timeout cap comes from `fetchSessionPolicy`, the read every user's session page makes.
 *
 * While an administrator is impersonating, Firebase is still signed in as the administrator, so every
 * action here would change *their* login. The actions are disabled and the card says so.
 */

import { useCallback, useEffect, useId, useState, useSyncExternalStore, type ReactNode } from 'react';
import Link from 'next/link';
import { format, formatDistanceToNow } from 'date-fns';
import { collection, getDocs, query, where } from 'firebase/firestore';
import {
  multiFactor,
  onIdTokenChanged,
  sendEmailVerification,
  type MultiFactorInfo,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  CircleAlert,
  CircleCheck,
  CircleMinus,
  ExternalLink,
  Info,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  Mail,
  Monitor,
  RefreshCw,
  Send,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Tablet,
  Timer,
  UserCog,
  type LucideIcon,
} from 'lucide-react';
import { auth, db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { ChangePasswordDialog } from '@/components/auth/ChangePasswordDialog';
import { MFASetupDialog } from '@/components/auth/MFASetupDialog';
import { PinSetupDialog } from '@/components/auth/PinSetupDialog';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import {
  fetchSessionPolicy,
  parseUserAgent,
  sessionControl,
  USER_SESSIONS_COLLECTION,
  type UserSession,
} from '@/lib/session-manager';
import { DEFAULT_IDLE_MINUTES, effectiveIdleMinutes, type SessionPolicy } from '@/lib/session-policy';
import type { SavedUser } from '@/lib/types';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

/* ───────────────────────────── constants ───────────────────────────── */

const SAVED_USERS_KEY = 'savedUsers';
const SESSION_ID_KEY = 'sessionId';
/** Firebase rate-limits verification mail; this keeps the button from inviting a `too-many-requests`. */
const VERIFY_COOLDOWN_SECONDS = 60;
const OTHER_SESSIONS_LISTED = 3;
const GOOGLE_SECURITY_URL = 'https://myaccount.google.com/security';

const PROVIDER_LABELS: Record<string, string> = {
  password: 'Email & password',
  'google.com': 'Google',
  'microsoft.com': 'Microsoft',
  'apple.com': 'Apple',
  'github.com': 'GitHub',
  'facebook.com': 'Facebook',
  'twitter.com': 'X (Twitter)',
  phone: 'Phone number',
};

const providerLabel = (providerId: string) => PROVIDER_LABELS[providerId] ?? providerId;

/* ─────────────────────────────── tones ─────────────────────────────── */

type Tone = 'good' | 'attention' | 'info' | 'off';

/** Every status pairs an icon with a word; the colour only reinforces it. */
const TONES: Record<Tone, { icon: LucideIcon; pill: string }> = {
  good: { icon: CircleCheck, pill: 'border-success/30 bg-success/10 text-success' },
  attention: { icon: CircleAlert, pill: 'border-warning/40 bg-warning/10 text-warning' },
  info: { icon: Info, pill: 'border-border bg-muted text-muted-foreground' },
  off: { icon: CircleMinus, pill: 'border-border bg-muted text-muted-foreground' },
};

function StatusPill({ tone, children }: { tone: Tone; children: ReactNode }) {
  const Icon = TONES[tone].icon;
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4',
        TONES[tone].pill,
      )}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      <span className="min-w-0 break-words">{children}</span>
    </span>
  );
}

/* ─────────────────────────────── helpers ───────────────────────────── */

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function tsToDate(ts: { seconds: number } | null | undefined): Date | null {
  return ts && typeof ts.seconds === 'number' ? new Date(ts.seconds * 1000) : null;
}

function errorCode(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return '';
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest === 0) return `${hours} hour${hours === 1 ? '' : 's'}`;
  return `${hours} hr ${rest} min`;
}

function relative(date: Date): string {
  return formatDistanceToNow(date, { addSuffix: true });
}

function deviceIcon(type: UserSession['deviceType'] | undefined): LucideIcon {
  if (type === 'Mobile') return Smartphone;
  if (type === 'Tablet') return Tablet;
  return Monitor;
}

function sessionPlace(session: UserSession): string {
  return [session.city, session.country].filter(Boolean).join(', ');
}

function describeThisSession(session: UserSession): string {
  const started = tsToDate(session.startedAt);
  const parts = [started ? `Signed in ${relative(started)}` : '', sessionPlace(session)].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Signed in on this browser';
}

/* ───────────────────────── Firebase Auth snapshot ───────────────────── */

interface FactorSummary {
  uid: string;
  kind: string;
  name: string | null;
  enrolledAt: Date | null;
}

interface SignInSnapshot {
  email: string | null;
  emailVerified: boolean;
  providers: string[];
  factors: FactorSummary[];
  createdAt: Date | null;
  lastSignInAt: Date | null;
}

function describeFactor(factor: MultiFactorInfo): FactorSummary {
  const kind =
    factor.factorId === 'totp' ? 'Authenticator app' : factor.factorId === 'phone' ? 'Text message' : 'Second factor';
  const name = factor.displayName?.trim() || null;
  return {
    uid: factor.uid,
    kind,
    name: name && name.toLowerCase() !== kind.toLowerCase() ? name : null,
    enrolledAt: toDate(factor.enrollmentTime),
  };
}

/** A plain copy of what the card shows, so a changed user is always a new value. */
function readSignIn(fbUser: FirebaseUser | null): SignInSnapshot | null {
  if (!fbUser) return null;
  let factors: FactorSummary[] = [];
  try {
    factors = multiFactor(fbUser).enrolledFactors.map(describeFactor);
  } catch {
    factors = [];
  }
  return {
    email: fbUser.email,
    emailVerified: fbUser.emailVerified,
    providers: Array.from(new Set(fbUser.providerData.map((p) => p.providerId).filter(Boolean))),
    factors,
    createdAt: toDate(fbUser.metadata.creationTime),
    lastSignInAt: toDate(fbUser.metadata.lastSignInTime),
  };
}

function useSignInSnapshot() {
  const [state, setState] = useState<{ ready: boolean; snapshot: SignInSnapshot | null }>({
    ready: false,
    snapshot: null,
  });

  useEffect(
    () => onIdTokenChanged(auth, (fbUser) => setState({ ready: true, snapshot: readSignIn(fbUser) })),
    [],
  );

  const refresh = useCallback(async (reloadFirst: boolean) => {
    const current = auth.currentUser;
    if (reloadFirst && current) {
      try {
        await current.reload();
      } catch (err) {
        console.warn('[SecurityCard] could not reload the signed-in user', err);
      }
    }
    setState({ ready: true, snapshot: readSignIn(auth.currentUser) });
  }, []);

  return { ...state, refresh };
}

/* ───────────────────────────── localStorage ─────────────────────────── */

function subscribeToStorage(onChange: () => void) {
  window.addEventListener('storage', onChange);
  return () => window.removeEventListener('storage', onChange);
}

function readStorage(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

/** `null` until the client has read storage (server render and hydration), then the stored string. */
function useStoredValue(key: string): string | null {
  return useSyncExternalStore<string | null>(
    subscribeToStorage,
    () => readStorage(key),
    () => null,
  );
}

type PinState = 'unknown' | 'set' | 'unset';

function readPinState(raw: string | null, ownerId: string | null): PinState {
  if (raw === null) return 'unknown';
  if (!raw || !ownerId) return 'unset';
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return 'unset';
    return (parsed as Partial<SavedUser>[]).some(
      (u) => u?.id === ownerId && typeof u.pin === 'string' && /^\d{4}$/.test(u.pin),
    )
      ? 'set'
      : 'unset';
  } catch {
    return 'unset';
  }
}

/* ─────────────────────────────── layout bits ───────────────────────── */

function SectionHeading({ id, icon: Icon, children }: { id: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <h3 id={id} className="flex items-center gap-2 text-sm font-semibold text-foreground">
      <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden />
      {children}
    </h3>
  );
}

function SettingRow({
  icon: Icon,
  title,
  status,
  children,
  actions,
}: {
  icon: LucideIcon;
  title: string;
  status?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
          aria-hidden
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h4 className="text-sm font-medium text-foreground">{title}</h4>
            {status}
          </div>
          <div className="space-y-1.5 text-xs text-muted-foreground">{children}</div>
        </div>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2 pl-12 sm:pl-0">{actions}</div> : null}
    </div>
  );
}

function FactorList({ factors }: { factors: FactorSummary[] }) {
  return (
    <ul className="space-y-0.5">
      {factors.map((factor) => (
        <li key={factor.uid} className="break-words text-foreground">
          {factor.kind}
          {factor.name ? ` “${factor.name}”` : ''}
          {factor.enrolledAt ? (
            <span className="text-muted-foreground"> · added {format(factor.enrolledAt, 'd MMM yyyy')}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function RowsSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-4" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

function CardShell({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <Card className={className}>
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 shrink-0 text-primary" aria-hidden />
          <CardTitle role="heading" aria-level={2} className="text-base">
            Security
          </CardTitle>
        </div>
        <CardDescription>Protect how you sign in: password, PIN, two-factor and where you’re signed in.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">{children}</CardContent>
    </Card>
  );
}

/* ──────────────────────────────── card ─────────────────────────────── */

interface SessionsState {
  userId: string;
  version: number;
  rows: UserSession[];
  error: boolean;
  /** This browser as the session manager labels it, for when its own record is missing. */
  deviceLabel: string;
}

interface ChecklistItem {
  key: string;
  label: string;
  tone: Tone;
  status: string;
  /** Counts toward "N of M". Informational rows and things this account cannot use do not. */
  counted: boolean;
  done: boolean;
}

export function SecurityCard({ className }: { className?: string }) {
  const { toast } = useToast();
  const { user, originalUser, isImpersonating, loadSavedUsers } = useAuth();
  const { can } = useAuthorization();

  const baseId = useId();
  const ids = {
    lockNote: `${baseId}-lock`,
    checklist: `${baseId}-checklist`,
    protection: `${baseId}-protection`,
    details: `${baseId}-details`,
    sessions: `${baseId}-sessions`,
    expiry: `${baseId}-expiry`,
  };

  const signIn = useSignInSnapshot();
  const account = signIn.snapshot;
  const refreshSignIn = signIn.refresh;

  const savedUsersRaw = useStoredValue(SAVED_USERS_KEY);
  const storedSessionId = useStoredValue(SESSION_ID_KEY);

  const userId = user?.id ?? null;
  // Impersonation keeps Firebase signed in as the administrator: their login is what the card sees.
  const locked = isImpersonating;
  const pinOwnerId = isImpersonating ? (originalUser?.id ?? null) : userId;
  const pinState = readPinState(savedUsersRaw, pinOwnerId);

  /* ── dialogs ── */
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [mfaSetupOpen, setMfaSetupOpen] = useState(false);
  const [mfaDisableOpen, setMfaDisableOpen] = useState(false);
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaError, setMfaError] = useState<string | null>(null);

  /* ── email verification ── */
  const [sendingVerification, setSendingVerification] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  const [checkingVerification, setCheckingVerification] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [clock, setClock] = useState(0);

  useEffect(() => {
    if (!cooldownUntil) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setClock(now);
      if (now >= cooldownUntil) setCooldownUntil(0);
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldownUntil]);

  const cooldownLeft = cooldownUntil ? Math.max(0, Math.ceil((cooldownUntil - clock) / 1000)) : 0;

  const startCooldown = () => {
    const now = Date.now();
    setClock(now);
    setCooldownUntil(now + VERIFY_COOLDOWN_SECONDS * 1000);
  };

  /* ── sessions ── */
  const [sessionsVersion, setSessionsVersion] = useState(0);
  const [sessions, setSessions] = useState<SessionsState | null>(null);
  const [confirmOthersOpen, setConfirmOthersOpen] = useState(false);
  const [signingOutOthers, setSigningOutOthers] = useState(false);

  useEffect(() => {
    if (!userId || isImpersonating) return;
    let cancelled = false;
    const version = sessionsVersion;
    const ownActive = query(
      collection(db, USER_SESSIONS_COLLECTION),
      where('isActive', '==', true),
      where('userId', '==', userId),
    );
    getDocs(ownActive)
      .then((snap) => {
        if (cancelled) return;
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as UserSession)
          .sort((a, b) => (b.lastActiveAt?.seconds ?? 0) - (a.lastActiveAt?.seconds ?? 0));
        setSessions({ userId, version, rows, error: false, deviceLabel: parseUserAgent(navigator.userAgent).deviceLabel });
      })
      .catch((err) => {
        console.warn('[SecurityCard] could not load sessions', err);
        if (cancelled) return;
        setSessions({ userId, version, rows: [], error: true, deviceLabel: parseUserAgent(navigator.userAgent).deviceLabel });
      });
    return () => {
      cancelled = true;
    };
  }, [userId, isImpersonating, sessionsVersion]);

  /* ── session policy (only for the idle-timeout cap) ── */
  const [policy, setPolicy] = useState<SessionPolicy | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetchSessionPolicy()
      .then((result) => {
        if (!cancelled) setPolicy(result.policy);
      })
      .catch((err) => console.warn('[SecurityCard] session policy unavailable', err));
    return () => {
      cancelled = true;
    };
  }, [userId]);

  /* ── actions ── */

  const openPinSetup = () => {
    // The dialog decides "verify the old PIN" vs "set a new one" from the saved users in context,
    // which nothing loads on a direct visit to this page. Load them first so a PIN can't be replaced
    // without the old one.
    loadSavedUsers();
    setPinOpen(true);
  };

  const disableMfa = async () => {
    const fbUser = auth.currentUser;
    if (!fbUser) return;
    setMfaBusy(true);
    setMfaError(null);
    try {
      const mf = multiFactor(fbUser);
      for (const factor of [...mf.enrolledFactors]) {
        await mf.unenroll(factor);
      }
      setMfaDisableOpen(false);
      toast({
        title: 'Two-factor authentication is off',
        description: 'Signing in now needs only your password or Google account.',
      });
    } catch (err) {
      const message =
        errorCode(err) === 'auth/requires-recent-login'
          ? 'For your protection, turning off two-factor needs a recent sign-in. Sign out, sign back in, then try again within a few minutes.'
          : errorCode(err) === 'auth/network-request-failed'
            ? 'You appear to be offline. Check your connection and try again.'
            : 'Two-factor authentication could not be turned off. Please try again.';
      console.error('[SecurityCard] MFA unenroll failed', err);
      setMfaError(message);
      setMfaDisableOpen(false);
      toast({ title: 'Two-factor is still on', description: message, variant: 'destructive' });
    } finally {
      setMfaBusy(false);
      await refreshSignIn(false);
    }
  };

  const sendVerification = async () => {
    const fbUser = auth.currentUser;
    if (!fbUser) return;
    setSendingVerification(true);
    try {
      await sendEmailVerification(fbUser);
      setVerificationSent(true);
      startCooldown();
      toast({
        title: 'Verification email sent',
        description: `Open the link sent to ${fbUser.email ?? 'your inbox'}, then choose “I’ve verified it”.`,
      });
    } catch (err) {
      const code = errorCode(err);
      if (code === 'auth/too-many-requests') startCooldown();
      toast({
        title: 'Could not send the email',
        description:
          code === 'auth/too-many-requests'
            ? 'Too many emails were requested. Wait a few minutes, then try again.'
            : code === 'auth/network-request-failed'
              ? 'You appear to be offline. Check your connection and try again.'
              : 'Something went wrong sending the verification email. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSendingVerification(false);
    }
  };

  const recheckVerification = async () => {
    setCheckingVerification(true);
    try {
      await refreshSignIn(true);
      const verified = auth.currentUser?.emailVerified ?? false;
      toast(
        verified
          ? { title: 'Email verified', description: 'Thanks — your email address is confirmed.' }
          : {
              title: 'Not verified yet',
              description: 'Open the link in the email first. It can take a minute to arrive — check spam too.',
            },
      );
    } finally {
      setCheckingVerification(false);
    }
  };

  const currentSessionId = storedSessionId || '';

  const signOutOthers = async () => {
    if (!currentSessionId) return;
    setSigningOutOthers(true);
    try {
      const result = await sessionControl({ action: 'terminate-others', currentSessionId });
      setPolicy(result.policy);
      setConfirmOthersOpen(false);
      toast({
        title: result.terminated ? 'Other devices signed out' : 'Nothing to sign out',
        description: result.terminated
          ? `${result.terminated} session${result.terminated === 1 ? '' : 's'} ended. This device stays signed in.`
          : 'Those sessions had already ended.',
      });
      setSessionsVersion((v) => v + 1);
    } catch (err) {
      toast({
        title: 'Could not sign out other devices',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSigningOutOthers(false);
    }
  };

  /* ── loading ── */

  if (!user) {
    return (
      <CardShell className={className}>
        <div role="status" aria-live="polite" className="space-y-6">
          <span className="sr-only">Loading security settings…</span>
          <Skeleton className="h-28 w-full rounded-lg" aria-hidden />
          <RowsSkeleton rows={3} />
        </div>
      </CardShell>
    );
  }

  /* ── derived ── */

  const accountReady = signIn.ready && pinState !== 'unknown';
  const providers = account?.providers ?? [];
  const hasPassword = providers.includes('password');
  const hasGoogle = providers.includes('google.com');
  const providerSummary = providers.length ? providers.map(providerLabel).join(' + ') : 'Unknown';
  const factors = account?.factors ?? [];
  const mfaOn = factors.length > 0;
  const pinAvailable = hasPassword;

  const checklist: ChecklistItem[] = account
    ? [
        {
          key: 'mfa',
          label: 'Two-factor authentication',
          tone: mfaOn ? 'good' : 'attention',
          status: mfaOn ? 'On' : 'Off',
          counted: true,
          done: mfaOn,
        },
        {
          key: 'email',
          label: 'Email address verified',
          tone: account.emailVerified ? 'good' : 'attention',
          status: account.emailVerified ? 'Verified' : 'Not verified',
          counted: true,
          done: account.emailVerified,
        },
        pinAvailable
          ? {
              key: 'pin',
              label: 'PIN on this device',
              tone: pinState === 'set' ? 'good' : 'off',
              status: pinState === 'set' ? 'Set' : 'Not set',
              counted: true,
              done: pinState === 'set',
            }
          : {
              key: 'pin',
              label: 'PIN on this device',
              tone: 'off',
              status: 'Not available',
              counted: false,
              done: false,
            },
        {
          key: 'method',
          label: 'Sign-in method',
          tone: 'info',
          status: providerSummary,
          counted: false,
          done: false,
        },
      ]
    : [];
  const countedItems = checklist.filter((item) => item.counted);
  const doneCount = countedItems.filter((item) => item.done).length;
  const allDone = countedItems.length > 0 && doneCount === countedItems.length;
  const SummaryIcon = allDone ? ShieldCheck : ShieldAlert;

  const lockedProps = locked ? { 'aria-describedby': ids.lockNote } : {};

  const preferenceMinutes =
    user.theme?.sessionDuration && user.theme.sessionDuration > 0 ? user.theme.sessionDuration : DEFAULT_IDLE_MINUTES;
  const appliedMinutes = policy ? effectiveIdleMinutes(preferenceMinutes, policy) : preferenceMinutes;
  const cappedByPolicy = appliedMinutes < preferenceMinutes;
  const canOpenLoginExpiry = can('View', 'Settings.Login Expiry');

  const sessionsForUser = sessions && sessions.userId === userId ? sessions : null;
  const sessionsRefreshing = !!sessionsForUser && sessionsForUser.version !== sessionsVersion;
  const thisSession = sessionsForUser?.rows.find((s) => s.id === currentSessionId) ?? null;
  const otherSessions = sessionsForUser?.rows.filter((s) => s.id !== currentSessionId) ?? [];
  const ThisDeviceIcon = deviceIcon(thisSession?.deviceType);

  const viewedName = user.name || 'this user';
  const adminName = originalUser?.name || 'yourself';

  return (
    <CardShell className={className}>
      {/* ── Impersonation notice ── */}
      {locked && (
        <div id={ids.lockNote} role="note" className="flex gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3">
          <UserCog className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          <div className="min-w-0 space-y-1 text-sm">
            <p className="font-medium text-foreground">Security actions are off while you view this profile as {viewedName}.</p>
            <p className="text-xs text-muted-foreground">
              You are still signed in as {adminName}, so a password, PIN, two-factor or session change made here
              would apply to your own administrator login, not to {viewedName}’s. The sign-in details below are
              yours for the same reason.
            </p>
          </div>
        </div>
      )}

      {/* ── Checklist ── */}
      <section
        aria-labelledby={ids.checklist}
        aria-busy={!accountReady}
        className="rounded-lg border bg-muted/40 p-3 sm:p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={ids.checklist} className="text-sm font-semibold text-foreground">
            Security checklist
          </h3>
          {accountReady && countedItems.length > 0 && (
            <p className={cn('inline-flex items-center gap-1.5 text-xs font-medium', allDone ? 'text-success' : 'text-warning')}>
              <SummaryIcon className="h-4 w-4 shrink-0" aria-hidden />
              {doneCount} of {countedItems.length} done
            </p>
          )}
        </div>
        {!accountReady ? (
          <div className="mt-3 space-y-2.5" role="status">
            <span className="sr-only">Checking your security settings…</span>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-5 w-full" aria-hidden />
            ))}
          </div>
        ) : !account ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Your sign-in details aren’t available right now. Reload the page to try again.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {checklist.map((item) => (
              <li key={item.key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
                <span className="min-w-0 text-foreground">{item.label}</span>
                <StatusPill tone={item.tone}>{item.status}</StatusPill>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Password, PIN, two-factor ── */}
      <section aria-labelledby={ids.protection} className="space-y-3">
        <SectionHeading id={ids.protection} icon={Lock}>
          Sign-in protection
        </SectionHeading>
        {!accountReady ? (
          <RowsSkeleton rows={3} />
        ) : (
          <div className="divide-y rounded-lg border px-3 py-4 sm:px-4">
            {/* Password */}
            <SettingRow
              icon={Lock}
              title="Password"
              status={hasPassword ? undefined : <StatusPill tone="info">Not used</StatusPill>}
              actions={
                hasPassword ? (
                  <Button size="sm" variant="outline" onClick={() => setPasswordOpen(true)} disabled={locked} {...lockedProps}>
                    Change password
                  </Button>
                ) : undefined
              }
            >
              {hasPassword ? (
                <p>Change the password you use with your email address. You’ll need your current one.</p>
              ) : (
                <>
                  <p>This account signs in with {providerSummary}, so there is no password to change here.</p>
                  {hasGoogle && (
                    <p>
                      <a
                        href={GOOGLE_SECURITY_URL}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 rounded-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      >
                        Manage your Google account security
                        <ExternalLink className="h-3 w-3" aria-hidden />
                        <span className="sr-only">(opens in a new tab)</span>
                      </a>
                    </p>
                  )}
                </>
              )}
            </SettingRow>

            {/* PIN */}
            <SettingRow
              icon={KeyRound}
              title="PIN"
              status={
                !pinAvailable ? (
                  <StatusPill tone="off">Not available</StatusPill>
                ) : pinState === 'set' ? (
                  <StatusPill tone="good">Set on this device</StatusPill>
                ) : (
                  <StatusPill tone="off">Not set</StatusPill>
                )
              }
              actions={
                pinAvailable ? (
                  <Button size="sm" variant="outline" onClick={openPinSetup} disabled={locked} {...lockedProps}>
                    {pinState === 'set' ? 'Change PIN' : 'Set up PIN'}
                  </Button>
                ) : undefined
              }
            >
              {pinAvailable ? (
                <>
                  <p>A 4-digit PIN lets you carry on quickly on this device when your session is about to expire.</p>
                  <p>It is saved in this browser only, together with your sign-in — set one only on a device you don’t share.</p>
                </>
              ) : (
                <p>
                  PIN unlock signs you back in with your email and password, so it isn’t available for an account that
                  signs in with {providerSummary} only.
                </p>
              )}
            </SettingRow>

            {/* Two-factor */}
            <SettingRow
              icon={mfaOn ? ShieldCheck : ShieldAlert}
              title="Two-factor authentication"
              status={mfaOn ? <StatusPill tone="good">On</StatusPill> : <StatusPill tone="attention">Off</StatusPill>}
              actions={
                mfaOn ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-danger hover:bg-danger/10 hover:text-danger"
                    onClick={() => {
                      setMfaError(null);
                      setMfaDisableOpen(true);
                    }}
                    disabled={locked || mfaBusy}
                    {...lockedProps}
                  >
                    {mfaBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
                    Turn off
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => {
                      setMfaError(null);
                      setMfaSetupOpen(true);
                    }}
                    disabled={locked}
                    {...lockedProps}
                  >
                    Turn on
                  </Button>
                )
              }
            >
              {mfaOn ? (
                <>
                  <p>Signing in also asks for a 6-digit code from your authenticator app.</p>
                  <FactorList factors={factors} />
                </>
              ) : (
                <p>Add a second step to signing in: a 6-digit code from an authenticator app on your phone.</p>
              )}
              {mfaError && (
                <p role="alert" className="flex items-start gap-1.5 font-medium text-danger">
                  <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>{mfaError}</span>
                </p>
              )}
            </SettingRow>
          </div>
        )}
      </section>

      {/* ── Sign-in details ── */}
      <section aria-labelledby={ids.details} aria-busy={!signIn.ready} className="space-y-3">
        <SectionHeading id={ids.details} icon={Mail}>
          Sign-in details
        </SectionHeading>
        {!signIn.ready ? (
          <RowsSkeleton rows={2} />
        ) : !account ? (
          <p className="text-xs text-muted-foreground">Sign-in details aren’t available right now.</p>
        ) : (
          <dl className="grid grid-cols-1 gap-4 rounded-lg border p-3 sm:grid-cols-2 sm:p-4">
            <div className="min-w-0 space-y-1">
              <dt className="text-xs text-muted-foreground">Sign-in methods</dt>
              <dd className="flex flex-wrap gap-1.5">
                {providers.length ? (
                  providers.map((p) => (
                    <span key={p} className="rounded-md border bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
                      {providerLabel(p)}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-muted-foreground">Unknown</span>
                )}
              </dd>
            </div>

            <div className="min-w-0 space-y-1">
              <dt className="text-xs text-muted-foreground">Email</dt>
              <dd className="space-y-2">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="min-w-0 break-all text-sm text-foreground">{account.email ?? '—'}</span>
                  {account.emailVerified ? (
                    <StatusPill tone="good">Verified</StatusPill>
                  ) : (
                    <StatusPill tone="attention">Not verified</StatusPill>
                  )}
                </div>
                {!account.emailVerified && account.email && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={sendVerification}
                      disabled={locked || sendingVerification || cooldownLeft > 0}
                      {...lockedProps}
                    >
                      {sendingVerification ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                      ) : (
                        <Send className="mr-2 h-4 w-4" aria-hidden />
                      )}
                      {cooldownLeft > 0
                        ? `Resend in ${cooldownLeft}s`
                        : verificationSent
                          ? 'Resend email'
                          : 'Send verification email'}
                    </Button>
                    {verificationSent && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={recheckVerification}
                        disabled={locked || checkingVerification}
                        {...lockedProps}
                      >
                        {checkingVerification ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                        ) : (
                          <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
                        )}
                        I’ve verified it
                      </Button>
                    )}
                  </div>
                )}
              </dd>
            </div>

            <div className="min-w-0 space-y-1">
              <dt className="text-xs text-muted-foreground">Account created</dt>
              <dd className="text-sm text-foreground">
                {account.createdAt ? format(account.createdAt, 'd MMM yyyy') : '—'}
              </dd>
            </div>

            <div className="min-w-0 space-y-1">
              <dt className="text-xs text-muted-foreground">Last sign-in</dt>
              <dd className="text-sm text-foreground">
                {account.lastSignInAt ? (
                  <>
                    {format(account.lastSignInAt, 'd MMM yyyy, h:mm a')}
                    <span className="text-muted-foreground"> ({relative(account.lastSignInAt)})</span>
                  </>
                ) : (
                  '—'
                )}
              </dd>
            </div>
          </dl>
        )}
      </section>

      {/* ── Sessions ── */}
      <section
        aria-labelledby={ids.sessions}
        aria-busy={!locked && (!sessionsForUser || sessionsRefreshing)}
        className="space-y-3"
      >
        <SectionHeading id={ids.sessions} icon={Monitor}>
          Sessions
        </SectionHeading>
        <div className="space-y-3 rounded-lg border p-3 sm:p-4">
          {locked ? (
            <p className="text-xs text-muted-foreground">
              Session details are hidden while you view another user’s profile.
            </p>
          ) : !sessionsForUser ? (
            <RowsSkeleton rows={2} />
          ) : sessionsForUser.error ? (
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
              <span>Your sessions couldn’t be loaded. You can still review them on the Sessions page.</span>
            </p>
          ) : (
            <>
              <div className="flex min-w-0 items-start gap-3">
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
                  aria-hidden
                >
                  <ThisDeviceIcon className="h-4 w-4" />
                </span>
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <h4 className="text-sm font-medium text-foreground">
                      {thisSession?.deviceLabel || sessionsForUser.deviceLabel}
                    </h4>
                    <StatusPill tone="info">This device</StatusPill>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {thisSession ? describeThisSession(thisSession) : 'This browser’s session record wasn’t found.'}
                  </p>
                </div>
              </div>

              <div className="space-y-1.5 border-t pt-3">
                <p className="text-sm text-foreground">
                  {otherSessions.length === 0
                    ? 'No other active sessions.'
                    : `${otherSessions.length} other active session${otherSessions.length === 1 ? '' : 's'}`}
                  {sessionsRefreshing && (
                    <Loader2 className="ml-2 inline h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />
                  )}
                </p>
                {otherSessions.length > 0 && (
                  <ul className="space-y-1">
                    {otherSessions.slice(0, OTHER_SESSIONS_LISTED).map((s) => {
                      const Icon = deviceIcon(s.deviceType);
                      const lastActive = tsToDate(s.lastActiveAt);
                      return (
                        <li key={s.id} className="flex min-w-0 items-start gap-2 text-xs text-muted-foreground">
                          <Icon className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                          <span className="min-w-0 break-words">
                            <span className="text-foreground">{s.deviceLabel || 'Unknown device'}</span>
                            {lastActive ? ` · active ${relative(lastActive)}` : ''}
                            {sessionPlace(s) ? ` · ${sessionPlace(s)}` : ''}
                          </span>
                        </li>
                      );
                    })}
                    {otherSessions.length > OTHER_SESSIONS_LISTED && (
                      <li className="pl-5 text-xs text-muted-foreground">
                        and {otherSessions.length - OTHER_SESSIONS_LISTED} more
                      </li>
                    )}
                  </ul>
                )}
              </div>
            </>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            {!locked && otherSessions.length > 0 && currentSessionId && (
              <Button
                size="sm"
                variant="outline"
                className="text-danger hover:bg-danger/10 hover:text-danger"
                onClick={() => setConfirmOthersOpen(true)}
                disabled={signingOutOthers}
              >
                <LogOut className="mr-2 h-4 w-4" aria-hidden />
                Sign out other devices
              </Button>
            )}
            <Button asChild size="sm" variant="outline">
              <Link href="/settings/session-management">Manage sessions</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ── Login expiry ── */}
      <section aria-labelledby={ids.expiry} className="space-y-3">
        <SectionHeading id={ids.expiry} icon={Timer}>
          Login expiry
        </SectionHeading>
        <div className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
          <div className="min-w-0 space-y-1">
            <p className="text-sm text-foreground">
              You’re signed out after <span className="font-medium">{formatMinutes(appliedMinutes)}</span> without
              activity.
            </p>
            {cappedByPolicy && (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>
                  Your setting is {formatMinutes(preferenceMinutes)}, but your organisation’s session policy limits it
                  to {formatMinutes(appliedMinutes)}.
                </span>
              </p>
            )}
          </div>
          {canOpenLoginExpiry && (
            <Button asChild size="sm" variant="outline" className="self-start sm:self-auto">
              <Link href="/settings/login-expiry">Change login expiry</Link>
            </Button>
          )}
        </div>
      </section>

      {/* ── Dialogs ── */}
      <ChangePasswordDialog isOpen={passwordOpen} onOpenChange={setPasswordOpen} />
      <PinSetupDialog user={user} isOpen={pinOpen} onOpenChange={setPinOpen} onPinSet={loadSavedUsers} />
      <MFASetupDialog
        open={mfaSetupOpen}
        onOpenChange={setMfaSetupOpen}
        onEnrolled={() => {
          setMfaError(null);
          void refreshSignIn(true);
        }}
      />

      <AlertDialog
        open={mfaDisableOpen}
        onOpenChange={(open) => {
          if (!mfaBusy) setMfaDisableOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn off two-factor authentication?</AlertDialogTitle>
            <AlertDialogDescription>
              Signing in will need only your password or Google account, so anyone who learns your password could get
              in. You can turn two-factor back on at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {factors.length > 0 && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <p className="mb-1 text-xs text-muted-foreground">This removes:</p>
              <FactorList factors={factors} />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mfaBusy}>Keep it on</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              disabled={mfaBusy}
              onClick={(event) => {
                // Stay open until Firebase answers; the handler closes it.
                event.preventDefault();
                void disableMfa();
              }}
            >
              {mfaBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              Turn off
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmOthersOpen}
        onOpenChange={(open) => {
          if (!signingOutOthers) setConfirmOthersOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out your other devices?</AlertDialogTitle>
            <AlertDialogDescription>
              {otherSessions.length === 1
                ? 'Your 1 other session will end'
                : `Your ${otherSessions.length} other sessions will end`}{' '}
              and those devices will have to sign in again. This device stays signed in.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={signingOutOthers}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              disabled={signingOutOthers}
              onClick={(event) => {
                event.preventDefault();
                void signOutOthers();
              }}
            >
              {signingOutOthers && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              Sign out other devices
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CardShell>
  );
}
