"use client";

/**
 * Indent hub — the same shape as the JMC and Survey hubs: static screens plus one card per
 * configured workflow stage, so the stages a project has set up are visible and reachable here.
 *
 * The indent register that used to live at this path is now at `indent/register`.
 */

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  FilePlus2,
  GitMerge,
  ListChecks,
  type LucideIcon,
  Settings,
} from "lucide-react";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { WorkflowStep } from "@/lib/types";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { useProjectManagementIndentContext } from "@/components/indent/use-indent-host-context";
import { IndentNav } from "@/components/indent/indent-nav";
import {
  INDENT_GRADIENT,
  INDENT_SETTINGS_GRADIENT,
  IndentAccessDenied,
  IndentCardGridLoadingState,
  IndentNavCard,
  IndentNavCardGrid,
  IndentPageHeader,
  IndentPageShell,
  IndentProjectNotFound,
} from "@/components/indent/indent-page-shell";
import {
  DEFAULT_INDENT_STEPS,
  INDENT_COLLECTION,
  INDENT_WORKFLOW_DOC_ID,
} from "@/lib/project-management-indent-workflow";

type IndentItem = {
  icon: LucideIcon;
  text: string;
  href: string;
  description: string;
  disabled?: boolean;
  gradient?: string;
};

export default function IndentHubPage() {
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { context, isResolving, notFound, projectName } = useProjectManagementIndentContext(mappingId);
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

  const canViewModule = safeCan("View") || safeCan("View Module");
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
        const workflowSnapshot = await getDoc(doc(db, "workflows", INDENT_WORKFLOW_DOC_ID));
        const rawSteps = workflowSnapshot.exists()
          ? ((workflowSnapshot.data()?.steps as WorkflowStep[] | undefined) ?? [])
          : DEFAULT_INDENT_STEPS;
        const nextSteps = (Array.isArray(rawSteps) ? rawSteps : [])
          .filter((step) => step && step.name)
          .map((step, index) => ({ ...step, id: String(step.id || index + 1) }));
        if (cancelled) return;
        setSteps(nextSteps);

        if (globalProjectId) {
          const indentSnapshot = await getDocs(
            collection(db, "projects", globalProjectId, INDENT_COLLECTION),
          );
          if (cancelled) return;
          const counts: Record<number, number> = {};
          let drafts = 0;
          indentSnapshot.docs.forEach((indentDoc) => {
            const data = indentDoc.data() as {
              status?: string;
              workflowEnrolled?: boolean;
              currentStepIndex?: number;
            };
            if (data.status === "Draft") drafts += 1;
            if (data.status !== "Submitted" || !data.workflowEnrolled) return;
            const index = data.currentStepIndex ?? -1;
            if (index < 0) return;
            counts[index] = (counts[index] ?? 0) + 1;
          });
          setOpenCountByStep(counts);
          setDraftCount(drafts);
        }
      } catch (error) {
        console.error("Failed to load the indent workflow:", error);
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

  const indentItems: IndentItem[] = useMemo(() => {
    if (authIsLoading || isWorkflowLoading) return [];

    const head: IndentItem[] = [
      {
        icon: FilePlus2,
        text: "New Indent",
        href: context.indentHref("new"),
        description: "Raise a multi-item indent against BOQ items.",
        disabled: !canAdd || !mappingId,
      },
      {
        icon: ListChecks,
        text: "Indent Register",
        href: context.indentHref("register"),
        description: draftCount
          ? `${draftCount} draft${draftCount === 1 ? "" : "s"} awaiting submission.`
          : "Every indent raised on this project.",
        disabled: !canViewModule || !mappingId,
      },
    ];

    const stageItems: IndentItem[] = steps.map((step, index) => {
      const count = openCountByStep[index] ?? 0;
      return {
        icon: GitMerge,
        text: step.name,
        href: context.indentHref(`stage/${step.id}`),
        description: count
          ? `${count} indent${count === 1 ? "" : "s"} awaiting ${step.name.toLowerCase()}.`
          : `Tasks for the ${step.name} stage.`,
        disabled: !canViewModule || !mappingId,
      };
    });

    const tail: IndentItem[] = [
      {
        icon: Settings,
        text: "Settings",
        href: context.indentHref("settings"),
        description: "Configure the indent approval workflow.",
        disabled: !canViewSettings || !mappingId,
        gradient: INDENT_SETTINGS_GRADIENT,
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
    return <IndentCardGridLoadingState tiles={5} />;
  }

  if (!canViewModule) {
    return <IndentAccessDenied description="You do not have permission to access the Indent module." />;
  }

  if (notFound) {
    return (
      <IndentProjectNotFound
        description="Return to Project Management and choose a project before opening Indent."
        href="/project-management"
      />
    );
  }

  return (
    <IndentPageShell>
      <IndentPageHeader
        title="Indent"
        subtitle={
          projectName
            ? `Raise material indents for ${projectName}, work each stage, and review the register.`
            : "Raise material indents, work each stage, and review the register."
        }
        icon={ListChecks}
        backHref={context.parentHref}
        gradient={INDENT_GRADIENT}
      />

      <IndentNav context={context} active="hub" />

      {workflowError ? (
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>Workflow unavailable</CardTitle>
            <CardDescription>{workflowError}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <IndentNavCardGrid>
          {indentItems.map((item) => (
            <IndentNavCard
              key={`${item.text}-${item.href}`}
              title={item.text}
              description={item.description}
              href={item.href}
              icon={item.icon}
              gradient={item.gradient ?? INDENT_GRADIENT}
              disabled={item.href === "#" || item.disabled}
            />
          ))}
        </IndentNavCardGrid>
      )}
    </IndentPageShell>
  );
}
