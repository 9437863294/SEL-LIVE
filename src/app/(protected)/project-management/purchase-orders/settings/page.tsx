"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { GitMerge, Settings2 } from "lucide-react";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useProjectManagementPoContext } from "@/components/po/use-po-host-context";
import {
  PO_SETTINGS_GRADIENT,
  PoAccessDenied,
  PoCardGridLoadingState,
  PoNavCard,
  PoNavCardGrid,
  PoPageShell,
  PoProjectNotFound,
} from "@/components/po/po-page-shell";
import { PageHeader } from "@/components/shared/page-header";

export default function PurchaseOrderSettingsPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { context, isResolving, notFound, projectName } = useProjectManagementPoContext(mappingId);
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
    return <PoCardGridLoadingState tiles={3} />;
  }

  if (!canViewPage) {
    return <PoAccessDenied description="You do not have permission to access these settings." />;
  }

  if (notFound) {
    return (
      <PoProjectNotFound
        description="This project could not be resolved. Choose a project from Project Management to open its purchase order settings."
        href="/project-management"
      />
    );
  }

  return (
    <PoPageShell>
      <PageHeader
        title="Purchase Order Settings"
        description={
          projectName
            ? `Configure how purchase orders are approved for issue on ${projectName}.`
            : "Configure how purchase orders are approved for issue."
        }
        icon={Settings2}
        backHref={context.poHref()}
        backLabel="Back to Purchase Orders"
      />


      <PoNavCardGrid>
        <PoNavCard
          title="Issue Workflow"
          description="Set up the approval stages a PO must pass before it is issued."
          href={context.poHref("settings/workflow-configuration")}
          icon={GitMerge}
          gradient={PO_SETTINGS_GRADIENT}
        />
      </PoNavCardGrid>
    </PoPageShell>
  );
}
