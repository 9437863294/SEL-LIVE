
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle as CardTitleShad,
  CardDescription as CardDescriptionShad,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
import { collection, getDocs, addDoc, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import type { Project } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuthorization } from '@/hooks/useAuthorization';

const initialNewProjectState = {
  projectName: '',
  siteCode: '',
  projectSite: '',
  projectDivision: '',
  location: '',
  siteInCharge: 'N/A',
  status: 'Active' as 'Active' | 'Inactive',
};

export default function ManageProjectPage() {
  const { toast } = useToast();
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const [newProject, setNewProject] = useState(initialNewProjectState);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);

  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

  const canView = can('View', 'Settings.Manage Project');
  const canAdd = can('Add', 'Settings.Manage Project');
  const canEdit = can('Edit', 'Settings.Manage Project');
  const canDelete = can('Delete', 'Settings.Manage Project');

  useEffect(() => {
    if (!isAuthLoading && canView) {
        fetchProjects();
    } else if (!isAuthLoading && !canView) {
        setIsLoading(false);
    }
  }, [isAuthLoading, canView]);
  
  const fetchProjects = async () => {
    setIsLoading(true);
    try {
      const querySnapshot = await getDocs(collection(db, 'projects'));
      const projectsData: Project[] = [];
      querySnapshot.forEach((doc) => {
        projectsData.push({ id: doc.id, ...doc.data() } as Project);
      });
      setProjects(projectsData);
    } catch (error) {
      console.error("Error fetching projects: ", error);
      toast({
        title: 'Error',
        description: 'Failed to fetch projects.',
        variant: 'destructive',
      });
    }
    setIsLoading(false);
  };
  
  const handleInputChange = (field: keyof typeof newProject, value: string) => {
    setNewProject(prev => ({ ...prev, [field]: value }));
  };
  
  const handleSelectChange = (field: keyof typeof newProject, value: string) => {
    setNewProject(prev => ({ ...prev, [field]: value }));
  };
  
  const resetAddDialog = () => {
    setNewProject(initialNewProjectState);
    setIsAddDialogOpen(false);
  }

  const handleAddProject = async () => {
    if (!newProject.projectName.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Project name cannot be empty.',
        variant: 'destructive',
      });
      return;
    }
    try {
      await addDoc(collection(db, 'projects'), newProject);
      toast({
        title: 'Success',
        description: `Project "${newProject.projectName}" added.`,
      });
      resetAddDialog();
      fetchProjects(); 
    } catch (error) {
      console.error("Error adding project: ", error);
      toast({
        title: 'Error',
        description: 'Failed to add project.',
        variant: 'destructive',
      });
    }
  };
  
  const handleDeleteProject = async (id: string) => {
    try {
      await deleteDoc(doc(db, "projects", id));
      toast({
        title: "Success",
        description: "Project deleted successfully.",
      });
      fetchProjects();
    } catch (error) {
      console.error("Error deleting project: ", error);
      toast({
        title: "Error",
        description: "Failed to delete project.",
        variant: "destructive",
      });
    }
  };
  
  const openEditDialog = (project: Project) => {
    setEditingProject(project);
    setIsEditDialogOpen(true);
  };
  
  const handleUpdateProject = async () => {
    if (!editingProject) return;
  
    try {
      const projectRef = doc(db, 'projects', editingProject.id);
      await updateDoc(projectRef, {
        ...editingProject
      });
      toast({
        title: 'Success',
        description: 'Project updated successfully.',
      });
      setIsEditDialogOpen(false);
      setEditingProject(null);
      fetchProjects();
    } catch (error) {
      console.error('Error updating project: ', error);
      toast({
        title: 'Error',
        description: 'Failed to update project.',
        variant: 'destructive',
      });
    }
  };

  if (isAuthLoading || (isLoading && canView)) {
    return (
        <div className="w-full px-4 sm:px-6 lg:px-8">
            <div className="mb-6 flex items-center justify-between">
                <Skeleton className="h-10 w-48" />
                <Skeleton className="h-10 w-32" />
            </div>
            <Card>
                <CardContent className="p-0">
                    <Skeleton className="h-96 w-full" />
                </CardContent>
            </Card>
        </div>
    );
  }
  
  if (!canView) {
      return (
        <div className="w-full max-w-4xl mx-auto">
            <div className="mb-6 flex items-center gap-4">
              <Link href="/settings">
                <Button variant="ghost" size="icon">
                  <ArrowLeft className="h-6 w-6" />
                </Button>
              </Link>
              <h1 className="text-2xl font-bold">Manage Project</h1>
            </div>
            <Card>
                <CardHeader>
                    <CardTitleShad>Access Denied</CardTitleShad>
                    <CardDescriptionShad>You do not have permission to view this page. Please contact an administrator.</CardDescriptionShad>
                </CardHeader>
                <CardContent className="flex justify-center p-8">
                    <ShieldAlert className="h-16 w-16 text-destructive" />
                </CardContent>
            </Card>
        </div>
      )
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/settings">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">Manage Project</h1>
        </div>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button disabled={!canAdd}>
              <Plus className="mr-2 h-4 w-4" />
              Add Project
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-3xl" onPointerDownOutside={(e) => e.preventDefault()}>
            <DialogHeader>
              <DialogTitle>Add New Project</DialogTitle>
              <DialogDescription>
                Fill in the details to add a new project.
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
                <div className="space-y-2">
                    <Label htmlFor="projectName">Project Name</Label>
                    <Input id="projectName" placeholder="e.g. Corporate Office" value={newProject.projectName} onChange={(e) => handleInputChange('projectName', e.target.value)} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="siteCode">Site Code</Label>
                    <Input id="siteCode" placeholder="e.g. SEL-001" value={newProject.siteCode} onChange={(e) => handleInputChange('siteCode', e.target.value)} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="projectSite">Project Site</Label>
                    <Input id="projectSite" placeholder="e.g. Hyderabad" value={newProject.projectSite} onChange={(e) => handleInputChange('projectSite', e.target.value)} />
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="projectDivision">Project Division</Label>
                    <Input id="projectDivision" placeholder="e.g. Electrical" value={newProject.projectDivision} onChange={(e) => handleInputChange('projectDivision', e.target.value)} />
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="location">Location</Label>
                    <Input id="location" placeholder="e.g. Gachibowli, Hyderabad" value={newProject.location} onChange={(e) => handleInputChange('location', e.target.value)} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="siteInCharge">Site in-charge</Label>
                    <Select value={newProject.siteInCharge} onValueChange={(value) => handleSelectChange('siteInCharge', value)}>
                        <SelectTrigger id="siteInCharge">
                            <SelectValue placeholder="Select a user" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="N/A">N/A</SelectItem>
                            {/* Future: Map users here */}
                        </SelectContent>
                    </Select>
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="status">Status</Label>
                    <Select value={newProject.status} onValueChange={(value: 'Active' | 'Inactive') => handleSelectChange('status', value)}>
                        <SelectTrigger id="status">
                            <SelectValue placeholder="Select status" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="Active">Active</SelectItem>
                            <SelectItem value="Inactive">Inactive</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" onClick={resetAddDialog}>Cancel</Button>
              </DialogClose>
              <Button onClick={handleAddProject}>Add Project</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sr. No.</TableHead>
                <TableHead>Project Name</TableHead>
                <TableHead>Site Code</TableHead>
                <TableHead>Project Site</TableHead>
                <TableHead>Project Division</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Site in-charge</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-10" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                    <TableCell className="text-right space-x-2">
                       <Skeleton className="h-8 w-16 inline-block" />
                       <Skeleton className="h-8 w-16 inline-block" />
                    </TableCell>
                  </TableRow>
                ))
              ) : projects.length > 0 ? (
                projects.map((proj, index) => (
                  <TableRow key={proj.id}>
                    <TableCell>{index + 1}</TableCell>
                    <TableCell className="font-medium">{proj.projectName}</TableCell>
                    <TableCell>{proj.siteCode}</TableCell>
                    <TableCell>{proj.projectSite}</TableCell>
                    <TableCell>{proj.projectDivision}</TableCell>
                    <TableCell>{proj.location}</TableCell>
                    <TableCell>{proj.siteInCharge}</TableCell>
                    <TableCell>{proj.status}</TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button variant="outline" size="sm" onClick={() => openEditDialog(proj)} disabled={!canEdit}>Edit</Button>
                      <Button variant="destructive" size="sm" onClick={() => handleDeleteProject(proj.id)} disabled={!canDelete}>Delete</Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={9} className="text-center h-24">
                    No projects found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Edit Project</DialogTitle>
            <DialogDescription>
              Update the details of the project.
            </DialogDescription>
          </DialogHeader>
          {editingProject && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
                 <div className="space-y-2">
                    <Label htmlFor="editProjectName">Project Name</Label>
                    <Input id="editProjectName" value={editingProject.projectName} onChange={(e) => setEditingProject({...editingProject, projectName: e.target.value})} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="editSiteCode">Site Code</Label>
                    <Input id="editSiteCode" value={editingProject.siteCode} onChange={(e) => setEditingProject({...editingProject, siteCode: e.target.value})} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="editProjectSite">Project Site</Label>
                    <Input id="editProjectSite" value={editingProject.projectSite} onChange={(e) => setEditingProject({...editingProject, projectSite: e.target.value})} />
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="editProjectDivision">Project Division</Label>
                    <Input id="editProjectDivision" value={editingProject.projectDivision} onChange={(e) => setEditingProject({...editingProject, projectDivision: e.target.value})} />
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="editLocation">Location</Label>
                    <Input id="editLocation" value={editingProject.location} onChange={(e) => setEditingProject({...editingProject, location: e.target.value})} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="editSiteInCharge">Site in-charge</Label>
                    <Select value={editingProject.siteInCharge} onValueChange={(value) => setEditingProject({...editingProject, siteInCharge: value})}>
                        <SelectTrigger id="editSiteInCharge">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="N/A">N/A</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="editStatus">Status</Label>
                    <Select value={editingProject.status} onValueChange={(value: 'Active' | 'Inactive') => setEditingProject({...editingProject, status: value})}>
                        <SelectTrigger id="editStatus">
                            <SelectValue/>
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="Active">Active</SelectItem>
                            <SelectItem value="Inactive">Inactive</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={handleUpdateProject}>Update Project</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
