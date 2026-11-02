'use client';

/**
 * What the Overview, Account workspace, Position table and Aurora dashboard designs share: the
 * model the dashboard page hands them, the header, account badges, utilisation bars, the "coming
 * up" list, the checks and the CSV export. The Classic design is the page's own markup.
 *
 * Every figure comes from the page's ledgers (bank-balance-ledger), so a design changes the
 * layout, never a number.
 */

import Link from 'next/link';
import { useMemo, type ReactNode } from 'react';
import { differenceInCalendarDays, format } from 'date-fns';
import { ArrowRightLeft, Building2, CheckCircle2, ChevronRight, Download, Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shared/page-header';
import { useTheme } from '@/components/theme/ThemeProvider';
import { downloadCsv } from '@/lib/recurring-payments';
import { compactInr, formatInr, utilisationLevel, type AccountLedger } from '@/lib/bank-balance-ledger';
import type { AttentionItem, AttentionSeverity, AttentionTarget } from '@/lib/bank-balance-insights';
import {
  accountPositions,
  bankInitials,
  positionTotals,
  type AccountPosition,
  type UpcomingItem,
} from '@/lib/bank-balance-dashboard';
import type { BankAccount, BankExpense } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Where the dashboard may send the viewer: each set only when the viewer holds that right. */
export interface DashboardLinks {
  addAccount?: string;
  transfer?: string;
  payment?: string;
  receipt?: string;
  ledger?: string;
  interest?: string;
  cheques?: string;
}

export interface BankDashboardModel {
  /** When the figures were read: "today" for every design. */
  now: Date;
  refreshing: boolean;
  onRefresh: () => void;
  /** Active accounts in the page's order; inactive ones are shown apart, out of every total. */
  active: BankAccount[];
  inactive: BankAccount[];
  ledgers: Map<string, AccountLedger<BankAccount, BankExpense>>;
  /** Each account's ledger figure today: utilisation for Cash Credit, balance otherwise. */
  figures: Record<string, number>;
  limitOn: (account: BankAccount, day: Date) => number;
  /** Interest accrued on Cash Credit this month so far, est. */
  interestMtd: number;
  attention: AttentionItem[];
  attentionHref: (target: AttentionTarget) => string | undefined;
  /** The Cheque Register's stale cheques; null when the viewer cannot see the register. */
  staleCheques: { count: number; amount: number } | null;
  links: DashboardLinks;
}

export type Position = AccountPosition<BankAccount>;
export type BankLedger = AccountLedger<BankAccount, BankExpense>;

/** Positions, totals and the active ledgers, worked out once per refresh. */
export function useDashboard(model: BankDashboardModel) {
  const { active, inactive, figures, limitOn, now, ledgers: byId } = model;
  return useMemo(() => {
    const limitToday = (account: BankAccount) => limitOn(account, now);
    const rows = accountPositions(active, figures, limitToday);
    const ledgers = active.flatMap((account) => {
      const ledger = byId.get(account.id);
      return ledger ? [ledger] : [];
    });
    return {
      rows,
      cc: rows.filter((row) => row.cc),
      current: rows.filter((row) => !row.cc),
      inactiveRows: accountPositions(inactive, figures, limitToday),
      totals: positionTotals(rows),
      ledgers,
    };
  }, [active, inactive, figures, limitOn, now, byId]);
}

export const accountName = (account: Pick<BankAccount, 'shortName' | 'bankName'>) =>
  (account.shortName || account.bankName || '').trim() || '—';

export const maskedNumber = (account: Pick<BankAccount, 'accountNumber'>) => {
  const digits = String(account.accountNumber ?? '').replace(/\s+/g, '');
  return `···· ${digits ? digits.slice(-4) : '????'}`;
};

/** A one-word bank label for tight spots: the short name when it is an abbreviation, else the bank's first word. */
export function bankShort(account: Pick<BankAccount, 'shortName' | 'bankName'>) {
  const token = (account.shortName || '').trim().split(/[\s\-_/.]+/)[0] || '';
  if (/^[A-Za-z]{2,3}$/.test(token)) return token.toUpperCase();
  return (account.bankName || account.shortName || '').trim().split(/\s+/)[0] || '—';
}

/** Headline money: crore-sized figures compact (₹44.94 Cr), the rest in whole rupees. */
export const headlineInr = (value: number) => (Math.abs(value) >= 1e7 ? compactInr(value) : formatInr(value, 0));

export const signedInr = (value: number) => `${value < 0 ? '−' : value > 0 ? '+' : ''}${formatInr(Math.abs(value), 0)}`;

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Round axis ticks covering [min, max]: steps of 1, 2, 2.5 or 5 times a power of ten. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  let low = Number.isFinite(min) ? min : 0;
  let high = Number.isFinite(max) ? max : 0;
  if (low === high) {
    const pad = Math.abs(high) * 0.1 || 1;
    low -= pad;
    high += pad;
  }
  const raw = (high - low) / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((candidate) => candidate >= raw) ?? 10 * power;
  const start = Math.floor(low / step) * step;
  const end = Math.ceil(high / step) * step;
  const ticks: number[] = [];
  for (let value = start; value <= end + step / 1e6; value += step) ticks.push(Math.round(value * 1e4) / 1e4);
  return ticks;
}

