'use client';

/**
 * The role library (§4) and the Role Builder (§38, §39).
 *
 * Roles here are the *same* `roles` collection the existing Role Management screen edits — not a
 * parallel set. This screen adds a description, a status, a System/Custom marker and a user count,
 * all optional fields that a role written before they existed simply does not have. Nothing here
 * requires them, and a role saved from the old screen keeps working after this one has touched it.
 *
 * ── Why disable rather than delete ──────────────────────────────────────────────────────────────
 *
 * `users.role` stores a role *name*, so deleting a role orphans every user pointing at it — the
 * existing User Management screen already warns about exactly that state. Disabling stops the role
 * granting while leaving the reference resolvable, which is recoverable; deleting is not.
 */

import * as React from 'react';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  CopyPlus,
  Layers,
  Loader2,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  ShieldOff,
  UserCheck,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { hrDialog, HrEmptyState } from '@/components/hr/hr-ui';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { Role } from '@/lib/types';
import {
  countPermissions,
  detectPrivilegedAccess,
  detectSodConflicts,
  isProtectedRole,
  registryPermissionCount,
} from '@/lib/access-control';
import { setRoleStatus, type AccessActor } from '@/lib/access-control-service';
import type { AccessDirectoryState } from '@/hooks/useAccessDirectory';
import { PermissionMapSummary } from './permission-tree';
import { AccessCard, RiskBadges } from './access-ui';

/** The tab the builder returns to, so a round trip lands where it started. */
const ROLES_TAB = '/settings/access-management?tab=roles';

/**
 * Where the Role Builder lives, now that it is a page rather than a dialog.
 *
 * One helper for all three entry points so the `returnTo` is impossible to forget: without it the
 * builder's Cancel and Save both fall back to Overview, and an administrator who came from the roles
 * tab is dropped somewhere they were not.
 */
function builderHref(options: { roleId?: string; duplicateFrom?: string } = {}): string {
  const base = options.roleId
    ? `/settings/access-management/roles/${encodeURIComponent(options.roleId)}`
    : '/settings/access-management/roles/new';
  const query = new URLSearchParams({ returnTo: ROLES_TAB });
  // Duplicating creates a role, so it is `new` with a source — never the source role's own URL.
  if (!options.roleId && options.duplicateFrom) query.set('duplicateFrom', options.duplicateFrom);
  return `${base}?${query.toString()}`;
}

