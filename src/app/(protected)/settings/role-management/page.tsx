

'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, ShieldAlert, Edit, Trash2, Copy, Sparkles, Search, Users, Loader2 } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, deleteDoc, doc, addDoc } from 'firebase/firestore';
import { type Role } from '@/lib/types';
import { permissionModules } from '@/lib/permissions';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getTotalPermissionsForModule, getGrantedPermissionsForModule } from '@/lib/permission-utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AuroraBackdrop } from '@/components/effects/AuroraBackdrop';
import { cn } from '@/lib/utils';

const MAX_VISIBLE_MODULE_BADGES = 4;

function getModuleSummaries(role: Role) {
  const summaries: { moduleName: string; percentage: number }[] = [];
  Object.keys(permissionModules).forEach((moduleName) => {
    const totalPerms = getTotalPermissionsForModule(moduleName);
    if (totalPerms === 0) return;
    const grantedPerms = getGrantedPermissionsForModule(role.permissions, moduleName);
    if (grantedPerms === 0) return;
    summaries.push({ moduleName, percentage: Math.round((grantedPerms / totalPerms) * 100) });
  });
  return summaries;
}

function ModuleSummaryBadges({ role, size = 'default' }: { role: Role; size?: 'default' | 'sm' }) {
  const summaries = getModuleSummaries(role);
  if (summaries.length === 0) {
    return <span className="text-xs italic text-slate-400">No permissions granted</span>;
  }
  const visible = summaries.slice(0, MAX_VISIBLE_MODULE_BADGES);
  const hiddenCount = summaries.length - visible.length;
  const textSize = size === 'sm' ? 'text-[10px]' : 'text-xs';
  return (
    <div className="flex flex-wrap gap-1.5">
      {visible.map(({ moduleName, percentage }) => (
        <Badge
          key={moduleName}
          variant="outline"
          className={cn(
            textSize,
            percentage === 100
              ? 'border-emerald-200/80 bg-emerald-50 text-emerald-700'
              : 'border-slate-200/80 bg-white/70 text-slate-700',
          )}
        >
          {moduleName}: {percentage}%
        </Badge>
      ))}
      {hiddenCount > 0 && (
        <Badge variant="outline" className={cn(textSize, 'border-slate-200/80 bg-slate-100 text-slate-500')}>
          +{hiddenCount} more
        </Badge>
      )}
    </div>
  );
}

