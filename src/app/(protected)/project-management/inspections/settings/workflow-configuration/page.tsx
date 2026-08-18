"use client";

/**
 * Inspection Result Workflow Configuration — the stages a passing result has to pass before it is
 * recorded and the MDCC gate opens.
 *
 * The editor is shared with Survey, Indent, RFQ, Purchase Orders and Manufacturing Clearance (see
 * WorkflowConfigurationEditor); this screen supplies the guards, the header, and the copy describing
 * what this particular workflow gates.
 */

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { GitMerge } from "lucide-react";
import { useAuthorization } from "@/hooks/useAuthorization";
import {
  DEFAULT_INSPECTION_RESULT_STEPS,
  INSPECTION_APPROVAL_ACTIONS,
  INSPECTION_RESULT_WORKFLOW_DOC_ID,
} from "@/lib/project-management-inspection-workflow";
import { useProjectManagementInspectionContext } from "@/components/inspection/use-inspection-host-context";
import { InspectionNav } from "@/components/inspection/inspection-nav";
import {
  INSPECTION_SETTINGS_GRADIENT,
  InspectionAccessDenied,
  InspectionLoadingState,
  InspectionPageHeader,
  InspectionPageShell,
  InspectionProjectNotFound,
} from "@/components/inspection/inspection-page-shell";
import { WorkflowConfigurationEditor } from "@/components/workflow/workflow-configuration-editor";

export default function InspectionResultWorkflowConfigurationPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { context, isResolving, notFound, projectName } =
    useProjectManagementInspectionContext(mappingId);

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
    return <InspectionLoadingState />;
  }

  if (!canViewPage) {
    return <InspectionAccessDenied description="You do not have permission to view these settings." />;
  }

  if (notFound) {
    return (
      <InspectionProjectNotFound
        description="This project could not be resolved. Choose a project from Project Management to open its inspection settings."
        href="/project-management"
      />
    );
  }

  return (
    <InspectionPageShell>
      <InspectionPageHeader
        title="Result Workflow"
        subtitle="Stages a passing inspection result passes before it is recorded."
        icon={GitMerge}
        backHref={context.inspectionHref("settings")}
        backLabel="Back to Inspection Settings"
        gradient={INSPECTION_SETTINGS_GRADIENT}
      />

      <InspectionNav context={context} active="settings" />

      <WorkflowConfigurationEditor
        workflowDocId={INSPECTION_RESULT_WORKFLOW_DOC_ID}
        defaultSteps={DEFAULT_INSPECTION_RESULT_STEPS}
        allowedActions={INSPECTION_APPROVAL_ACTIONS}
        canEdit={canEditPage}
        activityModule={context.activityModule}
        activityAction="Update Inspection Result Workflow"
        projectName={projectName}
        subjectNoun="result"
        behaviourDescription={
          "Recording Passed or Passed with Punch Items opens an approval request that enters at the first stage. The inspection stays Requested until the last stage approves, at which point the result is written and MDCC becomes available. The whole result — quantities, punch items, serials and the uploaded report — is snapshotted onto the request, so the approver signs off on exactly what the inspector recorded. Recording Failed is not routed: a failure holds the gate shut, and keeping it immediate preserves the re-inspection loop. Rejecting a request refuses the proposed result without recording a failure. With no stages configured, recording works exactly as it did before."
        }
        emptyStateDescription="A passing result is recorded immediately and opens the MDCC gate. Add a stage to require review of the quantities and punch items first."
      />
    </InspectionPageShell>
  );
}
