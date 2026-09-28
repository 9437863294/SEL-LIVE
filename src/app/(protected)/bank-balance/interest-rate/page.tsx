'use client';
export const dynamic = 'force-dynamic';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CalendarDays,
  FileBarChart,
  Landmark,
  Loader2,
  Percent,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { format, parseISO, startOfDay, subDays } from 'date-fns';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { PageHeader, SectionHeader } from '@/components/shared/page-header';
import { KpiCard } from '@/components/shared/kpi-card';
import { DataList, type ListColumn } from '@/components/shared/data-list';
import {
  BANK_PAGE,
  BankAccessDenied,
  BankBalanceBackground,
  BankPageSkeleton,
  accountLabel,
  useBankData,
} from '@/components/bank-balance/page-kit';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { db } from '@/lib/firebase';
import { cn } from '@/lib/utils';
import {
  balanceAt,
  buildLedgers,
  dailyInterest,
  dayKey,
  entryAppliesOn,
  formatDay,
  formatInr,
  isCashCredit,
  normaliseDatedLog,
} from '@/lib/bank-balance-ledger';
import type { BankAccount, InterestRateLogEntry } from '@/lib/types';

type EntryForm = { fromDate: string; rate: string };

const EMPTY_FORM: EntryForm = { fromDate: '', rate: '' };

const makeId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const formatRate = (rate: number) => `${(Number(rate) || 0).toFixed(2)}%`;

/** The account's rate log newest first, never undefined. */
const rateLogOf = (account: BankAccount): InterestRateLogEntry[] =>
  Array.isArray(account.interestRateLog)
    ? [...account.interestRateLog].sort((a, b) => b.fromDate.localeCompare(a.fromDate))
    : [];

