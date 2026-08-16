/**
 * The Requirement Planner — narrowest useful slice of the spec's §3.2: a BOQ-driven grid showing
 * what's left to indent and when it needs to be indented by, computed backward from a per-item
 * "required at site" date. Stock/surplus/in-transit/free-issue columns are intentionally omitted
 * (that needs integration with the separate Store & Stock Management module, out of scope here).
 * Net requirement deliberately excludes the overrun tolerance: tolerance is an approval ceiling,
 * not demand, and including it would recommend over-procurement on every BOQ line.
 */

export const DEFAULT_LEAD_TIME_DAYS = 45;

export const REQUIREMENT_PLANNER_PERMISSION_RESOURCE = "Project Management.Requirement Planner";

export const REQUIREMENT_STATUSES = ["Not Scheduled", "Late", "Due Soon", "Clear", "Fully Indented"] as const;
export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];

const DUE_SOON_WINDOW_DAYS = 14;

/** Indent-by date = required-at-site date minus the (configurable) total procurement lead time. */
export function computeIndentByDate(requiredAtSiteDate: string, leadTimeDays: number): string | null {
  if (!requiredAtSiteDate) return null;
  const date = new Date(`${requiredAtSiteDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() - leadTimeDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function classifyRequirementStatus(
  netRequirement: number,
  indentByDate: string | null,
  today: Date = new Date(),
): { status: RequirementStatus; slippageDays: number } {
  if (netRequirement <= 0) return { status: "Fully Indented", slippageDays: 0 };
  if (!indentByDate) return { status: "Not Scheduled", slippageDays: 0 };

  const indentBy = new Date(`${indentByDate}T00:00:00`);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffDays = Math.round((indentBy.getTime() - startOfToday.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return { status: "Late", slippageDays: -diffDays };
  if (diffDays <= DUE_SOON_WINDOW_DAYS) return { status: "Due Soon", slippageDays: 0 };
  return { status: "Clear", slippageDays: 0 };
}

export const requirementStatusStyles: Record<RequirementStatus, string> = {
  "Not Scheduled": "bg-muted text-muted-foreground",
  Late: "bg-red-100 text-red-700",
  "Due Soon": "bg-amber-100 text-amber-700",
  Clear: "bg-emerald-100 text-emerald-700",
  "Fully Indented": "bg-slate-100 text-slate-600",
};
