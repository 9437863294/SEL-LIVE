'use client';

import Link from 'next/link';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge } from '@/components/shared/status-badge';
import { TableCard } from '@/components/shared/table-card';
import { cn } from '@/lib/utils';
import { exportRowsToExcel } from '@/lib/report-excel';
import { E_APPROVAL_BASE_PATH } from '@/lib/e-approval';
import { oldestPendingEApprovals, summarizeEApprovalAging } from '@/lib/e-approval-analytics';
import { ChartCard, eaTooltipStyle, EA_VIZ } from '@/components/e-approval/dashboard-parts';
import { ReportShell } from '@/components/e-approval/reports/report-shell';
import { eApprovalPriorityTone } from '@/components/e-approval/shared';
import { formatEApprovalAmount, formatEApprovalDate } from '@/components/e-approval/hooks';

/** Older is darker — the validated ordinal ramp, extended across nine ordered bands. */
const AGE_RAMP = ['#cde2fb', '#9ec5f4', '#86b6ef', '#5598e7', '#3987e5', '#2a78d6', '#1c5cab', '#184f95', '#104281'];

const ageLabel = (hours: number) =>
  hours < 24 ? `${Math.round(hours)}h` : `${Math.round(hours / 24)}d`;

/**
 * Approval aging (spec section 3).
 *
 * The nine buckets are an *ordinal* scale, so they take a single-hue ramp and the reader sees the
 * order in the colour rather than having to read the axis. Every bucket is always rendered, empty or
 * not: a missing bar in an ordered series reads as missing data, not as an empty bucket.
 */
