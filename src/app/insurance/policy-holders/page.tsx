
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
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc, Timestamp } from 'firebase/firestore';
import type { PolicyHolder } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Calendar as CalendarIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from '@/components/ui/alert-dialog';


const initialFormState = {
    name: '',
    date_of_birth: undefined as Date | undefined,
    contact: '',
    email: '',
    address: '',
};

export default function ManagePolicyHoldersPage() {
  const { toast } = useToast();
  const [holders, setHolders] = useState<PolicyHolder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'add' | 'edit'>('add');
  
  const [formData, setFormData] = useState(initialFormState);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    fetchPolicyHolders();
  }, []);

  const fetchPolicyHolders = async () => {
    setIsLoading(true);
    try {
      const querySnapshot = await getDocs(collection(db, 'policyHolders'));
      const data = querySnapshot.docs.map(doc => {
        const d = doc.data();
        return { 
            id: doc.id, ...d, 
            date_of_birth: d.date_of_birth ? d.date_of_birth.toDate() : null 
        } as PolicyHolder
      });
      setHolders(data);
    } catch (error) {
      console.error("Error fetching policy holders:", error);
      toast({ title: 'Error', description: 'Failed to fetch policy holders.', variant: 'destructive' });
    }
    setIsLoading(false);
  };

  const openDialog = (mode: 'add' | 'edit', holder?: PolicyHolder) => {
    setDialogMode(mode);
    if (mode === 'edit' && holder) {
        setFormData({
            name: holder.name,
            date_of_birth: holder.date_of_birth ? new Date(holder.date_of_birth) : undefined,
            contact: holder.contact || '',
            email: holder.email || '',
            address: holder.address || '',
        });
        setEditingId(holder.id);
    } else {
        setFormData(initialFormState);
        setEditingId(null);
    }
    setIsDialogOpen(true);
  };
  
  const handleFormChange = (field: keyof typeof formData, value: string | Date | undefined) => {
    setFormData(prev => ({...prev, [field]: value}));
  }

  const handleSubmit = async () => {
    if (!formData.name) {
      toast({ title: 'Validation Error', description: 'Please enter a name.', variant: 'destructive' });
      return;
    }
    
    const dataToSave = {
        ...formData,
        date_of_birth: formData.date_of_birth ? Timestamp.fromDate(formData.date_of_birth) : null,
    };

    try {
      if (dialogMode === 'edit' && editingId) {
        await updateDoc(doc(db, 'policyHolders', editingId), dataToSave);
        toast({ title: 'Success', description: 'Policy holder updated.' });
      } else {
        await addDoc(collection(db, 'policyHolders'), dataToSave);
        toast({ title: 'Success', description: 'New policy holder added.' });
      }
      setIsDialogOpen(false);
      fetchPolicyHolders();
    } catch (error) {
      console.error("Error saving policy holder:", error);
      toast({ title: 'Error', description: 'Failed to save data.', variant: 'destructive' });
    }
  };
  
   const handleDelete = async (id: string) => {
      try {
          await deleteDoc(doc(db, 'policyHolders', id));
          toast({ title: 'Success', description: 'Policy holder deleted.'});
          fetchPolicyHolders();
      } catch (error) {
          console.error("Error deleting holder:", error);
          toast({ title: 'Error', description: 'Failed to delete holder.', variant: 'destructive'});
      }
  };

  const formatDate = (date: Date | null) => date ? format(date, 'dd MMM, yyyy') : 'N/A';

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/insurance"><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
          <div>
            <h1 className="text-xl font-bold">Manage Policy Holders</h1>
            <p className="text-sm text-muted-foreground">Add, edit, or remove policy holders.</p>
          </div>
        </div>
        <Button onClick={() => openDialog('add')}><Plus className="mr-2 h-4 w-4"/> Add Holder</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Date of Birth</TableHead>
                <TableHead>Contact No</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Address</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={6}><Skeleton className="h-8" /></TableCell></TableRow>
                ))
              ) : holders.length > 0 ? (
                holders.map(holder => (
                  <TableRow key={holder.id}>
                    <TableCell className="font-medium">{holder.name}</TableCell>
                    <TableCell>{formatDate(holder.date_of_birth)}</TableCell>
                    <TableCell>{holder.contact || 'N/A'}</TableCell>
                    <TableCell>{holder.email || 'N/A'}</TableCell>
                    <TableCell>{holder.address || 'N/A'}</TableCell>
                    <TableCell className="text-right">
                       <Button variant="outline" size="sm" onClick={() => openDialog('edit', holder)}><Edit className="mr-2 h-4 w-4" />Edit</Button>
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="destructive" size="sm" className="ml-2"><Trash2 className="mr-2 h-4 w-4" />Delete</Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                    <AlertDialogDescription>This action cannot be undone. This will permanently delete the policy holder.</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => handleDelete(holder.id)}>Delete</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow><TableCell colSpan={6} className="text-center h-24">No policy holders found.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>{dialogMode === 'add' ? 'Add New' : 'Edit'} Policy Holder</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
               <div className="space-y-2"><Label htmlFor="name">Name</Label><Input id="name" value={formData.name} onChange={e => handleFormChange('name', e.target.value)} /></div>
               <div className="space-y-2 flex flex-col">
                  <Label>Date of Birth</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn('justify-start text-left font-normal', !formData.date_of_birth && 'text-muted-foreground')}>
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {formData.date_of_birth ? format(formData.date_of_birth, 'PPP') : 'Pick a date'}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={formData.date_of_birth} onSelect={(d) => handleFormChange('date_of_birth', d)} initialFocus /></PopoverContent>
                  </Popover>
               </div>
                <div className="space-y-2"><Label htmlFor="contact">Contact No</Label><Input id="contact" value={formData.contact} onChange={e => handleFormChange('contact', e.target.value)} /></div>
                <div className="space-y-2"><Label htmlFor="email">Email</Label><Input id="email" type="email" value={formData.email} onChange={e => handleFormChange('email', e.target.value)} /></div>
                <div className="md:col-span-2 space-y-2"><Label htmlFor="address">Address</Label><Input id="address" value={formData.address} onChange={e => handleFormChange('address', e.target.value)} /></div>
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
