"use client";

/**
 * The Purchase Order screens as one consistent cross-link bar, mirroring the other module navs.
 *
 * Links are built through the host context, so every one carries the `?project=` handle forward.
 */

import Link from "next/link";
import { FilePlus2, LayoutGrid, Settings, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
            <Link href={context.poHref(screen.suffix)}>
              <Icon className="mr-1.5 h-3.5 w-3.5" />
              {screen.label}
            </Link>
          </Button>
        );
      })}
    </div>
  );
}
