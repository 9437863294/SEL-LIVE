'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  BarChart3,
  Boxes,
  Building2,
  ClipboardCheck,
  Component,
  ListTree,
  MapPin,
  PackagePlus,
  PackageSearch,
  Plus,
  Repeat2,
  Settings,
} from 'lucide-react';
import { ModuleShell, type ModuleNavGroup, type ModuleNavTab } from '@/components/shared/module-shell';

// Each page gates itself, so the menu is not permission-filtered.
const groups: ModuleNavGroup[] = [
  {
    id: 'operations',
    label: 'Operations',
    items: [
      { id: 'dashboard', href: '/store-stock-management/inventory', label: 'Dashboard', icon: Boxes, tone: 'blue' },
      { id: 'item-wise', href: '/store-stock-management/inventory/item-wise', label: 'Item-wise Inventory', icon: PackageSearch, tone: 'cyan' },
      { id: 'assemblies', href: '/store-stock-management/inventory/assemblies', label: 'Build / Unbuild', icon: Component, tone: 'fuchsia' },
      { id: 'movements', href: '/store-stock-management/inventory/movements', label: 'Receipts & Issues', icon: PackagePlus, tone: 'emerald' },
      { id: 'transfers', href: '/store-stock-management/inventory/transfers', label: 'Transfers', icon: Repeat2, tone: 'violet' },
      { id: 'counts', href: '/store-stock-management/inventory/counts', label: 'Stock Count', icon: ClipboardCheck, tone: 'amber' },
      { id: 'ledger', href: '/store-stock-management/inventory/ledger', label: 'Ledger & Reports', icon: BarChart3, tone: 'sky' },
    ],
  },
  {
    id: 'masters',
    label: 'Master data',
    items: [
      { id: 'items', href: '/store-stock-management/inventory/items', label: 'Item Master', icon: ListTree, tone: 'cyan' },
      { id: 'locations', href: '/store-stock-management/inventory/locations', label: 'Locations', icon: MapPin, tone: 'rose' },
    ],
  },
  {
    id: 'configuration',
    label: 'Configuration',
    items: [{ id: 'settings', href: '/store-stock-management/settings', label: 'Inventory Settings', icon: Settings, tone: 'slate' }],
  },
];

// The phone's bottom bar leads with the overview, stock by item, posting a receipt or issue, and
// transfers; the rest of the menu follows them, and "More" opens the bar's pop-up of every page,
// under the sidebar's headings. Not permission-filtered, like the sidebar.
const mobileTabs: ModuleNavTab[] = [
  { href: '/store-stock-management/inventory', label: 'Home', icon: Boxes, exact: true },
  { href: '/store-stock-management/inventory/item-wise', label: 'Stock', icon: PackageSearch, ariaLabel: 'Item-wise inventory' },
  { href: '/store-stock-management/inventory/movements', label: 'New', icon: Plus, emphasized: true, ariaLabel: 'Post a receipt, issue or adjustment' },
  { href: '/store-stock-management/inventory/transfers', label: 'Transfers', icon: Repeat2 },
];

/** The way out of the module, which is not an inventory page: the sidebar's foot and the top of the phone's pop-up. */
function BackLink({ sheet = false }: { sheet?: boolean }) {
  if (sheet) {
    return (
      <Link
        href="/store-stock-management"
        prefetch={false}
        className="flex items-center gap-3 rounded-2xl border border-border/60 bg-muted/30 px-3 py-2.5 text-sm font-medium text-foreground/80 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-background shadow-sm">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </span>
        Back to stock management
      </Link>
    );
  }
  return (
    <Link
      href="/store-stock-management"
      prefetch={false}
      className="flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>Stock management</span>
    </Link>
  );
}

export function InventoryModuleShell({ children }: { children: ReactNode }) {
  return (
    <ModuleShell
      title="Property Inventory"
      subtitle="Store & stock control"
      icon={Building2}
      groups={groups}
      mobileTabs={mobileTabs}
      footer={<BackLink />}
      mobileMoreContent={<BackLink sheet />}
    >
      {children}
    </ModuleShell>
  );
}
