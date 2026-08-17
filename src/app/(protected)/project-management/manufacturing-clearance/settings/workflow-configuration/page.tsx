"use client";

/**
 * MC Clearance Workflow Configuration — the stages a manufacturing clearance has to pass before the
 * gate opens.
 *
 * The editor is shared with Survey, Indent, RFQ and Purchase Orders (see
 * WorkflowConfigurationEditor); this screen supplies the guards, the header, and the copy describing
 * what this particular workflow gates.
 */

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { GitMerge } from "lucide-react";
import { useAuthorization } from "@/hooks/useAuthorization";
import {
  DEFAULT_MC_CLEARANCE_STEPS,
  MC_APPROVAL_ACTIONS,
  MC_CLEARANCE_WORKFLOW_DOC_ID,
} from "@/lib/project-management-mc-workflow";
import { useProjectManagementMcContext } from "@/components/mc/use-mc-host-context";
import { McNav } from "@/components/mc/mc-nav";
import {
  MC_SETTINGS_GRADIENT,
  McAccessDenied,
  McLoadingState,
  McPageHeader,
  McPageShell,
  McProjectNotFound,
} from "@/components/mc/mc-page-shell";
import { WorkflowConfigurationEditor } from "@/components/workflow/workflow-configuration-editor";

export default function McClearanceWorkflowConfigurationPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { context, isResolving, notFound, projectName } = useProjectManagementMcContext(mappingId);

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
    return <McLoadingState />;
  }

  if (!canViewPage) {
    return <McAccessDenied description="You do not have permission to view these settings." />;
  }

  if (notFound) {
    return (
      <McProjectNotFound
        description="This project could not be resolved. Choose a project from Project Management to open its manufacturing clearance settings."
        href="/project-management"
      />
    );
  }

  return (
    <McPageShell>
      <McPageHeader
        title="Clearance Workflow"
        subtitle="Stages a manufacturing clearance passes before the vendor may begin production."
        icon={GitMerge}
        backHref={context.mcHref("settings")}
        backLabel="Back to Manufacturing Clearance Settings"
        gradient={MC_SETTINGS_GRADIENT}
      />

      <McNav context={context} active="settings" />

      <WorkflowConfigurationEditor
        workflowDocId={MC_CLEARANCE_WORKFLOW_DOC_ID}
        defaultSteps={DEFAULT_MC_CLEARANCE_STEPS}
        allowedActions={MC_APPROVAL_ACTIONS}
        canEdit={canEditPage}
        activityModule={context.activityModule}
        activityAction="Update MC Clearance Workflow"
        projectName={projectName}
        subjectNoun="clearance"
        behaviourDescription="Clearing an item from the register opens an approval request that enters at the first stage. The MC record stays Pending until the last stage approves, at which point it is written as Cleared and inspection can be requested. Rejecting a request refuses the clearance without opening the gate. Rejecting the clearance outright from the register is not routed — it holds the gate shut and needs no sign-off. The existing rule that an MDL-tracked drawing must be approved before clearing still applies before a request can even be raised. With no stages configured, clearing works exactly as it did before."
        emptyStateDescription="Clearing an item opens the gate immediately. Add a stage to require approval before a vendor may begin manufacturing."
      />
    </McPageShell>
  );
}
