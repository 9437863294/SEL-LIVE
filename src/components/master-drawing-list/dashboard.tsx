'use client';

/**
 * Reports — Project Management's MDL reports for one drawing list, and the module's landing page:
 * the headline figures, the status split, where drawings sit by revision round, progress per
 * schedule and scope, and what is overdue or due within two weeks. A row opens its drawing.
 */

import { useMemo } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, Clock, FileStack, Layers } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { DataList, type ListColumn } from '@/components/shared/data-list';
import { TableCard } from '@/components/shared/table-card';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { chartChrome } from '@/components/ui/chart';
import { OVERALL_STATUSES, REVISION_ROUNDS, formatMdlDate, isApproved, latestRevisionAcrossItem, roundIndex, rollup, type DrawingItem, type OverallStatus, type Rollup } from '@/lib/master-drawing-list/drawings';
import { cn } from '@/lib/utils';

import { MdlStatus, StatCard } from './mdl-ui';

const STATUS_COLORS: Record<OverallStatus, string> = {
  Pending: '#94a3b8',
  'In Progress': '#3b82f6',
  Approved: '#10b981',
  'Approved with Comments': '#f59e0b',
  Rejected: '#ef4444',
};

const UPCOMING_WINDOW_DAYS = 14;

type ReportRow = { id: string; item: DrawingItem; rollup: Rollup };

