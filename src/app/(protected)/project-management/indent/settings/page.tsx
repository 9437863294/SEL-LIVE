"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { GitMerge, Settings2 } from "lucide-react";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useProjectManagementIndentContext } from "@/components/indent/use-indent-host-context";
import { IndentNav } from "@/components/indent/indent-nav";
import {
  INDENT_SETTINGS_GRADIENT,
  IndentAccessDenied,
  IndentCardGridLoadingState,
  IndentNavCard,
  IndentNavCardGrid,
  IndentPageHeader,
  IndentPageShell,
  IndentProjectNotFound,
} from "@/components/indent/indent-page-shell";

export default function IndentSettingsPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { context, isResolving, notFound, projectName } = useProjectManagementIndentContext(mappingId);
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
    return <IndentCardGridLoadingState tiles={3} />;
  }

  if (!canViewPage) {
    return <IndentAccessDenied description="You do not have permission to access these settings." />;
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
        title="Indent Settings"
        subtitle={
          projectName
            ? `Configure how indents are approved for ${projectName}.`
            : "Configure how indents are approved on this project."
        }
        icon={Settings2}
        backHref={context.indentHref()}
        backLabel="Back to Indent"
        gradient={INDENT_SETTINGS_GRADIENT}
      />

      <IndentNav context={context} active="settings" />

      <IndentNavCardGrid>
        <IndentNavCard
          title="Workflow Configuration"
          description="Set up the approval stages an indent must pass."
          href={context.indentHref("settings/workflow-configuration")}
          icon={GitMerge}
          gradient={INDENT_SETTINGS_GRADIENT}
        />
      </IndentNavCardGrid>
    </IndentPageShell>
  );
}
