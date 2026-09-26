"use client";

import { useState, useCallback, useMemo, useEffect, useId, useRef } from "react";
import Link from "next/link";
import { EyeOff } from "lucide-react";
import { useModules } from "@/context/ModuleContext";
import ModuleCard from "./ModuleCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ToastAction } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { toast } from "@/hooks/use-toast";
import { useAuthorization } from "@/hooks/useAuthorization";
import type { Module } from "@/lib/types";
import { permissionModules } from "@/lib/permissions";
import type { Density } from "@/lib/appearance/model";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAppearance } from "@/components/theme/ThemeProvider";
import { useCurrentDriverProfile } from "@/components/vehicle-management/hooks";
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
    "Driver mobile workflows, trip actions, and assignment execution.",
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

/** Pinned cards reorder the pinned list; the rest reorder this device's saved arrangement. */
type DragSection = "pinned" | "modules";

/** A control to put focus back on once a pin or hide has moved the card it was on. */
type FocusRequest = { control: "pin" | "hide" | "show-all"; title?: string };

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
  const hasDriverPermission =
    can("View Module", "Driver Management") ||
    can("View", "Driver Management.Driver Mobile Hub") ||
    can("View", "Driver Management.Employee Trip Log") ||
    can("Add", "Driver Management.Employee Trip Log") ||
    can("Edit", "Driver Management.Employee Trip Log") ||
    can("View", "Vehicle Management.Driver Mobile") ||
    can("View", "Vehicle Management.Employee Trip Reimbursement") ||
    can("Add", "Vehicle Management.Employee Trip Reimbursement") ||
    can("Edit", "Vehicle Management.Employee Trip Reimbursement") ||
    can("View", "Vehicle Management.Driver Management");
  const { driver } = useCurrentDriverProfile(
    !authLoading && !hasDriverPermission,
  );
  const [dragging, setDragging] = useState<{
    id: string;
    title: string;
    section: DragSection;
  } | null>(null);

  const allModules = useMemo(() => {
    if (isLoading || authLoading) {
      return [];
    }

    const isAssignedDriverWithVehicle = Boolean(
      driver?.id &&
      (driver?.assignedVehicleId || driver?.assignedVehicleNumber),
    );

    const availableModuleNames = Object.keys(permissionModules).filter(
      (moduleName) => {
        // Filtered here rather than at render, so a card already saved in the user's own arrangement
        // disappears too — `visibleSavedModules` below is filtered against this same list.
        if (HIDDEN_FROM_DASHBOARD.has(moduleName)) return false;
        if (moduleName === "Driver Management") {
          return hasDriverPermission || isAssignedDriverWithVehicle;
        }
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
    hasDriverPermission,
    driver?.id,
    driver?.assignedVehicleId,
    driver?.assignedVehicleNumber,
  ]);

  // ── Personal arrangement ──────────────────────────────────────────────────────────────────────────
  // Pins, hides and grouping (Settings → Appearance → Layout and Navigation) only ever filter and
  // reorder `allModules` above — the modules this person may open. Nothing below adds a card: a
  // pinned name with no permitted module behind it simply has nothing to show.
  const { effective, updatePreferences } = useAppearance();
  const {
    hiddenModules,
    pinnedModules,
    moduleGrouping,
    dashboardCardDensity: density,
  } = effective.layout;

  const { pinned, rest } = useMemo(() => {
    const hidden = new Set(hiddenModules);
    // Hidden wins over pinned: hiding is the more deliberate "not here".
    const visible = allModules.filter((m) => !hidden.has(m.title));
    const pinned = pinnedModules.flatMap(
      (name) => visible.find((m) => m.title === name) ?? [],
    );
    return { pinned, rest: visible.filter((m) => !pinned.includes(m)) };
  }, [allModules, hiddenModules, pinnedModules]);

  const groups = useMemo(() => {
    if (moduleGrouping !== "category") return null;
    return MODULE_CATEGORIES.map((category) => ({
      category,
      modules: rest.filter(
        (m) => (moduleCategories[m.title] ?? "Other") === category,
      ),
    })).filter((group) => group.modules.length > 0);
  }, [rest, moduleGrouping]);

  // Titles in the order the cards appear on screen, for moving focus on after a hide.
  const displayOrder = useMemo(
    () =>
      [...pinned, ...(groups ? groups.flatMap((g) => g.modules) : rest)].map(
        (m) => m.title,
      ),
    [pinned, rest, groups],
  );

  // `updatePreferences` replaces top-level fields, so `layout` is merged here, never replaced.
  const updateLayoutList = useCallback(
    (
      key: "pinnedModules" | "hiddenModules",
      change: (list: string[]) => string[],
    ) => {
      updatePreferences((current) => ({
        ...current,
        layout: { ...current.layout, [key]: change(current.layout?.[key] ?? []) },
      }));
    },
    [updatePreferences],
  );

  const rootRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<FocusRequest | null>(null);

  // Pinning moves a card into another section and hiding removes it; either way React replaces the
  // button that had focus. From the keyboard, focus is put back where the person was working rather
  // than dropped on <body>. Not after a mouse click: focusing would scroll the page up to the Pinned
  // section, and a pointer has no place to lose.
  const requestFocus = useCallback((request: FocusRequest) => {
    let fromKeyboard = true;
    try {
      fromKeyboard = Boolean(document.activeElement?.matches(":focus-visible"));
    } catch {
      // No :focus-visible in this browser: restore focus anyway, the safer of the two.
    }
    pendingFocus.current = fromKeyboard ? request : null;
  }, []);

  useEffect(() => {
    const request = pendingFocus.current;
    if (!request) return;
    pendingFocus.current = null;
    const target = Array.from(
      rootRef.current?.querySelectorAll<HTMLElement>("[data-module-control]") ??
        [],
    ).find(
      (el) =>
        el.dataset.moduleControl === request.control &&
        (request.title === undefined || el.dataset.moduleTitle === request.title),
    );
    target?.focus();
  }, [pinnedModules, hiddenModules]);

  const togglePin = useCallback(
    (title: string) => {
      requestFocus({ control: "pin", title });
      updateLayoutList("pinnedModules", (list) =>
        list.includes(title)
          ? list.filter((name) => name !== title)
          : [...list, title],
      );
    },
    [requestFocus, updateLayoutList],
  );

  const hideModule = useCallback(
    (title: string) => {
      const index = displayOrder.indexOf(title);
      const next = displayOrder[index + 1] ?? displayOrder[index - 1];
      // The next card's own Hide button, so tidying several in a row is one key press each; with
      // nothing left, the empty state's "Show all modules".
      requestFocus(
        next ? { control: "hide", title: next } : { control: "show-all" },
      );
      updateLayoutList("hiddenModules", (list) =>
        list.includes(title) ? list : [...list, title],
      );
      toast({
        title: `${title} hidden`,
        description:
          "It still opens from its links. Bring it back any time from Settings → Appearance → Layout and Navigation.",
        action: (
          <ToastAction
            altText={`Show ${title} on the launcher again`}
            onClick={() =>
              updateLayoutList("hiddenModules", (list) =>
                list.filter((name) => name !== title),
              )
            }
          >
            Undo
          </ToastAction>
        ),
      });
    },
    [displayOrder, requestFocus, updateLayoutList],
  );

  const showAllModules = useCallback(() => {
    // The first card's pin button: the empty state that had focus is about to go.
    requestFocus({ control: "pin" });
    updateLayoutList("hiddenModules", () => []);
  }, [requestFocus, updateLayoutList]);

  const handleDragStart = useCallback(
    (
      e: React.DragEvent<HTMLDivElement>,
      module: Module,
      section: DragSection,
    ) => {
      setDragging({ id: module.id, title: module.title, section });
      e.dataTransfer.effectAllowed = "move";
    },
    [],
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>, target: Module, section: DragSection) => {
      e.preventDefault();
      // Only within a section. Dropping a pinned card among the rest (or the reverse) would have to
      // mean unpin (or pin), and a drag is too easy to make by accident to decide that.
      if (
        dragging === null ||
        dragging.section !== section ||
        dragging.id === target.id
      )
        return;

      if (section === "pinned") {
        updateLayoutList("pinnedModules", (list) => {
          const from = list.indexOf(dragging.title);
          const to = list.indexOf(target.title);
          if (from === -1 || to === -1) return list;
          const next = [...list];
          next.splice(from, 1);
          next.splice(to, 0, dragging.title);
          return next;
        });
        return;
      }

      // The saved arrangement covers every permitted module, pinned and hidden ones included, so a
      // card keeps its place in it while pinned or hidden and returns there when it comes back.
      const currentModules = allModules;
      const draggedIndex = currentModules.findIndex(
        (m) => m.id === dragging.id,
      );
      const targetIndex = currentModules.findIndex((m) => m.id === target.id);

      if (draggedIndex === -1 || targetIndex === -1) return;

      const newModules = [...currentModules];
      const [draggedItem] = newModules.splice(draggedIndex, 1);
      newModules.splice(targetIndex, 0, draggedItem);
      updateModuleOrder(newModules);
    },
    [dragging, allModules, updateModuleOrder, updateLayoutList],
  );

  const handleDragEnd = useCallback(() => {
    setDragging(null);
  }, []);

  const headingId = useId();
  const loading = isLoading || authLoading;
  const everythingHidden =
    !loading && allModules.length > 0 && pinned.length === 0 && rest.length === 0;
  const gridClass = cn(
    "grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
    gridGap[density],
  );

  // `section` null means not reorderable: the category view, where a drag has no single order to
  // change. Pinned cards are always the pinned section, so that is also their pressed state.
  const renderGrid = (list: Module[], section: DragSection | null) => (
    <div className={gridClass} onDragOver={section ? handleDragOver : undefined}>
      {list.map((module) => (
        <ModuleCard
          key={module.id}
          module={module}
          density={density}
          pinned={section === "pinned"}
          onTogglePin={() => togglePin(module.title)}
          onHide={() => hideModule(module.title)}
          {...(section
            ? {
                draggable: true,
                onDragStart: (e: React.DragEvent<HTMLDivElement>) =>
                  handleDragStart(e, module, section),
                onDrop: (e: React.DragEvent<HTMLDivElement>) =>
                  handleDrop(e, module, section),
                onDragEnd: handleDragEnd,
              }
            : {})}
          isDragging={
            dragging?.id === module.id && dragging.section === section
          }
        />
      ))}
    </div>
  );

  return (
    <TooltipProvider delayDuration={300}>
      <div
        ref={rootRef}
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
        ) : everythingHidden ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-4 py-10 text-center">
            <EyeOff className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            <div className="max-w-md space-y-1">
              <h2 className="text-base font-semibold">Every module is hidden</h2>
              <p className="text-sm text-muted-foreground">
                You have hidden all of your modules from this launcher. They still open from
                their links, and you can choose which ones to show in{" "}
                <Link
                  href="/settings/appearance/layout-navigation"
                  className="rounded-sm font-medium text-primary underline underline-offset-4 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Settings → Appearance → Layout and Navigation
                </Link>
                .
              </p>
            </div>
            <Button
              type="button"
              data-module-control="show-all"
              onClick={showAllModules}
            >
              Show all modules
            </Button>
          </div>
        ) : (
          <>
            {pinned.length > 0 && (
              <section
                aria-labelledby={`${headingId}-pinned`}
                className="flex flex-col gap-2"
              >
                <h2 id={`${headingId}-pinned`} className={sectionHeading}>
                  Pinned
                </h2>
                {renderGrid(pinned, "pinned")}
              </section>
            )}
            {groups ? (
              groups.map((group, index) => (
                <section
                  key={group.category}
                  aria-labelledby={`${headingId}-group-${index}`}
                  className="flex flex-col gap-2"
                >
                  <h2 id={`${headingId}-group-${index}`} className={sectionHeading}>
                    {group.category}
                  </h2>
                  {renderGrid(group.modules, null)}
                </section>
              ))
            ) : pinned.length > 0 ? (
              rest.length > 0 && (
                <section
                  aria-labelledby={`${headingId}-rest`}
                  className="flex flex-col gap-2"
                >
                  <h2 id={`${headingId}-rest`} className={sectionHeading}>
                    Other modules
                  </h2>
                  {renderGrid(rest, "modules")}
                </section>
              )
            ) : (
              // Nothing pinned and not grouped: the launcher exactly as it was, one unlabelled grid.
              renderGrid(rest, "modules")
            )}
          </>
        )}
      </div>
    </TooltipProvider>
  );
}
