"use client";

/**
 * The JMC screens as one consistent cross-link bar, mirroring SupplyGateNav on the supply side.
 *
 * Billing Recon's JMC screens are reached only by going back to the hub and picking another tile.
 * Project Management's operational screens instead carry a persistent bar so moving between
 * related screens is one click — this is the JMC equivalent, rendered under the page header on
 * every JMC screen.
 *
 * Links are built through the host context, so every one carries the `?project=` handle forward.
 */

import { BarChart3, FilePlus, History, LayoutGrid, Settings } from "lucide-react";
import { PillNav } from "@/components/shared/pill-nav";
import type { PmJmcContext } from "@/lib/jmc-module";

const SCREENS = [
  { key: "hub", suffix: undefined, label: "JMC", icon: LayoutGrid },
  { key: "entry", suffix: "entry", label: "Create JMC", icon: FilePlus },
  { key: "log", suffix: "log", label: "JMC Log", icon: History },
  { key: "reports", suffix: "reports", label: "Reports", icon: BarChart3 },
  { key: "settings", suffix: "settings", label: "Settings", icon: Settings },
] as const;

export type JmcNavKey = (typeof SCREENS)[number]["key"];

export function JmcNav({
  context,
  active,
  /** Screens the current user may not open — rendered disabled rather than hidden, so the bar
   * keeps a stable shape between users. */
  hidden = [],
}: {
  context: PmJmcContext;
  active: JmcNavKey;
  hidden?: JmcNavKey[];
}) {
  return (
    <PillNav
      label="JMC screens"
      active={active}
      gradient="from-orange-600 to-amber-600"
      items={SCREENS.filter((screen) => !hidden.includes(screen.key)).map((screen) => ({
        key: screen.key,
        label: screen.label,
        icon: screen.icon,
        href: context.jmcHref(screen.suffix),
      }))}
    />
  );
}
