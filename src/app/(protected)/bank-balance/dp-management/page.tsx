'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  Landmark,
  Loader2,
  Plus,
  Save,
  Trash2,
  Wallet,
} from 'lucide-react';
import { collection, doc, getDocs, updateDoc } from 'firebase/firestore';
import { format, parseISO, subDays } from 'date-fns';

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
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { db } from '@/lib/firebase';
import { cn } from '@/lib/utils';
import { getApplicableCcLimitEntry, getEffectiveCcLimitFromEntry } from '@/lib/bank-balance-limit';
import { entryAppliesOn, formatDay, formatInr, normaliseDatedLog } from '@/lib/bank-balance-ledger';
import { BANK_PAGE, BankAccessDenied, BankBalanceBackground, BankPageSkeleton } from '@/components/bank-balance/page-kit';
import type { BankAccount, DpLogEntry } from '@/lib/types';

type EntryForm = { fromDate: string; amount: string; todAmount: string };

const EMPTY_FORM: EntryForm = { fromDate: '', amount: '', todAmount: '' };

const formatMoney = (value: number) => formatInr(value);

const makeId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export default function DpManagementPage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();

  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  const [formAccount, setFormAccount] = useState<BankAccount | null>(null);
  const [form, setForm] = useState<EntryForm>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<{ account: BankAccount; entry: DpLogEntry } | null>(null);

  const canView = !authLoading && can('View', 'Bank Balance.DP Management');
  const canAdd = !authLoading && can('Add', 'Bank Balance.DP Management');
  const canDelete = !authLoading && can('Delete', 'Bank Balance.DP Management');

  const fetchAccounts = async () => {
    setIsLoading(true);
    try {
      const snap = await getDocs(collection(db, 'bankAccounts'));
      const ccAccounts = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as BankAccount))
        .filter((acc) => acc.accountType === 'Cash Credit')
        .map((acc) => ({
          ...acc,
          drawingPower: Array.isArray(acc.drawingPower)
            ? [...acc.drawingPower].sort((a, b) => b.fromDate.localeCompare(a.fromDate))
            : [],
        }))
        .sort((a, b) => (a.shortName || a.bankName || '').localeCompare(b.shortName || b.bankName || ''));

      setAccounts(ccAccounts);
    } catch (error) {
      console.error('Error fetching accounts: ', error);
      toast({ title: 'Error', description: 'Failed to fetch bank accounts.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (authLoading) return;
    if (!canView) {
      setIsLoading(false);
      return;
    }
    void fetchAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, canView]);

  const summary = useMemo(() => {
    const current = accounts.map((acc) => getApplicableCcLimitEntry(acc, new Date()) ?? undefined);
    return {
      totalLimit: current.reduce((sum, entry) => sum + getEffectiveCcLimitFromEntry(entry), 0),
      totalTod: current.reduce((sum, entry) => sum + (entry?.todAmount || 0), 0),
      withoutLimit: current.filter((entry) => !entry).length,
    };
  }, [accounts]);

  const replaceLog = async (account: BankAccount, nextLog: DpLogEntry[], successMessage: string) => {
    setSavingId(account.id);
    try {
      await updateDoc(doc(db, 'bankAccounts', account.id), { drawingPower: nextLog });
      setAccounts((prev) => prev.map((acc) => (acc.id === account.id ? { ...acc, drawingPower: nextLog } : acc)));
      toast({ title: 'Saved', description: successMessage });
      return true;
    } catch (error) {
      console.error('Error saving DP log:', error);
      toast({ title: 'Error', description: 'Could not save the limit entry. Please try again.', variant: 'destructive' });
      return false;
    } finally {
      setSavingId(null);
    }
  };

  // Starts from the limit in force today, so a change to only DP or only TOD carries the other
  // figure forward instead of silently resetting it to zero.
  const openForm = (account: BankAccount) => {
    const current = getApplicableCcLimitEntry(account, new Date()) ?? account.drawingPower.find((entry) => entry.toDate === null);
    setForm({
      fromDate: format(new Date(), 'yyyy-MM-dd'),
      amount: current ? String((current.amount || 0) + (current.odAmount || 0)) : '',
      todAmount: current?.todAmount ? String(current.todAmount) : '',
    });
    setFormAccount(account);
  };

  const handleSaveEntry = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!formAccount) return;

    const amount = Number(form.amount);
    const todAmount = Number(form.todAmount || 0);

    if (!form.fromDate || !form.amount || !Number.isFinite(amount) || amount < 0) {
      toast({ title: 'Check the entry', description: 'Enter the effective date and a valid DP amount.', variant: 'destructive' });
      return;
    }
    if (!Number.isFinite(todAmount) || todAmount < 0) {
      toast({ title: 'Check the entry', description: 'TOD must be zero or a positive amount.', variant: 'destructive' });
      return;
    }
    // Two limits cannot start on the same day, so a second entry for a date replaces the first.
    const sameDay = formAccount.drawingPower.find((entry) => entry.fromDate === form.fromDate);
    const nextLog = normaliseDatedLog([
      ...formAccount.drawingPower.filter((entry) => entry.id !== sameDay?.id),
      { id: sameDay?.id ?? makeId(), fromDate: form.fromDate, toDate: null, amount, odAmount: 0, todAmount },
    ]);

    const saved = await replaceLog(
      formAccount,
      nextLog,
      `Limit from ${formatDay(form.fromDate)} ${sameDay ? 'updated' : 'saved'} for ${formAccount.shortName || formAccount.bankName}.`
    );
    if (saved) setFormAccount(null);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const { account, entry } = deleteTarget;
    const nextLog = normaliseDatedLog(account.drawingPower.filter((item) => item.id !== entry.id));
    await replaceLog(account, nextLog, 'Limit entry deleted.');
    setDeleteTarget(null);
  };

  const historyColumns = (account: BankAccount): Array<ListColumn<DpLogEntry>> => [
    {
      header: 'Effective From',
      mobile: 'title',
      cell: (entry) => <span className="whitespace-nowrap font-medium">{formatDay(entry.fromDate)}</span>,
    },
    {
      header: 'Effective To',
      mobile: 'aside',
      cell: (entry) =>
        entryAppliesOn(entry, new Date()) ? (
          <Badge variant="success">Current</Badge>
        ) : entry.fromDate > format(new Date(), 'yyyy-MM-dd') ? (
          <Badge variant="info">Upcoming</Badge>
        ) : (
          <span className="whitespace-nowrap text-muted-foreground">{formatDay(entry.toDate)}</span>
        ),
    },
    {
      header: 'DP',
      align: 'right',
      cell: (entry) => <span className="tabular-nums">{formatMoney((entry.amount || 0) + (entry.odAmount || 0))}</span>,
    },
    {
      header: 'TOD',
      align: 'right',
      cell: (entry) => <span className="tabular-nums">{formatMoney(entry.todAmount || 0)}</span>,
    },
    {
      header: 'Total Limit',
      align: 'right',
      cell: (entry) => <span className="font-semibold tabular-nums">{formatMoney(getEffectiveCcLimitFromEntry(entry))}</span>,
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
            aria-label={`Delete limit from ${formatDay(entry.fromDate)}`}
          >
            <Trash2 className="h-4 w-4 sm:mr-0" />
            <span className="ml-1.5 sm:hidden">Delete</span>
          </Button>
        ) : null,
    },
  ];

  if (authLoading || (isLoading && canView)) return <BankPageSkeleton kpis={3} />;

  if (!canView) return <BankAccessDenied title="DP Management" backHref="/bank-balance/settings" backLabel="Back to settings" />;

  // What the new entry is compared against: the limit that would otherwise be in force on the
  // chosen date (the log is newest first). On the same date, that is the entry being replaced.
  const formLog = formAccount?.drawingPower ?? [];
  const formNewTotal = (Number(form.amount) || 0) + (Number(form.todAmount) || 0);
  const formPrevious = form.fromDate ? formLog.find((entry) => entry.fromDate <= form.fromDate) : undefined;
  const formReplaces = formPrevious?.fromDate === form.fromDate ? formPrevious : undefined;
  const formNext = form.fromDate ? [...formLog].reverse().find((entry) => entry.fromDate > form.fromDate) : undefined;
  const formPreviousTotal = formPrevious ? getEffectiveCcLimitFromEntry(formPrevious) : 0;
  const formChange = formNewTotal - formPreviousTotal;
  const dayBefore = (iso: string) => formatDay(format(subDays(parseISO(iso), 1), 'yyyy-MM-dd'));

  return (
    <>
      <BankBalanceBackground tone="purple" />
    <div className={BANK_PAGE}>
      <PageHeader
        title="DP Management"
        description="Dated limits for Cash Credit accounts — drawing power (DP) plus temporary overdrawn (TOD)."
        backHref="/bank-balance/settings"
        backLabel="Back to settings"
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard label="Cash Credit accounts" value={accounts.length} icon={Landmark} tone="violet" accent />
        <KpiCard
          label="Total current limit"
          value={formatMoney(summary.totalLimit)}
          hint={summary.totalTod ? `Includes ${formatMoney(summary.totalTod)} TOD` : 'DP + TOD across all accounts'}
          icon={Wallet}
          tone="indigo"
          accent
        />
        <KpiCard
          label="Accounts without a limit"
          value={summary.withoutLimit}
          hint={summary.withoutLimit ? 'Add a limit entry for these' : 'Every account has a limit'}
          icon={AlertTriangle}
          tone={summary.withoutLimit ? 'amber' : 'emerald'}
          accent
        />
      </div>

      {accounts.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">No Cash Credit accounts found.</CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          {accounts.map((acc) => {
            const current = getApplicableCcLimitEntry(acc, new Date()) ?? undefined;
            const upcoming = acc.drawingPower.filter((entry) => entry.fromDate > format(new Date(), 'yyyy-MM-dd')).length;

            return (
              <Card key={acc.id} className="min-w-0 overflow-hidden">
                <CardHeader className="pb-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600 ring-4 ring-violet-100">
                        <Landmark className="h-5 w-5" />
                      </span>
                      <div className="min-w-0">
                        <CardTitle className="break-words">{acc.bankName}</CardTitle>
                        <CardDescription className="mt-1 flex flex-wrap items-center gap-2">
                          {acc.shortName && <Badge variant="progress">{acc.shortName.trim()}</Badge>}
                          <span className="break-all">{acc.accountNumber}</span>
                        </CardDescription>
                      </div>
                    </div>
                    {canAdd && (
                      <Button className="shrink-0" onClick={() => openForm(acc)} disabled={savingId === acc.id}>
                        <Plus className="mr-2 h-4 w-4" />
                        Add New Limit
                      </Button>
                    )}
                  </div>
                </CardHeader>

                <CardContent className="space-y-5">
                  {current ? (
                    <div className="rounded-lg border bg-muted/40 p-4">
                      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <CalendarDays className="h-3.5 w-3.5" />
                        Current limit, effective from
                        <span className="font-medium text-foreground">{formatDay(current.fromDate)}</span>
                        {upcoming > 0 && (
                          <Badge variant="info" className="ml-auto">
                            {upcoming} upcoming
                          </Badge>
                        )}
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div>
                          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">DP</p>
                          <p className="mt-0.5 text-base font-semibold tabular-nums">
                            {formatMoney((current.amount || 0) + (current.odAmount || 0))}
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">TOD</p>
                          <p className="mt-0.5 text-base font-semibold tabular-nums">{formatMoney(current.todAmount || 0)}</p>
                        </div>
                        <div>
                          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Total limit</p>
                          <p className="mt-0.5 text-lg font-bold tabular-nums text-violet-700">
                            {formatMoney(getEffectiveCcLimitFromEntry(current))}
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <div>
                        <p className="font-medium">No limit set yet</p>
                        <p className="text-xs">
                          {canAdd
                            ? 'Use “Add New Limit” to record the DP sanctioned for this account.'
                            : 'Ask someone with DP Management access to record the limit.'}
                        </p>
                      </div>
                    </div>
                  )}

                  <div>
                    <SectionHeader
                      title="Limit history"
                      as="h3"
                      className="mb-2"
                      badge={acc.drawingPower.length ? <Badge variant="neutral">{acc.drawingPower.length}</Badge> : undefined}
                    />
                    <DataList
                      rows={acc.drawingPower}
                      columns={historyColumns(acc)}
                      dense
                      maxHeightClassName="max-h-72"
                      empty={
                        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                          No limit history.
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
        {/* `gap-5`: DialogContent is a flex column with no gap of its own, so without it the
            header, the fields and the buttons sit flush against each other. */}
        <DialogContent className="hr-mobile-dialog gap-5 sm:max-w-lg">
          <DialogHeader className="hr-dialog-header pr-8">
            <DialogTitle>{formReplaces ? 'Update limit entry' : 'New limit entry'}</DialogTitle>
            <DialogDescription>
              {formAccount?.bankName}
              {formAccount?.shortName ? ` (${formAccount.shortName.trim()})` : ''} · {formAccount?.accountNumber}
            </DialogDescription>
          </DialogHeader>

          <form id="dp-entry-form" onSubmit={handleSaveEntry} className="hr-dialog-body space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="dp-from-date">Effective from</Label>
                <Input
                  id="dp-from-date"
                  type="date"
                  required
                  value={form.fromDate}
                  onChange={(e) => setForm((prev) => ({ ...prev, fromDate: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dp-amount">Drawing power (DP)</Label>
                <Input
                  id="dp-amount"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  required
                  placeholder="0"
                  value={form.amount}
                  onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dp-tod">Temporary overdrawn (TOD)</Label>
                <Input
                  id="dp-tod"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  placeholder="0 (optional)"
                  value={form.todAmount}
                  onChange={(e) => setForm((prev) => ({ ...prev, todAmount: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-2 rounded-lg border bg-muted/40 p-4 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 text-muted-foreground">
                  {formReplaces ? 'Entry being replaced' : 'Previous limit'}
                  {formPrevious && <span className="block text-xs">from {formatDay(formPrevious.fromDate)}</span>}
                </span>
                <span className="shrink-0 font-medium tabular-nums">{formPrevious ? formatMoney(formPreviousTotal) : 'None'}</span>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-muted-foreground">New limit (DP + TOD)</span>
                <span className="shrink-0 text-lg font-bold tabular-nums text-violet-700">{formatMoney(formNewTotal)}</span>
              </div>
              <div className="flex items-baseline justify-between gap-3 border-t pt-2">
                <span className="text-muted-foreground">Change</span>
                <span
                  className={cn(
                    'shrink-0 font-semibold tabular-nums',
                    formChange > 0 ? 'text-emerald-700' : formChange < 0 ? 'text-rose-700' : 'text-muted-foreground'
                  )}
                >
                  {formChange > 0 ? '+' : formChange < 0 ? '−' : ''}
                  {formatMoney(Math.abs(formChange))}
                </span>
              </div>

              {form.fromDate && (formReplaces || formPrevious || formNext) && (
                <div className="space-y-1 border-t pt-2 text-xs text-muted-foreground">
                  {formReplaces && (
                    <p>A limit already starts on {formatDay(form.fromDate)}. Saving replaces it.</p>
                  )}
                  {formPrevious && !formReplaces && (
                    <p>The previous limit will end on {dayBefore(form.fromDate)}.</p>
                  )}
                  {formNext && (
                    <p className="text-amber-700">
                      This is a past date: the entry applies until {dayBefore(formNext.fromDate)}, when the limit from{' '}
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
            <Button type="submit" form="dp-entry-form" disabled={!!savingId}>
              {savingId ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save Entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open && !savingId) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this limit entry?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && (
                <>
                  {deleteTarget.account.shortName || deleteTarget.account.bankName}: limit of{' '}
                  {formatMoney(getEffectiveCcLimitFromEntry(deleteTarget.entry))} from {formatDay(deleteTarget.entry.fromDate)}.
                  The dates of the remaining entries are adjusted so the history has no gap.
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
