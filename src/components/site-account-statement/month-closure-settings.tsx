'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  collection, deleteField, doc, getDocs, onSnapshot, orderBy, query, serverTimestamp, setDoc, where,
} from 'firebase/firestore';
import {
  AlertTriangle, Building2, CalendarRange, CheckCircle2, ChevronLeft, ChevronRight, Clock,
  Loader2, Lock, LockOpen, ShieldAlert, ShieldCheck, Timer, Undo2,
} from 'lucide-react';
import { db } from '@/lib/firebase';
import { PageHeader } from '@/components/shared/page-header';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { useToast } from '@/hooks/use-toast';
import {
  formatINR, SAS_COLLECTIONS, SAS_MONTH_CLOSURE_DOC_ID,
  type SASExpense, type SASPayment, type SASProject,
} from '@/lib/site-account-statement';
import {
  ALL_PROJECTS,
  canClosePeriod,
  canFollowAllProjects,
  canReopenPeriod,
  closureFor,
  effectiveClosure,
  isAllProjectsScope,
  monthState,
  addDays,
  localToday,
  periodsToBulkClose,
  projectsWithOverride,
  relockDateFor,
  RELOCK_PRESETS,
  resolveMonthClosure,
  summariseClosure,
  upcomingAutoCloses,
  validateReopenReason,
  type ClosureScope,
  type MonthState,
  type SASAutoCloseRule,
  type SASMonthClosureSettings,
} from '@/lib/site-account-statement-month-closure';
import { AutoCloseRuleCard } from '@/components/site-account-statement/auto-close-rule-card';
import {
  currentPeriod, fyLabelOf, fyPeriods, fyStartOf, periodLabel,
} from '@/lib/site-account-statement-period-range';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

const MODULE = 'Site Account Statement';

/** What a month holds, so nobody closes one without seeing inside it. */
interface MonthContents {
  expenseCount: number;
  expenseTotal: number;
  receiptCount: number;
  receiptTotal: number;
  /** Budget allocations still awaiting verification — closing would strand them. */
  pendingAllocations: number;
}

const EMPTY_CONTENTS: MonthContents = {
  expenseCount: 0, expenseTotal: 0, receiptCount: 0, receiptTotal: 0, pendingAllocations: 0,
};

const STATE_STYLE: Record<MonthState, { ring: string; chip: string; label: string }> = {
  closed:  { ring: 'border-slate-300 bg-slate-50',      chip: 'bg-slate-700 text-white',       label: 'Closed' },
  current: { ring: 'border-amber-300 bg-amber-50/60',   chip: 'bg-amber-500 text-white',       label: 'In progress' },
  open:    { ring: 'border-emerald-200 bg-emerald-50/40', chip: 'bg-emerald-600 text-white',   label: 'Open' },
  future:  { ring: 'border-slate-200 bg-white',          chip: 'bg-slate-200 text-slate-600',  label: 'Not started' },
};

