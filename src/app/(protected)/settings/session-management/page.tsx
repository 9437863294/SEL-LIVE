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
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Crosshair,
  Copy,
  Download,
  ExternalLink,
  Globe,
  History,
  Loader2,
  Lock,
  LogOut,
  Monitor,
  Navigation,
  RefreshCw,
  Save,
  Search,
  Settings2,
  Shield,
  ShieldAlert,
  Smartphone,
  Sparkles,
  Tablet,
  UserX,
  Users,
  X,
} from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import {
  fetchSessionPolicy,
  sessionControl,
  USER_SESSIONS_COLLECTION,
  type SessionControlAction,
  type UserSession,
} from '@/lib/session-manager';
import {
  DEFAULT_SESSION_POLICY,
  exceedsMaxLifetime,
  sessionPresence,
  type SessionPolicy,
  type SessionPresence,
} from '@/lib/session-policy';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { DataList, type ListColumn } from '@/components/shared/data-list';
import {
  distanceKm,
  loadUserGpsFixes,
  readLocationUnlockToken,
  requestCurrentGps,
  type UserGpsFix,
} from '@/lib/location-tracking-client';
import { cn } from '@/lib/utils';

// ─── pure helpers ────────────────────────────────────────────────────────────

type Ts = { seconds: number } | null | undefined;

const tsMs = (ts: Ts): number | null => (ts ? ts.seconds * 1000 : null);

