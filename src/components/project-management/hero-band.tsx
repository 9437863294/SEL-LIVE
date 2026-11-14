"use client";

/**
 * The headline band of the Project Management screens, from the user's mock-ups
 * (`sel-dpr-reports-colour`, `sel-projections-colour`, `sel-dpr-register-log-settings`,
 * `sel-pm-projects-settings`): a gradient band carrying the back arrow, where the page sits, the
 * title and its line, the page's actions, and an optional row under them (view tabs, a search,
 * quick links).
 *
 * It carries `keep-light`, so the dark-compat layer leaves its white text and translucent chips
 * alone; it reads the same in both themes. Colours are plain rgba — no color-mix(), which Chrome 109
 * (the Windows 7 PCs) drops silently.
 */

import type { MouseEvent, ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** The band's colourings, one per screen family in the mock-ups. */
export const HERO_BANDS = {
  /** Reports, Projections, Log — violet into teal. */
  violet: [
    "radial-gradient(520px 230px at 92% 0%, rgba(251, 191, 36, 0.63), transparent 65%)",
    "radial-gradient(520px 260px at 40% 140%, rgba(236, 72, 153, 0.63), transparent 65%)",
    "linear-gradient(115deg, #4c1d95, #7c3aed 45%, #0e7490)",
  ],
  /** DPR BOQ register. */
  cyan: [
    "radial-gradient(520px 230px at 92% 0%, rgba(34, 211, 238, 0.63), transparent 65%)",
    "radial-gradient(520px 260px at 40% 140%, rgba(167, 139, 250, 0.63), transparent 65%)",
    "linear-gradient(115deg, #164e63, #0891b2 45%, #6d28d9)",
  ],
  /** DPR Settings. */
  rose: [
    "radial-gradient(520px 230px at 92% 0%, rgba(251, 113, 133, 0.63), transparent 65%)",
    "radial-gradient(520px 260px at 40% 140%, rgba(251, 191, 36, 0.63), transparent 65%)",
    "linear-gradient(115deg, #831843, #db2777 45%, #7c3aed)",
  ],
  /** Projects register. */
  indigo: [
    "radial-gradient(520px 230px at 92% 0%, rgba(52, 211, 153, 0.63), transparent 65%)",
    "radial-gradient(520px 260px at 40% 150%, rgba(96, 165, 250, 0.63), transparent 65%)",
    "linear-gradient(115deg, #1e3a8a, #4f46e5 45%, #7c3aed)",
  ],
  /** Manage Projects. */
  blue: [
    "radial-gradient(520px 230px at 92% 0%, rgba(56, 189, 248, 0.63), transparent 65%)",
    "radial-gradient(520px 260px at 40% 150%, rgba(167, 139, 250, 0.63), transparent 65%)",
    "linear-gradient(115deg, #1e3a8a, #2563eb 45%, #7c3aed)",
  ],
  /** Clients. */
  iris: [
    "radial-gradient(520px 230px at 92% 0%, rgba(244, 114, 182, 0.63), transparent 65%)",
    "radial-gradient(520px 260px at 40% 150%, rgba(96, 165, 250, 0.63), transparent 65%)",
    "linear-gradient(115deg, #312e81, #4f46e5 45%, #7c3aed)",
  ],
  /** General Settings. */
  slate: [
    "radial-gradient(520px 230px at 92% 0%, rgba(251, 191, 36, 0.63), transparent 65%)",
    "radial-gradient(520px 260px at 40% 150%, rgba(52, 211, 153, 0.63), transparent 65%)",
    "linear-gradient(115deg, #0f172a, #334155 45%, #0e7490)",
  ],
  /** BOQ Settings. */
  purple: [
    "radial-gradient(520px 230px at 92% 0%, rgba(240, 171, 252, 0.63), transparent 65%)",
    "radial-gradient(520px 260px at 40% 150%, rgba(129, 140, 248, 0.63), transparent 65%)",
    "linear-gradient(115deg, #581c87, #9333ea 45%, #4f46e5)",
  ],
  /** Field Control. */
  sky: [
    "radial-gradient(520px 230px at 92% 0%, rgba(103, 232, 249, 0.63), transparent 65%)",
    "radial-gradient(520px 260px at 40% 150%, rgba(167, 139, 250, 0.63), transparent 65%)",
    "linear-gradient(115deg, #0c4a6e, #0284c7 45%, #4f46e5)",
  ],
} as const;
export type HeroBandColour = keyof typeof HERO_BANDS;

/** The band's own buttons: the white main action, and a translucent second one beside it. */
export const HERO_PRIMARY_BUTTON = "rounded-xl bg-white font-extrabold text-violet-900 shadow-lg hover:bg-white/90";
export const HERO_SECONDARY_BUTTON =
  "rounded-xl border border-white/30 bg-white/10 font-extrabold text-white hover:bg-white/20 hover:text-white";
/** A search box sitting on the band. */
export const HERO_SEARCH_INPUT =
  "h-[42px] rounded-[13px] border-white/30 bg-white/10 pl-9 font-semibold text-white placeholder:text-indigo-100/80 focus-visible:border-white focus-visible:bg-white/20 focus-visible:ring-0";

const DOTS = {
  backgroundImage: "radial-gradient(rgba(255, 255, 255, 0.08) 1px, transparent 1px)",
  backgroundSize: "18px 18px",
  WebkitMaskImage: "linear-gradient(90deg, transparent, #000 70%)",
  maskImage: "linear-gradient(90deg, transparent, #000 70%)",
} as const;

export interface HeroCrumb {
  label: string;
  href?: string;
}

export function HeroBand({
  back,
  icon: Icon,
  crumbs,
  title,
  description,
  actions,
  children,
  band = "violet",
  className,
}: {
  /** The back arrow — pass `useBackNavigation(...)`'s result so it follows history. */
  back?: { href: string; label: string; onClick?: (event: MouseEvent<HTMLAnchorElement>) => void };
  icon: LucideIcon;
  /** Where the page sits, nearest last; a `href` makes one a link. */
  crumbs?: readonly HeroCrumb[];
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** A row under the title: view tabs, quick links. */
  children?: ReactNode;
  band?: HeroBandColour;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "keep-light relative overflow-hidden rounded-3xl px-4 pb-4 pt-4 text-white shadow-sm sm:px-6 sm:pb-5 sm:pt-5",
        className,
      )}
      style={{ backgroundImage: HERO_BANDS[band].join(", ") }}
    >
      <div className="pointer-events-none absolute inset-0" style={DOTS} aria-hidden="true" />
      <div className="relative flex flex-wrap items-center gap-3">
        {back ? (
          <Link
            href={back.href}
            onClick={back.onClick}
            aria-label={back.label}
            title={back.label}
            className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl border border-white/25 bg-white/10 transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </Link>
        ) : null}
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/30 bg-white/15"
          aria-hidden="true"
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1 basis-[16rem]">
          {crumbs?.length ? (
            <nav aria-label="Breadcrumb" className="truncate text-[11px] font-bold tracking-[0.06em] text-violet-200">
              {crumbs.map((crumb, index) => (
                <span key={`${crumb.label}-${index}`}>
                  {index > 0 ? " / " : null}
                  {crumb.href ? (
                    <Link href={crumb.href} className="hover:text-white hover:underline">
                      {crumb.label}
                    </Link>
                  ) : (
                    <span>{crumb.label}</span>
                  )}
                </span>
              ))}
            </nav>
          ) : null}
          <h1 className="mt-px text-2xl font-extrabold leading-tight tracking-tight">{title}</h1>
          {description ? <p className="max-w-[720px] text-[12.5px] text-indigo-100">{description}</p> : null}
        </div>
        {actions ? <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 sm:shrink-0">{actions}</div> : null}
      </div>
      {children ? <div className="relative mt-4">{children}</div> : null}
    </section>
  );
}

/**
 * Quick-link chips on a band ("Manage Projects", "Clients"…), each with its gradient icon square.
 */
export function HeroChips({
  items,
}: {
  items: ReadonlyArray<{ key: string; label: string; icon: LucideIcon; colours: readonly [string, string]; href?: string; onClick?: () => void }>;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => {
        const inner = (
          <>
            <span
              className="flex h-5 w-5 items-center justify-center rounded-[7px]"
              style={{ backgroundImage: `linear-gradient(140deg, ${item.colours[0]}, ${item.colours[1]})` }}
              aria-hidden="true"
            >
              <item.icon className="h-3 w-3" />
            </span>
            {item.label}
          </>
        );
        const className =
          "inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/10 py-1.5 pl-[7px] pr-3 text-xs font-bold text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white";
        return item.href ? (
          <Link key={item.key} href={item.href} className={className}>
            {inner}
          </Link>
        ) : (
          <button key={item.key} type="button" onClick={item.onClick} className={className}>
            {inner}
          </button>
        );
      })}
    </div>
  );
}
