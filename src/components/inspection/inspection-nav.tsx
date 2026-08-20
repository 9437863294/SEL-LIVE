"use client";

/**
 * The Inspection screens as one consistent cross-link bar, mirroring the other module navs.
 * Distinct from SupplyGateNav, which moves between supply *stages* rather than within one.
 *
 * Links are built through the host context, so every one carries the `?project=` handle forward.
 */

import { LayoutGrid, Settings, Table2 } from "lucide-react";
import { PillNav } from "@/components/shared/pill-nav";
import type { PmInspectionContext } from "@/lib/project-management-inspection-workflow";

const SCREENS = [
  { key: "hub", suffix: undefined, label: "Inspections", icon: LayoutGrid },
  { key: "register", suffix: "register", label: "Inspection Register", icon: Table2 },
  { key: "settings", suffix: "settings", label: "Settings", icon: Settings },
] as const;

export type InspectionNavKey = (typeof SCREENS)[number]["key"];

export function InspectionNav({
  context,
  active,
  /** Screens the current user may not open — rendered disabled rather than hidden, so the bar
   * keeps a stable shape between users. */
  hidden = [],
}: {
  context: PmInspectionContext;
  active: InspectionNavKey;
  hidden?: InspectionNavKey[];
}) {
  return (
    <PillNav
      label="Inspection screens"
      active={active}
      gradient="from-blue-600 to-indigo-600"
      items={SCREENS.filter((screen) => !hidden.includes(screen.key)).map((screen) => ({
        key: screen.key,
        label: screen.label,
        icon: screen.icon,
        href: context.inspectionHref(screen.suffix),
      }))}
    />
  );
}
