'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CalendarClock, CheckCircle2, DatabaseZap, History, ListTree, Loader2,
  RefreshCw, Save, Square,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/shared/page-header';
import { useBackNavigation } from '@/hooks/use-back-navigation';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { TableCard } from '@/components/shared/table-card';
import { SettingsAccessDenied, SettingsNotice, SettingsPage, SettingsPageSkeleton, SettingsSection } from '@/components/settings/settings-ui';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableLoading, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { cn } from '@/lib/utils';
import {
  buildReportingCopyHistoryEntry,
  describeReportingCopySchedule,
  EVERY_HOURS_OPTIONS,
  formatReportingCopyPercent,
  REPORTING_COPY_RESOURCE,
  reportingCopyPercent,
  WEEKDAY_NAMES,
  type ReportingCopyFrequency,
  type ReportingCopyHistoryEntry,
  type ReportingCopyRunStatus,
  type ReportingCopySettingsInput,
} from '@/lib/reporting-copy';
import {
  continueReportingCopy,
  fetchReportingCopy,
  fetchReportingCopyHistory,
  refreshReportingCopyNow,
  saveReportingCopySettings,
  stopReportingCopy,
  type ReportingCopyOverview,
} from '@/lib/reporting-copy-client';

/** While a run is going and this screen is not driving it (hidden tab, no Run permission), it re-reads progress this often. */
const POLL_MS = 15_000;
/** After a busy or failed slice, the screen waits this long before asking for the next one. */
const BACKOFF_MS = 5_000;

const STATUS_BADGE: Record<ReportingCopyRunStatus, { variant: 'success' | 'danger' | 'warning' | 'progress'; label: string }> = {
  succeeded: { variant: 'success', label: 'Succeeded' },
  failed: { variant: 'danger', label: 'Failed' },
  stopped: { variant: 'warning', label: 'Stopped' },
  running: { variant: 'progress', label: 'Running' },
};

const count = (value: number | null | undefined) => (value ?? 0).toLocaleString('en-IN');

interface ChangeCounted {
  documents: number;
  inserted?: number;
  updated?: number;
  unchanged?: number;
  restored?: number;
  markedDeleted?: number;
  removed?: number;
}

/** Runs before 2026-10-15 rewrote everything and removed what was gone: they have `removed`, not change counts. */
const hasChangeCounts = (entry: ChangeCounted) => typeof entry.inserted === 'number';

/** New · Changed · Unchanged · Restored, or dashes for an older full-copy run. */
const changeCells = (entry: ChangeCounted) =>
  hasChangeCounts(entry)
    ? [count(entry.inserted), count(entry.updated), count(entry.unchanged), count(entry.restored)]
    : ['—', '—', '—', '—'];

/** Deleted in app: marked in newer runs; removed outright by the older full copies. */
const deletedCell = (entry: ChangeCounted) =>
  hasChangeCounts(entry) ? count(entry.markedDeleted) : `${count(entry.removed)} removed`;

const CHANGE_HEADS = ['New', 'Changed', 'Unchanged', 'Restored'];

