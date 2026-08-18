"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { GitMerge, Settings2 } from "lucide-react";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useProjectManagementInspectionContext } from "@/components/inspection/use-inspection-host-context";
import { InspectionNav } from "@/components/inspection/inspection-nav";
import {
  INSPECTION_SETTINGS_GRADIENT,
  InspectionAccessDenied,
  InspectionCardGridLoadingState,
  InspectionNavCard,
  InspectionNavCardGrid,
  InspectionPageHeader,
  InspectionPageShell,
  InspectionProjectNotFound,
} from "@/components/inspection/inspection-page-shell";

export default function InspectionSettingsPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { context, isResolving, notFound, projectName } =
    useProjectManagementInspectionContext(mappingId);
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
    return <InspectionCardGridLoadingState tiles={3} />;
  }

  if (!canViewPage) {
    return <InspectionAccessDenied description="You do not have permission to access these settings." />;
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
        title="Inspection Settings"
        subtitle={
          projectName
            ? `Configure how inspection results are approved on ${projectName}.`
            : "Configure how inspection results are approved."
        }
        icon={Settings2}
        backHref={context.inspectionHref()}
        backLabel="Back to Inspections"
        gradient={INSPECTION_SETTINGS_GRADIENT}
      />

      <InspectionNav context={context} active="settings" />

      <InspectionNavCardGrid>
        <InspectionNavCard
          title="Result Workflow"
          description="Set up the approval stages a passing result must pass before it is recorded."
          href={context.inspectionHref("settings/workflow-configuration")}
          icon={GitMerge}
          gradient={INSPECTION_SETTINGS_GRADIENT}
        />
      </InspectionNavCardGrid>
    </InspectionPageShell>
  );
}
