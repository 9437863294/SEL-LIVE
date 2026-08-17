"use client";

/**
 * Indent Workflow Configuration — the stages an indent has to pass before its quantities reserve
 * against the BOQ.
 *
 * The editor itself is shared with Survey (see WorkflowConfigurationEditor); this screen supplies
 * the guards, the header, and the copy describing what this particular workflow gates.
 */

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { GitMerge } from "lucide-react";
import { useAuthorization } from "@/hooks/useAuthorization";
import {
  DEFAULT_INDENT_STEPS,
  INDENT_ACTIONS,
  INDENT_WORKFLOW_DOC_ID,
} from "@/lib/project-management-indent-workflow";
import { useProjectManagementIndentContext } from "@/components/indent/use-indent-host-context";
import { IndentNav } from "@/components/indent/indent-nav";
import {
  INDENT_SETTINGS_GRADIENT,
  IndentAccessDenied,
  IndentLoadingState,
  IndentPageHeader,
  IndentPageShell,
  IndentProjectNotFound,
} from "@/components/indent/indent-page-shell";
import { WorkflowConfigurationEditor } from "@/components/workflow/workflow-configuration-editor";

export default function IndentWorkflowConfigurationPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { context, isResolving, notFound, projectName } = useProjectManagementIndentContext(mappingId);

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
    return <IndentLoadingState />;
  }

  if (!canViewPage) {
    return <IndentAccessDenied description="You do not have permission to view these settings." />;
  }

  if (notFound) {
    return (
      <IndentProjectNotFound
        description="This project could not be resolved. Choose a project from Project Management to open its Indent settings."
        href="/project-management"
      />
    );
  }

  return (
    <IndentPageShell>
      <IndentPageHeader
        title="Indent Workflow"
        subtitle="Stages an indent passes before its quantities reserve against the BOQ."
        icon={GitMerge}
        backHref={context.indentHref("settings")}
        backLabel="Back to Indent Settings"
        gradient={INDENT_SETTINGS_GRADIENT}
      />

      <IndentNav context={context} active="settings" />

      <WorkflowConfigurationEditor
        workflowDocId={INDENT_WORKFLOW_DOC_ID}
        defaultSteps={DEFAULT_INDENT_STEPS}
        allowedActions={INDENT_ACTIONS}
        canEdit={canEditPage}
        activityModule={context.activityModule}
        activityAction="Update Indent Workflow"
        projectName={projectName}
        subjectNoun="indent"
        behaviourDescription="A draft indent enters the workflow when it is submitted from the register. Each Approve moves it on; approving the last stage reserves its quantities against the linked BOQ items. Reject closes it, and Needs Correction returns it to the raiser as an editable draft. With no stages configured, submitting approves immediately. Indents raised before this workflow existed keep their reservation and are not pulled into review."
        emptyStateDescription="Submitting a draft approves it immediately. Add a stage to require review before an indent reserves BOQ quantity."
      />
    </IndentPageShell>
  );
}
