"use client";

/**
 * The tower register — the working screen for the site team.
 *
 * One row per tower, one column per activity. Clicking an activity cell opens the progress update
 * for exactly that tower and that activity, which is the interaction the whole feature turns on: a
 * site engineer looking for "T-37, foundation" should reach the right form in one click rather than
 * navigating to a tower, then a tab, then a form.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Download,
  ListTree,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { exportRowsToExcel } from "@/lib/report-excel";
import {
  TOWER_ACTIVITY_LIST,
  TOWER_ACTIVITY_STATUSES,
  activityStatusStyles,
  activityStatusToken,
  formatTowerDate,
  hasCompleteEvidence,
  isActivityComplete,
  towerProgressHref,
  type ProjectTower,
  type TowerActivity,
  type TowerActivityStatus,
} from "@/lib/project-management-tower-progress";
import { distinctValues, filterTowers } from "@/lib/project-management-tower-reports";
import { useTowerProgress } from "@/components/project-management/tower-progress/tower-progress-provider";
import { ProgressUpdateDialog } from "@/components/project-management/tower-progress/progress-update-dialog";
import {
  TowerDeleteDialog,
  TowerFormDialog,
  TowerImportDialog,
} from "@/components/project-management/tower-progress/tower-dialogs";
import {
  EmptyState,
  TowerProgressGuard,
  TowerProgressHeader,
  TowerProgressNav,
  TowerProgressShell,
} from "@/components/project-management/tower-progress/tower-progress-ui";

export default function TowerRegisterPage() {
  return (
    <TowerProgressGuard>
      <TowerRegister />
    </TowerProgressGuard>
  );
}

function TowerRegister() {
  const { mappingId, project, towers, settings, permissions, reload, error } = useTowerProgress();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [section, setSection] = useState("All");
  const [towerType, setTowerType] = useState("All");
  const [contractor, setContractor] = useState("All");
  const [status, setStatus] = useState<TowerActivityStatus | "All">("All");

  const [formTower, setFormTower] = useState<ProjectTower | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProjectTower | null>(null);
  const [update, setUpdate] = useState<{ tower: ProjectTower; activity: TowerActivity } | null>(null);

  const sections = useMemo(() => distinctValues(towers, "section"), [towers]);
  const towerTypes = useMemo(() => distinctValues(towers, "towerType"), [towers]);
  const contractors = useMemo(() => distinctValues(towers, "contractor"), [towers]);

  const filtered = useMemo(
    () => filterTowers(towers, { search, section, towerType, contractor, status }),
    [towers, search, section, towerType, contractor, status],
  );

  const handleExport = async () => {
    try {
      await exportRowsToExcel(
        `${project?.projectName ?? "project"} tower register`,
        filtered.map((tower) => ({
          "Tower No": tower.towerNo,
          "Tower Type": tower.towerType ?? "",
          Section: tower.section ?? "",
          Location: tower.location ?? "",
          Latitude: tower.latitude ?? "",
          Longitude: tower.longitude ?? "",
          Contractor: tower.contractor ?? "",
          "Span To Next (m)": tower.spanToNextM ?? "",
          ...Object.fromEntries(
            TOWER_ACTIVITY_LIST.flatMap((definition) => {
              const state = tower.activities[definition.key];
              return [
                [definition.label, state.status],
                [`${definition.label} Completed`, state.completedDate ?? ""],
              ];
            }),
          ),
          "Overall %": tower.overallProgressPct,
        })),
        { filename: `tower-register-${Date.now()}.xlsx`, sheetName: "Towers" },
      );
    } catch (exportError) {
      console.error("Failed to export the tower register:", exportError);
      toast({ title: "Could not build the workbook", variant: "destructive" });
    }
  };

  const openUpdate = (tower: ProjectTower, activity: TowerActivity) => {
    if (!permissions.updateProgress) return;
    setUpdate({ tower, activity });
  };

  return (
    <TowerProgressShell>
      <TowerProgressHeader
        title="Tower register"
        subtitle={
          project
            ? `${towers.length} towers on ${project.projectName}. Click an activity to record progress.`
            : "Click any activity to record progress."
        }
        icon={ListTree}
        backHref={towerProgressHref(mappingId)}
        actions={
          <>
            <Button variant="outline" onClick={() => void reload()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            {permissions.export && towers.length > 0 ? (
              <Button variant="outline" onClick={() => void handleExport()}>
                <Download className="mr-2 h-4 w-4" />
                Export
              </Button>
            ) : null}
            {permissions.importTowers ? (
              <Button variant="outline" onClick={() => setIsImportOpen(true)}>
                <Upload className="mr-2 h-4 w-4" />
                Import
              </Button>
            ) : null}
            {permissions.addTower ? (
              <Button
                onClick={() => {
                  setFormTower(null);
                  setIsFormOpen(true);
                }}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add tower
              </Button>
            ) : null}
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

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <CardTitle className="text-base">
                {filtered.length} of {towers.length} towers
              </CardTitle>
              <CardDescription>
                {settings.evidenceEnforcement === "block"
                  ? "Completion requires the activity's minimum photographs."
                  : "Completion without photographs is allowed but flagged."}
              </CardDescription>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <div className="relative sm:w-56">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Tower, location, contractor..."
                  className="pl-9"
                />
              </div>
              <FilterSelect value={section} onChange={setSection} options={sections} label="sections" />
              <FilterSelect value={towerType} onChange={setTowerType} options={towerTypes} label="types" />
              <FilterSelect
                value={contractor}
                onChange={setContractor}
                options={contractors}
                label="contractors"
              />
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
                      Has {entry}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {!towers.length ? (
            <EmptyState
              title="No towers yet"
              description="Add the first tower, or import the client's schedule as a spreadsheet."
              action={
                permissions.importTowers ? (
                  <Button onClick={() => setIsImportOpen(true)}>
                    <Upload className="mr-2 h-4 w-4" />
                    Import tower schedule
                  </Button>
                ) : undefined
              }
            />
          ) : !filtered.length ? (
            <EmptyState
              title="No towers match these filters"
              description="Clear a filter or widen the search to see the rest of the line."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 bg-background">Tower</TableHead>
                    <TableHead>Location</TableHead>
                    {TOWER_ACTIVITY_LIST.map((definition) => (
                      <TableHead key={definition.key} className="text-center">
                        {definition.shortLabel}
                      </TableHead>
                    ))}
                    <TableHead className="text-right">Overall</TableHead>
                    {permissions.editTower || permissions.deleteTower ? (
                      <TableHead className="text-right">Actions</TableHead>
                    ) : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((tower) => (
                    <TableRow key={tower.id}>
                      <TableCell className="sticky left-0 bg-background">
                        <Link
                          href={towerProgressHref(mappingId, `towers/${tower.id}`)}
                          className="font-medium hover:underline"
                        >
                          {tower.towerNo}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {[tower.towerType, tower.contractor].filter(Boolean).join(" · ") || "—"}
                        </p>
                      </TableCell>
                      <TableCell className="max-w-40">
                        <p className="truncate text-xs" title={tower.location}>
                          {tower.location || "—"}
                        </p>
                        {tower.section ? (
                          <p className="truncate text-[11px] text-muted-foreground">{tower.section}</p>
                        ) : null}
                      </TableCell>
                      {TOWER_ACTIVITY_LIST.map((definition) => {
                        const state = tower.activities[definition.key];
                        const evidenceGap =
                          isActivityComplete(state.status) &&
                          !hasCompleteEvidence(definition.key, state);
                        return (
                          <TableCell key={definition.key} className="p-1 text-center">
                            <button
                              type="button"
                              onClick={() => openUpdate(tower, definition.key)}
                              disabled={!permissions.updateProgress}
                              title={`${definition.label}: ${state.status}${
                                state.completedDate ? ` · ${formatTowerDate(state.completedDate)}` : ""
                              }${evidenceGap ? " · photographs missing" : ""}`}
                              className={cn(
                                "w-full rounded px-1.5 py-1 text-[11px] font-semibold transition",
                                activityStatusStyles[state.status],
                                permissions.updateProgress
                                  ? "cursor-pointer hover:ring-2 hover:ring-primary/40"
                                  : "cursor-default",
                                evidenceGap && "ring-2 ring-amber-400",
                              )}
                            >
                              {activityStatusToken[state.status]}
                            </button>
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-right">
                        <span className="font-semibold tabular-nums">{tower.overallProgressPct}%</span>
                      </TableCell>
                      {permissions.editTower || permissions.deleteTower ? (
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            {permissions.editTower ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                  setFormTower(tower);
                                  setIsFormOpen(true);
                                }}
                                aria-label={`Edit ${tower.towerNo}`}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            ) : null}
                            {permissions.deleteTower ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setDeleteTarget(tower)}
                                aria-label={`Remove ${tower.towerNo}`}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            ) : null}
                          </div>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Legend, because the matrix is deliberately terse. */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium">Legend:</span>
        {TOWER_ACTIVITY_STATUSES.map((entry) => (
          <Badge key={entry} className={cn(activityStatusStyles[entry], "text-[10px]")}>
            {activityStatusToken[entry]} {entry}
          </Badge>
        ))}
        <span className="ml-2 rounded px-1.5 py-0.5 ring-2 ring-amber-400">amber ring</span>
        <span>= completed without its photographs</span>
      </div>

      <TowerFormDialog tower={formTower} open={isFormOpen} onOpenChange={setIsFormOpen} />
      <TowerImportDialog open={isImportOpen} onOpenChange={setIsImportOpen} />
      <TowerDeleteDialog tower={deleteTarget} onOpenChange={() => setDeleteTarget(null)} />
      <ProgressUpdateDialog
        tower={update?.tower ?? null}
        activity={update?.activity ?? "erection"}
        open={Boolean(update)}
        onOpenChange={(open) => !open && setUpdate(null)}
      />
    </TowerProgressShell>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  label: string;
}) {
  if (!options.length) return null;
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="sm:w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="All">All {label}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
