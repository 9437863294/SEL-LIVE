'use client';

/**
 * Create or edit an access template (§24), as a page.
 *
 * It was a dialog. The same reasoning that moved Add User applies here, and more so — this form
 * carries a full `PermissionTree` over the whole registry (the same ~1,200-leaf tree, just for
 * building a template instead of granting one), plus a role picker and a project chooser. Three
 * scrolling regions stacked inside a dialog body is the same problem Add User had, at a size where a
 * modal was never going to be comfortable.
 *
 * The form is exported separately from the page shell, exactly as `AddUserForm` is, so the layout is
 * the only thing that changed.
 */

import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  type AccessTemplate,
  type PermissionMap,
  type RegistryNode,
} from '@/lib/access-control';
import { saveAccessTemplate, type AccessActor } from '@/lib/access-control-service';
import type { Project, Role } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { PermissionTree } from './permission-tree';
import { ProjectPicker, RolePicker } from './pickers';

export interface AccessTemplateFormProps {
  editing: AccessTemplate | null;
  roles: Role[];
  projects: Project[];
  registry: RegistryNode[];
  actor: AccessActor;
  onSaved: (templateId: string) => void;
  onCancel: () => void;
}

export function AccessTemplateForm({
  editing,
  roles,
  projects,
  registry,
  actor,
  onSaved,
  onCancel,
}: AccessTemplateFormProps) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState(editing?.name ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [roleIds, setRoleIds] = useState<string[]>(editing?.roleIds ?? []);
  const [projectIds, setProjectIds] = useState<string[]>(editing?.projectIds ?? []);
  const [permissions, setPermissions] = useState<PermissionMap>((editing?.permissions ?? {}) as PermissionMap);

  // Re-seed if a different template is opened without unmounting the page (the edit route reuses
  // this component across `templateId` changes via client-side navigation).
  useEffect(() => {
    setName(editing?.name ?? '');
    setDescription(editing?.description ?? '');
    setRoleIds(editing?.roleIds ?? []);
    setProjectIds(editing?.projectIds ?? []);
    setPermissions((editing?.permissions ?? {}) as PermissionMap);
  }, [editing]);

  const selectedRoleNames = useMemo(
    () => roleIds.map((id) => roles.find((role) => role.id === id)?.name).filter(Boolean) as string[],
    [roleIds, roles],
  );

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const id = await saveAccessTemplate(
        {
          id: editing?.id,
          name,
          description,
          roleIds,
          roleNames: selectedRoleNames,
          projectIds,
          permissions,
          active: true,
        },
        actor,
      );
      onSaved(id);
    } catch (error) {
      toast({
        title: 'Could not save the template',
        description: error instanceof Error ? error.message : 'Unexpected error.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <FormSection
        title="Identity"
        description="A template is a shortcut, not a link. Applying it copies these roles and permissions onto a user; changing the template later does not change anybody who already has it."
      >
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
      </FormSection>

      <FormSection title="Roles in this template">
        <RolePicker roles={roles} selectedIds={roleIds} onSelectionChange={setRoleIds} heightClassName="h-48" />
      </FormSection>

      <FormSection title="Projects (optional)">
        {projects.length === 0 ? (
          <p className="text-xs text-muted-foreground">No projects configured.</p>
        ) : (
          <ProjectPicker projects={projects} selectedIds={projectIds} onSelectionChange={setProjectIds} />
        )}
      </FormSection>

      <FormSection title="Direct permissions (optional)">
        <PermissionTree registry={registry} value={permissions} onChange={setPermissions} heightClassName="h-[28rem]" />
      </FormSection>

      <div className="sticky bottom-0 -mx-1 flex flex-col gap-2 border-t border-white/70 bg-white/85 px-1 py-3 backdrop-blur-sm sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onCancel} disabled={saving} className="sm:w-32">
          Cancel
        </Button>
        <Button onClick={() => void handleSave()} disabled={saving || !name.trim()} className="sm:w-44">
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {editing ? 'Save template' : 'Create template'}
        </Button>
      </div>
    </div>
  );
}

/** A titled group of fields — same shell `AddUserForm` uses, so the two long forms in this module
 * read as one style rather than two. */
function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/60 bg-white/80 p-4 shadow-sm backdrop-blur-sm">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
