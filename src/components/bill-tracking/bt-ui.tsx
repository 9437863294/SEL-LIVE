'use client';

/**
 * Shared presentation pieces for Bill Tracking: amounts, status badges, states, the FY picker and
 * export. Built on the app's shared kit (`StatusBadge`, `KpiCard`, `TableCard`) so the module looks
 * like the rest of SEL LIVE.
 */

import Link from 'next/link';
import { AlertTriangle, CalendarRange, Download, FileSpreadsheet, FileText, Inbox, Loader2, Printer, ShieldAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { KpiCard, type Tone } from '@/components/shared/kpi-card';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatINR, formatINRCompact } from '@/lib/bill-tracking/money';
import { financialYearOptions } from '@/lib/bill-tracking/calculations';
import {
  CERTIFICATION_STATE_LABELS,
  PAYMENT_STATUS_LABELS,
  TRANSACTION_TYPE_LABELS,
  WORKFLOW_STATUS_LABELS,
  type BillPaymentStatus,
  type BillTransactionType,
  type BillWorkflowStatus,
  type CertificationState,
} from '@/lib/bill-tracking/types';
import { exportWorkbook } from '@/lib/report-excel';
import { openPrintWindow } from '@/lib/open-print-window';
import { cn } from '@/lib/utils';

/* ── amounts ─────────────────────────────────────────────────────────────── */

/**
 * An amount. Compact (₹12.43 Cr) where space is tight, with the exact figure on hover; exact
 * (₹1,24,30,000) in tables and on the bill. Negative amounts keep their sign — a credit note is
 * shown as one.
 */
export function Amount({ value, compact = false, className, muted = false, signed = false }: { value: number | null | undefined; compact?: boolean; className?: string; muted?: boolean; signed?: boolean }) {
  if (value === null || value === undefined || Number.isNaN(value)) return <span className={cn('text-muted-foreground', className)}>—</span>;
  const text = compact ? formatINRCompact(value) : formatINR(value);
  return (
    <span title={formatINR(value, { paise: true })} className={cn('tabular-nums whitespace-nowrap', muted && value === 0 && 'text-muted-foreground', signed && value < 0 && 'text-rose-600', className)}>
      {text}
    </span>
  );
}

export const percentText = (value: number | null | undefined) => (value === null || value === undefined ? '—' : `${value.toFixed(1)}%`);

