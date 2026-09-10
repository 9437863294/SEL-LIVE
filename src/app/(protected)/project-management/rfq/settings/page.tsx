"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { GitMerge, Settings2 } from "lucide-react";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useProjectManagementRfqContext } from "@/components/rfq/use-rfq-host-context";
import {
  RFQ_SETTINGS_GRADIENT,
  RfqAccessDenied,
  RfqCardGridLoadingState,
  RfqNavCard,
  RfqNavCardGrid,
  RfqProjectNotFound,
} from "@/components/rfq/rfq-page-shell";
import {
  PmContent,
  PmShell,
  PmTopbar,
} from "@/components/project-management/pm-shell";

export default function RfqSettingsPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { context, isResolving, notFound, projectName } = useProjectManagementRfqContext(mappingId);
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
    return <RfqCardGridLoadingState tiles={3} />;
  }

  if (!canViewPage) {
    return <RfqAccessDenied description="You do not have permission to access these settings." />;
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
    <PmShell>
      <PmTopbar
        title="RFQ Settings"
        breadcrumbs={[
          ...(projectName
            ? [{ label: projectName, href: `/project-management?project=${encodeURIComponent(mappingId)}` }]
            : []),
          { label: "RFQ", href: context.rfqHref() },
        ]}
        backHref={context.rfqHref()}
        backLabel="Back to RFQ"
      />

      <PmContent>
        <RfqNavCardGrid>
          <RfqNavCard
            title="Award Workflow"
            description="Set up the approval stages an award must pass before a PO is raised."
            href={context.rfqHref("settings/workflow-configuration")}
            icon={GitMerge}
            gradient={RFQ_SETTINGS_GRADIENT}
          />
        </RfqNavCardGrid>
      </PmContent>
    </PmShell>
  );
}
