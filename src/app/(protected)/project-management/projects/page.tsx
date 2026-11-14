"use client";

/**
 * Project register — every Project Management project in one place, with the execution context the
 * wizard captures (code, type, scope, manager, schedule, lifecycle).
 *
 * Deliberately does NOT compute per-project progress. Progress is derived from the operational
 * registers (see calculateProjectControlTower), which means reading every register for a project;
 * doing that for each row would multiply the cost of this page by the number of projects. Progress
 * therefore lives on the per-project Command Center, where it is computed once for the project
 * actually being looked at. This matches the scaling note already recorded in
 * docs/project-management-readiness.md.
 *
 * This file is the container: permissions, the two Firestore reads and the back arrow. The screen
 * itself is `ProjectsRegisterView`, which takes all of it as props.
 */

import { useCallback, useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Project } from "@/lib/types";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useBackNavigation } from "@/hooks/use-back-navigation";
import { useToast } from "@/hooks/use-toast";
import { PM_PROJECT_COLLECTION, type PmProject } from "@/lib/project-management-projects";
import {
  ProjectsRegisterView,
  type ProjectsRegisterGlobal,
} from "@/components/project-management/projects-register-view";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const MODULE_NAME = "Project Management";

export default function ProjectRegisterPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { toast } = useToast();
  const back = useBackNavigation("/project-management", { fallbackLabel: "Back to Project Management" });
  const canView = can("View Module", MODULE_NAME) || can("View", `${MODULE_NAME}.BOQ`);
  const canManage = can("View", `${MODULE_NAME}.Project Mappings`);
  const canOpenSettings = can("View", `${MODULE_NAME}.Settings`);

  const [projects, setProjects] = useState<PmProject[]>([]);
  const [globalProjects, setGlobalProjects] = useState<Map<string, ProjectsRegisterGlobal>>(new Map());
  const [isLoading, setIsLoading] = useState(true);

  // `isLoading` starts true and this runs once, so it only ever clears it.
  const loadData = useCallback(async () => {
    try {
      const [pmSnapshot, globalSnapshot] = await Promise.all([
        getDocs(collection(db, PM_PROJECT_COLLECTION)),
        // The global project carries the client, contract value and location — this module reads
        // them but never writes them (that master is shared by several other modules).
        getDocs(collection(db, "projects")),
      ]);
      setProjects(
        pmSnapshot.docs
          .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }) as PmProject)
          .sort((a, b) => a.projectName.localeCompare(b.projectName)),
      );
      setGlobalProjects(
        new Map(
          globalSnapshot.docs.map((docSnapshot) => [
            docSnapshot.id,
            { id: docSnapshot.id, ...docSnapshot.data() } as Project,
          ]),
        ),
      );
    } catch (error) {
      console.error("Failed to load the project register:", error);
      toast({ title: "Unable to load projects", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  // Reading Firestore once is the "sync with an external system" case effects are for; the state is
  // set after the reads resolve. Without access nothing is read, and the skeleton below only shows
  // while a permitted read runs.
  useEffect(() => {
    if (isAuthLoading || !canView) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData();
  }, [canView, isAuthLoading, loadData]);

  if (isAuthLoading || (isLoading && canView)) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] space-y-4 p-4 sm:p-6">
        <Skeleton className="h-28 w-full rounded-3xl" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-20 rounded-[18px]" />
          ))}
        </div>
        <Skeleton className="h-96 w-full rounded-2xl" />
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

  return (
    <ProjectsRegisterView
      projects={projects}
      globalProjects={globalProjects}
      canManage={canManage}
      canOpenSettings={canOpenSettings}
      back={back}
    />
  );
}