/**
 * Chart colours. Recharts takes them as SVG attributes, which the dark-compat stylesheet cannot
 * reach, so each mode has its own steps. Single-series and drawn-against-track charts only: every
 * figure is in the tooltip and the text beside the chart too.
 */
const CHART = {
  light: { line: '#0f766e', drawn: '#1e293b', track: '#e2e8f0', pillBg: '#0f172a', pillText: '#ffffff' },
  dark: { line: '#2dd4bf', drawn: '#cbd5e1', track: '#334155', pillBg: '#e2e8f0', pillText: '#0f172a' },
} as const;

export function useChartColors() {
  const { resolvedMode } = useTheme();
  return CHART[resolvedMode === 'dark' ? 'dark' : 'light'];
}

/**
 * One colour per Cash Credit account, in this fixed order (the dataviz reference palette, validated
 * for adjacent pairs in both modes). An account keeps its colour on the donut, the bars and its
 * card; past eight, accounts share a neutral.
 */
const CATEGORICAL = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
} as const;
const OVERFLOW = { light: '#94a3b8', dark: '#64748b' } as const;

export function useAccountColours(ccAccounts: Array<Pick<BankAccount, 'id'>>) {
  const { resolvedMode } = useTheme();
  const mode = resolvedMode === 'dark' ? 'dark' : 'light';
  return useMemo(() => {
    const map = new Map<string, string>();
    ccAccounts.forEach((account, index) => map.set(account.id, CATEGORICAL[mode][index] ?? OVERFLOW[mode]));
    return (id: string) => map.get(id) ?? OVERFLOW[mode];
  }, [ccAccounts, mode]);
}

/** A section card. */
export function Panel({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn('min-w-0 rounded-xl border bg-card text-card-foreground shadow-sm', className)}>
      {(title || action) && (
        <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 px-4 pb-2 pt-4 sm:px-5">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-foreground">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={cn('px-4 pb-4 sm:px-5 sm:pb-5', !(title || action) && 'pt-4 sm:pt-5', bodyClassName)}>{children}</div>
    </section>
  );
}

export function PanelLink({ href, children }: { href?: string; children: ReactNode }) {
  if (!href) return null;
  return (
    <Link href={href} className="shrink-0 text-xs font-medium text-teal-700 hover:underline dark:text-teal-400">
      {children}
    </Link>
  );
}

/** A small set of mutually exclusive buttons: a period, a filter, a view. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: ReactNode }>;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn('inline-flex max-w-full shrink-0 overflow-x-auto rounded-lg bg-muted p-0.5', className)}>
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(option.value)}
            className={cn(
              'whitespace-nowrap rounded-md px-3 py-1 text-xs font-medium transition-colors',
              on ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** The bank's initials in a circle (soft) or a dark tile (solid). */
export function BankAvatar({
  account,
  tone = 'soft',
  className,
}: {
  account: Pick<BankAccount, 'shortName' | 'bankName'>;
  tone?: 'soft' | 'solid';
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex h-9 w-9 shrink-0 items-center justify-center text-[11px] font-semibold tracking-tight',
        tone === 'solid' ? 'rounded-lg bg-slate-900 text-white dark:bg-slate-700' : 'rounded-full bg-muted text-foreground/80',
        className,
      )}
    >
      {bankInitials(account)}
    </span>
  );
}

