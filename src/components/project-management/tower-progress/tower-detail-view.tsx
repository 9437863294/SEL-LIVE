"use client";

/**
 * One tower, end to end: its seven activities, every photograph recorded against it, and the
 * chronological history that produced its current state.
 *
 * The timeline tab is the important one. It is the audit trail a completion claim rests on — who
 * recorded what, on which date, from which coordinates, with which photographs, and who verified it.
 * Everything else here is a summary of it.
 *
 * Rendered by three routes — `towers/[towerId]`, `.../photos` and `.../timeline` — which differ only
 * in which tab opens. The specification names all three as routes, and they are worth having as
 * links: "send me the photographs for T-37" should be a URL, not an instruction to click a tab.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Camera,
  CalendarClock,
  Crosshair,
  FileText,
  MapPin,
  Pencil,
  Printer,
  RadioTower,
  Save,
  Trash2,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  TOWER_ACTIVITY_LIST,
  TOWER_PHOTO_KIND_LABELS,
  daysInCurrentStatus,
  formatGps,
  formatKm,
  formatTowerDate,
  hasCompleteEvidence,
  isActivityComplete,
  missingRequiredPhotoKinds,
  towerProgressHref,
  type TowerActivity,
  type TowerProgressUpdate,
} from "@/lib/project-management-tower-progress";
import { buildTowerTimeline, towerPhotos } from "@/lib/project-management-tower-reports";
import {
  deleteTowerProgressUpdate,
  saveTowerPlannedDates,
  setReportPhoto,
} from "@/lib/project-management-tower-service";
import { useTowerProgress } from "./tower-progress-provider";
import { ProgressUpdateDialog } from "./progress-update-dialog";
import { TowerFormDialog } from "./tower-dialogs";
import {
  ActivityStatusBadge,
  EmptyState,
  MetricCard,
  TowerProgressGuard,
  TowerProgressHeader,
  TowerProgressNav,
  TowerProgressShell,
  TowerReportPhoto,
  VerificationBadge,
} from "./tower-progress-ui";

export type TowerDetailTab = "progress" | "photos" | "timeline";

/** Entry point for all three tower routes. */
export function TowerDetailView({ defaultTab = "progress" }: { defaultTab?: TowerDetailTab }) {
  return (
    <TowerProgressGuard>
      <TowerDetail defaultTab={defaultTab} />
    </TowerProgressGuard>
  );
}

