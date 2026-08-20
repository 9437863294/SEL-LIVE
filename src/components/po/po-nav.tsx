"use client";

/**
 * The Purchase Order screens as one consistent cross-link bar, mirroring the other module navs.
 *
 * Links are built through the host context, so every one carries the `?project=` handle forward.
 */

import { FilePlus2, LayoutGrid, Settings, Table2 } from "lucide-react";
import { PillNav } from "@/components/shared/pill-nav";
import type { PmPoContext } from "@/lib/project-management-po-workflow";

const SCREENS = [
  { key: "hub", suffix: undefined, label: "Purchase Orders", icon: LayoutGrid },
  { key: "register", suffix: "register", label: "PO Register", icon: Table2 },
  { key: "new", suffix: "new", label: "New PO", icon: FilePlus2 },
  { key: "settings", suffix: "settings", label: "Settings", icon: Settings },
] as const;

export type PoNavKey = (typeof SCREENS)[number]["key"];

export function PoNav({
  context,
  active,
  /** Screens the current user may not open — rendered disabled rather than hidden, so the bar
   * keeps a stable shape between users. */
  hidden = [],
}: {
  context: PmPoContext;
  active: PoNavKey;
  hidden?: PoNavKey[];
}) {
  return (
    <PillNav
      label="Purchase Order screens"
      active={active}
      gradient="from-emerald-600 to-teal-600"
      items={SCREENS.filter((screen) => !hidden.includes(screen.key)).map((screen) => ({
        key: screen.key,
        label: screen.label,
        icon: screen.icon,
        href: context.poHref(screen.suffix),
      }))}
    />
  );
}
