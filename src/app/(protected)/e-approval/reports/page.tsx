'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Download, RefreshCw } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { exportRowsToExcel } from '@/lib/report-excel';
import {
  eApprovalAgeingBucket,
  isOpenEApprovalStatus,
  isTerminalEApprovalStatus,
  type EApprovalRequest,
  type EApprovalStep,
} from '@/lib/e-approval';
import { listEApprovals, listEApprovalSteps } from '@/lib/e-approval-service';
import { EApprovalEmptyState } from '@/components/e-approval/shared';
import {
  formatEApprovalAmount,
  formatEApprovalDate,
  useEApprovalActor,
  useEApprovalPermissions,
} from '@/components/e-approval/hooks';

const CHART_COLORS = ['#0ea5e9', '#8b5cf6', '#10b981', '#f59e0b', '#e11d48', '#14b8a6', '#6366f1', '#f97316'];

const hoursBetween = (from?: string | null, to?: string | null) => {
  if (!from || !to) return null;
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, (end - start) / 3_600_000);
};

/**
 * Reports (spec section 33).
 *
 * Turnaround is measured per *step*, not per request, and excludes paused time — the number an
 * approver can be held to is how long they held the file, not how long the file existed. A
 * request-level average punishes the last approver for four desks of delay before them.
 */
