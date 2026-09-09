"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Menu, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
 *    more useful with them showing.
 */
export default function SidebarTabsList({
  items,
  activeValue,
  onChange,
  title,
  description,
  icon: HeaderIcon,
  gradient,
}: {
  items: SidebarTabItem[];
  activeValue: string;
  onChange: (value: string) => void;
  title: string;
  description?: string;
  icon: LucideIcon;
  /** Solid gradient classes, e.g. `"from-emerald-500 to-teal-600"` — the active row's background. */
  gradient: string;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);
  const current = items.find((item) => item.value === activeValue);

  /** One row. `expanded` is passed rather than read from state so the mobile sheet — which is
   *  always expanded — can reuse it unchanged. */
  const navRow = (item: SidebarTabItem, expanded: boolean, onNavigate?: () => void) => {
    const isActive = item.value === activeValue;
    const Icon = item.icon;
    return (
      <button
        key={item.value}
        type="button"
        onClick={() => {
          onChange(item.value);
          onNavigate?.();
        }}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "group relative flex w-full cursor-pointer items-center rounded-lg transition-all duration-200",
          expanded ? "gap-2.5 px-2 py-1.5" : "justify-center p-1.5",
          isActive
            ? cn("bg-gradient-to-r text-white shadow-sm", gradient)
            : "hover:bg-muted/40",
        )}
      >
        <span
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-all duration-200",
            isActive ? "bg-white/25" : cn(item.bg, "group-hover:scale-105"),
          )}
        >
          <Icon
            className={cn(
              "h-3.5 w-3.5 transition-transform",
              isActive ? "scale-110 text-white" : item.color,
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
            {item.label}
          </span>
        )}

        {Boolean(item.count) &&
          (expanded ? (
            <Badge
              variant="secondary"
              className={cn("shrink-0 px-1.5 text-[10px]", isActive && "bg-white/20 text-white")}
            >
              {item.count}
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
      </button>
    );
  };

  return (
    <>
      {/* Mobile — a single trigger that opens the same list in a sheet. */}
      <div className="lg:hidden">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" className="h-9 w-full justify-start gap-2">
              <Menu className="h-4 w-4 shrink-0" />
              {current && <current.icon className={cn("h-4 w-4 shrink-0", current.color)} />}
              <span className="truncate text-sm font-medium">{current?.label ?? title}</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="flex w-72 flex-col p-0">
            <SheetHeader className="shrink-0 border-b border-border/40 px-4 py-3 text-left">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-primary/10 p-1.5">
                  <HeaderIcon className="h-4 w-4 text-primary" />
                </div>
                <SheetTitle className="text-sm font-semibold">{title}</SheetTitle>
              </div>
              <SheetDescription className="sr-only">
                {description ?? `${title} navigation`}
              </SheetDescription>
            </SheetHeader>
            <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-3">
              {items.map((item) => navRow(item, true, () => setMobileOpen(false)))}
            </nav>
          </SheetContent>
        </Sheet>
      </div>

      {/* Desktop — a sticky panel that collapses to an icon rail. */}
      <aside
        className={cn(
          "hidden self-start transition-all duration-300 lg:sticky lg:top-20 lg:flex lg:shrink-0 lg:flex-col",
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
            {items.map((item) =>
              isExpanded ? (
                navRow(item, true)
              ) : (
                <Tooltip key={item.value}>
                  <TooltipTrigger asChild>{navRow(item, false)}</TooltipTrigger>
                  <TooltipContent side="right" className="text-xs font-medium">
                    {item.label}
                    {Boolean(item.count) && ` · ${item.count}`}
                  </TooltipContent>
                </Tooltip>
              ),
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
