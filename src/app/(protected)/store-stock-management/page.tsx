'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  Boxes,
  Building2,
  CheckCircle2,
  ClipboardList,
  FolderKanban,
  Layers3,
  MapPin,
  PackagePlus,
  RefreshCw,
  Repeat2,
  Settings,
  ShieldAlert,
  Warehouse,
} from 'lucide-react';
import { collection, getDocs, query, where } from 'firebase/firestore';

import type { Project } from '@/lib/types';
import { useAuthorization } from '@/hooks/useAuthorization';
import { db } from '@/lib/firebase';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

type PropertyRecord = {
  id: string;
  name: string;
};

const propertyShortcuts = [
  {
    href: '/store-stock-management/inventory/item-wise',
    label: 'Item-wise stock',
    description: 'See availability by item',
    icon: Boxes,
  },
  {
    href: '/store-stock-management/inventory/movements',
    label: 'Receive or issue',
    description: 'Record inventory movement',
    icon: Repeat2,
  },
  {
    href: '/store-stock-management/inventory/assemblies',
    label: 'Build item packs',
    description: 'Assemble items from pack lists',
    icon: PackagePlus,
  },
  {
    href: '/store-stock-management/inventory/ledger',
    label: 'Stock ledger',
    description: 'Review the audit trail',
    icon: ClipboardList,
  },
] as const;

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '');

function StatCard({
  icon: Icon,
  label,
  value,
  detail,
  className,
}: {
  icon: typeof Boxes;
  label: string;
  value: string | number;
  detail: string;
  className?: string;
}) {
  return (
    <Card className="border-slate-200/80 bg-white/95 shadow-sm">
      <CardContent className="flex items-center gap-4 p-4 sm:p-5">
        <div className={cn('flex size-11 shrink-0 items-center justify-center rounded-2xl', className)}>
          <Icon className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
          <div className="mt-1 flex items-baseline gap-2">
            <p className="text-2xl font-bold tracking-tight text-slate-950">{value}</p>
            <p className="truncate text-xs text-slate-500">{detail}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function LandingSkeleton() {
  return (
    <div className="min-h-screen bg-slate-50">
      <Skeleton className="h-[340px] w-full rounded-none" />
      <div className="-mt-10 w-full space-y-4 px-2 pb-12 sm:px-3 lg:px-4">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24 rounded-2xl" />
          ))}
        </div>
        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.4fr)]">
          <Skeleton className="h-[500px] rounded-3xl" />
          <Skeleton className="h-[500px] rounded-3xl" />
        </div>
      </div>
    </div>
  );
}

