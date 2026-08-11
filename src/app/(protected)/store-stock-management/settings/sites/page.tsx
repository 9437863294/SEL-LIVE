'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Edit,
  FolderKanban,
  Loader2,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { addDoc, collection, deleteDoc, doc, getDocs, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Project, Site } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type ProjectSiteGroup = {
  project: Project;
  sites: Site[];
};

const emptySite = { name: '', location: '' };

export default function ManageSitesPage() {
  const { toast } = useToast();
  const [groups, setGroups] = useState<ProjectSiteGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [isSiteDialogOpen, setIsSiteDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'add' | 'edit'>('add');
  const [siteFormData, setSiteFormData] = useState(emptySite);
  const [editingSiteId, setEditingSiteId] = useState<string | null>(null);
  const [currentProjectIdForSite, setCurrentProjectIdForSite] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  const projects = useMemo(() => groups.map((group) => group.project), [groups]);

  const fetchAllData = useCallback(async () => {
    setIsLoading(true);
    setLoadError('');
    try {
      const projectsSnapshot = await getDocs(collection(db, 'projects'));
      const projectRecords = projectsSnapshot.docs
        .map((projectDocument) => ({ id: projectDocument.id, ...projectDocument.data() }) as Project)
        .sort((left, right) => (left.projectName || '').localeCompare(right.projectName || ''));

      // Load all site subcollections concurrently. The previous sequential loop
      // became increasingly slow as the number of projects grew.
      const nextGroups = await Promise.all(projectRecords.map(async (project) => {
        const sitesSnapshot = await getDocs(collection(db, 'projects', project.id, 'sites'));
        const sites = sitesSnapshot.docs
          .map((siteDocument) => ({ id: siteDocument.id, ...siteDocument.data() }) as Site)
          .sort((left, right) => (left.name || '').localeCompare(right.name || ''));
        return { project, sites };
      }));
      setGroups(nextGroups);
    } catch (error) {
      console.error('Unable to load project sites', error);
      setLoadError('Project and site data could not be loaded. Check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAllData();
  }, [fetchAllData]);

  const openSiteDialog = (mode: 'add' | 'edit', projectId?: string, site?: Site) => {
    const selectedProjectId = projectId || projects[0]?.id || '';
    setDialogMode(mode);
    setCurrentProjectIdForSite(selectedProjectId);
    setEditingSiteId(mode === 'edit' && site ? site.id : null);
    setSiteFormData(mode === 'edit' && site ? { name: site.name || '', location: site.location || '' } : emptySite);
    setIsSiteDialogOpen(true);
  };

  const handleDialogChange = (open: boolean) => {
    setIsSiteDialogOpen(open);
    if (!open && !isSaving) {
      setEditingSiteId(null);
      setSiteFormData(emptySite);
      setCurrentProjectIdForSite('');
    }
  };

  const handleSiteSubmit = async () => {
    const name = siteFormData.name.trim();
    const location = siteFormData.location.trim();
    if (!currentProjectIdForSite || !name) {
      toast({ title: 'Project and site name are required', variant: 'destructive' });
      return;
    }

    const selectedGroup = groups.find((group) => group.project.id === currentProjectIdForSite);
    const duplicate = selectedGroup?.sites.some((site) =>
      site.id !== editingSiteId && site.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (duplicate) {
      toast({ title: 'Duplicate site name', description: `${name} already exists under ${selectedGroup?.project.projectName}.`, variant: 'destructive' });
      return;
    }

    setIsSaving(true);
    try {
      const sitePayload = { name, location };
      if (dialogMode === 'edit' && editingSiteId) {
        await updateDoc(doc(db, 'projects', currentProjectIdForSite, 'sites', editingSiteId), sitePayload);
        setGroups((current) => current.map((group) => group.project.id === currentProjectIdForSite
          ? {
              ...group,
              sites: group.sites
                .map((site) => site.id === editingSiteId ? { ...site, ...sitePayload } : site)
                .sort((left, right) => left.name.localeCompare(right.name)),
            }
          : group));
        toast({ title: 'Site updated', description: `${name} was updated successfully.` });
      } else {
        const created = await addDoc(collection(db, 'projects', currentProjectIdForSite, 'sites'), sitePayload);
        setGroups((current) => current.map((group) => group.project.id === currentProjectIdForSite
          ? { ...group, sites: [...group.sites, { id: created.id, ...sitePayload }].sort((left, right) => left.name.localeCompare(right.name)) }
          : group));
        toast({ title: 'Site created', description: `${name} was added successfully.` });
      }
      setIsSiteDialogOpen(false);
      setEditingSiteId(null);
      setSiteFormData(emptySite);
      setCurrentProjectIdForSite('');
    } catch (error) {
      console.error('Unable to save site', error);
      toast({ title: 'Unable to save site', description: 'The site could not be saved. Please try again.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteSite = async (projectId: string, site: Site) => {
    const key = `${projectId}:${site.id}`;
    setDeletingKey(key);
    try {
      await deleteDoc(doc(db, 'projects', projectId, 'sites', site.id));
      setGroups((current) => current.map((group) => group.project.id === projectId
        ? { ...group, sites: group.sites.filter((entry) => entry.id !== site.id) }
        : group));
      toast({ title: 'Site deleted', description: `${site.name} was removed from the project.` });
    } catch (error) {
      console.error('Unable to delete site', error);
      toast({ title: 'Unable to delete site', description: 'The site could not be deleted. Please try again.', variant: 'destructive' });
    } finally {
      setDeletingKey(null);
    }
  };

  const normalizedSearch = search.trim().toLowerCase();
  const filteredGroups = useMemo(() => groups.map((group) => {
    if (!normalizedSearch) return group;
    const projectMatches = [group.project.projectName, group.project.siteCode, group.project.location]
      .some((value) => value?.toLowerCase().includes(normalizedSearch));
    if (projectMatches) return group;
    const matchingSites = group.sites.filter((site) => [site.name, site.location]
      .some((value) => value?.toLowerCase().includes(normalizedSearch)));
    return matchingSites.length ? { ...group, sites: matchingSites } : null;
  }).filter((group): group is ProjectSiteGroup => Boolean(group)), [groups, normalizedSearch]);

  const totalSites = groups.reduce((sum, group) => sum + group.sites.length, 0);
  const configuredProjects = groups.filter((group) => group.sites.length > 0).length;
  const projectsWithoutSites = groups.length - configuredProjects;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-rose-600">Project structure</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Project Sites</h1>
          <p className="mt-1 text-sm text-muted-foreground">Maintain operating sites under the correct parent project.</p>
        </div>
        <Button onClick={() => openSiteDialog('add')} disabled={isLoading || !projects.length}>
          <Plus className="mr-2 h-4 w-4" />Add Site
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard label="Projects" value={groups.length} icon={FolderKanban} tone="bg-amber-100 text-amber-700" />
        <SummaryCard label="Configured sites" value={totalSites} icon={MapPin} tone="bg-rose-100 text-rose-700" />
        <SummaryCard label="Projects without sites" value={projectsWithoutSites} icon={Building2} tone="bg-slate-100 text-slate-700" />
      </div>

      {loadError && (
        <Alert variant="destructive">
          <AlertTitle>Unable to load project sites</AlertTitle>
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{loadError}</span>
            <Button variant="outline" size="sm" onClick={() => void fetchAllData()}><RefreshCw className="mr-2 h-4 w-4" />Retry</Button>
          </AlertDescription>
        </Alert>
      )}

      <Card className="border-slate-200/80 shadow-sm">
        <CardHeader className="gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle>Sites by project</CardTitle>
            <CardDescription>Review, add, edit, or remove sites without leaving the project group.</CardDescription>
          </div>
          <div className="relative w-full lg:w-80">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search project, site, or location…" className="pl-9" />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? <SitesSkeleton /> : filteredGroups.map((group) => (
            <section key={group.project.id} className="overflow-hidden rounded-xl border border-slate-200/80">
              <div className="flex flex-col gap-3 bg-slate-50/80 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate font-bold text-slate-900">{group.project.projectName || 'Unnamed project'}</h3>
                    <Badge variant={group.project.status === 'Active' ? 'default' : 'secondary'}>{group.project.status || 'Unknown'}</Badge>
                    <Badge variant="outline">{group.sites.length} site{group.sites.length === 1 ? '' : 's'}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{[group.project.siteCode, group.project.location].filter(Boolean).join(' · ') || 'No project code or location'}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => openSiteDialog('add', group.project.id)}>
                  <Plus className="mr-2 h-4 w-4" />Add to project
                </Button>
              </div>

              {group.sites.length ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow><TableHead>Site Name</TableHead><TableHead>Location</TableHead><TableHead className="w-48 text-right">Actions</TableHead></TableRow></TableHeader>
                    <TableBody>{group.sites.map((site) => {
                      const deleteKey = `${group.project.id}:${site.id}`;
                      return (
                        <TableRow key={site.id}>
                          <TableCell className="font-medium">{site.name}</TableCell>
                          <TableCell>{site.location || '—'}</TableCell>
                          <TableCell className="text-right">
                            <div className="inline-flex gap-2">
                              <Button variant="outline" size="sm" onClick={() => openSiteDialog('edit', group.project.id, site)}><Edit className="mr-2 h-4 w-4" />Edit</Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild><Button variant="destructive" size="sm"><Trash2 className="mr-2 h-4 w-4" />Delete</Button></AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Delete {site.name}?</AlertDialogTitle>
                                    <AlertDialogDescription>This permanently removes the site from {group.project.projectName}. Existing records that mention the site are not deleted.</AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      disabled={deletingKey === deleteKey}
                                      onClick={() => void handleDeleteSite(group.project.id, site)}
                                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    >
                                      {deletingKey === deleteKey && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Delete Site
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}</TableBody>
                  </Table>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
                  <MapPin className="mb-2 h-8 w-8 text-slate-300" />
                  <p className="text-sm font-medium text-slate-700">No sites configured</p>
                  <p className="mt-1 text-xs text-muted-foreground">Add the first operating site for this project.</p>
                </div>
              )}
            </section>
          ))}

          {!isLoading && !loadError && !groups.length && (
            <div className="py-14 text-center"><FolderKanban className="mx-auto mb-3 h-10 w-10 text-slate-300" /><p className="font-medium">No projects found</p><p className="mt-1 text-sm text-muted-foreground">Create a project before adding sites.</p></div>
          )}
          {!isLoading && groups.length > 0 && !filteredGroups.length && (
            <div className="py-14 text-center"><Search className="mx-auto mb-3 h-10 w-10 text-slate-300" /><p className="font-medium">No matching sites</p><p className="mt-1 text-sm text-muted-foreground">Try a different project, site, or location.</p></div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isSiteDialogOpen} onOpenChange={handleDialogChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{dialogMode === 'add' ? 'Add Project Site' : 'Edit Project Site'}</DialogTitle>
            <DialogDescription>{dialogMode === 'add' ? 'Create a site under the selected project.' : 'Update the site name or location.'}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="project-select">Project *</Label>
              <Select value={currentProjectIdForSite} onValueChange={setCurrentProjectIdForSite} disabled={dialogMode === 'edit'}>
                <SelectTrigger id="project-select"><SelectValue placeholder="Select a project" /></SelectTrigger>
                <SelectContent>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.projectName}</SelectItem>)}</SelectContent>
              </Select>
              {dialogMode === 'edit' && <p className="text-xs text-muted-foreground">A site’s parent project cannot be changed while editing.</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="siteName">Site Name *</Label>
              <Input id="siteName" value={siteFormData.name} onChange={(event) => setSiteFormData((current) => ({ ...current, name: event.target.value }))} placeholder="e.g., Main Plant" autoFocus />
            </div>
            <div className="space-y-2">
              <Label htmlFor="siteLocation">Location</Label>
              <Input id="siteLocation" value={siteFormData.location} onChange={(event) => setSiteFormData((current) => ({ ...current, location: event.target.value }))} placeholder="City, district, or address" />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline" disabled={isSaving}>Cancel</Button></DialogClose>
            <Button onClick={() => void handleSiteSubmit()} disabled={isSaving}>
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{dialogMode === 'add' ? 'Create Site' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryCard({ label, value, icon: Icon, tone }: { label: string; value: number; icon: typeof MapPin; tone: string }) {
  return (
    <Card className="border-slate-200/80 bg-white/90 shadow-sm">
      <CardContent className="flex items-center justify-between p-4">
        <div><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-bold tabular-nums">{value}</p></div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${tone}`}><Icon className="h-5 w-5" /></div>
      </CardContent>
    </Card>
  );
}

function SitesSkeleton() {
  return <div className="space-y-4">{Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-36 w-full rounded-xl" />)}</div>;
}
