'use client';

import Link from 'next/link';
import { useId, useMemo, useState } from 'react';
import { addDays, addMonths, differenceInCalendarDays, format, startOfMonth, subMonths } from 'date-fns';
import { Plus } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { chartChrome } from '@/components/ui/chart';
import { compactInr, formatInr } from '@/lib/bank-balance-ledger';
import { cashOutlook } from '@/lib/bank-balance-insights';
import { flowBetween, upcomingItems } from '@/lib/bank-balance-dashboard';
import { cn } from '@/lib/utils';
import {
  AllClear,
  AttentionList,
  BankAvatar,
  DashboardHeader,
  NoAccounts,
  Panel,
  PanelLink,
  Segmented,
  UpcomingList,
  UsageBar,
  accountName,
  exportPositions,
  headlineInr,
  maskedNumber,
  niceTicks,
  useChartColors,
  useDashboard,
  type BankDashboardModel,
  type Position,
} from './kit';

type Range = '1M' | '3M' | '6M' | '1Y';
const RANGES: ReadonlyArray<{ value: Range; label: string }> = [
  { value: '1M', label: '1M' },
  { value: '3M', label: '3M' },
  { value: '6M', label: '6M' },
  { value: '1Y', label: '1Y' },
];
const MONTHS: Record<Range, number> = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12 };

interface TrendPoint {
  t: number;
  available: number;
}

/** Ticks on the time axis: weekly or fortnightly for short spans, month starts for long ones. */
function timeTicks(from: Date, to: Date, range: Range): number[] {
  if (range === '1M' || range === '3M') {
    const step = range === '1M' ? 7 : 14;
    const ticks: number[] = [];
    for (let day = from; day <= to; day = addDays(day, step)) ticks.push(day.getTime());
    return ticks;
  }
  const ticks: number[] = [];
  const step = range === '1Y' ? 2 : 1;
  for (let month = startOfMonth(addMonths(from, 1)); month <= to; month = addMonths(month, step)) ticks.push(month.getTime());
  return ticks;
}

/** The pill on the latest point: its date and figure. */
function EndLabel({
  viewBox,
  text,
  bg,
  fg,
}: {
  viewBox?: { x?: number; y?: number; width?: number; height?: number };
  text: string;
  bg: string;
  fg: string;
}) {
  if (!viewBox || viewBox.x === undefined || viewBox.y === undefined) return null;
  const cx = viewBox.x + (viewBox.width ?? 0) / 2;
  const cy = viewBox.y + (viewBox.height ?? 0) / 2;
  const width = text.length * 6.6 + 16;
  const height = 22;
  const x = cx - 12 - width;
  const y = cy - height - 6;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={6} fill={bg} />
      <text x={x + width / 2} y={y + height / 2} dominantBaseline="central" textAnchor="middle" fontSize={11} fontWeight={600} fill={fg}>
        {text}
      </text>
    </g>
  );
}

