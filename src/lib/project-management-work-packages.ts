export const WORK_PACKAGE_COLLECTION = "scopeWorkPackages";

export const WORK_PACKAGE_SCOPES = ["Civil", "Erection"] as const;
export type WorkPackageScope = (typeof WORK_PACKAGE_SCOPES)[number];

export const WORK_PACKAGE_STATUSES = [
  "Not Started",
  "In Progress",
  "Blocked",
  "On Hold",
  "Completed",
] as const;
export type WorkPackageStatus = (typeof WORK_PACKAGE_STATUSES)[number];

export const WORK_PACKAGE_PRIORITIES = ["Low", "Medium", "High", "Critical"] as const;
export type WorkPackagePriority = (typeof WORK_PACKAGE_PRIORITIES)[number];

export interface ProjectWorkPackage {
  id: string;
  scope: WorkPackageScope;
  title: string;
  description?: string;
  location?: string;
  ownerName: string;
  contractor?: string;
  priority: WorkPackagePriority;
  status: WorkPackageStatus;
  plannedStartDate: string;
  plannedEndDate: string;
  actualStartDate?: string;
  actualEndDate?: string;
  progressPct: number;
  blocker?: string;
  nextAction?: string;
  createdAt?: unknown;
  createdBy?: string;
  createdByName?: string;
  updatedAt?: unknown;
  updatedBy?: string;
  updatedByName?: string;
}

export type ProjectWorkPackageDraft = Omit<
  ProjectWorkPackage,
  "id" | "createdAt" | "createdBy" | "createdByName" | "updatedAt" | "updatedBy" | "updatedByName"
>;

export interface WorkPackageValidationError {
  field: keyof ProjectWorkPackageDraft;
  message: string;
}

export interface WorkPackageSummary {
  total: number;
  completed: number;
  blocked: number;
  overdue: number;
  dueSoon: number;
  averageProgressPct: number;
}

const parseLocalDate = (value?: string): Date | null => {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate());

export function isWorkPackageOverdue(
  workPackage: Pick<ProjectWorkPackage, "plannedEndDate" | "status">,
  today: Date = new Date(),
): boolean {
  if (workPackage.status === "Completed") return false;
  const plannedEnd = parseLocalDate(workPackage.plannedEndDate);
  return Boolean(plannedEnd && plannedEnd.getTime() < startOfDay(today).getTime());
}

export function validateWorkPackage(
  draft: ProjectWorkPackageDraft,
): WorkPackageValidationError[] {
  const errors: WorkPackageValidationError[] = [];
  if (!draft.title.trim()) errors.push({ field: "title", message: "Title is required." });
  if (!draft.ownerName.trim()) errors.push({ field: "ownerName", message: "Owner is required." });
  if (!draft.plannedStartDate) {
    errors.push({ field: "plannedStartDate", message: "Planned start date is required." });
  }
  if (!draft.plannedEndDate) {
    errors.push({ field: "plannedEndDate", message: "Planned end date is required." });
  }
  if (
    draft.plannedStartDate &&
    draft.plannedEndDate &&
    draft.plannedEndDate < draft.plannedStartDate
  ) {
    errors.push({ field: "plannedEndDate", message: "Planned end cannot be before planned start." });
  }
  if (
    draft.actualStartDate &&
    draft.actualEndDate &&
    draft.actualEndDate < draft.actualStartDate
  ) {
    errors.push({ field: "actualEndDate", message: "Actual end cannot be before actual start." });
  }
  if (!Number.isFinite(draft.progressPct) || draft.progressPct < 0 || draft.progressPct > 100) {
    errors.push({ field: "progressPct", message: "Progress must be between 0 and 100." });
  }
  if (draft.status === "Not Started" && draft.progressPct !== 0) {
    errors.push({ field: "progressPct", message: "Not Started packages must have 0% progress." });
  }
  if (draft.status === "Completed" && draft.progressPct !== 100) {
    errors.push({ field: "progressPct", message: "Completed packages must have 100% progress." });
  }
  if (draft.status === "Blocked" && !draft.blocker?.trim()) {
    errors.push({ field: "blocker", message: "Describe the blocker before marking this package Blocked." });
  }
  if (draft.status === "Completed" && !draft.actualEndDate) {
    errors.push({ field: "actualEndDate", message: "Actual end date is required for completed packages." });
  }
  return errors;
}

export function calculateWorkPackageSummary(
  workPackages: ProjectWorkPackage[],
  today: Date = new Date(),
): WorkPackageSummary {
  const currentDay = startOfDay(today);
  const dueSoonLimit = new Date(currentDay);
  dueSoonLimit.setDate(dueSoonLimit.getDate() + 14);
  const dueSoon = workPackages.filter((workPackage) => {
    if (workPackage.status === "Completed") return false;
    const end = parseLocalDate(workPackage.plannedEndDate);
    return Boolean(end && end >= currentDay && end <= dueSoonLimit);
  }).length;

  return {
    total: workPackages.length,
    completed: workPackages.filter((workPackage) => workPackage.status === "Completed").length,
    blocked: workPackages.filter((workPackage) => workPackage.status === "Blocked").length,
    overdue: workPackages.filter((workPackage) => isWorkPackageOverdue(workPackage, today)).length,
    dueSoon,
    averageProgressPct: workPackages.length
      ? Math.round(
          workPackages.reduce((sum, workPackage) => sum + workPackage.progressPct, 0) /
            workPackages.length,
        )
      : 0,
  };
}
