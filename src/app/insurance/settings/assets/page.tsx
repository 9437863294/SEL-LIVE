
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Edit, Trash2, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import type { InsuredAsset, Project } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useAuthorization } from '@/hooks/useAuthorization';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

const initialFormState = {
  name: '',
  type: 'Property' as 'Project' | 'Property',
  projectId: '',
  location: '',
  description: '',
};

export default function ManageAssetsPage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();
  
  const [assets, setAssets] = useState<InsuredAsset[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'add' | 'edit'>('add');
  const [formData, setFormData] = useState(initialFormState);
  const [editingId, setEditingId] = useState<string | null>(null);

  const canViewPage = can('View', 'Insurance.Settings.Assets');
  const canAdd = can('Add', 'Insurance.Settings.Assets');
  const canEdit = can('Edit', 'Insurance.Settings.Assets');
  const canDelete = can('Delete', 'Insurance.Settings.Assets');

  useEffect(() => {
    if (authLoading) return;
    if (canViewPage) {
      fetchData();
    } else {
      setIsLoading(false);
    }
  }, [canViewPage, authLoading]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [assetsSnap, projectsSnap] = await Promise.all([
        getDocs(collection(db, 'insuredAssets')),
        getDocs(collection(db, 'projects')),
      ]);
      setAssets(assetsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as InsuredAsset)));
      setProjects(projectsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)));
    } catch (error) {
      console.error("Error fetching data:", error);
      toast({ title: 'Error', description: 'Failed to fetch assets or projects.', variant: 'destructive' });
    }
    setIsLoading(false);
  };

  const openDialog = (mode: 'add' | 'edit', asset?: InsuredAsset) => {
    setDialogMode(mode);
    if (mode === 'edit' && asset) {
        setFormData({
            name: asset.name,
            type: asset.type,
            projectId: asset.projectId || '',
            location: asset.location || '',
            description: asset.description || '',
        });
        setEditingId(asset.id);
    } else {
        setFormData(initialFormState);
        setEditingId(null);
    }
    setIsDialogOpen(true);
  };
  
  const handleSubmit = async () => {
    const isProject = formData.type === 'Project';
    if ((isProject && !formData.projectId) || (!isProject && !formData.name.trim())) {
        toast({ title: 'Validation Error', description: 'Please fill in the required fields for the selected asset type.', variant: 'destructive' });
        return;
    }

    const dataToSave = { ...formData };
    if (isProject) {
        const selectedProject = projects.find(p => p.id === formData.projectId);
        dataToSave.name = selectedProject?.projectName || 'Unknown Project';
        dataToSave.location = '';
        dataToSave.description = '';
    } else {
        dataToSave.projectId = '';
    }
    
    try {
      if (dialogMode === 'edit' && editingId) {
        await updateDoc(doc(db, 'insuredAssets', editingId), dataToSave);
        toast({ title: 'Success', description: 'Asset updated.' });
      } else {
        await addDoc(collection(db, 'insuredAssets'), dataToSave);
        toast({ title: 'Success', description: 'New asset added.' });
      }
      setIsDialogOpen(false);
      fetchData();
    } catch (error) {
      console.error("Error saving asset:", error);
      toast({ title: 'Error', description: 'Failed to save data.', variant: 'destructive' });
    }
  };
  
  const handleDelete = async (id: string) => {
      try {
          await deleteDoc(doc(db, 'insuredAssets', id));
          toast({ title: 'Success', description: 'Asset deleted.'});
          fetchData();
      } catch (error) {
          console.error("Error deleting asset:", error);
          toast({ title: 'Error', description: 'Failed to delete asset.', variant: 'destructive'});
      }
  };
  
  const getAssetName = (asset: InsuredAsset) => {
      if (asset.type === 'Project' && asset.projectId) {
          return projects.find(p => p.id === asset.projectId)?.projectName || asset.name;
      }
      return asset.name;
  }

  if (authLoading || (isLoading && canViewPage)) {
    return (
        <div className="w-full">
            <Skeleton className="h-10 w-80 mb-6" />
            <Skeleton className="h-96 w-full" />
        </div>
    )
  }

  if (!canViewPage) {
    return (
        <div className="w-full">
            <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Link href="/insurance/settings"><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6"/></Button></Link>
                    <h1 className="text-xl font-bold">Manage Assets</h1>
                </div>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>Access Denied</CardTitle>
                    <CardDescription>You do not have permission to view this page.</CardDescription>
                </CardHeader>
                <CardContent className="flex justify-center p-8"><ShieldAlert className="h-16 w-16 text-destructive" /></CardContent>
            </Card>
        </div>
    )
  }

  return (
    <div className="w-full">
      <div className="mb-6 flex items-center justify-between">
         <div className="flex items-center gap-4">
            <Link href="/insurance/settings"><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6"/></Button></Link>
            <div>
                <h1 className="text-xl font-bold">Manage Assets</h1>
                <p className="text-sm text-muted-foreground">Manage insurable assets like projects and properties.</p>
            </div>
         </div>
        <Button onClick={() => openDialog('add')} disabled={!canAdd}><Plus className="mr-2 h-4 w-4"/> Add Asset</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Asset Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Location</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assets.map(asset => (
                  <TableRow key={asset.id}>
                    <TableCell className="font-medium">{getAssetName(asset)}</TableCell>
                    <TableCell>{asset.type}</TableCell>
                    <TableCell>{asset.location || 'N/A'}</TableCell>
                    <TableCell className="text-right">
                       <Button variant="outline" size="sm" onClick={() => openDialog('edit', asset)} disabled={!canEdit}><Edit className="mr-2 h-4 w-4" />Edit</Button>
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="destructive" size="sm" className="ml-2" disabled={!canDelete}><Trash2 className="mr-2 h-4 w-4" />Delete</Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                    <AlertDialogDescription>This action cannot be undone. This will permanently delete the asset.</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => handleDelete(asset.id)}>Delete</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>{dialogMode === 'add' ? 'Add New' : 'Edit'} Asset</DialogTitle>
            </DialogHeader>
            <div className="py-4 space-y-4">
               <div className="space-y-2">
                <Label>Asset Type</Label>
                <RadioGroup value={formData.type} onValueChange={(value) => setFormData(p => ({...p, type: value as any}))} className="flex gap-4">
                    <div className="flex items-center space-x-2"><RadioGroupItem value="Property" id="type-property"/><Label htmlFor="type-property">Property</Label></div>
                    <div className="flex items-center space-x-2"><RadioGroupItem value="Project" id="type-project" /><Label htmlFor="type-project">Project</Label></div>
                </RadioGroup>
               </div>
               
               {formData.type === 'Project' ? (
                <div className="space-y-2">
                    <Label htmlFor="projectId">Project</Label>
                    <Select value={formData.projectId} onValueChange={(value) => setFormData(p => ({...p, projectId: value}))}>
                        <SelectTrigger id="projectId"><SelectValue placeholder="Select a project" /></SelectTrigger>
                        <SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}</SelectContent>
                    </Select>
                </div>
               ) : (
                <>
                   <div className="space-y-2">
                       <Label htmlFor="name">Property Name</Label>
                       <Input id="name" value={formData.name} onChange={e => setFormData(p => ({...p, name: e.target.value}))} />
                    </div>
                    <div className="space-y-2">
                       <Label htmlFor="location">Location</Label>
                       <Input id="location" value={formData.location} onChange={e => setFormData(p => ({...p, location: e.target.value}))} />
                    </div>
                    <div className="space-y-2">
                       <Label htmlFor="description">Description</Label>
                       <Textarea id="description" value={formData.description} onChange={e => setFormData(p => ({...p, description: e.target.value}))} />
                    </div>
                </>
               )}
            </div>
            <DialogFooter>
              <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
              <Button type="button" onClick={handleSubmit}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
    </div>
  );
}
