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
  ShieldAlert,
  Trash2,
  Wallet,
} from 'lucide-react';
import { collection, doc, getDocs, updateDoc } from 'firebase/firestore';
import { format, parseISO, subDays } from 'date-fns';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
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
import { getEffectiveCcLimitFromEntry } from '@/lib/bank-balance-limit';
import type { BankAccount, DpLogEntry } from '@/lib/types';

type EntryForm = { fromDate: string; amount: string; todAmount: string };

const EMPTY_FORM: EntryForm = { fromDate: '', amount: '', todAmount: '' };

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
const formatMoney = (value: number) => inr.format(value || 0);
const formatDay = (iso: string | null | undefined) => (iso ? format(parseISO(iso), 'dd MMM yyyy') : '—');

/**
 * Newest first, with every entry closing the day before the next one starts and the newest left
 * open-ended.
 *
 * Recomputed on every add and delete rather than patched, so a back-dated entry slots into the
 * middle of the history and deleting a middle entry leaves no gap in the dates.
 */
const normaliseLog = (entries: DpLogEntry[]): DpLogEntry[] =>
  [...entries]
    .sort((a, b) => b.fromDate.localeCompare(a.fromDate))
    .map((entry, index, sorted) => ({
      ...entry,
      toDate:
        index === 0
          ? null
          : format(subDays(parseISO(sorted[index - 1].fromDate), 1), 'yyyy-MM-dd'),
    }));

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
    const current = accounts.map((acc) => acc.drawingPower.find((entry) => entry.toDate === null) ?? acc.drawingPower[0]);
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

  const openForm = (account: BankAccount) => {
    setForm({ ...EMPTY_FORM, fromDate: format(new Date(), 'yyyy-MM-dd') });
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
    if (formAccount.drawingPower.some((entry) => entry.fromDate === form.fromDate)) {
      toast({
        title: 'Date already used',
        description: `A limit already starts on ${formatDay(form.fromDate)}. Delete it first or pick another date.`,
        variant: 'destructive',
      });
      return;
    }

    const nextLog = normaliseLog([
      ...formAccount.drawingPower,
      { id: makeId(), fromDate: form.fromDate, toDate: null, amount, odAmount: 0, todAmount },
    ]);

    const saved = await replaceLog(formAccount, nextLog, `Limit from ${formatDay(form.fromDate)} saved for ${formAccount.shortName || formAccount.bankName}.`);
    if (saved) setFormAccount(null);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const { account, entry } = deleteTarget;
    const nextLog = normaliseLog(account.drawingPower.filter((item) => item.id !== entry.id));
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
        entry.toDate === null ? (
          <Badge variant="success">Current</Badge>
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

  if (authLoading || (isLoading && canView)) {
    return (
      <div className="relative w-full px-4 sm:px-6 lg:px-8 py-6 space-y-4">
        <Skeleton className="h-10 w-64 rounded-xl" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <Skeleton className="h-80 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="relative w-full px-4 sm:px-6 lg:px-8 py-6">
        <PageHeader title="DP Management" backHref="/bank-balance/settings" backLabel="Back to settings" />
        <Card><CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission to view this page.</CardDescription></CardHeader>
          <CardContent className="flex justify-center p-8"><ShieldAlert className="h-14 w-14 text-destructive" /></CardContent>
        </Card>
      </div>
    );
  }

  const formAmount = Number(form.amount) || 0;
  const formTod = Number(form.todAmount) || 0;
  const formCurrent = formAccount?.drawingPower.find((entry) => entry.toDate === null);
  const closesCurrent = !!formCurrent && !!form.fromDate && form.fromDate > formCurrent.fromDate;

  return (
    <>
      {/* ── Animated Background (Purple theme for DP Management) ── */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-purple-50/60 via-background to-violet-50/40 dark:from-purple-950/20 dark:via-background dark:to-violet-950/15" />
        <div className="animate-bb-orb-1 absolute top-[-10%] left-[-5%] w-[40vw] h-[40vw] rounded-full bg-purple-300/15 blur-3xl" />
        <div className="animate-bb-orb-2 absolute bottom-[-8%] right-[-6%] w-[45vw] h-[45vw] rounded-full bg-violet-300/12 blur-3xl" />
        <div className="absolute inset-0 opacity-20 dark:opacity-12"
          style={{ backgroundImage: 'radial-gradient(circle, rgba(168,85,247,0.12) 1px, transparent 1px)', backgroundSize: '28px 28px' }}
        />
      </div>
    <div className="relative w-full px-4 sm:px-6 lg:px-8 py-4 space-y-5">
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
            const current = acc.drawingPower.find((entry) => entry.toDate === null);

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
        <DialogContent className="hr-mobile-dialog sm:max-w-lg">
          <form onSubmit={handleSaveEntry} className="contents">
            <DialogHeader className="hr-dialog-header">
              <DialogTitle>New limit entry</DialogTitle>
              <DialogDescription>
                {formAccount?.bankName}
                {formAccount?.shortName ? ` (${formAccount.shortName.trim()})` : ''} · {formAccount?.accountNumber}
              </DialogDescription>
            </DialogHeader>

            <div className="hr-dialog-body grid grid-cols-1 gap-4 sm:grid-cols-2">
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

              <div className="rounded-lg border bg-muted/40 p-3 sm:col-span-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-muted-foreground">Total limit</span>
                  <span className="text-lg font-bold tabular-nums text-violet-700">{formatMoney(formAmount + formTod)}</span>
                </div>
                {closesCurrent && formCurrent && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    The current limit ({formatMoney(getEffectiveCcLimitFromEntry(formCurrent))} from {formatDay(formCurrent.fromDate)}) will end on{' '}
                    {formatDay(format(subDays(parseISO(form.fromDate), 1), 'yyyy-MM-dd'))}.
                  </p>
                )}
                {!!formCurrent && !!form.fromDate && form.fromDate < formCurrent.fromDate && (
                  <p className="mt-1 text-xs text-amber-700">
                    This date is before the current limit, so it will be added to the history as a past entry.
                  </p>
                )}
              </div>
            </div>

            <DialogFooter className="hr-dialog-footer">
              <Button type="button" variant="outline" onClick={() => setFormAccount(null)} disabled={!!savingId}>
                Cancel
              </Button>
              <Button type="submit" disabled={!!savingId}>
                {savingId ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save Entry
              </Button>
            </DialogFooter>
          </form>
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
