'use client';

/**
 * Create, edit or duplicate a role (§38, §39) — as a page.
 *
 * It was a dialog, and it was the worst fit for one in this module. The screenshot that prompted the
 * move says it: a modal roughly 700px wide holding a name field, a type select, a description, a
 * warning panel, a search box, four bulk-action buttons, six "apply everywhere" buttons, 27 module
 * chips wrapped over four lines, and then a scrolling tree of ~1,200 permission checkboxes. The tree
 * — the actual subject of the screen — got a viewport a few hundred pixels tall inside a dialog body
 * that was itself scrolling, so the page scrolled the modal, the modal scrolled the body, and the body
 * scrolled the tree. Choosing permissions for a role is a considered task that people leave and come
 * back to; it wants an addressable URL, the browser's back button, and the whole window.
 *
 * The form is exported separately from the page shell, exactly as `AddUserForm` and
 * `AccessTemplateForm` are, so the layout is the only thing that changed.
 *
 * ── What the move let us delete ─────────────────────────────────────────────────────────────────
 *
 * The dialog carried a `formKey` / `initialisedFor` pair and re-seeded its own state mid-render,
 * because one long-lived dialog instance was reused for every role: without it, opening role B after
 * role A would show A's permissions and save them onto B. A page is mounted fresh per URL, so the
 * initial values are simply initial values and the whole mechanism is gone — along with the class of
 * bug it existed to paper over.
 */

import * as React from 'react';
import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import type { Role } from '@/lib/types';
import {
  countPermissions,
  detectPrivilegedAccess,
  detectSodConflicts,
  type PermissionMap,
  type RegistryNode,
} from '@/lib/access-control';
import { saveRole, type AccessActor } from '@/lib/access-control-service';
import { PermissionTree } from './permission-tree';
import { RiskBadges } from './access-ui';

export interface RoleFormProps {
  /** The role being edited, or null when creating. */
  editing: Role | null;
  /** The role being copied, or null. Mutually exclusive with `editing`. */
  duplicating: Role | null;
  registry: RegistryNode[];
  /** Every role name in the directory, for the collision check. */
  existingNames: string[];
  actor: AccessActor;
  /** `created` distinguishes a new role from a saved one, so the page can route accordingly. */
  onSaved: (roleId: string, created: boolean) => void;
  onCancel: () => void;
}