export default function EApprovalAgingReportPage() {
  return (
    <ReportShell
      title="Approval Aging"
      description="How long open approvals have been waiting, what they are worth, and which are the oldest. Age runs from submission, not from the current step."
      onExport={async (scope) => {
        const oldest = oldestPendingEApprovals(scope.requests, scope.steps, {
          limit: 500,
          escalationLadder: scope.settings?.escalationLadder,
        });
        await exportRowsToExcel(
          'E-Approval Aging',
          oldest.map((row) => ({
            Reference: row.referenceNo || '',
            Subject: row.subject || '',
            Requester: row.requesterName || '',
            Department: row.departmentName || '',
            'Pending with': row.pendingWith || '',
            'Current step': row.currentStepName || '',
            'Pending since': formatEApprovalDate(row.pendingSince),
            'Age (hours)': row.ageHours,
            Bucket: row.bucket || '',
            Amount: row.amount ?? '',
            Priority: row.priority || '',
            SLA: row.overdue ? 'Breached' : 'Within',
            Escalation: row.escalationLevel || '',
          })),
        );
      }}
    >
      {(scope) => {
        const aging = summarizeEApprovalAging(scope.requests);
        const oldest = oldestPendingEApprovals(scope.requests, scope.steps, {
          limit: 50,
          escalationLadder: scope.settings?.escalationLadder,
        });
        const openCount = aging.reduce((sum, row) => sum + row.count, 0);
        const openValue = aging.reduce((sum, row) => sum + row.value, 0);
        const beyondWeek = aging
          .slice(6)
          .reduce((sum, row) => ({ count: sum.count + row.count, value: sum.value + row.value }), { count: 0, value: 0 });

        return (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: 'Open approvals', value: String(openCount) },
                { label: 'Value waiting', value: formatEApprovalAmount(openValue) },
                { label: 'Older than 7 days', value: String(beyondWeek.count) },
                { label: 'Value older than 7 days', value: formatEApprovalAmount(beyondWeek.value) },
              ].map((tile) => (
                <div key={tile.label} className="min-w-0 rounded-xl border bg-background p-2.5 shadow-sm">
                  <p className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {tile.label}
                  </p>
                  <p className="mt-0.5 text-xl font-semibold leading-none tracking-tight">{tile.value}</p>
                </div>
              ))}
            </div>

            <ChartCard
              title="Age of the open pile"
              description="Darker means older. Overdue counts the files already past the SLA on their current step."
              tableColumns={['Age', 'Approvals', 'Overdue', 'High/Urgent', 'Value']}
              tableRows={aging.map((row) => [row.bucket, row.count, row.overdue, row.urgent, row.value])}
              chart={
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={aging} margin={{ top: 18, right: 12, bottom: 30, left: 4 }}>
                    <CartesianGrid vertical={false} stroke={EA_VIZ.grid} />
                    <XAxis
                      dataKey="bucket"
                      fontSize={10}
                      stroke={EA_VIZ.axis}
                      tickLine={false}
                      angle={-30}
                      textAnchor="end"
                      height={50}
                      interval={0}
                    />
                    <YAxis allowDecimals={false} fontSize={11} stroke={EA_VIZ.axis} tickLine={false} axisLine={false} />
                    <Tooltip cursor={{ fill: EA_VIZ.cursor }} {...eaTooltipStyle} />
                    <Bar isAnimationActive={false} dataKey="count" name="Approvals" radius={[4, 4, 0, 0]} maxBarSize={40}>
                      {aging.map((row, index) => (
                        <Cell key={row.bucket} fill={AGE_RAMP[index] ?? AGE_RAMP[AGE_RAMP.length - 1]} />
                      ))}
                      <LabelList
                        dataKey="count"
                        position="top"
                        fontSize={11}
                        fill={EA_VIZ.label}
                        formatter={(value: unknown) => (Number(value) > 0 ? String(value) : '')}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              }
            />

            <TableCard title="Oldest pending approvals" count={oldest.length} noun="approval">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Reference</TableHead>
                        <TableHead>Subject</TableHead>
                        <TableHead>Requester</TableHead>
                        <TableHead>Department</TableHead>
                        <TableHead>Pending with</TableHead>
                        <TableHead>Step</TableHead>
                        <TableHead>Since</TableHead>
                        <TableHead className="text-right">Age</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Priority</TableHead>
                        <TableHead>SLA</TableHead>
                        <TableHead>Escalation</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {oldest.map((row) => (
                        <TableRow
                          key={row.id}
                          className={cn(
                            row.ageHours > 720 && 'bg-rose-50/70',
                            row.ageHours <= 720 && row.overdue && 'bg-amber-50/60',
                          )}
                        >
                          <TableCell className="whitespace-nowrap font-mono">
                            <Link href={`${E_APPROVAL_BASE_PATH}/${row.id}`} className="text-sky-700 hover:underline">
                              {row.referenceNo || 'Draft'}
                            </Link>
                          </TableCell>
                          <TableCell className="max-w-[220px] truncate">{row.subject}</TableCell>
                          <TableCell className="whitespace-nowrap">{row.requesterName || '—'}</TableCell>
                          <TableCell className="whitespace-nowrap">{row.departmentName || '—'}</TableCell>
                          <TableCell className="max-w-[170px] truncate">{row.pendingWith || '—'}</TableCell>
                          <TableCell className="max-w-[130px] truncate">{row.currentStepName || '—'}</TableCell>
                          <TableCell className="whitespace-nowrap">{formatEApprovalDate(row.pendingSince)}</TableCell>
                          <TableCell className="whitespace-nowrap text-right tabular-nums">
                            {ageLabel(row.ageHours)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right tabular-nums">
                            {row.amount == null ? '—' : formatEApprovalAmount(row.amount)}
                          </TableCell>
                          <TableCell>
                            {row.priority && row.priority !== 'Normal' && (
                              <StatusBadge status={row.priority} tone={eApprovalPriorityTone[row.priority]} />
                            )}
                          </TableCell>
                          <TableCell>
                            {row.overdue ? (
                              <StatusBadge status="Breached" tone="danger" />
                            ) : (
                              <StatusBadge status="Within" tone="success" />
                            )}
                          </TableCell>
                          <TableCell>
                            {row.escalationLevel ? (
                              <StatusBadge status={row.escalationLevel} tone="warning" />
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
            </TableCard>
          </>
        );
      }}
    </ReportShell>
  );
}
