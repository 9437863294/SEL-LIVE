
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
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
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, addDoc, deleteDoc, doc } from 'firebase/firestore';
import type { Department } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';

export default function ManageDepartmentPage() {
  const { toast } = useToast();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newDepartmentName, setNewDepartmentName] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const fetchDepartments = async () => {
    setIsLoading(true);
    try {
      const querySnapshot = await getDocs(collection(db, 'departments'));
      const departmentsData: Department[] = [];
      querySnapshot.forEach((doc) => {
        departmentsData.push({ id: doc.id, ...doc.data() } as Department);
      });
      setDepartments(departmentsData);
    } catch (error) {
      console.error("Error fetching departments: ", error);
      toast({
        title: 'Error',
        description: 'Failed to fetch departments.',
        variant: 'destructive',
      });
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchDepartments();
  }, []);

  const handleAddDepartment = async () => {
    if (!newDepartmentName.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Department name cannot be empty.',
        variant: 'destructive',
      });
      return;
    }
    try {
      await addDoc(collection(db, 'departments'), {
        name: newDepartmentName,
        head: 'N/A',
        status: 'Active',
      });
      toast({
        title: 'Success',
        description: `Department "${newDepartmentName}" added.`,
      });
      setNewDepartmentName('');
      setIsDialogOpen(false);
      fetchDepartments(); // Refresh the list
    } catch (error) {
      console.error("Error adding department: ", error);
      toast({
        title: 'Error',
        description: 'Failed to add department.',
        variant: 'destructive',
      });
    }
  };
  
  const handleDeleteDepartment = async (id: string) => {
    try {
      await deleteDoc(doc(db, "departments", id));
      toast({
        title: "Success",
        description: "Department deleted successfully.",
      });
      fetchDepartments(); // Refresh the list
    } catch (error) {
      console.error("Error deleting department: ", error);
      toast({
        title: "Error",
        description: "Failed to delete department.",
        variant: "destructive",
      });
    }
  };


  return (
    <div className="w-full max-w-6xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/settings">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">Manage Department</h1>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Department
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Add New Department</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="name" className="text-right">
                  Name
                </Label>
                <Input
                  id="name"
                  value={newDepartmentName}
                  onChange={(e) => setNewDepartmentName(e.target.value)}
                  className="col-span-3"
                  placeholder="e.g., Human Resources"
                />
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button onClick={handleAddDepartment}>Add Department</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Department Name</TableHead>
                <TableHead>Head of Department</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={4}>
                      <Skeleton className="h-8 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : departments.length > 0 ? (
                departments.map((dept) => (
                  <TableRow key={dept.id}>
                    <TableCell className="font-medium">{dept.name}</TableCell>
                    <TableCell>{dept.head}</TableCell>
                    <TableCell>{dept.status}</TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button variant="outline" size="sm" disabled>Edit</Button>
                      <Button variant="destructive" size="sm" onClick={() => handleDeleteDepartment(dept.id)}>Delete</Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="text-center h-24">
                    No departments found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
