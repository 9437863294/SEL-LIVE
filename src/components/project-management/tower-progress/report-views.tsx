"use client";

/**
 * The report renderers.
 *
 * Twenty-odd reports share six renderers here, and every one of them is fed by a builder in
 * project-management-tower-reports.ts. That is deliberate: the alternative — a page component per
 * report — is how an export ends up one column behind the table it exported, and how "Foundation
 * Report" and the dashboard end up disagreeing about how many foundations are complete.
 *
 * Each renderer produces both the on-screen cells and the workbook rows from one pass, so an export
 * cannot drift from what was on screen. The same components render the printable A4 version; only the
 * page chrome around them differs.
 */

import type { ReactNode } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { ExcelSheet } from "@/lib/report-excel";
import {
  TOWER_ACTIVITY_DEFINITIONS,
  TOWER_ACTIVITY_LIST,
  activityStatusStyles,
  addDaysToKey,
  calculateTowerProgressSummary,
  formatGps,
  formatKm,
  formatTowerDate,
  isActivityComplete,
  isoWeekNumber,
  parseIsoDate,
  towerProgressHref,
  type ProjectTower,
  type TowerActivity,
  type TowerActivityStatus,
  type TowerProgressSettings,
  type TowerProgressUpdate,
} from "@/lib/project-management-tower-progress";
import {
  buildActivityRegisterRows,
  buildBeforeAfterRows,
  buildBlockedReport,
  buildCompletedTowerReport,
  buildDailyProgressReport,
  buildDelayedReport,
  buildLatestPhotoRows,
  buildMissingEvidenceReport,
  buildPendingReport,
  buildPeriodProgressReport,
  buildTowerPhotoPages,
  buildTowerStatusRows,
  buildTowerTimeline,
  monthRange,
  weekRange,
  type TowerReportDefinition,
  type TowerReportFilters,
} from "@/lib/project-management-tower-reports";
import {
  ROUTE_STATUS_COLORS,
  ROUTE_STATUS_LABELS,
  ROUTE_STATUSES,
  buildTowerRouteMap,
} from "@/lib/project-management-tower-map";
import { ALL_SECTIONS_INCLUDED, type ReportInclude } from "./report-filter-bar";
import { MissingPhotoPlate, TowerReportPhoto } from "./tower-progress-ui";

/** How many towers a photo-heavy report renders on screen before asking for a narrower filter.
 *  Print is uncapped — a client report is meant to be long. */
const PHOTO_PAGE_SCREEN_LIMIT = 20;

export interface ReportContext {
  definition: TowerReportDefinition;
  /** Which optional sections to render (§17's "Include" checkboxes). */
  include: ReportInclude;
  /** Towers after the filter bar. */
  towers: ProjectTower[];
  /** Every tower, for denominators that must not move when a filter is applied. */
  allTowers: ProjectTower[];
  updates: TowerProgressUpdate[];
  settings: TowerProgressSettings;
  filters: TowerReportFilters;
  /** Selected day for the daily report. */
  dateKey: string;
  /** Monday of the selected week. */
  weekStart: string;
  /** Any date inside the selected month. */
  monthKey: string;
  mappingId: string;
  projectName: string;
  print?: boolean;
}

/* ── Generic table shape ────────────────────────────────────────────────────────────────────── */

interface GenericColumn {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
}

interface GenericRow {
  id: string;
  cells: Record<string, ReactNode>;
  excel: Record<string, unknown>;
  tone?: "danger" | "warn" | "good";
}

interface GenericTable {
  columns: GenericColumn[];
  rows: GenericRow[];
  /** Shown above the table — the one-line answer the report exists to give. */
  headline?: string;
  emptyMessage: string;
}

const toneClass = {
  danger: "bg-red-50/60",
  warn: "bg-amber-50/60",
  good: "bg-emerald-50/50",
} as const;

/**
 * Which "Include" checkbox governs a column. Keyed by the column key the builders use, so a report
 * that drops "Contractor" drops it from the table and from the exported workbook together.
 */
const COLUMN_SECTION: Record<string, keyof ReportInclude> = {
  status: "status",
  photo: "photos",
  gps: "gps",
  contractor: "contractor",
  remarks: "remarks",
  reason: "remarks",
  detail: "remarks",
  start: "dates",
  completed: "dates",
  planned: "dates",
  date: "dates",
  survey: "dates",
  final: "dates",
};

const visibleColumns = (columns: GenericColumn[], include: ReportInclude): GenericColumn[] =>
  columns.filter((column) => {
    const section = COLUMN_SECTION[column.key];
    return section ? include[section] : true;
  });

