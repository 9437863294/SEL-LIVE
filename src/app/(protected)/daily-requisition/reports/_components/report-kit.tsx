'use client';

/**
 * What the Daily Requisition reports share, so the seven of them read the same:
 *
 * - Money: whole rupees on KPI tiles and chart labels, to the paisa in tables — as the entry sheet
 *   shows amounts, so a part payment's paise reconcile (paid + outstanding = net) on screen.
 * - A requisition's date as a local yyyy-MM-dd. The entry sheet and the importer store a Firestore
 *   Timestamp: `String(timestamp)` dropped those entries from every date range, and `toISOString()`
 *   gives the UTC day — a day (and on the 1st, a month) early for an Indian midnight.
 * - Paid and still due, always through `paidOf` / `balanceOf` (src/lib/requisition-progress.ts),
 *   the one reading Daily Requisition and Bank Balance share — so a requisition part paid through a
 *   voucher counts here exactly as it does on the entry sheet and in the cheque register.
 * - The loading, access-denied, KPI-row and chip-strip frames.
 * - The redesigned report's parts, as on the Entry Sheet: one header card with the totals, a Period
 *   filter (the Entry Sheet's presets or a range of your own), and tight striped table rows.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { Timestamp } from 'firebase/firestore';
import { Download, ShieldAlert, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { BtToolbar, ToolbarDate, ToolbarSelect } from '@/components/bill-tracking/bt-toolbar';
import { PageHeader } from '@/components/shared/page-header';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import {
  DailyStatStrip,
  dailyPageContainerClass,
  dailySurfaceCardClass,
  type DailyStat,
} from '@/components/daily-requisition/module-shell';
import { DR_DATE_PRESETS, resolveDatePreset, type DRDatePreset } from '@/lib/daily-requisition-settings';
import { balanceOf, paidOf } from '@/lib/requisition-progress';
import type { DailyRequisitionEntry } from '@/lib/types';
import { cn } from '@/lib/utils';

/* ── Money ────────────────────────────────────────────────────────────────────────────────── */

const INR_WHOLE = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const INR_EXACT = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** ₹12,34,568 — whole rupees, for KPI tiles and chart labels. */
export const inrWhole = (value: number | null | undefined): string => INR_WHOLE.format(Number(value) || 0);

/** ₹12,34,567.89 — to the paisa, for tables. */
export const inr = (value: number | null | undefined): string => INR_EXACT.format(Number(value) || 0);

/** Sums of floats drift (0.1 + 0.2); exports get the figure to the paisa. */
export const round2 = (value: number): number => Math.round((Number(value) || 0) * 100) / 100;

/** A part as a share of a total, "12.3%"; "0.0%" when the total is nothing. */
export const pctOf = (part: number, total: number): string =>
  total > 0 ? `${((part / total) * 100).toFixed(1)}%` : '0.0%';

/* ── Dates ────────────────────────────────────────────────────────────────────────────────── */

const pad2 = (n: number) => String(n).padStart(2, '0');

/** A moment's local calendar day, yyyy-MM-dd. */
export const localDateKey = (d: Date): string => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** A Firestore Timestamp, Date, millis or date string as a Date; null when there is none. */
export function toJsDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') return Number.isFinite(value) ? new Date(value) : null;
  if (typeof value === 'string') {
    const text = value.trim();
    // A bare day is that day here; `new Date('2026-09-01')` would read it as UTC midnight.
    const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (day) return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  // A Timestamp that lost its prototype on the way (serialised, or another SDK copy).
  const maybe = value as { toDate?: () => Date; seconds?: number };
  if (typeof maybe.toDate === 'function') return maybe.toDate();
  if (typeof maybe.seconds === 'number') return new Date(maybe.seconds * 1000);
  return null;
}

/** A requisition's date as a local yyyy-MM-dd, or '' when it has none. */
export function dateKeyOf(value: unknown): string {
  const d = toJsDate(value);
  return d ? localDateKey(d) : '';
}

/** Whether a yyyy-MM-dd falls in an optional, inclusive from / to range. Undated rows only match no range. */
export function inDateRange(key: string, from: string, to: string): boolean {
  if (!from && !to) return true;
  if (!key) return false;
  return (!from || key >= from) && (!to || key <= to);
}

/** "01 Sep 2026", or an em dash. */
export function formatDay(value: unknown): string {
  const d = toJsDate(value);
  return d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}

/* ── Paid and still due ───────────────────────────────────────────────────────────────────── */

export interface RequisitionTotals {
  count: number;
  gross: number;
  net: number;
  /** Σ paidOf: what vouchers have paid, and a Paid requisition in full. */
  paid: number;
  /** Σ balanceOf: what is still to pay. A cancelled requisition owes nothing. */
  outstanding: number;
  /** How many are Partially Paid. */
  partPaid: number;
}

export const emptyTotals = (): RequisitionTotals => ({ count: 0, gross: 0, net: 0, paid: 0, outstanding: 0, partPaid: 0 });

