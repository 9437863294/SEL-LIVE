"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  LayoutGrid,
  Search,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { useSidebarDefault } from "@/components/theme/use-sidebar-default";
import { cn } from "@/lib/utils";

export type SidebarTabItem = {
  value: string;
  label: string;
  icon: LucideIcon;
  /** Per-item icon chip colors (`text-*-600` / `bg-*-100`) — each view gets its own accent. */
  color: string;
  bg: string;
  /** Optional at-a-glance count shown as a badge — e.g. how many items in this view need
   * attention right now. */
  count?: number;
};

/**
 * A route the sidebar navigates to, rather than a view it switches between.
 *
 * Lets a screen's own navigation live in the sidebar instead of a separate pill bar above the
 * content — which is a full bar of vertical space, on a page whose point is a dense table.
 */
export type SidebarLinkItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  color: string;
  bg: string;
  count?: number;
  /** Marks the screen you are already on. */
  active?: boolean;
  /** Rendered dimmed and unclickable rather than hidden, so the list keeps a stable shape
   *  between users — the same choice `PoNav` makes with its `hidden` prop. */
  disabled?: boolean;
};

/** One tile in the phone's sections pop-up: a view switched to in place, or a screen opened. */
export type SectionsSheetEntry = {
  key: string;
  label: string;
  icon: LucideIcon;
  /** The desktop row's accent (`text-*-600` / `bg-*-100`), kept on the tile's icon chip. */
  color: string;
  bg: string;
  count?: number;
  active?: boolean;
  /** For a view: the tile is a button that selects it. */
  onSelect?: () => void;
  /** For a screen: the tile is a link to it. */
  href?: string;
  disabled?: boolean;
};

export type SectionsSheetGroup = { label?: string; entries: SectionsSheetEntry[] };

const TILE_CLASS =
  "relative flex min-h-[5.25rem] flex-col items-center justify-center gap-2 rounded-2xl border p-2 text-center text-[11px] font-medium leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * A page's own sidebar, on a phone: a compact "Sections" pill naming the current view, which opens
 * a bottom pop-up of tiles drawn like the bottom bar's "More" sheet (`ModuleMoreSheet`) — so a
 * page's views are picked the same way as a module's pages. Picking a tile switches to it and
 * closes the pop-up. It replaces the slide-in side sheet phones used to get.
 */
