
'use client';

import { useState, useEffect, Fragment } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, ChevronUp, ShieldAlert } from 'lucide-react';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuthorization } from '@/hooks/useAuthorization';
import { CardHeader, CardTitle as CardTitleShad, CardDescription as CardDescriptionShad, CardContent as CardContentShad } from '@/components/ui/card';


const permissionModules = {
  'Site Fund Requisition': [
    'View Module', 'Create Requisition', 'Edit Requisition', 'Delete Requisition',
    'Approve Request', 'Reject Request', 'View Dashboard', 'View History',
    'Revise Request', 'View Settings', 'View Summary', 'View Planned vs Actual'
  ],
  'Daily Requisition': {
    'Entry Sheet': ['View', 'Add', 'Edit', 'Delete', 'View Checklist'],
    'Receiving at Finance': ['View', 'Mark as Received', 'Return to Pending', 'Cancel'],
    'GST & TDS Verification': ['View', 'Verify', 'Re-verify', 'Return to Pending'],
    'Settings': ['View', 'Edit Serial Nos', 'Edit User Rights'],
  },
  'Billing Recon': {
    'BOQ': ['View', 'Import', 'Add Manual', 'Clear BOQ', 'Delete Items'],
    'JMC': ['View', 'Create Work Order', 'Create JMC Entry', 'View Log', 'Delete JMC'],
    'Billing': ['View', 'Create Bill', 'View Log'],
    'MVAC': ['View', 'Add Item'],
  },
  'Expenses': {
    'Module Access': ['View'],
    'Expense Requests': ['Create', 'View All'],
    'Settings': ['View', 'Edit Serial Nos', 'Manage Accounts'],
  },
  'Settings': {
    'Manage Department': ['View', 'Add', 'Edit', 'Delete'],
    'Manage Project': ['View', 'Add', 'Edit', 'Delete'],
    'Employee Management': ['View', 'Add', 'Edit', 'Delete', 'Sync from GreytHR'],
    'User Management': ['View', 'Add', 'Edit', 'Delete'],
    'Role Management': ['View', 'Add', 'Edit', 'Delete'],
    'Working Hrs': ['View', 'Edit'],
    'Serial No. Config': ['View', 'Edit'],
    'Appearance': ['View', 'Edit'],
    'Email Authorization': ['View', 'Send Request', 'Revoke'],
  },
};

const initialNewRoleState = {
  name: '',
  permissions: Object.keys(permissionModules).reduce((acc, module) => {
    const sub = permissionModules[module as keyof typeof permissionModules];
    if(Array.isArray(sub)){
      acc[module] = [];
    } else {
      Object.keys(sub).forEach(subModule => {
        acc[`${module}.${subModule}`] = [];
      });
    }
    return acc;
  }, {} as Record<string, string[]>),
};

export default function ManageRolePage() {
  const { toast } = useToast();
  const { can } = useAuthorization();
  const [roles, setRoles] = useState<Role[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const [newRole, setNewRole] = useState<{name: string, permissions: Record<string, string[]>}>(JSON.parse(JSON.stringify(initialNewRoleState)));
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
    const completePermissions: Record<string, string[]> = {};
    Object.keys(permissionModules).forEach(moduleName => {
        const sub = permissionModules[moduleName as keyof typeof permissionModules];
        if (Array.isArray(sub)) {
            completePermissions[moduleName] = role.permissions?.[moduleName] || [];
        } else {
            Object.keys(sub).forEach(subModule => {
                const key = `${moduleName}.${subModule}`;
                completePermissions[key] = role.permissions?.[key] || [];
            });
        }
    });
    
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
             <Accordion type="multiple" defaultValue={Object.keys(permissionModules)}>
              {Object.entries(permissionModules).map(([moduleName, permissions]) => (
                <AccordionItem value={moduleName} key={moduleName}>
                  <AccordionTrigger className="font-medium text-base">
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
                        <Accordion type="multiple" className="w-full" defaultValue={Object.keys(permissions)}>
                            {Object.entries(permissions).map(([subModuleName, subPermissions]) => (
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
                        </Accordion>
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

  if (!can('View', 'Role Management')) {
    return (
        <div className="w-full max-w-4xl mx-auto">
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
                <CardContentShad>
                    <ShieldAlert className="h-16 w-16 text-destructive mx-auto" />
                </CardContentShad>
            </Card>
        </div>
    );
  }

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
            <Button disabled={!can('Add', 'Role Management')}>
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
                    <TableCell>
                      <TooltipProvider>
                        <div className="flex flex-wrap gap-1">
                          {role.permissions && Object.entries(role.permissions).map(([moduleKey, perms]) => (
                            perms.length > 0 && (
                              <Tooltip key={moduleKey}>
                                <TooltipTrigger asChild>
                                  <Badge variant="secondary" className="cursor-default">{moduleKey.replace('.', ' / ')} ({perms.length})</Badge>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p className="font-medium">{moduleKey.replace('.', ' / ')}</p>
                                  <ul className="list-disc pl-4 text-muted-foreground">
                                    {perms.map(p => <li key={p}>{p}</li>)}
                                  </ul>
                                </TooltipContent>
                              </Tooltip>
                            )
                          ))}
                        </div>
                      </TooltipProvider>
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button variant="outline" size="sm" onClick={() => openEditDialog(role)} disabled={!can('Edit', 'Role Management')}>Edit</Button>
                      <Button variant="destructive" size="sm" onClick={() => handleDeleteRole(role.id)} disabled={!can('Delete', 'Role Management')}>Delete</Button>
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
