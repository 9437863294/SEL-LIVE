
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
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
import { collection, getDocs, addDoc, deleteDoc, doc } from 'firebase/firestore';
import type { Site } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogTrigger } from "@/components/ui/alert-dialog";

export default function ManageUnitsPage() {
  const { toast } = useToast();
  const [units, setUnits] = useState<Site[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newUnitName, setNewUnitName] = useState('');

  useEffect(() => {
    fetchUnits();
  }, []);

  const fetchUnits = async () => {
    setIsLoading(true);
    try {
      const querySnapshot = await getDocs(collection(db, 'units'));
      const data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Site));
      setUnits(data.sort((a, b) => a.name.localeCompare(b.name)));
    } catch (error) {
      console.error("Error fetching units:", error);
      toast({ title: 'Error', description: 'Failed to fetch units of measurement.', variant: 'destructive' });
    }
    setIsLoading(false);
  };

  const handleAddUnit = async () => {
    if (!newUnitName.trim()) {
      toast({ title: 'Validation Error', description: 'Please enter a unit name.', variant: 'destructive' });
      return;
    }
    
    try {
      await addDoc(collection(db, 'units'), { name: newUnitName });
      toast({ title: 'Success', description: 'New unit added.' });
      setIsDialogOpen(false);
      setNewUnitName('');
      fetchUnits();
    } catch (error) {
      console.error("Error adding unit:", error);
      toast({ title: 'Error', description: 'Failed to save unit.', variant: 'destructive' });
    }
  };
  
  const handleDelete = async (id: string) => {
      try {
          await deleteDoc(doc(db, 'units', id));
          toast({ title: 'Success', description: 'Unit deleted.'});
          fetchUnits();
      } catch (error) {
          console.error("Error deleting unit:", error);
          toast({ title: 'Error', description: 'Failed to delete unit.', variant: 'destructive'});
      }
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
            <Link href="/store-stock-management/settings">
                <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6"/></Button>
            </Link>
            <div>
                <h1 className="text-xl font-bold">Manage Units of Measurement</h1>
                <p className="text-sm text-muted-foreground">Add or remove units for stock items.</p>
            </div>
         </div>
        <Button onClick={() => setIsDialogOpen(true)}><Plus className="mr-2 h-4 w-4"/> Add Unit</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Unit Name</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={2}><Skeleton className="h-8" /></TableCell></TableRow>
                ))
              ) : units.length > 0 ? (
                units.map(unit => (
                  <TableRow key={unit.id}>
                    <TableCell className="font-medium">{unit.name}</TableCell>
                    <TableCell className="text-right">
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="destructive" size="sm"><Trash2 className="mr-2 h-4 w-4" />Delete</Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                    <AlertDialogDescription>This action cannot be undone. This will permanently delete the unit.</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => handleDelete(unit.id)}>Delete</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow><TableCell colSpan={2} className="text-center h-24">No units found.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add New Unit</DialogTitle>
            </DialogHeader>
            <div className="py-4 space-y-4">
               <div className="space-y-2">
                  <Label htmlFor="name">Unit Name</Label>
                  <Input id="name" value={newUnitName} onChange={e => setNewUnitName(e.target.value)} placeholder="e.g., Kg, Mtr, Pcs" />
                </div>
            </div>
            <DialogFooter>
              <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
              <Button type="button" onClick={handleAddUnit}>Save Unit</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
    </div>
  );
}
