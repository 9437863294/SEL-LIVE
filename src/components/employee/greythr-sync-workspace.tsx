'use client';

/**
 * The greytHR sync console: connection, schedule, exit policy, and what the last run actually did.
 *
 * One screen rather than a settings page plus a separate log, because the three questions an
 * administrator has here are inseparable: is it connected, when does it run, and what did it change.
 * The review list is the part that matters most — a sync that silently deactivates accounts is a
 * support problem, so every account it touched or would touch is listed with the reason.
 */

import { formatDistanceToNow } from 'date-fns';
import * as React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
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
  PlugZap,
  RefreshCw,
  ShieldAlert,
  Undo2,
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
import { HrAccessDenied, HrEmptyState, HrLoader } from '@/components/hr/hr-ui';
import {
  EmployeeErrorBanner,
  EmployeeKpiCard,
  EmployeePageShell,
  EmployeeSubNav,
  employmentStateTone,
} from '@/components/employee/employee-ui';
import { StatusBadge } from '@/components/shared/status-badge';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  EXIT_ACCESS_POLICIES,
  describeSchedule,
  type ExitAccessPolicy,
  type GreytHRSyncRun,
  type GreytHRSyncSettings,
  type SyncEmployeeOutcome,
  observedTickGapMinutes,
  syncUnitSpec,
  type SyncFrequency,
  type ReviewAction,
  type SyncReviewRecord,
  type SyncUnitKey,
} from '@/lib/greythr';
import {
  fetchSyncReport,
  runSyncNow,
  saveSyncSettings,
  applyReviewDecision,
  testConnection,
  type SyncReport,
} from '@/lib/greythr-sync-client';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/shared/page-header';
import { SyncSchedulePanel } from '@/components/employee/sync-schedule-panel';

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
  /**
   * Which module is mid-refresh, separate from `busy` above.
   *
   * Separate because the spinner belongs on the one card that was pressed, while `busy` governs
   * the whole-run buttons in the header. One shared value would spin every card at once.
   */
  const [busyUnit, setBusyUnit] = useState<SyncUnitKey | null>(null);
  /** The flagged row currently being acted on, so only its buttons spin. */
  const [reviewBusy, setReviewBusy] = useState<string | null>(null);
  const [previewRun, setPreviewRun] = useState<GreytHRSyncRun | null>(null);
  const [connection, setConnection] = useState<{ ok: boolean; message: string; totalEmployees?: number } | null>(null);

  const load = useCallback(async (): Promise<SyncReport | null> => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchSyncReport();
      setReport(next);
      setDraft(next.settings);
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the sync settings.');
      return null;
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

  /**
   * How often scheduled runs actually arrive, measured rather than assumed.
   *
   * What calls this endpoint is deployment configuration the application cannot read, so the run
   * history is the only evidence available — and it is the right evidence, because it reports
   * what happened rather than what was configured.
   */
  const observedGapMinutes = useMemo(
    () => observedTickGapMinutes(report?.runs ?? []),
    [report?.runs],
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

      // Compared before/after so the toast can say whether the mirror's "still working" count
      // actually moved — not just that the run reported changes. A run can genuinely report
      // "0 updated" and be correct (the mirror was already right); it can also report real numbers
      // while the number that matters here does not move, if those changes were to fields other than
      // employment state. Either way, this is the one line meant to settle "did that actually work".
      const workingBefore = report?.mirror.working ?? null;
      const refreshed = await load();
      const workingAfter = refreshed?.mirror.working ?? null;

      toast({
        title: 'Sync complete',
        description:
          `${result.run.employeesCreated} added, ${result.run.employeesUpdated} updated, ` +
          `${result.run.usersDeactivated} account(s) deactivated, ${result.run.flaggedForReview} flagged.` +
          (workingBefore !== null && workingAfter !== null
            ? ` Still working: ${workingBefore} → ${workingAfter}.`
            : ''),
      });
      // The Employee screens listen for this to refetch, as the old sync page did.
      window.dispatchEvent(new CustomEvent('greytHRSyncSuccess'));
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

  /**
   * Refresh one module now.
   *
   * Reports what the run says rather than the employee counters, which are zero by definition for
   * a module that does not touch employee records — "0 added, 0 updated" after a successful swipe
   * refresh reads as a failure.
   */
  const handleRunUnit = async (key: SyncUnitKey) => {
    const label = syncUnitSpec(key).label;
    setBusyUnit(key);
    setPreviewRun(null);
    try {
      const result = await runSyncNow({ units: [key] });
      if (!result.ok) throw new Error(result.run.error || `${label} could not be refreshed.`);
      await load();
      toast({
        title: `${label} refreshed`,
        description:
          result.run.warnings?.[0] ??
          (key === 'employees'
            ? `${result.run.employeesCreated} added, ${result.run.employeesUpdated} updated, ` +
              `${result.run.flaggedForReview} flagged.`
            : 'Up to date as of just now.'),
      });
      window.dispatchEvent(new CustomEvent('greytHRSyncSuccess'));
    } catch (err) {
      toast({
        title: `${label} failed`,
        description: err instanceof Error ? err.message : 'Unexpected error.',
        variant: 'destructive',
      });
    } finally {
      setBusyUnit(null);
    }
  };

  /**
   * Apply one administrator decision to one flagged row.
   *
   * A refusal — the last-administrator guard, or an employee with no login — comes back as
   * `ok: false` with a sentence rather than as a thrown error, because "you can't, and here is
   * why" is an answer worth reading. It is shown as a warning, not a failure.
   */
  const handleReview = async (employeeId: string, action: ReviewAction, reason?: string) => {
    setReviewBusy(employeeId);
    try {
      const result = await applyReviewDecision({
        employeeId,
        action,
        reason: reason?.trim() || undefined,
        runId: shownRun?.id,
      });
      await load();
      toast({
        title: result.ok
          ? action === 'dismiss'
            ? 'Marked as reviewed'
            : action === 'enable'
              ? 'Login restored'
              : 'Login disabled'
          : 'Not applied',
        description: result.message,
        variant: result.ok ? undefined : 'destructive',
      });
    } catch (err) {
      toast({
        title: 'Could not record that',
        description: err instanceof Error ? err.message : 'Unexpected error.',
        variant: 'destructive',
      });
    } finally {
      setReviewBusy(null);
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
      <EmployeePageShell>
        <HrLoader label="Loading greytHR sync settings…" />
      </EmployeePageShell>
    );
  }

  if (!canView) {
    return (
      <EmployeePageShell>
        <PageHeader
          icon={DownloadCloud}
          eyebrow="Employee management"
          title="greytHR Sync"
          backHref="/employee"
          backLabel="Back to Employee Management"
        />
        <HrAccessDenied what="the greytHR sync settings" />
      </EmployeePageShell>
    );
  }

  const settings = draft ?? report?.settings;

  /**
   * The mirror against greytHR's own headcount.
   *
   * The panel below already shouted when *no* mirror record was still working, which is the extreme
   * case. It said nothing about the one that actually occurs: a mirror holding a handful of the
   * workforce and 180 leavers reports "3 still working" and reads as unremarkable. Comparing against
   * the stored current roster catches both, and names the gap.
   */
  /**
   * Whether the schedule has ever actually fired.
   *
   * Turning "Run automatically" on records a *preference*; it does not make anything happen. The
   * route decides whether a run is due, but something external has to call `GET /api/greythr/sync`
   * for it to be asked — and every run record says which did: `trigger: 'cron' | 'manual'`.
   *
   * On this installation the answer is nineteen runs and not one scheduled tick, because the only
   * cron configuration in the repository is `vercel.json` and this app deploys to Firebase App
   * Hosting, which never reads that file. A console that displays "Daily at 02:00 · enabled" over a
   * scheduler nothing is driving is stating a plan as though it were a fact.
   *
   * Judged over the runs the report carries rather than all of history: a tenant that has just run
   * twenty manual syncs could push a genuine cron run out of the window, so the wording below says
   * "recent runs" rather than "ever".
   */
  const recentRuns = report?.runs ?? [];
  const cronRunCount = recentRuns.filter((run) => run.trigger === 'cron').length;
  const scheduleEnabled = report?.settings.schedule.enabled === true;
  const schedulerNeverFired = scheduleEnabled && recentRuns.length > 0 && cronRunCount === 0;

  const rosterCount = report?.currentRoster.count ?? 0;
  const mirrorWorking = report?.mirror.working ?? 0;
  const mirrorGap = rosterCount > 0 ? rosterCount - mirrorWorking : 0;
  const mirrorIncomplete = mirrorGap > Math.max(2, Math.round(rosterCount * 0.05));

  return (
    <EmployeePageShell>
      <div className="relative">
        <PageHeader
          icon={DownloadCloud}
          eyebrow="Employee management"
          title="greytHR Employee Sync"
          backHref="/employee"
          backLabel="Back to Employee Management"
          badge={
            /* Three states, not two. Without a report we do not *know* whether the credentials are
               set — saying they are missing would be a guess, and a misleading one: the usual reason
               the report failed is the Admin SDK, which has nothing to do with greytHR. */
            !report ? (
              <StatusBadge tone="neutral">
                <PlugZap className="h-3 w-3" aria-hidden="true" />
                Credential status unknown
              </StatusBadge>
            ) : report.configured ? (
              <StatusBadge tone="success">
                <PlugZap className="h-3 w-3" aria-hidden="true" />
                Credentials configured
              </StatusBadge>
            ) : (
              <StatusBadge tone="danger">
                <ShieldAlert className="h-3 w-3" aria-hidden="true" />
                Credentials not configured
              </StatusBadge>
            )
          }
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

        <EmployeeSubNav current="sync" />

        {error && <EmployeeErrorBanner>{error}</EmployeeErrorBanner>}

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

        {connection && !connection.ok && <EmployeeErrorBanner>{connection.message}</EmployeeErrorBanner>}

        {schedulerNeverFired && (
          <div className="mb-3 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50/80 px-3 py-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-700">
              <CalendarClock className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1 text-rose-900">
              <p className="text-sm font-semibold">
                The schedule is on, but nothing is triggering it
              </p>
              <p className="text-xs leading-snug text-rose-800">
                All {recentRuns.length} recent run{recentRuns.length === 1 ? '' : 's'} started by hand, none
                on the schedule. Automatic runs need something calling{' '}
                <code className="rounded bg-rose-100 px-1">GET /api/greythr/sync</code> hourly — set up a
                scheduled job for it.
              </p>
            </div>
          </div>
        )}

        <Tabs defaultValue="status">
          {/*
            The strip spans the row at every width, four equal segments.

            It used to be `sm:inline-flex sm:w-auto`, so on a desktop it shrank to fit its four
            labels and left its tinted background stopping a quarter of the way across — reading as
            a panel that had failed to load rather than as a tab bar. Equal flex segments also mean
            the Review tab's count badge cannot shove the other three sideways as it changes.
          */}
          <TabsList className="flex w-full">
            <TabsTrigger value="status" className="flex-1 text-xs">Status</TabsTrigger>
            <TabsTrigger value="review" className="flex-1 text-xs">
              Review
              {(shownRun?.flaggedForReview ?? 0) > 0 && (
                <Badge variant="warning" className="ml-1.5">
                  {shownRun?.flaggedForReview}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="schedule" className="flex-1 text-xs">Schedule</TabsTrigger>
            <TabsTrigger value="history" className="flex-1 text-xs">History</TabsTrigger>
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
                  (report.mirror.working === 0 && report.mirror.employees > 0) || mirrorIncomplete
                    ? 'border-rose-200 bg-rose-50/70'
                    : 'border-white/60 bg-white/85 backdrop-blur-sm',
                )}
              >
                <CardHeader className="px-4 py-3">
                  <CardTitle className="flex flex-wrap items-center gap-1.5 text-sm">
                    <Users className="h-4 w-4 text-indigo-600" />
                    Employee mirror
                    <Badge variant="neutral">
                      {report.mirror.employees} record{report.mirror.employees === 1 ? '' : 's'}
                    </Badge>
                    <Badge variant={report.mirror.working > 0 && !mirrorIncomplete ? 'success' : 'danger'}>
                      {report.mirror.working} still working
                    </Badge>
                    {rosterCount > 0 && <Badge variant="neutral">greytHR: {rosterCount} current</Badge>}
                    {report.mirror.salaryRows > 0 && (
                      <Badge variant="outline">+ {report.mirror.salaryRows} salary rows</Badge>
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
                        <StatusBadge key={state} status={state} tone={employmentStateTone(state)}>
                          {state}: {count}
                        </StatusBadge>
                      ))}
                  </div>

                  {mirrorIncomplete && report.mirror.working > 0 && (
                    <p className="text-xs text-rose-800">
                      <strong>
                        greytHR lists {rosterCount} current employees; the mirror accounts for{' '}
                        {mirrorWorking}.
                      </strong>{' '}
                      The {mirrorGap} missing are the people the roster, the leave and attendance
                      registers, Reports and Salary all fail to describe — those screens read this
                      mirror. Run <strong>Full resync</strong> to fetch them.
                    </p>
                  )}

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

            {/* Five cards, so five columns — at four the fifth sat alone on a second row, the
                ragged tail this module has been removing everywhere else. */}
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
              <EmployeeKpiCard
                index={0}
                label="Employees checked"
                value={shownRun?.employeesFetched ?? '—'}
                hint={shownRun?.fullResync ? 'Full refresh' : 'Changed since last run'}
                icon={UserCheck}
                tone="blue"
              />
              <EmployeeKpiCard
                index={1}
                label="Added / updated"
                value={shownRun ? `${shownRun.employeesCreated} / ${shownRun.employeesUpdated}` : '—'}
                hint={`${shownRun?.employeesUnchanged ?? 0} unchanged`}
                icon={RefreshCw}
                tone="indigo"
              />
              <EmployeeKpiCard
                index={2}
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
              <EmployeeKpiCard
                index={3}
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
              <EmployeeKpiCard
                index={4}
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
            <OutcomeList
              run={shownRun}
              isPreview={!!previewRun}
              reviews={report?.reviews}
              canEdit={canEdit}
              busyEmployeeId={reviewBusy}
              onAction={(employeeId, action, reason) => void handleReview(employeeId, action, reason)}
            />
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
                      {/* Conditional, because the unqualified claim is false wherever nothing is
                          calling the endpoint — which is the state this installation is in. */}
                      {schedulerNeverFired ? (
                        <>
                          These settings decide when a run is <em>due</em> — but nothing is triggering the
                          scheduler, so none will start on its own. See the notice above.
                        </>
                      ) : (
                        <>
                          Each section refreshes on its own schedule and any single item can override it.
                          The scheduler ticks hourly and runs whatever is due, so a change here applies
                          immediately — no redeploy.
                        </>
                      )}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 px-4 pb-4">
                    <SyncSchedulePanel
                      draft={draft}
                      onChange={setDraft}
                      status={report?.unitStatus}
                      canEdit={canEdit}
                      canSync={canSync}
                      onRunUnit={(key) => void handleRunUnit(key)}
                      busyUnit={busyUnit}
                      /* Nothing calling the endpoint means "next due" would promise a tick that
                         never comes, so the cards drop that line. */
                      schedulerLive={!schedulerNeverFired}
                      observedGapMinutes={observedGapMinutes}
                    />
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

                    {/*
                      The per-group switches used to live here. They moved to Automatic refresh,
                      where each group now also carries a schedule — two switches for one flag on
                      one screen would be a control whose two halves can disagree.
                    */}
                    <div className="rounded-xl border border-white/70 bg-white/60 p-2.5">
                      <p className="text-[11px] text-muted-foreground">
                        Which details to fetch, and how often, is set under{' '}
                        <span className="font-medium">Automatic refresh</span> — each group has its own
                        switch and schedule there.
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
                          <Link href="/settings/access-management/greythr-linking" className="underline">
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
                  // `data-floating-nav="hide"`: `bottom-2` is not the `bottom-0` the phone's bottom bar
                  // looks for, and the two would otherwise stack at the foot of the screen.
                  <div
                    data-floating-nav="hide"
                    className="sticky bottom-2 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/70 bg-white/90 px-3 py-2.5 shadow-sm backdrop-blur"
                  >
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
    </EmployeePageShell>
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

function OutcomeList({
  run,
  isPreview,
  reviews,
  canEdit,
  busyEmployeeId,
  onAction,
}: {
  run: GreytHRSyncRun | null;
  isPreview: boolean;
  reviews: SyncReviewRecord[] | undefined;
  canEdit: boolean;
  busyEmployeeId: string | null;
  onAction: (employeeId: string, action: ReviewAction, reason?: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<'flagged' | 'changed' | 'all'>('flagged');

  const outcomes = useMemo(() => {
    const rows = run?.outcomes ?? [];
    if (filter === 'flagged') return rows.filter((row) => row.flagged);
    if (filter === 'changed') return rows.filter((row) => row.changes.length > 0);
    return rows;
  }, [run, filter]);

  /**
   * Decisions taken *after* this run, by employee.
   *
   * Compared against the run rather than simply "has a review ever been recorded": a person can be
   * flagged, dealt with, and flagged again months later for a different reason, and an old decision
   * must not silence the new flag.
   */
  const resolved = useMemo(() => {
    const map = new Map<string, SyncReviewRecord>();
    if (!run) return map;
    for (const review of reviews ?? []) {
      if (review.ok && review.reviewedAt > run.startedAt) map.set(review.employeeId, review);
    }
    return map;
  }, [reviews, run]);

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
          {/*
            A native overflow container, not `ScrollArea`.

            The wrapper used here before swallowed the horizontal scrollbar, and this table is wider
            than a laptop at the Decide column. `min-w-0` on the flex parent is what lets it shrink
            far enough to scroll rather than pushing the card out of the page.
          */}
          <div className="max-h-[32rem] min-w-0 overflow-auto">
            <table className="w-full min-w-[60rem] border-collapse text-left text-xs">
              <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-sm">
                <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="w-8 px-2 py-2" />
                  <th scope="col" className="px-2 py-2 font-semibold">Employee</th>
                  <th scope="col" className="px-2 py-2 font-semibold">State</th>
                  <th scope="col" className="px-2 py-2 font-semibold">Outcome</th>
                  <th scope="col" className="px-2 py-2 font-semibold">Why</th>
                  <th scope="col" className="px-2 py-2 text-right font-semibold">Changes</th>
                  <th scope="col" className="px-2 py-2 text-right font-semibold">Decide</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {outcomes.map((outcome) => (
                  <OutcomeRow
                    key={outcome.employeeId}
                    outcome={outcome}
                    open={expanded === outcome.employeeId}
                    onToggle={() => setExpanded(expanded === outcome.employeeId ? null : outcome.employeeId)}
                    review={resolved.get(outcome.employeeId)}
                    // Nothing was written, so there is nothing to act on yet.
                    canAct={canEdit && !isPreview}
                    busy={busyEmployeeId === outcome.employeeId}
                    onAction={(action, reason) => onAction(outcome.employeeId, action, reason)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

/**
 * One flagged employee, on one line.
 *
 * This was a stacked card that ran to four lines before it was even expanded, and a list of them
 * could not be scanned — the question "who needs attention and why" is a comparison across rows,
 * which is what a table is for. Everything needed to decide is now on the line: who, their state,
 * what the sync did, why, and the buttons.
 *
 * The expander stays for the two things that genuinely do not fit — the field-level diff and a
 * free-text note recorded with the decision.
 */
function OutcomeRow({
  outcome,
  open,
  onToggle,
  review,
  canAct,
  busy,
  onAction,
}: {
  outcome: SyncEmployeeOutcome;
  open: boolean;
  onToggle: () => void;
  /** A decision already taken on this row since the run, if there is one. */
  review: SyncReviewRecord | undefined;
  canAct: boolean;
  busy: boolean;
  onAction: (action: ReviewAction, reason?: string) => void;
}) {
  const [note, setNote] = useState('');
  const suggested = outcome.suggestedAction ?? null;
  // Only a flag asks for a decision; a row reporting what the sync already did does not.
  const needsDecision = outcome.flagged && !review;

  const outcomeBadge =
    outcome.accessAction === 'deactivate'
      ? { label: 'Login disabled', tone: 'danger' as const, icon: UserX }
      : outcome.accessAction === 'reactivate'
        ? { label: 'Login restored', tone: 'success' as const, icon: UserCheck }
        : outcome.flagged
          ? { label: 'Needs review', tone: 'warning' as const, icon: AlertTriangle }
          : null;

  return (
    <>
      <tr className={cn('align-top hover:bg-slate-50/70', open && 'bg-slate-50/50')}>
        <td className="px-2 py-2">
          <button
            type="button"
            onClick={onToggle}
            aria-label={open ? 'Hide details' : 'Show details'}
            aria-expanded={open}
            className="rounded p-0.5 text-slate-400 hover:text-slate-700"
          >
            <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
          </button>
        </td>

        <td className="max-w-[15rem] px-2 py-2">
          <p className="truncate font-medium text-slate-800">
            {outcome.name || outcome.employeeNo || outcome.employeeId}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {[outcome.employeeNo, outcome.email].filter(Boolean).join(' · ')}
          </p>
        </td>

        <td className="whitespace-nowrap px-2 py-2">
          <StatusBadge status={outcome.employmentState} tone={employmentStateTone(outcome.employmentState)}>
            {outcome.employmentState}
          </StatusBadge>
        </td>

        <td className="whitespace-nowrap px-2 py-2">
          <div className="flex flex-wrap items-center gap-1">
            {review ? (
              <StatusBadge tone="success">
                <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                {review.action === 'dismiss'
                  ? 'Reviewed'
                  : review.action === 'enable'
                    ? 'Login restored'
                    : 'Login disabled'}
              </StatusBadge>
            ) : (
              outcomeBadge && (
                <StatusBadge tone={outcomeBadge.tone}>
                  <outcomeBadge.icon className="h-3 w-3" aria-hidden="true" />
                  {outcomeBadge.label}
                </StatusBadge>
              )
            )}
            {!outcome.userId && (
              <Badge variant="outline" className="gap-1">
                <CircleSlash className="h-3 w-3" />
                No login
              </Badge>
            )}
          </div>
        </td>

        {/* Truncated with the full sentence on hover: the reason is often two lines of prose, and a
            table that wraps one cell to three lines stops being scannable. */}
        <td className="max-w-[24rem] px-2 py-2 text-slate-600">
          <p className="truncate" title={outcome.accessReason}>{outcome.accessReason}</p>
        </td>

        <td className="whitespace-nowrap px-2 py-2 text-right text-muted-foreground">
          {outcome.changes.length || '—'}
        </td>

        <td className="whitespace-nowrap px-2 py-2 text-right">
          {needsDecision && canAct ? (
            <div className="flex items-center justify-end gap-1">
              {/*
                Which buttons appear comes from `suggestedAction` rather than from reading
                `accessReason`: a button that shows or hides on the wording of a sentence is one
                that will eventually be wrong. Where the model offers no suggestion — an employee
                absent from greytHR, which might be an exit or might be the API user's scope
                narrowing — both appear and neither is emphasised.
              */}
              {suggested !== 'disable' && (
                <Button
                  size="sm"
                  variant={suggested === 'enable' ? 'default' : 'outline'}
                  className="h-7 px-2 text-[11px]"
                  disabled={busy || !outcome.userId}
                  onClick={() => onAction('enable', note)}
                >
                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserCheck className="h-3 w-3" />}
                  <span className="ml-1">Enable</span>
                </Button>
              )}
              {suggested !== 'enable' && (
                <Button
                  size="sm"
                  variant={suggested === 'disable' ? 'destructive' : 'outline'}
                  className="h-7 px-2 text-[11px]"
                  disabled={busy || !outcome.userId}
                  onClick={() => onAction('disable', note)}
                >
                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserX className="h-3 w-3" />}
                  <span className="ml-1">Disable</span>
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-[11px]"
                disabled={busy}
                onClick={() => onAction('dismiss', note)}
              >
                <Undo2 className="h-3 w-3" />
                <span className="ml-1">Reviewed</span>
              </Button>
            </div>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
      </tr>

      {open && (
        <tr className="bg-slate-50/60">
          <td />
          <td colSpan={6} className="px-2 pb-3">
            <div className="grid gap-3 sm:grid-cols-2">
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

            {needsDecision && canAct && (
              <Input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                disabled={busy}
                placeholder="Why (optional) — recorded on the account and in the audit trail"
                className="mt-3 h-8 text-xs"
              />
            )}

            {!outcome.userId && outcome.flagged && (
              <p className="mt-2 text-[11px] text-amber-700">
                No platform login is linked to this employee, so there is nothing to enable or
                disable — only to mark as reviewed.
              </p>
            )}

            {review && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                {review.message} — {review.reviewedByName || review.reviewedBy},{' '}
                {formatDistanceToNow(new Date(review.reviewedAt), { addSuffix: true })}
                {review.reason ? ` · ${review.reason}` : ''}
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

const formatValue = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
};

/* ------------------------------------------------------------------------------------------------
 * Run history
 * ---------------------------------------------------------------------------------------------- */

/**
 * The run history, one run per line.
 *
 * It was a stack of cards, each four lines tall with its counters as badges, so a dozen runs filled
 * the screen and the one question the history answers — "is this healthy, and when did that change"
 * — needed scrolling and arithmetic. Counters belong in columns: a zero under `Added` reads as a
 * zero at a glance, where a badge saying "0 added" has to be read.
 *
 * Now that the schedule actually fires, this list is mostly cron runs that all look alike, which is
 * exactly the case a table serves and a card list does not.
 */
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

  /** A count cell: zero is muted so a non-zero one is what the eye lands on. */
  const count = (value: number, tone?: string) => (
    <td className={cn('whitespace-nowrap px-2 py-2 text-right tabular-nums', value ? tone : 'text-slate-300')}>
      {value}
    </td>
  );

  return (
    <Card className="overflow-hidden border-white/60 bg-white/85 shadow-sm backdrop-blur-sm">
      {/* Native overflow, not `ScrollArea` — that wrapper swallows the horizontal scrollbar. */}
      <div className="max-h-[32rem] min-w-0 overflow-auto">
        <table className="w-full min-w-[52rem] border-collapse text-left text-xs">
          <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-sm">
            <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="px-2 py-2 font-semibold">When</th>
              <th scope="col" className="px-2 py-2 font-semibold">Trigger</th>
              <th scope="col" className="px-2 py-2 font-semibold">Result</th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">Took</th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">Fetched</th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">Added</th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">Updated</th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">Disabled</th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">Restored</th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">Flagged</th>
              <th scope="col" className="px-2 py-2 font-semibold">Scope</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {runs.map((run) => (
              <tr key={run.id} className="hover:bg-slate-50/70">
                <td className="whitespace-nowrap px-2 py-2">
                  <span className="font-medium text-slate-800">{formatWhen(run.startedAt)}</span>
                  {run.triggeredByName && (
                    <span className="block text-[11px] text-muted-foreground">by {run.triggeredByName}</span>
                  )}
                </td>

                <td className="whitespace-nowrap px-2 py-2">
                  <Badge variant="outline" className="capitalize">{run.trigger}</Badge>
                </td>

                <td className="whitespace-nowrap px-2 py-2">
                  <StatusBadge status={run.ok ? 'Succeeded' : 'Failed'} tone={run.ok ? 'success' : 'danger'} />
                  {run.error && (
                    // Truncated with the whole message on hover: an error is usually a sentence or
                    // two, and letting one row grow to three lines undoes the point of the table.
                    <span className="ml-1 inline-block max-w-[16rem] truncate align-middle text-destructive" title={run.error}>
                      {run.error}
                    </span>
                  )}
                </td>

                <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-muted-foreground">
                  {Math.round(run.tookMs / 1000)}s
                </td>

                {count(run.employeesFetched, 'text-slate-700')}
                {count(run.employeesCreated, 'text-slate-700')}
                {count(run.employeesUpdated, 'text-slate-700')}
                {count(run.usersDeactivated, 'font-medium text-rose-700')}
                {count(run.usersReactivated, 'font-medium text-emerald-700')}
                {count(run.flaggedForReview, 'font-medium text-amber-700')}

                <td className="whitespace-nowrap px-2 py-2 text-[11px] text-muted-foreground">
                  {run.fullResync ? (
                    <Badge variant="outline">Full refresh</Badge>
                  ) : run.modifiedSince ? (
                    `since ${run.modifiedSince}`
                  ) : (
                    '—'
                  )}
                  {/* Only once the run actually carries it — every run before this change does not. */}
                  {run.unitsRun?.length ? (
                    <span className="block truncate" title={run.unitsRun.join(', ')}>
                      {run.unitsRun.length} unit{run.unitsRun.length === 1 ? '' : 's'}
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
