'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Building2,
  FolderKanban,
  MapPin,
  RefreshCw,
  Settings,
  ShieldAlert,
} from 'lucide-react';
import { collection, getDocs, query, where } from 'firebase/firestore';

import type { Project } from '@/lib/types';
import { useAuthorization } from '@/hooks/useAuthorization';
import { db } from '@/lib/firebase';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

type PropertyRecord = {
  id: string;
  name: string;
};

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '');

function LandingSkeleton() {
  return (
    <div className="min-h-screen bg-slate-50 p-3 sm:p-4">
      <div className="flex items-center justify-between gap-4 border-b pb-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-72 max-w-full" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-10 w-28" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
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

      setProjects(projectSnapshot.docs
        .map((document) => ({ id: document.id, ...document.data() }) as Project)
        .sort((left, right) => left.projectName.localeCompare(right.projectName)));

      setProperties(propertySnapshot.docs
        .map((document) => ({ id: document.id, ...document.data() }) as PropertyRecord & {
          inventoryManagementRequired?: boolean;
        })
        .filter((property) => property.inventoryManagementRequired)
        .sort((left, right) => left.name.localeCompare(right.name)));
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

  if (authorizationLoading || isLoading) return <LandingSkeleton />;

  if (!canViewModule) {
    return (
      <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-slate-50 p-4">
        <Card className="w-full max-w-md border-rose-200">
          <CardContent className="flex flex-col items-center p-8 text-center">
            <div className="flex size-12 items-center justify-center rounded-xl bg-rose-100 text-rose-700">
              <ShieldAlert className="size-6" />
            </div>
            <h1 className="mt-4 text-xl font-bold">Access restricted</h1>
            <p className="mt-2 text-sm text-slate-600">
              Your role does not include access to Store &amp; Stock Management.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-3 text-slate-950 sm:p-4">
      <header className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Store &amp; Stock Management</h1>
          <p className="mt-1 text-sm text-slate-600">Select where you want to manage stock.</p>
        </div>
        <Button asChild variant="outline" className="w-fit bg-white">
          <Link href="/store-stock-management/settings" prefetch={false}>
            <Settings className="mr-2 size-4" />Settings
          </Link>
        </Button>
      </header>

      {loadError && (
        <Alert className="mt-4 border-amber-200 bg-amber-50">
          <RefreshCw className="size-4" />
          <AlertTitle>Unable to load workspaces</AlertTitle>
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{loadError}</span>
            <Button variant="outline" size="sm" onClick={() => void loadWorkspaces()} className="w-fit bg-white">
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <main className="mt-4 grid min-w-0 gap-4 lg:grid-cols-2">
        <Card className="border-emerald-200 bg-white shadow-sm">
          <CardHeader className="border-b bg-emerald-50/70 p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white">
                  <Building2 className="size-5" />
                </div>
                <div>
                  <CardTitle>Property Inventory</CardTitle>
                  <CardDescription className="mt-1">Items, stores, receipts, issues and transfers</CardDescription>
                </div>
              </div>
              <Badge variant="secondary" className="shrink-0 bg-white text-emerald-700">
                {properties.length} {properties.length === 1 ? 'property' : 'properties'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-5">
            <div className="min-h-20">
              <p className="text-sm font-medium text-slate-700">Enabled properties</p>
              {properties.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {properties.map((property) => (
                    <Badge key={property.id} variant="outline" className="bg-white font-normal">
                      <MapPin className="mr-1 size-3" />{property.name}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-sm text-slate-500">No properties are enabled yet.</p>
              )}
            </div>
            <Button asChild className="mt-5 w-full bg-emerald-600 hover:bg-emerald-700 sm:w-auto">
              <Link href="/store-stock-management/inventory" prefetch={false}>
                Open Property Inventory<ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="border-sky-200 bg-white shadow-sm">
          <CardHeader className="border-b bg-sky-50/70 p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-sky-600 text-white">
                  <FolderKanban className="size-5" />
                </div>
                <div>
                  <CardTitle>Project Stock</CardTitle>
                  <CardDescription className="mt-1">BOQ-based stock for each project</CardDescription>
                </div>
              </div>
              <Badge variant="secondary" className="shrink-0 bg-white text-sky-700">
                {projects.length} {projects.length === 1 ? 'project' : 'projects'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-5">
            {projects.length ? (
              <div className="space-y-2">
                {projects.map((project) => {
                  const projectLocation = project.location || project.projectSite || project.projectDivision;
                  const active = project.status === 'Active';
                  return (
                    <Link
                      key={project.id}
                      href={`/store-stock-management/${slugify(project.projectName)}`}
                      prefetch={false}
                      className="group flex min-w-0 items-center gap-3 rounded-xl border border-slate-200 p-3 transition hover:border-sky-300 hover:bg-sky-50/60"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate font-semibold text-slate-900">{project.projectName}</p>
                          <Badge
                            variant="outline"
                            className={cn(
                              'h-5 px-1.5 text-[10px]',
                              active
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : 'border-slate-200 text-slate-500',
                            )}
                          >
                            {project.status || 'Configured'}
                          </Badge>
                        </div>
                        {(project.siteCode || projectLocation) && (
                          <p className="mt-1 truncate text-xs text-slate-500">
                            {[project.siteCode, projectLocation].filter(Boolean).join(' · ')}
                          </p>
                        )}
                      </div>
                      <ArrowRight className="size-4 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-sky-700" />
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="flex min-h-24 items-center justify-center rounded-xl border border-dashed bg-slate-50 p-5 text-center text-sm text-slate-500">
                No BOQ stock projects are enabled yet.
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
