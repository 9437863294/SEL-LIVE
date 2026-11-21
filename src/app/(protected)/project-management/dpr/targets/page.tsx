"use client";

/**
 * Projections — the planned side of the DPR. No tabs (as on Record progress, user 2026-11-21):
 *
 *  - The page lands on the **projection list**: every projection record — the BOQ lines planned
 *    for one scope over the same dates. A record opens to show its lines, and can be edited:
 *    quantities changed (each a revision with a reason, baseline kept — rule P7), lines added,
 *    lines taken off.
 *  - **Add projection** (the band's main button) opens **Plan several lines** with its line picker
 *    already open: one period, a quantity against each line picked, checked as it is typed (rules
 *    P1–P6) and saved together.
 *  - **Six-week look-ahead** (the band's second button): planned per week whatever period each
 *    projection was set at, with work done for started weeks; a week can be planned from its cell.
 *
 * Both open under a back button to the list; `view=plan` / `view=look` in the address still land
 * on them.
 *
 * The period is always stored as explicit dates, and the planning engine
 * (`project-management-dpr-plan.ts`) spreads it over working days and lets the shorter of two
 * overlapping projections own the shared days, so nothing is ever counted twice.
 */

import { useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, CalendarRange, Plus } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { DPR_BASE_PATH, DPR_PERMISSION_RESOURCE, type DprTarget } from "@/lib/project-management-dpr";
import { indexDprActuals } from "@/lib/project-management-dpr-plan";
import {
  buildDprProjectionRecords,
  type DprProjectionRecord,
  type DprRecordEditPlan,
} from "@/lib/project-management-dpr-records";
import { useDprData, type DprBoqItem } from "@/components/project-management/dpr/use-dpr-data";
import {
  DPR_TABS,
  DprAccessDenied,
  DprLoadingState,
  DprPageShell,
  DprProjectNotFound,
  dprHref,
  formatRangeCompact,
  todayIso,
} from "@/components/project-management/dpr/dpr-shell";
import {
  DPR_HERO_PRIMARY,
  DPR_HERO_SECONDARY,
  DprReportsHero,
} from "@/components/project-management/dpr/reports-hero";
import { Button } from "@/components/ui/button";
import { ProjectionList } from "@/components/project-management/dpr/projections-list";
import { ProjectionPlanner } from "@/components/project-management/dpr/projections-plan";
import { ProjectionLookAhead } from "@/components/project-management/dpr/projections-look-ahead";
import {
  ProjectionRecordView,
  changeSummary,
  type ProjectionRecordMode,
} from "@/components/project-management/dpr/projections-record";
import {
  PlanWeekDialog,
  ReviseProjectionDialog,
  type PlanWeekRequest,
} from "@/components/project-management/dpr/projections-dialogs";
import {
  deleteProjectionRecord,
  saveProjectionRecordEdit,
  type ProjectionsContext,
} from "@/components/project-management/dpr/projections-shared";
import { Card, CardContent } from "@/components/ui/card";

type ViewId = "list" | "plan" | "look";

/** The three views, as tabs in the headline band, each with the mock-up's chip colours. */
const VIEWS: ReadonlyArray<{ id: ViewId; label: string }> = [
  { id: "list", label: "Projection list" },
  { id: "plan", label: "Plan several lines" },
  { id: "look", label: "Six-week look-ahead" },
];

const PROJECTIONS_TAB = DPR_TABS.find((tab) => tab.key === "projections")!;

const isViewId = (value: string | null | undefined): value is ViewId =>
  VIEWS.some((view) => view.id === value);

