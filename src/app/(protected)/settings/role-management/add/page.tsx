

'use client';

import { useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save, Loader2, Search, ShieldAlert, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle as CardTitleShad, CardDescription as CardDescriptionShad } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs, query, where } from 'firebase/firestore';
import type { Department, Project } from '@/lib/types';
import { permissionModules } from '@/lib/types';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Badge } from '@/components/ui/badge';
import { AuroraBackdrop } from '@/components/effects/AuroraBackdrop';
import { cn } from '@/lib/utils';

const initializePermissions = (departments: Department[], projects: Project[]): Record<string, string[]> => {
    const permissions: Record<string, string[]> = {};
    Object.keys(permissionModules).forEach(moduleName => {
        const moduleValue = permissionModules[moduleName as keyof typeof permissionModules];
        if (Array.isArray(moduleValue)) {
            permissions[moduleName] = [];
        } else {
            if ('View Module' in moduleValue) {
                permissions[moduleName] = [];
            }
            Object.keys(moduleValue).forEach(subModuleKey => {
                if (subModuleKey === 'View Module') return;
                const fullKey = `${moduleName}.${subModuleKey}`;
                
                if (subModuleKey === 'Departments' && departments.length > 0) {
                    departments.forEach(dept => {
                        const deptKey = `Expenses.Departments.${dept.id}`;
                        permissions[deptKey] = [];
                    });
                } else if (subModuleKey === 'Projects' && moduleName === 'Store & Stock Management' && projects.length > 0) {
                    projects.forEach(proj => {
                        const projectKey = `Store & Stock Management.Projects.${proj.id}`;
                        permissions[projectKey] = [];
                    });
                } else {
                    permissions[fullKey] = [];

                    const subPermissions = moduleValue[subModuleKey as keyof typeof moduleValue];
                     if (typeof subPermissions === 'object' && !Array.isArray(subPermissions)) {
                        Object.keys(subPermissions).forEach(nestedKey => {
                            const nestedFullKey = `${fullKey}.${nestedKey}`;
                            permissions[nestedFullKey] = [];
                        });
                    }
                }
            });
        }
    });
    return permissions;
};

function moduleMatchesQuery(
  moduleName: string,
  moduleValue: any,
  q: string,
  departments: Department[],
  projects: Project[]
) {
  const query = q.trim().toLowerCase();
  if (!query) return true;
  if (moduleName.toLowerCase().includes(query)) return true;

  const walk = (key: string, value: any): boolean => {
    if (String(key).toLowerCase().includes(query)) return true;
    if (Array.isArray(value)) return value.some((p) => String(p).toLowerCase().includes(query));
    if (value && typeof value === 'object') return Object.entries(value).some(([k, v]) => walk(k, v));
    return false;
  };

  if (walk(moduleName, moduleValue)) return true;
  if (moduleName === 'Expenses' && departments.some((d) => d.name.toLowerCase().includes(query))) return true;
  if (
    moduleName === 'Store & Stock Management' &&
    projects.some((p) => (p.projectName || '').toLowerCase().includes(query))
  ) {
    return true;
  }
  return false;
}


