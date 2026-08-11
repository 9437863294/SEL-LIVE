'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Boxes, Building2, FolderKanban, Settings, ShieldAlert } from 'lucide-react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Project } from '@/lib/types';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';

interface PropertyRecord {
  id: string;
  name: string;
  inventoryManagementRequired?: boolean;
}

const slugify = (text: string) => text.toLowerCase()
  .replace(/\s+/g, '-')
  .replace(/[^\w-]+/g, '')
  .replace(/--+/g, '-')
  .replace(/^-+/, '')
  .replace(/-+$/, '');

export default function StoreStockDashboard() {
  const router = useRouter();
  const { can, isLoading: authorizationLoading } = useAuthorization();
  const canViewModule = can('View Module', 'Store & Stock Management');
  const [projects, setProjects] = useState<Project[]>([]);
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authorizationLoading) return;
    if (!canViewModule) { setLoading(false); return; }
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const [projectSnapshot, propertySnapshot] = await Promise.all([
          getDocs(query(collection(db, 'projects'), where('stockManagementRequired', '==', true))),
          getDocs(query(collection(db, 'insuredAssets'), where('type', '==', 'Property'))),
        ]);
        if (!active) return;
        setProjects(projectSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as Project).sort((a, b) => a.projectName.localeCompare(b.projectName)));
        setProperties(propertySnapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as PropertyRecord).filter((property) => property.inventoryManagementRequired));
      } catch (error) {
        console.error('Unable to load stock workspaces', error);
      } finally { if (active) setLoading(false); }
    };
    load();
    return () => { active = false; };
  }, [authorizationLoading, canViewModule]);

  const handleWorkspaceChange = (value: string) => {
    if (value === 'properties') {
      router.push('/store-stock-management/inventory');
      return;
    }
    if (value.startsWith('project:')) {
      router.push(`/store-stock-management/${value.slice('project:'.length)}`);
    }
  };

  if (authorizationLoading || (loading && canViewModule)) {
    return <div className="w-full p-6"><Skeleton className="mb-6 h-8 w-64" /><Skeleton className="mx-auto h-72 max-w-3xl" /></div>;
  }
  if (!canViewModule) {
    return <div className="w-full p-6"><h1 className="mb-6 text-2xl font-bold sm:text-3xl">Store &amp; Stock Management</h1><Card><CardHeader><CardTitle>Access denied</CardTitle><CardDescription>You do not have permission to access this module.</CardDescription></CardHeader><CardContent className="flex justify-center p-8"><ShieldAlert className="h-16 w-16 text-destructive" /></CardContent></Card></div>;
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-8 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><h1 className="text-2xl font-bold sm:text-3xl">Store &amp; Stock Management</h1><p className="text-muted-foreground">Choose property inventory or a BOQ-based project workspace.</p></div>
        <Button asChild variant="outline"><Link href="/store-stock-management/settings"><Settings className="mr-2 h-4 w-4" />Settings</Link></Button>
      </div>

      <Card className="mx-auto w-full max-w-3xl">
        <CardHeader className="text-center"><div className="mx-auto mb-2 rounded-full bg-primary/10 p-4"><Boxes className="h-7 w-7 text-primary" /></div><CardTitle className="text-2xl">Select stock workspace</CardTitle><CardDescription>Properties open item-based inventory. Projects open their existing BOQ stock workspace.</CardDescription></CardHeader>
        <CardContent>
          <Select onValueChange={handleWorkspaceChange} disabled={loading}>
            <SelectTrigger className="h-14 w-full text-base"><SelectValue placeholder="Select Properties or a Project…" /></SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Property item inventory</SelectLabel>
                <SelectItem value="properties"><span className="flex items-center gap-2"><Building2 className="h-4 w-4" />Properties — Item-based Inventory ({properties.length} enabled)</span></SelectItem>
              </SelectGroup>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>Project BOQ stock</SelectLabel>
                {projects.map((project) => <SelectItem key={project.id} value={`project:${slugify(project.projectName)}`}><span className="flex items-center gap-2"><FolderKanban className="h-4 w-4" />{project.projectName}</span></SelectItem>)}
                {!projects.length && <SelectItem value="no-projects" disabled>No BOQ stock projects enabled</SelectItem>}
              </SelectGroup>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <div className="mx-auto grid w-full max-w-3xl gap-4 sm:grid-cols-2">
        <Card><CardHeader><Building2 className="mb-2 h-6 w-6 text-primary" /><CardTitle className="text-lg">Properties</CardTitle><CardDescription>Opens `/store-stock-management/inventory` for Item Master, locations, receipts, issues, transfers, counts, and ledger.</CardDescription></CardHeader></Card>
        <Card><CardHeader><FolderKanban className="mb-2 h-6 w-6 text-primary" /><CardTitle className="text-lg">Projects</CardTitle><CardDescription>Opens `/store-stock-management/[project]` for the existing BOQ, BOM, conversion, and project-stock screens.</CardDescription></CardHeader></Card>
      </div>
    </div>
  );
}