export function RoleLibrary({
  state,
  actor,
  canManage,
  onAssignRole,
}: {
  state: AccessDirectoryState;
  actor: AccessActor;
  canManage: boolean;
  /** Hands the role to the assignment workspace — §38's "immediately allow Assign Role to Users". */
  onAssignRole: (roleId: string) => void;
}) {
  const { toast } = useToast();
  const { directory, registry, roleUsage } = state;

  const [term, setTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'System' | 'Custom'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'Active' | 'Inactive'>('Active');
  const [moduleFilter, setModuleFilter] = useState('all');

  const [disabling, setDisabling] = useState<Role | null>(null);

  const modules = useMemo(
    () => [...new Set(registry.map((node) => node.module))].sort(),
    [registry],
  );

  const filtered = useMemo(() => {
    const query = term.trim().toLowerCase();
    return directory.roles
      .filter((role) => {
        const status = role.status === 'Inactive' || role.status === 'Disabled' ? 'Inactive' : 'Active';
        if (statusFilter !== 'all' && status !== statusFilter) return false;
        if (typeFilter !== 'all' && (role.type ?? 'System') !== typeFilter) return false;
        if (moduleFilter !== 'all') {
          const grantsModule = Object.keys(role.permissions ?? {}).some(
            (resource) => resource === moduleFilter || resource.startsWith(`${moduleFilter}.`),
          );
          if (!grantsModule) return false;
        }
        if (query) {
          const haystack = [
            role.name,
            role.description,
            ...Object.keys(role.permissions ?? {}),
            ...Object.values(role.permissions ?? {}).flat(),
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          if (!haystack.includes(query)) return false;
        }
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [directory.roles, term, typeFilter, statusFilter, moduleFilter]);

  const registryTotal = useMemo(() => registryPermissionCount(registry), [registry]);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 rounded-xl border border-white/70 bg-white/80 p-3 shadow-sm backdrop-blur lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Search roles, descriptions or the permissions they contain…"
            className="pl-9"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:w-auto">
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}>
            <SelectTrigger className="min-w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Active">Active</SelectItem>
              <SelectItem value="Inactive">Disabled</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={(value) => setTypeFilter(value as typeof typeFilter)}>
            <SelectTrigger className="min-w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="System">System</SelectItem>
              <SelectItem value="Custom">Custom</SelectItem>
            </SelectContent>
          </Select>
          <Select value={moduleFilter} onValueChange={setModuleFilter}>
            <SelectTrigger className="min-w-36"><SelectValue placeholder="Module" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any module</SelectItem>
              {modules.map((moduleName) => (
                <SelectItem key={moduleName} value={moduleName}>{moduleName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {canManage && (
          <Button asChild>
            <Link href={builderHref()}>
              <Plus className="mr-1.5 h-4 w-4" />
              New role
            </Link>
          </Button>
        )}
      </div>

      <p className="px-1 text-xs text-muted-foreground">
        {filtered.length} of {directory.roles.length} roles · the registry offers {registryTotal} grantable
        permissions across {modules.length} modules
      </p>

      {filtered.length === 0 ? (
        <HrEmptyState
          icon={Layers}
          title="No roles match these filters"
          description="Try clearing the module or status filter."
        />
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((role) => {
            const usage = roleUsage[role.name];
            const disabled = role.status === 'Inactive' || role.status === 'Disabled';
            const privileges = detectPrivilegedAccess(role.permissions ?? {});
            const conflicts = detectSodConflicts(role.permissions ?? {});

            return (
              <AccessCard
                key={role.id}
                className={cn('transition-shadow hover:shadow-md', disabled && 'opacity-70')}
              >
                <CardContent className="space-y-2.5 p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-800">{role.name}</p>
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {role.description || 'No description.'}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge variant="outline" className="text-[10px] text-slate-500">
                        {role.type === 'Custom' ? 'Custom' : 'System'}
                      </Badge>
                      {disabled && (
                        <Badge variant="outline" className="border-slate-300 bg-slate-100 text-[10px] text-slate-600">
                          Disabled
                        </Badge>
                      )}
                      {isProtectedRole(role.name) && (
                        <Badge variant="outline" className="border-rose-200 bg-rose-50 text-[10px] text-rose-700">
                          Protected
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700">
                      {countPermissions(role.permissions)} permissions
                    </Badge>
                    <Badge variant="outline" className="gap-1 border-slate-200 bg-white text-slate-600">
                      <UserCheck className="h-3 w-3" />
                      {usage?.total ?? 0} user{(usage?.total ?? 0) === 1 ? '' : 's'}
                    </Badge>
                    {usage && usage.additional > 0 && (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">
                        {usage.base} base · {usage.additional} additional
                      </Badge>
                    )}
                    <RiskBadges privileges={privileges} conflicts={conflicts} />
                  </div>

                  <PermissionMapSummary map={role.permissions ?? {}} registry={registry} max={6} />

                  <div className="flex flex-wrap gap-1.5 border-t border-slate-100 pt-2.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 flex-1 text-xs"
                      onClick={() => onAssignRole(role.id)}
                      disabled={disabled}
                    >
                      <ShieldCheck className="mr-1 h-3.5 w-3.5" />
                      Assign
                    </Button>
                    {canManage && (
                      <>
                        <Button asChild variant="outline" size="sm" className="h-8 text-xs">
                          <Link href={builderHref({ roleId: role.id })}>
                            <Pencil className="mr-1 h-3.5 w-3.5" />
                            Edit
                          </Link>
                        </Button>
                        <Button
                          asChild
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs"
                          title="Duplicate this role"
                        >
                          <Link
                            href={builderHref({ duplicateFrom: role.id })}
                            aria-label={`Duplicate ${role.name}`}
                          >
                            <CopyPlus className="h-3.5 w-3.5" />
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-xs"
                          title={disabled ? 'Re-enable this role' : 'Disable this role'}
                          onClick={() => setDisabling(role)}
                        >
                          <ShieldOff className={cn('h-3.5 w-3.5', !disabled && 'text-destructive')} />
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </AccessCard>
            );
          })}
        </div>
      )}

      <DisableRoleDialog
        role={disabling}
        onOpenChange={(open) => !open && setDisabling(null)}
        userCount={disabling ? (roleUsage[disabling.name]?.total ?? 0) : 0}
        actor={actor}
        onDone={async () => {
          setDisabling(null);
          await state.refresh();
        }}
      />
    </div>
  );
}


/* ------------------------------------------------------------------------------------------------
 * Disable / re-enable (§31)
 * ---------------------------------------------------------------------------------------------- */

function DisableRoleDialog({
  role,
  onOpenChange,
  userCount,
  actor,
  onDone,
}: {
  role: Role | null;
  onOpenChange: (open: boolean) => void;
  userCount: number;
  actor: AccessActor;
  onDone: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const disabled = role?.status === 'Inactive' || role?.status === 'Disabled';
  const nextStatus: 'Active' | 'Inactive' = disabled ? 'Active' : 'Inactive';

  return (
    <Dialog open={!!role} onOpenChange={onOpenChange}>
      <DialogContent className={hrDialog.content}>
        <DialogHeader className={hrDialog.header}>
          <DialogTitle>{disabled ? `Re-enable ${role?.name}` : `Disable ${role?.name}`}</DialogTitle>
          <DialogDescription>
            {disabled
              ? 'The role will start granting its permissions again to everybody holding it.'
              : 'The role stops granting its permissions. It is not deleted, so users pointing at it keep a resolvable reference and can be reassigned.'}
          </DialogDescription>
        </DialogHeader>

        <div className={hrDialog.body}>
          {!disabled && userCount > 0 && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <p className="font-semibold">
                {userCount} user{userCount === 1 ? '' : 's'} currently hold this role.
              </p>
              <p className="mt-0.5 text-xs">
                Disabling it removes the access it grants from all of them, unless another role grants
                the same permission. Check the Effective Access tab first if you are unsure.
              </p>
            </div>
          )}
          {role && isProtectedRole(role.name) && !disabled && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
              <p className="font-semibold">{role.name} is a protected role.</p>
              <p className="mt-0.5 text-xs">
                It cannot be disabled from this screen. Change it in Role Management if this is really
                intended.
              </p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="disable-reason">Reason *</Label>
            <Textarea
              id="disable-reason"
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
        </div>

        <DialogFooter className={hrDialog.footer}>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant={disabled ? 'default' : 'destructive'}
            disabled={saving || !reason.trim() || (!disabled && !!role && isProtectedRole(role.name))}
            onClick={async () => {
              if (!role) return;
              setSaving(true);
              try {
                await setRoleStatus(role, nextStatus, actor, reason.trim());
                setReason('');
                await onDone();
              } catch (error) {
                toast({
                  title: 'Could not change the role status',
                  description: error instanceof Error ? error.message : 'Unexpected error.',
                  variant: 'destructive',
                });
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {disabled ? 'Re-enable role' : 'Disable role'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
