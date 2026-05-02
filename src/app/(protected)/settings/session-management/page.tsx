'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Globe,
  History,
  Laptop,
  LogOut,
  MapPin,
  Monitor,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  Smartphone,
  Tablet,
  Users,
  Wifi,
  X,
} from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import {
  terminateSession,
  USER_SESSIONS_COLLECTION,
  type UserSession,
} from '@/lib/session-manager';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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

// ─── pure helpers ────────────────────────────────────────────────────────────

function timeAgo(ts: { seconds: number } | null | undefined): string {
  if (!ts) return '—';
  const diffMs = Date.now() - ts.seconds * 1000;
  const mins = Math.floor(diffMs / 60_000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ${mins % 60}m ago`;
  if (mins > 0) return `${mins}m ago`;
  return 'Just now';
}

function localDateTime(ts: { seconds: number } | null | undefined): string {
  if (!ts) return '—';
  return new Date(ts.seconds * 1000).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function sessionDuration(
  start: { seconds: number } | null | undefined,
  end: { seconds: number } | null | undefined,
  active: boolean
): string {
  if (!start) return '—';
  const endSec = active ? Date.now() / 1000 : (end?.seconds ?? start.seconds);
  const totalMins = Math.floor((endSec - start.seconds) / 60);
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${totalMins}m`;
}

function countryFlag(code: string): string {
  if (!code || code.length !== 2) return '';
  const A = 0x1f1e6;
  return (
    String.fromCodePoint(A + code.toUpperCase().charCodeAt(0) - 65) +
    String.fromCodePoint(A + code.toUpperCase().charCodeAt(1) - 65)
  );
}

function getInitials(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const AVATAR_PALETTE = [
  'from-rose-500 to-pink-600',
  'from-orange-500 to-amber-600',
  'from-yellow-500 to-lime-500',
  'from-emerald-500 to-teal-600',
  'from-cyan-500 to-sky-600',
  'from-blue-500 to-indigo-600',
  'from-violet-500 to-purple-600',
  'from-fuchsia-500 to-rose-600',
];

function avatarGradient(name: string): string {
  const code = (name || 'X').charCodeAt(0);
  return AVATAR_PALETTE[code % AVATAR_PALETTE.length];
}

function DeviceIcon({ type, size = 'md' }: { type: string; size?: 'sm' | 'md' }) {
  const cls = size === 'sm' ? 'h-3.5 w-3.5' : 'h-5 w-5';
  if (type === 'Mobile') return <Smartphone className={cls} />;
  if (type === 'Tablet') return <Tablet className={cls} />;
  return <Monitor className={cls} />;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      onClick={copy}
      title="Copy"
      className="ml-1 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
    >
      {copied ? <CheckCircle2 className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

// ─── card component ──────────────────────────────────────────────────────────

function SessionCard({
  session,
  isCurrent,
  isAdmin,
  currentUserId,
  canTerminate,
  onTerminate,
}: {
  session: UserSession;
  isCurrent: boolean;
  isAdmin: boolean;
  currentUserId: string;
  canTerminate: boolean;
  onTerminate: (s: UserSession) => void;
}) {
  const isOwnSession = session.userId === currentUserId;
  const isActive = session.isActive;

  const locationParts = [session.city, session.region, session.country].filter(Boolean);
  const locationStr = locationParts.join(', ');
  const flag = countryFlag(session.countryCode ?? '');

  const mapsUrl =
    session.lat && session.lon
      ? `https://www.google.com/maps?q=${session.lat},${session.lon}`
      : null;

  const canAct = isActive && !isCurrent && (canTerminate || isOwnSession);

  return (
    <Card
      className={cn(
        'overflow-hidden transition-all duration-200',
        isCurrent && 'ring-2 ring-indigo-400 ring-offset-2',
        !isActive && 'opacity-75'
      )}
    >
      {/* Top accent bar */}
      <div
        className={cn(
          'h-1 w-full',
          isActive
            ? isCurrent
              ? 'bg-gradient-to-r from-indigo-500 to-blue-500'
              : 'bg-gradient-to-r from-emerald-400 to-teal-500'
            : 'bg-gradient-to-r from-slate-300 to-slate-400'
        )}
      />

      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">

          {/* ── Left column: identity ──────────────────────────────────── */}
          <div className="flex items-start gap-3 sm:min-w-[200px]">
            {/* Avatar */}
            <div
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-sm font-bold text-white shadow-sm',
                avatarGradient(session.userName)
              )}
            >
              {getInitials(session.userName)}
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold text-sm leading-tight">
                  {session.userName || 'Unknown User'}
                </span>
                {isCurrent && (
                  <Badge className="bg-indigo-100 text-indigo-700 border-indigo-200 text-[10px] font-semibold px-1.5 py-0">
                    This device
                  </Badge>
                )}
                <Badge
                  variant={isActive ? 'default' : 'outline'}
                  className={cn(
                    'text-[10px] font-semibold px-1.5 py-0',
                    isActive ? 'bg-emerald-500 text-white border-0' : 'text-slate-500'
                  )}
                >
                  {isActive ? '● Active' : session.terminatedBy === 'admin' ? 'Terminated' : 'Signed out'}
                </Badge>
              </div>

              {/* Show email + role only in admin view for other users, or always for own */}
              {(isAdmin || isOwnSession) && (
                <p className="mt-0.5 text-xs text-muted-foreground truncate">
                  {session.userEmail}
                </p>
              )}
              {session.userRole && (
                <Badge variant="outline" className="mt-1 text-[10px] py-0 text-slate-500">
                  {session.userRole}
                </Badge>
              )}
            </div>
          </div>

          {/* ── Centre column: device + location ──────────────────────── */}
          <div className="flex-1 space-y-2.5 min-w-0">
            {/* Device */}
            <div className="flex items-center gap-2 text-sm">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                <DeviceIcon type={session.deviceType} size="sm" />
              </div>
              <span className="font-medium text-slate-700">{session.deviceLabel}</span>
            </div>

            {/* Location & IP — always shown for own sessions; admin-gated for others */}
            {(isAdmin || isOwnSession) && (
              <>
                {/* IP Address */}
                {session.ipAddress && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Wifi className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="font-mono font-medium text-slate-600">{session.ipAddress}</span>
                    <CopyButton text={session.ipAddress} />
                  </div>
                )}

                {/* Location */}
                {locationStr && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span>
                      {flag && <span className="mr-1">{flag}</span>}
                      {locationStr}
                    </span>
                    {mapsUrl && (
                      <a
                        href={mapsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-0.5 inline-flex items-center gap-0.5 text-cyan-600 hover:text-cyan-700 hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Map
                      </a>
                    )}
                  </div>
                )}

                {/* ISP */}
                {session.isp && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Building2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="truncate">{session.isp}</span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* ── Right column: times + action ──────────────────────────── */}
          <div className="flex flex-row flex-wrap items-end justify-between gap-3 sm:flex-col sm:items-end sm:justify-start">
            <div className="space-y-1 text-right">
              <div className="flex items-center gap-1.5 justify-end text-xs text-muted-foreground">
                <Laptop className="h-3 w-3 shrink-0" />
                <span>Started {timeAgo(session.startedAt)}</span>
              </div>
              <div className="flex items-center gap-1.5 justify-end text-xs text-muted-foreground">
                <Clock className="h-3 w-3 shrink-0" />
                <span>
                  {isActive
                    ? `Active ${timeAgo(session.lastActiveAt)}`
                    : `Ended ${timeAgo(session.terminatedAt)}`}
                </span>
              </div>
              <div className="text-[11px] text-slate-400 text-right">
                Duration: {sessionDuration(session.startedAt, session.terminatedAt, isActive)}
              </div>
              {!isActive && session.terminatedByUserName && (
                <div className="flex items-center gap-1 justify-end text-[11px] text-rose-500">
                  <AlertTriangle className="h-3 w-3" />
                  By {session.terminatedByUserName}
                </div>
              )}
            </div>

            {canAct && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onTerminate(session)}
                className="h-8 shrink-0 border-rose-200 bg-rose-50/50 text-rose-600 hover:bg-rose-50 hover:border-rose-300 hover:text-rose-700 gap-1.5 text-xs"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign Out
              </Button>
            )}
          </div>
        </div>

        {/* Terminated-at full timestamp (history only) */}
        {!isActive && session.terminatedAt && (
          <div className="mt-3 flex items-center gap-1.5 rounded-lg border border-slate-100 bg-slate-50 px-3 py-1.5 text-xs text-muted-foreground">
            <History className="h-3 w-3 shrink-0" />
            Ended: {localDateTime(session.terminatedAt)}
            {session.terminatedBy && (
              <Badge variant="outline" className="ml-auto text-[10px] py-0 capitalize">
                {session.terminatedBy}
              </Badge>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── page ────────────────────────────────────────────────────────────────────

type Tab = 'active' | 'history';

export default function SessionManagementPage() {
  const { user } = useAuth();
  const { can } = useAuthorization();
  const { toast } = useToast();

  const isAdmin = can('View', 'Settings.Session Management');
  const canTerminate = can('Delete', 'Settings.Session Management') || isAdmin;

  const [tab, setTab] = useState<Tab>('active');
  const [activeSessions, setActiveSessions] = useState<UserSession[]>([]);
  const [historySessions, setHistorySessions] = useState<UserSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [confirmSession, setConfirmSession] = useState<UserSession | null>(null);
  const [isTerminating, setIsTerminating] = useState(false);

  const currentSessionId = typeof window !== 'undefined' ? (localStorage.getItem('sessionId') ?? '') : '';
  const activeUnsubRef = useRef<(() => void) | null>(null);
  const historyUnsubRef = useRef<(() => void) | null>(null);
  const initialLoadDoneRef = useRef(false);

  // ─── realtime listeners ────────────────────────────────────────────────────

  const setupListeners = useCallback(() => {
    if (!user) return;
    // Only show the full-page skeleton on the very first load;
    // subsequent calls (Refresh button, Firestore-triggered re-runs) update
    // the data in place without flashing a loading state.
    if (!initialLoadDoneRef.current) setIsLoading(true);

    activeUnsubRef.current?.();
    const activeQ = isAdmin
      ? query(collection(db, USER_SESSIONS_COLLECTION), where('isActive', '==', true))
      : query(collection(db, USER_SESSIONS_COLLECTION), where('isActive', '==', true), where('userId', '==', user.id));

    activeUnsubRef.current = onSnapshot(
      activeQ,
      (snap) => {
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as UserSession))
          .sort((a, b) => (b.lastActiveAt?.seconds ?? 0) - (a.lastActiveAt?.seconds ?? 0));
        setActiveSessions(rows);
        initialLoadDoneRef.current = true;
        setIsLoading(false);
      },
      (err) => { console.error('Active sessions error', err); initialLoadDoneRef.current = true; setIsLoading(false); }
    );

    historyUnsubRef.current?.();
    const historyQ = isAdmin
      ? query(collection(db, USER_SESSIONS_COLLECTION), where('isActive', '==', false), orderBy('terminatedAt', 'desc'), limit(60))
      : query(collection(db, USER_SESSIONS_COLLECTION), where('isActive', '==', false), where('userId', '==', user.id), orderBy('terminatedAt', 'desc'), limit(60));

    historyUnsubRef.current = onSnapshot(
      historyQ,
      (snap) => setHistorySessions(snap.docs.map((d) => ({ id: d.id, ...d.data() } as UserSession))),
      (err) => console.error('Session history error', err)
    );
  }, [user, isAdmin]);

  useEffect(() => {
    setupListeners();
    return () => { activeUnsubRef.current?.(); historyUnsubRef.current?.(); };
  }, [setupListeners]);

  // ─── terminate ────────────────────────────────────────────────────────────

  const handleTerminate = async () => {
    if (!confirmSession || !user) return;
    setIsTerminating(true);
    try {
      await terminateSession(confirmSession.id, 'admin', user.id, user.name);
      toast({
        title: 'Session signed out',
        description: `${confirmSession.userName || confirmSession.userEmail} has been signed out from ${confirmSession.deviceLabel}.`,
      });
    } catch {
      toast({ title: 'Error', description: 'Failed to terminate session.', variant: 'destructive' });
    } finally {
      setIsTerminating(false);
      setConfirmSession(null);
    }
  };

  // ─── derived data ──────────────────────────────────────────────────────────

  const displayRows = useMemo(() => {
    const rows = tab === 'active' ? activeSessions : historySessions;
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(
      (s) =>
        s.userName.toLowerCase().includes(q) ||
        s.userEmail.toLowerCase().includes(q) ||
        s.deviceLabel.toLowerCase().includes(q) ||
        (s.ipAddress ?? '').includes(q) ||
        (s.city ?? '').toLowerCase().includes(q) ||
        (s.country ?? '').toLowerCase().includes(q) ||
        (s.isp ?? '').toLowerCase().includes(q)
    );
  }, [tab, activeSessions, historySessions, search]);

  const summary = useMemo(() => {
    const uniqueUsers = new Set(activeSessions.map((s) => s.userId)).size;
    const desktopCount = activeSessions.filter((s) => s.deviceType === 'Desktop').length;
    const mobileCount = activeSessions.filter((s) => s.deviceType !== 'Desktop').length;
    return { active: activeSessions.length, uniqueUsers, desktopCount, mobileCount };
  }, [activeSessions]);

  if (!user) return null;

  return (
    <div className="space-y-5 p-4 md:p-6">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <div className="h-1 w-full bg-gradient-to-r from-indigo-500 via-blue-500 to-cyan-500" />
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3">
            <div className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl shadow-sm',
              isAdmin ? 'bg-gradient-to-br from-indigo-500 to-blue-600' : 'bg-indigo-50'
            )}>
              {isAdmin
                ? <ShieldAlert className="h-5 w-5 text-white" />
                : <Shield className="h-5 w-5 text-indigo-600" />}
            </div>
            <div>
              <CardTitle className="text-lg tracking-tight">Session Management</CardTitle>
              <CardDescription>
                {isAdmin
                  ? 'Full visibility into all active sessions — IP addresses, locations and device info across every user.'
                  : 'View and manage your own active login sessions across all devices.'}
              </CardDescription>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={setupListeners} className="w-fit gap-1.5 bg-white self-start">
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </CardHeader>

        {/* Stats */}
        <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            {
              label: 'Active Sessions',
              value: isLoading ? '—' : String(summary.active),
              icon: <Globe className="h-4 w-4" />,
              color: 'text-indigo-600',
              bg: 'bg-indigo-50',
            },
            {
              label: 'Users Online',
              value: isLoading ? '—' : String(summary.uniqueUsers),
              icon: <Users className="h-4 w-4" />,
              color: 'text-emerald-600',
              bg: 'bg-emerald-50',
              adminOnly: true,
            },
            {
              label: 'Desktop',
              value: isLoading ? '—' : String(summary.desktopCount),
              icon: <Monitor className="h-4 w-4" />,
              color: 'text-blue-600',
              bg: 'bg-blue-50',
            },
            {
              label: 'Mobile / Tablet',
              value: isLoading ? '—' : String(summary.mobileCount),
              icon: <Smartphone className="h-4 w-4" />,
              color: 'text-cyan-600',
              bg: 'bg-cyan-50',
            },
          ]
            .filter((s) => !s.adminOnly || isAdmin)
            .map((stat) => (
              <div key={stat.label} className="flex items-center gap-3 rounded-xl border bg-white/80 px-3 py-3">
                <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', stat.bg, stat.color)}>
                  {stat.icon}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                  <p className={cn('text-xl font-bold leading-tight', stat.color)}>{stat.value}</p>
                </div>
              </div>
            ))}
        </CardContent>
      </Card>

      {/* ── Tab + Search bar ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-xl border bg-white/70 p-1 shadow-sm">
          {(['active', 'history'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all',
                tab === t
                  ? 'bg-white shadow-sm text-indigo-700'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t === 'active' ? (
                <><Globe className="h-3.5 w-3.5" /> Active{!isLoading && ` (${activeSessions.length})`}</>
              ) : (
                <><History className="h-3.5 w-3.5" /> History{!isLoading && ` (${historySessions.length})`}</>
              )}
            </button>
          ))}
        </div>

        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={isAdmin ? 'Search user, IP, location, device…' : 'Search device, location…'}
            className="pl-8 bg-white/85 h-9 text-sm"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {search && (
          <span className="text-xs text-muted-foreground">
            {displayRows.length} result{displayRows.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Admin info banner */}
      {isAdmin && tab === 'active' && !isLoading && activeSessions.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-xs text-indigo-700">
          <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            As an administrator you can see IP addresses, geographic locations, and network providers for all sessions.
            Use "Sign Out" to immediately terminate any active session.
          </span>
        </div>
      )}

      {/* ── Session list ────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-36 w-full rounded-xl" />)}
        </div>
      ) : displayRows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-20 text-center">
            {tab === 'active'
              ? <Globe className="h-12 w-12 text-muted-foreground/30" />
              : <History className="h-12 w-12 text-muted-foreground/30" />}
            <p className="text-sm font-medium text-slate-600">
              {tab === 'active' ? 'No active sessions' : 'No session history'}
            </p>
            <p className="text-xs text-muted-foreground">
              {tab === 'active'
                ? 'There are currently no active login sessions.'
                : 'Terminated sessions will appear here.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {displayRows.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              isCurrent={session.id === currentSessionId}
              isAdmin={isAdmin}
              currentUserId={user.id}
              canTerminate={canTerminate}
              onTerminate={setConfirmSession}
            />
          ))}
        </div>
      )}

      {/* ── Confirm terminate dialog ─────────────────────────────────── */}
      <AlertDialog open={!!confirmSession} onOpenChange={(open) => { if (!open) setConfirmSession(null); }}>
        <AlertDialogContent className="max-w-md overflow-hidden p-0">
          <div className="h-1 w-full bg-gradient-to-r from-rose-500 to-red-600" />
          <div className="px-6 pb-2 pt-5">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2 text-base">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rose-100">
                  <LogOut className="h-4 w-4 text-rose-600" />
                </div>
                Sign Out Session
              </AlertDialogTitle>
              <AlertDialogDescription className="mt-3 space-y-3 text-sm">
                <span className="block text-slate-600">
                  This will immediately end the session on the target device. The user will be signed out and
                  must log in again.
                </span>
                {confirmSession && (
                  <div className="rounded-xl border border-rose-100 bg-rose-50 p-3 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white bg-gradient-to-br', avatarGradient(confirmSession.userName))}>
                        {getInitials(confirmSession.userName)}
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-rose-800">{confirmSession.userName || confirmSession.userEmail}</p>
                        <p className="text-[11px] text-rose-600">{confirmSession.userEmail}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-rose-700">
                      <DeviceIcon type={confirmSession.deviceType} size="sm" />
                      {confirmSession.deviceLabel}
                    </div>
                    {confirmSession.ipAddress && (
                      <div className="flex items-center gap-1.5 text-xs text-rose-700">
                        <Wifi className="h-3 w-3" />
                        {confirmSession.ipAddress}
                        {confirmSession.city && ` · ${confirmSession.city}, ${confirmSession.country}`}
                      </div>
                    )}
                  </div>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
          </div>
          <AlertDialogFooter className="px-6 pb-5">
            <AlertDialogCancel className="bg-white hover:bg-slate-50">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleTerminate}
              disabled={isTerminating}
              className="bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-500 gap-1.5"
            >
              <LogOut className="h-4 w-4" />
              {isTerminating ? 'Signing out…' : 'Sign Out Device'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
