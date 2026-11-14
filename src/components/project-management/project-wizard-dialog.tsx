"use client";

/**
 * The New / Edit Project wizard of Settings › Manage Projects, after the user's mock-up
 * (`sel-pm-projects-settings`): three steps — Project details, Scope & team, Review & activate —
 * with a gradient header, a step rail (done ✓ / current / upcoming), coloured field labels, inline
 * errors and a review grid.
 *
 * Presentational only: no Firestore, no auth. The page passes the data, the Field Control accessor
 * and `onSave`, which runs every rule again (duplicates, timeline, lifecycle transitions) before it
 * writes — the checks here are early warnings, not the gate.
 *
 * A later step opens only once Project details passes; Scope & team has no rule of its own (its
 * fields matter for activation, which the review step checks). Create stays disabled while the
 * status being saved has blocking problems — light rules for a Draft, the activation bar for Active.
 */

import { useMemo, useState, type ReactNode } from "react";
import {
  Building2,
  CalendarCheck,
  CalendarDays,
  Check,
  FileText,
  FlaskConical,
  FolderKanban,
  Globe,
  HardHat,
  Hash,
  Loader2,
  PenTool,
  Tag,
  Timer,
  Truck,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { personOptionLabel } from "@/lib/people-directory";
import {
  PM_TEAM_ROLES,
  PROJECT_SCOPES,
  PROJECT_TYPES,
  canActivateProject,
  nextLifecycleStates,
  resolveLifecycle,
  validatePmProject,
  type PmProject,
  type PmProjectTeam,
  type ProjectLifecycleState,
  type ProjectScope,
  type ProjectType,
} from "@/lib/project-management-projects";
import type { Project } from "@/lib/types";
import type { PMFieldSetting } from "@/components/project-management/use-field-control";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/* ── The record ─────────────────────────────────────────────────────────────────────────────── */

export type ProjectMapping = PmProject & { globalProjectName: string };

export type MappingForm = Omit<ProjectMapping, "id" | "globalProjectName" | "globalProjectSite">;

export type MappingGlobalProject = Pick<Project, "id" | "projectName" | "projectSite" | "siteCode">;

export interface MappingStaffMember {
  id: string;
  name: string;
  role?: string;
  designation?: string | null;
  email?: string;
  employeeId?: string;
}

export const emptyMappingForm: MappingForm = {
  projectName: "",
  globalProjectId: "",
  description: "",
  startDate: "",
  endDate: "",
  status: "Inactive",
  projectCode: "",
  scopes: [],
  projectManagerId: "",
  projectManagerName: "",
  siteInChargeId: "",
  siteInChargeName: "",
  team: {},
  // New projects start as drafts. A project record should be able to exist before every detail is
  // known; going live is a deliberate act that has to clear the activation bar.
  lifecycle: "Draft",
};

export function mappingToForm(mapping: ProjectMapping): MappingForm {
  return {
    projectName: mapping.projectName,
    globalProjectId: mapping.globalProjectId,
    description: mapping.description ?? "",
    startDate: mapping.startDate ?? "",
    endDate: mapping.endDate ?? "",
    status: mapping.status,
    projectCode: mapping.projectCode ?? "",
    projectType: mapping.projectType,
    scopes: mapping.scopes ?? [],
    projectManagerId: mapping.projectManagerId ?? "",
    projectManagerName: mapping.projectManagerName ?? "",
    siteInChargeId: mapping.siteInChargeId ?? "",
    siteInChargeName: mapping.siteInChargeName ?? "",
    team: mapping.team ?? {},
    // Legacy mappings predate the lifecycle field — infer it rather than showing a blank.
    lifecycle: resolveLifecycle(mapping),
  };
}

/** "2026-11-14" → "14-11-2026". */
export const formatMappingDate = (value?: string) => (value ? value.split("-").reverse().join("-") : "");

/* ── Look ───────────────────────────────────────────────────────────────────────────────────── */

/** Three steps, because the fields genuinely group into three decisions: what and where it is,
 * who runs it, and whether it is ready to go live. */
const WIZARD_STEPS = ["Project details", "Scope & team", "Review & activate"] as const;

const HEADER_STYLE = {
  backgroundImage:
    "radial-gradient(300px 140px at 100% 0%, rgba(244, 114, 182, 0.5), transparent 70%), linear-gradient(120deg, #5b21b6, #7c3aed 55%, #0e7490)",
} as const;

/** The dialog's own ×, maximise and minimise sit on the gradient, so they turn white. */
const WHITE_WINDOW_CONTROLS =
  "[&_[data-slot=dialog-close]]:text-white [&_[data-slot=dialog-close]]:opacity-90 [&_[data-slot=dialog-close]]:data-[state=open]:bg-transparent [&_[data-slot=dialog-close]]:data-[state=open]:text-white [&_[data-slot=dialog-window-controls]]:text-white";

const PRIMARY_GRADIENT = { backgroundImage: "linear-gradient(135deg, #a855f7, #7c3aed)" } as const;

const SCOPE_LOOK: Record<ProjectScope, { icon: LucideIcon; colours: readonly [string, string]; line: string }> = {
  Design: { icon: PenTool, colours: ["#c4b5fd", "#7c3aed"], line: "Design and engineering" },
  Supply: { icon: Truck, colours: ["#fcd34d", "#d97706"], line: "Materials, orders and dispatch" },
  Civil: { icon: Building2, colours: ["#7dd3fc", "#0284c7"], line: "Site works and progress" },
  Testing: { icon: FlaskConical, colours: ["#6ee7b7", "#059669"], line: "Testing and commissioning" },
};

function FieldLabel({
  htmlFor,
  icon: Icon,
  colour,
  text,
  required = false,
}: {
  htmlFor?: string;
  icon: LucideIcon;
  colour: string;
  text: ReactNode;
  required?: boolean;
}) {
  return (
    <div className="mb-1.5 flex h-5 items-center gap-1.5">
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[7px] text-white"
        style={{ backgroundColor: colour }}
        aria-hidden="true"
      >
        <Icon className="h-[11px] w-[11px]" />
      </span>
      <Label htmlFor={htmlFor} className="text-xs font-extrabold text-muted-foreground">
        {text}
        {required ? <span className="text-rose-600"> *</span> : null}
      </Label>
    </div>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-1 text-[11.5px] font-bold text-rose-600" role="alert">
      {message}
    </p>
  );
}

const invalidClass = "border-destructive bg-rose-50 focus-visible:ring-destructive";

/** Whole days from start to end, both counted. */
function durationDays(start?: string, end?: string): number | null {
  if (!start || !end || end < start) return null;
  const from = Date.parse(`${start}T00:00:00Z`);
  const to = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round((to - from) / 86_400_000) + 1;
}

/* ── The wizard ─────────────────────────────────────────────────────────────────────────────── */

export function ProjectWizardDialog({
  open,
  editing,
  mappings,
  globalProjects,
  staff,
  field,
  onClose,
  onSave,
}: {
  open: boolean;
  /** The mapping being edited; null for a new one. */
  editing: ProjectMapping | null;
  /** Every mapping, for the early "already in use" warnings. */
  mappings: readonly ProjectMapping[];
  globalProjects: readonly MappingGlobalProject[];
  staff: readonly MappingStaffMember[];
  /** Field Control: label, visible and required per configurable field. */
  field: (key: string) => PMFieldSetting;
  onClose: () => void;
  /** Runs every rule again and writes; resolves true when saved. */
  onSave: (form: MappingForm, editing: ProjectMapping | null) => Promise<boolean>;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      {open ? (
        <WizardBody
          key={editing?.id ?? "new"}
          editing={editing}
          mappings={mappings}
          globalProjects={globalProjects}
          staff={staff}
          field={field}
          onClose={onClose}
          onSave={onSave}
        />
      ) : null}
    </Dialog>
  );
}

function WizardBody({
  editing,
  mappings,
  globalProjects,
  staff,
  field,
  onClose,
  onSave,
}: {
  editing: ProjectMapping | null;
  mappings: readonly ProjectMapping[];
  globalProjects: readonly MappingGlobalProject[];
  staff: readonly MappingStaffMember[];
  field: (key: string) => PMFieldSetting;
  onClose: () => void;
  onSave: (form: MappingForm, editing: ProjectMapping | null) => Promise<boolean>;
}) {
  const [form, setForm] = useState<MappingForm>(() => (editing ? mappingToForm(editing) : emptyMappingForm));
  const [step, setStep] = useState(0);
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof MappingForm>(key: K, value: MappingForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const globalById = useMemo(() => new Map(globalProjects.map((project) => [project.id, project])), [globalProjects]);
  const staffName = (id?: string) => staff.find((member) => member.id === id)?.name ?? "";

  /** Project details' own problems, by field — the bar for moving on. */
  const detailErrors = useMemo(() => {
    const errors = new Map<string, string>();
    for (const error of validatePmProject(form)) errors.set(error.field, error.message);
    const name = form.projectName.trim().toLowerCase();
    if (name && mappings.some((mapping) => mapping.id !== editing?.id && mapping.projectName.trim().toLowerCase() === name)) {
      errors.set("projectName", `A Project Management project named "${form.projectName.trim()}" already exists.`);
    }
    const mappedAs = mappings.find(
      (mapping) => mapping.id !== editing?.id && form.globalProjectId && mapping.globalProjectId === form.globalProjectId,
    );
    if (mappedAs) errors.set("globalProjectId", `Already mapped as "${mappedAs.projectName}". Each global project is mapped once.`);
    if (Boolean(form.startDate) !== Boolean(form.endDate) && !errors.has("endDate")) {
      errors.set(form.startDate ? "endDate" : "startDate", "Give both the start and the end date, or neither.");
    }
    // Field Control may make the optional fields required.
    for (const key of ["description", "startDate", "endDate"] as const) {
      const setting = field(key);
      if (setting.visible && setting.required && !String(form[key] ?? "").trim() && !errors.has(key)) {
        errors.set(key, `${setting.label} is required.`);
      }
    }
    return errors;
  }, [form, mappings, editing?.id, field]);
  const detailsPass = detailErrors.size === 0;

  // Blocking problems for the lifecycle the user is actually trying to save.
  const activationErrors = canActivateProject(form);
  const blockingErrors = form.lifecycle === "Active" ? activationErrors : validatePmProject(form);
  const canCreate = blockingErrors.length === 0 && detailsPass && !saving;

  const lifecycleChoices: ProjectLifecycleState[] = editing
    ? Array.from(new Set([resolveLifecycle(editing), ...nextLifecycleStates(resolveLifecycle(editing))]))
    : ["Draft", "Review"];

  const goTo = (next: number) => {
    if (next > step && step === 0 && !detailsPass) {
      setAttempted(true);
      return;
    }
    if (next > 0 && !detailsPass) {
      setAttempted(true);
      setStep(0);
      return;
    }
    setStep(Math.max(0, Math.min(WIZARD_STEPS.length - 1, next)));
  };

  const save = async () => {
    setAttempted(true);
    if (!detailsPass) {
      setStep(0);
      return;
    }
    if (blockingErrors.length > 0) return;
    setSaving(true);
    try {
      const saved = await onSave(form, editing);
      if (saved) onClose();
    } finally {
      setSaving(false);
    }
  };

  /** An error under a field: format and order problems at once, missing values after a try. */
  const errorFor = (key: string) => {
    const message = detailErrors.get(key);
    if (!message) return undefined;
    const immediate =
      (key === "endDate" && form.startDate && form.endDate) ||
      (key === "projectCode" && form.projectCode) ||
      (key === "projectName" && form.projectName.trim()) ||
      (key === "globalProjectId" && form.globalProjectId);
    return attempted || immediate ? message : undefined;
  };

  const nameSetting = field("projectName");
  const globalSetting = field("globalProjectId");
  const descriptionSetting = field("description");
  const startSetting = field("startDate");
  const endSetting = field("endDate");
  const days = durationDays(form.startDate, form.endDate);

  return (
    <DialogContent
      size="lg"
      className={cn("gap-0 p-0 sm:max-w-[40rem]", WHITE_WINDOW_CONTROLS)}
      style={{ scrollbarGutter: "auto" }}
    >
      <DialogHeader className="keep-light shrink-0 px-5 pb-4 pr-12 pt-5 text-left text-white sm:px-6 sm:pr-28" style={HEADER_STYLE}>
        <DialogTitle className="text-[19px] font-extrabold text-white">{editing ? "Edit Project" : "New Project"}</DialogTitle>
        <DialogDescription className="font-semibold text-indigo-100">
          {WIZARD_STEPS[step]} — step {step + 1} of {WIZARD_STEPS.length}
        </DialogDescription>
      </DialogHeader>

      {/* The step rail: done ✓, current, upcoming. A later step opens once Project details passes. */}
      <div className="grid shrink-0 grid-cols-1 gap-2 px-5 pt-4 sm:grid-cols-3 sm:px-6" role="tablist" aria-label="Wizard steps">
        {WIZARD_STEPS.map((label, index) => {
          const done = index < step;
          const current = index === step;
          return (
            <button
              key={label}
              type="button"
              role="tab"
              aria-selected={current}
              onClick={() => goTo(index)}
              className={cn(
                "flex items-center gap-2 rounded-[13px] border px-2.5 py-2 text-left text-xs font-extrabold transition-colors",
                current
                  ? "border-violet-200 bg-violet-50 text-violet-900"
                  : done
                    ? "border-border text-emerald-700 hover:bg-muted/50"
                    : "border-border text-muted-foreground hover:bg-muted/50",
              )}
            >
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[11px] text-white",
                  current ? "" : done ? "bg-emerald-500" : "bg-muted-foreground/40",
                )}
                style={current ? PRIMARY_GRADIENT : undefined}
                aria-hidden="true"
              >
                {done ? <Check className="h-3.5 w-3.5" /> : index + 1}
              </span>
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </div>

      <DialogBody className="mx-0 px-5 py-4 sm:px-6">
        {step === 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {nameSetting.visible ? (
              <div className="sm:col-span-2">
                <FieldLabel htmlFor="wizard-name" icon={FolderKanban} colour="#7c3aed" text={nameSetting.label} required={nameSetting.required} />
                <Input
                  id="wizard-name"
                  autoFocus
                  placeholder="For example: Project Y"
                  value={form.projectName}
                  aria-invalid={Boolean(errorFor("projectName")) || undefined}
                  className={cn(errorFor("projectName") && invalidClass)}
                  onChange={(event) => set("projectName", event.target.value)}
                />
                <FieldError message={errorFor("projectName")} />
              </div>
            ) : null}
            {globalSetting.visible ? (
              <div className="sm:col-span-2">
                <FieldLabel htmlFor="wizard-global" icon={Globe} colour="#0284c7" text={globalSetting.label} required={globalSetting.required} />
                <Select value={form.globalProjectId} onValueChange={(value) => set("globalProjectId", value)}>
                  <SelectTrigger
                    id="wizard-global"
                    aria-invalid={Boolean(errorFor("globalProjectId")) || undefined}
                    className={cn("text-left", errorFor("globalProjectId") && invalidClass)}
                  >
                    <SelectValue placeholder="Select global project" />
                  </SelectTrigger>
                  <SelectContent>
                    {globalProjects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.projectName}
                        {project.siteCode ? ` (${project.siteCode})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError message={errorFor("globalProjectId")} />
              </div>
            ) : null}
            {descriptionSetting.visible ? (
              <div className="sm:col-span-2">
                <FieldLabel
                  htmlFor="wizard-description"
                  icon={FileText}
                  colour="#64748b"
                  text={descriptionSetting.label}
                  required={descriptionSetting.required}
                />
                <Input
                  id="wizard-description"
                  placeholder="Optional description"
                  value={form.description ?? ""}
                  aria-invalid={Boolean(errorFor("description")) || undefined}
                  className={cn(errorFor("description") && invalidClass)}
                  onChange={(event) => set("description", event.target.value)}
                />
                <FieldError message={errorFor("description")} />
              </div>
            ) : null}
            {startSetting.visible ? (
              <div>
                <FieldLabel htmlFor="wizard-start" icon={CalendarDays} colour="#059669" text={startSetting.label} required={startSetting.required} />
                <Input
                  id="wizard-start"
                  type="date"
                  value={form.startDate ?? ""}
                  max={form.endDate || undefined}
                  aria-invalid={Boolean(errorFor("startDate")) || undefined}
                  className={cn(errorFor("startDate") && invalidClass)}
                  onChange={(event) => set("startDate", event.target.value)}
                />
                <FieldError message={errorFor("startDate")} />
              </div>
            ) : null}
            {endSetting.visible ? (
              <div>
                <FieldLabel htmlFor="wizard-end" icon={CalendarCheck} colour="#e11d48" text={endSetting.label} required={endSetting.required} />
                <Input
                  id="wizard-end"
                  type="date"
                  value={form.endDate ?? ""}
                  min={form.startDate || undefined}
                  aria-invalid={Boolean(errorFor("endDate")) || undefined}
                  className={cn(errorFor("endDate") && invalidClass)}
                  onChange={(event) => set("endDate", event.target.value)}
                />
                <FieldError message={errorFor("endDate")} />
              </div>
            ) : null}
            <div>
              <FieldLabel htmlFor="wizard-code" icon={Hash} colour="#d97706" text="Project Code" />
              <Input
                id="wizard-code"
                placeholder="SEL/PRJ/0031"
                value={form.projectCode ?? ""}
                aria-invalid={Boolean(errorFor("projectCode")) || undefined}
                className={cn(errorFor("projectCode") && invalidClass)}
                onChange={(event) => set("projectCode", event.target.value)}
              />
              <FieldError message={errorFor("projectCode")} />
            </div>
            <div>
              <FieldLabel htmlFor="wizard-type" icon={Tag} colour="#db2777" text="Project Type" />
              <Select value={form.projectType ?? ""} onValueChange={(value: ProjectType) => set("projectType", value)}>
                <SelectTrigger id="wizard-type" className="text-left">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {PROJECT_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {days !== null ? (
              <div className="flex sm:col-span-2">
                <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-cyan-50 px-2.5 py-0.5 text-[11.5px] font-extrabold text-cyan-800">
                  <Timer className="h-3.5 w-3.5" aria-hidden="true" />
                  {days} day{days === 1 ? "" : "s"}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 1 ? (
          <div className="space-y-5">
            <div>
              <p className="mb-1 text-xs font-extrabold text-muted-foreground">Scope</p>
              <p className="mb-2 text-xs text-muted-foreground">
                Which lanes this project actually runs. Determines which workflow a BOQ line follows and which
                sections are worth showing.
              </p>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {PROJECT_SCOPES.map((scope) => {
                  const look = SCOPE_LOOK[scope];
                  const checked = (form.scopes ?? []).includes(scope);
                  return (
                    <button
                      key={scope}
                      type="button"
                      role="checkbox"
                      aria-checked={checked}
                      onClick={() =>
                        set(
                          "scopes",
                          checked ? (form.scopes ?? []).filter((item) => item !== scope) : [...(form.scopes ?? []), scope],
                        )
                      }
                      className="flex items-center gap-3 rounded-2xl border-[1.5px] p-3.5 text-left font-extrabold transition-colors hover:bg-muted/40"
                      style={checked ? { borderColor: look.colours[1], backgroundColor: `${look.colours[1]}0f` } : undefined}
                    >
                      <span
                        className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl text-white"
                        style={{ backgroundImage: `linear-gradient(135deg, ${look.colours[0]}, ${look.colours[1]})` }}
                        aria-hidden="true"
                      >
                        <look.icon className="h-[18px] w-[18px]" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block">{scope}</span>
                        <small className="block truncate font-semibold text-muted-foreground">{look.line}</small>
                      </span>
                      <span
                        className={cn(
                          "flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px] border-2 text-white",
                          checked ? "" : "border-border",
                        )}
                        style={checked ? { backgroundColor: look.colours[1], borderColor: look.colours[1] } : undefined}
                        aria-hidden="true"
                      >
                        {checked ? <Check className="h-3.5 w-3.5" /> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel htmlFor="wizard-manager" icon={UserRound} colour="#7c3aed" text="Project Manager" />
                <Select value={form.projectManagerId ?? ""} onValueChange={(value) => set("projectManagerId", value)}>
                  <SelectTrigger id="wizard-manager" className="text-left">
                    <SelectValue placeholder="Select manager" />
                  </SelectTrigger>
                  <SelectContent>
                    {staff.map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        {personOptionLabel(member)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <FieldLabel htmlFor="wizard-site" icon={HardHat} colour="#059669" text="Site In-Charge" />
                <Select value={form.siteInChargeId ?? ""} onValueChange={(value) => set("siteInChargeId", value)}>
                  <SelectTrigger id="wizard-site" className="text-left">
                    <SelectValue placeholder="Select site in-charge" />
                  </SelectTrigger>
                  <SelectContent>
                    {staff.map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        {personOptionLabel(member)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <p className="mb-1 text-xs font-extrabold text-muted-foreground">Project Team</p>
              <p className="mb-2 text-xs text-muted-foreground">
                Referenced by user account, never copied — a rename or role change in User Management flows through
                automatically.
              </p>
              <div className="space-y-2.5">
                {PM_TEAM_ROLES.map((role) => (
                  <div key={role.key} className="rounded-xl border p-2.5">
                    <p className="mb-1.5 text-xs font-bold">{role.label}</p>
                    <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                      {staff.map((member) => {
                        const members = form.team?.[role.key as keyof PmProjectTeam] ?? [];
                        const selected = members.includes(member.id);
                        return (
                          <button
                            key={member.id}
                            type="button"
                            aria-pressed={selected}
                            onClick={() =>
                              set("team", {
                                ...form.team,
                                [role.key]: selected ? members.filter((item) => item !== member.id) : [...members, member.id],
                              })
                            }
                            className={cn(
                              "hr-inline-action rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors",
                              selected
                                ? "border-violet-200 bg-violet-50 text-violet-700"
                                : "border-border text-muted-foreground hover:bg-muted",
                            )}
                          >
                            {member.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <ReviewItem label="Project name" value={form.projectName.trim()} wide />
              <ReviewItem label="Global project" value={globalById.get(form.globalProjectId)?.projectName} />
              <ReviewItem label="Project code" value={form.projectCode?.trim()} />
              <ReviewItem label="Start date" value={formatMappingDate(form.startDate)} />
              <ReviewItem label="End date" value={formatMappingDate(form.endDate)} />
              <ReviewItem label="Project type" value={form.projectType} />
              <ReviewItem label="Scope" value={(form.scopes ?? []).join(", ")} />
              <ReviewItem label="Project manager" value={staffName(form.projectManagerId)} />
              <ReviewItem label="Site in-charge" value={staffName(form.siteInChargeId)} />
              {form.description?.trim() ? <ReviewItem label="Description" value={form.description.trim()} wide /> : null}
            </div>

            <div>
              <p className="mb-1.5 text-xs font-extrabold text-muted-foreground">Status</p>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Status">
                {lifecycleChoices.map((state) => {
                  const selected = (form.lifecycle ?? "Draft") === state;
                  return (
                    <button
                      key={state}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => set("lifecycle", state)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-extrabold transition-colors",
                        selected ? "keep-light border-transparent text-white" : "border-border text-muted-foreground hover:bg-muted",
                      )}
                      style={selected ? PRIMARY_GRADIENT : undefined}
                    >
                      {state}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Only transitions valid from the current status are offered. A new project starts as a Draft and is
                activated once it clears the checklist below.
              </p>
            </div>

            {activationErrors.length ? (
              <div
                className={cn(
                  "rounded-[14px] border px-3.5 py-3 text-xs",
                  form.lifecycle === "Active" ? "border-rose-200 bg-rose-50" : "border-amber-200 bg-amber-50",
                )}
              >
                <p className={cn("mb-1 font-extrabold", form.lifecycle === "Active" ? "text-rose-700" : "text-amber-800")}>
                  {form.lifecycle === "Active" ? "Clear these before it can go Active" : "Needed before this project can be activated"}
                </p>
                <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                  {activationErrors.map((error) => (
                    <li key={`${error.field}-${error.message}`}>{error.message}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="flex items-center gap-2.5 rounded-[14px] border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-xs font-bold text-emerald-800">
                <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
                Everything required to activate this project is in place.
              </div>
            )}
          </div>
        ) : null}
      </DialogBody>

      <DialogFooter className="justify-between gap-2 border-t border-border/60 px-5 py-3 sm:items-center sm:space-x-0 sm:px-6">
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => goTo(step - 1)} disabled={step === 0 || saving}>
            Back
          </Button>
          {step < WIZARD_STEPS.length - 1 ? (
            <Button variant="outline" onClick={() => goTo(step + 1)} disabled={saving}>
              Next
            </Button>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={() => void save()}
            disabled={!canCreate}
            className="keep-light text-white shadow-md"
            style={PRIMARY_GRADIENT}
            title={
              blockingErrors.length
                ? blockingErrors.map((error) => error.message).join(" ")
                : !detailsPass
                  ? "Complete the project details first."
                  : undefined
            }
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
            {editing ? "Save changes" : "Create Project"}
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  );
}

function ReviewItem({ label, value, wide = false }: { label: string; value?: string; wide?: boolean }) {
  return (
    <div className={cn("min-w-0 rounded-[14px] border bg-muted/40 px-3 py-2.5", wide && "sm:col-span-2")}>
      <small className="block text-[10.5px] font-extrabold uppercase tracking-wider text-muted-foreground">{label}</small>
      <b className={cn("block truncate font-extrabold", !value && "text-muted-foreground/60")} title={value || undefined}>
        {value || "—"}
      </b>
    </div>
  );
}
