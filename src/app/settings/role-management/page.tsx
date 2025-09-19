
'use client';

import { useState, useEffect, Fragment } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, ChevronDown, ShieldAlert, Edit, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription as CardDescriptionShad,
  CardHeader,
  CardTitle as CardTitleShad,
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
import { collection, getDocs, addDoc, deleteDoc, doc, updateDoc, writeBatch, query, where } from 'firebase/firestore';
import { type Role, permissionModules, type Department } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuthorization } from '@/hooks/useAuthorization';


const initialNewRoleState = {
  name: '',
  permissions: Object.keys(permissionModules).reduce((acc, module) => {
    const sub = permissionModules[module as keyof typeof permissionModules];
    if(Array.isArray(sub)){
      const key = module;
       if (!acc[key]) {
        acc[key] = [];
      }
    } else {
      Object.keys(sub).forEach(subModule => {
        const key = subModule === 'View Module' ? module : `${module}.${subModule}`;
        if (!acc[key]) {
          acc[key] = [];
        }
      });
    }
    return acc;
  }, {} as Record<string, string[]>),
};

export default function ManageRolePage() {
  const { toast } = useToast();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  
  const [roles, setRoles] = useState<Role[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const [newRole, setNewRole] = useState<{name: string, permissions: Record<string, string[]>}>(JSON.parse(JSON.stringify(initialNewRoleState)));
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);

  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  
  const canView = can('View', 'Settings.Role Management');
  const canAdd = can('Add', 'Settings.Role Management');
  const canEdit = can('Edit', 'Settings.Role Management');
  const canDelete = can('Delete', 'Settings.Role Management');

  const fetchRolesAndDepartments = async () => {
    setIsLoading(true);
    try {
      const [rolesSnap, deptsSnap] = await Promise.all([
        getDocs(collection(db, 'roles')),
        getDocs(query(collection(db, 'departments'), where('status', '==', 'Active')))
      ]);
      
      const rolesData: Role[] = rolesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Role));
      setRoles(rolesData);
      
      const deptsData: Department[] = deptsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Department));
      setDepartments(deptsData);

    } catch (error) {
      console.error("Error fetching roles or departments: ", error);
      toast({
        title: 'Error',
        description: 'Failed to fetch roles or departments.',
        variant: 'destructive',
      });
    }
    setIsLoading(false);
  };
  
  useEffect(() => {
    if (!isAuthLoading && canView) {
      fetchRolesAndDepartments();
    } else if (!isAuthLoading && !canView) {
        setIsLoading(false);
    }
  }, [isAuthLoading, canView]);


  const resetAddDialog = () => {
    setNewRole(JSON.parse(JSON.stringify(initialNewRoleState)));
    setIsAddDialogOpen(false);
  }

  const handlePermissionChange = (
    setState: React.Dispatch<React.SetStateAction<any>>,
    moduleKey: string,
    permission: string, 
    isChecked: boolean
  ) => {
    setState((prevState: any) => {
      const newPermissions = { ...prevState.permissions };
      const currentPermissions = newPermissions[moduleKey] || [];
      if (isChecked) {
        if (!currentPermissions.includes(permission)) {
          newPermissions[moduleKey] = [...currentPermissions, permission];
        }
      } else {
        newPermissions[moduleKey] = currentPermissions.filter((p: string) => p !== permission);
      }
      return { ...prevState, permissions: newPermissions };
    });
  };
  
  const handleSelectAll = (
    setState: React.Dispatch<React.SetStateAction<any>>,
    moduleName: string,
    allPermissionsForModule: string[],
    isChecked: boolean
  ) => {
    setState((prevState: any) => {
      const newPermissions = { ...prevState.permissions };
      const key = moduleName.includes('.') ? moduleName : `${moduleName}.View`;
      newPermissions[moduleName] = isChecked ? allPermissionsForModule : [];
      return { ...prevState, permissions: newPermissions };
    });
  };
  

  const handleAddRole = async () => {
    if (!newRole.name.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Role Name cannot be empty.',
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
      fetchRolesAndDepartments(); 
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
      fetchRolesAndDepartments();
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
    const completePermissions: Record<string, string[]> = {};
    Object.keys(permissionModules).forEach(moduleName => {
        const sub = permissionModules[moduleName as keyof typeof permissionModules];
        if (Array.isArray(sub)) {
            const key = moduleName;
            completePermissions[key] = role.permissions?.[key] || [];
        } else {
            Object.keys(sub).forEach(subModule => {
                const key = subModule === 'View Module' ? moduleName : `${moduleName}.${subModule}`;
                completePermissions[key] = role.permissions?.[key] || [];
            });
        }
    });

    departments.forEach(dept => {
        const deptKey = `Expenses.Departments.${dept.id}`;
        completePermissions[deptKey] = role.permissions?.[deptKey] || [];
    })
    
    setEditingRole({ ...role, permissions: completePermissions });
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
      fetchRolesAndDepartments();
    } catch (error) {
      console.error('Error updating role: ', error);
      toast({
        title: 'Error',
        description: 'Failed to update role.',
        variant: 'destructive',
      });
    }
  };


  const renderPermissionsForm = (
    roleData: { name: string; permissions: Record<string, string[]> },
    setData: React.Dispatch<React.SetStateAction<any>>
  ) => (
    <div className="space-y-4">
      <div className="max-w-sm">
        <Label htmlFor="roleName">Role Name</Label>
        <Input 
          id="roleName" 
          value={roleData.name} 
          onChange={(e) => setData({ ...roleData, name: e.target.value })} 
          className="mt-1"
        />
      </div>
      <div>
        <Label>Permissions</Label>
        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(permissionModules).map(([moduleName, moduleValue]) => {
                // This logic handles both flat arrays and nested objects of permissions
                const permissionGroups = Array.isArray(moduleValue) 
                    ? { [moduleName]: moduleValue }
                    : Object.entries(moduleValue).reduce((acc, [subKey, subValue]) => {
                        const fullKey = subKey === 'View Module' ? moduleName : `${moduleName}.${subKey}`;
                        acc[fullKey] = subValue;
                        return acc;
                      }, {} as Record<string, string[]>);
                
                return Object.entries(permissionGroups).map(([groupKey, permissions]) => {
                    const allPermissionsInGroup = permissions;
                    const grantedPermissions = roleData.permissions?.[groupKey] || [];
                    const isAllSelected = allPermissionsInGroup.length > 0 && grantedPermissions.length === allPermissionsInGroup.length;
                    
                    // A more descriptive title for the card
                    const cardTitle = groupKey.includes('.') ? groupKey.split('.').join(' > ') : groupKey;

                    return (
                        <Card key={groupKey}>
                            <CardHeader className="p-4 flex-row items-center justify-between">
                                <CardTitleShad className="text-base">{cardTitle} <span className="text-sm font-normal text-muted-foreground">Permission</span></CardTitleShad>
                                <div className="flex items-center space-x-2">
                                    <Checkbox
                                        id={`select-all-${groupKey}`}
                                        checked={isAllSelected}
                                        onCheckedChange={(checked) => handleSelectAll(setData, groupKey, allPermissionsInGroup, !!checked)}
                                    />
                                    <Label htmlFor={`select-all-${groupKey}`} className="text-sm font-medium">Select All</Label>
                                </div>
                            </CardHeader>
                            <CardContent className="p-4 grid grid-cols-2 gap-4">
                                {permissions.map(permission => (
                                    <div key={permission} className="flex items-center space-x-2">
                                        <Checkbox
                                            id={`${roleData.name}-${groupKey}-${permission}`}
                                            checked={grantedPermissions.includes(permission)}
                                            onCheckedChange={(checked) => handlePermissionChange(setData, groupKey, permission, !!checked)}
                                        />
                                        <Label htmlFor={`${roleData.name}-${groupKey}-${permission}`} className="text-sm font-normal leading-tight">
                                            {permission}
                                        </Label>
                                    </div>
                                ))}
                            </CardContent>
                        </Card>
                    );
                });
            })}
        </div>
      </div>
    </div>
  );

  if (isAuthLoading || (isLoading && canView)) {
    return (
        <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
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
    )
  }
  
  if (!canView) {
    return (
        <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="mb-6 flex items-center gap-4">
              <Link href="/settings">
                <Button variant="ghost" size="icon">
                  <ArrowLeft className="h-6 w-6" />
                </Button>
              </Link>
              <h1 className="text-2xl font-bold">Role Management</h1>
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
    );
  }

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
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
            <Button disabled={!canAdd}>
              <Plus className="mr-2 h-4 w-4" />
              Add New Role
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-4xl" onPointerDownOutside={(e) => e.preventDefault()}>
            <DialogHeader>
              <DialogTitle>Add New Role</DialogTitle>
              <DialogDescription>
                Define a new role and its permissions.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              {renderPermissionsForm(newRole, setNewRole)}
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
                <TableHead>Total Permissions</TableHead>
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
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {Object.keys(role.permissions || {}).length} permissions
                      </div>
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button variant="outline" size="sm" onClick={() => openEditDialog(role)} disabled={!canEdit}>Edit</Button>
                      <Button variant="destructive" size="sm" onClick={() => handleDeleteRole(role.id)} disabled={!canDelete}>Delete</Button>
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
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Edit Role</DialogTitle>
            <DialogDescription>
              Update the role name and permissions.
            </DialogDescription>
          </DialogHeader>
          {editingRole && (
            <div className="py-4">
              {renderPermissionsForm(editingRole, setEditingRole)}
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
