"use client";

/**
 * Project Management Settings hub. This file checks the permission and builds the back arrow; the
 * screen itself is `PmSettingsHubView`.
 */

import { ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useBackNavigation } from "@/hooks/use-back-navigation";
import { PmSettingsHubView } from "@/components/project-management/settings-hub-view";

const SETTINGS_PERMISSION = "Project Management.Settings";

export default function ProjectManagementSettingsPage() {
  const { can, isLoading } = useAuthorization();
  const back = useBackNavigation("/project-management", { fallbackLabel: "Back to Project Management" });

  if (isLoading) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] space-y-4 p-4 sm:p-6">
        <Skeleton className="h-36 w-full rounded-3xl" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-52 rounded-[22px]" />
          ))}
        </div>
      </main>
    );
  }

  if (!can("View", SETTINGS_PERMISSION)) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <PageHeader title="Project Management Settings" />
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              You do not have permission to access Project Management settings.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-8">
            <ShieldAlert className="h-16 w-16 text-destructive" />
          </CardContent>
        </Card>
      </main>
    );
  }

  return <PmSettingsHubView back={back} />;
}
