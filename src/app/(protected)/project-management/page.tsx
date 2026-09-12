"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  Building2,
  CalendarClock,
  ClipboardList,
  FileBarChart2,
  FileStack,
  FolderKanban,
  FolderOpen,
  HardHat,
  Layers,
  Package,
  Settings,
  ShieldAlert,
  UserRound,
} from "lucide-react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  projectLifecycleStyles,
  resolveLifecycle,
  type PmProjectTeam,
  type ProjectLifecycleState,
  type ProjectScope,
  type ProjectType,
} from "@/lib/project-management-projects";
import { Badge } from "@/components/ui/badge";
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

/**
 * The mapping document is loaded whole, so the execution context the project wizard captures —
 * code, type, scopes, manager, lifecycle — is already in hand. The header uses it rather than
 * repeating the project's name across every tile's description.
 */
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
  projectCode?: string;
  projectType?: ProjectType;
  scopes?: ProjectScope[];
  projectManagerName?: string;
  siteInChargeName?: string;
  team?: PmProjectTeam;
  lifecycle?: ProjectLifecycleState;
};

const formatDate = (value?: string) => {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

/** Whole days from today to the completion date. Negative once it has passed. */
const daysRemaining = (endDate?: string): number | null => {
  if (!endDate) return null;
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(end.getTime())) return null;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((end.getTime() - startOfToday.getTime()) / 86_400_000);
};

