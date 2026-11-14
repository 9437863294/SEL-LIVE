"use client";

/**
 * Daily Progress log — every sheet filed on this project, newest first.
 *
 * This page only resolves the project, the permissions and the loading states; everything on the
 * screen is `DprLogView` (`components/project-management/dpr/log-view.tsx`), which takes all it
 * needs as props.
 */

import { useSearchParams } from "next/navigation";
import { useAuthorization } from "@/hooks/useAuthorization";
import { DPR_PERMISSION_RESOURCE } from "@/lib/project-management-dpr";
import { useDprData } from "@/components/project-management/dpr/use-dpr-data";
import {
  DprAccessDenied,
  DprLoadingState,
  DprProjectNotFound,
} from "@/components/project-management/dpr/dpr-shell";
import { DprLogView } from "@/components/project-management/dpr/log-view";

export default function DprLogPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canView = !isAuthLoading && can("View", DPR_PERMISSION_RESOURCE);
  const canRecord = !isAuthLoading && can("Add", DPR_PERMISSION_RESOURCE);

  const data = useDprData(mappingId, canView);

  if (isAuthLoading || data.isResolving) return <DprLoadingState blocks={1} />;
  if (!canView) {
    return <DprAccessDenied description="You do not have permission to view daily progress." />;
  }
  if (data.notFound) {
    return (
      <DprProjectNotFound
        description="Return to Project Management and choose a project before opening the log."
        href="/project-management"
      />
    );
  }

  return <DprLogView data={data} mappingId={mappingId} canRecord={canRecord} />;
}