/** Drawn against the limit, on the module's utilisation thresholds (amber from 70%, red from 90%). */
export function UsageBar({ pct, className }: { pct: number; className?: string }) {
  const level = utilisationLevel(pct);
  const fill = level === 'critical' ? 'bg-rose-500' : level === 'high' ? 'bg-amber-500' : 'bg-slate-800 dark:bg-slate-300';
  return (
    <div aria-hidden className={cn('h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700', className)}>
      <div className={cn('h-full rounded-full', fill)} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  );
}

/** The percentage beside a usage bar, coloured on the same thresholds. */
export function usageText(pct: number) {
  const level = utilisationLevel(pct);
  return level === 'critical'
    ? 'text-rose-600 dark:text-rose-400'
    : level === 'high'
      ? 'text-amber-600 dark:text-amber-400'
      : 'text-muted-foreground';
}

/** The page header every newer design shares: date, last refresh, Refresh, Export, Record transfer. */
export function DashboardHeader({
  model,
  onExport,
  extra,
  transfer = true,
}: {
  model: BankDashboardModel;
  onExport: () => void;
  extra?: ReactNode;
  /** False when the design offers its own transfer button. */
  transfer?: boolean;
}) {
  return (
    <PageHeader
      title="Bank Balance"
      description={
        <span className="inline-flex flex-wrap items-center gap-x-2">
          <span>{format(model.now, 'EEEE, d MMMM yyyy')}</span>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Updated {format(model.now, 'HH:mm')}
          </span>
        </span>
      }
      actions={
        <>
          {extra}
          <Button variant="outline" size="sm" onClick={model.onRefresh} disabled={model.refreshing}>
            <RefreshCw className={cn('mr-1.5 h-4 w-4', model.refreshing && 'animate-spin')} />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={onExport}>
            <Download className="mr-1.5 h-4 w-4" />
            Export
          </Button>
          {transfer && model.links.transfer && (
            <Button asChild size="sm">
              <Link href={model.links.transfer}>
                <ArrowRightLeft className="mr-1.5 h-4 w-4" />
                Record transfer
              </Link>
            </Button>
          )}
        </>
      }
    />
  );
}

/** Today's position, one row per account, as a spreadsheet (account numbers masked as on screen). */
export function exportPositions(model: BankDashboardModel, rows: Position[]) {
  downloadCsv(
    `bank-position-${format(model.now, 'yyyy-MM-dd')}.csv`,
    ['Bank', 'Account', 'Type', 'Branch', 'Sanctioned limit', 'Drawn', 'Available', 'Utilisation %', 'Status'],
    rows.map((row) => [
      row.account.bankName || '',
      `${accountName(row.account)} ${maskedNumber(row.account)}`,
      row.cc ? 'Cash Credit' : 'Current Account',
      row.account.branch || '',
      row.cc ? Math.round(row.limit) : '',
      row.cc ? Math.round(row.drawn) : '',
      Math.round(row.available),
      row.cc && row.limit > 0 ? row.pct.toFixed(1) : '',
      row.account.status || '',
    ]),
  );
}

