'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Table2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

/**
 * Chart parameters for the module, validated rather than eyeballed.
 *
 * `series` (2 categorical slots) clears all six categorical checks on a white surface — worst
 * adjacent CVD ΔE 31.3 (protanopia), normal-vision ΔE 39.6, both marks above 3:1 contrast.
 * `ramp` is the ordinal ramp for genuinely ordered bands (ageing buckets): monotone lightness,
 * every adjacent ΔL ≥ 0.06, light end 2.11:1 against white. Both were produced by
 * `validate_palette.js`; re-run it if either is changed.
 *
 * `status` is the fixed scale the rest of this ERP already uses (Vehicle Management, Insurance,
 * Fixed Deposit). Status colour never carries meaning alone here — every use ships an icon and a
 * label, which is also what covers amber sitting below 3:1 on white.
 */
export const EA_VIZ = {
  surface: '#ffffff',
  grid: '#e2e8f0',
  axis: '#94a3b8',
  series: ['#2563eb', '#ea580c'] as const,
  ramp: ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281'] as const,
  status: {
    good: '#10b981',
    warning: '#f59e0b',
    critical: '#e11d48',
    neutral: '#94a3b8',
  },
} as const;

/** 1,284 · 12.9K · 1.3M — so a tile never wraps. */
export const compactCount = (value: number): string => {
  if (Math.abs(value) < 1000) return String(value);
  if (Math.abs(value) < 1_000_000) return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}K`;
  return `${(value / 1_000_000).toFixed(1)}M`;
};

/** ₹2.5L · ₹1.4Cr — Indian magnitudes, because ₹25,00,000 in a tile is unreadable at a glance. */
export const compactRupees = (value: number): string => {
  const amount = Math.abs(value);
  if (amount >= 10_000_000) return `₹${(value / 10_000_000).toFixed(2)}Cr`;
  if (amount >= 100_000) return `₹${(value / 100_000).toFixed(2)}L`;
  if (amount >= 1000) return `₹${(value / 1000).toFixed(1)}K`;
  return `₹${Math.round(value)}`;
};

/**
 * The one number the dashboard leads with (exactly one per view).
 *
 * Proportional figures, not `tabular-nums`: equal-width digits make a three-digit number look
 * loose at display size. Same sans as the rest of the app — a display face here reads as decoration.
 */
export function HeroFigure({
  value,
  label,
  caption,
  href,
  isLoading,
  tone = 'default',
}: {
  value: number;
  label: string;
  caption?: string;
  href?: string;
  isLoading?: boolean;
  tone?: 'default' | 'critical';
}) {
  const body = (
    <>
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      {isLoading ? (
        <Skeleton className="mt-1 h-12 w-24" />
      ) : (
        <p
          className={cn(
            'mt-0.5 text-5xl font-semibold leading-none tracking-tight',
            tone === 'critical' && value > 0 ? 'text-rose-600' : 'text-slate-900',
          )}
        >
          {value}
        </p>
      )}
      {caption && <p className="mt-1.5 text-xs text-muted-foreground">{caption}</p>}
    </>
  );
  if (!href) return <div className="min-w-0">{body}</div>;
  return (
    <Link href={href} className="group min-w-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
      {body}
      <span className="mt-1 inline-block text-xs font-medium text-sky-700 group-hover:underline">Open inbox →</span>
    </Link>
  );
}

export type TriageTone = 'critical' | 'warning' | 'good';

const triageIcon: Record<TriageTone, typeof AlertTriangle> = {
  critical: AlertTriangle,
  warning: Clock,
  good: CheckCircle2,
};

const triageClass: Record<TriageTone, string> = {
  critical: 'border-rose-200 bg-rose-50 text-rose-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  good: 'border-emerald-200 bg-emerald-50 text-emerald-800',
};

/**
 * One SLA bucket. Icon + label + count, never colour alone — which is both the status rule and the
 * reason amber is legible here despite sitting below 3:1 on white.
 */
export function TriageChip({
  tone,
  label,
  count,
  href,
  isLoading,
}: {
  tone: TriageTone;
  label: string;
  count: number;
  href?: string;
  isLoading?: boolean;
}) {
  const Icon = triageIcon[tone];
  const content = (
    <>
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0 truncate text-xs font-medium">{label}</span>
      <span className="ml-auto text-sm font-semibold tabular-nums">{isLoading ? '…' : count}</span>
    </>
  );
  const className = cn(
    'flex items-center gap-2 rounded-lg border px-2.5 py-2 transition-colors',
    triageClass[tone],
    href && 'hover:brightness-[0.98]',
  );
  return href ? (
    <Link href={href} className={className}>
      {content}
    </Link>
  ) : (
    <div className={className}>{content}</div>
  );
}

/**
 * Stat tile: label, value, and an optional signed delta against a named period.
 *
 * The delta's colour follows direction × whether up is good, so "12 more overdue" is never green.
 */
export function StatTile({
  label,
  value,
  hint,
  delta,
  upIsGood = true,
  href,
  isLoading,
}: {
  label: string;
  value: string | number;
  hint?: string;
  delta?: { value: number; period: string };
  upIsGood?: boolean;
  href?: string;
  isLoading?: boolean;
}) {
  const good = delta ? (delta.value >= 0 ? upIsGood : !upIsGood) : true;
  const body = (
    <>
      <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      {isLoading ? (
        <Skeleton className="mt-1 h-7 w-16" />
      ) : (
        <p className="mt-0.5 text-2xl font-semibold leading-none tracking-tight text-slate-900">{value}</p>
      )}
      <div className="mt-1 flex min-h-[16px] flex-wrap items-baseline gap-x-1.5">
        {delta && delta.value !== 0 && !isLoading && (
          <span className={cn('text-[11px] font-semibold', good ? 'text-emerald-700' : 'text-rose-700')}>
            {delta.value > 0 ? '+' : ''}
            {delta.value} <span className="font-normal text-muted-foreground">vs {delta.period}</span>
          </span>
        )}
        {hint && !delta && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
    </>
  );
  const className =
    'min-w-0 rounded-xl border bg-background p-2.5 shadow-sm transition-transform hover:-translate-y-0.5';
  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

/**
 * A chart card with a table-view twin.
 *
 * The toggle is not a nicety: it is what keeps every value reachable without relying on colour or a
 * tooltip, which is the accessibility floor for a chart — and the relief channel that licenses a
 * light fill sitting under 3:1 on white.
 */
export function ChartCard({
  title,
  description,
  isLoading,
  chart,
  tableColumns,
  tableRows,
  emptyMessage = 'Nothing to show yet.',
  className,
  action,
}: {
  title: string;
  description?: string;
  isLoading?: boolean;
  chart: ReactNode;
  tableColumns?: string[];
  tableRows?: Array<Array<string | number>>;
  emptyMessage?: string;
  className?: string;
  action?: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  const hasData = (tableRows?.length ?? 0) > 0;

  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 px-3 py-2.5 sm:px-4 sm:py-3">
        <div className="min-w-0">
          <CardTitle className="text-sm">{title}</CardTitle>
          {description && <CardDescription className="text-xs">{description}</CardDescription>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {action}
          {tableColumns && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className={cn('h-7 gap-1 px-2 text-[11px]', asTable && 'bg-muted')}
              onClick={() => setAsTable((value) => !value)}
              aria-pressed={asTable}
            >
              <Table2 className="h-3.5 w-3.5" />
              {asTable ? 'Chart' : 'Table'}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-1 pb-3 sm:px-3">
        {isLoading ? (
          <Skeleton className="mx-2 h-[220px]" />
        ) : !hasData ? (
          <p className="px-3 py-12 text-center text-sm text-muted-foreground">{emptyMessage}</p>
        ) : asTable && tableColumns ? (
          <div className="overflow-x-auto px-2">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  {tableColumns.map((column, index) => (
                    <TableHead key={column} className={index === 0 ? '' : 'text-right'}>
                      {column}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {tableRows?.map((row) => (
                  <TableRow key={String(row[0])}>
                    {row.map((cell, index) => (
                      <TableCell
                        key={index}
                        className={cn('text-xs', index === 0 ? 'font-medium' : 'text-right tabular-nums')}
                      >
                        {cell}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          chart
        )}
      </CardContent>
    </Card>
  );
}

/** Recharts tooltip, restyled once so every chart in the module shares it. */
export const eaTooltipStyle = {
  contentStyle: {
    borderRadius: 8,
    border: '1px solid #e2e8f0',
    fontSize: 12,
    padding: '6px 10px',
    boxShadow: '0 6px 16px -8px rgba(15,23,42,0.25)',
  },
  labelStyle: { fontWeight: 600, color: '#0f172a', marginBottom: 2 },
} as const;