function TowerDetail({ defaultTab }: { defaultTab: TowerDetailTab }) {
  const params = useParams();
  const towerId = String(params?.towerId ?? "");
  const {
    mappingId,
    project,
    updates,
    settings,
    permissions,
    actor,
    towerById,
    reload,
  } = useTowerProgress();
  const { toast } = useToast();

  const tower = towerById(towerId);
  const [updateActivity, setUpdateActivity] = useState<TowerActivity | null>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TowerProgressUpdate | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [planned, setPlanned] = useState<Record<string, string>>({});
  const [isSavingPlan, setIsSavingPlan] = useState(false);

  const timeline = useMemo(() => buildTowerTimeline(updates, towerId), [updates, towerId]);
  const photos = useMemo(() => towerPhotos(updates, towerId), [updates, towerId]);

  if (!tower) {
    return (
      <TowerProgressShell>
        <Card>
          <CardHeader>
            <CardTitle>Tower not found</CardTitle>
            <CardDescription>
              It may have been removed from this project&apos;s register.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href={towerProgressHref(mappingId, "towers")}>Back to the register</Link>
            </Button>
          </CardContent>
        </Card>
      </TowerProgressShell>
    );
  }

  const plannedValue = (activity: TowerActivity, field: "plannedStartDate" | "plannedEndDate") =>
    planned[`${activity}.${field}`] ?? tower.activities[activity][field] ?? "";

  const handleSavePlan = async () => {
    if (!project || !actor) return;
    setIsSavingPlan(true);
    try {
      await saveTowerPlannedDates(
        project,
        tower,
        Object.fromEntries(
          TOWER_ACTIVITY_LIST.map((definition) => [
            definition.key,
            {
              plannedStartDate: plannedValue(definition.key, "plannedStartDate"),
              plannedEndDate: plannedValue(definition.key, "plannedEndDate"),
            },
          ]),
        ),
        actor,
      );
      toast({ title: "Planned dates saved" });
      setPlanned({});
      await reload();
    } catch (error) {
      console.error("Failed to save planned dates:", error);
      toast({ title: "Could not save the planned dates", variant: "destructive" });
    } finally {
      setIsSavingPlan(false);
    }
  };

  const handleDeleteUpdate = async () => {
    if (!project || !actor || !deleteTarget) return;
    setIsDeleting(true);
    try {
      await deleteTowerProgressUpdate(project, deleteTarget, settings, actor);
      toast({ title: "Progress update removed" });
      setDeleteTarget(null);
      await reload();
    } catch (error) {
      console.error("Failed to remove the progress update:", error);
      toast({ title: "Could not remove the update", variant: "destructive" });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSetReportPhoto = async (update: TowerProgressUpdate, photoId: string) => {
    if (!project || !actor) return;
    try {
      await setReportPhoto(project, update, photoId, settings, actor);
      toast({ title: "Report photograph set" });
      await reload();
    } catch (error) {
      console.error("Failed to set the report photograph:", error);
      toast({ title: "Could not set the report photograph", variant: "destructive" });
    }
  };

  const completedActivities = TOWER_ACTIVITY_LIST.filter((definition) =>
    isActivityComplete(tower.activities[definition.key].status),
  ).length;
  const evidenceGaps = TOWER_ACTIVITY_LIST.filter(
    (definition) =>
      isActivityComplete(tower.activities[definition.key].status) &&
      !hasCompleteEvidence(definition.key, tower.activities[definition.key]),
  );
  const planDirty = Object.keys(planned).length > 0;

  return (
    <TowerProgressShell>
      <TowerProgressHeader
        title={tower.towerNo}
        subtitle={
          [tower.towerType, tower.location, tower.section, tower.contractor]
            .filter(Boolean)
            .join(" · ") || "No tower details recorded"
        }
        icon={RadioTower}
        backHref={towerProgressHref(mappingId, "towers")}
        actions={
          <>
            {permissions.viewReports ? (
              <Button variant="outline" asChild>
                <Link href={towerProgressHref(mappingId, `towers/${tower.id}/print`)} target="_blank">
                  <Printer className="mr-2 h-4 w-4" />
                  Generate tower report
                </Link>
              </Button>
            ) : null}
            {permissions.editTower ? (
              <Button variant="outline" onClick={() => setIsEditOpen(true)}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit tower
              </Button>
            ) : null}
            {permissions.updateProgress ? (
              <Button onClick={() => setUpdateActivity("erection")}>
                <Camera className="mr-2 h-4 w-4" />
                Update progress
              </Button>
            ) : null}
          </>
        }
      />

      <TowerProgressNav />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Overall progress"
          value={`${tower.overallProgressPct}%`}
          detail={`${completedActivities} of 7 activities complete`}
        />
        <MetricCard label="Photographs" value={photos.length} detail={`${timeline.length} updates`} />
        <MetricCard
          label="Evidence gaps"
          value={evidenceGaps.length}
          detail={evidenceGaps.map((entry) => entry.shortLabel).join(", ") || "None"}
          tone={evidenceGaps.length ? "warn" : "good"}
        />
        <MetricCard
          label="GPS"
          value={
            tower.latitude !== undefined && tower.longitude !== undefined
              ? formatGps({ latitude: tower.latitude, longitude: tower.longitude })
              : "—"
          }
          detail={tower.spanToNextM ? `Span to next: ${tower.spanToNextM} m` : "No span recorded"}
        />
      </div>

      <Progress value={tower.overallProgressPct} className="h-2" />

      {evidenceGaps.length ? (
        <Alert>
          <AlertTitle>
            {evidenceGaps.length} completed activit{evidenceGaps.length === 1 ? "y" : "ies"} without
            full photographic evidence
          </AlertTitle>
          <AlertDescription className="text-xs">
            {evidenceGaps
              .map(
                (definition) =>
                  `${definition.label}: missing ${missingRequiredPhotoKinds(
                    definition.key,
                    tower.activities[definition.key].presentPhotoKinds,
                  )
                    .map((kind) => TOWER_PHOTO_KIND_LABELS[kind])
                    .join(", ")}`,
              )
              .join(" · ")}
            . These stay out of client-facing reports until the photographs are uploaded.
          </AlertDescription>
        </Alert>
      ) : null}

      <Tabs defaultValue={defaultTab}>
        <TabsList>
          <TabsTrigger value="progress">Progress</TabsTrigger>
          <TabsTrigger value="photos">Photographs ({photos.length})</TabsTrigger>
          <TabsTrigger value="timeline">Timeline ({timeline.length})</TabsTrigger>
        </TabsList>

        {/* ── Progress ─────────────────────────────────────────────────────────────────────── */}
        <TabsContent value="progress" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-base">Activity status</CardTitle>
                  <CardDescription>
                    Planned dates are what the Delayed report measures against.
                  </CardDescription>
                </div>
                {permissions.updateProgress && planDirty ? (
                  <Button size="sm" onClick={() => void handleSavePlan()} disabled={isSavingPlan}>
                    <Save className="mr-2 h-4 w-4" />
                    Save planned dates
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
                      <TableHead>Status</TableHead>
                      <TableHead>Started</TableHead>
                      <TableHead>Completed</TableHead>
                      <TableHead>Planned start</TableHead>
                      <TableHead>Planned end</TableHead>
                      <TableHead>Evidence</TableHead>
                      <TableHead>Report photo</TableHead>
                      {permissions.updateProgress ? <TableHead /> : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {TOWER_ACTIVITY_LIST.map((definition) => {
                      const state = tower.activities[definition.key];
                      const missing = missingRequiredPhotoKinds(
                        definition.key,
                        state.presentPhotoKinds,
                      );
                      const days = daysInCurrentStatus(state);
                      return (
                        <TableRow key={definition.key}>
                          <TableCell className="font-medium">
                            {definition.label}
                            {definition.measure === "span" && state.quantityM ? (
                              <p className="text-xs text-muted-foreground">
                                {formatKm(state.quantityM)}
                              </p>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <ActivityStatusBadge status={state.status} />
                            {state.reason ? (
                              <p className="mt-1 max-w-48 text-[11px] text-red-700">{state.reason}</p>
                            ) : null}
                            {!isActivityComplete(state.status) && days !== undefined ? (
                              <p className="mt-1 text-[11px] text-muted-foreground">
                                {days} day{days === 1 ? "" : "s"} in status
                              </p>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-xs">{formatTowerDate(state.startedDate)}</TableCell>
                          <TableCell className="text-xs">
                            {formatTowerDate(state.completedDate)}
                          </TableCell>
                          <TableCell>
                            <Input
                              type="date"
                              className="h-8 w-36 text-xs"
                              disabled={!permissions.updateProgress}
                              value={plannedValue(definition.key, "plannedStartDate")}
                              onChange={(event) =>
                                setPlanned((current) => ({
                                  ...current,
                                  [`${definition.key}.plannedStartDate`]: event.target.value,
                                }))
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="date"
                              className="h-8 w-36 text-xs"
                              disabled={!permissions.updateProgress}
                              value={plannedValue(definition.key, "plannedEndDate")}
                              onChange={(event) =>
                                setPlanned((current) => ({
                                  ...current,
                                  [`${definition.key}.plannedEndDate`]: event.target.value,
                                }))
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[11px]",
                                missing.length
                                  ? "border-red-200 bg-red-50 text-red-700"
                                  : "border-emerald-200 bg-emerald-50 text-emerald-700",
                              )}
                              title={
                                missing.length
                                  ? `Missing: ${missing.map((kind) => TOWER_PHOTO_KIND_LABELS[kind]).join(", ")}`
                                  : "Minimum set complete"
                              }
                            >
                              {state.presentPhotoKinds.length}/
                              {definition.requiredPhotoKinds.length} required
                            </Badge>
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              {state.photoCount} photo{state.photoCount === 1 ? "" : "s"}
                            </p>
                          </TableCell>
                          <TableCell>
                            {state.reportPhotoUrl ? (
                              <TowerReportPhoto
                                compact
                                url={state.reportPhotoUrl}
                                towerNo={tower.towerNo}
                                activity={definition.key}
                                progressDate={state.reportPhotoDate ?? ""}
                              />
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          {permissions.updateProgress ? (
                            <TableCell className="text-right">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setUpdateActivity(definition.key)}
                              >
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
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Photographs ──────────────────────────────────────────────────────────────────── */}
        <TabsContent value="photos">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Every photograph on this tower</CardTitle>
              <CardDescription>
                Grouped by activity, newest first. The report photograph is the one that reaches
                official reports.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!photos.length ? (
                <EmptyState
                  title="No photographs yet"
                  description="Photographs are attached when progress is recorded against an activity."
                />
              ) : (
                <div className="space-y-6">
                  {TOWER_ACTIVITY_LIST.map((definition) => {
                    const group = photos.filter((entry) => entry.activity === definition.key);
                    if (!group.length) return null;
                    return (
                      <div key={definition.key} className="space-y-2">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-semibold">{definition.label}</h3>
                          <Badge variant="outline" className="text-[10px]">
                            {group.length}
                          </Badge>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                          {group.map((entry) => {
                            const update = updates.find((item) => item.id === entry.updateId);
                            return (
                              <div key={`${entry.updateId}-${entry.photo.id}`} className="space-y-1.5">
                                <TowerReportPhoto
                                  url={entry.photo.url}
                                  towerNo={tower.towerNo}
                                  activity={entry.activity}
                                  progressDate={entry.progressDate}
                                  gps={entry.photo.gps}
                                  uploadedByName={entry.uploadedByName}
                                  verified={entry.verified}
                                />
                                <div className="flex items-center justify-between gap-2">
                                  <span className="truncate text-[11px] text-muted-foreground">
                                    {TOWER_PHOTO_KIND_LABELS[entry.photo.kind]}
                                  </span>
                                  {entry.photo.isReportPhoto ? (
                                    <Badge className="bg-blue-100 text-[10px] text-blue-700">
                                      Report photo
                                    </Badge>
                                  ) : permissions.updateProgress && update ? (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 px-1.5 text-[10px]"
                                      onClick={() =>
                                        void handleSetReportPhoto(update, entry.photo.id)
                                      }
                                    >
                                      Use in reports
                                    </Button>
                                  ) : null}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Timeline ─────────────────────────────────────────────────────────────────────── */}
        <TabsContent value="timeline">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Photo timeline</CardTitle>
              <CardDescription>
                Visual proof of construction from survey to stringing — who recorded what, when, and
                from where.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!timeline.length ? (
                <EmptyState
                  title="Nothing recorded yet"
                  description="The first progress update against this tower will appear here."
                />
              ) : (
                <ol className="relative space-y-6 border-l pl-6">
                  {timeline.map((entry) => (
                    <li key={entry.updateId} className="relative">
                      <span className="absolute -left-[1.6875rem] top-1.5 flex h-3 w-3 rounded-full border-2 border-background bg-primary" />
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold">
                          {formatTowerDate(entry.progressDate)}
                        </span>
                        <span className="text-sm">{entry.activityLabel}</span>
                        <ActivityStatusBadge status={entry.status} />
                        <VerificationBadge state={entry.verificationState} />
                        {entry.quantityM ? (
                          <Badge variant="outline" className="text-[10px]">
                            {formatKm(entry.quantityM)}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <FileText className="h-3 w-3" />
                          {entry.uploadedByName || "Unknown"}
                        </span>
                        {entry.gps ? (
                          <span className="inline-flex items-center gap-1">
                            <Crosshair className="h-3 w-3" />
                            {formatGps(entry.gps)}
                            {entry.gps.accuracyM ? ` ±${entry.gps.accuracyM}m` : ""}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-amber-700">
                            <MapPin className="h-3 w-3" />
                            No GPS
                          </span>
                        )}
                        {entry.verifiedByName ? (
                          <span className="inline-flex items-center gap-1">
                            <CalendarClock className="h-3 w-3" />
                            Verified by {entry.verifiedByName}
                          </span>
                        ) : null}
                      </p>
                      {entry.reason ? (
                        <p className="mt-1 text-xs font-medium text-red-700">{entry.reason}</p>
                      ) : null}
                      {entry.remarks ? <p className="mt-1 text-xs">{entry.remarks}</p> : null}
                      {entry.photos.length ? (
                        <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
                      {permissions.updateProgress ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mt-2 h-7 px-2 text-xs text-destructive"
                          onClick={() => {
                            const update = updates.find((item) => item.id === entry.updateId);
                            if (update) setDeleteTarget(update);
                          }}
                        >
                          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                          Remove this entry
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ProgressUpdateDialog
        tower={tower}
        activity={updateActivity ?? "erection"}
        open={Boolean(updateActivity)}
        onOpenChange={(open) => !open && setUpdateActivity(null)}
      />
      <TowerFormDialog tower={tower} open={isEditOpen} onOpenChange={setIsEditOpen} />

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this progress entry?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `${deleteTarget.towerNo} · ${deleteTarget.activity} · ${formatTowerDate(deleteTarget.progressDate)}. Its ${deleteTarget.photos.length} photograph${deleteTarget.photos.length === 1 ? "" : "s"} will be deleted and the tower's status recalculated from what remains. The audit-log entry stays.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteUpdate();
              }}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TowerProgressShell>
  );
}
