'use client';
export const dynamic = 'force-dynamic';

/**
 * Bank Position — every account's closing figure today, from the ledger engine.
 *
 * A current account balance is money held; Cash Credit utilisation is money owed. The old grand
 * total added the two together. Here they stay apart, and the one combined figure is the net
 * position: current account balances plus Cash Credit headroom (limit − utilisation) — the
 * dashboard's "Total Consolidated Balance", computed the same way over the same active accounts.
 */

import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Building2, CreditCard, Gauge, Landmark, RefreshCw, Scale, TrendingUp, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
  UTILISATION_TEXT,
  UtilisationBadge,
  accountLabel,
  useBankData,
} from '@/components/bank-balance/page-kit';
import { useAuthorization } from '@/hooks/useAuthorization';
import { getApplicableCcLimit } from '@/lib/bank-balance-limit';
import { balanceAt, buildLedgers, formatDay, formatInr, isCashCredit, utilisationLevel } from '@/lib/bank-balance-ledger';
import type { BankAccount, BankExpense } from '@/lib/types';
import { cn } from '@/lib/utils';

interface PositionRow {
  id: string;
  account: BankAccount;
  cc: boolean;
  /** CC: utilisation. CA: balance. */
  figure: number;
  limit: number;
  /** CC: limit − utilisation, not below 0. CA: the balance. */
  available: number;
  percent: number;
}

