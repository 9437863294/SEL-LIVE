"use client";

/**
 * A single survey workflow stage — the entries sitting on it and the actions the step allows.
 *
 * Mirrors the JMC stage screen. Approving the last configured step is what finally writes the
 * surveyed quantity onto the BOQ item; every earlier approval just advances the entry. The write
 * itself is in project-management-survey-entries.ts so this screen never decides it.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Clock, GitMerge, Loader2 } from "lucide-react";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { WorkflowStep } from "@/lib/types";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { logUserActivity } from "@/lib/activity-logger";
import { getAssigneeForStep, calculateDeadline } from "@/lib/workflow-utils";
import { actOnSurveyEntry } from "@/lib/project-management-survey-entries";
import {
  DEFAULT_SURVEY_STEPS,
  SURVEY_ACTIONS,
  SURVEY_ENTRY_COLLECTION,
  SURVEY_WORKFLOW_DOC_ID,
  canActOnSurveyEntry,
  entriesForStep,
  surveyStatusStyles,
  type SurveyAction,
  type SurveyEntry,
} from "@/lib/project-management-survey-workflow";
import {
  DEFAULT_PLAUSIBILITY_LIMIT_PCT,
  classifySurveyDeviation,
  formatDeviationPct,
  surveyClassificationStyles,
  type SurveyDeviation,
} from "@/lib/project-management-survey";
import { DEFAULT_VARIATION_TOLERANCE_PCT } from "@/lib/project-management-variations";
import { useProjectManagementSurveyContext } from "@/components/survey/use-survey-host-context";
import {
  SURVEY_GRADIENT,
  SurveyAccessDenied,
  SurveyLoadingState,
  SurveyPageShell,
  SurveyProjectNotFound,
} from "@/components/survey/survey-page-shell";
import {
  PM_DIALOG,
  PmDataList,
  PmEmptyState,
  type PmListColumn,
} from "@/components/project-management/pm-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";

/** An entry with its deviation, as the list renders it. */
type StageListRow = SurveyDeviation & { id: string; entry: SurveyEntry };

const formatQuantity = (value: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(value);

const toDateSafe = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object" && value !== null && "toDate" in value) {
    try {
      return (value as { toDate: () => Date }).toDate();
    } catch {
      return null;
    }
  }
  if (typeof value === "number") return new Date(value);
  return null;
};

