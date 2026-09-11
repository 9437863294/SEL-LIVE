"use client";

/**
 * Survey hub — the same shape as the JMC hub: static screens plus one card per configured
 * workflow stage, so the stages a project has set up are visible and reachable from here.
 *
 * The BOQ deviation table that used to live at this path is now at `survey/record`.
 */

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  BarChart3,
  Compass,
  GitMerge,
  History,
  type LucideIcon,
  Ruler,
  Settings,
} from "lucide-react";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { WorkflowStep } from "@/lib/types";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { useProjectManagementSurveyContext } from "@/components/survey/use-survey-host-context";
import {
  SURVEY_GRADIENT,
  SURVEY_SETTINGS_GRADIENT,
  SurveyAccessDenied,
  SurveyCardGridLoadingState,
  SurveyNavCard,
  SurveyNavCardGrid,
  SurveyPageHeader,
  SurveyPageShell,
  SurveyProjectNotFound,
} from "@/components/survey/survey-page-shell";
import {
  DEFAULT_SURVEY_STEPS,
  SURVEY_ENTRY_COLLECTION,
  SURVEY_WORKFLOW_DOC_ID,
  isTerminalSurveyStatus,
  type SurveyEntry,
} from "@/lib/project-management-survey-workflow";

type SurveyItem = {
  icon: LucideIcon;
  text: string;
  href: string;
  description: string;
  disabled?: boolean;
  gradient?: string;
};

export default function SurveyHubPage() {
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { context, isResolving, notFound, projectName } = useProjectManagementSurveyContext(mappingId);
  const { can, isLoading: authIsLoading } = useAuthorization();

  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [openCountByStep, setOpenCountByStep] = useState<Record<number, number>>({});
  const [isWorkflowLoading, setIsWorkflowLoading] = useState(true);
  const [workflowError, setWorkflowError] = useState<string | null>(null);

  const safeCan = (action: string) => {
    if (authIsLoading) return false;
    try {
      return can(action, context.permissionResource);
    } catch {
      return false;
    }
  };

  const canViewModule = safeCan("View");
  const canRecord = safeCan("Record");
  const canViewSettings = safeCan("View Settings");
  const canViewReports = safeCan("View Reports");

  const globalProjectId = context.globalProjectId;

  useEffect(() => {
    if (authIsLoading || isResolving) return;
    let cancelled = false;

    void (async () => {
      setIsWorkflowLoading(true);
      setWorkflowError(null);
      try {
        const workflowSnapshot = await getDoc(doc(db, "workflows", SURVEY_WORKFLOW_DOC_ID));
        const rawSteps = workflowSnapshot.exists()
          ? ((workflowSnapshot.data()?.steps as WorkflowStep[] | undefined) ?? [])
          : DEFAULT_SURVEY_STEPS;
        const nextSteps = (Array.isArray(rawSteps) ? rawSteps : [])
          .filter((step) => step && step.name)
          .map((step, index) => ({ ...step, id: String(step.id || index + 1) }));
        if (cancelled) return;
        setSteps(nextSteps);

        // Per-stage counts, so the hub shows where work is actually sitting.
        if (globalProjectId) {
          const entrySnapshot = await getDocs(
            collection(db, "projects", globalProjectId, SURVEY_ENTRY_COLLECTION),
          );
          if (cancelled) return;
          const counts: Record<number, number> = {};
          entrySnapshot.docs.forEach((entryDoc) => {
            const entry = entryDoc.data() as SurveyEntry;
            if (isTerminalSurveyStatus(entry.status)) return;
            counts[entry.currentStepIndex] = (counts[entry.currentStepIndex] ?? 0) + 1;
          });
          setOpenCountByStep(counts);
        }
      } catch (error) {
        console.error("Failed to load the survey workflow:", error);
        if (cancelled) return;
        setWorkflowError("Failed to load workflow configuration.");
        toast({
          title: "Could not load workflow",
          description: "Please try again later.",
          variant: "destructive",
        });
      } finally {
        if (!cancelled) setIsWorkflowLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authIsLoading, isResolving, globalProjectId, toast]);

  const surveyItems: SurveyItem[] = useMemo(() => {
    if (authIsLoading || isWorkflowLoading) return [];

    const recordItem: SurveyItem = {
      icon: Ruler,
      text: "Record Survey",
      href: context.surveyHref("record"),
      description: "Measure BOQ items and submit surveyed quantities.",
      disabled: !canRecord || !mappingId,
    };

    const stageItems: SurveyItem[] = steps.map((step, index) => {
      const count = openCountByStep[index] ?? 0;
      return {
        icon: GitMerge,
        text: step.name,
        href: context.surveyHref(`stage/${step.id}`),
        description: count
          ? `${count} ${count === 1 ? "survey" : "surveys"} awaiting ${step.name.toLowerCase()}.`
          : `Tasks for the ${step.name} stage.`,
        disabled: !canViewModule || !mappingId,
      };
    });

    const tailItems: SurveyItem[] = [
      {
        icon: History,
        text: "Survey Log",
        href: context.surveyHref("log"),
        description: "Every survey entry and where it stands.",
        disabled: !canViewModule || !mappingId,
      },
      {
        icon: BarChart3,
        text: "Reports",
        href: context.surveyHref("reports"),
        description: "Survey coverage and deviation summaries.",
        disabled: !canViewReports || !mappingId,
      },
      {
        icon: Settings,
        text: "Settings",
        href: context.surveyHref("settings"),
        description: "Configure the survey approval workflow.",
        disabled: !canViewSettings || !mappingId,
        gradient: SURVEY_SETTINGS_GRADIENT,
      },
    ];

    return [recordItem, ...stageItems, ...tailItems];
  }, [
    authIsLoading,
    isWorkflowLoading,
    context,
    mappingId,
    steps,
    openCountByStep,
    canRecord,
    canViewModule,
    canViewReports,
    canViewSettings,
  ]);

  if (authIsLoading || isResolving || isWorkflowLoading) {
    return <SurveyCardGridLoadingState tiles={6} />;
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

  return (
    <SurveyPageShell>
      <SurveyPageHeader
        title="Survey"
        subtitle={
          projectName
            ? `Record surveyed quantities for ${projectName}, work each stage, and review the log.`
            : "Record surveyed quantities, work each stage, and review the log."
        }
        icon={Compass}
        backHref={context.parentHref}
        gradient={SURVEY_GRADIENT}
      />


      {workflowError ? (
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>Workflow unavailable</CardTitle>
            <CardDescription>{workflowError}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <SurveyNavCardGrid>
          {surveyItems.map((item) => (
            <SurveyNavCard
              key={`${item.text}-${item.href}`}
              title={item.text}
              description={item.description}
              href={item.href}
              icon={item.icon}
              gradient={item.gradient ?? SURVEY_GRADIENT}
              disabled={item.href === "#" || item.disabled}
            />
          ))}
        </SurveyNavCardGrid>
      )}
    </SurveyPageShell>
  );
}
