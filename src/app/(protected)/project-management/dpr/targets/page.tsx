"use client";

/**
 * Projections — the planned side of the DPR, in three views:
 *
 *  - **Projection list**: every projection, its spread and revision history. Revise changes the
 *    quantity with a reason and keeps the baseline (rule P7).
 *  - **Plan several lines**: one period, a quantity against each BOQ line of a scope, checked as
 *    it is typed (rules P1–P6) and saved together.
 *  - **Six-week look-ahead**: planned per week whatever period each projection was set at, with
 *    work done for started weeks; a week can be planned from its cell.
 *
 * The period is always stored as explicit dates, and the planning engine
 * (`project-management-dpr-plan.ts`) spreads it over working days and lets the shorter of two
 * overlapping projections own the shared days, so nothing is ever counted twice.
 */

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarRange, ListChecks, Target } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { DPR_BASE_PATH, DPR_PERMISSION_RESOURCE, type DprTarget } from "@/lib/project-management-dpr";
import { indexDprActuals } from "@/lib/project-management-dpr-plan";
import { useDprData, type DprBoqItem } from "@/components/project-management/dpr/use-dpr-data";
import {
  DprAccessDenied,
  DprHeader,
  DprLoadingState,
  DprPageShell,
  DprProjectNotFound,
  dprHref,
  todayIso,
} from "@/components/project-management/dpr/dpr-shell";
import { ProjectionList } from "@/components/project-management/dpr/projections-list";
import { ProjectionPlanner } from "@/components/project-management/dpr/projections-plan";
import { ProjectionLookAhead } from "@/components/project-management/dpr/projections-look-ahead";
import {
  PlanWeekDialog,
  ReviseProjectionDialog,
  type PlanWeekRequest,
} from "@/components/project-management/dpr/projections-dialogs";
import type { ProjectionsContext } from "@/components/project-management/dpr/projections-shared";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const VIEWS = [
  { id: "list", label: "Projection list", icon: ListChecks },
  { id: "plan", label: "Plan several lines", icon: Target },
  { id: "look", label: "Six-week look-ahead", icon: CalendarRange },
] as const;

type ViewId = (typeof VIEWS)[number]["id"];

const isViewId = (value: string | null | undefined): value is ViewId =>
  VIEWS.some((view) => view.id === value);

export default function DprProjectionsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { user } = useAuth();
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
  const [planningWeek, setPlanningWeek] = useState<PlanWeekRequest | null>(null);

  const actuals = useMemo(() => indexDprActuals(data.entries), [data.entries]);

  const context: ProjectionsContext = useMemo(
    () => ({ data, actuals, today, canEdit, canDelete, user }),
    [data, actuals, today, canEdit, canDelete, user],
  );

  const changeView = (next: ViewId) => {
    setView(next);
    // Kept in the address so a reload, or a link from the dashboard, lands on the same view.
    router.replace(dprHref(`${DPR_BASE_PATH}/targets`, mappingId, { view: next }), { scroll: false });
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
      <DprHeader active="projections" mappingId={mappingId} projectName={data.projectName} />

      {data.loadError ? (
        <Card className="border-destructive/40">
          <CardContent className="p-4 text-sm text-destructive">{data.loadError}</CardContent>
        </Card>
      ) : null}

      <Tabs value={view} onValueChange={(next) => changeView(next as ViewId)}>
        <TabsList className="h-auto flex-wrap">
          {VIEWS.map((candidate) => (
            <TabsTrigger key={candidate.id} value={candidate.id}>
              <candidate.icon className="mr-1.5 h-4 w-4" />
              {candidate.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {view === "list" ? (
        <ProjectionList context={context} onRevise={setRevising} onPlan={() => changeView("plan")} />
      ) : null}
      {/* Kept mounted while hidden, so quantities typed into the planner survive a look at the
          list or the look-ahead. */}
      <div hidden={view !== "plan"}>
        <ProjectionPlanner context={context} />
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
