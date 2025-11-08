
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


export default function ManageProjectsAndSitesPage() {
  const { toast } = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Dialog states
  const [isProjectDialogOpen, setIsProjectDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'add' | 'edit'>('add');
  
  // Project form state
  const [projectFormData, setProjectFormData] = useState(initialProjectState);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  
  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const projectsSnap = await getDocs(collection(db, 'projects'));
        const projectsData = projectsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project));
        setProjects(projectsData);
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

  return (
    <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/store-stock-management/settings">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-xl font-bold">Manage Projects</h1>
        </div>
        <Button onClick={() => openProjectDialog('add')}>
            <Plus className="mr-2 h-4 w-4" /> Add Project
        </Button>
      </div>

       <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project Name</TableHead>
                <TableHead>Site Code</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                  Array.from({length: 3}).map((_, i) => (
                    <TableRow key={i}><TableCell colSpan={5}><Skeleton className="h-8"/></TableCell></TableRow>
                  ))
              ) : projects.length > 0 ? (
                projects.map(project => (
                  <TableRow key={project.id}>
                    <TableCell className="font-semibold">{project.projectName}</TableCell>
                    <TableCell>{project.siteCode}</TableCell>
                    <TableCell>{project.location}</TableCell>
                    <TableCell><Badge>{project.status}</Badge></TableCell>
                    <TableCell className="text-right">
                       <Button variant="outline" size="sm" onClick={() => openProjectDialog('edit', project)}><Edit className="mr-2 h-4 w-4" />Edit</Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="destructive" size="sm" className="ml-2"><Trash2 className="mr-2 h-4 w-4" />Delete</Button>
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
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="text-center h-24">No projects found.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

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
    </div>
  );
}