/** What the books say is coming. `tile` shows the date as a calendar tile (Aurora). */
export function UpcomingList({
  items,
  today,
  limit = 5,
  variant = 'plain',
  empty = 'Nothing dated ahead in the next 45 days.',
}: {
  items: UpcomingItem[];
  today: Date;
  limit?: number;
  variant?: 'plain' | 'tile';
  empty?: string;
}) {
  if (items.length === 0) return <p className="py-2 text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="divide-y divide-border/70">
      {items.slice(0, limit).map((item) => {
        const soon = differenceInCalendarDays(item.day, today) <= 7;
        return (
          <li key={`${item.kind}-${item.day.getTime()}-${item.title}`} className="flex items-start gap-3 py-3 first:pt-1 last:pb-0">
            {variant === 'tile' ? (
              <span className="flex w-11 shrink-0 flex-col items-center rounded-lg bg-muted py-1 leading-tight">
                <span className="text-[15px] font-bold tabular-nums text-foreground">{format(item.day, 'dd')}</span>
                <span className="text-[10px] font-semibold uppercase text-muted-foreground">{format(item.day, 'MMM')}</span>
              </span>
            ) : (
              <span className={cn('w-12 shrink-0 text-sm tabular-nums', soon ? 'font-medium text-orange-600 dark:text-orange-400' : 'text-muted-foreground')}>
                {format(item.day, 'd MMM')}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium leading-snug text-foreground">{item.title}</p>
              <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{item.detail}</p>
            </div>
            {item.amount !== undefined && (
              <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{headlineInr(item.amount)}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const SEVERITY_DOT: Record<AttentionSeverity, string> = {
  critical: 'bg-red-500',
  warning: 'bg-amber-500',
  info: 'bg-blue-500',
};

/** The checks' findings, worst first; each one links where it can be dealt with. */
export function AttentionList({ items, hrefOf }: { items: AttentionItem[]; hrefOf: (target: AttentionTarget) => string | undefined }) {
  return (
    <ul className="space-y-0.5">
      {items.map((item) => {
        const href = hrefOf(item.target);
        const row = (
          <span className="flex items-start gap-2.5 rounded-md px-2 py-1.5 text-sm">
            <span aria-hidden className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', SEVERITY_DOT[item.severity])} />
            <span className="min-w-0 flex-1 text-foreground/90">{item.text}</span>
            {href && <ChevronRight aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
          </span>
        );
        return (
          <li key={item.text}>
            {href ? (
              <Link href={href} className="block rounded-md hover:bg-muted">
                {row}
              </Link>
            ) : (
              row
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The green line shown when the checks find nothing. Stale cheques are named only when they were checked. */
export function AllClear({ chequesChecked, className }: { chequesChecked: boolean; className?: string }) {
  return (
    <p className={cn('flex items-start gap-2 text-sm text-muted-foreground', className)}>
      <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
      {chequesChecked
        ? 'No limit breaches, overdrawn accounts or stale cheques on the books.'
        : 'No limit breaches or overdrawn accounts on the books.'}
    </p>
  );
}

/** A labelled figure: the KPI unit of the newer designs. */
export function Figure({
  label,
  value,
  hint,
  tone,
  title,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'teal' | 'green' | 'red';
  title?: string;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        title={title}
        className={cn(
          'mt-1 truncate text-2xl font-semibold tabular-nums tracking-tight',
          tone === 'teal' ? 'text-teal-700 dark:text-teal-400' : tone === 'green' ? 'text-emerald-600 dark:text-emerald-400' : tone === 'red' ? 'text-rose-600 dark:text-rose-400' : 'text-foreground',
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** A ring showing a share: drawn of the limit. */
export function Ring({ pct, size = 64, className }: { pct: number; size?: number; className?: string }) {
  const colours = useChartColors();
  const level = utilisationLevel(pct);
  const stroke = level === 'critical' ? '#e11d48' : level === 'high' ? '#d97706' : colours.drawn;
  const r = 15.915;
  const shown = Math.min(100, Math.max(0, pct));
  return (
    <svg viewBox="0 0 36 36" width={size} height={size} className={cn('shrink-0 -rotate-90', className)} aria-hidden>
      <circle cx="18" cy="18" r={r} fill="none" stroke={colours.track} strokeWidth="3.5" />
      {shown > 0 && (
        <circle cx="18" cy="18" r={r} fill="none" stroke={stroke} strokeWidth="3.5" strokeLinecap="round" strokeDasharray={`${shown} ${100 - shown}`} />
      )}
    </svg>
  );
}

/** Shown in place of a design's content when no account is set up yet. */
export function NoAccounts({ addHref }: { addHref?: string }) {
  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-card p-6 text-center">
      <Building2 aria-hidden className="h-8 w-8 text-muted-foreground/60" />
      <div>
        <p className="font-medium text-foreground">No bank accounts configured</p>
        <p className="text-sm text-muted-foreground">Add your first account to start tracking balances and daily entries.</p>
      </div>
      {addHref && (
        <Button asChild variant="outline" size="sm">
          <Link href={addHref}>
            <Plus className="mr-1.5 h-4 w-4" />
            Add account
          </Link>
        </Button>
      )}
    </div>
  );
}

/** The narration a movement is listed under. */
export const narration = (txn: Pick<BankExpense, 'description' | 'isContra' | 'voucherNo'>) =>
  (txn.description || '').trim() || (txn.isContra ? 'Internal transfer' : txn.voucherNo || '—');