export default function BankPositionReportPage() {
  const { can, isLoading: authLoading } = useAuthorization();
  const canView = !authLoading && can('View', 'Bank Balance.Reports');
  const { accounts, transactions, isLoading, isRefreshing, refresh, loadedAt } = useBankData({ enabled: canView, transactions: true });
  const [includeInactive, setIncludeInactive] = useState(false);

  const ledgers = useMemo(() => buildLedgers<BankAccount, BankExpense>(accounts, transactions), [accounts, transactions]);

  const rows = useMemo<PositionRow[]>(() => {
    const today = new Date();
    return accounts
      .filter((account) => includeInactive || account.status === 'Active')
      .flatMap((account) => {
        const ledger = ledgers.get(account.id);
        if (!ledger) return [];
        const cc = isCashCredit(account);
        const figure = balanceAt(ledger, today);
        const limit = cc ? getApplicableCcLimit(account, today) : 0;
        const utilised = Math.max(0, figure);
        return [
          {
            id: account.id,
            account,
            cc,
            figure,
            limit,
            available: cc ? Math.max(0, limit - utilised) : figure,
            percent: cc && limit > 0 ? (utilised / limit) * 100 : 0,
          },
        ];
      })
      .sort((a, b) => Number(b.cc) - Number(a.cc) || accountLabel(a.account).localeCompare(accountLabel(b.account)));
  }, [accounts, ledgers, includeInactive]);

  const totals = useMemo(() => {
    const ca = rows.filter((r) => !r.cc);
    const cc = rows.filter((r) => r.cc);
    const caBalance = ca.reduce((s, r) => s + r.figure, 0);
    const ccLimit = cc.reduce((s, r) => s + r.limit, 0);
    const ccUtilised = cc.reduce((s, r) => s + Math.max(0, r.figure), 0);
    const ccAvailable = cc.reduce((s, r) => s + r.available, 0);
    // The dashboard hero: CA balance + (limit − utilisation) per CC account, unclamped.
    const netPosition = caBalance + cc.reduce((s, r) => s + (r.limit - r.figure), 0);
    return {
      caCount: ca.length,
      ccCount: cc.length,
      caBalance,
      ccLimit,
      ccUtilised,
      ccAvailable,
      netPosition,
      percent: ccLimit > 0 ? (ccUtilised / ccLimit) * 100 : 0,
    };
  }, [rows]);

  if (authLoading || (isLoading && canView)) return <BankPageSkeleton kpis={4} />;
  if (!canView) return <BankAccessDenied title="Bank Position" what="this report" />;

  const columns: Array<ListColumn<PositionRow>> = [
    {
      header: 'Account',
      mobile: 'title',
      cell: (row) => (
        <div className="flex min-w-0 items-center gap-2">
          {row.cc ? <CreditCard className="h-4 w-4 shrink-0 text-violet-500" /> : <Building2 className="h-4 w-4 shrink-0 text-sky-500" />}
          <div className="min-w-0">
            <p className="truncate font-medium">{accountLabel(row.account)}</p>
            <p className="truncate text-xs font-normal text-muted-foreground">
              {row.account.bankName} · {row.account.accountNumber}
            </p>
          </div>
        </div>
      ),
    },
    {
      header: 'Type',
      mobile: 'aside',
      cell: (row) => (
        <div className="flex flex-wrap items-center justify-end gap-1 sm:justify-start">
          <Badge variant={row.cc ? 'progress' : 'info'} className="whitespace-nowrap">
            {row.cc ? 'Cash Credit' : 'Current'}
          </Badge>
          {row.account.status !== 'Active' && <StatusBadge status={row.account.status} />}
        </div>
      ),
    },
    {
      header: 'Balance / Utilisation',
      align: 'right',
      cell: (row) => (
        <span className={cn('whitespace-nowrap font-medium tabular-nums', row.figure < 0 && 'text-rose-600')}>
          {formatInr(row.figure)}
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">{row.cc ? 'utilised' : 'balance'}</span>
        </span>
      ),
    },
    {
      header: 'Limit',
      align: 'right',
      cell: (row) => <span className="whitespace-nowrap tabular-nums">{row.cc ? (row.limit ? formatInr(row.limit) : 'No limit') : '—'}</span>,
    },
    {
      header: 'Available',
      align: 'right',
      cell: (row) => <span className="whitespace-nowrap font-medium tabular-nums text-emerald-700">{formatInr(row.available)}</span>,
    },
    {
      header: 'Utilisation %',
      align: 'right',
      cell: (row) =>
        row.cc ? (
          <span className="inline-flex items-center gap-2 whitespace-nowrap">
            {row.limit > 0 && (
              <span className={cn('font-semibold tabular-nums', UTILISATION_TEXT[utilisationLevel(row.percent)])}>{row.percent.toFixed(1)}%</span>
            )}
            <UtilisationBadge percent={row.percent} hasLimit={row.limit > 0} />
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <>
      <BankBalanceBackground tone="indigo" />
      <div className={BANK_PAGE}>
        <PageHeader
          title="Bank Position"
          icon={Landmark}
          description={`Closing position of every account as of ${formatDay(new Date())}${loadedAt ? ` · updated ${format(loadedAt, 'HH:mm:ss')}` : ''}.`}
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
            label="Current account balance"
            value={formatInr(totals.caBalance)}
            hint={`${totals.caCount} current account${totals.caCount === 1 ? '' : 's'}`}
            icon={Wallet}
            tone="cyan"
            accent
          />
          <KpiCard
            label="CC utilisation"
            value={formatInr(totals.ccUtilised)}
            hint={totals.ccLimit > 0 ? `${totals.percent.toFixed(1)}% of ${formatInr(totals.ccLimit)} limit` : `${totals.ccCount} Cash Credit account${totals.ccCount === 1 ? '' : 's'}`}
            icon={Gauge}
            tone={totals.percent >= 90 ? 'rose' : totals.percent >= 70 ? 'amber' : 'violet'}
            accent
          />
          <KpiCard
            label="CC available"
            value={formatInr(totals.ccAvailable)}
            hint="Limit − utilisation, per account"
            icon={TrendingUp}
            tone="emerald"
            accent
          />
          <KpiCard
            label="Net position"
            value={formatInr(totals.netPosition)}
            hint={includeInactive ? 'CA balance + CC limit − utilisation (incl. inactive)' : 'CA balance + CC limit − utilisation, as the dashboard'}
            icon={Scale}
            tone="indigo"
            accent
          />
        </div>

        <TableCard
          title="Account-wise position"
          description="Cash Credit shows utilisation (drawn against the limit); current accounts show balance. The two are never added together."
          count={rows.length}
          noun="account"
          scroll="natural"
          toolbar={
            <FilterBar activeCount={includeInactive ? 1 : 0} onClear={() => setIncludeInactive(false)}>
              <div className="flex h-10 items-center gap-2 rounded-md border px-3">
                <Switch id="position-inactive" checked={includeInactive} onCheckedChange={setIncludeInactive} />
                <Label htmlFor="position-inactive" className="text-sm font-normal">
                  Include inactive
                </Label>
              </div>
            </FilterBar>
          }
          footer={
            rows.length > 0 ? (
              <div className="flex flex-wrap gap-x-5 gap-y-1 tabular-nums">
                <span>CA balance {formatInr(totals.caBalance)}</span>
                <span>CC utilised {formatInr(totals.ccUtilised)}</span>
                <span>CC available {formatInr(totals.ccAvailable)}</span>
                <span className="font-semibold text-foreground">Net position {formatInr(totals.netPosition)}</span>
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
                  <Building2 className="h-8 w-8 opacity-30" />
                  No bank accounts found.
                </div>
              }
            />
          </div>
        </TableCard>
      </div>
    </>
  );
}
