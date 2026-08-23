'use client';

import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { exportRowsToExcel } from '@/lib/report-excel';
import {
  rollupEApprovals,
  summarizeEApprovalBottleneckApprovers,
  summarizeEApprovalBottleneckSteps,
  summarizeEApprovalRework,
} from '@/lib/e-approval-analytics';
import { ChartCard, eaTooltipStyle, EA_VIZ } from '@/components/e-approval/dashboard-parts';
import { ReportShell } from '@/components/e-approval/reports/report-shell';
import { formatEApprovalAmount } from '@/components/e-approval/hooks';

const hours = (value: number) => (value >= 48 ? `${Math.round(value / 24)}d` : `${value}h`);

/**
 * Bottleneck intelligence (spec section 4).
 *
 * The table deliberately shows **completed volume beside the queue**. A long queue on the desk that
 * also clears the most work is capacity, not obstruction, and a report that ranks purely on pending
 * count accuses the busiest person in the organisation of being the problem. Median processing time
 * leads the workflow-stage ranking for the same reason — one file left over a long weekend should not
 * crown a stage the worst in the company.
 */
export default function EApprovalBottlenecksReportPage() {
  return (
    <ReportShell
      title="Bottleneck Intelligence"
      description="Where time is actually going. Held time excludes waiting on a verification or a hold, so a desk is only answerable for its own delay."
      onExport={async (scope) => {
        const approvers = summarizeEApprovalBottleneckApprovers(scope.steps, { limit: 500 });
        await exportRowsToExcel(
          'E-Approval Bottlenecks',
          approvers.map((row) => ({
            Holder: row.name,
            Department: row.departmentName || '',
            Pending: row.pending,
            Overdue: row.overdue,
            'Oldest pending (h)': row.oldestPendingHours,
            'Avg pending (h)': row.averagePendingHours,
            'SLA breaches': row.slaBreaches,
            'Pending value': row.pendingValue,
            Completed: row.completed,
            'Avg held (h)': row.averageHeldHours,
          })),
        );
      }}
    >
      {(scope) => {
        const approvers = summarizeEApprovalBottleneckApprovers(scope.steps, { limit: 15 });
        const stages = summarizeEApprovalBottleneckSteps(scope.steps, { limit: 15 });
        const departments = rollupEApprovals(scope.requests, 'department').filter((row) => row.pending > 0);
        const rework = summarizeEApprovalRework(scope.requests, scope.steps, scope.events);

        const queueChart = approvers
          .filter((row) => row.pending > 0)
          .slice(0, 10)
          .map((row) => ({ name: row.name, pending: row.pending, overdue: row.overdue }));

        const worstStage = stages[0];

        return (
          <>
            {worstStage && worstStage.processing.count > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  The slowest stage is <span className="font-semibold">{worstStage.workflowStep}</span> — a median of{' '}
                  {hours(worstStage.processing.median)} across {worstStage.cases} cases
                  {worstStage.slaBreachPercent != null && `, ${worstStage.slaBreachPercent}% past SLA`}
                  {worstStage.returnPercent != null && worstStage.returnPercent > 0 && `, ${worstStage.returnPercent}% returned`}.
                  {worstStage.returnPercent != null && worstStage.returnPercent > 20
                    ? ' A high return rate with a low processing time usually means requests are arriving underspecified, not that the desk is slow.'
                    : ''}
                </p>
              </div>
            )}

            <ChartCard
              title="Largest queues"
              description="Live steps per holder, with the overdue portion. Ordered by queue size."
              tableColumns={['Holder', 'Pending', 'Overdue']}
              tableRows={queueChart.map((row) => [row.name, row.pending, row.overdue])}
              emptyMessage="Nothing is pending with anybody."
              chart={
                <ResponsiveContainer width="100%" height={Math.max(200, queueChart.length * 34 + 40)}>
                  <BarChart data={queueChart} layout="vertical" margin={{ top: 4, right: 44, bottom: 4, left: 4 }}>
                    <CartesianGrid horizontal={false} stroke={EA_VIZ.grid} />
                    <XAxis type="number" allowDecimals={false} fontSize={11} stroke={EA_VIZ.axis} tickLine={false} />
                    <YAxis type="category" dataKey="name" width={150} fontSize={11} stroke={EA_VIZ.axis} tickLine={false} axisLine={false} />
                    <Tooltip cursor={{ fill: 'rgba(15,23,42,0.03)' }} {...eaTooltipStyle} />
                    <Bar isAnimationActive={false} dataKey="pending" name="Pending" fill={EA_VIZ.series[0]} radius={[0, 4, 4, 0]} maxBarSize={20}>
                      <LabelList dataKey="pending" position="right" fontSize={11} fill="#52514e" />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              }
            />

            <Card>
              <CardContent className="px-2 py-3 sm:px-3">
                <p className="mb-1 px-1 text-sm font-semibold">Holders</p>
                <p className="mb-2 px-1 text-[11px] text-muted-foreground">
                  Completed and average-held are shown so a busy desk is not mistaken for a slow one.
                </p>
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40">
                        <TableHead>Holder</TableHead>
                        <TableHead>Department</TableHead>
                        <TableHead className="text-right">Pending</TableHead>
                        <TableHead className="text-right">Overdue</TableHead>
                        <TableHead className="text-right">Oldest</TableHead>
                        <TableHead className="text-right">Avg waiting</TableHead>
                        <TableHead className="text-right">SLA breaches</TableHead>
                        <TableHead className="text-right">Pending value</TableHead>
                        <TableHead className="text-right">Completed</TableHead>
                        <TableHead className="text-right">Avg held</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {approvers.map((row) => (
                        <TableRow key={row.key}>
                          <TableCell className="whitespace-nowrap text-xs font-medium">{row.name}</TableCell>
                          <TableCell className="whitespace-nowrap text-xs">{row.departmentName || '—'}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{row.pending}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">
                            {row.overdue > 0 ? <span className="font-semibold text-rose-700">{row.overdue}</span> : '—'}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right text-xs tabular-nums">
                            {row.pending ? hours(row.oldestPendingHours) : '—'}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right text-xs tabular-nums">
                            {row.pending ? hours(row.averagePendingHours) : '—'}
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{row.slaBreaches || '—'}</TableCell>
                          <TableCell className="whitespace-nowrap text-right text-xs tabular-nums">
                            {row.pendingValue ? formatEApprovalAmount(row.pendingValue) : '—'}
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{row.completed}</TableCell>
                          <TableCell className="whitespace-nowrap text-right text-xs tabular-nums">
                            {row.completed ? hours(row.averageHeldHours) : '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="px-2 py-3 sm:px-3">
                <p className="mb-2 px-1 text-sm font-semibold">Workflow stages</p>
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40">
                        <TableHead>Stage</TableHead>
                        <TableHead className="text-right">Cases</TableHead>
                        <TableHead className="text-right">Median</TableHead>
                        <TableHead className="text-right">Mean</TableHead>
                        <TableHead className="text-right">p90</TableHead>
                        <TableHead className="text-right">SLA breach %</TableHead>
                        <TableHead className="text-right">Return %</TableHead>
                        <TableHead className="text-right">Re-opened %</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stages.map((row) => (
                        <TableRow key={row.workflowStep}>
                          <TableCell className="whitespace-nowrap text-xs font-medium">{row.workflowStep}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{row.cases}</TableCell>
                          <TableCell className="whitespace-nowrap text-right text-xs font-semibold tabular-nums">
                            {row.processing.count ? hours(row.processing.median) : '—'}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right text-xs tabular-nums">
                            {row.processing.count ? hours(row.processing.mean) : '—'}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right text-xs tabular-nums">
                            {row.processing.count ? hours(row.processing.p90) : '—'}
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">
                            {row.slaBreachPercent == null ? '—' : `${row.slaBreachPercent}%`}
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">
                            {row.returnPercent == null ? '—' : `${row.returnPercent}%`}
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">
                            {row.reopenedPercent == null ? '—' : `${row.reopenedPercent}%`}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="px-2 py-3 sm:px-3">
                <p className="mb-2 px-1 text-sm font-semibold">Departments with work outstanding</p>
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40">
                        <TableHead>Department</TableHead>
                        <TableHead className="text-right">Pending</TableHead>
                        <TableHead className="text-right">Overdue</TableHead>
                        <TableHead className="text-right">Value pending</TableHead>
                        <TableHead className="text-right">Median cycle</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {departments.map((row) => (
                        <TableRow key={row.key}>
                          <TableCell className="text-xs font-medium">{row.label}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{row.pending}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">
                            {row.overdue > 0 ? <span className="font-semibold text-rose-700">{row.overdue}</span> : '—'}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right text-xs tabular-nums">
                            {formatEApprovalAmount(row.valuePending)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right text-xs tabular-nums">
                            {row.cycleHours.count ? hours(row.cycleHours.median) : '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 px-3 py-3 sm:px-4">
                <p className="text-sm font-semibold">Rework</p>
                {[
                  { label: 'Requests returned', value: String(rework.requestsReturned) },
                  { label: 'Total returns', value: String(rework.totalReturns) },
                  { label: 'Returned more than once', value: String(rework.repeatedlyReturned) },
                  { label: 'Return rate', value: rework.returnRatePercent == null ? '—' : `${rework.returnRatePercent}%` },
                  { label: 'Content superseded', value: String(rework.requestsSuperseded) },
                ].map((tile) => (
                  <div key={tile.label}>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{tile.label}</p>
                    <p className="text-base font-semibold tabular-nums">{tile.value}</p>
                  </div>
                ))}
                {rework.byStep.length > 0 && (
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Sends back most</p>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {rework.byStep.slice(0, 5).map((row) => (
                        <Badge key={row.stepName} variant="outline" className="text-[10px]">
                          {row.stepName} · {row.returns}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        );
      }}
    </ReportShell>
  );
}
