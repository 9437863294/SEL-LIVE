"use client";

/**
 * The Project Management page shell.
 *
 * Structure taken from the PO Register mockup: a full-height sidebar flush to the left, a
 * breadcrumb topbar, a numbered document chain, then the content. Rendered in the application's
 * own theme rather than the mockup's — Inter, the violet primary and the cool background stay, so
 * these screens do not read as a different product from Settings or HR next door.
 *
 * Where the mockup is deliberately monochrome, this keeps the module's per-view colours: each view
 * and each document stage carries its own accent, because on a screen whose whole job is telling
 * seven near-identical gates apart, colour is doing work rather than decorating.
 *
 * Three structural differences from the mockup, all forced by the app it lives in:
 *
 *  1. The sidebar starts below the app's fixed header (h-14 on mobile, h-16 from `md`), not at the
 *     viewport top — the mockup had no application chrome above it.
 *  2. The topbar is sticky rather than static, so the breadcrumb and the primary action stay
 *     reachable while a long register scrolls.
 *  3. Counts on the document chain are optional. A page that has not loaded a gate's register
 *     cannot know its count, and a confident "0" that means "not loaded" is worse than no number.
 */

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Menu, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/* ── Shared metrics ─────────────────────────────────────────────────────────────────────────── */

/** Height of the application header the shell has to sit beneath. */
const BELOW_APP_HEADER = "top-14 md:top-16";
const SIDEBAR_HEIGHT = "h-[calc(100dvh-3.5rem)] md:h-[calc(100dvh-4rem)]";

/**
 * Table density for every register in the module.
 *
 * Set here rather than in `components/ui/table.tsx`, which every table in the application shares.
 * `[&_td]` beats a cell's own `py-*`, so cells must not set vertical padding themselves — set a
 * `pl-*` on an inner element if a cell needs indenting.
 */
export const PM_TABLE_CLASS =
  "[&_th]:h-9 [&_th]:whitespace-nowrap [&_th]:bg-muted/40 [&_th]:px-4 [&_th]:text-xs [&_th]:font-semibold [&_td]:px-4 [&_td]:py-2.5";

/**
 * Deterministic accents by position.
 *
 * A screen's views are a fixed list, so each one is given its colour by hand. A workflow's stages
 * are not — they are configured, and a project may have three or nine — so they take their accent
 * from position instead. Cycling keeps neighbours distinct, which is the only thing the colour has
 * to achieve here.
 */
export const PM_ACCENTS = [
  { color: "text-emerald-600", bg: "bg-emerald-100", border: "border-emerald-500" },
  { color: "text-sky-600", bg: "bg-sky-100", border: "border-sky-500" },
  { color: "text-violet-600", bg: "bg-violet-100", border: "border-violet-500" },
  { color: "text-amber-600", bg: "bg-amber-100", border: "border-amber-500" },
  { color: "text-rose-600", bg: "bg-rose-100", border: "border-rose-500" },
  { color: "text-cyan-600", bg: "bg-cyan-100", border: "border-cyan-500" },
  { color: "text-orange-600", bg: "bg-orange-100", border: "border-orange-500" },
] as const;

export const pmAccent = (index: number) => PM_ACCENTS[index % PM_ACCENTS.length]!;

/* ── Sidebar ────────────────────────────────────────────────────────────────────────────────── */

export type PmSidebarView = {
  value: string;
  label: string;
  icon: LucideIcon;
  /** Per-view accent, e.g. `"text-emerald-600"` / `"bg-emerald-100"`. */
  color: string;
  bg: string;
  count?: number;
};

export type PmSidebarLink = {
  href: string;
  label: string;
  icon: LucideIcon;
  color: string;
  bg: string;
  count?: number;
  active?: boolean;
  /** Dimmed and unclickable rather than hidden, so the list keeps one shape across users. */
  disabled?: boolean;
};

export type PmSidebarGroup =
  | { label: string; views: PmSidebarView[] }
  | { label: string; links: PmSidebarLink[] };

