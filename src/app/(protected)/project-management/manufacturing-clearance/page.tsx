"use client";

/**
 * Manufacturing Clearance hub — the same shape as the other module hubs: static screens plus one
 * card per configured clearance-approval stage.
 *
 * The MC register that used to live at this path is now at `manufacturing-clearance/register`.
 */

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Factory, GitMerge, type LucideIcon, Settings, Table2 } from "lucide-react";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { WorkflowStep } from "@/lib/types";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { MC_COLLECTION } from "@/lib/supply-gates";
import { useProjectManagementMcContext } from "@/components/mc/use-mc-host-context";
import { McNav } from "@/components/mc/mc-nav";
import {
  MC_GRADIENT,
  MC_SETTINGS_GRADIENT,
  McAccessDenied,
  McCardGridLoadingState,
  McNavCard,
  McNavCardGrid,
  McPageHeader,
  McPageShell,
  McProjectNotFound,
} from "@/components/mc/mc-page-shell";
import {
  DEFAULT_MC_CLEARANCE_STEPS,
  MC_CLEARANCE_APPROVAL_COLLECTION,
  MC_CLEARANCE_WORKFLOW_DOC_ID,
  isTerminalMcApprovalStatus,
  type McClearanceApproval,
} from "@/lib/project-management-mc-workflow";

type McItem = {
  icon: LucideIcon;
  text: string;
  href: string;
  description: string;
  disabled?: boolean;
  gradient?: string;
};

export default function ManufacturingClearanceHubPage() {
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { context, isResolving, notFound, projectName } = useProjectManagementMcContext(mappingId);
  const { can, isLoading: authIsLoading } = useAuthorization();

  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [openCountByStep, setOpenCountByStep] = useState<Record<number, number>>({});
  const [pendingGateCount, setPendingGateCount] = useState(0);
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
        const workflowSnapshot = await getDoc(doc(db, "workflows", MC_CLEARANCE_WORKFLOW_DOC_ID));
        const rawSteps = workflowSnapshot.exists()
          ? ((workflowSnapshot.data()?.steps as WorkflowStep[] | undefined) ?? [])
          : DEFAULT_MC_CLEARANCE_STEPS;
        const nextSteps = (Array.isArray(rawSteps) ? rawSteps : [])
          .filter((step) => step && step.name)
          .map((step, index) => ({ ...step, id: String(step.id || index + 1) }));
        if (cancelled) return;
        setSteps(nextSteps);

        if (globalProjectId) {
          const [approvalSnapshot, mcSnapshot] = await Promise.all([
            getDocs(collection(db, "projects", globalProjectId, MC_CLEARANCE_APPROVAL_COLLECTION)),
            getDocs(collection(db, "projects", globalProjectId, MC_COLLECTION)),
          ]);
          if (cancelled) return;
          const counts: Record<number, number> = {};
          approvalSnapshot.docs.forEach((approvalDoc) => {
            const approval = approvalDoc.data() as McClearanceApproval;
            if (isTerminalMcApprovalStatus(approval.status)) return;
            counts[approval.currentStepIndex] = (counts[approval.currentStepIndex] ?? 0) + 1;
          });
          setOpenCountByStep(counts);
          setPendingGateCount(
            mcSnapshot.docs.filter(
              (mcDoc) => String(mcDoc.data()?.status ?? "Pending") === "Pending",
            ).length,
          );
        }
      } catch (error) {
        console.error("Failed to load the MC clearance workflow:", error);
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

  const mcItems: McItem[] = useMemo(() => {
    if (authIsLoading || isWorkflowLoading) return [];

    const head: McItem[] = [
      {
        icon: Table2,
        text: "MC Register",
        href: context.mcHref("register"),
        description: pendingGateCount
          ? `${pendingGateCount} item${pendingGateCount === 1 ? "" : "s"} not yet cleared.`
          : "Items on issued purchase orders awaiting clearance.",
        disabled: !canViewModule || !mappingId,
      },
    ];

    const stageItems: McItem[] = steps.map((step, index) => {
      const count = openCountByStep[index] ?? 0;
      return {
        icon: GitMerge,
        text: step.name,
        href: context.mcHref(`stage/${step.id}`),
        description: count
          ? `${count} clearance${count === 1 ? "" : "s"} awaiting ${step.name.toLowerCase()}.`
          : `Clearance requests at the ${step.name} stage.`,
        disabled: !canViewModule || !mappingId,
      };
    });

    const tail: McItem[] = [
      {
        icon: Settings,
        text: "Settings",
        href: context.mcHref("settings"),
        description: "Configure the clearance approval workflow.",
        disabled: !canViewSettings || !mappingId,
        gradient: MC_SETTINGS_GRADIENT,
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
    pendingGateCount,
    canViewModule,
    canViewSettings,
  ]);

  if (authIsLoading || isResolving || isWorkflowLoading) {
    return <McCardGridLoadingState tiles={4} />;
  }

  if (!canViewModule) {
    return (
      <McAccessDenied description="You do not have permission to access manufacturing clearance." />
    );
  }

  if (notFound) {
    return (
      <McProjectNotFound
        description="Return to Project Management and choose a project before opening manufacturing clearance."
        href="/project-management"
      />
    );
  }

  return (
    <McPageShell>
      <McPageHeader
        title="Manufacturing Clearance"
        subtitle={
          projectName
            ? `Clear vendors to begin manufacturing on ${projectName}, and work each approval stage.`
            : "Clear vendors to begin manufacturing, and work each approval stage."
        }
        icon={Factory}
        backHref={context.parentHref}
        gradient={MC_GRADIENT}
      />

      <McNav context={context} active="hub" />

      {workflowError ? (
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>Workflow unavailable</CardTitle>
            <CardDescription>{workflowError}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <McNavCardGrid>
          {mcItems.map((item) => (
            <McNavCard
              key={`${item.text}-${item.href}`}
              title={item.text}
              description={item.description}
              href={item.href}
              icon={item.icon}
              gradient={item.gradient ?? MC_GRADIENT}
              disabled={item.href === "#" || item.disabled}
            />
          ))}
        </McNavCardGrid>
      )}
    </McPageShell>
  );
}
