
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Edit, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, addDoc, deleteDoc, doc, updateDoc, writeBatch } from 'firebase/firestore';
import type { Project, Site } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const initialProjectState = {
  projectName: '',
  siteCode: '',
  projectSite: '',
  projectDivision: '',
  location: '',
  siteInCharge: 'N/A',
  status: 'Active' as 'Active' | 'Inactive',
  billingRequired: false,
};

const initialSiteState = {
    name: '',
    location: '',
};

export default function ManageProjectsAndSitesPage() {
  const { toast } = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [sites, setSites] = useState<Record<string, Site[]>>({});
  const [isLoading, setIsLoading] = useState(true);

  // Dialog states
  const [isProjectDialogOpen, setIsProjectDialogOpen] = useState(false);
  const [isSiteDialogOpen, setIsSiteDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'add' | 'edit'>('add');
  
  // Project form state
  const [projectFormData, setProjectFormData] = useState(initialProjectState);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  
  // Site form state
  const [siteFormData, setSiteFormData] = useState(initialSiteState);
  const [editingSiteId, setEditingSiteId] = useState<string | null>(null);
  const [currentProjectIdForSite, setCurrentProjectIdForSite] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const projectsSnap = await getDocs(collection(db, 'projects'));
        const projectsData = projectsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project));
        setProjects(projectsData);
        
        const sitesData: Record<string, Site[]> = {};
        for (const project of projectsData) {
            const sitesSnap = await getDocs(collection(db, 'projects', project.id, 'sites'));
            sitesData[project.id] = sitesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Site));
        }
        setSites(sitesData);

      } catch (error) {
        console.error("Error fetching data:", error);
      }
      setIsLoading(false);
    };
    fetchData();
  }, []);

  // --- Project Handlers ---
  const openProjectDialog = (mode: 'add' | 'edit', project?: Project) => {
    setDialogMode(mode);
    if (mode === 'edit' && project) {
      setProjectFormData({
          projectName: project.projectName || '',
          siteCode: project.siteCode || '',
          projectSite: project.projectSite || '',
          projectDivision: project.projectDivision || '',
          location: project.location || '',
          siteInCharge: project.siteInCharge || 'N/A',
          status: project.status || 'Active',
          billingRequired: project.billingRequired || false,
      });
      setEditingProjectId(project.id);
    } else {
      setProjectFormData(initialProjectState);
      setEditingProjectId(null);
    }
    setIsProjectDialogOpen(true);
  };
  
  const handleProjectSubmit = async () => {
      if (!projectFormData.projectName) {
          toast({ title: "Validation Error", description: "Project Name is required.", variant: "destructive"});
          return;
      }
      try {
          if (dialogMode === 'edit' && editingProjectId) {
              await updateDoc(doc(db, 'projects', editingProjectId), projectFormData);
              toast({ title: 'Success', description: 'Project updated.' });
          } else {
              await addDoc(collection(db, 'projects'), projectFormData);
              toast({ title: 'Success', description: 'New project added.' });
          }
          setIsProjectDialogOpen(false);
          // Refetch data
          const projectsSnap = await getDocs(collection(db, 'projects'));
          setProjects(projectsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)));
      } catch (error) {
          toast({ title: "Error", description: "Failed to save project.", variant: "destructive" });
      }
  }
  
  const handleDeleteProject = async (projectId: string) => {
      try {
          await deleteDoc(doc(db, 'projects', projectId));
          // Note: subcollections (sites) are not automatically deleted.
          // A cloud function would be needed for full cleanup.
          toast({ title: 'Project Deleted', description: 'The project has been deleted.' });
          setProjects(prev => prev.filter(p => p.id !== projectId));
      } catch (error) {
          toast({ title: 'Error', description: 'Failed to delete project.', variant: "destructive" });
      }
  }

  // --- Site Handlers ---
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
      toast({ title: "Validation Error", description: "Site Name is required.", variant: "destructive" });
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
      // Refetch sites for the specific project
      const sitesSnap = await getDocs(sitesCollectionRef);
      setSites(prev => ({...prev, [currentProjectIdForSite]: sitesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Site)) }));
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to save site.', variant: 'destructive' });
    }
  };

  const handleDeleteSite = async (projectId: string, siteId: string) => {
      try {
          await deleteDoc(doc(db, 'projects', projectId, 'sites', siteId));
          toast({ title: 'Site Deleted', description: 'The site has been removed from the project.' });
          setSites(prev => ({...prev, [projectId]: prev[projectId].filter(s => s.id !== siteId) }));
      } catch (error) {
          toast({ title: 'Error', description: 'Failed to delete site.', variant: "destructive" });
      }
  }


  return (
    <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/store-stock-management">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-xl font-bold">Manage Projects & Sites</h1>
        </div>
        <Button onClick={() => openProjectDialog('add')}>
            <Plus className="mr-2 h-4 w-4" /> Add Project
        </Button>
      </div>

       <Accordion type="multiple" className="w-full space-y-4">
        {isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : projects.length > 0 ? (
          projects.map(project => (
            <AccordionItem value={project.id} key={project.id} className="border-none">
                <Card>
                    <div className="flex items-center p-4">
                      <AccordionTrigger className="hover:no-underline flex-1">
                          <div className="flex justify-between items-center w-full">
                              <h3 className="font-semibold text-lg">{project.projectName}</h3>
                              <Badge>{project.status || 'Active'}</Badge>
                          </div>
                      </AccordionTrigger>
                      <div className="ml-4 flex items-center gap-2">
                          <Button variant="outline" size="sm" onClick={() => openProjectDialog('edit', project)}><Edit className="mr-2 h-4 w-4" />Edit</Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="destructive" size="sm"><Trash2 className="mr-2 h-4 w-4" />Delete</Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                    <AlertDialogDescription>This will delete the project. Site data will remain but will be orphaned.</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => handleDeleteProject(project.id)}>Delete</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                      </div>
                    </div>
                    <AccordionContent className="px-4 pb-4">
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
                                {(sites[project.id] || []).length > 0 ? (
                                    sites[project.id].map(site => (
                                        <TableRow key={site.id}>
                                            <TableCell>{site.name}</TableCell>
                                            <TableCell>{site.location}</TableCell>
                                            <TableCell className="text-right">
                                                <Button variant="ghost" size="sm" onClick={() => openSiteDialog('edit', project.id, site)}><Edit className="h-4 w-4" /></Button>
                                                <AlertDialog>
                                                    <AlertDialogTrigger asChild>
                                                        <Button variant="ghost" size="sm" className="text-destructive"><Trash2 className="h-4 w-4" /></Button>
                                                    </AlertDialogTrigger>
                                                    <AlertDialogContent>
                                                        <AlertDialogHeader>
                                                            <AlertDialogTitle>Delete Site</AlertDialogTitle>
                                                            <AlertDialogDescription>Are you sure you want to delete the site "{site.name}"?</AlertDialogDescription>
                                                        </AlertDialogHeader>
                                                        <AlertDialogFooter>
                                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                            <AlertDialogAction onClick={() => handleDeleteSite(project.id, site.id)}>Delete</AlertDialogAction>
                                                        </AlertDialogFooter>
                                                    </AlertDialogContent>
                                                </AlertDialog>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                ) : (
                                    <TableRow>
                                        <TableCell colSpan={3} className="text-center h-20">No sites for this project.</TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                         </Table>
                         <div className="p-2 border-t">
                            <Button variant="outline" size="sm" onClick={() => openSiteDialog('add', project.id)}>
                                <Plus className="mr-2 h-4 w-4"/> Add Site
                            </Button>
                         </div>
                       </div>
                    </AccordionContent>
                </Card>
            </AccordionItem>
          ))
        ) : (
          <Card className="text-center py-12">
            <CardContent>No projects found.</CardContent>
          </Card>
        )}
       </Accordion>

       {/* Project Dialog */}
       <Dialog open={isProjectDialogOpen} onOpenChange={setIsProjectDialogOpen}>
          <DialogContent className="sm:max-w-3xl">
              <DialogHeader>
                  <DialogTitle>{dialogMode === 'add' ? 'Add New' : 'Edit'} Project</DialogTitle>
              </DialogHeader>
               <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
                    <div className="space-y-2">
                        <Label>Project Name</Label>
                        <Input value={projectFormData.projectName} onChange={(e) => setProjectFormData(p => ({...p, projectName: e.target.value}))} />
                    </div>
                     <div className="space-y-2">
                        <Label>Site Code</Label>
                        <Input value={projectFormData.siteCode} onChange={(e) => setProjectFormData(p => ({...p, siteCode: e.target.value}))} />
                    </div>
                     <div className="space-y-2">
                        <Label>Project Site</Label>
                        <Input value={projectFormData.projectSite} onChange={(e) => setProjectFormData(p => ({...p, projectSite: e.target.value}))} />
                    </div>
                     <div className="space-y-2">
                        <Label>Project Division</Label>
                        <Input value={projectFormData.projectDivision} onChange={(e) => setProjectFormData(p => ({...p, projectDivision: e.target.value}))} />
                    </div>
                     <div className="space-y-2">
                        <Label>Location</Label>
                        <Input value={projectFormData.location} onChange={(e) => setProjectFormData(p => ({...p, location: e.target.value}))} />
                    </div>
                    <div className="space-y-2">
                        <Label>Status</Label>
                        <Select value={projectFormData.status} onValueChange={(v: 'Active' | 'Inactive') => setProjectFormData(p => ({...p, status: v}))}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="Active">Active</SelectItem>
                                <SelectItem value="Inactive">Inactive</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
               </div>
              <DialogFooter>
                  <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
                  <Button onClick={handleProjectSubmit}>Save Project</Button>
              </DialogFooter>
          </DialogContent>
       </Dialog>

        {/* Site Dialog */}
       <Dialog open={isSiteDialogOpen} onOpenChange={setIsSiteDialogOpen}>
          <DialogContent className="sm:max-w-md">
              <DialogHeader>
                  <DialogTitle>{dialogMode === 'add' ? 'Add New' : 'Edit'} Site</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                  <div className="space-y-2">
                      <Label htmlFor="siteName">Site Name</Label>
                      <Input id="siteName" value={siteFormData.name} onChange={(e) => setSiteFormData(p => ({...p, name: e.target.value}))} />
                  </div>
                  <div className="space-y-2">
                      <Label htmlFor="siteLocation">Location</Label>
                      <Input id="siteLocation" value={siteFormData.location} onChange={(e) => setSiteFormData(p => ({...p, location: e.target.value}))} />
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
