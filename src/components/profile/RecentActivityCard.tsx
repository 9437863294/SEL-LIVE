'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { onAuthStateChanged } from 'firebase/auth';
import { AlertCircle, History, Loader2, RotateCw } from 'lucide-react';

import { auth } from '@/lib/firebase';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  PROFILE_ACTIVITY_DEFAULT_LIMIT,
  type ProfileActivityResponse,
  type ProfileActivityRow,
  type ProfileActivitySource,
} from './activity-format';

type Phase = 'loading' | 'ready' | 'error';

interface ActivityState {
  phase: Phase;
  rows: ProfileActivityRow[];
  nextCursor: string | null;
  approximate: boolean;
  error: string | null;
}

const INITIAL: ActivityState = { phase: 'loading', rows: [], nextCursor: null, approximate: false, error: null };

const SIGNED_OUT = 'Sign in again to see your activity.';

async function fetchActivityPage(cursor: string | null): Promise<ProfileActivityResponse> {
  const user = auth.currentUser;
  if (!user) throw new Error(SIGNED_OUT);
  const token = await user.getIdToken();
  const params = new URLSearchParams({ limit: String(PROFILE_ACTIVITY_DEFAULT_LIMIT) });
  if (cursor) params.set('cursor', cursor);
  const response = await fetch(`/api/profile/activity?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const body = (await response.json().catch(() => ({}))) as Partial<ProfileActivityResponse> & { error?: string };
  if (!response.ok) throw new Error(body.error || `The server answered ${response.status}.`);
  return { rows: body.rows ?? [], nextCursor: body.nextCursor ?? null, approximate: Boolean(body.approximate) };
}

const errorText = (error: unknown) =>
  error instanceof Error && error.message ? error.message : 'Your activity could not be loaded.';

/** Rows can repeat across pages when two share a timestamp and the index was unavailable. */
function appendUnique(current: ProfileActivityRow[], next: ProfileActivityRow[]): ProfileActivityRow[] {
  const seen = new Set(current.map((row) => row.id));
  return [...current, ...next.filter((row) => !seen.has(row.id))];
}

const SOURCE_NOTE: Partial<Record<ProfileActivitySource, string>> = {
  cron: 'Scheduled job',
  webhook: 'Webhook',
};

function ActivityTime({ at }: { at: string | null }) {
  const date = at ? new Date(at) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return <span className="shrink-0 text-xs text-muted-foreground">Time unknown</span>;
  }
  const exact = date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <time dateTime={at ?? undefined} title={exact} className="shrink-0 text-xs text-muted-foreground">
      {formatDistanceToNow(date, { addSuffix: true })}
      <span className="sr-only"> ({exact})</span>
    </time>
  );
}

function ActivityItem({ row, isLast }: { row: ProfileActivityRow; isLast: boolean }) {
  const meta = [row.device, row.ipAddress, SOURCE_NOTE[row.source]].filter(Boolean) as string[];
  return (
    <li className={cn('relative flex gap-3', !isLast && 'pb-4')}>
      {/* The rail joining this dot to the next one. */}
      {!isLast && <span aria-hidden="true" className="absolute bottom-0 left-[5px] top-4 w-px bg-border" />}
      <span aria-hidden="true" className="relative mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full border-2 border-primary bg-card" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <p className="min-w-0 break-words text-sm font-medium leading-snug text-foreground">{row.action}</p>
          <ActivityTime at={row.at} />
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <Badge variant="secondary" className="max-w-full px-2 py-0 text-[11px] font-medium">
            <span className="truncate">{row.module}</span>
          </Badge>
          {row.summary && <span className="min-w-0 truncate text-xs text-muted-foreground">{row.summary}</span>}
        </div>
        {meta.length > 0 && (
          <p className="break-words text-xs text-muted-foreground">
            {meta.map((part, index) => (
              <span key={index}>
                {index > 0 && <span aria-hidden="true"> · </span>}
                <span className={part === row.ipAddress ? 'tabular-nums' : undefined}>{part}</span>
              </span>
            ))}
          </p>
        )}
      </div>
    </li>
  );
}

function ActivitySkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="flex gap-3">
          <Skeleton className="mt-1 h-3 w-3 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <div className="flex justify-between gap-3">
              <Skeleton className="h-4 w-2/3 max-w-[14rem]" />
              <Skeleton className="h-3 w-16" />
            </div>
            <Skeleton className="h-4 w-24 rounded-full" />
            <Skeleton className="h-3 w-40" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The signed-in user's own recent actions, from the same audit trail administrators review — so
 * someone can spot activity they do not recognise. Reads `GET /api/profile/activity`, which only
 * ever returns the caller's rows, with `details` withheld and IP addresses masked.
 */
export function RecentActivityCard({ className }: { className?: string }) {
  const [state, setState] = useState<ActivityState>(INITIAL);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  // Bumped by every fresh load, so a slower response from an earlier one is dropped.
  const generation = useRef(0);

  const loadFirstPage = useCallback(async () => {
    const ticket = ++generation.current;
    setState((current) => ({ ...current, phase: 'loading', error: null }));
    setLoadingMore(false);
    setMoreError(null);
    try {
      const page = await fetchActivityPage(null);
      if (ticket !== generation.current) return;
      setState({ phase: 'ready', rows: page.rows, nextCursor: page.nextCursor, approximate: page.approximate, error: null });
    } catch (error) {
      if (ticket !== generation.current) return;
      setState((current) => ({ ...current, phase: 'error', error: errorText(error) }));
    }
  }, []);

  useEffect(
    () =>
      // Wait for Firebase to restore the session before asking for a token.
      onAuthStateChanged(auth, (user) => {
        if (user) {
          void loadFirstPage();
        } else {
          generation.current += 1;
          setState({ ...INITIAL, phase: 'error', error: SIGNED_OUT });
        }
      }),
    [loadFirstPage],
  );

  const loadMore = async () => {
    if (!state.nextCursor || loadingMore) return;
    const ticket = generation.current;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await fetchActivityPage(state.nextCursor);
      if (ticket !== generation.current) return;
      setState((current) => ({
        ...current,
        rows: appendUnique(current.rows, page.rows),
        nextCursor: page.nextCursor,
        approximate: current.approximate || page.approximate,
      }));
    } catch (error) {
      if (ticket === generation.current) setMoreError(errorText(error));
    } finally {
      if (ticket === generation.current) setLoadingMore(false);
    }
  };

  const { phase, rows, nextCursor, approximate, error } = state;

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <CardTitle className="text-base">Recent activity</CardTitle>
        </div>
        <CardDescription>What you have done in SEL Live recently, newest first.</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4" aria-busy={phase === 'loading' || loadingMore}>
        {phase === 'loading' ? (
          <>
            <span className="sr-only" role="status">Loading your recent activity…</span>
            <ActivitySkeleton />
          </>
        ) : phase === 'error' ? (
          <div role="alert" className="flex flex-col items-start gap-3 rounded-md border border-destructive/40 p-3 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
              <p className="min-w-0 break-words text-sm text-foreground">{error}</p>
            </div>
            {error !== SIGNED_OUT && (
              <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => void loadFirstPage()}>
                <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
                Retry
              </Button>
            )}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-md border border-dashed px-4 py-8 text-center">
            <History className="h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
            <p className="text-sm font-medium text-foreground">No activity recorded yet</p>
            <p className="text-xs text-muted-foreground">Actions you take across SEL Live will appear here.</p>
          </div>
        ) : (
          <>
            <ol aria-label="Your recent activity" className="min-w-0">
              {rows.map((row, index) => (
                <ActivityItem key={row.id} row={row} isLast={index === rows.length - 1} />
              ))}
            </ol>

            {approximate && (
              <p className="text-xs text-muted-foreground">
                The order shown may be approximate, and some older entries may be missing, while the
                activity index is being built.
              </p>
            )}

            {moreError && (
              <p role="alert" className="flex items-start gap-1.5 text-xs text-destructive">
                <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 break-words">{moreError}</span>
              </p>
            )}

            {nextCursor && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full gap-1.5 sm:w-auto"
                onClick={() => void loadMore()}
                disabled={loadingMore}
              >
                {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                {loadingMore ? 'Loading…' : moreError ? 'Try again' : 'Load more'}
              </Button>
            )}
          </>
        )}

        <p className="border-t pt-3 text-xs text-muted-foreground">
          Something you don&apos;t recognise? Change your password and{' '}
          <Link
            href="/settings/session-management"
            className="font-medium text-primary underline-offset-4 hover:underline focus-visible:underline"
          >
            review your sessions
          </Link>
          .
        </p>
      </CardContent>
    </Card>
  );
}
