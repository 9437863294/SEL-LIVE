'use client';
export const dynamic = 'force-dynamic';

import { useState } from 'react';
import { AlertTriangle, Building2, CreditCard, Landmark, Loader2, Pencil, Plus, Save, Trash2, Wallet } from 'lucide-react';
import { addDoc, collection, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { PageHeader } from '@/components/shared/page-header';
import { KpiCard } from '@/components/shared/kpi-card';
import { DataList, type ListColumn } from '@/components/shared/data-list';
import { StatusBadge } from '@/components/shared/status-badge';
import { TableCard } from '@/components/shared/table-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
import { formatDay, formatInr } from '@/lib/bank-balance-ledger';
import type { BankAccount } from '@/lib/types';

type AccountForm = {
  bankName: string;
  shortName: string;
  accountNumber: string;
  accountType: BankAccount['accountType'];
  status: BankAccount['status'];
  branch: string;
  ifsc: string;
  openingDate: string;
  openingAmount: string;
};

const todayISO = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const EMPTY_FORM: AccountForm = {
  bankName: '',
  shortName: '',
  accountNumber: '',
  accountType: 'Current Account',
  status: 'Active',
  branch: '',
  ifsc: '',
  openingDate: todayISO(),
  openingAmount: '',
};

const isCc = (account: Pick<BankAccount, 'accountType'>) => account.accountType === 'Cash Credit';
const openingOf = (account: BankAccount) => (isCc(account) ? account.openingUtilization : account.openingBalance) || 0;

/**
 * Bank Accounts — the module's account master, and the one place an account's opening figure is
 * set (the separate Opening Utilization page edited the same two fields under another permission
 * and has been folded in here).
 *
 * The opening figure is the position at the start of the opening date: every balance, utilisation
 * and interest calculation starts there and ignores entries dated earlier, so the date is required.
 */
export default function BankAccountsPage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();
  const canView = !authLoading && can('View', 'Bank Balance.Accounts');
  const canAdd = !authLoading && can('Add', 'Bank Balance.Accounts');
  const canEdit = !authLoading && can('Edit', 'Bank Balance.Accounts');
  const canDelete = !authLoading && can('Delete', 'Bank Balance.Accounts');

  const { accounts, isLoading, refresh } = useBankData({ enabled: canView });

  const [editing, setEditing] = useState<BankAccount | 'new' | null>(null);
  const [form, setForm] = useState<AccountForm>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BankAccount | null>(null);

  if (authLoading || (isLoading && canView)) return <BankPageSkeleton kpis={4} />;
  if (!canView) return <BankAccessDenied title="Bank Accounts" backHref="/bank-balance/settings" backLabel="Back to settings" />;

  const openForm = (account?: BankAccount) => {
    if (account) {
      setForm({
        bankName: account.bankName || '',
        shortName: account.shortName || '',
        accountNumber: account.accountNumber || '',
        accountType: account.accountType || 'Current Account',
        status: account.status || 'Active',
        branch: account.branch || '',
        ifsc: account.ifsc || '',
        openingDate: account.openingDate || '',
        openingAmount: String(openingOf(account)),
      });
      setEditing(account);
    } else {
      setForm(EMPTY_FORM);
      setEditing('new');
    }
  };

  const set = <K extends keyof AccountForm>(field: K, value: AccountForm[K]) => setForm((prev) => ({ ...prev, [field]: value }));

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    const isNew = editing === 'new';
    if (isNew ? !canAdd : !canEdit) {
      toast({ title: 'Not allowed', description: 'You do not have permission to save bank accounts.', variant: 'destructive' });
      return;
    }
    if (!form.bankName.trim() || !form.shortName.trim() || !form.accountNumber.trim()) {
      toast({ title: 'Check the form', description: 'Bank name, short name and account number are required.', variant: 'destructive' });
      return;
    }
    if (!form.openingDate) {
      toast({ title: 'Check the form', description: 'The opening date is required — balances are calculated from it.', variant: 'destructive' });
      return;
    }
    const openingValue = Number(form.openingAmount || 0);
    if (!Number.isFinite(openingValue)) {
      toast({ title: 'Check the form', description: 'Enter a valid opening amount.', variant: 'destructive' });
      return;
    }

    const details = {
      bankName: form.bankName.trim(),
      shortName: form.shortName.trim(),
      accountNumber: form.accountNumber.trim(),
      accountType: form.accountType,
      status: form.status,
      branch: form.branch.trim(),
      ifsc: form.ifsc.trim().toUpperCase(),
      openingDate: form.openingDate,
      // Only the figure for this account type is written, so switching the type no longer
      // silently zeroes the other one.
      ...(form.accountType === 'Cash Credit' ? { openingUtilization: openingValue } : { openingBalance: openingValue }),
    };

    setIsSaving(true);
    try {
      if (isNew) {
        await addDoc(collection(db, 'bankAccounts'), {
          openingBalance: 0,
          openingUtilization: 0,
          ...details,
          currentBalance: 0,
          drawingPower: [],
          interestRateLog: [],
        });
        toast({ title: 'Saved', description: `${details.shortName} added.` });
      } else {
        await updateDoc(doc(db, 'bankAccounts', editing.id), details);
        toast({ title: 'Saved', description: `${details.shortName} updated.` });
      }
      setEditing(null);
      void refresh();
    } catch (error) {
      console.error('Error saving bank account:', error);
      toast({ title: 'Error', description: 'Could not save the bank account.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    if (!canDelete) {
      toast({ title: 'Not allowed', description: 'You do not have permission to delete bank accounts.', variant: 'destructive' });
      return;
    }
    setIsSaving(true);
    try {
      await deleteDoc(doc(db, 'bankAccounts', deleteTarget.id));
      toast({ title: 'Deleted', description: `${accountLabel(deleteTarget)} deleted.` });
      setDeleteTarget(null);
      void refresh();
    } catch (error) {
      console.error('Error deleting bank account:', error);
      toast({ title: 'Error', description: 'Could not delete the bank account.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const active = accounts.filter((a) => a.status === 'Active');
  const ccCount = accounts.filter(isCc).length;
  const missingOpeningDate = accounts.filter((a) => !a.openingDate).length;

  const columns: Array<ListColumn<BankAccount>> = [
    {
      header: 'Account',
      mobile: 'title',
      cell: (a) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={isCc(a) ? 'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600' : 'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-600'}>
            {isCc(a) ? <CreditCard className="h-4 w-4" /> : <Building2 className="h-4 w-4" />}
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">{accountLabel(a)}</p>
            <p className="truncate text-xs text-muted-foreground">{a.bankName}</p>
          </div>
        </div>
      ),
    },
    { header: 'Status', mobile: 'aside', cell: (a) => <StatusBadge status={a.status} /> },
    { header: 'Type', cell: (a) => <Badge variant={isCc(a) ? 'progress' : 'info'}>{isCc(a) ? 'Cash Credit' : 'Current'}</Badge> },
    { header: 'Account No.', cell: (a) => <span className="whitespace-nowrap font-mono text-xs">{a.accountNumber || '—'}</span> },
    {
      header: 'Branch / IFSC',
      cell: (a) => (
        <div className="min-w-0 text-xs">
          <p className="truncate">{a.branch || '—'}</p>
          <p className="font-mono text-muted-foreground">{a.ifsc || '—'}</p>
        </div>
      ),
    },
    {
      header: 'Opening',
      align: 'right',
      cell: (a) => (
        <div className="text-right text-xs">
          <p className="font-medium tabular-nums">{formatInr(openingOf(a))}</p>
          {a.openingDate ? (
            <p className="text-muted-foreground">{isCc(a) ? 'Utilisation' : 'Balance'} on {formatDay(a.openingDate)}</p>
          ) : (
            <p className="font-medium text-amber-700">No opening date</p>
          )}
        </div>
      ),
    },
    {
      header: '',
      align: 'right',
      mobile: 'footer',
      cell: (a) =>
        canEdit || canDelete ? (
          <div className="flex justify-end gap-1">
            {canEdit && (
              <Button variant="ghost" size="sm" className="h-8" onClick={() => openForm(a)} aria-label={`Edit ${accountLabel(a)}`}>
                <Pencil className="h-3.5 w-3.5 sm:mr-0" />
                <span className="ml-1.5 sm:hidden">Edit</span>
              </Button>
            )}
            {canDelete && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-destructive hover:text-destructive"
                onClick={() => setDeleteTarget(a)}
                aria-label={`Delete ${accountLabel(a)}`}
              >
                <Trash2 className="h-3.5 w-3.5 sm:mr-0" />
                <span className="ml-1.5 sm:hidden">Delete</span>
              </Button>
            )}
          </div>
        ) : null,
    },
  ];

  const isNew = editing === 'new';

  return (
    <>
      <BankBalanceBackground tone="violet" />
      <div className={BANK_PAGE}>
        <PageHeader
          title="Bank Accounts"
          description="Accounts, their type and status, and the opening figure every balance starts from."
          icon={Landmark}
          backHref="/bank-balance/settings"
          backLabel="Back to settings"
          actions={
            canAdd && (
              <Button onClick={() => openForm()}>
                <Plus className="mr-2 h-4 w-4" />
                Add Account
              </Button>
            )
          }
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Accounts" value={accounts.length} hint={`${active.length} active · ${accounts.length - active.length} inactive`} icon={Landmark} tone="violet" accent />
          <KpiCard label="Cash Credit" value={ccCount} hint="Limits in DP Management" icon={CreditCard} tone="indigo" accent href={can('View', 'Bank Balance.DP Management') ? '/bank-balance/dp-management' : undefined} />
          <KpiCard label="Current accounts" value={accounts.length - ccCount} icon={Wallet} tone="cyan" accent />
          <KpiCard
            label="Missing opening date"
            value={missingOpeningDate}
            hint={missingOpeningDate ? 'Balances count every entry for these' : 'Every account has one'}
            icon={AlertTriangle}
            tone={missingOpeningDate ? 'amber' : 'emerald'}
            accent
          />
        </div>

        <TableCard title="Bank accounts" count={accounts.length} noun="account" scroll="natural">
          <DataList
            rows={accounts}
            columns={columns}
            empty={
              <div className="flex flex-col items-center justify-center py-14 text-center">
                <Building2 className="mb-3 h-8 w-8 text-muted-foreground" />
                <p className="font-medium">No bank accounts yet</p>
                <p className="text-sm text-muted-foreground">Add the first account to start tracking balances.</p>
              </div>
            }
          />
        </TableCard>
      </div>

      <Dialog open={!!editing} onOpenChange={(open) => { if (!open && !isSaving) setEditing(null); }}>
        <DialogContent className="hr-mobile-dialog gap-5 sm:max-w-2xl">
          <DialogHeader className="hr-dialog-header pr-8">
            <DialogTitle>{isNew ? 'Add bank account' : 'Edit bank account'}</DialogTitle>
            <DialogDescription>
              {isNew ? 'Details, type and the opening figure the balance starts from.' : accountLabel(editing || undefined)}
            </DialogDescription>
          </DialogHeader>

          <form id="bank-account-form" onSubmit={handleSave} className="hr-dialog-body space-y-5">
            <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Bank details</legend>
              <div className="space-y-1.5">
                <Label htmlFor="acc-bank">Bank name</Label>
                <Input id="acc-bank" required value={form.bankName} onChange={(e) => set('bankName', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="acc-short">Short name</Label>
                <Input id="acc-short" required placeholder="e.g. SBI-CC" value={form.shortName} onChange={(e) => set('shortName', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="acc-number">Account number</Label>
                <Input id="acc-number" required value={form.accountNumber} onChange={(e) => set('accountNumber', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="acc-ifsc">IFSC</Label>
                <Input id="acc-ifsc" value={form.ifsc} onChange={(e) => set('ifsc', e.target.value)} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="acc-branch">Branch</Label>
                <Input id="acc-branch" value={form.branch} onChange={(e) => set('branch', e.target.value)} />
              </div>
            </fieldset>

            <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Account</legend>
              <div className="space-y-1.5">
                <Label>Account type</Label>
                <Select value={form.accountType} onValueChange={(v) => set('accountType', v as AccountForm['accountType'])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Current Account">Current Account</SelectItem>
                    <SelectItem value="Cash Credit">Cash Credit</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => set('status', v as AccountForm['status'])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Active">Active</SelectItem>
                    <SelectItem value="Inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </fieldset>

            <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Opening figure</legend>
              <div className="space-y-1.5">
                <Label htmlFor="acc-opening-date">Opening date</Label>
                <Input id="acc-opening-date" type="date" required value={form.openingDate} onChange={(e) => set('openingDate', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="acc-opening-amount">{form.accountType === 'Cash Credit' ? 'Opening utilisation (₹)' : 'Opening balance (₹)'}</Label>
                <Input
                  id="acc-opening-amount"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  placeholder="0"
                  value={form.openingAmount}
                  onChange={(e) => set('openingAmount', e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                The {form.accountType === 'Cash Credit' ? 'utilisation' : 'balance'} at the start of the opening date. Balances, limits and
                interest are calculated from here; entries dated earlier are ignored.
              </p>
            </fieldset>
          </form>

          <DialogFooter className="hr-dialog-footer gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setEditing(null)} disabled={isSaving}>
              Cancel
            </Button>
            <Button type="submit" form="bank-account-form" disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save Account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open && !isSaving) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {accountLabel(deleteTarget || undefined)}?</AlertDialogTitle>
            <AlertDialogDescription>
              The account is removed permanently. Its payments, receipts and transfers stay in the records but no longer belong to
              any account. To stop using an account while keeping its history, set it to Inactive instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSaving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isSaving}
              onClick={(event) => {
                event.preventDefault();
                void handleDelete();
              }}
            >
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
