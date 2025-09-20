
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
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import type { InsuranceCompany } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const initialFormState = {
    name: '',
    status: 'Active' as 'Active' | 'Inactive',
};

export default function ManageInsuranceCompaniesPage() {
  const { toast } = useToast();
  const [companies, setCompanies] = useState<InsuranceCompany[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'add' | 'edit'>('add');
  const [formData, setFormData] = useState(initialFormState);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    fetchCompanies();
  }, []);

  const fetchCompanies = async () => {
    setIsLoading(true);
    try {
      const querySnapshot = await getDocs(collection(db, 'insuranceCompanies'));
      const data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InsuranceCompany));
      setCompanies(data);
    } catch (error) {
      console.error("Error fetching insurance companies:", error);
      toast({ title: 'Error', description: 'Failed to fetch insurance companies.', variant: 'destructive' });
    }
    setIsLoading(false);
  };

  const openDialog = (mode: 'add' | 'edit', company?: InsuranceCompany) => {
    setDialogMode(mode);
    if (mode === 'edit' && company) {
        setFormData({ name: company.name, status: company.status || 'Active' });
        setEditingId(company.id);
    } else {
        setFormData(initialFormState);
        setEditingId(null);
    }
    setIsDialogOpen(true);
  };
  
  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      toast({ title: 'Validation Error', description: 'Please enter a company name.', variant: 'destructive' });
      return;
    }
    
    try {
      if (dialogMode === 'edit' && editingId) {
        await updateDoc(doc(db, 'insuranceCompanies', editingId), formData);
        toast({ title: 'Success', description: 'Insurance company updated.' });
      } else {
        await addDoc(collection(db, 'insuranceCompanies'), formData);
        toast({ title: 'Success', description: 'New insurance company added.' });
      }
      setIsDialogOpen(false);
      fetchCompanies();
    } catch (error) {
      console.error("Error saving insurance company:", error);
      toast({ title: 'Error', description: 'Failed to save data.', variant: 'destructive' });
    }
  };
  
   const handleDelete = async (id: string) => {
      try {
          await deleteDoc(doc(db, 'insuranceCompanies', id));
          toast({ title: 'Success', description: 'Insurance company deleted.'});
          fetchCompanies();
      } catch (error) {
          console.error("Error deleting company:", error);
          toast({ title: 'Error', description: 'Failed to delete company.', variant: 'destructive'});
      }
  };

  return (
    <div className="w-full">
      <div className="mb-6 flex items-center justify-between">
        <div>
            <h1 className="text-xl font-bold">Manage Insurance Companies</h1>
            <p className="text-sm text-muted-foreground">Add, edit, or remove insurance companies.</p>
        </div>
        <Button onClick={() => openDialog('add')}><Plus className="mr-2 h-4 w-4"/> Add Company</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={3}><Skeleton className="h-8" /></TableCell></TableRow>
                ))
              ) : companies.length > 0 ? (
                companies.map(company => (
                  <TableRow key={company.id}>
                    <TableCell className="font-medium">{company.name}</TableCell>
                    <TableCell>
                      <Badge variant={company.status === 'Active' ? 'default' : 'secondary'}>{company.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                       <Button variant="outline" size="sm" onClick={() => openDialog('edit', company)}><Edit className="mr-2 h-4 w-4" />Edit</Button>
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="destructive" size="sm" className="ml-2"><Trash2 className="mr-2 h-4 w-4" />Delete</Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                    <AlertDialogDescription>This action cannot be undone. This will permanently delete the insurance company.</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => handleDelete(company.id)}>Delete</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow><TableCell colSpan={3} className="text-center h-24">No insurance companies found.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{dialogMode === 'add' ? 'Add New' : 'Edit'} Insurance Company</DialogTitle>
            </DialogHeader>
            <div className="py-4 space-y-4">
               <div className="space-y-2"><Label htmlFor="name">Company Name</Label><Input id="name" value={formData.name} onChange={e => setFormData(p => ({...p, name: e.target.value}))} /></div>
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
