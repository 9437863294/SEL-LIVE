"use client";

/**
 * A working screen for one activity across the whole line — `.../activity/foundation`,
 * `.../activity/erection` and so on, the seven screens the specification lists at project level.
 *
 * The difference between this and the activity *report* is who it is for. The report is a document:
 * filtered, printable, exportable, read-only. This is where the crew running one trade works — every
 * row has an update button, the evidence gap is called out per tower, and the summary at the top is
 * that trade's own position rather than the project's.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { BarChart3, Camera, HardHat, RefreshCw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  ACTIVITY_ROUTE_SEGMENTS,
  TOWER_ACTIVITY_DEFINITIONS,
  TOWER_ACTIVITY_LIST,
  TOWER_ACTIVITY_STATUSES,
  TOWER_PHOTO_KIND_LABELS,
  activityFromRouteSegment,
  calculateTowerProgressSummary,
  daysInCurrentStatus,
  formatKm,
  formatTowerDate,
  hasCompleteEvidence,
  isActivityComplete,
  missingRequiredPhotoKinds,
  towerProgressHref,
  type ProjectTower,
  type TowerActivityState,
  type TowerActivityStatus,
  type TowerPhotoKind,
} from "@/lib/project-management-tower-progress";
import { distinctValues, filterTowers } from "@/lib/project-management-tower-reports";
import { PmDataList, type PmListColumn } from "@/components/project-management/pm-shell";
import { useTowerProgress } from "@/components/project-management/tower-progress/tower-progress-provider";
import { ProgressUpdateDialog } from "@/components/project-management/tower-progress/progress-update-dialog";
import {
  ActivityStatusBadge,
  EmptyState,
  MetricCard,
  TowerProgressGuard,
  TowerProgressHeader,
  TowerProgressNav,
  TowerProgressShell,
  TowerReportPhoto,
} from "@/components/project-management/tower-progress/tower-progress-ui";

/** One register row: a tower with this activity's state and evidence position. */
interface ActivityRow {
  id: string;
  tower: ProjectTower;
  state: TowerActivityState;
  missing: TowerPhotoKind[];
  evidenceGap: boolean;
  days: number | undefined;
}

export default function ActivityWorkspacePage() {
  return (
    <TowerProgressGuard>
      <ActivityWorkspace />
    </TowerProgressGuard>
  );
}

