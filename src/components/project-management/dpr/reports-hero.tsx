"use client";

/**
 * The Daily Progress screens' headline band: the shared Project Management `HeroBand` with the
 * module's breadcrumb (Project Management / Daily Progress / project) and, where a screen has
 * views, those views as tabs (keyboard: arrow keys move between them, focus follows).
 */

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { useBackNavigation } from "@/hooks/use-back-navigation";
import { DPR_BASE_PATH } from "@/lib/project-management-dpr";
import { dprHref } from "@/components/project-management/dpr/dpr-shell";
import {
  HERO_PRIMARY_BUTTON,
  HERO_SECONDARY_BUTTON,
  HeroBand,
  type HeroBandColour,
} from "@/components/project-management/hero-band";
import { cn } from "@/lib/utils";

export interface DprReportTab<Id extends string> {
  id: Id;
  label: string;
  icon: LucideIcon;
  /** The tab's chip, light to dark. */
  colours: readonly [string, string];
}

export type DprHeroBand = Extract<HeroBandColour, "violet" | "cyan" | "rose">;

/** The band's own buttons: the white main action, and a translucent second one beside it. */
export const DPR_HERO_PRIMARY = HERO_PRIMARY_BUTTON;
export const DPR_HERO_SECONDARY = HERO_SECONDARY_BUTTON;

export function DprReportsHero<Id extends string = string>({
  mappingId,
  projectName,
  title,
  description,
  icon,
  tabs,
  active,
  onTabChange,
  actions,
  band = "violet",
}: {
  mappingId: string;
  projectName: string;
  title: string;
  description: string;
  icon: LucideIcon;
  /** The screen's views; a page with one view leaves them out. */
  tabs?: readonly DprReportTab<Id>[];
  active?: Id;
  onTabChange?: (next: Id) => void;
  actions?: ReactNode;
  band?: DprHeroBand;
}) {
  const back = useBackNavigation(dprHref("/project-management", mappingId), {
    fallbackLabel: "Project Management",
  });
  const showTabs = Boolean(tabs && tabs.length > 0 && active !== undefined && onTabChange);
  return (
    <HeroBand
      back={back}
      icon={icon}
      crumbs={[
        { label: "Project Management", href: "/project-management" },
        { label: "Daily Progress", href: dprHref(DPR_BASE_PATH, mappingId) },
        { label: projectName || "Project" },
      ]}
      title={title}
      description={description}
      actions={actions}
      band={band}
    >
      {showTabs && tabs && onTabChange ? (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label={`${title} views`}>
          {tabs.map((tab) => {
            const selected = tab.id === active;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => onTabChange(tab.id)}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
                  event.preventDefault();
                  const strip = event.currentTarget.parentElement;
                  const index = tabs.findIndex((candidate) => candidate.id === tab.id);
                  const next = tabs[(index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
                  onTabChange(next.id);
                  // Focus follows the selection, as in any tab strip.
                  requestAnimationFrame(() => strip?.querySelector<HTMLElement>(`[data-tab="${next.id}"]`)?.focus());
                }}
                data-tab={tab.id}
                className={cn(
                  "flex items-center gap-2 rounded-[13px] border py-1.5 pl-1.5 pr-3.5 text-sm font-bold backdrop-blur transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
                  selected
                    ? "border-white bg-white text-slate-900 shadow-lg"
                    : "border-white/25 bg-white/10 text-white hover:bg-white/20",
                )}
              >
                <span
                  className="flex h-7 w-7 items-center justify-center rounded-[9px] text-white"
                  style={{ backgroundImage: `linear-gradient(140deg, ${tab.colours[0]}, ${tab.colours[1]})` }}
                  aria-hidden="true"
                >
                  <tab.icon className="h-[15px] w-[15px]" />
                </span>
                {tab.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </HeroBand>
  );
}