/** Adds one requisition to running totals, and returns them. */
export function addTo(totals: RequisitionTotals, entry: DailyRequisitionEntry): RequisitionTotals {
  totals.count += 1;
  totals.gross += Number(entry.grossAmount) || 0;
  totals.net += Number(entry.netAmount) || 0;
  totals.paid += paidOf(entry);
  totals.outstanding += balanceOf(entry);
  if (entry.status === 'Partially Paid') totals.partPaid += 1;
  return totals;
}

export const totalsOf = (entries: readonly DailyRequisitionEntry[]): RequisitionTotals =>
  entries.reduce((totals, entry) => addTo(totals, entry), emptyTotals());

export interface GroupTotals extends RequisitionTotals {
  key: string;
  name: string;
}

/** Requisitions grouped by department, project or party, each group with its totals. */
export function groupTotals(
  entries: readonly DailyRequisitionEntry[],
  keyOf: (entry: DailyRequisitionEntry) => string,
  nameOf: (key: string) => string,
): GroupTotals[] {
  const groups = new Map<string, GroupTotals>();
  for (const entry of entries) {
    const key = keyOf(entry);
    let group = groups.get(key);
    if (!group) {
      group = { key, name: nameOf(key), ...emptyTotals() };
      groups.set(key, group);
    }
    addTo(group, entry);
  }
  return Array.from(groups.values());
}

/* ── Period ───────────────────────────────────────────────────────────────────────────────── */

export type ReportPeriod = DRDatePreset | 'custom';

/** The Entry Sheet's date presets, then a range of your own. "All time" is the select's empty choice. */
const PERIOD_OPTIONS = [
  ...DR_DATE_PRESETS.filter((preset) => preset.value !== 'all'),
  { value: 'custom', label: 'Custom range' },
];

export interface ReportPeriodState {
  period: ReportPeriod;
  setPeriod: (period: ReportPeriod) => void;
  customFrom: string;
  setCustomFrom: (value: string) => void;
  customTo: string;
  setCustomTo: (value: string) => void;
  /** The period as an inclusive yyyy-MM-dd range; both empty for all time. */
  dateFrom: string;
  dateTo: string;
  /** "This month", "01 Sep 2026 – 30 Sep 2026", "All time". */
  label: string;
  /** Back to all time. */
  clear: () => void;
}

/** A report's period: a preset, or a from / to of your own. */
export function useReportPeriod(initial: ReportPeriod = 'all'): ReportPeriodState {
  const [period, setPeriod] = useState<ReportPeriod>(initial);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const { dateFrom, dateTo } = useMemo(() => {
    if (period === 'custom') return { dateFrom: customFrom, dateTo: customTo };
    const range = resolveDatePreset(period);
    return range ? { dateFrom: localDateKey(range.from), dateTo: localDateKey(range.to) } : { dateFrom: '', dateTo: '' };
  }, [period, customFrom, customTo]);

  const label =
    period !== 'custom'
      ? (DR_DATE_PRESETS.find((preset) => preset.value === period)?.label ?? 'All time')
      : dateFrom && dateTo
        ? `${formatDay(dateFrom)} – ${formatDay(dateTo)}`
        : dateFrom
          ? `From ${formatDay(dateFrom)}`
          : dateTo
            ? `Until ${formatDay(dateTo)}`
            : 'All time';

  const clear = () => {
    setPeriod('all');
    setCustomFrom('');
    setCustomTo('');
  };

  return { period, setPeriod, customFrom, setCustomFrom, customTo, setCustomTo, dateFrom, dateTo, label, clear };
}

/**
 * The filter row under the header card — Bill Tracking's filter toolbar, as on the Bill Register:
 * Period, its own From / To when custom, any `children` controls, and Clear.
 */
export function ReportPeriodFilter({ state, children }: { state: ReportPeriodState; children?: ReactNode }) {
  return (
    <BtToolbar
      controls={
        <>
          <ToolbarSelect
            label="Period"
            value={state.period === 'all' ? '' : state.period}
            onChange={(value) => state.setPeriod((value || 'all') as ReportPeriod)}
            options={PERIOD_OPTIONS}
            allLabel="All time"
          />
          {state.period === 'custom' ? (
            <>
              <ToolbarDate label="From" value={state.customFrom} onChange={state.setCustomFrom} />
              <ToolbarDate label="To" value={state.customTo} onChange={state.setCustomTo} />
            </>
          ) : null}
          {children}
        </>
      }
      activeCount={state.period !== 'all' ? 1 : 0}
      onClear={state.clear}
    />
  );
}

/* ── The redesigned report's frame ────────────────────────────────────────────────────────── */

/**
 * One card, as on the Entry Sheet: the report — back, icon, title, what it shows, its actions —
 * then its totals as a strip of figures.
 */
