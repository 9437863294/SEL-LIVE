"use client";

/**
 * The launcher's catalogue: which modules exist on the home page, what each is called, its icon,
 * its category and where its card goes — shared by every home design (Classic, Command and
 * Launchpad), so they can never disagree about what a person may open.
 */

import { useMemo } from "react";
import { useModules } from "@/context/ModuleContext";
import { useAuthorization } from "@/hooks/useAuthorization";
import { permissionModules } from "@/lib/permissions";
import type { Module } from "@/lib/types";

export const moduleIcons: Record<string, string> = {
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
export const HIDDEN_FROM_DASHBOARD = new Set<string>([
  // Reached through Project Management → Civil, which links into it already scoped to a project.
  "Subcontractors Management",
  // Project Management is deliberately NOT hidden: this card is its only entry point — it is not
  // in the app shell nav, and nothing else links to /project-management.
]);

export const moduleDescriptions: Record<string, string> = {
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
export const MODULE_CATEGORIES = [
  "Finance & Treasury",
  "Projects & Sites",
  "Procurement & Stores",
  "People & HR",
  "Fleet & Logistics",
  "Workspace & Communication",
  "Administration",
  "Other",
] as const;
export type ModuleCategory = (typeof MODULE_CATEGORIES)[number];

export const moduleCategories: Record<string, ModuleCategory> = {
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

/** Where a module's card opens. */
export function moduleHref(moduleTitle: string): string {
  const slug = moduleTitle.toLowerCase().replace(/\s+/g, "-");
  switch (moduleTitle) {
    case "Subcontractors Management":
      return "/subcontractors-management/all";
    case "Project Management":
      return "/project-management";
    case "Vendor Management":
      return "/vendor-management";
    case "Site Fund Requisition":
      return "/site-fund-requisition-2";
    case "Site Fund Request":
      return "/site-fund-request";
    case "Daily Requisition":
      return "/daily-requisition";
    case "Billing Recon":
      return "/billing-recon";
    case "Bank Balance":
      return "/bank-balance";
    case "Expenses":
      return "/expenses";
    case "Settings":
      return "/settings";
    case "Chat System":
      return "/chat-system";
    case "Loan":
      return "/loan";
    case "Recurring Payments":
      return "/recurring-payments";
    case "Bill Tracking":
      return "/bill-tracking";
    // The slug fallback below would produce "hr-&-recruitment", so this needs naming explicitly.
    case "HR & Recruitment":
      return "/hr";
    // The slug fallback below would produce "tour,-travel-&-expense" (comma and ampersand carried
    // straight through), a URL no route matches, so this needs naming explicitly too.
    case "Tour, Travel & Expense":
      return "/tour-travel";
    case "Letter of Credit Management":
      return "/letter-of-credit";
    case "Bank Guarantee Management":
      return "/bank-guarantee";
    case "Fixed Deposit Management":
      return "/fixed-deposit";
    case "Insurance":
      return "/insurance";
    case "Store & Stock Management":
      return "/store-stock-management";
    case "Vehicle Management":
      return "/vehicle-management";
    case "Driver Management":
      return "/driver-management";
    case "Site Account Statement":
      return "/site-account-statement";
    case "Mail Hub":
      return "/mail";
    // Nested Settings Pages
    // User Management and Role Management no longer have screens of their own — Access Management
    // absorbed both. Their permission nodes stay (roles still hold them, and they still grant the
    // work), so all three titles resolve to the one screen.
    case "User Management":
    case "Role Management":
    case "Access Management":
      return "/settings/access-management";
    case "Serial No. Config":
      return "/settings/serial-no-configuration";
    case "Working Hrs":
      return "/settings/working-hours";
    case "Appearance":
      return "/settings/appearance";
    case "Email Authorization":
      return "/settings/email-authorization";
    case "Login Expiry":
      return "/settings/login-expiry";
    case "Manage Department":
      return "/settings/department";
    case "Manage Project":
      return "/settings/project";
    case "Employee":
      return "/employee";
    // Nested Expenses Settings — these live inside the module, under its own shell and its own
    // Expenses.Settings permissions. The /settings/expenses duplicates they used to point at are gone.
    case "Manage Accounts":
      return "/expenses/settings/accounts";
    case "Department-wise Serial Number":
      return "/expenses/settings/department-serial-no";
    // Nested Insurance Settings
    case "Policy Holders":
      return "/insurance/policy-holders";
    case "Insurance Companies":
      return "/insurance/companies";
    case "Policy Category":
      return "/insurance/settings/policy-category";
    case "Projects and Properties":
      return "/insurance/settings/assets";
    case "Help":
      return "/insurance/settings/help";
    default:
      return `/${slug}`;
  }
}

/**
 * The modules this person may open, in their saved arrangement, then any not arranged yet. Empty
 * while modules or permissions are still loading — `usePermittedModulesLoading` tells the two apart.
 */
export function usePermittedModules(): Module[] {
  const { modules, isLoading } = useModules();
  const { can, isLoading: authLoading } = useAuthorization();

  return useMemo(() => {
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
}

/** True while `usePermittedModules` cannot answer yet. */
export function usePermittedModulesLoading(): boolean {
  const { isLoading } = useModules();
  const { isLoading: authLoading } = useAuthorization();
  return isLoading || authLoading;
}
