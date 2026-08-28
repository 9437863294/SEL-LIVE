'use client';

/**
 * The gate between choosing an assignment and performing it (§15, §16, §26, §34).
 *
 * Nothing is written until an administrator has seen exactly what will change, per user, and
 * confirmed it. The numbers are computed by `previewAssignment` — the same resolver that decides
 * access at runtime — so what this dialog says will happen is what happens, not an estimate of it.
 *
 * The single most important line on the screen is "Existing permissions removed: 0". It is a
 * measurement of the projected result, not a claim; if the projection ever showed otherwise, the
 * confirm button disables and the reason is spelled out. That is the whole point of §47 made
 * operational.
 */

import * as React from 'react';
import { useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, Loader2, ShieldAlert, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { hrDialog } from '@/components/hr/hr-ui';
import { cn } from '@/lib/utils';
import type { Project, Role, User } from '@/lib/types';
import {
  countPermissions,
  detectSodConflicts,
  isProtectedRole,
  normalizeUserAccessGrant,
  previewAssignment,
  removeAccessFromGrant,
  type AccessAssignmentRequest,
  type AccessTemplate,
  type AssignmentPreview,
  type PermissionMap,
  type RoleLike,
  type ScopeGrantConfig,
  type UserAccessGrant,
} from '@/lib/access-control';
import type { GrantAccessResult } from '@/lib/access-control-service';
import { DiffSummary, PermissionPairList, RemovalReadout, StatLine } from './access-ui';

export interface AssignmentPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  users: User[];
  request: AccessAssignmentRequest;
  roles: Role[];
  grants: Record<string, UserAccessGrant>;
  scopeGrants: ScopeGrantConfig[];
  templates: AccessTemplate[];
  projects: Project[];
  /** Resolves with the service result, so this dialog can show the §34 summary itself. */
  onConfirm: (reason: string) => Promise<GrantAccessResult>;
  title?: string;
  submitLabel?: string;
}

