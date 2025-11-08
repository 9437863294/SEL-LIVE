

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Edit, Trash2, ShieldAlert, Tags } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import type { PolicyCategory } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const initialFormState = {
    name: '',
    status: 'Active' as 'Active' | 'Inactive',
};

export default function ManagePolicyCategoriesPage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();
  
  const [categories, setCategories] = useState<PolicyCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'add' | 'edit'>('add');
  const [formData, setFormData] = useState(initialFormState);
  const [editingId, setEditingId] = useState<string | null>(null);

  const canViewPage = can('View', 'Insurance.Settings.Categories');
  const canAdd = can('Add', 'Insurance.Settings.Categories');
  const canEdit = can('Edit', 'Insurance.Settings.Categories');
  const canDelete = can('Delete', 'Insurance.Settings.Categories');

  useEffect(() => {
    if (authLoading) return;
    if (canViewPage) {
      fetchCategories();
    } else {
      setIsLoading(false);
    }
  }, [canViewPage, authLoading]);

  const fetchCategories = async () => {
    setIsLoading(true);
    try {
      const querySnapshot = await getDocs(collection(db, 'policyCategories'));
      const data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PolicyCategory));
      setCategories(data);
    } catch (error) {
      console.error("Error fetching policy categories:", error);
      toast({ title: 'Error', description: 'Failed to fetch policy categories.', variant: 'destructive' });
    }
    setIsLoading(false);
  };

  const openDialog = (mode: 'add' | 'edit', category?: PolicyCategory) => {
    setDialogMode(mode);
    if (mode === 'edit' && category) {
        setFormData({ name: category.name, status: category.status || 'Active' });
        setEditingId(category.id);
    } else {
        setFormData(initialFormState);
        setEditingId(null);
    }
    setIsDialogOpen(true);
  };
  
  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      toast({ title: 'Validation Error', description: 'Please enter a category name.', variant: 'destructive' });
      return;
    }
    
    try {
      if (dialogMode === 'edit' && editingId) {
        await updateDoc(doc(db, 'policyCategories', editingId), formData);
        toast({ title: 'Success', description: 'Policy category updated.' });
      } else {
        await addDoc(collection(db, 'policyCategories'), formData);
        toast({ title: 'Success', description: 'New policy category added.' });
      }
      setIsDialogOpen(false);
      fetchCategories();
    } catch (error) {
      console.error("Error saving policy category:", error);
      toast({ title: 'Error', description: 'Failed to save data.', variant: 'destructive' });
    }
  };
  
   const handleDelete = async (id: string) => {
      try {
          await deleteDoc(doc(db, 'policyCategories', id));
          toast({ title: 'Success', description: 'Policy category deleted.'});
          fetchCategories();
      } catch (error) {
          console.error("Error deleting category:", error);
          toast({ title: 'Error', description: 'Failed to delete category.', variant: 'destructive'});
      }
  };

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
            <div className="mb-6 flex items-center gap-4">
                <Link href="/insurance/settings"><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6"/></Button></Link>
                <h1 className="text-xl font-bold">Manage Policy Categories</h1>
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
                <h1 className="text-xl font-bold">Manage Policy Categories</h1>
                <p className="text-sm text-muted-foreground">Add, edit, or remove categories for project insurance.</p>
            </div>
        </div>
        <Button onClick={() => openDialog('add')} disabled={!canAdd}><Plus className="mr-2 h-4 w-4"/> Add Category</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={3}><Skeleton className="h-8" /></TableCell></TableRow>
                ))
              ) : categories.length > 0 ? (
                categories.map(category => (
                  <TableRow key={category.id}>
                    <TableCell className="font-medium">{category.name}</TableCell>
                    <TableCell>
                       <Badge variant={category.status === 'Active' ? 'default' : 'secondary'}>{category.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                       <Button variant="outline" size="sm" onClick={() => openDialog('edit', category)} disabled={!canEdit}><Edit className="mr-2 h-4 w-4" />Edit</Button>
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="destructive" size="sm" className="ml-2" disabled={!canDelete}><Trash2 className="mr-2 h-4 w-4" />Delete</Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                    <AlertDialogDescription>This action cannot be undone. This will permanently delete the policy category.</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => handleDelete(category.id)}>Delete</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow><TableCell colSpan={3} className="text-center h-24">No policy categories found.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{dialogMode === 'add' ? 'Add New' : 'Edit'} Policy Category</DialogTitle>
            </DialogHeader>
            <div className="py-4 space-y-4">
               <div className="space-y-2">
                  <Label htmlFor="name">Category Name</Label>
                  <Input id="name" value={formData.name} onChange={e => setFormData(p => ({...p, name: e.target.value}))} placeholder="e.g., CAR Policy, Fire Policy" />
                </div>
                 <div className="space-y-2">
                  <Label htmlFor="status">Status</Label>
                  <Select value={formData.status} onValueChange={(value: 'Active' | 'Inactive') => setFormData(p => ({...p, status: value}))}>
                      <SelectTrigger id="status"><SelectValue /></SelectTrigger>
                      <SelectContent>
                          <SelectItem value="Active">Active</SelectItem>
                          <SelectItem value="Inactive">Inactive</SelectItem>
                      </SelectContent>
                  </Select>
               </div>
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
