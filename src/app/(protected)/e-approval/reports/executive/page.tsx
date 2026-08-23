'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { exportRowsToExcel } from '@/lib/report-excel';
import { E_APPROVAL_BASE_PATH } from '@/lib/e-approval';
import {
  compareEApprovalKpis,
  computeEApprovalKpis,
  eApprovalTrend,
  oldestPendingEApprovals,
  summarizeEApprovalValueBands,
  type ComparisonPeriod,
} from '@/lib/e-approval-analytics';
import { ChartCard, compactRupees, eaTooltipStyle, EA_VIZ, HeroFigure } from '@/components/e-approval/dashboard-parts';
import { ReportShell } from '@/components/e-approval/reports/report-shell';
import { formatEApprovalAmount } from '@/components/e-approval/hooks';

const PERIODS: Array<{ value: ComparisonPeriod; label: string }> = [
  { value: 'day', label: 'vs yesterday' },
  { value: 'week', label: 'vs last week' },
  { value: 'month', label: 'vs last month' },
  { value: 'year', label: 'vs last year' },
];

/** A KPI tile with its period-on-period movement. */
function Kpi({
  label,
  value,
  delta,
  upIsGood,
  href,
  tone,
}: {
  label: string;
  value: string | number;
  delta?: { change: number; percent: number | null };
  upIsGood?: boolean;
  href?: string;
  tone?: 'critical' | 'warning';
}) {
  const moved = delta && delta.change !== 0;
  const good = moved ? (delta.change > 0 ? upIsGood : !upIsGood) : undefined;
  const Icon = !moved ? ArrowRight : delta.change > 0 ? ArrowUpRight : ArrowDownRight;

  const body = (
    <>
      <p className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          'mt-0.5 text-xl font-semibold leading-none tracking-tight sm:text-2xl',
          tone === 'critical' ? 'text-rose-700' : tone === 'warning' ? 'text-amber-700' : 'text-slate-900',
        )}
      >
        {value}
      </p>
      <span className="mt-1 flex min-h-[16px] items-center gap-0.5 text-[11px]">
        {moved && (
          <>
            <Icon className={cn('h-3 w-3', good ? 'text-emerald-700' : 'text-rose-700')} />
            <span className={cn('font-semibold', good ? 'text-emerald-700' : 'text-rose-700')}>
              {delta.percent == null ? `${delta.change > 0 ? '+' : ''}${delta.change}` : `${Math.abs(delta.percent)}%`}
            </span>
          </>
        )}
      </span>
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
 * The executive command centre (spec section 1).
 *
 * Every tile is clickable through to the register that produced it, because a number a director cannot
 * open is a number they cannot act on. Movement is shown against the equivalent preceding span rather
 * than a calendar boundary, so the comparison does not collapse on the 1st of the month.
 */
