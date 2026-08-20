"use client";

/**
 * The Survey screens as one consistent cross-link bar, mirroring JmcNav.
 *
 * Links are built through the host context, so every one carries the `?project=` handle forward.
 */

import { History, LayoutGrid, Ruler, Settings } from "lucide-react";
import { PillNav } from "@/components/shared/pill-nav";
import type { PmSurveyContext } from "@/lib/project-management-survey-workflow";

const SCREENS = [
  { key: "hub", suffix: undefined, label: "Survey", icon: LayoutGrid },
  { key: "record", suffix: "record", label: "Record Survey", icon: Ruler },
  { key: "log", suffix: "log", label: "Survey Log", icon: History },
  { key: "settings", suffix: "settings", label: "Settings", icon: Settings },
] as const;

export type SurveyNavKey = (typeof SCREENS)[number]["key"];

export function SurveyNav({
  context,
  active,
  /** Screens the current user may not open — rendered disabled rather than hidden, so the bar
   * keeps a stable shape between users. */
  hidden = [],
}: {
  context: PmSurveyContext;
  active: SurveyNavKey;
  hidden?: SurveyNavKey[];
}) {
  return (
    <PillNav
      label="Survey screens"
      active={active}
      gradient="from-cyan-600 to-sky-600"
      items={SCREENS.filter((screen) => !hidden.includes(screen.key)).map((screen) => ({
        key: screen.key,
        label: screen.label,
        icon: screen.icon,
        href: context.surveyHref(screen.suffix),
      }))}
    />
  );
}