export const dateText = (key: string | undefined | null) => {
  if (!key) return '—';
  const [year, month, day] = key.slice(0, 10).split('-').map(Number);
  if (!year) return key;
  return new Date(year, month - 1, day).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const dateTimeText = (iso: string | undefined | null) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

/* ── badges ──────────────────────────────────────────────────────────────── */

const PAYMENT_TONES: Record<BillPaymentStatus, StatusTone> = {
  not_received: 'danger',
  partially_received: 'warning',
  received: 'success',
  over_received: 'info',
  adjusted: 'neutral',
  cancelled: 'neutral',
};

export function PaymentStatusBadge({ status, overridden }: { status: BillPaymentStatus; overridden?: boolean }) {
  return (
    <StatusBadge tone={PAYMENT_TONES[status]} dot title={overridden ? 'Set by a finance override — see the bill’s activity for the reason' : undefined}>
      {PAYMENT_STATUS_LABELS[status]}
      {overridden ? ' *' : ''}
    </StatusBadge>
  );
}

const WORKFLOW_TONES: Record<BillWorkflowStatus, StatusTone> = {
  draft: 'neutral',
  submitted: 'info',
  under_verification: 'info',
  verified: 'progress',
  approved: 'success',
  raised: 'progress',
  certified: 'success',
  payment_followup: 'warning',
  reconciliation: 'info',
  closed: 'success',
  returned: 'danger',
};

const CERTIFICATION_TONES: Record<CertificationState, StatusTone> = {
  not_certified: 'neutral',
  matched: 'success',
  adjustment_pending: 'progress',
};

/** Awaiting certification / certified and matched / certified with a note still to raise. */
export function CertificationBadge({ state }: { state: CertificationState }) {
  return (
    <StatusBadge tone={CERTIFICATION_TONES[state]} dot>
      {CERTIFICATION_STATE_LABELS[state]}
    </StatusBadge>
  );
}

export function WorkflowStatusBadge({ status }: { status: BillWorkflowStatus }) {
  return <StatusBadge tone={WORKFLOW_TONES[status]}>{WORKFLOW_STATUS_LABELS[status]}</StatusBadge>;
}

const AGEING_TONES: StatusTone[] = ['success', 'info', 'warning', 'warning', 'danger', 'danger'];

export function AgeingBadge({ label, days, buckets }: { label: string; days?: number; buckets: { label: string }[] }) {
  if (!label) return <span className="text-muted-foreground">—</span>;
  const index = Math.max(0, buckets.findIndex((bucket) => bucket.label === label));
  return (
    <StatusBadge tone={AGEING_TONES[Math.min(index, AGEING_TONES.length - 1)]} title={days !== undefined ? `${days} days` : undefined}>
      {label}
      {days !== undefined ? <span className="ml-1 font-normal opacity-75">· {days}d</span> : null}
    </StatusBadge>
  );
}

export function TransactionTypeBadge({ type }: { type: BillTransactionType }) {
  if (type === 'invoice') return null;
  return <StatusBadge tone={type === 'credit_note' ? 'danger' : type === 'retention_bill' ? 'progress' : 'info'}>{TRANSACTION_TYPE_LABELS[type]}</StatusBadge>;
}

/** A finance term with its definition on hover. */
export function Term({ children, tip }: { children: React.ReactNode; tip: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help underline decoration-dotted decoration-muted-foreground/50 underline-offset-4">{children}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">{tip}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Long text kept to one line in a table cell — cut with "…" at `className`'s max width — with the
 * whole text in a popup on hover (or keyboard focus).
 */
export function TruncatedText({ text, className }: { text: string | null | undefined; className?: string }) {
  if (!text) return <span className="text-muted-foreground">—</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className={cn('block cursor-default truncate whitespace-nowrap outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-emerald-500/40', className)}>
          {text}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm break-words text-xs">{text}</TooltipContent>
    </Tooltip>
  );
}

/* ── KPI ─────────────────────────────────────────────────────────────────── */

export function MoneyKpi({ label, value, hint, icon, tone = 'slate', href, compact = true }: { label: string; value: number | null | undefined; hint?: string; icon?: React.ElementType; tone?: Tone; href?: string; compact?: boolean }) {
  return <KpiCard label={label} value={<Amount value={value} compact={compact} />} hint={hint} icon={icon} tone={tone} href={href} />;
}

export interface StatItem {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  /** Text colour of the value, e.g. `text-emerald-700`. */
  tone?: string;
}

// Columns per item count, and a span for the last item where a row would otherwise end short and
// show the grey hairline background as an empty cell. Static strings so Tailwind sees them all.
const STAT_LAYOUT: Record<number, { grid: string; last?: string }> = {
  2: { grid: 'grid-cols-2' },
  3: { grid: 'grid-cols-2 sm:grid-cols-3', last: 'col-span-2 sm:col-span-1' },
  4: { grid: 'grid-cols-2 sm:grid-cols-4' },
  5: { grid: 'grid-cols-2 sm:grid-cols-5', last: 'col-span-2 sm:col-span-1' },
  6: { grid: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6' },
  7: { grid: 'grid-cols-2 sm:grid-cols-4 xl:grid-cols-7', last: 'col-span-2 xl:col-span-1' },
  8: { grid: 'grid-cols-2 sm:grid-cols-4' },
};

/**
 * A row of headline figures in one frame, split by hairlines — lighter than a row of KPI cards, for
 * the totals above a register or the amounts at the top of a bill.
 */
export function StatStrip({ items, className }: { items: StatItem[]; className?: string }) {
  const layout = STAT_LAYOUT[items.length] ?? { grid: 'grid-cols-2 sm:grid-cols-4' };
  return (
    <dl className={cn('grid gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 shadow-sm', layout.grid, className)}>
      {items.map((item, index) => (
        <div key={index} className={cn('min-w-0 bg-white px-3.5 py-3', index === items.length - 1 && layout.last)}>
          <dt className="truncate text-[11px] font-medium uppercase tracking-wide text-slate-500">{item.label}</dt>
          <dd className={cn('mt-1 truncate text-base font-semibold tabular-nums', item.tone ?? 'text-slate-900')}>{item.value}</dd>
          {item.hint ? <dd className="mt-0.5 truncate text-[11px] text-slate-400">{item.hint}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

/* ── forms ───────────────────────────────────────────────────────────────── */

/**
 * One card of a form: a numbered (or icon) header strip with the title, a line of help and any
 * actions, then the fields. Every Bill Tracking form is built from these so they read alike.
 */
export function FormSection({
  step,
  icon: Icon,
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  step?: number;
  icon?: React.ElementType;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn('min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm', className)}>
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 border-b border-slate-100 px-4 py-3">
        <div className="flex min-w-0 flex-1 basis-56 items-start gap-2.5">
          {step !== undefined ? (
            <span className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-semibold text-white" aria-hidden="true">
              {step}
            </span>
          ) : Icon ? (
            <span className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700" aria-hidden="true">
              <Icon className="h-3.5 w-3.5" />
            </span>
          ) : null}
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold leading-6 text-slate-900">{title}</h3>
            {description ? <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{description}</p> : null}
          </div>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      <div className={cn('space-y-4 p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

/**
 * Field widths sized to what goes in them, for fields laid out in a `FIELD_ROW` (a wrapping row).
 * Full width on a phone; from `sm` each takes its own width, so a date is a date's width and a
 * project name gets room, instead of every field stretching to a third of the form.
 */
export const FIELD_WIDTHS = {
  /** Week, rate %, a short code. */
  short: 'w-full sm:w-32',
  /** A date, a switch with a word beside it. */
  date: 'w-full sm:w-44',
  /** An amount. */
  amount: 'w-full sm:w-52',
  /** A dropdown, an invoice or reference number. */
  medium: 'w-full sm:w-60',
  /** A project, client or registration name. */
  wide: 'w-full sm:w-80',
  /** Free text that takes the rest of the row. */
  grow: 'w-full sm:min-w-[16rem] sm:flex-1',
} as const;
export type FieldWidth = keyof typeof FIELD_WIDTHS;

/** The row fields with a `width` sit in: left to right, wrapping, tops aligned. */
export const FIELD_ROW = 'flex flex-wrap items-start gap-x-4 gap-y-4';

/**
 * A labelled field. A label written as "Project *" shows a red required marker instead of the
 * asterisk text; the hint sits under the control. `width` sizes it inside a `FIELD_ROW`.
 */
export function FormField({ label, hint, htmlFor, children, className, width }: { label: React.ReactNode; hint?: React.ReactNode; htmlFor?: string; children: React.ReactNode; className?: string; width?: FieldWidth }) {
  const required = typeof label === 'string' && label.endsWith(' *');
  return (
    <div className={cn('min-w-0 space-y-1.5', width && FIELD_WIDTHS[width], className)}>
      <Label htmlFor={htmlFor} className="flex min-h-4 items-center gap-0.5 text-xs font-medium leading-4 text-slate-700">
        {required ? (label as string).slice(0, -2) : label}
        {required ? (
          <span className="text-rose-600" aria-hidden="true">
            *
          </span>
        ) : null}
      </Label>
      {children}
      {hint ? <div className="text-[11px] leading-snug text-slate-500">{hint}</div> : null}
    </div>
  );
}

/* ── tabs ────────────────────────────────────────────────────────────────── */

/** A tab strip that scrolls sideways on a phone rather than wrapping into rows. */
export const BT_TABS_LIST = 'flex h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm';
// The active tab is painted by the app's sliding indicator (ui/tabs.tsx); an active background here
// would cover it and leave its light text on a light fill.
export const BT_TAB = 'shrink-0 gap-1.5';

export function TabCount({ value }: { value: number }) {
  return <span className="rounded-full bg-slate-100 px-1.5 text-[10px] font-semibold leading-4 text-slate-600">{value.toLocaleString('en-IN')}</span>;
}

/* ── states ──────────────────────────────────────────────────────────────── */

export function BtLoading({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <div className={cn('flex min-h-[30vh] items-center justify-center gap-2 text-sm text-muted-foreground', className)} role="status">
      <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
      {label}
    </div>
  );
}

export function BtError({ message, onRetry }: { message: string | null | undefined; onRetry?: () => void }) {
  if (!message) return null;
  return (
    <div role="alert" className="flex flex-wrap items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="min-w-0 flex-1">{message}</p>
      {onRetry ? (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export function BtEmpty({ title, description, icon: Icon = Inbox, action }: { title: string; description?: string; icon?: React.ElementType; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
      <Icon className="h-9 w-9 text-muted-foreground/60" />
      <p className="font-medium text-slate-700">{title}</p>
      {description ? <p className="max-w-md text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function BtAccessDenied({ what = 'this page' }: { what?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white py-16 text-center shadow-sm">
      <ShieldAlert className="mx-auto h-12 w-12 text-destructive" />
      <p className="mt-3 font-semibold text-slate-800">Access denied</p>
      <p className="mt-1 text-sm text-muted-foreground">You do not have permission to view {what}. Ask your administrator for the Bill Tracking permission.</p>
    </div>
  );
}

export function Notice({ tone = 'amber', title, children }: { tone?: 'amber' | 'rose' | 'blue' | 'emerald'; title?: string; children: React.ReactNode }) {
  const tones = {
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    rose: 'border-rose-200 bg-rose-50 text-rose-900',
    blue: 'border-sky-200 bg-sky-50 text-sky-900',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  };
  return (
    <div className={cn('rounded-lg border p-3 text-sm', tones[tone])}>
      {title ? <p className="font-semibold">{title}</p> : null}
      <div className={title ? 'mt-1' : undefined}>{children}</div>
    </div>
  );
}

/* ── FY picker ───────────────────────────────────────────────────────────── */

export function FySelect({ value, onChange, allowAll = true, className }: { value: string; onChange: (value: string) => void; allowAll?: boolean; className?: string }) {
  const options = financialYearOptions();
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={cn('h-9 w-full gap-1.5 bg-white text-sm font-medium shadow-sm sm:w-auto sm:min-w-[8.5rem]', className)} aria-label="Financial year">
        <CalendarRange className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-left">
          <SelectValue placeholder="FY" />
        </span>
      </SelectTrigger>
      <SelectContent>
        {allowAll ? <SelectItem value="all">All years</SelectItem> : null}
        {options.map((fy) => (
          <SelectItem key={fy} value={fy}>
            FY {fy}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/* ── export ──────────────────────────────────────────────────────────────── */

export interface ExportColumn<T> {
  key: string;
  label: string;
  value: (row: T) => string | number | null | undefined;
  align?: 'left' | 'right';
  /** Amount columns are written as numbers to Excel and formatted ₹ in print. */
  money?: boolean;
}

export interface ExportSpec<T> {
  title: string;
  fileName: string;
  columns: ExportColumn<T>[];
  rows: T[];
  /** The filters in force, printed so the page still makes sense next year. */
  meta?: { label: string; value: string }[];
  totals?: Record<string, number | string>;
  generatedBy?: string;
}

const csvCell = (value: unknown) => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function downloadCsv<T>(spec: ExportSpec<T>) {
  const lines = [spec.columns.map((column) => csvCell(column.label)).join(',')];
  for (const row of spec.rows) lines.push(spec.columns.map((column) => csvCell(column.value(row))).join(','));
  if (spec.totals) lines.push(spec.columns.map((column, index) => csvCell(index === 0 ? 'Total' : spec.totals?.[column.key] ?? '')).join(','));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${spec.fileName}.csv`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function downloadExcel<T>(spec: ExportSpec<T>) {
  const rows = spec.rows.map((row) => Object.fromEntries(spec.columns.map((column) => [column.key, column.value(row) ?? ''])));
  if (spec.totals) rows.push(Object.fromEntries(spec.columns.map((column, index) => [column.key, index === 0 ? 'Total' : spec.totals?.[column.key] ?? ''])));
  await exportWorkbook(`${spec.fileName}.xlsx`, [
    {
      name: spec.title.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '),
      columns: spec.columns.map((column) => ({ header: column.label, key: column.key, width: Math.min(Math.max(column.label.length + 4, column.money ? 16 : 12), 48) })),
      rows,
    },
  ]);
}

/** SEL-branded A4 print: title, filters, as-on date, generated on/by, page numbers, totals. */
export function printReport<T>(spec: ExportSpec<T>): boolean {
  const fmt = (column: ExportColumn<T>, value: unknown) => (column.money && typeof value === 'number' ? formatINR(value) : value === null || value === undefined ? '' : String(value));
  return openPrintWindow({
    title: spec.title,
    subtitle: 'SEL LIVE · Bill Tracking & Collection Management',
    meta: spec.meta,
    columns: spec.columns.map((column) => ({ key: column.key, label: column.label, align: column.align ?? (column.money ? 'right' : 'left') })),
    rows: spec.rows.map((row) => Object.fromEntries(spec.columns.map((column) => [column.key, fmt(column, column.value(row))]))),
    totals: spec.totals ? Object.fromEntries(spec.columns.map((column) => [column.key, fmt(column, spec.totals?.[column.key])])) : undefined,
    generatedOn: new Date().toLocaleString('en-IN'),
    generatedBy: spec.generatedBy,
  });
}

export function ExportMenu<T>({ spec, extra, disabled, loadAll }: { spec: () => ExportSpec<T> | Promise<ExportSpec<T>>; extra?: { label: string; onSelect: () => void }[]; disabled?: boolean; loadAll?: boolean }) {
  const run = async (kind: 'excel' | 'csv' | 'print') => {
    const resolved = await spec();
    if (kind === 'excel') await downloadExcel(resolved);
    else if (kind === 'csv') downloadCsv(resolved);
    else if (!printReport(resolved)) window.alert('Allow pop-ups for this site to print the report.');
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled} className="h-9 gap-1.5">
          <Download className="h-4 w-4" />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {loadAll ? <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">All rows matching the current filters</DropdownMenuLabel> : null}
        <DropdownMenuItem onSelect={() => void run('excel')}>
          <FileSpreadsheet className="mr-2 h-4 w-4" /> Excel (.xlsx)
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void run('csv')}>
          <FileText className="mr-2 h-4 w-4" /> CSV
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void run('print')}>
          <Printer className="mr-2 h-4 w-4" /> Print / PDF
        </DropdownMenuItem>
        {extra?.length ? <DropdownMenuSeparator /> : null}
        {extra?.map((item) => (
          <DropdownMenuItem key={item.label} onSelect={item.onSelect}>
            <FileSpreadsheet className="mr-2 h-4 w-4" /> {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A link styled as a plain cell value — for drill-downs inside tables. */
export function DrillLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn('font-medium text-emerald-700 hover:underline', className)}>
      {children}
    </Link>
  );
}

/** Builds a `?a=1&b=2` query from a filter object, skipping empty values. */
export function toQuery(values: Record<string, string | number | boolean | undefined | null | string[]>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    if (Array.isArray(value)) {
      if (value.length) params.set(key, value.join(','));
    } else params.set(key, String(value === true ? '1' : value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}
