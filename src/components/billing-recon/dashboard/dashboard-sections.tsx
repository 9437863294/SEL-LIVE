'use client';

/**
 * The detail panels of Billing Recon's dashboards. Figures come from
 * src/lib/billing-recon/dashboard-detail.ts; colours follow br-charts.tsx (executed blue, certified
 * orange, billed aqua). Ageing uses a one-hue ordinal ramp (validated light and dark: monotone
 * lightness, light end ≥ 2:1 against the surface), so the order reads in the colour, and every bar
 * also carries its count and value as text.
 */

import type { ElementType, ReactNode } from 'react';
import { ArrowRight, Clock, FileWarning, ListChecks, Receipt, Scale, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DataList, type ListColumn } from '@/components/shared/data-list';
import { StatusBadge } from '@/components/shared/status-badge';
import { useTheme } from '@/components/theme/ThemeProvider';
import { cn } from '@/lib/utils';
import type { StatusTone } from '@/lib/status-tone';
import { percent } from '@/lib/billing-recon/dashboard';
import type {
  AgeBucket,
  BillRow,
  ExceptionKind,
  ExceptionSummary,
  PeriodComparison,
  PeriodFigures,
  ScopeRow,
  StatusRow,
} from '@/lib/billing-recon/dashboard-detail';
import { compactInr, formatInr, useBrSeries } from './br-charts';

const AGE_RAMP = {
  light: ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281'],
  dark: ['#184f95', '#256abf', '#3987e5', '#6da7ec', '#9ec5f4'],
} as const;

function Panel({
  title,
  description,
  icon: Icon,
  className,
  bodyClassName,
  children,
}: {
  title: string;
  description?: string;
  icon?: ElementType;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <Card className={cn('min-w-0 shadow-sm', className)}>
      <CardHeader className="space-y-1 p-4 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          {Icon && <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />}
          {title}
        </CardTitle>
        {description && <CardDescription className="text-xs">{description}</CardDescription>}
      </CardHeader>
      <CardContent className={cn('p-4 pt-2', bodyClassName)}>{children}</CardContent>
    </Card>
  );
}

export const statusTone = (status: string): StatusTone => {
  switch (status.toLowerCase()) {
    case 'pending':
      return 'warning';
    case 'in progress':
      return 'progress';
    case 'needs review':
      return 'info';
    case 'completed':
    case 'certified':
    case 'submitted':
      return 'success';
    case 'rejected':
      return 'danger';
    default:
      return 'neutral';
  }
};

/* ── BOQ → executed → certified → billed ───────────────────────────────────────────────────── */

