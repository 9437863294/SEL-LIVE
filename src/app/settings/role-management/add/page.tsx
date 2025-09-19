
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save, Loader2, Plus, Edit, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription as CardDescriptionShad } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs, query, where } from 'firebase/firestore';
import type { Role, Department } from '@/lib/types';
import { permissionModules } from '@/lib/types';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';
import { ScrollArea } from '@/components/ui/scroll-area';

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

export default function AddRolePage() {
    const { toast } = useToast();
    const router = useRouter();
    const { user } = useAuth();

    const [newRole, setNewRole] = useState<{name: string, permissions: Record<string, string[]>}>(JSON.parse(JSON.stringify(initialNewRoleState)));
    const [departments, setDepartments] = useState<Department[]>([]);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        const fetchDepartments = async () => {
            const deptsSnap = await getDocs(query(collection(db, 'departments'), where('status', '==', 'Active')));
            const deptsData: Department[] = deptsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Department));
            setDepartments(deptsData);
        };
        fetchDepartments();
    }, []);

    const handlePermissionChange = (moduleKey: string, permission: string, isChecked: boolean) => {
        setNewRole((prevState) => {
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
      
    const handleSelectAllForGroup = (groupKey: string, allPermissionsInGroup: string[], isChecked: boolean) => {
        setNewRole((prevState) => {
            const newPermissions = { ...prevState.permissions };
            newPermissions[groupKey] = isChecked ? allPermissionsInGroup : [];
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
        if (!user) return;

        setIsSaving(true);
        try {
          await addDoc(collection(db, 'roles'), newRole);
          await logUserActivity({
            userId: user.id,
            action: 'Create Role',
            details: { roleName: newRole.name }
          });
          toast({
            title: 'Success',
            description: `Role "${newRole.name}" created successfully.`,
          });
          router.push('/settings/role-management');
        } catch (error) {
          console.error("Error adding role: ", error);
          toast({
            title: 'Error',
            description: 'Failed to add role.',
            variant: 'destructive',
          });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-4">
                <Link href="/settings/role-management">
                    <Button variant="ghost" size="icon">
                    <ArrowLeft className="h-6 w-6" />
                    </Button>
                </Link>
                <h1 className="text-2xl font-bold">Add New Role</h1>
                </div>
                <Button onClick={handleAddRole} disabled={isSaving}>
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Save Role
                </Button>
            </div>

            <div className="space-y-4">
                <div className="flex items-center gap-4">
                    <Label htmlFor="roleName" className="text-base min-w-[100px]">Role Name</Label>
                    <Input 
                    id="roleName" 
                    value={newRole.name} 
                    onChange={(e) => setNewRole({ ...newRole, name: e.target.value })} 
                    className="mt-1"
                    />
                </div>
                <div>
                    <Label className="text-base">Permissions</Label>
                    <p className="text-sm text-muted-foreground">Select the actions this role can perform for each module.</p>
                    <ScrollArea className="mt-2 h-[calc(100vh-22rem)]">
                    <div className="space-y-4 pr-4">
                        {Object.entries(permissionModules).map(([moduleName, moduleValue]) => (
                            <Card key={moduleName}>
                                <CardHeader className="p-4 bg-muted/50">
                                    <CardTitleShad className="text-base">{moduleName}</CardTitleShad>
                                </CardHeader>
                                <CardContent className="p-4 space-y-4">
                                {Array.isArray(moduleValue) ? (
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                        {moduleValue.map(permission => (
                                            <div key={permission} className="flex items-center space-x-2">
                                                <Checkbox
                                                    id={`new-${moduleName}-${permission}`}
                                                    checked={(newRole.permissions?.[moduleName] || []).includes(permission)}
                                                    onCheckedChange={(checked) => handlePermissionChange(moduleName, permission, !!checked)}
                                                />
                                                <Label htmlFor={`new-${moduleName}-${permission}`} className="text-sm font-normal leading-tight">{permission}</Label>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    Object.entries(moduleValue).map(([subModuleKey, permissions]) => {
                                        if (subModuleKey === 'View Module') {
                                            return (
                                              <div key={subModuleKey} className="flex items-center space-x-2 border-b pb-4">
                                                <Checkbox
                                                    id={`new-${moduleName}-view`}
                                                    checked={(newRole.permissions?.[moduleName] || []).includes('View')}
                                                    onCheckedChange={(checked) => handlePermissionChange(moduleName, 'View', !!checked)}
                                                />
                                                <Label htmlFor={`new-${moduleName}-view`} className="text-sm font-semibold">{subModuleKey}</Label>
                                              </div>
                                            )
                                        }

                                        const fullKey = `${moduleName}.${subModuleKey}`;
                                        
                                        if (subModuleKey === 'Departments') {
                                            return (
                                                <div key={fullKey} className="p-3 border rounded-md">
                                                    <h4 className="font-semibold text-sm mb-3">{subModuleKey}-specific Permissions</h4>
                                                    {departments.map(dept => {
                                                        const deptKey = `Expenses.Departments.${dept.id}`;
                                                        const deptPermissions = permissions;
                                                        const grantedInDept = newRole.permissions?.[deptKey] || [];
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
                                                                        />
                                                                        <Label htmlFor={`select-all-dept-${dept.id}`} className="text-xs font-medium">All</Label>
                                                                    </div>
                                                                </div>
                                                                <div className="grid grid-cols-3 gap-2">
                                                                    {deptPermissions.map((permission: string) => (
                                                                        <div key={permission} className="flex items-center space-x-2">
                                                                            <Checkbox
                                                                                id={`new-${deptKey}-${permission}`}
                                                                                checked={grantedInDept.includes(permission)}
                                                                                onCheckedChange={(checked) => handlePermissionChange(deptKey, permission, !!checked)}
                                                                            />
                                                                            <Label htmlFor={`new-${deptKey}-${permission}`} className="text-xs font-normal">{permission}</Label>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            )
                                        }

                                        const grantedInGroup = newRole.permissions?.[fullKey] || [];
                                        const isAllInGroupSelected = permissions.length > 0 && grantedInGroup.length === permissions.length;

                                        return (
                                            <div key={fullKey} className="p-3 border rounded-md">
                                                <div className="flex justify-between items-center mb-3">
                                                <h4 className="font-semibold text-sm">{subModuleKey}</h4>
                                                <div className="flex items-center space-x-2">
                                                    <Checkbox
                                                        id={`select-all-group-${fullKey}`}
                                                        checked={isAllInGroupSelected}
                                                        onClick={(e) => {e.stopPropagation(); handleSelectAllForGroup(fullKey, permissions, e.currentTarget.dataset.state === 'unchecked')}}
                                                    />
                                                    <Label htmlFor={`select-all-group-${fullKey}`} className="text-xs font-medium">All</Label>
                                                </div>
                                                </div>
                                                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                                    {permissions.map(permission => (
                                                        <div key={permission} className="flex items-center space-x-2">
                                                            <Checkbox
                                                                id={`new-${fullKey}-${permission}`}
                                                                checked={grantedInGroup.includes(permission)}
                                                                onCheckedChange={(checked) => handlePermissionChange(fullKey, permission, !!checked)}
                                                            />
                                                            <Label htmlFor={`new-${fullKey}-${permission}`} className="text-xs font-normal leading-tight">{permission}</Label>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )
                                    })
                                )}
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                    </ScrollArea>
                </div>
            </div>
        </div>
    );
}
