"use client";

/**
 * Project Management hub.
 *
 * A project dashboard rather than a wall of link tiles: the hero answers "where is this project?"
 * before anything asks you to click, the delivery scopes read left to right as the pipeline they
 * are, and the rail carries what is actually wrong and what falls due next.
 *
 * Every figure comes from the control tower (see use-control-tower-summary.ts), which reads the
 * same registers the Reports tower does — there are no placeholder numbers on this screen, and a
 * scope with nothing recorded shows "—" rather than a zero that would read as "no progress made".
 * The tower is a wide read, so the structure renders from the mapping alone and the figures land
 * when they arrive.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Building2,
  CalendarClock,
  ChevronRight,
  ClipboardList,
  FileBarChart2,
  FileStack,
  FolderKanban,
  FolderOpen,
  HardHat,
  IndianRupee,
  Package,
  Settings,
  ShieldAlert,
  TrendingUp,
} from "lucide-react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  resolveLifecycle,
  type PmProjectTeam,
  type ProjectLifecycleState,
  type ProjectScope,
  type ProjectType,
} from "@/lib/project-management-projects";
import {
  type ProjectAttentionTarget,
  type ProjectScopeKey,
  type ProjectScopeStage,
} from "@/lib/project-management-dashboard";
import { useControlTowerSummary } from "@/components/project-management/use-control-tower-summary";
import { DPR_BASE_PATH, DPR_PERMISSION_RESOURCE } from "@/lib/project-management-dpr";
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
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
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

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: value >= 10_000_000 ? 2 : 0,
    notation: value >= 10_000_000 ? "compact" : "standard",
  }).format(value);

const formatCount = (value: number) => new Intl.NumberFormat("en-IN").format(value);

const startOfToday = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

/** Whole days from today to the completion date. Negative once it has passed. */
const daysRemaining = (endDate?: string): number | null => {
  if (!endDate) return null;
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(end.getTime())) return null;
  return Math.round((end.getTime() - startOfToday().getTime()) / 86_400_000);
};

/**
 * Elapsed share of the contract period, for the bar under the schedule figure.
 *
 * Measured to the start of today rather than to the millisecond: a figure that changes between
 * the server render and the client's is a hydration mismatch, and nobody needs this bar to move
 * during the day anyway.
 */
const elapsedSharePct = (startDate?: string, endDate?: string): number | null => {
  if (!startDate || !endDate) return null;
  const start = new Date(`${startDate}T00:00:00`).getTime();
  const end = new Date(`${endDate}T00:00:00`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;
  return Math.min(Math.max(((startOfToday().getTime() - start) / (end - start)) * 100, 0), 100);
};

/** Per-scope accent, matching the tile colours the module already uses for each of them. */
const scopeAccent: Record<ProjectScopeKey, { gradient: string; icon: typeof FileStack; href: string }> = {
  engineering: { gradient: "from-sky-500 to-blue-600", icon: FileStack, href: "/project-management/mdl" },
  supply: { gradient: "from-cyan-500 to-blue-600", icon: Package, href: "/project-management/supply" },
  civil: { gradient: "from-stone-500 to-stone-700", icon: Building2, href: "/project-management/civil" },
  erection: { gradient: "from-orange-500 to-red-600", icon: HardHat, href: "/project-management/erection" },
};

const scopeTone: Record<ProjectScopeStage["tone"], StatusTone> = {
  ok: "success",
  warn: "warning",
  bad: "danger",
  idle: "neutral",
};

const severityTone: Record<"critical" | "warning" | "info", StatusTone> = {
  critical: "danger",
  warning: "warning",
  info: "info",
};

/** Where each attention target opens, relative to the module base. */
const targetPath: Record<ProjectAttentionTarget, string> = {
  boq: "boq/costing",
  "requirement-planner": "requirement-planner",
  mdl: "mdl",
  "purchase-orders": "purchase-orders",
  inspections: "inspections",
  mdcc: "mdcc/documents",
  "dispatch-instructions": "dispatch-instructions/documents",
  grn: "grn/documents",
  mvac: "mvac/documents",
  projects: "projects",
  civil: "civil",
  jmc: "jmc/log",
};

/** A circular gauge for the overall figure. Plain SVG — one number does not need a chart library. */
function ProgressRing({ value }: { value: number | null }) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const filled = value === null ? 0 : (Math.min(Math.max(value, 0), 100) / 100) * circumference;
  return (
    <svg viewBox="0 0 64 64" className="h-[72px] w-[72px] shrink-0" role="img" aria-label={value === null ? "No progress recorded" : `${value}% complete`}>
      <circle cx="32" cy="32" r={radius} fill="none" stroke="hsl(var(--muted))" strokeWidth="6" />
      <circle
        cx="32"
        cy="32"
        r={radius}
        fill="none"
        stroke="url(#pm-ring)"
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={`${filled} ${circumference}`}
        transform="rotate(-90 32 32)"
      />
      <defs>
        <linearGradient id="pm-ring" x1="0" x2="1">
          <stop offset="0" stopColor="#14b8a6" />
          <stop offset="0.5" stopColor="#6366f1" />
          <stop offset="1" stopColor="#db2777" />
        </linearGradient>
      </defs>
      <text
        x="32"
        y="36"
        textAnchor="middle"
        className="fill-foreground text-[15px] font-bold"
      >
        {value === null ? "—" : `${Math.round(value)}%`}
      </text>
    </svg>
  );
}

