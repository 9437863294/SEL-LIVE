'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowLeft,
  BarChart3,
  Boxes,
  Building2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Component,
  ListTree,
  MapPin,
  Menu,
  PackagePlus,
  PackageSearch,
  Repeat2,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

type NavigationItem = {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  iconClassName: string;
  iconBackground: string;
  activeGradient: string;
  exact?: boolean;
};

const operations: NavigationItem[] = [
  {
    href: '/store-stock-management/inventory',
    label: 'Dashboard',
    description: 'Stock overview',
    icon: Boxes,
    iconClassName: 'text-blue-700',
    iconBackground: 'bg-blue-100',
    activeGradient: 'from-blue-600 to-indigo-600',
    exact: true,
  },
  {
    href: '/store-stock-management/inventory/item-wise',
    label: 'Item-wise Inventory',
    description: 'Stock by item and location',
    icon: PackageSearch,
    iconClassName: 'text-cyan-700',
    iconBackground: 'bg-cyan-100',
    activeGradient: 'from-cyan-600 to-blue-600',
  },
  {
    href: '/store-stock-management/inventory/assemblies',
    label: 'Build / Unbuild',
    description: 'Assemble or recover sub-items',
    icon: Component,
    iconClassName: 'text-fuchsia-700',
    iconBackground: 'bg-fuchsia-100',
    activeGradient: 'from-fuchsia-600 to-purple-600',
  },
  {
    href: '/store-stock-management/inventory/movements',
    label: 'Receipts & Issues',
    description: 'Stock in and stock out',
    icon: PackagePlus,
    iconClassName: 'text-emerald-700',
    iconBackground: 'bg-emerald-100',
    activeGradient: 'from-emerald-600 to-teal-600',
  },
  {
    href: '/store-stock-management/inventory/transfers',
    label: 'Transfers',
    description: 'Move stock between stores',
    icon: Repeat2,
    iconClassName: 'text-violet-700',
    iconBackground: 'bg-violet-100',
    activeGradient: 'from-violet-600 to-purple-600',
  },
  {
    href: '/store-stock-management/inventory/counts',
    label: 'Stock Count',
    description: 'Physical verification',
    icon: ClipboardCheck,
    iconClassName: 'text-amber-700',
    iconBackground: 'bg-amber-100',
    activeGradient: 'from-amber-500 to-orange-600',
  },
  {
    href: '/store-stock-management/inventory/ledger',
    label: 'Ledger & Reports',
    description: 'Movement audit trail',
    icon: BarChart3,
    iconClassName: 'text-sky-700',
    iconBackground: 'bg-sky-100',
    activeGradient: 'from-sky-600 to-blue-600',
  },
];

const masters: NavigationItem[] = [
  {
    href: '/store-stock-management/inventory/items',
    label: 'Item Master',
    description: 'Items and stock controls',
    icon: ListTree,
    iconClassName: 'text-cyan-700',
    iconBackground: 'bg-cyan-100',
    activeGradient: 'from-cyan-600 to-blue-600',
  },
  {
    href: '/store-stock-management/inventory/locations',
    label: 'Locations',
    description: 'Stores, warehouses and bins',
    icon: MapPin,
    iconClassName: 'text-rose-700',
    iconBackground: 'bg-rose-100',
    activeGradient: 'from-rose-600 to-pink-600',
  },
];

const settingsItem: NavigationItem = {
  href: '/store-stock-management/settings',
  label: 'Inventory Settings',
  description: 'Scope and configuration',
  icon: Settings,
  iconClassName: 'text-slate-700',
  iconBackground: 'bg-slate-100',
  activeGradient: 'from-slate-600 to-slate-800',
};

const STORAGE_KEY = 'inventory-sidebar-expanded';

function isItemActive(pathname: string, item: NavigationItem) {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}

