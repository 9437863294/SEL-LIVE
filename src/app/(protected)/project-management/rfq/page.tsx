"use client";

/**
 * RFQ hub — the same shape as the JMC, Survey and Indent hubs: static screens plus one card per
 * configured award-approval stage.
 *
 * The RFQ register that used to live at this path is now at `rfq/register`.
 */

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  FilePlus2,
  FileSearch,
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
import { useProjectManagementRfqContext } from "@/components/rfq/use-rfq-host-context";
import { RfqNav } from "@/components/rfq/rfq-nav";
import {
  RFQ_GRADIENT,
  RFQ_SETTINGS_GRADIENT,
  RfqAccessDenied,
  RfqCardGridLoadingState,
  RfqNavCard,
  RfqNavCardGrid,
  RfqPageHeader,
  RfqPageShell,
  RfqProjectNotFound,
} from "@/components/rfq/rfq-page-shell";
import {
  DEFAULT_RFQ_AWARD_STEPS,
  RFQ_AWARD_APPROVAL_COLLECTION,
  RFQ_AWARD_WORKFLOW_DOC_ID,
  isTerminalRfqAwardStatus,
  type RfqAwardApproval,
} from "@/lib/project-management-rfq-workflow";

type RfqItem = {
  icon: LucideIcon;
  text: string;
  href: string;
  description: string;
  disabled?: boolean;
  gradient?: string;
};

export default function RfqHubPage() {
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { context, isResolving, notFound, projectName } = useProjectManagementRfqContext(mappingId);
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
  const canAdd = safeCan("Add");
  const canViewSettings = safeCan("View Settings");

  const globalProjectId = context.globalProjectId;

  useEffect(() => {
    if (authIsLoading || isResolving) return;
    let cancelled = false;

    void (async () => {
      setIsWorkflowLoading(true);
      setWorkflowError(null);
      try {
        const workflowSnapshot = await getDoc(doc(db, "workflows", RFQ_AWARD_WORKFLOW_DOC_ID));
        const rawSteps = workflowSnapshot.exists()
          ? ((workflowSnapshot.data()?.steps as WorkflowStep[] | undefined) ?? [])
          : DEFAULT_RFQ_AWARD_STEPS;
        const nextSteps = (Array.isArray(rawSteps) ? rawSteps : [])
          .filter((step) => step && step.name)
          .map((step, index) => ({ ...step, id: String(step.id || index + 1) }));
        if (cancelled) return;
        setSteps(nextSteps);

        if (globalProjectId) {
          const approvalSnapshot = await getDocs(
            collection(db, "projects", globalProjectId, RFQ_AWARD_APPROVAL_COLLECTION),
          );
          if (cancelled) return;
          const counts: Record<number, number> = {};
          approvalSnapshot.docs.forEach((approvalDoc) => {
            const approval = approvalDoc.data() as RfqAwardApproval;
            if (isTerminalRfqAwardStatus(approval.status)) return;
            counts[approval.currentStepIndex] = (counts[approval.currentStepIndex] ?? 0) + 1;
          });
          setOpenCountByStep(counts);
        }
      } catch (error) {
        console.error("Failed to load the RFQ award workflow:", error);
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

  const rfqItems: RfqItem[] = useMemo(() => {
    if (authIsLoading || isWorkflowLoading) return [];

    const head: RfqItem[] = [
      {
        icon: FilePlus2,
        text: "New RFQ",
        href: context.rfqHref("new"),
        description: "Bundle indent items and invite vendors to quote.",
        disabled: !canAdd || !mappingId,
      },
      {
        icon: Table2,
        text: "RFQ Register",
        href: context.rfqHref("register"),
        description: "Every RFQ, its quotes and its awards.",
        disabled: !canViewModule || !mappingId,
      },
    ];

    const stageItems: RfqItem[] = steps.map((step, index) => {
      const count = openCountByStep[index] ?? 0;
      return {
        icon: GitMerge,
        text: step.name,
        href: context.rfqHref(`stage/${step.id}`),
        description: count
          ? `${count} award${count === 1 ? "" : "s"} awaiting ${step.name.toLowerCase()}.`
          : `Award requests at the ${step.name} stage.`,
        disabled: !canViewModule || !mappingId,
      };
    });

    const tail: RfqItem[] = [
      {
        icon: Settings,
        text: "Settings",
        href: context.rfqHref("settings"),
        description: "Configure the award approval workflow.",
        disabled: !canViewSettings || !mappingId,
        gradient: RFQ_SETTINGS_GRADIENT,
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
    canAdd,
    canViewModule,
    canViewSettings,
  ]);

  if (authIsLoading || isResolving || isWorkflowLoading) {
    return <RfqCardGridLoadingState tiles={5} />;
  }

  if (!canViewModule) {
    return <RfqAccessDenied description="You do not have permission to access the RFQ module." />;
  }

  if (notFound) {
    return (
      <RfqProjectNotFound
        description="Return to Project Management and choose a project before opening RFQs."
        href="/project-management"
      />
    );
  }

  return (
    <RfqPageShell>
      <RfqPageHeader
        title="RFQ"
        subtitle={
          projectName
            ? `Request quotations for ${projectName}, review awards, and raise purchase orders.`
            : "Request quotations, review awards, and raise purchase orders."
        }
        icon={FileSearch}
        backHref={context.parentHref}
        gradient={RFQ_GRADIENT}
      />

      <RfqNav context={context} active="hub" />

      {workflowError ? (
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>Workflow unavailable</CardTitle>
            <CardDescription>{workflowError}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <RfqNavCardGrid>
          {rfqItems.map((item) => (
            <RfqNavCard
              key={`${item.text}-${item.href}`}
              title={item.text}
              description={item.description}
              href={item.href}
              icon={item.icon}
              gradient={item.gradient ?? RFQ_GRADIENT}
              disabled={item.href === "#" || item.disabled}
            />
          ))}
        </RfqNavCardGrid>
      )}
    </RfqPageShell>
  );
}
