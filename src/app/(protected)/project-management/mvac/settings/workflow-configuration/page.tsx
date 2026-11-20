"use client";

/**
 * MVAC Workflow Configuration — the desks a joint acceptance certificate passes before it is
 * signed off.
 *
 * The editor is the one Indent, RFQ, PO, MC, Inspections and Survey already use; this screen
 * supplies the guards, the header, and the copy describing what this particular workflow gates. It
 * writes the same `workflows/{id}.steps` shape, so assignment resolution and TAT/deadline
 * calculation reuse `workflow-utils` unchanged.
 *
 * It edits `pm-mvac-workflow`, not Billing Recon's `mvac-workflow` — see the note in
 * `project-management-mvac-module.ts` for why those two stay apart.
 */

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { GitMerge } from "lucide-react";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useSupplyProject } from "@/components/project-management/supply-document-screens";
import {
  MvacAccessDenied,
  MvacLoadingState,
  MvacPageShell,
  MvacProjectNotFound,
} from "@/components/mvac/mvac-page-shell";
import { WorkflowConfigurationEditor } from "@/components/workflow/workflow-configuration-editor";
import { PageHeader } from "@/components/shared/page-header";
import {
  PM_MVAC_DEFAULT_STEPS,
  PM_MVAC_PERMISSION_RESOURCE,
  PM_MVAC_WORKFLOW_ACTIONS,
  PM_MVAC_WORKFLOW_ID,
  mvacTabHref,
} from "@/lib/project-management-mvac-module";

export default function MvacWorkflowConfigurationPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { projectName, isResolving, notFound } = useSupplyProject(mappingId);

  const safeCan = useMemo(
    () => (action: string) => {
      if (isAuthLoading) return false;
      try {
        return can(action, PM_MVAC_PERMISSION_RESOURCE);
      } catch {
        return false;
      }
    },
    [isAuthLoading, can],
  );

  const canViewPage = safeCan("View Settings");
  const canEditPage = safeCan("Edit Settings");

  if (isAuthLoading || isResolving) return <MvacLoadingState />;

  if (!canViewPage) {
    return <MvacAccessDenied description="You do not have permission to view these settings." />;
  }

  if (notFound) {
    return (
      <MvacProjectNotFound description="This project could not be resolved. Choose a project from the Supply Chain workspace to open its MVAC settings." />
    );
  }

  return (
    <MvacPageShell>
      <PageHeader
        title="MVAC Workflow"
        description="The desks a joint acceptance certificate passes before it is signed off."
        icon={GitMerge}
        backHref={mvacTabHref("settings", mappingId)}
        backLabel="Back to MVAC settings"
      />

      <WorkflowConfigurationEditor
        workflowDocId={PM_MVAC_WORKFLOW_ID}
        defaultSteps={PM_MVAC_DEFAULT_STEPS}
        allowedActions={PM_MVAC_WORKFLOW_ACTIONS}
        canEdit={canEditPage}
        activityModule="Project Management"
        activityAction="Update MVAC Workflow"
        projectName={projectName}
        subjectNoun="certificate"
        behaviourDescription="A certificate enters at the first stage when it is raised. Each Approve moves it on; approving the last stage closes the run. Record Acceptance opens the register's decision, where accepted and rejected quantity per line are written. Reject takes the certificate off every desk but does not release the quantity it holds — cancelling it on the register does that. With no stages configured, a certificate is raised and signed off on the register, as MVAC has always worked."
        emptyStateDescription="Certificates are raised and signed off on the register. Add a stage to route them for verification first."
      />
    </MvacPageShell>
  );
}
