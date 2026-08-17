"use client";

/**
 * Page furniture for the Purchase Order screens.
 *
 * The parts themselves are Project Management's, not JMC's — jmc-page-shell.tsx just happens to be
 * where they were first factored out. Re-exported under PO names with the PO accent so these
 * screens compose from the same furniture rather than a fifth hand-copy that drifts.
 */

export {
  JmcPageShell as PoPageShell,
  JmcPageHeader as PoPageHeader,
  JmcLoadingState as PoLoadingState,
  JmcCardGridLoadingState as PoCardGridLoadingState,
  JmcAccessDenied as PoAccessDenied,
  JmcProjectNotFound as PoProjectNotFound,
  JmcNavCard as PoNavCard,
  JmcNavCardGrid as PoNavCardGrid,
} from "@/components/jmc/jmc-page-shell";

/** The PO accent — matching the Purchase Orders tile on the Supply hub. */
export const PO_GRADIENT = "from-emerald-500 to-teal-600";
/** Settings screens use the slate accent Project Management gives every settings surface. */
export const PO_SETTINGS_GRADIENT = "from-slate-500 to-slate-700";
