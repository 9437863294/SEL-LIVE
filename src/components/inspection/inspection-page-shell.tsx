"use client";

/**
 * Page furniture for the Inspection screens.
 *
 * The parts themselves are Project Management's, not JMC's — jmc-page-shell.tsx just happens to be
 * where they were first factored out. Re-exported under Inspection names with the Inspection accent
 * so these screens compose from the same furniture rather than a seventh hand-copy that drifts.
 */

export {
  JmcPageShell as InspectionPageShell,
  JmcPageHeader as InspectionPageHeader,
  JmcLoadingState as InspectionLoadingState,
  JmcCardGridLoadingState as InspectionCardGridLoadingState,
  JmcAccessDenied as InspectionAccessDenied,
  JmcProjectNotFound as InspectionProjectNotFound,
  JmcNavCard as InspectionNavCard,
  JmcNavCardGrid as InspectionNavCardGrid,
} from "@/components/jmc/jmc-page-shell";

/** The Inspection accent — matching the Inspections tile on the Supply hub. */
export const INSPECTION_GRADIENT = "from-blue-500 to-indigo-600";
/** Settings screens use the slate accent Project Management gives every settings surface. */
export const INSPECTION_SETTINGS_GRADIENT = "from-slate-500 to-slate-700";
