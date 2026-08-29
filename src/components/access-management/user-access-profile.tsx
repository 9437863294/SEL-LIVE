'use client';

/**
 * One user's access profile (§25) — the screen an administrator lands on when somebody says "I
 * can't see X".
 *
 * Everything about that person's access on one page, plus the actions to change it. The effective-
 * access panel is the identical component the Effective Access tab renders, deliberately: an
 * administrator should not have to re-learn the layout depending on how they got here.
 *
 * ── Removal lives here, not on the assignment screen ────────────────────────────────────────────
 *
 * §47 asks for a separate, explicit removal workflow, and this is it. Grants are listed
 * individually with their provenance, and removing one shows what the user would actually lose —
 * usually less than the grant contains, because another source still covers the overlap.
 */

import * as React from 'react';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  CalendarClock,
  Building2,
  FolderKanban,
  History,
  KeyRound,
  Layers,
  Link2,
  Loader2,
  PauseCircle,
  PlayCircle,
  ShieldPlus,
  Trash2,
  UserCheck,
  UserX,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { hrDialog, HrEmptyState, HrField, HrLoader } from '@/components/hr/hr-ui';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  formatGrantDate,
  temporaryGrantState,
  type PermissionMap,
} from '@/lib/access-control';
import {
  checkAdministrationSurvives,
  deactivateUserAccount,
  grantAccess,
  reactivateUserAccount,
  revokeAccess,
  setAccessLayerStatus,
  type AccessActor,
} from '@/lib/access-control-service';
import { linkMethodLabel } from '@/lib/greythr-linking';
import type { User } from '@/lib/types';
import type { AccessDirectoryState } from '@/hooks/useAccessDirectory';
import { UserEffectiveAccessPanel } from './effective-access';
import { RemovalPreviewDialog } from './assignment-preview';
import { AuditHistory } from './audit-history';
import { AccessBackLink, AccessCard, PermissionPairList, RoleBadge } from './access-ui';
import { AccessChecklist, AccessChecklistSaveBar, type PendingChange } from './access-checklist';