/** Whether the tab is in front: the screen copies only while someone can see it. */
function usePageVisible() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible');
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}

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
  const back = useBackNavigation('/settings');
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
  const [isStopping, setIsStopping] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [confirmFull, setConfirmFull] = useState(false);
  const [history, setHistory] = useState<ReportingCopyHistoryEntry[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReportingCopyHistoryEntry | null>(null);
  /** The last slice this screen asked for: busy (someone else is copying) or failed. */
  const [sliceNote, setSliceNote] = useState<string | null>(null);
  const visible = usePageVisible();

  /** Re-read the run while it is going; the draft is left alone so an edit in progress is not lost. */
  const poll = useCallback(async () => {
    try {
      setOverview(await fetchReportingCopy());
    } catch {
      // A missed poll is retried on the next one.
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      setHistory((await fetchReportingCopyHistory()).runs);
      setHistoryError(null);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'Could not load the run history.');
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
    fetchReportingCopyHistory().then(
      ({ runs }) => { if (!cancelled) setHistory(runs); },
      (error) => { if (!cancelled) setHistoryError(error instanceof Error ? error.message : 'Could not load the run history.'); },
    );
    return () => { cancelled = true; };
  }, [authzLoading, canView]);

  const running = Boolean(overview?.state.running);
  /** This screen carries the run on itself while it is open, in front, and allowed to. */
  const driving = running && visible && canRun;

  useEffect(() => {
    if (!running || driving) return;
    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [running, driving, poll]);

  // Back-to-back slices: the next as soon as the last answers, 5 s apart after a busy or failed
  // one. Ends when the run ends, or the tab is hidden or left (the scheduler carries on from there).
  useEffect(() => {
    if (!driving) return;
    let active = true;
    let timer: number | undefined;
    const step = async () => {
      if (!active) return;
      let delay = 0;
      try {
        const result = await continueReportingCopy();
        if (!active) return;
        setOverview(result.overview);
        if (result.busy) {
          setSliceNote('Another part of the run is copying (the scheduler or another open tab); checking again shortly.');
          delay = BACKOFF_MS;
        } else if (!result.slice.ok) {
          setSliceNote(`The last part failed (${result.slice.error ?? 'unknown error'}); retrying.`);
          delay = BACKOFF_MS;
        } else {
          setSliceNote(null);
        }
        if (!result.overview.state.running) {
          setSliceNote(null);
          void loadHistory();
          const status = result.overview.state.lastRun?.status;
          toast({
            title: status === 'succeeded' ? 'Refresh finished' : status === 'stopped' ? 'Refresh stopped' : 'Refresh ended',
            description: result.overview.state.lastRun?.error ?? 'The reporting copy is up to date.',
            variant: status === 'failed' ? 'destructive' : undefined,
          });
          return;
        }
      } catch (error) {
        if (!active) return;
        setSliceNote(`Could not reach the server (${error instanceof Error ? error.message : 'unknown error'}); retrying.`);
        delay = BACKOFF_MS;
      }
      if (active) timer = window.setTimeout(() => void step(), delay);
    };
    void step();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [driving, loadHistory, toast]);

  // A run that ended while this screen was only polling: pick up its history line.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) void loadHistory();
    wasRunning.current = running;
  }, [running, loadHistory]);

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

  const handleRefresh = async (full = false) => {
    if (!canRun) return;
    setIsRefreshing(true);
    try {
      const result = await refreshReportingCopyNow(full);
      setOverview(result.overview);
      toast({
        title: result.queued ? (full ? 'Full refresh started' : 'Refresh started') : 'Already refreshing',
        description: result.queued
          ? result.slice?.ok === false
            ? `The first part failed (${result.slice.error ?? 'unknown error'}); it is retried while this page stays open.`
            : 'Copying continues while this page stays open; otherwise the scheduler carries it on every 15 minutes.'
          : result.reason,
        variant: result.slice?.ok === false ? 'destructive' : undefined,
      });
    } catch (error) {
      toast({ title: 'Could not start the refresh', description: error instanceof Error ? error.message : 'Please try again.', variant: 'destructive' });
    }
    setIsRefreshing(false);
  };

  /** Throws on failure so the confirm dialog stays open for a retry. */
  const handleStop = async () => {
    if (!canRun) return;
    setIsStopping(true);
    try {
      const result = await stopReportingCopy();
      setOverview(result.overview);
      if (result.outcome === 'stopped') void loadHistory();
      toast({
        title: result.outcome === 'nothing' ? 'Nothing to stop' : result.outcome === 'stopped' ? 'Refresh stopped' : 'Stopping',
        description: result.outcome === 'signalled' ? 'The page being copied is finished first; what was copied is kept.' : result.reason,
      });
    } catch (error) {
      toast({ title: 'Could not stop the refresh', description: error instanceof Error ? error.message : 'Please try again.', variant: 'destructive' });
      throw error;
    } finally {
      setIsStopping(false);
    }
  };

  if (!authzLoading && !canView) return <SettingsAccessDenied title="Reporting Database" icon={DatabaseZap} />;
  if (authzLoading || (canView && !overview && !loadError)) return <SettingsPageSkeleton layout="split" />;

  const timeZone = overview?.config.timezone || 'Asia/Kolkata';
  const lastRun = overview?.state.lastRun ?? null;
  const progress = overview?.state.progress ?? null;
  const rootCount = progress?.roots?.length ?? 0;
  const percent = reportingCopyPercent(progress);
  const dirty = Boolean(overview && draft && JSON.stringify(toSettings(overview)) !== JSON.stringify(draft));
  const stopping = Boolean(overview?.state.stopping);
  const startedBy = lastRun
    ? lastRun.trigger === 'manual' ? `Started by ${lastRun.requestedBy || 'Refresh now'}` : 'Scheduled'
    : null;
  // The run in progress heads the history table, with its counts so far.
  const currentEntry = running && lastRun ? buildReportingCopyHistoryEntry(lastRun, progress) : null;
  const historyRows = [
    ...(currentEntry ? [currentEntry] : []),
    ...(history ?? []).filter((entry) => entry.runId !== currentEntry?.runId),
  ];

  return (
    <>
      <SettingsPage>
        <PageHeader
          title="Reporting Database"
          description="A copy of the app's data for MongoDB reporting tools, refreshed on a schedule."
          icon={DatabaseZap}
          backHref={back.href}
          backLabel={back.label}
          onBackClick={back.onClick}
          actions={canRun ? (
            <>
              {running && (
                <Button
                  variant="outline"
                  onClick={() => setConfirmStop(true)}
                  disabled={isStopping || stopping}
                  className="border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
                >
                  {isStopping || stopping ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Square className="mr-2 h-4 w-4" />}
                  {stopping ? 'Stopping…' : 'Stop'}
                </Button>
              )}
              {!running && (
                <Button
                  variant="outline"
                  onClick={() => setConfirmFull(true)}
                  disabled={isRefreshing}
                  title="Look for subcollections again and check every collection for deleted documents"
                >
                  <ListTree className="mr-2 h-4 w-4" />
                  Full refresh
                </Button>
              )}
              <Button onClick={() => void handleRefresh()} disabled={isRefreshing || running}>
                {isRefreshing || running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                {running ? 'Refreshing…' : 'Refresh now'}
              </Button>
            </>
          ) : undefined}
        />

        {loadError && <SettingsNotice tone="danger" title="The reporting database settings did not load">{loadError}</SettingsNotice>}

        {overview && !overview.configured && (
          <SettingsNotice tone="warning" title="Not connected to the reporting database">
            The server has no connection string for it (<code>NEWDATABASE_MONGODB_URI</code>), so a refresh would fail. It is
            set as an App Hosting secret; until then the schedule can be prepared but not run.
          </SettingsNotice>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* ── Last refresh ── */}
          <SettingsSection
            title={running ? 'Refresh in progress' : 'Last refresh'}
            icon={History}
            description={lastRun ? `${startedBy} · ${formatWhen(lastRun.startedAt, timeZone)}` : 'Not refreshed from the app yet'}
            action={
              lastRun ? (
                <Badge variant={STATUS_BADGE[lastRun.status]?.variant ?? 'neutral'}>
                  {stopping ? 'Stopping' : STATUS_BADGE[lastRun.status]?.label ?? lastRun.status}
                </Badge>
              ) : undefined
            }
            contentClassName="space-y-4"
          >
              {lastRun ? (
                <>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {[
                      ...(hasChangeCounts(lastRun)
                        ? [
                          { label: 'Read', value: count(lastRun.documents) },
                          { label: 'New', value: count(lastRun.inserted) },
                          { label: 'Changed', value: count(lastRun.updated) },
                          { label: 'Unchanged', value: count(lastRun.unchanged) },
                          { label: 'Restored', value: count(lastRun.restored) },
                          { label: 'Deleted in app', value: count(lastRun.markedDeleted) },
                        ]
                        : [
                          { label: 'Documents', value: count(lastRun.documents) },
                          { label: 'Removed', value: count(lastRun.removed) },
                          { label: 'Started', value: formatWhen(lastRun.startedAt, timeZone) },
                        ]),
                      { label: 'Collections', value: count(lastRun.collections) },
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
                        <span className="min-w-0 truncate" title={progress.target ?? undefined}>
                          {progress.roots
                            ? `${lastRun.full ? 'Full refresh' : 'Refreshing'}… collection ${Math.min(progress.index + 1, rootCount)} of ${rootCount} · ${count(lastRun.documents)} read, ${count((lastRun.inserted ?? 0) + (lastRun.updated ?? 0) + (lastRun.restored ?? 0))} written so far`
                            : 'Listing collections…'}
                        </span>
                        <span className="shrink-0">{formatReportingCopyPercent(percent)}</span>
                      </div>
                      <Progress value={percent} className="h-2" />
                      {progress.target && (
                        <div className="truncate text-xs text-muted-foreground" title={progress.target}>Now at {progress.target}</div>
                      )}
                      <div className="text-xs text-muted-foreground">
                        {stopping
                          ? `Stopping${overview?.state.cancelRequestedBy ? ` (asked by ${overview.state.cancelRequestedBy})` : ''} once the page being copied is saved.`
                          : driving
                            ? 'This continues on its own while this page is open; if you leave, the scheduler carries it on every 15 minutes.'
                            : canRun && !visible
                              ? 'Paused here while this tab is hidden; the scheduler carries it on every 15 minutes, and coming back resumes it.'
                              : overview?.state.working
                                ? 'Copying now.'
                                : 'Carried on by the scheduler every 15 minutes, or by keeping this page open (Run permission).'}
                        {' '}Part {progress.ticks} of the run.
                      </div>
                      {sliceNote && driving && (
                        <div className="break-words text-xs text-muted-foreground">{sliceNote}</div>
                      )}
                      {progress.lastError && <SettingsNotice tone="warning" title="Retrying after an error">{progress.lastError}</SettingsNotice>}
                    </div>
                  )}

                  {!running && lastRun.error && (
                    <SettingsNotice tone={lastRun.status === 'stopped' ? 'warning' : 'danger'}>{lastRun.error}</SettingsNotice>
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
          </SettingsSection>

          {/* ── Schedule ── */}
          <SettingsSection
            title="Schedule"
            icon={CalendarClock}
            description={`${overview ? describeReportingCopySchedule(overview.config) : '—'}${overview?.nextDueAt ? ` · next ${formatWhen(overview.nextDueAt, timeZone)}` : ''}`}
            contentClassName="space-y-4"
            footer={
              draft && canEdit ? (
                <Button onClick={handleSave} disabled={isSaving || !dirty}>
                  {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="mr-2 h-4 w-4" aria-hidden="true" />}
                  Save schedule
                </Button>
              ) : undefined
            }
          >
            {draft && (
              <>
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
                              'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40',
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
                  A scheduled refresh takes several 15-minute scheduler ticks to read everything (a refresh watched on this
                  page goes faster), so a time missed by a late tick still runs on the next one. Refreshing more often than a
                  full copy takes simply starts the next one when it ends.
                </div>

              </>
            )}
          </SettingsSection>
        </div>

        {/* ── Run history ── */}
        <TableCard
          title="Run history"
          icon={ListTree}
          description="The last 50 refreshes. Select one for its collection-by-collection counts."
          scroll="natural"
          toolbar={historyError ? <SettingsNotice tone="danger">{historyError}</SettingsNotice> : undefined}
        >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Started</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead className="text-right">Read</TableHead>
                  {CHANGE_HEADS.map((head) => <TableHead key={head} className="text-right">{head}</TableHead>)}
                  <TableHead className="whitespace-nowrap text-right">Deleted in app</TableHead>
                  <TableHead className="text-right">Collections</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history === null && !historyError && !currentEntry ? (
                  <TableLoading colSpan={13} rows={3} />
                ) : historyRows.length === 0 ? (
                  <TableEmpty colSpan={13} icon={<History />}>No refresh has finished yet.</TableEmpty>
                ) : (
                  historyRows.map((entry) => {
                    const current = entry.runId === currentEntry?.runId;
                    const badge = STATUS_BADGE[entry.status] ?? STATUS_BADGE.failed;
                    return (
                      <TableRow
                        key={entry.runId}
                        className="cursor-pointer"
                        tabIndex={0}
                        onClick={() => setSelected(entry)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setSelected(entry);
                          }
                        }}
                      >
                        <TableCell className="whitespace-nowrap">{formatWhen(entry.startedAt, timeZone)}</TableCell>
                        <TableCell className="whitespace-nowrap">{entry.trigger === 'manual' ? (entry.full ? 'Full refresh' : 'Refresh now') : 'Schedule'}</TableCell>
                        <TableCell className="whitespace-nowrap">{entry.requestedBy || '—'}</TableCell>
                        <TableCell>
                          <Badge variant={current && stopping ? 'warning' : badge.variant}>{current && stopping ? 'Stopping' : badge.label}</Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{current ? 'Running' : formatDuration(entry.durationSeconds)}</TableCell>
                        <TableCell className="text-right tabular-nums">{count(entry.documents)}</TableCell>
                        {changeCells(entry).map((value, i) => (
                          <TableCell key={CHANGE_HEADS[i]} className="text-right tabular-nums">{value}</TableCell>
                        ))}
                        <TableCell className="whitespace-nowrap text-right tabular-nums">{deletedCell(entry)}</TableCell>
                        <TableCell className="text-right tabular-nums">{count(entry.collections)}</TableCell>
                        <TableCell>
                          <span className="block max-w-xs truncate text-xs text-muted-foreground" title={entry.error ?? undefined}>
                            {entry.error || '—'}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
        </TableCard>

        {/* ── What this is ── */}
        <SettingsNotice title="About the reporting copy">
          <div className="space-y-1.5 text-muted-foreground">
            <div>
              <strong>A one-way copy for MongoDB tools.</strong> Each refresh copies every collection of the app&apos;s
              database into <code>newdatabase</code> (Firestore with MongoDB compatibility), so it can be queried with
              MongoDB Compass, BI connectors or scripts.
            </div>
            <div>
              <strong>Each refresh writes only new and changed documents.</strong> Documents deleted in the app stay in the
              copy, marked <code>_deletedInApp: true</code> (with <code>_deletedNoticedAt</code>) — filter reports with{' '}
              <code>{'{ _deletedInApp: { $ne: true } }'}</code>. Subcollections are looked up once a week; Full refresh looks
              for new ones now and checks every collection for deletions.
            </div>
            <div>
              <strong>The app never reads it.</strong> Nothing typed into the copy comes back, and changing it changes
              nothing in the app — a document edited there is overwritten when it next changes in the app.
            </div>
            <div>
              <strong>It holds everything, including personal data</strong> — employee details, salary and identity
              records, mail and credentials. The app&apos;s permissions do not apply to it; only its own database logins
              do. Give reporting users read-only logins, and keep the list short.
            </div>
          </div>
        </SettingsNotice>
      </SettingsPage>

      <ConfirmDialog
        open={confirmStop}
        onOpenChange={setConfirmStop}
        destructive
        title="Stop the refresh?"
        description="The page being copied is finished, then the run ends as stopped. What has been copied so far stays in the reporting database; the collection it was on is left part-refreshed until the next refresh."
        confirmLabel="Stop refresh"
        cancelLabel="Keep copying"
        loading={isStopping}
        onConfirm={handleStop}
      />

      <ConfirmDialog
        open={confirmFull}
        onOpenChange={setConfirmFull}
        title="Run a full refresh?"
        description="Like Refresh now, only new and changed documents are written. It also looks for subcollections again instead of reusing the names found in the last week, and checks every collection's copy against the app for deleted documents instead of trusting the counts, so it reads about twice as much and takes longer. Use it after adding a new kind of record, or if the copy looks out of step."
        confirmLabel="Start full refresh"
        cancelLabel="Cancel"
        loading={isRefreshing}
        onConfirm={() => handleRefresh(true)}
      />

      <Dialog open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Refresh of {selected ? formatWhen(selected.startedAt, timeZone) : ''}</DialogTitle>
            <DialogDescription>
              {selected
                ? `${selected.trigger === 'manual' ? `${selected.full ? 'Full refresh' : 'Refresh now'}${selected.requestedBy ? ` by ${selected.requestedBy}` : ''}` : 'Scheduled'} · ${STATUS_BADGE[selected.status]?.label ?? selected.status} · ${count(selected.documents)} documents ${hasChangeCounts(selected) ? 'read' : 'copied'} in ${count(selected.collections)} collections`
                : ''}
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <DialogBody className="space-y-3">
              {selected.error && <SettingsNotice tone="danger">{selected.error}</SettingsNotice>}
              {selected.skipped.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs font-medium">Skipped collections</div>
                  <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                    {selected.skipped.map((reason) => <li key={reason} className="break-words">{reason}</li>)}
                  </ul>
                </div>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Collection</TableHead>
                    <TableHead className="text-right">Read</TableHead>
                    {CHANGE_HEADS.map((head) => <TableHead key={head} className="text-right">{head}</TableHead>)}
                    <TableHead className="whitespace-nowrap text-right">Deleted in app</TableHead>
                    <TableHead>State</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selected.perCollection.length === 0 ? (
                    <TableEmpty colSpan={8}>No per-collection counts for this run (recorded from 15 Oct 2026).</TableEmpty>
                  ) : (
                    selected.perCollection.map((entry) => (
                      <TableRow key={entry.name}>
                        <TableCell className="break-all font-mono text-xs">{entry.name}</TableCell>
                        <TableCell className="text-right tabular-nums">{count(entry.documents)}</TableCell>
                        {changeCells(entry).map((value, i) => (
                          <TableCell key={CHANGE_HEADS[i]} className="text-right tabular-nums">{value}</TableCell>
                        ))}
                        <TableCell className="whitespace-nowrap text-right tabular-nums">{deletedCell(entry)}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{entry.complete ? 'Complete' : 'Partly copied'}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              {selected.collectionsOmitted > 0 && (
                <div className="text-xs text-muted-foreground">…and {count(selected.collectionsOmitted)} more collections not listed.</div>
              )}
            </DialogBody>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