export default function ProjectManagementPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const [projects, setProjects] = useState<ProjectMapping[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);

  const canViewModule = can("View Module", MODULE_NAME);
  const canViewBoq = can("View", `${MODULE_NAME}.BOQ`);
  const canViewMdl = can("View", `${MODULE_NAME}.MDL`) || canViewBoq;
  const canViewSupply = can("View", `${MODULE_NAME}.Supply`) || canViewBoq;
  const canViewCivil = can("View", `${MODULE_NAME}.Civil`) || canViewBoq;
  const canViewErection = can("View", `${MODULE_NAME}.Erection`) || canViewBoq;
  const canViewDocuments = can("View", `${MODULE_NAME}.Documents`) || canViewBoq;
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

  // Grouped rather than one flat grid: eight same-sized cards in a row gave no clue that Projects
  // and Settings work without a project selected while the rest don't, or that Design & Engineering
  // through Erection are the four delivery scopes rather than four unrelated screens.
  //
  // Within Delivery Scopes the order follows the project lifecycle — drawings get approved, then
  // material is procured, then civil work, then erection.
  const linkGroups = [
    {
      key: "overview",
      title: "Overview",
      icon: FolderKanban,
      links: [
        {
          // Project-independent: the register lists every project, so it does not need one selected.
          show: canViewModule,
          href: "/project-management/projects",
          title: "Projects",
          description: "Every project with its code, scope, manager, schedule and status.",
          icon: FolderKanban,
          gradient: "from-indigo-500 to-blue-600",
        },
        {
          show: Boolean(selectedProject && canViewBoq),
          href: `/project-management/reports?project=${encodeURIComponent(selectedProject?.id ?? "")}`,
          title: "Reports",
          description: "Commercial, engineering, procurement and site-control indicators.",
          icon: FileBarChart2,
          gradient: "from-blue-500 to-indigo-600",
        },
      ],
    },
    {
      key: "data",
      title: "Project Data",
      icon: ClipboardList,
      links: [
        {
          show: Boolean(selectedProject && canViewBoq),
          href: `/project-management/boq?project=${encodeURIComponent(selectedProject?.id ?? "")}`,
          title: "BOQ",
          description: "Costing and operational BOQs, with every gate quantity alongside.",
          icon: ClipboardList,
          gradient: "from-emerald-500 to-teal-600",
        },
        {
          show: Boolean(selectedProject && canViewDocuments),
          href: `/project-management/documents?project=${encodeURIComponent(selectedProject?.id ?? "")}`,
          title: "Documents",
          description: "Drawings, QC certificates and other filed evidence.",
          icon: FolderOpen,
          gradient: "from-purple-500 to-fuchsia-600",
        },
      ],
    },
    {
      key: "scopes",
      title: "Delivery Scopes",
      icon: Layers,
      links: [
        {
          show: Boolean(selectedProject && canViewMdl),
          href: `/project-management/mdl?project=${encodeURIComponent(selectedProject?.id ?? "")}`,
          title: "Design & Engineering",
          description: "Master Drawing List — submissions, revisions and approvals.",
          icon: FileStack,
          gradient: "from-sky-500 to-blue-600",
        },
        {
          show: Boolean(selectedProject && canViewSupply),
          href: `/project-management/supply?project=${encodeURIComponent(selectedProject?.id ?? "")}`,
          title: "Supply",
          description: "Indent to RFQ, PO, inspection, dispatch and site receipt.",
          icon: Package,
          gradient: "from-cyan-500 to-blue-600",
        },
        {
          show: Boolean(selectedProject && canViewCivil),
          href: `/project-management/civil?project=${encodeURIComponent(selectedProject?.id ?? "")}`,
          title: "Civil",
          description: "Civil execution, measured through joint measurement.",
          icon: Building2,
          gradient: "from-stone-500 to-stone-700",
        },
        {
          show: Boolean(selectedProject && canViewErection),
          href: `/project-management/erection?project=${encodeURIComponent(selectedProject?.id ?? "")}`,
          title: "Erection",
          description: "Erection work packages, owners, progress and blockers.",
          icon: HardHat,
          gradient: "from-orange-500 to-red-600",
        },
      ],
    },
    {
      key: "configuration",
      title: "Configuration",
      icon: Settings,
      links: [
        {
          show: canViewSettings,
          href: "/project-management/settings",
          title: "Settings",
          description: "Manage project mappings and configure Project Management.",
          icon: Settings,
          gradient: "from-slate-500 to-slate-700",
        },
      ],
    },
  ]
    .map((group) => ({ ...group, links: group.links.filter((link) => link.show) }))
    .filter((group) => group.links.length)
    // Laid out as 2 + 1 columns per row, so this order both leads with the screens people open
    // most and leaves no empty cells: scopes(2) + overview(1), then data(2) + configuration(1).
    .sort(
      (a, b) =>
        ["scopes", "overview", "data", "configuration"].indexOf(a.key) -
        ["scopes", "overview", "data", "configuration"].indexOf(b.key),
    );

  // Project Data and Delivery Scopes are empty until a project is chosen. Without saying so the
  // page just looks short, as though those screens didn't exist for this user.
  const awaitingProjectChoice =
    !selectedProject && projects.length > 0 && (canViewBoq || canViewMdl || canViewSupply);

  if (isAuthLoading) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] space-y-5 p-4 sm:p-6">
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-40 w-full max-w-2xl rounded-xl" />
        {/* Same column counts as the real card grid, so the layout doesn't jump on load. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      </main>
    );
  }

  if (!canViewModule) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
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
    <main className="min-h-[calc(100dvh-4rem)] space-y-5 p-4 sm:p-6">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <Card className="relative overflow-hidden border-0 bg-gradient-to-r from-indigo-600 via-blue-600 to-cyan-600 text-white shadow-lg">
        <div className="absolute inset-0 opacity-10 bg-[radial-gradient(ellipse_at_top_right,_white_0%,_transparent_60%)]" />
        <CardContent className="relative flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm">
              <FolderKanban className="h-7 w-7 text-white" />
            </div>
            {/* With a project chosen the header identifies it, rather than repeating an
                instruction that has already been followed. */}
            {selectedProject ? (
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="truncate text-2xl font-bold tracking-tight">
                    {selectedProject.projectName}
                  </h1>
                  <Badge
                    variant="outline"
                    className={cn(
                      "border-0 shrink-0",
                      projectLifecycleStyles[resolveLifecycle(selectedProject)],
                    )}
                  >
                    {resolveLifecycle(selectedProject)}
                  </Badge>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-blue-100">
                  {selectedProject.projectCode && (
                    <span className="font-mono">{selectedProject.projectCode}</span>
                  )}
                  {selectedProject.projectType && <span>{selectedProject.projectType}</span>}
                  {selectedProject.globalProjectSite && (
                    <span className="inline-flex items-center gap-1">
                      <Building2 className="h-3 w-3" />
                      {selectedProject.globalProjectSite}
                    </span>
                  )}
                  {selectedProject.projectManagerName && (
                    <span className="inline-flex items-center gap-1">
                      <UserRound className="h-3 w-3" />
                      {selectedProject.projectManagerName}
                    </span>
                  )}
                  {selectedProject.endDate && (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1",
                        (daysRemaining(selectedProject.endDate) ?? 0) < 0 && "text-red-200",
                      )}
                    >
                      <CalendarClock className="h-3 w-3" />
                      {formatDate(selectedProject.startDate)
                        ? `${formatDate(selectedProject.startDate)} → `
                        : "Due "}
                      {formatDate(selectedProject.endDate)}
                      {(() => {
                        const remaining = daysRemaining(selectedProject.endDate);
                        if (remaining == null) return null;
                        return remaining < 0
                          ? ` · ${Math.abs(remaining)}d overrun`
                          : ` · ${remaining}d left`;
                      })()}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <div>
                <h1 className="text-2xl font-bold tracking-tight">{MODULE_NAME}</h1>
                <p className="mt-0.5 text-sm text-blue-100">
                  Select a project to open its mapped BOQ, costing, and configuration data
                </p>
              </div>
            )}
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

      {/* ── Quick access ─────────────────────────────────────────────────────
          Two columns rather than four stacked full-width grids. Each group used to own a
          five-column row, so a two-tile group left three empty columns and the one-tile
          Configuration group left four — most of the page was gaps. Delivery Scopes, the four
          screens people actually work in, now leads a wide left column; the project-independent
          and admin groups sit in a narrower right column and fill the space beside it. */}
      <div className="grid gap-5 lg:grid-cols-3">
        {linkGroups.map((group) => (
          <section
            key={group.key}
            className={cn(
              "space-y-2.5",
              // Scopes and Project Data carry the page; Overview and Configuration are secondary.
              group.key === "scopes" || group.key === "data" ? "lg:col-span-2" : "lg:col-span-1",
            )}
          >
            <div className="flex items-center gap-2">
              <group.icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {group.title}
              </h2>
              {/* Hairline carries the eye across the row and keeps the heading from floating. */}
              <span aria-hidden className="h-px flex-1 bg-border" />
            </div>

            <div
              className={cn(
                "grid gap-3",
                // Column counts are chosen per group so its tiles fill the row they are given
                // instead of trailing off into empty cells.
                group.key === "scopes"
                  ? "sm:grid-cols-2 xl:grid-cols-4"
                  : group.key === "data"
                    ? "sm:grid-cols-2"
                    : "sm:grid-cols-2 lg:grid-cols-1",
              )}
            >
              {group.links.map((link) => (
                <Link
                  key={link.title}
                  href={link.href}
                  className="group rounded-xl no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <Card className="h-full overflow-hidden border-border/60 transition-all duration-200 hover:-translate-y-0.5 hover:border-border hover:shadow-md">
                    <div className={cn("h-1 w-full bg-gradient-to-r", link.gradient)} />
                    <CardContent className="flex items-center gap-2.5 p-3">
                      <div
                        className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br shadow-sm transition-transform duration-200 group-hover:scale-105",
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
          </section>
        ))}

        {awaitingProjectChoice && (
          <Card className="border-dashed bg-muted/30">
            <CardContent className="flex items-center gap-2.5 p-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                <FolderKanban className="h-4 w-4 text-muted-foreground" />
              </div>
              <p className="text-xs text-muted-foreground">
                Select a project above to open its BOQ, documents and the four delivery scopes.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
