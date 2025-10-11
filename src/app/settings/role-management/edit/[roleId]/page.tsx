
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Save, Loader2, Plus, Edit, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle as CardTitleShad, CardDescription as CardDescriptionShad } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, doc, getDoc, updateDoc, getDocs, query, where } from 'firebase/firestore';
import type { Role, Department, Project } from '@/lib/types';
import { permissionModules } from '@/lib/types';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

export default function EditRolePage() {
    const { toast } = useToast();
    const router = useRouter();
    const { roleId } = useParams() as { roleId: string };
    const { user } = useAuth();

    const [editingRole, setEditingRole] = useState<Role | null>(null);
    const [departments, setDepartments] = useState<Department[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (!roleId) return;

        const fetchRoleAndDepartments = async () => {
            setIsLoading(true);
            try {
                const roleDocRef = doc(db, 'roles', roleId);
                const roleDocSnap = await getDoc(roleDocRef);

                if (roleDocSnap.exists()) {
                    const roleData = { id: roleDocSnap.id, ...roleDocSnap.data() } as Role;
                    
                    const completePermissions: Record<string, string[]> = {};
                    Object.keys(permissionModules).forEach(moduleName => {
                        const sub = permissionModules[moduleName as keyof typeof permissionModules];
                        if (Array.isArray(sub)) {
                            completePermissions[moduleName] = roleData.permissions?.[moduleName] || [];
                        } else {
                             if(sub['View Module'] !== undefined){
                                completePermissions[moduleName] = (roleData.permissions?.[moduleName] || []).includes('View Module') ? ['View Module'] : [];
                             }
                            Object.keys(sub).forEach(subModule => {
                                if (subModule === 'View Module') return;
                                const key = `${moduleName}.${subModule}`;
                                completePermissions[key] = roleData.permissions?.[key] || [];
                            });
                        }
                    });

                    const deptsSnap = await getDocs(query(collection(db, 'departments'), where('status', '==', 'Active')));
                    const deptsData = deptsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Department));
                    setDepartments(deptsData);

                    const projectsSnap = await getDocs(query(collection(db, 'projects'), where('stockManagementRequired', '==', true)));
                    const projectsData = projectsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project));
                    setProjects(projectsData);

                    deptsData.forEach(dept => {
                        const deptKey = `Expenses.Departments.${dept.id}`;
                        completePermissions[deptKey] = roleData.permissions?.[deptKey] || [];
                    });
                    
                    projectsData.forEach(proj => {
                        const projectKey = `Store & Stock Management.Projects.${proj.id}`;
                        completePermissions[projectKey] = roleData.permissions?.[projectKey] || [];
                    });

                    setEditingRole({ ...roleData, permissions: completePermissions });
                } else {
                    toast({ title: 'Error', description: 'Role not found.', variant: 'destructive' });
                    router.push('/settings/role-management');
                }
            } catch (error) {
                console.error("Error fetching role:", error);
                toast({ title: 'Error', description: 'Failed to fetch role details.', variant: 'destructive' });
            }
            setIsLoading(false);
        };
        
        fetchRoleAndDepartments();
    }, [roleId, router, toast]);

    const handlePermissionChange = (moduleKey: string, permission: string, isChecked: boolean) => {
        setEditingRole(prev => {
            if (!prev) return null;
            const newPermissions = { ...prev.permissions };
            const currentPermissions = newPermissions[moduleKey] || [];
            if (isChecked) {
                newPermissions[moduleKey] = [...currentPermissions, permission];
            } else {
                newPermissions[moduleKey] = currentPermissions.filter(p => p !== permission);
            }
            return { ...prev, permissions: newPermissions };
        });
    };
      
    const handleSelectAllForGroup = (groupKey: string, allPermissionsInGroup: string[], isChecked: boolean) => {
        setEditingRole(prev => {
            if (!prev) return null;
            const newPermissions = { ...prev.permissions };
            newPermissions[groupKey] = isChecked ? allPermissionsInGroup : [];
            return { ...prev, permissions: newPermissions };
        });
    };

    const handleUpdateRole = async () => {
        if (!editingRole || !editingRole.name.trim()) {
          toast({ title: 'Validation Error', description: 'Role Name cannot be empty.', variant: 'destructive' });
          return;
        }
        if (!user) return;

        setIsSaving(true);
        try {
            const roleRef = doc(db, 'roles', editingRole.id);
            const { id, ...dataToUpdate } = editingRole;
            await updateDoc(roleRef, dataToUpdate);

            await logUserActivity({
                userId: user.id,
                action: 'Update Role',
                details: { roleId: editingRole.id, roleName: editingRole.name }
            });
            toast({ title: 'Success', description: 'Role updated successfully.' });
            router.push('/settings/role-management');
        } catch (error) {
          console.error('Error updating role: ', error);
          toast({ title: 'Error', description: 'Failed to update role.', variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    };
    
    if (isLoading) {
        return (
            <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
                <div className="mb-6"><Skeleton className="h-10 w-64" /></div>
                <div className="space-y-4">
                    <Skeleton className="h-12 w-1/2" />
                    <Skeleton className="h-96 w-full" />
                </div>
            </div>
        );
    }

    if (!editingRole) {
        return <div className="p-8">Role not found.</div>;
    }

    return (
        <div className="w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Link href="/settings/role-management">
                        <Button variant="ghost" size="icon">
                            <ArrowLeft className="h-6 w-6" />
                        </Button>
                    </Link>
                    <h1 className="text-xl font-bold">Edit Role</h1>
                </div>
                <Button onClick={handleUpdateRole} disabled={isSaving}>
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Save Role
                </Button>
            </div>
            
            <div className="space-y-4">
                <div className="flex items-center gap-4">
                    <Label htmlFor="roleName" className="text-base min-w-[100px]">Role Name</Label>
                    <Input 
                        id="roleName" 
                        value={editingRole.name} 
                        onChange={(e) => setEditingRole({ ...editingRole, name: e.target.value })} 
                        className="max-w-sm"
                    />
                </div>
                <div>
                    <Label className="text-base">Permissions</Label>
                    <p className="text-sm text-muted-foreground">Select the actions this role can perform for each module.</p>
                    <ScrollArea className="mt-2 h-[calc(100vh-19rem)]">
                        <Accordion type="single" collapsible className="w-full pr-4">
                            {Object.entries(permissionModules).map(([moduleName, moduleValue]) => {
                                const hasViewModulePermission = (editingRole.permissions?.[moduleName] || []).includes('View Module');

                                return (
                                <AccordionItem value={moduleName} key={moduleName}>
                                    <AccordionTrigger>{moduleName}</AccordionTrigger>
                                    <AccordionContent>
                                        <Card>
                                            <CardContent className="p-3 space-y-3">
                                            {Array.isArray(moduleValue) ? (
                                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                                    {moduleValue.map(permission => (
                                                        <div key={permission} className="flex items-center space-x-2">
                                                            <Checkbox
                                                                id={`edit-${moduleName}-${permission}`}
                                                                checked={(editingRole.permissions?.[moduleName] || []).includes(permission)}
                                                                onCheckedChange={(checked) => handlePermissionChange(moduleName, permission, !!checked)}
                                                            />
                                                            <Label htmlFor={`edit-${moduleName}-${permission}`} className="text-sm font-normal leading-tight">{permission}</Label>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <>
                                                    {moduleValue['View Module'] !== undefined && (
                                                        <div className="p-3 border rounded-md">
                                                            <div className="flex justify-between items-center">
                                                                <h4 className="font-semibold text-sm">View Module</h4>
                                                                <div className="flex items-center space-x-2">
                                                                    <Checkbox
                                                                        id={`select-all-group-edit-${moduleName}-view`}
                                                                        checked={hasViewModulePermission}
                                                                        onClick={(e) => { e.stopPropagation(); handlePermissionChange(moduleName, 'View Module', e.currentTarget.dataset.state === 'unchecked')}}
                                                                    />
                                                                    <Label htmlFor={`select-all-group-edit-${moduleName}-view`} className="text-xs font-medium">Allow</Label>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}
                                                    <div className={!hasViewModulePermission ? 'opacity-50 pointer-events-none' : ''}>
                                                        {Object.entries(moduleValue).map(([subModuleKey, permissions]) => {
                                                            if (subModuleKey === 'View Module' || !Array.isArray(permissions)) return null;

                                                            const fullKey = `${moduleName}.${subModuleKey}`;
                                                            
                                                            if (subModuleKey === 'Departments') {
                                                                return (
                                                                    <div key={fullKey} className="p-3 border rounded-md mt-2">
                                                                        <h4 className="font-semibold text-sm mb-3">{subModuleKey}-specific Permissions</h4>
                                                                        {departments.map(dept => {
                                                                            const deptKey = `Expenses.Departments.${dept.id}`;
                                                                            const deptPermissions = permissions as string[];
                                                                            const grantedInDept = editingRole.permissions?.[deptKey] || [];
                                                                            const isAllInDeptSelected = deptPermissions.length > 0 && grantedInDept.length === deptPermissions.length;
                                                                            return (
                                                                                <div key={dept.id} className="p-2 border-t mt-2 first:mt-0 first:border-t-0">
                                                                                    <div className="flex justify-between items-center mb-2">
                                                                                        <p className="text-sm font-medium">{dept.name}</p>
                                                                                        <div className="flex items-center space-x-2">
                                                                                            <Checkbox
                                                                                                id={`select-all-dept-${dept.id}`}
                                                                                                checked={isAllInDeptSelected}
                                                                                                onClick={(e) => {e.stopPropagation(); handleSelectAllForGroup(deptKey, deptPermissions, e.currentTarget.dataset.state === 'unchecked')}}
                                                                                                disabled={!hasViewModulePermission}
                                                                                            />
                                                                                            <Label htmlFor={`select-all-dept-${dept.id}`} className="text-xs font-medium">All</Label>
                                                                                        </div>
                                                                                    </div>
                                                                                    <div className="grid grid-cols-3 gap-2">
                                                                                        {deptPermissions.map((permission: string) => (
                                                                                            <div key={permission} className="flex items-center space-x-2">
                                                                                                <Checkbox
                                                                                                    id={`edit-${deptKey}-${permission}`}
                                                                                                    checked={grantedInDept.includes(permission)}
                                                                                                    onCheckedChange={(checked) => handlePermissionChange(deptKey, permission, !!checked)}
                                                                                                    disabled={!hasViewModulePermission}
                                                                                                />
                                                                                                <Label htmlFor={`edit-${deptKey}-${permission}`} className="text-xs font-normal">{permission}</Label>
                                                                                            </div>
                                                                                        ))}
                                                                                    </div>
                                                                                </div>
                                                                            )
                                                                        })}
                                                                    </div>
                                                                )
                                                            }
                                                            
                                                            if (subModuleKey === 'Projects' && moduleName === 'Store & Stock Management') {
                                                                return (
                                                                  <div key={fullKey} className="p-3 border rounded-md mt-2">
                                                                    <h4 className="font-semibold text-sm mb-3">Project Access</h4>
                                                                    {projects.map(proj => {
                                                                      const projectKey = `Store & Stock Management.Projects.${proj.id}`;
                                                                      const projectPermissions = permissions as string[];
                                                                      const grantedInProject = editingRole.permissions?.[projectKey] || [];
                                                                      return (
                                                                        <div key={proj.id} className="p-2 border-t mt-2 first:mt-0 first:border-t-0">
                                                                          <div className="flex justify-between items-center">
                                                                            <p className="text-sm font-medium">{proj.projectName}</p>
                                                                            <div className="flex items-center space-x-2">
                                                                              <Checkbox
                                                                                id={`edit-${projectKey}-View`}
                                                                                checked={grantedInProject.includes('View')}
                                                                                onCheckedChange={(checked) => handlePermissionChange(projectKey, 'View', !!checked)}
                                                                                disabled={!hasViewModulePermission}
                                                                              />
                                                                              <Label htmlFor={`edit-${projectKey}-View`} className="text-xs font-normal">View</Label>
                                                                            </div>
                                                                          </div>
                                                                        </div>
                                                                      )
                                                                    })}
                                                                  </div>
                                                                )
                                                              }

                                                            const grantedInGroup = editingRole.permissions?.[fullKey] || [];
                                                            const isAllInGroupSelected = permissions.length > 0 && grantedInGroup.length === permissions.length;

                                                            return (
                                                                <div key={fullKey} className="p-3 border rounded-md mt-2">
                                                                    <div className="flex justify-between items-center mb-3">
                                                                    <h4 className="font-semibold text-sm">{subModuleKey}</h4>
                                                                    <div className="flex items-center space-x-2">
                                                                        <Checkbox
                                                                            id={`select-all-group-edit-${fullKey}`}
                                                                            checked={isAllInGroupSelected}
                                                                            onClick={(e) => { e.stopPropagation(); handleSelectAllForGroup(fullKey, permissions, e.currentTarget.dataset.state === 'unchecked')}}
                                                                            disabled={!hasViewModulePermission}
                                                                        />
                                                                        <Label htmlFor={`select-all-group-edit-${fullKey}`} className="text-xs font-medium">All</Label>
                                                                    </div>
                                                                    </div>
                                                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                                                        {permissions.map(permission => (
                                                                            <div key={permission} className="flex items-center space-x-2">
                                                                                <Checkbox
                                                                                    id={`edit-${fullKey}-${permission}`}
                                                                                    checked={grantedInGroup.includes(permission)}
                                                                                    onCheckedChange={(checked) => handlePermissionChange(fullKey, permission, !!checked)}
                                                                                    disabled={!hasViewModulePermission}
                                                                                />
                                                                                <Label htmlFor={`edit-${fullKey}-${permission}`} className="text-xs font-normal leading-tight">{permission}</Label>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            )
                                                        })}
                                                    </div>
                                                </>
                                            )}
                                            </CardContent>
                                        </Card>
                                    </AccordionContent>
                                </AccordionItem>
                                )
                            })}
                        </Accordion>
                    </ScrollArea>
                </div>
            </div>
        </div>
    );
}
