"use client";

import Link from 'next/link';
import {
  ArrowRight,
  Boxes,
  Construction,
  FilePen,
  MapPin,
  PackageSearch,
  Ruler,
  Settings2,
  SlidersHorizontal,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader, SectionHeader } from '@/components/shared/page-header';
import { cn } from '@/lib/utils';

type SettingsItem = {
  icon: LucideIcon;
  title: string;
  href: string;
  description: string;
  tone: string;
  badge?: string;
};

type SettingsGroup = {
  title: string;
  description: string;
  items: SettingsItem[];
};

const groups: SettingsGroup[] = [
  {
    title: 'Inventory foundation',
    description: 'Define what can be stocked and where balances are held.',
    items: [
      {
        icon: PackageSearch,
        title: 'Item Master',
        href: '/store-stock-management/inventory/items',
        description: 'Maintain item codes, units, costing, reorder controls, and tracking requirements.',
        tone: 'bg-cyan-100 text-cyan-700',
        badge: 'Core master',
      },
      {
        icon: Warehouse,
        title: 'Inventory Locations',
        href: '/store-stock-management/inventory/locations',
        description: 'Configure central, property, project, quarantine, transit, and scrap locations.',
        tone: 'bg-teal-100 text-teal-700',
        badge: 'Core master',
      },
      {
        icon: SlidersHorizontal,
        title: 'Stock Scope',
        href: '/store-stock-management/settings/stock-status',
        description: 'Enable BOQ project stock and property item inventory independently.',
        tone: 'bg-emerald-100 text-emerald-700',
        badge: 'Access control',
      },
    ],
  },
  {
    title: 'Project structure',
    description: 'Maintain the project and site records used by stock workflows.',
    items: [
      {
        icon: Construction,
        title: 'Projects',
        href: '/store-stock-management/settings/projects',
        description: 'Create and maintain project identity, location, division, and status.',
        tone: 'bg-amber-100 text-amber-700',
      },
      {
        icon: MapPin,
        title: 'Project Sites',
        href: '/store-stock-management/settings/sites',
        description: 'Organize operational sites under the correct parent project.',
        tone: 'bg-rose-100 text-rose-700',
      },
    ],
  },
  {
    title: 'Transaction configuration',
    description: 'Control measurement and goods-receipt data requirements.',
    items: [
      {
        icon: Ruler,
        title: 'Units of Measure',
        href: '/store-stock-management/settings/units',
        description: 'Manage the units available for inventory and BOQ items.',
        tone: 'bg-sky-100 text-sky-700',
      },
      {
        icon: FilePen,
        title: 'GRN Entry',
        href: '/store-stock-management/settings/grn-entry',
        description: 'Choose which purchase, invoice, and transport fields are mandatory on GRNs.',
        tone: 'bg-violet-100 text-violet-700',
      },
    ],
  },
];

export default function SettingsPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        className="mb-0 sm:mb-0"
        icon={Settings2}
        eyebrow="Configuration centre"
        title="Store & Stock Management Settings"
        description="Configure inventory masters, project structure, stock availability, and transaction requirements from one place."
        actions={
          <>
            <Button asChild variant="outline"><Link href="/store-stock-management/settings/stock-status"><SlidersHorizontal className="mr-2 h-4 w-4" />Configure stock scope</Link></Button>
            <Button asChild><Link href="/store-stock-management/inventory"><Boxes className="mr-2 h-4 w-4" />Open inventory</Link></Button>
          </>
        }
      />

      {groups.map((group) => (
        <section key={group.title} className="space-y-4">
          <SectionHeader className="mb-0" title={group.title} description={group.description} />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href} className="group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50">
                  <Card className="h-full border-slate-200/80 bg-white/90 transition-all duration-200 group-hover:-translate-y-0.5 group-hover:border-indigo-200 group-hover:shadow-md">
                    <CardContent className="flex h-full items-start gap-4 p-5">
                      <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', item.tone)}><Icon className="h-5 w-5" /></div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h3 className="text-[15px] font-semibold leading-snug tracking-tight text-slate-900 sm:text-base">{item.title}</h3>
                            {item.badge && <Badge variant="outline" className="mt-1 text-[10px]">{item.badge}</Badge>}
                          </div>
                          <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-1 group-hover:text-indigo-600" />
                        </div>
                        <p className="mt-2 text-sm leading-5 text-muted-foreground">{item.description}</p>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
