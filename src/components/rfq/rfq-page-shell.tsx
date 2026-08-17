"use client";

/**
 * Page furniture for the RFQ screens.
 *
 * The parts themselves are Project Management's, not JMC's — jmc-page-shell.tsx just happens to be
 * where they were first factored out. Re-exported under RFQ names with RFQ's accent so these
 * screens compose from the same furniture rather than a fourth hand-copy that drifts.
 */

export {
  JmcPageShell as RfqPageShell,
  JmcPageHeader as RfqPageHeader,
  JmcLoadingState as RfqLoadingState,
  JmcCardGridLoadingState as RfqCardGridLoadingState,
  JmcAccessDenied as RfqAccessDenied,
  JmcProjectNotFound as RfqProjectNotFound,
  JmcNavCard as RfqNavCard,
  JmcNavCardGrid as RfqNavCardGrid,
} from "@/components/jmc/jmc-page-shell";

/** RFQ's accent — matching the RFQ tile on the Supply hub. */
export const RFQ_GRADIENT = "from-violet-500 to-purple-600";
/** Settings screens use the slate accent Project Management gives every settings surface. */
export const RFQ_SETTINGS_GRADIENT = "from-slate-500 to-slate-700";
