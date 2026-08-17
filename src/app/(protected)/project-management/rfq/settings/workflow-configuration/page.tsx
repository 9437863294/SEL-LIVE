"use client";

/**
 * RFQ Award Workflow Configuration — the stages an award has to pass before a purchase order is
 * raised.
 *
 * The editor is shared with Survey and Indent (see WorkflowConfigurationEditor); this screen
 * supplies the guards, the header, and the copy describing what this particular workflow gates.
 */

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { GitMerge } from "lucide-react";
import { useAuthorization } from "@/hooks/useAuthorization";
import {
  DEFAULT_RFQ_AWARD_STEPS,
  RFQ_AWARD_ACTIONS,
  RFQ_AWARD_WORKFLOW_DOC_ID,
} from "@/lib/project-management-rfq-workflow";
import { useProjectManagementRfqContext } from "@/components/rfq/use-rfq-host-context";
import { RfqNav } from "@/components/rfq/rfq-nav";
import {
  RFQ_SETTINGS_GRADIENT,
  RfqAccessDenied,
  RfqLoadingState,
  RfqPageHeader,
  RfqPageShell,
  RfqProjectNotFound,
} from "@/components/rfq/rfq-page-shell";
import { WorkflowConfigurationEditor } from "@/components/workflow/workflow-configuration-editor";

export default function RfqAwardWorkflowConfigurationPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { context, isResolving, notFound, projectName } = useProjectManagementRfqContext(mappingId);

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
    return <RfqLoadingState />;
  }

  if (!canViewPage) {
    return <RfqAccessDenied description="You do not have permission to view these settings." />;
  }

  if (notFound) {
    return (
      <RfqProjectNotFound
        description="This project could not be resolved. Choose a project from Project Management to open its RFQ settings."
        href="/project-management"
      />
    );
  }

  return (
    <RfqPageShell>
      <RfqPageHeader
        title="Award Workflow"
        subtitle="Stages an award passes before a purchase order is raised."
        icon={GitMerge}
        backHref={context.rfqHref("settings")}
        backLabel="Back to RFQ Settings"
        gradient={RFQ_SETTINGS_GRADIENT}
      />

      <RfqNav context={context} active="settings" />

      <WorkflowConfigurationEditor
        workflowDocId={RFQ_AWARD_WORKFLOW_DOC_ID}
        defaultSteps={DEFAULT_RFQ_AWARD_STEPS}
        allowedActions={RFQ_AWARD_ACTIONS}
        canEdit={canEditPage}
        activityModule={context.activityModule}
        activityAction="Update RFQ Award Workflow"
        projectName={projectName}
        subjectNoun="award"
        behaviourDescription="Confirming awards on an RFQ opens an approval request per vendor, which enters at the first stage. Each Approve moves it on; approving the last stage creates the purchase order. Reject closes the request, and Needs Correction sends the recommendation back to the buyer. With no stages configured, confirming awards creates the purchase order immediately. RFQs raised before this workflow existed always award directly, so nothing mid-negotiation is blocked."
        emptyStateDescription="Confirming awards creates the purchase order immediately. Add a stage to require approval of the vendor and rate first."
      />
    </RfqPageShell>
  );
}
