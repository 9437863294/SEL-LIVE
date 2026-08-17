"use client";

/**
 * PO Issue Workflow Configuration — the stages a purchase order has to pass before it is issued.
 *
 * The editor is shared with Survey, Indent and RFQ (see WorkflowConfigurationEditor); this screen
 * supplies the guards, the header, and the copy describing what this particular workflow gates.
 */

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { GitMerge } from "lucide-react";
import { useAuthorization } from "@/hooks/useAuthorization";
import {
  DEFAULT_PO_ISSUE_STEPS,
  PO_ISSUE_ACTIONS,
  PO_ISSUE_WORKFLOW_DOC_ID,
} from "@/lib/project-management-po-workflow";
import { useProjectManagementPoContext } from "@/components/po/use-po-host-context";
import { PoNav } from "@/components/po/po-nav";
import {
  PO_SETTINGS_GRADIENT,
  PoAccessDenied,
  PoLoadingState,
  PoPageHeader,
  PoPageShell,
  PoProjectNotFound,
} from "@/components/po/po-page-shell";
import { WorkflowConfigurationEditor } from "@/components/workflow/workflow-configuration-editor";

export default function PoIssueWorkflowConfigurationPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { context, isResolving, notFound, projectName } = useProjectManagementPoContext(mappingId);

  const safeCan = useMemo(
    () => (action: string) => {
      if (isAuthLoading) return false;
      try {
        return can(action, context.permissionResource);
      } catch {
        return false;
      }
    },
    [isAuthLoading, can, context.permissionResource],
  );

  const canViewPage = safeCan("View Settings");
  const canEditPage = safeCan("Edit Settings");

  if (isAuthLoading || isResolving) {
    return <PoLoadingState />;
  }

  if (!canViewPage) {
    return <PoAccessDenied description="You do not have permission to view these settings." />;
  }

  if (notFound) {
    return (
      <PoProjectNotFound
        description="This project could not be resolved. Choose a project from Project Management to open its purchase order settings."
        href="/project-management"
      />
    );
  }

  return (
    <PoPageShell>
      <PoPageHeader
        title="Issue Workflow"
        subtitle="Stages a purchase order passes before it is issued to the vendor."
        icon={GitMerge}
        backHref={context.poHref("settings")}
        backLabel="Back to Purchase Order Settings"
        gradient={PO_SETTINGS_GRADIENT}
      />

      <PoNav context={context} active="settings" />

      <WorkflowConfigurationEditor
        workflowDocId={PO_ISSUE_WORKFLOW_DOC_ID}
        defaultSteps={DEFAULT_PO_ISSUE_STEPS}
        allowedActions={PO_ISSUE_ACTIONS}
        canEdit={canEditPage}
        activityModule={context.activityModule}
        activityAction="Update PO Issue Workflow"
        projectName={projectName}
        subjectNoun="purchase order"
        behaviourDescription="Issuing a draft PO opens an approval request that enters at the first stage. Each Approve moves it on; approving the last stage issues the order, which is the point at which its quantities and value count as a commitment against the BOQ. Reject closes the request, and Needs Correction returns the PO to the buyer as an editable draft. Any unresolved flow-down gaps or commitment exceptions travel with the request, so the person accepting them is not the person raising them. With no stages configured, issuing works exactly as it did before. POs raised before this workflow existed always issue directly."
        emptyStateDescription="Purchase orders are issued as soon as someone with the Issue permission says so. Add a stage to require approval first."
      />
    </PoPageShell>
  );
}
