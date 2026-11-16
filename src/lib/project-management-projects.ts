/**
 * Project Management's own project record.
 *
 * A project exists twice, deliberately. The global `projects` collection is the company-wide master
 * shared by Billing Recon, Store & Stock, Site Fund, Vehicle Management, Insurance and others —
 * changing its shape risks every one of them, so this module never does. `projectManagementProjects`
 * is Project Management's opt-in record: it points at a global project and adds the execution
 * context that only this module needs — code, type, scopes, manager, team and lifecycle.
 *
 * Every new field is optional. Mappings created before this existed keep loading and saving
 * unchanged, and `resolveLifecycle()` derives a sensible lifecycle for them from the legacy
 * Active/Inactive flag rather than showing a blank.
 *
 * Pure (no Firebase, no React) so the validation rules are unit-testable with `node --test`.
 */

export const PM_PROJECT_COLLECTION = "projectManagementProjects";

/**
 * Draft → Review → Active is the intake path; On Hold / Completed / Closed are the exits.
 * The legacy `status: "Active" | "Inactive"` field is kept in sync by deriveLegacyStatus() because
 * the module landing page and several pickers still filter on it.
 */
export const PROJECT_LIFECYCLE_STATES = [
  "Draft",
  "Review",
  "Active",
  "On Hold",
  "Completed",
  "Closed",
] as const;
export type ProjectLifecycleState = (typeof PROJECT_LIFECYCLE_STATES)[number];

/** Which execution lanes a project actually runs. Drives which workflow a BOQ line follows and
 * which Command Center tabs are worth showing. */
export const PROJECT_SCOPES = ["Design", "Supply", "Civil", "Testing"] as const;
export type ProjectScope = (typeof PROJECT_SCOPES)[number];

export const PROJECT_TYPES = [
  "EPC",
  "Supply Only",
  "Civil Only",
  "Turnkey",
  "Rate Contract",
] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

/** Team members are referenced by `users` document id — never copied — so a rename or role change
 * in user management flows through automatically. Names are cached alongside purely for display. */
export interface PmProjectTeam {
  design?: string[];
  procurement?: string[];
  civil?: string[];
  billing?: string[];
  store?: string[];
}

export const PM_TEAM_ROLES: Array<{ key: keyof PmProjectTeam; label: string }> = [
  { key: "design", label: "Design & Engineering" },
  { key: "procurement", label: "Procurement" },
  { key: "civil", label: "Civil" },
  { key: "billing", label: "Billing" },
  { key: "store", label: "Store / Site Receipt" },
];

export interface PmProject {
  id: string;
  /* --- fields that already existed; shape unchanged --- */
  projectName: string;
  globalProjectId: string;
  globalProjectName?: string;
  globalProjectSite?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  /** Legacy flag. Still read by the landing page picker; kept in sync with `lifecycle`. */
  status: "Active" | "Inactive";
  /* --- added by the project wizard; all optional --- */
  projectCode?: string;
  projectType?: ProjectType;
  scopes?: ProjectScope[];
  projectManagerId?: string;
  projectManagerName?: string;
  siteInChargeId?: string;
  siteInChargeName?: string;
  team?: PmProjectTeam;
  lifecycle?: ProjectLifecycleState;
}

export type PmProjectDraft = Omit<PmProject, "id" | "globalProjectName" | "globalProjectSite">;

export interface PmProjectValidationError {
  field: keyof PmProjectDraft;
  message: string;
}

/**
 * The lifecycle to display. Older mappings have no `lifecycle` field, so it is inferred from the
 * legacy flag — an Active mapping reads as Active, anything else as Draft.
 */
export function resolveLifecycle(
  project: Pick<PmProject, "lifecycle" | "status">,
): ProjectLifecycleState {
  if (project.lifecycle) return project.lifecycle;
  return project.status === "Active" ? "Active" : "Draft";
}

/** Keeps the legacy Active/Inactive flag consistent with the lifecycle, so existing screens that
 * filter on `status` keep behaving correctly without needing to know lifecycle exists. */