export default function DprProjectionsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { user } = useAuth();
  const { toast } = useToast();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canView = !isAuthLoading && can("View", DPR_PERMISSION_RESOURCE);
  const canEdit = !isAuthLoading && can("Edit", DPR_PERMISSION_RESOURCE);
  const canDelete = !isAuthLoading && can("Delete", DPR_PERMISSION_RESOURCE);

  const data = useDprData(mappingId, canView);
  // Fixed for the life of the screen, so a check run at 23:59 and one at 00:01 do not disagree.
  const [today] = useState(todayIso);

  const requestedView = searchParams?.get("view");
  const [view, setView] = useState<ViewId>(isViewId(requestedView) ? requestedView : "list");
  const [revising, setRevising] = useState<DprTarget | null>(null);
  /** The planner's line picker, opened straight away by Add projection. */
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [planningWeek, setPlanningWeek] = useState<PlanWeekRequest | null>(null);
  /** The open projection record (its key is in the address too), and whether it is being edited. */
  const [recordKey, setRecordKey] = useState<string | null>(searchParams?.get("record") || null);
  const [recordMode, setRecordMode] = useState<ProjectionRecordMode>(
    searchParams?.get("edit") === "1" ? "edit" : "view",
  );

  const actuals = useMemo(() => indexDprActuals(data.entries), [data.entries]);

  const context: ProjectionsContext = useMemo(
    () => ({ data, actuals, today, canEdit, canDelete, user }),
    [data, actuals, today, canEdit, canDelete, user],
  );

  const records = useMemo(() => buildDprProjectionRecords(data.targets, today), [data.targets, today]);
  const openRecord = records.find((record) => record.key === recordKey) ?? null;

  /** The view, the open record and its mode live in the address, so a reload or a link lands there. */
  const showRecord = useCallback(
    (key: string | null, mode: ProjectionRecordMode = "view") => {
      setRecordKey(key);
      setRecordMode(mode);
      const query: Record<string, string> = { view: "list" };
      if (key) query.record = key;
      if (key && mode === "edit") query.edit = "1";
      // Opening or leaving a record starts at the top; switching its mode stays put.
      router.replace(dprHref(`${DPR_BASE_PATH}/targets`, mappingId, query), { scroll: key !== recordKey });
    },
    [router, mappingId, recordKey],
  );

  const changeView = (next: ViewId) => {
    setView(next);
    setRecordKey(null);
    setRecordMode("view");
    // Kept in the address so a reload, or a link from the dashboard, lands on the same view; the
    // list is the page itself.
    router.replace(dprHref(`${DPR_BASE_PATH}/targets`, mappingId, next === "list" ? {} : { view: next }), {
      scroll: false,
    });
  };

  /** Add projection: Plan several lines, with its line picker already open. */
  const openPlanner = () => {
    changeView("plan");
    setIsPickerOpen(true);
  };

  const handleSaveRecord = async (
    record: DprProjectionRecord,
    plan: DprRecordEditPlan,
    reason: string,
  ): Promise<boolean> => {
    if (!data.globalProjectId || !user || !canEdit) return false;
    try {
      await saveProjectionRecordEdit(context, record, plan, reason);
      toast({
        title: plan.removesAll ? "Record removed" : "Record saved",
        description: `${record.scope} · ${formatRangeCompact(record.startDate, record.endDate)}: ${changeSummary(plan)}.`,
      });
      await data.reload();
      showRecord(plan.removesAll ? null : record.key, "view");
      return true;
    } catch (error) {
      console.error("Failed to save the projection record:", error);
      toast({
        title: "Save failed",
        description: "The record could not be saved. Nothing was changed.",
        variant: "destructive",
      });
      return false;
    }
  };

  const handleDeleteRecord = async (record: DprProjectionRecord): Promise<boolean> => {
    if (!data.globalProjectId || !user || !canDelete) return false;
    try {
      await deleteProjectionRecord(context, record);
      const lines = record.targets.length;
      toast({
        title: "Record deleted",
        description: `${record.scope} · ${formatRangeCompact(record.startDate, record.endDate)} · ${lines} BOQ line${lines === 1 ? "" : "s"}.`,
      });
      if (record.key === recordKey) showRecord(null);
      await data.reload();
      return true;
    } catch (error) {
      console.error("Failed to delete the projection record:", error);
      toast({
        title: "Delete failed",
        description: "The record could not be deleted.",
        variant: "destructive",
      });
      return false;
    }
  };

  if (isAuthLoading || data.isResolving) return <DprLoadingState blocks={1} />;
  if (!canView) {
    return <DprAccessDenied description="You do not have permission to view daily progress." />;
  }
  if (data.notFound) {
    return (
      <DprProjectNotFound
        description="Return to Project Management and choose a project before setting projections."
        href="/project-management"
      />
    );
  }

  return (
    <DprPageShell>
      <DprReportsHero
        mappingId={mappingId}
        projectName={data.projectName}
        title={PROJECTIONS_TAB.label}
        description={PROJECTIONS_TAB.description}
        icon={PROJECTIONS_TAB.icon}
        actions={
          view === "list" && !recordKey ? (
            <>
              {canEdit ? (
                <Button className={DPR_HERO_PRIMARY} onClick={openPlanner}>
                  <Plus className="mr-2 h-4 w-4" /> Add projection
                </Button>
              ) : null}
              <Button className={DPR_HERO_SECONDARY} onClick={() => changeView("look")}>
                <CalendarRange className="mr-2 h-4 w-4" /> Six-week look-ahead
              </Button>
            </>
          ) : undefined
        }
      />

      {view !== "list" ? (
        <div className="flex min-w-0 items-center gap-2">
          <Button type="button" variant="ghost" size="sm" className="-ml-2 gap-1.5 font-bold" onClick={() => changeView("list")}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            All projection records
          </Button>
          <span className="truncate text-sm font-extrabold text-muted-foreground">
            {VIEWS.find((candidate) => candidate.id === view)?.label}
          </span>
        </div>
      ) : null}

      {data.loadError ? (
        <Card className="border-destructive/40">
          <CardContent className="p-4 text-sm text-destructive">{data.loadError}</CardContent>
        </Card>
      ) : null}

      {view === "list" && recordKey ? (
        <ProjectionRecordView
          // A fresh editor each time the record or its mode changes, so Cancel drops what was typed.
          key={`${recordKey}-${recordMode}`}
          context={context}
          record={openRecord}
          isLoading={data.isLoading}
          mode={recordMode}
          onModeChange={(mode) => showRecord(recordKey, mode)}
          onBack={() => showRecord(null)}
          onSave={handleSaveRecord}
          onDelete={handleDeleteRecord}
        />
      ) : view === "list" ? (
        <ProjectionList
          context={context}
          onOpen={(record, mode) => showRecord(record.key, mode)}
          onPlan={openPlanner}
          onDeleteRecord={handleDeleteRecord}
        />
      ) : null}
      {/* Kept mounted while hidden, so quantities typed into the planner survive a look at the
          list or the look-ahead. */}
      <div hidden={view !== "plan"}>
        <ProjectionPlanner context={context} pickerOpen={isPickerOpen} onPickerOpenChange={setIsPickerOpen} />
      </div>
      {view === "look" ? (
        <ProjectionLookAhead
          context={context}
          onRevise={setRevising}
          onPlanWeek={(item: DprBoqItem, week) => setPlanningWeek({ item, week })}
        />
      ) : null}

      <ReviseProjectionDialog
        target={revising}
        context={context}
        onClose={() => setRevising(null)}
        onSaved={data.reload}
      />
      <PlanWeekDialog
        request={planningWeek}
        context={context}
        onClose={() => setPlanningWeek(null)}
        onSaved={data.reload}
      />
    </DprPageShell>
  );
}
