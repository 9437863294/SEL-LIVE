'use client';

/**
 * Access templates (§24) and scope-based access (§21).
 *
 * Two different answers to the same problem — "the same bundle of access, over and over" — and they
 * belong together because choosing between them is the decision an administrator makes here.
 *
 *   A **template** is a starting point. Applying it copies its roles and permissions onto a user; it
 *   is a shortcut for typing, and nothing links the user to the template afterwards.
 *
 *   A **scope grant** is a standing rule. "Finance gets the Finance dashboard" applies to whoever is
 *   in Finance *now*, so somebody joining the department gets it without anybody assigning anything,
 *   and somebody leaving loses it.
 *
 * Both are needed. A site engineer template saves an administrator forty clicks; a department rule
 * is what stops the fortieth new joiner from being forgotten.
 */

import * as React from 'react';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Building2, Loader2, Plus, Sparkles, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { hrDialog, HrEmptyState } from '@/components/hr/hr-ui';
import { AccessCard } from './access-ui';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  countPermissions,
  type PermissionMap,
  type ScopeGrantConfig,
} from '@/lib/access-control';
import {
  deleteAccessTemplate,
  saveScopeGrant,
  type AccessActor,
} from '@/lib/access-control-service';
import type { AccessDirectoryState } from '@/hooks/useAccessDirectory';
import { PermissionMapSummary, PermissionTree } from './permission-tree';
import { RolePicker } from './pickers';

/** Where the template editor sends you back to, from either entry point below. */
const TEMPLATES_RETURN_TO = encodeURIComponent('/settings/access-management?tab=templates');

