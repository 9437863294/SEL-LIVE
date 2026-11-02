'use client';

import Link from 'next/link';
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { endOfDay, format, isSameDay } from 'date-fns';
import { Activity, AlertTriangle, ArrowDown, ArrowRightLeft, ArrowUp, Clock, Landmark, LayoutGrid, Plus, Scale, Table2 } from 'lucide-react';
import { compactInr, formatInr, utilisationLevel, type UtilisationLevel } from '@/lib/bank-balance-ledger';
import { flowBetween, lastEntryAt, upcomingItems } from '@/lib/bank-balance-dashboard';
import { cn } from '@/lib/utils';
import styles from './aurora.module.css';
import {
  AttentionList,
  DashboardHeader,
  NoAccounts,
  Panel,
  Segmented,
  UpcomingList,
  accountName,
  exportPositions,
  headlineInr,
  maskedNumber,
  plural,
  useAccountColours,
  useDashboard,
  type BankDashboardModel,
  type Position,
} from './kit';

type Tint = 'aurora' | 'ocean' | 'sunset' | 'forest';
type View = 'cards' | 'table';
type Filter = 'all' | 'cc' | 'ca';

const TINTS: ReadonlyArray<{ id: Tint; label: string; swatch: string }> = [
  { id: 'aurora', label: 'Aurora', swatch: 'conic-gradient(#0f766e, #2563eb, #7c3aed, #db2777, #f59e0b, #0f766e)' },
  { id: 'ocean', label: 'Ocean', swatch: 'linear-gradient(135deg, #22d3ee, #2563eb, #4f46e5)' },
  { id: 'sunset', label: 'Sunset', swatch: 'linear-gradient(135deg, #7c3aed, #db2777, #f97316, #facc15)' },
  { id: 'forest', label: 'Forest', swatch: 'linear-gradient(135deg, #065f46, #0891b2, #a3e635)' },
];

// The banner tint and the accounts view are each viewer's own, kept in this browser only.
const TINT_KEY = 'bankBalance.aurora.tint';
const VIEW_KEY = 'bankBalance.aurora.view';

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private windows and blocked storage: the choice just isn't remembered.
  }
}

