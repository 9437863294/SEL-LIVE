"use client";

/**
 * Project Management's module-level reporting screen.
 *
 * The control tower used to sit directly on the module hub, which meant the hub was both a
 * launcher and a dashboard — every visit paid for the tower's fan-out of Firestore reads just to
 * click through to BOQ. It lives here now, so the hub stays a launcher and the reads only happen
 * when somebody actually wants the numbers.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, FileBarChart2, ShieldAlert } from "lucide-react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthorization } from "@/hooks/useAuthorization";
import ProjectControlTower from "@/components/project-management/project-control-tower";

const MODULE_NAME = "Project Management";
const PROJECTS_COLLECTION = "projectManagementProjects";

type ProjectMapping = {
  id: string;
  projectName: string;
  globalProjectId: string;
  globalProjectName: string;
  endDate?: string;
  status: "Active" | "Inactive";
};

export default function ProjectManagementReportsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const [projects, setProjects] = useState<ProjectMapping[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);

  const canViewModule = can("View Module", MODULE_NAME);
  const canViewBoq = can("View", `${MODULE_NAME}.BOQ`);
  // The tower reads across BOQ, MDL, procurement and the supply gates, so it is gated on the same
  // permission the hub used before it moved here.
  const canViewReports = canViewModule && canViewBoq;
  const selectedProjectId = searchParams?.get("project") ?? "";

  useEffect(() => {
    if (isAuthLoading) return;
    if (!canViewReports) {
      setIsLoadingProjects(false);
      return;
    }

    const loadProjects = async () => {
      setIsLoadingProjects(true);
      try {
        const snapshot = await getDocs(collection(db, PROJECTS_COLLECTION));
        setProjects(
          snapshot.docs
            .map((projectDoc) => ({ id: projectDoc.id, ...projectDoc.data() }) as ProjectMapping)
            .filter((project) => project.status === "Active")
            .sort((a, b) => a.projectName.localeCompare(b.projectName)),
        );
      } catch (error) {
        console.error("Failed to load Project Management projects:", error);
        setProjects([]);
      } finally {
        setIsLoadingProjects(false);
      }
    };

    void loadProjects();
  }, [canViewReports, isAuthLoading]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

  const handleProjectChange = (projectId: string) => {
    router.replace(`/project-management/reports?project=${encodeURIComponent(projectId)}`);
  };

  if (isAuthLoading || isLoadingProjects) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] space-y-5 p-4 sm:p-6">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-80 w-full rounded-xl" />
      </main>
    );
  }

  if (!canViewReports) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to view Project Management reports.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-8">
            <ShieldAlert className="h-16 w-16 text-destructive" />
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100dvh-4rem)] space-y-5 p-4 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link
              href={`/project-management${selectedProjectId ? `?project=${encodeURIComponent(selectedProjectId)}` : ""}`}
              aria-label="Back to Project Management"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-sm">
            <FileBarChart2 className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Reports</h1>
            <p className="text-sm text-muted-foreground">
              Commercial, engineering, procurement and site-control indicators across the project.
            </p>
          </div>
        </div>

        {projects.length > 0 && (
          <Select value={selectedProject?.id ?? ""} onValueChange={handleProjectChange}>
            <SelectTrigger className="w-full sm:w-64">
              <SelectValue placeholder="Select project..." />
            </SelectTrigger>
            <SelectContent>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.projectName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {selectedProject ? (
        <ProjectControlTower mapping={selectedProject} />
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <FileBarChart2 className="h-10 w-10 text-muted-foreground" />
            <div>
              <p className="font-medium">Select a project</p>
              <p className="text-sm text-muted-foreground">
                {projects.length
                  ? "Choose a project above to see its control tower."
                  : "No active projects yet."}
              </p>
            </div>
            {!projects.length && (
              <Button variant="outline" asChild>
                <Link href="/project-management/settings/projects">Create a project</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </main>
  );
}
