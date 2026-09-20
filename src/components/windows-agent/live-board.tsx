'use client';

import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, WifiOff } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  HrAccessDenied,
  HrDataList,
  HrEmptyState,
  HrKpiCard,
  HrLoader,
  HrPageHeader,
  type HrListColumn,
} from '@/components/hr/hr-ui';
import { WINDOWS_AGENT_ROUTES } from '@/lib/windows-agent';
import {
  canViewActivityOf,
  canViewLiveBoard,
  evaluateAgentHealth,
  resolvePresence,
  type PresenceState,
  type WindowsDevice,
  type WindowsHeartbeat,
  type WindowsSession,
} from '@/lib/windows-agent';
import {
  listenToDevices,
  listenToHeartbeats,
  listenToOpenSessions,
} from '@/lib/windows-agent-service';
import { useTickingNow, useWindowsAgent } from './hooks';
import {
  ClockTime,
  Duration,
  MeasurementNotice,
  PersonCell,
  PresenceBadge,
  RelativeTime,
} from './ui';

/**
 * §17's live board: who is signed in, on what, doing what, right now.
 *
 * ── This is the most sensitive screen in the application ───────────────────────────────────────
 *
 * It shows, in real time, the name of the program every colleague currently has on screen. §17
 * says not to expose it to ordinary users and to require a specific permission, and that is
 * enforced twice — the sidebar hides the link, and this component refuses to subscribe at all
 * without `Windows Agent.Live Users` `View`. The second check is the one that matters: a hidden
 * link is not access control, and the listeners are what would actually stream the data to a
 * browser.
 *
 * ── Why three listeners and not one ────────────────────────────────────────────────────────────
 *
 * Heartbeats, open sessions and devices are three collections because they change at three
 * different rates and mean three different things. The heartbeat is the freshest fact and is
 * overwritten in place; the session carries the day's accumulated totals; the device carries the
 * administrator's view of the machine. Joining them here — in the browser, over at most a few
 * hundred small documents — is cheaper than denormalising all of it onto one document that every
 * agent would then rewrite every ninety seconds.
 *
 * ── Presence is recomputed, never trusted ──────────────────────────────────────────────────────
 *
 * A row shows what `resolvePresence` says, not what the last heartbeat claimed. A PC that said
 * ACTIVE and then went quiet is offline, and a board that kept showing it as active would stop
 * being believed — which is the only thing a live board has going for it.
 */
