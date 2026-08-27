'use client';

/**
 * The greytHR sync console: connection, schedule, exit policy, and what the last run actually did.
 *
 * One screen rather than a settings page plus a separate log, because the three questions an
 * administrator has here are inseparable: is it connected, when does it run, and what did it change.
 * The review list is the part that matters most — a sync that silently deactivates accounts is a
 * support problem, so every account it touched or would touch is listed with the reason.
 */

import * as React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  CircleSlash,
  Clock,
  DownloadCloud,
  Eye,
  History,
  KeyRound,
  Loader2,
  Lock,
  PlugZap,
  RefreshCw,
  ShieldAlert,
  UserCheck,
  Users,
  UserX,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AuroraBackdrop } from '@/components/effects/AuroraBackdrop';
import { HrAccessDenied, HrEmptyState, HrKpiCard, HrLoader, HrPageHeader } from '@/components/hr/hr-ui';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  EMPLOYEE_DETAIL_GROUPS,
  EXIT_ACCESS_POLICIES,
  SYNC_FREQUENCIES,
  describeSchedule,
  type EmploymentState,
  type ExitAccessPolicy,
  type GreytHRSyncRun,
  type GreytHRSyncSettings,
  type SyncEmployeeOutcome,
  type SyncFrequency,
} from '@/lib/greythr';
import {
  fetchSyncReport,
  runSyncNow,
  saveSyncSettings,
  testConnection,
  type SyncReport,
} from '@/lib/greythr-sync-client';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const STATE_TONE: Record<EmploymentState, string> = {
  Active: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  'Notice Period': 'border-amber-200 bg-amber-50 text-amber-800',
  Relieved: 'border-rose-200 bg-rose-50 text-rose-700',
  Retired: 'border-slate-200 bg-slate-100 text-slate-600',
  Settled: 'border-slate-200 bg-slate-100 text-slate-600',
  Left: 'border-rose-200 bg-rose-50 text-rose-700',
  Unknown: 'border-slate-300 bg-white text-slate-500',
};

