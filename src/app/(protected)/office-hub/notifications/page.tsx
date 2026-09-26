'use client';

/**
 * The notification centre (§32).
 *
 * ── Why this exists when the header already has a bell ─────────────────────────────────────────
 *
 * The app's header bell is a live dropdown of the most recent unread notifications — the right
 * thing for "what just happened". §32 asks for something else: a page with the whole history,
 * grouped into All / Meetings / Tasks / Teams / Decisions / System, with mark-as-read and
 * mark-all-read.
 *
 * So this reads the *same* `userNotifications` collection the bell reads, filtered to this module,
 * and does not invent a second inbox. Marking something read here marks it read in the bell,
 * because there is only one record.
 */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  BellOff,
  CalendarDays,
  CheckCheck,
  CheckSquare,
  Gavel,
  Inbox,
  Settings as SettingsIcon,
  Users,
} from 'lucide-react';
import {
  collection,
  limit as fsLimit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import {
  markAllNotificationsReadForUser,
  markNotificationsRead,
  normalizeNotification,
  type NormalizedNotification,
} from '@/lib/notifications';
import { OFFICE_HUB_BASE_PATH, formatRelativeToNow } from '@/lib/office-hub';
import { useOfficeHub, useOfficeHubAction } from '@/components/office-hub/hooks';
import {
  OfficeHubEmptyState,
  OfficeHubPageHeader,
} from '@/components/office-hub/ui';

type Group = 'all' | 'meetings' | 'tasks' | 'teams' | 'decisions' | 'system';

/**
 * Which tab a notification belongs in.
 *
 * Keyed on the type string this module writes (`office_hub_meeting_invitation` and friends), so a
 * type added later lands in `system` rather than disappearing — an unrecognised notification the
 * user cannot find is worse than one in the wrong tab.
 */
function groupOf(type: string): Exclude<Group, 'all'> {
  if (type.includes('meeting') || type.includes('mom')) return 'meetings';
  if (type.includes('task')) return 'tasks';
  if (type.includes('team')) return 'teams';
  if (type.includes('decision') || type.includes('action_item')) return 'decisions';
  return 'system';
}

const GROUP_ICON: Record<Exclude<Group, 'all'>, React.ElementType> = {
  meetings: CalendarDays,
  tasks: CheckSquare,
  teams: Users,
  decisions: Gavel,
  system: Bell,
};

export default function NotificationsPage() {
  const { actor, isLoading } = useOfficeHub();
  const { isBusy, run } = useOfficeHubAction();

  const [rows, setRows] = useState<NormalizedNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [group, setGroup] = useState<Group>('all');
  const [error, setError] = useState<string | null>(null);

  /**
   * A live listener, because this is an inbox.
   *
   * Filtered on `module` so it shows Office Hub's notifications and not the whole app's — the
   * header bell is the place for everything. That needs a composite index on
   * `(userId, module, createdAt)`, which is in `firestore.indexes.json`.
   */
  useEffect(() => {
    if (!actor) return;
    setLoading(true);

    const unsubscribe = onSnapshot(
      query(
        collection(db, 'userNotifications'),
        where('userId', '==', actor.userId),
        where('module', '==', ACTIVITY_MODULES.OFFICE_HUB),
        orderBy('createdAt', 'desc'),
        fsLimit(200),
      ),
      (snapshot) => {
        setRows(snapshot.docs.map((entry) => normalizeNotification(entry.id, entry.data())));
        setLoading(false);
        setError(null);
      },
      (listenerError) => {
        console.error('[office-hub] Notification listener error', listenerError);
        // The commonest cause is the composite index not being deployed yet, and the generic
        // Firestore message does not say so — which is how this turns into "notifications are
        // broken" rather than "one index is missing".
        setError(
          'Your notifications could not be loaded. If this is a new installation, the Firestore composite index on userNotifications (userId, module, createdAt) may not be deployed yet.',
        );
        setLoading(false);
      },
    );

    return unsubscribe;
  }, [actor]);

  const counts = useMemo(() => {
    const tally: Record<Group, number> = { all: 0, meetings: 0, tasks: 0, teams: 0, decisions: 0, system: 0 };
    for (const row of rows) {
      if (row.read) continue;
      tally.all += 1;
      tally[groupOf(row.type)] += 1;
    }
    return tally;
  }, [rows]);

  const filtered = useMemo(
    () => (group === 'all' ? rows : rows.filter((row) => groupOf(row.type) === group)),
    [rows, group],
  );

  const markRead = async (ids: string[]) => {
    if (!ids.length) return;
    await run(() => markNotificationsRead(ids), { failure: 'Could not mark those as read' });
  };

  const markAll = async () => {
    if (!actor) return;
    await run(() => markAllNotificationsReadForUser(actor.userId), {
      success: 'All caught up',
      failure: 'Could not mark everything as read',
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <OfficeHubPageHeader
        title="Notifications"
        description="Everything Office Hub has told you. The header bell shows the same records."
        actions={
          <div className="flex flex-wrap gap-2">
            {counts.all > 0 && (
              <Button variant="outline" onClick={() => void markAll()} disabled={isBusy} className="gap-2">
                <CheckCheck className="h-4 w-4" />
                Mark all as read
              </Button>
            )}
            <Button variant="ghost" asChild className="gap-2">
              <Link href={`${OFFICE_HUB_BASE_PATH}/settings`}>
                <SettingsIcon className="h-4 w-4" />
                Preferences
              </Link>
            </Button>
          </div>
        }
      />

      <Tabs value={group} onValueChange={(next) => setGroup(next as Group)}>
        <TabsList className="flex h-auto w-full justify-start gap-1">
          {(['all', 'meetings', 'tasks', 'teams', 'decisions', 'system'] as Group[]).map((entry) => (
            <TabsTrigger key={entry} value={entry} className="text-xs capitalize">
              {entry}
              {counts[entry] > 0 && (
                <Badge
                  variant="outline"
                  className="ml-1.5 border-indigo-200 bg-indigo-50 px-1 text-[10px] tabular-nums text-indigo-700"
                >
                  {counts[entry]}
                </Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {error && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="px-4 py-3">
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : filtered.length === 0 ? (
        <OfficeHubEmptyState
          icon={group === 'all' ? Inbox : GROUP_ICON[group as Exclude<Group, 'all'>]}
          title={group === 'all' ? 'No notifications yet.' : `Nothing in ${group}.`}
          description={
            group === 'all'
              ? 'Invitations, reminders, task assignments and mentions will appear here.'
              : undefined
          }
        />
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-white">
          {filtered.map((row) => {
            const Icon = GROUP_ICON[groupOf(row.type)];
            return (
              <li
                key={row.id}
                className={cn('flex items-start gap-3 px-4 py-3', !row.read && 'bg-indigo-50/40')}
              >
                <span
                  className={cn(
                    'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                    row.severity === 'CRITICAL'
                      ? 'bg-rose-100'
                      : row.severity === 'WARNING'
                        ? 'bg-amber-100'
                        : 'bg-slate-100',
                  )}
                >
                  <Icon
                    className={cn(
                      'h-4 w-4',
                      row.severity === 'CRITICAL'
                        ? 'text-rose-600'
                        : row.severity === 'WARNING'
                          ? 'text-amber-600'
                          : 'text-slate-500',
                    )}
                  />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <p className={cn('min-w-0 break-words text-sm', row.read ? 'text-slate-700' : 'font-semibold text-slate-900')}>
                      {row.title}
                    </p>
                    {!row.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" aria-label="Unread" />}
                  </div>
                  <p className="mt-0.5 break-words text-xs text-muted-foreground">{row.body}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {/*  comes back as a Firestore timestamp shape, not a Date. */}
                    {/* A Firestore timestamp shape, not a Date — hence the seconds conversion. */}
                    {formatRelativeToNow(row.createdAt ? new Date(row.createdAt.seconds * 1000) : null)}
                    {row.itemRef ? ` · ${row.itemRef}` : ''}
                  </p>
                </div>

                <div className="flex shrink-0 flex-col items-end gap-1">
                  {row.link && (
                    <Button
                      size="sm"
                      variant="outline"
                      asChild
                      className="h-7 px-2 text-[11px]"
                      onClick={() => {
                        // Opening it is the acknowledgement; marking it read separately would be a
                        // second click for something the user has just demonstrated.
                        if (!row.read) void markRead([row.id]);
                      }}
                    >
                      <Link href={row.link}>Open</Link>
                    </Button>
                  )}
                  {!row.read && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-1.5 text-[11px]"
                      disabled={isBusy}
                      onClick={() => void markRead([row.id])}
                    >
                      Mark read
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {rows.length > 0 && (
        <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <BellOff className="mt-0.5 h-3 w-3 shrink-0" />
          Getting too many of something? Each kind has its own switch in{' '}
          <Link href={`${OFFICE_HUB_BASE_PATH}/settings`} className="text-indigo-600 hover:underline">
            Settings → My preferences
          </Link>
          . A few — a cancelled meeting, published minutes — deliberately have none.
        </p>
      )}
    </div>
  );
}