function ActivityWorkspace() {
  const params = useParams();
  const segment = String(params?.activity ?? "");
  const activity = activityFromRouteSegment(segment);
  const { mappingId, project, towers, updates, settings, permissions, reload } = useTowerProgress();

  const [search, setSearch] = useState("");
  const [section, setSection] = useState("All");
  const [contractor, setContractor] = useState("All");
  const [status, setStatus] = useState<TowerActivityStatus | "All">("All");
  const [updateTower, setUpdateTower] = useState<ProjectTower | null>(null);

  const sections = useMemo(() => distinctValues(towers, "section"), [towers]);
  const contractors = useMemo(() => distinctValues(towers, "contractor"), [towers]);

  const filtered = useMemo(
    () =>
      activity
        ? filterTowers(towers, { search, section, contractor, status }, activity)
        : [],
    [towers, search, section, contractor, status, activity],
  );

  const summary = useMemo(
    () => calculateTowerProgressSummary(towers, settings),
    [towers, settings],
  );

  if (!activity) {
    return (
      <TowerProgressShell>
        <Card>
          <CardHeader>
            <CardTitle>Unknown activity</CardTitle>
            <CardDescription>
              &ldquo;{segment}&rdquo; is not one of the seven construction activities.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {TOWER_ACTIVITY_LIST.map((definition) => (
              <Button key={definition.key} variant="outline" size="sm" asChild>
                <Link
                  href={towerProgressHref(
                    mappingId,
                    `activity/${ACTIVITY_ROUTE_SEGMENTS[definition.key]}`,
                  )}
                >
                  {definition.label}
                </Link>
              </Button>
            ))}
          </CardContent>
        </Card>
      </TowerProgressShell>
    );
  }

  const definition = TOWER_ACTIVITY_DEFINITIONS[activity];
  const activitySummary = summary.activities.find((entry) => entry.activity === activity);

  // This activity's state per tower, worked out once rather than in every cell.
  const rows: ActivityRow[] = filtered.map((tower) => {
    const state = tower.activities[activity];
    const missing = missingRequiredPhotoKinds(activity, state.presentPhotoKinds);
    return {
      id: tower.id,
      tower,
      state,
      missing,
      evidenceGap: isActivityComplete(state.status) && missing.length > 0,
      days: daysInCurrentStatus(state),
    };
  });

  const columns: PmListColumn<ActivityRow>[] = [
    {
      header: "Tower",
      mobile: "title",
      cell: ({ tower }) => (
        <>
          <Link
            href={towerProgressHref(mappingId, `towers/${tower.id}`)}
            className="font-medium hover:underline"
          >
            {tower.towerNo}
          </Link>
          {tower.towerType ? (
            <p className="text-xs font-normal text-muted-foreground">{tower.towerType}</p>
          ) : null}
        </>
      ),
    },
    // Phone only: the reason or remark in full under the tower number, where a crew will read it.
    // The desktop shows it truncated in its own column further along.
    {
      header: "Note",
      mobile: "title",
      className: "hidden",
      cell: ({ state }) =>
        state.reason || state.remarks ? (
          <p className={cn("break-words", state.reason && "font-medium text-red-700")}>
            {state.reason || state.remarks}
          </p>
        ) : null,
    },
    {
      header: "Location",
      className: "max-w-40 truncate text-xs",
      cell: ({ tower }) => tower.location || "—",
    },
    {
      header: "Contractor",
      className: "text-xs",
      cell: ({ tower }) => tower.contractor || "—",
    },
    {
      header: "Status",
      mobile: "aside",
      cell: ({ state, days }) => (
        <>
          <ActivityStatusBadge status={state.status} />
          {!isActivityComplete(state.status) && days !== undefined ? (
            <p className="mt-1 text-[11px] text-muted-foreground max-sm:text-right">
              {days}d in status
            </p>
          ) : null}
        </>
      ),
    },
    {
      header: "Started",
      className: "text-xs",
      cell: ({ state }) => formatTowerDate(state.startedDate),
    },
    {
      header: "Completed",
      className: "text-xs",
      cell: ({ state }) => formatTowerDate(state.completedDate),
    },
    ...(definition.measure === "span"
      ? [
          {
            header: "Length",
            align: "right" as const,
            className: "text-xs",
            cell: ({ state }: ActivityRow) => (state.quantityM ? formatKm(state.quantityM) : "—"),
          },
        ]
      : []),
    {
      header: "Evidence",
      className: "text-center",
      cell: ({ state, missing }) => (
        <Badge
          variant="outline"
          className={cn(
            "text-[10px]",
            hasCompleteEvidence(activity, state)
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-red-200 bg-red-50 text-red-700",
          )}
          title={
            missing.length
              ? `Missing: ${missing.map((kind) => TOWER_PHOTO_KIND_LABELS[kind]).join(", ")}`
              : "Minimum set complete"
          }
        >
          {state.presentPhotoKinds.length}/{definition.requiredPhotoKinds.length}
        </Badge>
      ),
    },
    {
      header: "Photo",
      className: "text-center",
      cell: ({ tower, state }) =>
        state.reportPhotoUrl ? (
          <TowerReportPhoto
            compact
            url={state.reportPhotoUrl}
            towerNo={tower.towerNo}
            activity={activity}
            progressDate={state.reportPhotoDate ?? ""}
          />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      header: "Reason / remarks",
      mobile: "omit",
      className: "max-w-56",
      cell: ({ state }) => (
        <p
          className={cn("truncate text-xs", state.reason && "font-medium text-red-700")}
          title={state.reason || state.remarks}
        >
          {state.reason || state.remarks || "—"}
        </p>
      ),
    },
    ...(permissions.updateProgress
      ? [
          {
            header: "",
            align: "right" as const,
            mobile: "footer" as const,
            cell: ({ tower }: ActivityRow) => (
              <Button variant="outline" size="sm" onClick={() => setUpdateTower(tower)}>
                <Camera className="mr-1.5 h-3.5 w-3.5" />
                Update
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <TowerProgressShell>
      <TowerProgressHeader
        title={definition.label}
        subtitle={
          project
            ? `${definition.label} across ${towers.length} towers on ${project.projectName}.`
            : `${definition.label} across the line.`
        }
        icon={HardHat}
        backHref={towerProgressHref(mappingId)}
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => void reload()}
              aria-label="Refresh"
              className="max-sm:px-3"
            >
              <RefreshCw className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            {permissions.viewReports ? (
              <Button variant="outline" asChild className="max-sm:px-3">
                <Link
                  href={towerProgressHref(mappingId, `reports/${ACTIVITY_ROUTE_SEGMENTS[activity]}`)}
                  aria-label={`${definition.label} report`}
                >
                  <BarChart3 className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">{definition.label} report</span>
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <TowerProgressNav />

      {/* Sibling activities, so the crew can move along the sequence without going back to the hub. */}
      <div className="flex flex-wrap gap-1.5">
        {TOWER_ACTIVITY_LIST.map((entry) => (
          <Button
            key={entry.key}
            variant={entry.key === activity ? "default" : "outline"}
            size="sm"
            asChild
          >
            <Link
              href={towerProgressHref(mappingId, `activity/${ACTIVITY_ROUTE_SEGMENTS[entry.key]}`)}
            >
              {entry.shortLabel}
            </Link>
          </Button>
        ))}
      </div>

      {activitySummary ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            <MetricCard
              label={definition.measure === "span" ? "Total spans" : "Total towers"}
              value={activitySummary.total}
              detail={
                definition.measure === "span" && activitySummary.quantityM > 0
                  ? formatKm(activitySummary.quantityM)
                  : `${definition.measure === "span" ? "Span" : "Tower"} activity`
              }
            />
            <MetricCard
              label="Completed"
              value={activitySummary.completed}
              detail={`${activitySummary.completionPct}% of scope`}
              tone={activitySummary.completionPct === 100 ? "good" : "neutral"}
            />
            <MetricCard label="In progress" value={activitySummary.inProgress} detail="Under way" />
            <MetricCard label="Pending" value={activitySummary.pending} detail="Not yet complete" />
            <MetricCard
              label="Blocked / on hold"
              value={activitySummary.blocked + activitySummary.hold}
              detail="Need intervention"
              tone={activitySummary.blocked + activitySummary.hold > 0 ? "bad" : "neutral"}
            />
            <MetricCard
              label="No evidence"
              value={activitySummary.missingEvidence}
              detail="Completed without photos"
              tone={activitySummary.missingEvidence > 0 ? "warn" : "good"}
            />
          </div>
          <Progress value={activitySummary.completionPct} className="h-2" />
        </>
      ) : null}

      <section className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 space-y-1.5">
            <h2 className="text-base font-semibold leading-none tracking-tight">
              {filtered.length} of {towers.length} towers
            </h2>
            <p className="text-sm text-muted-foreground">
              Requires {definition.requiredPhotoKinds.length} photograph
              {definition.requiredPhotoKinds.length === 1 ? "" : "s"} to complete:{" "}
              {definition.requiredPhotoKinds
                .map((kind) => TOWER_PHOTO_KIND_LABELS[kind])
                .join(", ")}
              .
            </p>
          </div>
          {/* Search across a phone, the filters two to a row beneath it. */}
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-row">
            <div className="relative col-span-2 sm:w-52">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Tower, location..."
                className="pl-9"
              />
            </div>
            {sections.length ? (
              <Select value={section} onValueChange={setSection}>
                <SelectTrigger className="sm:w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All sections</SelectItem>
                  {sections.map((entry) => (
                    <SelectItem key={entry} value={entry}>
                      {entry}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            {contractors.length ? (
              <Select value={contractor} onValueChange={setContractor}>
                <SelectTrigger className="sm:w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All contractors</SelectItem>
                  {contractors.map((entry) => (
                    <SelectItem key={entry} value={entry}>
                      {entry}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <Select
              value={status}
              onValueChange={(value) => setStatus(value as TowerActivityStatus | "All")}
            >
              <SelectTrigger className="sm:w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">Any status</SelectItem>
                {TOWER_ACTIVITY_STATUSES.map((entry) => (
                  <SelectItem key={entry} value={entry}>
                    {entry}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <PmDataList
          rows={rows}
          columns={columns}
          rowClassName={(row) => cn(row.evidenceGap && "bg-amber-50/60")}
          empty={
            <EmptyState
              title={towers.length ? "No towers match these filters" : "No towers yet"}
              description={
                towers.length
                  ? "Clear a filter or widen the search."
                  : "Set up the tower register before recording activity progress."
              }
            />
          }
        />
      </section>

      <ProgressUpdateDialog
        tower={updateTower}
        activity={activity}
        open={Boolean(updateTower)}
        onOpenChange={(open) => !open && setUpdateTower(null)}
      />
    </TowerProgressShell>
  );
}
