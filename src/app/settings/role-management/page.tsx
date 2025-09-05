
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, ShieldCheck } from 'lucide-react';
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
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, addDoc, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import type { Role } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';

const initialNewRoleState = {
  name: '',
  permissions: '',
};

export default function ManageRolePage() {
  const { toast } = useToast();
  const [roles, setRoles] = useState<Role[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const [newRole, setNewRole] = useState(initialNewRoleState);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);

  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

  const fetchRoles = async () => {
    setIsLoading(true);
    try {
      const querySnapshot = await getDocs(collection(db, 'roles'));
      const rolesData: Role[] = [];
      querySnapshot.forEach((doc) => {
        rolesData.push({ id: doc.id, ...doc.data() } as Role);
      });
      setRoles(rolesData);
    } catch (error) {
      console.error("Error fetching roles: ", error);
      toast({
        title: 'Error',
        description: 'Failed to fetch roles.',
        variant: 'destructive',
      });
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchRoles();
  }, []);
  
  const handleInputChange = (field: keyof typeof newRole, value: string) => {
    setNewRole(prev => ({ ...prev, [field]: value }));
  };
  
  const resetAddDialog = () => {
    setNewRole(initialNewRoleState);
    setIsAddDialogOpen(false);
  }

  const handleAddRole = async () => {
    if (!newRole.name.trim() || !newRole.permissions.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Role Name and Permissions cannot be empty.',
        variant: 'destructive',
      });
      return;
    }
    try {
      await addDoc(collection(db, 'roles'), newRole);
      toast({
        title: 'Success',
        description: `Role "${newRole.name}" added.`,
      });
      resetAddDialog();
      fetchRoles(); 
    } catch (error) {
      console.error("Error adding role: ", error);
      toast({
        title: 'Error',
        description: 'Failed to add role.',
        variant: 'destructive',
      });
    }
  };
  
  const handleDeleteRole = async (id: string) => {
    try {
      await deleteDoc(doc(db, "roles", id));
      toast({
        title: "Success",
        description: "Role deleted successfully.",
      });
      fetchRoles();
    } catch (error) {
      console.error("Error deleting role: ", error);
      toast({
        title: "Error",
        description: "Failed to delete role.",
        variant: "destructive",
      });
    }
  };
  
  const openEditDialog = (role: Role) => {
    setEditingRole(role);
    setIsEditDialogOpen(true);
  };
  
  const handleUpdateRole = async () => {
    if (!editingRole) return;
  
    try {
      const roleRef = doc(db, 'roles', editingRole.id);
      const { id, ...dataToUpdate } = editingRole;
      await updateDoc(roleRef, dataToUpdate);
      toast({
        title: 'Success',
        description: 'Role updated successfully.',
      });
      setIsEditDialogOpen(false);
      setEditingRole(null);
      fetchRoles();
    } catch (error) {
      console.error('Error updating role: ', error);
      toast({
        title: 'Error',
        description: 'Failed to update role.',
        variant: 'destructive',
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
          <h1 className="text-2xl font-bold">Role Management</h1>
        </div>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add New Role
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-xl" onPointerDownOutside={(e) => e.preventDefault()}>
            <DialogHeader>
              <DialogTitle>Add New Role</DialogTitle>
              <DialogDescription>
                Define a new role and its permissions.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
                <div className="space-y-2">
                    <Label htmlFor="roleName">Role Name</Label>
                    <Input id="roleName" placeholder="e.g. Admin, Editor" value={newRole.name} onChange={(e) => handleInputChange('name', e.target.value)} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="permissions">Permissions</Label>
                    <Textarea id="permissions" placeholder="Describe permissions, separated by |" value={newRole.permissions} onChange={(e) => handleInputChange('permissions', e.target.value)} rows={4}/>
                </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" onClick={resetAddDialog}>Cancel</Button>
              </DialogClose>
              <Button onClick={handleAddRole}>Add Role</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[200px]">Role Name</TableHead>
                <TableHead>Permissions</TableHead>
                <TableHead className="text-right w-[180px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-3/4" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-full" /></TableCell>
                    <TableCell className="text-right space-x-2">
                       <Skeleton className="h-8 w-16 inline-block" />
                       <Skeleton className="h-8 w-16 inline-block" />
                    </TableCell>
                  </TableRow>
                ))
              ) : roles.length > 0 ? (
                roles.map((role) => (
                  <TableRow key={role.id}>
                    <TableCell className="font-medium">{role.name}</TableCell>
                    <TableCell className="text-muted-foreground text-sm whitespace-pre-wrap break-words max-w-md">{role.permissions}</TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button variant="outline" size="sm" onClick={() => openEditDialog(role)}>Edit</Button>
                      <Button variant="destructive" size="sm" onClick={() => handleDeleteRole(role.id)}>Delete</Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={3} className="text-center h-24">
                    No roles found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit Role</DialogTitle>
            <DialogDescription>
              Update the details of the role.
            </DialogDescription>
          </DialogHeader>
          {editingRole && (
            <div className="space-y-4 py-4">
                 <div className="space-y-2">
                    <Label htmlFor="editRoleName">Role Name</Label>
                    <Input id="editRoleName" value={editingRole.name} onChange={(e) => setEditingRole({...editingRole, name: e.target.value})} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="editPermissions">Permissions</Label>
                    <Textarea id="editPermissions" value={editingRole.permissions} onChange={(e) => setEditingRole({...editingRole, permissions: e.target.value})} rows={4} />
                </div>
            </div>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={handleUpdateRole}>Update Role</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
