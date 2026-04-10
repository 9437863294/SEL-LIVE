

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Building2, ShieldAlert } from 'lucide-react';
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
import type { Department } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuthorization } from '@/hooks/useAuthorization';


export default function ManageDepartmentPage() {
  const { toast } = useToast();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // State for Add Dialog
  const [newDepartmentName, setNewDepartmentName] = useState('');
  const [newDepartmentStatus, setNewDepartmentStatus] = useState<'Active' | 'Inactive'>('Active');
  const [newDepartmentHead, setNewDepartmentHead] = useState('N/A');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);

  // State for Edit Dialog
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingDepartment, setEditingDepartment] = useState<Department | null>(null);
  const [editedName, setEditedName] = useState('');
  const [editedStatus, setEditedStatus] = useState<'Active' | 'Inactive'>('Active');
  const [editedHead, setEditedHead] = useState('N/A');
  
  const canView = can('View', 'Settings.Manage Department');
  const canAdd = can('Add', 'Settings.Manage Department');
  const canEdit = can('Edit', 'Settings.Manage Department');
  const canDelete = can('Delete', 'Settings.Manage Department');

  useEffect(() => {
    if (!isAuthLoading && canView) {
        fetchDepartments();
    } else if (!isAuthLoading && !canView) {
        setIsLoading(false);
    }
  }, [isAuthLoading, canView]);

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

  const resetAddDialog = () => {
    setNewDepartmentName('');
    setNewDepartmentStatus('Active');
    setNewDepartmentHead('N/A');
    setIsAddDialogOpen(false);
  }

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
        head: newDepartmentHead,
        status: newDepartmentStatus,
      });
      toast({
        title: 'Success',
        description: `Department "${newDepartmentName}" added.`,
      });
      resetAddDialog();
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

  const openEditDialog = (department: Department) => {
    setEditingDepartment(department);
    setEditedName(department.name);
    setEditedStatus(department.status);
    setEditedHead(department.head);
    setIsEditDialogOpen(true);
  };

  const handleUpdateDepartment = async () => {
    if (!editingDepartment) return;

    if (!editedName.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Department name cannot be empty.',
        variant: 'destructive',
      });
      return;
    }

    try {
      const departmentRef = doc(db, 'departments', editingDepartment.id);
      await updateDoc(departmentRef, {
        name: editedName,
        status: editedStatus,
        head: editedHead,
      });
      toast({
        title: 'Success',
        description: 'Department updated successfully.',
      });
      setIsEditDialogOpen(false);
      setEditingDepartment(null);
      fetchDepartments();
    } catch (error) {
      console.error('Error updating department: ', error);
      toast({
        title: 'Error',
        description: 'Failed to update department.',
        variant: 'destructive',
      });
    }
  };

  if (isAuthLoading || (isLoading && canView)) {
    return (
      <>
        <div className="fixed inset-0 -z-10 pointer-events-none">
          <div className="absolute inset-0 bg-gradient-to-br from-sky-50/60 via-background to-blue-50/40 dark:from-sky-950/20 dark:via-background dark:to-blue-950/15" />
        </div>
        <div className="w-full max-w-5xl mx-auto space-y-4">
          <div className="flex items-center justify-between">
            <Skeleton className="h-9 w-48 rounded-xl" />
            <Skeleton className="h-9 w-36 rounded-full" />
          </div>
          <Skeleton className="h-80 w-full rounded-xl" />
        </div>
      </>
    );
  }

  if (!canView) {
    return (
      <div className="w-full max-w-5xl mx-auto">
        <div className="mb-5 flex items-center gap-3">
          <Link href="/settings"><Button variant="ghost" size="icon" className="rounded-full"><ArrowLeft className="h-5 w-5" /></Button></Link>
          <h1 className="text-xl font-bold">Manage Department</h1>
        </div>
        <Card><CardHeader><CardTitleShad>Access Denied</CardTitleShad><CardDescriptionShad>You do not have permission to view this page.</CardDescriptionShad></CardHeader>
          <CardContent className="flex justify-center p-8"><ShieldAlert className="h-14 w-14 text-destructive" /></CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      {/* ── Background ── */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-sky-50/60 via-background to-blue-50/40 dark:from-sky-950/20 dark:via-background dark:to-blue-950/15" />
        <div className="animate-bb-orb-1 absolute top-[-10%] left-[-5%] w-[40vw] h-[40vw] rounded-full bg-sky-300/15 blur-3xl" />
        <div className="animate-bb-orb-2 absolute bottom-[-8%] right-[-6%] w-[40vw] h-[40vw] rounded-full bg-blue-300/12 blur-3xl" />
        <div className="absolute inset-0 opacity-20 dark:opacity-12"
          style={{ backgroundImage: 'radial-gradient(circle, rgba(14,165,233,0.10) 1px, transparent 1px)', backgroundSize: '28px 28px' }}
        />
      </div>
    <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/settings">
            <Button variant="ghost" size="icon" className="rounded-full hover:bg-sky-50 dark:hover:bg-sky-950/30">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Manage Departments</h1>
            <p className="text-xs text-muted-foreground">{departments.length} department{departments.length !== 1 ? 's' : ''} configured</p>
          </div>
        </div>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button disabled={!canAdd} className="rounded-full shadow-md">
              <Plus className="mr-2 h-4 w-4" />
              Add Department
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]" onPointerDownOutside={(e) => e.preventDefault()}>
            <DialogHeader>
              <DialogTitle>Add New Department</DialogTitle>
              <DialogDescription>
                Fill in the details to add a new department.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="add-name">
                  Department Name
                </Label>
                <Input
                  id="add-name"
                  value={newDepartmentName}
                  onChange={(e) => setNewDepartmentName(e.target.value)}
                  placeholder="e.g., Human Resources"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="add-status">
                  Status
                </Label>
                <Select
                  value={newDepartmentStatus}
                  onValueChange={(value: 'Active' | 'Inactive') => setNewDepartmentStatus(value)}
                >
                  <SelectTrigger id="add-status">
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Active">Active</SelectItem>
                    <SelectItem value="Inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="add-head">
                  Head of Department
                </Label>
                 <Select
                  value={newDepartmentHead}
                  onValueChange={(value: string) => setNewDepartmentHead(value)}
                >
                  <SelectTrigger id="add-head">
                    <SelectValue placeholder="Select a user" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="N/A">N/A</SelectItem>
                    {/* You can map over users here in the future */}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" onClick={resetAddDialog}>Cancel</Button>
              </DialogClose>
              <Button onClick={handleAddDepartment}>Add Department</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="overflow-hidden border-border/60">
        <div className="h-0.5 w-full bg-gradient-to-r from-sky-400 to-blue-400" />
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead className="font-semibold">Department Name</TableHead>
                <TableHead className="font-semibold">Head of Department</TableHead>
                <TableHead className="font-semibold">Status</TableHead>
                <TableHead className="text-right font-semibold">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-3/4" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-1/2" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-1/4" /></TableCell>
                    <TableCell className="text-right space-x-2">
                       <Skeleton className="h-8 w-16 inline-block" />
                       <Skeleton className="h-8 w-16 inline-block" />
                    </TableCell>
                  </TableRow>
                ))
              ) : departments.length > 0 ? (
                departments.map((dept) => (
                  <TableRow key={dept.id} className="hover:bg-muted/20 transition-colors">
                    <TableCell className="font-medium">{dept.name}</TableCell>
                    <TableCell className="text-muted-foreground">{dept.head}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        dept.status === 'Active'
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
                          : 'bg-muted text-muted-foreground'
                      }`}>
                        {dept.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button variant="outline" size="sm" onClick={() => openEditDialog(dept)} disabled={!canEdit} className="rounded-lg">Edit</Button>
                      <Button variant="destructive" size="sm" onClick={() => handleDeleteDepartment(dept.id)} disabled={!canDelete} className="rounded-lg">Delete</Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="text-center h-24 text-muted-foreground">
                    No departments found. Add your first department.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Edit Department Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit Department</DialogTitle>
            <DialogDescription>
              Fill in the details to update the department.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-6 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="edit-name" className="text-right">
                Department Name
              </Label>
              <div className="col-span-3 relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="edit-name"
                  value={editedName}
                  onChange={(e) => setEditedName(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="edit-status" className="text-right">
                Status
              </Label>
              <Select
                value={editedStatus}
                onValueChange={(value: 'Active' | 'Inactive') => setEditedStatus(value)}
              >
                <SelectTrigger className="col-span-3">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="edit-head" className="text-right">
                Head of Department
              </Label>
               <Select
                value={editedHead}
                onValueChange={(value: string) => setEditedHead(value)}
              >
                <SelectTrigger className="col-span-3">
                  <SelectValue placeholder="Select a user" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="N/A">N/A</SelectItem>
                  {/* You can map over users here in the future */}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={handleUpdateDepartment}>Update Department</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </>
  );
}
