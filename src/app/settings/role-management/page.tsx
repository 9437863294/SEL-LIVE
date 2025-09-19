

'use client';

import { useState, useEffect, Fragment } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, ChevronDown, ShieldAlert, Edit, Trash2 } from 'lucide-react';
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
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, deleteDoc, doc } from 'firebase/firestore';
import { type Role } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { getTotalPermissionsForModule, getGrantedPermissionsForModule } from '@/lib/permission-utils';


export default function ManageRolePage() {
  const { toast } = useToast();
  const router = useRouter();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  
  const [roles, setRoles] = useState<Role[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const canView = can('View', 'Settings.Role Management');
  const canAdd = can('Add', 'Settings.Role Management');
  const canEdit = can('Edit', 'Settings.Role Management');
  const canDelete = can('Delete', 'Settings.Role Management');

  const fetchRoles = async () => {
    setIsLoading(true);
    try {
      const rolesSnap = await getDocs(collection(db, 'roles'));
      const rolesData: Role[] = rolesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Role));
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
    if (!isAuthLoading && canView) {
      fetchRoles();
    } else if (!isAuthLoading && !canView) {
        setIsLoading(false);
    }
  }, [isAuthLoading, canView, toast]);


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
    );
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
        <Link href="/settings/role-management/add">
          <Button disabled={!canAdd}>
            <Plus className="mr-2 h-4 w-4" />
            Add New Role
          </Button>
        </Link>
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
                        {getTotalPermissionsForModule && getGrantedPermissionsForModule && Object.keys(permissionModules).map(moduleName => {
                            const totalPerms = getTotalPermissionsForModule(moduleName);
                            if (totalPerms === 0) return null;
                            const grantedPerms = getGrantedPermissionsForModule(role.permissions, moduleName);
                            if (grantedPerms === 0) return null;
                            const percentage = totalPerms > 0 ? Math.round((grantedPerms / totalPerms) * 100) : 0;
                            return (
                                <Badge key={moduleName} variant={percentage === 100 ? 'default' : 'secondary'} className="cursor-default">
                                    {moduleName}: {percentage}%
                                </Badge>
                            )
                        })}
                      </div>
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Link href={`/settings/role-management/edit/${role.id}`}>
                        <Button variant="outline" size="sm" disabled={!canEdit}>
                           <Edit className="mr-2 h-4 w-4"/> Edit
                        </Button>
                      </Link>
                       <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="destructive" size="sm" disabled={!canDelete}>
                                <Trash2 className="mr-2 h-4 w-4" /> Delete
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                                <AlertDialogDescription>This will permanently delete the "{role.name}" role.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleDeleteRole(role.id)}>Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
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
    </div>
  );
}
