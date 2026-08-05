"use client";

import { useMemo } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, Clock, FileStack } from "lucide-react";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import StatCard from "@/components/project-management/stat-card";
import { cn } from "@/lib/utils";
import {
  MDL_OVERALL_STATUSES,
  MDL_REVISION_ROUNDS,
  formatMdlDate,
  getLatestRevision,
  isMdlOverdue,
  mdlOverallStatusStyles,
  type MdlOverallStatus,
  type MdlRow,
} from "@/lib/mdl";

const STATUS_COLORS: Record<MdlOverallStatus, string> = {
  Pending: "#94a3b8",
  "In Progress": "#3b82f6",
  Approved: "#10b981",
  "Approved with Comments": "#f59e0b",
  Rejected: "#ef4444",
};

const APPROVED_STATUSES: MdlOverallStatus[] = ["Approved", "Approved with Comments"];
const UPCOMING_WINDOW_DAYS = 14;

export default function MdlReports({
  rows,
  onSelectItem,
}: {
  rows: MdlRow[];
  onSelectItem: (boqItemId: string) => void;
}) {
  const total = rows.length;

  const statusCounts = useMemo(() => {
    const counts = new Map<MdlOverallStatus, number>(MDL_OVERALL_STATUSES.map((status) => [status, 0]));
    for (const { drawing } of rows) {
      const status = drawing?.status ?? "Pending";
      counts.set(status, (counts.get(status) ?? 0) + 1);
    }
    return counts;
  }, [rows]);

  const statusData = useMemo(
    () =>
      MDL_OVERALL_STATUSES.map((status) => ({ name: status, value: statusCounts.get(status) ?? 0 })).filter(
        (entry) => entry.value > 0,
      ),
    [statusCounts],
  );

  const stageData = useMemo(() => {
    const counts = new Map(MDL_REVISION_ROUNDS.map((round) => [round, 0]));
    for (const { drawing } of rows) {
      if (!drawing) continue;
      const round = getLatestRevision(drawing.revisions ?? [])?.round ?? "R0";
      counts.set(round, (counts.get(round) ?? 0) + 1);
    }
    return MDL_REVISION_ROUNDS.map((round) => ({ name: round, count: counts.get(round) ?? 0 }));
  }, [rows]);

  const overdueRows = useMemo(
    () =>
      rows
        .filter((row) => isMdlOverdue(row.drawing))
        .sort((a, b) => (a.drawing?.plannedEndDate ?? "").localeCompare(b.drawing?.plannedEndDate ?? "")),
    [rows],
  );

  const upcomingRows = useMemo(() => {
    const today = new Date();
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + UPCOMING_WINDOW_DAYS);
    return rows
      .filter((row) => {
        const drawing = row.drawing;
        if (!drawing || isMdlOverdue(drawing) || APPROVED_STATUSES.includes(drawing.status)) return false;
        if (!drawing.plannedEndDate) return false;
        const end = new Date(`${drawing.plannedEndDate}T00:00:00`);
        return end >= today && end <= horizon;
      })
      .sort((a, b) => (a.drawing?.plannedEndDate ?? "").localeCompare(b.drawing?.plannedEndDate ?? ""));
  }, [rows]);

  const scopeProgress = useMemo(() => {
    const map = new Map<string, { total: number; approved: number }>();
    for (const { item, drawing } of rows) {
      const scope = String(item["Scope 1"] ?? "").trim() || "Ungrouped";
      const entry = map.get(scope) ?? { total: 0, approved: 0 };
      entry.total += 1;
      if (drawing && APPROVED_STATUSES.includes(drawing.status)) entry.approved += 1;
      map.set(scope, entry);
    }
    return Array.from(map.entries()).map(([scope, { total: scopeTotal, approved }]) => ({
      scope,
      total: scopeTotal,
      approved,
      percent: scopeTotal ? Math.round((approved / scopeTotal) * 100) : 0,
    }));
  }, [rows]);

  const approvedCount = (statusCounts.get("Approved") ?? 0) + (statusCounts.get("Approved with Comments") ?? 0);
  const rejectedCount = statusCounts.get("Rejected") ?? 0;
  const inProgressCount = (statusCounts.get("Pending") ?? 0) + (statusCounts.get("In Progress") ?? 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatCard label="Total Drawings" value={total} icon={FileStack} tone="bg-slate-100 text-slate-700" />
        <StatCard label="Approved" value={approvedCount} icon={CheckCircle2} tone="bg-emerald-100 text-emerald-700" />
        <StatCard label="Pending / In Progress" value={inProgressCount} icon={Clock} tone="bg-blue-100 text-blue-700" />
        <StatCard label="Rejected" value={rejectedCount} icon={AlertTriangle} tone="bg-red-100 text-red-700" />
        <StatCard label="Overdue" value={overdueRows.length} icon={CalendarClock} tone="bg-orange-100 text-orange-700" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Status distribution</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            {statusData.length ? (
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={statusData} dataKey="value" nameKey="name" outerRadius={85} label>
                    {statusData.map((entry) => (
                      <Cell key={entry.name} fill={STATUS_COLORS[entry.name as MdlOverallStatus] ?? "#94a3b8"} />
                    ))}
                  </Pie>
                  <Tooltip />
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
          <CardContent className="h-64">
            <ResponsiveContainer>
              <BarChart data={stageData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
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
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium">{scope}</span>
                  <span className="text-muted-foreground">
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

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-red-700">Overdue ({overdueRows.length})</CardTitle>
            <CardDescription>Planned end date has passed without approval</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {overdueRows.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Planned End</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overdueRows.map(({ item, drawing }) => (
                    <TableRow key={item.id} className="cursor-pointer" onClick={() => onSelectItem(item.id)}>
                      <TableCell className="max-w-[200px] truncate">{String(item.Description ?? "—")}</TableCell>
                      <TableCell className="whitespace-nowrap text-red-600">{formatMdlDate(drawing?.plannedEndDate)}</TableCell>
                      <TableCell>
                        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", mdlOverallStatusStyles[drawing?.status ?? "Pending"])}>
                          {drawing?.status ?? "Pending"}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Planned End</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {upcomingRows.map(({ item, drawing }) => (
                    <TableRow key={item.id} className="cursor-pointer" onClick={() => onSelectItem(item.id)}>
                      <TableCell className="max-w-[200px] truncate">{String(item.Description ?? "—")}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatMdlDate(drawing?.plannedEndDate)}</TableCell>
                      <TableCell>
                        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", mdlOverallStatusStyles[drawing?.status ?? "Pending"])}>
                          {drawing?.status ?? "Pending"}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="p-4 text-sm text-muted-foreground">Nothing due soon.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