function AvailableTrend({ points, range }: { points: TrendPoint[]; range: Range }) {
  const colours = useChartColors();
  const gradientId = `bbd-trend-${useId().replace(/:/g, '')}`;
  if (points.length < 2) {
    return <div className="flex h-[260px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">No history to draw yet.</div>;
  }
  const values = points.map((point) => point.available);
  // Zoomed to the data on round ticks, so a few crore of movement on a large balance still shows.
  const yTicks = niceTicks(Math.min(...values), Math.max(...values), 4);
  const domain: [number, number] = [yTicks[0], yTicks[yTicks.length - 1]];
  const first = new Date(points[0].t);
  const last = points[points.length - 1];
  const long = range === '6M' || range === '1Y';
  const tickFormat = (t: number) => {
    const day = new Date(t);
    if (!long) return format(day, 'd MMM');
    return day.getMonth() === 0 ? format(day, 'MMM yy') : format(day, 'MMM');
  };

  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={points} margin={{ top: 34, right: 14, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colours.line} stopOpacity={0.18} />
            <stop offset="100%" stopColor={colours.line} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={chartChrome.grid} vertical={false} />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={['dataMin', 'dataMax']}
          ticks={timeTicks(first, new Date(last.t), range)}
          tickFormatter={tickFormat}
          stroke={chartChrome.axis}
          fontSize={11}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
        />
        <YAxis
          domain={domain}
          ticks={yTicks}
          interval={0}
          tickFormatter={(value) => compactInr(Number(value))}
          stroke={chartChrome.axis}
          fontSize={11}
          tickLine={false}
          axisLine={false}
          width={68}
        />
        <Tooltip
          cursor={{ stroke: chartChrome.axis, strokeDasharray: '3 3' }}
          content={({ active, payload }) => {
            const point = active ? (payload?.[0]?.payload as TrendPoint | undefined) : undefined;
            if (!point) return null;
            return (
              <div style={chartChrome.tooltip.contentStyle} className="px-3 py-2 shadow-md">
                <p className="text-xs font-semibold">{format(point.t, 'EEE, d MMM yyyy')}</p>
                <p className="mt-0.5 flex items-center justify-between gap-4 text-xs">
                  <span className="opacity-80">Total available</span>
                  <span className="font-semibold tabular-nums">{formatInr(point.available, 0)}</span>
                </p>
              </div>
            );
          }}
        />
        <Area
          type="monotone"
          dataKey="available"
          stroke={colours.line}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          dot={false}
          activeDot={{ r: 4, stroke: chartChrome.surface, strokeWidth: 2 }}
          isAnimationActive={false}
        />
        <ReferenceDot
          x={last.t}
          y={last.available}
          r={5}
          fill={colours.line}
          stroke={chartChrome.surface}
          strokeWidth={2}
          ifOverflow="visible"
          label={<EndLabel text={`${format(last.t, 'd MMM')} ${compactInr(last.available)}`} bg={colours.pillBg} fg={colours.pillText} />}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function Chip({ dot, label, value }: { dot: string; label: string; value: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs text-foreground">
      <span aria-hidden className={cn('h-2 w-2 shrink-0 rounded-full', dot)} />
      <span className="truncate">{label}</span>
      <span className="shrink-0 tabular-nums text-muted-foreground">{value}</span>
    </span>
  );
}

function AccountRow({ row, inactive }: { row: Position; inactive?: boolean }) {
  const { account } = row;
  const subline = [`${accountName(account)} ${maskedNumber(account)}`, account.branch || 'Branch not recorded'].join(' ');
  return (
    <li className={cn('grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-3 sm:grid-cols-[auto_minmax(0,1.2fr)_minmax(0,1fr)_auto] sm:gap-x-5', inactive && 'opacity-60')}>
      <BankAvatar account={account} />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{account.bankName || accountName(account)}</p>
        <p className="truncate text-xs text-muted-foreground">{subline}</p>
      </div>
      <div className="col-span-3 col-start-1 row-start-2 min-w-0 pl-12 sm:col-span-1 sm:col-start-3 sm:row-start-1 sm:pl-0">
        {row.cc ? (
          <>
            <UsageBar pct={row.pct} />
            <p className="mt-1.5 text-xs text-muted-foreground">
              {row.limit > 0 ? `${row.pct.toFixed(0)}% of ${compactInr(row.limit)} used` : 'No limit in force'}
            </p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground sm:text-center">{inactive ? 'Inactive' : 'Current account'}</p>
        )}
      </div>
      <div className="text-right">
        <p className={cn('text-sm font-semibold tabular-nums', row.available < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-foreground')}>
          {formatInr(row.available, row.cc ? 0 : 2)}
        </p>
        <p className="text-xs text-muted-foreground">{row.cc ? 'available' : 'balance'}</p>
      </div>
    </li>
  );
}

function AccountGroup({ title, rows, inactive }: { title: string; rows: Position[]; inactive?: boolean }) {
  if (rows.length === 0) return null;
  return (
    <div className="border-t pt-3 first:border-t-0 first:pt-0">
      <p className="text-xs text-muted-foreground">
        {title} <span className="ml-1 tabular-nums">{rows.length}</span>
      </p>
      <ul className="divide-y divide-border/50">
        {rows.map((row) => (
          <AccountRow key={row.account.id} row={row} inactive={inactive} />
        ))}
      </ul>
    </div>
  );
}

/**
 * Overview: one headline figure — everything spendable — with its trend, then the accounts as a
 * list and, beside them, the month so far, what is coming up and the checks.
 */
export function OverviewDesign({ model }: { model: BankDashboardModel }) {
  const [range, setRange] = useState<Range>('1Y');
  const { rows, cc, current, inactiveRows, totals, ledgers } = useDashboard(model);
  const { now, limitOn, interestMtd } = model;

  const trend = useMemo<TrendPoint[]>(() => {
    const from = subMonths(now, MONTHS[range]);
    const days = differenceInCalendarDays(now, from) + 1;
    return cashOutlook(ledgers, limitOn, from, days).points.map((point) => ({ t: point.day.getTime(), available: point.available }));
  }, [ledgers, limitOn, now, range]);

  const month = useMemo(() => flowBetween(ledgers, startOfMonth(now), now), [ledgers, now]);
  const upcoming = useMemo(
    () => upcomingItems({ ledgers, nameOf: accountName, limitOn, today: now, horizonDays: 45, interestAccrued: interestMtd }),
    [ledgers, limitOn, now, interestMtd],
  );

  const from = subMonths(now, MONTHS[range]);

  return (
    <div className="relative w-full space-y-6 px-4 py-4 sm:px-6 lg:px-8">
      <DashboardHeader model={model} onExport={() => exportPositions(model, [...rows, ...inactiveRows])} />

      {rows.length === 0 ? (
        <NoAccounts addHref={model.links.addAccount} />
      ) : (
        <>
          <section className="min-w-0">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">Total available</p>
                <p className="mt-1 break-words text-4xl font-semibold tabular-nums tracking-tight text-foreground sm:text-5xl">
                  {formatInr(totals.available, 0)}
                </p>
              </div>
              <Segmented label="Trend period" value={range} options={RANGES} onChange={setRange} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Chip dot="bg-slate-900 dark:bg-slate-200" label="Cash in current accounts" value={headlineInr(totals.currentBalance)} />
              <Chip dot="bg-teal-600 dark:bg-teal-400" label="Undrawn cash credit" value={headlineInr(totals.ccHeadroom)} />
              <Chip dot="bg-slate-300 dark:bg-slate-600" label="Drawn" value={`${headlineInr(totals.ccDrawn)}, ${totals.drawnPct.toFixed(0)}%`} />
            </div>
            <div className="mt-4">
              <AvailableTrend points={trend} range={range} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground sm:pl-[68px]">
              Total available at each day’s close, {format(from, 'd MMM yyyy')} to {format(now, 'd MMM yyyy')}: current-account balances plus
              undrawn cash credit, from the ledger. Accounts count from their opening date.
            </p>
          </section>

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <section className="min-w-0">
              <div className="flex items-center justify-between gap-3 border-b pb-3">
                <h2 className="text-base font-semibold text-foreground">
                  Accounts <span className="ml-1 font-normal tabular-nums text-muted-foreground">{rows.length}</span>
                </h2>
                {model.links.addAccount && (
                  <Link href={model.links.addAccount} className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground hover:underline">
                    <Plus aria-hidden className="h-4 w-4" />
                    Add account
                  </Link>
                )}
              </div>
              <div className="space-y-3 pt-3">
                <AccountGroup title="Cash credit" rows={cc} />
                <AccountGroup title="Current" rows={current} />
                <AccountGroup title="Inactive" rows={inactiveRows} inactive />
              </div>
            </section>

            <aside className="min-w-0 space-y-4">
              <Panel title={format(now, 'MMMM')} action={<PanelLink href={model.links.ledger}>Ledger</PanelLink>}>
                <dl className="divide-y divide-border/60 text-sm">
                  {[
                    { label: 'Money in', value: formatInr(month.receipts, 0), tone: 'text-emerald-600 dark:text-emerald-400' },
                    { label: 'Money out', value: formatInr(month.payments, 0) },
                    { label: 'Net', value: `${month.net < 0 ? '−' : ''}${formatInr(Math.abs(month.net), 0)}` },
                    { label: 'Interest accrued, est.', value: formatInr(interestMtd, 0), href: model.links.interest },
                  ].map((line) => (
                    <div key={line.label} className="flex items-center justify-between gap-3 py-2.5 first:pt-1 last:pb-0">
                      <dt className="text-muted-foreground">
                        {line.href ? (
                          <Link href={line.href} className="hover:underline">
                            {line.label}
                          </Link>
                        ) : (
                          line.label
                        )}
                      </dt>
                      <dd className={cn('font-medium tabular-nums text-foreground', line.tone)}>{line.value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 text-[11px] text-muted-foreground">Internal transfers excluded.</p>
              </Panel>

              <Panel title="Coming up" action={<span className="text-xs tabular-nums text-muted-foreground">{upcoming.length}</span>}>
                <UpcomingList items={upcoming} today={now} />
              </Panel>

              {model.attention.length > 0 ? (
                <Panel title="Needs attention" action={<span className="text-xs tabular-nums text-muted-foreground">{model.attention.length}</span>} bodyClassName="px-2 sm:px-3">
                  <AttentionList items={model.attention} hrefOf={model.attentionHref} />
                </Panel>
              ) : (
                <AllClear chequesChecked={model.staleCheques !== null} className="px-1" />
              )}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
