"use client";

import { useMemo } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, Clock, FileStack, Layers } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { chartChrome } from "@/components/ui/chart";
import StatCard from "@/components/project-management/stat-card";
import { PmDataList, type PmListColumn } from "@/components/project-management/pm-shell";
import { cn } from "@/lib/utils";
import {
  MDL_OVERALL_STATUSES,
  MDL_REVISION_ROUNDS,
  formatMdlDate,
  getLatestRevisionAcrossItem,
  getMdlRollup,
  isMdlApproved,
  mdlOverallStatusStyles,
  type MdlOverallStatus,
  type MdlRollup,
  type MdlRow,
} from "@/lib/mdl";

const STATUS_COLORS: Record<MdlOverallStatus, string> = {
  Pending: "#94a3b8",
  "In Progress": "#3b82f6",
  Approved: "#10b981",
  "Approved with Comments": "#f59e0b",
  Rejected: "#ef4444",
};

const UPCOMING_WINDOW_DAYS = 14;

// `id` is the BOQ item's, so the overdue and due-soon lists can render through PmDataList.
type ReportRow = MdlRow & { id: string; rollup: MdlRollup };

export default function MdlReports({
  rows,
  onSelectItem,
}: {
  rows: MdlRow[];
  onSelectItem: (boqItemId: string) => void;
}) {
  const total = rows.length;

  // Every figure below is driven by the rolled-up state of each BOQ item, so an item whose
  // sub-drawings are still outstanding never reports as approved here while the register
  // shows it as in progress.
  const reportRows = useMemo<ReportRow[]>(
    () => rows.map((row) => ({ ...row, id: row.item.id, rollup: getMdlRollup(row.drawing) })),
    [rows],
  );

  const subDrawingTotals = useMemo(
    () =>
      reportRows.reduce(
        (totals, { rollup }) => ({
          total: totals.total + rollup.subTotal,
          approved: totals.approved + rollup.subApproved,
        }),
        { total: 0, approved: 0 },
      ),
    [reportRows],
  );

  const statusCounts = useMemo(() => {
    const counts = new Map<MdlOverallStatus, number>(MDL_OVERALL_STATUSES.map((status) => [status, 0]));
    for (const { rollup } of reportRows) {
      counts.set(rollup.status, (counts.get(rollup.status) ?? 0) + 1);
    }
    return counts;
  }, [reportRows]);

  const statusData = useMemo(
    () =>
      MDL_OVERALL_STATUSES.map((status) => ({ name: status, value: statusCounts.get(status) ?? 0 })).filter(
        (entry) => entry.value > 0,
      ),
    [statusCounts],
  );

  const stageData = useMemo(() => {
    const counts = new Map(MDL_REVISION_ROUNDS.map((round) => [round, 0]));
    for (const { drawing } of reportRows) {
      if (!drawing) continue;
      const round = getLatestRevisionAcrossItem(drawing)?.round ?? "R0";
      counts.set(round, (counts.get(round) ?? 0) + 1);
    }
    return MDL_REVISION_ROUNDS.map((round) => ({ name: round, count: counts.get(round) ?? 0 }));
  }, [reportRows]);

  const overdueRows = useMemo(
    () =>
      reportRows
        .filter((row) => row.rollup.overdue)
        .sort((a, b) => a.rollup.plannedEndDate.localeCompare(b.rollup.plannedEndDate)),
    [reportRows],
  );

  const upcomingRows = useMemo(() => {
    const today = new Date();
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + UPCOMING_WINDOW_DAYS);
    return reportRows
      .filter(({ drawing, rollup }) => {
        if (!drawing || rollup.overdue || isMdlApproved(rollup.status)) return false;
        if (!rollup.plannedEndDate) return false;
        const end = new Date(`${rollup.plannedEndDate}T00:00:00`);
        return end >= today && end <= horizon;
      })
      .sort((a, b) => a.rollup.plannedEndDate.localeCompare(b.rollup.plannedEndDate));
  }, [reportRows]);

  const scopeProgress = useMemo(() => {
    const map = new Map<string, { total: number; approved: number }>();
    for (const { item, rollup } of reportRows) {
      const scope = String(item["Scope 1"] ?? "").trim() || "Ungrouped";
      const entry = map.get(scope) ?? { total: 0, approved: 0 };
      entry.total += 1;
      if (isMdlApproved(rollup.status)) entry.approved += 1;
      map.set(scope, entry);
    }
    return Array.from(map.entries()).map(([scope, { total: scopeTotal, approved }]) => ({
      scope,
      total: scopeTotal,
      approved,
      percent: scopeTotal ? Math.round((approved / scopeTotal) * 100) : 0,
    }));
  }, [reportRows]);

  const approvedCount = (statusCounts.get("Approved") ?? 0) + (statusCounts.get("Approved with Comments") ?? 0);
  const rejectedCount = statusCounts.get("Rejected") ?? 0;
  const inProgressCount = (statusCounts.get("Pending") ?? 0) + (statusCounts.get("In Progress") ?? 0);

  // Shared by the Overdue and Due-soon lists: a card per item on a phone, the three-column table
  // from `sm`. `overdue` only colours the date.
  const dueColumns = (overdue: boolean): PmListColumn<ReportRow>[] => [
    {
      header: "Item",
      mobile: "title",
      className: "max-w-[200px] truncate",
      cell: ({ item }) => String(item.Description ?? "—"),
    },
    {
      header: "Planned End",
      className: "whitespace-nowrap",
      cell: ({ rollup }) => (
        <span className={overdue ? "text-red-600" : undefined}>{formatMdlDate(rollup.plannedEndDate)}</span>
      ),
    },
    {
      header: "Status",
      mobile: "aside",
      cell: ({ rollup }) => (
        <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", mdlOverallStatusStyles[rollup.status])}>
          {rollup.status}
        </span>
      ),
    },
  ];

  // The list sits inside the section's own Card, so its desktop frame is dropped (the Card is the
  // frame) and on a phone the cards get the padding the Card's `p-0` content does not give them.
  const DUE_LIST_CLASS = "max-sm:px-3 max-sm:pb-3 sm:rounded-none sm:border-0 sm:shadow-none";

  return (
    <div className="space-y-5">
      <div className={cn("grid grid-cols-2 gap-3 sm:grid-cols-3", subDrawingTotals.total ? "lg:grid-cols-6" : "lg:grid-cols-5")}>
        <StatCard label="Total Items" value={total} icon={FileStack} tone="bg-slate-100 text-slate-700" />
        {subDrawingTotals.total > 0 && (
          <StatCard
            label="Sub-drawings Approved"
            value={`${subDrawingTotals.approved}/${subDrawingTotals.total}`}
            icon={Layers}
            tone="bg-sky-100 text-sky-700"
          />
        )}
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
                      <Cell key={entry.name} fill={STATUS_COLORS[entry.name as MdlOverallStatus] ?? "#94a3b8"} />
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
                  <span className="min-w-0 truncate font-medium" title={scope}>{scope}</span>
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
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-red-700">Overdue ({overdueRows.length})</CardTitle>
            <CardDescription>Planned end date has passed without approval</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {overdueRows.length ? (
              <PmDataList
                rows={overdueRows}
                columns={dueColumns(true)}
                onRowClick={({ item }) => onSelectItem(item.id)}
                className={DUE_LIST_CLASS}
              />
            ) : (
              <p className="p-4 text-sm text-muted-foreground">Nothing overdue.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Due in the next {UPCOMING_WINDOW_DAYS} days ({upcomingRows.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {upcomingRows.length ? (
              <PmDataList
                rows={upcomingRows}
                columns={dueColumns(false)}
                onRowClick={({ item }) => onSelectItem(item.id)}
                className={DUE_LIST_CLASS}
              />
            ) : (
              <p className="p-4 text-sm text-muted-foreground">Nothing due soon.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
