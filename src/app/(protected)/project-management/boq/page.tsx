"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FolderOpen, ShieldAlert } from "lucide-react";
import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import {
  BoqHub,
  BoqHubSkeleton,
  buildBoqStages,
  type BoqHubFigures,
} from "@/components/project-management/boq-hub";
import { useAuthorization } from "@/hooks/useAuthorization";
import {
  VARIATION_COLLECTION,
  VARIATION_PERMISSION_RESOURCE,
} from "@/lib/project-management-variations";

const MODULE_NAME = "Project Management";
const PROJECTS_COLLECTION = "projectManagementProjects";

type SelectedProject = {
  id: string;
  projectName: string;
  globalProjectId: string;
  globalProjectName: string;
};

/** A count, or `null` when it cannot be read (rules, offline) — the stage then shows no figure. */
async function countOrNull(source: Parameters<typeof getCountFromServer>[0]) {
  try {
    return (await getCountFromServer(source)).data().count;
  } catch (error) {
    console.warn("BOQ hub: a stage figure could not be counted.", error);
    return null;
  }
}

export default function BoqPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canViewBoq = can("View", `${MODULE_NAME}.BOQ`);
  const canImportBoq = can("Import", `${MODULE_NAME}.BOQ`);
  const canAddManualBoq = can("Add Manual", `${MODULE_NAME}.BOQ`);
  const canViewVariations = can("View", VARIATION_PERMISSION_RESOURCE);
  const [selectedProject, setSelectedProject] = useState<SelectedProject | null>(null);
  const [isLoadingProject, setIsLoadingProject] = useState(Boolean(mappingId));
  const [figures, setFigures] = useState<BoqHubFigures>({});

  useEffect(() => {
    if (isAuthLoading || !canViewBoq || !mappingId) {
      setIsLoadingProject(false);
      return;
    }

    const loadProject = async () => {
      setIsLoadingProject(true);
      try {
        const mappingSnapshot = await getDoc(
          doc(db, PROJECTS_COLLECTION, mappingId),
        );
        if (!mappingSnapshot.exists()) {
          setSelectedProject(null);
          return;
        }

        const mapping = mappingSnapshot.data() as Omit<SelectedProject, "id">;
        let globalProjectName = mapping.globalProjectName;
        if (mapping.globalProjectId) {
          const globalSnapshot = await getDoc(doc(db, "projects", mapping.globalProjectId));
          globalProjectName =
            (globalSnapshot.data()?.projectName as string | undefined) ??
            globalProjectName;
        }

        setSelectedProject({
          id: mappingSnapshot.id,
          projectName: mapping.projectName,
          globalProjectId: mapping.globalProjectId,
          globalProjectName,
        });
      } catch (error) {
        console.error("Failed to load the selected Project Management project:", error);
        setSelectedProject(null);
      } finally {
        setIsLoadingProject(false);
      }
    };

    void loadProject();
  }, [canViewBoq, isAuthLoading, mappingId]);

  // The figures beside the stage names. Count queries only — a few reads, not the whole BOQ — and
  // drawn after the cards, so a slow count never holds the page back.
  useEffect(() => {
    if (!selectedProject) return;
    let cancelled = false;

    const loadFigures = async () => {
      const [boqItems, pendingVariations] = await Promise.all([
        selectedProject.globalProjectId
          ? countOrNull(collection(db, "projects", selectedProject.globalProjectId, "boqItems"))
          : Promise.resolve(null),
        canViewVariations
          ? countOrNull(
              query(
                collection(db, VARIATION_COLLECTION),
                where("projectMappingId", "==", selectedProject.id),
                where("status", "==", "Pending"),
              ),
            )
          : Promise.resolve(null),
      ]);
      if (!cancelled) setFigures({ boqItems, pendingVariations });
    };

    void loadFigures();
    return () => {
      cancelled = true;
    };
  }, [canViewVariations, selectedProject]);

  const stages = useMemo(
    () =>
      selectedProject
        ? buildBoqStages(
            selectedProject,
            {
              canImport: canImportBoq,
              canAddManual: canAddManualBoq,
              canViewVariations,
            },
            figures,
          )
        : [],
    [canAddManualBoq, canImportBoq, canViewVariations, figures, selectedProject],
  );

  if (isAuthLoading || isLoadingProject) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <BoqHubSkeleton />
      </main>
    );
  }

  if (!canViewBoq) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <PageHeader title="BOQ" />
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              You do not have permission to access Project Management BOQ.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-8">
            <ShieldAlert className="h-16 w-16 text-destructive" />
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!selectedProject) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <Card className="max-w-xl overflow-hidden border-border/60">
          <div className="h-1 w-full bg-gradient-to-r from-indigo-500 to-cyan-500" />
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-500 shadow-sm">
                <FolderOpen className="h-4 w-4 text-white" />
              </div>
              Select a project first
            </CardTitle>
            <CardDescription>
              Return to Project Management and select a mapped project before opening BOQ.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/project-management">Select Project</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
      <BoqHub project={selectedProject} stages={stages} />
    </main>
  );
}
