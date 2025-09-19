

'use client';

import { useState, useEffect, Fragment } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, ChevronDown, ShieldAlert } from 'lucide-react';
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
import { collection, getDocs, addDoc, deleteDoc, doc, updateDoc, writeBatch, query, where } from 'firebase/firestore';
import { type Role, permissionModules, type Department } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuthorization } from '@/hooks/useAuthorization';
import { CardHeader, CardTitle as CardTitleShad, CardDescription as CardDescriptionShad, CardContent as CardContentShad } from '@/components/ui/card';


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
  
  const handleViewModuleChange = (
    setState: React.Dispatch<React.SetStateAction<any>>,
    moduleName: string,
    isChecked: boolean
  ) => {
     setState((prevState: any) => {
      const newPermissions = { ...prevState.permissions };
      if(isChecked) {
        newPermissions[moduleName] = ['View Module'];
      } else {
        // When unchecking "View Module", clear all permissions for that module and its submodules.
        Object.keys(newPermissions).forEach(key => {
            if (key === moduleName || key.startsWith(`${moduleName}.`)) {
                newPermissions[key] = [];
            }
        });
      }
      return { ...prevState, permissions: newPermissions };
    });
  }

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
  
 const calculateTotalPermissions = (moduleName: string) => {
    const module = permissionModules[moduleName as keyof typeof permissionModules];
    if (Array.isArray(module)) {
        return module.length;
    }
    let count = 0;
    Object.entries(module).forEach(([key, value]) => {
        if(key === 'View Module') {
          count +=1;
        } else if (key === 'Departments') {
           count += value.length * departments.length;
        } else {
           count += value.length;
        }
    });
    return count;
  };

  const calculateGrantedPermissions = (role: Role, moduleName: string) => {
    if (!role.permissions) return 0;
    return Object.keys(role.permissions)
      .filter(key => key === moduleName || key.startsWith(`${moduleName}.`))
      .reduce((acc, key) => acc + role.permissions[key].length, 0);
  };


  const renderPermissionsForm = (
    roleData: { name: string; permissions: Record<string, string[]> },
    setData: React.Dispatch<React.SetStateAction<any>>
  ) => (
    <div className="space-y-4">
      <div>
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
        <p className="text-sm text-muted-foreground">Select the actions this role can perform for each module.</p>
        <Card className="mt-2">
          <CardContent className="p-4 max-h-[50vh] overflow-y-auto">
             <Accordion type="single" collapsible className="w-full">
              {Object.entries(permissionModules).map(([moduleName, permissions]) => (
                <AccordionItem value={moduleName} key={moduleName}>
                  <AccordionTrigger className="font-medium text-base hover:no-underline">
                    {moduleName}
                  </AccordionTrigger>
                  <AccordionContent className="pt-4 space-y-4">
                    {Array.isArray(permissions) ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                            {permissions.map((permission) => (
                                <div key={permission} className="flex items-center space-x-2">
                                <Checkbox
                                    id={`${roleData.name}-${moduleName}-${permission}`}
                                    checked={roleData.permissions?.[moduleName]?.includes(permission)}
                                    onCheckedChange={(checked) => handlePermissionChange(setData, moduleName, permission, !!checked)}
                                />
                                <Label htmlFor={`${roleData.name}-${moduleName}-${permission}`} className="font-normal leading-tight">
                                    {permission}
                                </Label>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <>
                          {Object.keys(permissions).includes('View Module') && (
                            <div className="flex items-center space-x-2 p-2 bg-muted/50 rounded-md">
                               <Checkbox
                                  id={`${roleData.name}-${moduleName}-ViewModule`}
                                  checked={roleData.permissions?.[moduleName]?.includes('View Module')}
                                  onCheckedChange={(checked) => handleViewModuleChange(setData, moduleName, !!checked)}
                                />
                                <Label htmlFor={`${roleData.name}-${moduleName}-ViewModule`} className="font-semibold leading-tight text-primary">
                                    View Module
                                </Label>
                            </div>
                          )}
                           <Accordion type="single" collapsible className="w-full pl-4">
                              {Object.entries(permissions).filter(([subModuleName]) => subModuleName !== 'View Module' && subModuleName !== 'Departments').map(([subModuleName, subPermissions]) => (
                                  <AccordionItem value={subModuleName} key={subModuleName}>
                                      <AccordionTrigger className="text-sm font-semibold">{subModuleName}</AccordionTrigger>
                                      <AccordionContent className="pt-4">
                                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                                              {subPermissions.map((permission) => (
                                                  <div key={permission} className="flex items-center space-x-2">
                                                  <Checkbox
                                                      id={`${roleData.name}-${moduleName}-${subModuleName}-${permission}`}
                                                      checked={roleData.permissions?.[`${moduleName}.${subModuleName}`]?.includes(permission)}
                                                      onCheckedChange={(checked) => handlePermissionChange(setData, `${moduleName}.${subModuleName}`, permission, !!checked)}
                                                  />
                                                  <Label htmlFor={`${roleData.name}-${moduleName}-${subModuleName}-${permission}`} className="font-normal leading-tight">
                                                      {permission}
                                                  </Label>
                                                  </div>
                                              ))}
                                          </div>
                                      </AccordionContent>
                                  </AccordionItem>
                              ))}

                              {/* Dynamic Departments for Expenses Module */}
                              {moduleName === 'Expenses' && (
                                <AccordionItem value="Departments">
                                  <AccordionTrigger className="text-sm font-semibold">Departments</AccordionTrigger>
                                  <AccordionContent className="pt-4 space-y-3">
                                      {departments.map(dept => (
                                        <div key={dept.id} className="p-3 border rounded-md">
                                            <p className="font-medium mb-2">{dept.name}</p>
                                             <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                                                {(permissionModules.Expenses.Departments as string[]).map(perm => (
                                                    <div key={perm} className="flex items-center space-x-2">
                                                        <Checkbox
                                                          id={`${roleData.name}-Expenses-Departments-${dept.id}-${perm}`}
                                                          checked={roleData.permissions?.[`Expenses.Departments.${dept.id}`]?.includes(perm)}
                                                          onCheckedChange={(checked) => handlePermissionChange(setData, `Expenses.Departments.${dept.id}`, perm, !!checked)}
                                                        />
                                                        <Label htmlFor={`${roleData.name}-Expenses-Departments-${dept.id}-${perm}`} className="font-normal leading-tight">
                                                            {perm}
                                                        </Label>
                                                    </div>
                                                ))}
                                             </div>
                                        </div>
                                      ))}
                                  </AccordionContent>
                                </AccordionItem>
                              )}
                          </Accordion>
                        </>
                    )}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </CardContent>
        </Card>
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
                <CardContentShad className="flex justify-center p-8">
                    <ShieldAlert className="h-16 w-16 text-destructive" />
                </CardContentShad>
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
                <TableHead>Permissions Summary</TableHead>
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
                        {Object.keys(permissionModules).map(moduleName => {
                           const total = calculateTotalPermissions(moduleName);
                           const granted = calculateGrantedPermissions(role, moduleName);
                           if (total === 0) return null;
                           const percentage = Math.round((granted / total) * 100);
                           return (
                             <TooltipProvider key={moduleName}>
                               <Tooltip>
                                 <TooltipTrigger asChild>
                                   <Badge variant={granted > 0 ? "default" : "secondary"} className="cursor-default">
                                     {moduleName}: {percentage}%
                                   </Badge>
                                 </TooltipTrigger>
                                 <TooltipContent>
                                   {granted} of {total} permissions granted
                                 </TooltipContent>
                               </Tooltip>
                             </TooltipProvider>
                           );
                        })}
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
