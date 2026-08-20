"use client";

/**
 * The Manufacturing Clearance screens as one consistent cross-link bar, mirroring the other module
 * navs. Distinct from SupplyGateNav, which moves between supply *stages* rather than within one.
 *
 * Links are built through the host context, so every one carries the `?project=` handle forward.
 */

import { LayoutGrid, Settings, Table2 } from "lucide-react";
import { PillNav } from "@/components/shared/pill-nav";
import type { PmMcContext } from "@/lib/project-management-mc-workflow";

const SCREENS = [
  { key: "hub", suffix: undefined, label: "Manufacturing Clearance", icon: LayoutGrid },
  { key: "register", suffix: "register", label: "MC Register", icon: Table2 },
  { key: "settings", suffix: "settings", label: "Settings", icon: Settings },
] as const;

export type McNavKey = (typeof SCREENS)[number]["key"];

export function McNav({
  context,
  active,
  /** Screens the current user may not open — rendered disabled rather than hidden, so the bar
   * keeps a stable shape between users. */
  hidden = [],
}: {
  context: PmMcContext;
  active: McNavKey;
  hidden?: McNavKey[];
}) {
  return (
    <PillNav
      label="Manufacturing Clearance screens"
      active={active}
      gradient="from-lime-600 to-green-600"
      items={SCREENS.filter((screen) => !hidden.includes(screen.key)).map((screen) => ({
        key: screen.key,
        label: screen.label,
        icon: screen.icon,
        href: context.mcHref(screen.suffix),
      }))}
    />
  );
}