export function GreytHRSyncWorkspace() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();

  const canView = can('View', 'Settings.Employee Management');
  const canSync = can('Sync from GreytHR', 'Settings.Employee Management');
  const canEdit = can('Edit', 'Settings.Employee Management');

  const [report, setReport] = useState<SyncReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'run' | 'preview' | 'full' | 'test' | 'save' | null>(null);
  const [draft, setDraft] = useState<GreytHRSyncSettings | null>(null);
  const [previewRun, setPreviewRun] = useState<GreytHRSyncRun | null>(null);
  const [connection, setConnection] = useState<{ ok: boolean; message: string; totalEmployees?: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchSyncReport();
      setReport(next);
      setDraft(next.settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the sync settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading || !canView) {
      if (!authLoading) setLoading(false);
      return;
    }
    void load();
  }, [authLoading, canView, load]);

  const dirty = useMemo(
    () => !!draft && !!report && JSON.stringify(draft) !== JSON.stringify(report.settings),
    [draft, report],
  );

  /** The run shown in the summary: a preview when one is on screen, otherwise the last real run. */
  const shownRun = previewRun ?? report?.runs?.[0] ?? null;

  const handleRun = async (mode: 'run' | 'preview' | 'full') => {
    setBusy(mode);
    setPreviewRun(null);
    try {
      const result = await runSyncNow({
        preview: mode === 'preview',
        fullResync: mode === 'full',
      });

      if (mode === 'preview') {
        setPreviewRun(result.run);
        toast({
          title: 'Preview complete — nothing was saved',
          description: `${result.run.employeesFetched} employees checked. Review the findings below before running for real.`,
        });
        return;
      }

      if (!result.ok) throw new Error(result.run.error || 'The sync failed.');
      toast({
        title: 'Sync complete',
        description:
          `${result.run.employeesCreated} added, ${result.run.employeesUpdated} updated, ` +
          `${result.run.usersDeactivated} account(s) deactivated, ${result.run.flaggedForReview} flagged.`,
      });
      // The Employee screens listen for this to refetch, as the old sync page did.
      window.dispatchEvent(new CustomEvent('greytHRSyncSuccess'));
      await load();
    } catch (err) {
      toast({
        title: mode === 'preview' ? 'Preview failed' : 'Sync failed',
        description: err instanceof Error ? err.message : 'Unexpected error.',
        variant: 'destructive',
      });
    } finally {
      setBusy(null);
    }
  };

  const handleSave = async () => {
    if (!draft) return;
    setBusy('save');
    try {
      const result = await saveSyncSettings(draft);
      setReport((current) => (current ? { ...current, settings: result.settings } : current));
      setDraft(result.settings);
      toast({ title: 'Settings saved', description: describeSchedule(result.settings.schedule) });
    } catch (err) {
      toast({
        title: 'Could not save',
        description: err instanceof Error ? err.message : 'Unexpected error.',
        variant: 'destructive',
      });
    } finally {
      setBusy(null);
    }
  };

  const handleTest = async () => {
    setBusy('test');
    try {
      const result = await testConnection();
      setConnection(result);
      toast({
        title: result.ok ? 'Connected' : 'Connection failed',
        description: result.ok
          ? `${result.message}${result.totalEmployees ? ` ${result.totalEmployees} employees visible.` : ''}`
          : result.message,
        variant: result.ok ? undefined : 'destructive',
      });
    } catch (err) {
      // The route itself can fail before it ever reaches greytHR — most often because the Admin SDK
      // has no credentials. Without this catch the rejection escaped as an unhandled promise and
      // Next.js showed a runtime-error overlay instead of a toast.
      const message = err instanceof Error ? err.message : 'Unexpected error.';
      setConnection({ ok: false, message });
      toast({ title: 'Connection test failed', description: message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="relative min-h-[calc(100dvh-4rem)] overflow-hidden px-4 py-3 sm:px-5">
        <AuroraBackdrop />
        <HrLoader label="Loading greytHR sync settings…" />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="relative min-h-[calc(100dvh-4rem)] overflow-hidden px-4 py-3 sm:px-5">
        <AuroraBackdrop />
        <div className="mb-4 flex items-center gap-2">
          <Link href="/employee">
            <Button variant="ghost" size="icon" className="rounded-full bg-white/70 shadow-sm backdrop-blur">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <h1 className="text-xl font-semibold text-slate-800">greytHR Sync</h1>
        </div>
        <HrAccessDenied what="the greytHR sync settings" />
      </div>
    );
  }

  const settings = draft ?? report?.settings;

  return (
    <div className="relative min-h-[calc(100dvh-4rem)] overflow-hidden px-4 py-3 sm:px-5">
      <AuroraBackdrop />

      <div className="relative">
        <div className="mb-1 flex items-center gap-2">
          <Link href="/employee">
            <Button variant="ghost" size="icon" className="rounded-full bg-white/70 shadow-sm backdrop-blur">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          {/* Three states, not two. Without a report we do not *know* whether the credentials are
              set — saying they are missing would be a guess, and a misleading one: the usual reason
              the report failed is the Admin SDK, which has nothing to do with greytHR. */}
          {!report ? (
            <Badge variant="outline" className="gap-1 border-slate-200 bg-white text-[10px] text-slate-500">
              <PlugZap className="h-3 w-3" />
              Credential status unknown
            </Badge>
          ) : report.configured ? (
            <Badge variant="outline" className="gap-1 border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700">
              <PlugZap className="h-3 w-3" />
              greytHR credentials configured
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1 border-rose-200 bg-rose-50 text-[10px] text-rose-700">
              <ShieldAlert className="h-3 w-3" />
              greytHR credentials not configured
            </Badge>
          )}
        </div>

        <HrPageHeader
          title="greytHR Employee Sync"
          description="Keeps designation, department, project and employment status in step with greytHR — and controls what happens to a platform login when somebody leaves."
          actions={
            <>
              <Button variant="outline" size="sm" onClick={() => void handleTest()} disabled={busy !== null}>
                {busy === 'test' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <PlugZap className="mr-1.5 h-4 w-4" />}
                Test connection
              </Button>
              {canSync && (
                <>
                  <Button variant="outline" size="sm" onClick={() => void handleRun('preview')} disabled={busy !== null}>
                    {busy === 'preview' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Eye className="mr-1.5 h-4 w-4" />}
                    Preview
                  </Button>
                  <Button size="sm" onClick={() => void handleRun('run')} disabled={busy !== null}>
                    {busy === 'run' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <DownloadCloud className="mr-1.5 h-4 w-4" />}
                    Sync now
                  </Button>
                </>
              )}
            </>
          }
        />

        {error && (
          <div className="mb-3 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Only when the server actually told us they are missing. Showing this because the report
            call failed was a false alarm — and it sent the reader after the wrong variables. */}
        {report && !report.configured && (
          <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50/80 px-3 py-2.5 text-sm text-rose-900">
            <p className="font-semibold">greytHR credentials are not set on the server.</p>
            <p className="mt-0.5 text-xs">
              Set <code>GREYTHR_USERNAME</code> and <code>GREYTHR_PASSWORD</code> as secrets (and
              optionally <code>GREYTHR_DOMAIN</code>). Nothing will sync until they are configured.
            </p>
          </div>
        )}

        {connection && !connection.ok && (
          <div className="mb-3 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
            {connection.message}
          </div>
        )}

        <Tabs defaultValue="status">
          <TabsList className="grid w-full grid-cols-4 sm:w-auto">
            <TabsTrigger value="status" className="text-xs">Status</TabsTrigger>
            <TabsTrigger value="review" className="text-xs">
              Review
              {(shownRun?.flaggedForReview ?? 0) > 0 && (
                <Badge variant="outline" className="ml-1.5 border-amber-200 bg-amber-50 text-[10px] text-amber-800">
                  {shownRun?.flaggedForReview}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="schedule" className="text-xs">Schedule</TabsTrigger>
            <TabsTrigger value="history" className="text-xs">History</TabsTrigger>
          </TabsList>

          {/* ── Status ── */}
          <TabsContent value="status" className="mt-3 space-y-3">
            {previewRun && (
              <div className="rounded-xl border border-sky-200 bg-sky-50/80 px-3 py-2.5 text-sm text-sky-900">
                <p className="flex items-center gap-1.5 font-semibold">
                  <Eye className="h-4 w-4" />
                  Showing a preview — nothing has been saved
                </p>
                <p className="mt-0.5 text-xs">
                  These are the changes a real run would make right now. Use <strong>Sync now</strong> to apply them.
                </p>
              </div>
            )}

            {/*
              What is in the mirror, stated before anything about the last run.

              Everything below describes a *run*, and a run cannot tell you whether the mirror is
              complete: an incremental pass over three changed records reports "3 fetched, 1 updated"
              and looks healthy whether the collection holds 1,300 employees or 182. Worse, what an
              incremental pass returns is whatever changed — leavers and people on notice — so an
              incomplete mirror is not visibly sparse, it is visibly *wrong*. "182 records, 0 working"
              says that in one line.
            */}
            {report?.mirror && (
              <Card
                className={cn(
                  'shadow-sm',
                  report.mirror.working === 0 && report.mirror.employees > 0
                    ? 'border-rose-200 bg-rose-50/70'
                    : 'border-white/60 bg-white/85 backdrop-blur-sm',
                )}
              >
                <CardHeader className="px-4 py-3">
                  <CardTitle className="flex flex-wrap items-center gap-1.5 text-sm">
                    <Users className="h-4 w-4 text-indigo-600" />
                    Employee mirror
                    <Badge variant="outline" className="text-[10px] text-slate-600">
                      {report.mirror.employees} record{report.mirror.employees === 1 ? '' : 's'}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[10px]',
                        report.mirror.working > 0
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-rose-200 bg-rose-50 text-rose-700',
                      )}
                    >
                      {report.mirror.working} still working
                    </Badge>
                    {report.mirror.salaryRows > 0 && (
                      <Badge variant="outline" className="text-[10px] text-slate-500">
                        + {report.mirror.salaryRows} salary rows
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription className="text-xs">
                    What is stored here now — not what the last run touched.{' '}
                    {connection?.totalEmployees !== undefined
                      ? `greytHR reports ${connection.totalEmployees} employees in total.`
                      : 'Use Test connection to see how many greytHR holds in total.'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 px-4 pb-4">
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(report.mirror.byState)
                      .sort((a, b) => b[1] - a[1])
                      .map(([state, count]) => (
                        <Badge
                          key={state}
                          variant="outline"
                          className={cn('font-normal', STATE_TONE[state as EmploymentState] ?? STATE_TONE.Unknown)}
                        >
                          {state}: {count}
                        </Badge>
                      ))}
                  </div>

                  {report.mirror.employees > 0 && report.mirror.working === 0 && (
                    <p className="text-xs text-rose-800">
                      <strong>No employee in the mirror is recorded as still working.</strong> That is
                      almost never true of a real workforce, so it means the records here are not the
                      whole roster — an incremental run only returns what changed, and what changes is
                      people leaving. Run <strong>Full resync</strong> to fetch everybody.
                    </p>
                  )}

                  {connection?.totalEmployees !== undefined &&
                    connection.totalEmployees > report.mirror.employees && (
                      <p className="text-xs text-amber-800">
                        greytHR holds {connection.totalEmployees - report.mirror.employees} employee(s)
                        that are not stored here.
                      </p>
                    )}
                </CardContent>
              </Card>
            )}

            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
              <HrKpiCard
                label="Employees checked"
                value={shownRun?.employeesFetched ?? '—'}
                hint={shownRun?.fullResync ? 'Full refresh' : 'Changed since last run'}
                icon={UserCheck}
                tone="blue"
              />
              <HrKpiCard
                label="Added / updated"
                value={shownRun ? `${shownRun.employeesCreated} / ${shownRun.employeesUpdated}` : '—'}
                hint={`${shownRun?.employeesUnchanged ?? 0} unchanged`}
                icon={RefreshCw}
                tone="indigo"
              />
              <HrKpiCard
                label="Logins deactivated"
                value={shownRun?.usersDeactivated ?? 0}
                hint={
                  settings?.exitPolicy === 'Flag for review'
                    ? 'Policy is review-only'
                    : `Policy: ${settings?.exitPolicy}`
                }
                icon={UserX}
                tone={(shownRun?.usersDeactivated ?? 0) > 0 ? 'rose' : 'slate'}
              />
              <HrKpiCard
                label="Flagged for review"
                value={shownRun?.flaggedForReview ?? 0}
                hint="Need a human decision"
                icon={AlertTriangle}
                tone={(shownRun?.flaggedForReview ?? 0) > 0 ? 'amber' : 'slate'}
              />
              {/*
                Shown as a pair. "12 linked" alone reads as a success; the queue beside it is the part
                that matters, because an account nobody has linked is one the exit policy cannot touch
                however it is configured.
              */}
              <HrKpiCard
                label="Logins linked"
                value={shownRun?.usersAutoLinked ?? 0}
                hint={
                  (shownRun?.usersLeftForReview ?? 0) > 0
                    ? `${shownRun?.usersLeftForReview} need a human to choose`
                    : 'Matched on id, employee no or email'
                }
                icon={UserCheck}
                tone={(shownRun?.usersLeftForReview ?? 0) > 0 ? 'amber' : 'emerald'}
              />
            </div>

            <Card className="border-white/60 bg-white/85 shadow-sm backdrop-blur-sm">
              <CardHeader className="px-4 py-3">
                <CardTitle className="flex items-center gap-1.5 text-sm">
                  <Clock className="h-4 w-4 text-indigo-600" />
                  Schedule
                </CardTitle>
                <CardDescription className="text-xs">
                  {settings ? describeSchedule(settings.schedule) : '—'}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 px-4 pb-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Last run">
                  {report?.settings.lastRunAt ? formatWhen(report.settings.lastRunAt) : 'Never'}
                </Field>
                <Field label="Last successful run">
                  {report?.settings.lastSuccessfulRunAt ? formatWhen(report.settings.lastSuccessfulRunAt) : 'Never'}
                </Field>
                {/*
                  Shown next to the other two because the difference between them is the thing that
                  matters: "last successful run: an hour ago" alongside "full baseline: never" is a
                  mirror that is fresh and incomplete, which no single field can express.
                */}
                <Field label="Full baseline">
                  {report?.settings.baselineCompletedAt
                    ? formatWhen(report.settings.baselineCompletedAt)
                    : 'Never'}
                </Field>
                <Field label="Next scheduled run">
                  {report?.nextRun.due ? 'Due on the next hourly tick' : (report?.nextRun.reason ?? '—')}
                </Field>
              </CardContent>
            </Card>

            {report?.mirrorRefresh.force && (
              <Card className="border-amber-200 bg-amber-50/60 shadow-sm">
                <CardContent className="flex items-start gap-2 p-4 text-sm text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-medium">The employee mirror needs a full rebuild.</p>
                    <p className="mt-0.5 text-xs">
                      {report.mirrorRefresh.reason}{' '}
                      Incremental runs only return employees whose records changed, so they cannot fill
                      a gap — and the records that change are leavers and people on notice, which is why
                      an incomplete mirror skews that way. The next run will fetch everybody
                      automatically; you can also press <strong>Full resync</strong> now.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {shownRun?.warnings?.length ? (
              <Card className="border-amber-200 bg-amber-50/60 shadow-sm">
                <CardHeader className="px-4 py-3">
                  <CardTitle className="flex items-center gap-1.5 text-sm text-amber-900">
                    <AlertTriangle className="h-4 w-4" />
                    Warnings from the last run
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <ul className="list-disc space-y-1 pl-5 text-xs text-amber-900">
                    {shownRun.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ) : null}

            {shownRun?.error && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
                <p className="font-semibold">The last run failed.</p>
                <p className="mt-0.5 text-xs">{shownRun.error}</p>
              </div>
            )}

            {canSync && (
              <Card className="border-white/60 bg-white/85 shadow-sm backdrop-blur-sm">
                <CardHeader className="px-4 py-3">
                  <CardTitle className="text-sm">Full refresh</CardTitle>
                  <CardDescription className="text-xs">
                    Normal runs only fetch employees greytHR reports as modified since the last successful
                    run. A full refresh re-reads every employee — slower, and the right thing after
                    changing categories in greytHR or if a run was missed for a long time.
                  </CardDescription>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <Button variant="outline" size="sm" onClick={() => void handleRun('full')} disabled={busy !== null}>
                    {busy === 'full' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
                    Run a full refresh
                  </Button>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ── Review ── */}
          <TabsContent value="review" className="mt-3">
            <OutcomeList run={shownRun} isPreview={!!previewRun} />
          </TabsContent>

          {/* ── Schedule & policy ── */}
          <TabsContent value="schedule" className="mt-3 space-y-3">
            {!canEdit && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
                You can view these settings but not change them. Changing the schedule or the exit policy
                needs Edit on Employee Management.
              </div>
            )}

            {settings && draft && (
              <>
                <Card className="border-white/60 bg-white/85 shadow-sm backdrop-blur-sm">
                  <CardHeader className="px-4 py-3">
                    <CardTitle className="flex items-center gap-1.5 text-sm">
                      <CalendarClock className="h-4 w-4 text-indigo-600" />
                      Automatic refresh
                    </CardTitle>
                    <CardDescription className="text-xs">
                      The scheduler ticks hourly and runs the sync when your chosen frequency is due, so
                      changing this takes effect immediately — no redeploy.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 px-4 pb-4">
                    <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800">Run automatically</p>
                        <p className="text-[11px] text-muted-foreground">
                          {describeSchedule(draft.schedule)}
                        </p>
                      </div>
                      <Switch
                        checked={draft.schedule.enabled}
                        disabled={!canEdit}
                        onCheckedChange={(enabled) =>
                          setDraft({ ...draft, schedule: { ...draft.schedule, enabled } })
                        }
                      />
                    </label>

                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Frequency</Label>
                        <Select
                          value={draft.schedule.frequency}
                          disabled={!canEdit}
                          onValueChange={(value) =>
                            setDraft({
                              ...draft,
                              schedule: { ...draft.schedule, frequency: value as SyncFrequency },
                            })
                          }
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {SYNC_FREQUENCIES.map((frequency) => (
                              <SelectItem key={frequency} value={frequency}>{frequency}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs">Hour of day</Label>
                        <Select
                          value={String(draft.schedule.hourOfDay)}
                          disabled={!canEdit || !['Daily', 'Weekly'].includes(draft.schedule.frequency)}
                          onValueChange={(value) =>
                            setDraft({
                              ...draft,
                              schedule: { ...draft.schedule, hourOfDay: Number(value) },
                            })
                          }
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent className="max-h-64">
                            {Array.from({ length: 24 }).map((_, hour) => (
                              <SelectItem key={hour} value={String(hour)}>
                                {String(hour).padStart(2, '0')}:00
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs">Day of week</Label>
                        <Select
                          value={String(draft.schedule.dayOfWeek)}
                          disabled={!canEdit || draft.schedule.frequency !== 'Weekly'}
                          onValueChange={(value) =>
                            setDraft({
                              ...draft,
                              schedule: { ...draft.schedule, dayOfWeek: Number(value) },
                            })
                          }
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {DAY_NAMES.map((day, index) => (
                              <SelectItem key={day} value={String(index)}>{day}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-white/60 bg-white/85 shadow-sm backdrop-blur-sm">
                  <CardHeader className="px-4 py-3">
                    <CardTitle className="flex items-center gap-1.5 text-sm">
                      <UserX className="h-4 w-4 text-rose-600" />
                      When somebody leaves
                    </CardTitle>
                    <CardDescription className="text-xs">
                      What the sync does to a platform login once greytHR says the person has resigned or
                      left. Employment state is derived from the leaving date and the separation record —
                      not from greytHR's <code>status</code> field, which is Probation / Confirmed /
                      Contract / Trainee and says nothing about whether they are still here.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2.5 px-4 pb-4">
                    {EXIT_ACCESS_POLICIES.map((policy) => (
                      <button
                        key={policy}
                        type="button"
                        disabled={!canEdit}
                        onClick={() => setDraft({ ...draft, exitPolicy: policy })}
                        className={cn(
                          'w-full rounded-xl border px-3 py-2.5 text-left transition-colors',
                          draft.exitPolicy === policy
                            ? 'border-indigo-300 bg-indigo-50'
                            : 'border-white bg-white/80 hover:bg-slate-50',
                          !canEdit && 'cursor-not-allowed opacity-70',
                        )}
                      >
                        <p className="text-sm font-semibold text-slate-800">{policy}</p>
                        <p className="text-xs text-muted-foreground">{POLICY_HELP[policy]}</p>
                      </button>
                    ))}

                    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-[11px] text-slate-600">
                      <p className="font-medium text-slate-700">Two safety rules apply whatever you pick:</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4">
                        <li>
                          A user who is the last person able to administer access is never deactivated
                          automatically — they are flagged instead.
                        </li>
                        <li>
                          The sync only ever reactivates accounts <em>it</em> deactivated. An account you
                          disabled by hand stays disabled.
                        </li>
                      </ul>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-white/60 bg-white/85 shadow-sm backdrop-blur-sm">
                  <CardHeader className="px-4 py-3">
                    <CardTitle className="flex items-center gap-1.5 text-sm">
                      <KeyRound className="h-4 w-4 text-violet-600" />
                      Designation &amp; project mapping
                    </CardTitle>
                    <CardDescription className="text-xs">
                      greytHR is the authority on who holds which designation, department and project.
                      Access Management decides what each of those is worth.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2.5 px-4 pb-4">
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
                      <p className="text-sm font-medium text-emerald-900">
                        Employee facts — always synced
                      </p>
                      <p className="mt-0.5 text-[11px] text-emerald-800">
                        Designation, department, location, project name and division, grade, cost centre and
                        employment type are written onto each employee record, resolved as at today from
                        greytHR's effective-dated category history.
                      </p>
                    </div>

                    {/* Which detail groups to fetch. Sensitive ones are visually separated and
                        default off, because holding somebody's Aadhaar number is a decision. */}
                    <div className="space-y-2 rounded-xl border border-white/70 bg-white/60 p-2.5">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Which details to fetch
                      </p>
                      {EMPLOYEE_DETAIL_GROUPS.map((spec) => {
                        const sensitive = spec.destination === 'sensitive';
                        return (
                          <label
                            key={spec.group}
                            className={cn(
                              'flex items-start justify-between gap-3 rounded-xl border p-2.5',
                              sensitive ? 'border-amber-200 bg-amber-50/50' : 'border-white bg-white/80',
                            )}
                          >
                            <div className="min-w-0">
                              <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-slate-800">
                                {spec.label}
                                {sensitive && (
                                  <Badge
                                    variant="outline"
                                    className="gap-1 border-amber-300 bg-white/70 text-[10px] text-amber-800"
                                  >
                                    <Lock className="h-3 w-3" />
                                    Restricted
                                  </Badge>
                                )}
                              </p>
                              <p className="mt-0.5 text-[11px] text-muted-foreground">{spec.description}</p>
                              <p className="mt-0.5 text-[11px] text-slate-400">Includes: {spec.contains}</p>
                            </div>
                            <Switch
                              checked={draft.detailGroups[spec.group]}
                              disabled={!canEdit}
                              onCheckedChange={(value) =>
                                setDraft({
                                  ...draft,
                                  detailGroups: { ...draft.detailGroups, [spec.group]: value },
                                })
                              }
                            />
                          </label>
                        );
                      })}
                      <p className="text-[11px] text-muted-foreground">
                        Restricted groups are stored separately and need the{' '}
                        <span className="font-medium">Employee › Personal Data · View</span> permission
                        to read — no role holds it until you grant it.
                      </p>
                    </div>

                    <label className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white/80 p-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800">
                          Keep department &amp; designation membership current
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          Records the user's greytHR designation and department on their access profile, so
                          the Designation and Department rules you configure in{' '}
                          <Link href="/settings/access-management" className="underline">
                            Access Management
                          </Link>{' '}
                          apply automatically. The sync never grants a role itself — it only keeps
                          membership accurate.
                        </p>
                      </div>
                      <Switch
                        checked={draft.mapping.syncAccessMembership}
                        disabled={!canEdit}
                        onCheckedChange={(value) =>
                          setDraft({ ...draft, mapping: { ...draft.mapping, syncAccessMembership: value } })
                        }
                      />
                    </label>

                    <label className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white/80 p-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800">
                          Link logins to greytHR employees automatically
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          Matches platform accounts to greytHR employees on every run, using the greytHR
                          employee id, employee number or official email. Name and phone matches are never
                          applied automatically — those stay in the review queue in{' '}
                          <Link href="/settings/user-management/greythr-linking" className="underline">
                            greytHR linking
                          </Link>
                          . Worth leaving on: the exit policy above can only act on an account it can
                          identify, so an unlinked login keeps working after the person has left.
                        </p>
                      </div>
                      <Switch
                        checked={draft.mapping.autoLinkUsers}
                        disabled={!canEdit}
                        onCheckedChange={(value) =>
                          setDraft({ ...draft, mapping: { ...draft.mapping, autoLinkUsers: value } })
                        }
                      />
                    </label>
                  </CardContent>
                </Card>

                {canEdit && (
                  <div className="sticky bottom-2 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/70 bg-white/90 px-3 py-2.5 shadow-sm backdrop-blur">
                    <p className="text-xs text-muted-foreground">
                      {dirty ? 'Unsaved changes.' : 'All changes saved.'}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!dirty || busy !== null}
                        onClick={() => setDraft(report?.settings ?? null)}
                      >
                        Discard
                      </Button>
                      <Button size="sm" disabled={!dirty || busy !== null} onClick={() => void handleSave()}>
                        {busy === 'save' && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                        Save settings
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </TabsContent>

          {/* ── History ── */}
          <TabsContent value="history" className="mt-3">
            <RunHistory runs={report?.runs ?? []} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

const POLICY_HELP: Record<ExitAccessPolicy, string> = {
  'Flag for review':
    'Nothing is changed automatically. Exits appear on the Review tab and you disable the login yourself. The safe default.',
  'On last working day':
    'The login is disabled once the leaving date has passed. Employees working their notice period keep normal access.',
  'On resignation':
    'The login is disabled as soon as a resignation is recorded, before the last working day. Strictest — use where system access is cut at resignation.',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-sm font-medium text-slate-800">{children || '—'}</p>
    </div>
  );
}

const formatWhen = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

/* ------------------------------------------------------------------------------------------------
 * The review list
 * ---------------------------------------------------------------------------------------------- */

function OutcomeList({ run, isPreview }: { run: GreytHRSyncRun | null; isPreview: boolean }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<'flagged' | 'changed' | 'all'>('flagged');

  const outcomes = useMemo(() => {
    const rows = run?.outcomes ?? [];
    if (filter === 'flagged') return rows.filter((row) => row.flagged);
    if (filter === 'changed') return rows.filter((row) => row.changes.length > 0);
    return rows;
  }, [run, filter]);

  if (!run) {
    return (
      <HrEmptyState
        icon={History}
        title="No run to review yet"
        description="Use Preview to see what a sync would change without saving anything."
      />
    );
  }

  return (
    <div className="space-y-3">
      {isPreview && (
        <div className="rounded-xl border border-sky-200 bg-sky-50/80 px-3 py-2 text-xs text-sky-900">
          Preview — these changes have not been saved.
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {(['flagged', 'changed', 'all'] as const).map((option) => (
            <Button
              key={option}
              variant={filter === option ? 'default' : 'outline'}
              size="sm"
              className="h-7 text-xs capitalize"
              onClick={() => setFilter(option)}
            >
              {option === 'flagged' ? 'Needs review' : option === 'changed' ? 'Changed' : 'All reported'}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{outcomes.length} row(s)</p>
      </div>

      {outcomes.length === 0 ? (
        <HrEmptyState
          icon={CheckCircle2}
          title={filter === 'flagged' ? 'Nothing needs review' : 'Nothing to show'}
          description={
            filter === 'flagged'
              ? 'No exits, no orphaned accounts and no ambiguous records in this run.'
              : 'Try a different filter.'
          }
        />
      ) : (
        <Card className="overflow-hidden border-white/60 bg-white/85 shadow-sm backdrop-blur-sm">
          <ScrollArea className="h-[28rem]">
            <div className="divide-y divide-slate-100">
              {outcomes.map((outcome) => (
                <OutcomeRow
                  key={outcome.employeeId}
                  outcome={outcome}
                  open={expanded === outcome.employeeId}
                  onToggle={() => setExpanded(expanded === outcome.employeeId ? null : outcome.employeeId)}
                />
              ))}
            </div>
          </ScrollArea>
        </Card>
      )}
    </div>
  );
}

function OutcomeRow({
  outcome,
  open,
  onToggle,
}: {
  outcome: SyncEmployeeOutcome;
  open: boolean;
  onToggle: () => void;
}) {
  const actionBadge =
    outcome.accessAction === 'deactivate'
      ? { label: 'Login disabled', className: 'border-rose-200 bg-rose-50 text-rose-700', icon: UserX }
      : outcome.accessAction === 'reactivate'
        ? { label: 'Login restored', className: 'border-emerald-200 bg-emerald-50 text-emerald-700', icon: UserCheck }
        : outcome.flagged
          ? { label: 'Needs review', className: 'border-amber-200 bg-amber-50 text-amber-800', icon: AlertTriangle }
          : null;

  return (
    <div>
      <button type="button" onClick={onToggle} className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-slate-50/70">
        <ChevronDown className={cn('mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-medium text-slate-800">{outcome.name || outcome.employeeNo || outcome.employeeId}</span>
            <Badge variant="outline" className={cn('text-[10px]', STATE_TONE[outcome.employmentState])}>
              {outcome.employmentState}
            </Badge>
            {actionBadge && (
              <Badge variant="outline" className={cn('gap-1 text-[10px]', actionBadge.className)}>
                <actionBadge.icon className="h-3 w-3" />
                {actionBadge.label}
              </Badge>
            )}
            {outcome.changes.length > 0 && (
              <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-[10px] text-indigo-700">
                {outcome.changes.length} field{outcome.changes.length === 1 ? '' : 's'} changed
              </Badge>
            )}
            {!outcome.userId && (
              <Badge variant="outline" className="gap-1 border-slate-200 bg-white text-[10px] text-slate-500">
                <CircleSlash className="h-3 w-3" />
                No platform login
              </Badge>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {[outcome.employeeNo, outcome.email].filter(Boolean).join(' · ')}
          </p>
          <p className="mt-0.5 text-xs text-slate-600">{outcome.accessReason}</p>
        </div>
      </button>

      {open && (
        <div className="grid gap-3 bg-slate-50/60 px-3 py-3 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Employment state
            </p>
            <p className="text-xs text-slate-700">{outcome.employmentStateReason}</p>
            {outcome.userId && (
              <Link
                href={`/settings/access-management/users/${outcome.userId}`}
                className="mt-2 inline-block text-xs text-indigo-600 underline"
              >
                Open access profile
              </Link>
            )}
          </div>
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Field changes ({outcome.changes.length})
            </p>
            {outcome.changes.length === 0 ? (
              <p className="text-xs text-muted-foreground">None</p>
            ) : (
              <div className="space-y-0.5">
                {outcome.changes.map((change) => (
                  <p key={change.field} className="truncate text-xs">
                    <span className="font-medium text-slate-700">{change.field}</span>
                    <span className="text-muted-foreground">
                      {' '}
                      {formatValue(change.from)} → {formatValue(change.to)}
                    </span>
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const formatValue = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
};

/* ------------------------------------------------------------------------------------------------
 * Run history
 * ---------------------------------------------------------------------------------------------- */

function RunHistory({ runs }: { runs: GreytHRSyncRun[] }) {
  if (!runs.length) {
    return (
      <HrEmptyState
        icon={History}
        title="No runs recorded yet"
        description="Every automatic and manual run is recorded here with what it fetched and what it changed."
      />
    );
  }

  return (
    <div className="space-y-2.5">
      {runs.map((run) => (
        <Card key={run.id} className="border-white/60 bg-white/85 shadow-sm backdrop-blur-sm">
          <CardContent className="space-y-2 p-3.5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-slate-800">
                  {formatWhen(run.startedAt)}
                  <Badge variant="outline" className="text-[10px] capitalize text-slate-600">{run.trigger}</Badge>
                  {run.fullResync && (
                    <Badge variant="outline" className="border-sky-200 bg-sky-50 text-[10px] text-sky-700">
                      Full refresh
                    </Badge>
                  )}
                  <Badge
                    variant="outline"
                    className={
                      run.ok
                        ? 'border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700'
                        : 'border-destructive/40 bg-destructive/10 text-[10px] text-destructive'
                    }
                  >
                    {run.ok ? 'Succeeded' : 'Failed'}
                  </Badge>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {run.triggeredByName ? `by ${run.triggeredByName} · ` : ''}
                  {Math.round(run.tookMs / 1000)}s
                  {run.modifiedSince ? ` · since ${run.modifiedSince}` : ''}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5 text-[11px]">
              <Badge variant="outline" className="text-slate-600">{run.employeesFetched} fetched</Badge>
              <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                {run.employeesCreated} added
              </Badge>
              <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700">
                {run.employeesUpdated} updated
              </Badge>
              {run.usersDeactivated > 0 && (
                <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">
                  {run.usersDeactivated} logins disabled
                </Badge>
              )}
              {run.usersReactivated > 0 && (
                <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                  {run.usersReactivated} logins restored
                </Badge>
              )}
              {run.flaggedForReview > 0 && (
                <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
                  {run.flaggedForReview} flagged
                </Badge>
              )}
            </div>

            {run.error && <p className="text-xs text-destructive">{run.error}</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