function timeAgo(ts: Ts): string {
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

function localDateTime(ts: Ts): string {
  if (!ts) return '—';
  return new Date(ts.seconds * 1000).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function sessionDuration(start: Ts, end: Ts, active: boolean): string {
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

const PRESENCE_META: Record<SessionPresence, { label: string; dot: string; chip: string }> = {
  online: { label: 'Active now', dot: 'bg-emerald-500', chip: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  idle: { label: 'Idle', dot: 'bg-amber-400', chip: 'border-amber-200 bg-amber-50 text-amber-700' },
  stale: { label: 'Stale', dot: 'bg-slate-400', chip: 'border-slate-200 bg-slate-100 text-slate-600' },
};

const REASON_LABEL: Record<string, string> = {
  user: 'Signed out',
  admin: 'Terminated',
  timeout: 'Expired',
  policy: 'Ended by policy',
};

function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(filename: string, rows: UserSession[], nowMs: number, policy: SessionPolicy) {
  const header = [
    'User', 'Email', 'Role', 'Device', 'Browser', 'OS', 'IP', 'City', 'Country', 'ISP',
    'Status', 'Started', 'Last active', 'Ended', 'Ended by', 'Ended by user',
  ];
  const lines = rows.map((s) => [
    s.userName, s.userEmail, s.userRole, s.deviceLabel, s.browser, s.os, s.ipAddress, s.city, s.country, s.isp,
    s.isActive ? PRESENCE_META[sessionPresence(tsMs(s.lastActiveAt), nowMs, policy)].label : REASON_LABEL[s.terminatedBy ?? ''] ?? 'Ended',
    localDateTime(s.startedAt), localDateTime(s.lastActiveAt), s.isActive ? '' : localDateTime(s.terminatedAt),
    s.terminatedBy ?? '', s.terminatedByUserName ?? '',
  ].map(csvCell).join(','));
  const blob = new Blob(['\uFEFF' + [header.join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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

function PresenceChip({ presence }: { presence: SessionPresence }) {
  const meta = PRESENCE_META[presence];
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-1.5 py-0 text-[10px] font-semibold', meta.chip)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot, presence === 'online' && 'animate-pulse')} />
      {meta.label}
    </span>
  );
}

// ─── table columns ───────────────────────────────────────────────────────────

const cellNowrap = 'whitespace-nowrap';

/**
 * IP geolocation and GPS further apart than this get flagged. Deliberately generous: Indian mobile
 * carriers routinely exit through a gateway several hundred kilometres from the handset, so a
 * tighter threshold would flag every phone on mobile data.
 */
const IP_GPS_MISMATCH_KM = 300;

/** What the GPS column needs. Null when the viewer has no Location Tracking permission. */
interface GpsColumnContext {
  /** The viewer has unlocked Location Tracking with an OTP in this tab. */
  unlocked: boolean;
  byUser: Map<string, UserGpsFix>;
  canLocate: boolean;
  locating: Set<string>;
  onLocate: (userId: string, name: string) => void;
}

function GpsCell({
  ctx, userId, userName, ipLat, ipLon,
}: {
  ctx: GpsColumnContext; userId: string; userName: string; ipLat?: number | null; ipLon?: number | null;
}) {
  if (!ctx.unlocked) {
    return (
      <a
        href="/settings/location-tracking"
        title="GPS is protected by an email OTP. Unlock it in Location Tracking, then refresh this page."
        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-indigo-600 hover:underline"
      >
        <Lock className="h-3 w-3" /> Unlock
      </a>
    );
  }
  const fix = ctx.byUser.get(userId);
  const hasFix = fix && fix.latitude != null && fix.longitude != null;
  const locating = ctx.locating.has(userId);
  const mismatchKm =
    hasFix && ipLat != null && ipLon != null ? distanceKm(ipLat, ipLon, fix.latitude!, fix.longitude!) : 0;

  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      {hasFix ? (
        <a
          href={`https://www.google.com/maps?q=${fix.latitude},${fix.longitude}`}
          target="_blank"
          rel="noreferrer"
          title={`${fix.latitude!.toFixed(5)}, ${fix.longitude!.toFixed(5)}${fix.accuracy != null ? ` · ±${Math.round(fix.accuracy)} m` : ''}${fix.platform ? ` · ${fix.platform}` : ''}${fix.updatedAtMs ? ` · ${new Date(fix.updatedAtMs).toLocaleString()}` : ''}`}
          className="inline-flex items-center gap-1 font-medium text-emerald-700 hover:underline"
        >
          <Navigation className="h-3 w-3" />
          {fix.updatedAtMs ? timeAgo({ seconds: fix.updatedAtMs / 1000 }) : 'GPS'}
          {fix.accuracy != null && <span className="font-normal text-slate-500">±{Math.round(fix.accuracy)}m</span>}
        </a>
      ) : (
        <span className="text-slate-400">{fix?.enabled ? 'No fix yet' : 'Tracking off'}</span>
      )}
      {mismatchKm > IP_GPS_MISMATCH_KM && (
        <Badge
          variant="outline"
          title="The IP address geolocates far from the device's GPS — a VPN, proxy, or carrier routing. Worth a look, not proof of anything."
          className="border-amber-200 bg-amber-50 px-1.5 py-0 text-[10px] text-amber-700"
        >
          IP ≠ GPS · {Math.round(mismatchKm).toLocaleString()} km
        </Badge>
      )}
      {ctx.canLocate && fix?.enabled && (
        <button
          type="button"
          disabled={locating}
          onClick={() => ctx.onLocate(userId, userName)}
          title="Ask the device for a fresh GPS point now"
          className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-indigo-600 disabled:opacity-60"
        >
          {locating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Crosshair className="h-3.5 w-3.5" />}
        </button>
      )}
    </span>
  );
}

function UserCell({ name, badge }: { name: string; badge?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 whitespace-nowrap">
      <div
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-[11px] font-bold text-white',
          avatarGradient(name)
        )}
      >
        {getInitials(name)}
      </div>
      <span className="font-semibold text-slate-800">{name || 'Unknown User'}</span>
      {badge}
    </div>
  );
}

function SignOutButton({ onClick, label = 'Sign Out', icon = <LogOut className="h-3.5 w-3.5" /> }: {
  onClick: () => void; label?: string; icon?: React.ReactNode;
}) {
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={onClick}
      className="h-7 shrink-0 gap-1.5 whitespace-nowrap border-rose-200 bg-rose-50/50 px-2 text-xs text-rose-600 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700"
    >
      {icon}
      {label}
    </Button>
  );
}

/**
 * The user row toggles open on click, so anything clickable inside it — checkbox, buttons, links —
 * must keep its click to itself or using it would also expand/collapse the row.
 */
function NoToggle({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center" onClick={(e) => e.stopPropagation()}>
      {children}
    </span>
  );
}

/** Columns of one session, shown inside an expanded user row — so no user, email, role or GPS. */
function sessionColumns({
  tab,
  isAdmin,
  currentUserId,
  currentSessionId,
  canTerminate,
  presenceOf,
  isOverAge,
  selection,
  onTerminate,
}: {
  tab: 'active' | 'history';
  isAdmin: boolean;
  currentUserId: string;
  currentSessionId: string;
  canTerminate: boolean;
  presenceOf: (s: UserSession) => SessionPresence;
  isOverAge: (s: UserSession) => boolean;
  selection: { selected: Set<string>; toggle: (s: UserSession) => void } | null;
  onTerminate: (s: UserSession) => void;
}): ListColumn<UserSession>[] {
  // Network details are the user's own business or an administrator's.
  const canSeeNetwork = (s: UserSession) => isAdmin || s.userId === currentUserId;
  const canAct = (s: UserSession) =>
    s.isActive && s.id !== currentSessionId && (canTerminate || s.userId === currentUserId);

  const columns: ListColumn<UserSession>[] = [];

  if (selection) {
    columns.push({
      header: ' ',
      mobile: 'omit',
      className: 'w-8',
      cell: (s) => (
        <Checkbox
          checked={selection.selected.has(s.id)}
          disabled={!canAct(s)}
          onCheckedChange={() => selection.toggle(s)}
          aria-label="Select session"
        />
      ),
    });
  }

  columns.push(
    {
      header: 'Device',
      mobile: 'title',
      className: cellNowrap,
      cell: (s) => (
        <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
          <DeviceIcon type={s.deviceType} size="sm" />
          {s.deviceLabel}
          {s.id === currentSessionId && (
            <Badge className="border-indigo-200 bg-indigo-100 px-1.5 py-0 text-[10px] font-semibold text-indigo-700">
              This device
            </Badge>
          )}
        </span>
      ),
    },
    {
      header: 'Status',
      mobile: 'aside',
      className: cellNowrap,
      cell: (s) =>
        s.isActive ? (
          <span className="inline-flex items-center gap-1">
            <PresenceChip presence={presenceOf(s)} />
            {isOverAge(s) && (
              <Badge variant="outline" className="border-rose-200 bg-rose-50 px-1.5 py-0 text-[10px] text-rose-600">
                Over max age
              </Badge>
            )}
          </span>
        ) : (
          <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-semibold text-slate-500">
            {REASON_LABEL[s.terminatedBy ?? ''] ?? 'Ended'}
          </Badge>
        ),
    },
    {
      header: 'IP Address',
      className: cellNowrap,
      cell: (s) =>
        canSeeNetwork(s) && s.ipAddress ? (
          <span className="inline-flex items-center font-mono text-xs text-slate-600">
            {s.ipAddress}
            <CopyButton text={s.ipAddress} />
          </span>
        ) : '—',
    },
    {
      header: 'Location',
      className: cellNowrap,
      cell: (s) => {
        const loc = [s.city, s.country].filter(Boolean).join(', ');
        if (!canSeeNetwork(s) || !loc) return '—';
        const flag = countryFlag(s.countryCode ?? '');
        const mapsUrl = s.lat && s.lon ? `https://www.google.com/maps?q=${s.lat},${s.lon}` : null;
        return (
          <span className="inline-flex items-center gap-1 text-xs text-slate-600" title={[s.city, s.region, s.country].filter(Boolean).join(', ')}>
            {flag && <span>{flag}</span>}
            {loc}
            {mapsUrl && (
              <a href={mapsUrl} target="_blank" rel="noreferrer" title="Open map" className="text-cyan-600 hover:text-cyan-700">
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </span>
        );
      },
    },
    {
      header: 'ISP',
      className: `${cellNowrap} hidden lg:table-cell`,
      cell: (s) => (canSeeNetwork(s) && s.isp ? <span className="text-xs text-slate-600">{s.isp}</span> : '—'),
    },
    {
      header: 'Started',
      className: cellNowrap,
      cell: (s) => <span className="text-xs text-slate-600" title={localDateTime(s.startedAt)}>{timeAgo(s.startedAt)}</span>,
    },
    tab === 'active'
      ? {
          header: 'Last Active',
          className: cellNowrap,
          cell: (s) => <span className="text-xs text-slate-600" title={localDateTime(s.lastActiveAt)}>{timeAgo(s.lastActiveAt)}</span>,
        }
      : {
          header: 'Ended',
          className: cellNowrap,
          cell: (s) => <span className="text-xs text-slate-600">{localDateTime(s.terminatedAt)}</span>,
        },
    {
      header: 'Duration',
      className: cellNowrap,
      cell: (s) => <span className="text-xs tabular-nums text-slate-600">{sessionDuration(s.startedAt, s.terminatedAt, s.isActive)}</span>,
    },
  );

  if (tab === 'history') {
    columns.push({
      header: 'Ended By',
      className: cellNowrap,
      cell: (s) =>
        s.terminatedByUserName ? (
          <span className="inline-flex items-center gap-1 text-xs text-rose-600">
            <AlertTriangle className="h-3 w-3" /> {s.terminatedByUserName}
          </span>
        ) : (
          <span className="text-xs capitalize text-muted-foreground">{s.terminatedBy ?? '—'}</span>
        ),
    });
  } else {
    columns.push({
      header: 'Action',
      mobile: 'footer',
      align: 'right',
      className: cellNowrap,
      cell: (s) => (canAct(s) ? <SignOutButton onClick={() => onTerminate(s)} /> : null),
    });
  }

  return columns;
}

// ─── grouped by user ─────────────────────────────────────────────────────────

interface UserGroup {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  userRole: string;
  /** Most recent first. */
  sessions: UserSession[];
  /** Latest activity (active tab) or latest ending (history tab). */
  latestMs: number;
  /** Best presence across the sessions — active tab only. */
  presence: SessionPresence;
}

const PRESENCE_RANK: Record<SessionPresence, number> = { online: 0, idle: 1, stale: 2 };

function groupByUser(
  rows: UserSession[],
  tab: 'active' | 'history',
  presenceOf: (s: UserSession) => SessionPresence,
): UserGroup[] {
  const map = new Map<string, UserGroup>();
  for (const s of rows) {
    const at = (tab === 'active' ? tsMs(s.lastActiveAt) : tsMs(s.terminatedAt)) ?? 0;
    const p = s.isActive ? presenceOf(s) : 'stale';
    const g = map.get(s.userId);
    if (!g) {
      map.set(s.userId, {
        id: s.userId, userId: s.userId, userName: s.userName, userEmail: s.userEmail, userRole: s.userRole,
        sessions: [s], latestMs: at, presence: p,
      });
    } else {
      g.sessions.push(s);
      g.latestMs = Math.max(g.latestMs, at);
      if (PRESENCE_RANK[p] < PRESENCE_RANK[g.presence]) g.presence = p;
    }
  }
  for (const g of map.values()) {
    g.sessions.sort((a, b) =>
      ((tab === 'active' ? tsMs(b.lastActiveAt) : tsMs(b.terminatedAt)) ?? 0) -
      ((tab === 'active' ? tsMs(a.lastActiveAt) : tsMs(a.terminatedAt)) ?? 0));
  }
  return [...map.values()].sort((a, b) => b.latestMs - a.latestMs);
}

function userGroupColumns({
  tab,
  isAdmin,
  currentUserId,
  currentSessionId,
  canTerminate,
  gps,
  expanded,
  onToggleExpand,
  groupSelection,
  onSignOutEverywhere,
  onSignOutOthers,
}: {
  tab: 'active' | 'history';
  isAdmin: boolean;
  currentUserId: string;
  currentSessionId: string;
  canTerminate: boolean;
  gps: GpsColumnContext | null;
  expanded: ReadonlySet<string>;
  onToggleExpand: (g: UserGroup) => void;
  groupSelection: { state: (g: UserGroup) => boolean | 'indeterminate' | null; toggle: (g: UserGroup) => void } | null;
  onSignOutEverywhere: (g: UserGroup) => void;
  onSignOutOthers: () => void;
}): ListColumn<UserGroup>[] {
  const columns: ListColumn<UserGroup>[] = [];

  if (groupSelection) {
    columns.push({
      header: ' ',
      mobile: 'omit',
      className: 'w-8',
      cell: (g) => {
        const state = groupSelection.state(g);
        return (
          <NoToggle>
            <Checkbox
              checked={state ?? false}
              disabled={state === null}
              onCheckedChange={() => groupSelection.toggle(g)}
              aria-label={`Select all sessions of ${g.userName}`}
            />
          </NoToggle>
        );
      },
    });
  }

  columns.push(
    {
      header: 'User',
      mobile: 'title',
      cell: (g) => (
        <span className="inline-flex items-center gap-1.5">
          <ChevronRight
            className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', expanded.has(g.id) && 'rotate-90 text-indigo-600')}
          />
          <UserCell
            name={g.userName}
            badge={g.userId === currentUserId && (
              <Badge className="border-indigo-200 bg-indigo-100 px-1.5 py-0 text-[10px] font-semibold text-indigo-700">You</Badge>
            )}
          />
        </span>
      ),
    },
    {
      header: 'Email',
      mobile: 'title',
      className: cellNowrap,
      cell: (g) => (isAdmin || g.userId === currentUserId ? <span className="text-muted-foreground">{g.userEmail}</span> : '—'),
    },
    {
      header: 'Role',
      className: cellNowrap,
      cell: (g) => (g.userRole ? <Badge variant="outline" className="py-0 text-[10px] text-slate-500">{g.userRole}</Badge> : '—'),
    },
  );

  if (tab === 'active') {
    columns.push({ header: 'Status', mobile: 'aside', className: cellNowrap, cell: (g) => <PresenceChip presence={g.presence} /> });
    if (gps) {
      columns.push({
        header: 'GPS',
        className: cellNowrap,
        cell: (g) => {
          // Compare against the most recent session that has an IP location.
          const withGeo = g.sessions.find((s) => s.lat != null && s.lon != null);
          return (
            <NoToggle>
              <GpsCell ctx={gps} userId={g.userId} userName={g.userName} ipLat={withGeo?.lat} ipLon={withGeo?.lon} />
            </NoToggle>
          );
        },
      });
    }
  }

  columns.push(
    {
      header: 'Sessions',
      mobile: 'footer',
      className: cellNowrap,
      cell: (g) => (
        <NoToggle>
          <button
            type="button"
            onClick={() => onToggleExpand(g)}
            aria-expanded={expanded.has(g.id)}
            className={cn(
              'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold transition-colors',
              expanded.has(g.id)
                ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-200 hover:text-indigo-700'
            )}
          >
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', !expanded.has(g.id) && '-rotate-90')} />
            {g.sessions.length} session{g.sessions.length !== 1 ? 's' : ''}
          </button>
        </NoToggle>
      ),
    },
    {
      header: 'Devices',
      className: cellNowrap,
      cell: (g) => {
        const devices = g.sessions.reduce<Record<string, number>>((acc, s) => {
          acc[s.deviceType] = (acc[s.deviceType] ?? 0) + 1;
          return acc;
        }, {});
        return (
          <span className="inline-flex items-center gap-1.5">
            {Object.entries(devices).map(([type, n]) => (
              <span key={type} className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                <DeviceIcon type={type} size="sm" /> {n}
              </span>
            ))}
          </span>
        );
      },
    },
    {
      header: tab === 'active' ? 'Last Active' : 'Last Ended',
      className: cellNowrap,
      cell: (g) => (
        <span className="text-xs text-slate-600" title={g.latestMs ? new Date(g.latestMs).toLocaleString() : undefined}>
          {g.latestMs ? timeAgo({ seconds: g.latestMs / 1000 }) : '—'}
        </span>
      ),
    },
  );

  if (tab === 'active') {
    columns.push({
      header: 'Action',
      mobile: 'footer',
      align: 'right',
      className: cellNowrap,
      cell: (g) => {
        if (g.userId === currentUserId) {
          const others = g.sessions.filter((s) => s.id !== currentSessionId).length;
          return others > 0 ? (
            <NoToggle><SignOutButton onClick={onSignOutOthers} label={`Sign out other devices (${others})`} /></NoToggle>
          ) : null;
        }
        return canTerminate ? (
          <NoToggle>
            <SignOutButton onClick={() => onSignOutEverywhere(g)} label="Sign out everywhere" icon={<UserX className="h-3.5 w-3.5" />} />
          </NoToggle>
        ) : null;
      },
    });
  }

  return columns;
}


// ─── policy panel ────────────────────────────────────────────────────────────

function NumberField({
  id, label, hint, value, onChange, disabled, suffix, min = 0,
}: {
  id: string; label: string; hint: string; value: number; onChange: (n: number) => void;
  disabled: boolean; suffix: string; min?: number;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm font-medium">{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="number"
          min={min}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Math.max(min, Number(e.target.value) || 0))}
          className="h-9 w-28 bg-white"
        />
        <span className="text-xs text-muted-foreground">{suffix}</span>
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function ToggleField({
  id, label, hint, checked, onChange, disabled,
}: {
  id: string; label: string; hint: string; checked: boolean; onChange: (b: boolean) => void; disabled: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border bg-white/70 p-3">
      <div className="space-y-0.5">
        <Label htmlFor={id} className="text-sm font-medium">{label}</Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

function PolicyPanel({
  policy,
  canEdit,
  onSave,
}: {
  policy: SessionPolicy;
  canEdit: boolean;
  onSave: (p: SessionPolicy) => Promise<void>;
}) {
  const [draft, setDraft] = useState<SessionPolicy>(policy);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(policy), [policy]);

  const set = <K extends keyof SessionPolicy>(key: K, value: SessionPolicy[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const dirty = (Object.keys(DEFAULT_SESSION_POLICY) as (keyof SessionPolicy)[])
    .filter((k) => !['updatedAt', 'updatedByName', 'lastSweepAt'].includes(k))
    .some((k) => draft[k] !== policy[k]);
  const disabled = !canEdit || saving;

  return (
    <Card className="overflow-hidden">
      <div className="h-1 w-full bg-gradient-to-r from-violet-500 to-indigo-500" />
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Settings2 className="h-4 w-4 text-indigo-600" /> Session policy
        </CardTitle>
        <CardDescription>
          Applied at every sign-in and page load. 0 means no limit. The defaults match how sessions behaved before this policy existed.
          {!canEdit && ' You can view the policy; changing it needs Edit permission on Session Management.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-5 sm:grid-cols-2">
          <NumberField
            id="maxConcurrent"
            label="Max sessions per user"
            hint="Signing in beyond this ends that user’s least recently active sessions."
            value={draft.maxConcurrentSessions}
            onChange={(n) => set('maxConcurrentSessions', n)}
            disabled={disabled}
            suffix="sessions (0 = unlimited)"
          />
          <NumberField
            id="idleCap"
            label="Idle timeout cap"
            hint="Upper limit on each user’s own Login Expiry setting."
            value={draft.idleTimeoutCapMinutes}
            onChange={(n) => set('idleTimeoutCapMinutes', n)}
            disabled={disabled}
            suffix="minutes (0 = user decides)"
          />
          <NumberField
            id="maxAge"
            label="Maximum session age"
            hint="A session older than this is ended at its next load and by the sweep, however active."
            value={draft.maxSessionHours}
            onChange={(n) => set('maxSessionHours', n)}
            disabled={disabled}
            suffix="hours (0 = no limit)"
          />
          <NumberField
            id="staleAfter"
            label="Stale after"
            hint="No activity for this long marks a session stale; the sweep ends it."
            value={draft.staleAfterHours}
            onChange={(n) => set('staleAfterHours', n)}
            disabled={disabled}
            suffix="hours"
            min={1}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <ToggleField
            id="expireOnResume"
            label="Enforce idle timeout after reopening"
            hint="Reopening the app after the idle timeout has passed requires signing in again — including on phones."
            checked={draft.expireOnResumeAfterIdle}
            onChange={(b) => set('expireOnResumeAfterIdle', b)}
            disabled={disabled}
          />
          <ToggleField
            id="autoSweep"
            label="Automatically sweep stale sessions"
            hint="Ends stale and over-age sessions at most every 15 minutes, triggered by any sign-in."
            checked={draft.autoSweepStale}
            onChange={(b) => set('autoSweepStale', b)}
            disabled={disabled}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="text-xs text-muted-foreground">
            {policy.updatedAt
              ? `Last changed ${new Date(policy.updatedAt).toLocaleString()}${policy.updatedByName ? ` by ${policy.updatedByName}` : ''}.`
              : 'Using default policy.'}
            {policy.lastSweepAt && ` Last sweep ${new Date(policy.lastSweepAt).toLocaleString()}.`}
          </p>
          {canEdit && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={!dirty || saving} onClick={() => setDraft(policy)} className="bg-white">
                Discard
              </Button>
              <Button
                size="sm"
                disabled={!dirty || saving}
                onClick={async () => {
                  setSaving(true);
                  try { await onSave(draft); } finally { setSaving(false); }
                }}
                className="gap-1.5 bg-indigo-600 text-white hover:bg-indigo-700"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save policy
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── page ────────────────────────────────────────────────────────────────────

type Tab = 'active' | 'history' | 'policy';
type PresenceFilter = 'all' | SessionPresence;
type DeviceFilter = 'all' | 'Desktop' | 'Mobile' | 'Tablet';

type PendingAction =
  | { kind: 'terminate'; sessions: UserSession[] }
  | { kind: 'terminate-user'; group: UserGroup }
  | { kind: 'terminate-others'; sessions: UserSession[] }
  | { kind: 'terminate-all'; sessions: UserSession[] }
  | { kind: 'sweep'; sessions: UserSession[] };

const HISTORY_PAGE = 60;

export default function SessionManagementPage() {
  const { user } = useAuth();
  const { can } = useAuthorization();
  const { toast } = useToast();

  const isAdmin = can('View', 'Settings.Session Management');
  const canTerminate = can('Delete', 'Settings.Session Management');
  const canEditPolicy = canTerminate || can('Edit', 'Settings.Session Management');
  const canViewGps = can('View', 'Settings.Location Tracking');
  const canLocateGps = can('Edit', 'Settings.Location Tracking');

  const [tab, setTab] = useState<Tab>('active');
  const [activeSessions, setActiveSessions] = useState<UserSession[]>([]);
  const [historySessions, setHistorySessions] = useState<UserSession[]>([]);
  const [historyLimit, setHistoryLimit] = useState(HISTORY_PAGE);
  const [policy, setPolicy] = useState<SessionPolicy>(DEFAULT_SESSION_POLICY);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [presenceFilter, setPresenceFilter] = useState<PresenceFilter>('all');
  const [deviceFilter, setDeviceFilter] = useState<DeviceFilter>('all');
  const [reasonFilter, setReasonFilter] = useState<string>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [gpsToken, setGpsToken] = useState('');
  const [gpsByUser, setGpsByUser] = useState<Map<string, UserGpsFix>>(new Map());
  const [locatingIds, setLocatingIds] = useState<Set<string>>(new Set());
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());

  const currentSessionId = typeof window !== 'undefined' ? (localStorage.getItem('sessionId') ?? '') : '';
  const activeUnsubRef = useRef<(() => void) | null>(null);
  const historyUnsubRef = useRef<(() => void) | null>(null);
  const initialLoadDoneRef = useRef(false);

  // Presence is relative to now; keep it moving without a reload.
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const loadPolicy = useCallback(() => {
    fetchSessionPolicy()
      .then((r) => setPolicy(r.policy))
      .catch((err) => console.warn('[session-management] policy load failed', err));
  }, []);

  useEffect(() => { if (user) loadPolicy(); }, [user, loadPolicy]);

  // ─── GPS (reuses the Location Tracking OTP unlock) ─────────────────────────

  const loadGps = useCallback(async () => {
    if (!canViewGps) return;
    const token = readLocationUnlockToken();
    setGpsToken(token);
    if (!token) { setGpsByUser(new Map()); return; }
    try {
      setGpsByUser(await loadUserGpsFixes(token));
    } catch (err) {
      // An expired or revoked unlock reads as locked, not as an error.
      if ((err as { status?: number }).status === 401) setGpsToken('');
      console.warn('[session-management] GPS load failed', err);
    }
  }, [canViewGps]);

  useEffect(() => {
    if (!user || !canViewGps) return;
    void loadGps();
    const t = setInterval(() => void loadGps(), 60_000);
    // Unlocking in another tab of Location Tracking shows up when the user comes back here.
    const onFocus = () => void loadGps();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [user, canViewGps, loadGps]);

  const locateNow = useCallback(async (userId: string, name: string) => {
    if (!gpsToken) return;
    setLocatingIds((prev) => new Set(prev).add(userId));
    try {
      const requestId = await requestCurrentGps(userId, gpsToken);
      toast({ title: 'Current location requested', description: `${name || 'The user'}’s device is fetching a fresh GPS point.` });
      // The device answers asynchronously; poll briefly for the reply carrying our request id.
      for (let i = 0; i < 6; i += 1) {
        await new Promise((r) => setTimeout(r, 4_000));
        const fixes = await loadUserGpsFixes(gpsToken);
        setGpsByUser(fixes);
        if (requestId && fixes.get(userId)?.lastFetchRequestId === requestId) {
          toast({ title: 'Location received', description: `${name || 'The user'}’s latest coordinates are now shown.` });
          return;
        }
      }
      toast({
        title: 'Request is waiting',
        description: 'The device has not answered yet. It will once the app is open with location permission granted.',
      });
    } catch (err) {
      toast({
        title: 'Location request failed',
        description: err instanceof Error ? err.message : 'Try again.',
        variant: 'destructive',
      });
    } finally {
      setLocatingIds((prev) => { const next = new Set(prev); next.delete(userId); return next; });
    }
  }, [gpsToken, toast]);

  const gpsContext = useMemo<GpsColumnContext | null>(
    () =>
      canViewGps
        ? { unlocked: !!gpsToken, byUser: gpsByUser, canLocate: canLocateGps && !!gpsToken, locating: locatingIds, onLocate: locateNow }
        : null,
    [canViewGps, gpsToken, gpsByUser, canLocateGps, locatingIds, locateNow]
  );

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
      ? query(collection(db, USER_SESSIONS_COLLECTION), where('isActive', '==', false), orderBy('terminatedAt', 'desc'), limit(historyLimit))
      : query(collection(db, USER_SESSIONS_COLLECTION), where('isActive', '==', false), where('userId', '==', user.id), orderBy('terminatedAt', 'desc'), limit(historyLimit));

    historyUnsubRef.current = onSnapshot(
      historyQ,
      (snap) => setHistorySessions(snap.docs.map((d) => ({ id: d.id, ...d.data() } as UserSession))),
      (err) => console.error('Session history error', err)
    );
  }, [user, isAdmin, historyLimit]);

  useEffect(() => {
    setupListeners();
    return () => { activeUnsubRef.current?.(); historyUnsubRef.current?.(); };
  }, [setupListeners]);

  // Drop selections that are no longer active (ended elsewhere, or by this page).
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const alive = new Set(activeSessions.map((s) => s.id));
      const next = new Set([...prev].filter((id) => alive.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [activeSessions]);

  // ─── derived data ──────────────────────────────────────────────────────────

  const presenceOf = useCallback(
    (s: UserSession) => sessionPresence(tsMs(s.lastActiveAt), nowMs, policy),
    [nowMs, policy]
  );

  const matchesSearch = useCallback((s: UserSession) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (s.userName ?? '').toLowerCase().includes(q) ||
      (s.userEmail ?? '').toLowerCase().includes(q) ||
      (s.deviceLabel ?? '').toLowerCase().includes(q) ||
      (s.ipAddress ?? '').includes(q) ||
      (s.city ?? '').toLowerCase().includes(q) ||
      (s.country ?? '').toLowerCase().includes(q) ||
      (s.isp ?? '').toLowerCase().includes(q)
    );
  }, [search]);

  const displayRows = useMemo(() => {
    if (tab === 'history') {
      return historySessions.filter(
        (s) =>
          matchesSearch(s) &&
          (deviceFilter === 'all' || s.deviceType === deviceFilter) &&
          (reasonFilter === 'all' || s.terminatedBy === reasonFilter)
      );
    }
    return activeSessions.filter(
      (s) =>
        matchesSearch(s) &&
        (deviceFilter === 'all' || s.deviceType === deviceFilter) &&
        (presenceFilter === 'all' || presenceOf(s) === presenceFilter)
    );
  }, [tab, activeSessions, historySessions, matchesSearch, deviceFilter, presenceFilter, reasonFilter, presenceOf]);

  const userGroups = useMemo(
    () => groupByUser(displayRows, tab === 'history' ? 'history' : 'active', presenceOf),
    [displayRows, tab, presenceOf]
  );

  const summary = useMemo(() => {
    const uniqueUsers = new Set(activeSessions.map((s) => s.userId)).size;
    const desktopCount = activeSessions.filter((s) => s.deviceType === 'Desktop').length;
    const mobileCount = activeSessions.filter((s) => s.deviceType !== 'Desktop').length;
    const online = activeSessions.filter((s) => presenceOf(s) === 'online').length;
    const sweepable = activeSessions.filter(
      (s) => s.id !== currentSessionId &&
        (presenceOf(s) === 'stale' || exceedsMaxLifetime(tsMs(s.startedAt), nowMs, policy))
    );
    return { active: activeSessions.length, uniqueUsers, desktopCount, mobileCount, online, sweepable };
  }, [activeSessions, presenceOf, currentSessionId, nowMs, policy]);

  const myOtherSessions = useMemo(
    () => (user ? activeSessions.filter((s) => s.userId === user.id && s.id !== currentSessionId) : []),
    [activeSessions, user, currentSessionId]
  );

  const selectableRows = useMemo(
    () => (tab === 'active' && user
      ? displayRows.filter((s) => s.isActive && s.id !== currentSessionId && (canTerminate || s.userId === user.id))
      : []),
    [tab, displayRows, currentSessionId, canTerminate, user]
  );

  const selectedSessions = useMemo(
    () => activeSessions.filter((s) => selected.has(s.id)),
    [activeSessions, selected]
  );

  // ─── actions ───────────────────────────────────────────────────────────────

  const toggleSelect = useCallback((s: UserSession) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(s.id)) next.delete(s.id);
      else next.add(s.id);
      return next;
    });
  }, []);

  const allVisibleSelected = selectableRows.length > 0 && selectableRows.every((s) => selected.has(s.id));
  const toggleSelectAll = () => {
    setSelected(allVisibleSelected ? new Set() : new Set(selectableRows.map((s) => s.id)));
  };

  const columns = useMemo(
    () =>
      sessionColumns({
        tab: tab === 'history' ? 'history' : 'active',
        isAdmin,
        currentUserId: user?.id ?? '',
        currentSessionId,
        canTerminate,
        presenceOf,
        isOverAge: (s) => s.isActive && exceedsMaxLifetime(tsMs(s.startedAt), nowMs, policy),
        selection: tab === 'active' && selectableRows.length > 0 ? { selected, toggle: toggleSelect } : null,
        onTerminate: (s) => setPending({ kind: 'terminate', sessions: [s] }),
      }),
    [tab, isAdmin, user?.id, currentSessionId, canTerminate, presenceOf, nowMs, policy, selectableRows.length, selected, toggleSelect]
  );

  const toggleExpand = useCallback((g: UserGroup) => {
    setExpandedUsers((prev) => {
      const next = new Set(prev);
      if (next.has(g.id)) next.delete(g.id);
      else next.add(g.id);
      return next;
    });
  }, []);

  const allExpanded = userGroups.length > 0 && userGroups.every((g) => expandedUsers.has(g.id));

  const selectableIds = useMemo(() => new Set(selectableRows.map((s) => s.id)), [selectableRows]);

  const groupSelection = useMemo(() => {
    if (tab !== 'active' || selectableRows.length === 0) return null;
    const pickable = (g: UserGroup) => g.sessions.filter((s) => selectableIds.has(s.id));
    return {
      state: (g: UserGroup): boolean | 'indeterminate' | null => {
        const ids = pickable(g);
        if (ids.length === 0) return null;
        const n = ids.filter((s) => selected.has(s.id)).length;
        return n === 0 ? false : n === ids.length ? true : 'indeterminate';
      },
      toggle: (g: UserGroup) => {
        const ids = pickable(g).map((s) => s.id);
        setSelected((prev) => {
          const next = new Set(prev);
          const all = ids.every((id) => next.has(id));
          ids.forEach((id) => (all ? next.delete(id) : next.add(id)));
          return next;
        });
      },
    };
  }, [tab, selectableRows.length, selectableIds, selected]);

  const userColumns = useMemo(
    () =>
      userGroupColumns({
        tab: tab === 'history' ? 'history' : 'active',
        isAdmin,
        currentUserId: user?.id ?? '',
        currentSessionId,
        canTerminate,
        gps: gpsContext,
        expanded: expandedUsers,
        onToggleExpand: toggleExpand,
        groupSelection,
        onSignOutEverywhere: (group) => setPending({ kind: 'terminate-user', group }),
        onSignOutOthers: () => setPending({ kind: 'terminate-others', sessions: myOtherSessions }),
      }),
    [tab, isAdmin, user?.id, currentSessionId, canTerminate, gpsContext, expandedUsers, toggleExpand, groupSelection, myOtherSessions]
  );

  const runPending = async () => {
    if (!pending || !user) return;
    let payload: SessionControlAction;
    switch (pending.kind) {
      case 'terminate': {
        const ids = pending.sessions.map((s) => s.id).filter((id) => id !== currentSessionId);
        if (!ids.length) { setPending(null); return; }
        payload = { action: 'terminate', sessionIds: ids };
        break;
      }
      case 'terminate-user':
        payload = { action: 'terminate-user', userId: pending.group.userId, currentSessionId };
        break;
      case 'terminate-others':
        payload = { action: 'terminate-others', currentSessionId };
        break;
      case 'terminate-all':
        payload = { action: 'terminate-all', currentSessionId };
        break;
      case 'sweep':
        payload = { action: 'sweep-stale', currentSessionId };
        break;
    }

    setIsWorking(true);
    try {
      const result = await sessionControl(payload);
      setPolicy(result.policy);
      setSelected(new Set());
      toast({
        title: result.terminated ? 'Sessions signed out' : 'Nothing to sign out',
        description: result.terminated
          ? `${result.terminated} session${result.terminated !== 1 ? 's' : ''} ended.${pending.kind === 'terminate-user' || pending.kind === 'terminate-all' ? ' Sign-in tokens were revoked as well.' : ''}`
          : 'Those sessions had already ended.',
      });
    } catch (err) {
      toast({
        title: 'Could not sign out',
        description: err instanceof Error ? err.message : 'Failed to terminate session.',
        variant: 'destructive',
      });
    } finally {
      setIsWorking(false);
      setPending(null);
    }
  };

  const savePolicy = async (next: SessionPolicy) => {
    try {
      const result = await sessionControl({ action: 'update-policy', policy: next });
      setPolicy(result.policy);
      toast({ title: 'Session policy saved', description: 'It applies from each user’s next sign-in or page load.' });
    } catch (err) {
      toast({
        title: 'Could not save policy',
        description: err instanceof Error ? err.message : 'Unknown error.',
        variant: 'destructive',
      });
    }
  };

  if (!user) return null;

  // ─── confirm dialog copy ────────────────────────────────────────────────────

  const dialog = (() => {
    if (!pending) return null;
    switch (pending.kind) {
      case 'terminate':
        return {
          title: pending.sessions.length === 1 ? 'Sign Out Session' : `Sign Out ${pending.sessions.length} Sessions`,
          body: 'This immediately ends the session on the target device. The user will be signed out there and must log in again.',
          sessions: pending.sessions,
          confirm: pending.sessions.length === 1 ? 'Sign Out Device' : 'Sign Out Selected',
        };
      case 'terminate-user':
        return {
          title: `Sign ${pending.group.userName || pending.group.userEmail} Out Everywhere`,
          body: 'Ends every active session this person has and revokes their sign-in tokens, so devices that are offline right now are signed out too.',
          sessions: pending.group.sessions,
          confirm: 'Sign Out Everywhere',
        };
      case 'terminate-others':
        return {
          title: 'Sign Out Your Other Devices',
          body: 'Every session of yours except this one will end. Use this if you signed in on a device you no longer have.',
          sessions: pending.sessions,
          confirm: 'Sign Out Other Devices',
        };
      case 'terminate-all':
        return {
          title: 'Sign Out Everyone',
          body: 'Emergency action: ends every active session in the organisation except yours on this device, and revokes everyone’s sign-in tokens. Everyone must log in again.',
          sessions: pending.sessions,
          confirm: `Sign Out ${pending.sessions.length} Sessions`,
        };
      case 'sweep':
        return {
          title: 'Clean Up Stale Sessions',
          body: `Ends sessions with no activity for ${policy.staleAfterHours}h${policy.maxSessionHours ? ` and sessions older than ${policy.maxSessionHours}h` : ''}. If one of those devices is reopened, it will be asked to sign in.`,
          sessions: pending.sessions,
          confirm: 'Clean Up',
        };
    }
  })();

  const tabs: { id: Tab; label: string; icon: React.ReactNode; count?: number; show: boolean }[] = [
    { id: 'active', label: 'Active', icon: <Globe className="h-3.5 w-3.5" />, count: activeSessions.length, show: true },
    { id: 'history', label: 'History', icon: <History className="h-3.5 w-3.5" />, count: historySessions.length, show: true },
    { id: 'policy', label: 'Policy', icon: <Settings2 className="h-3.5 w-3.5" />, show: isAdmin },
  ];

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
                  ? 'Monitor, control and set policy for every login session — devices, locations, idle and stale sessions.'
                  : 'View and manage your own active login sessions across all devices.'}
              </CardDescription>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 self-start">
            {myOtherSessions.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPending({ kind: 'terminate-others', sessions: myOtherSessions })}
                className="w-fit gap-1.5 bg-white text-rose-600 hover:text-rose-700"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign out my other devices ({myOtherSessions.length})
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => { setupListeners(); loadPolicy(); void loadGps(); }} className="w-fit gap-1.5 bg-white">
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>
        </CardHeader>

        {/* Stats */}
        <CardContent className={cn('grid grid-cols-2 gap-3', isAdmin ? 'sm:grid-cols-3 lg:grid-cols-5' : 'sm:grid-cols-4')}>
          {[
            { label: 'Active Sessions', value: summary.active, icon: <Globe className="h-4 w-4" />, color: 'text-indigo-600', bg: 'bg-indigo-50' },
            { label: 'Users Online', value: summary.uniqueUsers, icon: <Users className="h-4 w-4" />, color: 'text-emerald-600', bg: 'bg-emerald-50', adminOnly: true },
            { label: 'Active Now', value: summary.online, icon: <Sparkles className="h-4 w-4" />, color: 'text-teal-600', bg: 'bg-teal-50' },
            { label: 'Stale / Over Age', value: summary.sweepable.length, icon: <AlertTriangle className="h-4 w-4" />, color: 'text-amber-600', bg: 'bg-amber-50', adminOnly: true },
            { label: 'Desktop · Mobile', value: `${summary.desktopCount} · ${summary.mobileCount}`, icon: <Monitor className="h-4 w-4" />, color: 'text-blue-600', bg: 'bg-blue-50' },
          ]
            .filter((s) => !s.adminOnly || isAdmin)
            .map((stat) => (
              <div key={stat.label} className="flex items-center gap-3 rounded-xl border bg-white/80 px-3 py-3">
                <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', stat.bg, stat.color)}>
                  {stat.icon}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                  <p className={cn('text-xl font-bold leading-tight', stat.color)}>{isLoading ? '—' : String(stat.value)}</p>
                </div>
              </div>
            ))}
        </CardContent>
      </Card>

      {/* ── Tab + Search bar ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-xl border bg-white/70 p-1 shadow-sm">
          {tabs.filter((t) => t.show).map((t) => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setSelected(new Set()); }}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all',
                tab === t.id
                  ? 'bg-white shadow-sm text-indigo-700'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t.icon} {t.label}{t.count != null && !isLoading && ` (${t.count})`}
            </button>
          ))}
        </div>

        {tab !== 'policy' && (
          <>
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

            {tab === 'active' && (
              <Select value={presenceFilter} onValueChange={(v) => setPresenceFilter(v as PresenceFilter)}>
                <SelectTrigger className="h-9 w-[140px] bg-white/85 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All states</SelectItem>
                  <SelectItem value="online">Active now</SelectItem>
                  <SelectItem value="idle">Idle</SelectItem>
                  <SelectItem value="stale">Stale</SelectItem>
                </SelectContent>
              </Select>
            )}
            {tab === 'history' && (
              <Select value={reasonFilter} onValueChange={setReasonFilter}>
                <SelectTrigger className="h-9 w-[150px] bg-white/85 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All endings</SelectItem>
                  <SelectItem value="user">Signed out</SelectItem>
                  <SelectItem value="admin">Terminated</SelectItem>
                  <SelectItem value="timeout">Expired</SelectItem>
                  <SelectItem value="policy">Ended by policy</SelectItem>
                </SelectContent>
              </Select>
            )}
            {(
              <Select value={deviceFilter} onValueChange={(v) => setDeviceFilter(v as DeviceFilter)}>
                <SelectTrigger className="h-9 w-[130px] bg-white/85 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All devices</SelectItem>
                  <SelectItem value="Desktop">Desktop</SelectItem>
                  <SelectItem value="Mobile">Mobile</SelectItem>
                  <SelectItem value="Tablet">Tablet</SelectItem>
                </SelectContent>
              </Select>
            )}

            {displayRows.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-1.5 bg-white/85 text-xs"
                onClick={() => downloadCsv(`sessions-${tab}-${new Date().toISOString().slice(0, 10)}.csv`, displayRows, nowMs, policy)}
              >
                <Download className="h-3.5 w-3.5" /> Export
              </Button>
            )}

            {search && (
              <span className="text-xs text-muted-foreground">
                {displayRows.length} result{displayRows.length !== 1 ? 's' : ''}
              </span>
            )}
          </>
        )}
      </div>

      {/* ── Admin control bar ───────────────────────────────────────────── */}
      {tab === 'active' && !isLoading && (selectableRows.length > 0 || (canTerminate && activeSessions.length > 0)) && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-xs text-indigo-800">
          {selectableRows.length > 0 && (
            <label className="flex cursor-pointer items-center gap-2 font-medium">
              <Checkbox checked={allVisibleSelected} onCheckedChange={toggleSelectAll} aria-label="Select all" />
              {selected.size > 0 ? `${selected.size} selected` : 'Select all'}
            </label>
          )}
          {selected.size > 0 && (
            <>
              <Button
                size="sm"
                onClick={() => setPending({ kind: 'terminate', sessions: selectedSessions })}
                className="h-7 gap-1.5 bg-rose-600 text-xs text-white hover:bg-rose-700"
              >
                <LogOut className="h-3.5 w-3.5" /> Sign out selected
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} className="h-7 text-xs">
                Clear
              </Button>
            </>
          )}
          {canTerminate && (
            <div className="ml-auto flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={summary.sweepable.length === 0}
                onClick={() => setPending({ kind: 'sweep', sessions: summary.sweepable })}
                className="h-7 gap-1.5 bg-white text-xs"
              >
                <Sparkles className="h-3.5 w-3.5 text-amber-500" /> Clean up stale ({summary.sweepable.length})
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={activeSessions.filter((s) => s.id !== currentSessionId).length === 0}
                onClick={() => setPending({ kind: 'terminate-all', sessions: activeSessions.filter((s) => s.id !== currentSessionId) })}
                className="h-7 gap-1.5 border-rose-200 bg-white text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700"
              >
                <ShieldAlert className="h-3.5 w-3.5" /> Sign out everyone
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ── Body ────────────────────────────────────────────────────────── */}
      {tab === 'policy' ? (
        <PolicyPanel policy={policy} canEdit={canEditPolicy} onSave={savePolicy} />
      ) : isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-36 w-full rounded-xl" />)}
        </div>
      ) : userGroups.length === 0 ? (
        <EmptyState
          icon={tab === 'active'
            ? <Globe className="h-12 w-12 text-muted-foreground/30" />
            : <History className="h-12 w-12 text-muted-foreground/30" />}
          title={tab === 'active' ? 'No active sessions' : 'No session history'}
          body={tab === 'active'
            ? (search || presenceFilter !== 'all' || deviceFilter !== 'all' ? 'No sessions match these filters.' : 'There are currently no active login sessions.')
            : 'Ended sessions will appear here.'}
        />
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
            <span>
              {userGroups.length} user{userGroups.length !== 1 ? 's' : ''} · {displayRows.length} session{displayRows.length !== 1 ? 's' : ''} — click a user to see their sessions
            </span>
            <button
              type="button"
              onClick={() => setExpandedUsers(allExpanded ? new Set() : new Set(userGroups.map((g) => g.id)))}
              className="font-medium text-indigo-600 hover:underline"
            >
              {allExpanded ? 'Collapse all' : 'Expand all'}
            </button>
          </div>
          <div className="rounded-xl border bg-white/90 shadow-sm">
            <DataList
              dense
              rows={userGroups}
              columns={userColumns}
              maxHeightClassName="sm:max-h-[75vh]"
              onRowClick={toggleExpand}
              expandedIds={expandedUsers}
              rowClassName={(g) =>
                g.sessions.some((s) => selected.has(s.id))
                  ? 'bg-rose-50/70'
                  : g.userId === user.id
                    ? 'bg-indigo-50/60'
                    : undefined
              }
              renderExpanded={(g) => (
                <div className="rounded-lg border border-indigo-100 bg-indigo-50/30 p-2 sm:ml-6">
                  <DataList
                    dense
                    rows={g.sessions}
                    columns={columns}
                    rowClassName={(s) =>
                      selected.has(s.id)
                        ? 'bg-rose-50/70'
                        : s.id === currentSessionId
                          ? 'bg-indigo-50/60'
                          : !s.isActive
                            ? 'text-slate-500'
                            : undefined
                    }
                  />
                </div>
              )}
            />
          </div>
          {tab === 'history' && historySessions.length >= historyLimit && (
            <div className="flex justify-center pt-1">
              <Button variant="outline" size="sm" className="bg-white" onClick={() => setHistoryLimit((n) => n + HISTORY_PAGE)}>
                Load more history
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ── Confirm dialog ─────────────────────────────────────────────── */}
      <AlertDialog open={!!pending} onOpenChange={(open) => { if (!open && !isWorking) setPending(null); }}>
        <AlertDialogContent className="max-w-md overflow-hidden p-0">
          <div className="h-1 w-full bg-gradient-to-r from-rose-500 to-red-600" />
          <div className="px-6 pb-2 pt-5">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2 text-base">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rose-100">
                  <LogOut className="h-4 w-4 text-rose-600" />
                </div>
                {dialog?.title}
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="mt-3 space-y-3 text-sm">
                  <span className="block text-slate-600">{dialog?.body}</span>
                  {dialog && dialog.sessions.length > 0 && (
                    <div className="max-h-56 space-y-2 overflow-y-auto rounded-xl border border-rose-100 bg-rose-50 p-3">
                      {dialog.sessions.slice(0, 6).map((s) => (
                        <div key={s.id} className="flex items-center gap-2">
                          <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white bg-gradient-to-br', avatarGradient(s.userName))}>
                            {getInitials(s.userName)}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold text-rose-800">{s.userName || s.userEmail}</p>
                            <p className="flex items-center gap-1 truncate text-[11px] text-rose-600">
                              <DeviceIcon type={s.deviceType} size="sm" /> {s.deviceLabel}
                              {s.ipAddress && ` · ${s.ipAddress}`}
                              {s.city && ` · ${s.city}`}
                            </p>
                          </div>
                        </div>
                      ))}
                      {dialog.sessions.length > 6 && (
                        <p className="text-[11px] font-medium text-rose-700">+ {dialog.sessions.length - 6} more</p>
                      )}
                    </div>
                  )}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
          </div>
          <AlertDialogFooter className="px-6 pb-5">
            <AlertDialogCancel disabled={isWorking} className="bg-white hover:bg-slate-50">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void runPending(); }}
              disabled={isWorking}
              className="bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-500 gap-1.5"
            >
              {isWorking ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
              {isWorking ? 'Working…' : dialog?.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EmptyState({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-20 text-center">
        {icon}
        <p className="text-sm font-medium text-slate-600">{title}</p>
        <p className="text-xs text-muted-foreground">{body}</p>
      </CardContent>
    </Card>
  );
}