export function SectionsSheet({
  title,
  description,
  icon: HeaderIcon,
  groups,
  className,
}: {
  title: string;
  description?: string;
  icon: LucideIcon;
  /** Shown in order; a group's `label` becomes its heading. */
  groups: SectionsSheetGroup[];
  /** Classes for the trigger pill. */
  className?: string;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const all = groups.flatMap((group) => group.entries);
  const current = all.find((entry) => entry.active);
  // A long list gets a filter; a short one is quicker to scan than to search — as in "More".
  const searchable = all.length > 9;
  const needle = query.trim().toLowerCase();
  const shown = groups
    .map((group) => ({
      ...group,
      entries: needle
        ? group.entries.filter((entry) =>
            `${entry.label} ${group.label ?? ""}`.toLowerCase().includes(needle),
          )
        : group.entries,
    }))
    .filter((group) => group.entries.length > 0);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    // Each opening starts from the full list.
    if (next) setQuery("");
  };

  if (!all.length) return null;

  const tileInner = (entry: SectionsSheetEntry) => (
    <>
      <span
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-xl",
          entry.active ? "bg-primary text-primary-foreground" : entry.bg,
        )}
      >
        <entry.icon className={cn("h-4 w-4", !entry.active && entry.color)} aria-hidden="true" />
      </span>
      <span className="line-clamp-2">{entry.label}</span>
      {Boolean(entry.count) && (
        <span
          className={cn(
            "absolute right-1.5 top-1.5 min-w-[1.25rem] rounded-full px-1.5 py-px text-[10px] font-semibold tabular-nums",
            entry.active ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground shadow-sm",
          )}
        >
          {entry.count}
        </span>
      )}
    </>
  );

  const tile = (entry: SectionsSheetEntry) => {
    if (entry.disabled) {
      return (
        <span
          key={entry.key}
          aria-disabled="true"
          title={`${entry.label} — you do not have permission to open this`}
          className={cn(TILE_CLASS, "cursor-not-allowed border-border/60 bg-muted/30 text-foreground/80 opacity-50")}
        >
          {tileInner(entry)}
        </span>
      );
    }
    const tone = entry.active
      ? "border-primary/40 bg-primary/10 text-primary"
      : "border-border/60 bg-muted/30 text-foreground/80 hover:bg-muted/60";
    if (entry.href) {
      return (
        <Link
          key={entry.key}
          href={entry.href}
          onClick={() => setOpen(false)}
          aria-current={entry.active ? "page" : undefined}
          className={cn(TILE_CLASS, tone)}
        >
          {tileInner(entry)}
        </Link>
      );
    }
    return (
      <button
        key={entry.key}
        type="button"
        aria-pressed={Boolean(entry.active)}
        onClick={() => {
          entry.onSelect?.();
          setOpen(false);
        }}
        className={cn(TILE_CLASS, tone)}
      >
        {tileInner(entry)}
      </button>
    );
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-9 max-w-full items-center gap-2 rounded-full border border-border/70 bg-background pl-3 pr-2.5 text-sm shadow-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          <LayoutGrid className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="shrink-0 font-medium text-muted-foreground">Sections</span>
          {current && (
            <>
              <span aria-hidden="true" className="text-muted-foreground/60">
                ·
              </span>
              <span className="truncate font-semibold text-foreground">{current.label}</span>
            </>
          )}
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </SheetTrigger>
      <SheetContent
        ref={contentRef}
        side="bottom"
        // Focus the sheet, not its search box: on a phone a focused input throws the keyboard up
        // over the very tiles the person opened the sheet to tap.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          contentRef.current?.focus({ preventScroll: true });
        }}
        className="max-h-[82dvh] overflow-y-auto rounded-t-[1.75rem] px-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-3 focus:outline-none"
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-muted" aria-hidden="true" />
        <SheetHeader className="pr-8 text-left">
          <SheetTitle className="flex items-center gap-2 text-base">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <HeaderIcon className="h-4 w-4 text-primary" aria-hidden="true" />
            </span>
            <span className="min-w-0 truncate">{title}</span>
          </SheetTitle>
          <SheetDescription className="text-xs">
            {description ?? "Every section of this screen"}
          </SheetDescription>
        </SheetHeader>
        {searchable && (
          <div className="relative mt-3">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${all.length} sections`}
              aria-label={`Search ${title} sections`}
              className="h-10 w-full rounded-xl border border-border/70 bg-muted/40 pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50 focus:bg-background focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        )}
        {needle && shown.length === 0 && (
          <p className="mt-6 text-center text-sm text-muted-foreground">
            No section matches “{query.trim()}”.
          </p>
        )}
        {shown.map((group, index) => (
          <section key={group.label ?? `group-${index}`} className="mt-4">
            {group.label && (
              <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                {group.label}
              </p>
            )}
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{group.entries.map(tile)}</div>
          </section>
        ))}
      </SheetContent>
    </Sheet>
  );
}

/**
 * A view-switcher sidebar for one page's own sub-views (e.g. MDL's Pending Tasks / Register /
 * Calendar / Gantt / Reports), driven purely by `activeValue`/`onChange` so the caller keeps
 * owning the state — typically synced to a `?view=` URL param.
 *
 * Styled to match the Settings module's sidebar (`app/(protected)/settings/layout.tsx`): a quiet
 * collapsible panel with a small header chip, compact rows, 28px icon chips, a gradient active
 * state and tooltips once collapsed. It deliberately shares that visual language rather than
 * inventing a second one, so moving between Settings and Project Management does not feel like
 * moving between two applications.
 *
 * Two deliberate differences from Settings, both because this switches *views* rather than routes:
 *  - it is a sticky in-page aside, not a viewport-fixed rail, since it sits beside page content
 *    that has its own header above it;
 *  - it opens expanded. Settings opens as an icon rail, which suits its seventeen grouped
 *    destinations; a five-item switcher whose labels are the only clue to what the views are is
 *    more useful with them showing. That is only the fallback now: once the user's sidebar
 *    preference is known it decides, as it does for every rail.
 */
export default function SidebarTabsList({
  items,
  activeValue,
  onChange,
  title,
  description,
  icon: HeaderIcon,
  gradient,
  itemsLabel = "Views",
  links,
  linksLabel = "Screens",
}: {
  items: SidebarTabItem[];
  activeValue: string;
  onChange: (value: string) => void;
  title: string;
  description?: string;
  icon: LucideIcon;
  /** Solid gradient classes, e.g. `"from-emerald-500 to-teal-600"` — the active row's background. */
  gradient: string;
  /** Group heading above the views. Only shown when `links` are present — with one group there
   *  is nothing to tell apart, and a lone heading is just another line of chrome. */
  itemsLabel?: string;
  /** Routes this screen navigates to, rendered as a second group beneath the views. */
  links?: SidebarLinkItem[];
  linksLabel?: string;
}) {
  const [isExpanded, setIsExpanded] = useSidebarDefault(true);
  const hasGroups = Boolean(links?.length);

  /** The shared row shell. Both the view buttons and the screen links render through it, so a
   *  route and a view are indistinguishable to look at — which is the point of moving the screen
   *  nav in here rather than leaving it as a separate bar. */
  const rowClass = (isActive: boolean, expanded: boolean, disabled = false) =>
    cn(
      "group relative flex w-full items-center rounded-lg transition-all duration-200",
      expanded ? "gap-2.5 px-2 py-1.5" : "justify-center p-1.5",
      disabled
        ? "cursor-not-allowed opacity-50"
        : isActive
          ? cn("cursor-pointer bg-gradient-to-r text-white shadow-sm", gradient)
          : "cursor-pointer hover:bg-muted/40",
    );

  const rowInner = (
    entry: { label: string; icon: LucideIcon; color: string; bg: string; count?: number },
    isActive: boolean,
    expanded: boolean,
  ) => (
    <>
      <span
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-all duration-200",
          isActive ? "bg-white/25" : cn(entry.bg, "group-hover:scale-105"),
        )}
      >
        <entry.icon
          className={cn(
            "h-3.5 w-3.5 transition-transform",
            isActive ? "scale-110 text-white" : entry.color,
          )}
        />
      </span>

      {expanded && (
        <span
          className={cn(
            "flex-1 truncate text-left text-sm",
            isActive ? "font-semibold" : "font-medium text-foreground/80",
          )}
        >
          {entry.label}
        </span>
      )}

      {Boolean(entry.count) &&
        (expanded ? (
          <Badge
            variant="secondary"
            className={cn("shrink-0 px-1.5 text-[10px]", isActive && "bg-white/20 text-white")}
          >
            {entry.count}
          </Badge>
        ) : (
          // Collapsed to a rail there is no room for a number, so the count becomes a dot —
          // still says "something here needs attention" without widening the rail.
          <span
            aria-hidden
            className={cn(
              "absolute right-1 top-1 h-1.5 w-1.5 rounded-full",
              isActive ? "bg-white" : "bg-primary",
            )}
          />
        ))}
    </>
  );

  /** One view row: icon and label, or (`expanded` false) the icon alone for the collapsed rail. */
  const navRow = (item: SidebarTabItem, expanded: boolean) => {
    const isActive = item.value === activeValue;
    return (
      <button
        key={item.value}
        type="button"
        onClick={() => onChange(item.value)}
        aria-current={isActive ? "page" : undefined}
        className={rowClass(isActive, expanded)}
      >
        {rowInner(item, isActive, expanded)}
      </button>
    );
  };

  /** One screen row. A link, not a button, so it opens in a new tab and shows its target on hover
   *  like any other navigation. */
  const navLink = (link: SidebarLinkItem, expanded: boolean) => {
    const isActive = Boolean(link.active);
    if (link.disabled) {
      return (
        <span
          key={link.href}
          aria-disabled
          className={rowClass(false, expanded, true)}
          title={`${link.label} — you do not have permission to open this`}
        >
          {rowInner(link, false, expanded)}
        </span>
      );
    }
    return (
      <Link
        key={link.href}
        href={link.href}
        aria-current={isActive ? "page" : undefined}
        className={rowClass(isActive, expanded)}
      >
        {rowInner(link, isActive, expanded)}
      </Link>
    );
  };

  /** Uppercase group heading, matching the Settings sidebar. Collapsed to a rail there is no room
   *  for a word, so the groups are separated by a hairline instead. */
  const groupLabel = (label: string, expanded: boolean, first: boolean) =>
    expanded ? (
      <p className="mb-1 mt-2 px-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 first:mt-0">
        {label}
      </p>
    ) : first ? null : (
      <div aria-hidden className="mx-1 my-1 h-px bg-border/40" />
    );

  /** The whole nav, expanded — the desktop panel's body. */
  const navBody = (expanded: boolean) => (
    <>
      {hasGroups && groupLabel(itemsLabel, expanded, true)}
      {items.map((item) => navRow(item, expanded))}
      {hasGroups && groupLabel(linksLabel, expanded, false)}
      {links?.map((link) => navLink(link, expanded))}
    </>
  );

  // The same list for the phone's pop-up, grouped as the panel groups it.
  const phoneGroups: SectionsSheetGroup[] = [
    {
      label: hasGroups ? itemsLabel : undefined,
      entries: items.map((item) => ({
        key: item.value,
        label: item.label,
        icon: item.icon,
        color: item.color,
        bg: item.bg,
        count: item.count,
        active: item.value === activeValue,
        onSelect: () => onChange(item.value),
      })),
    },
    ...(links?.length
      ? [
          {
            label: linksLabel,
            entries: links.map((link) => ({
              key: link.href,
              label: link.label,
              icon: link.icon,
              color: link.color,
              bg: link.bg,
              count: link.count,
              active: link.active,
              href: link.href,
              disabled: link.disabled,
            })),
          },
        ]
      : []),
  ];

  return (
    <>
      {/* Phones — a "Sections" pill opening the same list as a pop-up of tiles. */}
      <div className="lg:hidden">
        <SectionsSheet title={title} description={description} icon={HeaderIcon} groups={phoneGroups} />
      </div>

      {/* Desktop — a sticky panel that collapses to an icon rail. It sticks 1rem below the header's
          visible height (`--app-header-offset`), so it follows a non-sticky header off screen. */}
      <aside
        className={cn(
          "hidden self-start transition-all duration-300 lg:sticky lg:top-[calc(var(--app-header-offset,4rem)+1rem)] lg:flex lg:shrink-0 lg:flex-col",
          "overflow-hidden rounded-xl border border-border/60 bg-background/95 shadow-sm backdrop-blur-sm",
          isExpanded ? "lg:w-56" : "lg:w-14",
        )}
      >
        <div
          className={cn(
            "flex shrink-0 items-center gap-2 border-b border-border/40 px-3 py-3",
            !isExpanded && "justify-center",
          )}
          // The description is the header's tooltip rather than a second line: a truncated
          // subtitle under the title made the header the tallest thing in the panel.
          title={description}
        >
          <div className="shrink-0 rounded-lg bg-primary/10 p-1.5">
            <HeaderIcon className="h-4 w-4 text-primary" />
          </div>
          {isExpanded && (
            <span className="truncate text-sm font-semibold text-foreground/80">{title}</span>
          )}
        </div>

        <TooltipProvider delayDuration={0}>
          <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-2">
            {isExpanded ? (
              navBody(true)
            ) : (
              <>
                {items.map((item) => (
                  <Tooltip key={item.value}>
                    <TooltipTrigger asChild>{navRow(item, false)}</TooltipTrigger>
                    <TooltipContent side="right" className="text-xs font-medium">
                      {item.label}
                      {Boolean(item.count) && ` · ${item.count}`}
                    </TooltipContent>
                  </Tooltip>
                ))}
                {hasGroups && groupLabel(linksLabel, false, false)}
                {links?.map((link) => (
                  <Tooltip key={link.href}>
                    <TooltipTrigger asChild>{navLink(link, false)}</TooltipTrigger>
                    <TooltipContent side="right" className="text-xs font-medium">
                      {link.label}
                      {link.disabled && " — no permission"}
                    </TooltipContent>
                  </Tooltip>
                ))}
              </>
            )}
          </nav>
        </TooltipProvider>

        <div className="shrink-0 border-t border-border/40 p-2">
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            aria-label={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
            aria-expanded={isExpanded}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-muted-foreground transition-all duration-200 hover:bg-muted/60 hover:text-foreground",
              !isExpanded && "justify-center",
            )}
          >
            {isExpanded ? (
              <>
                <ChevronLeft className="h-4 w-4 shrink-0" />
                <span>Collapse</span>
              </>
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
        </div>
      </aside>
    </>
  );
}
