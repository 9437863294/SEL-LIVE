"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { GitMerge, Settings2 } from "lucide-react";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useProjectManagementMcContext } from "@/components/mc/use-mc-host-context";
import { McNav } from "@/components/mc/mc-nav";
import {
  MC_SETTINGS_GRADIENT,
  McAccessDenied,
  McCardGridLoadingState,
  McNavCard,
  McNavCardGrid,
  McPageHeader,
  McPageShell,
  McProjectNotFound,
} from "@/components/mc/mc-page-shell";

export default function ManufacturingClearanceSettingsPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { context, isResolving, notFound, projectName } = useProjectManagementMcContext(mappingId);
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
    return <McCardGridLoadingState tiles={3} />;
  }

  if (!canViewPage) {
    return <McAccessDenied description="You do not have permission to access these settings." />;
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
        title="Manufacturing Clearance Settings"
        subtitle={
          projectName
            ? `Configure how manufacturing clearances are approved on ${projectName}.`
            : "Configure how manufacturing clearances are approved."
        }
        icon={Settings2}
        backHref={context.mcHref()}
        backLabel="Back to Manufacturing Clearance"
        gradient={MC_SETTINGS_GRADIENT}
      />

      <McNav context={context} active="settings" />

      <McNavCardGrid>
        <McNavCard
          title="Clearance Workflow"
          description="Set up the approval stages a clearance must pass before the gate opens."
          href={context.mcHref("settings/workflow-configuration")}
          icon={GitMerge}
          gradient={MC_SETTINGS_GRADIENT}
        />
      </McNavCardGrid>
    </McPageShell>
  );
}
