"use client";

/**
 * Daily Progress's BOQ register — this project's Civil and Erection BOQ lines with the sub-items
 * each is broken into, and theirs under those.
 *
 * The page loads the register and checks access; everything on screen is `DprBoqRegisterView`,
 * which takes all it needs as props (so it can be shown from fabricated data too).
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
import { DprBoqRegisterView } from "@/components/project-management/dpr/boq-register-view";

export default function DprBoqRegisterPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canView = !isAuthLoading && can("View", DPR_PERMISSION_RESOURCE);
  const canAdd = !isAuthLoading && can("Add", DPR_PERMISSION_RESOURCE);
  const canEdit = !isAuthLoading && can("Edit", DPR_PERMISSION_RESOURCE);
  const canDelete = !isAuthLoading && can("Delete", DPR_PERMISSION_RESOURCE);

  const data = useDprData(mappingId, canView);
  const linkedScope = searchParams?.get("scope");

  if (isAuthLoading || data.isResolving) return <DprLoadingState blocks={1} />;
  if (!canView) {
    return <DprAccessDenied description="You do not have permission to view daily progress." />;
  }
  if (data.notFound) {
    return (
      <DprProjectNotFound
        description="Return to Project Management and choose a project before opening the BOQ register."
        href="/project-management"
      />
    );
  }

  return (
    <DprBoqRegisterView
      data={data}
      mappingId={mappingId}
      user={user}
      canAdd={canAdd}
      canEdit={canEdit}
      canDelete={canDelete}
      initialScope={linkedScope === "Erection" ? "Erection" : "Civil"}
    />
  );
}
