'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, deleteField, doc, getDocs, onSnapshot, query, serverTimestamp, setDoc, Timestamp, where } from 'firebase/firestore';
import {
  AlertTriangle, CalendarRange, ChevronLeft, ChevronRight, Clock, History, Landmark, Loader2, Lock, LockOpen,
  ShieldCheck, Timer, Undo2,
} from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import { PageHeader } from '@/components/shared/page-header';
import { AutoCloseRuleCard } from '@/components/site-account-statement/auto-close-rule-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { BANK_PAGE, BankAccessDenied, BankPageSkeleton, accountLabel, useBankData } from '@/components/bank-balance/page-kit';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { db } from '@/lib/firebase';
import { formatInr, txnDate, dayKey } from '@/lib/bank-balance-ledger';
import { canBounce, type BankPaymentVoucher } from '@/lib/bank-payments';
import {
  ALL_ACCOUNTS,
  ALL_ACCOUNTS_LABEL,
  BB_CONTROL_DOCS,
  BB_SETTINGS_COLLECTION,
  EMPTY_MONTH_CONTENTS,
  tallyMonths,
  type MonthContents,
} from '@/lib/bank-balance-entry-controls';
import {
  addDays,
  canClosePeriod,
  canFollowAllProjects,
  canReopenPeriod,
  closureFor,
  effectiveClosure,
  localToday,
  monthState,
  periodsToBulkClose,
  projectsWithOverride,
  relockDateFor,
  RELOCK_PRESETS,
  resolveMonthClosure,
  summariseClosure,
  upcomingAutoCloses,
  validateReopenReason,
  type MonthState,
  type SASAutoCloseRule,
  type SASMonthClosureSettings,
} from '@/lib/site-account-statement-month-closure';
import { currentPeriod, fyLabelOf, fyPeriods, fyStartOf, periodLabel } from '@/lib/site-account-statement-period-range';
import type { BankExpense } from '@/lib/types';
import { cn } from '@/lib/utils';
import { BB_CONTROL_ACTIONS, BankMonthClosureHistory } from './histories';

const STATE_STYLE: Record<MonthState, { ring: string; chip: string; label: string }> = {
  closed: { ring: 'border-slate-300 bg-slate-50', chip: 'bg-slate-700 text-white', label: 'Closed' },
  current: { ring: 'border-amber-300 bg-amber-50/60', chip: 'bg-amber-500 text-white', label: 'In progress' },
  open: { ring: 'border-emerald-200 bg-emerald-50/40', chip: 'bg-emerald-600 text-white', label: 'Open' },
  future: { ring: 'border-slate-200 bg-white', chip: 'bg-slate-200 text-slate-600', label: 'Not started' },
};

