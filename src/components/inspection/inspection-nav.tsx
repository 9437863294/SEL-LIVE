"use client";

/**
 * The Inspection screens as one consistent cross-link bar, mirroring the other module navs.
 * Distinct from SupplyGateNav, which moves between supply *stages* rather than within one.
 *
 * Links are built through the host context, so every one carries the `?project=` handle forward.
 */

import Link from "next/link";
import { LayoutGrid, Settings, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
            <Link href={context.inspectionHref(screen.suffix)}>
              <Icon className="mr-1.5 h-3.5 w-3.5" />
              {screen.label}
            </Link>
          </Button>
        );
      })}
    </div>
  );
}