export default function EApprovalReportsPage() {
  const { toast } = useToast();
  const { serviceActor } = useEApprovalActor();
  const permissions = useEApprovalPermissions();
  const [requests, setRequests] = useState<EApprovalRequest[]>([]);
  const [steps, setSteps] = useState<EApprovalStep[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    if (!serviceActor) return;
    setIsLoading(true);
    try {
      const rows = await listEApprovals({ organizationId: serviceActor.organizationId, limit: 400 });
      setRequests(rows);
      // Steps are fetched for the most recent slice only: turnaround needs per-step timings, and
      // pulling every step of every approval ever raised to compute an average is not worth the read.
      const recent = rows.slice(0, 120);
      const stepRows = await Promise.all(recent.map((row) => listEApprovalSteps(row.id)));
      setSteps(stepRows.flat());
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Could not load reports',
        description: error instanceof Error ? error.message : 'Something went wrong.',
      });
    } finally {
      setIsLoading(false);
    }
  }, [serviceActor, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const byDepartment = useMemo(() => {
    const tally = new Map<string, { department: string; open: number; approved: number; rejected: number }>();
    requests.forEach((row) => {
      const key = row.departmentName || 'Unassigned';
      const entry = tally.get(key) ?? { department: key, open: 0, approved: 0, rejected: 0 };
      if (row.status === 'Approved') entry.approved += 1;
      else if (row.status === 'Rejected' || row.status === 'Cancelled') entry.rejected += 1;
      else if (isOpenEApprovalStatus(row.status)) entry.open += 1;
      tally.set(key, entry);
    });
    return Array.from(tally.values()).sort((a, b) => b.open + b.approved - (a.open + a.approved));
  }, [requests]);

  const byType = useMemo(() => {
    const tally = new Map<string, number>();
    requests.forEach((row) => {
      const key = row.approvalTypeName || 'Unspecified';
      tally.set(key, (tally.get(key) ?? 0) + 1);
    });
    return Array.from(tally.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [requests]);

  const monthlyTrend = useMemo(() => {
    const tally = new Map<string, { month: string; raised: number; approved: number }>();
    requests.forEach((row) => {
      const raisedAt = row.submittedAt ? new Date(row.submittedAt) : null;
      if (raisedAt && !Number.isNaN(raisedAt.getTime())) {
        const key = raisedAt.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
        const entry = tally.get(key) ?? { month: key, raised: 0, approved: 0 };
        entry.raised += 1;
        tally.set(key, entry);
      }
      if (row.status === 'Approved' && row.completedAt) {
        const closedAt = new Date(row.completedAt);
        if (!Number.isNaN(closedAt.getTime())) {
          const key = closedAt.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
          const entry = tally.get(key) ?? { month: key, raised: 0, approved: 0 };
          entry.approved += 1;
          tally.set(key, entry);
        }
      }
    });
    return Array.from(tally.values());
  }, [requests]);

  const turnaround = useMemo(() => {
    const tally = new Map<string, { approver: string; actions: number; totalHours: number; overdue: number }>();
    steps
      .filter((step) => step.completedAt && step.startedAt && step.actedByName)
      .forEach((step) => {
        const key = step.actedByName as string;
        const held = hoursBetween(step.startedAt, step.completedAt);
        if (held == null) return;
        const paused = (step.pausedMs ?? 0) / 3_600_000;
        const active = Math.max(0, held - paused);
        const entry = tally.get(key) ?? { approver: key, actions: 0, totalHours: 0, overdue: 0 };
        entry.actions += 1;
        entry.totalHours += active;
        if (step.slaHours && active > step.slaHours) entry.overdue += 1;
        tally.set(key, entry);
      });
    return Array.from(tally.values())
      .map((entry) => ({
        ...entry,
        averageHours: Math.round((entry.totalHours / Math.max(1, entry.actions)) * 10) / 10,
      }))
      .sort((a, b) => b.actions - a.actions);
  }, [steps]);

  const overdue = useMemo(
    () =>
      requests
        .filter((row) => isOpenEApprovalStatus(row.status) && row.currentDueAt && new Date(row.currentDueAt) < new Date())
        .sort((a, b) => new Date(a.currentDueAt as string).getTime() - new Date(b.currentDueAt as string).getTime()),
    [requests],
  );

  const summary = useMemo(() => {
    const open = requests.filter((row) => isOpenEApprovalStatus(row.status));
    const closed = requests.filter((row) => isTerminalEApprovalStatus(row.status));
    const cycleTimes = requests
      .filter((row) => row.status === 'Approved')
      .map((row) => hoursBetween(row.submittedAt, row.completedAt))
      .filter((value): value is number => value != null);
    return {
      total: requests.length,
      open: open.length,
      closed: closed.length,
      approvedValue: requests
        .filter((row) => row.status === 'Approved')
        .reduce((sum, row) => sum + (row.amount ?? 0), 0),
      averageCycleHours: cycleTimes.length
        ? Math.round((cycleTimes.reduce((sum, value) => sum + value, 0) / cycleTimes.length) * 10) / 10
        : null,
    };
  }, [requests]);

  const exportRegister = async () => {
    if (!requests.length) return;
    await exportRowsToExcel(
      'E-Approval Register',
      requests.map((row) => ({
        Reference: row.referenceNo || '',
        Subject: row.subject,
        Type: row.approvalTypeName || '',
        Department: row.departmentName || '',
        Project: row.projectName || '',
        Requester: row.requesterName || '',
        Amount: row.amount ?? '',
        Status: row.status,
        'Pending with': row.pendingLabel || '',
        Version: row.version,
        Submitted: formatEApprovalDate(row.submittedAt),
        Closed: formatEApprovalDate(row.completedAt),
        Age: eApprovalAgeingBucket(row.submittedAt),
      })),
    );
  };

  if (!permissions.isLoading && !permissions.canViewReports) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Not permitted</CardTitle>
          <CardDescription>You do not have permission to view E-Approval reports.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 px-3 py-2.5 sm:px-4 sm:py-3">
          <div>
            <CardTitle className="flex items-center gap-1.5 text-base">
              <BarChart3 className="h-4 w-4" /> Reports
            </CardTitle>
            <CardDescription className="text-xs">
              Across the most recent 400 approvals. Turnaround is measured per step and excludes paused time.
            </CardDescription>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => void load()} disabled={isLoading}>
              <RefreshCw className={isLoading ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} /> Refresh
            </Button>
            {permissions.canExport && (
              <Button size="sm" className="h-8 gap-1.5" onClick={() => void exportRegister()} disabled={!requests.length}>
                <Download className="h-3.5 w-3.5" /> Export register
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 px-3 pb-3 sm:grid-cols-5 sm:px-4">
          {[
            { label: 'Total', value: summary.total },
            { label: 'Open', value: summary.open },
            { label: 'Closed', value: summary.closed },
            { label: 'Approved value', value: formatEApprovalAmount(summary.approvedValue) },
            {
              label: 'Avg. cycle time',
              value: summary.averageCycleHours == null ? '—' : `${summary.averageCycleHours}h`,
            },
          ].map((tile) => (
            <div key={tile.label} className="rounded-lg border bg-muted/20 p-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{tile.label}</p>
              <p className="mt-0.5 text-base font-semibold tabular-nums">{isLoading ? '…' : tile.value}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-3 xl:grid-cols-2">
        <Card>
          <CardHeader className="px-3 py-2.5 sm:px-4">
            <CardTitle className="text-sm">By Department</CardTitle>
            <CardDescription className="text-xs">Open, approved and rejected per department.</CardDescription>
          </CardHeader>
          <CardContent className="px-1 pb-2 sm:px-3">
            {isLoading ? (
              <Skeleton className="h-[240px] w-full" />
            ) : byDepartment.length === 0 ? (
              <EApprovalEmptyState title="No data yet" />
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={byDepartment} layout="vertical" margin={{ left: 4, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                  <XAxis type="number" allowDecimals={false} fontSize={11} stroke="#94a3b8" />
                  <YAxis type="category" dataKey="department" width={110} fontSize={11} stroke="#94a3b8" tickLine={false} />
                  <Tooltip cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar isAnimationActive={false} dataKey="open" name="Open" stackId="s" fill="#0ea5e9" maxBarSize={20} />
                  <Bar isAnimationActive={false} dataKey="approved" name="Approved" stackId="s" fill="#10b981" maxBarSize={20} />
                  <Bar isAnimationActive={false} dataKey="rejected" name="Rejected/Cancelled" stackId="s" fill="#e11d48" radius={[0, 4, 4, 0]} maxBarSize={20} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="px-3 py-2.5 sm:px-4">
            <CardTitle className="text-sm">By Approval Type</CardTitle>
            <CardDescription className="text-xs">What the organisation raises note-sheets for.</CardDescription>
          </CardHeader>
          <CardContent className="px-1 pb-2 sm:px-3">
            {isLoading ? (
              <Skeleton className="h-[240px] w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie isAnimationActive={false} data={byType} dataKey="count" nameKey="name" innerRadius={50} outerRadius={88} paddingAngle={2}>
                    {byType.map((entry, index) => (
                      <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader className="px-3 py-2.5 sm:px-4">
            <CardTitle className="text-sm">Monthly Trend</CardTitle>
            <CardDescription className="text-xs">Raised against approved, by month.</CardDescription>
          </CardHeader>
          <CardContent className="px-1 pb-2 sm:px-3">
            {isLoading ? (
              <Skeleton className="h-[240px] w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={monthlyTrend} margin={{ left: 4, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="month" fontSize={11} stroke="#94a3b8" />
                  <YAxis allowDecimals={false} fontSize={11} stroke="#94a3b8" />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line isAnimationActive={false} type="monotone" dataKey="raised" name="Raised" stroke="#0ea5e9" strokeWidth={2} />
                  <Line isAnimationActive={false} type="monotone" dataKey="approved" name="Approved" stroke="#10b981" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="px-3 py-2.5 sm:px-4">
          <CardTitle className="text-sm">Turnaround by Approver</CardTitle>
          <CardDescription className="text-xs">
            Average hours a step was actually held, excluding time spent on hold or waiting on a verification.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-2 pb-3 sm:px-3">
          {isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : turnaround.length === 0 ? (
            <EApprovalEmptyState title="No completed steps yet" />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>Approver</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                    <TableHead className="text-right">Average hours held</TableHead>
                    <TableHead className="text-right">Past SLA</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {turnaround.slice(0, 20).map((row) => (
                    <TableRow key={row.approver}>
                      <TableCell className="text-xs font-medium">{row.approver}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{row.actions}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{row.averageHours}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        <span className={row.overdue > 0 ? 'font-semibold text-rose-600' : undefined}>{row.overdue}</span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="px-3 py-2.5 sm:px-4">
          <CardTitle className="text-sm">Overdue Now</CardTitle>
          <CardDescription className="text-xs">Open approvals past the SLA on their current step.</CardDescription>
        </CardHeader>
        <CardContent className="px-2 pb-3 sm:px-3">
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : overdue.length === 0 ? (
            <EApprovalEmptyState title="Nothing overdue" description="Every open approval is inside its SLA." />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>Reference</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead>Pending with</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overdue.slice(0, 25).map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap font-mono text-[11px]">{row.referenceNo}</TableCell>
                      <TableCell className="max-w-[280px] truncate text-xs">{row.subject}</TableCell>
                      <TableCell className="text-xs">{row.pendingLabel || '—'}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-rose-600">
                        {formatEApprovalDate(row.currentDueAt)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right text-xs tabular-nums">
                        {row.amount == null ? '—' : formatEApprovalAmount(row.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
