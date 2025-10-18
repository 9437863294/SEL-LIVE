
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Edit, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc, query } from 'firebase/firestore';
import type { Site, Project } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const initialSiteState = {
    name: '',
    location: '',
};

export default function ManageSitesPage() {
    const { toast } = useToast();
    const [sitesByProject, setSitesByProject] = useState<Record<string, { projectName: string, sites: Site[] }>>({});
    const [projects, setProjects] = useState<Project[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const [isSiteDialogOpen, setIsSiteDialogOpen] = useState(false);
    const [dialogMode, setDialogMode] = useState<'add' | 'edit'>('add');
    const [siteFormData, setSiteFormData] = useState(initialSiteState);
    const [editingSiteId, setEditingSiteId] = useState<string | null>(null);
    const [currentProjectIdForSite, setCurrentProjectIdForSite] = useState<string>('');

    const fetchAllData = async () => {
        setIsLoading(true);
        try {
            const projectsSnap = await getDocs(collection(db, 'projects'));
            const projectsData = projectsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project));
            setProjects(projectsData);
            
            const allSitesData: Record<string, { projectName: string, sites: Site[] }> = {};
            for (const project of projectsData) {
                const sitesSnap = await getDocs(collection(db, 'projects', project.id, 'sites'));
                allSitesData[project.id] = {
                    projectName: project.projectName,
                    sites: sitesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Site))
                };
            }
            setSitesByProject(allSitesData);
        } catch (error) {
            console.error("Error fetching data:", error);
            toast({ title: "Error", description: "Failed to load project and site data.", variant: "destructive" });
        }
        setIsLoading(false);
    };

    useEffect(() => {
        fetchAllData();
    }, []);

    const openSiteDialog = (mode: 'add' | 'edit', projectId: string, site?: Site) => {
        setDialogMode(mode);
        setCurrentProjectIdForSite(projectId);
        if (mode === 'edit' && site) {
            setSiteFormData({ name: site.name, location: site.location });
            setEditingSiteId(site.id);
        } else {
            setSiteFormData(initialSiteState);
            setEditingSiteId(null);
        }
        setIsSiteDialogOpen(true);
    };

    const handleSiteSubmit = async () => {
        if (!currentProjectIdForSite || !siteFormData.name) {
            toast({ title: "Validation Error", description: "Project and Site Name are required.", variant: "destructive" });
            return;
        }
        try {
            const sitesCollectionRef = collection(db, 'projects', currentProjectIdForSite, 'sites');
            if (dialogMode === 'edit' && editingSiteId) {
                await updateDoc(doc(sitesCollectionRef, editingSiteId), siteFormData);
                toast({ title: 'Success', description: 'Site updated.' });
            } else {
                await addDoc(sitesCollectionRef, siteFormData);
                toast({ title: 'Success', description: 'New site added.' });
            }
            setIsSiteDialogOpen(false);
            await fetchAllData();
        } catch (error) {
            toast({ title: 'Error', description: 'Failed to save site.', variant: "destructive" });
        }
    };

    const handleDeleteSite = async (projectId: string, siteId: string) => {
        try {
            await deleteDoc(doc(db, 'projects', projectId, 'sites', siteId));
            toast({ title: 'Site Deleted', description: 'The site has been removed from the project.' });
            await fetchAllData();
        } catch (error) {
            toast({ title: 'Error', description: 'Failed to delete site.', variant: "destructive" });
        }
    };

    return (
        <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Link href="/store-stock-management/settings">
                        <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
                    </Link>
                    <h1 className="text-xl font-bold">Manage Sites</h1>
                </div>
                <Button onClick={() => openSiteDialog('add', projects[0]?.id || '')}>
                    <Plus className="mr-2 h-4 w-4" /> Add Site
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>All Project Sites</CardTitle>
                    <CardDescription>A list of all sites categorized by their parent project.</CardDescription>
                </CardHeader>
                <CardContent>
                    {isLoading ? <Skeleton className="h-64 w-full" /> : Object.keys(sitesByProject).length > 0 ? (
                        Object.entries(sitesByProject).map(([projectId, data]) => (
                            <div key={projectId} className="mb-6">
                                <h3 className="text-lg font-semibold mb-2">{data.projectName}</h3>
                                <div className="border rounded-md">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Site Name</TableHead>
                                                <TableHead>Location</TableHead>
                                                <TableHead className="text-right">Actions</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {data.sites.length > 0 ? data.sites.map(site => (
                                                <TableRow key={site.id}>
                                                    <TableCell>{site.name}</TableCell>
                                                    <TableCell>{site.location}</TableCell>
                                                    <TableCell className="text-right">
                                                        <Button variant="outline" size="sm" onClick={() => openSiteDialog('edit', projectId, site)}>
                                                            <Edit className="mr-2 h-4 w-4" /> Edit
                                                        </Button>
                                                        <AlertDialog>
                                                            <AlertDialogTrigger asChild>
                                                                <Button variant="destructive" size="sm" className="ml-2"><Trash2 className="mr-2 h-4 w-4" />Delete</Button>
                                                            </AlertDialogTrigger>
                                                            <AlertDialogContent>
                                                                <AlertDialogHeader>
                                                                    <AlertDialogTitle>Delete Site</AlertDialogTitle>
                                                                    <AlertDialogDescription>Are you sure you want to delete "{site.name}"?</AlertDialogDescription>
                                                                </AlertDialogHeader>
                                                                <AlertDialogFooter>
                                                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                                    <AlertDialogAction onClick={() => handleDeleteSite(projectId, site.id)}>Delete</AlertDialogAction>
                                                                </AlertDialogFooter>
                                                            </AlertDialogContent>
                                                        </AlertDialog>
                                                    </TableCell>
                                                </TableRow>
                                            )) : (
                                                <TableRow>
                                                    <TableCell colSpan={3} className="text-center h-20">No sites for this project.</TableCell>
                                                </TableRow>
                                            )}
                                        </TableBody>
                                    </Table>
                                </div>
                            </div>
                        ))
                    ) : (
                        <p className="text-center text-muted-foreground p-8">No projects found. Add a project to start managing sites.</p>
                    )}
                </CardContent>
            </Card>

            <Dialog open={isSiteDialogOpen} onOpenChange={setIsSiteDialogOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{dialogMode === 'add' ? 'Add New' : 'Edit'} Site</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="space-y-2">
                           <Label htmlFor="project-select">Project</Label>
                            <Select value={currentProjectIdForSite} onValueChange={setCurrentProjectIdForSite}>
                                <SelectTrigger id="project-select"><SelectValue placeholder="Select a project" /></SelectTrigger>
                                <SelectContent>
                                    {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="siteName">Site Name</Label>
                            <Input id="siteName" value={siteFormData.name} onChange={(e) => setSiteFormData(p => ({ ...p, name: e.target.value }))} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="siteLocation">Location</Label>
                            <Input id="siteLocation" value={siteFormData.location} onChange={(e) => setSiteFormData(p => ({ ...p, location: e.target.value }))} />
                        </div>
                    </div>
                    <DialogFooter>
                        <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
                        <Button onClick={handleSiteSubmit}>Save Site</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
