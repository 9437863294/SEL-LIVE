

'use client';

import { useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Save, Loader2, Search, ShieldAlert } from 'lucide-react';
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


export default function EditRolePage() {
    const { toast } = useToast();
    const router = useRouter();
    const { roleId } = useParams() as { roleId: string };
    const { user } = useAuth();
    const { can, isLoading: isAuthLoading } = useAuthorization();

    const canEdit = can('Edit', 'Settings.Role Management');

    const [editingRole, setEditingRole] = useState<Role | null>(null);
    const [departments, setDepartments] = useState<Department[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    const [permissionQuery, setPermissionQuery] = useState('');
    const [openModules, setOpenModules] = useState<string[]>([]);

    useEffect(() => {
        if (!roleId) return;

        const fetchRoleAndDepartments = async () => {
            setIsLoading(true);
            try {
                const deptsSnap = await getDocs(query(collection(db, 'departments'), where('status', '==', 'Active')));
                const deptsData = deptsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Department));
                setDepartments(deptsData);

                const projectsSnap = await getDocs(query(collection(db, 'projects'), where('stockManagementRequired', '==', true)));
                const projectsData = projectsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project));
                setProjects(projectsData);
                
                const roleDocRef = doc(db, 'roles', roleId);
                const roleDocSnap = await getDoc(roleDocRef);

                if (roleDocSnap.exists()) {
                    const roleData = { id: roleDocSnap.id, ...roleDocSnap.data() } as Role;
                    const completePermissions = initializePermissions(deptsData, projectsData);

                    // Merge saved permissions into the complete structure
                    for (const key in roleData.permissions) {
                        if (completePermissions.hasOwnProperty(key)) {
                            completePermissions[key] = roleData.permissions[key];
                        }
                    }

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
        <div className="relative overflow-hidden px-6 py-6 sm:px-8 lg:px-10">
          <AuroraBackdrop />
          <div className="mx-auto w-full max-w-5xl">
            <div className="mb-6 flex items-center justify-between">
              <Skeleton className="h-10 w-56" /><Skeleton className="h-10 w-32" />
            </div>
            <Skeleton className="h-28 w-full rounded-2xl mb-4" />
            <Skeleton className="h-[520px] w-full rounded-2xl" />
          </div>
        </div>
      );
    }

    if (!canEdit) {
      return (
        <div className="relative overflow-hidden px-6 py-6 sm:px-8 lg:px-10">
          <AuroraBackdrop />
          <div className="mx-auto w-full max-w-5xl">
            <div className="mb-6 flex items-center gap-3">
              <Link href="/settings/role-management">
                <Button variant="ghost" size="icon" className="rounded-full bg-white/70 shadow-sm backdrop-blur hover:bg-white/90"><ArrowLeft className="h-5 w-5" /></Button>
              </Link>
              <h1 className="text-xl font-bold tracking-tight text-slate-900">Edit Role</h1>
            </div>
            <Card className="overflow-hidden rounded-2xl border border-white/70 bg-white/80 shadow-[0_8px_30px_-10px_rgba(2,6,23,0.25)] backdrop-blur">
              <CardHeader><CardTitleShad>Access Denied</CardTitleShad><CardDescriptionShad>You do not have permission to edit roles.</CardDescriptionShad></CardHeader>
              <CardContent className="flex justify-center p-8"><ShieldAlert className="h-14 w-14 text-destructive" /></CardContent>
            </Card>
          </div>
        </div>
      );
    }

    if (!editingRole) {
      return (
        <div className="relative overflow-hidden px-6 py-6 sm:px-8 lg:px-10">
          <AuroraBackdrop />
          <div className="mx-auto w-full max-w-5xl">
            <div className="mb-6 flex items-center gap-3">
              <Link href="/settings/role-management">
                <Button variant="ghost" size="icon" className="rounded-full bg-white/70 shadow-sm backdrop-blur hover:bg-white/90"><ArrowLeft className="h-5 w-5" /></Button>
              </Link>
              <h1 className="text-xl font-bold tracking-tight text-slate-900">Edit Role</h1>
            </div>
            <Card className="overflow-hidden rounded-2xl border border-white/70 bg-white/80 shadow-[0_8px_30px_-10px_rgba(2,6,23,0.25)] backdrop-blur">
              <CardHeader><CardTitleShad>Role Not Found</CardTitleShad><CardDescriptionShad>The requested role does not exist or you no longer have access.</CardDescriptionShad></CardHeader>
            </Card>
          </div>
        </div>
      );
    }

    return (
        <div className="relative overflow-hidden px-6 py-6 sm:px-8 lg:px-10">
          <AuroraBackdrop />
          <div className="mx-auto w-full max-w-5xl">
            {/* ── Header ── */}
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <Link href="/settings/role-management">
                  <Button variant="ghost" size="icon" className="rounded-full bg-white/70 shadow-sm backdrop-blur hover:bg-white/90">
                    <ArrowLeft className="h-5 w-5" />
                  </Button>
                </Link>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="text-xl font-bold tracking-tight text-slate-900">Edit Role</h1>
                    <Badge variant="outline" className="border-slate-200 bg-white/80 text-slate-600 text-xs">
                      {editingRole.name || 'Role'}
                    </Badge>
                  </div>
                  <p className="text-sm text-slate-500 mt-0.5">Update the role name and fine-tune module permissions.</p>
                </div>
              </div>
              <Button onClick={handleUpdateRole} disabled={isSaving} className="rounded-full shadow-md shrink-0">
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save Changes
              </Button>
            </div>

            {/* ── Role Name + Search ── */}
            <Card className="mb-5 overflow-hidden rounded-2xl border border-white/70 bg-white/80 shadow-[0_8px_30px_-10px_rgba(2,6,23,0.25)] backdrop-blur">
              <CardContent className="p-5">
                <div className="grid grid-cols-1 gap-5 md:grid-cols-3 md:items-end">
                  <div>
                    <Label htmlFor="roleName" className="text-sm font-semibold text-slate-700 mb-2 block">Role Name</Label>
                    <Input id="roleName" value={editingRole.name} onChange={(e) => setEditingRole({ ...editingRole, name: e.target.value })}
                      className="bg-white/80 border-slate-200" />
                  </div>
                  <div className="md:col-span-2">
                    <Label className="text-sm font-semibold text-slate-700 mb-2 block">Search Permissions</Label>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <Input value={permissionQuery} onChange={(e) => setPermissionQuery(e.target.value)}
                          placeholder="Search modules, actions, departments..." className="pl-9 bg-white/80 border-slate-200" />
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button type="button" variant="outline" size="sm" className="bg-white/70 border-slate-200 rounded-full"
                          onClick={() => setOpenModules(filteredModules.map(([m]) => m))} disabled={filteredModules.length === 0}>
                          Expand All
                        </Button>
                        <Button type="button" variant="outline" size="sm" className="bg-white/70 border-slate-200 rounded-full"
                          onClick={() => setOpenModules([])} disabled={openModules.length === 0}>
                          Collapse
                        </Button>
                        <span className="text-xs text-slate-500 whitespace-nowrap">{filteredModules.length} modules</span>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* ── Permissions ── */}
            <Card className="overflow-hidden rounded-2xl border border-white/70 bg-white/80 shadow-[0_8px_30px_-10px_rgba(2,6,23,0.25)] backdrop-blur">
              <CardHeader className="border-b border-slate-100 pb-4">
                <CardTitleShad className="text-base">Module Permissions</CardTitleShad>
                <CardDescriptionShad>Select the actions this role can perform for each module.</CardDescriptionShad>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[calc(100vh-22rem)]">
                  <div className="p-5">
                  <Accordion type="multiple" value={openModules} onValueChange={(v) => setOpenModules(v as string[])} className="w-full space-y-2">
                    {filteredModules.map(([moduleName, moduleValue]) => {
                      const isViewModuleOnly = typeof moduleValue === 'object' && !Array.isArray(moduleValue) && Object.keys(moduleValue).length === 1 && 'View Module' in moduleValue;
                      const isViewModulePermission = (editingRole.permissions?.[moduleName] || []).includes('View Module') || (moduleValue as any)['View Module'] === true;
                      return (
                        <AccordionItem value={moduleName} key={moduleName}
                          className="rounded-xl border border-slate-200/80 bg-white/60 px-1 overflow-hidden">
                          <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-slate-50/80 rounded-xl">
                            <div className="flex w-full items-center justify-between gap-3 pr-2">
                              <span className="font-semibold text-slate-800 text-sm">{moduleName}</span>
                              {isViewModuleOnly && <Badge variant="outline" className="border-slate-200 bg-white/80 text-slate-500 text-xs">View only</Badge>}
                            </div>
                          </AccordionTrigger>
                          <AccordionContent>
                            <div className="px-4 pb-4 pt-2 space-y-3">
                            {Array.isArray(moduleValue) ? (
                              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                                {moduleValue.map(permission => (
                                  <label key={permission} className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-slate-50 cursor-pointer">
                                    <Checkbox id={`edit-${moduleName}-${permission}`}
                                      checked={(editingRole.permissions?.[moduleName] || []).includes(permission)}
                                      onCheckedChange={(checked) => handlePermissionChange(moduleName, permission, !!checked)} />
                                    <span className="text-sm text-slate-700 leading-tight">{permission}</span>
                                  </label>
                                ))}
                              </div>
                            ) : (
                              <>
                                {'View Module' in moduleValue && (
                                  <div className="flex items-center justify-between p-3.5 rounded-xl bg-primary/5 border border-primary/20">
                                    <div>
                                      <p className="text-sm font-semibold text-slate-800">View Module</p>
                                      <p className="text-xs text-slate-500 mt-0.5">Must be enabled to allow sub-permissions</p>
                                    </div>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                      <Checkbox id={`select-all-group-edit-${moduleName}-view`} checked={isViewModulePermission}
                                        onCheckedChange={(checked) => handlePermissionChange(moduleName, 'View Module', !!checked)} />
                                      <span className="text-xs font-medium text-slate-700">Allow</span>
                                    </label>
                                  </div>
                                )}
                                <div className={cn('space-y-3', !isViewModulePermission && 'opacity-40 pointer-events-none')}>
                                  {Object.entries(moduleValue).map(([subModuleKey, permissions]) => {
                                    if (subModuleKey === 'View Module') return null;
                                    const fullKey = `${moduleName}.${subModuleKey}`;

                                    if (subModuleKey === 'Departments' && departments.length > 0) {
                                      return (
                                        <div key={fullKey} className="rounded-xl border border-slate-200 bg-slate-50/50 overflow-hidden">
                                          <div className="px-4 py-2.5 bg-slate-100/80 border-b border-slate-200">
                                            <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Department Permissions</h4>
                                          </div>
                                          <div className="p-3 space-y-3">
                                            {departments.map(dept => {
                                              const deptKey = `Expenses.Departments.${dept.id}`;
                                              const deptPermissions = permissions as string[];
                                              const grantedInDept = editingRole.permissions?.[deptKey] || [];
                                              const isAllInDeptSelected = deptPermissions.length > 0 && grantedInDept.length === deptPermissions.length;
                                              return (
                                                <div key={dept.id} className="p-3 rounded-lg bg-white border border-slate-200">
                                                  <div className="flex justify-between items-center mb-2.5">
                                                    <p className="text-sm font-medium text-slate-700">{dept.name}</p>
                                                    <label className="flex items-center gap-1.5 cursor-pointer">
                                                      <Checkbox id={`select-all-dept-edit-${dept.id}`} checked={isAllInDeptSelected}
                                                        onCheckedChange={(checked) => handleSelectAllForGroup(deptKey, deptPermissions, !!checked)} disabled={!isViewModulePermission} />
                                                      <span className="text-xs text-slate-500">All</span>
                                                    </label>
                                                  </div>
                                                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                                    {deptPermissions.map((permission: string) => (
                                                      <label key={permission} className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-50 cursor-pointer">
                                                        <Checkbox id={`edit-${deptKey}-${permission}`} checked={grantedInDept.includes(permission)}
                                                          onCheckedChange={(checked) => handlePermissionChange(deptKey, permission, !!checked)} disabled={!isViewModulePermission} />
                                                        <span className="text-xs text-slate-600">{permission}</span>
                                                      </label>
                                                    ))}
                                                  </div>
                                                </div>
                                              );
                                            })}
                                          </div>
                                        </div>
                                      );
                                    }

                                    if (subModuleKey === 'Projects' && moduleName === 'Store & Stock Management') {
                                      const projectPermissions = permissions as string[];
                                      return (
                                        <div key={fullKey} className="rounded-xl border border-slate-200 bg-slate-50/50 overflow-hidden">
                                          <div className="px-4 py-2.5 bg-slate-100/80 border-b border-slate-200">
                                            <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Project Permissions</h4>
                                          </div>
                                          <div className="p-3 space-y-3">
                                            {projects.map(proj => {
                                              const projectKey = `Store & Stock Management.Projects.${proj.id}`;
                                              const grantedInProject = editingRole.permissions?.[projectKey] || [];
                                              const isAllInProjectSelected = projectPermissions.length > 0 && grantedInProject.length === projectPermissions.length;
                                              return (
                                                <div key={proj.id} className="p-3 rounded-lg bg-white border border-slate-200">
                                                  <div className="flex justify-between items-center mb-2.5">
                                                    <p className="text-sm font-medium text-slate-700">{proj.projectName}</p>
                                                    <label className="flex items-center gap-1.5 cursor-pointer">
                                                      <Checkbox id={`select-all-project-edit-${proj.id}`} checked={isAllInProjectSelected}
                                                        onCheckedChange={(checked) => handleSelectAllForGroup(projectKey, projectPermissions, !!checked)} disabled={!isViewModulePermission} />
                                                      <span className="text-xs text-slate-500">All</span>
                                                    </label>
                                                  </div>
                                                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                                    {projectPermissions.map(permission => (
                                                      <label key={permission} className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-50 cursor-pointer">
                                                        <Checkbox id={`edit-${projectKey}-${permission}`} checked={grantedInProject.includes(permission)}
                                                          onCheckedChange={(checked) => handlePermissionChange(projectKey, permission, !!checked)} disabled={!isViewModulePermission} />
                                                        <span className="text-xs text-slate-600">{permission}</span>
                                                      </label>
                                                    ))}
                                                  </div>
                                                </div>
                                              );
                                            })}
                                          </div>
                                        </div>
                                      );
                                    }

                                    if (Array.isArray(permissions) && permissions.length > 0) {
                                      const grantedInGroup = editingRole.permissions?.[fullKey] || [];
                                      const isAllInGroupSelected = permissions.length > 0 && grantedInGroup.length === permissions.length;
                                      return (
                                        <div key={fullKey} className="rounded-xl border border-slate-200 bg-slate-50/50 overflow-hidden">
                                          <div className="flex items-center justify-between px-4 py-2.5 bg-slate-100/80 border-b border-slate-200">
                                            <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wider">{subModuleKey}</h4>
                                            <label className="flex items-center gap-1.5 cursor-pointer">
                                              <Checkbox id={`select-all-group-edit-${fullKey}`} checked={isAllInGroupSelected}
                                                onCheckedChange={(checked) => handleSelectAllForGroup(fullKey, permissions as string[], !!checked)} disabled={!isViewModulePermission} />
                                              <span className="text-xs text-slate-500">All</span>
                                            </label>
                                          </div>
                                          <div className="p-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                                            {permissions.map(permission => (
                                              <label key={permission} className="flex items-center gap-2 p-2 rounded-lg bg-white border border-slate-100 hover:border-slate-200 cursor-pointer transition-colors">
                                                <Checkbox id={`edit-${fullKey}-${permission}`} checked={grantedInGroup.includes(permission)}
                                                  onCheckedChange={(checked) => handlePermissionChange(fullKey, permission, !!checked)} disabled={!isViewModulePermission} />
                                                <span className="text-xs text-slate-700 leading-tight">{permission}</span>
                                              </label>
                                            ))}
                                          </div>
                                        </div>
                                      );
                                    }

                                    if (typeof permissions === 'object' && !Array.isArray(permissions)) {
                                      return (
                                        <div key={fullKey} className="rounded-xl border border-slate-200 bg-slate-50/50 overflow-hidden">
                                          <div className="px-4 py-2.5 bg-slate-100/80 border-b border-slate-200">
                                            <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wider">{subModuleKey}</h4>
                                          </div>
                                          <div className="p-3 space-y-2">
                                            {Object.entries(permissions).map(([nestedKey, nestedPerms]) => {
                                              if (!Array.isArray(nestedPerms)) return null;
                                              const nestedFullKey = `${fullKey}.${nestedKey}`;
                                              const grantedInNestedGroup = editingRole.permissions?.[nestedFullKey] || [];
                                              const isAllInNestedSelected = nestedPerms.length > 0 && grantedInNestedGroup.length === nestedPerms.length;
                                              if (nestedPerms.length === 0) {
                                                return (
                                                  <label key={nestedFullKey} className="flex items-center gap-2.5 p-2 rounded-lg bg-white border border-slate-100 hover:border-slate-200 cursor-pointer">
                                                    <Checkbox id={`edit-${nestedFullKey}-View`} checked={grantedInNestedGroup.includes('View')}
                                                      onCheckedChange={(checked) => handlePermissionChange(nestedFullKey, 'View', !!checked)} disabled={!isViewModulePermission} />
                                                    <span className="text-sm text-slate-700">{nestedKey}</span>
                                                  </label>
                                                );
                                              }
                                              return (
                                                <div key={nestedFullKey} className="rounded-lg border border-slate-200 bg-white overflow-hidden">
                                                  <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-100">
                                                    <p className="text-xs font-medium text-slate-700">{nestedKey}</p>
                                                    {nestedPerms.length > 1 && (
                                                      <label className="flex items-center gap-1.5 cursor-pointer">
                                                        <Checkbox id={`select-all-nested-edit-${nestedFullKey}`} checked={isAllInNestedSelected}
                                                          onCheckedChange={(checked) => handleSelectAllForGroup(nestedFullKey, nestedPerms, !!checked)} disabled={!isViewModulePermission} />
                                                        <span className="text-xs text-slate-500">All</span>
                                                      </label>
                                                    )}
                                                  </div>
                                                  <div className="p-2 grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                                                    {nestedPerms.map(p => (
                                                      <label key={p} className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-50 cursor-pointer">
                                                        <Checkbox id={`edit-${nestedFullKey}-${p}`} checked={grantedInNestedGroup.includes(p)}
                                                          onCheckedChange={(checked) => handlePermissionChange(nestedFullKey, p, !!checked)} disabled={!isViewModulePermission} />
                                                        <span className="text-xs text-slate-600">{p}</span>
                                                      </label>
                                                    ))}
                                                  </div>
                                                </div>
                                              );
                                            })}
                                          </div>
                                        </div>
                                      );
                                    }
                                  })}
                                </div>
                              </>
                            )}
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      );
                    })}
                  </Accordion>
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </div>
    );
}

