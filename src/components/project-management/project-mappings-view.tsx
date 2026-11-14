"use client";

/**
 * Settings › Manage Projects, after the user's mock-up (`sel-pm-projects-settings`, "Manage
 * Projects"): the blue band with New Project Mapping, then the mappings in one table — the
 * Project Management project, the global project it maps to, the site, the timeline and the
 * status — each with edit and delete.
 *
 * Presentational only: the page loads the data, holds the permissions and runs every write
 * (`onSave`, `onDelete`), so this renders the same with fabricated data in a browser probe.
 */

import { useMemo, useState } from "react";
import { CalendarRange, Globe, Link2, Pencil, Plus, Trash2 } from "lucide-react";
import { resolveLifecycle, type ProjectLifecycleState } from "@/lib/project-management-projects";
import type { PMFieldSetting } from "@/components/project-management/use-field-control";
import { useBackNavigation } from "@/hooks/use-back-navigation";
import { HERO_PRIMARY_BUTTON, HeroBand } from "@/components/project-management/hero-band";
import { DprReportCard, DprReportZero } from "@/components/project-management/dpr/reports-parts";
import {
  ProjectWizardDialog,
  formatMappingDate,
  type MappingForm,
  type MappingGlobalProject,
  type MappingStaffMember,
  type ProjectMapping,
} from "@/components/project-management/project-wizard-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type { MappingForm, MappingGlobalProject, MappingStaffMember, ProjectMapping };

