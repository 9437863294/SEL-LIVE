"use client";

/**
 * Daily Progress settings. The page only resolves the project and the permissions; the settings
 * themselves — form, checks, save — are `DprSettingsView`, which takes everything as props.
 */

import { useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { DPR_PERMISSION_RESOURCE } from "@/lib/project-management-dpr";
import { useDprData } from "@/components/project-management/dpr/use-dpr-data";
import {
  DprAccessDenied,
  DprLoadingState,
  DprProjectNotFound,
} from "@/components/project-management/dpr/dpr-shell";
import { DprSettingsView } from "@/components/project-management/dpr/settings-view";

export default function DprSettingsPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canView = !isAuthLoading && can("View", DPR_PERMISSION_RESOURCE);
  const canEdit = !isAuthLoading && can("Edit Settings", DPR_PERMISSION_RESOURCE);

  const data = useDprData(mappingId, canView);

  if (isAuthLoading || data.isResolving) return <DprLoadingState blocks={2} />;
  if (!canView) {
    return <DprAccessDenied description="You do not have permission to view daily progress." />;
  }
  if (data.notFound) {
    return (
      <DprProjectNotFound
        description="Return to Project Management and choose a project before opening these settings."
        href="/project-management"
      />
    );
  }

  return <DprSettingsView data={data} mappingId={mappingId} user={user} canEditSettings={canEdit} />;
}
