"use client";

/**
 * Purchase Orders hub — the same shape as the JMC, Survey, Indent and RFQ hubs: static screens plus
 * one card per configured issue-approval stage.
 *
 * The PO register that used to live at this path is now at `purchase-orders/register`.
 */

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  FilePlus2,
  GitMerge,
  type LucideIcon,
  Settings,
  ShoppingCart,
  Table2,
} from "lucide-react";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { WorkflowStep } from "@/lib/types";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { PO_COLLECTION } from "@/lib/purchase-orders";
import { useProjectManagementPoContext } from "@/components/po/use-po-host-context";
import { PoNav } from "@/components/po/po-nav";
import {
  PO_GRADIENT,
  PO_SETTINGS_GRADIENT,
  PoAccessDenied,
  PoCardGridLoadingState,
  PoNavCard,
  PoNavCardGrid,
  PoPageHeader,
  PoPageShell,
  PoProjectNotFound,
} from "@/components/po/po-page-shell";
import {
  DEFAULT_PO_ISSUE_STEPS,
  PO_ISSUE_APPROVAL_COLLECTION,
  PO_ISSUE_WORKFLOW_DOC_ID,
  isTerminalPoIssueStatus,
  type PoIssueApproval,
} from "@/lib/project-management-po-workflow";

type PoItem = {
  icon: LucideIcon;
  text: string;
  href: string;
  description: string;
  disabled?: boolean;
  gradient?: string;
};

export default function PurchaseOrdersHubPage() {
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { context, isResolving, notFound, projectName } = useProjectManagementPoContext(mappingId);
  const { can, isLoading: authIsLoading } = useAuthorization();

  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [openCountByStep, setOpenCountByStep] = useState<Record<number, number>>({});
  const [draftCount, setDraftCount] = useState(0);
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
        const workflowSnapshot = await getDoc(doc(db, "workflows", PO_ISSUE_WORKFLOW_DOC_ID));
        const rawSteps = workflowSnapshot.exists()
          ? ((workflowSnapshot.data()?.steps as WorkflowStep[] | undefined) ?? [])
          : DEFAULT_PO_ISSUE_STEPS;
        const nextSteps = (Array.isArray(rawSteps) ? rawSteps : [])
          .filter((step) => step && step.name)
          .map((step, index) => ({ ...step, id: String(step.id || index + 1) }));
        if (cancelled) return;
        setSteps(nextSteps);

        if (globalProjectId) {
          const [approvalSnapshot, poSnapshot] = await Promise.all([
            getDocs(collection(db, "projects", globalProjectId, PO_ISSUE_APPROVAL_COLLECTION)),
            getDocs(collection(db, "projects", globalProjectId, PO_COLLECTION)),
          ]);
          if (cancelled) return;
          const counts: Record<number, number> = {};
          approvalSnapshot.docs.forEach((approvalDoc) => {
            const approval = approvalDoc.data() as PoIssueApproval;
            if (isTerminalPoIssueStatus(approval.status)) return;
            counts[approval.currentStepIndex] = (counts[approval.currentStepIndex] ?? 0) + 1;
          });
          setOpenCountByStep(counts);
          setDraftCount(
            poSnapshot.docs.filter((poDoc) => String(poDoc.data()?.status) === "Draft").length,
          );
        }
      } catch (error) {
        console.error("Failed to load the PO issue workflow:", error);
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

  const poItems: PoItem[] = useMemo(() => {
    if (authIsLoading || isWorkflowLoading) return [];

    const head: PoItem[] = [
      {
        icon: FilePlus2,
        text: "New PO",
        href: context.poHref("new"),
        description: "Raise a purchase order from awarded quotes, indents or BOQ items.",
        disabled: !canAdd || !mappingId,
      },
      {
        icon: Table2,
        text: "PO Register",
        href: context.poHref("register"),
        description: draftCount
          ? `${draftCount} draft${draftCount === 1 ? "" : "s"} not yet issued.`
          : "Every purchase order, with calendar, Gantt and reports.",
        disabled: !canViewModule || !mappingId,
      },
    ];

    const stageItems: PoItem[] = steps.map((step, index) => {
      const count = openCountByStep[index] ?? 0;
      return {
        icon: GitMerge,
        text: step.name,
        href: context.poHref(`stage/${step.id}`),
        description: count
          ? `${count} PO${count === 1 ? "" : "s"} awaiting ${step.name.toLowerCase()}.`
          : `Issue requests at the ${step.name} stage.`,
        disabled: !canViewModule || !mappingId,
      };
    });

    const tail: PoItem[] = [
      {
        icon: Settings,
        text: "Settings",
        href: context.poHref("settings"),
        description: "Configure the issue approval workflow.",
        disabled: !canViewSettings || !mappingId,
        gradient: PO_SETTINGS_GRADIENT,
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
    draftCount,
    canAdd,
    canViewModule,
    canViewSettings,
  ]);

  if (authIsLoading || isResolving || isWorkflowLoading) {
    return <PoCardGridLoadingState tiles={5} />;
  }

  if (!canViewModule) {
    return <PoAccessDenied description="You do not have permission to access purchase orders." />;
  }

  if (notFound) {
    return (
      <PoProjectNotFound
        description="Return to Project Management and choose a project before opening purchase orders."
        href="/project-management"
      />
    );
  }

  return (
    <PoPageShell>
      <PoPageHeader
        title="Purchase Orders"
        subtitle={
          projectName
            ? `Raise, approve and issue purchase orders for ${projectName}.`
            : "Raise, approve and issue purchase orders."
        }
        icon={ShoppingCart}
        backHref={context.parentHref}
        gradient={PO_GRADIENT}
      />

      <PoNav context={context} active="hub" />

      {workflowError ? (
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>Workflow unavailable</CardTitle>
            <CardDescription>{workflowError}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <PoNavCardGrid>
          {poItems.map((item) => (
            <PoNavCard
              key={`${item.text}-${item.href}`}
              title={item.text}
              description={item.description}
              href={item.href}
              icon={item.icon}
              gradient={item.gradient ?? PO_GRADIENT}
              disabled={item.href === "#" || item.disabled}
            />
          ))}
        </PoNavCardGrid>
      )}
    </PoPageShell>
  );
}
