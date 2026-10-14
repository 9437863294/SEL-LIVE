'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, CalendarClock, CheckCircle2, DatabaseZap, History, Info, Loader2,
  RefreshCw, Save, ShieldAlert, XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/shared/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { cn } from '@/lib/utils';
import {
  describeReportingCopySchedule,
  EVERY_HOURS_OPTIONS,
  REPORTING_COPY_RESOURCE,
  WEEKDAY_NAMES,
  type ReportingCopyFrequency,
  type ReportingCopySettingsInput,
} from '@/lib/reporting-copy';
import {
  fetchReportingCopy,
  refreshReportingCopyNow,
  saveReportingCopySettings,
  type ReportingCopyOverview,
} from '@/lib/reporting-copy-client';

/** While a run is going, the screen re-reads its progress this often. */
const POLL_MS = 15_000;

const formatWhen = (iso: string | null | undefined, timeZone: string) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-IN', { timeZone, dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return new Date(iso).toLocaleString();
  }
};

const formatDuration = (seconds: number | null | undefined) => {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

const toSettings = (overview: ReportingCopyOverview): ReportingCopySettingsInput => {
  const { enabled, frequency, everyHours, weekDays, timeOfDay, timezone } = overview.config;
  return { enabled, frequency, everyHours, weekDays, timeOfDay, timezone };
};

export default function ReportingDatabasePage() {
  const { toast } = useToast();
  const { can, isLoading: authzLoading } = useAuthorization();
  const canView = can('View', REPORTING_COPY_RESOURCE);
  const canEdit = can('Edit', REPORTING_COPY_RESOURCE);
  const canRun = can('Run', REPORTING_COPY_RESOURCE);

  const [overview, setOverview] = useState<ReportingCopyOverview | null>(null);
  const [draft, setDraft] = useState<ReportingCopySettingsInput | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  /** Re-read the run while it is going; the draft is left alone so an edit in progress is not lost. */
  const poll = useCallback(async () => {
    try {
      setOverview(await fetchReportingCopy());
    } catch {
      // A missed poll is retried on the next one.
    }
  }, []);

  useEffect(() => {
    if (authzLoading || !canView) return;
    let cancelled = false;
    fetchReportingCopy().then(
      (next) => {
        if (cancelled) return;
        setOverview(next);
        setDraft(toSettings(next));
        setLoadError(null);
      },
      (error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Could not load the reporting database settings.');
      },
    );
    return () => { cancelled = true; };
  }, [authzLoading, canView]);

  const running = Boolean(overview?.state.running);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [running, poll]);

  const update = (patch: Partial<ReportingCopySettingsInput>) => setDraft((current) => (current ? { ...current, ...patch } : current));

  const handleSave = async () => {
    if (!draft || !canEdit) return;
    setIsSaving(true);
    try {
      const next = await saveReportingCopySettings(draft);
      setOverview(next);
      setDraft(toSettings(next));
      toast({ title: 'Schedule saved', description: describeReportingCopySchedule(next.config) });
    } catch (error) {
      toast({ title: 'Could not save', description: error instanceof Error ? error.message : 'Please try again.', variant: 'destructive' });
    }
    setIsSaving(false);
  };

  const handleRefresh = async () => {
    if (!canRun) return;
    setIsRefreshing(true);
    try {
      const result = await refreshReportingCopyNow();
      setOverview(result.overview);
      toast({
        title: result.queued ? 'Refresh started' : 'Already refreshing',
        description: result.queued
          ? result.slice?.ok === false
            ? `The first part failed (${result.slice.error ?? 'unknown error'}); the scheduler retries within 15 minutes.`
            : 'The first part has been copied; the scheduler continues every 15 minutes until it is done.'
          : result.reason,
        variant: result.slice?.ok === false ? 'destructive' : undefined,
      });
    } catch (error) {
      toast({ title: 'Could not start the refresh', description: error instanceof Error ? error.message : 'Please try again.', variant: 'destructive' });
    }
    setIsRefreshing(false);
  };

  if (authzLoading || (canView && !overview && !loadError)) {
    return (
      <div className="px-4 sm:px-5 py-3 space-y-4">
        <Skeleton className="h-10 w-64 rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="px-4 sm:px-5 py-3">
        <PageHeader title="Reporting Database" icon={DatabaseZap} backHref="/settings" backLabel="Back to settings" />
        <Card><CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission to view this page.</CardDescription></CardHeader>
          <CardContent className="flex justify-center p-8"><ShieldAlert className="h-14 w-14 text-destructive" /></CardContent>
        </Card>
      </div>
    );
  }

  const timeZone = overview?.config.timezone || 'Asia/Kolkata';
  const lastRun = overview?.state.lastRun ?? null;
  const progress = overview?.state.progress ?? null;
  const rootCount = progress?.roots?.length ?? 0;
  const percent = rootCount ? Math.min(100, Math.round(((progress?.index ?? 0) / rootCount) * 100)) : 0;
  const dirty = Boolean(overview && draft && JSON.stringify(toSettings(overview)) !== JSON.stringify(draft));

  return (
    <>
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-50/80 via-background to-violet-50/50 dark:from-slate-950/40 dark:via-background dark:to-violet-950/20" />
      </div>

      <div className="px-4 sm:px-5 py-3 space-y-4">
        <PageHeader
          title="Reporting Database"
          description="A copy of the app's data for MongoDB reporting tools, refreshed on a schedule"
          icon={DatabaseZap}
          backHref="/settings"
          backLabel="Back to settings"
          actions={canRun ? (
            <Button onClick={handleRefresh} disabled={isRefreshing || running} className="rounded-full shadow-md">
              {isRefreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              {running ? 'Refreshing…' : 'Refresh now'}
            </Button>
          ) : undefined}
        />

        {loadError && (
          <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0 break-words">{loadError}</span>
          </div>
        )}

        {overview && !overview.configured && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0 break-words">
              The server has no connection string for the reporting database (<code>NEWDATABASE_MONGODB_URI</code>), so a
              refresh would fail. It is set as an App Hosting secret; until then the schedule can be prepared but not run.
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* ── Last refresh ── */}
          <Card className="min-w-0 overflow-hidden">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-cyan-100 dark:bg-cyan-900/40 p-2">
                  <History className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <CardTitle>{running ? 'Refresh in progress' : 'Last refresh'}</CardTitle>
                  <CardDescription className="text-xs">
                    {lastRun ? `${lastRun.trigger === 'manual' ? 'Started by Refresh now' : 'Scheduled'} · ${formatWhen(lastRun.startedAt, timeZone)}` : 'Not refreshed from the app yet'}
                  </CardDescription>
                </div>
                {lastRun && (
                  <Badge variant={lastRun.status === 'succeeded' ? 'success' : lastRun.status === 'failed' ? 'danger' : 'progress'}>
                    {lastRun.status === 'succeeded' ? 'Succeeded' : lastRun.status === 'failed' ? 'Failed' : 'Running'}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {lastRun ? (
                <>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {[
                      { label: 'Documents', value: lastRun.documents.toLocaleString('en-IN') },
                      { label: 'Collections', value: lastRun.collections.toLocaleString('en-IN') },
                      { label: 'Removed', value: lastRun.removed.toLocaleString('en-IN') },
                      { label: 'Started', value: formatWhen(lastRun.startedAt, timeZone) },
                      { label: 'Finished', value: running ? '—' : formatWhen(lastRun.finishedAt, timeZone) },
                      { label: 'Duration', value: running ? 'Running' : formatDuration(lastRun.durationSeconds) },
                    ].map((fact) => (
                      <div key={fact.label} className="min-w-0 rounded-lg border border-border/40 bg-muted/40 p-2.5">
                        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{fact.label}</div>
                        <div className="mt-0.5 truncate text-sm font-semibold" title={fact.value}>{fact.value}</div>
                      </div>
                    ))}
                  </div>

                  {running && progress && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span className="min-w-0 truncate">
                          {progress.roots ? `Collection ${Math.min(progress.index + 1, rootCount)} of ${rootCount}` : 'Listing collections'}
                          {progress.target ? ` · ${progress.target}` : ''}
                        </span>
                        <span className="shrink-0">{percent}%</span>
                      </div>
                      <Progress value={percent} className="h-2" />
                      <div className="text-xs text-muted-foreground">
                        {overview?.state.working ? 'Copying now.' : 'Waiting for the next scheduler tick (every 15 minutes).'}
                        {' '}Part {progress.ticks} of the run.
                      </div>
                      {progress.lastError && (
                        <div className="break-words rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                          Retrying after an error: {progress.lastError}
                        </div>
                      )}
                    </div>
                  )}

                  {!running && lastRun.error && (
                    <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span className="min-w-0 break-words">{lastRun.error}</span>
                    </div>
                  )}
                  {!running && lastRun.status === 'succeeded' && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                      The copy matched the app&apos;s data when this run finished.
                    </div>
                  )}
                </>
              ) : (
                <div className="text-sm text-muted-foreground">
                  No refresh has run from the app yet. {canRun ? 'Use Refresh now, or switch the schedule on.' : ''}
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Schedule ── */}
          <Card className="min-w-0 overflow-hidden">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-cyan-100 dark:bg-cyan-900/40 p-2">
                  <CalendarClock className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <CardTitle>Schedule</CardTitle>
                  <CardDescription className="text-xs">
                    {overview ? describeReportingCopySchedule(overview.config) : '—'}
                    {overview?.nextDueAt ? ` · next ${formatWhen(overview.nextDueAt, timeZone)}` : ''}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            {draft && (
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-muted/40 p-3">
                  <div className="min-w-0">
                    <Label htmlFor="reporting-copy-enabled" className="text-sm font-medium">Scheduled refresh</Label>
                    <div className="text-xs text-muted-foreground">Off: the copy changes only when someone uses Refresh now.</div>
                  </div>
                  <Switch id="reporting-copy-enabled" checked={draft.enabled} disabled={!canEdit} onCheckedChange={(enabled) => update({ enabled })} />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Frequency</Label>
                    <Select value={draft.frequency} disabled={!canEdit} onValueChange={(value) => update({ frequency: value as ReportingCopyFrequency })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="daily">Daily</SelectItem>
                        <SelectItem value="everyHours">Every few hours</SelectItem>
                        <SelectItem value="weekly">Weekly</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {draft.frequency === 'everyHours' && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">Every</Label>
                      <Select value={String(draft.everyHours)} disabled={!canEdit} onValueChange={(value) => update({ everyHours: Number(value) })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {EVERY_HOURS_OPTIONS.map((hours) => (
                            <SelectItem key={hours} value={String(hours)}>{hours === 1 ? '1 hour' : `${hours} hours`}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label htmlFor="reporting-copy-time" className="text-xs">{draft.frequency === 'everyHours' ? 'Starting at' : 'Time'}</Label>
                    <Input id="reporting-copy-time" type="time" value={draft.timeOfDay} disabled={!canEdit} onChange={(event) => update({ timeOfDay: event.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="reporting-copy-zone" className="text-xs">Timezone</Label>
                    <Input id="reporting-copy-zone" value={draft.timezone} disabled={!canEdit} onChange={(event) => update({ timezone: event.target.value })} placeholder="Asia/Kolkata" />
                  </div>
                </div>

                {draft.frequency === 'weekly' && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Days</Label>
                    <div className="flex flex-wrap gap-2">
                      {WEEKDAY_NAMES.map((name, day) => {
                        const on = draft.weekDays.includes(day);
                        return (
                          <button
                            key={name}
                            type="button"
                            disabled={!canEdit}
                            aria-pressed={on}
                            onClick={() => update({ weekDays: on ? draft.weekDays.filter((d) => d !== day) : [...draft.weekDays, day].sort() })}
                            className={cn(
                              'rounded-full border px-3 py-1.5 text-xs font-medium transition-all disabled:opacity-40',
                              on ? 'border-primary bg-primary text-primary-foreground' : 'border-border/60 text-muted-foreground',
                            )}
                          >
                            {name.slice(0, 3)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="text-xs text-muted-foreground">
                  A refresh takes several 15-minute scheduler ticks to copy everything, so a time missed by a late tick still
                  runs on the next one. Refreshing more often than a full copy takes simply starts the next one when it ends.
                </div>

                {canEdit && (
                  <div className="flex justify-end">
                    <Button onClick={handleSave} disabled={isSaving || !dirty} className="rounded-full shadow-md">
                      {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                      Save schedule
                    </Button>
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        </div>

        {/* ── What this is ── */}
        <div className="flex items-start gap-2 rounded-lg border border-border/40 bg-muted/40 p-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
            <div>
              <strong>A one-way copy for MongoDB tools.</strong> Each refresh copies every collection of the app&apos;s
              database into <code>newdatabase</code> (Firestore with MongoDB compatibility), so it can be queried with
              MongoDB Compass, BI connectors or scripts. Records deleted in the app are removed from the copy too.
            </div>
            <div>
              <strong>The app never reads it.</strong> Nothing typed into the copy comes back, and changing it changes
              nothing in the app — it is overwritten by the next refresh.
            </div>
            <div>
              <strong>It holds everything, including personal data</strong> — employee details, salary and identity
              records, mail and credentials. The app&apos;s permissions do not apply to it; only its own database logins
              do. Give reporting users read-only logins, and keep the list short.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
