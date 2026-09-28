'use client';
export const dynamic = 'force-dynamic';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, FileBarChart, IndianRupee, Landmark, Percent, Plus, Trash2 } from 'lucide-react';
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
import { balanceAt, buildLedgers, dailyInterest, entryAppliesOn, formatDay, formatInr, isCashCredit, normaliseDatedLog } from '@/lib/bank-balance-ledger';
import type { BankAccount, InterestRateLogEntry } from '@/lib/types';

type EntryForm = { accountId: string; fromDate: string; rate: string };
type Row = RegisterRow<InterestRateLogEntry>;

const EMPTY_FORM: EntryForm = { accountId: '', fromDate: '', rate: '' };

const makeId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const formatRate = (rate: number) => `${(Number(rate) || 0).toFixed(2)}%`;
const signedPp = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(2)} pp`;

const logOf = (account: BankAccount): InterestRateLogEntry[] =>
  Array.isArray(account.interestRateLog) ? [...account.interestRateLog].sort((a, b) => b.fromDate.localeCompare(a.fromDate)) : [];

const VIEW_TITLE: Record<RegisterView, string> = {
  current: 'Rates in force today',
  upcoming: 'Upcoming rates',
  all: 'All rate entries',
};

/**
 * Interest Rates — the dated rate (% per annum) each Cash Credit account is charged, kept in ONE
 * register for all banks, exactly like DP Management: by default the rate in force today with
 * today's projected interest, or switch to upcoming entries or the full history, and narrow it to
 * one account. The Interest Report reads these rates for every day's interest.
 */
export default function InterestRatePage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();
  const canView = !authLoading && can('View', 'Bank Balance.Interest Rate');
  const canAdd = !authLoading && can('Add', 'Bank Balance.Interest Rate');
  const canDelete = !authLoading && can('Delete', 'Bank Balance.Interest Rate');
  const canViewReports = can('View', 'Bank Balance.Reports');

  const { accounts, setAccounts, transactions, isLoading, loadedAt } = useBankData({ enabled: canView, transactions: true });

  const [form, setForm] = useState<EntryForm>(EMPTY_FORM);
  const [formOpen, setFormOpen] = useState(false);
  const [lockAccount, setLockAccount] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null);
  const [view, setView] = useState<RegisterView>('current');
  const [accountFilter, setAccountFilter] = useState('all');

  const today = useMemo(() => startOfDay(loadedAt ?? new Date()), [loadedAt]);
  const ccAccounts = useMemo(() => accounts.filter(isCashCredit), [accounts]);
  const ledgers = useMemo(() => buildLedgers(ccAccounts, transactions), [ccAccounts, transactions]);

  // Per account: the rate in force today, today's utilisation, and today's projected interest.
  const inForce = useMemo(() => {
    const out = new Map<string, { entry?: InterestRateLogEntry; utilised: number; interest: number }>();
    for (const account of ccAccounts) {
      const entry = logOf(account).find((e) => entryAppliesOn(e, today));
      const ledger = ledgers.get(account.id);
      const utilised = ledger ? balanceAt(ledger, today) : 0;
      out.set(account.id, { entry, utilised, interest: dailyInterest(utilised, Number(entry?.rate) || 0) });
    }
    return out;
  }, [ccAccounts, ledgers, today]);

  const summary = useMemo(() => {
    const rates = [...inForce.values()].map((v) => v.entry).filter((e): e is InterestRateLogEntry => !!e).map((e) => Number(e.rate) || 0);
    return {
      average: rates.length ? rates.reduce((sum, rate) => sum + rate, 0) / rates.length : null,
      withRate: rates.length,
      withoutRate: ccAccounts.length - rates.length,
      interest: [...inForce.values()].reduce((sum, v) => sum + v.interest, 0),
      upcoming: ccAccounts.filter((a) => logOf(a).some((e) => e.fromDate > format(today, 'yyyy-MM-dd'))).length,
    };
  }, [ccAccounts, inForce, today]);

  const rows = useMemo(
    () =>
      buildRegisterRows(ccAccounts, logOf, {
        view,
        accountId: accountFilter,
        today,
        delta: (entry, previous) => (Number(entry.rate) || 0) - (Number(previous.rate) || 0),
      }),
    [ccAccounts, view, accountFilter, today],
  );

  const saveLog = async (account: BankAccount, nextLog: InterestRateLogEntry[], message: string) => {
    setSaving(true);
    try {
      await updateDoc(doc(db, 'bankAccounts', account.id), { interestRateLog: nextLog });
      setAccounts((prev) => prev.map((a) => (a.id === account.id ? { ...a, interestRateLog: nextLog } : a)));
      toast({ title: 'Saved', description: message });
      return true;
    } catch (error) {
      console.error('Error saving interest rate log:', error);
      toast({ title: 'Error', description: 'Could not save the rate entry. Please try again.', variant: 'destructive' });
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Starts from the rate in force today, so a small revision only needs the new figure typed over.
  const prefill = (accountId: string) => {
    const entry = inForce.get(accountId)?.entry;
    return { rate: entry ? String(entry.rate) : '' };
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
    const rate = Number(form.rate);
    if (!form.fromDate || form.rate.trim() === '' || !Number.isFinite(rate) || rate < 0 || rate > 100) {
      toast({ title: 'Check the entry', description: 'Enter the effective date and a rate between 0 and 100%.', variant: 'destructive' });
      return;
    }
    // Two rates cannot start on the same day, so a second entry for a date replaces the first.
    const log = logOf(formAccount);
    const sameDay = log.find((e) => e.fromDate === form.fromDate);
    const nextLog = normaliseDatedLog([...log.filter((e) => e.id !== sameDay?.id), { id: sameDay?.id ?? makeId(), fromDate: form.fromDate, toDate: null, rate }]);
    const ok = await saveLog(formAccount, nextLog, `Rate from ${formatDay(form.fromDate)} ${sameDay ? 'updated' : 'saved'} for ${accountLabel(formAccount)}.`);
    if (ok) setFormOpen(false);
  };

  const handleDelete = async () => {
    if (!deleteTarget?.entry || !canDelete) return;
    const entryId = deleteTarget.entry.id;
    const nextLog = normaliseDatedLog(logOf(deleteTarget.account).filter((e) => e.id !== entryId));
    const ok = await saveLog(deleteTarget.account, nextLog, 'Rate entry deleted.');
    if (ok) setDeleteTarget(null);
  };

  if (authLoading || (isLoading && canView)) return <BankPageSkeleton kpis={4} blocks={1} />;
  if (!canView) return <BankAccessDenied title="Interest Rates" backHref="/bank-balance/settings" backLabel="Back to settings" />;

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
    { header: 'Status', mobile: 'aside', cell: (r) => <RegisterStateBadge state={r.state} entry={r.entry} noneLabel="No rate" /> },
    { header: 'Effective from', cell: (r) => <span className="whitespace-nowrap">{r.entry ? formatDay(r.entry.fromDate) : '—'}</span> },
    { header: 'Effective to', cell: (r) => <span className="whitespace-nowrap text-muted-foreground">{r.entry ? (r.entry.toDate ? formatDay(r.entry.toDate) : 'Open-ended') : '—'}</span> },
    { header: 'Rate (p.a.)', align: 'right', cell: (r) => <span className="font-semibold tabular-nums">{r.entry ? formatRate(r.entry.rate) : '—'}</span> },
    {
      header: 'Change',
      align: 'right',
      cell: (r) =>
        !r.entry ? (
          <span className="text-muted-foreground">—</span>
        ) : r.change === null ? (
          <span className="text-xs text-muted-foreground">First entry</span>
        ) : (
          <span className={r.change > 0 ? 'tabular-nums text-rose-700' : r.change < 0 ? 'tabular-nums text-emerald-700' : 'tabular-nums text-muted-foreground'}>
            {signedPp(r.change)}
          </span>
        ),
    },
    ...(view === 'current'
      ? [
          { header: 'Utilised today', align: 'right' as const, cell: (r: Row) => <span className="tabular-nums">{formatInr(Math.max(0, inForce.get(r.account.id)?.utilised || 0))}</span> },
          { header: 'Interest today', align: 'right' as const, cell: (r: Row) => <span className="tabular-nums">{formatInr(inForce.get(r.account.id)?.interest || 0)}</span> },
          {
            header: 'Next change',
            cell: (r: Row) =>
              r.upcoming ? (
                <span className="whitespace-nowrap text-xs">
                  {formatRate(r.upcoming.rate)} from {formatDay(r.upcoming.fromDate)}
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
              New rate
            </Button>
          )}
          {canDelete && r.entry && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-destructive hover:text-destructive"
              onClick={() => setDeleteTarget(r)}
              aria-label={`Delete the ${accountLabel(r.account)} rate from ${formatDay(r.entry.fromDate)}`}
            >
              <Trash2 className="h-3.5 w-3.5 sm:mr-0" />
              <span className="ml-1.5 sm:hidden">Delete</span>
            </Button>
          )}
        </div>
      ),
    },
  ];

  // The dialog's comparison: against the rate that would otherwise be in force on the chosen date.
  const formLog = formAccount ? logOf(formAccount) : [];
  const newRate = Number(form.rate) || 0;
  const previous = form.fromDate ? formLog.find((e) => e.fromDate <= form.fromDate) : undefined;
  const replaces = previous?.fromDate === form.fromDate;
  const next = form.fromDate ? [...formLog].reverse().find((e) => e.fromDate > form.fromDate) : undefined;
  const change = newRate - (Number(previous?.rate) || 0);
  const dayBefore = (iso: string) => formatDay(subDays(parseISO(iso), 1));

  return (
    <>
      <BankBalanceBackground tone="indigo" />
      <div className={BANK_PAGE}>
        <PageHeader
          title="Interest Rates"
          description="Dated interest rates (% per annum) for Cash Credit accounts, used for every day's interest."
          icon={Percent}
          backHref="/bank-balance/settings"
          backLabel="Back to settings"
          actions={
            <>
              {canViewReports && (
                <Button asChild variant="outline">
                  <Link href="/bank-balance/reports/interest-accrual">
                    <FileBarChart className="mr-2 h-4 w-4" />
                    Interest Report
                  </Link>
                </Button>
              )}
              {canAdd && ccAccounts.length > 0 && (
                <Button onClick={() => openForm()}>
                  <Plus className="mr-2 h-4 w-4" />
                  New Rate
                </Button>
              )}
            </>
          }
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Cash Credit accounts"
            value={ccAccounts.length}
            hint={summary.upcoming ? `${summary.upcoming} with an upcoming change` : 'Rates dated per account'}
            icon={Landmark}
            tone="violet"
            accent
          />
          <KpiCard
            label="Average rate today"
            value={summary.average === null ? '—' : formatRate(summary.average)}
            hint={summary.withRate ? `Simple mean of ${summary.withRate} account${summary.withRate === 1 ? '' : 's'}` : 'No rate in force today'}
            icon={Percent}
            tone="indigo"
            accent
          />
          <KpiCard label="Projected interest today" value={formatInr(summary.interest)} hint="Today's utilisation × rate ÷ 365" icon={IndianRupee} tone="cyan" accent />
          <KpiCard
            label="Accounts without a rate"
            value={summary.withoutRate}
            hint={summary.withoutRate ? 'Interest is taken as nil for these' : 'Every account has a rate'}
            icon={AlertTriangle}
            tone={summary.withoutRate ? 'amber' : 'emerald'}
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
                : `All Cash Credit accounts in one register · ${formatInr(summary.interest)} projected interest today.`
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
                {ccAccounts.length === 0 ? 'No Cash Credit accounts. Add one under Bank Accounts.' : view === 'upcoming' ? 'No upcoming rates.' : 'No rate entries yet.'}
              </p>
            }
          />
        </TableCard>
      </div>

      <EntryDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        formId="interest-rate-form"
        title={replaces ? 'Update rate entry' : 'New rate entry'}
        accounts={ccAccounts}
        accountId={form.accountId}
        onAccountChange={(accountId) => setForm((prev) => ({ ...prev, accountId, ...prefill(accountId) }))}
        lockAccount={lockAccount}
        fromDate={form.fromDate}
        onFromDateChange={(fromDate) => setForm((prev) => ({ ...prev, fromDate }))}
        fields={
          <div className="space-y-1.5">
            <Label htmlFor="rate-value">Rate (% per annum)</Label>
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
        }
        comparison={[
          {
            label: previous ? `${replaces ? 'Entry being replaced' : 'Previous rate'} (from ${formatDay(previous.fromDate)})` : 'Previous rate',
            value: previous ? formatRate(previous.rate) : 'None',
          },
          { label: 'New rate', value: formatRate(newRate), strong: true },
          { label: 'Change', value: signedPp(change), tone: change > 0 ? 'bad' : change < 0 ? 'good' : 'none' },
        ]}
        notes={effectNotes({ noun: 'rate', fromDate: form.fromDate, replaces, previous: !!previous, next, dayBefore })}
        saving={saving}
        onSubmit={handleSave}
      />

      <ConfirmDeleteEntry
        open={!!deleteTarget}
        title="Delete this rate entry?"
        description={
          deleteTarget?.entry
            ? `${accountLabel(deleteTarget.account)}: ${formatRate(deleteTarget.entry.rate)} from ${formatDay(deleteTarget.entry.fromDate)}. The remaining entries are re-dated so the history has no gap.`
            : ''
        }
        saving={saving}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void handleDelete()}
      />
    </>
  );
}