export function deriveLegacyStatus(lifecycle: ProjectLifecycleState): "Active" | "Inactive" {
  return lifecycle === "Active" ? "Active" : "Inactive";
}

/**
 * Rules that apply at every save: a name, a global project, and well-formed dates and code when they
 * are given. Deliberately light — a project record should be able to exist, and go live, before
 * every detail is known.
 */
export function validatePmProject(draft: PmProjectDraft): PmProjectValidationError[] {
  const errors: PmProjectValidationError[] = [];

  if (!draft.projectName?.trim()) {
    errors.push({ field: "projectName", message: "Project name is required." });
  }
  if (!draft.globalProjectId) {
    errors.push({ field: "globalProjectId", message: "Select the global project to map." });
  }
  if (draft.startDate && draft.endDate && draft.endDate < draft.startDate) {
    errors.push({ field: "endDate", message: "Completion date cannot be before the start date." });
  }
  if (draft.projectCode && !/^[A-Za-z0-9/_-]+$/.test(draft.projectCode.trim())) {
    errors.push({
      field: "projectCode",
      message: "Project code may only contain letters, numbers, and - _ / characters.",
    });
  }
  return errors;
}

/**
 * What a project must have before it goes live: a name and the global project it maps to — the same
 * as any save. Everything else (code, type, scope, manager, site in-charge, dates, team) is optional
 * and can be filled in later; the user asked for that on 2026-11-16, so a project can go Active as
 * soon as it is named and mapped. Field Control can still make a field required, and the wizard and
 * Manage Projects page enforce that separately. `missingOptionalDetails` lists what is still blank,
 * for a reminder that does not block.
 */
export function canActivateProject(draft: PmProjectDraft): PmProjectValidationError[] {
  return validatePmProject(draft);
}

/** The optional details still blank, by display name, in the order the wizard asks for them. */
export function missingOptionalDetails(draft: PmProjectDraft): string[] {
  const missing: string[] = [];
  if (!draft.startDate || !draft.endDate) missing.push("Start and end dates");
  if (!draft.projectCode?.trim()) missing.push("Project code");
  if (!draft.projectType) missing.push("Project type");
  if (!draft.scopes?.length) missing.push("Scope");
  if (!draft.projectManagerId) missing.push("Project manager");
  if (!draft.siteInChargeId) missing.push("Site in-charge");
  return missing;
}

/** Whether a lifecycle transition is allowed. Status is changed through explicit actions, never by
 * editing a dropdown to an arbitrary value (§55) — so, for example, a Closed project cannot silently
 * become Active again without being reopened to On Hold first. */
const ALLOWED_TRANSITIONS: Record<ProjectLifecycleState, ProjectLifecycleState[]> = {
  Draft: ["Review", "Closed"],
  Review: ["Draft", "Active", "Closed"],
  Active: ["On Hold", "Completed", "Closed"],
  "On Hold": ["Active", "Closed"],
  Completed: ["Active", "Closed"],
  Closed: ["On Hold"],
};

export function canTransitionLifecycle(
  from: ProjectLifecycleState,
  to: ProjectLifecycleState,
): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function nextLifecycleStates(from: ProjectLifecycleState): ProjectLifecycleState[] {
  return ALLOWED_TRANSITIONS[from];
}

/** Whether a BOQ line's scope is one this project actually runs. Used to hide Command Center tabs
 * and workflow stages that will never apply. */
export function projectRunsScope(
  project: Pick<PmProject, "scopes">,
  scope: ProjectScope,
): boolean {
  // No scopes recorded (legacy mapping) means "we don't know" — show everything rather than
  // hiding lanes that may well be in use.
  if (!project.scopes?.length) return true;
  return project.scopes.includes(scope);
}

export const projectLifecycleStyles: Record<ProjectLifecycleState, string> = {
  Draft: "bg-muted text-muted-foreground",
  Review: "bg-amber-100 text-amber-700",
  Active: "bg-emerald-100 text-emerald-700",
  "On Hold": "bg-orange-100 text-orange-700",
  Completed: "bg-blue-100 text-blue-700",
  Closed: "bg-slate-200 text-slate-700",
};
