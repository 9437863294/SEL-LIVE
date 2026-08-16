"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, HardHat, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAuthorization } from "@/hooks/useAuthorization";

const PERMISSION_RESOURCE = "Project Management.Erection";

export default function ErectionPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { can, isLoading } = useAuthorization();
  const canView = can("View", PERMISSION_RESOURCE) || can("View", "Project Management.BOQ");

  if (isLoading) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <div className="h-9 w-64 animate-pulse rounded-md bg-muted" />
      </main>
    );
  }

  if (!canView) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to view this module.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-8">
            <ShieldAlert className="h-16 w-16 text-destructive" />
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!mappingId) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Select a project first</CardTitle>
            <CardDescription>Return to Project Management and choose a project before opening Erection.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild><Link href="/project-management">Select Project</Link></Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100dvh-4rem)] space-y-5 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/project-management?project=${encodeURIComponent(mappingId)}`} aria-label="Back to Project Management">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-red-600 shadow-sm">
          <HardHat className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Erection</h1>
          <p className="text-sm text-muted-foreground">Erection scope tracking for this project.</p>
        </div>
      </div>

      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
          <HardHat className="h-10 w-10 text-muted-foreground" />
          <div>
            <p className="font-medium">Coming soon</p>
            <p className="text-sm text-muted-foreground">This section is being built out.</p>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