export function InventoryModuleShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || '';
  const [isExpanded, setIsExpanded] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved !== null) setIsExpanded(saved === 'true');
  }, []);

  const toggleExpanded = () => {
    setIsExpanded((current) => {
      const next = !current;
      window.localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  };

  const desktopLink = (item: NavigationItem) => {
    const active = isItemActive(pathname, item);
    const Icon = item.icon;
    const link = (
      <Link
        href={item.href}
        prefetch={false}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'group flex min-h-11 items-center rounded-xl transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
          isExpanded ? 'gap-3 px-2.5 py-2' : 'justify-center p-2',
          active
            ? cn('bg-gradient-to-r text-white shadow-sm', item.activeGradient)
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950',
        )}
      >
        <span className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-transform group-hover:scale-105',
          active ? 'bg-white/20' : item.iconBackground,
        )}>
          <Icon className={cn('h-4 w-4', active ? 'text-white' : item.iconClassName)} />
        </span>
        {isExpanded && (
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{item.label}</span>
            <span className={cn('block truncate text-[11px]', active ? 'text-white/75' : 'text-muted-foreground')}>
              {item.description}
            </span>
          </span>
        )}
      </Link>
    );

    if (isExpanded) return <div key={item.href}>{link}</div>;
    return (
      <Tooltip key={item.href}>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right">
          <p className="font-medium">{item.label}</p>
          <p className="text-xs opacity-80">{item.description}</p>
        </TooltipContent>
      </Tooltip>
    );
  };

  const mobileLink = (item: NavigationItem) => {
    const active = isItemActive(pathname, item);
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        prefetch={false}
        onClick={() => setMobileOpen(false)}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors',
          active ? cn('bg-gradient-to-r text-white shadow-sm', item.activeGradient) : 'text-slate-700 hover:bg-slate-100',
        )}
      >
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', active ? 'bg-white/20' : item.iconBackground)}>
          <Icon className={cn('h-4 w-4', active ? 'text-white' : item.iconClassName)} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{item.label}</span>
          <span className={cn('block truncate text-xs', active ? 'text-white/75' : 'text-muted-foreground')}>{item.description}</span>
        </span>
      </Link>
    );
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] w-full bg-gradient-to-br from-slate-50/80 via-background to-blue-50/40">
      <TooltipProvider delayDuration={100}>
        <aside className={cn(
          'fixed bottom-0 left-0 top-16 z-40 hidden flex-col border-r border-slate-200/80 bg-white/95 shadow-sm backdrop-blur transition-[width] duration-300 md:flex',
          isExpanded ? 'w-64' : 'w-[4.5rem]',
        )}>
          <div className={cn('flex h-[4.5rem] shrink-0 items-center border-b border-slate-200/70', isExpanded ? 'gap-3 px-4' : 'justify-center px-2')}>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-600 to-teal-700 shadow-sm">
              <Building2 className="h-5 w-5 text-white" />
            </div>
            {isExpanded && (
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-slate-900">Property Inventory</p>
                <p className="truncate text-[11px] text-muted-foreground">Store & stock control</p>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-2 py-3">
            {isExpanded && <p className="mb-1 px-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Operations</p>}
            <nav className="space-y-1" aria-label="Inventory operations">{operations.map(desktopLink)}</nav>
            <div className="my-3 border-t border-slate-200/70" />
            {isExpanded && <p className="mb-1 px-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Master data</p>}
            <nav className="space-y-1" aria-label="Inventory master data">{masters.map(desktopLink)}</nav>
          </div>

          <div className="shrink-0 space-y-1 border-t border-slate-200/70 p-2">
            {desktopLink(settingsItem)}
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  href="/store-stock-management"
                  prefetch={false}
                  className={cn('flex h-10 items-center rounded-lg text-sm font-medium text-muted-foreground transition-colors hover:bg-slate-100 hover:text-foreground', isExpanded ? 'gap-3 px-3' : 'justify-center px-2')}
                >
                  <ArrowLeft className="h-4 w-4 shrink-0" />
                  {isExpanded && <span>Stock management</span>}
                </Link>
              </TooltipTrigger>
              {!isExpanded && <TooltipContent side="right">Stock management</TooltipContent>}
            </Tooltip>
            <button
              type="button"
              onClick={toggleExpanded}
              aria-label={isExpanded ? 'Collapse inventory sidebar' : 'Expand inventory sidebar'}
              className={cn('flex h-10 w-full items-center rounded-lg text-sm font-medium text-muted-foreground transition-colors hover:bg-slate-100 hover:text-foreground', isExpanded ? 'gap-3 px-3' : 'justify-center px-2')}
            >
              {isExpanded ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              {isExpanded && <span>Collapse sidebar</span>}
            </button>
          </div>
        </aside>
      </TooltipProvider>

      <div className={cn('min-w-0 transition-[margin] duration-300', isExpanded ? 'md:ml-64' : 'md:ml-[4.5rem]')}>
        <div className="border-b bg-white/90 px-4 py-3 backdrop-blur md:hidden">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-600 to-teal-700">
                <Building2 className="h-4 w-4 text-white" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">Property Inventory</p>
                <p className="truncate text-xs text-muted-foreground">Store & stock control</p>
              </div>
            </div>
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm"><Menu className="mr-2 h-4 w-4" />Menu</Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[88vw] max-w-sm bg-slate-50 p-0">
                <SheetHeader className="border-b bg-white px-5 py-5 text-left">
                  <SheetTitle className="flex items-center gap-2"><Building2 className="h-5 w-5 text-emerald-700" />Property Inventory</SheetTitle>
                  <SheetDescription>Navigate inventory operations and master data.</SheetDescription>
                </SheetHeader>
                <div className="max-h-[calc(100vh-7rem)] overflow-y-auto p-3 pb-8">
                  <p className="mb-2 px-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Operations</p>
                  <nav className="space-y-1" aria-label="Mobile inventory operations">{operations.map(mobileLink)}</nav>
                  <div className="my-4 border-t" />
                  <p className="mb-2 px-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Master data</p>
                  <nav className="space-y-1" aria-label="Mobile inventory master data">{masters.map(mobileLink)}</nav>
                  <div className="my-4 border-t" />
                  {mobileLink(settingsItem)}
                  <Link href="/store-stock-management" prefetch={false} onClick={() => setMobileOpen(false)} className="mt-2 flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-muted-foreground hover:bg-slate-100 hover:text-foreground">
                    <ArrowLeft className="h-4 w-4" />Back to stock management
                  </Link>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>

        <main className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
