"use client";

/**
 * The Survey screens as one consistent cross-link bar, mirroring JmcNav.
 *
 * Links are built through the host context, so every one carries the `?project=` handle forward.
 */

import Link from "next/link";
import { History, LayoutGrid, Ruler, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
            <Link href={context.surveyHref(screen.suffix)}>
              <Icon className="mr-1.5 h-3.5 w-3.5" />
              {screen.label}
            </Link>
          </Button>
        );
      })}
    </div>
  );
}