export function RoleForm({
  editing,
  duplicating,
  registry,
  existingNames,
  actor,
  onSaved,
  onCancel,
}: RoleFormProps) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const source = editing ?? duplicating;

  // Plain initial values. See the header for why this no longer needs re-seeding machinery.
  const [name, setName] = useState(
    editing ? editing.name : duplicating ? `${duplicating.name} (copy)` : '',
  );
  const [description, setDescription] = useState(source?.description ?? '');
  const [type, setType] = useState<'System' | 'Custom'>((source?.type as 'System' | 'Custom') ?? 'Custom');
  const [permissions, setPermissions] = useState<PermissionMap>((source?.permissions ?? {}) as PermissionMap);

  /**
   * Does another role already own this name?
   *
   * The dialog skipped this check entirely while editing (`!editing && …`), which let a rename land
   * on an existing role's name. That matters more here than a duplicate label would elsewhere:
   * `users.role` stores the role *name*, so two roles sharing one is genuinely ambiguous about which
   * permissions a user holds. Comparing against every name *except this role's own* keeps the rename
   * case guarded without a role tripping over itself.
   *
   * Note the server only enforces uniqueness on create — `saveRole` updates without re-checking — so
   * this is the guard that covers the rename path.
   */
  const nameTaken = useMemo(() => {
    const candidate = name.trim().toLowerCase();
    if (!candidate) return false;
    return existingNames.some(
      (existing) =>
        existing.trim().toLowerCase() === candidate &&
        existing.trim().toLowerCase() !== editing?.name.trim().toLowerCase(),
    );
  }, [name, existingNames, editing]);

  const selectedCount = useMemo(() => countPermissions(permissions), [permissions]);
  const privileges = useMemo(() => detectPrivilegedAccess(permissions), [permissions]);
  const conflicts = useMemo(() => detectSodConflicts(permissions), [permissions]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast({ title: 'A role needs a name', variant: 'destructive' });
      return;
    }
    if (nameTaken) {
      toast({ title: 'That role name already exists', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const roleId = await saveRole(
        {
          id: editing?.id,
          name,
          description,
          type,
          status: 'Active',
          permissions,
          duplicatedFrom: duplicating,
        },
        actor,
      );
      onSaved(roleId, !editing);
    } catch (error) {
      toast({
        title: 'Could not save the role',
        description: error instanceof Error ? error.message : 'Unexpected error.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <FormSection title="About this role">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="role-name">Role name *</Label>
            <Input
              id="role-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Assistant Project Manager"
            />
            {nameTaken && <p className="text-xs text-destructive">A role with this name already exists.</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="role-type">Role type</Label>
            <Select value={type} onValueChange={(value) => setType(value as 'System' | 'Custom')}>
              <SelectTrigger id="role-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Custom">Custom</SelectItem>
                <SelectItem value="System">System</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-3">
            <Label htmlFor="role-description">Description</Label>
            <Textarea
              id="role-description"
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this role is for, and who should hold it."
            />
          </div>
        </div>
      </FormSection>

      {editing && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-xs text-amber-800 shadow-sm">
          <p className="font-semibold">
            {countPermissions(editing.permissions)} permissions today. Editing a role changes access for
            everybody holding it.
          </p>
          <p className="mt-0.5">
            Removing a permission here removes it from every holder who has no other source for it. If you
            only want to widen access, add permissions and leave the existing ticks alone.
          </p>
        </div>
      )}

      {duplicating && (
        <div className="rounded-2xl border border-sky-200 bg-sky-50/70 p-4 text-xs text-sky-900 shadow-sm">
          <p className="font-semibold">
            Starting from {duplicating.name}&apos;s {countPermissions(duplicating.permissions)} permissions.
          </p>
          <p className="mt-0.5">
            {duplicating.name} itself is not modified, and nobody holding it is affected — this saves as a
            new role.
          </p>
        </div>
      )}

      <FormSection
        title="Permissions"
        description="Tick what this role should carry. The whole window is available here, so the tree does not have to be scrolled through a keyhole."
      >
        {/*
          Taller than the dialog's `h-[24rem]` because there is now room for it. Still a fixed height
          rather than a viewport calculation: the tree owns its own scroll, and a tree that grew to fit
          its content would put the Save button an unpredictable distance down a very long page.
        */}
        <PermissionTree
          registry={registry}
          value={permissions}
          onChange={setPermissions}
          heightClassName="h-[34rem]"
        />
      </FormSection>

      {/*
        Sticky, so Save is reachable without scrolling back up from wherever in the tree you finished
        — the same bar the other two long forms in this module use.
      */}
      <div className="sticky bottom-0 -mx-1 flex flex-col gap-2 border-t border-white/70 bg-white/85 px-1 py-3 backdrop-blur-sm sm:flex-row sm:items-center">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700">
            Selected: {selectedCount} permission{selectedCount === 1 ? '' : 's'}
          </Badge>
          {/* Surfaced before saving rather than only on the role card afterwards — the point of a
              privilege or separation-of-duties warning is to be seen while it is still a draft. */}
          <RiskBadges privileges={privileges} conflicts={conflicts} />
        </div>
        <div className="flex flex-col gap-2 sm:ml-auto sm:flex-row">
          <Button variant="outline" onClick={onCancel} disabled={saving} className="sm:w-32">
            Cancel
          </Button>
          <Button
            onClick={() => void handleSave()}
            disabled={saving || !name.trim() || nameTaken}
            className="sm:w-44"
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {editing ? 'Save role' : 'Create role'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** A titled group of fields — the same shell `AddUserForm` and `AccessTemplateForm` use, so the three
 * long forms in this module read as one style rather than three. */
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
