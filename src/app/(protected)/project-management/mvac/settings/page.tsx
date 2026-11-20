"use client";

/**
 * MVAC's settings hub.
 *
 * One card per setting this module owns, and the module keeps one Settings entry in its sidebar —
 * the cards here are not listed there as well.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { GitMerge, Settings2 } from "lucide-react";
import { useAuthorization } from "@/hooks/useAuthorization";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { useSupplyProject } from "@/components/project-management/supply-document-screens";
import {
  MVAC_SETTINGS_GRADIENT,
  MvacAccessDenied,
  MvacLoadingState,
  MvacPageShell,
  MvacProjectNotFound,
} from "@/components/mvac/mvac-page-shell";
import {
  PM_MVAC_PERMISSION_RESOURCE,
  mvacTabHref,
} from "@/lib/project-management-mvac-module";
import { cn } from "@/lib/utils";

export default function MvacSettingsPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { projectName, isResolving, notFound } = useSupplyProject(mappingId);
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const canViewPage = useMemo(() => {
    if (isAuthLoading) return false;
    try {
      return can("View Settings", PM_MVAC_PERMISSION_RESOURCE);
    } catch {
      return false;
    }
  }, [isAuthLoading, can]);

  if (isAuthLoading || isResolving) return <MvacLoadingState />;

  if (!canViewPage) {
    return <MvacAccessDenied description="You do not have permission to view MVAC settings." />;
  }

  if (notFound) {
    return (
      <MvacProjectNotFound description="This project could not be resolved. Choose a project from the Supply Chain workspace to open its MVAC settings." />
    );
  }

  return (
    <MvacPageShell>
      <PageHeader
        title="MVAC Settings"
        description={
          projectName
            ? `How joint acceptance behaves on ${projectName}.`
            : "How joint acceptance behaves on this project."
        }
        icon={Settings2}
        backHref={mvacTabHref("", mappingId)}
        backLabel="Back to MVAC"
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Link
          href={mvacTabHref("settings/workflow-configuration", mappingId)}
          className="group no-underline"
        >
          <Card className="h-full overflow-hidden border-border/60 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
            <div className={cn("h-1 w-full bg-gradient-to-r", MVAC_SETTINGS_GRADIENT)} />
            <CardContent className="flex items-center gap-2.5 p-3">
              <div
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br shadow-sm",
                  MVAC_SETTINGS_GRADIENT,
                )}
              >
                <GitMerge className="h-4 w-4 text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold leading-tight">Workflow Configuration</p>
                <p className="truncate text-xs text-muted-foreground">
                  The desks a certificate passes before it is signed off.
                </p>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>
    </MvacPageShell>
  );
}
