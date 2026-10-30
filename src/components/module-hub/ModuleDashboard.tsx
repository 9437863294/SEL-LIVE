"use client";

import { useState, useCallback, useMemo, useId } from "react";
import { useModules } from "@/context/ModuleContext";
import ModuleCard from "./ModuleCard";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthorization } from "@/hooks/useAuthorization";
import type { Module } from "@/lib/types";
import type { Density } from "@/lib/appearance/model";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAppearance } from "@/components/theme/ThemeProvider";
import { cn } from "@/lib/utils";
import { useModuleGroups, usePermittedModules } from "./module-catalog";

/** "Dashboard card density" for the grid; the card pads itself to match. `standard` is the original. */
const gridGap: Record<Density, string> = {
  compact: "gap-2 sm:gap-3",
  standard: "gap-3 sm:gap-6",
  comfortable: "gap-4 sm:gap-8",
};
const skeletonHeight: Record<Density, string> = {
  compact: "h-20 sm:h-24",
  standard: "h-24 sm:h-28",
  comfortable: "h-28 sm:h-32",
};

const sectionHeading =
  "px-0.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground";

/**
 * `className` replaces the outer spacing, not just adds to it.
 *
 * The launcher used to be the whole page and owned its own page padding. Now it is one tab panel
 * beside the work board, and the panel already pads itself — so the caller needs to be able to say
 * "no padding here" rather than inheriting a second copy of it.
 */
export default function ModuleDashboard({ className }: { className?: string } = {}) {
  const { modules, addModule, updateModule, updateModuleOrder, isLoading } =
    useModules();
  const { can, isLoading: authLoading } = useAuthorization();
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const allModules = usePermittedModules();

  // ── Personal arrangement ──────────────────────────────────────────────────────────────────────────
  // Grouping (Settings → Appearance → Layout and Navigation) only ever rearranges `allModules` above —
  // the modules this person may open. Pinning and hiding modules were removed on 2026-10-30; a
  // `pinnedModules` or `hiddenModules` list saved before then is ignored, so every card is back in
  // the one list.
  const { effective } = useAppearance();
  const { moduleGrouping, dashboardCardDensity: density } = effective.layout;

  // The company's module groups (Theme Management › Module groups), each in this person's own order.
  const { groups: launcherGroups, groupOf } = useModuleGroups();
  const groups = useMemo(() => {
    if (moduleGrouping !== "category") return null;
    return launcherGroups
      .map((group) => ({
        category: group.label,
        id: group.id,
        modules: allModules.filter((m) => groupOf(m.title).id === group.id),
      }))
      .filter((group) => group.modules.length > 0);
  }, [allModules, moduleGrouping, launcherGroups, groupOf]);

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLDivElement>, module: Module) => {
      setDraggingId(module.id);
      e.dataTransfer.effectAllowed = "move";
    },
    [],
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>, target: Module) => {
      e.preventDefault();
      if (draggingId === null || draggingId === target.id) return;

      const currentModules = allModules;
      const draggedIndex = currentModules.findIndex(
        (m) => m.id === draggingId,
      );
      const targetIndex = currentModules.findIndex((m) => m.id === target.id);

      if (draggedIndex === -1 || targetIndex === -1) return;

      const newModules = [...currentModules];
      const [draggedItem] = newModules.splice(draggedIndex, 1);
      newModules.splice(targetIndex, 0, draggedItem);
      updateModuleOrder(newModules);
    },
    [draggingId, allModules, updateModuleOrder],
  );

  const handleDragEnd = useCallback(() => {
    setDraggingId(null);
  }, []);

  const headingId = useId();
  const loading = isLoading || authLoading;
  const gridClass = cn(
    "grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
    gridGap[density],
  );

  // Not reorderable in the category view, where a drag has no single order to change.
  const renderGrid = (list: Module[], reorderable: boolean) => (
    <div className={gridClass} onDragOver={reorderable ? handleDragOver : undefined}>
      {list.map((module) => (
        <ModuleCard
          key={module.id}
          module={module}
          density={density}
          {...(reorderable
            ? {
                draggable: true,
                onDragStart: (e: React.DragEvent<HTMLDivElement>) =>
                  handleDragStart(e, module),
                onDrop: (e: React.DragEvent<HTMLDivElement>) =>
                  handleDrop(e, module),
                onDragEnd: handleDragEnd,
              }
            : {})}
          isDragging={reorderable && draggingId === module.id}
        />
      ))}
    </div>
  );

  return (
    <div
      className={className ?? "flex flex-col gap-6 h-full p-2 sm:p-3 md:p-4"}
    >
      {loading ? (
        <div className={gridClass}>
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton
              key={i}
              className={cn("rounded-xl", skeletonHeight[density])}
            />
          ))}
        </div>
      ) : groups ? (
        groups.map((group, index) => (
          <section
            key={group.id}
            aria-labelledby={`${headingId}-group-${index}`}
            className="flex flex-col gap-2"
          >
            <h2 id={`${headingId}-group-${index}`} className={sectionHeading}>
              {group.category}
            </h2>
            {renderGrid(group.modules, false)}
          </section>
        ))
      ) : (
        renderGrid(allModules, true)
      )}
    </div>
  );
}
