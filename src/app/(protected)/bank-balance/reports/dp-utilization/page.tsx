'use client';
export const dynamic = 'force-dynamic';

/**
 * DP Utilisation — each Cash Credit account's limit in force today (DP + OD + TOD) against its
 * utilisation from the ledger engine (from the opening date, internal transfers included, a credit
 * balance read as nothing drawn).
 */

import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { AlertTriangle, CreditCard, Gauge, Landmark, RefreshCw, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { PageHeader } from '@/components/shared/page-header';
import { KpiCard } from '@/components/shared/kpi-card';
import { TableCard } from '@/components/shared/table-card';
import { FilterBar } from '@/components/shared/filter-bar';
import { DataList, type ListColumn } from '@/components/shared/data-list';
import { StatusBadge } from '@/components/shared/status-badge';
import {
  BANK_PAGE,
  BankAccessDenied,
  BankBalanceBackground,
  BankPageSkeleton,
  UTILISATION_BAR,
  UTILISATION_TEXT,
  UtilisationBadge,
  accountLabel,
  useBankData,
} from '@/components/bank-balance/page-kit';
import { useAuthorization } from '@/hooks/useAuthorization';
import { getApplicableCcLimitEntry, getEffectiveCcLimitFromEntry } from '@/lib/bank-balance-limit';
import { balanceAt, buildLedgers, formatDay, formatInr, isCashCredit, utilisationLevel } from '@/lib/bank-balance-ledger';
import type { BankAccount, BankExpense } from '@/lib/types';
import { cn } from '@/lib/utils';

interface DpRow {
  id: string;
  account: BankAccount;
  dp: number;
  od: number;
  tod: number;
  limit: number;
  utilised: number;
  available: number;
  percent: number;
  fromDate: string | null;
}

export default function DpUtilizationPage() {
  const { can, isLoading: authLoading } = useAuthorization();
  const canView = !authLoading && can('View', 'Bank Balance.Reports');
  const { accounts, transactions, isLoading, isRefreshing, refresh, loadedAt } = useBankData({ enabled: canView, transactions: true });
  const [includeInactive, setIncludeInactive] = useState(false);

  const ccAccounts = useMemo(
    () => accounts.filter((account) => isCashCredit(account) && (includeInactive || account.status === 'Active')),
    [accounts, includeInactive],
  );
  const ledgers = useMemo(() => buildLedgers<BankAccount, BankExpense>(ccAccounts, transactions), [ccAccounts, transactions]);

  const rows = useMemo<DpRow[]>(() => {
    const today = new Date();
    return ccAccounts.flatMap((account) => {
      const ledger = ledgers.get(account.id);
      if (!ledger) return [];
      const utilised = Math.max(0, balanceAt(ledger, today));
      const entry = getApplicableCcLimitEntry(account, today);
      const limit = getEffectiveCcLimitFromEntry(entry);
      return [
        {
          id: account.id,
          account,
          dp: entry?.amount || 0,
          od: entry?.odAmount || 0,
          tod: entry?.todAmount || 0,
          limit,
          utilised,
          available: Math.max(0, limit - utilised),
          percent: limit > 0 ? (utilised / limit) * 100 : 0,
          fromDate: entry?.fromDate ?? null,
        },
      ];
    });
  }, [ccAccounts, ledgers]);

  const totals = useMemo(() => {
    const limit = rows.reduce((s, r) => s + r.limit, 0);
    const utilised = rows.reduce((s, r) => s + r.utilised, 0);
    return {
      limit,
      utilised,
      available: rows.reduce((s, r) => s + r.available, 0),
      percent: limit > 0 ? (utilised / limit) * 100 : 0,
      critical: rows.filter((r) => r.limit > 0 && utilisationLevel(r.percent) === 'critical').length,
      withoutLimit: rows.filter((r) => r.limit <= 0).length,
    };
  }, [rows]);

  if (authLoading || (isLoading && canView)) return <BankPageSkeleton kpis={4} />;
  if (!canView) return <BankAccessDenied title="DP Utilisation" what="this report" />;

  const columns: Array<ListColumn<DpRow>> = [
    {
      header: 'Account',
      mobile: 'title',
      cell: (row) => (
        <div className="flex min-w-0 items-center gap-2">
          <CreditCard className="h-4 w-4 shrink-0 text-rose-400" />
          <div className="min-w-0">
            <p className="truncate font-medium">
              {accountLabel(row.account)}
              {row.account.status !== 'Active' && <span className="ml-1.5 inline-block align-middle"><StatusBadge status={row.account.status} /></span>}
            </p>
            <p className="truncate text-xs font-normal text-muted-foreground">
              {row.account.bankName} · {row.account.accountNumber}
            </p>
          </div>
        </div>
      ),
    },
    {
      header: 'Level',
      mobile: 'aside',
      cell: (row) => <UtilisationBadge percent={row.percent} hasLimit={row.limit > 0} />,
    },
    { header: 'DP', align: 'right', cell: (row) => <span className="whitespace-nowrap tabular-nums">{row.dp ? formatInr(row.dp) : '—'}</span> },
    { header: 'OD', align: 'right', cell: (row) => <span className="whitespace-nowrap tabular-nums">{row.od ? formatInr(row.od) : '—'}</span> },
    { header: 'TOD', align: 'right', cell: (row) => <span className="whitespace-nowrap tabular-nums">{row.tod ? formatInr(row.tod) : '—'}</span> },
    {
      header: 'Total limit',
      align: 'right',
      cell: (row) => <span className="whitespace-nowrap font-medium tabular-nums">{row.limit ? formatInr(row.limit) : 'No limit'}</span>,
    },
    {
      header: 'Utilised',
      align: 'right',
      cell: (row) => (
        <span className={cn('whitespace-nowrap font-medium tabular-nums', row.limit > 0 && UTILISATION_TEXT[utilisationLevel(row.percent)])}>
          {formatInr(row.utilised)}
        </span>
      ),
    },
    {
      header: 'Available',
      align: 'right',
      cell: (row) => <span className="whitespace-nowrap tabular-nums text-emerald-700">{formatInr(row.available)}</span>,
    },
    {
      header: 'Usage',
      cell: (row) =>
        row.limit > 0 ? (
          <div className="flex min-w-[8rem] items-center gap-2">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className={cn('h-full rounded-full', UTILISATION_BAR[utilisationLevel(row.percent)])}
                style={{ width: `${Math.min(100, row.percent)}%` }}
              />
            </div>
            <span className={cn('w-12 text-right text-xs font-semibold tabular-nums', UTILISATION_TEXT[utilisationLevel(row.percent)])}>
              {row.percent.toFixed(1)}%
            </span>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      header: 'Effective from',
      cell: (row) => <span className="whitespace-nowrap text-muted-foreground">{formatDay(row.fromDate)}</span>,
    },
  ];

  return (
    <>
      <BankBalanceBackground tone="rose" />
      <div className={BANK_PAGE}>
        <PageHeader
          title="DP Utilisation"
          icon={Gauge}
          description={`Cash Credit limits in force today against utilisation · as of ${formatDay(new Date())}${loadedAt ? `, ${format(loadedAt, 'HH:mm')}` : ''}.`}
          backHref="/bank-balance"
          backLabel="Back to dashboard"
          actions={
            <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={isRefreshing}>
              <RefreshCw className={cn('mr-2 h-4 w-4', isRefreshing && 'animate-spin')} />
              Refresh
            </Button>
          }
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Total limit (DP + OD + TOD)"
            value={formatInr(totals.limit)}
            hint={
              totals.withoutLimit
                ? `${totals.withoutLimit} of ${rows.length} account${rows.length === 1 ? '' : 's'} without a limit`
                : `${rows.length} Cash Credit account${rows.length === 1 ? '' : 's'}`
            }
            icon={Landmark}
            tone="violet"
            accent
          />
          <KpiCard
            label="Utilised"
            value={formatInr(totals.utilised)}
            hint={totals.limit > 0 ? `${totals.percent.toFixed(1)}% of total limit` : 'No limit set'}
            icon={Gauge}
            tone={totals.percent >= 90 ? 'rose' : totals.percent >= 70 ? 'amber' : 'blue'}
            accent
          />
          <KpiCard
            label="Available headroom"
            value={formatInr(totals.available)}
            hint="Limit − utilisation, per account"
            icon={TrendingUp}
            tone="emerald"
            accent
          />
          <KpiCard
            label="Accounts over 90%"
            value={totals.critical}
            hint={totals.critical ? 'Critical utilisation' : 'None critical'}
            icon={AlertTriangle}
            tone={totals.critical ? 'rose' : 'emerald'}
            accent
          />
        </div>

        <TableCard
          title="Account-wise DP utilisation"
          description="Limits from the DP log in force today; utilisation from the opening date, internal transfers included."
          count={rows.length}
          noun="account"
          scroll="natural"
          toolbar={
            <FilterBar activeCount={includeInactive ? 1 : 0} onClear={() => setIncludeInactive(false)}>
              <div className="flex h-10 items-center gap-2 rounded-md border px-3">
                <Switch id="dp-inactive" checked={includeInactive} onCheckedChange={setIncludeInactive} />
                <Label htmlFor="dp-inactive" className="text-sm font-normal">
                  Include inactive
                </Label>
              </div>
            </FilterBar>
          }
          footer={
            rows.length > 0 ? (
              <div className="flex flex-wrap gap-x-5 gap-y-1 tabular-nums">
                <span>Limit {formatInr(totals.limit)}</span>
                <span>Utilised {formatInr(totals.utilised)}</span>
                <span>Available {formatInr(totals.available)}</span>
                <span className="font-semibold text-foreground">{totals.percent.toFixed(1)}% overall</span>
              </div>
            ) : undefined
          }
        >
          <div className="p-3 sm:p-0">
            <DataList
              rows={rows}
              columns={columns}
              dense
              frameless
              empty={
                <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
                  <CreditCard className="h-8 w-8 opacity-30" />
                  No Cash Credit accounts found.
                </div>
              }
            />
          </div>
        </TableCard>
      </div>
    </>
  );
}