/** Status colours for utilisation, on the module's thresholds; always shown with the percentage. */
const LEVEL: Record<UtilisationLevel, { bar: string; chip: string }> = {
  healthy: { bar: 'bg-emerald-500', chip: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
  moderate: { bar: 'bg-emerald-500', chip: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
  high: { bar: 'bg-amber-500', chip: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  critical: { bar: 'bg-rose-500', chip: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300' },
};

function PctChip({ pct }: { pct: number }) {
  return <span className={cn('rounded-md px-1.5 py-px text-xs font-bold tabular-nums', LEVEL[utilisationLevel(pct)].chip)}>{pct.toFixed(0)}%</span>;
}

function Track({ pct, marker, className }: { pct: number; marker?: boolean; className?: string }) {
  return (
    <div className={cn('relative h-3 rounded-full bg-muted', className)}>
      <div className={cn('h-full rounded-full', LEVEL[utilisationLevel(pct)].bar)} style={{ width: `${Math.min(100, Math.max(pct > 0 ? 1 : 0, pct))}%` }} />
      {marker && (
        <span aria-hidden className="absolute -bottom-1 -top-1 w-0.5 bg-foreground/30" style={{ left: '90%' }}>
          <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[9.5px] font-bold text-muted-foreground">90%</span>
        </span>
      )}
    </div>
  );
}

function AppIcon({ from, to, size = 40, children }: { from: string; to: string; size?: number; children: ReactNode }) {
  return (
    <span
      aria-hidden
      className={styles.appIcon}
      style={{ '--a': from, '--b': to, width: size, height: size, borderRadius: size * 0.3 } as CSSProperties}
    >
      {children}
    </span>
  );
}

const NEUTRAL = { from: '#94a3b8', to: '#475569' };

/** Each Cash Credit account's share of the combined limit. */
function LimitDonut({ rows, colourOf }: { rows: Position[]; colourOf: (id: string) => string }) {
  const withLimit = rows.filter((row) => row.limit > 0);
  const total = withLimit.reduce((sum, row) => sum + row.limit, 0);
  if (total <= 0) return <p className="text-sm text-muted-foreground">No Cash Credit limit in force today.</p>;
  const compact = compactInr(total);
  const match = /^(.*?)\s(Cr|L|K)$/.exec(compact);
  const unit = match ? ({ Cr: 'CRORE', L: 'LAKH', K: 'THOUSAND' } as const)[match[2] as 'Cr' | 'L' | 'K'] : '';
  const gap = withLimit.length > 1 ? 0.8 : 0;
  // Each arc starts where the previous one ended, from 12 o'clock.
  const arcs = withLimit.map((row, index) => {
    const share = (row.limit / total) * 100;
    const before = withLimit.slice(0, index).reduce((sum, prev) => sum + (prev.limit / total) * 100, 0);
    return { row, share, offset: 25 - before };
  });
  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg viewBox="0 0 42 42" width={132} height={132} className="shrink-0" role="img" aria-label={`Combined limit ${formatInr(total, 0)}`}>
        <circle cx="21" cy="21" r="15.915" fill="none" className="stroke-muted" strokeWidth="5" />
        {arcs.map(({ row, share, offset }) => (
          <circle
            key={row.account.id}
            cx="21"
            cy="21"
            r="15.915"
            fill="none"
            stroke={colourOf(row.account.id)}
            strokeWidth="5"
            strokeDasharray={`${Math.max(0, share - gap)} ${100 - Math.max(0, share - gap)}`}
            strokeDashoffset={offset}
          >
            <title>{`${accountName(row.account)}: ${formatInr(row.limit, 0)} (${share.toFixed(1)}%)`}</title>
          </circle>
        ))}
        <text x="21" y={unit ? 20.5 : 22} textAnchor="middle" fontSize="5" fontWeight="800" fill="currentColor" className="text-foreground">
          {match ? match[1] : compact}
        </text>
        {unit && (
          <text x="21" y="26" textAnchor="middle" fontSize="3" fontWeight="700" fill="currentColor" className="text-muted-foreground">
            {unit}
          </text>
        )}
      </svg>
      <ul className="min-w-[10rem] flex-1 space-y-1.5">
        {withLimit.map((row) => (
          <li key={row.account.id} className="flex items-center gap-2 text-sm">
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: colourOf(row.account.id) }} />
            <span className="min-w-0 flex-1 truncate font-medium text-foreground">{accountName(row.account)}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{compactInr(row.limit)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LastEntry({ at, now }: { at: Date | null; now: Date }) {
  if (at && isSameDay(at, now)) {
    return (
      <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-400">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Entry today
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 font-semibold text-amber-700 dark:text-amber-400">
      <Clock aria-hidden className="h-3.5 w-3.5" />
      {at ? `Last entry ${format(at, 'd MMM')}` : 'No entries yet'}
    </span>
  );
}

/**
 * Aurora: a colour banner with what is available and where it comes from, quick entries, today's
 * figures, Cash Credit utilisation and the limit by bank, then the accounts as cards or a table.
 * Built from the user's own HTML mockup; its demo "working day" figures and calendar items are not
 * carried over — every number here is the ledger's.
 */
export function AuroraDesign({ model }: { model: BankDashboardModel }) {
  const { rows, cc, current, inactiveRows, totals, ledgers } = useDashboard(model);
  const { now, limitOn, interestMtd, attention } = model;
  const colourOf = useAccountColours(useMemo(() => cc.map((row) => row.account), [cc]));
  // Read on first render: this design only ever renders in the browser, after the data has loaded
  // (the server sends the dashboard's skeleton), so there is no server markup to disagree with.
  const [tint, setTint] = useState<Tint>(() => readStored(TINT_KEY, ['aurora', 'ocean', 'sunset', 'forest'] as const, 'aurora'));
  const [view, setView] = useState<View>(() => readStored(VIEW_KEY, ['cards', 'table'] as const, 'cards'));
  const [filter, setFilter] = useState<Filter>('all');

  const today = useMemo(() => flowBetween(ledgers, now, now), [ledgers, now]);
  const upcoming = useMemo(
    () => upcomingItems({ ledgers, nameOf: accountName, limitOn, today: now, horizonDays: 30, interestAccrued: interestMtd }),
    [ledgers, limitOn, now, interestMtd],
  );
  const lastEntries = useMemo(() => {
    const cutoff = endOfDay(now);
    const map = new Map<string, Date | null>();
    for (const row of [...rows, ...inactiveRows]) map.set(row.account.id, lastEntryAt(model.ledgers.get(row.account.id), cutoff));
    return map;
  }, [rows, inactiveRows, model.ledgers, now]);

  if (rows.length === 0 && inactiveRows.length === 0) {
    return (
      <div className="relative w-full space-y-5 px-4 py-4 sm:px-6 lg:px-8">
        <DashboardHeader model={model} onExport={() => exportPositions(model, [])} />
        <NoAccounts addHref={model.links.addAccount} />
      </div>
    );
  }

  const cashPart = Math.max(0, totals.currentBalance);
  const headPart = Math.max(0, totals.ccHeadroom);
  const splitTotal = cashPart + headPart + totals.ccDrawn;
  const share = (value: number) => (splitTotal > 0 ? `${(value / splitTotal) * 100}%` : '0%');
  const noEntries = rows.filter((row) => !lastEntries.get(row.account.id));
  const byUse = [...cc].sort((a, b) => b.pct - a.pct);
  const shown = [...rows, ...(filter === 'all' ? inactiveRows : [])].filter((row) => filter === 'all' || (filter === 'cc' ? row.cc : !row.cc));
  const iconColours = (row: Position) => (row.cc ? { from: `${colourOf(row.account.id)}b3`, to: colourOf(row.account.id) } : NEUTRAL);

  const actions = [
    model.links.payment && { href: model.links.payment, label: 'Record payment', icon: Plus, primary: true },
    model.links.receipt && { href: model.links.receipt, label: 'Receipt', icon: ArrowUp },
    model.links.transfer && { href: model.links.transfer, label: 'Transfer', icon: ArrowRightLeft },
  ].filter(Boolean) as Array<{ href: string; label: string; icon: typeof Plus; primary?: boolean }>;

  return (
    <div className="relative w-full space-y-4 px-4 py-4 sm:px-6 lg:px-8">
      <DashboardHeader model={model} onExport={() => exportPositions(model, [...rows, ...inactiveRows])} transfer={false} />

      <section className={cn(styles.hero, 'keep-light p-5 sm:p-7')} data-tint={tint}>
        <div className={styles.swatches} role="group" aria-label="Banner colour">
          {TINTS.map((option) => (
            <button
              key={option.id}
              type="button"
              title={option.label}
              aria-label={option.label}
              aria-pressed={tint === option.id}
              className={styles.swatch}
              style={{ background: option.swatch }}
              onClick={() => {
                setTint(option.id);
                store(TINT_KEY, option.id);
              }}
            />
          ))}
        </div>

        <div className="grid grid-cols-1 items-end gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <div className="min-w-0 pt-6 sm:pt-0">
            <div className={cn(styles.muted, 'flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-[0.08em]')}>
              Available liquidity
              <span className={cn(styles.pill, 'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold normal-case tracking-normal text-white')}>
                <span aria-hidden className={cn(styles.liveDot, 'h-1.5 w-1.5 rounded-full')} />
                Live · {format(now, 'HH:mm')}
              </span>
            </div>
            <p className="mb-1 mt-2 break-words text-3xl font-extrabold tabular-nums tracking-tight sm:text-[44px] sm:leading-[1.1]">{formatInr(totals.available, 0)}</p>
            <p className={cn(styles.muted, 'text-sm')}>
              Cash in current accounts plus undrawn cash credit · <b className="text-white">{compactInr(totals.ccDrawn)}</b> drawn of {compactInr(totals.ccLimit)} limit (
              {totals.drawnPct.toFixed(1)}%)
            </p>
            {actions.length > 0 && (
              <div className="mt-5 flex flex-wrap gap-2">
                {actions.map((action) => (
                  <Link key={action.label} href={action.href} className={cn(styles.action, action.primary && styles.actionPrimary)}>
                    <action.icon aria-hidden className="h-4 w-4" />
                    {action.label}
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className={cn(styles.glass, 'min-w-0 rounded-2xl p-4')}>
            <div className="flex items-center justify-between gap-3 text-xs font-bold">
              <span className={styles.muted}>Where it comes from</span>
              <span className={cn(styles.muted, 'tabular-nums')}>Total {compactInr(splitTotal)}</span>
            </div>
            <div className="my-3 flex h-3 overflow-hidden rounded-md bg-white/15" aria-hidden>
              <div className="h-full bg-[#4ade80]" style={{ width: share(cashPart) }} />
              <div className="h-full bg-white" style={{ width: share(headPart) }} />
              <div className="h-full bg-[#fb7185]" style={{ width: share(totals.ccDrawn) }} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[
                { colour: 'bg-[#4ade80]', label: 'Cash in current a/cs', value: totals.currentBalance },
                { colour: 'bg-white', label: 'Undrawn CC (headroom)', value: totals.ccHeadroom },
                { colour: 'bg-[#fb7185]', label: 'CC drawn (owed to bank)', value: totals.ccDrawn },
              ].map((part) => (
                <div key={part.label} className="min-w-0">
                  <p className={cn(styles.muted, 'flex items-start gap-1.5 text-[11.5px] font-semibold leading-tight')}>
                    <span aria-hidden className={cn('mt-0.5 h-2 w-2 shrink-0 rounded-sm', part.colour)} />
                    <span className="min-w-0">{part.label}</span>
                  </p>
                  <p className="text-lg font-extrabold tabular-nums" title={formatInr(part.value)}>
                    {compactInr(part.value)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {(attention.length > 0 || noEntries.length > 0) && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-100">
          <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-200 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1 space-y-1 text-sm">
            {noEntries.length > 0 && (
              <p>
                <b>
                  {noEntries.length} of {rows.length} accounts have no entries yet
                </b>{' '}
                ({noEntries.map((row) => accountName(row.account)).join(', ')}). Their figures are the opening balance only, so a ₹0 may just mean
                nothing has been posted.
              </p>
            )}
            {attention.length > 0 && (
              <div className="-mx-2">
                <AttentionList items={attention} hrefOf={model.attentionHref} />
              </div>
            )}
          </div>
          {model.links.ledger && noEntries.length > 0 && (
            <Link href={model.links.ledger} className="hidden shrink-0 rounded-lg border border-amber-300 bg-white/70 px-3 py-1.5 text-sm font-semibold hover:bg-white sm:inline-block dark:border-amber-700 dark:bg-transparent">
              Daily log →
            </Link>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-4">
        {[
          { label: 'Today’s receipts', value: compactInr(today.receipts), from: '#86efac', to: '#16a34a', icon: ArrowUp, extra: today.receiptCount ? plural(today.receiptCount, 'entry', 'entries') : 'No entries yet' },
          { label: 'Today’s payments', value: compactInr(today.payments), from: '#fda4af', to: '#e11d48', icon: ArrowDown, extra: today.paymentCount ? plural(today.paymentCount, 'entry', 'entries') : 'No entries yet' },
          {
            label: 'Net flow today',
            value: `${today.net < 0 ? '−' : today.net > 0 ? '+' : ''}${compactInr(Math.abs(today.net))}`,
            from: '#a5b4fc',
            to: '#4f46e5',
            icon: Scale,
            extra: today.net > 0 ? 'More in than out' : today.net < 0 ? 'More out than in' : '—',
          },
          {
            label: 'Transactions',
            value: plural(today.count, 'entry', 'entries'),
            from: '#7dd3fc',
            to: '#0284c7',
            icon: Activity,
            extra: today.transfers ? `Transfers ${compactInr(today.transfers)}` : today.count ? 'Transfers included' : 'Nothing posted today',
          },
        ].map((tile) => (
          <div key={tile.label} className="flex min-w-0 items-center gap-3 rounded-2xl border bg-card px-4 py-3.5 shadow-sm">
            <AppIcon from={tile.from} to={tile.to} size={38}>
              <tile.icon className="h-[18px] w-[18px]" />
            </AppIcon>
            <div className="min-w-0">
              <p className="text-[11.5px] font-semibold text-muted-foreground">{tile.label}</p>
              <p className="whitespace-nowrap text-lg font-extrabold tabular-nums tracking-tight text-foreground">{tile.value}</p>
            </div>
            <span className="ml-auto text-right text-[11.5px] text-muted-foreground">{tile.extra}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <Panel
          title="Cash credit utilisation"
          description="Drawn against the DP + OD + TOD limit of each account. The line marks 90%, where the module flags a limit as critical."
          action={
            <div className="flex flex-wrap gap-3 text-[11.5px] font-semibold text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />Below 70%</span>
              <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-amber-500" />70–90%</span>
              <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-rose-500" />90% and over</span>
            </div>
          }
        >
          {byUse.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active Cash Credit accounts.</p>
          ) : (
            <ul className="divide-y divide-dashed">
              {byUse.map((row) => {
                const colours = iconColours(row);
                return (
                  <li key={row.account.id} className="grid grid-cols-1 items-center gap-2 py-3 sm:grid-cols-[9.5rem_minmax(0,1fr)_11rem] sm:gap-4">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <AppIcon from={colours.from} to={colours.to} size={28}>
                        <Landmark className="h-3.5 w-3.5" />
                      </AppIcon>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-foreground">{accountName(row.account)}</p>
                        <p className="truncate text-[11px] font-semibold text-muted-foreground">{row.account.bankName}</p>
                      </div>
                    </div>
                    {row.limit > 0 ? <Track pct={row.pct} marker className="mt-3 sm:mt-0" /> : <p className="text-xs text-muted-foreground">No limit in force</p>}
                    <div className="sm:text-right">
                      <p className="flex items-center gap-2 font-extrabold tabular-nums text-foreground sm:justify-end">
                        {compactInr(row.drawn)} {row.limit > 0 && <PctChip pct={row.pct} />}
                      </p>
                      <p className="text-[11.5px] text-muted-foreground">
                        of {compactInr(row.limit)} · {compactInr(Math.max(0, row.available))} left
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="Limit by bank" description={`Share of the ${compactInr(totals.ccLimit)} sanctioned Cash Credit limit`}>
            <LimitDonut rows={cc} colourOf={colourOf} />
          </Panel>
          <Panel title="Coming up" description="Next 30 days, from the books">
            <UpcomingList items={upcoming} today={now} variant="tile" empty="Nothing dated ahead in the next 30 days." />
          </Panel>
        </div>
      </div>

      <section className="min-w-0 pt-2">
        <div className="mb-3 flex flex-wrap items-center gap-2.5">
          <h2 className="text-base font-extrabold text-foreground">Accounts</h2>
          <span className="rounded-full bg-muted px-2 py-px text-xs font-bold tabular-nums text-muted-foreground">{rows.length}</span>
          <Segmented
            label="Account type"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'cc', label: `Cash credit · ${cc.length}` },
              { value: 'ca', label: `Current · ${current.length}` },
            ]}
          />
          <div className="flex-1" />
          <Segmented
            label="Accounts view"
            value={view}
            onChange={(next) => {
              setView(next);
              store(VIEW_KEY, next);
            }}
            options={[
              { value: 'cards', label: <span className="inline-flex items-center gap-1.5"><LayoutGrid aria-hidden className="h-3.5 w-3.5" />Cards</span> },
              { value: 'table', label: <span className="inline-flex items-center gap-1.5"><Table2 aria-hidden className="h-3.5 w-3.5" />Table</span> },
            ]}
          />
        </div>

        {view === 'cards' ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-3.5">
            {shown.map((row) => {
              const colours = iconColours(row);
              const inactive = row.account.status !== 'Active';
              return (
                <div key={row.account.id} className={cn('relative min-w-0 overflow-hidden rounded-2xl border bg-card p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md', inactive && 'opacity-60')}>
                  <span aria-hidden className="pointer-events-none absolute -right-12 -top-12 h-36 w-36 rounded-full opacity-20 blur-2xl" style={{ background: colours.to }} />
                  <div className="relative flex items-center gap-3">
                    <AppIcon from={colours.from} to={colours.to}>
                      <Landmark className="h-[19px] w-[19px]" />
                    </AppIcon>
                    <div className="min-w-0">
                      <p className="truncate text-[14.5px] font-bold text-foreground">{accountName(row.account)}</p>
                      <p className="truncate text-xs text-muted-foreground">{row.account.bankName}</p>
                    </div>
                    <div className="ml-auto flex shrink-0 flex-col items-end gap-1">
                      <span
                        className={cn(
                          'rounded-md px-1.5 py-px text-[11px] font-extrabold tracking-wide',
                          row.cc ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' : 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
                        )}
                      >
                        {inactive ? 'INACTIVE' : row.cc ? 'CASH CREDIT' : 'CURRENT'}
                      </span>
                      <span className="font-mono text-[11.5px] text-muted-foreground">{maskedNumber(row.account)}</span>
                    </div>
                  </div>
                  <p className={cn('relative mt-3.5 text-2xl font-extrabold tabular-nums tracking-tight', row.available < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-foreground')} title={formatInr(row.available)}>
                    {headlineInr(row.available)}
                  </p>
                  <p className="text-xs font-semibold text-muted-foreground">{row.cc ? 'Available to draw' : 'Balance in account'}</p>
                  {row.cc ? (
                    <>
                      <Track pct={row.pct} className="mb-2 mt-3 h-2" />
                      <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>
                          Drawn <b className="tabular-nums text-foreground">{compactInr(row.drawn)}</b>
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          Limit <b className="tabular-nums text-foreground">{compactInr(row.limit)}</b> {row.limit > 0 && <PctChip pct={row.pct} />}
                        </span>
                      </div>
                    </>
                  ) : (
                    <p className="mt-5 text-xs text-muted-foreground">Operating account · no limit</p>
                  )}
                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-dashed pt-2.5 text-xs">
                    <LastEntry at={lastEntries.get(row.account.id) ?? null} now={now} />
                    <span className="truncate text-muted-foreground">{row.account.branch || 'Branch not recorded'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="min-w-0 overflow-x-auto rounded-2xl border bg-card shadow-sm">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                  <th className="px-4 py-3 font-bold">Account</th>
                  <th className="px-4 py-3 font-bold">Type</th>
                  <th className="px-4 py-3 text-right font-bold">Limit</th>
                  <th className="px-4 py-3 text-right font-bold">Drawn / balance</th>
                  <th className="px-4 py-3 text-right font-bold">Available</th>
                  <th className="px-4 py-3 font-bold">Utilisation</th>
                  <th className="px-4 py-3 font-bold">Last entry</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => {
                  const colours = iconColours(row);
                  return (
                    <tr key={row.account.id} className={cn('border-b last:border-b-0', row.account.status !== 'Active' && 'opacity-60')}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <AppIcon from={colours.from} to={colours.to} size={30}>
                            <Landmark className="h-3.5 w-3.5" />
                          </AppIcon>
                          <div className="min-w-0">
                            <p className="font-bold text-foreground">{accountName(row.account)}</p>
                            <p className="font-mono text-[11.5px] text-muted-foreground">
                              {row.account.bankName} · {maskedNumber(row.account)}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('rounded-md px-1.5 py-px text-[11px] font-extrabold', row.cc ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' : 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300')}>
                          {row.cc ? 'CC' : 'CA'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{row.cc ? compactInr(row.limit) : '—'}</td>
                      <td className="px-4 py-3 text-right font-bold tabular-nums">{compactInr(row.cc ? row.drawn : row.figure)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{compactInr(row.available)}</td>
                      <td className="min-w-[140px] px-4 py-3">
                        {row.cc && row.limit > 0 ? (
                          <div className="flex items-center gap-2">
                            <Track pct={row.pct} className="h-[7px] flex-1" />
                            <PctChip pct={row.pct} />
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <LastEntry at={lastEntries.get(row.account.id) ?? null} now={now} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t bg-muted/40 font-extrabold">
                  <td className="px-4 py-3" colSpan={2}>
                    Total · {plural(shown.filter((row) => row.account.status === 'Active').length, 'active account')}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{compactInr(shown.filter((r) => r.account.status === 'Active').reduce((s, r) => s + r.limit, 0))}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{compactInr(shown.filter((r) => r.account.status === 'Active').reduce((s, r) => s + (r.cc ? r.drawn : r.figure), 0))}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{compactInr(shown.filter((r) => r.account.status === 'Active').reduce((s, r) => s + r.available, 0))}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