const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export function ReportsView({ items, today, onSelect }: { items: DrawingItem[]; today: string; onSelect: (item: DrawingItem) => void }) {
  const total = items.length;
  const rows = useMemo<ReportRow[]>(() => items.map((item) => ({ id: item.id, item, rollup: rollup(item, today) })), [items, today]);

  const subTotals = useMemo(() => rows.reduce((sum, { rollup: r }) => ({ total: sum.total + r.subTotal, approved: sum.approved + r.subApproved }), { total: 0, approved: 0 }), [rows]);

  const statusCounts = useMemo(() => {
    const counts = new Map<OverallStatus, number>(OVERALL_STATUSES.map((status) => [status, 0]));
    for (const { rollup: r } of rows) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
    return counts;
  }, [rows]);
  const statusData = useMemo(() => OVERALL_STATUSES.map((status) => ({ name: status, value: statusCounts.get(status) ?? 0 })).filter((entry) => entry.value > 0), [statusCounts]);

  // Rounds beyond R3 are shown only once a drawing has reached them.
  const stageData = useMemo(() => {
    const counts = new Map<string, number>();
    for (const { item } of rows) {
      const round = latestRevisionAcrossItem(item)?.round ?? 'R0';
      counts.set(round, (counts.get(round) ?? 0) + 1);
    }
    const deepest = Math.max(3, ...[...counts.keys()].map(roundIndex));
    return REVISION_ROUNDS.slice(0, deepest + 1).map((round) => ({ name: round, count: counts.get(round) ?? 0 }));
  }, [rows]);

  const overdueRows = useMemo(() => rows.filter((row) => row.rollup.overdue).sort((a, b) => a.rollup.plannedEndDate.localeCompare(b.rollup.plannedEndDate)), [rows]);
  const upcomingRows = useMemo(() => {
    const horizon = addDays(today, UPCOMING_WINDOW_DAYS);
    return rows
      .filter(({ rollup: r }) => !r.overdue && !isApproved(r.status) && r.plannedEndDate && r.plannedEndDate >= today && r.plannedEndDate <= horizon)
      .sort((a, b) => a.rollup.plannedEndDate.localeCompare(b.rollup.plannedEndDate));
  }, [rows, today]);

  const scopeProgress = useMemo(() => {
    const map = new Map<string, { total: number; approved: number }>();
    for (const { item, rollup: r } of rows) {
      const key = `${item.schedule} › ${item.scope}`;
      const entry = map.get(key) ?? { total: 0, approved: 0 };
      entry.total += 1;
      if (isApproved(r.status)) entry.approved += 1;
      map.set(key, entry);
    }
    return [...map.entries()].map(([scope, { total: scopeTotal, approved }]) => ({ scope, total: scopeTotal, approved, percent: scopeTotal ? Math.round((approved / scopeTotal) * 100) : 0 }));
  }, [rows]);

  const approvedCount = (statusCounts.get('Approved') ?? 0) + (statusCounts.get('Approved with Comments') ?? 0);
  const rejectedCount = statusCounts.get('Rejected') ?? 0;
  const inProgressCount = (statusCounts.get('Pending') ?? 0) + (statusCounts.get('In Progress') ?? 0);

  const dueColumns = (overdue: boolean): ListColumn<ReportRow>[] => [
    { header: 'Item', mobile: 'title', className: 'max-w-[200px] truncate', cell: ({ item }) => item.description || '—' },
    { header: 'Planned End', className: 'whitespace-nowrap', cell: ({ rollup: r }) => <span className={overdue ? 'text-red-600' : undefined}>{formatMdlDate(r.plannedEndDate)}</span> },
    { header: 'Status', mobile: 'aside', cell: ({ rollup: r }) => <MdlStatus status={r.status} /> },
  ];

  return (
    <div className="space-y-5">
      <div className={cn('grid grid-cols-2 gap-3 sm:grid-cols-3', subTotals.total ? 'lg:grid-cols-6' : 'lg:grid-cols-5')}>
        <StatCard label="Total Items" value={total} icon={FileStack} tone="bg-slate-100 text-slate-700" />
        {subTotals.total > 0 && <StatCard label="Sub-drawings Approved" value={`${subTotals.approved}/${subTotals.total}`} icon={Layers} tone="bg-sky-100 text-sky-700" />}
        <StatCard label="Approved" value={approvedCount} icon={CheckCircle2} tone="bg-emerald-100 text-emerald-700" />
        <StatCard label="Pending / In Progress" value={inProgressCount} icon={Clock} tone="bg-blue-100 text-blue-700" />
        <StatCard label="Rejected" value={rejectedCount} icon={AlertTriangle} tone="bg-red-100 text-red-700" />
        <StatCard label="Overdue" value={overdueRows.length} icon={CalendarClock} tone="bg-orange-100 text-orange-700" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Status distribution</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            {statusData.length ? (
              <ResponsiveContainer>
                <PieChart>
                  <Pie stroke={chartChrome.surface} data={statusData} dataKey="value" nameKey="name" outerRadius={85} label>
                    {statusData.map((entry) => (
                      <Cell key={entry.name} fill={STATUS_COLORS[entry.name as OverallStatus] ?? '#94a3b8'} />
                    ))}
                  </Pie>
                  <Tooltip {...chartChrome.tooltip} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="flex h-full items-center justify-center text-sm text-muted-foreground">No data yet</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Current submission stage</CardTitle>
            <CardDescription>How many drawings are currently sitting at each revision round</CardDescription>
          </CardHeader>
          <CardContent className="h-56 sm:h-64">
            <ResponsiveContainer>
              <BarChart data={stageData}>
                <CartesianGrid stroke={chartChrome.grid} strokeDasharray="3 3" />
                <XAxis stroke={chartChrome.axis} dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis stroke={chartChrome.axis} allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip {...chartChrome.tooltip} />
                <Bar dataKey="count" fill="#6366f1" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Scope-wise progress</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {scopeProgress.length ? (
            scopeProgress.map(({ scope, total: scopeTotal, approved, percent }) => (
              <div key={scope}>
                <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate font-medium" title={scope}>
                    {scope}
                  </span>
                  <span className="shrink-0 whitespace-nowrap text-muted-foreground">
                    {approved}/{scopeTotal} approved · {percent}%
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: `${percent}%` }} />
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No data yet.</p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TableCard title="Overdue" description="Planned end date has passed without approval" icon={CalendarClock} count={overdueRows.length} noun="item" scroll="natural">
          {overdueRows.length ? <DataList rows={overdueRows} columns={dueColumns(true)} onRowClick={({ item }) => onSelect(item)} frameless /> : <p className="p-4 text-sm text-muted-foreground">Nothing overdue.</p>}
        </TableCard>
        <TableCard title={`Due in the next ${UPCOMING_WINDOW_DAYS} days`} icon={Clock} count={upcomingRows.length} noun="item" scroll="natural">
          {upcomingRows.length ? <DataList rows={upcomingRows} columns={dueColumns(false)} onRowClick={({ item }) => onSelect(item)} frameless /> : <p className="p-4 text-sm text-muted-foreground">Nothing due soon.</p>}
        </TableCard>
      </div>
    </div>
  );
}
