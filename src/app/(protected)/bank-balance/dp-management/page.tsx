'use client';
export const dynamic = 'force-dynamic';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Gauge, Landmark, Plus, Trash2, TrendingUp, Wallet } from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { format, parseISO, startOfDay, subDays } from 'date-fns';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/shared/page-header';
import { KpiCard } from '@/components/shared/kpi-card';
import { DataList, type ListColumn } from '@/components/shared/data-list';
import { TableCard } from '@/components/shared/table-card';
import { FilterBar } from '@/components/shared/filter-bar';
import {
  BANK_PAGE,
  BankAccessDenied,
  BankBalanceBackground,
  BankPageSkeleton,
  accountLabel,
  useBankData,
} from '@/components/bank-balance/page-kit';
import {
  AccountFilter,
  ConfirmDeleteEntry,
  EntryDialog,
  RegisterStateBadge,
  RegisterViewFilter,
  buildRegisterRows,
  effectNotes,
  type RegisterRow,
  type RegisterView,
} from '@/components/bank-balance/dated-log-kit';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { db } from '@/lib/firebase';
import { getEffectiveCcLimitFromEntry } from '@/lib/bank-balance-limit';
import { entryAppliesOn, formatDay, formatInr, isCashCredit, normaliseDatedLog } from '@/lib/bank-balance-ledger';
import type { BankAccount, DpLogEntry } from '@/lib/types';

type EntryForm = { accountId: string; fromDate: string; amount: string; todAmount: string };
type Row = RegisterRow<DpLogEntry>;

const EMPTY_FORM: EntryForm = { accountId: '', fromDate: '', amount: '', todAmount: '' };

const makeId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const logOf = (account: BankAccount): DpLogEntry[] =>
  Array.isArray(account.drawingPower) ? [...account.drawingPower].sort((a, b) => b.fromDate.localeCompare(a.fromDate)) : [];