function KpiCard({
  label,
  value,
  detail,
  fillPct,
  gradient,
  isLoading,
}: {
  label: string;
  value: string;
  detail: string;
  fillPct: number | null;
  gradient: string;
  isLoading: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border/50 bg-card/80 p-3 backdrop-blur-sm sm:p-4">
      <p className="text-[11.5px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      {isLoading ? (
        <Skeleton className="mt-1 h-7 w-24" />
      ) : (
        <p className="text-xl font-extrabold leading-tight tracking-tight sm:text-[22px]">{value}</p>
      )}
      <p className="mt-0.5 text-[11.5px] font-medium text-muted-foreground">{detail}</p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full bg-gradient-to-r", gradient)}
          style={{ width: `${Math.min(Math.max(fillPct ?? 0, 0), 100)}%` }}
        />
      </div>
    </div>
  );
}

export default function ProjectManagementPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const [projects, setProjects] = useState<ProjectMapping[]>([]);
  const [isFetchingProjects, setIsFetchingProjects] = useState(true);

  const canViewModule = can("View Module", MODULE_NAME);
  const canViewBoq = can("View", `${MODULE_NAME}.BOQ`);
  const canViewMdl = can("View", `${MODULE_NAME}.MDL`) || canViewBoq;
  const canViewSupply = can("View", `${MODULE_NAME}.Supply`) || canViewBoq;
  const canViewCivil = can("View", `${MODULE_NAME}.Civil`) || canViewBoq;
  const canViewErection = can("View", `${MODULE_NAME}.Erection`) || canViewBoq;
  const canViewDpr = can("View", DPR_PERMISSION_RESOURCE) || canViewCivil || canViewErection;
  const canViewDocuments = can("View", `${MODULE_NAME}.Documents`) || canViewBoq;
  const canViewSettings = can("View", `${MODULE_NAME}.Settings`);
  const selectedProjectId = searchParams?.get("project") ?? "";

  useEffect(() => {
    // Nothing to load while auth is resolving, or for someone who cannot see the module; "not
    // loading" is derived from those below rather than written back through setState here.
    if (isAuthLoading || !canViewModule) return;

    const loadProjects = async () => {
      setIsFetchingProjects(true);
      try {
        const snapshot = await getDocs(collection(db, PROJECTS_COLLECTION));
        const activeProjects = snapshot.docs
          .map((projectDoc) => ({ id: projectDoc.id, ...projectDoc.data() }) as ProjectMapping)
          .filter((project) => project.status === "Active")
          .sort((a, b) => a.projectName.localeCompare(b.projectName));
        setProjects(activeProjects);
      } catch (error) {
        console.error("Failed to load Project Management projects:", error);
        setProjects([]);
      } finally {
        setIsFetchingProjects(false);
      }
    };

    void loadProjects();
  }, [canViewModule, isAuthLoading]);

  // Only loading when a load is actually going to happen.
  const isLoadingProjects = isFetchingProjects && canViewModule;

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

  const { summary, isLoading: isLoadingSummary } = useControlTowerSummary(
    selectedProject,
    canViewModule,
  );

  const handleProjectChange = (projectId: string) => {
    router.replace(`/project-management?project=${encodeURIComponent(projectId)}`);
  };

  const withProject = (path: string) =>
    `${path}?project=${encodeURIComponent(selectedProject?.id ?? "")}`;

  const scheduleDays = daysRemaining(selectedProject?.endDate);
  const lifecycle = selectedProject ? resolveLifecycle(selectedProject) : null;

  const elapsedPct = elapsedSharePct(selectedProject?.startDate, selectedProject?.endDate);

  const dataCards = [
    {
      show: canViewBoq,
      href: withProject("/project-management/boq"),
      title: "BOQ",
      description: "Costing and operational BOQs, with every gate quantity alongside.",
      icon: ClipboardList,
      gradient: "from-emerald-500 to-green-600",
      stats: summary
        ? [
            { label: "items", value: formatCount(summary.boq.itemCount) },
            { label: "budget", value: formatCurrency(summary.boq.budgetValue) },
            { label: "surveyed", value: `${Math.round(summary.boq.surveyCoveragePct)}%` },
          ]
        : [],
    },
    {
      show: canViewDpr,
      href: `${DPR_BASE_PATH}?project=${encodeURIComponent(selectedProject?.id ?? "")}`,
      title: "Daily Progress",
      description: "Projected against actual work, day by day, on Civil and Erection BOQ lines.",
      icon: Activity,
      gradient: "from-amber-500 to-orange-600",
      stats: [],
    },
    {
      show: canViewDocuments,
      href: withProject("/project-management/documents"),
      title: "Documents",
      description: "Drawings, certificates and other filed evidence for this project.",
      icon: FolderOpen,
      gradient: "from-fuchsia-500 to-purple-600",
      stats: [],
    },
    {
      show: canViewBoq,
      href: withProject("/project-management/reports"),
      title: "Reports",
      description: "Commercial, engineering, procurement and site-control indicators.",
      icon: FileBarChart2,
      gradient: "from-indigo-500 to-blue-700",
      stats: summary
        ? [
            { label: "committed", value: formatCurrency(summary.cost.committedValue) },
            { label: "of budget", value: `${summary.cost.committedPct}%` },
          ]
        : [],
    },
  ].filter((card) => card.show);

  // A plain filter over at most four items — cheap enough that memoizing it only gave the React
  // compiler a dependency record to object to.
  const scopeAllowed: Record<ProjectScopeKey, boolean> = {
    engineering: canViewMdl,
    supply: canViewSupply,
    civil: canViewCivil,
    erection: canViewErection,
  };
  const visibleScopes = summary?.scopes.filter((scope) => scopeAllowed[scope.key]) ?? [];

  if (isAuthLoading) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] space-y-5 p-4 sm:p-6">
        <Skeleton className="h-56 w-full rounded-3xl" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((index) => (
            <Skeleton key={index} className="h-48 rounded-2xl" />
          ))}
        </div>
      </main>
    );
  }

  if (!canViewModule) {
    return (
      <main className="min-h-[calc(100dvh-4rem)] p-4 sm:p-6">
        <PageHeader title={MODULE_NAME} icon={FolderKanban} />
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to access this module.</CardDescription>
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
      {/* ── Hero ─────────────────────────────────────────────────────────────────────────── */}
      <section className="relative isolate overflow-hidden rounded-3xl border border-border/50 bg-card/60 shadow-sm">
        {/* Colour fields, not decoration for its own sake: they make the hub read as the module's
            front door rather than as one more register. Motion respects the OS setting. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          <span className="absolute -left-[5%] -top-32 h-64 w-[32rem] rounded-full bg-teal-300/40 blur-3xl animate-blob-drift-a motion-reduce:animate-none" />
          <span className="absolute left-[40%] -top-36 h-64 w-[35rem] rounded-full bg-indigo-300/40 blur-3xl animate-blob-drift-b motion-reduce:animate-none" />
          <span className="absolute -right-[5%] -bottom-36 h-60 w-[30rem] rounded-full bg-pink-300/40 blur-3xl animate-blob-drift-c motion-reduce:animate-none" />
        </div>

        <div className="grid grid-cols-1 items-center gap-6 p-5 sm:p-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1.5fr)]">
          <div className="min-w-0">
            <nav className="flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-wider text-muted-foreground">
              <Link href="/" className="hover:text-foreground">
                Modules
              </Link>
              <ChevronRight className="h-3 w-3" />
              <span className="text-foreground/70">{MODULE_NAME}</span>
            </nav>

            <div className="mt-2.5 flex items-center gap-3.5">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-400 to-purple-600 text-white shadow-md sm:h-14 sm:w-14">
                <FolderKanban className="h-6 w-6" />
              </span>
              <div className="min-w-0">
                <h1 className="truncate bg-gradient-to-r from-teal-600 via-indigo-600 to-pink-600 bg-clip-text text-2xl font-extrabold leading-tight tracking-tight text-transparent sm:text-3xl">
                  {selectedProject ? selectedProject.projectName : MODULE_NAME}
                </h1>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {lifecycle ? <StatusBadge status={lifecycle} dot /> : null}
                  {selectedProject?.projectCode ? (
                    <span className="rounded-full border border-border/50 bg-background/70 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                      Code <b className="text-foreground">{selectedProject.projectCode}</b>
                    </span>
                  ) : null}
                  {selectedProject?.globalProjectSite ? (
                    <span className="rounded-full border border-border/50 bg-background/70 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                      Site <b className="text-foreground">{selectedProject.globalProjectSite}</b>
                    </span>
                  ) : null}
                  {selectedProject?.projectManagerName ? (
                    <span className="rounded-full border border-border/50 bg-background/70 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                      PM <b className="text-foreground">{selectedProject.projectManagerName}</b>
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="mt-4 max-w-md">
              {isLoadingProjects ? (
                <Skeleton className="h-10 w-full rounded-xl" />
              ) : (
                <Select value={selectedProjectId} onValueChange={handleProjectChange}>
                  <SelectTrigger className="h-11 rounded-xl border-border/50 bg-background/80 text-left">
                    <div className="flex min-w-0 items-center gap-2">
                      <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <SelectValue placeholder="Select a project to open it" />
                    </div>
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
              {!selectedProject && projects.length > 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Choose a project to see its progress, scopes and open items.
                </p>
              ) : null}
            </div>
          </div>

          {/* KPIs — blank until a project is chosen, rather than showing zeroes for nothing. */}
          {selectedProject ? (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="col-span-2 flex items-center gap-3 rounded-2xl border border-border/50 bg-card/80 p-3 backdrop-blur-sm sm:p-4 lg:col-span-1">
                {isLoadingSummary ? (
                  <Skeleton className="h-[72px] w-[72px] shrink-0 rounded-full" />
                ) : (
                  <ProgressRing value={summary?.overallProgressPct ?? null} />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-bold leading-tight">Overall progress</p>
                  <p className="text-[11.5px] leading-snug text-muted-foreground">
                    Mean of the scopes that have something recorded
                  </p>
                </div>
              </div>
              <KpiCard
                label="BOQ value"
                value={summary ? formatCurrency(summary.boq.budgetValue) : "—"}
                detail={summary ? `${formatCount(summary.boq.itemCount)} line items` : "Loading"}
                fillPct={100}
                gradient="from-sky-400 to-blue-600"
                isLoading={isLoadingSummary}
              />
              <KpiCard
                label="Committed"
                value={summary ? formatCurrency(summary.cost.committedValue) : "—"}
                detail={summary ? `${summary.cost.committedPct}% of budget · POs and work orders` : "Loading"}
                fillPct={summary?.cost.committedPct ?? null}
                gradient={
                  summary?.cost.overBudget
                    ? "from-rose-400 to-red-600"
                    : "from-emerald-400 to-teal-600"
                }
                isLoading={isLoadingSummary}
              />
              <KpiCard
                label="Schedule"
                value={
                  scheduleDays === null
                    ? "—"
                    : scheduleDays >= 0
                      ? `${formatCount(scheduleDays)} days`
                      : `${formatCount(Math.abs(scheduleDays))} days over`
                }
                detail={
                  selectedProject.endDate
                    ? `to completion · ${formatDate(selectedProject.endDate)}`
                    : "No completion date recorded"
                }
                fillPct={elapsedPct}
                gradient={
                  scheduleDays !== null && scheduleDays < 0
                    ? "from-rose-400 to-red-600"
                    : "from-amber-400 to-orange-600"
                }
                isLoading={false}
              />
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border/60 bg-background/50 p-6 text-center text-sm text-muted-foreground">
              No project selected. Progress, commitment and schedule appear here once you choose one.
            </div>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          {/* ── Delivery scopes ──────────────────────────────────────────────────────────── */}
          <section>
            <div className="mb-3 flex items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-sky-400 to-blue-600 text-white">
                <TrendingUp className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <h2 className="text-base font-bold">Delivery scopes</h2>
                <p className="text-xs text-muted-foreground">
                  From drawing to erection, in the order the work happens
                </p>
              </div>
              <span className="hidden h-px flex-1 bg-border sm:block" />
            </div>

            {!selectedProject ? (
              <Card className="border-dashed">
                <CardContent className="p-6 text-center text-sm text-muted-foreground">
                  Select a project to see how its four scopes are tracking.
                </CardContent>
              </Card>
            ) : isLoadingSummary ? (
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 2xl:grid-cols-4">
                {[1, 2, 3, 4].map((index) => (
                  <Skeleton key={index} className="h-56 rounded-2xl" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 2xl:grid-cols-4">
                {visibleScopes.map((scope, index) => {
                  const accent = scopeAccent[scope.key];
                  const Icon = accent.icon;
                  return (
                    <Link
                      key={scope.key}
                      href={withProject(accent.href)}
                      className="group relative flex flex-col gap-3 overflow-hidden rounded-2xl border border-border/60 bg-card p-4 no-underline transition hover:-translate-y-0.5 hover:shadow-lg"
                    >
                      <span
                        className={cn(
                          "pointer-events-none absolute -right-12 -top-12 h-36 w-36 rounded-full bg-gradient-to-br opacity-10 blur-2xl",
                          accent.gradient,
                        )}
                      />
                      <span className="absolute right-3.5 top-3.5 text-[10.5px] font-extrabold uppercase tracking-widest text-muted-foreground/70">
                        Step {index + 1}
                      </span>

                      <div className="flex items-center gap-3">
                        <span
                          className={cn(
                            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm",
                            accent.gradient,
                          )}
                        >
                          <Icon className="h-5 w-5" />
                        </span>
                        <div className="min-w-0 pr-10">
                          <p className="truncate text-sm font-bold leading-tight">{scope.label}</p>
                          <p className="truncate text-[11.5px] text-muted-foreground" title={scope.basis}>
                            {scope.basis}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="text-2xl font-extrabold tracking-tight tabular-nums">
                          {scope.progressPct === null ? "—" : `${scope.progressPct}%`}
                        </span>
                        <span className="text-[11.5px] font-medium text-muted-foreground">
                          {scope.progressPct === null ? "nothing recorded" : "complete"}
                        </span>
                        <StatusBadge
                          status={scope.statusLabel}
                          tone={scopeTone[scope.tone]}
                          className="ml-auto shrink-0"
                        >
                          {scope.statusLabel}
                        </StatusBadge>
                      </div>

                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn("h-full rounded-full bg-gradient-to-r", accent.gradient)}
                          style={{ width: `${Math.min(Math.max(scope.progressPct ?? 0, 0), 100)}%` }}
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-1.5">
                        {scope.stats.map((stat) => (
                          <div key={stat.label} className="rounded-lg bg-muted/60 px-2.5 py-1.5">
                            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                              {stat.label}
                            </p>
                            <p className="text-[13px] font-semibold tabular-nums">{stat.value}</p>
                          </div>
                        ))}
                      </div>

                      <div className="mt-auto flex items-center justify-between border-t border-dashed border-border pt-2.5 text-xs text-muted-foreground">
                        <span>Open {scope.label.toLowerCase()}</span>
                        <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5 group-hover:text-foreground" />
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>

          {/* ── Project data ─────────────────────────────────────────────────────────────── */}
          {dataCards.length > 0 ? (
            <section>
              <div className="mb-3 flex items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-green-600 text-white">
                  <ClipboardList className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-base font-bold">Project data</h2>
                  <p className="text-xs text-muted-foreground">
                    The quantities and paperwork every scope draws on
                  </p>
                </div>
                <span className="hidden h-px flex-1 bg-border sm:block" />
              </div>

              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 2xl:grid-cols-3">
                {dataCards.map((card) => (
                  <Link
                    key={card.title}
                    href={selectedProject ? card.href : "#"}
                    aria-disabled={!selectedProject}
                    onClick={(event) => {
                      if (!selectedProject) event.preventDefault();
                    }}
                    className={cn(
                      "group relative flex flex-col gap-3 overflow-hidden rounded-2xl border border-border/60 bg-card p-4 no-underline transition",
                      selectedProject
                        ? "hover:-translate-y-0.5 hover:shadow-lg"
                        : "cursor-not-allowed opacity-60",
                    )}
                  >
                    <span
                      className={cn(
                        "pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gradient-to-br opacity-10 blur-2xl",
                        card.gradient,
                      )}
                    />
                    <div className="flex items-start gap-3">
                      <span
                        className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm",
                          card.gradient,
                        )}
                      >
                        <card.icon className="h-5 w-5" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-bold">{card.title}</p>
                        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                          {card.description}
                        </p>
                      </div>
                    </div>
                    {card.stats.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {card.stats.map((stat) => (
                          <span
                            key={stat.label}
                            className="rounded-lg bg-muted/60 px-2 py-1 text-[11.5px] font-medium text-muted-foreground"
                          >
                            <b className="text-foreground">{stat.value}</b> {stat.label}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <div className="mt-auto flex items-center justify-between border-t border-dashed border-border pt-2.5 text-xs text-muted-foreground">
                      <span>{selectedProject ? "Open" : "Select a project first"}</span>
                      <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5 group-hover:text-foreground" />
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        {/* ── Rail ───────────────────────────────────────────────────────────────────────── */}
        <aside className="space-y-3.5 xl:sticky xl:top-20">
          <Card className="overflow-hidden border-border/60">
            <CardHeader className="flex-row items-center justify-between space-y-0 p-4 pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-bold">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Needs attention
                {summary && summary.attention.length > 0 ? (
                  <StatusBadge status="count" tone="danger" className="px-2">
                    {summary.attention.length}
                  </StatusBadge>
                ) : null}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {!selectedProject ? (
                <p className="py-3 text-xs text-muted-foreground">
                  Select a project to see what is waiting on someone.
                </p>
              ) : isLoadingSummary ? (
                <div className="space-y-2 py-1">
                  {[1, 2, 3].map((index) => (
                    <Skeleton key={index} className="h-10 rounded-lg" />
                  ))}
                </div>
              ) : !summary || summary.attention.length === 0 ? (
                <p className="py-3 text-xs text-muted-foreground">
                  Nothing is flagged on this project right now.
                </p>
              ) : (
                <ul className="divide-y divide-dashed divide-border">
                  {summary.attention.slice(0, 6).map((item) => (
                    <li key={item.id}>
                      <Link
                        href={withProject(`/project-management/${targetPath[item.target]}`)}
                        className="flex items-start gap-2.5 py-2.5 no-underline"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-[12.5px] font-semibold leading-snug">{item.title}</p>
                          <p className="truncate text-[11.5px] text-muted-foreground" title={item.detail}>
                            {item.detail}
                          </p>
                        </div>
                        <StatusBadge
                          status={item.severity}
                          tone={severityTone[item.severity]}
                          className="shrink-0"
                        >
                          {item.count > 0 ? formatCount(item.count) : item.severity}
                        </StatusBadge>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="overflow-hidden border-border/60">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-bold">
                <CalendarClock className="h-4 w-4 text-sky-500" />
                Coming up
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {!selectedProject ? (
                <p className="py-3 text-xs text-muted-foreground">
                  Select a project to see what falls due next.
                </p>
              ) : isLoadingSummary ? (
                <div className="space-y-2 py-1">
                  {[1, 2, 3].map((index) => (
                    <Skeleton key={index} className="h-10 rounded-lg" />
                  ))}
                </div>
              ) : !summary || summary.upcoming.length === 0 ? (
                <p className="py-3 text-xs text-muted-foreground">
                  Nothing dated falls due in the next 45 days.
                </p>
              ) : (
                <ul className="divide-y divide-dashed divide-border">
                  {summary.upcoming.map((item) => {
                    const date = new Date(`${item.date}T00:00:00`);
                    return (
                      <li key={item.id}>
                        <Link
                          href={withProject(`/project-management/${targetPath[item.target]}`)}
                          className="flex items-center gap-3 py-2.5 no-underline"
                        >
                          <div className="w-11 shrink-0 rounded-lg bg-muted/70 py-1 text-center leading-tight">
                            <p className="text-[15px] font-bold tabular-nums">
                              {String(date.getDate()).padStart(2, "0")}
                            </p>
                            <p className="text-[9.5px] font-extrabold uppercase text-muted-foreground">
                              {date.toLocaleDateString("en-IN", { month: "short" })}
                            </p>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[12.5px] font-semibold" title={item.title}>
                              {item.title}
                            </p>
                            <p className="truncate text-[11.5px] text-muted-foreground">
                              {item.detail}
                            </p>
                          </div>
                          <span className="shrink-0 text-[11px] font-semibold text-muted-foreground">
                            {item.daysAway === 0 ? "today" : `${item.daysAway}d`}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Link
            href="/project-management/projects"
            className="flex items-center gap-3 rounded-2xl border border-dashed border-border bg-card/50 p-3.5 no-underline transition hover:border-border hover:bg-card"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-300 to-blue-700 text-white">
              <FolderKanban className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-bold">All projects</p>
              <p className="text-xs text-muted-foreground">
                Every project with code, scope, manager and status
              </p>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>

          {canViewSettings ? (
            <Link
              href="/project-management/settings"
              className="flex items-center gap-3 rounded-2xl border border-dashed border-border bg-card/50 p-3.5 no-underline transition hover:border-border hover:bg-card"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-400 to-slate-700 text-white">
                <Settings className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-bold">Settings</p>
                <p className="text-xs text-muted-foreground">
                  Project mappings and module configuration
                </p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
          ) : null}

          {selectedProject && summary?.cost.overBudget ? (
            <div className="flex items-start gap-2.5 rounded-2xl border border-destructive/40 bg-destructive/5 p-3.5">
              <IndianRupee className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <p className="text-xs text-muted-foreground">
                Commitment is{" "}
                <b className="text-foreground">{formatCurrency(summary.cost.varianceValue)}</b> over
                the BOQ budget for this project.
              </p>
            </div>
          ) : null}
        </aside>
      </div>
    </main>
  );
}
