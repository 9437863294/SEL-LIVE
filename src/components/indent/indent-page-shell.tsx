"use client";

/**
 * Page furniture for the Indent screens.
 *
 * The parts themselves are Project Management's, not JMC's — jmc-page-shell.tsx just happens to be
 * where they were first factored out. Re-exported under Indent names with Indent's accent so these
 * screens compose from the same furniture rather than a third hand-copy that drifts.
 */

export {
  JmcPageShell as IndentPageShell,
  JmcPageHeader as IndentPageHeader,
  JmcLoadingState as IndentLoadingState,
  JmcCardGridLoadingState as IndentCardGridLoadingState,
  JmcAccessDenied as IndentAccessDenied,
  JmcProjectNotFound as IndentProjectNotFound,
  JmcNavCard as IndentNavCard,
  JmcNavCardGrid as IndentNavCardGrid,
} from "@/components/jmc/jmc-page-shell";

/** Indent's accent — the amber the Indent tile already uses on the Supply hub. */
export const INDENT_GRADIENT = "from-amber-500 to-orange-600";
/** Settings screens use the slate accent Project Management gives every settings surface. */
export const INDENT_SETTINGS_GRADIENT = "from-slate-500 to-slate-700";
