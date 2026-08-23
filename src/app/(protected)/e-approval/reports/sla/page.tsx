'use client';

import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, CheckCircle2, Clock, HelpCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { exportRowsToExcel } from '@/lib/report-excel';
import { summarizeEApprovalSla, type AnalyticsStepRow } from '@/lib/e-approval-analytics';
import { ChartCard, eaTooltipStyle, EA_VIZ, TriageChip } from '@/components/e-approval/dashboard-parts';
import { ReportShell } from '@/components/e-approval/reports/report-shell';

type SlaDimension = 'department' | 'approvalType' | 'project' | 'holder' | 'stage';

const DIMENSIONS: Array<{ value: SlaDimension; label: string }> = [
  { value: 'department', label: 'Department' },
  { value: 'approvalType', label: 'Approval type' },
  { value: 'project', label: 'Project / site' },
  { value: 'holder', label: 'Approver' },
  { value: 'stage', label: 'Workflow stage' },
];

/** Level colours run good→critical, and always ship with the level label beside them. */
const LEVEL_TONE: Record<string, string> = {
  'Level 1': '#f59e0b',
  'Level 2': '#ea580c',
  'Level 3': '#e11d48',
  Management: '#881337',
};

/**
 * SLA and escalation analytics (spec section 5).
 *
 * Compliance is computed per **step**, not per request: a request touching six desks has six chances
 * to breach, and averaging it to one pass/fail per request hides five of them. Every percentage here
 * is shown with the number of measured steps behind it, and a group with no clock at all shows a dash
 * rather than a flattering 100%.
 */
