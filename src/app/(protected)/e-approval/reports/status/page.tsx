'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge } from '@/components/shared/status-badge';
import { TableCard } from '@/components/shared/table-card';
import { exportRowsToExcel } from '@/lib/report-excel';
import { E_APPROVAL_BASE_PATH } from '@/lib/e-approval';
import { rollupEApprovals, summarizeEApprovalStatuses, type EApprovalDimension } from '@/lib/e-approval-analytics';
import { ChartCard, eaTooltipStyle, EA_VIZ } from '@/components/e-approval/dashboard-parts';
import { ReportShell } from '@/components/e-approval/reports/report-shell';
import { formatEApprovalAmount, formatEApprovalDate } from '@/components/e-approval/hooks';

const DIMENSIONS: Array<{ value: EApprovalDimension; label: string }> = [
  { value: 'department', label: 'Department' },
  { value: 'approvalType', label: 'Approval type' },
  { value: 'project', label: 'Project / site' },
  { value: 'requester', label: 'Requester' },
  { value: 'priority', label: 'Priority' },
];

/**
 * Status distribution (spec section 2).
 *
 * A horizontal bar rather than a pie: there are fourteen statuses, and past about seven colour classes
 * adjacent slices become indistinguishable — the chart stops being readable exactly when it has the
 * most to say. Bar length carries the value, so every bar takes one hue.
 *
 * Drill-down happens **in place**: clicking a bar lists the matching requests underneath rather than
 * navigating away, so the reader keeps the distribution on screen while reading the detail.
 */
export default function EApprovalStatusReportPage() {
  const [dimension, setDimension] = useState<EApprovalDimension>('department');
  const [drill, setDrill] = useState<string | null>(null);

  return (
    <ReportShell
      title="Status Distribution"
      description="Every status, its share of the pile and the money behind it. Click a bar to see the approvals inside it."
      onExport={async (scope) => {
        const slices = summarizeEApprovalStatuses(scope.requests);
        await exportRowsToExcel(
          'E-Approval Status Distribution',
          slices.map((slice) => ({
            Status: slice.status,
            Approvals: slice.count,
            'Share %': slice.percent ?? '',
            Value: slice.value,
          })),
        );
      }}
    >
      {(scope) => {
        const slices = summarizeEApprovalStatuses(scope.requests);
        const rollup = rollupEApprovals(scope.requests, dimension);
        const drilled = drill ? scope.requests.filter((row) => String(row.status) === drill) : [];

        return (
          <>
            <ChartCard
              title="By status"
              description={`${scope.requests.length} approvals in scope. One hue — the bar length is the value.`}
              tableColumns={['Status', 'Approvals', 'Share %', 'Value']}
              tableRows={slices.map((slice) => [slice.status, slice.count, slice.percent ?? '—', slice.value])}
              chart={
                <ResponsiveContainer width="100%" height={Math.max(200, slices.length * 34 + 30)}>
                  <BarChart data={slices} layout="vertical" margin={{ top: 4, right: 48, bottom: 4, left: 4 }}>
                    <CartesianGrid horizontal={false} stroke={EA_VIZ.grid} />
                    <XAxis type="number" allowDecimals={false} fontSize={11} stroke={EA_VIZ.axis} tickLine={false} />
                    <YAxis type="category" dataKey="status" width={150} fontSize={11} stroke={EA_VIZ.axis} tickLine={false} axisLine={false} />
                    <Tooltip cursor={{ fill: EA_VIZ.cursor }} {...eaTooltipStyle} />
                    <Bar
                      isAnimationActive={false}
                      dataKey="count"
                      name="Approvals"
                      radius={[0, 4, 4, 0]}
                      maxBarSize={20}
                      onClick={(entry: { status?: string }) => setDrill(entry?.status ?? null)}
                      className="cursor-pointer"
                    >
                      {slices.map((slice) => (
                        <Cell
                          key={slice.status}
                          fill={drill && drill !== slice.status ? EA_VIZ.muted : EA_VIZ.series[0]}
                        />
                      ))}
                      <LabelList dataKey="count" position="right" fontSize={11} fill={EA_VIZ.label} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              }
            />

            {drill && (
              <TableCard
                title="Approvals in status"
                description={
                  <StatusBadge status={drill}>{drill === 'Superseded' ? <s>Superseded</s> : undefined}</StatusBadge>
                }
                count={drilled.length}
                noun="approval"
                actions={
                  <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={() => setDrill(null)}>
                    <X className="h-3.5 w-3.5" /> Close
                  </Button>
                }
                footer={
                  drilled.length > 100
                    ? `Showing the first 100 of ${drilled.length}. Narrow the filter above to see the rest.`
                    : undefined
                }
              >
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Reference</TableHead>
                          <TableHead>Subject</TableHead>
                          <TableHead>Requester</TableHead>
                          <TableHead>Department</TableHead>
                          <TableHead>Pending with</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead>Submitted</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {drilled.slice(0, 100).map((row) => (
                          <TableRow key={row.id}>
                            <TableCell className="whitespace-nowrap font-mono">
                              <Link href={`${E_APPROVAL_BASE_PATH}/${row.id}`} className="text-sky-700 hover:underline">
                                {row.referenceNo || 'Draft'}
                              </Link>
                            </TableCell>
                            <TableCell className="max-w-[240px] truncate">{row.subject}</TableCell>
                            <TableCell>{row.requesterName || '—'}</TableCell>
                            <TableCell>{row.departmentName || '—'}</TableCell>
                            <TableCell className="max-w-[180px] truncate">{row.pendingLabel || '—'}</TableCell>
                            <TableCell className="whitespace-nowrap text-right tabular-nums">
                              {row.amount == null ? '—' : formatEApprovalAmount(row.amount)}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">{formatEApprovalDate(row.submittedAt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
              </TableCard>
            )}

            <TableCard
              title="Breakdown"
              count={rollup.length}
              noun="group"
              actions={
                <Select value={dimension} onValueChange={(next) => setDimension(next as EApprovalDimension)}>
                  <SelectTrigger className="w-[170px]" aria-label="Break down by">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DIMENSIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        By {option.label.toLowerCase()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              }
            >
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{DIMENSIONS.find((d) => d.value === dimension)?.label}</TableHead>
                        <TableHead className="text-right">Raised</TableHead>
                        <TableHead className="text-right">Pending</TableHead>
                        <TableHead className="text-right">Approved</TableHead>
                        <TableHead className="text-right">Rejected</TableHead>
                        <TableHead className="text-right">Overdue</TableHead>
                        <TableHead className="text-right">Approval %</TableHead>
                        <TableHead className="text-right">Median cycle</TableHead>
                        <TableHead className="text-right">Value pending</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rollup.map((row) => (
                        <TableRow key={row.key}>
                          <TableCell className="font-medium">{row.label}</TableCell>
                          <TableCell className="text-right tabular-nums">{row.raised}</TableCell>
                          <TableCell className="text-right tabular-nums">{row.pending}</TableCell>
                          <TableCell className="text-right tabular-nums">{row.approved}</TableCell>
                          <TableCell className="text-right tabular-nums">{row.rejected}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {row.overdue > 0 ? <span className="font-semibold text-rose-700">{row.overdue}</span> : '—'}
                          </TableCell>
                          {/* A dash, not 0% — no decisions yet is not a 0% approval rate. */}
                          <TableCell className="text-right tabular-nums">
                            {row.approvalRatePercent == null ? '—' : `${row.approvalRatePercent}%`}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {row.cycleHours.count ? `${row.cycleHours.median}h` : '—'}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right tabular-nums">
                            {formatEApprovalAmount(row.valuePending)}
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