export function ReportHeaderCard({
  icon,
  title,
  description,
  actions,
  stats,
}: {
  icon: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  stats: DailyStat[];
}) {
  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
      {/* A `space-y-*` parent: globals.css then drops the header's own bottom margin. */}
      <div className="space-y-0 px-4 py-3 sm:px-5 sm:py-4">
        <PageHeader
          eyebrow="Daily Requisition"
          icon={icon}
          title={title}
          description={description}
          backHref="/daily-requisition/reports"
          actions={actions}
        />
      </div>
      <DailyStatStrip flush items={stats} />
    </section>
  );
}

/** The header card's export button. */
export function ExportExcelButton({ onClick, busy, disabled = false }: { onClick: () => void; busy: boolean; disabled?: boolean }) {
  return (
    <Button size="sm" variant="outline" className="gap-1.5" onClick={onClick} disabled={busy || disabled}>
      <Download className="h-4 w-4" />
      {busy ? 'Exporting…' : 'Export Excel'}
    </Button>
  );
}

/** A report table's rhythm: the app's compact table density, whatever the Table rows setting. */
export const REPORT_TABLE = '[--table-cell-py:0.375rem] [--table-head-h:2.25rem]';

/** A report table's row: striped like the module's registers. A totals row keeps its own fill. */
export const REPORT_ROW = 'border-slate-100 even:bg-slate-50 hover:bg-emerald-50';

/** A name in a report table, on one line: cut short with "…", the whole of it on hover. */
export function CellName({ text, className }: { text: string; className?: string }) {
  return (
    <span className={cn('block max-w-[260px] truncate', className)} title={text}>
      {text}
    </span>
  );
}

/** A count or amount with a small bar beside it — on the same line, so the row stays one line tall. */
export function ValueBar({ value, share, barClassName }: { value: ReactNode; share: number; barClassName: string }) {
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="h-1.5 w-20 shrink-0 rounded-full bg-slate-100" aria-hidden="true">
        <div className={cn('h-1.5 rounded-full bg-gradient-to-r', barClassName)} style={{ width: `${Math.max(0, Math.min(share, 1)) * 100}%` }} />
      </div>
      <span className="whitespace-nowrap tabular-nums">{value}</span>
    </div>
  );
}

/* ── Frames ───────────────────────────────────────────────────────────────────────────────── */

/** The one row of KPI tiles above a report's table: one column on a phone, then two, then four. */
export function KpiRow({ children }: { children: ReactNode }) {
  return <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{children}</div>;
}

export interface Chip {
  key: string;
  label: string;
  count: number;
  tone?: StatusTone;
  /** A muted figure after the chip, e.g. the amount behind the count. */
  hint?: string;
}

/** Counts per status or bucket as one wrapping line of chips — the compact stand-in for a card each. */
export function ChipStrip({ label, chips }: { label: string; chips: Chip[] }) {
  return (
    <ul aria-label={label} className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
      {chips.map((chip) => (
        <li key={chip.key} className={cn('flex min-w-0 items-center gap-1.5', chip.count === 0 && 'opacity-60')}>
          <StatusBadge status={chip.label} tone={chip.tone} dot>
            {chip.label}
            <span className="font-semibold tabular-nums">{chip.count}</span>
          </StatusBadge>
          {chip.hint ? <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">{chip.hint}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** While permissions or the report's data load. */
export function ReportSkeleton({
  filters = true,
  strip = false,
  panel = false,
}: {
  /** A filter bar under the header. */
  filters?: boolean;
  /** A chip strip under the KPI row. */
  strip?: boolean;
  /** A chart or breakdown card before the table. */
  panel?: boolean;
}) {
  return (
    <div className={dailyPageContainerClass} aria-busy="true">
      <div className="mb-5 flex items-start gap-3">
        <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-6 w-full max-w-xs" />
          <Skeleton className="h-4 w-full max-w-lg" />
        </div>
      </div>
      {filters && <Skeleton className="mb-4 h-10 w-full rounded-xl" />}
      <KpiRow>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[74px] rounded-xl" />
        ))}
      </KpiRow>
      {strip && <Skeleton className="mb-4 h-6 w-full max-w-2xl rounded-full" />}
      {panel && <Skeleton className="mb-4 h-56 w-full rounded-2xl" />}
      <Skeleton className="h-80 w-full rounded-2xl" />
    </div>
  );
}

/** The standard Access Denied card. */
export function AccessDeniedCard({ message = 'You do not have permission to view this report.' }: { message?: string }) {
  return (
    <Card className={dailySurfaceCardClass}>
      <CardHeader>
        <CardTitle>Access Denied</CardTitle>
        <CardDescription>{message}</CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center p-8">
        <ShieldAlert className="h-16 w-16 text-destructive" aria-hidden="true" />
      </CardContent>
    </Card>
  );
}

/** No permission: the report's header, back to Daily Requisition, over the Access Denied card. */
export function ReportAccessDenied({ title, description, message }: { title: string; description?: string; message?: string }) {
  return (
    <div className={dailyPageContainerClass}>
      <PageHeader
        eyebrow="Daily Requisition"
        title={title}
        description={description}
        backHref="/daily-requisition"
        backLabel="Back to Daily Requisition"
      />
      <AccessDeniedCard message={message} />
    </div>
  );
}
