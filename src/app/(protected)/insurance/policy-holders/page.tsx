
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Edit, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc, Timestamp, query, where, writeBatch } from 'firebase/firestore';
import { useAuthorization } from '@/hooks/useAuthorization';
import { countPolicyReferences, PERSONAL_POLICIES } from '@/lib/insurance-service';
import { AccessDenied, DateField } from '@/components/insurance/insurance-ui';
import { Textarea } from '@/components/ui/textarea';
import type { PolicyHolder } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import { PageHeader } from '@/components/shared/page-header';
import { TableCard } from '@/components/shared/table-card';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogTrigger } from '@/components/ui/alert-dialog';


const initialFormState = {
    name: '',
    date_of_birth: undefined as Date | undefined,
    contact: '',
    email: '',
    address: '',
};

export default function ManagePolicyHoldersPage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();
  const canView = can('View', 'Insurance.Settings.Holders');
  const canAdd = can('Add', 'Insurance.Settings.Holders');
  const canEdit = can('Edit', 'Insurance.Settings.Holders');
  const canDelete = can('Delete', 'Insurance.Settings.Holders');
  const [holders, setHolders] = useState<PolicyHolder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'add' | 'edit'>('add');
  
  const [formData, setFormData] = useState(initialFormState);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (canView) fetchPolicyHolders();
    else setIsLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, canView]);

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
    const name = formData.name.trim();
    if (!name) {
      toast({ title: 'Validation Error', description: 'Please enter a name.', variant: 'destructive' });
      return;
    }
    if (holders.some((h) => h.id !== editingId && h.name.trim().toLowerCase() === name.toLowerCase())) {
      toast({ title: 'Duplicate', description: `A policy holder named ${name} already exists.`, variant: 'destructive' });
      return;
    }
    
    const dataToSave = {
        ...formData,
        name,
        date_of_birth: formData.date_of_birth ? Timestamp.fromDate(formData.date_of_birth) : null,
    };

    try {
      if (dialogMode === 'edit' && editingId) {
        await updateDoc(doc(db, 'policyHolders', editingId), dataToSave);
        // Policies refer to their holder by name, so a rename has to follow through to them.
        const previous = holders.find((h) => h.id === editingId)?.name;
        let moved = 0;
        if (previous && previous !== name) {
          const linked = await getDocs(query(collection(db, PERSONAL_POLICIES), where('insured_person', '==', previous)));
          const batch = writeBatch(db);
          linked.docs.forEach((d) => batch.update(d.ref, { insured_person: name }));
          if (!linked.empty) await batch.commit();
          moved = linked.size;
        }
        toast({ title: 'Success', description: moved ? `Policy holder updated, and ${moved} polic${moved === 1 ? 'y' : 'ies'} renamed with it.` : 'Policy holder updated.' });
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
  
   const handleDelete = async (holder: PolicyHolder) => {
      try {
          const inUse = await countPolicyReferences('insured_person', holder.name);
          if (inUse > 0) {
            toast({ title: 'Holder in use', description: `${holder.name} is the insured person on ${inUse} polic${inUse === 1 ? 'y' : 'ies'}. Reassign or delete those first.`, variant: 'destructive' });
            return;
          }
          await deleteDoc(doc(db, 'policyHolders', holder.id));
          toast({ title: 'Success', description: 'Policy holder deleted.'});
          fetchPolicyHolders();
      } catch (error) {
          console.error("Error deleting holder:", error);
          toast({ title: 'Error', description: 'Failed to delete holder.', variant: 'destructive'});
      }
  };

  const formatDate = (date: Date | null) => date ? format(date, 'dd MMM, yyyy') : 'N/A';

  if (!authLoading && !canView) return <AccessDenied what="manage policy holders" />;

  return (
    <div className="w-full">
      <PageHeader
        title="Manage Policy Holders"
        description="The people personal policies are held for."
        backHref="/insurance/settings"
        backLabel="Back to settings"
        actions={canAdd && <Button onClick={() => openDialog('add')}><Plus className="mr-2 h-4 w-4"/> Add Holder</Button>}
      />

      <TableCard title="Policy holders" count={isLoading ? undefined : holders.length} noun="holder">
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
              {isLoading || authLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={6}><Skeleton className="h-8" /></TableCell></TableRow>
                ))
              ) : holders.length > 0 ? (
                holders.map(holder => (
                  <TableRow key={holder.id}>
                    <TableCell className="font-medium">{holder.name}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatDate(holder.date_of_birth)}</TableCell>
                    <TableCell>{holder.contact || 'N/A'}</TableCell>
                    <TableCell>{holder.email || 'N/A'}</TableCell>
                    <TableCell>{holder.address || 'N/A'}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                       {canEdit && <Button variant="outline" size="sm" onClick={() => openDialog('edit', holder)}><Edit className="mr-2 h-4 w-4" />Edit</Button>}
                        {canDelete && <AlertDialog>
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
                                    <AlertDialogAction onClick={() => handleDelete(holder)}>Delete</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow><TableCell colSpan={6} className="text-center h-24">No policy holders found.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
      </TableCard>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>{dialogMode === 'add' ? 'Add New' : 'Edit'} Policy Holder</DialogTitle>
              <DialogDescription>
                {dialogMode === 'add'
                  ? 'The person a personal policy is taken out for. Only the name is required.'
                  : 'Renaming a holder also renames every policy recorded against them.'}
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-1 gap-x-4 gap-y-5 py-2 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">Name <span className="text-destructive">*</span></Label>
                <Input id="name" value={formData.name} onChange={e => handleFormChange('name', e.target.value)} placeholder="Full name as on the policy" autoComplete="off" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dob">Date of Birth</Label>
                <DateField
                  id="dob"
                  value={formData.date_of_birth}
                  onChange={(date) => handleFormChange('date_of_birth', date)}
                  fromYear={1900}
                  toYear={new Date().getFullYear()}
                  maxDate={new Date()}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contact">Contact No</Label>
                <Input id="contact" type="tel" inputMode="tel" value={formData.contact} onChange={e => handleFormChange('contact', e.target.value)} placeholder="10-digit mobile" autoComplete="off" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={formData.email} onChange={e => handleFormChange('email', e.target.value)} placeholder="name@example.com" autoComplete="off" />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="address">Address</Label>
                <Textarea id="address" rows={2} value={formData.address} onChange={e => handleFormChange('address', e.target.value)} placeholder="House, street, city, PIN" />
              </div>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
              <Button type="button" onClick={handleSubmit}>{dialogMode === 'add' ? 'Add Holder' : 'Save Changes'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
    </div>
  );
}
