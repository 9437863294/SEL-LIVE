'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  collection, doc, getDocs, onSnapshot, query, serverTimestamp, setDoc, where,
} from 'firebase/firestore';
import {
  AlertTriangle, CalendarRange, CheckCircle2, ChevronLeft, ChevronRight, Clock,
  Loader2, Lock, LockOpen, ShieldAlert, ShieldCheck,
} from 'lucide-react';
import { db } from '@/lib/firebase';
import { PageHeader } from '@/components/shared/page-header';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { useToast } from '@/hooks/use-toast';
import {
  formatINR, SAS_COLLECTIONS, SAS_MONTH_CLOSURE_DOC_ID,
  type SASExpense, type SASPayment,
} from '@/lib/site-account-statement';
import {
  canClosePeriod,
  canReopenPeriod,
  closureFor,
  monthState,
  periodsToBulkClose,
  resolveMonthClosure,
  summariseClosure,
  validateReopenReason,
  type MonthState,
  type SASMonthClosureSettings,
} from '@/lib/site-account-statement-month-closure';
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
  const [closure, setClosure] = useState<SASMonthClosureSettings>(() => resolveMonthClosure(null));
  const [loading, setLoading] = useState(true);
  const [contents, setContents] = useState<Record<string, MonthContents>>({});
  const [contentsLoading, setContentsLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // Dialogs
  const [closeTarget, setCloseTarget] = useState<string | null>(null);
  const [closeNote, setCloseNote] = useState('');
  const [reopenTarget, setReopenTarget] = useState<string | null>(null);
  const [reopenReason, setReopenReason] = useState('');
  const [bulkThrough, setBulkThrough] = useState<string | null>(null);

  const periods = useMemo(() => fyPeriods(fyStart), [fyStart]);
  const summary = useMemo(() => summariseClosure(periods, closure, now), [periods, closure, now]);

  useEffect(
    () =>
      onSnapshot(
        doc(db, SAS_COLLECTIONS.settings, SAS_MONTH_CLOSURE_DOC_ID),
        snapshot => {
          setClosure(resolveMonthClosure(snapshot.data() as Partial<SASMonthClosureSettings> | undefined));
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
          const b = bucket((row.expenseDate ?? '').slice(0, 7));
          b.expenseCount++;
          b.expenseTotal += Number(row.expenseAmount) || 0;
        }
        for (const d of receiptSnap.docs) {
          const row = d.data() as SASPayment;
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
            const row = d.data() as { period?: string };
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
  }, [fyStart]);

  async function writeClosure(next: Record<string, unknown>, activity: string, detail: Record<string, unknown>) {
    await setDoc(
      doc(db, SAS_COLLECTIONS.settings, SAS_MONTH_CLOSURE_DOC_ID),
      {
        months: next,
        updatedAt: serverTimestamp(),
        updatedBy: user?.id ?? '',
        updatedByName: user?.name ?? '',
      },
      // Merged, so two administrators closing different months in the same minute do not overwrite
      // each other's month — a whole-document write would.
      { merge: true },
    );
    void log(activity, detail);
  }

  async function handleClose(period: string) {
    const check = canClosePeriod(period, closure, now);
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
            // as if it were current.
            reopenReason: '',
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
    const allowed = canReopenPeriod(period, closure);
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
    try {
      await writeClosure(
        {
          [period]: {
            ...(closureFor(closure, period) ?? { period }),
            period,
            closed: false,
            reopenedAt: serverTimestamp(),
            reopenedBy: user?.id ?? '',
            reopenedByName: user?.name ?? '',
            reopenReason: reopenReason.trim(),
          },
        },
        'Reopen SAS Month',
        { period, reason: reopenReason.trim() },
      );
      toast({
        title: `${periodLabel(period)} reopened`,
        description: 'Entries dated in this month can be recorded again. The reason has been logged.',
      });
      setReopenTarget(null);
      setReopenReason('');
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  }

  async function handleBulkClose(through: string) {
    const targets = periodsToBulkClose(periods, through, closure, now);
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
  const bulkCandidates = periods.filter(p => canClosePeriod(p, closure, now).ok);
  const bulkTargets = bulkThrough ? periodsToBulkClose(periods, bulkThrough, closure, now) : [];
  const closeContents = closeTarget ? contents[closeTarget] ?? EMPTY_CONTENTS : EMPTY_CONTENTS;

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Site Account Statement · Settings"
        title="Month Closure"
        description="Freeze an accounting period once it has been reported on."
      />

      {/* ── What the lock actually does ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarRange className="h-4 w-4 text-indigo-600" />
            How closure works
          </CardTitle>
          <CardDescription>
            A closed month refuses any expense or receipt dated inside it — new entries, edits, and
            entries moved into it — no matter how recent today is. This is separate from Date
            Control, which limits how late an entry may be filed while a month is still open; both
            apply, and either can refuse a date.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-2 text-xs text-muted-foreground sm:grid-cols-3">
          <p className="rounded-lg border bg-muted/30 px-3 py-2">
            <strong className="text-slate-700">Closing</strong> needs the Month Closure · Close
            permission. Its holder can still post into months they have closed, so a single
            correction does not require unlocking the period for everyone.
          </p>
          <p className="rounded-lg border bg-muted/30 px-3 py-2">
            <strong className="text-slate-700">Reopening</strong> needs Month Closure · Reopen and a
            written reason, which is kept with the month and in the activity log.
          </p>
          <p className="rounded-lg border bg-muted/30 px-3 py-2">
            <strong className="text-slate-700">The current month</strong> cannot be closed while it
            is still running, and neither can a month that has not started.
          </p>
        </CardContent>
      </Card>

      {/* ── Year picker and totals ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">FY {fyLabelOf(fyStart)}</CardTitle>
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
              const state = monthState(period, closure, now);
              const style = STATE_STYLE[state];
              const record = closureFor(closure, period);
              const held = contents[period] ?? EMPTY_CONTENTS;
              const isBusy = busy === period;
              const hasActivity = held.expenseCount > 0 || held.receiptCount > 0;

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
                    </div>

                    {state === 'closed'
                      ? canReopen && (
                        <Button
                          variant="outline" size="sm" className="h-7 shrink-0 gap-1 px-2 text-xs"
                          disabled={isBusy}
                          onClick={() => { setReopenTarget(period); setReopenReason(''); }}
                        >
                          {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <LockOpen className="h-3 w-3" />}
                          Reopen
                        </Button>
                      )
                      : canClose && canClosePeriod(period, closure, now).ok && (
                        <Button
                          size="sm" className="h-7 shrink-0 gap-1 bg-slate-700 px-2 text-xs hover:bg-slate-800"
                          disabled={isBusy}
                          onClick={() => { setCloseTarget(period); setCloseNote(''); }}
                        >
                          {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Lock className="h-3 w-3" />}
                          Close
                        </Button>
                      )}
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
                  {record?.closed && (
                    <p className="mt-2 text-[10px] text-muted-foreground">
                      Closed{record.closedByName ? ` by ${record.closedByName}` : ''}
                      {record.note ? ` — ${record.note}` : ''}
                    </p>
                  )}
                  {!record?.closed && record?.reopenReason && (
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
            <DialogTitle>Close {closeTarget ? periodLabel(closeTarget) : ''}</DialogTitle>
            <DialogDescription>
              No expense or receipt dated in this month will be accepted afterwards, from anyone
              without the Close permission. Reopening is possible but requires a reason.
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
            <DialogTitle>Reopen {reopenTarget ? periodLabel(reopenTarget) : ''}</DialogTitle>
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
