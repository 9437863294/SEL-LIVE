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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  type TowerActivityStatus,
} from "@/lib/project-management-tower-progress";
import { distinctValues, filterTowers } from "@/lib/project-management-tower-reports";
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
            <Button variant="outline" onClick={() => void reload()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            {permissions.viewReports ? (
              <Button variant="outline" asChild>
                <Link
                  href={towerProgressHref(mappingId, `reports/${ACTIVITY_ROUTE_SEGMENTS[activity]}`)}
                >
                  <BarChart3 className="mr-2 h-4 w-4" />
                  {definition.label} report
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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
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

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="text-base">
                {filtered.length} of {towers.length} towers
              </CardTitle>
              <CardDescription>
                Requires {definition.requiredPhotoKinds.length} photograph
                {definition.requiredPhotoKinds.length === 1 ? "" : "s"} to complete:{" "}
                {definition.requiredPhotoKinds
                  .map((kind) => TOWER_PHOTO_KIND_LABELS[kind])
                  .join(", ")}
                .
              </CardDescription>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative sm:w-52">
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
        </CardHeader>
        <CardContent className="p-0">
          {!filtered.length ? (
            <EmptyState
              title={towers.length ? "No towers match these filters" : "No towers yet"}
              description={
                towers.length
                  ? "Clear a filter or widen the search."
                  : "Set up the tower register before recording activity progress."
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tower</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Contractor</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead>Completed</TableHead>
                    {definition.measure === "span" ? (
                      <TableHead className="text-right">Length</TableHead>
                    ) : null}
                    <TableHead className="text-center">Evidence</TableHead>
                    <TableHead className="text-center">Photo</TableHead>
                    <TableHead>Reason / remarks</TableHead>
                    {permissions.updateProgress ? <TableHead /> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((tower) => {
                    const state = tower.activities[activity];
                    const missing = missingRequiredPhotoKinds(activity, state.presentPhotoKinds);
                    const evidenceGap = isActivityComplete(state.status) && missing.length > 0;
                    const days = daysInCurrentStatus(state);
                    return (
                      <TableRow key={tower.id} className={cn(evidenceGap && "bg-amber-50/60")}>
                        <TableCell>
                          <Link
                            href={towerProgressHref(mappingId, `towers/${tower.id}`)}
                            className="font-medium hover:underline"
                          >
                            {tower.towerNo}
                          </Link>
                          {tower.towerType ? (
                            <p className="text-xs text-muted-foreground">{tower.towerType}</p>
                          ) : null}
                        </TableCell>
                        <TableCell className="max-w-40 truncate text-xs">
                          {tower.location || "—"}
                        </TableCell>
                        <TableCell className="text-xs">{tower.contractor || "—"}</TableCell>
                        <TableCell>
                          <ActivityStatusBadge status={state.status} />
                          {!isActivityComplete(state.status) && days !== undefined ? (
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              {days}d in status
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-xs">
                          {formatTowerDate(state.startedDate)}
                        </TableCell>
                        <TableCell className="text-xs">
                          {formatTowerDate(state.completedDate)}
                        </TableCell>
                        {definition.measure === "span" ? (
                          <TableCell className="text-right text-xs">
                            {state.quantityM ? formatKm(state.quantityM) : "—"}
                          </TableCell>
                        ) : null}
                        <TableCell className="text-center">
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
                        </TableCell>
                        <TableCell className="text-center">
                          {state.reportPhotoUrl ? (
                            <TowerReportPhoto
                              compact
                              url={state.reportPhotoUrl}
                              towerNo={tower.towerNo}
                              activity={activity}
                              progressDate={state.reportPhotoDate ?? ""}
                            />
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-56">
                          <p
                            className={cn(
                              "truncate text-xs",
                              state.reason && "font-medium text-red-700",
                            )}
                            title={state.reason || state.remarks}
                          >
                            {state.reason || state.remarks || "—"}
                          </p>
                        </TableCell>
                        {permissions.updateProgress ? (
                          <TableCell className="text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setUpdateTower(tower)}
                            >
                              <Camera className="mr-1.5 h-3.5 w-3.5" />
                              Update
                            </Button>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <ProgressUpdateDialog
        tower={updateTower}
        activity={activity}
        open={Boolean(updateTower)}
        onOpenChange={(open) => !open && setUpdateTower(null)}
      />
    </TowerProgressShell>
  );
}
