'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { endOfDay, format, startOfMonth, subDays } from 'date-fns';
import { Layers, Plus, Search } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Input } from '@/components/ui/input';
import { chartChrome } from '@/components/ui/chart';
import { compactInr, formatInr } from '@/lib/bank-balance-ledger';
import { accruedCcInterest, cashOutlook } from '@/lib/bank-balance-insights';
import { drawnHistory, flowBetween, monthEndPoints, recentMovements, upcomingItems } from '@/lib/bank-balance-dashboard';
import { cn } from '@/lib/utils';
import {
  BankAvatar,
  DashboardHeader,
  Figure,
  NoAccounts,
  Panel,
  PanelLink,
  Ring,
  Segmented,
  UpcomingList,
  UsageBar,
  accountName,
  exportPositions,
  headlineInr,
  maskedNumber,
  narration,
  niceTicks,
  plural,
  useChartColors,
  useDashboard,
  type BankDashboardModel,
  type Position,
} from './kit';

type Period = '30d' | '90d' | '12m';
const PERIODS: ReadonlyArray<{ value: Period; label: string }> = [
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '12m', label: '12 months' },
];
const DAYS: Record<Period, number> = { '30d': 30, '90d': 90, '12m': 365 };

interface BarPoint {
  day: Date;
  label: string;
  title: string;
  /** Cash Credit: drawn and the rest of the limit. Current account: the closing balance in `drawn`. */
  drawn: number;
  undrawn: number;
  limit: number;
}

function RailItem({ row, selected, onSelect }: { row: Position; selected: boolean; onSelect: () => void }) {
  const { account } = row;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors',
        selected ? 'bg-muted' : 'hover:bg-muted/60',
        account.status !== 'Active' && 'opacity-60',
      )}
    >
      <BankAvatar account={account} tone="solid" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{account.bankName || accountName(account)}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {accountName(account)} {maskedNumber(account)}
        </span>
      </span>
      <span className="shrink-0 text-right">
        {row.cc ? (
          <>
            <span className="block whitespace-nowrap text-sm font-semibold tabular-nums text-foreground">{compactInr(row.limit)}</span>
            <UsageBar pct={row.pct} className="ml-auto mt-1 w-16" />
            <span className="mt-0.5 block text-[11px] tabular-nums text-muted-foreground">{row.pct.toFixed(0)}%</span>
          </>
        ) : (
          <>
            <span className={cn('block whitespace-nowrap text-sm font-semibold tabular-nums', row.figure < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-foreground')}>
              {headlineInr(row.figure)}
            </span>
            <span className="block text-[11px] text-muted-foreground">balance</span>
          </>
        )}
      </span>
    </button>
  );
}

