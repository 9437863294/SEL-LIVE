"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type SidebarTabItem = {
  value: string;
  label: string;
  icon: LucideIcon;
};

// A vertical sidebar of tab triggers that collapses to an icon-only rail by default —
// desktop (lg+) only; on smaller screens it stays a normal horizontally-scrollable tab row.
export default function SidebarTabsList({
  items,
  activeClassName,
}: {
  items: SidebarTabItem[];
  activeClassName: string;
}) {
  const [collapsed, setCollapsed] = useState(true);

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className={cn(
          "flex flex-row items-stretch gap-1 rounded-lg border bg-muted/40 p-1.5 lg:flex-col lg:self-start",
          collapsed ? "lg:w-14" : "lg:w-52",
        )}
      >
        <button
          type="button"
          onClick={() => setCollapsed((current) => !current)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand" : "Collapse"}
          className="hidden shrink-0 items-center justify-center rounded-md p-2 text-muted-foreground hover:bg-background hover:text-foreground lg:flex"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>

        <TabsList className="flex h-auto flex-1 flex-row gap-1 overflow-x-auto bg-transparent p-0 lg:flex-col lg:items-stretch lg:overflow-visible">
          {items.map((item) => {
            const trigger = (
              <TabsTrigger
                key={item.value}
                value={item.value}
                className={cn(
                  "shrink-0 justify-start gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground data-[state=active]:shadow-none lg:w-full",
                  collapsed && "lg:justify-center lg:px-2",
                  activeClassName,
                )}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                <span className={cn(collapsed && "lg:hidden")}>{item.label}</span>
              </TabsTrigger>
            );

            if (!collapsed) return trigger;

            return (
              <Tooltip key={item.value}>
                <TooltipTrigger asChild>{trigger}</TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            );
          })}
        </TabsList>
      </div>
    </TooltipProvider>
  );
}
