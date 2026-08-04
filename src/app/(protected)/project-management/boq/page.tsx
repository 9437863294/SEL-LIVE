"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Calculator,
  ClipboardCheck,
  ClipboardList,
  FolderOpen,
  ListPlus,
  ShieldAlert,
  UploadCloud,
} from "lucide-react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
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
import { cn } from "@/lib/utils";

const MODULE_NAME = "Project Management";
const PROJECTS_COLLECTION = "projectManagementProjects";

type SelectedProject = {
  id: string;
  projectName: string;
  globalProjectId: string;
  globalProjectName: string;
};

const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]+/g, "")
    .replace(/--+/g, "-")
    .replace(/^-+|-+$/g, "");

export default function BoqPage() {
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get("project") ?? "";
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const canViewBoq = can("View", `${MODULE_NAME}.BOQ`);
  const canImportBoq = can("Import", `${MODULE_NAME}.BOQ`);
  const canAddManualBoq = can("Add Manual", `${MODULE_NAME}.BOQ`);
  const [selectedProject, setSelectedProject] = useState<SelectedProject | null>(null);
  const [isLoadingProject, setIsLoadingProject] = useState(Boolean(mappingId));

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

  const boqSections = useMemo(() => {
    if (!selectedProject) return [];
    const projectQuery = `project=${encodeURIComponent(selectedProject.id)}`;
    const globalProjectSlug = slugify(selectedProject.globalProjectName);

    const sections = [
      {
        title: "BOQ Costing",
        description: "Prepare and manage project BOQ costing.",
        href: `/project-management/boq/costing?${projectQuery}`,
        icon: Calculator,
        gradient: "from-emerald-500 to-teal-600",
      },
      {
        title: "Operational BOQ",
        description: "Manage operational quantities and project execution BOQs.",
        href: `/project-management/boq/operational/${globalProjectSlug}?${projectQuery}`,
        icon: ClipboardCheck,
        gradient: "from-violet-500 to-purple-600",
      },
    ];

    if (canAddManualBoq) {
      sections.unshift({
        title: "Add BOQ Items",
        description: "Manually add one or more BOQ items at once.",
        href: `/project-management/boq/add?${projectQuery}`,
        icon: ListPlus,
        gradient: "from-blue-500 to-indigo-600",
      });
    }

    if (canImportBoq) {
      sections.unshift({
        title: "Import BOQ",
        description: "Upload and process a BOQ Excel file.",
        href: `/project-management/boq/import?${projectQuery}`,
        icon: UploadCloud,
        gradient: "from-amber-500 to-orange-600",
      });
    }

    return sections;
  }, [canAddManualBoq, canImportBoq, selectedProject]);

  if (isAuthLoading || isLoadingProject) {
    return (
      <main className="min-h-[calc(100vh-4rem)] space-y-5 p-4 sm:p-6">
        <Skeleton className="h-24 w-full rounded-xl" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      </main>
    );
  }

  if (!canViewBoq) {
    return (
      <main className="min-h-[calc(100vh-4rem)] p-4 sm:p-6">
        <h1 className="mb-6 text-2xl font-bold sm:text-3xl">BOQ</h1>
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
      <main className="min-h-[calc(100vh-4rem)] p-4 sm:p-6">
        <Card className="max-w-xl overflow-hidden border-border/60">
          <div className="h-1 w-full bg-gradient-to-r from-indigo-500 to-cyan-500" />
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
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
    <main className="min-h-[calc(100vh-4rem)] space-y-5 p-4 sm:p-6">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <Card className="relative overflow-hidden border-0 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 text-white shadow-lg">
        <div className="absolute inset-0 opacity-10 bg-[radial-gradient(ellipse_at_top_right,_white_0%,_transparent_60%)]" />
        <CardContent className="relative flex items-center gap-4 p-5">
          <Button variant="ghost" size="icon" asChild className="shrink-0 text-white hover:bg-white/20 hover:text-white">
            <Link
              href={`/project-management?project=${encodeURIComponent(selectedProject.id)}`}
              aria-label="Back to Project Management"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm">
            <ClipboardList className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">BOQ</h1>
            <p className="mt-0.5 text-sm text-emerald-100">
              {selectedProject.projectName} · mapped to {selectedProject.globalProjectName}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── Sections ─────────────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {boqSections.map((section) => {
          const Icon = section.icon;

          return (
            <Link key={section.href} href={section.href} className="group no-underline">
              <Card className="h-full overflow-hidden border-border/60 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
                <div className={cn("h-1 w-full bg-gradient-to-r", section.gradient)} />
                <CardContent className="flex items-center gap-3 p-3.5">
                  <div
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br shadow-sm",
                      section.gradient,
                    )}
                  >
                    <Icon className="h-4 w-4 text-white" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold leading-tight">{section.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {section.description}
                    </p>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1" />
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
