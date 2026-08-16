"use client";

import { useState } from "react";
import { Menu, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export type SidebarTabItem = {
  value: string;
  label: string;
  icon: LucideIcon;
  /** Per-item icon chip colors, same convention as Vehicle Management's own sidebar
   * (`text-*-600` / `bg-*-100`) — each view gets its own accent instead of one flat color. */
  color: string;
  bg: string;
  /** Optional at-a-glance count shown as a badge — e.g. how many items in this view need
   * attention right now. */
  count?: number;
};

/**
 * A view-switcher sidebar styled like Vehicle Management's module sidebar (sticky card, colored
 * icon chips, gradient active state, mobile Sheet menu) — but scoped to one page's own sub-views
 * (e.g. Purchase Orders' List/BOQ Items/Calendar/Gantt/Reports) rather than routes. Driven purely
 * by `activeValue`/`onChange` so the caller keeps owning the actual state (typically synced to a
 * `?view=` URL param) — this component has no Radix Tabs dependency of its own.
 */
export default function SidebarTabsList({
  items,
  activeValue,
  onChange,
  title,
  description,
  icon: HeaderIcon,
  gradient,
  tint,
}: {
  items: SidebarTabItem[];
  activeValue: string;
  onChange: (value: string) => void;
  title: string;
  description?: string;
  icon: LucideIcon;
  /** Solid gradient classes, e.g. `"from-emerald-500 to-teal-600"` — used for the header icon chip
   * and the active nav item's background. */
  gradient: string;
  /** Faint gradient classes for the header strip background, e.g. `"from-emerald-500/10 to-teal-500/5"`. */
  tint: string;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const current = items.find((item) => item.value === activeValue);

  const navList = (onNavigate?: () => void) => (
    <div className="space-y-1">
      {items.map((item) => {
        const active = item.value === activeValue;
        const Icon = item.icon;
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => {
              onChange(item.value);
              onNavigate?.();
            }}
            className={cn(
              "group relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 lg:py-2 text-left text-sm font-medium transition-all duration-200",
              active
                ? cn("bg-gradient-to-r text-white shadow-[0_8px_24px_-8px_rgba(15,23,42,0.35)]", gradient)
                : "text-slate-600 hover:bg-white/70 hover:text-slate-900",
            )}
          >
            <span
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 transition-all duration-200",
                active ? "bg-white/20 ring-white/30" : cn("ring-black/[0.03] group-hover:scale-105", item.bg),
              )}
            >
              <Icon className={cn("h-4 w-4 transition-transform", active ? "text-white scale-110" : item.color)} />
            </span>
            <span className="flex-1 truncate">{item.label}</span>
            {Boolean(item.count) && (
              <Badge
                variant="secondary"
                className={cn("shrink-0 px-1.5 text-[10px]", active && "bg-white/20 text-white")}
              >
                {item.count}
              </Badge>
            )}
          </button>
        );
      })}
    </div>
  );

  return (
    <>
      {/* Mobile — collapses into a single trigger button that opens a slide-out sheet */}
      <div className="lg:hidden">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" className="w-full justify-start gap-2 bg-white/90">
              {current && <current.icon className={cn("h-4 w-4", current.color)} />}
              {current?.label ?? title}
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="flex w-[85vw] max-w-[300px] flex-col p-0">
            <SheetHeader className="shrink-0 border-b border-slate-200/60 px-4 py-3 text-left">
              <div className="flex items-center gap-2.5">
                <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br shadow", gradient)}>
                  <HeaderIcon className="h-4 w-4 text-white" />
                </div>
                <div>
                  <SheetTitle className="text-sm font-semibold">{title}</SheetTitle>
                  <SheetDescription className="text-[11px]">Tap a view to switch</SheetDescription>
                </div>
              </div>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto p-2 pb-8">{navList(() => setMobileOpen(false))}</div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Desktop — sticky sidebar card */}
      <aside className="hidden lg:sticky lg:top-20 lg:block lg:w-64 lg:shrink-0 lg:self-start">
        <Card className="overflow-hidden">
          <div className={cn("border-b border-slate-100 bg-gradient-to-r px-4 py-3", tint)}>
            <div className="flex items-center gap-2.5">
              <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br shadow-sm", gradient)}>
                <HeaderIcon className="h-4 w-4 text-white" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold tracking-tight text-slate-800">{title}</p>
                {description && <p className="truncate text-[11px] text-muted-foreground">{description}</p>}
              </div>
            </div>
          </div>
          <div className="p-2">{navList()}</div>
        </Card>
      </aside>
    </>
  );
}
