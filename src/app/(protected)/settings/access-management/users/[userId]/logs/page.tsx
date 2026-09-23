'use client';

/**
 * `/settings/access-management/users/[userId]/logs` — one user's activity trail.
 *
 * This screen came across from the old User Management module when that was merged into Access
 * Management, and arrived wearing the old module's clothes: a bare page, a default Card, a table
 * with no shell. It now uses the same chrome as the rest of the module — the filled shell, the
 * scrolling frame, `HrDataList` for the responsive table.
 *
 * ── What this is *not* ─────────────────────────────────────────────────────────────────────────
 *
 * Not the access audit trail. That is `AuditHistory`, reads `accessAuditLogs`, and carries the
 * before/after permission pairs for every grant and revoke. This reads `userLogs` — sign-ins,
 * sign-outs, and user-record edits — which is a different question ("what has this person been
 * doing") from "who changed their access and to what". Both are linked from the profile.
 */

import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { FilePen, FilePlus, History, LogIn, LogOut } from 'lucide-react';
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import type { User } from '@/lib/types';
import { HrDataList, HrEmptyState, type HrListColumn } from '@/components/hr/hr-ui';
import { AccessCard, AccessPageShell, ACCESS_SCROLL_FRAME_CLASS } from '@/components/access-management/access-ui';

type UserLog = {
  id: string;
  action: 'Login' | 'Logout' | 'Create User' | 'Update User' | string;
  timestamp: any;
  details: Record<string, any>;
};

/** One tone per action, so a long trail is scannable by colour before it is read. */
const ACTION_TONE: Record<string, { icon: React.ElementType; className: string }> = {
  Login: { icon: LogIn, className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  Logout: { icon: LogOut, className: 'border-slate-200 bg-slate-50 text-slate-600' },
  'Create User': { icon: FilePlus, className: 'border-sky-200 bg-sky-50 text-sky-700' },
  'Update User': { icon: FilePen, className: 'border-amber-200 bg-amber-50 text-amber-700' },
};

function ActionBadge({ action }: { action: string }) {
  const tone = ACTION_TONE[action];
  const Icon = tone?.icon ?? History;
  return (
    <Badge
      variant="outline"
      className={`gap-1 whitespace-nowrap text-[11px] ${tone?.className ?? 'border-slate-200 bg-white text-slate-600'}`}
    >
      <Icon className="h-3 w-3" />
      {action}
    </Badge>
  );
}

/** `key: value · key: value`, or an em dash. Details are free-form, so nothing is assumed. */
function detailText(details: Record<string, any>): string {
  const entries = Object.entries(details ?? {});
  if (!entries.length) return '—';
  return entries.map(([key, value]) => `${key}: ${value}`).join(' · ');
}

export default function UserLogsPage() {
  const params = useParams<{ userId: string }>();
  const userId = String(params?.userId ?? '');
  const [user, setUser] = useState<User | null>(null);
  const [logs, setLogs] = useState<UserLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;

    const fetchUserDataAndLogs = async () => {
      setIsLoading(true);
      try {
        const userDocSnap = await getDoc(doc(db, 'users', userId));
        if (userDocSnap.exists()) setUser({ id: userDocSnap.id, ...userDocSnap.data() } as User);

        // No `orderBy` in the query, so this needs no composite index on (userId, timestamp) —
        // one user's trail is small enough to sort in memory.
        const logsSnapshot = await getDocs(query(collection(db, 'userLogs'), where('userId', '==', userId)));
        const logsData = logsSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }) as UserLog);
        logsData.sort((a, b) => b.timestamp.toDate() - a.timestamp.toDate());
        setLogs(logsData);
      } catch (error: any) {
        console.error('Error fetching user logs:', error);
      }
      setIsLoading(false);
    };

    void fetchUserDataAndLogs();
  }, [userId]);

  const columns: HrListColumn<UserLog>[] = useMemo(
    () => [
      {
        header: 'Action',
        cell: (log) => <ActionBadge action={log.action} />,
        mobile: 'title',
      },
      {
        header: 'Details',
        cell: (log) => (
          <span className="block max-w-xl truncate text-muted-foreground" title={detailText(log.details)}>
            {detailText(log.details)}
          </span>
        ),
        mobile: 'detail',
      },
      {
        header: 'When',
        align: 'right',
        cell: (log) => (
          <span className="whitespace-nowrap tabular-nums text-muted-foreground">
            {log.timestamp ? format(log.timestamp.toDate(), 'dd MMM yyyy, HH:mm') : '—'}
          </span>
        ),
        mobile: 'aside',
      },
    ],
    [],
  );

  return (
    <AccessPageShell
      fill
      backHref={`/settings/access-management/users/${userId}`}
      backLabel="Back to access profile"
    >
      <div className="flex shrink-0 flex-col gap-1 pb-3">
        {isLoading ? (
          <Skeleton className="h-7 w-52" />
        ) : (
          <h1 className="break-words text-lg font-semibold tracking-tight text-slate-800 sm:text-xl">
            Activity · {user?.name || user?.email || 'User'}
          </h1>
        )}
        <p className="hidden text-sm text-muted-foreground sm:block">
          Sign-ins, sign-outs and edits to this user's record. Access grants and revokes are on the
          profile's History tab.
        </p>
      </div>

      <div className={ACCESS_SCROLL_FRAME_CLASS}>
        <AccessCard>
          <CardHeader className="px-4 py-3">
            <CardTitle className="text-sm">Activity log</CardTitle>
            <CardDescription className="text-xs">
              {isLoading ? 'Loading…' : `${logs.length} ${logs.length === 1 ? 'entry' : 'entries'}, newest first.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full rounded-lg" />
                ))}
              </div>
            ) : (
              // The module's responsive register: a real table from `sm` up, stacked cards below
              // it, from one column spec — rather than the two hand-written copies of the same
              // three fields this page used to carry.
              <HrDataList
                rows={logs}
                columns={columns}
                empty={
                  <HrEmptyState
                    icon={History}
                    title="No activity yet"
                    description="Nothing has been recorded against this user. Sign-ins and record edits will appear here."
                  />
                }
              />
            )}
          </CardContent>
        </AccessCard>
      </div>
    </AccessPageShell>
  );
}