export function TemplatesAndScopes({
  state,
  actor,
  canManage,
  onApplyTemplate,
}: {
  state: AccessDirectoryState;
  actor: AccessActor;
  canManage: boolean;
  /** Hands the template to the assignment workspace so it can be applied to selected users. */
  onApplyTemplate: (templateId: string) => void;
}) {
  return (
    <Tabs defaultValue="templates" className="space-y-3">
      <TabsList className="flex h-auto w-full sm:inline-flex sm:h-10 sm:w-auto">
        {/* Short labels on a phone — the two full ones together are wider than the screen. */}
        <TabsTrigger value="templates" className="flex-1 shrink-0 text-xs sm:flex-none">
          <span className="sm:hidden">Templates</span>
          <span className="hidden sm:inline">Access templates</span>
        </TabsTrigger>
        <TabsTrigger value="scopes" className="flex-1 shrink-0 text-xs sm:flex-none">
          <span className="sm:hidden">Scope rules</span>
          <span className="hidden sm:inline">Department &amp; designation rules</span>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="templates">
        <TemplateManager state={state} canManage={canManage} onApplyTemplate={onApplyTemplate} />
      </TabsContent>

      <TabsContent value="scopes">
        <ScopeGrantManager state={state} actor={actor} canManage={canManage} />
      </TabsContent>
    </Tabs>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Templates (§24)
 * ---------------------------------------------------------------------------------------------- */

function TemplateManager({
  state,
  canManage,
  onApplyTemplate,
}: {
  state: AccessDirectoryState;
  canManage: boolean;
  onApplyTemplate: (templateId: string) => void;
}) {
  const { toast } = useToast();
  const { directory, projects, registry } = state;

  /**
   * Deleting is safe for existing holders (applying a template copies, nothing stays linked), but it
   * is still the one destructive click on this screen — so it confirms like every other destructive
   * action in the module instead of firing straight from a ghost icon.
   */
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const templates = useMemo(
    () => directory.templates.filter((template) => template.active !== false),
    [directory.templates],
  );

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleteBusy(true);
    try {
      await deleteAccessTemplate(pendingDelete.id);
      await state.refresh();
      toast({ title: 'Template removed', description: 'Users who already had it keep their access.' });
      setPendingDelete(null);
    } catch (error) {
      toast({
        title: 'Could not remove the template',
        description: error instanceof Error ? error.message : 'Unexpected error.',
        variant: 'destructive',
      });
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          A reusable bundle of roles, permissions and projects. Applying one adds it on top of whatever
          the user already has.
        </p>
        {canManage && (
          // A link, not a dialog trigger — this form carries a full permission tree, a role picker
          // and a project chooser, and comes back here with `?returnTo=`.
          <Button asChild size="sm" className="max-sm:w-full">
            <Link href={`/settings/access-management/templates/new?returnTo=${TEMPLATES_RETURN_TO}`}>
              <Plus className="mr-1.5 h-4 w-4" />
              New template
            </Link>
          </Button>
        )}
      </div>

      {templates.length === 0 ? (
        <HrEmptyState
          icon={Sparkles}
          title="No templates yet"
          description="Create one for the roles you set up repeatedly — Site Engineer, Finance Executive, Store Keeper — and assigning a new joiner becomes one click."
          action={
            canManage ? (
              <Button asChild size="sm">
                <Link href={`/settings/access-management/templates/new?returnTo=${TEMPLATES_RETURN_TO}`}>
                  <Plus className="mr-1.5 h-4 w-4" />
                  New template
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {templates.map((template) => (
            <AccessCard key={template.id}>
              <CardContent className="space-y-2.5 p-3.5">
                <div>
                  <p className="truncate text-sm font-semibold text-slate-800">{template.name}</p>
                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    {template.description || 'No description.'}
                  </p>
                </div>

                <div className="flex flex-wrap gap-1">
                  {(template.roleIds ?? []).map((roleId) => {
                    const role = directory.roles.find((entry) => entry.id === roleId);
                    return (
                      <Badge key={roleId} variant="outline" className="border-indigo-200 bg-indigo-50 text-[10px] text-indigo-700">
                        {role?.name ?? roleId}
                      </Badge>
                    );
                  })}
                  {(template.projectIds ?? []).map((projectId) => (
                    <Badge key={projectId} variant="outline" className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700">
                      {projects.find((project) => project.id === projectId)?.projectName ?? projectId}
                    </Badge>
                  ))}
                </div>

                <PermissionMapSummary
                  map={(template.permissions ?? {}) as PermissionMap}
                  registry={registry}
                  emptyLabel="No direct permissions — roles only"
                  max={5}
                />

                <p className="text-[11px] text-muted-foreground">
                  {(template.roleIds ?? []).length} role(s) · {countPermissions(template.permissions)} direct
                  permission(s)
                </p>

                <div className="flex flex-wrap gap-1.5 border-t border-slate-100 pt-2.5 [&>*]:flex-1 sm:[&>*]:flex-none">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 flex-1 text-xs"
                    onClick={() => onApplyTemplate(template.id)}
                  >
                    Apply to users
                  </Button>
                  {canManage && (
                    <>
                      <Button asChild variant="outline" size="sm" className="h-8 text-xs">
                        <Link
                          href={`/settings/access-management/templates/${template.id}?returnTo=${TEMPLATES_RETURN_TO}`}
                        >
                          Edit
                        </Link>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs text-destructive"
                        title="Delete template"
                        aria-label={`Delete ${template.name}`}
                        onClick={() => setPendingDelete({ id: template.id, name: template.name })}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span className="ml-1 sm:hidden">Delete</span>
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </AccessCard>
          ))}
        </div>
      )}

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && !deleteBusy && setPendingDelete(null)}>
        <AlertDialogContent className="max-h-[90dvh] w-[calc(100vw-2rem)] overflow-y-auto rounded-xl sm:w-full">
          <AlertDialogHeader>
            <AlertDialogTitle className="break-words">Delete “{pendingDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The template disappears from this list and from the assignment workspace. Users it was
              already applied to keep everything — applying a template copies access, nothing stays
              linked to it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Cancel</AlertDialogCancel>
            <Button variant="destructive" onClick={() => void confirmDelete()} disabled={deleteBusy}>
              {deleteBusy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Delete template
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}


/* ------------------------------------------------------------------------------------------------
 * Scope grants (§21)
 * ---------------------------------------------------------------------------------------------- */

function ScopeGrantManager({
  state,
  actor,
  canManage,
}: {
  state: AccessDirectoryState;
  actor: AccessActor;
  canManage: boolean;
}) {
  const { toast } = useToast();
  const { directory, departments, designations, projects, registry } = state;
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<ScopeGrantConfig | null>(null);

  const byType = useMemo(() => {
    const grouped: Record<ScopeGrantConfig['scopeType'], ScopeGrantConfig[]> = {
      Department: [],
      Designation: [],
      Project: [],
    };
    for (const grant of directory.scopeGrants) grouped[grant.scopeType]?.push(grant);
    return grouped;
  }, [directory.scopeGrants]);

  const scopeLabel = (grant: ScopeGrantConfig) => {
    if (grant.scopeName) return grant.scopeName;
    if (grant.scopeType === 'Department') return departments.find((entry) => entry.id === grant.scopeId)?.name ?? grant.scopeId;
    if (grant.scopeType === 'Project') return projects.find((entry) => entry.id === grant.scopeId)?.projectName ?? grant.scopeId;
    return grant.scopeId;
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-xs text-muted-foreground">
          A standing rule: whoever is in this department, holds this designation, or is assigned to this
          project gets these roles and permissions — automatically, and only while they are.
        </p>
        {canManage && (
          <Button
            size="sm"
            className="max-sm:w-full"
            onClick={() => {
              setEditing(null);
              setEditorOpen(true);
            }}
          >
            <Plus className="mr-1.5 h-4 w-4" />
            New rule
          </Button>
        )}
      </div>

      {directory.scopeGrants.length === 0 ? (
        <HrEmptyState
          icon={Building2}
          title="No department, designation or project rules yet"
          description="Without these, access is assigned per person. Add a rule when a whole group should get something by virtue of being in that group."
        />
      ) : (
        <div className="space-y-3">
          {(['Department', 'Designation', 'Project'] as const).map((scopeType) =>
            byType[scopeType].length === 0 ? null : (
              <AccessCard key={scopeType}>
                <CardHeader className="px-4 py-3">
                  <CardTitle className="text-sm">{scopeType} rules</CardTitle>
                  <CardDescription className="text-xs">
                    {byType[scopeType].length} rule(s)
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 px-4 pb-4">
                  {byType[scopeType].map((grant) => (
                    <div
                      key={grant.id}
                      className={cn(
                        'flex flex-wrap items-start justify-between gap-2 rounded-xl border border-white bg-white/80 p-2.5',
                        grant.active === false && 'opacity-60',
                      )}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-slate-800">
                          {scopeLabel(grant)}
                          {grant.active === false && (
                            <Badge variant="outline" className="border-slate-300 bg-slate-100 text-[10px] text-slate-600">
                              Inactive
                            </Badge>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {(grant.roleIds ?? []).map((roleId) => {
                            const role = directory.roles.find((entry) => entry.id === roleId);
                            return (
                              <Badge key={roleId} variant="outline" className="border-indigo-200 bg-indigo-50 text-[10px] text-indigo-700">
                                {role?.name ?? roleId}
                              </Badge>
                            );
                          })}
                          {countPermissions(grant.permissions) > 0 && (
                            <Badge variant="outline" className="border-violet-200 bg-violet-50 text-[10px] text-violet-700">
                              {countPermissions(grant.permissions)} direct
                            </Badge>
                          )}
                        </div>
                      </div>
                      {canManage && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs max-sm:w-full"
                          onClick={() => {
                            setEditing(grant);
                            setEditorOpen(true);
                          }}
                        >
                          Edit
                        </Button>
                      )}
                    </div>
                  ))}
                </CardContent>
              </AccessCard>
            ),
          )}
        </div>
      )}

      <ScopeGrantEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        editing={editing}
        roles={directory.roles}
        departments={departments}
        designations={designations}
        projects={projects}
        registry={registry}
        actor={actor}
        onSaved={async () => {
          await state.refresh();
          toast({ title: editing ? 'Rule updated' : 'Rule created' });
        }}
      />
    </div>
  );
}

function ScopeGrantEditor({
  open,
  onOpenChange,
  editing,
  roles,
  departments,
  designations,
  projects,
  registry,
  actor,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: ScopeGrantConfig | null;
  roles: AccessDirectoryState['directory']['roles'];
  departments: AccessDirectoryState['departments'];
  designations: string[];
  projects: AccessDirectoryState['projects'];
  registry: AccessDirectoryState['registry'];
  actor: AccessActor;
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [initialisedFor, setInitialisedFor] = useState('');

  const [scopeType, setScopeType] = useState<ScopeGrantConfig['scopeType']>('Department');
  const [scopeId, setScopeId] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<PermissionMap>({});
  const [active, setActive] = useState(true);

  const formKey = `${editing?.id ?? 'new'}|${open}`;
  if (open && initialisedFor !== formKey) {
    setInitialisedFor(formKey);
    setScopeType(editing?.scopeType ?? 'Department');
    setScopeId(editing?.scopeId ?? '');
    setRoleIds(editing?.roleIds ?? []);
    setPermissions((editing?.permissions ?? {}) as PermissionMap);
    setActive(editing?.active !== false);
  }

  const options =
    scopeType === 'Department'
      ? departments.map((department) => ({ id: department.id, label: department.name }))
      : scopeType === 'Project'
        ? projects.map((project) => ({ id: project.id, label: project.projectName || project.siteCode || project.id }))
        : designations.map((designation) => ({ id: designation, label: designation }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={hrDialog.contentWide}>
        <DialogHeader className={hrDialog.header}>
          <DialogTitle>{editing ? 'Edit rule' : 'New scope rule'}</DialogTitle>
          <DialogDescription>
            Applies to whoever is in this scope at the time access is evaluated — nobody has to be
            re-assigned when somebody joins or leaves.
          </DialogDescription>
        </DialogHeader>

        <div className={hrDialog.body}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Scope type</Label>
              <Select
                value={scopeType}
                onValueChange={(value) => {
                  setScopeType(value as ScopeGrantConfig['scopeType']);
                  setScopeId('');
                }}
                disabled={!!editing}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Department">Department</SelectItem>
                  <SelectItem value="Designation">Designation</SelectItem>
                  <SelectItem value="Project">Project / site</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{scopeType}</Label>
              <Select value={scopeId} onValueChange={setScopeId} disabled={!!editing}>
                <SelectTrigger><SelectValue placeholder={`Select a ${scopeType.toLowerCase()}`} /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {options.map((option) => (
                    <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
            <div>
              <p className="text-sm font-medium text-slate-800">Rule active</p>
              <p className="text-[11px] text-muted-foreground">
                Switching this off stops the rule granting, without deleting it.
              </p>
            </div>
            <Switch checked={active} onCheckedChange={setActive} />
          </label>

          <div className="space-y-1.5">
            <Label>Roles granted to this {scopeType.toLowerCase()}</Label>
            <RolePicker
              roles={roles}
              selectedIds={roleIds}
              onSelectionChange={setRoleIds}
              heightClassName="sm:h-40"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Additional permissions (optional)</Label>
            {scopeType === 'Project' && (
              <p className="text-[11px] text-muted-foreground">
                Project rules grant scoped access — these permissions apply only within the project, not
                across all of them.
              </p>
            )}
            <PermissionTree
              registry={registry}
              value={permissions}
              onChange={setPermissions}
              heightClassName="sm:h-56"
            />
          </div>
        </div>

        <DialogFooter className={hrDialog.footer}>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button
            disabled={saving || !scopeId}
            onClick={async () => {
              setSaving(true);
              try {
                await saveScopeGrant(
                  {
                    id: editing?.id,
                    scopeType,
                    scopeId,
                    scopeName: options.find((option) => option.id === scopeId)?.label,
                    roleIds,
                    roleNames: roleIds
                      .map((id) => roles.find((role) => role.id === id)?.name)
                      .filter(Boolean) as string[],
                    permissions,
                    active,
                  },
                  actor,
                );
                onOpenChange(false);
                setInitialisedFor('');
                await onSaved();
              } catch (error) {
                toast({
                  title: 'Could not save the rule',
                  description: error instanceof Error ? error.message : 'Unexpected error.',
                  variant: 'destructive',
                });
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {editing ? 'Save rule' : 'Create rule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

