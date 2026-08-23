'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { exportRowsToExcel } from '@/lib/report-excel';
import { E_APPROVAL_BASE_PATH } from '@/lib/e-approval';
import { rollupEApprovals, summarizeEApprovalStatuses, type EApprovalDimension } from '@/lib/e-approval-analytics';
import { ChartCard, eaTooltipStyle, EA_VIZ } from '@/components/e-approval/dashboard-parts';
import { ReportShell } from '@/components/e-approval/reports/report-shell';
import { EApprovalStatusBadge } from '@/components/e-approval/shared';
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
                    <Tooltip cursor={{ fill: 'rgba(15,23,42,0.03)' }} {...eaTooltipStyle} />
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
                          fill={drill && drill !== slice.status ? '#cbd5e1' : EA_VIZ.series[0]}
                        />
                      ))}
                      <LabelList dataKey="count" position="right" fontSize={11} fill="#52514e" />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              }
            />

            {drill && (
              <Card>
                <CardContent className="px-2 py-3 sm:px-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2 px-1">
                    <p className="text-sm font-semibold">
                      <EApprovalStatusBadge status={drill} /> <span className="ml-1">{drilled.length} approvals</span>
                    </p>
                    <Button size="sm" variant="ghost" className="ml-auto h-7 gap-1 px-2 text-xs" onClick={() => setDrill(null)}>
                      <X className="h-3.5 w-3.5" /> Close
                    </Button>
                  </div>
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/40">
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
                            <TableCell className="whitespace-nowrap font-mono text-[11px]">
                              <Link href={`${E_APPROVAL_BASE_PATH}/${row.id}`} className="text-sky-700 hover:underline">
                                {row.referenceNo || 'Draft'}
                              </Link>
                            </TableCell>
                            <TableCell className="max-w-[240px] truncate text-xs">{row.subject}</TableCell>
                            <TableCell className="text-xs">{row.requesterName || '—'}</TableCell>
                            <TableCell className="text-xs">{row.departmentName || '—'}</TableCell>
                            <TableCell className="max-w-[180px] truncate text-xs">{row.pendingLabel || '—'}</TableCell>
                            <TableCell className="whitespace-nowrap text-right text-xs tabular-nums">
                              {row.amount == null ? '—' : formatEApprovalAmount(row.amount)}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs">{formatEApprovalDate(row.submittedAt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {drilled.length > 100 && (
                    <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">
                      Showing the first 100 of {drilled.length}. Narrow the filter above to see the rest.
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardContent className="px-2 py-3 sm:px-3">
                <div className="mb-2 flex flex-wrap items-center gap-2 px-1">
                  <p className="text-sm font-semibold">Breakdown</p>
                  <Select value={dimension} onValueChange={(next) => setDimension(next as EApprovalDimension)}>
                    <SelectTrigger className="h-8 w-[170px] text-xs">
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
                  <Badge variant="outline" className="text-[10px]">
                    {rollup.length} groups
                  </Badge>
                </div>
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40">
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
                          <TableCell className="text-xs font-medium">{row.label}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{row.raised}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{row.pending}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{row.approved}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{row.rejected}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">
                            {row.overdue > 0 ? <span className="font-semibold text-rose-700">{row.overdue}</span> : '—'}
                          </TableCell>
                          {/* A dash, not 0% — no decisions yet is not a 0% approval rate. */}
                          <TableCell className="text-right text-xs tabular-nums">
                            {row.approvalRatePercent == null ? '—' : `${row.approvalRatePercent}%`}
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">
                            {row.cycleHours.count ? `${row.cycleHours.median}h` : '—'}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right text-xs tabular-nums">
                            {formatEApprovalAmount(row.valuePending)}
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