export function ConversionPanel({ boq, executed, certified, billed, boqLoaded }: { boq: number; executed: number; certified: number; billed: number; boqLoaded: boolean }) {
  const series = useBrSeries();
  const base = Math.max(boq, executed, certified, billed, 1);
  const steps = [
    ...(boqLoaded ? [{ label: 'BOQ value', value: boq, color: 'hsl(var(--muted-foreground))', ratio: null as string | null }] : []),
    { label: 'Executed', value: executed, color: series.executed, ratio: boqLoaded && boq ? `${percent(executed, boq)}% of BOQ` : null },
    { label: 'Certified', value: certified, color: series.certified, ratio: `${percent(certified, executed)}% of executed` },
    { label: 'Billed', value: billed, color: series.billed, ratio: `${percent(billed, certified)}% of certified` },
  ];
  return (
    <Panel title="From BOQ to billed" description="How far the work has moved through measurement, client certification and billing." icon={TrendingUp}>
      <div className="space-y-3.5">
        {steps.map((step, i) => (
          <div key={step.label} className="space-y-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                {i > 0 && <ArrowRight className="h-3 w-3" aria-hidden />}
                {step.label}
              </span>
              <span className="flex items-baseline gap-2">
                {step.ratio && <span className="text-xs text-muted-foreground">{step.ratio}</span>}
                <span className="font-semibold tabular-nums text-foreground">{formatInr(step.value)}</span>
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted" role="presentation">
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, (step.value / base) * 100)}%`, backgroundColor: step.color }} />
            </div>
          </div>
        ))}
        {!boqLoaded && <p className="text-xs text-muted-foreground">BOQ value is shown once the BOQ has loaded.</p>}
      </div>
    </Panel>
  );
}

/* ── this month / last month / FY ──────────────────────────────────────────────────────────── */

const PERIOD_ROWS: Array<{ key: keyof PeriodFigures; label: string; money?: boolean }> = [
  { key: 'jmcRaised', label: 'JMC raised' },
  { key: 'mvacRaised', label: 'MVAC raised' },
  { key: 'executed', label: 'Executed value', money: true },
  { key: 'certified', label: 'Certified value', money: true },
  { key: 'bills', label: 'RA bills' },
  { key: 'billed', label: 'Billed value', money: true },
];

function Delta({ now, before }: { now: number; before: number }) {
  if (!before && !now) return null;
  if (!before) return <span className="text-[11px] text-muted-foreground">new</span>;
  const change = Math.round(((now - before) / before) * 100);
  if (change === 0) return <span className="text-[11px] text-muted-foreground">±0%</span>;
  return (
    <span className={cn('text-[11px] tabular-nums', change > 0 ? 'text-emerald-600' : 'text-rose-600')}>
      {change > 0 ? '▲' : '▼'} {Math.abs(change)}%
    </span>
  );
}

export function PeriodPanel({ comparison }: { comparison: PeriodComparison }) {
  const cols: Array<{ label: string; figures: PeriodFigures; delta?: boolean }> = [
    { label: comparison.thisMonthLabel, figures: comparison.thisMonth, delta: true },
    { label: comparison.lastMonthLabel, figures: comparison.lastMonth },
    { label: comparison.financialYearLabel, figures: comparison.financialYear },
  ];
  return (
    <Panel title="This month, last month, this year" description="By JMC / MVAC date and bill date. The arrow compares with last month." icon={Clock} bodyClassName="p-0 sm:p-4 sm:pt-2">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[26rem] text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="px-4 py-2 text-left font-medium sm:px-2" />
              {cols.map((c) => (
                <th key={c.label} className="px-3 py-2 text-right font-medium">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERIOD_ROWS.map((row) => (
              <tr key={row.key} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-2 text-muted-foreground sm:px-2">{row.label}</td>
                {cols.map((c) => (
                  <td key={c.label} className="px-3 py-2 text-right">
                    <div className="font-medium tabular-nums text-foreground">{row.money ? compactInr(c.figures[row.key]) : c.figures[row.key].toLocaleString('en-IN')}</div>
                    {c.delta && <Delta now={c.figures[row.key]} before={comparison.lastMonth[row.key]} />}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/* ── ageing ─────────────────────────────────────────────────────────────────────────────────── */

export function AgeingPanel({ buckets, undated }: { buckets: AgeBucket[]; undated: number }) {
  const { resolvedMode } = useTheme();
  const ramp = AGE_RAMP[resolvedMode === 'dark' ? 'dark' : 'light'];
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const total = buckets.reduce((s, b) => s + b.count, 0);
  return (
    <Panel title="How long open entries have waited" description="Open JMC and MVAC entries by days since they were raised." icon={Clock}>
      {total === 0 && undated === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No open entries.</p>
      ) : (
        <div className="space-y-3">
          {buckets.map((b, i) => (
            <div key={b.key} className="space-y-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                <span className="text-muted-foreground">{b.label}</span>
                <span className="flex items-baseline gap-2 tabular-nums">
                  <span className="text-xs text-muted-foreground">
                    {b.jmc} JMC · {b.mvac} MVAC{b.overdue ? <span className="text-destructive"> · {b.overdue} overdue</span> : null}
                  </span>
                  <span className="font-semibold text-foreground">{b.count}</span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted" role="presentation">
                  <div className="h-full rounded-full" style={{ width: `${(b.count / max) * 100}%`, backgroundColor: ramp[i] }} />
                </div>
                <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{compactInr(b.value)}</span>
              </div>
            </div>
          ))}
          {undated > 0 && <p className="text-xs text-muted-foreground">{undated} open entries have no date and are not shown.</p>}
        </div>
      )}
    </Panel>
  );
}

/* ── status breakdown ───────────────────────────────────────────────────────────────────────── */

export function StatusPanel({ rows }: { rows: StatusRow[] }) {
  const series = useBrSeries();
  const max = Math.max(1, ...rows.map((r) => r.jmc + r.mvac));
  return (
    <Panel title="Entries by status" description="Every JMC and MVAC entry, open or closed." icon={ListChecks}>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No entries yet.</p>
      ) : (
        <div className="space-y-2.5">
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: series.executed }} /> JMC
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: series.certified }} /> MVAC
            </span>
          </div>
          {rows.map((r) => (
            <div key={r.status} className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-3 text-sm">
              <StatusBadge tone={statusTone(r.status)} status={r.status} className="justify-self-start" />
              <div className="flex h-2.5 overflow-hidden rounded-full bg-muted" role="presentation">
                <div style={{ width: `${(r.jmc / max) * 100}%`, backgroundColor: series.executed }} />
                <div className="border-l-2 border-card" style={{ width: `${(r.mvac / max) * 100}%`, backgroundColor: series.certified }} />
              </div>
              <span className="w-24 text-right text-xs tabular-nums text-muted-foreground">
                <span className="font-semibold text-foreground">{r.jmc + r.mvac}</span> · {r.jmc} / {r.mvac}
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/* ── scopes waiting to be billed ────────────────────────────────────────────────────────────── */

export function ScopesPanel({ rows, showProject }: { rows: ScopeRow[]; showProject: boolean }) {
  const columns: ListColumn<ScopeRow>[] = [
    {
      header: 'Scope',
      mobile: 'title',
      cell: (r) => (
        <div className="min-w-0">
          <span className="block truncate font-medium text-foreground">{[r.scope2, r.scope1].filter(Boolean).join(' › ') || 'No scope'}</span>
          {showProject && <span className="block truncate text-xs text-muted-foreground">{r.projectName}</span>}
        </div>
      ),
    },
    { header: 'Items', align: 'right', cell: (r) => <span className="tabular-nums">{r.items}</span> },
    { header: 'BOQ', align: 'right', cell: (r) => <span className="tabular-nums">{compactInr(r.boqValue)}</span> },
    { header: 'Certified', align: 'right', cell: (r) => <span className="tabular-nums">{compactInr(r.certifiedValue)}</span> },
    { header: 'Billed', align: 'right', cell: (r) => <span className="tabular-nums">{compactInr(r.billedValue)}</span> },
    { header: 'To certify', align: 'right', cell: (r) => <span className="tabular-nums text-muted-foreground">{compactInr(r.toCertifyValue)}</span> },
    { header: 'To bill', align: 'right', mobile: 'aside', cell: (r) => <span className="font-semibold tabular-nums text-foreground">{compactInr(r.toBillValue)}</span> },
  ];
  return (
    <Panel title="Scopes waiting to be billed" description="Certified value not yet on an RA bill, by BOQ scope, at BOQ rates." icon={Receipt} bodyClassName="p-0 sm:p-4 sm:pt-2">
      <DataList rows={rows} columns={columns} dense empty="Nothing certified is waiting to be billed." />
    </Panel>
  );
}

/* ── exceptions ─────────────────────────────────────────────────────────────────────────────── */

const EXCEPTION_TONE: Record<ExceptionKind, StatusTone> = {
  'Over-executed': 'warning',
  'Over-billed': 'danger',
  'Duplicate SL No': 'info',
  'Unmatched line': 'neutral',
};

const EXCEPTION_HINT: Record<ExceptionKind, string> = {
  'Over-executed': 'Measured beyond the BOQ quantity',
  'Over-billed': 'Billed beyond the certified quantity',
  'Duplicate SL No': 'Two BOQ items share a scope and SL No',
  'Unmatched line': 'A JMC / MVAC / bill line matching no BOQ item',
};

export function ExceptionsPanel({ summary, showProject, limit = 8 }: { summary: ExceptionSummary; showProject: boolean; limit?: number }) {
  const rows = summary.rows.slice(0, limit);
  const columns: ListColumn<ExceptionSummary['rows'][number]>[] = [
    { header: 'Kind', mobile: 'aside', cell: (r) => <StatusBadge tone={EXCEPTION_TONE[r.kind]} status={r.kind} /> },
    {
      header: 'Item',
      mobile: 'title',
      cell: (r) => (
        <div className="min-w-0">
          <span className="block truncate font-medium text-foreground">{r.reference}</span>
          <span className="block max-w-[22rem] truncate text-xs text-muted-foreground">
            {[showProject ? r.projectName : '', r.scope, r.description].filter(Boolean).join(' · ')}
          </span>
        </div>
      ),
    },
    { header: 'Value', align: 'right', cell: (r) => <span className="tabular-nums">{r.value ? compactInr(r.value) : '—'}</span> },
  ];
  const kinds = Object.keys(summary.counts) as ExceptionKind[];
  return (
    <Panel title="Exceptions" description="Where the BOQ, the measurements and the bills don't agree." icon={FileWarning} bodyClassName="space-y-3 p-0 pb-2 sm:p-4 sm:pt-2">
      <div className="grid grid-cols-2 gap-2 px-4 sm:grid-cols-4 sm:px-0">
        {kinds.map((k) => (
          <div key={k} className="rounded-lg border border-border bg-card px-3 py-2" title={EXCEPTION_HINT[k]}>
            <div className="truncate text-[11px] text-muted-foreground">{k}</div>
            <div className={cn('text-lg font-semibold tabular-nums', summary.counts[k] ? 'text-foreground' : 'text-muted-foreground')}>{summary.counts[k]}</div>
          </div>
        ))}
      </div>
      <DataList rows={rows} columns={columns} dense empty="No exceptions — every line matches its BOQ item." />
      {summary.rows.length > limit && (
        <p className="px-4 text-xs text-muted-foreground sm:px-0">
          {summary.rows.length - limit} more — see each project&apos;s Reconciliation, or export.
        </p>
      )}
    </Panel>
  );
}

/* ── RA bills ───────────────────────────────────────────────────────────────────────────────── */

export function BillsPanel({ rows, showProject, limit = 8 }: { rows: BillRow[]; showProject: boolean; limit?: number }) {
  const attention = rows.filter((r) => r.issue);
  const recent = rows.slice(0, limit);
  const columns: ListColumn<BillRow>[] = [
    {
      header: 'Bill',
      mobile: 'title',
      cell: (r) => (
        <div className="min-w-0">
          <span className="block truncate font-medium text-foreground">
            {r.billNo}
            {r.raSequence ? <span className="font-normal text-muted-foreground"> · RA {r.raSequence}</span> : null}
          </span>
          {showProject && <span className="block truncate text-xs text-muted-foreground">{r.projectName}</span>}
        </div>
      ),
    },
    { header: 'Date', cell: (r) => r.billDate || '—' },
    { header: 'Status', mobile: 'aside', cell: (r) => <StatusBadge tone={r.status === 'Draft' ? 'warning' : statusTone(r.status)} status={r.status} /> },
    { header: 'Bill Tracking', cell: (r) => (r.billTrackingRef ? r.billTrackingRef : <span className="text-muted-foreground">—</span>) },
    { header: 'Amount', align: 'right', cell: (r) => <span className="tabular-nums">{formatInr(r.amount)}</span> },
  ];
  const attentionColumns: ListColumn<BillRow>[] = [
    columns[0],
    { header: 'Needs', mobile: 'aside', cell: (r) => <StatusBadge tone="warning" status={r.issue} /> },
    { header: 'Amount', align: 'right', cell: (r) => <span className="tabular-nums">{formatInr(r.amount)}</span> },
  ];
  return (
    <Panel title="RA bills" description="Quantity bills to the client; their money is followed in Bill Tracking." icon={Scale} bodyClassName="space-y-4 p-0 pb-2 sm:p-4 sm:pt-2">
      <div className="space-y-2">
        <p className="px-4 text-sm font-medium text-foreground sm:px-0">
          Needs attention <span className="font-normal text-muted-foreground">({attention.length})</span>
        </p>
        <DataList rows={attention.slice(0, limit)} columns={attentionColumns} dense empty="No draft is lingering, and every submitted bill is linked to Bill Tracking." />
      </div>
      <div className="space-y-2">
        <p className="px-4 text-sm font-medium text-foreground sm:px-0">Latest</p>
        <DataList rows={recent} columns={columns} dense empty="No RA bill yet." />
      </div>
    </Panel>
  );
}