function GenericReportTable({
  table,
  print,
  include = ALL_SECTIONS_INCLUDED,
}: {
  table: GenericTable;
  print?: boolean;
  include?: ReportInclude;
}) {
  if (!table.rows.length) {
    return <p className="p-6 text-center text-sm text-muted-foreground">{table.emptyMessage}</p>;
  }
  const columns = visibleColumns(table.columns, include);
  return (
    <div className={cn(!print && "overflow-x-auto")}>
      {table.headline && include.summary ? (
        <p className="px-4 pt-3 text-sm font-semibold">{table.headline}</p>
      ) : null}
      <Table className={print ? "text-[8pt]" : undefined}>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead
                key={column.key}
                className={cn(
                  column.align === "right" && "text-right",
                  column.align === "center" && "text-center",
                )}
              >
                {column.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {table.rows.map((row) => (
            <TableRow key={row.id} className={row.tone ? toneClass[row.tone] : undefined}>
              {columns.map((column) => (
                <TableCell
                  key={column.key}
                  className={cn(
                    column.align === "right" && "text-right",
                    column.align === "center" && "text-center",
                  )}
                >
                  {row.cells[column.key] ?? "—"}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

const dash = (value: string | number | undefined | null) =>
  value === undefined || value === null || value === "" ? "—" : String(value);

/* ── Row-report builders ────────────────────────────────────────────────────────────────────── */

function towerLink(ctx: ReportContext, towerId: string, towerNo: string): ReactNode {
  if (ctx.print) return towerNo;
  return (
    <Link
      href={towerProgressHref(ctx.mappingId, `towers/${towerId}`)}
      className="font-medium hover:underline"
    >
      {towerNo}
    </Link>
  );
}

function statusCell(status: TowerActivityStatus): ReactNode {
  return (
    <Badge className={cn(activityStatusStyles[status], "whitespace-nowrap text-[10px]")}>
      {status}
    </Badge>
  );
}

/** Activity-wise register (§10). */
function activityRegisterTable(ctx: ReportContext, activity: TowerActivity): GenericTable {
  const definition = TOWER_ACTIVITY_DEFINITIONS[activity];
  const rows = buildActivityRegisterRows(ctx.towers, ctx.updates, activity, ctx.settings);
  const completed = rows.filter((row) => row.completedDate).length;
  return {
    headline: `${definition.label}: ${completed} of ${rows.length} recorded complete`,
    emptyMessage: "No towers match the current filters.",
    columns: [
      { key: "tower", label: "Tower" },
      { key: "location", label: "Location" },
      { key: "type", label: "Type" },
      { key: "contractor", label: "Contractor" },
      { key: "status", label: "Status" },
      { key: "start", label: "Start" },
      { key: "completed", label: "Completed" },
      ...(definition.measure === "span"
        ? [{ key: "quantity", label: "Length", align: "right" as const }]
        : []),
      { key: "evidence", label: "Evidence", align: "center" as const },
      { key: "photo", label: "Photo", align: "center" as const },
      { key: "remarks", label: "Remarks / reason" },
    ],
    rows: rows.map((row) => ({
      id: row.towerId,
      tone: row.status === "Blocked" ? "danger" : !row.evidenceComplete && row.completedDate ? "warn" : undefined,
      cells: {
        tower: towerLink(ctx, row.towerId, row.towerNo),
        location: dash(row.location),
        type: dash(row.towerType),
        contractor: dash(row.contractor),
        status: statusCell(row.status),
        start: formatTowerDate(row.startedDate),
        completed: formatTowerDate(row.completedDate),
        quantity: row.quantityM ? formatKm(row.quantityM) : "—",
        evidence: row.evidenceComplete ? (
          <span className="text-emerald-700">✓</span>
        ) : (
          <span className="font-semibold text-red-700">✗</span>
        ),
        photo: row.photo ? (
          <TowerReportPhoto
            compact
            url={row.photo.photo.url}
            towerNo={row.towerNo}
            activity={activity}
            progressDate={row.photo.progressDate}
          />
        ) : (
          "—"
        ),
        remarks: dash(row.reason || row.remarks),
      },
      excel: {
        Tower: row.towerNo,
        Location: row.location,
        Type: row.towerType,
        Contractor: row.contractor,
        Status: row.status,
        Start: row.startedDate,
        Completed: row.completedDate,
        ...(definition.measure === "span" ? { "Length (m)": row.quantityM ?? "" } : {}),
        "Evidence complete": row.evidenceComplete ? "Yes" : "No",
        "Client ready": row.clientReady ? "Yes" : "No",
        Photographs: row.photoCount,
        "Remarks / reason": row.reason || row.remarks,
      },
    })),
  };
}

/** Pending / delayed / blocked — all three share a shape (§11). */
function exceptionTable(
  ctx: ReportContext,
  kind: "pending" | "delayed" | "blocked",
  activity: TowerActivity | "All",
): GenericTable {
  const rows =
    kind === "pending"
      ? buildPendingReport(ctx.towers, activity)
      : kind === "delayed"
        ? buildDelayedReport(ctx.towers, ctx.settings)
        : buildBlockedReport(ctx.towers, activity);
  const headline =
    kind === "pending"
      ? `${rows.length} activit${rows.length === 1 ? "y" : "ies"} ready to run but not finished`
      : kind === "delayed"
        ? `${rows.length} activit${rows.length === 1 ? "y" : "ies"} past plan or stalled beyond ${ctx.settings.delayThresholdDays} days`
        : `${rows.length} activit${rows.length === 1 ? "y" : "ies"} blocked or on hold`;
  return {
    headline,
    emptyMessage:
      kind === "pending"
        ? "Nothing is waiting — every activity whose predecessor is done has been completed."
        : kind === "delayed"
          ? "Nothing is late against plan or stalled beyond the threshold."
          : "Nothing is blocked or on hold.",
    columns: [
      { key: "tower", label: "Tower" },
      { key: "location", label: "Location" },
      { key: "activity", label: "Activity" },
      { key: "status", label: "Status" },
      { key: "predecessors", label: "Preceding work" },
      { key: "days", label: "Days", align: "right" },
      { key: "planned", label: "Planned end" },
      { key: "contractor", label: "Contractor" },
      { key: "reason", label: "Reason / detail" },
    ],
    rows: rows.map((row) => ({
      id: `${row.towerId}-${row.activity}`,
      tone:
        row.status === "Blocked"
          ? "danger"
          : (row.daysWaiting ?? 0) >= ctx.settings.delayThresholdDays
            ? "warn"
            : undefined,
      cells: {
        tower: towerLink(ctx, row.towerId, row.towerNo),
        location: dash(row.location),
        activity: row.activityLabel,
        status: statusCell(row.status),
        predecessors: <span className="text-[11px] text-muted-foreground">{dash(row.predecessorStatuses)}</span>,
        days: row.daysWaiting ?? "—",
        planned: formatTowerDate(row.plannedEndDate),
        contractor: dash(row.contractor),
        reason: dash(row.reason || row.detail),
      },
      excel: {
        Tower: row.towerNo,
        Location: row.location,
        Activity: row.activityLabel,
        Status: row.status,
        "Preceding work": row.predecessorStatuses,
        "Days waiting": row.daysWaiting ?? "",
        "Planned end": row.plannedEndDate,
        Contractor: row.contractor,
        Reason: row.reason,
        Detail: row.detail,
      },
    })),
  };
}

/** No Evidence report (§22) — the false-completion check. */
function missingEvidenceTable(ctx: ReportContext): GenericTable {
  const rows = buildMissingEvidenceReport(ctx.towers, ctx.settings);
  const missingPhotos = rows.filter((row) => row.missingCount > 0).length;
  return {
    headline:
      rows.length === 0
        ? "Every recorded completion is backed by its minimum photographs."
        : `${missingPhotos} completion${missingPhotos === 1 ? "" : "s"} missing photographs, ${rows.length - missingPhotos} awaiting verification`,
    emptyMessage: "Every recorded completion is backed by its minimum photographs.",
    columns: [
      { key: "tower", label: "Tower" },
      { key: "location", label: "Location" },
      { key: "activity", label: "Activity" },
      { key: "status", label: "Status" },
      { key: "completed", label: "Completed" },
      { key: "photos", label: "Photos", align: "right" },
      { key: "missing", label: "Missing" },
      { key: "reportedBy", label: "Reported by" },
    ],
    rows: rows.map((row) => ({
      id: `${row.towerId}-${row.activity}`,
      tone: row.missingCount > 0 ? "danger" : "warn",
      cells: {
        tower: towerLink(ctx, row.towerId, row.towerNo),
        location: dash(row.location),
        activity: row.activityLabel,
        status: statusCell(row.status),
        completed: formatTowerDate(row.completedDate),
        photos: row.photoCount,
        missing: (
          <span className={row.awaitingVerification ? "text-amber-700" : "font-medium text-red-700"}>
            {row.awaitingVerification ? "⏳ " : "❌ "}
            {row.missing}
          </span>
        ),
        reportedBy: dash(row.reportedByName),
      },
      excel: {
        Tower: row.towerNo,
        Location: row.location,
        Activity: row.activityLabel,
        Status: row.status,
        Completed: row.completedDate,
        Photographs: row.photoCount,
        Missing: row.missing,
        "Reported by": row.reportedByName,
      },
    })),
  };
}

/** Completed towers (§12) — the handover list. */
function completedTowerTable(ctx: ReportContext): GenericTable {
  const rows = buildCompletedTowerReport(ctx.towers);
  return {
    headline: `Fully completed towers: ${rows.length} / ${ctx.allTowers.length}`,
    emptyMessage: "No tower has all seven activities complete yet.",
    columns: [
      { key: "tower", label: "Tower" },
      { key: "location", label: "Location" },
      { key: "type", label: "Type" },
      { key: "contractor", label: "Contractor" },
      { key: "survey", label: "Survey" },
      { key: "final", label: "Final activity" },
      { key: "days", label: "Days", align: "right" },
      { key: "evidence", label: "Evidence", align: "center" },
    ],
    rows: rows.map((row) => ({
      id: row.towerId,
      tone: row.evidenceComplete ? "good" : "warn",
      cells: {
        tower: towerLink(ctx, row.towerId, row.towerNo),
        location: dash(row.location),
        type: dash(row.towerType),
        contractor: dash(row.contractor),
        survey: formatTowerDate(row.surveyDate),
        final: formatTowerDate(row.finalDate),
        days: row.constructionDays ?? "—",
        evidence: row.evidenceComplete ? (
          <span className="text-emerald-700">✓ complete</span>
        ) : (
          <span className="text-amber-700">gaps</span>
        ),
      },
      excel: {
        Tower: row.towerNo,
        Location: row.location,
        Type: row.towerType,
        Contractor: row.contractor,
        "Survey completed": row.surveyDate,
        "Final activity completed": row.finalDate,
        "Construction days": row.constructionDays ?? "",
        "Evidence complete": row.evidenceComplete ? "Yes" : "No",
      },
    })),
  };
}

/** Latest photograph per tower (§6). */
function latestPhotoTable(ctx: ReportContext): GenericTable {
  const towerIds = new Set(ctx.towers.map((tower) => tower.id));
  const rows = buildLatestPhotoRows(ctx.towers, ctx.updates).filter((row) =>
    towerIds.has(row.towerId),
  );
  return {
    headline: `${rows.length} tower${rows.length === 1 ? "" : "s"} with photographic evidence on record`,
    emptyMessage: "No photographs have been recorded against these towers yet.",
    columns: [
      { key: "tower", label: "Tower" },
      { key: "location", label: "Location" },
      { key: "activity", label: "Activity" },
      { key: "status", label: "Status" },
      { key: "photo", label: "Latest photo", align: "center" },
      { key: "date", label: "Date" },
      { key: "by", label: "Uploaded by" },
      { key: "verified", label: "Verified", align: "center" },
    ],
    rows: rows.map((row) => ({
      id: row.towerId,
      cells: {
        tower: towerLink(ctx, row.towerId, row.towerNo),
        location: dash(row.location),
        activity: row.activityLabel,
        status: statusCell(row.status),
        photo: row.photo ? (
          <TowerReportPhoto
            compact
            url={row.photo.url}
            towerNo={row.towerNo}
            activity={row.activity}
            progressDate={row.progressDate}
          />
        ) : (
          "—"
        ),
        date: formatTowerDate(row.progressDate),
        by: dash(row.uploadedByName),
        verified: row.verified ? <span className="text-emerald-700">✓</span> : <span className="text-amber-700">⏳</span>,
      },
      excel: {
        Tower: row.towerNo,
        Location: row.location,
        Activity: row.activityLabel,
        Status: row.status,
        Date: row.progressDate,
        "Uploaded by": row.uploadedByName,
        Verified: row.verified ? "Yes" : "No",
        "Photo URL": row.photo?.url ?? "",
      },
    })),
  };
}

/** Dispatches the flat-table reports to their builder. */
function rowsTableFor(ctx: ReportContext): GenericTable {
  const { definition } = ctx;
  switch (definition.id) {
    case "pending":
      return exceptionTable(ctx, "pending", "All");
    case "delayed":
      return exceptionTable(ctx, "delayed", "All");
    case "missing-evidence":
      return missingEvidenceTable(ctx);
    case "row-blocked":
      return exceptionTable(ctx, "blocked", "row");
    case "completed-towers":
      return completedTowerTable(ctx);
    case "foundation-pending":
    case "structure-pending":
    case "erection-pending":
    case "stringing-pending":
      return exceptionTable(ctx, "pending", definition.activity ?? "All");
    default:
      return activityRegisterTable(ctx, definition.activity ?? "erection");
  }
}

/* ── Renderers ──────────────────────────────────────────────────────────────────────────────── */

function ProjectSummaryReport({ ctx }: { ctx: ReportContext }) {
  const summary = calculateTowerProgressSummary(ctx.towers, ctx.settings);
  return (
    <div className="space-y-4">
      {ctx.include.summary ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "Total towers", value: summary.totalTowers },
            { label: "Spans", value: summary.totalSpans },
            { label: "Overall progress", value: `${summary.overallProgressPct}%` },
            { label: "Fully completed", value: summary.fullyCompletedTowers },
            { label: "Blocked towers", value: summary.blockedTowers },
            { label: "No evidence", value: summary.towersWithoutEvidence },
          ].map((metric) => (
            <div key={metric.label} className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">{metric.label}</p>
              <p className="mt-0.5 text-lg font-bold tabular-nums">{metric.value}</p>
            </div>
          ))}
        </div>
      ) : null}
      <GenericReportTable
        print={ctx.print}
        include={ctx.include}
        table={{
          emptyMessage: "No towers in scope.",
          columns: [
            { key: "activity", label: "Activity" },
            { key: "total", label: "Total", align: "right" },
            { key: "completed", label: "Completed", align: "right" },
            { key: "wip", label: "In Progress", align: "right" },
            { key: "pending", label: "Pending", align: "right" },
            { key: "blocked", label: "Blocked", align: "right" },
            { key: "quantity", label: "Length", align: "right" },
            { key: "pct", label: "%", align: "right" },
          ],
          rows: summary.activities.map((activity) => ({
            id: activity.activity,
            cells: {
              activity: (
                <span className="font-medium">
                  {activity.label}
                  {activity.measure === "span" ? (
                    <span className="ml-1 text-xs text-muted-foreground">(spans)</span>
                  ) : null}
                </span>
              ),
              total: activity.total,
              completed: activity.completed,
              wip: activity.inProgress,
              pending: activity.pending,
              blocked: activity.blocked,
              quantity: activity.quantityM > 0 ? formatKm(activity.quantityM) : "—",
              pct: <span className="font-semibold">{activity.completionPct}%</span>,
            },
            excel: {
              Activity: activity.label,
              "Measured per": activity.measure,
              Total: activity.total,
              Completed: activity.completed,
              "In Progress": activity.inProgress,
              Pending: activity.pending,
              Blocked: activity.blocked,
              "On Hold": activity.hold,
              "No evidence": activity.missingEvidence,
              "Length (m)": activity.quantityM,
              "%": activity.completionPct,
            },
          })),
        }}
      />
    </div>
  );
}

/** Tower Status matrix (§2) — the module's main report. */
function TowerStatusReport({ ctx }: { ctx: ReportContext }) {
  const rows = buildTowerStatusRows(ctx.towers, ctx.settings);
  return (
    <div className={cn(!ctx.print && "overflow-x-auto")}>
      <Table className={ctx.print ? "text-[8pt]" : undefined}>
        <TableHeader>
          <TableRow>
            <TableHead>Tower</TableHead>
            <TableHead>Location</TableHead>
            <TableHead>Type</TableHead>
            {TOWER_ACTIVITY_LIST.map((definition) => (
              <TableHead key={definition.key} className="text-center">
                {definition.shortLabel}
              </TableHead>
            ))}
            <TableHead className="text-right">Overall</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.towerId} className={row.evidenceGap ? "bg-amber-50/60" : undefined}>
              <TableCell>{towerLink(ctx, row.towerId, row.towerNo)}</TableCell>
              <TableCell className="max-w-40 truncate text-xs">{dash(row.location)}</TableCell>
              <TableCell className="text-xs">{dash(row.towerType)}</TableCell>
              {row.cells.map((cell) => (
                <TableCell key={cell.activity} className="text-center">
                  <span
                    className={cn(
                      "inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold",
                      activityStatusStyles[cell.status],
                      !cell.evidenceComplete &&
                        cell.token !== "—" &&
                        cell.status !== "Not Started" &&
                        cell.status !== "Ready" &&
                        "ring-1 ring-amber-400",
                    )}
                    title={`${TOWER_ACTIVITY_DEFINITIONS[cell.activity].label}: ${cell.status}${
                      cell.completedDate ? ` · ${formatTowerDate(cell.completedDate)}` : ""
                    }`}
                  >
                    {cell.token}
                  </span>
                </TableCell>
              ))}
              <TableCell className="text-right font-semibold tabular-nums">{row.overallPct}%</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {!rows.length ? (
        <p className="p-6 text-center text-sm text-muted-foreground">
          No towers match the current filters.
        </p>
      ) : null}
    </div>
  );
}

/** Daily Progress (§7). */
function DailyProgressReport({ ctx }: { ctx: ReportContext }) {
  const towerIds = new Set(ctx.towers.map((tower) => tower.id));
  const scoped = ctx.updates.filter((update) => towerIds.has(update.towerId));
  const report = buildDailyProgressReport(scoped, ctx.dateKey);

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold">
          Daily project progress — {formatTowerDate(ctx.dateKey)}
        </h3>
        <p className="text-sm text-muted-foreground">
          {report.totalUpdates} update{report.totalUpdates === 1 ? "" : "s"} recorded.
        </p>
      </div>

      {report.completions.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {report.completions.map((line) => (
            <div key={line.activity} className="break-inside-avoid rounded-lg border p-3">
              <p className="text-sm font-semibold">
                {line.label} completed today:{" "}
                {line.measure === "span" && line.quantityM > 0
                  ? formatKm(line.quantityM)
                  : `${line.count} tower${line.count === 1 ? "" : "s"}`}
              </p>
              {line.towerNos.length ? (
                <p className="mt-1 text-xs text-muted-foreground">{line.towerNos.join(", ")}</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          No activity was completed on this date.
        </p>
      )}

      {report.otherUpdates.length ? (
        <div>
          <h4 className="mb-2 text-sm font-semibold">Other movements</h4>
          <GenericReportTable
            print={ctx.print}
        include={ctx.include}
            table={{
              emptyMessage: "",
              columns: [
                { key: "tower", label: "Tower" },
                { key: "activity", label: "Activity" },
                { key: "status", label: "Status" },
                { key: "remarks", label: "Remarks / reason" },
              ],
              rows: report.otherUpdates.map((entry, index) => ({
                id: `${entry.towerNo}-${entry.activityLabel}-${index}`,
                cells: {
                  tower: entry.towerNo,
                  activity: entry.activityLabel,
                  status: statusCell(entry.status),
                  remarks: dash(entry.remarks),
                },
                excel: {
                  Tower: entry.towerNo,
                  Activity: entry.activityLabel,
                  Status: entry.status,
                  Remarks: entry.remarks,
                },
              })),
            }}
          />
        </div>
      ) : null}

      {report.photos.length && ctx.include.photos ? (
        <div>
          <h4 className="mb-2 text-sm font-semibold">Photographic progress</h4>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {report.photos.map((entry) => (
              <div key={`${entry.updateId}-${entry.photo.id}`} className="space-y-1">
                <TowerReportPhoto
                  url={entry.photo.url}
                  towerNo={entry.towerNo}
                  activity={entry.activity}
                  progressDate={entry.progressDate}
                  gps={entry.photo.gps}
                  uploadedByName={entry.uploadedByName}
                  verified={entry.verified}
                />
                <p className="text-xs text-muted-foreground">
                  {entry.towerNo} · {entry.activityLabel}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Weekly and Monthly progress (§8, §9). */
function PeriodProgressReport({ ctx }: { ctx: ReportContext }) {
  const isMonthly = ctx.definition.id === "monthly-progress";
  const range = isMonthly
    ? monthRange(ctx.monthKey)
    : weekRange(
        ctx.weekStart,
        isoWeekNumber(parseIsoDate(ctx.weekStart) ?? new Date()),
      );
  const towerIds = new Set(ctx.towers.map((tower) => tower.id));
  const report = buildPeriodProgressReport(
    ctx.towers,
    ctx.updates.filter((update) => towerIds.has(update.towerId)),
    range,
    ctx.settings,
  );

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold">
          {report.label} · {formatTowerDate(report.fromDate)} to {formatTowerDate(report.toDate)}
        </h3>
        <p className="text-sm text-muted-foreground">
          Overall progress {report.overallProgressPct}% across {ctx.towers.length} towers.
        </p>
      </div>

      <GenericReportTable
        print={ctx.print}
        include={ctx.include}
        table={{
          emptyMessage: "No towers in scope.",
          columns: [
            { key: "activity", label: "Activity" },
            { key: "opening", label: "Opening", align: "right" },
            { key: "period", label: isMonthly ? "This month" : "This week", align: "right" },
            { key: "cumulative", label: "Cumulative", align: "right" },
            { key: "balance", label: "Balance", align: "right" },
            { key: "quantity", label: "Length done", align: "right" },
            { key: "towers", label: "Towers completed" },
          ],
          rows: report.lines.map((line) => ({
            id: line.activity,
            cells: {
              activity: (
                <span className="font-medium">
                  {line.label}
                  {line.measure === "span" ? (
                    <span className="ml-1 text-xs text-muted-foreground">(spans)</span>
                  ) : null}
                </span>
              ),
              opening: line.opening,
              period: <span className="font-semibold">{line.thisPeriod}</span>,
              cumulative: line.cumulative,
              balance: line.balance,
              quantity: line.quantityThisPeriodM > 0 ? formatKm(line.quantityThisPeriodM) : "—",
              towers: (
                <span className="text-[11px] text-muted-foreground">
                  {line.towerNos.join(", ") || "—"}
                </span>
              ),
            },
            excel: {
              Activity: line.label,
              Total: line.total,
              Opening: line.opening,
              [isMonthly ? "This month" : "This week"]: line.thisPeriod,
              Cumulative: line.cumulative,
              Balance: line.balance,
              "Length done (m)": line.quantityThisPeriodM,
              "Towers completed": line.towerNos.join(", "),
            },
          })),
        }}
      />

      {report.constraints.length ? (
        <div>
          <h4 className="mb-2 text-sm font-semibold">Issues and constraints raised</h4>
          <GenericReportTable
            print={ctx.print}
        include={ctx.include}
            table={{
              emptyMessage: "",
              columns: [
                { key: "date", label: "Date" },
                { key: "tower", label: "Tower" },
                { key: "activity", label: "Activity" },
                { key: "status", label: "Status" },
                { key: "reason", label: "Reason" },
              ],
              rows: report.constraints.map((entry, index) => ({
                id: `${entry.towerNo}-${index}`,
                tone: entry.status === "Blocked" ? "danger" : "warn",
                cells: {
                  date: formatTowerDate(entry.date),
                  tower: entry.towerNo,
                  activity: entry.activityLabel,
                  status: statusCell(entry.status),
                  reason: entry.reason,
                },
                excel: {
                  Date: entry.date,
                  Tower: entry.towerNo,
                  Activity: entry.activityLabel,
                  Status: entry.status,
                  Reason: entry.reason,
                },
              })),
            }}
          />
        </div>
      ) : null}

      {report.photos.length && ctx.include.photos ? (
        <div>
          <h4 className="mb-2 text-sm font-semibold">
            Photographic progress ({report.photos.length})
          </h4>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {report.photos.map((entry) => (
              <div key={`${entry.updateId}-${entry.photo.id}`} className="space-y-1">
                <TowerReportPhoto
                  url={entry.photo.url}
                  towerNo={entry.towerNo}
                  activity={entry.activity}
                  progressDate={entry.progressDate}
                  gps={entry.photo.gps}
                  uploadedByName={entry.uploadedByName}
                  verified={entry.verified}
                />
                <p className="text-xs text-muted-foreground">
                  {entry.towerNo} · {entry.activityLabel}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The formal monthly report (§9).
 *
 * The weekly report is a working document — a table and some photographs. The monthly one goes to a
 * client or a board, so it is laid out as the numbered sections such a report is expected to have,
 * and every section is still a projection of the same two arrays. Section 14 is derived from the
 * planned dates on the tower register, which is the only forward-looking data the module holds.
 */
function MonthlyProgressReport({ ctx }: { ctx: ReportContext }) {
  const range = monthRange(ctx.monthKey);
  const towerIds = new Set(ctx.towers.map((tower) => tower.id));
  const scopedUpdates = ctx.updates.filter((update) => towerIds.has(update.towerId));
  const report = buildPeriodProgressReport(ctx.towers, scopedUpdates, range, ctx.settings);
  const summary = calculateTowerProgressSummary(ctx.towers, ctx.settings);
  const delayed = buildDelayedReport(ctx.towers, ctx.settings);

  // Section 14: activities whose planned window opens in the month after the reporting month.
  const nextMonthStart = addDaysToKey(range.toDate, 1);
  const nextMonth = monthRange(nextMonthStart);
  const planned = ctx.towers.flatMap((tower) =>
    TOWER_ACTIVITY_LIST.filter((definition) => {
      const state = tower.activities[definition.key];
      if (isActivityComplete(state.status)) return false;
      const start = state.plannedStartDate ?? state.plannedEndDate;
      return Boolean(start && start >= nextMonth.fromDate && start <= nextMonth.toDate);
    }).map((definition) => ({
      towerNo: tower.towerNo,
      label: definition.label,
      activity: definition.key,
      plannedStart: tower.activities[definition.key].plannedStartDate ?? "",
      plannedEnd: tower.activities[definition.key].plannedEndDate ?? "",
    })),
  );

  let sectionNumber = 0;
  const Section = ({ title, children }: { title: string; children: ReactNode }) => {
    sectionNumber += 1;
    return (
      <section className="space-y-2 break-inside-avoid">
        <h3 className="border-b pb-1 text-base font-bold uppercase tracking-wide">
          {sectionNumber}. {title}
        </h3>
        {children}
      </section>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-extrabold uppercase">{report.label} Progress Report</h2>
        <p className="text-sm text-muted-foreground">
          {formatTowerDate(report.fromDate)} to {formatTowerDate(report.toDate)}
        </p>
      </div>

      <Section title="Project Overview">
        <div className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <p>
            <span className="text-muted-foreground">Project:</span> {ctx.projectName || "—"}
          </p>
          <p>
            <span className="text-muted-foreground">Towers in scope:</span> {summary.totalTowers}
          </p>
          <p>
            <span className="text-muted-foreground">Spans:</span> {summary.totalSpans}
          </p>
          <p>
            <span className="text-muted-foreground">Reporting period:</span> {report.label}
          </p>
        </div>
      </Section>

      <Section title="Executive Progress Summary">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {[
            { label: "Overall progress", value: `${summary.overallProgressPct}%` },
            { label: "Fully completed towers", value: summary.fullyCompletedTowers },
            { label: "Blocked towers", value: summary.blockedTowers },
            { label: "Delayed activities", value: delayed.length },
            { label: "Completions without evidence", value: summary.towersWithoutEvidence },
          ].map((metric) => (
            <div key={metric.label} className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">{metric.label}</p>
              <p className="mt-0.5 text-lg font-bold tabular-nums">{metric.value}</p>
            </div>
          ))}
        </div>
        <GenericReportTable
          print={ctx.print}
          include={ctx.include}
          table={{
            emptyMessage: "No towers in scope.",
            columns: [
              { key: "activity", label: "Activity" },
              { key: "opening", label: "Opening", align: "right" },
              { key: "period", label: "This month", align: "right" },
              { key: "cumulative", label: "Cumulative", align: "right" },
              { key: "balance", label: "Balance", align: "right" },
              { key: "quantity", label: "Length done", align: "right" },
            ],
            rows: report.lines.map((line) => ({
              id: line.activity,
              cells: {
                activity: <span className="font-medium">{line.label}</span>,
                opening: line.opening,
                period: <span className="font-semibold">{line.thisPeriod}</span>,
                cumulative: line.cumulative,
                balance: line.balance,
                quantity: line.quantityThisPeriodM > 0 ? formatKm(line.quantityThisPeriodM) : "—",
              },
              excel: {
                Activity: line.label,
                Opening: line.opening,
                "This month": line.thisPeriod,
                Cumulative: line.cumulative,
                Balance: line.balance,
                "Length done (m)": line.quantityThisPeriodM,
              },
            })),
          }}
        />
      </Section>

      <Section title="Tower Status">
        <TowerStatusReport ctx={ctx} />
      </Section>

      {/* Sections 4–10: one per activity, in execution order. */}
      {TOWER_ACTIVITY_LIST.map((definition) => {
        const line = report.lines.find((entry) => entry.activity === definition.key);
        return (
          <Section key={definition.key} title={`${definition.label} Progress`}>
            {line ? (
              <p className="text-sm">
                {line.cumulative} of {line.total} complete ({line.balance} outstanding).{" "}
                {line.thisPeriod} completed this month
                {line.quantityThisPeriodM > 0 ? ` covering ${formatKm(line.quantityThisPeriodM)}` : ""}
                {line.towerNos.length ? `: ${line.towerNos.join(", ")}` : "."}
              </p>
            ) : null}
            <GenericReportTable
              print={ctx.print}
              include={ctx.include}
              table={activityRegisterTable(ctx, definition.key)}
            />
          </Section>
        );
      })}

      <Section title="Delayed Towers">
        <GenericReportTable
          print={ctx.print}
          include={ctx.include}
          table={exceptionTable(ctx, "delayed", "All")}
        />
      </Section>

      <Section title="Issues / Constraints">
        {report.constraints.length ? (
          <GenericReportTable
            print={ctx.print}
            include={ctx.include}
            table={{
              emptyMessage: "",
              columns: [
                { key: "date", label: "Date" },
                { key: "tower", label: "Tower" },
                { key: "activity", label: "Activity" },
                { key: "status", label: "Status" },
                { key: "reason", label: "Reason" },
              ],
              rows: report.constraints.map((entry, index) => ({
                id: `${entry.towerNo}-${index}`,
                tone: entry.status === "Blocked" ? "danger" : "warn",
                cells: {
                  date: formatTowerDate(entry.date),
                  tower: entry.towerNo,
                  activity: entry.activityLabel,
                  status: statusCell(entry.status),
                  reason: entry.reason,
                },
                excel: {
                  Date: entry.date,
                  Tower: entry.towerNo,
                  Activity: entry.activityLabel,
                  Status: entry.status,
                  Reason: entry.reason,
                },
              })),
            }}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            No hold or blocked status was raised during the month.
          </p>
        )}
      </Section>

      <Section title="Photographic Progress">
        {ctx.include.photos && report.photos.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {report.photos.map((entry) => (
              <div key={`${entry.updateId}-${entry.photo.id}`} className="space-y-1">
                <TowerReportPhoto
                  url={entry.photo.url}
                  towerNo={entry.towerNo}
                  activity={entry.activity}
                  progressDate={entry.progressDate}
                  gps={ctx.include.gps ? entry.photo.gps : null}
                  uploadedByName={entry.uploadedByName}
                  verified={entry.verified}
                />
                <p className="text-xs text-muted-foreground">
                  {entry.towerNo} · {entry.activityLabel}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {ctx.include.photos
              ? "No photographs were recorded during the month."
              : "Photographs excluded from this report."}
          </p>
        )}
      </Section>

      <Section title={`Planned Activities — ${nextMonth.label}`}>
        {planned.length ? (
          <GenericReportTable
            print={ctx.print}
            include={ctx.include}
            table={{
              emptyMessage: "",
              columns: [
                { key: "tower", label: "Tower" },
                { key: "activity", label: "Activity" },
                { key: "start", label: "Planned start" },
                { key: "planned", label: "Planned end" },
              ],
              rows: planned.map((entry, index) => ({
                id: `${entry.towerNo}-${entry.activity}-${index}`,
                cells: {
                  tower: entry.towerNo,
                  activity: entry.label,
                  start: formatTowerDate(entry.plannedStart),
                  planned: formatTowerDate(entry.plannedEnd),
                },
                excel: {
                  Tower: entry.towerNo,
                  Activity: entry.label,
                  Start: entry.plannedStart,
                  "Planned end": entry.plannedEnd,
                },
              })),
            }}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            No planned dates fall in {nextMonth.label}. Planned dates are recorded per activity on
            each tower&apos;s page, and are what this section and the Delayed report read.
          </p>
        )}
      </Section>
    </div>
  );
}

/** Tower Photo Report (§3) — a page per tower. */
function PhotoPagesReport({ ctx }: { ctx: ReportContext }) {
  const limited = ctx.print ? ctx.towers : ctx.towers.slice(0, PHOTO_PAGE_SCREEN_LIMIT);
  const pages = buildTowerPhotoPages(limited, ctx.updates, ctx.settings);
  const truncated = !ctx.print && ctx.towers.length > limited.length;

  return (
    <div className="space-y-8">
      {truncated ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          Showing the first {PHOTO_PAGE_SCREEN_LIMIT} of {ctx.towers.length} towers. Narrow the filters
          or use Print / PDF, which includes every tower in scope.
        </p>
      ) : null}

      {pages.map((page) => (
        <section
          key={page.tower.id}
          className="break-inside-avoid space-y-3 border-b pb-6 last:border-b-0 print:break-after-page"
        >
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h3 className="text-lg font-bold">TOWER {page.tower.towerNo}</h3>
            <span className="text-sm text-muted-foreground">
              Overall progress {page.overallPct}%
            </span>
          </div>
          <div className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <p>
              <span className="text-muted-foreground">Location:</span> {dash(page.tower.location)}
            </p>
            {ctx.include.gps ? (
              <p>
                <span className="text-muted-foreground">GPS:</span>{" "}
                {page.tower.latitude !== undefined && page.tower.longitude !== undefined
                  ? formatGps({ latitude: page.tower.latitude, longitude: page.tower.longitude })
                  : "—"}
              </p>
            ) : null}
            <p>
              <span className="text-muted-foreground">Tower type:</span> {dash(page.tower.towerType)}
            </p>
            {ctx.include.contractor ? (
              <p>
                <span className="text-muted-foreground">Contractor:</span>{" "}
                {dash(page.tower.contractor)}
              </p>
            ) : null}
          </div>

          {ctx.include.status ? (
            <Table className={ctx.print ? "text-[8pt]" : "text-sm"}>
              <TableHeader>
                <TableRow>
                  <TableHead>Activity</TableHead>
                  <TableHead>Status</TableHead>
                  {ctx.include.dates ? <TableHead>Completion date</TableHead> : null}
                  <TableHead className="text-center">Evidence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.activities.map((entry) => (
                  <TableRow key={entry.activity}>
                    <TableCell className="font-medium">{entry.label}</TableCell>
                    <TableCell>{statusCell(entry.status)}</TableCell>
                    {ctx.include.dates ? (
                      <TableCell>{formatTowerDate(entry.completedDate)}</TableCell>
                    ) : null}
                    <TableCell className="text-center">
                      {entry.evidenceComplete ? (
                        <span className="text-emerald-700">✓</span>
                      ) : (
                        <span className="text-red-700">✗</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}

          {ctx.include.photos ? (
            <div>
              <h4 className="mb-2 text-sm font-semibold">Site photographs</h4>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {page.activities.map((entry) =>
                  entry.photo ? (
                    <TowerReportPhoto
                      key={entry.activity}
                      url={entry.photo.photo.url}
                      towerNo={page.tower.towerNo}
                      activity={entry.activity}
                      progressDate={entry.photo.progressDate}
                      gps={ctx.include.gps ? entry.photo.photo.gps : null}
                      uploadedByName={entry.photo.uploadedByName}
                      verified={entry.photo.verified}
                    />
                  ) : (
                    <MissingPhotoPlate key={entry.activity} label={entry.label} />
                  ),
                )}
              </div>
            </div>
          ) : null}
        </section>
      ))}

      {!pages.length ? (
        <p className="p-6 text-center text-sm text-muted-foreground">
          No towers match the current filters.
        </p>
      ) : null}
    </div>
  );
}

/** Before / After (§14). */
function BeforeAfterReport({ ctx }: { ctx: ReportContext }) {
  const rows = buildBeforeAfterRows(ctx.towers, ctx.updates, ctx.settings);
  if (!rows.length) {
    return (
      <p className="p-6 text-center text-sm text-muted-foreground">
        No tower yet has both a survey photograph and a completed-tower photograph
        {ctx.settings.clientReportsRequireApprovedPhotos ? " that has been verified" : ""}.
      </p>
    );
  }
  return (
    <div className="space-y-6">
      {rows.map((row) => (
        <section key={row.towerId} className="break-inside-avoid space-y-2 rounded-lg border p-4">
          <h3 className="text-base font-bold">
            TOWER {row.towerNo}
            {row.location ? <span className="ml-2 text-sm font-normal text-muted-foreground">{row.location}</span> : null}
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Before — survey
              </p>
              {row.before ? (
                <TowerReportPhoto
                  url={row.before.photo.url}
                  towerNo={row.towerNo}
                  activity="survey"
                  progressDate={row.before.progressDate}
                  gps={row.before.photo.gps}
                  uploadedByName={row.before.uploadedByName}
                  verified={row.before.verified}
                />
              ) : (
                <MissingPhotoPlate label="Survey" />
              )}
            </div>
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                After — tower erected
              </p>
              {row.after ? (
                <TowerReportPhoto
                  url={row.after.photo.url}
                  towerNo={row.towerNo}
                  activity="erection"
                  progressDate={row.after.progressDate}
                  gps={row.after.photo.gps}
                  uploadedByName={row.after.uploadedByName}
                  verified={row.after.verified}
                />
              ) : (
                <MissingPhotoPlate label="Erection" />
              )}
            </div>
          </div>
          <p className="text-sm">
            Survey date: {formatTowerDate(row.surveyDate)} · Tower erection:{" "}
            {formatTowerDate(row.erectionDate)}
            {row.constructionDays !== undefined
              ? ` · Total construction time: ${row.constructionDays} days`
              : ""}
          </p>
        </section>
      ))}
    </div>
  );
}

/** Photo Timeline (§13), across every tower in scope. */
function TimelineReport({ ctx }: { ctx: ReportContext }) {
  const limited = ctx.print ? ctx.towers : ctx.towers.slice(0, PHOTO_PAGE_SCREEN_LIMIT);
  const truncated = !ctx.print && ctx.towers.length > limited.length;
  return (
    <div className="space-y-8">
      {truncated ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          Showing the first {PHOTO_PAGE_SCREEN_LIMIT} of {ctx.towers.length} towers. Narrow the filters
          or use Print / PDF.
        </p>
      ) : null}
      {limited.map((tower) => {
        const timeline = buildTowerTimeline(ctx.updates, tower.id);
        if (!timeline.length) return null;
        return (
          <section key={tower.id} className="break-inside-avoid space-y-3">
            <h3 className="text-base font-bold">
              TOWER {tower.towerNo}
              {tower.location ? (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {tower.location}
                </span>
              ) : null}
            </h3>
            <div className="space-y-4 border-l pl-5">
              {timeline.map((entry) => (
                <div key={entry.updateId} className="break-inside-avoid space-y-1.5">
                  <p className="text-sm font-semibold">
                    {formatTowerDate(entry.progressDate)} — {entry.activityLabel} ·{" "}
                    <span className="font-normal">{entry.status}</span>
                  </p>
                  {entry.reason && ctx.include.remarks ? (
                    <p className="text-xs text-red-700">{entry.reason}</p>
                  ) : null}
                  {entry.photos.length && ctx.include.photos ? (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      {entry.photos.map((photo) => (
                        <TowerReportPhoto
                          key={photo.id}
                          url={photo.url}
                          towerNo={tower.towerNo}
                          activity={entry.activity}
                          progressDate={entry.progressDate}
                          gps={photo.gps}
                          uploadedByName={entry.uploadedByName}
                          verified={entry.verificationState === "Approved"}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Map progress report (§15) — SVG route, no basemap. */
function MapReport({ ctx }: { ctx: ReportContext }) {
  const map = buildTowerRouteMap(ctx.towers, ctx.settings);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        {ROUTE_STATUSES.map((status) => (
          <span key={status} className="inline-flex items-center gap-1.5 text-sm">
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ backgroundColor: ROUTE_STATUS_COLORS[status] }}
            />
            {ROUTE_STATUS_LABELS[status]} — {map.counts[status]}
          </span>
        ))}
      </div>

      {map.points.length ? (
        <>
          <div className="overflow-hidden rounded-lg border bg-white">
            <svg
              viewBox={`0 0 ${map.width} ${map.height}`}
              className="h-auto w-full"
              role="img"
              aria-label="Tower route progress map"
            >
              <path
                d={map.path}
                fill="none"
                stroke="#cbd5e1"
                strokeWidth={2}
                strokeDasharray="6 4"
              />
              {map.points.map((point) => (
                <g key={point.towerId}>
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r={6}
                    fill={ROUTE_STATUS_COLORS[point.status]}
                    stroke="#ffffff"
                    strokeWidth={1.5}
                  />
                  <title>
                    {point.towerNo} — {ROUTE_STATUS_LABELS[point.status]} · {point.progressPct}%
                    {point.location ? ` · ${point.location}` : ""}
                  </title>
                </g>
              ))}
              {/* Labels only when the line is short enough for them to be legible. */}
              {map.points.length <= 60
                ? map.points.map((point) => (
                    <text
                      key={`${point.towerId}-label`}
                      x={point.x}
                      y={point.y - 10}
                      textAnchor="middle"
                      fontSize={9}
                      fill="#334155"
                    >
                      {point.towerNo}
                    </text>
                  ))
                : null}
            </svg>
          </div>
          <p className="text-xs text-muted-foreground">
            {map.points.length} towers plotted from recorded coordinates · straight-line route length{" "}
            {map.routeKm.toFixed(2)} km. This is a schematic route diagram drawn from the tower
            coordinates, not a basemap — there are no roads or terrain behind it.
          </p>
          {map.towersWithoutCoordinates.length ? (
            <p className="text-xs text-amber-700">
              {map.towersWithoutCoordinates.length} tower
              {map.towersWithoutCoordinates.length === 1 ? "" : "s"} could not be plotted because no
              coordinates are recorded: {map.towersWithoutCoordinates.slice(0, 30).join(", ")}
              {map.towersWithoutCoordinates.length > 30 ? "…" : ""}
            </p>
          ) : null}
        </>
      ) : (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          None of the towers in scope have coordinates recorded, so there is nothing to plot. Add
          latitude and longitude on the tower register, or include them in the import sheet.
        </p>
      )}

      <GenericReportTable
        print={ctx.print}
        include={ctx.include}
        table={{
          emptyMessage: "No towers in scope.",
          columns: [
            { key: "tower", label: "Tower" },
            { key: "location", label: "Location" },
            { key: "gps", label: "GPS" },
            { key: "status", label: "Map status" },
            { key: "pct", label: "Progress", align: "right" },
          ],
          rows: map.points.map((point) => ({
            id: point.towerId,
            cells: {
              tower: towerLink(ctx, point.towerId, point.towerNo),
              location: dash(point.location),
              gps: formatGps({ latitude: point.latitude, longitude: point.longitude }),
              status: (
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: ROUTE_STATUS_COLORS[point.status] }}
                  />
                  {ROUTE_STATUS_LABELS[point.status]}
                </span>
              ),
              pct: `${point.progressPct}%`,
            },
            excel: {
              Tower: point.towerNo,
              Location: point.location,
              Latitude: point.latitude,
              Longitude: point.longitude,
              "Map status": ROUTE_STATUS_LABELS[point.status],
              "Progress %": point.progressPct,
            },
          })),
        }}
      />
    </div>
  );
}

/* ── Entry point ────────────────────────────────────────────────────────────────────────────── */

function ReportKindBody({ ctx }: { ctx: ReportContext }) {
  switch (ctx.definition.kind) {
    case "summary":
      return <ProjectSummaryReport ctx={ctx} />;
    case "matrix":
      return <TowerStatusReport ctx={ctx} />;
    case "daily":
      return <DailyProgressReport ctx={ctx} />;
    case "period":
      return ctx.definition.id === "monthly-progress" ? (
        <MonthlyProgressReport ctx={ctx} />
      ) : (
        <PeriodProgressReport ctx={ctx} />
      );
    case "photo-pages":
      return <PhotoPagesReport ctx={ctx} />;
    case "before-after":
      return <BeforeAfterReport ctx={ctx} />;
    case "timeline":
      return <TimelineReport ctx={ctx} />;
    case "map":
      return <MapReport ctx={ctx} />;
    case "photo-rows":
      return <GenericReportTable print={ctx.print} include={ctx.include} table={latestPhotoTable(ctx)} />;
    case "rows":
    default:
      return <GenericReportTable print={ctx.print} include={ctx.include} table={rowsTableFor(ctx)} />;
  }
}

export function TowerReportBody({ ctx }: { ctx: ReportContext }) {
  // The map is an appendix any report can carry (§17), so a monthly progress report can end with the
  // route diagram without needing a second report. It is skipped on the map report itself.
  const withMap = ctx.include.map && ctx.definition.kind !== "map";
  return (
    <div className="space-y-6">
      <ReportKindBody ctx={ctx} />
      {withMap ? (
        <section className="space-y-2 border-t pt-4 print:break-before-page">
          <h3 className="text-base font-semibold">Route progress map</h3>
          <MapReport ctx={ctx} />
        </section>
      ) : null}
    </div>
  );
}

/* ── Excel export ───────────────────────────────────────────────────────────────────────────── */

/**
 * Which "Include" checkbox governs a workbook column, keyed by its visible header. Separate from
 * COLUMN_SECTION above because the export is keyed by heading rather than by column key — but the
 * point is the same: a report that dropped Contractor on screen exports without it too.
 */
const HEADER_SECTION: Record<string, keyof ReportInclude> = {
  Contractor: "contractor",
  Status: "status",
  Start: "dates",
  Completed: "dates",
  "Planned end": "dates",
  "Completion date": "dates",
  "Survey completed": "dates",
  "Final activity completed": "dates",
  "Survey date": "dates",
  "Erection date": "dates",
  "Photo date": "dates",
  Remarks: "remarks",
  "Remarks / reason": "remarks",
  Reason: "remarks",
  Detail: "remarks",
  GPS: "gps",
  Latitude: "gps",
  Longitude: "gps",
  Photographs: "photos",
  "Photo URL": "photos",
  "Photo URLs": "photos",
  "Before photo": "photos",
  "After photo": "photos",
};

const sheetFrom = (
  name: string,
  rows: Array<Record<string, unknown>>,
  include: ReportInclude = ALL_SECTIONS_INCLUDED,
): ExcelSheet => {
  const headers = Object.keys(rows[0] ?? {}).filter((header) => {
    const section = HEADER_SECTION[header];
    return section ? include[section] : true;
  });
  return {
    name: name.replace(/[[\]:*?/\\]/g, " ").slice(0, 31) || "Report",
    columns: headers.map((header) => ({
      header,
      key: header,
      width: Math.min(42, Math.max(12, header.length + 4)),
    })),
    rows: rows.map((row) =>
      Object.fromEntries(headers.map((header) => [header, row[header]])),
    ),
  };
};

/**
 * Workbook sheets for a report, built from the same row structures the screen renders.
 *
 * The photographic reports export their metadata and photograph URLs rather than the images: an
 * .xlsx with 700 embedded site photographs is not a file anybody can open, and the URLs let a reader
 * click straight through to the evidence.
 */
export function reportExcelSheets(ctx: ReportContext): ExcelSheet[] {
  const { definition } = ctx;
  // Every sheet honours the same "Include" selection the screen used, so an export can never carry
  // a column the report it came from had switched off.
  const sheet = (name: string, rows: Array<Record<string, unknown>>) =>
    sheetFrom(name, rows, ctx.include);

  if (definition.kind === "summary") {
    const summary = calculateTowerProgressSummary(ctx.towers, ctx.settings);
    return [
      sheet(
        "Summary",
        summary.activities.map((activity) => ({
          Activity: activity.label,
          "Measured per": activity.measure,
          Total: activity.total,
          Completed: activity.completed,
          "In Progress": activity.inProgress,
          Pending: activity.pending,
          Blocked: activity.blocked,
          "On Hold": activity.hold,
          "No evidence": activity.missingEvidence,
          "Length (m)": activity.quantityM,
          "%": activity.completionPct,
        })),
      ),
      sheet("Headline", [
        {
          "Total towers": summary.totalTowers,
          Spans: summary.totalSpans,
          "Overall progress %": summary.overallProgressPct,
          "Fully completed towers": summary.fullyCompletedTowers,
          "Blocked towers": summary.blockedTowers,
          "Towers without evidence": summary.towersWithoutEvidence,
        },
      ]),
    ];
  }

  if (definition.kind === "matrix") {
    return [
      sheet(
        "Tower Status",
        buildTowerStatusRows(ctx.towers, ctx.settings).map((row) => ({
          Tower: row.towerNo,
          Location: row.location,
          Type: row.towerType,
          Section: row.section,
          Contractor: row.contractor,
          ...Object.fromEntries(
            row.cells.map((cell) => [
              TOWER_ACTIVITY_DEFINITIONS[cell.activity].label,
              cell.status,
            ]),
          ),
          "Overall %": row.overallPct,
          "Evidence gap": row.evidenceGap ? "Yes" : "No",
        })),
      ),
    ];
  }

  if (definition.kind === "daily") {
    const towerIds = new Set(ctx.towers.map((tower) => tower.id));
    const report = buildDailyProgressReport(
      ctx.updates.filter((update) => towerIds.has(update.towerId)),
      ctx.dateKey,
    );
    return [
      sheet(
        "Completions",
        report.completions.map((line) => ({
          Date: report.date,
          Activity: line.label,
          "Towers completed": line.count,
          "Tower numbers": line.towerNos.join(", "),
          "Length (m)": line.quantityM,
        })),
      ),
      sheet(
        "Photographs",
        report.photos.map((entry) => ({
          Date: entry.progressDate,
          Tower: entry.towerNo,
          Activity: entry.activityLabel,
          "Uploaded by": entry.uploadedByName,
          Verified: entry.verified ? "Yes" : "No",
          GPS: formatGps(entry.photo.gps),
          "Photo URL": entry.photo.url,
        })),
      ),
    ];
  }

  if (definition.kind === "period") {
    const isMonthly = definition.id === "monthly-progress";
    const range = isMonthly
      ? monthRange(ctx.monthKey)
      : weekRange(ctx.weekStart, isoWeekNumber(parseIsoDate(ctx.weekStart) ?? new Date()));
    const towerIds = new Set(ctx.towers.map((tower) => tower.id));
    const report = buildPeriodProgressReport(
      ctx.towers,
      ctx.updates.filter((update) => towerIds.has(update.towerId)),
      range,
      ctx.settings,
    );
    return [
      sheet(
        report.label,
        report.lines.map((line) => ({
          Activity: line.label,
          Total: line.total,
          Opening: line.opening,
          [isMonthly ? "This month" : "This week"]: line.thisPeriod,
          Cumulative: line.cumulative,
          Balance: line.balance,
          "Length done (m)": line.quantityThisPeriodM,
          "Towers completed": line.towerNos.join(", "),
        })),
      ),
      ...(report.constraints.length
        ? [
            sheet(
              "Constraints",
              report.constraints.map((entry) => ({
                Date: entry.date,
                Tower: entry.towerNo,
                Activity: entry.activityLabel,
                Status: entry.status,
                Reason: entry.reason,
              })),
            ),
          ]
        : []),
    ];
  }

  if (definition.kind === "photo-pages") {
    const pages = buildTowerPhotoPages(ctx.towers, ctx.updates, ctx.settings);
    return [
      sheet(
        "Tower Photos",
        pages.flatMap((page) =>
          page.activities.map((entry) => ({
            Tower: page.tower.towerNo,
            Location: page.tower.location ?? "",
            "Tower type": page.tower.towerType ?? "",
            Contractor: page.tower.contractor ?? "",
            Activity: entry.label,
            Status: entry.status,
            "Completion date": entry.completedDate,
            "Evidence complete": entry.evidenceComplete ? "Yes" : "No",
            "Photo date": entry.photo?.progressDate ?? "",
            "Photo URL": entry.photo?.photo.url ?? "",
          })),
        ),
      ),
    ];
  }

  if (definition.kind === "before-after") {
    return [
      sheet(
        "Before After",
        buildBeforeAfterRows(ctx.towers, ctx.updates, ctx.settings).map((row) => ({
          Tower: row.towerNo,
          Location: row.location,
          "Survey date": row.surveyDate,
          "Erection date": row.erectionDate,
          "Construction days": row.constructionDays ?? "",
          "Before photo": row.before?.photo.url ?? "",
          "After photo": row.after?.photo.url ?? "",
        })),
      ),
    ];
  }

  if (definition.kind === "timeline") {
    return [
      sheet(
        "Timeline",
        ctx.towers.flatMap((tower) =>
          buildTowerTimeline(ctx.updates, tower.id).map((entry) => ({
            Tower: tower.towerNo,
            Date: entry.progressDate,
            Activity: entry.activityLabel,
            Status: entry.status,
            "Recorded by": entry.uploadedByName,
            Verification: entry.verificationState,
            "Verified by": entry.verifiedByName,
            GPS: formatGps(entry.gps),
            "Length (m)": entry.quantityM ?? "",
            Reason: entry.reason,
            Remarks: entry.remarks,
            Photographs: entry.photos.length,
            "Photo URLs": entry.photos.map((photo) => photo.url).join(" | "),
          })),
        ),
      ),
    ];
  }

  if (definition.kind === "map") {
    const map = buildTowerRouteMap(ctx.towers, ctx.settings);
    return [
      sheet(
        "Map Progress",
        map.points.map((point) => ({
          Tower: point.towerNo,
          Location: point.location,
          Latitude: point.latitude,
          Longitude: point.longitude,
          "Map status": ROUTE_STATUS_LABELS[point.status],
          "Progress %": point.progressPct,
        })),
      ),
    ];
  }

  const table = definition.kind === "photo-rows" ? latestPhotoTable(ctx) : rowsTableFor(ctx);
  return [sheet(definition.title, table.rows.map((row) => row.excel))];
}

/** Whether a report renders a wide matrix, so the print sheet can switch to landscape. */
export function reportPrefersLandscape(definition: TowerReportDefinition): boolean {
  return definition.kind === "matrix" || definition.kind === "period" || definition.kind === "map";
}