const TERMS = {
  all: ALL_ACCOUNTS_LABEL,
  allLower: 'all accounts',
  plural: 'accounts',
  allRule: 'all-accounts rule',
  scopeNoun: 'account',
  records: 'payment, receipt or transfer',
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A month's contents in two short lines. */
function ContentsLines({ held }: { held: MonthContents }) {
  return (
    <>
      <p className="text-rose-700">{plural(held.paymentCount, 'payment')} · {formatInr(held.paymentTotal, 0)}</p>
      <p className="text-blue-700">{plural(held.receiptCount, 'receipt')} · {formatInr(held.receiptTotal, 0)}</p>
      {held.transferCount > 0 && <p className="text-violet-700">{plural(held.transferCount, 'transfer')} · {formatInr(held.transferTotal, 0)}</p>}
    </>
  );
}

/**
 * Bank Balance › Settings › Month Closure: freeze an accounting period once it has been reported
 * on, for all accounts or one account. Site Account's page and engine, with bank accounts where it
 * has projects.
 */
export default function BankMonthClosureSettings() {
  const { user } = useAuth();
  const { can, isLoading: authLoading } = useAuthorization();
  const { log } = useActivityLogger(ACTIVITY_MODULES.BANK_BALANCE);
  const { toast } = useToast();

  // The module's settings right stands in for Month Closure until roles grant it.
  const settingsRight = can('Edit', 'Bank Balance.Payment Entry Settings');
  const canClose = can('Close', 'Bank Balance.Month Closure') || settingsRight;
  const canReopen = can('Reopen', 'Bank Balance.Month Closure') || settingsRight;
  const canView = canClose || canReopen || can('View', 'Bank Balance.Month Closure') || can('View Module', 'Bank Balance');
  const canSeeCheques = can('View', 'Bank Balance.Expenses');

  const now = currentPeriod();
  const [fyStart, setFyStart] = useState(() => fyStartOf(now));
  const [scope, setScope] = useState<string>(ALL_ACCOUNTS);
  const { accounts } = useBankData({ enabled: canView && !authLoading });
  const [closureRaw, setClosureRaw] = useState<Partial<SASMonthClosureSettings> | null>(null);
  const [today, setToday] = useState(localToday);
  useEffect(() => {
    const id = setInterval(() => {
      const next = localToday();
      setToday((prev) => (prev === next ? prev : next));
    }, 60_000);
    return () => clearInterval(id);
  }, []);
  // Months close themselves on their trigger day, so the document is resolved for today each render.
  const closure = useMemo(() => resolveMonthClosure(closureRaw, today), [closureRaw, today]);
  const [loading, setLoading] = useState(true);
  const [contents, setContents] = useState<Record<string, MonthContents>>({});
  const [contentsLoading, setContentsLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [historyKey, setHistoryKey] = useState(0);

  const [closeTarget, setCloseTarget] = useState<string | null>(null);
  const [closeNote, setCloseNote] = useState('');
  const [reopenTarget, setReopenTarget] = useState<string | null>(null);
  const [reopenReason, setReopenReason] = useState('');
  /** Days until a reopened month locks again; null keeps it open until closed by hand. */
  const [reopenDays, setReopenDays] = useState<number | null>(3);
  const [bulkThrough, setBulkThrough] = useState<string | null>(null);

  const scopeAccount = scope === ALL_ACCOUNTS ? undefined : scope;
  const nameOf = (id: string) => {
    const account = accounts.find((a) => a.id === id);
    return account ? accountLabel(account) : 'this account';
  };
  const scopeName = scopeAccount ? nameOf(scopeAccount) : ALL_ACCOUNTS_LABEL;

  const periods = useMemo(() => fyPeriods(fyStart), [fyStart]);
  const summary = useMemo(() => summariseClosure(periods, closure, now, scopeAccount), [periods, closure, now, scopeAccount]);

  useEffect(
    () =>
      onSnapshot(
        doc(db, BB_SETTINGS_COLLECTION, BB_CONTROL_DOCS.monthClosure),
        (snapshot) => {
          setClosureRaw((snapshot.data() as Partial<SASMonthClosureSettings> | undefined) ?? null);
          setLoading(false);
        },
        () => setLoading(false),
      ),
    [],
  );

  /*
   * What each month of the year holds, so nobody closes one blind. One query for the year's
   * entries, and the vouchers for cheques not yet cleared. A refusal or missing index leaves the
   * counts empty — they are context, not the function of the page.
   */
  useEffect(() => {
    if (!canView || authLoading) return;
    let cancelled = false;
    const from = new Date(fyStart, 3, 1);
    const to = new Date(fyStart + 1, 2, 31, 23, 59, 59);
    void (async () => {
      setContentsLoading(true);
      try {
        const [entrySnap, voucherSnap] = await Promise.all([
          getDocs(query(collection(db, 'bankExpenses'), where('date', '>=', Timestamp.fromDate(from)), where('date', '<=', Timestamp.fromDate(to)))),
          canSeeCheques ? getDocs(collection(db, 'bankPayments')).catch(() => null) : Promise.resolve(null),
        ]);
        const entries = entrySnap.docs.flatMap((d) => {
          const row = { id: d.id, ...d.data() } as BankExpense;
          try {
            return [{ day: dayKey(txnDate(row)), accountId: row.accountId, type: row.type, isContra: row.isContra, amount: Number(row.amount) || 0 }];
          } catch {
            return [];
          }
        });
        const cheques = (voucherSnap?.docs ?? []).map((d) => {
          const v = d.data() as BankPaymentVoucher;
          return { instrumentDate: v.instrumentDate || '', accountId: v.accountId, uncleared: v.status === 'Issued' && canBounce(v.mode) };
        });
        if (!cancelled) setContents(tallyMonths({ entries, cheques, accountId: scopeAccount }));
      } catch {
        if (!cancelled) setContents({});
      } finally {
        if (!cancelled) setContentsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fyStart, scopeAccount, canView, authLoading, canSeeCheques]);

  async function record(action: string, detail: Record<string, unknown>) {
    await log(action, detail).catch(() => {});
    setHistoryKey((k) => k + 1);
  }

  const stamp = () => ({ updatedAt: serverTimestamp(), updatedBy: user?.id ?? '', updatedByName: user?.name ?? '' });

  /**
   * Writes period entries into the calendar in scope: the all-accounts one at `months`, an
   * account's exceptions at `projects.<accountId>` — the engine's shape, shared with Site Account.
   * Merged, so two administrators acting on different months in the same minute do not collide.
   */
  async function writeClosure(entries: Record<string, unknown>, activity: string, detail: Record<string, unknown>) {
    await setDoc(
      doc(db, BB_SETTINGS_COLLECTION, BB_CONTROL_DOCS.monthClosure),
      { ...(scopeAccount ? { projects: { [scopeAccount]: entries } } : { months: entries }), ...stamp() },
      { merge: true },
    );
    await record(activity, { scope: scopeName, ...detail });
  }

  async function handleClose(period: string) {
    const check = canClosePeriod(period, closure, now, scopeAccount);
    if (!check.ok) {
      toast({ title: 'Cannot close', description: check.reason, variant: 'destructive' });
      return;
    }
    setBusy(period);
    try {
      await writeClosure(
        {
          [period]: {
            period, closed: true, closedAt: serverTimestamp(), closedBy: user?.id ?? '', closedByName: user?.name ?? '',
            note: closeNote.trim(),
            // Cleared, so a month closed again after a reopen does not show the old reason or lock date.
            reopenReason: '', relockOn: '',
          },
        },
        BB_CONTROL_ACTIONS.closeMonth,
        { period, note: closeNote.trim() },
      );
      toast({ title: `${periodLabel(period)} closed`, description: 'Payments, receipts and transfers dated in this month can no longer be recorded or changed.' });
      setCloseTarget(null);
      setCloseNote('');
    } catch (error) {
      toast({ title: 'Error', description: error instanceof Error ? error.message : 'Could not close the month.', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  }

  async function handleReopen(period: string) {
    const allowed = canReopenPeriod(period, closure, scopeAccount);
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
            ...(closureFor(closure, period, scopeAccount) ?? { period }),
            period, closed: false, reopenedAt: serverTimestamp(), reopenedBy: user?.id ?? '', reopenedByName: user?.name ?? '',
            reopenReason: reopenReason.trim(),
            // Written either way, so a reopen with no limit clears an earlier one.
            relockOn: relockOn ?? '',
          },
        },
        BB_CONTROL_ACTIONS.reopenMonth,
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
    } catch (error) {
      toast({ title: 'Error', description: error instanceof Error ? error.message : 'Could not reopen the month.', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  }

  /** Drops an account's exception for a month, putting it back on the all-accounts calendar. */
  async function handleFollowAll(period: string) {
    if (!scopeAccount) return;
    setBusy(period);
    try {
      await setDoc(
        doc(db, BB_SETTINGS_COLLECTION, BB_CONTROL_DOCS.monthClosure),
        { projects: { [scopeAccount]: { [period]: deleteField() } }, ...stamp() },
        { merge: true },
      );
      await record(BB_CONTROL_ACTIONS.clearException, { scope: scopeName, period });
      toast({ title: `${periodLabel(period)} follows all accounts`, description: `${scopeName} no longer has its own setting for this month.` });
    } catch (error) {
      toast({ title: 'Error', description: error instanceof Error ? error.message : 'Could not update the month.', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  }

  /** Saves the automatic rule for the scope in view; null removes an account's own rule. */
  async function handleSaveRule(next: SASAutoCloseRule | null, changeReason: string) {
    const value = next
      ? { enabled: next.enabled, dayOfNextMonth: next.dayOfNextMonth, startPeriod: next.startPeriod, changeReason, ...stamp() }
      : deleteField();
    try {
      await setDoc(
        doc(db, BB_SETTINGS_COLLECTION, BB_CONTROL_DOCS.monthClosure),
        { ...(scopeAccount ? { projectAutoClose: { [scopeAccount]: value } } : { autoClose: value }), ...stamp() },
        { merge: true },
      );
      await record(BB_CONTROL_ACTIONS.autoRule, {
        scope: scopeName,
        rule: next ? `${next.enabled ? 'on' : 'off'} · day ${next.dayOfNextMonth} · from ${next.startPeriod}` : 'follows all accounts',
        ...(changeReason ? { reason: changeReason } : {}),
      });
      toast({ title: 'Automatic closing saved', description: `For ${scopeAccount ? scopeName : 'all accounts'}.` });
    } catch (error) {
      toast({ title: 'Error', description: error instanceof Error ? error.message : 'Could not save the rule.', variant: 'destructive' });
      throw error;
    }
  }

  async function handleBulkClose(through: string) {
    const targets = periodsToBulkClose(periods, through, closure, now, scopeAccount);
    if (targets.length === 0) {
      toast({ title: 'Nothing to close', description: 'Every month up to there is already closed.' });
      return;
    }
    setBusy('bulk');
    try {
      const at = serverTimestamp();
      await writeClosure(
        Object.fromEntries(
          targets.map((period) => [
            period,
            {
              period, closed: true, closedAt: at, closedBy: user?.id ?? '', closedByName: user?.name ?? '',
              note: `Closed with ${targets.length} months through ${periodLabel(through)}.`, reopenReason: '', relockOn: '',
            },
          ]),
        ),
        BB_CONTROL_ACTIONS.closeMonths,
        { through, count: targets.length, periods: targets.join(', ') },
      );
      toast({ title: `${plural(targets.length, 'month')} closed`, description: `Up to and including ${periodLabel(through)}.` });
      setBulkThrough(null);
    } catch (error) {
      toast({ title: 'Error', description: error instanceof Error ? error.message : 'Could not close the months.', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  }

  if (authLoading || loading) return <BankPageSkeleton kpis={0} blocks={1} />;
  if (!canView) return <BankAccessDenied title="Month Closure" backHref="/bank-balance/settings" backLabel="Back to settings" what="Month Closure" />;

  const fyOptions = Array.from({ length: 7 }, (_, i) => fyStartOf(now) + 1 - i);
  const bulkCandidates = periods.filter((p) => canClosePeriod(p, closure, now, scopeAccount).ok);
  const bulkTargets = bulkThrough ? periodsToBulkClose(periods, bulkThrough, closure, now, scopeAccount) : [];
  const closeContents = closeTarget ? contents[closeTarget] ?? EMPTY_MONTH_CONTENTS : EMPTY_MONTH_CONTENTS;
  const upcoming = upcomingAutoCloses(periods, closure, scopeAccount);
  const relockPreview = relockDateFor(today, reopenDays);
  const pickable = accounts.filter((a) => a.status === 'Active' || closure.projects[a.id] || closure.projectAutoClose[a.id]);
  const reopenRecord = reopenTarget ? closureFor(closure, reopenTarget, scopeAccount) : null;

  return (
    <div className={BANK_PAGE}>
      <PageHeader
        backHref="/bank-balance/settings"
        backLabel="Back to settings"
        title="Month Closure"
        description="Freeze an accounting period once it has been reported on."
      />

      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3">
        <Landmark className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium">Showing</span>
        <Select value={scope} onValueChange={setScope}>
          <SelectTrigger className="w-full sm:w-[280px]" aria-label="Closure scope">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_ACCOUNTS}>{ALL_ACCOUNTS_LABEL}</SelectItem>
            {pickable.map((a) => (
              <SelectItem key={a.id} value={a.id}>{accountLabel(a)} — {a.bankName}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          {scopeAccount
            ? 'Changes here apply to this account only and override the all-accounts settings.'
            : 'Changes here apply to every account that has no setting of its own.'}
        </span>
      </div>

      <Tabs defaultValue="months" className="space-y-4">
        <TabsList>
          <TabsTrigger value="months" className="gap-1.5"><CalendarRange className="h-4 w-4" /> Months</TabsTrigger>
          <TabsTrigger value="auto" className="gap-1.5"><Timer className="h-4 w-4" /> Automatic closing</TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5"><History className="h-4 w-4" /> History</TabsTrigger>
        </TabsList>

        <TabsContent value="auto" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
          <AutoCloseRuleCard
            key={scope}
            closure={closure}
            scopeProject={scopeAccount}
            scopeName={scopeName}
            currentPeriodKey={now}
            canClose={canClose}
            canReopen={canReopen}
            onSave={handleSaveRule}
            terms={TERMS}
          />
        </TabsContent>

        <TabsContent value="months" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="text-base">FY {fyLabelOf(fyStart)} · {scopeName}</CardTitle>
                  <CardDescription>
                    {summary.closed} of {summary.total} months closed
                    {summary.closable > 0 && <> · {summary.closable} can be closed now</>}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Previous financial year" onClick={() => setFyStart((y) => y - 1)}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Select value={String(fyStart)} onValueChange={(v) => setFyStart(Number(v))}>
                    <SelectTrigger className="w-[150px]" aria-label="Financial year"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {fyOptions.map((y) => <SelectItem key={y} value={String(y)}>FY {fyLabelOf(y)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Next financial year" onClick={() => setFyStart((y) => y + 1)}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  {canClose && bulkCandidates.length > 1 && (
                    <Button variant="outline" className="gap-2" onClick={() => setBulkThrough(bulkCandidates[bulkCandidates.length - 1])}>
                      <Lock className="h-4 w-4" />
                      Close through…
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>

            <CardContent>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {periods.map((period) => {
                  const state = monthState(period, closure, now, scopeAccount);
                  const style = STATE_STYLE[state];
                  const effect = effectiveClosure(closure, period, scopeAccount);
                  const entry = effect.record;
                  const held = contents[period] ?? EMPTY_MONTH_CONTENTS;
                  const isBusy = busy === period;
                  const hasActivity = held.paymentCount > 0 || held.receiptCount > 0 || held.transferCount > 0;
                  const differing = scopeAccount ? [] : projectsWithOverride(closure, period);
                  const hasOwnEntry = Boolean(scopeAccount && effect.source === 'project');
                  const ownRule = Boolean(scopeAccount && effect.autoScope === 'project');
                  const autoCloseOn = upcoming[period];

                  return (
                    <div key={period} className={cn('rounded-xl border p-3', style.ring)}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-800">{periodLabel(period)}</p>
                          <span className={cn('mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium', style.chip)}>
                            {state === 'closed' ? <Lock className="h-2.5 w-2.5" /> : state === 'current' ? <Clock className="h-2.5 w-2.5" /> : state === 'open' ? <LockOpen className="h-2.5 w-2.5" /> : null}
                            {style.label}
                          </span>
                          {scopeAccount && (
                            <span className={cn('ml-1 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium', hasOwnEntry || ownRule ? 'bg-violet-100 text-violet-800' : 'bg-slate-100 text-slate-600')}>
                              {hasOwnEntry ? 'This account only' : ownRule ? "This account's rule" : 'Follows all accounts'}
                            </span>
                          )}
                          {effect.source === 'auto' && (
                            <span className="ml-1 inline-flex items-center gap-0.5 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-800">
                              <Timer className="h-2.5 w-2.5" /> Automatic
                            </span>
                          )}
                          {differing.length > 0 && (
                            <span
                              title={differing.map((d) => `${nameOf(d.projectId)}: ${d.closed ? 'closed' : 'open'}`).join('\n')}
                              className="ml-1 inline-flex items-center gap-0.5 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-800"
                            >
                              <Landmark className="h-2.5 w-2.5" />
                              {differing.length} differ{differing.length === 1 ? 's' : ''}
                            </span>
                          )}
                        </div>

                        <div className="flex shrink-0 flex-col items-end gap-1">
                          {state === 'closed'
                            ? canReopen && (
                                <Button
                                  variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" disabled={isBusy}
                                  onClick={() => { setReopenTarget(period); setReopenReason(''); setReopenDays(3); }}
                                >
                                  {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <LockOpen className="h-3 w-3" />}
                                  Reopen{scopeAccount ? ' here' : ''}
                                </Button>
                              )
                            : canClose && canClosePeriod(period, closure, now, scopeAccount).ok && (
                                <Button
                                  size="sm" className="h-7 gap-1 bg-slate-700 px-2 text-xs hover:bg-slate-800" disabled={isBusy}
                                  onClick={() => { setCloseTarget(period); setCloseNote(''); }}
                                >
                                  {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Lock className="h-3 w-3" />}
                                  Close{scopeAccount ? ' here' : ''}
                                </Button>
                              )}
                          {hasOwnEntry && (canClose || canReopen) && canFollowAllProjects(period, closure, scopeAccount!).ok && (
                            <Button
                              variant="ghost" size="sm" className="h-6 gap-1 px-2 text-[11px] text-muted-foreground" disabled={isBusy}
                              title="Remove this account's own setting and follow the all-accounts calendar"
                              onClick={() => void handleFollowAll(period)}
                            >
                              <Undo2 className="h-3 w-3" />
                              Follow all
                            </Button>
                          )}
                        </div>
                      </div>

                      <div className="mt-2.5 space-y-0.5 border-t pt-2 text-[11px]">
                        {contentsLoading ? (
                          <p className="text-muted-foreground">Counting…</p>
                        ) : hasActivity ? (
                          <ContentsLines held={held} />
                        ) : (
                          <p className="text-muted-foreground">No entries recorded</p>
                        )}
                        {held.unclearedCheques > 0 && state !== 'closed' && (
                          <p className="flex items-center gap-1 text-amber-700">
                            <AlertTriangle className="h-3 w-3 shrink-0" />
                            {plural(held.unclearedCheques, 'cheque')} not yet cleared
                          </p>
                        )}
                      </div>

                      {effect.source === 'auto' && (
                        <p className="mt-2 text-[10px] text-indigo-700">
                          Closed automatically on {effect.closesOn}{effect.autoScope === 'project' ? " by this account's rule" : ''}
                        </p>
                      )}
                      {!effect.closed && autoCloseOn && (
                        <p className="mt-2 flex items-center gap-1 text-[10px] text-indigo-700">
                          <Timer className="h-2.5 w-2.5 shrink-0" />
                          Closes automatically on {autoCloseOn}
                        </p>
                      )}
                      {entry?.closed && (
                        <p className="mt-2 text-[10px] text-muted-foreground">
                          Closed{entry.closedByName ? ` by ${entry.closedByName}` : ''}{entry.note ? ` — ${entry.note}` : ''}
                        </p>
                      )}
                      {effect.relocked && entry?.relockOn && (
                        <p className="mt-2 text-[10px] text-muted-foreground">
                          Was reopened{entry.reopenedByName ? ` by ${entry.reopenedByName}` : ''}; locked again on {entry.relockOn}
                        </p>
                      )}
                      {!effect.closed && entry?.relockOn && (
                        <p className="mt-2 flex items-center gap-1 text-[10px] text-amber-700">
                          <Timer className="h-2.5 w-2.5 shrink-0" />
                          Locks again on {entry.relockOn}
                        </p>
                      )}
                      {!entry?.closed && !effect.relocked && entry?.reopenReason && (
                        <p className="mt-2 text-[10px] text-amber-700">
                          Reopened{entry.reopenedByName ? ` by ${entry.reopenedByName}` : ''} — {entry.reopenReason}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-0">
          <BankMonthClosureHistory scopeName={scopeName} scopeAccount={scopeAccount} refreshKey={historyKey} />
        </TabsContent>
      </Tabs>

      {/* ── Close one month ── */}
      <Dialog open={Boolean(closeTarget)} onOpenChange={(open) => { if (!open) setCloseTarget(null); }}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Close {closeTarget ? periodLabel(closeTarget) : ''} · {scopeAccount ? scopeName : 'all accounts'}</DialogTitle>
            <DialogDescription>
              Afterwards, no payment, receipt or transfer dated in this month can be added, edited, deleted or cancelled by anyone —
              including you. Reopening is possible but requires a written reason and stays on the record.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1 rounded-lg border bg-muted/30 px-3 py-2.5 text-xs">
            <p className="font-medium text-foreground">This month currently holds</p>
            <ContentsLines held={closeContents} />
          </div>

          {closeContents.unclearedCheques > 0 && (
            <p className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
              {plural(closeContents.unclearedCheques, 'cheque')} dated in this month {closeContents.unclearedCheques === 1 ? 'has' : 'have'} not cleared yet.
              Clearing still works after closing, but if one bounces or is cancelled the month has to be reopened to reverse it.
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="close-note">Note (optional)</Label>
            <Textarea id="close-note" rows={2} placeholder="e.g. Bank position reported to the Director on the 5th." value={closeNote} onChange={(e) => setCloseNote(e.target.value)} />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseTarget(null)} disabled={busy !== null}>Cancel</Button>
            <Button className="gap-2 bg-slate-700 hover:bg-slate-800" disabled={busy !== null} onClick={() => closeTarget && void handleClose(closeTarget)}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
              Close month
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reopen ── */}
      <Dialog open={Boolean(reopenTarget)} onOpenChange={(open) => { if (!open) setReopenTarget(null); }}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Reopen {reopenTarget ? periodLabel(reopenTarget) : ''} · {scopeAccount ? scopeName : 'all accounts'}</DialogTitle>
            <DialogDescription>
              This month has already been reported on. The reason below is kept with the month and in the activity log, and stays
              visible on this screen.
            </DialogDescription>
          </DialogHeader>

          {reopenRecord?.closedByName && (
            <p className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Closed by {reopenRecord.closedByName}{reopenRecord.note ? ` — ${reopenRecord.note}` : ''}
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="reopen-reason">Reason <span className="text-destructive">*</span></Label>
            <Textarea
              id="reopen-reason" rows={3}
              placeholder="e.g. Bank charges for September debited late; the Director approved a restated September."
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Written for whoever reads this in a year — say what arrived and who authorised it.</p>
          </div>

          <div className="space-y-1.5">
            <Label>Lock again automatically</Label>
            <div className="flex flex-wrap gap-2">
              {RELOCK_PRESETS.map((preset) => (
                <Button key={preset.label} type="button" size="sm" variant={reopenDays === preset.days ? 'default' : 'outline'} onClick={() => setReopenDays(preset.days)}>
                  {preset.label}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {relockPreview ? `Open through ${addDays(relockPreview, -1)}; locks again on ${relockPreview}.` : 'Stays open until someone closes it by hand.'}
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setReopenTarget(null)} disabled={busy !== null}>Cancel</Button>
            <Button className="gap-2" disabled={busy !== null || !validateReopenReason(reopenReason).ok} onClick={() => reopenTarget && void handleReopen(reopenTarget)}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockOpen className="h-4 w-4" />}
              Reopen month
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Bulk close ── */}
      <Dialog open={Boolean(bulkThrough)} onOpenChange={(open) => { if (!open) setBulkThrough(null); }}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Close several months</DialogTitle>
            <DialogDescription>Year-end is rarely one padlock at a time. Pick the last month to close; everything up to it that is eligible closes together.</DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label>Close everything through</Label>
            <Select value={bulkThrough ?? ''} onValueChange={setBulkThrough}>
              <SelectTrigger aria-label="Close everything through"><SelectValue /></SelectTrigger>
              <SelectContent>
                {bulkCandidates.map((p) => <SelectItem key={p} value={p}>{periodLabel(p)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
            <p className="text-xs font-medium text-foreground">{plural(bulkTargets.length, 'month')} will close</p>
            {bulkTargets.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">Everything up to there is already closed.</p>
            ) : (
              // A div, not a p: Badge renders a div, which is invalid inside a paragraph.
              <div className="mt-1 flex flex-wrap gap-1">
                {bulkTargets.map((p) => <Badge key={p} variant="outline" className="text-[11px]">{periodLabel(p)}</Badge>)}
              </div>
            )}
            {bulkTargets.some((p) => (contents[p]?.unclearedCheques ?? 0) > 0) && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700">
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                Some of these months have cheques that have not cleared yet.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkThrough(null)} disabled={busy !== null}>Cancel</Button>
            <Button className="gap-2 bg-slate-700 hover:bg-slate-800" disabled={busy !== null || bulkTargets.length === 0} onClick={() => bulkThrough && void handleBulkClose(bulkThrough)}>
              {busy === 'bulk' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
              Close {plural(bulkTargets.length, 'month')}
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
