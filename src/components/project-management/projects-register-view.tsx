"use client";

/**
 * The project register, as the user's mock-up (`sel-pm-projects-settings`, `v-projects`) draws it:
 * the indigo band, a status card per lifecycle state that filters the list, and one line per
 * project in a table that keeps its data inside itself.
 *
 * Presentational only: the page loads the projects and the global project master, works out the
 * permissions and hands everything down, so this view can be rendered with fabricated data.
 *
 * Deliberately does NOT compute per-project progress — see the note at the foot of the page and
 * the container's file comment.
 */

import { useMemo, useState, type MouseEvent } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Calendar,
  FolderKanban,
  Link2,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import type { Project } from "@/lib/types";
import {
  PROJECT_LIFECYCLE_STATES,
  resolveLifecycle,
  type PmProject,
  type ProjectLifecycleState,
} from "@/lib/project-management-projects";
import {
  HERO_PRIMARY_BUTTON,
  HeroBand,
} from "@/components/project-management/hero-band";
import {
  DprReportCallout,
  DprReportCard,
  DprReportZero,
} from "@/components/project-management/dpr/reports-parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

/** What the register reads from the global project master. */
export type ProjectsRegisterGlobal = Pick<
  Project,
  "clientName" | "contractValue" | "location" | "projectSite" | "siteCode"
>;

/** A lifecycle state's colours: the card/avatar gradient, its count colour, and its chip. */
const LIFECYCLE_STYLE: Record<
  ProjectLifecycleState,
  { from: string; to: string; rgb: string; chip: string }
> = {
  Draft: { from: "#cbd5e1", to: "#64748b", rgb: "100, 116, 139", chip: "bg-slate-100 text-slate-600" },
  Review: { from: "#fcd34d", to: "#d97706", rgb: "217, 119, 6", chip: "bg-amber-100 text-amber-700" },
  Active: { from: "#6ee7b7", to: "#059669", rgb: "5, 150, 105", chip: "bg-emerald-100 text-emerald-700" },
  "On Hold": { from: "#fdba74", to: "#ea580c", rgb: "234, 88, 12", chip: "bg-orange-100 text-orange-700" },
  Completed: { from: "#93c5fd", to: "#2563eb", rgb: "37, 99, 235", chip: "bg-blue-100 text-blue-700" },
  Closed: { from: "#c4b5fd", to: "#7c3aed", rgb: "124, 58, 237", chip: "bg-violet-100 text-violet-700" },
};
const lifecycleStyle = (state: ProjectLifecycleState) => LIFECYCLE_STYLE[state] ?? LIFECYCLE_STYLE.Draft;

/** A delivery scope's chip. */
const SCOPE_CHIP: Record<string, string> = {
  Civil: "bg-sky-100 text-sky-700",
  Erection: "bg-amber-100 text-amber-700",
  Supply: "bg-amber-100 text-amber-700",
  Design: "bg-violet-100 text-violet-700",
  Testing: "bg-emerald-100 text-emerald-700",
};

const formatDate = (value?: string, year: "numeric" | "2-digit" = "numeric") => {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year });
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

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() || "—";

const projectHref = (project: PmProject) => `/project-management?project=${encodeURIComponent(project.id)}`;

const DASH = <span className="text-muted-foreground/60">—</span>;

export interface ProjectsRegisterViewProps {
  projects: readonly PmProject[];
  /** The global project master, by id: client, contract value and location live there. */
  globalProjects: ReadonlyMap<string, ProjectsRegisterGlobal>;
  /** Manage projects (Project Mappings View). */
  canManage: boolean;
  /** Settings (Project Management.Settings View). */
  canOpenSettings: boolean;
  /** The band's back arrow — `useBackNavigation(...)`'s result. */
  back: { href: string; label: string; onClick?: (event: MouseEvent<HTMLAnchorElement>) => void };
}