const dpOf = (entry: DpLogEntry | undefined) => (entry?.amount || 0) + (entry?.odAmount || 0);
const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatInr(Math.abs(value))}`;

const VIEW_TITLE: Record<RegisterView, string> = {
  current: 'Limits in force today',
  upcoming: 'Upcoming limits',
  all: 'All limit entries',
};

/**
 * DP Management — the dated limits (drawing power + temporary overdrawn) of every Cash Credit
 * account, kept in ONE register for all banks: by default the limit each account has today, or
 * switch the view to upcoming entries or the full history, and narrow it to one account.
 *
 * Entries are added and deleted through `normaliseDatedLog`, so each entry ends the day before the
 * next begins, a back-dated entry slots into place, a second entry on the same date replaces the
 * first, and any entry can be deleted.
 */
export default function DpManagementPage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();
  const canView = !authLoading && can('View', 'Bank Balance.DP Management');
  const canAdd = !authLoading && can('Add', 'Bank Balance.DP Management');
  const canDelete = !authLoading && can('Delete', 'Bank Balance.DP Management');
  const canViewReports = can('View', 'Bank Balance.Reports');

  const { accounts, setAccounts, isLoading, loadedAt } = useBankData({ enabled: canView });

  const [form, setForm] = useState<EntryForm>(EMPTY_FORM);
  const [formOpen, setFormOpen] = useState(false);
  const [lockAccount, setLockAccount] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null);
  const [view, setView] = useState<RegisterView>('current');
  const [accountFilter, setAccountFilter] = useState('all');

  const today = useMemo(() => startOfDay(loadedAt ?? new Date()), [loadedAt]);
  const ccAccounts = useMemo(() => accounts.filter(isCashCredit), [accounts]);

  const inForce = useMemo(() => {
    const out = new Map<string, DpLogEntry | undefined>();
    ccAccounts.forEach((account) => out.set(account.id, logOf(account).find((e) => entryAppliesOn(e, today))));
    return out;
  }, [ccAccounts, today]);

  const summary = useMemo(() => {
    const entries = [...inForce.values()].filter((e): e is DpLogEntry => !!e);
    return {
      limit: entries.reduce((sum, e) => sum + getEffectiveCcLimitFromEntry(e), 0),
      dp: entries.reduce((sum, e) => sum + dpOf(e), 0),
      tod: entries.reduce((sum, e) => sum + (e.todAmount || 0), 0),
      withoutLimit: ccAccounts.length - entries.length,
      upcoming: ccAccounts.filter((a) => logOf(a).some((e) => e.fromDate > format(today, 'yyyy-MM-dd'))).length,
    };
  }, [ccAccounts, inForce, today]);

  const rows = useMemo(
    () =>
      buildRegisterRows(ccAccounts, logOf, {
        view,
        accountId: accountFilter,
        today,
        delta: (entry, previous) => getEffectiveCcLimitFromEntry(entry) - getEffectiveCcLimitFromEntry(previous),
      }),
    [ccAccounts, view, accountFilter, today],
  );
  const shownTotal = rows.reduce((sum, row) => sum + (row.entry ? getEffectiveCcLimitFromEntry(row.entry) : 0), 0);

  const saveLog = async (account: BankAccount, nextLog: DpLogEntry[], message: string) => {
    setSaving(true);
    try {
      await updateDoc(doc(db, 'bankAccounts', account.id), { drawingPower: nextLog });
      setAccounts((prev) => prev.map((a) => (a.id === account.id ? { ...a, drawingPower: nextLog } : a)));
      toast({ title: 'Saved', description: message });
      return true;
    } catch (error) {
      console.error('Error saving DP log:', error);
      toast({ title: 'Error', description: 'Could not save the limit entry. Please try again.', variant: 'destructive' });
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Starts from the limit in force today, so changing only DP or only TOD carries the other forward.
  const prefill = (accountId: string) => {
    const entry = inForce.get(accountId);
    return { amount: entry ? String(dpOf(entry)) : '', todAmount: entry?.todAmount ? String(entry.todAmount) : '' };
  };

  const openForm = (account?: BankAccount) => {
    const accountId = account?.id ?? (accountFilter !== 'all' ? accountFilter : ccAccounts.length === 1 ? ccAccounts[0].id : '');
    setForm({ accountId, fromDate: format(new Date(), 'yyyy-MM-dd'), ...prefill(accountId) });
    setLockAccount(!!account);
    setFormOpen(true);
  };

  const formAccount = ccAccounts.find((a) => a.id === form.accountId);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canAdd) return;
    if (!formAccount) {
      toast({ title: 'Check the entry', description: 'Choose the account.', variant: 'destructive' });
      return;
    }
    const amount = Number(form.amount);
    const todAmount = Number(form.todAmount || 0);
    if (!form.fromDate || form.amount.trim() === '' || !Number.isFinite(amount) || amount < 0 || !Number.isFinite(todAmount) || todAmount < 0) {
      toast({ title: 'Check the entry', description: 'Enter the effective date, the DP, and a TOD of zero or more.', variant: 'destructive' });
      return;
    }
    const log = logOf(formAccount);
    const sameDay = log.find((e) => e.fromDate === form.fromDate);
    const nextLog = normaliseDatedLog([
      ...log.filter((e) => e.id !== sameDay?.id),
      { id: sameDay?.id ?? makeId(), fromDate: form.fromDate, toDate: null, amount, odAmount: 0, todAmount },
    ]);
    const ok = await saveLog(formAccount, nextLog, `Limit from ${formatDay(form.fromDate)} ${sameDay ? 'updated' : 'saved'} for ${accountLabel(formAccount)}.`);
    if (ok) setFormOpen(false);
  };

  const handleDelete = async () => {
    if (!deleteTarget?.entry || !canDelete) return;
    const entryId = deleteTarget.entry.id;
    const nextLog = normaliseDatedLog(logOf(deleteTarget.account).filter((e) => e.id !== entryId));
    const ok = await saveLog(deleteTarget.account, nextLog, 'Limit entry deleted.');
    if (ok) setDeleteTarget(null);
  };

  if (authLoading || (isLoading && canView)) return <BankPageSkeleton kpis={4} blocks={1} />;
  if (!canView) return <BankAccessDenied title="DP Management" backHref="/bank-balance/settings" backLabel="Back to settings" />;

  const amountCell = (row: Row, value: (entry: DpLogEntry) => number, strong = false) =>
    row.entry ? <span className={strong ? 'font-semibold tabular-nums' : 'tabular-nums'}>{formatInr(value(row.entry))}</span> : <span className="text-muted-foreground">—</span>;

  const columns: Array<ListColumn<Row>> = [
    {
      header: 'Account',
      mobile: 'title',
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium">
            {accountLabel(r.account)}
            {r.account.status === 'Inactive' && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(inactive)</span>}
          </p>
          <p className="truncate text-xs text-muted-foreground">{r.account.bankName}</p>
        </div>
      ),
    },
    { header: 'Status', mobile: 'aside', cell: (r) => <RegisterStateBadge state={r.state} entry={r.entry} noneLabel="No limit" /> },
    { header: 'Effective from', cell: (r) => <span className="whitespace-nowrap">{r.entry ? formatDay(r.entry.fromDate) : '—'}</span> },
    { header: 'Effective to', cell: (r) => <span className="whitespace-nowrap text-muted-foreground">{r.entry ? (r.entry.toDate ? formatDay(r.entry.toDate) : 'Open-ended') : '—'}</span> },
    { header: 'DP', align: 'right', cell: (r) => amountCell(r, dpOf) },
    { header: 'TOD', align: 'right', cell: (r) => amountCell(r, (e) => e.todAmount || 0) },
    { header: 'Total limit', align: 'right', cell: (r) => amountCell(r, getEffectiveCcLimitFromEntry, true) },
    {
      header: 'Change',
      align: 'right',
      cell: (r) =>
        !r.entry ? (
          <span className="text-muted-foreground">—</span>
        ) : r.change === null ? (
          <span className="text-xs text-muted-foreground">First entry</span>
        ) : (
          <span className={r.change > 0 ? 'tabular-nums text-emerald-700' : r.change < 0 ? 'tabular-nums text-rose-700' : 'tabular-nums text-muted-foreground'}>
            {signed(r.change)}
          </span>
        ),
    },
    ...(view === 'current'
      ? [
          {
            header: 'Next change',
            cell: (r: Row) =>
              r.upcoming ? (
                <span className="whitespace-nowrap text-xs">
                  {formatInr(getEffectiveCcLimitFromEntry(r.upcoming))} from {formatDay(r.upcoming.fromDate)}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              ),
          },
        ]
      : []),
    {
      header: '',
      align: 'right',
      mobile: 'footer',
      cell: (r) => (
        <div className="flex justify-end gap-1">
          {canAdd && (
            <Button variant="outline" size="sm" className="h-8" onClick={() => openForm(r.account)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              New limit
            </Button>
          )}
          {canDelete && r.entry && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-destructive hover:text-destructive"
              onClick={() => setDeleteTarget(r)}
              aria-label={`Delete the ${accountLabel(r.account)} limit from ${formatDay(r.entry.fromDate)}`}
            >
              <Trash2 className="h-3.5 w-3.5 sm:mr-0" />
              <span className="ml-1.5 sm:hidden">Delete</span>
            </Button>
          )}
        </div>
      ),
    },
  ];

  // The dialog's comparison: against the limit that would otherwise be in force on the chosen date.
  const formLog = formAccount ? logOf(formAccount) : [];
  const newTotal = (Number(form.amount) || 0) + (Number(form.todAmount) || 0);
  const previous = form.fromDate ? formLog.find((e) => e.fromDate <= form.fromDate) : undefined;
  const replaces = previous?.fromDate === form.fromDate;
  const next = form.fromDate ? [...formLog].reverse().find((e) => e.fromDate > form.fromDate) : undefined;
  const change = newTotal - (previous ? getEffectiveCcLimitFromEntry(previous) : 0);
  const dayBefore = (iso: string) => formatDay(subDays(parseISO(iso), 1));

  return (
    <>
      <BankBalanceBackground tone="purple" />
      <div className={BANK_PAGE}>
        <PageHeader
          title="DP Management"
          description="Dated limits for Cash Credit accounts: drawing power (DP) plus temporary overdrawn (TOD)."
          icon={TrendingUp}
          backHref="/bank-balance/settings"
          backLabel="Back to settings"
          actions={
            <>
              {canViewReports && (
                <Button asChild variant="outline">
                  <Link href="/bank-balance/reports/dp-utilization">
                    <Gauge className="mr-2 h-4 w-4" />
                    DP Utilization
                  </Link>
                </Button>
              )}
              {canAdd && ccAccounts.length > 0 && (
                <Button onClick={() => openForm()}>
                  <Plus className="mr-2 h-4 w-4" />
                  New Limit
                </Button>
              )}
            </>
          }
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Cash Credit accounts"
            value={ccAccounts.length}
            hint={summary.upcoming ? `${summary.upcoming} with an upcoming change` : 'Limits dated per account'}
            icon={Landmark}
            tone="violet"
            accent
          />
          <KpiCard label="Total limit in force" value={formatInr(summary.limit)} hint="DP + TOD, today" icon={Wallet} tone="indigo" accent />
          <KpiCard label="Of which TOD" value={formatInr(summary.tod)} hint={`DP ${formatInr(summary.dp)}`} icon={TrendingUp} tone="cyan" accent />
          <KpiCard
            label="Accounts without a limit"
            value={summary.withoutLimit}
            hint={summary.withoutLimit ? 'No limit in force today' : 'Every account has a limit'}
            icon={AlertTriangle}
            tone={summary.withoutLimit ? 'amber' : 'emerald'}
            accent
          />
        </div>

        <TableCard
          title={VIEW_TITLE[view]}
          description={
            view === 'all'
              ? 'Every dated entry of every account; each one ends the day before the next begins.'
              : view === 'upcoming'
                ? 'Entries that start after today.'
                : `All Cash Credit accounts in one register · ${formatInr(shownTotal)} in force.`
          }
          count={rows.filter((r) => r.entry).length}
          noun="entry"
          toolbar={
            <FilterBar
              activeCount={(view === 'current' ? 0 : 1) + (accountFilter === 'all' ? 0 : 1)}
              onClear={() => {
                setView('current');
                setAccountFilter('all');
              }}
            >
              <RegisterViewFilter value={view} onChange={setView} />
              <AccountFilter accounts={ccAccounts} value={accountFilter} onChange={setAccountFilter} />
            </FilterBar>
          }
        >
          <DataList
            rows={rows}
            columns={columns}
            empty={
              <p className="py-12 text-center text-sm text-muted-foreground">
                {ccAccounts.length === 0 ? 'No Cash Credit accounts. Add one under Bank Accounts.' : view === 'upcoming' ? 'No upcoming limits.' : 'No limit entries yet.'}
              </p>
            }
          />
        </TableCard>
      </div>

      <EntryDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        formId="dp-entry-form"
        title={replaces ? 'Update limit entry' : 'New limit entry'}
        accounts={ccAccounts}
        accountId={form.accountId}
        onAccountChange={(accountId) => setForm((prev) => ({ ...prev, accountId, ...prefill(accountId) }))}
        lockAccount={lockAccount}
        fromDate={form.fromDate}
        onFromDateChange={(fromDate) => setForm((prev) => ({ ...prev, fromDate }))}
        fields={
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
        }
        comparison={[
          {
            label: previous ? `${replaces ? 'Entry being replaced' : 'Previous limit'} (from ${formatDay(previous.fromDate)})` : 'Previous limit',
            value: previous ? formatInr(getEffectiveCcLimitFromEntry(previous)) : 'None',
          },
          { label: 'New limit (DP + TOD)', value: formatInr(newTotal), strong: true },
          { label: 'Change', value: signed(change), tone: change > 0 ? 'good' : change < 0 ? 'bad' : 'none' },
        ]}
        notes={effectNotes({ noun: 'limit', fromDate: form.fromDate, replaces, previous: !!previous, next, dayBefore })}
        saving={saving}
        onSubmit={handleSave}
      />

      <ConfirmDeleteEntry
        open={!!deleteTarget}
        title="Delete this limit entry?"
        description={
          deleteTarget?.entry
            ? `${accountLabel(deleteTarget.account)}: ${formatInr(getEffectiveCcLimitFromEntry(deleteTarget.entry))} from ${formatDay(deleteTarget.entry.fromDate)}. The remaining entries are re-dated so the history has no gap.`
            : ''
        }
        saving={saving}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void handleDelete()}
      />
    </>
  );
}
