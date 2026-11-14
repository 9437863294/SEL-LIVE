"use client";

/**
 * The Project Management Settings hub, as the user's mock-up (`sel-pm-projects-settings`, `v-hub`)
 * draws it: the violet band with a "Find a setting" search and a quick-link chip per setting, then
 * one tile per setting — a gradient band with its number, the setting's icon overlapping it, what
 * it does, and "Open →".
 *
 * A settings hub is the one place link cards belong (the module's sidebar carries a single
 * Settings entry). Presentational only: the page checks the permission and hands in the back arrow.
 */

import { useMemo, useState, type MouseEvent } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Building2,
  ClipboardList,
  FolderCog,
  Search,
  Settings2,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import {
  HERO_SEARCH_INPUT,
  HeroBand,
  HeroChips,
} from "@/components/project-management/hero-band";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface PmSettingsSection {
  key: string;
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  /** The tile's band, light to dark. */
  colours: readonly [string, string];
}

/** "#7c3aed" → "124, 58, 237". */
const rgbOf = (hex: string): string => {
  const value = hex.replace("#", "");
  const n = Number.parseInt(value, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
};

// Variation Orders is not here: approving one changes a BOQ quantity, so the register sits under
// BOQ (`/project-management/boq/variation-orders`). Only its tolerance is a setting, on General.
export const PM_SETTINGS_SECTIONS: readonly PmSettingsSection[] = [
  {
    key: "projects",
    title: "Manage Projects",
    description: "Create Project Management projects and map them to global projects.",
    href: "/project-management/settings/projects",
    icon: FolderCog,
    colours: ["#93c5fd", "#2563eb"],
  },
  {
    key: "clients",
    title: "Clients",
    description: "Manage the paying customers projects are executed for.",
    href: "/project-management/settings/clients",
    icon: Building2,
    colours: ["#a5b4fc", "#4f46e5"],
  },
  {
    key: "general",
    title: "General Settings",
    description: "Configure general defaults for Project Management.",
    href: "/project-management/settings/general",
    icon: Settings2,
    colours: ["#94a3b8", "#334155"],
  },
  {
    key: "boq",
    title: "BOQ Settings",
    description: "Configure BOQ behavior, defaults, and future custom fields.",
    href: "/project-management/settings/boq",
    icon: ClipboardList,
    colours: ["#d8b4fe", "#9333ea"],
  },
  {
    key: "field-control",
    title: "Field Control",
    description: "Show, hide, rename, or require fields across BOQ, Indent, RFQ, PO, and project mapping forms.",
    href: "/project-management/settings/field-control",
    icon: SlidersHorizontal,
    colours: ["#7dd3fc", "#0284c7"],
  },
];

const TILE_BAND_DOTS = {
  backgroundImage: "radial-gradient(rgba(255, 255, 255, 0.15) 1.2px, transparent 1.2px)",
  backgroundSize: "16px 16px",
  WebkitMaskImage: "linear-gradient(120deg, transparent 30%, #000)",
  maskImage: "linear-gradient(120deg, transparent 30%, #000)",
} as const;

export function PmSettingsHubView({
  back,
  sections = PM_SETTINGS_SECTIONS,
}: {
  /** The band's back arrow — `useBackNavigation(...)`'s result. */
  back: { href: string; label: string; onClick?: (event: MouseEvent<HTMLAnchorElement>) => void };
  sections?: readonly PmSettingsSection[];
}) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return sections.map((section, index) => ({ section, number: index + 1 }));
    return sections
      .map((section, index) => ({ section, number: index + 1 }))
      .filter(({ section }) => `${section.title} ${section.description}`.toLowerCase().includes(needle));
  }, [sections, query]);

  return (
    <main className="min-h-[calc(100dvh-4rem)] space-y-4 p-4 sm:p-6">
      <HeroBand
        band="violet"
        back={back}
        icon={Settings2}
        crumbs={[{ label: "Project Management", href: "/project-management" }]}
        title="Project Management Settings"
        description="Manage projects and configure module-wide behavior"
        actions={
          <label className="relative block w-full min-w-0 sm:w-[300px]">
            <span className="sr-only">Find a setting</span>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-violet-200"
              aria-hidden="true"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a setting…"
              className={HERO_SEARCH_INPUT}
            />
          </label>
        }
      >
        <HeroChips
          items={sections.map((section) => ({
            key: section.key,
            label: section.title,
            icon: section.icon,
            colours: section.colours,
            href: section.href,
          }))}
        />
      </HeroBand>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6" aria-label="Settings">
        {shown.length === 0 ? (
          <div className="col-span-full rounded-[22px] border border-dashed border-border bg-card px-5 py-12 text-center font-semibold text-muted-foreground">
            No setting matches “{query.trim()}”.
          </div>
        ) : (
          shown.map(({ section, number }, index) => {
            const [from, to] = section.colours;
            const rgb = rgbOf(to);
            const Icon = section.icon;
            return (
              <Link
                key={section.key}
                href={section.href}
                className={cn(
                  "group relative flex min-w-0 flex-col overflow-hidden rounded-[22px] border border-border/60 bg-card text-left no-underline shadow-sm transition-[transform,box-shadow] duration-200 hover:-translate-y-[3px] hover:shadow-lg focus-visible:-translate-y-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  index < 3 ? "xl:col-span-2" : "xl:col-span-3",
                )}
              >
                <div
                  className="keep-light relative h-[92px] shrink-0"
                  style={{
                    backgroundImage: `radial-gradient(220px 120px at 100% 0%, rgba(255, 255, 255, 0.33), transparent 70%), linear-gradient(135deg, ${from}, ${to})`,
                  }}
                >
                  <span className="pointer-events-none absolute inset-0" style={TILE_BAND_DOTS} aria-hidden="true" />
                  <span className="absolute right-[18px] top-3.5 z-[1] rounded-full border border-white/35 bg-white/20 px-2.5 py-0.5 text-xs font-extrabold tabular-nums text-white">
                    {String(number).padStart(2, "0")}
                  </span>
                  <span
                    className="absolute -bottom-[26px] left-5 z-[1] flex h-[58px] w-[58px] items-center justify-center rounded-[18px] border bg-card shadow-lg"
                    style={{ color: to, borderColor: `rgba(${rgb}, 0.18)` }}
                    aria-hidden="true"
                  >
                    <Icon className="h-[26px] w-[26px]" />
                  </span>
                </div>
                <div className="flex flex-1 flex-col gap-1.5 px-5 pb-[18px] pt-[38px]">
                  <b className="text-[16.5px] font-extrabold tracking-tight text-foreground">{section.title}</b>
                  <span className="text-[13px] leading-relaxed text-muted-foreground">{section.description}</span>
                  <span className="mt-auto flex items-center gap-2 pt-3 text-[12.5px] font-extrabold" style={{ color: to }}>
                    Open
                    <span
                      className="flex h-[30px] w-[30px] items-center justify-center rounded-[10px] transition-transform duration-200 group-hover:translate-x-[3px]"
                      style={{ backgroundColor: `rgba(${rgb}, 0.1)` }}
                      aria-hidden="true"
                    >
                      <ArrowRight className="h-[15px] w-[15px]" />
                    </span>
                  </span>
                </div>
              </Link>
            );
          })
        )}
      </section>
    </main>
  );
}
