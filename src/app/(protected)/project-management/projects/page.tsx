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
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FolderKanban, Search, ShieldAlert } from "lucide-react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Project } from "@/lib/types";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import {
  PM_PROJECT_COLLECTION,
  PROJECT_LIFECYCLE_STATES,
  projectLifecycleStyles,
  resolveLifecycle,
  type PmProject,
  type ProjectLifecycleState,
} from "@/lib/project-management-projects";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PmDataList,
  PmEmptyState,
  PmToolbar,
  type PmListColumn,
} from "@/components/project-management/pm-shell";
import { cn } from "@/lib/utils";

const MODULE_NAME = "Project Management";

const formatDate = (value?: string) => {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const formatCurrency = (value?: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
        notation: value >= 10_000_000 ? "compact" : "standard",
      }).format(value)
    : "—";

export default function ProjectRegisterPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { toast } = useToast();
  const canView = can("View Module", MODULE_NAME) || can("View", `${MODULE_NAME}.BOQ`);
  const canManage = can("View", `${MODULE_NAME}.Project Mappings`);

  const [projects, setProjects] = useState<PmProject[]>([]);
  const [globalProjects, setGlobalProjects] = useState<Map<string, Project>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [lifecycleFilter, setLifecycleFilter] = useState<ProjectLifecycleState | "all">("all");

  const loadData = useCallback(async () => {
    setIsLoading(true);
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

  useEffect(() => {
    if (isAuthLoading || !canView) {
      setIsLoading(false);
      return;
    }
    void loadData();
  }, [canView, isAuthLoading, loadData]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return projects.filter((project) => {
      const lifecycle = resolveLifecycle(project);
      if (lifecycleFilter !== "all" && lifecycle !== lifecycleFilter) return false;
      if (!needle) return true;
      const global = globalProjects.get(project.globalProjectId);
      return [
        project.projectName,
        project.projectCode,
        project.projectManagerName,
        global?.clientName,
        global?.location,
        global?.siteCode,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [projects, globalProjects, search, lifecycleFilter]);

  const counts = useMemo(() => {
    const byLifecycle = new Map<ProjectLifecycleState, number>();
    projects.forEach((project) => {
      const lifecycle = resolveLifecycle(project);
      byLifecycle.set(lifecycle, (byLifecycle.get(lifecycle) ?? 0) + 1);
    });
    return byLifecycle;
  }, [projects]);

  if (isAuthLoading || (isLoading && canView)) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] space-y-5 p-4 sm:p-6">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-96 w-full" />
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

  const columns: PmListColumn<PmProject>[] = [
    {
      header: "Code",
      className: "whitespace-nowrap text-xs text-muted-foreground",
      cell: (project) => project.projectCode || "—",
    },
    {
      header: "Project",
      mobile: "title",
      className: "max-w-xs",
      cell: (project) => (
        <>
          {/* Wraps on a phone card, where the name is the card's headline. */}
          <p className="break-words font-medium sm:truncate" title={project.projectName}>
            {project.projectName}
          </p>
          {project.projectType ? (
            <p className="text-[10px] text-muted-foreground">{project.projectType}</p>
          ) : null}
        </>
      ),
    },
    {
      header: "Client",
      className: "max-w-[10rem] truncate text-xs",
      cell: (project) => globalProjects.get(project.globalProjectId)?.clientName || "—",
    },
    {
      header: "Location",
      className: "max-w-[10rem] truncate text-xs",
      cell: (project) => {
        const global = globalProjects.get(project.globalProjectId);
        return global?.location || global?.projectSite || "—";
      },
    },
    {
      header: "Project Manager",
      className: "text-xs",
      cell: (project) => project.projectManagerName || "—",
    },
    {
      header: "Scope",
      cell: (project) =>
        project.scopes?.length ? (
          <div className="flex flex-wrap gap-1">
            {project.scopes.map((scope) => (
              <Badge key={scope} variant="outline" className="text-[10px]">
                {scope}
              </Badge>
            ))}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      header: "Contract Value",
      align: "right",
      className: "whitespace-nowrap text-xs",
      cell: (project) => formatCurrency(globalProjects.get(project.globalProjectId)?.contractValue),
    },
    {
      // A sub-line on the phone card: two dates do not fit a half-width detail cell.
      header: "Schedule",
      mobile: "title",
      className: "whitespace-nowrap text-xs",
      cell: (project) => (
        <>
          {formatDate(project.startDate)} → {formatDate(project.endDate)}
        </>
      ),
    },
    {
      header: "Status",
      mobile: "aside",
      cell: (project) => {
        const lifecycle = resolveLifecycle(project);
        return (
          <Badge variant="outline" className={projectLifecycleStyles[lifecycle]}>
            {lifecycle}
          </Badge>
        );
      },
    },
    {
      // The phone card is itself the link (`cardHref`), so the button is desktop-only.
      header: "Open",
      align: "right",
      mobile: "omit",
      className: "w-28",
      cell: (project) => (
        <Button variant="outline" size="sm" asChild>
          <Link href={`/project-management?project=${encodeURIComponent(project.id)}`}>
            Open
          </Link>
        </Button>
      ),
    },
  ];

  return (
    <main className="min-h-[calc(100dvh-4rem)] space-y-4 p-4 sm:space-y-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-48 items-center gap-2 sm:gap-3">
          <Button variant="ghost" size="icon" className="shrink-0" asChild>
            <Link href="/project-management" aria-label="Back to Project Management">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 shadow-sm sm:flex">
            <FolderKanban className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold sm:text-2xl">Projects</h1>
            <p className="text-[13px] text-muted-foreground sm:text-sm">
              {projects.length} project{projects.length === 1 ? "" : "s"} in Project Management
            </p>
          </div>
        </div>
        {canManage && (
          <Button asChild className="ml-auto">
            <Link href="/project-management/settings/projects">Manage projects</Link>
          </Button>
        )}
      </div>

      {/* Lifecycle summary */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {PROJECT_LIFECYCLE_STATES.map((state) => (
          <button
            key={state}
            type="button"
            onClick={() => setLifecycleFilter((current) => (current === state ? "all" : state))}
            className={cn(
              "rounded-lg border px-3 py-2 text-left transition-colors",
              lifecycleFilter === state ? "border-primary bg-primary/5" : "hover:bg-muted/50",
            )}
          >
            <p className="text-xl font-bold">{counts.get(state) ?? 0}</p>
            <p className="text-xs text-muted-foreground">{state}</p>
          </button>
        ))}
      </div>

      <PmToolbar className="mb-0">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by project, code, manager, client or location…"
            className="pl-8"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Select
          value={lifecycleFilter}
          onValueChange={(value: ProjectLifecycleState | "all") => setLifecycleFilter(value)}
        >
          <SelectTrigger className="sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {PROJECT_LIFECYCLE_STATES.map((state) => (
              <SelectItem key={state} value={state}>{state}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PmToolbar>

      <PmDataList
        rows={rows}
        columns={columns}
        cardHref={(project) => `/project-management?project=${encodeURIComponent(project.id)}`}
        empty={
          <PmEmptyState
            icon={FolderKanban}
            title="No projects match"
            description="Adjust the search or status filter, or create a project in Settings."
          />
        }
      />

      <p className="text-xs text-muted-foreground">
        Progress is shown on each project&apos;s own dashboard rather than here — it is derived from
        every operational register, so computing it for every row would multiply this page&apos;s
        cost by the number of projects.
      </p>
    </main>
  );
}
