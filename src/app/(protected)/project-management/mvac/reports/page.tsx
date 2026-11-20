"use client";
export const dynamic = "force-dynamic";

/**
 * MVAC's reports hub.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BarChart3, BarChart4 } from "lucide-react";
import { useAuthorization } from "@/hooks/useAuthorization";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { useSupplyProject } from "@/components/project-management/supply-document-screens";
import {
  MVAC_GRADIENT,
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

export default function MvacReportsPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { projectName, isResolving, notFound } = useSupplyProject(mappingId);
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const canViewPage = useMemo(() => {
    if (isAuthLoading) return false;
    try {
      return can("View Reports", PM_MVAC_PERMISSION_RESOURCE);
    } catch {
      return false;
    }
  }, [isAuthLoading, can]);

  if (isAuthLoading || isResolving) return <MvacLoadingState />;

  if (!canViewPage) {
    return <MvacAccessDenied description="You do not have permission to view MVAC reports." />;
  }

  if (notFound) {
    return (
      <MvacProjectNotFound description="This link does not identify a mapped Project Management project, so MVAC reports cannot be opened." />
    );
  }

  return (
    <MvacPageShell>
      <PageHeader
        title="MVAC Reports"
        description={`Joint acceptance status and quantity summaries${projectName ? ` for ${projectName}` : ""}`}
        icon={BarChart3}
        backHref={mvacTabHref("", mappingId)}
        backLabel="Back to MVAC"
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Link href={mvacTabHref("reports/mvac-summary", mappingId)} className="group no-underline">
          <Card className="h-full overflow-hidden border-border/60 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
            <div className={cn("h-1 w-full bg-gradient-to-r", MVAC_GRADIENT)} />
            <CardContent className="flex items-center gap-2.5 p-3">
              <div
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br shadow-sm",
                  MVAC_GRADIENT,
                )}
              >
                <BarChart4 className="h-4 w-4 text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold leading-tight">MVAC Summary</p>
                <p className="truncate text-xs text-muted-foreground">
                  Every certificate, what it holds, and where it has got to.
                </p>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>
    </MvacPageShell>
  );
}
