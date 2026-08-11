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
      <section className="relative overflow-hidden rounded-2xl border border-indigo-200/70 bg-gradient-to-br from-indigo-700 via-violet-700 to-purple-800 p-6 text-white shadow-lg sm:p-8">
        <div className="pointer-events-none absolute -right-12 -top-16 h-52 w-52 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-20 left-1/3 h-48 w-48 rounded-full bg-cyan-300/15 blur-3xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <Badge className="mb-4 border-white/20 bg-white/15 text-white hover:bg-white/15"><Settings2 className="mr-1.5 h-3.5 w-3.5" />Configuration centre</Badge>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Store &amp; Stock Management Settings</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-indigo-100 sm:text-base">
              Configure inventory masters, project structure, stock availability, and transaction requirements from one place.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="secondary"><Link href="/store-stock-management/settings/stock-status"><SlidersHorizontal className="mr-2 h-4 w-4" />Configure stock scope</Link></Button>
            <Button asChild className="border border-white/25 bg-white/10 text-white hover:bg-white/20"><Link href="/store-stock-management/inventory"><Boxes className="mr-2 h-4 w-4" />Open inventory</Link></Button>
          </div>
        </div>
      </section>

      {groups.map((group) => (
        <section key={group.title} className="space-y-4">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-slate-900">{group.title}</h2>
            <p className="text-sm text-muted-foreground">{group.description}</p>
          </div>
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
                            <h3 className="font-bold text-slate-900">{item.title}</h3>
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
