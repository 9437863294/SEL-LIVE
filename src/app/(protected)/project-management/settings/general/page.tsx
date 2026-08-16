"use client";

import Link from "next/link";
import { ArrowLeft, Settings2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthorization } from "@/hooks/useAuthorization";

const SETTINGS_PERMISSION = "Project Management.Settings";

export default function ProjectManagementGeneralSettingsPage() {
  const { can, isLoading } = useAuthorization();

  if (isLoading) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <Skeleton className="h-9 w-64" />
      </main>
    );
  }

  if (!can("View", SETTINGS_PERMISSION)) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <h1 className="mb-6 text-2xl font-bold sm:text-3xl">General Settings</h1>
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

  return (
    <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
      <div className="mb-6 flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/project-management/settings" aria-label="Back to Settings">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-500 to-slate-700 shadow-sm">
          <Settings2 className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">General Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            General configuration fields can be added here as requirements are defined.
          </p>
        </div>
      </div>

      <Card className="border-dashed">
        <CardContent className="flex min-h-48 flex-col items-center justify-center gap-3 text-center">
          <Settings2 className="h-10 w-10 text-muted-foreground" />
          <div>
            <p className="font-medium">Ready for configuration</p>
            <p className="text-sm text-muted-foreground">
              Define the general project settings you need and they can be added here.
            </p>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
