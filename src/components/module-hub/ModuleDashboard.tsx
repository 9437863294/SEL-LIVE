"use client";

import { useState, useCallback, useMemo, useId } from "react";
import { useModules } from "@/context/ModuleContext";
import ModuleCard from "./ModuleCard";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthorization } from "@/hooks/useAuthorization";
import type { Module } from "@/lib/types";
import { permissionModules } from "@/lib/permissions";
import type { Density } from "@/lib/appearance/model";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAppearance } from "@/components/theme/ThemeProvider";
import { cn } from "@/lib/utils";

const moduleIcons: Record<string, string> = {
  "Site Fund Requisition": "Landmark",
  "Site Fund Requisition 2": "Workflow",
  "Site Fund Request": "GitMerge",
  "Daily Requisition": "ClipboardCheck",
  "Billing Recon": "CreditCard",
  "Bank Balance": "Banknote",
  Expenses: "Receipt",
  Settings: "Settings",
  "Chat System": "MessageSquare",
  "E-Approval": "Stamp",
  Loan: "Coins",
  "Recurring Payments": "RefreshCard",
  "Bill Tracking": "BillTracking",
  "Letter of Credit Management": "BookOpenCheck",
  "Bank Guarantee Management": "ShieldCheck",
  "Fixed Deposit Management": "Vault",
  Insurance: "Shield",
  "Store & Stock Management": "Package",
  "Subcontractors Management": "HardHat",
  "Project Management": "FolderKanban",
  "Vendor Management": "ShoppingCart",
  Employee: "IdBadge",
  "Vehicle Management": "Truck",
  "Driver Management": "SteeringWheel",
  "Site Account Statement": "LedgerChart",
  "Tour, Travel & Expense": "Plane",
  "Office Hub": "CalendarCheck",
  "Mail Hub": "MailOpen",
};

/**
 * Modules deliberately kept off the home dashboard.
 *
 * This hides the CARD only. Permissions, routes and every in-app link into these modules keep
 * working exactly as before — so a hidden module is still reachable by URL, and still reachable
 * from wherever another module links to it.
 *
 * Remove a name from this set to bring its card back; nothing else has to change.
 */
const HIDDEN_FROM_DASHBOARD = new Set<string>([
  // Reached through Project Management → Civil, which links into it already scoped to a project.
  "Subcontractors Management",
  // Project Management is deliberately NOT hidden: this card is its only entry point — it is not
  // in the app shell nav, and nothing else links to /project-management.
]);

const moduleDescriptions: Record<string, string> = {
  "Mail Hub":
    "Your mailboxes and shared team inboxes, linked to projects, vendors, POs and approvals.",
  "Office Hub":
    "Schedule meetings, run them, and turn what was decided into tracked tasks.",
  "Site Fund Requisition": "Handle site fund requests and approvals.",
  "Site Fund Requisition 2":
    "Raise, approve, and track site fund requests with configurable workflow and reporting.",
  "Site Fund Request": "Submit and approve site fund requests with workflow.",
  "Daily Requisition": "Handle daily material and service requests.",
  "Billing Recon": "Reconcile billing statements and payments.",
  "Bank Balance": "View and manage bank balance information.",
  Expenses: "Track and manage project expenses.",
  Settings: "Manage application-wide settings.",
  "Chat System": "Message colleagues directly or collaborate in groups.",
  "E-Approval":
    "Raise note-sheets and route them through approval, verification and clarification.",
  Loan: "Manage and track loan activities.",
  "Recurring Payments":
    "Manage recurring bills, approvals, due dates, and payments.",
  "Bill Tracking":
    "Track client bills, deductions, collections, retention, ageing and outstanding receivables.",
  "Letter of Credit Management":
    "Control LC requests, limits, collateral, bills, payments, recoveries, and closure.",
  "Bank Guarantee Management":
    "Control BG requests, limits, collateral, validity, custody, claims, and release.",
  "Fixed Deposit Management":
    "Manage FD principal, BG/LC utilisation, availability, maturities, and interest.",
  Insurance: "Manage insurance policies and claims.",
  "Store & Stock Management": "Manage inventory and stock levels.",
  "Subcontractors Management":
    "Manage subcontractors, work orders, and billing.",
  "Project Management": "Plan and manage projects.",
  "Vendor Management": "Manage vendors and purchase orders.",
  Employee: "Manage employee information and records.",
  "Vehicle Management": "Manage fleet, trips, fuel usage, and maintenance.",
  "Driver Management":
    "Record every official trip by GPS — your own vehicle, claimed per km, or a company vehicle, billed to the project — with approvals, payments, fuel and the driver app.",
  "Site Account Statement":
    "Track project-wise payments, expenses, and budgets with forecasts and reports.",
  "Tour, Travel & Expense":
    "Raise tour requests, route them for approval, and manage travel advances, expense claims, and settlements.",
};