export default function LiveBoard() {
  const { viewer, directoryById, loading } = useWindowsAgent();
  const now = useTickingNow(10_000);

  const allowed = canViewLiveBoard(viewer);

  const [heartbeats, setHeartbeats] = useState<WindowsHeartbeat[]>([]);
  const [sessions, setSessions] = useState<WindowsSession[]>([]);
  const [devices, setDevices] = useState<WindowsDevice[]>([]);
  const [subscribed, setSubscribed] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!allowed) return;
    const stops = [
      listenToHeartbeats(setHeartbeats),
      listenToOpenSessions(setSessions),
      listenToDevices(setDevices),
    ];
    setSubscribed(true);
    return () => {
      stops.forEach((stop) => stop());
      setSubscribed(false);
    };
  }, [allowed]);

  const rows = useMemo(() => {
    if (!allowed) return [];

    const beatsByDevice = new Map(heartbeats.map((beat) => [beat.deviceId, beat]));
    const devicesById = new Map(devices.map((device) => [device.id, device]));

    return sessions
      .map((session) => {
        const beat = beatsByDevice.get(session.deviceId) ?? null;
        const device = devicesById.get(session.deviceId) ?? null;
        const person = directoryById.get(session.userId);

        const lastHeartbeat = beat?.receivedAt ? new Date(beat.receivedAt) : null;
        const presence = resolvePresence(lastHeartbeat, beat?.presence ?? null, {
          // The device's own policy is not loaded here; the default interval is the right
          // assumption for a staleness check and is generous rather than eager.
          heartbeatIntervalSeconds: 90,
          now,
        });

        const health = device
          ? evaluateAgentHealth({
              status: device.status,
              lastHeartbeatAt: lastHeartbeat,
              agentVersion: device.agentVersion,
              latestVersion: null,
              queuedSpanCount: beat?.queuedSpanCount ?? 0,
              clockSkewSeconds: beat?.clockSkewSeconds ?? 0,
              heartbeatIntervalSeconds: 90,
              now,
            })
          : [];

        return {
          id: session.id,
          userId: session.userId,
          userName: session.userName,
          departmentId: session.departmentId,
          departmentName: session.departmentName ?? person?.departmentName ?? null,
          deviceId: session.deviceId,
          deviceName: session.deviceName,
          loginAt: session.loginAt,
          presence,
          currentApplication: beat?.applicationName ?? session.currentApplicationName ?? null,
          activeSeconds: session.activeSeconds,
          idleSeconds: session.idleSeconds + session.extendedIdleSeconds,
          lastSeen: lastHeartbeat,
          health,
        };
      })
      // Scope, applied to rows here because the subscription is collection-wide — a query cannot
      // be narrowed by department when the listener has to see every open session to be live.
      // The rows a viewer may not see never reach the table; they do reach the browser, which is
      // why `View Live Users` is a deliberately narrow grant.
      .filter((row) => canViewActivityOf(viewer, { userId: row.userId, departmentId: row.departmentId }))
      .filter((row) => {
        if (!search.trim()) return true;
        const needle = search.trim().toLowerCase();
        return (
          row.userName.toLowerCase().includes(needle) ||
          row.deviceName.toLowerCase().includes(needle) ||
          (row.currentApplication ?? '').toLowerCase().includes(needle) ||
          (row.departmentName ?? '').toLowerCase().includes(needle)
        );
      })
      .sort((left, right) => left.userName.localeCompare(right.userName));
  }, [allowed, heartbeats, sessions, devices, directoryById, viewer, now, search]);

  const counts = useMemo(() => {
    const byPresence = (state: PresenceState) => rows.filter((row) => row.presence === state).length;
    return {
      online: rows.filter((row) => row.presence !== 'OFFLINE').length,
      working: byPresence('ACTIVE'),
      idle: byPresence('IDLE') + byPresence('EXTENDED_IDLE'),
      locked: byPresence('LOCKED'),
      offline: byPresence('OFFLINE'),
      late: rows.filter((row) => sessions.find((s) => s.id === row.id)?.lateLogin).length,
      unhealthy: rows.filter((row) => row.health.length > 0).length,
    };
  }, [rows, sessions]);

  if (loading) return <HrLoader label="Loading the live board" />;
  if (!allowed) return <HrAccessDenied what="the live user board" />;

  type Row = (typeof rows)[number];

  const columns: HrListColumn<Row>[] = [
    {
      header: 'Employee',
      mobile: 'title',
      cell: (row) => (
        <PersonCell
          userId={row.userId}
          name={row.userName}
          department={row.departmentName}
          href={WINDOWS_AGENT_ROUTES.user(row.userId)}
        />
      ),
    },
    {
      header: 'Device',
      className: 'hidden md:table-cell',
      mobile: 'detail',
      cell: (row) => (
        <span className="text-sm text-muted-foreground">{row.deviceName}</span>
      ),
    },
    {
      header: 'Login',
      className: 'hidden lg:table-cell',
      mobile: 'detail',
      cell: (row) => <ClockTime value={row.loginAt} />,
    },
    {
      header: 'Status',
      mobile: 'aside',
      cell: (row) => <PresenceBadge presence={row.presence} />,
    },
    {
      header: 'In foreground',
      mobile: 'detail',
      cell: (row) =>
        row.presence === 'OFFLINE' || row.presence === 'LOCKED' ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className="text-sm">{row.currentApplication ?? '—'}</span>
        ),
    },
    {
      header: 'Active today',
      align: 'right',
      mobile: 'detail',
      cell: (row) => <Duration seconds={row.activeSeconds} />,
    },
    {
      header: 'Idle today',
      align: 'right',
      className: 'hidden lg:table-cell',
      mobile: 'detail',
      cell: (row) => <Duration seconds={row.idleSeconds} muted />,
    },
    {
      header: 'Last seen',
      align: 'right',
      mobile: 'footer',
      cell: (row) => (
        <span className="flex items-center justify-end gap-2">
          {row.health.length > 0 ? (
            <Badge
              variant="outline"
              className="border-amber-200 bg-amber-50 text-amber-700"
              title={row.health.join(', ')}
            >
              <WifiOff className="mr-1 h-3 w-3" aria-hidden />
              {row.health.length}
            </Badge>
          ) : null}
          <RelativeTime value={row.lastSeen} now={now} />
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <HrPageHeader
        title="Live users"
        description="Open work sessions across the fleet, refreshed as the agents report."
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <HrKpiCard label="Online" value={counts.online} tone="emerald" />
        <HrKpiCard label="Working" value={counts.working} tone="emerald" />
        <HrKpiCard label="Idle" value={counts.idle} tone="amber" />
        <HrKpiCard label="Locked" value={counts.locked} tone="slate" />
        <HrKpiCard label="Offline" value={counts.offline} tone="slate" />
        <HrKpiCard label="Agent problems" value={counts.unhealthy} tone={counts.unhealthy ? 'rose' : 'slate'} />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <RefreshCw
              className={subscribed ? 'h-4 w-4 animate-spin text-emerald-600' : 'h-4 w-4 text-muted-foreground'}
              style={subscribed ? { animationDuration: '3s' } : undefined}
              aria-hidden
            />
            {rows.length} {rows.length === 1 ? 'session' : 'sessions'}
          </CardTitle>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filter by name, device, department or program"
            className="max-w-xs"
          />
        </CardHeader>
        <CardContent>
          <HrDataList
            rows={rows}
            columns={columns}
            dense
            cardHref={(row) => WINDOWS_AGENT_ROUTES.user(row.userId)}
            empty={
              <HrEmptyState
                title="Nobody is signed in"
                description={
                  search
                    ? 'No open session matches that filter.'
                    : 'Open sessions appear here as agents sign in. If you expected somebody, check the Devices page for agent health.'
                }
              />
            }
          />
        </CardContent>
      </Card>

      <MeasurementNotice />
    </div>
  );
}
