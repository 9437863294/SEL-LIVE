'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Construction,
  FilePen,
  LayoutGrid,
  ListTree,
  MapPin,
  Ruler,
  Settings2,
  SlidersHorizontal,
  Warehouse,
} from 'lucide-react';
import { ModuleShell, type ModuleNavGroup, type ModuleNavTab } from '@/components/shared/module-shell';

// Not permission-filtered: each page gates itself.
const groups: ModuleNavGroup[] = [
  {
    id: 'configuration',
    label: 'Configuration',
    items: [
      { id: 'overview', href: '/store-stock-management/settings', label: 'Settings Overview', icon: LayoutGrid, tone: 'indigo' },
      { id: 'stock-status', href: '/store-stock-management/settings/stock-status', label: 'Stock Scope', icon: SlidersHorizontal, tone: 'emerald' },
      { id: 'projects', href: '/store-stock-management/settings/projects', label: 'Projects', icon: Construction, tone: 'amber' },
      { id: 'sites', href: '/store-stock-management/settings/sites', label: 'Project Sites', icon: MapPin, tone: 'rose' },
      { id: 'units', href: '/store-stock-management/settings/units', label: 'Units of Measure', icon: Ruler, tone: 'sky' },
      { id: 'grn-entry', href: '/store-stock-management/settings/grn-entry', label: 'GRN Entry', icon: FilePen, tone: 'violet' },
    ],
  },
  {
    id: 'masters',
    label: 'Inventory masters',
    items: [
      { id: 'items', href: '/store-stock-management/inventory/items', label: 'Item Master', icon: ListTree, tone: 'cyan' },
      { id: 'locations', href: '/store-stock-management/inventory/locations', label: 'Inventory Locations', icon: Warehouse, tone: 'teal' },
    ],
  },
];

// The phone's bottom bar leads with the overview and the three masters set up most often; the rest
// of the menu — units, GRN fields and the inventory masters — follows them, and "More" opens the
// bar's pop-up of every page, under the sidebar's two headings. Overview wears the shell's icon
// rather than its sidebar one, which is the same grid "More" uses.
const mobileTabs: ModuleNavTab[] = [
  { href: '/store-stock-management/settings', label: 'Overview', icon: Settings2, exact: true, ariaLabel: 'Settings overview' },
  { href: '/store-stock-management/settings/stock-status', label: 'Scope', icon: SlidersHorizontal, ariaLabel: 'Stock scope' },
  { href: '/store-stock-management/settings/projects', label: 'Projects', icon: Construction },
  { href: '/store-stock-management/settings/sites', label: 'Sites', icon: MapPin, ariaLabel: 'Project sites' },
];

/** The way back to inventory, which is not a settings page: the sidebar's foot and the top of the phone's pop-up. */
function BackLink({ sheet = false }: { sheet?: boolean }) {
  if (sheet) {
    return (
      <Link
        href="/store-stock-management/inventory"
        className="flex items-center gap-3 rounded-2xl border border-border/60 bg-muted/30 px-3 py-2.5 text-sm font-medium text-foreground/80 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-background shadow-sm">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </span>
        Back to inventory
      </Link>
    );
  }
  return (
    <Link
      href="/store-stock-management/inventory"
      className="flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>Back to inventory</span>
    </Link>
  );
}

export function SettingsModuleShell({ children }: { children: ReactNode }) {
  return (
    <ModuleShell
      title="Stock Settings"
      subtitle="Configuration & masters"
      icon={Settings2}
      groups={groups}
      mobileTabs={mobileTabs}
      footer={<BackLink />}
      mobileMoreContent={<BackLink sheet />}
    >
      {children}
    </ModuleShell>
  );
}
