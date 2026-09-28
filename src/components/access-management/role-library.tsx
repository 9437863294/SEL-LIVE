'use client';

/**
 * The role library (§4) — browse, search and act on roles.
 *
 * Roles here are the *same* `roles` collection the existing Role Management screen edits — not a
 * parallel set. This screen adds a description, a status, a System/Custom marker and a user count,
 * all optional fields that a role written before they existed simply does not have. Nothing here
 * requires them, and a role saved from the old screen keeps working after this one has touched it.
 *
 * ── Where the builder went ─────────────────────────────────────────────────────────────────────
 *
 * New / Edit / Duplicate (§38, §39) used to open a dialog defined in this file. They are now links to
 * `/settings/access-management/roles/…` — see `RoleForm` for why a ~1,200-checkbox permission tree
 * had no business inside a modal. This file kept the parts that belong to a *library*: the filters,
 * the cards, and the two small confirmations.
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
  Lock,
  Pencil,
  Plus,
  ShieldCheck,
  ShieldOff,
  UserCheck,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { hrDialog, HrEmptyState } from '@/components/hr/hr-ui';
import { FilterBar } from '@/components/shared/filter-bar';
import { StatusBadge } from '@/components/shared/status-badge';
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
import {
  ACCESS_ACTION_CLASS,
  ACCESS_ACTION_ICON,
  ACCESS_ACTION_TONES,
  ACCESS_STICKY_TOOLBAR_CLASS,
  AccessCard,
  RiskBadges,
} from './access-ui';

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
      {/* Pinned under the tab strip — filtering 28 roles from halfway down the list should not mean
          scrolling back to the top. The count line comes along because it is the readout for these
          controls, and reads as stale if it scrolls away while they stay. */}
      <div className={ACCESS_STICKY_TOOLBAR_CLASS}>
        <FilterBar
          search={{
            value: term,
            onChange: setTerm,
            placeholder: 'Search roles, descriptions or the permissions they contain…',
          }}
          activeCount={
            [statusFilter !== 'Active', typeFilter !== 'all', moduleFilter !== 'all'].filter(Boolean).length
          }
          onClear={() => {
            setTerm('');
            setStatusFilter('Active');
            setTypeFilter('all');
            setModuleFilter('all');
          }}
          summary={
            <>
              {filtered.length} of {directory.roles.length} roles
              {/* The registry totals are context, not the answer to "did my filter work" — they wrap to a
                  second line on a phone, so they wait for the width to say them. */}
              <span className="hidden sm:inline">
                {' '}
                · the registry offers {registryTotal} grantable permissions across {modules.length} modules
              </span>
            </>
          }
          actions={
            canManage && (
              <Button asChild className="shrink-0">
                <Link href={builderHref()}>
                  <Plus className="h-4 w-4" />
                  {/* "New role" is worth the width on a desktop row; on a phone the noun is already
                      obvious from the screen you are on. The spacing is the Button's own `gap`, so
                      there are no margins here to double it. */}
                  <span>
                    New<span className="hidden lg:inline">&nbsp;role</span>
                  </span>
                </Link>
              </Button>
            )
          }
        >
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}>
            <SelectTrigger aria-label="Status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Active">Active</SelectItem>
              <SelectItem value="Inactive">Disabled</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={(value) => setTypeFilter(value as typeof typeFilter)}>
            <SelectTrigger aria-label="Role type"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="System">System</SelectItem>
              <SelectItem value="Custom">Custom</SelectItem>
            </SelectContent>
          </Select>
          <Select value={moduleFilter} onValueChange={setModuleFilter}>
            <SelectTrigger aria-label="Module"><SelectValue placeholder="Module" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any module</SelectItem>
              {modules.map((moduleName) => (
                <SelectItem key={moduleName} value={moduleName}>{moduleName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterBar>
      </div>

      {filtered.length === 0 ? (
        <HrEmptyState
          icon={Layers}
          title="No roles match these filters"
          description="Try clearing the module or status filter."
        />
      ) : (
        // `auto-rows-fr` gives every row the same height rather than each row sizing to its own
        // tallest card, so the whole grid is uniform instead of only each row internally.
        //
        // Four across from `2xl` (1536px). Not from `xl` (1280px): four cards there are ~300px
        // wide, which is under what the four action buttons and the two-column module grid need
        // without truncating both.
        <div className="grid auto-rows-fr grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {filtered.map((role) => {
            const usage = roleUsage[role.name];
            const disabled = role.status === 'Inactive' || role.status === 'Disabled';
            const privileges = detectPrivilegedAccess(role.permissions ?? {});
            const conflicts = detectSodConflicts(role.permissions ?? {});

            return (
              // `h-full` + a flex column is what makes the row of cards one height: the grid
              // already stretches them, but without it the card's own content decides its height
              // and the action rows sit at three different places across a row.
              <AccessCard
                key={role.id}
                className={cn(
                  'flex h-full flex-col transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md',
                  disabled && 'opacity-70',
                )}
              >
                <CardContent className="flex flex-1 flex-col gap-2.5 p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-800">{role.name}</p>
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {role.description || 'No description.'}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge variant="outline">{role.type === 'Custom' ? 'Custom' : 'System'}</Badge>
                      {disabled && <StatusBadge status="Disabled" />}
                      {/* Not a word the shared vocabulary knows; it is the role that cannot be switched off. */}
                      {isProtectedRole(role.name) && <StatusBadge status="Protected" tone="danger" />}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <Badge variant="neutral">{countPermissions(role.permissions)} permissions</Badge>
                    <Badge variant="outline" className="gap-1">
                      <UserCheck className="h-3 w-3" />
                      {usage?.total ?? 0} user{(usage?.total ?? 0) === 1 ? '' : 's'}
                    </Badge>
                    {usage && usage.additional > 0 && (
                      <Badge variant="outline">
                        {usage.base} base · {usage.additional} additional
                      </Badge>
                    )}
                    <RiskBadges privileges={privileges} conflicts={conflicts} />
                  </div>

                  {/* A floor, not a fixed height: one module should not make a card noticeably
                      shorter than its neighbours, but a role reaching eight still gets its second
                      row rather than being clipped. */}
                  <div className="min-h-[2.75rem]">
                    {/* Four, not six. Every card is now as tall as the tallest one (`auto-rows-fr`),
                        so the widest role's chip list sets the dead space in all 28 — and past about
                        four the chips stop being a summary anyway. The rest are a click away. */}
                    <PermissionMapSummary
                      map={role.permissions ?? {}}
                      registry={registry}
                      max={4}
                      emptyLabel="No permissions granted."
                    />
                  </div>

                  {/* `mt-auto` is the other half of the equal-height card: the actions sit on the
                      bottom edge of every card in the row, however much sits above them. */}
                  <div className="mt-auto flex gap-1.5 border-t border-slate-100 pt-2.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn(ACCESS_ACTION_CLASS, ACCESS_ACTION_TONES.indigo)}
                      onClick={() => onAssignRole(role.id)}
                      disabled={disabled}
                    >
                      <ShieldCheck className={ACCESS_ACTION_ICON} />
                      Assign
                    </Button>
                    {canManage && (
                      <>
                        <Button
                          asChild
                          variant="outline"
                          size="sm"
                          className={cn(ACCESS_ACTION_CLASS, ACCESS_ACTION_TONES.sky)}
                        >
                          <Link href={builderHref({ roleId: role.id })}>
                            <Pencil className={ACCESS_ACTION_ICON} />
                            Edit
                          </Link>
                        </Button>
                        <Button
                          asChild
                          variant="outline"
                          size="sm"
                          className={cn(ACCESS_ACTION_CLASS, ACCESS_ACTION_TONES.violet)}
                        >
                          <Link
                            href={builderHref({ duplicateFrom: role.id })}
                            aria-label={`Duplicate ${role.name}`}
                          >
                            <CopyPlus className={ACCESS_ACTION_ICON} />
                            Copy
                          </Link>
                        </Button>
                        {/*
                          A protected role gets a lock, not a disable button — offering the button
                          and refusing inside the dialog teaches administrators the control is broken.
                          It keeps the row's shape so the other three stay aligned card to card.
                        */}
                        {isProtectedRole(role.name) && !disabled ? (
                          <span
                            title="Protected role — cannot be disabled"
                            aria-label={`${role.name} is protected and cannot be disabled`}
                            className="flex h-8 flex-1 items-center justify-center gap-1 rounded-md border border-slate-200 bg-slate-50/80 px-2 text-xs font-medium text-slate-400"
                          >
                            <Lock className="h-3.5 w-3.5" />
                            Locked
                          </span>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className={cn(
                              ACCESS_ACTION_CLASS,
                              disabled ? ACCESS_ACTION_TONES.emerald : ACCESS_ACTION_TONES.rose,
                            )}
                            aria-label={disabled ? `Re-enable ${role.name}` : `Disable ${role.name}`}
                            onClick={() => setDisabling(role)}
                          >
                            <ShieldOff className={ACCESS_ACTION_ICON} />
                            {disabled ? 'Enable' : 'Disable'}
                          </Button>
                        )}
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
