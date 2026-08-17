"use client";

/**
 * Page furniture for the Survey screens.
 *
 * The parts themselves (header row, shell, loading shapes, denied / no-project cards, nav tiles)
 * are Project Management's, not JMC's — jmc-page-shell.tsx just happens to be where they were
 * first factored out. Re-exported under Survey names with Survey's accent so these screens compose
 * from the same furniture without a second hand-copy that drifts from the original.
 */

export {
  JmcPageShell as SurveyPageShell,
  JmcPageHeader as SurveyPageHeader,
  JmcLoadingState as SurveyLoadingState,
  JmcCardGridLoadingState as SurveyCardGridLoadingState,
  JmcAccessDenied as SurveyAccessDenied,
  JmcProjectNotFound as SurveyProjectNotFound,
  JmcNavCard as SurveyNavCard,
  JmcNavCardGrid as SurveyNavCardGrid,
  JMC_MAIN_CLASS as SURVEY_MAIN_CLASS,
} from "@/components/jmc/jmc-page-shell";

/** Survey's accent — the rose/pink the Survey tile already uses on the Supply hub. */
export const SURVEY_GRADIENT = "from-rose-500 to-pink-600";
/** Settings screens use the slate accent Project Management gives every settings surface. */
export const SURVEY_SETTINGS_GRADIENT = "from-slate-500 to-slate-700";
