'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Building2, FolderKanban, Loader2, Search } from 'lucide-react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { inventoryCommand } from '@/lib/inventory-client';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import type { Project } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

interface PropertyRecord {
  id: string;
  name: string;
  location?: string;
  description?: string;
  status: 'Active' | 'Inactive';
  type: 'Property';
  inventoryManagementRequired?: boolean;
}

export default function StockStatusPage() {
  const { toast } = useToast();
  const { can, isLoading: authorizationLoading } = useAuthorization();
  const [projects, setProjects] = useState<Project[]>([]);
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const canEditAll = can('Edit', 'Store & Stock Management.Settings');
  const canEditProjects = canEditAll || can('Manage Projects', 'Store & Stock Management.Settings');
  const canEditProperties = canEditAll || can('Manage Properties', 'Store & Stock Management.Settings');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [projectSnapshot, propertySnapshot] = await Promise.all([
        getDocs(collection(db, 'projects')),
        getDocs(query(collection(db, 'insuredAssets'), where('type', '==', 'Property'))),
      ]);
      setProjects(projectSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as Project).sort((a, b) => a.projectName.localeCompare(b.projectName)));
      setProperties(propertySnapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as PropertyRecord).sort((a, b) => a.name.localeCompare(b.name)));
    } catch (error) {
      console.error('Unable to load stock-management scopes', error);
      toast({ title: 'Unable to load projects and properties', variant: 'destructive' });
    } finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (scope: 'Project' | 'Property', entityId: string, enabled: boolean) => {
    const key = `${scope}:${entityId}`;
    setSavingKey(key);
    try {
      await inventoryCommand({ action: 'setInventoryScopeStatus', scope, entityId, enabled });
      if (scope === 'Project') {
        setProjects((current) => current.map((project) => project.id === entityId ? { ...project, stockManagementRequired: enabled } : project));
      } else {
        setProperties((current) => current.map((property) => property.id === entityId ? { ...property, inventoryManagementRequired: enabled } : property));
      }
      toast({
        title: enabled ? `${scope} stock enabled` : `${scope} stock disabled`,
        description: scope === 'Project'
          ? 'This controls the legacy BOQ-based project stock workspace.'
          : enabled ? 'A default Property Main Store is now available for item transactions.' : 'The empty Property Main Store was deactivated.',
      });
    } catch (error) {
      toast({ title: 'Status update failed', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' });
    } finally { setSavingKey(null); }
  };

  const term = search.toLowerCase().trim();
  const filteredProjects = useMemo(() => projects.filter((project) => !term || [project.projectName, project.siteCode, project.location].some((value) => value?.toLowerCase().includes(term))), [projects, term]);
  const filteredProperties = useMemo(() => properties.filter((property) => !term || [property.name, property.location, property.description].some((value) => value?.toLowerCase().includes(term))), [properties, term]);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-600">Inventory availability</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Stock-management scope</h1>
        <p className="mt-1 text-sm text-muted-foreground">Enable BOQ-based project stock and property item inventory independently.</p>
      </div>

      <Alert>
        <FolderKanban className="h-4 w-4" />
        <AlertTitle>Two separate stock paths</AlertTitle>
        <AlertDescription><strong>Project BOQ Stock</strong> keeps the existing project/BOQ workflow. <strong>Property Item Inventory</strong> uses Item Master, Property Store locations, balances, and the stock ledger without requiring BOQ.</AlertDescription>
      </Alert>

      {!authorizationLoading && !canEditProjects && !canEditProperties && <Alert variant="destructive"><AlertTitle>View only</AlertTitle><AlertDescription>Your role needs Store &amp; Stock Management → Settings → Edit, Manage Projects, or Manage Properties to change these switches.</AlertDescription></Alert>}

      <div className="relative max-w-md"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search project or property…" /></div>

      <Tabs defaultValue="projects">
        <TabsList className="grid h-auto w-full max-w-2xl grid-cols-1 gap-1 p-1 sm:grid-cols-2">
          <TabsTrigger className="min-h-10" value="projects"><FolderKanban className="mr-2 h-4 w-4" />Project BOQ Stock ({projects.filter((project) => project.stockManagementRequired).length})</TabsTrigger>
          <TabsTrigger className="min-h-10" value="properties"><Building2 className="mr-2 h-4 w-4" />Property Item Inventory ({properties.filter((property) => property.inventoryManagementRequired).length})</TabsTrigger>
        </TabsList>

        <TabsContent value="projects" className="mt-4">
          <Card><CardHeader><CardTitle>BOQ-based project stock</CardTitle><CardDescription>Enabled projects appear in the legacy project selector with BOQ, BOM, conversions, project receipts, and project issues.</CardDescription></CardHeader><CardContent className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Project</TableHead><TableHead>Site code</TableHead><TableHead>Location</TableHead><TableHead>Project status</TableHead><TableHead className="text-right">BOQ stock enabled</TableHead></TableRow></TableHeader><TableBody>
            {loading ? <LoadingRows /> : filteredProjects.map((project) => <TableRow key={project.id}><TableCell className="font-medium">{project.projectName || '—'}</TableCell><TableCell>{project.siteCode || '—'}</TableCell><TableCell>{project.location || project.projectSite || '—'}</TableCell><TableCell><Badge variant={project.status === 'Active' ? 'default' : 'secondary'}>{project.status || 'Unknown'}</Badge></TableCell><TableCell className="text-right"><ScopeSwitch loading={savingKey === `Project:${project.id}`} checked={Boolean(project.stockManagementRequired)} disabled={!canEditProjects || project.status !== 'Active'} onChange={(checked) => toggle('Project', project.id, checked)} /></TableCell></TableRow>)}
            {!loading && !filteredProjects.length && <TableRow><TableCell colSpan={5} className="h-28 text-center text-muted-foreground">No projects match this search.</TableCell></TableRow>}
          </TableBody></Table></CardContent></Card>
        </TabsContent>

        <TabsContent value="properties" className="mt-4">
          <Card><CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between"><div><CardTitle>Property item inventory</CardTitle><CardDescription>Enabling a property creates or activates its default Main Store for Item Master transactions.</CardDescription></div><Button asChild variant="outline"><Link href="/insurance/settings/assets">Manage Property Master</Link></Button></CardHeader><CardContent className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Property</TableHead><TableHead>Location</TableHead><TableHead>Description</TableHead><TableHead>Property status</TableHead><TableHead className="text-right">Item inventory enabled</TableHead></TableRow></TableHeader><TableBody>
            {loading ? <LoadingRows /> : filteredProperties.map((property) => <TableRow key={property.id}><TableCell className="font-medium">{property.name}</TableCell><TableCell>{property.location || '—'}</TableCell><TableCell className="max-w-md truncate">{property.description || '—'}</TableCell><TableCell><Badge variant={property.status === 'Active' ? 'default' : 'secondary'}>{property.status || 'Unknown'}</Badge></TableCell><TableCell className="text-right"><ScopeSwitch loading={savingKey === `Property:${property.id}`} checked={Boolean(property.inventoryManagementRequired)} disabled={!canEditProperties || property.status !== 'Active'} onChange={(checked) => toggle('Property', property.id, checked)} /></TableCell></TableRow>)}
            {!loading && !filteredProperties.length && <TableRow><TableCell colSpan={5} className="h-28 text-center text-muted-foreground">No Property Master records found. Add a Property asset first.</TableCell></TableRow>}
          </TableBody></Table></CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ScopeSwitch({ loading, checked, disabled, onChange }: { loading: boolean; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }) {
  return <div className="inline-flex min-w-20 justify-end">{loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />}</div>;
}

function LoadingRows() {
  return <>{Array.from({ length: 5 }).map((_, index) => <TableRow key={index}><TableCell colSpan={5}><Skeleton className="h-7 w-full" /></TableCell></TableRow>)}</>;
}
