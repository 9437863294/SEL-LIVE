"use client";

/**
 * The Reports screen's headline band, from the user's mock-up (`sel-dpr-reports-manpower-colour`):
 * a violet-to-teal band carrying the back arrow, where the page sits, the title, the export
 * button, and the five reports as tabs. It carries `keep-light`, so the dark-compat layer leaves
 * its white text and translucent chips alone; it reads the same in both themes.
 *
 * Colours are plain rgba — no color-mix(), which Chrome 109 (the Windows 7 PCs) drops silently.
 */

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, type LucideIcon } from "lucide-react";
import { useBackNavigation } from "@/hooks/use-back-navigation";
import { DPR_BASE_PATH } from "@/lib/project-management-dpr";
import { dprHref } from "@/components/project-management/dpr/dpr-shell";
import { cn } from "@/lib/utils";

export interface DprReportTab<Id extends string> {
  id: Id;
  label: string;
  icon: LucideIcon;
  /** The tab's chip, light to dark. */
  colours: readonly [string, string];
}

const BAND = {
  backgroundImage: [
    "radial-gradient(520px 230px at 92% 0%, rgba(251, 191, 36, 0.63), transparent 65%)",
    "radial-gradient(520px 260px at 40% 140%, rgba(236, 72, 153, 0.63), transparent 65%)",
    "linear-gradient(115deg, #4c1d95, #7c3aed 45%, #0e7490)",
  ].join(", "),
} as const;

const DOTS = {
  backgroundImage: "radial-gradient(rgba(255, 255, 255, 0.08) 1px, transparent 1px)",
  backgroundSize: "18px 18px",
  WebkitMaskImage: "linear-gradient(90deg, transparent, #000 70%)",
  maskImage: "linear-gradient(90deg, transparent, #000 70%)",
} as const;

export function DprReportsHero<Id extends string>({
  mappingId,
  projectName,
  title,
  description,
  icon: Icon,
  tabs,
  active,
  onTabChange,
  actions,
}: {
  mappingId: string;
  projectName: string;
  title: string;
  description: string;
  icon: LucideIcon;
  tabs: readonly DprReportTab<Id>[];
  active: Id;
  onTabChange: (next: Id) => void;
  actions?: ReactNode;
}) {
  const back = useBackNavigation(dprHref("/project-management", mappingId), {
    fallbackLabel: "Project Management",
  });
  return (
    <section
      className="keep-light relative overflow-hidden rounded-3xl px-4 pb-4 pt-4 text-white shadow-sm sm:px-6 sm:pb-5 sm:pt-5"
      style={BAND}
    >
      <div className="pointer-events-none absolute inset-0" style={DOTS} aria-hidden="true" />
      <div className="relative flex flex-wrap items-center gap-3">
        <Link
          href={back.href}
          onClick={back.onClick}
          aria-label={back.label}
          title={back.label}
          className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl border border-white/25 bg-white/10 transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </Link>
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/30 bg-white/15"
          aria-hidden="true"
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1 basis-[16rem]">
          <nav aria-label="Breadcrumb" className="truncate text-[11px] font-bold tracking-[0.06em] text-violet-200">
            <Link href="/project-management" className="hover:text-white hover:underline">
              Project Management
            </Link>
            {" / "}
            <Link href={dprHref(DPR_BASE_PATH, mappingId)} className="hover:text-white hover:underline">
              Daily Progress
            </Link>
            {" / "}
            <span>{projectName || "Project"}</span>
          </nav>
          <h1 className="mt-px text-2xl font-extrabold leading-tight tracking-tight">{title}</h1>
          <p className="text-[12.5px] text-indigo-100">{description}</p>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>

      <div className="relative mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Reports">
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
                requestAnimationFrame(() =>
                  strip?.querySelector<HTMLElement>(`[data-tab="${next.id}"]`)?.focus(),
                );
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
    </section>
  );
}
