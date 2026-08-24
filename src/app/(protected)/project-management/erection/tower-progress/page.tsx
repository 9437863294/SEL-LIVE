"use client";

/**
 * Tower Progress dashboard — the project's live position, tower by tower.
 *
 * Nothing here is entered or maintained: every figure is derived from the tower register and the
 * progress-update history, so it moves the moment a site engineer records work. That is the point of
 * the whole feature, and this screen is where it becomes visible.
 */

import Link from "next/link";
import { BarChart3, HardHat, ListTree, RefreshCw, ShieldCheck, Upload } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
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
  formatKm,
  formatTowerDate,
  towerProgressHref,
} from "@/lib/project-management-tower-progress";
import { buildLatestPhotoRows } from "@/lib/project-management-tower-reports";
import { useTowerProgress } from "@/components/project-management/tower-progress/tower-progress-provider";
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

export default function TowerProgressDashboardPage() {
  return (
    <TowerProgressGuard>
      <Dashboard />
    </TowerProgressGuard>
  );
}

function Dashboard() {
  const { mappingId, project, towers, updates, summary, permissions, reload, error } =
    useTowerProgress();

  const pendingVerification = updates.filter((update) => update.verificationState === "Pending");
  const latestPhotos = buildLatestPhotoRows(towers, updates).slice(0, 8);

  return (
    <TowerProgressShell>
      <TowerProgressHeader
        title="Tower Progress"
        subtitle={
          project
            ? `Tower-wise execution and photographic evidence for ${project.projectName}.`
            : "Tower-wise execution and photographic evidence."
        }
        icon={HardHat}
        backHref={`/project-management/erection?project=${encodeURIComponent(mappingId)}`}
        actions={
          <>
            <Button variant="outline" onClick={() => void reload()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            {permissions.viewReports ? (
              <Button variant="outline" asChild>
                <Link href={towerProgressHref(mappingId, "reports")}>
                  <BarChart3 className="mr-2 h-4 w-4" />
                  Reports
                </Link>
              </Button>
            ) : null}
            <Button asChild>
              <Link href={towerProgressHref(mappingId, "towers")}>
                <ListTree className="mr-2 h-4 w-4" />
                Towers
              </Link>
            </Button>
          </>
        }
      />

      <TowerProgressNav />

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Register unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {!towers.length ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              title="No towers yet"
              description="Tower Progress runs on a tower schedule. Add towers one at a time, or import the client's schedule as a spreadsheet — tower number, type, location, coordinates and contractor."
              action={
                permissions.addTower || permissions.importTowers ? (
                  <Button asChild>
                    <Link href={towerProgressHref(mappingId, "towers")}>
                      <Upload className="mr-2 h-4 w-4" />
                      Set up the tower register
                    </Link>
                  </Button>
                ) : undefined
              }
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <MetricCard
              label="Total towers"
              value={summary.totalTowers}
              detail={`${summary.totalSpans} spans`}
            />
            <MetricCard
              label="Overall progress"
              value={`${summary.overallProgressPct}%`}
              detail="Weighted across seven activities"
            />
            <MetricCard
              label="Fully completed"
              value={summary.fullyCompletedTowers}
              detail={`of ${summary.totalTowers} towers`}
              tone={summary.fullyCompletedTowers > 0 ? "good" : "neutral"}
            />
            <MetricCard
              label="Blocked towers"
              value={summary.blockedTowers}
              detail="Need intervention"
              tone={summary.blockedTowers > 0 ? "bad" : "neutral"}
            />
            <MetricCard
              label="No photo evidence"
              value={summary.towersWithoutEvidence}
              detail="Completions without proof"
              tone={summary.towersWithoutEvidence > 0 ? "warn" : "good"}
            />
            <MetricCard
              label="Awaiting verification"
              value={pendingVerification.length}
              detail="Updates in the queue"
              tone={pendingVerification.length > 0 ? "warn" : "neutral"}
            />
          </div>

          <Progress value={summary.overallProgressPct} className="h-2" />

          {/* ── Headline counts, the shape a director reads first ──────────────────────────── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Activity completion</CardTitle>
              <CardDescription>
                Stringing and OPGW are counted against spans, not towers — a {summary.totalTowers}-tower
                line has {summary.totalSpans} spans.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {/* Each card opens that trade's working screen — the crew running foundations should
                  reach their own list from here rather than filtering the whole register. */}
              {summary.activities.map((activity) => (
                <Link
                  key={activity.activity}
                  href={towerProgressHref(
                    mappingId,
                    `activity/${ACTIVITY_ROUTE_SEGMENTS[activity.activity]}`,
                  )}
                  className="flex items-center justify-between gap-3 rounded-lg border p-3 transition hover:border-primary/50 hover:bg-muted/40"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{activity.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {activity.completed} of {activity.total}
                      {activity.measure === "span" && activity.quantityM > 0
                        ? ` · ${formatKm(activity.quantityM)}`
                        : ""}
                    </p>
                  </div>
                  <span className="text-lg font-bold tabular-nums">{activity.completionPct}%</span>
                </Link>
              ))}
            </CardContent>
          </Card>

          {/* ── Tower status summary ───────────────────────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-base">Tower status summary</CardTitle>
                  <CardDescription>
                    Where every activity stands across the line, and what is stuck.
                  </CardDescription>
                </div>
                {permissions.viewReports ? (
                  <Button variant="outline" size="sm" asChild>
                    <Link href={towerProgressHref(mappingId, "reports/tower-status")}>
                      Open tower status report
                    </Link>
                  </Button>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Activity</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Completed</TableHead>
                      <TableHead className="text-right">In Progress</TableHead>
                      <TableHead className="text-right">Pending</TableHead>
                      <TableHead className="text-right">Blocked</TableHead>
                      <TableHead className="text-right">On Hold</TableHead>
                      <TableHead className="text-right">No evidence</TableHead>
                      <TableHead className="text-right">%</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.activities.map((activity) => (
                      <TableRow key={activity.activity}>
                        <TableCell className="font-medium">
                          {activity.label}
                          {activity.measure === "span" ? (
                            <span className="ml-1 text-xs text-muted-foreground">(spans)</span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{activity.total}</TableCell>
                        <TableCell className="text-right tabular-nums">{activity.completed}</TableCell>
                        <TableCell className="text-right tabular-nums">{activity.inProgress}</TableCell>
                        <TableCell className="text-right tabular-nums">{activity.pending}</TableCell>
                        <TableCell
                          className={cn(
                            "text-right tabular-nums",
                            activity.blocked > 0 && "font-semibold text-red-700",
                          )}
                        >
                          {activity.blocked}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right tabular-nums",
                            activity.hold > 0 && "font-semibold text-orange-700",
                          )}
                        >
                          {activity.hold}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right tabular-nums",
                            activity.missingEvidence > 0 && "font-semibold text-amber-700",
                          )}
                        >
                          {activity.missingEvidence}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {activity.completionPct}%
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* ── Latest site photographs ────────────────────────────────────────────────────── */}
          {latestPhotos.length ? (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle className="text-base">Latest site photographs</CardTitle>
                    <CardDescription>
                      The most recent evidence recorded against each tower.
                    </CardDescription>
                  </div>
                  {permissions.viewReports ? (
                    <Button variant="outline" size="sm" asChild>
                      <Link href={towerProgressHref(mappingId, "reports/latest-photos")}>
                        See all
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {latestPhotos.map((row) =>
                  row.photo ? (
                    <div key={row.towerId} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <Link
                          href={towerProgressHref(mappingId, `towers/${row.towerId}`)}
                          className="truncate text-sm font-medium hover:underline"
                        >
                          {row.towerNo}
                        </Link>
                        <ActivityStatusBadge status={row.status} className="text-[10px]" />
                      </div>
                      <TowerReportPhoto
                        url={row.photo.url}
                        towerNo={row.towerNo}
                        activity={row.activity}
                        progressDate={row.progressDate}
                        gps={row.photo.gps}
                        uploadedByName={row.uploadedByName}
                        verified={row.verified}
                      />
                      <p className="text-xs text-muted-foreground">
                        {row.activityLabel} · {formatTowerDate(row.progressDate)}
                      </p>
                    </div>
                  ) : null,
                )}
              </CardContent>
            </Card>
          ) : null}

          {pendingVerification.length && permissions.verifyProgress ? (
            <Alert>
              <ShieldCheck className="h-4 w-4" />
              <AlertTitle>
                {pendingVerification.length} update
                {pendingVerification.length === 1 ? "" : "s"} awaiting verification
              </AlertTitle>
              <AlertDescription className="flex flex-wrap items-center gap-3">
                <span>
                  Until they are verified their photographs stay out of client-facing reports.
                </span>
                <Button size="sm" variant="outline" asChild>
                  <Link href={towerProgressHref(mappingId, "verify")}>Open the queue</Link>
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
        </>
      )}
    </TowerProgressShell>
  );
}
