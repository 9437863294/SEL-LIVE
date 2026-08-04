"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  Building2,
  ClipboardList,
  FileSearch,
  FolderKanban,
  ListChecks,
  Settings,
  ShieldAlert,
  ShoppingCart,
} from "lucide-react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthorization } from "@/hooks/useAuthorization";
import { cn } from "@/lib/utils";

const MODULE_NAME = "Project Management";
const PROJECTS_COLLECTION = "projectManagementProjects";

type ProjectMapping = {
  id: string;
  projectName: string;
  globalProjectId: string;
  globalProjectName: string;
  globalProjectSite?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  status: "Active" | "Inactive";
};

export default function ProjectManagementPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const [projects, setProjects] = useState<ProjectMapping[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);

  const canViewModule = can("View Module", MODULE_NAME);
  const canViewBoq = can("View", `${MODULE_NAME}.BOQ`);
  const canViewIndent =
    can("View", `${MODULE_NAME}.Indent`) || canViewBoq;
  const canViewRfq = can("View", `${MODULE_NAME}.RFQ`) || canViewBoq;
  const canViewPurchaseOrders =
    can("View", `${MODULE_NAME}.Purchase Orders`) || canViewRfq;
  const canViewSettings = can("View", `${MODULE_NAME}.Settings`);
  const selectedProjectId = searchParams?.get("project") ?? "";

  useEffect(() => {
    if (isAuthLoading) return;
    if (!canViewModule) {
      setIsLoadingProjects(false);
      return;
    }

    const loadProjects = async () => {
      setIsLoadingProjects(true);
      try {
        const snapshot = await getDocs(collection(db, PROJECTS_COLLECTION));
        const activeProjects = snapshot.docs
          .map(
            (projectDoc) =>
              ({ id: projectDoc.id, ...projectDoc.data() }) as ProjectMapping,
          )
          .filter((project) => project.status === "Active")
          .sort((a, b) => a.projectName.localeCompare(b.projectName));
        setProjects(activeProjects);
      } catch (error) {
        console.error("Failed to load Project Management projects:", error);
        setProjects([]);
      } finally {
        setIsLoadingProjects(false);
      }
    };

    void loadProjects();
  }, [canViewModule, isAuthLoading]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

  const handleProjectChange = (projectId: string) => {
    router.replace(`/project-management?project=${encodeURIComponent(projectId)}`);
  };

  const quickLinks = [
    {
      show: Boolean(selectedProject && canViewBoq),
      href: `/project-management/boq?project=${encodeURIComponent(selectedProject?.id ?? "")}`,
      title: "BOQ",
      description: selectedProject
        ? `Manage BOQ data for ${selectedProject.projectName}.`
        : "Manage BOQ costing and operational BOQs.",
      icon: ClipboardList,
      gradient: "from-emerald-500 to-teal-600",
    },
    {
      show: Boolean(selectedProject && canViewIndent),
      href: `/project-management/indent?project=${encodeURIComponent(selectedProject?.id ?? "")}`,
      title: "Indent",
      description: selectedProject
        ? `Create BOQ item indents for ${selectedProject.projectName}.`
        : "Create project indents against BOQ items.",
      icon: ListChecks,
      gradient: "from-amber-500 to-orange-600",
    },
    {
      show: Boolean(selectedProject && canViewRfq),
      href: `/project-management/rfq?project=${encodeURIComponent(selectedProject?.id ?? "")}`,
      title: "RFQ",
      description: selectedProject
        ? `Request vendor quotations for ${selectedProject.projectName}.`
        : "Request and compare vendor quotations for indents.",
      icon: FileSearch,
      gradient: "from-violet-500 to-purple-600",
    },
    {
      show: Boolean(selectedProject && canViewPurchaseOrders),
      href: `/project-management/purchase-orders?project=${encodeURIComponent(selectedProject?.id ?? "")}`,
      title: "Purchase Orders",
      description: selectedProject
        ? `Create and track purchase orders for ${selectedProject.projectName}.`
        : "Create and track purchase orders against vendors.",
      icon: ShoppingCart,
      gradient: "from-emerald-500 to-teal-600",
    },
    {
      show: canViewSettings,
      href: "/project-management/settings",
      title: "Settings",
      description: "Manage project mappings and configure Project Management.",
      icon: Settings,
      gradient: "from-slate-500 to-slate-700",
    },
  ].filter((link) => link.show);

  if (isAuthLoading) {
    return (
      <main className="min-h-[calc(100vh-4rem)] space-y-5 p-4 sm:p-6">
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-40 w-full max-w-2xl rounded-xl" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      </main>
    );
  }

  if (!canViewModule) {
    return (
      <main className="min-h-[calc(100vh-4rem)] p-4 sm:p-6">
        <h1 className="mb-6 text-2xl font-bold sm:text-3xl">{MODULE_NAME}</h1>
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              You do not have permission to access this module.
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
    <main className="min-h-[calc(100vh-4rem)] space-y-5 p-4 sm:p-6">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <Card className="relative overflow-hidden border-0 bg-gradient-to-r from-indigo-600 via-blue-600 to-cyan-600 text-white shadow-lg">
        <div className="absolute inset-0 opacity-10 bg-[radial-gradient(ellipse_at_top_right,_white_0%,_transparent_60%)]" />
        <CardContent className="relative flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm">
              <FolderKanban className="h-7 w-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{MODULE_NAME}</h1>
              <p className="mt-0.5 text-sm text-blue-100">
                Select a project to open its mapped BOQ, costing, and configuration data
              </p>
            </div>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
            {isLoadingProjects ? (
              <Skeleton className="h-9 w-full bg-white/20 sm:w-56" />
            ) : projects.length ? (
              <Select value={selectedProject?.id ?? ""} onValueChange={handleProjectChange}>
                <SelectTrigger className="h-9 w-full border-white/30 bg-white/15 text-sm text-white shadow-none backdrop-blur-sm hover:bg-white/20 focus:ring-white/40 data-[placeholder]:text-blue-100 sm:w-56">
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
            ) : (
              <div className="rounded-lg border border-white/25 bg-white/10 px-3 py-2 text-xs text-blue-50">
                No active projects.
                {canViewSettings && (
                  <Link
                    href="/project-management/settings/projects"
                    className="ml-1 font-semibold text-white underline underline-offset-2"
                  >
                    Create one
                  </Link>
                )}
              </div>
            )}

            {!isLoadingProjects && (
              <div className="flex shrink-0 items-center gap-1.5 self-end rounded-full bg-white/15 px-3 py-1.5 text-xs font-medium backdrop-blur-sm sm:self-auto">
                <Building2 className="h-3.5 w-3.5" />
                {projects.length} Active Project{projects.length !== 1 ? "s" : ""}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Quick access ─────────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {quickLinks.map((link) => (
          <Link key={link.title} href={link.href} className="group no-underline">
            <Card className="h-full overflow-hidden border-border/60 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
              <div className={cn("h-1 w-full bg-gradient-to-r", link.gradient)} />
              <CardContent className="flex items-center gap-3 p-3.5">
                <div
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br shadow-sm",
                    link.gradient,
                  )}
                >
                  <link.icon className="h-4 w-4 text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold leading-tight">{link.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{link.description}</p>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}