export default function StoreStockManagementPage() {
  const { can, isLoading: authorizationLoading } = useAuthorization();
  const [projects, setProjects] = useState<Project[]>([]);
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const canViewModule = can('View Module', 'Store & Stock Management');

  const loadWorkspaces = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);

    try {
      const [projectSnapshot, propertySnapshot] = await Promise.all([
        getDocs(query(collection(db, 'projects'), where('stockManagementRequired', '==', true))),
        getDocs(query(collection(db, 'insuredAssets'), where('type', '==', 'Property'))),
      ]);

      const nextProjects = projectSnapshot.docs
        .map((document) => ({ id: document.id, ...document.data() }) as Project)
        .sort((left, right) => left.projectName.localeCompare(right.projectName));

      const nextProperties = propertySnapshot.docs
        .map((document) => ({ id: document.id, ...document.data() }) as PropertyRecord & {
          inventoryManagementRequired?: boolean;
        })
        .filter((property) => property.inventoryManagementRequired)
        .sort((left, right) => left.name.localeCompare(right.name));

      setProjects(nextProjects);
      setProperties(nextProperties);
    } catch (error) {
      console.error('Failed to load stock workspaces:', error);
      setLoadError('The workspace list could not be loaded. Check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authorizationLoading) return;

    if (!canViewModule) {
      setIsLoading(false);
      return;
    }

    void loadWorkspaces();
  }, [authorizationLoading, canViewModule, loadWorkspaces]);

  const enabledWorkspaceCount = properties.length + projects.length;
  const activeProjects = useMemo(
    () => projects.filter((project) => project.status === 'Active').length,
    [projects],
  );

  if (authorizationLoading || isLoading) {
    return <LandingSkeleton />;
  }

  if (!canViewModule) {
    return (
      <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-slate-50 p-6">
        <Card className="w-full max-w-lg border-rose-200 shadow-lg">
          <CardContent className="flex flex-col items-center px-8 py-12 text-center">
            <div className="flex size-16 items-center justify-center rounded-3xl bg-rose-100 text-rose-700">
              <ShieldAlert className="size-8" aria-hidden="true" />
            </div>
            <h1 className="mt-6 text-2xl font-bold text-slate-950">Access restricted</h1>
            <p className="mt-2 max-w-sm text-sm leading-6 text-slate-600">
              Your role does not include access to Store &amp; Stock Management. Ask an administrator to
              update your role permissions.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <section className="relative isolate overflow-hidden bg-slate-950 text-white">
        <div className="absolute inset-0 -z-20 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.28),transparent_34%),radial-gradient(circle_at_78%_15%,rgba(56,189,248,0.22),transparent_30%),linear-gradient(135deg,#020617_0%,#0f172a_55%,#102a2d_100%)]" />
        <div className="absolute inset-0 -z-10 opacity-20 [background-image:linear-gradient(rgba(255,255,255,.09)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.09)_1px,transparent_1px)] [background-size:42px_42px] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]" />
        <div className="flex min-h-[340px] w-full flex-col justify-center px-3 py-14 sm:px-4 lg:py-20">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="mb-5 flex flex-wrap items-center gap-2">
                <Badge className="border-emerald-300/25 bg-emerald-400/10 px-3 py-1 text-emerald-100 hover:bg-emerald-400/10">
                  <Warehouse className="mr-1.5 size-3.5" aria-hidden="true" />
                  Inventory command center
                </Badge>
                <Badge className="border-white/15 bg-white/5 px-3 py-1 text-slate-200 hover:bg-white/5">
                  {enabledWorkspaceCount} enabled workspace{enabledWorkspaceCount === 1 ? '' : 's'}
                </Badge>
              </div>
              <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
                Store &amp; Stock Management
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
                Choose the inventory model that matches your work: item-ledger stock for properties or
                BOQ-controlled stock for construction projects.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg" variant="outline" className="border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white">
                <Link href="/store-stock-management/settings">
                  <Settings className="mr-2 size-4" aria-hidden="true" />
                  Settings
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <main className="-mt-10 w-full space-y-4 px-2 pb-14 sm:px-3 lg:px-4">
        <section
          className="relative z-10 grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-3"
          aria-label="Stock workspace summary"
        >
          <StatCard
            icon={Layers3}
            label="Workspaces"
            value={enabledWorkspaceCount}
            detail="ready to manage"
            className="bg-slate-900 text-white"
          />
          <StatCard
            icon={Building2}
            label="Properties"
            value={properties.length}
            detail="inventory enabled"
            className="bg-emerald-100 text-emerald-700"
          />
          <StatCard
            icon={FolderKanban}
            label="BOQ projects"
            value={projects.length}
            detail="stock enabled"
            className="bg-sky-100 text-sky-700"
          />
          <StatCard
            icon={CheckCircle2}
            label="Active projects"
            value={activeProjects}
            detail="currently running"
            className="bg-violet-100 text-violet-700"
          />
        </section>

        {loadError ? (
          <Alert className="border-amber-200 bg-amber-50 text-amber-950">
            <RefreshCw className="size-4" aria-hidden="true" />
            <AlertTitle>Workspace data is unavailable</AlertTitle>
            <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>{loadError}</span>
              <Button variant="outline" size="sm" onClick={() => void loadWorkspaces()} className="w-fit border-amber-300 bg-white">
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.4fr)]">
          <Card className="overflow-hidden border-emerald-200/80 bg-white shadow-sm">
            <div className="relative overflow-hidden bg-gradient-to-br from-emerald-700 via-emerald-700 to-teal-800 px-6 py-7 text-white sm:px-7">
              <div className="absolute -right-12 -top-12 size-44 rounded-full border border-white/10 bg-white/5" />
              <div className="absolute -bottom-20 right-8 size-40 rounded-full bg-cyan-300/10 blur-2xl" />
              <div className="relative">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex size-12 items-center justify-center rounded-2xl bg-white/12 ring-1 ring-white/15">
                    <Building2 className="size-6" aria-hidden="true" />
                  </div>
                  <Badge className="border-white/15 bg-white/10 text-emerald-50 hover:bg-white/10">
                    Item-ledger stock
                  </Badge>
                </div>
                <p className="mt-7 text-xs font-bold uppercase tracking-[0.2em] text-emerald-200">Property inventory</p>
                <h2 className="mt-2 text-2xl font-bold tracking-tight">Manage stores, items and movements</h2>
                <p className="mt-3 text-sm leading-6 text-emerald-50/85">
                  Track stock by property, store and item. Receive, issue, transfer, assemble and audit inventory from one workspace.
                </p>
                <Button asChild className="mt-6 bg-white text-emerald-800 shadow-sm hover:bg-emerald-50">
                  <Link href="/store-stock-management/inventory">
                    Enter property inventory
                    <ArrowRight className="ml-2 size-4" aria-hidden="true" />
                  </Link>
                </Button>
              </div>
            </div>

            <CardContent className="space-y-6 p-6 sm:p-7">
              <div>
                <div className="flex items-center justify-between gap-4">
                  <h3 className="text-sm font-semibold text-slate-900">Enabled properties</h3>
                  <span className="text-xs font-medium text-slate-500">{properties.length} total</span>
                </div>
                {properties.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {properties.slice(0, 6).map((property) => (
                      <Badge key={property.id} variant="secondary" className="bg-emerald-50 font-medium text-emerald-800 hover:bg-emerald-50">
                        <MapPin className="mr-1 size-3" aria-hidden="true" />
                        {property.name}
                      </Badge>
                    ))}
                    {properties.length > 6 ? (
                      <Badge variant="outline" className="text-slate-600">+{properties.length - 6} more</Badge>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    No properties are enabled yet. Add one from inventory settings when you are ready.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-3">
                {propertyShortcuts.map((shortcut) => {
                  const Icon = shortcut.icon;
                  return (
                    <Link
                      key={shortcut.href}
                      href={shortcut.href}
                      className="group rounded-2xl border border-slate-200 bg-slate-50/70 p-4 transition hover:-translate-y-0.5 hover:border-emerald-300 hover:bg-emerald-50/60 hover:shadow-sm"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white text-slate-700 shadow-sm ring-1 ring-slate-200 transition group-hover:text-emerald-700 group-hover:ring-emerald-200">
                          <Icon className="size-4" aria-hidden="true" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900">{shortcut.label}</p>
                          <p className="mt-0.5 text-xs leading-5 text-slate-500">{shortcut.description}</p>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden border-sky-200/80 bg-white shadow-sm">
            <div className="border-b border-slate-200 bg-gradient-to-r from-sky-50 via-white to-violet-50 px-6 py-7 sm:px-7">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex gap-4">
                  <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-sky-600 text-white shadow-md shadow-sky-200">
                    <FolderKanban className="size-6" aria-hidden="true" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs font-bold uppercase tracking-[0.2em] text-sky-700">Project stock</p>
                      <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700">BOQ-controlled</Badge>
                    </div>
                    <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">Choose a project workspace</h2>
                    <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">
                      Compare BOQ requirements with receipts, issues and on-site balances for each project independently.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <CardContent className="p-6 sm:p-7">
              {projects.length > 0 ? (
                <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-4">
                  {projects.map((project) => {
                    const projectLocation = project.location || project.projectSite || project.projectDivision;
                    const isActive = project.status === 'Active';

                    return (
                      <Link
                        key={project.id}
                        href={`/store-stock-management/${slugify(project.projectName)}`}
                        className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 transition hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-lg hover:shadow-sky-100/70"
                      >
                        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-sky-500 to-violet-500 opacity-0 transition group-hover:opacity-100" />
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-700 ring-1 ring-sky-100">
                            <FolderKanban className="size-5" aria-hidden="true" />
                          </div>
                          <Badge
                            variant="outline"
                            className={cn(
                              'text-[11px]',
                              isActive
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : 'border-slate-200 bg-slate-50 text-slate-600',
                            )}
                          >
                            <span className={cn('mr-1.5 size-1.5 rounded-full', isActive ? 'bg-emerald-500' : 'bg-slate-400')} />
                            {project.status || 'Configured'}
                          </Badge>
                        </div>
                        <h3 className="mt-5 line-clamp-2 text-base font-bold leading-6 text-slate-950 transition group-hover:text-sky-800">
                          {project.projectName}
                        </h3>
                        <div className="mt-3 space-y-1.5 text-xs text-slate-500">
                          {project.siteCode ? (
                            <p className="font-semibold uppercase tracking-[0.12em] text-slate-500">{project.siteCode}</p>
                          ) : null}
                          {projectLocation ? (
                            <p className="flex items-center gap-1.5">
                              <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                              <span className="truncate">{projectLocation}</span>
                            </p>
                          ) : null}
                        </div>
                        <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4 text-sm font-semibold text-sky-700">
                          Open project
                          <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
                        </div>
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <div className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 px-6 text-center">
                  <div className="flex size-14 items-center justify-center rounded-2xl bg-sky-100 text-sky-700">
                    <FolderKanban className="size-7" aria-hidden="true" />
                  </div>
                  <h3 className="mt-4 font-semibold text-slate-900">No BOQ stock projects yet</h3>
                  <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">
                    Projects appear here after Stock Management is enabled in the project configuration.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </section>

      </main>
    </div>
  );
}
