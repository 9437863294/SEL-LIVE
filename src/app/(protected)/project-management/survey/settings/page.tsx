"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { GitMerge, Settings2 } from "lucide-react";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useProjectManagementSurveyContext } from "@/components/survey/use-survey-host-context";
import { SurveyNav } from "@/components/survey/survey-nav";
import {
  SURVEY_SETTINGS_GRADIENT,
  SurveyAccessDenied,
  SurveyCardGridLoadingState,
  SurveyNavCard,
  SurveyNavCardGrid,
  SurveyPageHeader,
  SurveyPageShell,
  SurveyProjectNotFound,
} from "@/components/survey/survey-page-shell";

export default function SurveySettingsPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { context, isResolving, notFound, projectName } = useProjectManagementSurveyContext(mappingId);
  const { can, isLoading: authLoading } = useAuthorization();

  const canViewPage = useMemo(() => {
    if (authLoading) return false;
    try {
      return can("View Settings", context.permissionResource);
    } catch {
      return false;
    }
  }, [authLoading, can, context.permissionResource]);

  if (authLoading || isResolving) {
    return <SurveyCardGridLoadingState tiles={3} />;
  }

  if (!canViewPage) {
    return <SurveyAccessDenied description="You do not have permission to access these settings." />;
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
        title="Survey Settings"
        subtitle={
          projectName
            ? `Configure how surveyed quantities are reviewed for ${projectName}.`
            : "Configure how surveyed quantities are reviewed on this project."
        }
        icon={Settings2}
        backHref={context.surveyHref()}
        backLabel="Back to Survey"
        gradient={SURVEY_SETTINGS_GRADIENT}
      />

      <SurveyNav context={context} active="settings" />

      <SurveyNavCardGrid>
        <SurveyNavCard
          title="Workflow Configuration"
          description="Set up the approval stages a surveyed quantity must pass."
          href={context.surveyHref("settings/workflow-configuration")}
          icon={GitMerge}
          gradient={SURVEY_SETTINGS_GRADIENT}
        />
      </SurveyNavCardGrid>
    </SurveyPageShell>
  );
}
