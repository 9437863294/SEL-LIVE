"use client";

/**
 * The Indent screens as one consistent cross-link bar, mirroring JmcNav and SurveyNav.
 *
 * Links are built through the host context, so every one carries the `?project=` handle forward.
 */

import { FilePlus2, LayoutGrid, ListChecks, Settings } from "lucide-react";
import { PillNav } from "@/components/shared/pill-nav";
import type { PmIndentContext } from "@/lib/project-management-indent-workflow";

const SCREENS = [
  { key: "hub", suffix: undefined, label: "Indent", icon: LayoutGrid },
  { key: "register", suffix: "register", label: "Indent Register", icon: ListChecks },
  { key: "new", suffix: "new", label: "New Indent", icon: FilePlus2 },
  { key: "settings", suffix: "settings", label: "Settings", icon: Settings },
] as const;

export type IndentNavKey = (typeof SCREENS)[number]["key"];

export function IndentNav({
  context,
  active,
  /** Screens the current user may not open — rendered disabled rather than hidden, so the bar
   * keeps a stable shape between users. */
  hidden = [],
}: {
  context: PmIndentContext;
  active: IndentNavKey;
  hidden?: IndentNavKey[];
}) {
  return (
    <PillNav
      label="Indent screens"
      active={active}
      gradient="from-amber-600 to-orange-600"
      items={SCREENS.filter((screen) => !hidden.includes(screen.key)).map((screen) => ({
        key: screen.key,
        label: screen.label,
        icon: screen.icon,
        href: context.indentHref(screen.suffix),
      }))}
    />
  );
}