export default function InterestRatePage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();

  const canView = can('View', 'Bank Balance.Interest Rate');
  const canAdd = can('Add', 'Bank Balance.Interest Rate');
  const canDelete = can('Delete', 'Bank Balance.Interest Rate');
  const canViewReports = can('View', 'Bank Balance.Reports');

  const { accounts, setAccounts, transactions, isLoading, loadedAt } = useBankData({
    enabled: !authLoading && canView,
    transactions: true,
  });

  const [savingId, setSavingId] = useState<string | null>(null);
  const [formAccount, setFormAccount] = useState<BankAccount | null>(null);
  const [form, setForm] = useState<EntryForm>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<{ account: BankAccount; entry: InterestRateLogEntry } | null>(null);

  const today = useMemo(() => startOfDay(loadedAt ?? new Date()), [loadedAt]);

  const ccAccounts = useMemo(
    () => accounts.filter(isCashCredit).map((acc) => ({ ...acc, interestRateLog: rateLogOf(acc) })),
    [accounts],
  );

  const ledgers = useMemo(() => buildLedgers(ccAccounts, transactions), [ccAccounts, transactions]);

  // Per account: the entry in force today, the next scheduled one, and today's projected interest.
  const status = useMemo(() => {
    const out = new Map<
      string,
      { current?: InterestRateLogEntry; upcoming?: InterestRateLogEntry; utilised: number; todayInterest: number }
    >();
    for (const acc of ccAccounts) {
      const current = acc.interestRateLog.find((entry) => entryAppliesOn(entry, today));
      const upcoming = [...acc.interestRateLog].reverse().find((entry) => entry.fromDate > dayKey(today));
      const ledger = ledgers.get(acc.id);
      const utilised = ledger ? balanceAt(ledger, today) : 0;
      out.set(acc.id, { current, upcoming, utilised, todayInterest: dailyInterest(utilised, Number(current?.rate) || 0) });
    }
    return out;
  }, [ccAccounts, ledgers, today]);

  const summary = useMemo(() => {
    const rates = ccAccounts
      .map((acc) => status.get(acc.id)?.current)
      .filter((entry): entry is InterestRateLogEntry => !!entry)
      .map((entry) => Number(entry.rate) || 0);
    return {
      averageRate: rates.length ? rates.reduce((sum, rate) => sum + rate, 0) / rates.length : null,
      withRate: rates.length,
      withoutRate: ccAccounts.length - rates.length,
      todayInterest: ccAccounts.reduce((sum, acc) => sum + (status.get(acc.id)?.todayInterest || 0), 0),
    };
  }, [ccAccounts, status]);

  const replaceLog = async (account: BankAccount, nextLog: InterestRateLogEntry[], successMessage: string) => {
    setSavingId(account.id);
    try {
      await updateDoc(doc(db, 'bankAccounts', account.id), { interestRateLog: nextLog });
      setAccounts((prev) => prev.map((acc) => (acc.id === account.id ? { ...acc, interestRateLog: nextLog } : acc)));
      toast({ title: 'Saved', description: successMessage });
      return true;
    } catch (error) {
      console.error('Error saving interest rate log:', error);
      toast({ title: 'Error', description: 'Could not save the rate entry. Please try again.', variant: 'destructive' });
      return false;
    } finally {
      setSavingId(null);
    }
  };

  // Starts from the rate in force today, so a small revision only needs the new figure typed over.
  const openForm = (account: BankAccount) => {
    const current = status.get(account.id)?.current;
    setForm({ fromDate: format(new Date(), 'yyyy-MM-dd'), rate: current ? String(current.rate) : '' });
    setFormAccount(account);
  };

  const handleSaveEntry = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!formAccount) return;

    const rate = Number(form.rate);
    if (!form.fromDate || form.rate.trim() === '' || !Number.isFinite(rate) || rate < 0 || rate > 100) {
      toast({ title: 'Check the entry', description: 'Enter the effective date and a rate between 0 and 100%.', variant: 'destructive' });
      return;
    }
    // Two rates cannot start on the same day, so a second entry for a date replaces the first.
    const log = rateLogOf(formAccount);
    const sameDay = log.find((entry) => entry.fromDate === form.fromDate);
    const nextLog = normaliseDatedLog([
      ...log.filter((entry) => entry.id !== sameDay?.id),
      { id: sameDay?.id ?? makeId(), fromDate: form.fromDate, toDate: null, rate },
    ]);

    const saved = await replaceLog(
      formAccount,
      nextLog,
      `Rate from ${formatDay(form.fromDate)} ${sameDay ? 'updated' : 'saved'} for ${accountLabel(formAccount)}.`,
    );
    if (saved) setFormAccount(null);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const { account, entry } = deleteTarget;
    const nextLog = normaliseDatedLog(rateLogOf(account).filter((item) => item.id !== entry.id));
    await replaceLog(account, nextLog, 'Rate entry deleted.');
    setDeleteTarget(null);
  };

  const historyColumns = (account: BankAccount): Array<ListColumn<InterestRateLogEntry>> => [
    {
      header: 'Effective From',
      mobile: 'title',
      cell: (entry) => <span className="whitespace-nowrap font-medium">{formatDay(entry.fromDate)}</span>,
    },
    {
      header: 'Effective To',
      mobile: 'aside',
      cell: (entry) =>
        entry.toDate === null ? (
          entry.fromDate > dayKey(today) ? (
            <Badge variant="neutral">Scheduled</Badge>
          ) : (
            <Badge variant="success">Current</Badge>
          )
        ) : (
          <span className="whitespace-nowrap text-muted-foreground">{formatDay(entry.toDate)}</span>
        ),
    },
    {
      header: 'Rate (p.a.)',
      align: 'right',
      cell: (entry) => <span className="font-semibold tabular-nums">{formatRate(entry.rate)}</span>,
    },
    {
      header: '',
      align: 'right',
      mobile: 'footer',
      cell: (entry) =>
        canDelete ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-destructive hover:text-destructive"
            onClick={() => setDeleteTarget({ account, entry })}
            disabled={savingId === account.id}
            aria-label={`Delete rate from ${formatDay(entry.fromDate)}`}
          >
            <Trash2 className="h-4 w-4 sm:mr-0" />
            <span className="ml-1.5 sm:hidden">Delete</span>
          </Button>
        ) : null,
    },
  ];

  if (authLoading || (isLoading && canView)) return <BankPageSkeleton kpis={3} blocks={2} />;

  if (!canView) {
    return <BankAccessDenied title="Interest Rates" backHref="/bank-balance/settings" backLabel="Back to settings" />;
  }

  // What the new entry is compared against: the rate that would otherwise be in force on the
  // chosen date (the log is newest first). On the same date, that is the entry being replaced.
  const formLog = formAccount ? rateLogOf(formAccount) : [];
  const formNewRate = Number(form.rate) || 0;
  const formPrevious = form.fromDate ? formLog.find((entry) => entry.fromDate <= form.fromDate) : undefined;
  const formReplaces = formPrevious?.fromDate === form.fromDate ? formPrevious : undefined;
  const formNext = form.fromDate ? [...formLog].reverse().find((entry) => entry.fromDate > form.fromDate) : undefined;
  const formChange = formNewRate - (Number(formPrevious?.rate) || 0);
  const dayBefore = (iso: string) => formatDay(subDays(parseISO(iso), 1));

  return (
    <>
      <BankBalanceBackground tone="indigo" />
      <div className={BANK_PAGE}>
        <PageHeader
          title="Interest Rates"
          description="Dated interest rates (% per annum) for Cash Credit accounts. The Interest Report uses these for every day's interest."
          icon={Percent}
          backHref="/bank-balance/settings"
          backLabel="Back to settings"
          actions={
            canViewReports ? (
              <Button asChild variant="outline">
                <Link href="/bank-balance/reports/interest-accrual">
                  <FileBarChart className="mr-2 h-4 w-4" />
                  Interest report
                </Link>
              </Button>
            ) : undefined
          }
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <KpiCard label="Cash Credit accounts" value={ccAccounts.length} icon={Landmark} tone="violet" accent />
          <KpiCard
            label="Average current rate"
            value={summary.averageRate === null ? '—' : formatRate(summary.averageRate)}
            hint={
              summary.withRate
                ? `Simple mean of ${summary.withRate} account${summary.withRate === 1 ? '' : 's'} · ${formatInr(summary.todayInterest)} projected today`
                : 'No rate in force today'
            }
            icon={Percent}
            tone="indigo"
            accent
          />
          <KpiCard
            label="Accounts without a rate"
            value={summary.withoutRate}
            hint={summary.withoutRate ? 'No rate in force today for these' : 'Every account has a rate'}
            icon={AlertTriangle}
            tone={summary.withoutRate ? 'amber' : 'emerald'}
            accent
          />
        </div>

        {ccAccounts.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center text-muted-foreground">No Cash Credit accounts found.</CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            {ccAccounts.map((acc) => {
              const info = status.get(acc.id);
              const current = info?.current;
              const upcoming = info?.upcoming;

              return (
                <Card key={acc.id} className="min-w-0 overflow-hidden">
                  <CardHeader className="pb-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex min-w-0 items-start gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 ring-4 ring-indigo-100">
                          <Landmark className="h-5 w-5" />
                        </span>
                        <div className="min-w-0">
                          <CardTitle className="break-words">{acc.bankName}</CardTitle>
                          <CardDescription className="mt-1 flex flex-wrap items-center gap-2">
                            {acc.shortName && <Badge variant="progress">{acc.shortName.trim()}</Badge>}
                            {acc.status === 'Inactive' && <Badge variant="neutral">Inactive</Badge>}
                            <span className="break-all">{acc.accountNumber}</span>
                          </CardDescription>
                        </div>
                      </div>
                      {canAdd && (
                        <Button className="shrink-0" onClick={() => openForm(acc)} disabled={savingId === acc.id}>
                          <Plus className="mr-2 h-4 w-4" />
                          Add New Rate
                        </Button>
                      )}
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-5">
                    {current ? (
                      <div className="rounded-lg border bg-muted/40 p-4">
                        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <CalendarDays className="h-3.5 w-3.5" />
                          Current rate, effective since
                          <span className="font-medium text-foreground">{formatDay(current.fromDate)}</span>
                        </div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                          <div>
                            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Rate (p.a.)</p>
                            <p className="mt-0.5 text-lg font-bold tabular-nums text-indigo-700">{formatRate(current.rate)}</p>
                          </div>
                          <div>
                            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Utilised today</p>
                            <p className="mt-0.5 text-base font-semibold tabular-nums">{formatInr(info?.utilised)}</p>
                          </div>
                          <div>
                            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                              Today&apos;s projected daily interest
                            </p>
                            <p className="mt-0.5 text-base font-semibold tabular-nums">{formatInr(info?.todayInterest)}</p>
                            {(info?.utilised ?? 0) <= 0 && (
                              <p className="text-xs text-muted-foreground">No utilisation, no interest</p>
                            )}
                          </div>
                        </div>
                        {upcoming && (
                          <p className="mt-3 border-t pt-2 text-xs text-muted-foreground">
                            Changes to <span className="font-medium text-foreground">{formatRate(upcoming.rate)}</span> from{' '}
                            {formatDay(upcoming.fromDate)}.
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <div>
                          <p className="font-medium">No rate in force today</p>
                          <p className="text-xs">
                            {upcoming
                              ? `A rate of ${formatRate(upcoming.rate)} starts on ${formatDay(upcoming.fromDate)}. Until then interest is taken as nil.`
                              : canAdd
                                ? 'Use “Add New Rate” to record the rate the bank charges on this account.'
                                : 'Ask someone with Interest Rate access to record the rate.'}
                          </p>
                        </div>
                      </div>
                    )}

                    <div>
                      <SectionHeader
                        title="Rate history"
                        as="h3"
                        className="mb-2"
                        badge={acc.interestRateLog.length ? <Badge variant="neutral">{acc.interestRateLog.length}</Badge> : undefined}
                      />
                      <DataList
                        rows={acc.interestRateLog}
                        columns={historyColumns(acc)}
                        dense
                        maxHeightClassName="max-h-72"
                        empty={
                          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                            No rate history.
                          </div>
                        }
                      />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={!!formAccount} onOpenChange={(open) => { if (!open && !savingId) setFormAccount(null); }}>
        <DialogContent className="hr-mobile-dialog gap-5 sm:max-w-lg">
          <DialogHeader className="hr-dialog-header pr-8">
            <DialogTitle>{formReplaces ? 'Update rate entry' : 'New rate entry'}</DialogTitle>
            <DialogDescription>
              {formAccount?.bankName}
              {formAccount?.shortName ? ` (${formAccount.shortName.trim()})` : ''} · {formAccount?.accountNumber}
            </DialogDescription>
          </DialogHeader>

          <form id="interest-rate-form" onSubmit={handleSaveEntry} className="hr-dialog-body space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="rate-from-date">Effective from</Label>
                <Input
                  id="rate-from-date"
                  type="date"
                  required
                  value={form.fromDate}
                  onChange={(e) => setForm((prev) => ({ ...prev, fromDate: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rate-value">Rate (% p.a.)</Label>
                <Input
                  id="rate-value"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  step="0.01"
                  required
                  placeholder="e.g. 9.25"
                  value={form.rate}
                  onChange={(e) => setForm((prev) => ({ ...prev, rate: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-2 rounded-lg border bg-muted/40 p-4 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 text-muted-foreground">
                  {formReplaces ? 'Entry being replaced' : 'Previous rate'}
                  {formPrevious && <span className="block text-xs">from {formatDay(formPrevious.fromDate)}</span>}
                </span>
                <span className="shrink-0 font-medium tabular-nums">{formPrevious ? formatRate(formPrevious.rate) : 'None'}</span>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-muted-foreground">New rate</span>
                <span className="shrink-0 text-lg font-bold tabular-nums text-indigo-700">{formatRate(formNewRate)}</span>
              </div>
              <div className="flex items-baseline justify-between gap-3 border-t pt-2">
                <span className="text-muted-foreground">Change</span>
                <span
                  className={cn(
                    'shrink-0 font-semibold tabular-nums',
                    formChange > 0 ? 'text-rose-700' : formChange < 0 ? 'text-emerald-700' : 'text-muted-foreground',
                  )}
                >
                  {formChange > 0 ? '+' : formChange < 0 ? '−' : ''}
                  {Math.abs(formChange).toFixed(2)} pp
                </span>
              </div>

              {form.fromDate && (formReplaces || formPrevious || formNext) && (
                <div className="space-y-1 border-t pt-2 text-xs text-muted-foreground">
                  {formReplaces && <p>A rate already starts on {formatDay(form.fromDate)}. Saving replaces it.</p>}
                  {formPrevious && !formReplaces && <p>The previous rate will end on {dayBefore(form.fromDate)}.</p>}
                  {formNext && (
                    <p className="text-amber-700">
                      This is a past date: the entry applies until {dayBefore(formNext.fromDate)}, when the rate from{' '}
                      {formatDay(formNext.fromDate)} takes over.
                    </p>
                  )}
                </div>
              )}
            </div>
          </form>

          <DialogFooter className="hr-dialog-footer gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setFormAccount(null)} disabled={!!savingId}>
              Cancel
            </Button>
            <Button type="submit" form="interest-rate-form" disabled={!!savingId}>
              {savingId ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save Entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open && !savingId) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this rate entry?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && (
                <>
                  {accountLabel(deleteTarget.account)}: {formatRate(deleteTarget.entry.rate)} from{' '}
                  {formatDay(deleteTarget.entry.fromDate)}. The dates of the remaining entries are adjusted so the history
                  has no gap.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!savingId}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!!savingId}
              onClick={(event) => {
                event.preventDefault();
                void handleConfirmDelete();
              }}
            >
              {savingId ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