function DrawnBars({ points, balance }: { points: BarPoint[]; balance: boolean }) {
  const colours = useChartColors();
  const hasData = points.some((point) => point.drawn !== 0 || point.limit !== 0);
  const tops = points.map((point) => (balance ? point.drawn : Math.max(point.drawn, point.limit)));
  const yTicks = niceTicks(Math.min(0, ...tops), Math.max(0, ...tops), 3);
  if (!hasData) {
    return (
      <div className="flex h-[220px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        {balance ? 'No balance recorded in this period.' : 'No Cash Credit limit or drawing in this period.'}
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barCategoryGap={points.length > 60 ? 1 : '18%'}>
        <CartesianGrid stroke={chartChrome.grid} vertical={false} />
        <XAxis dataKey="label" stroke={chartChrome.axis} fontSize={11} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={36} tickMargin={6} />
        <YAxis
          stroke={chartChrome.axis}
          fontSize={11}
          tickLine={false}
          axisLine={false}
          width={68}
          domain={[yTicks[0], yTicks[yTicks.length - 1]]}
          ticks={yTicks}
          interval={0}
          tickFormatter={(value) => compactInr(Number(value))}
        />
        <Tooltip
          cursor={chartChrome.cursor}
          content={({ active, payload }) => {
            const point = active ? (payload?.[0]?.payload as BarPoint | undefined) : undefined;
            if (!point) return null;
            const over = !balance && point.limit > 0 && point.drawn > point.limit;
            return (
              <div style={chartChrome.tooltip.contentStyle} className="min-w-[180px] px-3 py-2 shadow-md">
                <p className="mb-1 text-xs font-semibold">{point.title}</p>
                {balance ? (
                  <Row label="Closing balance" value={formatInr(point.drawn, 0)} />
                ) : (
                  <>
                    <Row label="Drawn" value={formatInr(point.drawn, 0)} colour={colours.drawn} />
                    <Row label={over ? 'Over limit by' : 'Undrawn'} value={formatInr(over ? point.drawn - point.limit : point.undrawn, 0)} colour={over ? undefined : colours.track} />
                    <Row label="Limit" value={formatInr(point.limit, 0)} />
                    <Row label="Drawn" value={point.limit > 0 ? `${((point.drawn / point.limit) * 100).toFixed(1)}%` : '—'} />
                  </>
                )}
              </div>
            );
          }}
        />
        <Bar dataKey="drawn" stackId="limit" fill={colours.drawn} isAnimationActive={false} radius={balance ? [3, 3, 0, 0] : 0} />
        {!balance && <Bar dataKey="undrawn" stackId="limit" fill={colours.track} radius={[3, 3, 0, 0]} isAnimationActive={false} />}
      </BarChart>
    </ResponsiveContainer>
  );
}

function RingFigure({ pct, label }: { pct: number; label: string }) {
  return (
    <Panel bodyClassName="flex items-center gap-4">
      <Ring pct={pct} />
      <div className="min-w-0">
        <p className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">{pct.toFixed(0)}%</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
      </div>
    </Panel>
  );
}

function Row({ label, value, colour }: { label: string; value: string; colour?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-xs">
      <span className="inline-flex items-center gap-1.5 opacity-80">
        {colour && <span aria-hidden className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: colour }} />}
        {label}
      </span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function Legend({ items }: { items: Array<{ label: string; colour: string }> }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: item.colour }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

/**
 * Account workspace: every account down the left, all of them or one picked at a time on the
 * right — its figures, drawn against the limit (or the balance) over the period, what is coming
 * up and the latest movements.
 */
export function AccountsDesign({ model }: { model: BankDashboardModel }) {
  const { rows, cc, current, inactiveRows, totals, ledgers } = useDashboard(model);
  const { now, limitOn, interestMtd } = model;
  const colours = useChartColors();
  const [selectedId, setSelectedId] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [period, setPeriod] = useState<Period>('30d');

  const allRows = useMemo(() => [...rows, ...inactiveRows], [rows, inactiveRows]);
  const selected = selectedId === 'all' ? null : allRows.find((row) => row.account.id === selectedId) ?? null;
  const scope = useMemo(() => {
    if (!selected) return ledgers;
    const ledger = model.ledgers.get(selected.account.id);
    return ledger ? [ledger] : [];
  }, [selected, ledgers, model.ledgers]);
  const balanceView = Boolean(selected && !selected.cc);

  const matches = (row: Position) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const { account } = row;
    return [account.bankName, account.shortName, account.branch, String(account.accountNumber ?? '').slice(-4)]
      .some((value) => (value || '').toLowerCase().includes(q));
  };

  const days = DAYS[period];
  const from = useMemo(() => subDays(now, days - 1), [now, days]);

  const bars = useMemo<BarPoint[]>(() => {
    const daily: BarPoint[] = balanceView
      ? cashOutlook(scope, limitOn, from, days).points.map((point) => ({
          day: point.day,
          label: format(point.day, 'd MMM'),
          title: format(point.day, 'EEE, d MMM yyyy'),
          drawn: point.available,
          undrawn: 0,
          limit: 0,
        }))
      : drawnHistory(scope, limitOn, from, now).map((point) => ({
          day: point.day,
          label: format(point.day, 'd MMM'),
          title: format(point.day, 'EEE, d MMM yyyy'),
          drawn: point.drawn,
          undrawn: Math.max(0, point.limit - point.drawn),
          limit: point.limit,
        }));
    if (period !== '12m') return daily;
    return monthEndPoints(daily).map((point) => ({
      ...point,
      label: format(point.day, 'MMM yy'),
      title: `${format(point.day, 'MMMM yyyy')}, at ${format(point.day, 'd MMM')}`,
    }));
  }, [scope, limitOn, from, now, days, period, balanceView]);

  const flow = useMemo(() => flowBetween(scope, from, now), [scope, from, now]);
  const interest = useMemo(
    () => (selected ? (selected.cc ? accruedCcInterest(scope, startOfMonth(now), now) : 0) : interestMtd),
    [selected, scope, now, interestMtd],
  );
  const upcoming = useMemo(
    () => upcomingItems({ ledgers: scope, nameOf: accountName, limitOn, today: now, horizonDays: 45, interestAccrued: interest }),
    [scope, limitOn, now, interest],
  );
  const movements = useMemo(() => recentMovements(scope, endOfDay(now), 8), [scope, now]);

  if (rows.length === 0 && inactiveRows.length === 0) {
    return (
      <div className="relative w-full space-y-5 px-4 py-4 sm:px-6 lg:px-8">
        <DashboardHeader model={model} onExport={() => exportPositions(model, allRows)} />
        <NoAccounts addHref={model.links.addAccount} />
      </div>
    );
  }

  const banks = new Set(rows.map((row) => (row.account.bankName || '').trim().toLowerCase()).filter(Boolean)).size;
  const periodLabel = `${format(from, 'd MMM')} to ${format(now, 'd MMM')}`;

  const railGroups: Array<{ title: string; rows: Position[] }> = [
    { title: 'Cash credit', rows: cc.filter(matches) },
    { title: 'Current', rows: current.filter(matches) },
    { title: 'Inactive', rows: inactiveRows.filter(matches) },
  ].filter((group) => group.rows.length > 0);

  return (
    <div className="relative w-full space-y-5 px-4 py-4 sm:px-6 lg:px-8">
      <DashboardHeader model={model} onExport={() => exportPositions(model, allRows)} />

      {/* Phone and tablet: the accounts as a strip of chips instead of the rail. */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 lg:hidden">
        {[{ id: 'all', label: 'All accounts', value: compactInr(totals.ccHeadroom) }, ...allRows.map((row) => ({
          id: row.account.id,
          label: accountName(row.account),
          value: row.cc ? `${row.pct.toFixed(0)}%` : headlineInr(row.figure),
        }))].map((chip) => (
          <button
            key={chip.id}
            type="button"
            aria-pressed={selectedId === chip.id}
            onClick={() => setSelectedId(chip.id)}
            className={cn(
              'shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium',
              selectedId === chip.id ? 'border-foreground bg-foreground text-background' : 'bg-card text-foreground',
            )}
          >
            {chip.label} <span className="ml-1 tabular-nums opacity-70">{chip.value}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]">
        <aside className="hidden min-w-0 self-start rounded-xl border bg-card p-3 shadow-sm lg:block">
          <label className="relative block">
            <span className="sr-only">Search accounts</span>
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search accounts" className="h-9 pl-9" />
          </label>
          <button
            type="button"
            onClick={() => setSelectedId('all')}
            aria-pressed={selectedId === 'all'}
            className={cn('mt-3 flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left', selectedId === 'all' ? 'bg-teal-50 dark:bg-teal-950/40' : 'hover:bg-muted/60')}
          >
            <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-600 text-white">
              <Layers className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-foreground">All accounts</span>
              <span className="block truncate text-xs text-muted-foreground">
                {plural(cc.length, 'cash credit', 'cash credit')}, {plural(current.length, 'current', 'current')}
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block text-sm font-semibold tabular-nums text-foreground">{compactInr(totals.ccHeadroom)}</span>
              <span className="block text-[11px] text-muted-foreground">headroom</span>
            </span>
          </button>
          {railGroups.map((group) => (
            <div key={group.title} className="mt-3">
              <p className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">{group.title}</p>
              <div className="space-y-0.5">
                {group.rows.map((row) => (
                  <RailItem key={row.account.id} row={row} selected={selectedId === row.account.id} onSelect={() => setSelectedId(row.account.id)} />
                ))}
              </div>
            </div>
          ))}
          {railGroups.length === 0 && <p className="px-2.5 py-4 text-sm text-muted-foreground">No account matches “{query}”.</p>}
          {model.links.addAccount && (
            <Link
              href={model.links.addAccount}
              className="mt-3 flex items-center justify-center gap-1.5 rounded-lg border border-dashed py-2 text-sm font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            >
              <Plus aria-hidden className="h-4 w-4" />
              Add account
            </Link>
          )}
        </aside>

        <div className="min-w-0 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-xl font-semibold tracking-tight text-foreground">{selected ? selected.account.bankName || accountName(selected.account) : 'All accounts'}</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {selected
                  ? [`${accountName(selected.account)} ${maskedNumber(selected.account)}`, selected.account.branch, selected.account.status !== 'Active' ? 'Inactive' : '']
                      .filter(Boolean)
                      .join(' · ')
                  : `${plural(cc.length, 'cash-credit limit')} and ${plural(current.length, 'current account')} across ${plural(banks, 'bank')}`}
              </p>
            </div>
            <Segmented label="Period" value={period} options={PERIODS} onChange={setPeriod} />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-4">
            {!selected ? (
              <>
                <Panel>
                  <Figure label="Cash in current accounts" value={formatInr(totals.currentBalance)} hint={plural(totals.currentCount, 'account')} />
                </Panel>
                <Panel>
                  <Figure label="Drawn against cash credit" value={headlineInr(totals.ccDrawn)} title={formatInr(totals.ccDrawn)} hint={`of ${compactInr(totals.ccLimit)} sanctioned`} />
                </Panel>
                <Panel>
                  <Figure label="Undrawn headroom" value={headlineInr(totals.ccHeadroom)} title={formatInr(totals.ccHeadroom)} tone="teal" hint={`Across ${plural(totals.ccCount, 'cash-credit account')}`} />
                </Panel>
                <RingFigure pct={totals.drawnPct} label="of combined limit drawn" />
              </>
            ) : selected.cc ? (
              <>
                <Panel>
                  <Figure label="Sanctioned limit" value={headlineInr(selected.limit)} title={formatInr(selected.limit)} hint="DP + OD + TOD in force today" />
                </Panel>
                <Panel>
                  <Figure label="Drawn" value={headlineInr(selected.drawn)} title={formatInr(selected.drawn)} hint={selected.limit > 0 ? `${selected.pct.toFixed(1)}% of the limit` : 'No limit in force'} />
                </Panel>
                <Panel>
                  <Figure label="Available" value={headlineInr(selected.available)} title={formatInr(selected.available)} tone={selected.available < 0 ? 'red' : 'teal'} hint={selected.available < 0 ? 'Over the limit' : 'Left to draw'} />
                </Panel>
                <RingFigure pct={selected.pct} label="of the limit drawn" />
              </>
            ) : (
              <>
                <Panel>
                  <Figure label="Balance" value={formatInr(selected.figure)} tone={selected.figure < 0 ? 'red' : undefined} hint={selected.figure < 0 ? 'Overdrawn' : 'Current account'} />
                </Panel>
                <Panel>
                  <Figure label="Money in" value={headlineInr(flow.receipts)} title={formatInr(flow.receipts)} tone="green" hint={`${plural(flow.receiptCount, 'receipt')}, ${periodLabel}`} />
                </Panel>
                <Panel>
                  <Figure label="Money out" value={headlineInr(flow.payments)} title={formatInr(flow.payments)} hint={`${plural(flow.paymentCount, 'payment')}, ${periodLabel}`} />
                </Panel>
                <Panel>
                  <Figure label="Transfers" value={headlineInr(flow.transfers)} title={formatInr(flow.transfers)} hint={`Between own accounts, ${periodLabel}`} />
                </Panel>
              </>
            )}
          </div>

          <Panel
            title={balanceView ? 'Closing balance' : selected ? 'Drawn against the limit' : 'Drawn against combined limit'}
            action={<span className="text-xs text-muted-foreground">{period === '12m' ? `Month ends, ${format(from, 'MMM yyyy')} to ${format(now, 'MMM yyyy')}` : `Daily, ${periodLabel}`}</span>}
          >
            <DrawnBars points={bars} balance={balanceView} />
            {!balanceView && <Legend items={[{ label: 'Drawn', colour: colours.drawn }, { label: 'Undrawn limit', colour: colours.track }]} />}
          </Panel>

          <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)]">
            <Panel title="Coming up" action={<PanelLink href={model.links.cheques}>Cheques</PanelLink>}>
              <UpcomingList items={upcoming} today={now} />
            </Panel>

            <Panel title="Recent movements" action={<PanelLink href={model.links.ledger}>Open ledger</PanelLink>} bodyClassName="px-0 sm:px-0">
              {movements.length === 0 ? (
                <p className="px-4 py-2 text-sm text-muted-foreground sm:px-5">No entries yet.</p>
              ) : (
                <ul className="divide-y divide-border/60">
                  {movements.map(({ txn, at, account }) => {
                    const credit = txn.type === 'Credit';
                    return (
                      <li key={txn.id} className="grid grid-cols-[3.25rem_minmax(0,1fr)_auto] items-baseline gap-x-3 px-4 py-2.5 text-sm sm:grid-cols-[3.5rem_7rem_minmax(0,1fr)_auto] sm:px-5">
                        <span className="tabular-nums text-muted-foreground">{format(at, 'd MMM')}</span>
                        <span className="hidden truncate text-muted-foreground sm:block">{accountName(account)}</span>
                        <span className="min-w-0">
                          <span className="block truncate text-foreground">{narration(txn)}</span>
                          <span className="block truncate text-xs text-muted-foreground sm:hidden">{accountName(account)}</span>
                        </span>
                        <span className={cn('text-right font-semibold tabular-nums', credit && !txn.isContra ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground')}>
                          {credit ? '+' : '−'}
                          {formatInr(Number(txn.amount) || 0, 0)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}