export default function SurveyStagePage() {
  const params = useParams();
  const stageId = String(params?.stageId ?? "");
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { context, isResolving, notFound, projectName } = useProjectManagementSurveyContext(mappingId);

  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [entries, setEntries] = useState<SurveyEntry[]>([]);
  const [tolerancePct, setTolerancePct] = useState(DEFAULT_VARIATION_TOLERANCE_PCT);
  const [plausibilityPct, setPlausibilityPct] = useState(DEFAULT_PLAUSIBILITY_LIMIT_PCT);
  const [isLoading, setIsLoading] = useState(true);
  const [isActing, setIsActing] = useState(false);
  const [pending, setPending] = useState<{ entry: SurveyEntry; action: SurveyAction } | null>(null);
  const [comment, setComment] = useState("");

  const canViewModule = useMemo(() => {
    if (isAuthLoading) return false;
    try {
      return can("View", context.permissionResource);
    } catch {
      return false;
    }
  }, [isAuthLoading, can, context.permissionResource]);

  const globalProjectId = context.globalProjectId;

  const loadData = useCallback(async () => {
    if (!globalProjectId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const [workflowSnapshot, entrySnapshot, settingsSnapshot] = await Promise.all([
        getDoc(doc(db, "workflows", SURVEY_WORKFLOW_DOC_ID)),
        getDocs(collection(db, "projects", globalProjectId, SURVEY_ENTRY_COLLECTION)),
        getDoc(doc(db, "projectManagementSettings", "general")),
      ]);

      // The reviewer must see the same classification the surveyor did, so read the configured
      // tolerance rather than classifying against a default.
      const storedTolerance = settingsSnapshot.data()?.variationTolerancePct;
      setTolerancePct(
        typeof storedTolerance === "number" ? storedTolerance : DEFAULT_VARIATION_TOLERANCE_PCT,
      );
      const storedPlausibility = settingsSnapshot.data()?.plausibilityLimitPct;
      setPlausibilityPct(
        typeof storedPlausibility === "number" ? storedPlausibility : DEFAULT_PLAUSIBILITY_LIMIT_PCT,
      );

      const rawSteps = workflowSnapshot.exists()
        ? ((workflowSnapshot.data()?.steps as WorkflowStep[] | undefined) ?? [])
        : DEFAULT_SURVEY_STEPS;
      setSteps(
        (Array.isArray(rawSteps) ? rawSteps : [])
          .filter((step) => step && step.name)
          .map((step, index) => ({ ...step, id: String(step.id || index + 1) })),
      );

      setEntries(entrySnapshot.docs.map((entryDoc) => ({ id: entryDoc.id, ...entryDoc.data() } as SurveyEntry)));
    } catch (error) {
      console.error("Failed to load survey stage:", error);
      toast({ title: "Unable to load this stage", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [globalProjectId, toast]);

  useEffect(() => {
    if (isAuthLoading || isResolving || !canViewModule) {
      if (!isAuthLoading && !isResolving) setIsLoading(false);
      return;
    }
    void loadData();
  }, [canViewModule, isAuthLoading, isResolving, loadData]);

  const step = useMemo(
    () => steps.find((candidate) => String(candidate.id) === stageId) ?? null,
    [steps, stageId],
  );

  const stageEntries = useMemo(() => entriesForStep(entries, stageId, steps), [entries, stageId, steps]);

  const allowedActions = useMemo<SurveyAction[]>(() => {
    if (!step) return [];
    const configured = (step.actions ?? []).map((action) =>
      typeof action === "string" ? action : action.name,
    );
    // A step can only ever offer actions Survey understands, whatever the config says.
    return SURVEY_ACTIONS.filter((action) => configured.includes(action));
  }, [step]);

  const handleAct = async () => {
    if (!pending || !user || !globalProjectId) return;
    setIsActing(true);
    try {
      const result = await actOnSurveyEntry({
        projectId: globalProjectId,
        entryId: pending.entry.id,
        action: pending.action,
        comment: comment.trim(),
        steps,
        actor: { id: user.id, name: user.name },
        resolveAssignees: (nextStep) =>
          getAssigneeForStep(nextStep, {
            projectId: globalProjectId,
            departmentId: "",
            amount: pending.entry.surveyedQty * pending.entry.budgetPrice,
          }),
        resolveDeadline: async (nextStep) => {
          try {
            return await calculateDeadline(new Date(), nextStep.tat);
          } catch {
            return null;
          }
        },
      });

      void logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: context.activityModule,
        action: `Survey ${pending.action}`,
        details: {
          project: projectName,
          boqSlNo: pending.entry.boqSlNo,
          stage: step?.name ?? "",
          surveyedQty: pending.entry.surveyedQty,
        },
      });

      toast({
        title: `Survey ${result.status.toLowerCase()}`,
        description: result.applied
          ? "The surveyed quantity has been certified and written to the BOQ item."
          : undefined,
      });
      setPending(null);
      setComment("");
      await loadData();
    } catch (error) {
      console.error("Failed to action survey entry:", error);
      toast({
        title: "Action failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsActing(false);
    }
  };

  const columns: PmListColumn<StageListRow>[] = [
    { header: "BOQ SL No", className: "whitespace-nowrap", mobile: "title", cell: ({ entry }) => entry.boqSlNo || "—" },
    {
      header: "Description",
      className: "max-w-xs truncate",
      mobile: "title",
      cell: ({ entry }) => <span title={entry.description}>{entry.description}</span>,
    },
    { header: "BOQ Qty", align: "right", cell: ({ entry }) => formatQuantity(entry.boqQty) },
    {
      header: "Surveyed Qty",
      align: "right",
      cell: ({ entry }) => (
        <span className="font-medium">
          {formatQuantity(entry.surveyedQty)} {entry.unit}
        </span>
      ),
    },
    {
      header: "Deviation",
      align: "right",
      cell: ({ deviation, deviationPct, classification }) => (
        <>
          <span className={deviation > 0 ? "text-amber-600" : deviation < 0 ? "text-blue-600" : ""}>
            {deviation > 0 ? "+" : ""}
            {formatQuantity(deviation)} ({formatDeviationPct(deviationPct)})
          </span>
          <div>
            <Badge variant="outline" className={`mt-1 ${surveyClassificationStyles[classification]}`}>
              {classification}
            </Badge>
          </div>
        </>
      ),
    },
    { header: "Surveyed By", cell: ({ entry }) => entry.surveyedByName || "—" },
    {
      header: "Status",
      mobile: "aside",
      cell: ({ entry }) => (
        <Badge variant="outline" className={surveyStatusStyles[entry.status]}>
          {entry.status}
        </Badge>
      ),
    },
    {
      header: "Due",
      cell: ({ entry }) => {
        const due = toDateSafe(entry.deadline);
        return (
          <div className="text-xs text-muted-foreground">
            {due ? (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {due.toLocaleDateString()}
              </span>
            ) : (
              "—"
            )}
          </div>
        );
      },
    },
    {
      header: "Actions",
      align: "right",
      mobile: "footer",
      cell: ({ entry }) => {
        const mayAct = user ? canActOnSurveyEntry(entry, user.id) : false;
        return mayAct ? (
          <div className="flex w-full flex-wrap justify-end gap-2 sm:w-auto sm:gap-1">
            {allowedActions.map((action) => (
              <Button
                key={action}
                size="sm"
                variant={action === "Approve" ? "default" : "outline"}
                onClick={() => {
                  setPending({ entry, action });
                  setComment("");
                }}
              >
                {action}
              </Button>
            ))}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Not assigned to you</span>
        );
      },
    },
  ];

  if (isAuthLoading || isResolving || (isLoading && canViewModule)) {
    return <SurveyLoadingState />;
  }

  if (!canViewModule) {
    return <SurveyAccessDenied description="You do not have permission to access the Survey module." />;
  }

  if (notFound) {
    return (
      <SurveyProjectNotFound
        description="Return to Project Management and choose a project before opening Survey."
        href="/project-management"
      />
    );
  }

  if (!step) {
    return (
      <SurveyPageShell>
        <PageHeader
          title="Stage not found"
          description="This stage is no longer part of the survey workflow."
          icon={GitMerge}
          backHref={context.surveyHref()}
          backLabel="Back to Survey"
        />
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>Stage removed</CardTitle>
            <CardDescription>
              It may have been deleted in Workflow Configuration. Open the Survey hub to see the
              current stages.
            </CardDescription>
          </CardHeader>
        </Card>
      </SurveyPageShell>
    );
  }

  return (
    <SurveyPageShell>
      <PageHeader
        title={step.name}
        description={
          step.description ||
          (projectName ? `Survey entries awaiting ${step.name} for ${projectName}.` : `Survey entries awaiting ${step.name}.`)
        }
        icon={GitMerge}
        backHref={context.surveyHref()}
        backLabel="Back to Survey"
      />


      <PmDataList
        rows={stageEntries.map((entry) => ({
          id: entry.id,
          entry,
          ...classifySurveyDeviation(entry.surveyedQty, entry.boqQty, tolerancePct, plausibilityPct),
        }))}
        columns={columns}
        empty={
          <PmEmptyState
            icon={GitMerge}
            title="Nothing waiting at this stage"
            description="Surveys submitted from Record Survey will appear here."
          />
        }
      />

      <Dialog open={Boolean(pending)} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent className={PM_DIALOG.content}>
          <DialogHeader className={PM_DIALOG.header}>
            <DialogTitle>{pending?.action} survey</DialogTitle>
            <DialogDescription>
              {pending ? `${pending.entry.boqSlNo} — ${pending.entry.description}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className={cn(PM_DIALOG.body, "py-2")}>
            <p className="text-sm">
              Surveyed quantity:{" "}
              <span className="font-medium">
                {pending ? formatQuantity(pending.entry.surveyedQty) : ""} {pending?.entry.unit}
              </span>{" "}
              against a BOQ quantity of {pending ? formatQuantity(pending.entry.boqQty) : ""}.
            </p>
            {pending?.action === "Approve" && step && steps[steps.length - 1]?.id === step.id && (
              <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
                This is the final step — approving writes the surveyed quantity onto the BOQ item.
              </p>
            )}
            <div className="space-y-2">
              <Label htmlFor="survey-action-comment">Comment</Label>
              <Textarea
                id="survey-action-comment"
                placeholder="Optional notes for the audit trail..."
                value={comment}
                onChange={(event) => setComment(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter className={PM_DIALOG.footer}>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={handleAct} disabled={isActing}>
              {isActing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirm {pending?.action}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SurveyPageShell>
  );
}
