"use client";

/**
 * Project Management's phone navigation bar.
 *
 * The module has no shell of its own — `layout.tsx` is a bare server layout and every screen brings
 * its own chrome — so this is mounted from that layout, beneath every page, and derives everything
 * from the URL. The project travels as `?project={mappingId}` on every screen in the module, and each
 * tab carries it on, the way the landing hub's tiles do.
 *
 * Tabs mirror the landing hub (`project-management/page.tsx`): Home, then three of the four delivery
 * scopes people work in on site. Each tab takes that hub tile's permission, and the project-scoped
 * ones appear only once a project is in the URL — without one those screens have nothing to show.
 *
 * No Create tab: the module creates a dozen different documents (indent, RFQ, PO, GRN, JMC…), each
 * from its own register, and there is no one "New" that means the same thing on every screen.
 */

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  Building2,
  ClipboardList,
  FileBarChart2,
  FileStack,
  FolderKanban,
  FolderOpen,
  HardHat,
  LayoutDashboard,
  Package,
  RadioTower,
  Settings,
} from "lucide-react";
import {
  ModuleBottomNav,
  type ModuleMoreLink,
  type ModuleNavTab,
} from "@/components/navigation/ModuleBottomNav";
import { useAuthorization } from "@/hooks/useAuthorization";
import { PM_JMC_BASE_PATH } from "@/lib/jmc-module";
import {
  TOWER_PROGRESS_PERMISSION_RESOURCE,
  towerProgressHref,
} from "@/lib/project-management-tower-progress";

const MODULE_NAME = "Project Management";
const BASE = "/project-management";

/**
 * Which screens light up which tab. The Supply hub fans out to thirteen sibling routes rather than
 * nesting them, and Civil's JMC lives at `/project-management/jmc`, so prefix-on-`href` would leave
 * most of the procurement chain showing "More".
 */
const SUPPLY_ROOTS = [
  "supply",
  "survey",
  "requirement-planner",
  "drawing",
  "indent",
  "rfq",
  "purchase-orders",
  "manufacturing-clearance",
  "inspections",
  "mdcc",
  "dispatch-instructions",
  "grn",
  "mvac",
].map((segment) => `${BASE}/${segment}`);
const CIVIL_ROOTS = [`${BASE}/civil`, PM_JMC_BASE_PATH];
// Tower Progress sits under Erection, so it reads as Erection here too; its own sub-navigation
// across the tower screens is untouched.
const ERECTION_ROOTS = [`${BASE}/erection`];

const under = (pathname: string, roots: string[]) =>
  roots.some((root) => pathname === root || pathname.startsWith(`${root}/`));

function ProjectManagementBottomNavInner() {
  const searchParams = useSearchParams();
  const { can } = useAuthorization();

  const mappingId = searchParams?.get("project") ?? "";
  const hasProject = Boolean(mappingId);
  const withProject = (path: string) =>
    hasProject ? `${path}?project=${encodeURIComponent(mappingId)}` : path;

  // The landing hub's own gates, so the bar never offers a screen the hub would not.
  const canViewModule = can("View Module", MODULE_NAME);
  const canViewBoq = can("View", `${MODULE_NAME}.BOQ`);
  const canViewMdl = can("View", `${MODULE_NAME}.MDL`) || canViewBoq;
  const canViewSupply = can("View", `${MODULE_NAME}.Supply`) || canViewBoq;
  const canViewCivil = can("View", `${MODULE_NAME}.Civil`) || canViewBoq;
  const canViewErection = can("View", `${MODULE_NAME}.Erection`) || canViewBoq;
  const canViewDocuments = can("View", `${MODULE_NAME}.Documents`) || canViewBoq;
  const canViewSettings = can("View", `${MODULE_NAME}.Settings`);
  // The Tower Progress screens' own rule (tower-progress-provider): its resource, or Erection View.
  const canViewTowerProgress =
    can("View", TOWER_PROGRESS_PERMISSION_RESOURCE) || can("View", `${MODULE_NAME}.Erection`);

  // The hub is Access Denied without View Module, and so is everything it links to.
  if (!canViewModule) return null;

  const tabs: Array<ModuleNavTab & { show: boolean }> = [
    {
      show: true,
      href: withProject(BASE),
      label: "Home",
      icon: LayoutDashboard,
      match: (path) => path === BASE,
    },
    {
      show: hasProject && canViewSupply,
      href: withProject(`${BASE}/supply`),
      label: "Supply",
      icon: Package,
      match: (path) => under(path, SUPPLY_ROOTS),
    },
    {
      show: hasProject && canViewCivil,
      href: withProject(`${BASE}/civil`),
      label: "Civil",
      icon: Building2,
      match: (path) => under(path, CIVIL_ROOTS),
    },
    {
      show: hasProject && canViewErection,
      href: withProject(`${BASE}/erection`),
      label: "Erection",
      icon: HardHat,
      match: (path) => under(path, ERECTION_ROOTS),
    },
    // Before a project is chosen, the project register is the one other screen that works.
    { show: !hasProject, href: `${BASE}/projects`, label: "Projects", icon: FolderKanban },
  ];

  // The landing hub's groups, in its order, plus Tower Progress — the one screen in the module
  // built to be used from a phone at the tower, and otherwise two taps deep inside Erection.
  const moreLinks: Array<ModuleMoreLink & { show: boolean }> = [
    { show: true, href: `${BASE}/projects`, label: "Projects", icon: FolderKanban, group: "Overview" },
    {
      show: hasProject && canViewBoq,
      href: withProject(`${BASE}/reports`),
      label: "Reports",
      icon: FileBarChart2,
      group: "Overview",
    },
    {
      show: hasProject && canViewBoq,
      href: withProject(`${BASE}/boq`),
      label: "BOQ",
      icon: ClipboardList,
      group: "Project Data",
    },
    {
      show: hasProject && canViewDocuments,
      href: withProject(`${BASE}/documents`),
      label: "Documents",
      icon: FolderOpen,
      group: "Project Data",
    },
    {
      show: hasProject && canViewMdl,
      href: withProject(`${BASE}/mdl`),
      label: "Design & Engineering",
      icon: FileStack,
      group: "Delivery Scopes",
    },
    {
      show: hasProject && canViewSupply,
      href: withProject(`${BASE}/supply`),
      label: "Supply",
      icon: Package,
      group: "Delivery Scopes",
    },
    {
      show: hasProject && canViewCivil,
      href: withProject(`${BASE}/civil`),
      label: "Civil",
      icon: Building2,
      group: "Delivery Scopes",
    },
    {
      show: hasProject && canViewErection,
      href: withProject(`${BASE}/erection`),
      label: "Erection",
      icon: HardHat,
      group: "Delivery Scopes",
    },
    {
      show: hasProject && canViewTowerProgress,
      href: towerProgressHref(mappingId),
      label: "Tower Progress",
      icon: RadioTower,
      group: "Delivery Scopes",
    },
    {
      show: canViewSettings,
      href: `${BASE}/settings`,
      label: "Settings",
      icon: Settings,
      group: "Configuration",
    },
  ];

  return (
    <ModuleBottomNav
      tabs={tabs.filter((tab) => tab.show)}
      moreLinks={moreLinks.filter((link) => link.show)}
      moduleName={MODULE_NAME}
    />
  );
}

/**
 * `useSearchParams` suspends while a route prerenders, so the bar gets its own boundary rather than
 * taking the page down to client rendering with it.
 */
export default function ProjectManagementBottomNav() {
  return (
    <Suspense fallback={null}>
      <ProjectManagementBottomNavInner />
    </Suspense>
  );
}
