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

import Link from "next/link";
import { BarChart3, FilePlus, History, LayoutGrid, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
    <div className="flex flex-wrap items-center gap-2">
      {SCREENS.filter((screen) => !hidden.includes(screen.key)).map((screen) => {
        const Icon = screen.icon;
        const isActive = screen.key === active;
        return (
          <Button
            key={screen.key}
            variant={isActive ? "default" : "outline"}
            size="sm"
            asChild
            className={cn(isActive && "pointer-events-none")}
          >
            <Link href={context.jmcHref(screen.suffix)}>
              <Icon className="mr-1.5 h-3.5 w-3.5" />
              {screen.label}
            </Link>
          </Button>
        );
      })}
    </div>
  );
}
