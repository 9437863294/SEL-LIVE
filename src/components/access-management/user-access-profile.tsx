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
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
import { revokeAccess, setAccessLayerStatus, type AccessActor } from '@/lib/access-control-service';
import { linkMethodLabel } from '@/lib/greythr-linking';
import type { User } from '@/lib/types';
import type { AccessDirectoryState } from '@/hooks/useAccessDirectory';
import { UserEffectiveAccessPanel } from './effective-access';
import { RemovalPreviewDialog } from './assignment-preview';
import { AuditHistory } from './audit-history';
import { PermissionPairList, RoleBadge } from './access-ui';

export function UserAccessProfile({
  userId,
  state,
  actor,
  canRevoke,
}: {
  userId: string;
  state: AccessDirectoryState;
  actor: AccessActor;
  canRevoke: boolean;
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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <Link href="/settings/access-management">
            <Button variant="ghost" size="icon" className="rounded-full bg-white/70 shadow-sm backdrop-blur">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-slate-800 sm:text-xl">
              {user.name || user.email}
            </h1>
            <p className="text-sm text-muted-foreground">Access profile · everything this user can do, and why</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/settings/access-management?assignTo=${user.id}`}>
            <Button size="sm">
              <ShieldPlus className="mr-1.5 h-4 w-4" />
              Add access
            </Button>
          </Link>
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
        </div>
      </div>

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
        <TabsList className="grid w-full grid-cols-3 sm:w-auto">
          <TabsTrigger value="access" className="text-xs">Effective access</TabsTrigger>
          <TabsTrigger value="grants" className="text-xs">Grants</TabsTrigger>
          <TabsTrigger value="history" className="text-xs">History</TabsTrigger>
        </TabsList>

        <TabsContent value="access" className="mt-3 space-y-3">
          <Card className="border-white/60 bg-white/85 shadow-sm backdrop-blur-sm">
            <CardHeader className="px-4 py-3">
              <CardTitle className="text-sm">Employee information</CardTitle>
              <CardDescription className="text-xs">
                {employee
                  ? 'From the employee master, matched on email address.'
                  : 'No matching employee record — department and designation come only from access grants.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 px-4 pb-4 sm:grid-cols-3 lg:grid-cols-4">
              <HrField label="Employee ID">{employee?.employeeId}</HrField>
              <HrField label="Email">{user.email}</HrField>
              <HrField label="Mobile">{user.mobile !== 'N/A' ? user.mobile : employee?.phone}</HrField>
              <HrField label="Department">{employee?.department}</HrField>
              <HrField label="Designation">{employee?.designation}</HrField>
              <HrField label="Date of joining">{employee?.dateOfJoin}</HrField>
              <HrField label="Account status">{user.status ?? 'Active'}</HrField>
              <HrField label="Session length">
                {user.theme?.sessionDuration ? `${user.theme.sessionDuration} minutes` : 'Default (60 minutes)'}
              </HrField>
            </CardContent>
          </Card>

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
          <Card className="border-white/60 bg-white/85 shadow-sm backdrop-blur-sm">
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
              <Link href="/settings/user-management">
                <Button variant="outline" size="sm" className="h-7 text-xs">
                  Change in User Management
                </Button>
              </Link>
            </CardContent>
          </Card>

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

          {/* Direct permissions */}
          <GrantSection
            title="Direct permissions"
            icon={KeyRound}
            description="Granted straight to this person, outside any role."
            empty="No direct permissions."
          >
            {(grant?.directPermissions ?? []).map((entry, index) => (
              <GrantRow
                key={`${entry.resource}-${index}`}
                title={entry.resource.split('.').join(' › ')}
                subtitle={entry.actions.join(', ')}
                meta={[
                  entry.assignedByName ? `assigned by ${entry.assignedByName}` : null,
                  entry.assignedAt ? formatGrantDate(entry.assignedAt) : null,
                  entry.expiresAt ? `expires ${formatGrantDate(entry.expiresAt)}` : null,
                  entry.reason ? `“${entry.reason}”` : null,
                ]}
                onRemove={
                  canRevoke
                    ? () =>
                        setRemoval({
                          roleIds: [],
                          projectIds: [],
                          temporaryIds: [],
                          directPermissions: { [entry.resource]: entry.actions },
                        })
                    : undefined
                }
              />
            ))}
          </GrantSection>

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
    <Card className="border-white/60 bg-white/85 shadow-sm backdrop-blur-sm">
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
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
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
    </Card>
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
    <Card className="border-white/60 bg-white/85 shadow-sm backdrop-blur-sm">
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
    </Card>
  );
}

function GrantRow({
  title,
  subtitle,
  badge,
  badgeTone = 'slate',
  meta,
  onRemove,
}: {
  title: string;
  subtitle?: string;
  badge?: string;
  badgeTone?: 'slate' | 'amber' | 'sky';
  meta: Array<string | null>;
  onRemove?: () => void;
}) {
  const visibleMeta = meta.filter(Boolean) as string[];
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-white bg-white/80 px-2.5 py-2">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-slate-800">
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
        </p>
        {subtitle && <p className="text-xs text-slate-600">{subtitle}</p>}
        {visibleMeta.length > 0 && (
          <p className="mt-0.5 text-[11px] text-muted-foreground">{visibleMeta.join(' · ')}</p>
        )}
      </div>
      {onRemove && (
        <Button variant="ghost" size="sm" className="h-7 shrink-0 text-xs text-destructive" onClick={onRemove}>
          <Trash2 className="mr-1 h-3.5 w-3.5" />
          Remove
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