export default function ManageRolePage() {
  const { toast } = useToast();
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const [roles, setRoles] = useState<Role[]>([]);
  const [roleUsage, setRoleUsage] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<Role | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [duplicateSource, setDuplicateSource] = useState<Role | null>(null);
  const [duplicateName, setDuplicateName] = useState('');
  const [isDuplicating, setIsDuplicating] = useState(false);

  const canView = can('View', 'Settings.Role Management');
  const canAdd = can('Add', 'Settings.Role Management');
  const canEdit = can('Edit', 'Settings.Role Management');
  const canDelete = can('Delete', 'Settings.Role Management');

  const fetchRoles = async () => {
    setIsLoading(true);
    try {
      const [rolesSnap, usersSnap] = await Promise.all([
        getDocs(collection(db, 'roles')),
        getDocs(collection(db, 'users')),
      ]);
      const rolesData: Role[] = rolesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Role));
      const usage: Record<string, number> = {};
      usersSnap.docs.forEach((docSnap) => {
        const roleName = String((docSnap.data() as any)?.role || '').trim();
        if (!roleName) return;
        usage[roleName] = (usage[roleName] || 0) + 1;
      });
      setRoles(rolesData);
      setRoleUsage(usage);
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
  }, [isAuthLoading, canView]);

  const filteredRoles = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return roles;
    return roles.filter((role) => role.name.toLowerCase().includes(q));
  }, [roles, search]);

  const handleDeleteRole = async (role: Role) => {
    setIsDeleting(true);
    try {
      await deleteDoc(doc(db, "roles", role.id));
      toast({
        title: "Success",
        description: `Role "${role.name}" deleted successfully.`,
      });
      setDeleteTarget(null);
      fetchRoles();
    } catch (error) {
      console.error("Error deleting role: ", error);
      toast({
        title: "Error",
        description: "Failed to delete role.",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const openDuplicateDialog = (role: Role) => {
    setDuplicateSource(role);
    setDuplicateName(`Copy of ${role.name}`);
  };

  const handleDuplicateRole = async () => {
    if (!duplicateSource) return;
    const trimmed = duplicateName.trim();
    if (!trimmed) {
      toast({ title: 'Validation Error', description: 'Role name cannot be empty.', variant: 'destructive' });
      return;
    }
    const nameTaken = roles.some((role) => role.name.trim().toLowerCase() === trimmed.toLowerCase());
    if (nameTaken) {
      toast({ title: 'Validation Error', description: `A role named "${trimmed}" already exists.`, variant: 'destructive' });
      return;
    }
    setIsDuplicating(true);
    try {
      await addDoc(collection(db, 'roles'), {
        name: trimmed,
        permissions: duplicateSource.permissions || {},
      });
      toast({
        title: 'Success',
        description: `Role "${trimmed}" created from "${duplicateSource.name}".`,
      });
      setDuplicateSource(null);
      setDuplicateName('');
      fetchRoles();
    } catch (error) {
      console.error('Error duplicating role: ', error);
      toast({ title: 'Error', description: 'Failed to duplicate role.', variant: 'destructive' });
    } finally {
      setIsDuplicating(false);
    }
  };

  const deleteUsageCount = deleteTarget ? (roleUsage[deleteTarget.name.trim()] || 0) : 0;

  if (isAuthLoading || (isLoading && canView)) {
    return (
        <div className="relative min-h-[calc(100dvh-4rem)] overflow-hidden px-4 py-3 sm:px-5">
            <AuroraBackdrop />
            <div className="w-full">
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
        </div>
    );
  }

  if (!canView) {
    return (
        <div className="relative min-h-[calc(100dvh-4rem)] overflow-hidden px-4 py-3 sm:px-5">
            <AuroraBackdrop />
            <div className="w-full">
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
        </div>
    );
  }

  return (
    <div className="relative min-h-[calc(100dvh-4rem)] overflow-hidden px-4 py-3 sm:px-5">
      <AuroraBackdrop />

      <div className="w-full">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-start gap-4">
            <Link href="/settings">
              <Button variant="ghost" size="icon" className="rounded-full bg-white/70 shadow-sm backdrop-blur hover:bg-white/90">
                <ArrowLeft className="h-6 w-6" />
              </Button>
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">Role Management</h1>
                <Badge variant="outline" className="border-white/70 bg-white/70 text-slate-700 backdrop-blur">
                  {roles.length} roles
                </Badge>
              </div>
              <p className="mt-1 text-sm text-slate-600">
                Design access control with clear permission summaries per module.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Link href="/settings/role-management/add">
              <Button
                disabled={!canAdd}
                className="shadow-[0_18px_60px_-45px_rgba(2,6,23,0.55)]"
              >
                <Plus className="mr-2 h-4 w-4" />
                Add New Role
              </Button>
            </Link>
            <Badge className="hidden sm:inline-flex bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white shadow-sm">
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              Refined UI
            </Badge>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-4 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search roles by name..."
            className="border-white/70 bg-white/70 pl-9 backdrop-blur"
          />
        </div>

        {/* Mobile card view — hidden on md+ */}
        <div className="space-y-3 md:hidden">
          {isLoading ? (
            Array.from({length: 3}).map((_, i) => <Skeleton key={i} className="h-36 w-full rounded-2xl" />)
          ) : filteredRoles.length === 0 ? (
            <div className="rounded-2xl border border-white/70 bg-white/70 px-4 py-10 text-center text-sm text-muted-foreground backdrop-blur">
              {roles.length === 0 ? 'No roles found.' : 'No roles match your search.'}
            </div>
          ) : (
            filteredRoles.map(role => {
              const usageCount = roleUsage[role.name.trim()] || 0;
              return (
              <div key={role.id} className="rounded-2xl border border-white/70 bg-white/70 p-4 shadow-sm backdrop-blur space-y-3 active:scale-[0.99] transition-transform">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-slate-900">{role.name}</h3>
                  <Badge
                    variant="outline"
                    className={cn(
                      'shrink-0 gap-1 text-[10px]',
                      usageCount > 0 ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-slate-200 bg-white/70 text-slate-500',
                    )}
                  >
                    <Users className="h-3 w-3" /> {usageCount}
                  </Badge>
                </div>
                <ModuleSummaryBadges role={role} size="sm" />
                <div className="flex gap-2 border-t border-slate-100 pt-3">
                  <Link href={`/settings/role-management/edit/${role.id}`} className="flex-1">
                    <Button variant="outline" size="sm" disabled={!canEdit} className="w-full bg-white/70 border-white/70 h-10">
                      <Edit className="mr-2 h-4 w-4" /> Edit
                    </Button>
                  </Link>
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={!canAdd}
                    className="h-10 w-10 shrink-0 bg-white/70 border-white/70"
                    title="Duplicate role"
                    onClick={() => openDuplicateDialog(role)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="destructive"
                    size="icon"
                    disabled={!canDelete}
                    className="h-10 w-10 shrink-0"
                    title="Delete role"
                    onClick={() => setDeleteTarget(role)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              );
            })
          )}
        </div>

        <Card className="hidden md:block overflow-hidden rounded-2xl border border-white/70 bg-white/70 shadow-[0_20px_70px_-55px_rgba(2,6,23,0.55)] backdrop-blur">
          <CardContent className="p-0">
            <ScrollArea className="h-[calc(100dvh-18.5rem)]" showHorizontalScrollbar>
              <Table className="min-w-[1080px]">
              <TableHeader className="sticky top-0 z-10 bg-gradient-to-r from-white/90 via-white/80 to-white/90 backdrop-blur border-b border-white/70">
                <TableRow>
                  <TableHead className="w-[200px] text-slate-700">Role Name</TableHead>
                  <TableHead className="text-slate-700">Permissions Summary</TableHead>
                  <TableHead className="w-[110px] text-slate-700">Users</TableHead>
                  <TableHead className="text-right w-[240px] text-slate-700">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-5 w-3/4" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-full" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-10" /></TableCell>
                      <TableCell className="text-right space-x-2">
                        <Skeleton className="h-8 w-16 inline-block" />
                        <Skeleton className="h-8 w-16 inline-block" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : filteredRoles.length > 0 ? (
                  filteredRoles.map((role) => {
                    const usageCount = roleUsage[role.name.trim()] || 0;
                    return (
                    <TableRow key={role.id} className="hover:bg-slate-50/70">
                      <TableCell className="font-semibold text-slate-900">{role.name}</TableCell>
                      <TableCell>
                        <ModuleSummaryBadges role={role} />
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            'gap-1',
                            usageCount > 0 ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-slate-200 bg-white/70 text-slate-500',
                          )}
                        >
                          <Users className="h-3 w-3" /> {usageCount}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        <Link href={`/settings/role-management/edit/${role.id}`}>
                          <Button variant="outline" size="sm" disabled={!canEdit} className="bg-white/70 border-white/70">
                            <Edit className="mr-2 h-4 w-4" /> Edit
                          </Button>
                        </Link>
                        <Button
                          variant="outline"
                          size="icon"
                          disabled={!canAdd}
                          className="bg-white/70 border-white/70"
                          title="Duplicate role"
                          onClick={() => openDuplicateDialog(role)}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="destructive"
                          size="icon"
                          disabled={!canDelete}
                          title="Delete role"
                          onClick={() => setDeleteTarget(role)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center h-24 text-slate-600">
                      {roles.length === 0 ? 'No roles found.' : 'No roles match your search.'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* Delete confirmation — blocks the action outright if users are still assigned to this role */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          {deleteTarget && deleteUsageCount > 0 ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Can&apos;t delete &quot;{deleteTarget.name}&quot;</AlertDialogTitle>
                <AlertDialogDescription>
                  {deleteUsageCount} user{deleteUsageCount === 1 ? ' is' : 's are'} currently assigned this role.
                  Reassign {deleteUsageCount === 1 ? 'that user' : 'those users'} to a different role in User Management
                  first, then come back to delete this one.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogAction onClick={() => setDeleteTarget(null)}>Got it</AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete &quot;{deleteTarget?.name}&quot;?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete the role and cannot be undone. No users are currently assigned to it.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={isDeleting}
                  onClick={() => deleteTarget && handleDeleteRole(deleteTarget)}
                >
                  {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>

      {/* Duplicate role */}
      <Dialog open={!!duplicateSource} onOpenChange={(open) => !open && setDuplicateSource(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Duplicate role</DialogTitle>
            <DialogDescription>
              Creates a new role with the same permissions as &quot;{duplicateSource?.name}&quot;. You can rename it and
              adjust permissions afterwards from Edit.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="duplicateRoleName">New role name</Label>
            <Input
              id="duplicateRoleName"
              value={duplicateName}
              onChange={(e) => setDuplicateName(e.target.value)}
              placeholder="e.g. Finance Approver (Copy)"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDuplicateSource(null)} disabled={isDuplicating}>
              Cancel
            </Button>
            <Button onClick={handleDuplicateRole} disabled={isDuplicating}>
              {isDuplicating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Copy className="mr-2 h-4 w-4" />}
              Create Role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
