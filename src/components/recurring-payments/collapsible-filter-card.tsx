"use client";

import { useState } from "react";
import { ChevronDown, RotateCcw, SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

/**
 * Standard filter panel for the recurring-payments module — collapsed by default so a page opens
 * showing data, not a wall of form controls, with an active-filter count always visible on the
 * header so it's obvious when something is hiding rows even while collapsed. Every filter-bearing
 * page in this module should wrap its filter controls in this instead of a bare Card, so the
 * collapse behavior (and its styling) stays in exactly one place.
 */
export default function CollapsibleFilterCard({
  title = "Filters",
  activeCount,
  onClear,
  children,
}: {
  title?: string;
  activeCount: number;
  onClear?: () => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="print:hidden">
      <Card>
        {/* The trigger sits inside the header instead of wrapping it: "Clear filters" is a real
            button, and HTML forbids nesting a <button> inside another one (React flags it as a
            hydration error). Keeping them siblings also means the clear action no longer has to
            stop propagation to avoid toggling the panel. */}
        {/* A single compact bar when collapsed: the default CardHeader padding turned a control
            nobody is currently using into one of the tallest blocks on the page, pushing the
            actual table below the fold. */}
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 px-3 py-2">
          <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 text-left">
            <SlidersHorizontal className="h-4 w-4 shrink-0 text-muted-foreground" />
            <CardTitle className="truncate text-sm font-medium">{title}</CardTitle>
            {activeCount > 0 && (
              <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[11px]">
                {activeCount}
              </Badge>
            )}
            <ChevronDown
              className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
            />
          </CollapsibleTrigger>
          {activeCount > 0 && onClear && (
            <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs" onClick={onClear}>
              <RotateCcw className="mr-1 h-3 w-3" />
              Clear
            </Button>
          )}
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="space-y-2 px-3 pb-3 pt-0">{children}</CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