export function AssignmentPreviewDialog({
  open,
  onOpenChange,
  users,
  request,
  roles,
  grants,
  scopeGrants,
  templates,
  projects,
  onConfirm,
  title = 'Review access changes',
  submitLabel = 'Confirm & Add Access',
}: AssignmentPreviewDialogProps) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<GrantAccessResult | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [protectedAck, setProtectedAck] = useState('');

  const preview: AssignmentPreview = useMemo(
    () =>
      previewAssignment(
        users.map((user) => ({ user, grant: grants[user.id] })),
        request,
        { roles: roles as RoleLike[], scopeGrants, templates },
      ),
    [users, request, roles, grants, scopeGrants, templates],
  );

  const selectedRoles = useMemo(
    () => (request.roleIds ?? []).map((id) => roles.find((role) => role.id === id)).filter(Boolean) as Role[],
    [request.roleIds, roles],
  );

  /**
   * A protected role (§31) needs more than a click.
   *
   * Requiring the role name to be typed is deliberately more friction than a checkbox: granting
   * Super Admin to thirty people by mis-clicking a bulk action is the failure this prevents, and a
   * checkbox is the same single gesture as the button next to it.
   */
  const protectedRoles = selectedRoles.filter((role) => isProtectedRole(role.name));
  const protectedSatisfied =
    protectedRoles.length === 0 ||
    protectedAck.trim().toLowerCase() === protectedRoles.map((role) => role.name).join(', ').toLowerCase();

  /** SoD conflicts this assignment would create that did not exist before (§46). */
  const newConflicts = useMemo(() => {
    const out: Array<{ userName: string; labels: string[] }> = [];
    for (const plan of preview.plans) {
      const before = detectSodConflicts(plan.before).map((conflict) => conflict.id);
      const after = detectSodConflicts(plan.after);
      const created = after.filter((conflict) => !before.includes(conflict.id));
      if (created.length) out.push({ userName: plan.userName, labels: created.map((c) => c.label) });
    }
    return out;
  }, [preview.plans]);

  const reasonRequired = protectedRoles.length > 0 || !!request.temporary;
  const canConfirm =
    !saving &&
    preview.blockingIssues.length === 0 &&
    preview.permissionsRemoved === 0 &&
    protectedSatisfied &&
    (!reasonRequired || reason.trim().length > 0);

  const [saveError, setSaveError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const outcome = await onConfirm(reason.trim());
      setResult(outcome);
    } catch (error) {
      /**
       * Shown in the dialog rather than as a toast, and the dialog stays open.
       *
       * A failed assignment is exactly the moment an administrator needs to know what happened and
       * that nothing was saved — `assertAdditive` throwing here, for instance, means the operation
       * was refused because it would have removed access. Letting the rejection escape produced an
       * unhandled promise and a runtime overlay, which said none of that.
       */
      setSaveError(error instanceof Error ? error.message : 'The assignment could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const close = () => {
    setResult(null);
    setReason('');
    setProtectedAck('');
    setExpanded(null);
    onOpenChange(false);
  };

  /* ---- The §34 summary, shown in place of the preview once the write succeeds ---- */

  if (result) {
    return (
      <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
        <DialogContent className={hrDialog.contentWide}>
          <DialogHeader className={hrDialog.header}>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              Access successfully updated
            </DialogTitle>
            <DialogDescription>
              Batch {result.batchId} — open it from Audit History to see every user it touched.
            </DialogDescription>
          </DialogHeader>

          <div className={hrDialog.body}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <StatLine label="Users selected" value={result.usersSelected} />
              <StatLine label="Users updated" value={result.usersUpdated} tone="emerald" />
              <StatLine label="Already had access" value={result.usersAlreadyHadAccess} />
              <StatLine label="New role assignments" value={result.roleAssignmentsAdded} tone="indigo" />
              <StatLine label="Permissions added" value={result.permissionsAdded} tone="emerald" />
              <StatLine
                label="Failed"
                value={result.usersFailed}
                tone={result.usersFailed ? 'rose' : 'slate'}
              />
            </div>

            <RemovalReadout removed={result.permissionsRemoved} />

            {result.failures.length > 0 && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
                <p className="mb-1.5 text-sm font-semibold text-destructive">
                  {result.failures.length} assignment(s) did not apply
                </p>
                <ul className="space-y-1 text-xs text-destructive">
                  {result.failures.map((failure) => (
                    <li key={failure.userId}>
                      <span className="font-medium">{failure.userName}</span> — {failure.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* One button — the phone footer's two-column grid would leave half the row empty. */}
          <DialogFooter className={cn(hrDialog.footer, 'max-sm:grid-cols-1')}>
            <Button onClick={close}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  /* ---- The preview ---- */

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      {/* Long by nature — it lists every permission being granted, per user. Capped to the viewport
          with the body scrolling, so the Confirm button cannot end up below the fold. */}
      <DialogContent className={hrDialog.contentTall}>
        <DialogHeader className={hrDialog.header}>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Nothing is saved until you confirm. Everything below is computed from the same rules that
            decide access at runtime.
          </DialogDescription>
        </DialogHeader>

        <div className={hrDialog.bodyScroll}>
          {/* Headline numbers (§15, §26) */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatLine label="Selected users" value={preview.userCount} />
            <StatLine label="Will change" value={preview.usersAffected} tone="emerald" />
            <StatLine label="Already have it" value={preview.usersAlreadyHadAccess} />
            <StatLine label="Permissions added" value={preview.permissionsAdded} tone="indigo" />
          </div>

          <RemovalReadout removed={preview.permissionsRemoved} />

          {/* What is being granted */}
          <div className="rounded-xl border border-white/70 bg-white/80 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Being granted
            </p>
            <div className="flex flex-wrap gap-1.5">
              {selectedRoles.map((role) => (
                <Badge key={role.id} variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700">
                  {role.name} · {countPermissions(role.permissions)} permissions
                </Badge>
              ))}
              {(request.templateIds ?? []).map((templateId) => {
                const template = templates.find((entry) => entry.id === templateId);
                return (
                  <Badge key={templateId} variant="outline" className="border-violet-200 bg-violet-50 text-violet-700">
                    Template · {template?.name ?? templateId}
                  </Badge>
                );
              })}
              {Object.keys(request.directPermissions ?? {}).length > 0 && (
                <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700">
                  {countPermissions(request.directPermissions)} direct permissions
                </Badge>
              )}
              {(request.projectIds ?? []).map((projectId) => (
                <Badge key={projectId} variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                  Project · {projects.find((project) => project.id === projectId)?.projectName ?? projectId}
                </Badge>
              ))}
              {(request.departmentIds ?? []).length > 0 && (
                <Badge variant="outline" className="border-cyan-200 bg-cyan-50 text-cyan-700">
                  {(request.departmentIds ?? []).length} department assignment(s)
                </Badge>
              )}
              {(request.designations ?? []).length > 0 && (
                <Badge variant="outline" className="border-teal-200 bg-teal-50 text-teal-700">
                  {(request.designations ?? []).length} designation assignment(s)
                </Badge>
              )}
              {request.temporary && (
                <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
                  Temporary · {request.temporary.startAt.slice(0, 10)} to {request.temporary.expiresAt.slice(0, 10)}
                </Badge>
              )}
            </div>
          </div>

          {/* Blocking issues and warnings */}
          {preview.blockingIssues.length > 0 && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
              <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-destructive">
                <ShieldAlert className="h-4 w-4" /> Cannot continue
              </p>
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-destructive">
                {preview.blockingIssues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </div>
          )}

          {preview.warnings.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3">
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-800">
                {preview.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}

          {newConflicts.length > 0 && (
            <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-3">
              <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-rose-800">
                <TriangleAlert className="h-4 w-4" /> Segregation-of-duties warning
              </p>
              <p className="mb-1.5 text-xs text-rose-700">
                This assignment would let the same person do both halves of a controlled process. It is
                allowed — flagged so you can decide, not blocked.
              </p>
              <ul className="space-y-0.5 text-xs text-rose-700">
                {newConflicts.slice(0, 8).map((entry) => (
                  <li key={entry.userName}>
                    <span className="font-medium">{entry.userName}</span> — {entry.labels.join('; ')}
                  </li>
                ))}
                {newConflicts.length > 8 && <li>+{newConflicts.length - 8} more users</li>}
              </ul>
            </div>
          )}

          {/* Per-user impact */}
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Per-user impact
            </p>
            <ScrollArea className="h-auto rounded-xl border border-white/70 bg-white/60 sm:h-56">
              <div className="divide-y divide-slate-100">
                {preview.plans.map((plan) => {
                  const isOpen = expanded === plan.userId;
                  return (
                    <div key={plan.userId}>
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : plan.userId)}
                        className="flex w-full items-start gap-2 px-2.5 py-2 text-left hover:bg-slate-50/70"
                      >
                        <ChevronDown
                          className={cn('mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform', isOpen && 'rotate-180')}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate text-sm font-medium text-slate-800">{plan.userName}</span>
                            {plan.noop && (
                              <Badge variant="outline" className="border-slate-200 bg-slate-50 text-[10px] text-slate-500">
                                Already assigned
                              </Badge>
                            )}
                          </div>
                          <DiffSummary
                            className="mt-1"
                            added={plan.diff.addedCount}
                            already={plan.rolesAlreadyHeld.length}
                            removed={plan.diff.removedCount}
                          />
                        </div>
                      </button>

                      {isOpen && (
                        <div className="grid gap-3 bg-slate-50/60 px-3 py-2.5 sm:grid-cols-2">
                          <div>
                            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                              Permissions being added ({plan.diff.addedCount})
                            </p>
                            <PermissionPairList pairs={plan.diff.added} emptyLabel="Nothing new" max={60} />
                          </div>
                          <div>
                            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                              Already held ({plan.rolesAlreadyHeld.length} role
                              {plan.rolesAlreadyHeld.length === 1 ? '' : 's'})
                            </p>
                            {plan.rolesAlreadyHeld.length ? (
                              <div className="flex flex-wrap gap-1">
                                {plan.rolesAlreadyHeld.map((role) => (
                                  <Badge key={role.id} variant="outline" className="text-[10px] text-slate-600">
                                    {role.name}
                                  </Badge>
                                ))}
                              </div>
                            ) : (
                              <p className="text-xs text-muted-foreground">None</p>
                            )}
                            <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                              Permissions removed
                            </p>
                            <p
                              className={cn(
                                'text-xs font-medium',
                                plan.diff.removedCount === 0 ? 'text-emerald-700' : 'text-destructive',
                              )}
                            >
                              {plan.diff.removedCount}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>

          {/* Protected-role acknowledgement (§31) */}
          {protectedRoles.length > 0 && (
            <div className="space-y-2 rounded-xl border border-rose-200 bg-rose-50/70 p-3">
              <p className="text-sm font-semibold text-rose-800">
                You are granting a protected role: {protectedRoles.map((role) => role.name).join(', ')}
              </p>
              <p className="text-xs text-rose-700">
                Type the role name{protectedRoles.length > 1 ? 's, comma separated,' : ''} to confirm.
              </p>
              <Input
                value={protectedAck}
                onChange={(event) => setProtectedAck(event.target.value)}
                placeholder={protectedRoles.map((role) => role.name).join(', ')}
              />
            </div>
          )}

          {saveError && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
                <ShieldAlert className="h-4 w-4" />
                Nothing was saved
              </p>
              <p className="mt-0.5 text-xs text-destructive">{saveError}</p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="access-reason">
              Reason {reasonRequired ? <span className="text-destructive">*</span> : <span className="text-muted-foreground">(recorded in the audit trail)</span>}
            </Label>
            <Textarea
              id="access-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              placeholder="e.g. Taking over BG approvals while Anil is on leave"
            />
          </div>
        </div>

        <DialogFooter className={hrDialog.footer}>
          <Button variant="outline" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The mirror image, for the explicit removal workflow (§17, §47).
 *
 * Separate from the dialog above rather than a mode of it. The two screens carry opposite promises —
 * one says "nothing will be lost", the other exists precisely to say what will be — and a shared
 * component with a boolean would make it far too easy for a future edit to show the reassuring copy
 * on the destructive path.
 */
export function RemovalPreviewDialog({
  open,
  onOpenChange,
  users,
  roleIdsToRemove,
  directPermissionsToRemove,
  projectIdsToRemove,
  temporaryIdsToRemove,
  roles,
  grants,
  scopeGrants,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  users: User[];
  roleIdsToRemove: string[];
  directPermissionsToRemove?: PermissionMap;
  projectIdsToRemove?: string[];
  temporaryIdsToRemove?: string[];
  roles: Role[];
  grants: Record<string, UserAccessGrant>;
  scopeGrants: ScopeGrantConfig[];
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [removalError, setRemovalError] = useState<string | null>(null);

  /**
   * Projected losses and retentions, per user.
   *
   * Runs the *same* `removeAccessFromGrant` the service will run, rather than reproducing the
   * removal here. That matters more than the duplication it saves: §17's guarantee — that a
   * permission still granted by another source survives the removal — is a property of that
   * function, and a preview computed a second way could show a loss the write does not cause, or
   * worse, miss one it does.
   */
  const impact = useMemo(
    () =>
      users.map((user) => {
        const outcome = removeAccessFromGrant(
          user,
          normalizeUserAccessGrant(user.id, grants[user.id]),
          {
            roleIds: roleIdsToRemove,
            projectIds: projectIdsToRemove,
            temporaryIds: temporaryIdsToRemove,
            directPermissions: directPermissionsToRemove,
          },
          {
            roles: roles as RoleLike[],
            scopeGrants,
            // A projection, so the actor is irrelevant — nothing is written and the revocation
            // stamps this produces are thrown away with the projected grant.
            actor: { userId: 'preview', userName: 'preview' },
          },
        );
        return {
          user,
          lost: outcome.permissionsLost,
          retained: outcome.permissionsRetainedByOtherSources,
        };
      }),
    [users, grants, roles, scopeGrants, roleIdsToRemove, projectIdsToRemove, temporaryIdsToRemove, directPermissionsToRemove],
  );

  const totalLost = impact.reduce((sum, entry) => sum + entry.lost.length, 0);
  const totalRetained = impact.reduce((sum, entry) => sum + entry.retained.length, 0);
  const unaffected = impact.filter((entry) => entry.lost.length === 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={hrDialog.contentWide}>
        <DialogHeader className={hrDialog.header}>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <ShieldAlert className="h-5 w-5" />
            Remove additional access
          </DialogTitle>
          <DialogDescription>
            This reduces what these users can do. Their base role is not touched — only access granted
            through this layer is removed.
          </DialogDescription>
        </DialogHeader>

        <div className={hrDialog.body}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatLine label="Users" value={users.length} />
            <StatLine label="Permissions removed" value={totalLost} tone={totalLost ? 'rose' : 'slate'} />
            <StatLine label="Retained elsewhere" value={totalRetained} tone="emerald" />
            <StatLine label="Lose nothing" value={unaffected.length} tone="emerald" />
          </div>

          {unaffected.length > 0 && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-xs text-emerald-800">
              <p className="font-semibold">
                {unaffected.length} user{unaffected.length === 1 ? '' : 's'} will lose nothing.
              </p>
              <p className="mt-0.5">
                Everything the removed grant gave them is still granted by another source — usually their
                base role. Their access is unchanged.
              </p>
            </div>
          )}

          <ScrollArea className="h-auto rounded-xl border border-white/70 bg-white/60 sm:h-56">
            <div className="divide-y divide-slate-100">
              {impact.map(({ user, lost, retained }) => (
                <div key={user.id} className="px-2.5 py-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-slate-800">{user.name || user.email}</span>
                    <Badge
                      variant="outline"
                      className={
                        lost.length
                          ? 'border-destructive/40 bg-destructive/10 text-[10px] text-destructive'
                          : 'border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700'
                      }
                    >
                      {lost.length ? `${lost.length} removed` : 'no change'}
                    </Badge>
                    {retained.length > 0 && (
                      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700">
                        {retained.length} still granted elsewhere
                      </Badge>
                    )}
                  </div>
                  {lost.length > 0 && (
                    <div className="mt-1">
                      <PermissionPairList pairs={lost} max={40} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>

          {removalError && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-sm font-semibold text-destructive">Nothing was removed</p>
              <p className="mt-0.5 text-xs text-destructive">{removalError}</p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="removal-reason">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="removal-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              placeholder="Why is this access being removed?"
            />
          </div>
        </div>

        <DialogFooter className={hrDialog.footer}>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={saving || !reason.trim()}
            onClick={async () => {
              setSaving(true);
              setRemovalError(null);
              try {
                await onConfirm(reason.trim());
                setReason('');
                onOpenChange(false);
              } catch (error) {
                // Kept open with the reason shown: a failed revocation means access is unchanged,
                // and the administrator needs to know that rather than see an error overlay.
                setRemovalError(error instanceof Error ? error.message : 'The removal could not be saved.');
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Remove access
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