export default function EApprovalExecutiveReportPage() {
  const [period, setPeriod] = useState<ComparisonPeriod>('month');

  return (
    <ReportShell
      title="Executive Command Center"
      description="What is outstanding, what it is worth, and how it has moved. Value at risk is the pending value already past its SLA."
      onExport={async (scope) => {
        const kpis = computeEApprovalKpis(scope.requests, scope.steps, {
          escalationLadder: scope.settings?.escalationLadder,
        });
        await exportRowsToExcel('E-Approval Executive Summary', [
          {
            'Raised': kpis.raised,
            'Pending': kpis.pending,
            'Pending verification': kpis.pendingVerification,
            'Pending clarification': kpis.pendingClarification,
            'Returned': kpis.returned,
            'On hold': kpis.onHold,
            'Approved': kpis.approved,
            'Rejected': kpis.rejected,
            'Overdue': kpis.overdue,
            'SLA breached (steps)': kpis.slaBreached,
            'Escalated': kpis.escalated,
            'Value pending': kpis.valuePending,
            'Value approved': kpis.valueApproved,
            'Value at risk': kpis.valueAtRisk,
            'Mean cycle (h)': kpis.cycleHours.mean,
            'Median cycle (h)': kpis.cycleHours.median,
            'Oldest pending (h)': kpis.oldestPendingHours ?? '',
          },
        ]);
      }}
    >
      {(scope) => {
        const ladder = scope.settings?.escalationLadder;
        const kpis = computeEApprovalKpis(scope.requests, scope.steps, { escalationLadder: ladder });
        const comparison = compareEApprovalKpis(scope.requests, scope.steps, { period, escalationLadder: ladder });
        const trend = eApprovalTrend(scope.requests, { granularity: 'month', buckets: 12 });
        const bands = summarizeEApprovalValueBands(scope.requests);
        const oldest = oldestPendingEApprovals(scope.requests, scope.steps, { limit: 10, escalationLadder: ladder });
        const delta = (key: string) => comparison.delta[key];

        return (
          <>
            {/* Hero + the numbers that decide today */}
            <Card className="border-slate-200 bg-gradient-to-r from-slate-50 to-white">
              <CardContent className="grid gap-4 px-3 py-3 sm:px-4 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
                <HeroFigure
                  value={kpis.pending}
                  label="Awaiting a decision"
                  caption={`${compactRupees(kpis.valuePending)} in play · ${compactRupees(kpis.valueAtRisk)} already late`}
                  href={`${E_APPROVAL_BASE_PATH}/all`}
                  tone={kpis.overdue > 0 ? 'critical' : 'default'}
                />
                <div className="min-w-0">
                  <div className="mb-1.5 flex flex-wrap items-center gap-1">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Compare
                    </p>
                    {PERIODS.map((option) => (
                      <Button
                        key={option.value}
                        type="button"
                        size="sm"
                        variant={period === option.value ? 'default' : 'ghost'}
                        className="h-6 px-2 text-[11px]"
                        onClick={() => setPeriod(option.value)}
                      >
                        {option.label}
                      </Button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                    <Kpi label="Raised" value={kpis.raised} delta={delta('raised')} upIsGood href={`${E_APPROVAL_BASE_PATH}/all`} />
                    <Kpi label="Approved" value={kpis.approved} delta={delta('approved')} upIsGood href={`${E_APPROVAL_BASE_PATH}/completed`} />
                    <Kpi label="Rejected" value={kpis.rejected} delta={delta('rejected')} upIsGood={false} href={`${E_APPROVAL_BASE_PATH}/rejected`} />
                    <Kpi label="Overdue" value={kpis.overdue} delta={delta('overdue')} upIsGood={false} tone={kpis.overdue ? 'critical' : undefined} href={`${E_APPROVAL_BASE_PATH}/all`} />
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-6">
              <Kpi label="Pending verification" value={kpis.pendingVerification} />
              <Kpi label="Pending clarification" value={kpis.pendingClarification} />
              <Kpi label="Returned" value={kpis.returned} tone={kpis.returned ? 'warning' : undefined} />
              <Kpi label="On hold" value={kpis.onHold} />
              <Kpi label="SLA breached (steps)" value={kpis.slaBreached} delta={delta('slaBreached')} upIsGood={false} tone={kpis.slaBreached ? 'critical' : undefined} />
              <Kpi label="Escalated files" value={kpis.escalated} delta={delta('escalated')} upIsGood={false} />
              <Kpi label="Value pending" value={compactRupees(kpis.valuePending)} />
              <Kpi label="Value approved" value={compactRupees(kpis.valueApproved)} delta={delta('valueApproved')} upIsGood />
              <Kpi label="Value at risk" value={compactRupees(kpis.valueAtRisk)} tone={kpis.valueAtRisk ? 'critical' : undefined} />
              <Kpi label="Mean cycle" value={`${kpis.cycleHours.mean}h`} />
              <Kpi label="Median cycle" value={`${kpis.cycleHours.median}h`} />
              <Kpi
                label="Oldest pending"
                value={kpis.oldestPendingHours == null ? '—' : `${Math.round(kpis.oldestPendingHours / 24)}d`}
                tone={(kpis.oldestPendingHours ?? 0) > 240 ? 'critical' : undefined}
              />
            </div>

            {/* Mean beside median, deliberately: the gap between them is the story. */}
            {kpis.cycleHours.count > 0 && kpis.cycleHours.mean > kpis.cycleHours.median * 2 && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                The mean cycle time ({kpis.cycleHours.mean}h) is more than twice the median (
                {kpis.cycleHours.median}h) — a minority of files is taking far longer than typical. The
                p90 is {kpis.cycleHours.p90}h. Read the median as normal and the aging report for the tail.
              </p>
            )}

            <ChartCard
              title="Raised against approved"
              description="Twelve months of throughput on the approvals in scope."
              tableColumns={['Month', 'Raised', 'Approved', 'Rejected', 'Value approved']}
              tableRows={trend.map((point) => [point.label, point.raised, point.approved, point.rejected, point.valueApproved])}
              chart={
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={trend} margin={{ top: 12, right: 24, bottom: 4, left: 4 }}>
                    <CartesianGrid vertical={false} stroke={EA_VIZ.grid} />
                    <XAxis dataKey="label" fontSize={11} stroke={EA_VIZ.axis} tickLine={false} />
                    <YAxis allowDecimals={false} fontSize={11} stroke={EA_VIZ.axis} tickLine={false} axisLine={false} />
                    <Tooltip {...eaTooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 11 }} iconType="plainline" />
                    <Line isAnimationActive={false} type="monotone" dataKey="raised" name="Raised" stroke={EA_VIZ.series[0]} strokeWidth={2} strokeLinecap="round" dot={{ r: 4, fill: EA_VIZ.series[0], stroke: EA_VIZ.surface, strokeWidth: 2 }} />
                    <Line isAnimationActive={false} type="monotone" dataKey="approved" name="Approved" stroke={EA_VIZ.series[1]} strokeWidth={2} strokeLinecap="round" dot={{ r: 4, fill: EA_VIZ.series[1], stroke: EA_VIZ.surface, strokeWidth: 2 }} />
                  </LineChart>
                </ResponsiveContainer>
              }
            />

            <ChartCard
              title="Financial exposure by band"
              description="Where the money sits. Pending value is what still needs a decision."
              tableColumns={['Band', 'Approvals', 'Pending', 'Value pending', 'Value approved']}
              tableRows={bands.map((band) => [band.band, band.count, band.pending, band.valuePending, band.valueApproved])}
              chart={
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={bands} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
                    <CartesianGrid horizontal={false} stroke={EA_VIZ.grid} />
                    <XAxis type="number" allowDecimals={false} fontSize={11} stroke={EA_VIZ.axis} tickLine={false} />
                    <YAxis type="category" dataKey="band" width={168} fontSize={10} stroke={EA_VIZ.axis} tickLine={false} axisLine={false} />
                    <Tooltip cursor={{ fill: 'rgba(15,23,42,0.03)' }} {...eaTooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar isAnimationActive={false} dataKey="pending" name="Pending" stackId="s" fill={EA_VIZ.series[0]} maxBarSize={20} stroke={EA_VIZ.surface} strokeWidth={2} />
                    <Bar isAnimationActive={false} dataKey="approved" name="Approved" stackId="s" fill={EA_VIZ.series[1]} radius={[0, 4, 4, 0]} maxBarSize={20} stroke={EA_VIZ.surface} strokeWidth={2} />
                  </BarChart>
                </ResponsiveContainer>
              }
            />

            <Card>
              <CardContent className="px-2 py-3 sm:px-3">
                <p className="mb-2 px-1 text-sm font-semibold">Oldest pending approvals</p>
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40">
                        <TableHead>Reference</TableHead>
                        <TableHead>Subject</TableHead>
                        <TableHead>Pending with</TableHead>
                        <TableHead className="text-right">Age</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Escalation</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {oldest.map((row) => (
                        <TableRow key={row.id} className={row.overdue ? 'bg-rose-50/60' : undefined}>
                          <TableCell className="whitespace-nowrap font-mono text-[11px]">
                            <Link href={`${E_APPROVAL_BASE_PATH}/${row.id}`} className="text-sky-700 hover:underline">
                              {row.referenceNo || 'Draft'}
                            </Link>
                          </TableCell>
                          <TableCell className="max-w-[260px] truncate text-xs">{row.subject}</TableCell>
                          <TableCell className="text-xs">{row.pendingWith || '—'}</TableCell>
                          <TableCell className="whitespace-nowrap text-right text-xs tabular-nums">
                            {Math.round(row.ageHours / 24)}d
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right text-xs tabular-nums">
                            {row.amount == null ? '—' : formatEApprovalAmount(row.amount)}
                          </TableCell>
                          <TableCell>
                            {row.escalationLevel ? (
                              <Badge variant="outline" className="border-rose-200 bg-rose-50 text-[10px] text-rose-700">
                                {row.escalationLevel}
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </>
        );
      }}
    </ReportShell>
  );
}
