"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { useModules } from "@/context/ModuleContext";
import ModuleCard from "./ModuleCard";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthorization } from "@/hooks/useAuthorization";
import type { Module } from "@/lib/types";
import { permissionModules } from "@/lib/permissions";
import { useAuth } from "@/components/auth/AuthProvider";
import { useCurrentDriverProfile } from "@/components/vehicle-management/hooks";

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
};

const moduleDescriptions: Record<string, string> = {
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

export default function ModuleDashboard() {
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
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);

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

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLDivElement>, id: string) => {
      setDraggedItemId(id);
      e.dataTransfer.effectAllowed = "move";
    },
    [],
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>, targetId: string) => {
      e.preventDefault();
      if (draggedItemId === null || draggedItemId === targetId) return;

      const currentModules = allModules;
      const draggedIndex = currentModules.findIndex(
        (m) => m.id === draggedItemId,
      );
      const targetIndex = currentModules.findIndex((m) => m.id === targetId);

      if (draggedIndex === -1 || targetIndex === -1) return;

      const newModules = [...currentModules];
      const [draggedItem] = newModules.splice(draggedIndex, 1);
      newModules.splice(targetIndex, 0, draggedItem);
      updateModuleOrder(newModules);
    },
    [draggedItemId, allModules, updateModuleOrder],
  );

  const handleDragEnd = useCallback(() => {
    setDraggedItemId(null);
  }, []);

  return (
    <div className="flex flex-col gap-6 h-full p-3 sm:p-4 md:p-6">
      <div
        className="grid grid-cols-2 gap-3 sm:gap-6 lg:grid-cols-3 xl:grid-cols-4"
        onDragOver={handleDragOver}
      >
        {isLoading || authLoading
          ? Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-24 sm:h-28 rounded-xl" />
            ))
          : allModules.map((module) => (
              <ModuleCard
                key={module.id}
                module={module}
                draggable
                onDragStart={(e) => handleDragStart(e, module.id)}
                onDrop={(e) => handleDrop(e, module.id)}
                onDragEnd={handleDragEnd}
                isDragging={draggedItemId === module.id}
              />
            ))}
      </div>
    </div>
  );
}
