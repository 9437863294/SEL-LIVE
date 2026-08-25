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
import { Building2, Layers, Loader2, Plus, Sparkles, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { hrDialog, HrEmptyState } from '@/components/hr/hr-ui';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  countPermissions,
  type AccessTemplate,
  type PermissionMap,
  type ScopeGrantConfig,
} from '@/lib/access-control';
import {
  deleteAccessTemplate,
  saveAccessTemplate,
  saveScopeGrant,
  type AccessActor,
} from '@/lib/access-control-service';
import type { AccessDirectoryState } from '@/hooks/useAccessDirectory';
import { PermissionMapSummary, PermissionTree } from './permission-tree';
import { RolePicker } from './pickers';

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
      <TabsList className="grid w-full grid-cols-2 sm:w-auto">
        <TabsTrigger value="templates" className="text-xs">Access templates</TabsTrigger>
        <TabsTrigger value="scopes" className="text-xs">Department &amp; designation rules</TabsTrigger>
      </TabsList>

      <TabsContent value="templates">
        <TemplateManager
          state={state}
          actor={actor}
          canManage={canManage}
          onApplyTemplate={onApplyTemplate}
        />
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
  actor,
  canManage,
  onApplyTemplate,
}: {
  state: AccessDirectoryState;
  actor: AccessActor;
  canManage: boolean;
  onApplyTemplate: (templateId: string) => void;
}) {
  const { toast } = useToast();
  const { directory, projects, registry } = state;
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<AccessTemplate | null>(null);

  const templates = useMemo(
    () => directory.templates.filter((template) => template.active !== false),
    [directory.templates],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          A reusable bundle of roles, permissions and projects. Applying one adds it on top of whatever
          the user already has.
        </p>
        {canManage && (
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setEditorOpen(true);
            }}
          >
            <Plus className="mr-1.5 h-4 w-4" />
            New template
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
              <Button
                size="sm"
                onClick={() => {
                  setEditing(null);
                  setEditorOpen(true);
                }}
              >
                <Plus className="mr-1.5 h-4 w-4" />
                New template
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {templates.map((template) => (
            <Card key={template.id} className="border-white/60 bg-white/85 shadow-sm backdrop-blur-sm">
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

                <div className="flex flex-wrap gap-1.5 border-t border-slate-100 pt-2.5">
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
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => {
                          setEditing(template);
                          setEditorOpen(true);
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs text-destructive"
                        onClick={async () => {
                          await deleteAccessTemplate(template.id);
                          await state.refresh();
                          toast({ title: 'Template removed', description: 'Users who already had it keep their access.' });
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <TemplateEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        editing={editing}
        state={state}
        actor={actor}
        onSaved={async () => {
          await state.refresh();
          toast({ title: editing ? 'Template updated' : 'Template created' });
        }}
      />
    </div>
  );
}

function TemplateEditorDialog({
  open,
  onOpenChange,
  editing,
  state,
  actor,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: AccessTemplate | null;
  state: AccessDirectoryState;
  actor: AccessActor;
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const { directory, projects, registry } = state;
  const [saving, setSaving] = useState(false);
  const [initialisedFor, setInitialisedFor] = useState('');

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<PermissionMap>({});

  const formKey = `${editing?.id ?? 'new'}|${open}`;
  if (open && initialisedFor !== formKey) {
    setInitialisedFor(formKey);
    setName(editing?.name ?? '');
    setDescription(editing?.description ?? '');
    setRoleIds(editing?.roleIds ?? []);
    setProjectIds(editing?.projectIds ?? []);
    setPermissions((editing?.permissions ?? {}) as PermissionMap);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={hrDialog.contentWide}>
        <DialogHeader className={hrDialog.header}>
          <DialogTitle>{editing ? `Edit ${editing.name}` : 'New access template'}</DialogTitle>
          <DialogDescription>
            A template is a shortcut, not a link. Applying it copies these roles and permissions onto a
            user; changing the template later does not change anybody who already has it.
          </DialogDescription>
        </DialogHeader>

        <div className={hrDialog.body}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="template-name">Template name *</Label>
              <Input
                id="template-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Site Engineer"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="template-description">Description</Label>
              <Input
                id="template-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Who this is for"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Roles in this template</Label>
            <RolePicker
              roles={directory.roles}
              selectedIds={roleIds}
              onSelectionChange={setRoleIds}
              heightClassName="h-40"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Projects (optional)</Label>
            <div className="flex flex-wrap gap-1.5 rounded-xl border border-white/70 bg-white/70 p-2">
              {projects.slice(0, 40).map((project) => {
                const selected = projectIds.includes(project.id);
                return (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() =>
                      setProjectIds((current) =>
                        selected ? current.filter((id) => id !== project.id) : [...current, project.id],
                      )
                    }
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-xs transition-colors',
                      selected
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
                    )}
                  >
                    {project.projectName || project.siteCode || project.id}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Direct permissions (optional)</Label>
            <PermissionTree
              registry={registry}
              value={permissions}
              onChange={setPermissions}
              heightClassName="h-64"
            />
          </div>
        </div>

        <DialogFooter className={hrDialog.footer}>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button
            disabled={saving || !name.trim()}
            onClick={async () => {
              setSaving(true);
              try {
                await saveAccessTemplate(
                  {
                    id: editing?.id,
                    name,
                    description,
                    roleIds,
                    roleNames: roleIds
                      .map((id) => directory.roles.find((role) => role.id === id)?.name)
                      .filter(Boolean) as string[],
                    projectIds,
                    permissions,
                    active: true,
                  },
                  actor,
                );
                onOpenChange(false);
                setInitialisedFor('');
                await onSaved();
              } catch (error) {
                toast({
                  title: 'Could not save the template',
                  description: error instanceof Error ? error.message : 'Unexpected error.',
                  variant: 'destructive',
                });
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {editing ? 'Save template' : 'Create template'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
              <Card key={scopeType} className="border-white/60 bg-white/85 shadow-sm backdrop-blur-sm">
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
                        <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-slate-800">
                          {scopeLabel(grant)}
                          {grant.active === false && (
                            <Badge variant="outline" className="border-slate-300 bg-slate-100 text-[10px] text-slate-600">
                              Inactive
                            </Badge>
                          )}
                        </p>
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
                          className="h-8 text-xs"
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
              </Card>
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
              heightClassName="h-40"
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
              heightClassName="h-56"
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