/** `2026-09` → the first and last day, for a range query. */
function monthBounds(period: string): { from: string; to: string } {
  const [year, month] = period.split('-').map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, '0')}` };
}

export default function SiteAccountMonthClosureSettings() {
  const { user } = useAuth();
  const { can, isLoading: authLoading } = useAuthorization();
  const { log } = useActivityLogger(MODULE);
  const { toast } = useToast();

  /*
   * `Month Closure` is a new resource, so no role document grants it yet and the page would refuse
   * everyone — including whoever needs to grant it. Project Settings stands in: the people who
   * administer which projects exist are the people who own the accounting calendar. One-directional
   * on purpose, exactly as Date Control falls back to Field Control: holding Month Closure never
   * implies Project Settings.
   */
  const canView   = can('View', `${MODULE}.Month Closure`) || can('Close', `${MODULE}.Month Closure`)
    || can('Edit', `${MODULE}.Project Settings`) || can('View', `${MODULE}.All Projects`);
  const canClose  = can('Close', `${MODULE}.Month Closure`) || can('Edit', `${MODULE}.Project Settings`);
  const canReopen = can('Reopen', `${MODULE}.Month Closure`) || can('Edit', `${MODULE}.Project Settings`);

  const now = currentPeriod();
  const [fyStart, setFyStart] = useState(() => fyStartOf(now));
  /** `ALL_PROJECTS`, or one project id. Everything on this screen is read through it. */
  const [scope, setScope] = useState<ClosureScope>(ALL_PROJECTS);
  const [projects, setProjects] = useState<SASProject[]>([]);
  /*
   * The stored document, resolved for today on every render. Months close themselves on their
   * trigger day, so the same document reads differently tomorrow; the minute tick below makes a
   * screen left open roll over at midnight like the forms do.
   */
  const [closureRaw, setClosureRaw] = useState<Partial<SASMonthClosureSettings> | null>(null);
  const [today, setToday] = useState(localToday);
  useEffect(() => {
    const id = setInterval(() => {
      const next = localToday();
      setToday(prev => (prev === next ? prev : next));
    }, 60_000);
    return () => clearInterval(id);
  }, []);
  const closure = useMemo(() => resolveMonthClosure(closureRaw, today), [closureRaw, today]);
  const [loading, setLoading] = useState(true);
  const [contents, setContents] = useState<Record<string, MonthContents>>({});
  const [contentsLoading, setContentsLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // Dialogs
  const [closeTarget, setCloseTarget] = useState<string | null>(null);
  const [closeNote, setCloseNote] = useState('');
  const [reopenTarget, setReopenTarget] = useState<string | null>(null);
  const [reopenReason, setReopenReason] = useState('');
  /** Days until a reopened month locks again; null keeps it open until closed by hand. */
  const [reopenDays, setReopenDays] = useState<number | null>(3);
  const [bulkThrough, setBulkThrough] = useState<string | null>(null);

  /*
   * `undefined` for the all-projects view, a project id otherwise.
   *
   * Every closure helper takes the project as an optional last argument and treats its absence as
   * "the organisation's calendar", so this single value steers the whole screen rather than each
   * call site deciding for itself.
   */
  const scopeProject = isAllProjectsScope(scope) ? undefined : scope;
  const scopeName = scopeProject
    ? projects.find(p => p.id === scopeProject)?.projectName ?? 'this project'
    : 'all projects';

  const periods = useMemo(() => fyPeriods(fyStart), [fyStart]);
  const summary = useMemo(
    () => summariseClosure(periods, closure, now, scopeProject),
    [periods, closure, now, scopeProject],
  );

  useEffect(() => {
    void (async () => {
      try {
        const snap = await getDocs(query(collection(db, SAS_COLLECTIONS.projects), orderBy('projectName')));
        setProjects(
          snap.docs
            .map(d => ({ id: d.id, ...d.data() } as SASProject))
            .filter(p => p.enabledForSiteAccount && p.status === 'Active'),
        );
      } catch { /* the scope picker falls back to all-projects only */ }
    })();
  }, []);

  useEffect(
    () =>
      onSnapshot(
        doc(db, SAS_COLLECTIONS.settings, SAS_MONTH_CLOSURE_DOC_ID),
        snapshot => {
          setClosureRaw((snapshot.data() as Partial<SASMonthClosureSettings> | undefined) ?? null);
          setLoading(false);
        },
        () => setLoading(false),
      ),
    [],
  );

  /*
   * What each month of the selected year contains.
   *
   * Closing a period blind is the failure this screen exists to prevent — "September had eleven
   * expenses and two receipts still unposted" is the fact that changes the decision. Queried once
   * per financial year across the whole year's range rather than month by month, so changing the
   * year costs two reads, not twenty-four.
   */
  useEffect(() => {
    let cancelled = false;
    const from = `${fyStart}-04-01`;
    const to = `${fyStart + 1}-03-31`;

    async function loadContents() {
      setContentsLoading(true);
      const tally: Record<string, MonthContents> = {};
      const bucket = (period: string) => (tally[period] ??= { ...EMPTY_CONTENTS });
      try {
        const [expenseSnap, receiptSnap] = await Promise.all([
          getDocs(query(
            collection(db, SAS_COLLECTIONS.expenses),
            where('expenseDate', '>=', from), where('expenseDate', '<=', to),
          )),
          getDocs(query(
            collection(db, SAS_COLLECTIONS.payments),
            where('receiptDate', '>=', from), where('receiptDate', '<=', to),
          )),
        ]);
        for (const d of expenseSnap.docs) {
          const row = d.data() as SASExpense;
          if (scopeProject && row.projectId !== scopeProject) continue;
          const b = bucket((row.expenseDate ?? '').slice(0, 7));
          b.expenseCount++;
          b.expenseTotal += Number(row.expenseAmount) || 0;
        }
        for (const d of receiptSnap.docs) {
          const row = d.data() as SASPayment;
          if (scopeProject && row.projectId !== scopeProject) continue;
          const b = bucket((row.receiptDate ?? '').slice(0, 7));
          b.receiptCount++;
          b.receiptTotal += Number(row.receivedAmount) || 0;
        }
        // Unverified allocations are counted separately: they are the one thing a closure would
        // strand, since nobody can verify an instalment into a frozen month.
        try {
          const allocSnap = await getDocs(query(
            collection(db, SAS_COLLECTIONS.budgetAllocations),
            where('status', '==', 'pending'),
          ));
          for (const d of allocSnap.docs) {
            const row = d.data() as { period?: string; projectId?: string };
            if (scopeProject && row.projectId !== scopeProject) continue;
            if (!row.period?.startsWith(String(fyStart)) && !row.period?.startsWith(String(fyStart + 1))) continue;
            bucket(row.period).pendingAllocations++;
          }
        } catch { /* the collection may not exist yet */ }
        if (!cancelled) setContents(tally);
      } catch {
        // A missing index or a permission refusal must not block the closure controls themselves —
        // the counts are context, not the function of the page.
        if (!cancelled) setContents({});
      } finally {
        if (!cancelled) setContentsLoading(false);
      }
    }

    void loadContents();
    return () => { cancelled = true; };
  }, [fyStart, scopeProject]);

  /**
   * Writes period entries into whichever calendar is in scope.
   *
   * The all-projects calendar lives at `months`, a project's exceptions at `projects.<id>`. Both
   * are maps keyed by period, so the shape written is the same either way and only the path
   * differs — which is what lets one set of handlers serve both.
   */
  async function writeClosure(
    entries: Record<string, unknown>,
    activity: string,
    detail: Record<string, unknown>,
  ) {
    await setDoc(
      doc(db, SAS_COLLECTIONS.settings, SAS_MONTH_CLOSURE_DOC_ID),
      {
        ...(scopeProject ? { projects: { [scopeProject]: entries } } : { months: entries }),
        updatedAt: serverTimestamp(),
        updatedBy: user?.id ?? '',
        updatedByName: user?.name ?? '',
      },
      // Merged, so two administrators acting on different months — or different projects — in the
      // same minute do not overwrite each other. A whole-document write would.
      { merge: true },
    );
    void log(activity, { scope: scopeProject ? scopeName : 'All projects', ...detail });
  }

  async function handleClose(period: string) {
    const check = canClosePeriod(period, closure, now, scopeProject);
    if (!check.ok) {
      toast({ title: 'Cannot close', description: check.reason, variant: 'destructive' });
      return;
    }
    setBusy(period);
    try {
      await writeClosure(
        {
          [period]: {
            period,
            closed: true,
            closedAt: serverTimestamp(),
            closedBy: user?.id ?? '',
            closedByName: user?.name ?? '',
            note: closeNote.trim(),
            // Cleared, so a month closed again after a reopen does not still show the old reason
            // — or carry a lock-again date that no longer means anything — as if it were current.
            reopenReason: '',
            relockOn: '',
          },
        },
        'Close SAS Month',
        { period, note: closeNote.trim() },
      );
      toast({
        title: `${periodLabel(period)} closed`,
        description: 'Expenses and receipts dated in this month can no longer be recorded or changed.',
      });
      setCloseTarget(null);
      setCloseNote('');
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  }

  async function handleReopen(period: string) {
    const allowed = canReopenPeriod(period, closure, scopeProject);
    if (!allowed.ok) {
      toast({ title: 'Cannot reopen', description: allowed.reason, variant: 'destructive' });
      return;
    }
    const reasonCheck = validateReopenReason(reopenReason);
    if (!reasonCheck.ok) {
      toast({ title: 'Reason needed', description: reasonCheck.reason, variant: 'destructive' });
      return;
    }
    setBusy(period);
    const relockOn = relockDateFor(today, reopenDays);
    try {
      await writeClosure(
        {
          [period]: {
            ...(closureFor(closure, period, scopeProject) ?? { period }),
            period,
            closed: false,
            reopenedAt: serverTimestamp(),
            reopenedBy: user?.id ?? '',
            reopenedByName: user?.name ?? '',
            reopenReason: reopenReason.trim(),
            // Written explicitly either way, so a reopen with no limit clears any earlier one.
            relockOn: relockOn ?? '',
          },
        },
        'Reopen SAS Month',
        { period, reason: reopenReason.trim(), relockOn: relockOn ?? 'none' },
      );
      toast({
        title: `${periodLabel(period)} reopened`,
        description: relockOn
          ? `Entries can be recorded until it locks again on ${relockOn}. The reason has been logged.`
          : 'Entries dated in this month can be recorded again. The reason has been logged.',
      });
      setReopenTarget(null);
      setReopenReason('');
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  }

  /**
   * Drops a project's exception, putting it back on the organisation's calendar.
   *
   * Distinct from reopening, and the distinction is the point: reopening a project leaves a
   * standing "this site is different" entry that keeps overriding every later all-projects
   * change. Removing it means the site simply follows along again.
   */
  async function handleFollowAll(period: string) {
    if (!scopeProject) return;
    setBusy(period);
    try {
      await setDoc(
        doc(db, SAS_COLLECTIONS.settings, SAS_MONTH_CLOSURE_DOC_ID),
        {
          projects: { [scopeProject]: { [period]: deleteField() } },
          updatedAt: serverTimestamp(),
          updatedBy: user?.id ?? '',
          updatedByName: user?.name ?? '',
        },
        { merge: true },
      );
      void log('Clear SAS Month Exception', { scope: scopeName, period });
      toast({
        title: `${periodLabel(period)} follows all projects`,
        description: `${scopeName} no longer has its own setting for this month.`,
      });
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  }

  /**
   * Saves the automatic rule for the scope in view.
   *
   * The card has already confirmed with the user what the change does, and collected a reason if
   * it reopens anything. This writes it, under the organisation's rule or the project's, and
   * removes a project's rule entirely when it goes back to following the organisation.
   */
  async function handleSaveRule(next: SASAutoCloseRule | null, changeReason: string) {
    const stamp = {
      updatedAt: serverTimestamp(),
      updatedBy: user?.id ?? '',
      updatedByName: user?.name ?? '',
    };
    const value = next
      ? {
          enabled: next.enabled,
          dayOfNextMonth: next.dayOfNextMonth,
          startPeriod: next.startPeriod,
          // Explicit, so an earlier reason does not linger on a later, unrelated change.
          changeReason,
          ...stamp,
        }
      : deleteField();
    try {
      await setDoc(
        doc(db, SAS_COLLECTIONS.settings, SAS_MONTH_CLOSURE_DOC_ID),
        {
          ...(scopeProject
            ? { projectAutoClose: { [scopeProject]: value } }
            : { autoClose: value }),
          ...stamp,
        },
        { merge: true },
      );
      void log('Change SAS Auto-Close Rule', {
        scope: scopeProject ? scopeName : 'All projects',
        rule: next ? `${next.enabled ? 'on' : 'off'} · day ${next.dayOfNextMonth} · from ${next.startPeriod}` : 'follows all projects',
        ...(changeReason ? { reason: changeReason } : {}),
      });
      toast({ title: 'Automatic closing saved', description: `For ${scopeProject ? scopeName : 'all projects'}.` });
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
      throw e;
    }
  }

  async function handleBulkClose(through: string) {
    const targets = periodsToBulkClose(periods, through, closure, now, scopeProject);
    if (targets.length === 0) {
      toast({ title: 'Nothing to close', description: 'Every month up to there is already closed.' });
      return;
    }
    setBusy('bulk');
    try {
      const stamp = serverTimestamp();
      await writeClosure(
        Object.fromEntries(targets.map(period => [period, {
          period, closed: true, closedAt: stamp,
          closedBy: user?.id ?? '', closedByName: user?.name ?? '',
          note: `Closed with ${targets.length} months through ${periodLabel(through)}.`,
          reopenReason: '',
          relockOn: '',
        }])),
        'Close SAS Months (bulk)',
        { through, count: targets.length, periods: targets.join(', ') },
      );
      toast({
        title: `${targets.length} month${targets.length === 1 ? '' : 's'} closed`,
        description: `Up to and including ${periodLabel(through)}.`,
      });
      setBulkThrough(null);
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  }

  if (authLoading || loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-emerald-600" />
      </div>
    );
  }

  if (!canView) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <ShieldAlert className="h-12 w-12 text-destructive" />
          <p className="font-semibold text-slate-800">Access Denied</p>
          <p className="text-sm text-muted-foreground">You don&apos;t have permission to manage month closure.</p>
        </CardContent>
      </Card>
    );
  }

  const fyOptions = Array.from({ length: 7 }, (_, i) => fyStartOf(now) + 1 - i);
  const bulkCandidates = periods.filter(p => canClosePeriod(p, closure, now, scopeProject).ok);
  const bulkTargets = bulkThrough
    ? periodsToBulkClose(periods, bulkThrough, closure, now, scopeProject)
    : [];
  const closeContents = closeTarget ? contents[closeTarget] ?? EMPTY_CONTENTS : EMPTY_CONTENTS;
  // Open months a rule will close later, so each card can say when.
  const upcoming = upcomingAutoCloses(periods, closure, scopeProject);
  const relockPreview = relockDateFor(today, reopenDays);

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Site Account Statement · Settings"
        title="Month Closure"
        description="Freeze an accounting period once it has been reported on."
      />

      {/*
        * ── Scope ──
        * Its own bar, above everything it governs: the automatic rule, which months read as
        * closed, what the close and reopen buttons write, and whose figures are counted.
        */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-white/80 px-4 py-3">
        <Building2 className="h-4 w-4 shrink-0 text-slate-500" />
        <span className="text-sm font-medium text-slate-700">Showing</span>
        <Select value={scope} onValueChange={v => setScope(v as ClosureScope)}>
          <SelectTrigger className="w-full sm:w-[280px]" aria-label="Closure scope">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_PROJECTS}>All projects</SelectItem>
            {projects.map(p => (
              <SelectItem key={p.id} value={p.id}>
                {p.projectName}{p.projectCode ? ` (${p.projectCode})` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          {scopeProject
            ? 'Changes here apply to this project only and override the all-projects settings.'
            : 'Changes here apply to every project that has no setting of its own.'}
        </span>
      </div>

      {/* ── The automatic rule ── */}
      <AutoCloseRuleCard
        // Keyed by scope, so a draft for one project never carries over to another.
        key={scope}
        closure={closure}
        scopeProject={scopeProject}
        scopeName={scopeName}
        currentPeriodKey={now}
        canClose={canClose}
        canReopen={canReopen}
        onSave={handleSaveRule}
      />

      {/* ── Year picker and totals ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="text-base">
                FY {fyLabelOf(fyStart)} · {scopeProject ? scopeName : 'All projects'}
              </CardTitle>
              <CardDescription>
                {summary.closed} of {summary.total} months closed
                {summary.closable > 0 && <> · {summary.closable} can be closed now</>}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline" size="icon" className="h-9 w-9"
                aria-label="Previous financial year"
                onClick={() => setFyStart(y => y - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Select value={String(fyStart)} onValueChange={v => setFyStart(Number(v))}>
                <SelectTrigger className="w-[150px]" aria-label="Financial year">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {fyOptions.map(y => (
                    <SelectItem key={y} value={String(y)}>FY {fyLabelOf(y)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline" size="icon" className="h-9 w-9"
                aria-label="Next financial year"
                onClick={() => setFyStart(y => y + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              {canClose && bulkCandidates.length > 1 && (
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={() => setBulkThrough(bulkCandidates[bulkCandidates.length - 1])}
                >
                  <Lock className="h-4 w-4" />
                  Close through…
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {/* `grid-cols-1` is explicit: without it the cards stretch past a phone's width. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {periods.map(period => {
              const state = monthState(period, closure, now, scopeProject);
              const style = STATE_STYLE[state];
              const effect = effectiveClosure(closure, period, scopeProject);
              const record = effect.record;
              const held = contents[period] ?? EMPTY_CONTENTS;
              const isBusy = busy === period;
              const hasActivity = held.expenseCount > 0 || held.receiptCount > 0;
              // On the all-projects view, the sites that are somewhere else this month.
              const differing = scopeProject ? [] : projectsWithOverride(closure, period);
              const hasOwnEntry = Boolean(scopeProject && effect.source === 'project');
              // A project rule makes the month this site's own even with no manual entry.
              const ownRule = Boolean(scopeProject && effect.autoScope === 'project');
              const autoCloseOn = upcoming[period];

              return (
                <div key={period} className={cn('rounded-xl border p-3', style.ring)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800">{periodLabel(period)}</p>
                      <span className={cn('mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium', style.chip)}>
                        {state === 'closed' ? <Lock className="h-2.5 w-2.5" />
                          : state === 'current' ? <Clock className="h-2.5 w-2.5" />
                          : state === 'open' ? <LockOpen className="h-2.5 w-2.5" />
                          : null}
                        {style.label}
                      </span>
                      {/*
                        * Where the state came from. "Closed because everyone is" and "closed
                        * because this site was frozen early" need different actions, and an
                        * administrator who cannot tell them apart undoes the wrong one.
                        */}
                      {scopeProject && (
                        <span className={cn(
                          'ml-1 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium',
                          hasOwnEntry || ownRule ? 'bg-violet-100 text-violet-800' : 'bg-slate-100 text-slate-600',
                        )}>
                          {hasOwnEntry ? 'This project only' : ownRule ? "This project's rule" : 'Follows all projects'}
                        </span>
                      )}
                      {effect.source === 'auto' && (
                        <span className="ml-1 inline-flex items-center gap-0.5 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-800">
                          <Timer className="h-2.5 w-2.5" /> Automatic
                        </span>
                      )}
                      {differing.length > 0 && (
                        <span
                          title={`${differing.length} project(s) have their own setting for this month`}
                          className="ml-1 inline-flex items-center gap-0.5 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-800"
                        >
                          <Building2 className="h-2.5 w-2.5" />
                          {differing.length} differ{differing.length === 1 ? 's' : ''}
                        </span>
                      )}
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {state === 'closed'
                        ? canReopen && (
                          <Button
                            variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs"
                            disabled={isBusy}
                            // Each reopen starts from the default lock-again period, not whatever
                            // the previous reopen in this session happened to choose.
                            onClick={() => { setReopenTarget(period); setReopenReason(''); setReopenDays(3); }}
                          >
                            {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <LockOpen className="h-3 w-3" />}
                            Reopen{scopeProject ? ' here' : ''}
                          </Button>
                        )
                        : canClose && canClosePeriod(period, closure, now, scopeProject).ok && (
                          <Button
                            size="sm" className="h-7 gap-1 bg-slate-700 px-2 text-xs hover:bg-slate-800"
                            disabled={isBusy}
                            onClick={() => { setCloseTarget(period); setCloseNote(''); }}
                          >
                            {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Lock className="h-3 w-3" />}
                            Close{scopeProject ? ' here' : ''}
                          </Button>
                        )}

                      {/* Dropping the exception differs from reopening: it stops this site
                          overriding every later all-projects change. */}
                      {hasOwnEntry && (canClose || canReopen)
                        && canFollowAllProjects(period, closure, scopeProject!).ok && (
                        <Button
                          variant="ghost" size="sm" className="h-6 gap-1 px-2 text-[11px] text-muted-foreground"
                          disabled={isBusy}
                          title="Remove this project's own setting and follow the all-projects calendar"
                          onClick={() => void handleFollowAll(period)}
                        >
                          <Undo2 className="h-3 w-3" />
                          Follow all
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* What the month holds — the fact that should drive the decision. */}
                  <div className="mt-2.5 space-y-0.5 border-t pt-2 text-[11px]">
                    {contentsLoading ? (
                      <p className="text-muted-foreground">Counting…</p>
                    ) : hasActivity ? (
                      <>
                        <p className="text-rose-700">
                          {held.expenseCount} expense{held.expenseCount === 1 ? '' : 's'} · {formatINR(held.expenseTotal)}
                        </p>
                        <p className="text-blue-700">
                          {held.receiptCount} receipt{held.receiptCount === 1 ? '' : 's'} · {formatINR(held.receiptTotal)}
                        </p>
                      </>
                    ) : (
                      <p className="text-muted-foreground">No entries recorded</p>
                    )}
                    {held.pendingAllocations > 0 && state !== 'closed' && (
                      <p className="flex items-center gap-1 text-amber-700">
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        {held.pendingAllocations} budget allocation{held.pendingAllocations === 1 ? '' : 's'} awaiting verification
                      </p>
                    )}
                  </div>

                  {/* The audit trail, on the card rather than buried in a log. */}
                  {effect.source === 'auto' && (
                    <p className="mt-2 text-[10px] text-indigo-700">
                      Closed automatically on {effect.closesOn}
                      {effect.autoScope === 'project' ? " by this project's rule" : ''}
                    </p>
                  )}
                  {!effect.closed && autoCloseOn && (
                    <p className="mt-2 flex items-center gap-1 text-[10px] text-indigo-700">
                      <Timer className="h-2.5 w-2.5 shrink-0" />
                      Closes automatically on {autoCloseOn}
                    </p>
                  )}
                  {record?.closed && (
                    <p className="mt-2 text-[10px] text-muted-foreground">
                      Closed{record.closedByName ? ` by ${record.closedByName}` : ''}
                      {record.note ? ` — ${record.note}` : ''}
                    </p>
                  )}
                  {effect.relocked && record?.relockOn && (
                    <p className="mt-2 text-[10px] text-muted-foreground">
                      Was reopened{record.reopenedByName ? ` by ${record.reopenedByName}` : ''}; locked again on {record.relockOn}
                    </p>
                  )}
                  {!effect.closed && record?.relockOn && (
                    <p className="mt-2 flex items-center gap-1 text-[10px] text-amber-700">
                      <Timer className="h-2.5 w-2.5 shrink-0" />
                      Locks again on {record.relockOn}
                    </p>
                  )}
                  {!record?.closed && !effect.relocked && record?.reopenReason && (
                    <p className="mt-2 text-[10px] text-amber-700">
                      Reopened{record.reopenedByName ? ` by ${record.reopenedByName}` : ''} — {record.reopenReason}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ── Close one month ── */}
      <Dialog open={Boolean(closeTarget)} onOpenChange={open => { if (!open) setCloseTarget(null); }}>
        <DialogContent className="max-w-[95vw] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Close {closeTarget ? periodLabel(closeTarget) : ''} · {scopeProject ? scopeName : 'all projects'}
            </DialogTitle>
            <DialogDescription>
              Afterwards, no expense or receipt dated in this month can be added, edited or deleted
              by anyone — including you. Reopening is possible but requires a written reason and
              stays on the record.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 rounded-lg border bg-muted/30 px-3 py-2.5 text-xs">
            <p className="font-medium text-slate-700">This month currently holds</p>
            <p className="text-rose-700">
              {closeContents.expenseCount} expense{closeContents.expenseCount === 1 ? '' : 's'} · {formatINR(closeContents.expenseTotal)}
            </p>
            <p className="text-blue-700">
              {closeContents.receiptCount} receipt{closeContents.receiptCount === 1 ? '' : 's'} · {formatINR(closeContents.receiptTotal)}
            </p>
          </div>

          {closeContents.pendingAllocations > 0 && (
            <p className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
              {closeContents.pendingAllocations} budget allocation
              {closeContents.pendingAllocations === 1 ? '' : 's'} for this month
              {closeContents.pendingAllocations === 1 ? ' is' : ' are'} still awaiting verification.
              Verify or reject {closeContents.pendingAllocations === 1 ? 'it' : 'them'} first, or
              {closeContents.pendingAllocations === 1 ? ' it' : ' they'} will sit against a month
              nobody can post to.
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="close-note">Note (optional)</Label>
            <Textarea
              id="close-note" rows={2}
              placeholder="e.g. Figures reported to Head Office on the 5th."
              value={closeNote}
              onChange={e => setCloseNote(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseTarget(null)} disabled={busy !== null}>Cancel</Button>
            <Button
              className="gap-2 bg-slate-700 hover:bg-slate-800"
              disabled={busy !== null}
              onClick={() => closeTarget && void handleClose(closeTarget)}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
              Close month
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reopen ── */}
      <Dialog open={Boolean(reopenTarget)} onOpenChange={open => { if (!open) setReopenTarget(null); }}>
        <DialogContent className="max-w-[95vw] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Reopen {reopenTarget ? periodLabel(reopenTarget) : ''} · {scopeProject ? scopeName : 'all projects'}
            </DialogTitle>
            <DialogDescription>
              This month has already been reported on. The reason below is kept with the month and
              in the activity log, and stays visible on this screen.
            </DialogDescription>
          </DialogHeader>

          {reopenTarget && closureFor(closure, reopenTarget)?.closedByName && (
            <p className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Closed by {closureFor(closure, reopenTarget)?.closedByName}
              {closureFor(closure, reopenTarget)?.note ? ` — ${closureFor(closure, reopenTarget)?.note}` : ''}
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="reopen-reason">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="reopen-reason" rows={3}
              placeholder="e.g. Vendor bill dated 28 Sep arrived late; HO approved a restated September."
              value={reopenReason}
              onChange={e => setReopenReason(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Written for whoever reads this in a year — say what arrived and who authorised it.
            </p>
          </div>

          {/*
            * How long the reopen lasts. A reopen is nearly always for one correction, and a month
            * left open "until someone remembers" is how a closed period stops being one — so it
            * defaults to locking again by itself.
            */}
          <div className="space-y-1.5">
            <Label>Lock again automatically</Label>
            <div className="flex flex-wrap gap-2">
              {RELOCK_PRESETS.map(preset => (
                <Button
                  key={preset.label}
                  type="button" size="sm"
                  variant={reopenDays === preset.days ? 'default' : 'outline'}
                  onClick={() => setReopenDays(preset.days)}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {relockPreview
                ? `Open through ${addDays(relockPreview, -1)}; locks again on ${relockPreview}.`
                : 'Stays open until someone closes it by hand.'}
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setReopenTarget(null)} disabled={busy !== null}>Cancel</Button>
            <Button
              className="gap-2"
              disabled={busy !== null || !validateReopenReason(reopenReason).ok}
              onClick={() => reopenTarget && void handleReopen(reopenTarget)}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockOpen className="h-4 w-4" />}
              Reopen month
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Bulk close ── */}
      <Dialog open={Boolean(bulkThrough)} onOpenChange={open => { if (!open) setBulkThrough(null); }}>
        <DialogContent className="max-w-[95vw] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Close several months</DialogTitle>
            <DialogDescription>
              Year-end is rarely one padlock at a time. Pick the last month to close; everything up
              to it that is eligible closes together.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label>Close everything through</Label>
            <Select value={bulkThrough ?? ''} onValueChange={setBulkThrough}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {bulkCandidates.map(p => (
                  <SelectItem key={p} value={p}>{periodLabel(p)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* The resolved list, not a promise about one — this is the irreversible-ish step. */}
          <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
            <p className="text-xs font-medium text-slate-700">
              {bulkTargets.length} month{bulkTargets.length === 1 ? '' : 's'} will close
            </p>
            {bulkTargets.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Everything up to there is already closed.
              </p>
            ) : (
              // A div, not a p: Badge renders a div, which is invalid inside a paragraph and
              // surfaces as a hydration error rather than as anything visible.
              <div className="mt-1 flex flex-wrap gap-1">
                {bulkTargets.map(p => (
                  <Badge key={p} variant="outline" className="text-[11px]">{periodLabel(p)}</Badge>
                ))}
              </div>
            )}
            {bulkTargets.some(p => (contents[p]?.pendingAllocations ?? 0) > 0) && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700">
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                Some of these months have budget allocations awaiting verification.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkThrough(null)} disabled={busy !== null}>Cancel</Button>
            <Button
              className="gap-2 bg-slate-700 hover:bg-slate-800"
              disabled={busy !== null || bulkTargets.length === 0}
              onClick={() => bulkThrough && void handleBulkClose(bulkThrough)}
            >
              {busy === 'bulk' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
              Close {bulkTargets.length} month{bulkTargets.length === 1 ? '' : 's'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {!canClose && !canReopen && (
        <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          You can see the closure calendar but not change it.
        </p>
      )}
    </div>
  );
}