export function PmSidebar({
  title,
  subtitle,
  icon: ModuleIcon,
  gradient,
  groups,
  footerLinks,
  activeValue,
  onChange,
}: {
  title: string;
  /** The project, under the screen name — the mockup's second line on the module mark. */
  subtitle?: string;
  icon: LucideIcon;
  gradient: string;
  groups: PmSidebarGroup[];
  /**
   * Pinned above the Collapse control rather than listed with the views.
   *
   * For destinations that are neither a view of this screen nor reachable from the topbar —
   * Settings being the case that matters. A screen's own siblings do not belong here: the back
   * button and the breadcrumb already go to the parent, the primary action already goes to the
   * "new" form, and the screen you are on does not need a link to itself.
   */
  footerLinks?: PmSidebarLink[];
  activeValue?: string;
  onChange?: (value: string) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);

  const allViews = groups.flatMap((group) => ("views" in group ? group.views : []));
  const current = allViews.find((view) => view.value === activeValue);

  const rowClass = (isActive: boolean, expanded: boolean, disabled = false) =>
    cn(
      "group relative flex w-full items-center rounded-md transition-colors duration-150",
      expanded ? "gap-2.5 px-2.5 py-2" : "justify-center p-1.5",
      disabled
        ? "cursor-not-allowed opacity-40"
        : isActive
          ? cn("cursor-pointer bg-gradient-to-r text-white shadow-sm", gradient)
          : "cursor-pointer text-muted-foreground hover:bg-muted/60 hover:text-foreground",
    );

  const rowInner = (
    entry: { label: string; icon: LucideIcon; color: string; bg: string; count?: number },
    isActive: boolean,
    expanded: boolean,
  ) => (
    <>
      <span
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-transform duration-150",
          isActive ? "bg-white/20" : cn(entry.bg, "group-hover:scale-105"),
        )}
      >
        <entry.icon className={cn("h-3.5 w-3.5", isActive ? "text-white" : entry.color)} />
      </span>

      {expanded && <span className="flex-1 truncate text-left text-sm font-medium">{entry.label}</span>}

      {entry.count !== undefined &&
        (expanded ? (
          <span
            className={cn(
              "shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
              isActive ? "bg-white/20 text-white" : "bg-muted text-muted-foreground",
            )}
          >
            {entry.count}
          </span>
        ) : entry.count > 0 ? (
          // No room for a number on a rail, so a live count becomes a dot. A zero shows nothing —
          // a marker that means "nothing here" is just noise.
          <span
            aria-hidden
            className={cn(
              "absolute right-1 top-1 h-1.5 w-1.5 rounded-full",
              isActive ? "bg-white" : "bg-primary",
            )}
          />
        ) : null)}
    </>
  );

  const viewRow = (view: PmSidebarView, expanded: boolean, onNavigate?: () => void) => {
    const isActive = view.value === activeValue;
    return (
      <button
        key={view.value}
        type="button"
        aria-current={isActive ? "page" : undefined}
        onClick={() => {
          onChange?.(view.value);
          onNavigate?.();
        }}
        className={rowClass(isActive, expanded)}
      >
        {rowInner(view, isActive, expanded)}
      </button>
    );
  };

  const linkRow = (link: PmSidebarLink, expanded: boolean, onNavigate?: () => void) => {
    if (link.disabled) {
      return (
        <span
          key={link.href}
          aria-disabled
          title={`${link.label} — you do not have permission to open this`}
          className={rowClass(false, expanded, true)}
        >
          {rowInner(link, false, expanded)}
        </span>
      );
    }
    return (
      <Link
        key={link.href}
        href={link.href}
        aria-current={link.active ? "page" : undefined}
        onClick={onNavigate}
        className={rowClass(Boolean(link.active), expanded)}
      >
        {rowInner(link, Boolean(link.active), expanded)}
      </Link>
    );
  };

  const groupBody = (expanded: boolean, onNavigate?: () => void) =>
    groups.map((group, index) => (
      <div key={group.label} className={index ? "mt-3" : undefined}>
        {expanded ? (
          <p className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/60">
            {group.label}
          </p>
        ) : index ? (
          <div aria-hidden className="mx-1 mb-1.5 h-px bg-border" />
        ) : null}
        <div className="space-y-0.5">
          {"views" in group
            ? group.views.map((view) => viewRow(view, expanded, onNavigate))
            : group.links.map((link) => linkRow(link, expanded, onNavigate))}
        </div>
      </div>
    ));

  const moduleMark = (expanded: boolean) => (
    <div className={cn("flex items-center gap-2.5", !expanded && "justify-center")}>
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-white shadow-sm",
          gradient,
        )}
      >
        <ModuleIcon className="h-4 w-4" />
      </span>
      {expanded && (
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold leading-tight">{title}</span>
          {subtitle && (
            <span className="block truncate text-[11px] text-muted-foreground">{subtitle}</span>
          )}
        </span>
      )}
    </div>
  );

  return (
    <>
      {/* Mobile — the same list in a sheet, opened from a single trigger. */}
      <div className="border-b bg-card px-4 py-2 lg:hidden">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 w-full justify-start gap-2">
              <Menu className="h-4 w-4 shrink-0" />
              {current && <current.icon className={cn("h-4 w-4 shrink-0", current.color)} />}
              <span className="truncate text-sm font-medium">{current?.label ?? title}</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="flex w-72 flex-col p-0">
            <SheetHeader className="shrink-0 border-b px-4 py-3 text-left">
              <SheetTitle asChild>
                <div>{moduleMark(true)}</div>
              </SheetTitle>
              <SheetDescription className="sr-only">{title} navigation</SheetDescription>
            </SheetHeader>
            <nav className="flex-1 overflow-y-auto px-2.5 py-3">
              {groupBody(true, () => setMobileOpen(false))}
            </nav>
            {footerLinks?.length ? (
              <div className="shrink-0 space-y-0.5 border-t px-2.5 py-2">
                {footerLinks.map((link) => linkRow(link, true, () => setMobileOpen(false)))}
              </div>
            ) : null}
          </SheetContent>
        </Sheet>
      </div>

      {/* Desktop — flush to the left edge, full height, collapsing to an icon rail. */}
      <aside
        className={cn(
          "hidden shrink-0 flex-col border-r bg-card transition-[width] duration-200 lg:sticky lg:flex",
          BELOW_APP_HEADER,
          SIDEBAR_HEIGHT,
          isExpanded ? "w-[232px]" : "w-[60px]",
        )}
      >
        <div className={cn("shrink-0 border-b px-3 py-3", !isExpanded && "px-2")}>
          {moduleMark(isExpanded)}
        </div>

        <TooltipProvider delayDuration={0}>
          <nav className={cn("flex-1 overflow-y-auto py-3", isExpanded ? "px-2.5" : "px-2")}>
            {isExpanded ? (
              groupBody(true)
            ) : (
              <div className="space-y-0.5">
                {groups.map((group, index) => (
                  <div key={group.label} className={index ? "mt-3" : undefined}>
                    {index ? <div aria-hidden className="mx-1 mb-1.5 h-px bg-border" /> : null}
                    <div className="space-y-0.5">
                      {("views" in group ? group.views : group.links).map((entry) => {
                        const key = "value" in entry ? entry.value : entry.href;
                        const node =
                          "value" in entry ? viewRow(entry, false) : linkRow(entry, false);
                        return (
                          <Tooltip key={key}>
                            <TooltipTrigger asChild>{node}</TooltipTrigger>
                            <TooltipContent side="right" className="text-xs font-medium">
                              {entry.label}
                              {entry.count !== undefined && ` · ${entry.count}`}
                            </TooltipContent>
                          </Tooltip>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </nav>
        </TooltipProvider>

        <div className="shrink-0 border-t p-2">
          {footerLinks?.length ? (
            <TooltipProvider delayDuration={0}>
              <div className="mb-1 space-y-0.5">
                {footerLinks.map((link) =>
                  isExpanded ? (
                    linkRow(link, true)
                  ) : (
                    <Tooltip key={link.href}>
                      <TooltipTrigger asChild>{linkRow(link, false)}</TooltipTrigger>
                      <TooltipContent side="right" className="text-xs font-medium">
                        {link.label}
                      </TooltipContent>
                    </Tooltip>
                  ),
                )}
              </div>
            </TooltipProvider>
          ) : null}
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            aria-label={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
            aria-expanded={isExpanded}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-2 text-[13px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground",
              !isExpanded && "justify-center",
            )}
          >
            {isExpanded ? (
              <>
                <ChevronLeft className="h-3.5 w-3.5 shrink-0" />
                <span>Collapse</span>
              </>
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </aside>
    </>
  );
}

/* ── Shell + topbar ─────────────────────────────────────────────────────────────────────────── */

/**
 * Wraps the sidebar and the scrolling column beside it.
 *
 * No padding and no negative margins: `AppShell` hands its children a bare `flex-grow` div, and
 * the page padding every other screen has comes from that screen's own `<main>` — which this
 * replaces. So the shell already sits flush against the window, and the sidebar reaches the left
 * edge and the topbar's border runs the full width without any margin trickery. Padding is applied
 * inside, by `PmTopbar` and `PmContent`.
 */
export function PmShell({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] md:min-h-[calc(100dvh-4rem)]">
      {sidebar}
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

/**
 * Back arrow, breadcrumb trail, screen title, then actions.
 *
 * The trail replaces the old stacked header's subtitle sentence: "Madanpur Rampur / Procurement /
 * PO Register" says where you are in one line and in less space than "Purchase orders raised
 * against vendors for Madanpur Rampur" took in two.
 */
export function PmTopbar({
  title,
  breadcrumbs = [],
  backHref,
  backLabel = "Back",
  actions,
}: {
  title: string;
  /** Ancestors, nearest last. A `href` makes a crumb a link. */
  breadcrumbs?: Array<{ label: string; href?: string }>;
  backHref: string;
  backLabel?: string;
  actions?: ReactNode;
}) {
  return (
    <header
      className={cn(
        "sticky z-20 flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-card/95 px-4 py-2.5 backdrop-blur md:px-6",
        BELOW_APP_HEADER,
      )}
    >
      <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" asChild>
        <Link href={backHref} aria-label={backLabel}>
          <ChevronLeft className="h-4 w-4" />
        </Link>
      </Button>

      <nav aria-label="Breadcrumb" className="flex min-w-0 items-baseline gap-2">
        {breadcrumbs.length > 0 && (
          <p className="hidden shrink-0 items-baseline gap-1.5 whitespace-nowrap text-[13px] text-muted-foreground md:flex">
            {breadcrumbs.map((crumb) => (
              <span key={crumb.label} className="flex items-baseline gap-1.5">
                {crumb.href ? (
                  <Link href={crumb.href} className="font-medium text-foreground hover:underline">
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="font-medium text-foreground">{crumb.label}</span>
                )}
                <span aria-hidden className="text-muted-foreground/50">
                  /
                </span>
              </span>
            ))}
          </p>
        )}
        <h1 className="truncate text-[17px] font-semibold tracking-tight">{title}</h1>
      </nav>

      {actions ? <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/* ── Document chain ─────────────────────────────────────────────────────────────────────────── */

export type PmChainStage = {
  key: string;
  label: string;
  href: string;
  /** Per-stage accent, e.g. `"text-emerald-600"` / `"bg-emerald-100"` / `"border-emerald-500"`. */
  color: string;
  bg: string;
  border: string;
  /** Omit when the page has not loaded this stage's register — see the module note. */
  count?: number;
};

/**
 * The document chain: numbered stages in the order work moves through them, connected by a rule.
 *
 * This replaces a flat pill row for the supply gates. The numbers and the connectors are the
 * point — the seven gates are a *sequence*, and a row of equal pills said nothing about which
 * comes before which, which is exactly what somebody chasing a stuck item needs to know.
 */
export function PmDocumentChain({
  label,
  stages,
  active,
}: {
  label: string;
  stages: PmChainStage[];
  active: string;
}) {
  return (
    <nav aria-label={label} className="border-b bg-card">
      <div
        className={cn(
          "flex overflow-x-auto px-4 md:px-6",
          "[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        )}
      >
        {stages.map((stage, index) => {
          const isActive = stage.key === active;
          const isEmpty = stage.count === 0;
          return (
            <Link
              key={stage.key}
              href={stage.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "relative flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-[13px] font-medium transition-colors",
                isActive
                  ? cn(stage.border, stage.color)
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {index > 0 && (
                <span aria-hidden className="absolute -left-2 top-1/2 h-px w-4 bg-border" />
              )}
              <span
                className={cn(
                  "grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full text-[11px] font-semibold",
                  isActive
                    ? cn(stage.bg, stage.color)
                    : "bg-muted text-muted-foreground/70",
                )}
              >
                {index + 1}
              </span>
              {stage.label}
              {stage.count !== undefined && (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
                    isEmpty
                      ? "border border-dashed border-border text-muted-foreground/60"
                      : isActive
                        ? cn(stage.bg, stage.color)
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {stage.count}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/* ── Content furniture ──────────────────────────────────────────────────────────────────────── */

/** The scrolling content area beneath the topbar and chain. */
export function PmContent({ children, className }: { children: ReactNode; className?: string }) {
  return <main className={cn("flex-1 px-4 py-5 md:px-6", className)}>{children}</main>;
}

/**
 * Screen heading with its figures alongside.
 *
 * The mockup puts the counts on the same line as the title instead of in a card header beneath it,
 * which is both shorter and more useful — "2 orders · ₹42,72,870 · 1 awaiting review" is the
 * summary somebody opened the register for.
 */
export function PmSectionHead({
  title,
  stats = [],
  actions,
}: {
  title: string;
  /** `tone: "flag"` colours a figure that wants attention. */
  stats?: Array<{ label: string; value: string; tone?: "default" | "flag" }>;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end gap-x-6 gap-y-2">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      {stats.length > 0 && (
        <dl className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[13px] text-muted-foreground">
          {stats.map((stat) => (
            <div key={stat.label} className="flex items-baseline gap-1.5">
              <dd
                className={cn(
                  "font-semibold tabular-nums",
                  stat.tone === "flag" ? "text-amber-700" : "text-foreground",
                )}
              >
                {stat.value}
              </dd>
              <dt className={stat.tone === "flag" ? "text-amber-700" : undefined}>{stat.label}</dt>
            </div>
          ))}
        </dl>
      )}
      {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Totals bar closing a register, as the mockup's table footer. */
export function PmTableFoot({ left, right }: { left: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
      <span>{left}</span>
      {right ? <span>{right}</span> : null}
    </div>
  );
}

/** A status pill with a leading dot, as the mockup renders Issued / Commercial review. */
export function PmStatusPill({
  label,
  tone,
  note,
}: {
  label: string;
  tone: "ok" | "wait" | "bad" | "neutral";
  /** Secondary line beneath — kept for the one case the mockup allows it, the approval note. */
  note?: string;
}) {
  const tones = {
    ok: "bg-emerald-100 text-emerald-700 [&>span]:bg-emerald-600",
    wait: "bg-amber-100 text-amber-800 [&>span]:bg-amber-600",
    bad: "bg-red-100 text-red-700 [&>span]:bg-red-600",
    neutral: "bg-muted text-muted-foreground [&>span]:bg-muted-foreground",
  } as const;
  return (
    <span className="inline-flex flex-col gap-0.5">
      <span
        className={cn(
          "inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-medium",
          tones[tone],
        )}
      >
        <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" />
        {label}
      </span>
      {note && <span className="text-[11px] text-muted-foreground">{note}</span>}
    </span>
  );
}