/** A status's chip, and its light-to-dark pair for the project's avatar. */
const LIFECYCLE_LOOK: Record<ProjectLifecycleState, { chip: string; avatar: readonly [string, string] }> = {
  Draft: { chip: "bg-slate-100 text-slate-700", avatar: ["#cbd5e1", "#64748b"] },
  Review: { chip: "bg-amber-100 text-amber-700", avatar: ["#fcd34d", "#d97706"] },
  Active: { chip: "bg-emerald-100 text-emerald-700", avatar: ["#6ee7b7", "#059669"] },
  "On Hold": { chip: "bg-orange-100 text-orange-700", avatar: ["#fdba74", "#ea580c"] },
  Completed: { chip: "bg-blue-100 text-blue-700", avatar: ["#93c5fd", "#2563eb"] },
  Closed: { chip: "bg-violet-100 text-violet-700", avatar: ["#c4b5fd", "#7c3aed"] },
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

export interface ProjectMappingsViewProps {
  mappings: readonly ProjectMapping[];
  globalProjects: readonly MappingGlobalProject[];
  staff: readonly MappingStaffMember[];
  /** Field Control: label, visible and required per configurable field of the form. */
  field: (key: string) => PMFieldSetting;
  canAdd: boolean;
  canEdit: boolean;
  canDelete: boolean;
  /** Runs every rule and writes; resolves true when saved (the wizard then closes). */
  onSave: (form: MappingForm, editing: ProjectMapping | null) => Promise<boolean>;
  /** Checks the project has nothing under it, then deletes the mapping. */
  onDelete: (mapping: ProjectMapping) => Promise<void>;
}

export function ProjectMappingsView({
  mappings,
  globalProjects,
  staff,
  field,
  canAdd,
  canEdit,
  canDelete,
  onSave,
  onDelete,
}: ProjectMappingsViewProps) {
  const back = useBackNavigation("/project-management/settings", { fallbackLabel: "Settings" });
  const [wizard, setWizard] = useState<{ editing: ProjectMapping | null } | null>(null);
  const globalById = useMemo(() => new Map(globalProjects.map((project) => [project.id, project])), [globalProjects]);

  return (
    <div className="space-y-4">
      <HeroBand
        band="blue"
        back={back}
        icon={Link2}
        crumbs={[
          { label: "Project Management", href: "/project-management" },
          { label: "Settings", href: "/project-management/settings" },
        ]}
        title="Manage Projects"
        description="Create Project Management projects and map each one to a global project."
        actions={
          canAdd ? (
            <Button className={HERO_PRIMARY_BUTTON} onClick={() => setWizard({ editing: null })}>
              <Plus className="mr-2 h-4 w-4" />
              New Project Mapping
            </Button>
          ) : null
        }
      />

      <DprReportCard
        icon={Link2}
        colours={["#93c5fd", "#2563eb"]}
        title="Project mappings"
        subtitle="The new project name is used inside Project Management. The mapped global project remains the source for shared project data."
      >
        {mappings.length === 0 ? (
          <div className="pb-6">
            <DprReportZero
              icon={Link2}
              colours={["#93c5fd", "#2563eb"]}
              glow={["rgba(147, 197, 253, 0.6)", "rgba(196, 181, 253, 0.5)"]}
              title="No Project Management projects yet"
              text="Create a Project Management project and map it to an existing global project."
            />
            {canAdd ? (
              <div className="flex justify-center">
                <Button onClick={() => setWizard({ editing: null })}>
                  <Plus className="mr-2 h-4 w-4" />
                  New Project Mapping
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <Table stickyHeader containerClassName="max-h-[70vh]" className="min-w-[1080px] table-fixed">
            <colgroup>
              <col />
              <col className="w-[280px]" />
              <col className="w-[170px]" />
              <col className="w-[240px]" />
              <col className="w-[130px]" />
              <col className="w-[104px]" />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead className="truncate">Project Management project</TableHead>
                <TableHead className="truncate">Mapped global project</TableHead>
                <TableHead className="truncate">Site</TableHead>
                <TableHead className="truncate">Project timeline</TableHead>
                <TableHead className="truncate">Status</TableHead>
                <TableHead className="truncate text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mappings.map((mapping) => {
                const lifecycle = resolveLifecycle(mapping);
                const look = LIFECYCLE_LOOK[lifecycle];
                const global = globalById.get(mapping.globalProjectId);
                const globalName = global?.projectName ?? mapping.globalProjectName;
                const site = global?.projectSite ?? mapping.globalProjectSite ?? "";
                const tooltip = [mapping.projectName, mapping.projectCode, mapping.description].filter(Boolean).join(" · ");
                return (
                  <TableRow key={mapping.id}>
                    <TableCell className="py-2.5" title={tooltip}>
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span
                          className="keep-light flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[11px] text-xs font-extrabold text-white"
                          style={{ backgroundImage: `linear-gradient(135deg, ${look.avatar[0]}, ${look.avatar[1]})` }}
                          aria-hidden="true"
                        >
                          {initials(mapping.projectName) || "—"}
                        </span>
                        <span className="min-w-0 truncate font-extrabold">{mapping.projectName}</span>
                        {mapping.projectCode ? (
                          <span className="shrink-0 truncate rounded-md bg-muted px-1.5 py-px font-mono text-[11px] font-bold text-muted-foreground">
                            {mapping.projectCode}
                          </span>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell className="py-2.5" title={globalName}>
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="flex shrink-0 items-center gap-1 text-violet-600" aria-hidden="true">
                          <i className="block h-0.5 w-[26px] rounded bg-gradient-to-r from-violet-300 to-violet-600" />
                          <Link2 className="h-3.5 w-3.5" />
                        </span>
                        <span className="inline-flex min-w-0 items-center gap-1.5 rounded-[10px] border border-sky-200 bg-sky-50 px-2.5 py-1 text-sm font-extrabold text-sky-700">
                          <Globe className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          <span className="truncate">{globalName || "—"}</span>
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="truncate text-sm" title={site || undefined}>
                      {site || <span className="text-muted-foreground/60">—</span>}
                    </TableCell>
                    <TableCell className="truncate text-sm">
                      {mapping.startDate || mapping.endDate ? (
                        <span className="inline-flex items-center gap-1.5 font-semibold tabular-nums">
                          <CalendarRange className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                          {formatMappingDate(mapping.startDate) || "—"} → {formatMappingDate(mapping.endDate) || "—"}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 font-semibold text-muted-foreground">
                          <CalendarRange className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          Not set
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] font-extrabold",
                          look.chip,
                        )}
                      >
                        <span className="h-[7px] w-[7px] rounded-full bg-current" aria-hidden="true" />
                        {lifecycle}
                      </span>
                    </TableCell>
                    <TableCell className="py-2 text-right">
                      <span className="inline-flex justify-end gap-1.5">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-[34px] w-[34px] rounded-[10px]"
                          onClick={() => setWizard({ editing: mapping })}
                          disabled={!canEdit}
                          aria-label={`Edit ${mapping.projectName}`}
                          title="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-[34px] w-[34px] rounded-[10px] text-rose-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
                              disabled={!canDelete}
                              aria-label={`Delete ${mapping.projectName}`}
                              title="Delete"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete project mapping?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This removes “{mapping.projectName}” from Project Management. The mapped global project will
                                not be deleted.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => void onDelete(mapping)}>Delete Mapping</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </DprReportCard>

      <ProjectWizardDialog
        open={wizard !== null}
        editing={wizard?.editing ?? null}
        mappings={mappings}
        globalProjects={globalProjects}
        staff={staff}
        field={field}
        onClose={() => setWizard(null)}
        onSave={onSave}
      />
    </div>
  );
}