export default function EApprovalSlaReportPage() {
  const [dimension, setDimension] = useState<SlaDimension>('department');

  return (
    <ReportShell
      title="SLA & Escalation"
      description="Compliance measured per step, excluding time a step spent paused. Approaching means 80% of the clock consumed — the same threshold the reminders use."
      onExport={async (scope) => {
        const sla = summarizeEApprovalSla(scope.steps, { escalationLadder: scope.settings?.escalationLadder });
        await exportRowsToExcel('E-Approval SLA', [
          {
            'Measured steps': sla.measured,
            'Within SLA': sla.withinSla,
            Approaching: sla.approaching,
            Breached: sla.breached,
            'No clock': sla.noClock,
            'Compliance %': sla.compliancePercent ?? '',
            ...Object.fromEntries(sla.byLevel.map((row) => [row.level, row.approvals])),
          },
        ]);
      }}
    >
      {(scope) => {
        const ladder = scope.settings?.escalationLadder;
        const sla = summarizeEApprovalSla(scope.steps, { escalationLadder: ladder });

        // Group steps by the chosen dimension, then run the same SLA summary over each group — so
        // there is exactly one definition of compliance on the page.
        const requestById = new Map(scope.requests.map((row) => [row.id, row]));
        const keyOf = (step: AnalyticsStepRow) => {
          const request = requestById.get(step.approvalId);
          switch (dimension) {
            case 'department':
              return request?.departmentName ?? 'Unassigned';
            case 'approvalType':
              return request?.approvalTypeName ?? 'Unspecified';
            case 'project':
              return request?.projectName ?? 'Not project-specific';
            case 'holder':
              return step.actedByName || step.assignment?.userName || step.assignment?.departmentName || 'Unassigned';
            case 'stage':
              return step.name || '(unnamed)';
            default:
              return 'Unassigned';
          }
        };

        const groups = new Map<string, AnalyticsStepRow[]>();
        for (const step of scope.steps) {
          const key = keyOf(step);
          groups.set(key, [...(groups.get(key) ?? []), step]);
        }
        const byDimension = Array.from(groups.entries())
          .map(([label, rows]) => ({ label, ...summarizeEApprovalSla(rows, { escalationLadder: ladder }) }))
          .filter((row) => row.measured > 0)
          .sort((a, b) => (a.compliancePercent ?? 101) - (b.compliancePercent ?? 101));

        const worst = byDimension.slice(0, 12).map((row) => ({
          label: row.label,
          compliance: row.compliancePercent ?? 0,
          measured: row.measured,
        }));

        const approaching = scope.steps
          .filter((step) => {
            const started = step.startedAt ? new Date(step.startedAt).getTime() : null;
            const due = step.dueAt ? new Date(step.dueAt).getTime() : null;
            if (started == null || due == null || step.completedAt) return false;
            const at = Date.now();
            if (at > due) return false;
            return (at - started) / (due - started) >= 0.8;
          })
          .map((step) => ({ step, request: requestById.get(step.approvalId) }))
          .sort((a, b) => new Date(a.step.dueAt ?? 0).getTime() - new Date(b.step.dueAt ?? 0).getTime())
          .slice(0, 25);

        return (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              <TriageChip tone="good" label="Within SLA" count={sla.withinSla} />
              <TriageChip tone="warning" label="Approaching" count={sla.approaching} />
              <TriageChip tone="critical" label="Breached" count={sla.breached} />
              <div className="flex items-center gap-2 rounded-lg border bg-muted/20 px-2.5 py-2">
                <HelpCircle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 truncate text-xs font-medium">No clock set</span>
                <span className="ml-auto text-sm font-semibold tabular-nums">{sla.noClock}</span>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-2 text-sky-900">
                <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
                <span className="min-w-0 truncate text-xs font-medium">Compliance</span>
                <span className="ml-auto text-sm font-semibold tabular-nums">
                  {sla.compliancePercent == null ? '—' : `${sla.compliancePercent}%`}
                </span>
              </div>
            </div>

            <p className="px-1 text-[11px] text-muted-foreground">
              Compliance is {sla.withinSla + sla.approaching} of {sla.measured} measured steps.
              {sla.noClock > 0 && ` ${sla.noClock} steps carry no SLA and are excluded from the denominator.`}
            </p>

            {sla.byLevel.length > 0 && (
              <ChartCard
                title="Escalation by level"
                description="Distinct approvals that reached each level. A file counted at Level 3 also passed Levels 1 and 2."
                tableColumns={['Level', 'Approvals']}
                tableRows={sla.byLevel.map((row) => [row.level, row.approvals])}
                chart={
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={sla.byLevel} margin={{ top: 18, right: 12, bottom: 4, left: 4 }}>
                      <CartesianGrid vertical={false} stroke={EA_VIZ.grid} />
                      <XAxis dataKey="level" fontSize={11} stroke={EA_VIZ.axis} tickLine={false} />
                      <YAxis allowDecimals={false} fontSize={11} stroke={EA_VIZ.axis} tickLine={false} axisLine={false} />
                      <Tooltip cursor={{ fill: 'rgba(15,23,42,0.03)' }} {...eaTooltipStyle} />
                      <Bar isAnimationActive={false} dataKey="approvals" name="Approvals" radius={[4, 4, 0, 0]} maxBarSize={48}>
                        {sla.byLevel.map((row) => (
                          <Cell key={row.level} fill={LEVEL_TONE[row.level] ?? EA_VIZ.status.warning} />
                        ))}
                        <LabelList dataKey="approvals" position="top" fontSize={11} fill="#52514e" />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                }
              />
            )}

            <ChartCard
              title="Weakest compliance"
              description="Lowest first. Groups with no measured step are omitted rather than shown as 100%."
              action={
                <Select value={dimension} onValueChange={(next) => setDimension(next as SlaDimension)}>
                  <SelectTrigger className="h-7 w-[150px] text-xs">
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
              tableColumns={['Group', 'Compliance %', 'Measured', 'Breached']}
              tableRows={byDimension.map((row) => [row.label, row.compliancePercent ?? '—', row.measured, row.breached])}
              chart={
                <ResponsiveContainer width="100%" height={Math.max(200, worst.length * 32 + 40)}>
                  <BarChart data={worst} layout="vertical" margin={{ top: 4, right: 52, bottom: 4, left: 4 }}>
                    <CartesianGrid horizontal={false} stroke={EA_VIZ.grid} />
                    <XAxis type="number" domain={[0, 100]} fontSize={11} stroke={EA_VIZ.axis} tickLine={false} unit="%" />
                    <YAxis type="category" dataKey="label" width={150} fontSize={11} stroke={EA_VIZ.axis} tickLine={false} axisLine={false} />
                    <Tooltip cursor={{ fill: 'rgba(15,23,42,0.03)' }} {...eaTooltipStyle} />
                    <Bar isAnimationActive={false} dataKey="compliance" name="Compliance %" radius={[0, 4, 4, 0]} maxBarSize={20}>
                      {worst.map((row) => (
                        <Cell
                          key={row.label}
                          fill={
                            row.compliance >= 90
                              ? EA_VIZ.status.good
                              : row.compliance >= 70
                                ? EA_VIZ.status.warning
                                : EA_VIZ.status.critical
                          }
                        />
                      ))}
                      <LabelList
                        dataKey="compliance"
                        position="right"
                        fontSize={11}
                        fill="#52514e"
                        formatter={(value: unknown) => `${value}%`}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              }
            />

            <Card>
              <CardContent className="px-2 py-3 sm:px-3">
                <p className="mb-1 flex items-center gap-1.5 px-1 text-sm font-semibold">
                  <Clock className="h-4 w-4 text-amber-600" /> Approaching SLA
                </p>
                <p className="mb-2 px-1 text-[11px] text-muted-foreground">
                  Steps with 80% or more of their clock consumed and still running — the chase list.
                </p>
                {approaching.length === 0 ? (
                  <p className="px-1 py-6 text-center text-sm text-muted-foreground">
                    Nothing is close to breaching.
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/40">
                          <TableHead>Reference</TableHead>
                          <TableHead>Subject</TableHead>
                          <TableHead>Stage</TableHead>
                          <TableHead>Held by</TableHead>
                          <TableHead>Due</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {approaching.map(({ step, request }) => (
                          <TableRow key={step.id}>
                            <TableCell className="whitespace-nowrap font-mono text-[11px]">
                              {request?.referenceNo || '—'}
                            </TableCell>
                            <TableCell className="max-w-[240px] truncate text-xs">{request?.subject || '—'}</TableCell>
                            <TableCell className="whitespace-nowrap text-xs">{step.name}</TableCell>
                            <TableCell className="whitespace-nowrap text-xs">
                              {step.assignment?.userName || step.assignment?.departmentName || step.assignment?.role || '—'}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs">
                              <Badge variant="outline" className={cn('text-[10px]', 'border-amber-200 bg-amber-50 text-amber-800')}>
                                <AlertTriangle className="mr-1 h-3 w-3" />
                                {step.dueAt ? new Date(step.dueAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
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
