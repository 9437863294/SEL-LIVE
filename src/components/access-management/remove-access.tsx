'use client';

/**
 * Remove additive access from one or many users (§47).
 *
 * ── The gap this closes ─────────────────────────────────────────────────────────────────────────
 *
 * Granting was bulk from the start: Assign Access takes any number of users and hands them roles,
 * direct permissions and project scope in one operation. Removing was not. `RemovalPreviewDialog` was
 * built for bulk — it maps over an array of users and its own copy says "N users will lose nothing" —
 * but it was only ever wired to the single-user profile, one row at a time.
 *
 * So a direct permission granted to forty people could only be taken back forty times, from forty
 * pages, and only by an administrator who knew the profile route existed. That asymmetry reads as "I
 * can't revoke this", which is exactly how it was reported.
 *
 * This is the missing half: pick the users, see every source of additive access they *actually* hold,
 * choose what to take away.
 *
 * ── Why the choices are computed, not typed ─────────────────────────────────────────────────────
 *
 * The options are the union of what the selected users hold, with a count against each. An
 * administrator removing "Inventory.Stock → Edit" from a team should not have to know which of them
 * has it, and offering a permission nobody holds would produce a confident no-op.
 */

import * as React from 'react';
import { useMemo, useState } from 'react';
import { KeyRound, Layers, FolderKanban, ShieldMinus, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { hrDialog, HrEmptyState } from '@/components/hr/hr-ui';
import { cn } from '@/lib/utils';
import type { User } from '@/lib/types';
import {
  normalizeUserAccessGrant,
  type PermissionMap,
  type UserAccessGrant,
} from '@/lib/access-control';

/** One removable thing, and how many of the selected users have it. */
interface Removable {
  kind: 'role' | 'direct' | 'project';
  /** Stable identity: role id, `resource::action`, or project id. */
  id: string;
  label: string;
  detail: string;
  userCount: number;
}

export interface RemoveAccessSelection {
  roleIds: string[];
  projectIds: string[];
  directPermissions: PermissionMap;
}

const EMPTY: RemoveAccessSelection = { roleIds: [], projectIds: [], directPermissions: {} };

/**
 * Everything the selected users hold through this layer, deduplicated.
 *
 * Direct permissions are enumerated per **action**, not per resource. Granting tends to happen a
 * resource at a time, but revoking does not: taking `Edit` away while leaving `View` is the common
 * case, and a resource-level list cannot express it.
 */
function collectRemovables(
  users: User[],
  grants: Record<string, UserAccessGrant>,
  projectName: (id: string) => string,
): Removable[] {
  const found = new Map<string, Removable>();

  const add = (item: Omit<Removable, 'userCount'>) => {
    const existing = found.get(`${item.kind}:${item.id}`);
    if (existing) existing.userCount += 1;
    else found.set(`${item.kind}:${item.id}`, { ...item, userCount: 1 });
  };

  for (const user of users) {
    const grant = normalizeUserAccessGrant(user.id, grants[user.id]);

    for (const role of grant.additionalRoles) {
      add({ kind: 'role', id: role.roleId, label: role.roleName || role.roleId, detail: 'Additional role' });
    }

    for (const entry of grant.directPermissions) {
      for (const action of entry.actions) {
        add({
          kind: 'direct',
          id: `${entry.resource}::${action}`,
          label: `${entry.resource.split('.').join(' › ')} → ${action}`,
          detail: 'Direct permission',
        });
      }
    }

    for (const entry of grant.projectAccess) {
      add({
        kind: 'project',
        id: entry.projectId,
        label: projectName(entry.projectId),
        detail: 'Project access',
      });
    }
  }

  // Roles first, then direct permissions, then projects; within a kind, the ones held by the most
  // users first — a bulk removal is usually aimed at the thing they have in common.
  const order = { role: 0, direct: 1, project: 2 } as const;
  return [...found.values()].sort(
    (a, b) => order[a.kind] - order[b.kind] || b.userCount - a.userCount || a.label.localeCompare(b.label),
  );
}

/** Turn ticked ids back into the shape `removeAccessFromGrant` takes. */
export function toRemovalSelection(ids: string[], removables: Removable[]): RemoveAccessSelection {
  const picked = new Set(ids);
  const selection: RemoveAccessSelection = { roleIds: [], projectIds: [], directPermissions: {} };

  for (const item of removables) {
    if (!picked.has(`${item.kind}:${item.id}`)) continue;
    if (item.kind === 'role') selection.roleIds.push(item.id);
    else if (item.kind === 'project') selection.projectIds.push(item.id);
    else {
      // `resource::action` — split on the last separator, because a resource key contains dots but
      // never `::`.
      const cut = item.id.lastIndexOf('::');
      const resource = item.id.slice(0, cut);
      const action = item.id.slice(cut + 2);
      selection.directPermissions[resource] = [...(selection.directPermissions[resource] ?? []), action];
    }
  }

  return selection;
}

const ICONS = { role: Layers, direct: KeyRound, project: FolderKanban } as const;

export function RemoveAccessDialog({
  open,
  onOpenChange,
  users,
  grants,
  projectName,
  onContinue,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  users: User[];
  grants: Record<string, UserAccessGrant>;
  projectName: (id: string) => string;
  /** Hands the chosen sources to the preview, which is where the confirmation lives. */
  onContinue: (selection: RemoveAccessSelection) => void;
}) {
  const [ticked, setTicked] = useState<string[]>([]);
  const [term, setTerm] = useState('');

  const removables = useMemo(
    () => (open ? collectRemovables(users, grants, projectName) : []),
    [open, users, grants, projectName],
  );

  const visible = useMemo(() => {
    const query = term.trim().toLowerCase();
    if (!query) return removables;
    return removables.filter((item) => `${item.label} ${item.detail}`.toLowerCase().includes(query));
  }, [removables, term]);

  const toggle = (key: string) =>
    setTicked((current) =>
      current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key],
    );

  const close = () => {
    setTicked([]);
    setTerm('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className={hrDialog.contentTall}>
        <DialogHeader className={hrDialog.header}>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <ShieldMinus className="h-5 w-5" />
            Remove access
          </DialogTitle>
          <DialogDescription>
            Only what was granted through this layer is listed. Base roles are not shown because this
            never touches them — nothing here can reduce somebody below their primary role.
          </DialogDescription>
        </DialogHeader>

        <div className={hrDialog.bodyScroll}>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="gap-1 border-indigo-200 bg-indigo-50 text-indigo-700">
              <Users className="h-3 w-3" />
              {users.length} user{users.length === 1 ? '' : 's'}
            </Badge>
            <span>{removables.length} removable grant(s) between them</span>
            {ticked.length > 0 && (
              <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive">
                {ticked.length} selected
              </Badge>
            )}
          </div>

          {removables.length > 8 && (
            <Input
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Filter roles, permissions and projects…"
            />
          )}

          {removables.length === 0 ? (
            <HrEmptyState
              icon={ShieldMinus}
              title="Nothing to remove"
              description={
                users.length === 1
                  ? 'This user has no additional roles, direct permissions or project access. Everything they can do comes from their base role.'
                  : 'None of the selected users has been granted anything through this layer.'
              }
            />
          ) : (
            <ScrollArea className="h-auto rounded-xl border border-white/70 bg-white/60 sm:h-72">
              {visible.length === 0 && (
                <p className="px-3 py-10 text-center text-sm text-muted-foreground">
                  Nothing matches “{term.trim()}”. Clear the filter to see all {removables.length}{' '}
                  removable grant(s).
                </p>
              )}
              <div className="divide-y divide-slate-100">
                {visible.map((item) => {
                  const key = `${item.kind}:${item.id}`;
                  const Icon = ICONS[item.kind];
                  const checked = ticked.includes(key);
                  return (
                    <label
                      key={key}
                      className={cn(
                        'flex cursor-pointer items-start gap-2.5 px-2.5 py-2.5 transition-colors hover:bg-destructive/5',
                        checked && 'bg-destructive/5',
                      )}
                    >
                      <Checkbox checked={checked} onCheckedChange={() => toggle(key)} className="mt-0.5" />
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-sm text-slate-800 sm:truncate">{item.label}</span>
                        <span className="block text-[11px] text-muted-foreground">{item.detail}</span>
                      </span>
                      {/* Only meaningful for a multi-user removal, and misleading for one. */}
                      {users.length > 1 && (
                        <Badge variant="outline" className="shrink-0 text-[10px] text-slate-500">
                          {item.userCount} of {users.length}
                        </Badge>
                      )}
                    </label>
                  );
                })}
              </div>
            </ScrollArea>
          )}

          <p className="text-[11px] text-muted-foreground">
            Nothing is removed yet. The next step shows exactly what each user would lose — and what
            they keep because another source still grants it.
          </p>
        </div>

        <DialogFooter className={hrDialog.footer}>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={ticked.length === 0}
            onClick={() => {
              onContinue(toRemovalSelection(ticked, removables));
              close();
            }}
          >
            Review {ticked.length || ''} removal{ticked.length === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { EMPTY as EMPTY_REMOVAL_SELECTION };
