"use client";

/**
 * Inspections hub — the same shape as the other module hubs: static screens plus one card per
 * configured result-approval stage.
 *
 * The inspection register that used to live at this path is now at `inspections/register`.
 */

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ClipboardCheck,
  FolderOpen,
  GitMerge,
  type LucideIcon,
  Settings,
  Table2,
} from "lucide-react";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { WorkflowStep } from "@/lib/types";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { INSPECTION_COLLECTION } from "@/lib/supply-gates";
import { useProjectManagementInspectionContext } from "@/components/inspection/use-inspection-host-context";
import { InspectionNav } from "@/components/inspection/inspection-nav";
import {
  INSPECTION_GRADIENT,
  INSPECTION_SETTINGS_GRADIENT,
  InspectionAccessDenied,
  InspectionCardGridLoadingState,
  InspectionNavCard,
  InspectionNavCardGrid,
  InspectionPageHeader,
  InspectionPageShell,
  InspectionProjectNotFound,
} from "@/components/inspection/inspection-page-shell";
import {
  DEFAULT_INSPECTION_RESULT_STEPS,
  INSPECTION_RESULT_APPROVAL_COLLECTION,
  INSPECTION_RESULT_WORKFLOW_DOC_ID,
  isTerminalInspectionApprovalStatus,
  type InspectionResultApproval,
} from "@/lib/project-management-inspection-workflow";

type InspectionItem = {
  icon: LucideIcon;
  text: string;
  href: string;
  description: string;
  disabled?: boolean;
  gradient?: string;
};

export default function InspectionsHubPage() {
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { context, isResolving, notFound, projectName } =
    useProjectManagementInspectionContext(mappingId);
  const { can, isLoading: authIsLoading } = useAuthorization();

  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [openCountByStep, setOpenCountByStep] = useState<Record<number, number>>({});
  const [awaitingResultCount, setAwaitingResultCount] = useState(0);
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
  const canViewSettings = safeCan("View Settings");

  const globalProjectId = context.globalProjectId;

  useEffect(() => {
    if (authIsLoading || isResolving) return;
    let cancelled = false;

    void (async () => {
      setIsWorkflowLoading(true);
      setWorkflowError(null);
      try {
        const workflowSnapshot = await getDoc(
          doc(db, "workflows", INSPECTION_RESULT_WORKFLOW_DOC_ID),
        );
        const rawSteps = workflowSnapshot.exists()
          ? ((workflowSnapshot.data()?.steps as WorkflowStep[] | undefined) ?? [])
          : DEFAULT_INSPECTION_RESULT_STEPS;
        const nextSteps = (Array.isArray(rawSteps) ? rawSteps : [])
          .filter((step) => step && step.name)
          .map((step, index) => ({ ...step, id: String(step.id || index + 1) }));
        if (cancelled) return;
        setSteps(nextSteps);

        if (globalProjectId) {
          const [approvalSnapshot, inspectionSnapshot] = await Promise.all([
            getDocs(
              collection(db, "projects", globalProjectId, INSPECTION_RESULT_APPROVAL_COLLECTION),
            ),
            getDocs(collection(db, "projects", globalProjectId, INSPECTION_COLLECTION)),
          ]);
          if (cancelled) return;
          const counts: Record<number, number> = {};
          approvalSnapshot.docs.forEach((approvalDoc) => {
            const approval = approvalDoc.data() as InspectionResultApproval;
            if (isTerminalInspectionApprovalStatus(approval.status)) return;
            counts[approval.currentStepIndex] = (counts[approval.currentStepIndex] ?? 0) + 1;
          });
          setOpenCountByStep(counts);
          setAwaitingResultCount(
            inspectionSnapshot.docs.filter(
              (inspectionDoc) => String(inspectionDoc.data()?.status ?? "") === "Requested",
            ).length,
          );
        }
      } catch (error) {
        console.error("Failed to load the inspection result workflow:", error);
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

  const inspectionItems: InspectionItem[] = useMemo(() => {
    if (authIsLoading || isWorkflowLoading) return [];

    const head: InspectionItem[] = [
      {
        icon: Table2,
        text: "Inspection Register",
        href: context.inspectionHref("register"),
        description: awaitingResultCount
          ? `${awaitingResultCount} inspection${awaitingResultCount === 1 ? "" : "s"} awaiting a result.`
          : "Items on issued purchase orders, and their inspection state.",
        disabled: !canViewModule || !mappingId,
      },
    ];

    const stageItems: InspectionItem[] = steps.map((step, index) => {
      const count = openCountByStep[index] ?? 0;
      return {
        icon: GitMerge,
        text: step.name,
        href: context.inspectionHref(`stage/${step.id}`),
        description: count
          ? `${count} result${count === 1 ? "" : "s"} awaiting ${step.name.toLowerCase()}.`
          : `Result requests at the ${step.name} stage.`,
        disabled: !canViewModule || !mappingId,
      };
    });

    const tail: InspectionItem[] = [
      {
        icon: FolderOpen,
        text: "Inspection Reports",
        href: `/project-management/documents?project=${encodeURIComponent(mappingId)}&category=${encodeURIComponent("Inspection Report")}`,
        description: "Every uploaded inspection report for this project.",
        disabled: !canViewModule || !mappingId,
      },
      {
        icon: Settings,
        text: "Settings",
        href: context.inspectionHref("settings"),
        description: "Configure the result approval workflow.",
        disabled: !canViewSettings || !mappingId,
        gradient: INSPECTION_SETTINGS_GRADIENT,
      },
    ];

    return [...head, ...stageItems, ...tail];
  }, [
    authIsLoading,
    isWorkflowLoading,
    context,
    mappingId,
    steps,
    openCountByStep,
    awaitingResultCount,
    canViewModule,
    canViewSettings,
  ]);

  if (authIsLoading || isResolving || isWorkflowLoading) {
    return <InspectionCardGridLoadingState tiles={5} />;
  }

  if (!canViewModule) {
    return <InspectionAccessDenied description="You do not have permission to access inspections." />;
  }

  if (notFound) {
    return (
      <InspectionProjectNotFound
        description="Return to Project Management and choose a project before opening inspections."
        href="/project-management"
      />
    );
  }

  return (
    <InspectionPageShell>
      <InspectionPageHeader
        title="Inspections"
        subtitle={
          projectName
            ? `Request and record inspections for ${projectName}, and work each approval stage.`
            : "Request and record inspections, and work each approval stage."
        }
        icon={ClipboardCheck}
        backHref={context.parentHref}
        gradient={INSPECTION_GRADIENT}
      />

      <InspectionNav context={context} active="hub" />

      {workflowError ? (
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>Workflow unavailable</CardTitle>
            <CardDescription>{workflowError}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <InspectionNavCardGrid>
          {inspectionItems.map((item) => (
            <InspectionNavCard
              key={`${item.text}-${item.href}`}
              title={item.text}
              description={item.description}
              href={item.href}
              icon={item.icon}
              gradient={item.gradient ?? INSPECTION_GRADIENT}
              disabled={item.href === "#" || item.disabled}
            />
          ))}
        </InspectionNavCardGrid>
      )}
    </InspectionPageShell>
  );
}
