"use client";

/**
 * Survey Workflow Configuration — the stages a surveyed quantity has to pass before it is written
 * onto its BOQ item.
 *
 * The editor itself is shared with Indent (see WorkflowConfigurationEditor); this screen supplies
 * the guards, the header, and the copy describing what this particular workflow gates. Writes the
 * same `workflows/{id}.steps` shape JMC uses, so assignment resolution, TAT/deadline calculation
 * and escalation all reuse workflow-utils unchanged.
 */

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { GitMerge } from "lucide-react";
import { useAuthorization } from "@/hooks/useAuthorization";
import {
  DEFAULT_SURVEY_STEPS,
  SURVEY_ACTIONS,
  SURVEY_WORKFLOW_DOC_ID,
} from "@/lib/project-management-survey-workflow";
import { useProjectManagementSurveyContext } from "@/components/survey/use-survey-host-context";
import { SurveyNav } from "@/components/survey/survey-nav";
import {
  SURVEY_SETTINGS_GRADIENT,
  SurveyAccessDenied,
  SurveyLoadingState,
  SurveyPageHeader,
  SurveyPageShell,
  SurveyProjectNotFound,
} from "@/components/survey/survey-page-shell";
import { WorkflowConfigurationEditor } from "@/components/workflow/workflow-configuration-editor";

export default function SurveyWorkflowConfigurationPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { context, isResolving, notFound, projectName } = useProjectManagementSurveyContext(mappingId);

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
    return <SurveyLoadingState />;
  }

  if (!canViewPage) {
    return <SurveyAccessDenied description="You do not have permission to view these settings." />;
  }

  if (notFound) {
    return (
      <SurveyProjectNotFound
        description="This project could not be resolved. Choose a project from Project Management to open its Survey settings."
        href="/project-management"
      />
    );
  }

  return (
    <SurveyPageShell>
      <SurveyPageHeader
        title="Survey Workflow"
        subtitle="Stages a surveyed quantity passes before it is written onto the BOQ item."
        icon={GitMerge}
        backHref={context.surveyHref("settings")}
        backLabel="Back to Survey Settings"
        gradient={SURVEY_SETTINGS_GRADIENT}
      />

      <SurveyNav context={context} active="settings" />

      <WorkflowConfigurationEditor
        workflowDocId={SURVEY_WORKFLOW_DOC_ID}
        defaultSteps={DEFAULT_SURVEY_STEPS}
        allowedActions={SURVEY_ACTIONS}
        canEdit={canEditPage}
        activityModule={context.activityModule}
        activityAction="Update Survey Workflow"
        projectName={projectName}
        subjectNoun="survey"
        behaviourDescription="A recorded survey enters at the first stage. Each Approve moves it on; approving the last stage certifies the quantity and writes it onto the BOQ item. Reject closes the entry, and Needs Correction returns it to the surveyor. With no stages configured, recording a survey applies it immediately."
        emptyStateDescription="Surveys are applied to the BOQ item as soon as they are recorded. Add a stage to require review first."
      />
    </SurveyPageShell>
  );
}