export function ProjectsRegisterView({
  projects,
  globalProjects,
  canManage,
  canOpenSettings,
  back,
}: ProjectsRegisterViewProps) {
  const [search, setSearch] = useState("");
  const [lifecycleFilter, setLifecycleFilter] = useState<ProjectLifecycleState | "all">("all");

  const counts = useMemo(() => {
    const byLifecycle = new Map<ProjectLifecycleState, number>();
    projects.forEach((project) => {
      const lifecycle = resolveLifecycle(project);
      byLifecycle.set(lifecycle, (byLifecycle.get(lifecycle) ?? 0) + 1);
    });
    return byLifecycle;
  }, [projects]);

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

  const filtered = search.trim() !== "" || lifecycleFilter !== "all";

  return (
    <main className="min-h-[calc(100dvh-4rem)] space-y-4 p-4 sm:p-6">
      <HeroBand
        band="indigo"
        back={back}
        icon={FolderKanban}
        crumbs={[{ label: "Project Management", href: "/project-management" }]}
        title="Projects"
        description={`${projects.length} project${projects.length === 1 ? "" : "s"} in Project Management`}
        actions={
          canOpenSettings || canManage ? (
            <>
              {canOpenSettings ? (
                <Button asChild className={HERO_PRIMARY_BUTTON}>
                  <Link href="/project-management/settings">
                    <SlidersHorizontal className="mr-2 h-4 w-4" aria-hidden="true" />
                    Settings
                  </Link>
                </Button>
              ) : null}
              {canManage ? (
                <Button asChild className={HERO_PRIMARY_BUTTON}>
                  <Link href="/project-management/settings/projects">
                    <Link2 className="mr-2 h-4 w-4" aria-hidden="true" />
                    Manage projects
                  </Link>
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      />

      {/* One card per lifecycle state: its count, and a click filters the list to it. */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6" aria-label="Projects by status">
        {PROJECT_LIFECYCLE_STATES.map((state) => {
          const style = lifecycleStyle(state);
          const count = counts.get(state) ?? 0;
          const active = lifecycleFilter === state;
          return (
            <button
              key={state}
              type="button"
              aria-pressed={active}
              title={active ? `Showing ${state} projects — click to show all` : `Show only ${state} projects`}
              onClick={() => setLifecycleFilter((current) => (current === state ? "all" : state))}
              className={cn(
                "relative overflow-hidden rounded-[18px] border bg-card px-4 py-3.5 text-left shadow-sm transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active ? "" : "border-border/60 hover:shadow-md",
              )}
              style={{
                backgroundImage: `radial-gradient(160px 90px at 100% 0%, rgba(${style.rgb}, 0.14), transparent 70%)`,
                ...(active ? { borderColor: style.to, boxShadow: `0 0 0 3px rgba(${style.rgb}, 0.18)` } : {}),
              }}
            >
              <span
                className="absolute inset-y-0 left-0 w-1"
                style={{ backgroundImage: `linear-gradient(${style.from}, ${style.to})` }}
                aria-hidden="true"
              />
              <b
                className={cn("block text-[28px] font-extrabold leading-tight tabular-nums", count === 0 && "text-slate-300")}
                style={count > 0 ? { color: style.to } : undefined}
              >
                {count}
              </b>
              <span className="flex items-center gap-1.5 text-xs font-extrabold text-muted-foreground">
                <i className="h-2 w-2 rounded-full" style={{ backgroundColor: style.to }} aria-hidden="true" />
                {state}
              </span>
            </button>
          );
        })}
      </section>

      <DprReportCard
        icon={FolderKanban}
        colours={["#a5b4fc", "#4f46e5"]}
        title="All projects"
        subtitle="Click a status card above to filter"
        aside={
          <>
            <label className="relative block w-full min-w-0 sm:w-[280px]">
              <span className="sr-only">Search projects</span>
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by project, code, manager…"
                title="Search by project, code, manager, client or location"
                className="h-[38px] rounded-xl pl-9 font-semibold"
              />
            </label>
            <Select
              value={lifecycleFilter}
              onValueChange={(value: ProjectLifecycleState | "all") => setLifecycleFilter(value)}
            >
              <SelectTrigger className="h-[38px] w-[160px] rounded-xl text-left font-bold" aria-label="Status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {PROJECT_LIFECYCLE_STATES.map((state) => (
                  <SelectItem key={state} value={state}>
                    {state}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
      >
        {rows.length === 0 ? (
          <DprReportZero
            icon={FolderKanban}
            colours={["#a5b4fc", "#4f46e5"]}
            glow={["rgba(165, 180, 252, 0.6)", "rgba(110, 231, 183, 0.45)"]}
            title={projects.length === 0 ? "No projects yet" : "No projects match"}
            text={
              projects.length === 0
                ? "Create a project in Settings › Manage projects."
                : "Adjust the search or status filter, or create a project in Settings."
            }
          />
        ) : (
          <>
          {/* A phone gets a card per project: ten columns do not fit a phone, and a register is
              read down, not across. */}
          <ul className="divide-y divide-border/60 sm:hidden">
            {rows.map((project) => {
              const lifecycle = resolveLifecycle(project);
              const style = lifecycleStyle(lifecycle);
              const global = globalProjects.get(project.globalProjectId);
              const location = global?.location || global?.projectSite || "";
              const hasSchedule = Boolean(project.startDate || project.endDate);
              const scopes = project.scopes ?? [];
              return (
                <li key={project.id} className="space-y-2 px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="keep-light flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[11px] text-xs font-extrabold text-white"
                      style={{ backgroundImage: `linear-gradient(135deg, ${style.from}, ${style.to})` }}
                      aria-hidden="true"
                    >
                      {initials(project.projectName)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <b className="block truncate text-sm font-extrabold" title={project.projectName}>
                        {project.projectName}
                      </b>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[project.projectCode, global?.clientName, location].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </div>
                    <span
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-extrabold",
                        style.chip,
                      )}
                    >
                      <i className="h-[7px] w-[7px] rounded-full bg-current" aria-hidden="true" />
                      {lifecycle}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    {scopes.map((scope) => (
                      <span
                        key={scope}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-extrabold",
                          SCOPE_CHIP[scope] ?? "bg-slate-100 text-slate-600",
                        )}
                      >
                        {scope}
                      </span>
                    ))}
                    {hasSchedule ? (
                      <span className="inline-flex items-center gap-1 font-semibold tabular-nums text-muted-foreground">
                        <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                        {formatDate(project.startDate, "2-digit")} → {formatDate(project.endDate, "2-digit")}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold tabular-nums">{formatCurrency(global?.contractValue)}</span>
                    <Button variant="outline" size="sm" asChild className="h-9 rounded-[11px] font-extrabold">
                      <Link href={projectHref(project)} aria-label={`Open ${project.projectName}`}>
                        Open
                        <ArrowRight className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
                      </Link>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
          {/* Columns size to their content: short values (code, value, schedule, status, scope chips)
              are never cut, long text (project, client, location, manager) stops at a cap with the
              rest on hover, and every row stays one line. The table scrolls sideways only when the
              page is too narrow for all of it. */}
          <div className="hidden sm:block">
          <Table stickyHeader containerClassName="max-h-[65vh]" className="min-w-full">
            <TableHeader>
              <TableRow>
                <TableHead className="whitespace-nowrap">Code</TableHead>
                <TableHead className="whitespace-nowrap">Project</TableHead>
                <TableHead className="whitespace-nowrap">Client</TableHead>
                <TableHead className="whitespace-nowrap">Location</TableHead>
                <TableHead className="whitespace-nowrap">Project manager</TableHead>
                <TableHead className="whitespace-nowrap">Scope</TableHead>
                <TableHead className="whitespace-nowrap text-right">Contract value</TableHead>
                <TableHead className="whitespace-nowrap">Schedule</TableHead>
                <TableHead className="whitespace-nowrap">Status</TableHead>
                <TableHead className="whitespace-nowrap text-right">
                  <span className="sr-only">Open</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((project) => {
                const lifecycle = resolveLifecycle(project);
                const style = lifecycleStyle(lifecycle);
                const global = globalProjects.get(project.globalProjectId);
                const location = global?.location || global?.projectSite || "";
                const schedule = `${formatDate(project.startDate)} → ${formatDate(project.endDate)}`;
                // The cell shows a two-digit year so a whole schedule stays short; the tooltip
                // keeps the full dates.
                const scheduleShort = `${formatDate(project.startDate, "2-digit")} → ${formatDate(project.endDate, "2-digit")}`;
                const hasSchedule = Boolean(project.startDate || project.endDate);
                const scopes = project.scopes ?? [];
                return (
                  <TableRow key={project.id}>
                    <TableCell className="whitespace-nowrap text-sm font-bold" title={project.projectCode || undefined}>
                      {project.projectCode || DASH}
                    </TableCell>
                    <TableCell
                      className="whitespace-nowrap text-sm"
                      title={[project.projectName, project.projectType].filter(Boolean).join(" · ")}
                    >
                      <span className="flex max-w-[300px] items-center gap-2.5 font-extrabold">
                        <span
                          className="keep-light flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[11px] text-xs font-extrabold text-white"
                          style={{ backgroundImage: `linear-gradient(135deg, ${style.from}, ${style.to})` }}
                          aria-hidden="true"
                        >
                          {initials(project.projectName)}
                        </span>
                        <span className="min-w-0 truncate">
                          {project.projectName}
                          {project.projectType ? (
                            <span className="ml-1.5 text-xs font-semibold text-muted-foreground">
                              · {project.projectType}
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm" title={global?.clientName || undefined}>
                      <span className="block max-w-[220px] truncate">{global?.clientName || DASH}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm" title={location || undefined}>
                      <span className="block max-w-[180px] truncate">{location || DASH}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm" title={project.projectManagerName || undefined}>
                      <span className="block max-w-[180px] truncate">{project.projectManagerName || DASH}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm" title={scopes.join(", ") || undefined}>
                      {scopes.length > 0 ? (
                        <span className="flex gap-1">
                          {scopes.map((scope) => (
                            <span
                              key={scope}
                              className={cn(
                                "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-extrabold",
                                SCOPE_CHIP[scope] ?? "bg-slate-100 text-slate-600",
                              )}
                            >
                              <i className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
                              {scope}
                            </span>
                          ))}
                        </span>
                      ) : (
                        DASH
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right text-sm font-bold tabular-nums">
                      {formatCurrency(global?.contractValue)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm" title={hasSchedule ? schedule : undefined}>
                      {hasSchedule ? (
                        <span className="inline-flex items-center gap-1.5 font-bold">
                          <Calendar className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                          <span className="tabular-nums">{scheduleShort}</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground/60">— → —</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-extrabold",
                          style.chip,
                        )}
                      >
                        <i className="h-[7px] w-[7px] rounded-full bg-current" aria-hidden="true" />
                        {lifecycle}
                      </span>
                    </TableCell>
                    <TableCell className="px-2 py-1.5 text-right">
                      <Button variant="outline" size="sm" asChild className="h-9 rounded-[11px] font-extrabold">
                        <Link href={projectHref(project)} aria-label={`Open ${project.projectName}`}>
                          Open
                          <ArrowRight className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          </div>
          </>
        )}
        {filtered && rows.length > 0 ? (
          <div className="border-t border-border/60 px-4 py-2 text-xs text-muted-foreground sm:px-5">
            Showing {rows.length} of {projects.length} project{projects.length === 1 ? "" : "s"}.{" "}
            <button
              type="button"
              className="font-semibold text-primary underline-offset-2 hover:underline"
              onClick={() => {
                setSearch("");
                setLifecycleFilter("all");
              }}
            >
              Clear filters
            </button>
          </div>
        ) : null}
      </DprReportCard>

      <DprReportCallout tone="info" title="Progress is shown on each project's own dashboard">
        It is derived from every operational register, so computing it for every row here would
        multiply this page&apos;s cost by the number of projects.
      </DprReportCallout>
    </main>
  );
}
