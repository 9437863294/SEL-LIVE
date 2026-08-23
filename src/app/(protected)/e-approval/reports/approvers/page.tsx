'use client';

import { useState } from 'react';
import { ArrowUpDown, Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { exportRowsToExcel } from '@/lib/report-excel';
import { summarizeEApprovalApprovers, type ApproverPerformance } from '@/lib/e-approval-analytics';
import { ReportShell } from '@/components/e-approval/reports/report-shell';

type SortKey = 'assigned' | 'pending' | 'overdue' | 'median' | 'slaBreachPercent' | 'returnRatePercent';

const COLUMNS: Array<{ key: SortKey; label: string; hint?: string }> = [
  { key: 'assigned', label: 'Steps' },
  { key: 'pending', label: 'Pending' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'median', label: 'Median held', hint: 'Excludes time waiting on a verification or a hold' },
  { key: 'slaBreachPercent', label: 'SLA breach %' },
  { key: 'returnRatePercent', label: 'Return %', hint: 'Of decisions taken, not of steps assigned' },
];

const hours = (value: number) => (value >= 48 ? `${Math.round(value / 24)}d` : `${value}h`);

const sortValue = (row: ApproverPerformance, key: SortKey): number => {
  switch (key) {
    case 'median':
      return row.response.median;
    case 'slaBreachPercent':
      return row.slaBreachPercent ?? -1;
    case 'returnRatePercent':
      return row.returnRatePercent ?? -1;
    default:
      return row[key];
  }
};

/**
 * Approver performance (spec section 6).
 *
 * The spec's own caution is honoured here rather than paraphrased: these are **workflow metrics, not
 * an appraisal**. A high return rate can be diligence; a fast response can be rubber-stamping. The
 * page says so on the page, because a table of people ranked by speed will be read as a league table
 * unless it explicitly is not one.
 *
 * Rates divide by *decisions taken*, never by steps assigned — otherwise a step auto-skipped when a
 * parallel group was satisfied would silently deflate somebody's numbers.
 */
export default function EApprovalApproverReportPage() {
  const [sort, setSort] = useState<SortKey>('assigned');
  const [ascending, setAscending] = useState(false);

  return (
    <ReportShell
      title="Approver Performance"
      description="Per-person workflow metrics. Held time excludes waiting on others, so each figure reflects only that desk's own delay."
      onExport={async (scope) => {
        const rows = summarizeEApprovalApprovers(scope.steps, { limit: 1000 });
        await exportRowsToExcel(
          'E-Approval Approver Performance',
          rows.map((row) => ({
            Approver: row.name,
            'Steps assigned': row.assigned,
            Approved: row.approved,
            Rejected: row.rejected,
            Returned: row.returned,
            Verified: row.verified,
            Clarified: row.clarified,
            Skipped: row.skipped,
            Pending: row.pending,
            Overdue: row.overdue,
            'SLA breaches': row.slaBreaches,
            'SLA breach %': row.slaBreachPercent ?? '',
            'Median held (h)': row.response.median,
            'Mean held (h)': row.response.mean,
            'Fastest (h)': row.response.min,
            'Slowest (h)': row.response.max,
            'Approval %': row.approvalRatePercent ?? '',
            'Return %': row.returnRatePercent ?? '',
            'Acted on behalf of': row.onBehalfOf,
          })),
        );
      }}
    >
      {(scope) => {
        const rows = summarizeEApprovalApprovers(scope.steps, { limit: 200 });
        const sorted = [...rows].sort((a, b) => (sortValue(a, sort) - sortValue(b, sort)) * (ascending ? 1 : -1));

        const decided = rows.filter((row) => row.response.count > 0);
        const fastest = [...decided].sort((a, b) => a.response.median - b.response.median).slice(0, 3);
        const heaviest = [...rows].sort((a, b) => b.pending - a.pending).slice(0, 3);

        const toggle = (key: SortKey) => {
          if (sort === key) setAscending((value) => !value);
          else {
            setSort(key);
            setAscending(false);
          }
        };

        return (
          <>
            <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                These are workflow metrics, not a performance appraisal. A high return rate may be diligence and a fast
                response may be rubber-stamping — the numbers describe a queue, not a person&apos;s worth. Actions taken
                under a delegation are attributed to whoever actually acted, and flagged.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Card>
                <CardContent className="px-3 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Quickest median turnaround
                  </p>
                  <div className="mt-1.5 space-y-1">
                    {fastest.length === 0 && <p className="text-xs text-muted-foreground">No decisions recorded yet.</p>}
                    {fastest.map((row) => (
                      <div key={row.userId} className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate font-medium">{row.name}</span>
                        <span className="shrink-0 tabular-nums">
                          {hours(row.response.median)}
                          <span className="ml-1 text-[11px] text-muted-foreground">({row.response.count})</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="px-3 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Largest open queue
                  </p>
                  <div className="mt-1.5 space-y-1">
                    {heaviest.filter((row) => row.pending > 0).length === 0 && (
                      <p className="text-xs text-muted-foreground">Nothing pending with anybody.</p>
                    )}
                    {heaviest
                      .filter((row) => row.pending > 0)
                      .map((row) => (
                        <div key={row.userId} className="flex items-baseline justify-between gap-2 text-sm">
                          <span className="min-w-0 truncate font-medium">{row.name}</span>
                          <span className="shrink-0 tabular-nums">
                            {row.pending}
                            {row.overdue > 0 && (
                              <span className="ml-1 text-[11px] font-semibold text-rose-700">{row.overdue} late</span>
                            )}
                          </span>
                        </div>
                      ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardContent className="px-2 py-3 sm:px-3">
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40">
                        <TableHead>Approver</TableHead>
                        {COLUMNS.map((column) => (
                          <TableHead key={column.key} className="whitespace-nowrap text-right" title={column.hint}>
                            <button type="button" className="inline-flex items-center gap-1" onClick={() => toggle(column.key)}>
                              {column.label} <ArrowUpDown className="h-3 w-3" />
                            </button>
                          </TableHead>
                        ))}
                        <TableHead className="text-right">Approved</TableHead>
                        <TableHead className="text-right">Returned</TableHead>
                        <TableHead className="text-right">Verified</TableHead>
                        <TableHead className="text-right">Fastest</TableHead>
                        <TableHead className="text-right">Slowest</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sorted.map((row) => (
                        <TableRow key={row.userId}>
                          <TableCell className="whitespace-nowrap text-xs font-medium">
                            {row.name}
                            {row.onBehalfOf > 0 && (
                              <Badge variant="outline" className="ml-1.5 text-[9px]" title="Acted under a delegation">
                                {row.onBehalfOf} on behalf
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{row.assigned}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{row.pending || '—'}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">
                            {row.overdue > 0 ? <span className="font-semibold text-rose-700">{row.overdue}</span> : '—'}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right text-xs font-semibold tabular-nums">
                            {row.response.count ? hours(row.response.median) : '—'}
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">
                            <span
                              className={cn(
                                row.slaBreachPercent != null && row.slaBreachPercent > 25 && 'font-semibold text-rose-700',
                              )}
                            >
                              {row.slaBreachPercent == null ? '—' : `${row.slaBreachPercent}%`}
                            </span>
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">
                            {row.returnRatePercent == null ? '—' : `${row.returnRatePercent}%`}
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{row.approved || '—'}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{row.returned || '—'}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{row.verified || '—'}</TableCell>
                          <TableCell className="whitespace-nowrap text-right text-xs tabular-nums">
                            {row.response.count ? hours(row.response.min) : '—'}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right text-xs tabular-nums">
                            {row.response.count ? hours(row.response.max) : '—'}
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