/**
 * Headings for "Group modules by category" (Settings → Appearance → Layout and Navigation), in the
 * order they are shown. Keyed by the module names in `permissionModules`.
 *
 * Grouping only arranges cards the user may already open — it is not a list of what exists. A
 * module missing from this map is still shown, under "Other", so a new module never goes missing
 * from the launcher just because nobody filed it here.
 */
const MODULE_CATEGORIES = [
  "Finance & Treasury",
  "Projects & Sites",
  "Procurement & Stores",
  "People & HR",
  "Fleet & Logistics",
  "Workspace & Communication",
  "Administration",
  "Other",
] as const;
type ModuleCategory = (typeof MODULE_CATEGORIES)[number];

const moduleCategories: Record<string, ModuleCategory> = {
  "Bank Balance": "Finance & Treasury",
  "Fixed Deposit Management": "Finance & Treasury",
  "Letter of Credit Management": "Finance & Treasury",
  "Bank Guarantee Management": "Finance & Treasury",
  Loan: "Finance & Treasury",
  "Recurring Payments": "Finance & Treasury",
  "Bill Tracking": "Finance & Treasury",
  Expenses: "Finance & Treasury",
  Insurance: "Finance & Treasury",
  // Everything addressed to a site or a project, including the money that goes to one.
  "Project Management": "Projects & Sites",
  "Subcontractors Management": "Projects & Sites",
  "Billing Recon": "Projects & Sites",
  "Site Account Statement": "Projects & Sites",
  "Site Fund Requisition": "Projects & Sites",
  "Site Fund Requisition 2": "Projects & Sites",
  "Site Fund Request": "Projects & Sites",
  "Daily Requisition": "Procurement & Stores",
  "Store & Stock Management": "Procurement & Stores",
  "Vendor Management": "Procurement & Stores",
  Employee: "People & HR",
  "HR & Recruitment": "People & HR",
  "Tour, Travel & Expense": "People & HR",
  "Vehicle Management": "Fleet & Logistics",
  "Driver Management": "Fleet & Logistics",
  "Chat System": "Workspace & Communication",
  "Mail Hub": "Workspace & Communication",
  "Office Hub": "Workspace & Communication",
  "E-Approval": "Workspace & Communication",
  Settings: "Administration",
  "Module Hub": "Administration",
  "Windows Agent": "Administration",
};

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

  const allModules = useMemo(() => {
    if (isLoading || authLoading) {
      return [];
    }

    const availableModuleNames = Object.keys(permissionModules).filter(
      (moduleName) => {
        // Filtered here rather than at render, so a card already saved in the user's own arrangement
        // disappears too — `visibleSavedModules` below is filtered against this same list.
        if (HIDDEN_FROM_DASHBOARD.has(moduleName)) return false;
        // Every employee records their own trips and claims there; its pages check anything more.
        if (moduleName === "Driver Management") return true;
        return can("View Module", moduleName);
      },
    );

    const defaultModules = availableModuleNames.map((moduleName, index) => ({
      id: moduleName,
      title: moduleName,
      content: moduleDescriptions[moduleName] || `Manage ${moduleName}.`,
      tags: [] as string[],
      icon: moduleIcons[moduleName] || "FileText",
    }));

    const savedModules = modules;

    const visibleSavedModules = savedModules.filter((sm) =>
      availableModuleNames.includes(sm.title),
    );

    const newModules = defaultModules.filter(
      (dm) => !visibleSavedModules.some((vsm) => vsm.title === dm.title),
    );

    return [...visibleSavedModules, ...newModules];
  }, [
    modules,
    isLoading,
    can,
    authLoading,
  ]);

  // ── Personal arrangement ──────────────────────────────────────────────────────────────────────────
  // Grouping (Settings → Appearance → Layout and Navigation) only ever rearranges `allModules` above —
  // the modules this person may open. Pinning and hiding modules were removed on 2026-10-30; a
  // `pinnedModules` or `hiddenModules` list saved before then is ignored, so every card is back in
  // the one list.
  const { effective } = useAppearance();
  const { moduleGrouping, dashboardCardDensity: density } = effective.layout;

  const groups = useMemo(() => {
    if (moduleGrouping !== "category") return null;
    return MODULE_CATEGORIES.map((category) => ({
      category,
      modules: allModules.filter(
        (m) => (moduleCategories[m.title] ?? "Other") === category,
      ),
    })).filter((group) => group.modules.length > 0);
  }, [allModules, moduleGrouping]);

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
            key={group.category}
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