export function UserAccessProfile({
  userId,
  state,
  actor,
  canRevoke,
  canAssign,
}: {
  userId: string;
  state: AccessDirectoryState;
  actor: AccessActor;
  canRevoke: boolean;
  /** Whether this administrator may grant new direct permissions from the checklist below. */
  canAssign: boolean;
}) {
  const { toast } = useToast();
  const { directory, accessByUser, departments, projects, employees, registry, isLoading } = state;

  const [term, setTerm] = useState('');
  const [removal, setRemoval] = useState<{
    roleIds: string[];
    projectIds: string[];
    temporaryIds: string[];
    directPermissions: PermissionMap;
  } | null>(null);
  const [suspendOpen, setSuspendOpen] = useState(false);
  /** The account dialog, and — when disabling — why it must not go ahead (the last administrator). */
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountGuard, setAccountGuard] = useState<string | null>(null);

  /**
   * Staged tick/untick changes from the checklist below, keyed `${resource}::${action}`.
   *
   * Kept separate from `removal` (the per-row dialogs above) deliberately: those confirm one grant's
   * worth of removal at a time with its own preview; the checklist stages an arbitrary mix of grants
   * and revokes across the whole registry and saves them together with one reason, which is a
   * different enough shape of action to deserve its own state rather than being force-fit into
   * `removal`'s.
   */
  const [pendingChanges, setPendingChanges] = useState<Map<string, PendingChange>>(new Map());
  const [checklistReason, setChecklistReason] = useState('');
  const [checklistSaving, setChecklistSaving] = useState(false);
  const [checklistError, setChecklistError] = useState<string | null>(null);

  const user = directory.users.find((entry) => entry.id === userId);
  const access = accessByUser[userId];
  const grant = directory.grants[userId];

  const employee = useMemo(() => {
    const email = (user?.email || '').trim().toLowerCase();
    if (!email) return undefined;
    return employees.find((entry) => (entry.email || '').trim().toLowerCase() === email);
  }, [user?.email, employees]);

  if (isLoading) return <HrLoader label="Loading access profile…" />;

  if (!user || !access) {
    return (
      <HrEmptyState
        title="User not found"
        description="This user may have been removed. Go back to the access management screen and pick another."
        action={
          <Link href="/settings/access-management">
            <Button variant="outline" size="sm">
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              Back to Access Management
            </Button>
          </Link>
        }
      />
    );
  }

  const layerSuspended = grant?.status === 'Suspended';
  const accountInactive = user.status === 'Inactive';
  const isSelf = user.id === actor.userId;

  const openAccountDialog = () => {
    // Checked when the dialog opens rather than on every render — it resolves everybody's
    // effective access to find out whether this is the last administrator.
    const survives = accountInactive ? null : checkAdministrationSurvives(directory, [user.id]);
    setAccountGuard(
      survives && !survives.safe
        ? (survives.message ?? 'This would leave nobody able to manage users and roles.')
        : null,
    );
    setAccountOpen(true);
  };

  const doRevoke = async (reason: string) => {
    if (!removal) return;
    await revokeAccess({
      users: [user],
      request: {
        roleIds: removal.roleIds,
        projectIds: removal.projectIds,
        temporaryIds: removal.temporaryIds,
        directPermissions: removal.directPermissions,
      },
      directory,
      actor,
      reason,
      label: `Remove additional access from ${user.name || user.id}`,
    });
    setRemoval(null);
    await state.refresh();
    toast({
      title: 'Additional access removed',
      description: 'Their base role is untouched, and anything another source still grants is retained.',
    });
  };

  /** Stage or un-stage one checkbox. Toggling back to the held state removes the pending entry
   * entirely, rather than leaving a no-op change sitting in the save bar. */
  const toggleChecklistAction = (resource: string, action: string, next: boolean) => {
    const key = `${resource}::${action}`;
    const heldNow = access ? resource in access.permissions && access.permissions[resource].includes(action) : false;
    setPendingChanges((current) => {
      const updated = new Map(current);
      if (next === heldNow) updated.delete(key);
      else updated.set(key, { resource, action, next });
      return updated;
    });
  };

  const discardChecklistChanges = () => {
    setPendingChanges(new Map());
    setChecklistReason('');
    setChecklistError(null);
  };

  const saveChecklistChanges = async () => {
    if (pendingChanges.size === 0 || !checklistReason.trim()) return;
    setChecklistSaving(true);
    setChecklistError(null);
    try {
      const toGrant: PermissionMap = {};
      const toRevoke: PermissionMap = {};
      for (const change of pendingChanges.values()) {
        const target = change.next ? toGrant : toRevoke;
        target[change.resource] = [...(target[change.resource] ?? []), change.action];
      }

      // Two separate writes rather than one combined request: `grantAccess` and `revokeAccess` are
      // different operations with different audit shapes (one records what was added, the other what
      // was lost and what survived elsewhere), and collapsing them would blur that distinction in the
      // history for no benefit — nothing here depends on them being atomic with each other.
      if (Object.keys(toGrant).length) {
        await grantAccess({
          users: [user],
          request: { directPermissions: toGrant },
          directory,
          actor,
          reason: checklistReason.trim(),
          label: `Grant direct permissions to ${user.name || user.id}`,
        });
      }
      if (Object.keys(toRevoke).length) {
        await revokeAccess({
          users: [user],
          request: { directPermissions: toRevoke },
          directory,
          actor,
          reason: checklistReason.trim(),
          label: `Revoke direct permissions from ${user.name || user.id}`,
        });
      }

      discardChecklistChanges();
      await state.refresh();
      toast({
        title: 'Permissions updated',
        description:
          `${Object.values(toGrant).reduce((sum, actions) => sum + actions.length, 0)} granted, ` +
          `${Object.values(toRevoke).reduce((sum, actions) => sum + actions.length, 0)} revoked.`,
      });
    } catch (error) {
      // Kept open with the reason and every staged tick intact — a partial failure here (the grant
      // half committed, the revoke half did not, or vice versa) is exactly when the administrator
      // most needs to see what is still pending rather than lose it to a closed panel.
      setChecklistError(error instanceof Error ? error.message : 'Nothing more was saved.');
    } finally {
      setChecklistSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <AccessBackLink href="/settings/access-management" label="Back to Access Control Center" />
          <div className="min-w-0">
            <h1 className="break-words text-lg font-semibold tracking-tight text-slate-800 sm:text-xl">
              {user.name || user.email}
            </h1>
            <p className="text-sm text-muted-foreground">Access profile · everything this user can do, and why</p>
          </div>
        </div>
        {/* Full-width on a phone, natural width from `sm` up. */}
        <div className="flex w-full flex-wrap gap-2 sm:w-auto [&>*]:flex-1 sm:[&>*]:flex-none">
          <Button asChild size="sm">
            <Link href={`/settings/access-management?assignTo=${user.id}`}>
              <ShieldPlus className="mr-1.5 h-4 w-4" />
              Add access
            </Link>
          </Button>
          {canRevoke && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSuspendOpen(true)}
              className={layerSuspended ? undefined : 'text-amber-700'}
            >
              {layerSuspended ? (
                <>
                  <PlayCircle className="mr-1.5 h-4 w-4" />
                  Resume additional access
                </>
              ) : (
                <>
                  <PauseCircle className="mr-1.5 h-4 w-4" />
                  Suspend additional access
                </>
              )}
            </Button>
          )}
          {/*
            The account itself, as distinct from the additive layer above: disabled, the user cannot
            sign in at all. Never offered on your own profile — you would only lock yourself out.
          */}
          {canRevoke && !isSelf && (
            <Button
              variant="outline"
              size="sm"
              onClick={openAccountDialog}
              className={
                accountInactive
                  ? 'text-emerald-700'
                  : 'border-destructive/30 text-destructive hover:bg-destructive/5 hover:text-destructive'
              }
            >
              {accountInactive ? (
                <>
                  <UserCheck className="mr-1.5 h-4 w-4" />
                  Reactivate account
                </>
              ) : (
                <>
                  <UserX className="mr-1.5 h-4 w-4" />
                  Disable account
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {accountInactive && (
        <div className="rounded-xl border border-rose-200 bg-rose-50/80 px-3 py-2.5 text-sm text-rose-900">
          <p className="font-semibold">
            {user.deactivation?.until
              ? `This account is disabled until ${formatGrantDate(user.deactivation.until)}.`
              : 'This account is disabled.'}
          </p>
          <p className="text-xs">
            They cannot sign in
            {user.deactivation?.until ? ' until then — it reactivates on its own after that date' : ''}.
            {user.deactivation
              ? ` Disabled by ${user.deactivation.deactivatedByName} on ${formatGrantDate(user.deactivation.deactivatedAt)} — “${user.deactivation.reason}”.`
              : ' Roles and grants are kept, and come back when the account is reactivated.'}
          </p>
        </div>
      )}

      {layerSuspended && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2.5 text-sm text-amber-900">
          <p className="font-semibold">Additional access is suspended for this user.</p>
          <p className="text-xs">
            Everything granted through this layer is inactive. Their base role — {user.role || 'none'} —
            is unaffected, so they keep the access they had before any of this was assigned.
          </p>
        </div>
      )}

      <Tabs defaultValue="access">
        <TabsList className="flex h-auto w-full sm:inline-flex sm:h-10 sm:w-auto">
          <TabsTrigger value="access" className="flex-1 shrink-0 text-xs sm:flex-none">Effective access</TabsTrigger>
          <TabsTrigger value="grants" className="flex-1 shrink-0 text-xs sm:flex-none">Grants</TabsTrigger>
          <TabsTrigger value="history" className="flex-1 shrink-0 text-xs sm:flex-none">History</TabsTrigger>
        </TabsList>

        <TabsContent value="access" className="mt-3 space-y-3">
          <AccessCard>
            <CardHeader className="px-4 py-3">
              <CardTitle className="text-sm">Employee information</CardTitle>
              <CardDescription className="text-xs">
                {employee
                  ? 'From the employee master, matched on email address.'
                  : 'No matching employee record — department and designation come only from access grants.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 px-4 pb-4 sm:grid-cols-3 lg:grid-cols-4">
              <HrField label="Employee ID">{employee?.employeeId}</HrField>
              <HrField label="Email">{user.email}</HrField>
              <HrField label="Mobile">{user.mobile !== 'N/A' ? user.mobile : employee?.phone}</HrField>
              <HrField label="Department">{employee?.department}</HrField>
              <HrField label="Designation">{employee?.designation}</HrField>
              <HrField label="Date of joining">{employee?.dateOfJoin}</HrField>
              <HrField label="Account status">
                {accountInactive && user.deactivation?.until
                  ? `Inactive until ${formatGrantDate(user.deactivation.until)}`
                  : (user.status ?? 'Active')}
              </HrField>
              <HrField label="Session length">
                {user.theme?.sessionDuration ? `${user.theme.sessionDuration} minutes` : 'Default (60 minutes)'}
              </HrField>
            </CardContent>
          </AccessCard>

          <GreytHRConnectionCard user={user} />

          <UserEffectiveAccessPanel
            user={user}
            access={access}
            registry={registry}
            departmentName={(id) => departments.find((department) => department.id === id)?.name ?? id}
            projectName={(id) => projects.find((project) => project.id === id)?.projectName ?? id}
            term={term}
            onTermChange={setTerm}
          />
        </TabsContent>

        <TabsContent value="grants" className="mt-3 space-y-3">
          {/* Base role — read-only here, deliberately */}
          <AccessCard>
            <CardHeader className="px-4 py-3">
              <CardTitle className="text-sm">Base role</CardTitle>
              <CardDescription className="text-xs">
                The user's primary role, stored on their own record. Changed in User Management, never
                from here — this screen only ever adds on top of it.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-2 px-4 pb-4">
              {user.role ? (
                <RoleBadge name={user.role} kind="base" />
              ) : (
                <span className="text-xs text-muted-foreground">No primary role assigned.</span>
              )}
              <Button asChild variant="outline" size="sm" className="h-7 text-xs">
                <Link href="/settings/user-management">Change in User Management</Link>
              </Button>
            </CardContent>
          </AccessCard>

          {/* Additional roles */}
          <GrantSection
            title="Additional roles"
            icon={Layers}
            description="Granted on top of the base role. Removing one only takes away what no other source provides."
            empty="No additional roles."
          >
            {(grant?.additionalRoles ?? []).map((assignment) => (
              <GrantRow
                key={assignment.roleId}
                title={assignment.roleName}
                meta={[
                  assignment.assignedByName ? `assigned by ${assignment.assignedByName}` : null,
                  assignment.assignedAt ? formatGrantDate(assignment.assignedAt) : null,
                  assignment.reason ? `“${assignment.reason}”` : null,
                  assignment.batchId ?? null,
                ]}
                onRemove={
                  canRevoke
                    ? () =>
                        setRemoval({
                          roleIds: [assignment.roleId],
                          projectIds: [],
                          temporaryIds: [],
                          directPermissions: {},
                        })
                    : undefined
                }
              />
            ))}
          </GrantSection>

          {/*
            The permission checklist.

            Requested as a specific interaction: every module collapsed, opening one page-wise —
            module, then page, then action — with a tick to grant and an untick to revoke, and
            opening a different module closes whichever was open. `AccessChecklist` owns that
            interaction; this page owns staging the changes and saving them, because the check for
            "is this actually editable" needs `access.sources`, which only this page's own data has.
          */}
          <AccessCard>
            <CardHeader className="px-4 py-3">
              <CardTitle className="flex items-center gap-1.5 text-sm">
                <KeyRound className="h-4 w-4 text-indigo-600" />
                Permissions
              </CardTitle>
              <CardDescription className="text-xs">
                Every module, collapsed — open one to see its pages. A locked, ticked box is held
                through a role, department, project or temporary grant; remove it from that section
                below instead of here. An open box tickable here is either unheld, or held directly and
                revocable directly.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 px-4 pb-4">
              <AccessChecklist
                registry={registry}
                access={access}
                pending={pendingChanges}
                onToggle={toggleChecklistAction}
                canGrant={canAssign}
                canRevoke={canRevoke}
              />
              <AccessChecklistSaveBar
                pending={pendingChanges}
                reason={checklistReason}
                onReasonChange={setChecklistReason}
                onSave={() => void saveChecklistChanges()}
                onDiscard={discardChecklistChanges}
                saving={checklistSaving}
                error={checklistError}
              />
            </CardContent>
          </AccessCard>

          {/* Projects */}
          <GrantSection
            title="Project & site access"
            icon={FolderKanban}
            description="Scoped access — these permissions apply only within the project."
            empty="No project restriction. This user can reach every project their permissions allow."
          >
            {(grant?.projectAccess ?? []).map((entry) => (
              <GrantRow
                key={entry.projectId}
                title={
                  entry.projectName ||
                  projects.find((project) => project.id === entry.projectId)?.projectName ||
                  entry.projectId
                }
                meta={[
                  entry.assignedByName ? `assigned by ${entry.assignedByName}` : null,
                  entry.assignedAt ? formatGrantDate(entry.assignedAt) : null,
                ]}
                onRemove={
                  canRevoke
                    ? () =>
                        setRemoval({
                          roleIds: [],
                          projectIds: [entry.projectId],
                          temporaryIds: [],
                          directPermissions: {},
                        })
                    : undefined
                }
              />
            ))}
          </GrantSection>

          {/* Departments / designations */}
          <GrantSection
            title="Department & designation membership"
            icon={Building2}
            description="Whatever these groups grant reaches this user automatically."
            empty="Not a member of any access-granting department or designation."
          >
            {[
              ...(grant?.departmentIds ?? []).map((id) => ({
                key: `dept-${id}`,
                label: departments.find((department) => department.id === id)?.name ?? id,
                kind: 'Department',
              })),
              ...(grant?.designations ?? []).map((designation) => ({
                key: `desig-${designation}`,
                label: designation,
                kind: 'Designation',
              })),
            ].map((entry) => (
              <GrantRow key={entry.key} title={entry.label} subtitle={entry.kind} meta={[]} />
            ))}
          </GrantSection>

          {/* Temporary */}
          <GrantSection
            title="Temporary access"
            icon={CalendarClock}
            description="Lapses automatically. Expired grants stay listed so the audit history survives."
            empty="No temporary access."
          >
            {(grant?.temporaryAccess ?? []).map((entry) => {
              const grantState = temporaryGrantState(entry);
              return (
                <GrantRow
                  key={entry.id}
                  title={entry.roleName || 'Direct permissions'}
                  subtitle={`${formatGrantDate(entry.startAt)} → ${formatGrantDate(entry.expiresAt)}`}
                  badge={grantState}
                  badgeTone={
                    grantState === 'Active' ? 'amber' : grantState === 'Upcoming' ? 'sky' : 'slate'
                  }
                  meta={[
                    entry.reason ? `“${entry.reason}”` : null,
                    entry.approvedByName ? `approved by ${entry.approvedByName}` : null,
                    entry.revokedAt ? `revoked ${formatGrantDate(entry.revokedAt)}` : null,
                  ]}
                  onRemove={
                    canRevoke && grantState === 'Active'
                      ? () =>
                          setRemoval({
                            roleIds: [],
                            projectIds: [],
                            temporaryIds: [entry.id],
                            directPermissions: {},
                          })
                      : undefined
                  }
                />
              );
            })}
          </GrantSection>
        </TabsContent>

        <TabsContent value="history" className="mt-3">
          <AuditHistory state={state} initialUserId={userId} />
        </TabsContent>
      </Tabs>

      <RemovalPreviewDialog
        open={!!removal}
        onOpenChange={(open) => !open && setRemoval(null)}
        users={[user]}
        roleIdsToRemove={removal?.roleIds ?? []}
        projectIdsToRemove={removal?.projectIds ?? []}
        temporaryIdsToRemove={removal?.temporaryIds ?? []}
        directPermissionsToRemove={removal?.directPermissions}
        roles={directory.roles}
        grants={directory.grants}
        scopeGrants={directory.scopeGrants}
        onConfirm={doRevoke}
      />

      <SuspendLayerDialog
        open={suspendOpen}
        onOpenChange={setSuspendOpen}
        suspended={layerSuspended}
        userName={user.name || user.email || user.id}
        baseRoleName={user.role}
        onConfirm={async (reason) => {
          await setAccessLayerStatus(user, layerSuspended ? 'Active' : 'Suspended', actor, reason);
          await state.refresh();
          toast({
            title: layerSuspended ? 'Additional access resumed' : 'Additional access suspended',
            description: 'The base role was not changed.',
          });
        }}
      />

      <AccountStatusDialog
        open={accountOpen}
        onOpenChange={setAccountOpen}
        userName={user.name || user.email || user.id}
        inactive={accountInactive}
        guard={accountGuard}
        onConfirm={async ({ until, reason }) => {
          if (accountInactive) await reactivateUserAccount(user, actor, reason);
          else await deactivateUserAccount({ user, until, reason, actor });
          await state.refresh();
          toast({
            title: accountInactive
              ? 'Account reactivated'
              : until
                ? `Account disabled until ${formatGrantDate(until)}`
                : 'Account disabled',
            description: accountInactive
              ? 'They can sign in again now, with everything they had.'
              : 'They are signed out on their next request and cannot sign in. Roles and grants are kept.',
          });
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Small presentational pieces
 * ---------------------------------------------------------------------------------------------- */

/**
 * The greytHR connection for one account.
 *
 * Read-only here on purpose. Linking is a reconciliation job — you need to see who else claims an
 * employee before you can safely claim it — so the actions live on the linking console and this card
 * links out to it. Duplicating a link button here would mean duplicating the conflict check too, and
 * a second implementation of that check is exactly how a user ends up double-linked.
 */
function GreytHRConnectionCard({ user }: { user: User }) {
  const link = user.greytHR;
  const connected = Boolean(user.employeeId);

  return (
    <AccessCard>
      <CardHeader className="px-4 py-3">
        <CardTitle className="flex items-center gap-1.5 text-sm">
          <Link2 className={cn('h-4 w-4', connected ? 'text-emerald-600' : 'text-slate-400')} />
          greytHR connection
          <Badge
            variant="outline"
            className={cn(
              'text-[10px] font-normal',
              connected
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-slate-200 bg-slate-100 text-slate-600',
            )}
          >
            {connected ? 'Connected' : 'Not connected'}
          </Badge>
        </CardTitle>
        <CardDescription className="text-xs">
          {connected
            ? 'HR data follows this employee record. Roles and permissions are owned here and are never written by greytHR.'
            : 'No employee record is attached, so a resignation in greytHR will not deactivate this account.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 px-4 pb-4">
        {connected && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <HrField label="greytHR employee ID">{user.employeeId}</HrField>
            <HrField label="Employee no.">{user.employeeNo || '—'}</HrField>
            <HrField label="Linked">
              {link?.linkedAt ? new Date(link.linkedAt).toLocaleDateString('en-IN') : '—'}
            </HrField>
            <HrField label="How">{link ? linkMethodLabel(link.method) : '—'}</HrField>
          </div>
        )}

        {/* A previous link, kept after unlinking so "it used to point at E1401" stays answerable. */}
        {!connected && link?.employeeId && (
          <p className="text-xs text-amber-700">
            Previously linked to {link.employeeNo || link.employeeId}
            {link.unlinkedAt ? ` until ${new Date(link.unlinkedAt).toLocaleDateString('en-IN')}` : ''}
            {link.unlinkReason ? ` — ${link.unlinkReason}` : ''}.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {connected && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/employee/${user.employeeId}`}>View greytHR profile</Link>
            </Button>
          )}
          <Button asChild variant="outline" size="sm">
            <Link href="/settings/user-management/greythr-linking">
              {connected ? 'Manage link' : 'Link an employee'}
            </Link>
          </Button>
        </div>
      </CardContent>
    </AccessCard>
  );
}

function GrantSection({
  title,
  description,
  icon: Icon,
  empty,
  children,
}: {
  title: string;
  description: string;
  icon: React.ElementType;
  empty: string;
  children: React.ReactNode;
}) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <AccessCard>
      <CardHeader className="px-4 py-3">
        <CardTitle className="flex items-center gap-1.5 text-sm">
          <Icon className="h-4 w-4 text-indigo-600" />
          {title}
          {items.length > 0 && (
            <Badge variant="outline" className="text-[10px] text-slate-500">{items.length}</Badge>
          )}
        </CardTitle>
        <CardDescription className="text-xs">{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1.5 px-4 pb-4">
        {items.length ? items : <p className="text-xs text-muted-foreground">{empty}</p>}
      </CardContent>
    </AccessCard>
  );
}

function GrantRow({
  title,
  subtitle,
  badge,
  badgeTone = 'slate',
  meta,
  onRemove,
  /** Names what a click actually revokes — "Revoke Delete" rather than a bare "Remove". */
  removeLabel,
}: {
  title: string;
  subtitle?: string;
  badge?: string;
  badgeTone?: 'slate' | 'amber' | 'sky';
  meta: Array<string | null>;
  onRemove?: () => void;
  removeLabel?: string;
}) {
  const visibleMeta = meta.filter(Boolean) as string[];
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-white bg-white/80 px-2.5 py-2">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-slate-800">
          {title}
          {badge && (
            <Badge
              variant="outline"
              className={cn(
                'text-[10px]',
                badgeTone === 'amber'
                  ? 'border-amber-200 bg-amber-50 text-amber-800'
                  : badgeTone === 'sky'
                    ? 'border-sky-200 bg-sky-50 text-sky-700'
                    : 'border-slate-200 bg-white text-slate-500',
              )}
            >
              {badge}
            </Badge>
          )}
        </div>
        {subtitle && <p className="text-xs text-slate-600">{subtitle}</p>}
        {visibleMeta.length > 0 && (
          <p className="mt-0.5 text-[11px] text-muted-foreground">{visibleMeta.join(' · ')}</p>
        )}
      </div>
      {onRemove && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 text-xs text-destructive max-sm:w-full max-sm:justify-start"
          onClick={onRemove}
        >
          <Trash2 className="mr-1 h-3.5 w-3.5" />
          {removeLabel ? `Revoke ${removeLabel}` : 'Remove'}
        </Button>
      )}
    </div>
  );
}

function SuspendLayerDialog({
  open,
  onOpenChange,
  suspended,
  userName,
  baseRoleName,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suspended: boolean;
  userName: string;
  baseRoleName?: string | null;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={hrDialog.content}>
        <DialogHeader className={hrDialog.header}>
          <DialogTitle>
            {suspended ? `Resume additional access for ${userName}` : `Suspend additional access for ${userName}`}
          </DialogTitle>
          <DialogDescription>
            {suspended
              ? 'Every additional role, direct permission, project grant and active temporary grant becomes effective again.'
              : `Everything granted through this layer stops applying. Their base role (${baseRoleName || 'none'}) is untouched, so they keep the access they had before anything was added.`}
          </DialogDescription>
        </DialogHeader>

        <div className={hrDialog.body}>
          {error && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-sm font-semibold text-destructive">Nothing was changed</p>
              <p className="mt-0.5 text-xs text-destructive">{error}</p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="suspend-reason">Reason *</Label>
            <Textarea
              id="suspend-reason"
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={suspended ? 'Why is it being restored?' : 'e.g. On long leave — restore in September'}
            />
          </div>
        </div>

        <DialogFooter className={hrDialog.footer}>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button
            variant={suspended ? 'default' : 'destructive'}
            disabled={saving || !reason.trim()}
            onClick={async () => {
              setSaving(true);
              setError(null);
              try {
                await onConfirm(reason.trim());
                setReason('');
                onOpenChange(false);
              } catch (err) {
                // Nothing changed, so the dialog stays open and says why rather than letting the
                // rejection escape as a runtime overlay.
                setError(err instanceof Error ? err.message : 'The change could not be saved.');
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {suspended ? 'Resume' : 'Suspend'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Disable an account — for a while or for good — or bring it back.
 *
 * The temporary option exists because "on leave until October" is the common case and a permanent
 * deactivation that somebody has to remember to undo is how people come back to find they cannot
 * sign in. Both need a reason: the audit trail records why, and "why was I disabled?" is a question
 * that gets asked.
 */
function AccountStatusDialog({
  open,
  onOpenChange,
  userName,
  inactive,
  guard,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userName: string;
  /** Currently disabled — the dialog offers reactivation instead. */
  inactive: boolean;
  /** Why disabling must not go ahead (the last administrator), or null. */
  guard: string | null;
  onConfirm: (input: { until: string | null; reason: string }) => Promise<void>;
}) {
  const [mode, setMode] = useState<'temporary' | 'permanent'>('temporary');
  const [untilDate, setUntilDate] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const blocked = !inactive && guard !== null;
  const dateMissing = !inactive && mode === 'temporary' && !(untilDate && untilDate >= today);
  const canSubmit = !saving && !blocked && !dateMissing && reason.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={hrDialog.content}>
        <DialogHeader className={hrDialog.header}>
          <DialogTitle>{inactive ? `Reactivate ${userName}` : `Disable ${userName}`}</DialogTitle>
          <DialogDescription>
            {inactive
              ? 'They can sign in again straight away, with every role and grant they had before.'
              : 'They are signed out and cannot sign in. Nothing is deleted — roles, grants and history stay, and come back when the account is reactivated.'}
          </DialogDescription>
        </DialogHeader>

        <div className={hrDialog.body}>
          {blocked && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <p className="font-semibold">Cannot disable this account</p>
              <p className="mt-0.5 text-xs">{guard}</p>
            </div>
          )}

          {!inactive && (
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { id: 'temporary', label: 'Temporarily', hint: 'Comes back on its own after a date' },
                  { id: 'permanent', label: 'Permanently', hint: 'Until somebody reactivates it' },
                ] as const
              ).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setMode(option.id)}
                  aria-pressed={mode === option.id}
                  className={cn(
                    'rounded-xl border px-3 py-2 text-left transition-colors',
                    mode === option.id
                      ? 'border-indigo-300 bg-indigo-50 text-indigo-900'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                  )}
                >
                  <span className="block text-sm font-semibold">{option.label}</span>
                  <span className="block text-[11px] text-muted-foreground">{option.hint}</span>
                </button>
              ))}
            </div>
          )}

          {!inactive && mode === 'temporary' && (
            <div className="space-y-1.5">
              <Label htmlFor="disable-until">Disabled until *</Label>
              <Input
                id="disable-until"
                type="date"
                min={today}
                value={untilDate}
                onChange={(event) => setUntilDate(event.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                The account reactivates itself after the end of this day — nobody has to remember.
              </p>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-sm font-semibold text-destructive">Nothing was changed</p>
              <p className="mt-0.5 text-xs text-destructive">{error}</p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="account-reason">Reason *</Label>
            <Textarea
              id="account-reason"
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={inactive ? 'e.g. Back from leave' : 'e.g. On long leave until October'}
            />
          </div>
        </div>

        <DialogFooter className={hrDialog.footer}>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant={inactive ? 'default' : 'destructive'}
            disabled={!canSubmit}
            onClick={async () => {
              setSaving(true);
              setError(null);
              try {
                // End of the chosen day, local time — the same reading the temporary grants use.
                const until =
                  !inactive && mode === 'temporary' ? new Date(`${untilDate}T23:59:59`).toISOString() : null;
                await onConfirm({ until, reason: reason.trim() });
                setReason('');
                setUntilDate('');
                setMode('temporary');
                onOpenChange(false);
              } catch (err) {
                // Nothing changed, so the dialog stays open and says why.
                setError(err instanceof Error ? err.message : 'The change could not be saved.');
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {inactive ? 'Reactivate account' : mode === 'temporary' ? 'Disable until that date' : 'Disable account'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
