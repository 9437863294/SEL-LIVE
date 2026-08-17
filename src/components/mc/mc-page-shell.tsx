"use client";

/**
 * Page furniture for the Manufacturing Clearance screens.
 *
 * The parts themselves are Project Management's, not JMC's — jmc-page-shell.tsx just happens to be
 * where they were first factored out. Re-exported under MC names with the MC accent so these screens
 * compose from the same furniture rather than a sixth hand-copy that drifts.
 */

export {
  JmcPageShell as McPageShell,
  JmcPageHeader as McPageHeader,
  JmcLoadingState as McLoadingState,
  JmcCardGridLoadingState as McCardGridLoadingState,
  JmcAccessDenied as McAccessDenied,
  JmcProjectNotFound as McProjectNotFound,
  JmcNavCard as McNavCard,
  JmcNavCardGrid as McNavCardGrid,
} from "@/components/jmc/jmc-page-shell";

/** The MC accent — matching the Manufacturing Clearance tile on the Supply hub. */
export const MC_GRADIENT = "from-lime-500 to-green-600";
/** Settings screens use the slate accent Project Management gives every settings surface. */
export const MC_SETTINGS_GRADIENT = "from-slate-500 to-slate-700";