export default function AddRolePage() {
    const { toast } = useToast();
    const router = useRouter();
    const { user } = useAuth();
    const { can, isLoading: isAuthLoading } = useAuthorization();

    const canAdd = can('Add', 'Settings.Role Management');

    const [newRole, setNewRole] = useState<{name: string, permissions: Record<string, string[]>}>({ name: '', permissions: {} });
    const [departments, setDepartments] = useState<Department[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    const [permissionQuery, setPermissionQuery] = useState('');
    const [openModules, setOpenModules] = useState<string[]>([]);

    useEffect(() => {
        const fetchDeptsAndProjects = async () => {
            setIsLoading(true);
            try {
                const deptsSnap = await getDocs(query(collection(db, 'departments'), where('status', '==', 'Active')));
                const deptsData = deptsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Department));
                setDepartments(deptsData);

                const projectsSnap = await getDocs(query(collection(db, 'projects'), where('stockManagementRequired', '==', true)));
                const projectsData = projectsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project));
                setProjects(projectsData);
                
                setNewRole({ name: '', permissions: initializePermissions(deptsData, projectsData) });

            } catch (error) {
                toast({ title: "Error", description: "Failed to load initial data for roles.", variant: "destructive" });
            }
            setIsLoading(false);
        };
        fetchDeptsAndProjects();
    }, [toast]);

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

    const filteredModules = useMemo(() => {
      return Object.entries(permissionModules).filter(([moduleName, moduleValue]) =>
        moduleMatchesQuery(moduleName, moduleValue, permissionQuery, departments, projects)
      );
    }, [permissionQuery, departments, projects]);

    useEffect(() => {
      const q = permissionQuery.trim();
      if (!q) return;
      setOpenModules(filteredModules.map(([m]) => m));
    }, [permissionQuery, filteredModules]);

    if (isAuthLoading || isLoading) {
      return (
        <div className="relative min-h-[calc(100vh-4rem)] overflow-hidden px-4 py-6 sm:px-6 lg:px-8">
          <AuroraBackdrop />
          <div className="mx-auto w-full max-w-6xl">
            <div className="mb-6 flex items-center justify-between">
              <Skeleton className="h-10 w-56" />
              <Skeleton className="h-10 w-32" />
            </div>
            <Card className="overflow-hidden rounded-2xl border border-white/70 bg-white/70 shadow-[0_20px_70px_-55px_rgba(2,6,23,0.55)] backdrop-blur">
              <CardContent className="p-0">
                <Skeleton className="h-[520px] w-full" />
              </CardContent>
            </Card>
          </div>
        </div>
      );
    }

    if (!canAdd) {
      return (
        <div className="relative min-h-[calc(100vh-4rem)] overflow-hidden px-4 py-6 sm:px-6 lg:px-8">
          <AuroraBackdrop />
          <div className="mx-auto w-full max-w-4xl">
            <div className="mb-6 flex items-center gap-4">
              <Link href="/settings/role-management">
                <Button variant="ghost" size="icon" className="rounded-full bg-white/70 shadow-sm backdrop-blur hover:bg-white/90">
                  <ArrowLeft className="h-6 w-6" />
                </Button>
              </Link>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">Add New Role</h1>
            </div>
            <Card className="overflow-hidden rounded-2xl border border-white/70 bg-white/70 shadow-[0_20px_70px_-55px_rgba(2,6,23,0.55)] backdrop-blur">
              <CardHeader>
                <CardTitleShad>Access Denied</CardTitleShad>
                <CardDescriptionShad>
                  You do not have permission to add roles. Please contact an administrator.
                </CardDescriptionShad>
              </CardHeader>
              <CardContent className="flex justify-center p-8">
                <ShieldAlert className="h-16 w-16 text-destructive" />
              </CardContent>
            </Card>
          </div>
        </div>
      );
    }

    return (
        <div className="relative min-h-[calc(100vh-4rem)] overflow-hidden px-4 py-6 sm:px-6 lg:px-8">
          <AuroraBackdrop />
          <div className="mx-auto w-full max-w-6xl">
            <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="flex items-start gap-4">
                <Link href="/settings/role-management">
                  <Button variant="ghost" size="icon" className="rounded-full bg-white/70 shadow-sm backdrop-blur hover:bg-white/90">
                    <ArrowLeft className="h-6 w-6" />
                  </Button>
                </Link>
                <div>
                  <div className="flex items-center gap-2">
                    <h1 className="text-2xl font-bold tracking-tight text-slate-900">Add New Role</h1>
                    <Badge variant="outline" className="border-white/70 bg-white/70 text-slate-700 backdrop-blur">
                      Role Management
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    Build a reusable permission set for modules, reports, and settings.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Badge className="hidden sm:inline-flex bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white shadow-sm">
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  Refined UI
                </Badge>
                <Button onClick={handleAddRole} disabled={isSaving} className="shadow-[0_18px_60px_-45px_rgba(2,6,23,0.55)]">
                  {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Save Role
                </Button>
              </div>
            </div>

            <Card className="mb-4 overflow-hidden rounded-2xl border border-white/70 bg-white/70 shadow-[0_20px_70px_-55px_rgba(2,6,23,0.55)] backdrop-blur">
              <CardContent className="p-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3 md:items-end">
                  <div className="md:col-span-1">
                    <Label htmlFor="roleName" className="text-sm font-semibold text-slate-700">Role Name</Label>
                    <Input
                      id="roleName"
                      value={newRole.name}
                      onChange={(e) => setNewRole({ ...newRole, name: e.target.value })}
                      placeholder="e.g. Finance Approver"
                      className="mt-2 bg-white/80 border-white/70"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <Label className="text-sm font-semibold text-slate-700">Search Permissions</Label>
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="relative w-full sm:max-w-md">
                        <Search className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
                        <Input
                          value={permissionQuery}
                          onChange={(e) => setPermissionQuery(e.target.value)}
                          placeholder="Search modules, actions, departments..."
                          className="pl-9 bg-white/80 border-white/70"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="bg-white/70 border-white/70"
                          onClick={() => setOpenModules(filteredModules.map(([m]) => m))}
                          disabled={filteredModules.length === 0}
                        >
                          Expand All
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="bg-white/70 border-white/70"
                          onClick={() => setOpenModules([])}
                          disabled={openModules.length === 0}
                        >
                          Collapse
                        </Button>
                        <Badge variant="outline" className="border-white/70 bg-white/70 text-slate-700 backdrop-blur">
                          {filteredModules.length} modules
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="overflow-hidden rounded-2xl border border-white/70 bg-white/70 shadow-[0_20px_70px_-55px_rgba(2,6,23,0.55)] backdrop-blur">
              <CardHeader className="pb-3">
                <CardTitleShad>Permissions</CardTitleShad>
                <CardDescriptionShad>
                  Select the actions this role can perform for each module.
                </CardDescriptionShad>
              </CardHeader>
              <CardContent className="pt-0">
                <ScrollArea className="h-[calc(100vh-26rem)]">
                  <Accordion
                    type="multiple"
                    value={openModules}
                    onValueChange={(v) => setOpenModules(v as string[])}
                    className="w-full pr-4"
                  >
                            {filteredModules.map(([moduleName, moduleValue]) => {
                                const isViewModuleOnly = typeof moduleValue === 'object' && !Array.isArray(moduleValue) && Object.keys(moduleValue).length === 1 && 'View Module' in moduleValue;
                                const isViewModulePermission = (newRole.permissions?.[moduleName] || []).includes('View Module') || (moduleValue as any)['View Module'] === true;

                                return (
                                  <AccordionItem value={moduleName} key={moduleName}>
                                    <AccordionTrigger className="text-left">
                                      <div className="flex w-full items-center justify-between gap-3 pr-2">
                                        <span className="font-semibold text-slate-900">{moduleName}</span>
                                        {isViewModuleOnly && (
                                          <Badge variant="outline" className="border-slate-200/80 bg-white/70 text-slate-700">
                                            View only
                                          </Badge>
                                        )}
                                      </div>
                                    </AccordionTrigger>
                                    <AccordionContent>
                                        <Card className="overflow-hidden rounded-xl border border-white/70 bg-white/70 backdrop-blur">
                                            <CardContent className="p-4 space-y-3">
                                            {Array.isArray(moduleValue) ? (
                                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
                                            <>
                                                { 'View Module' in moduleValue && (
                                                    <div className="p-3 border rounded-md">
                                                        <div className="flex justify-between items-center">
                                                            <h4 className="font-semibold text-sm">View Module</h4>
                                                            <div className="flex items-center space-x-2">
                                                                <Checkbox
                                                                    id={`select-all-group-new-${moduleName}-view`}
                                                                    checked={isViewModulePermission}
                                                                    onCheckedChange={(checked) => handlePermissionChange(moduleName, 'View Module', !!checked)}
                                                                />
                                                                <Label htmlFor={`select-all-group-new-${moduleName}-view`} className="text-xs font-medium">Allow</Label>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                                <div className={cn(!isViewModulePermission && 'opacity-50 pointer-events-none')}>
                                                    {Object.entries(moduleValue).map(([subModuleKey, permissions]) => {
                                                        if (subModuleKey === 'View Module') return null;

                                                        const fullKey = `${moduleName}.${subModuleKey}`;
                                                        
                                                        if (subModuleKey === 'Departments' && departments.length > 0) {
                                                            return (
                                                                <div key={fullKey} className="p-3 border rounded-md mt-2">
                                                                    <h4 className="font-semibold text-sm mb-3">{subModuleKey}-specific Permissions</h4>
                                                                    {departments.map(dept => {
                                                                        const deptKey = `Expenses.Departments.${dept.id}`;
                                                                        const deptPermissions = permissions as string[];
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
                                                                                            onCheckedChange={(checked) => handleSelectAllForGroup(deptKey, deptPermissions, !!checked)}
                                                                                            disabled={!isViewModulePermission}
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
                                                                                                disabled={!isViewModulePermission}
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
                                                        if (subModuleKey === 'Projects' && moduleName === 'Store & Stock Management') {
                                                            const projectPermissions = permissions as string[];
                                                            return (
                                                              <div key={fullKey} className="p-3 border rounded-md mt-2">
                                                                <h4 className="font-semibold text-sm mb-3">Project-specific Permissions</h4>
                                                                {projects.map(proj => {
                                                                  const projectKey = `Store & Stock Management.Projects.${proj.id}`;
                                                                  const grantedInProject = newRole.permissions?.[projectKey] || [];
                                                                  const isAllInProjectSelected = projectPermissions.length > 0 && grantedInProject.length === projectPermissions.length;
                                                                  return (
                                                                    <div key={proj.id} className="p-2 border-t mt-2 first:mt-0 first:border-t-0">
                                                                      <div className="flex justify-between items-center mb-2">
                                                                        <p className="text-sm font-medium">{proj.projectName}</p>
                                                                        <div className="flex items-center space-x-2">
                                                                          <Checkbox
                                                                            id={`select-all-project-${proj.id}`}
                                                                            checked={isAllInProjectSelected}
                                                                            onCheckedChange={(checked) => handleSelectAllForGroup(projectKey, projectPermissions, !!checked)}
                                                                            disabled={!isViewModulePermission}
                                                                          />
                                                                          <Label htmlFor={`select-all-project-${proj.id}`} className="text-xs font-medium">All</Label>
                                                                        </div>
                                                                      </div>
                                                                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                                                        {projectPermissions.map(permission => (
                                                                          <div key={permission} className="flex items-center space-x-2">
                                                                            <Checkbox
                                                                              id={`new-${projectKey}-${permission}`}
                                                                              checked={grantedInProject.includes(permission)}
                                                                              onCheckedChange={(checked) => handlePermissionChange(projectKey, permission, !!checked)}
                                                                              disabled={!isViewModulePermission}
                                                                            />
                                                                            <Label htmlFor={`new-${projectKey}-${permission}`} className="text-xs font-normal">{permission}</Label>
                                                                          </div>
                                                                        ))}
                                                                      </div>
                                                                    </div>
                                                                  );
                                                                })}
                                                              </div>
                                                            );
                                                          }

                                                          if (Array.isArray(permissions) && permissions.length > 0) {
                                                                const resourcePermissions = permissions;
                                                                const grantedInGroup = newRole.permissions?.[fullKey] || [];
                                                                const isAllInGroupSelected = Array.isArray(permissions) && permissions.length > 0 && grantedInGroup.length === permissions.length;

                                                                return (
                                                                    <div key={fullKey} className="p-3 border rounded-md mt-2">
                                                                        <div className="flex justify-between items-center mb-3">
                                                                        <h4 className="font-semibold text-sm">{subModuleKey}</h4>
                                                                        <div className="flex items-center space-x-2">
                                                                            <Checkbox
                                                                                id={`select-all-group-new-${fullKey}`}
                                                                                checked={isAllInGroupSelected}
                                                                                onCheckedChange={(checked) => handleSelectAllForGroup(fullKey, permissions as string[], !!checked)}
                                                                                disabled={!isViewModulePermission || !Array.isArray(permissions)}
                                                                            />
                                                                            <Label htmlFor={`select-all-group-new-${fullKey}`} className="text-xs font-medium">All</Label>
                                                                        </div>
                                                                        </div>
                                                                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                                                            {Array.isArray(permissions) && permissions.map(permission => (
                                                                                <div key={permission} className="flex items-center space-x-2">
                                                                                    <Checkbox
                                                                                        id={`new-${fullKey}-${permission}`}
                                                                                        checked={grantedInGroup.includes(permission)}
                                                                                        onCheckedChange={(checked) => handlePermissionChange(fullKey, permission, !!checked)}
                                                                                        disabled={!isViewModulePermission}
                                                                                    />
                                                                                    <Label htmlFor={`new-${fullKey}-${permission}`} className="text-xs font-normal leading-tight">{permission}</Label>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                )
                                                            }
                                                            
                                                            // Handle nested objects of permissions (like Reports)
                                                            if (typeof permissions === 'object' && !Array.isArray(permissions)) {
                                                              return (
                                                                  <div key={fullKey} className="p-3 border rounded-md mt-2">
                                                                      <h4 className="font-semibold text-sm mb-2">{subModuleKey}</h4>
                                                                      {Object.entries(permissions).map(([nestedKey, nestedPerms]) => {
                                                                          if (!Array.isArray(nestedPerms)) return null;
                                                                          const nestedFullKey = `${fullKey}.${nestedKey}`;
                                                                          const grantedInNestedGroup = newRole.permissions?.[nestedFullKey] || [];
                                                                          const isAllInNestedSelected = nestedPerms.length > 0 && grantedInNestedGroup.length === nestedPerms.length;
                                                                          
                                                                          // Special case for 'View' with an empty array
                                                                          if (nestedPerms.length === 0) {
                                                                            return (
                                                                              <div key={nestedFullKey} className="p-2 border-t mt-2 first:mt-0 first:border-t-0">
                                                                                <div className="flex items-center space-x-2">
                                                                                  <Checkbox
                                                                                    id={`new-${nestedFullKey}-View`}
                                                                                    checked={grantedInNestedGroup.includes('View')}
                                                                                    onCheckedChange={(checked) => handlePermissionChange(nestedFullKey, 'View', !!checked)}
                                                                                    disabled={!isViewModulePermission}
                                                                                  />
                                                                                  <Label htmlFor={`new-${nestedFullKey}-View`} className="text-sm font-normal">{nestedKey}</Label>
                                                                                </div>
                                                                              </div>
                                                                            );
                                                                          }
                                                                          
                                                                          return (
                                                                              <div key={nestedFullKey} className="p-2 border-t mt-2 first:mt-0 first:border-t-0">
                                                                                  <div className="flex justify-between items-center mb-2">
                                                                                      <p className="text-sm font-medium">{nestedKey}</p>
                                                                                      {nestedPerms.length > 1 && (
                                                                                          <div className="flex items-center space-x-2">
                                                                                              <Checkbox
                                                                                                  id={`select-all-nested-${nestedFullKey}`}
                                                                                                  checked={isAllInNestedSelected}
                                                                                                  onCheckedChange={(checked) => handleSelectAllForGroup(nestedFullKey, nestedPerms, !!checked)}
                                                                                                  disabled={!isViewModulePermission}
                                                                                              />
                                                                                              <Label htmlFor={`select-all-nested-${nestedFullKey}`} className="text-xs font-medium">All</Label>
                                                                                          </div>
                                                                                      )}
                                                                                  </div>
                                                                                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                                                                      {nestedPerms.map(p => (
                                                                                          <div key={p} className="flex items-center space-x-2">
                                                                                              <Checkbox
                                                                                                  id={`new-${nestedFullKey}-${p}`}
                                                                                                  checked={grantedInNestedGroup.includes(p)}
                                                                                                  onCheckedChange={(checked) => handlePermissionChange(nestedFullKey, p, !!checked)}
                                                                                                  disabled={!isViewModulePermission}
                                                                                              />
                                                                                              <Label htmlFor={`new-${nestedFullKey}-${p}`} className="text-xs font-normal">{p}</Label>
                                                                                          </div>
                                                                                      ))}
                                                                                  </div>
                                                                              </div>
                                                                          )
                                                                      })}
                                                                  </div>
                                                              )
                                                            }
                                                        })}
                                                    </div>
                                                </>
                                            )}
                                            </CardContent>
                                        </Card>
                                    </AccordionContent>
                                  </AccordionItem>
                                );
                            })}
                  </Accordion>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </div>
    );
}
