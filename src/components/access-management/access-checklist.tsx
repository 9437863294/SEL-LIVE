'use client';

/**
 * A single user's permissions as a tick/untick tree — module, then page, then action.
 *
 * Requested as a specific layout: every module as a card in a grid up top; selecting one shows its
 * pages, grouped, in a panel below the whole grid — not an accordion where a module's content opens
 * inline underneath that one row and pushes the rows below it down. Selecting a different module
 * swaps the panel; it does not add a second one, so there is always exactly one module's detail on
 * screen, in one place, however many modules there are above it.
 *
 * ── Why this is a different component from `PermissionTree`, not a mode of it ──────────────────
 *
 * `PermissionTree` edits a *proposed* permission map that has not been saved yet — inherited boxes
 * are ticked, locked, and never written. This edits somebody's *actual, current* access, so ticking
 * and unticking are real actions with a real effect the moment they are saved, not a selection being
 * assembled. Bolting that onto `PermissionTree` would mean a `mode` prop silently changing what a
 * checkbox does, which is the kind of ambiguity a permission editor cannot afford.
 *
 * ── The three states a checkbox can be in ───────────────────────────────────────────────────────
 *
 *   1. **Unchecked.** Not held from anywhere. Ticking stages a grant, written as a *direct*
 *      permission — there is no role to put it in from this screen, and a direct grant is exactly
 *      what "give this one person this one thing" means.
 *   2. **Checked and editable.** Held *only* as a direct permission. Unticking stages its removal.
 *   3. **Checked and locked.** Held via the base role, an additional role, a department, a
 *      designation, a project, or a temporary grant — anything that is not a direct grant. Shown
 *      ticked with a lock and the source named, because it cannot be revoked by unticking a box: a
 *      role's permissions belong to everyone holding that role, and removing one action from it here
 *      would either do nothing (this screen has no authority to edit a role) or silently affect every
 *      other holder (if it somehow did). The source is named so the administrator knows exactly which
 *      other section of this page — Additional roles, Departments, Projects — actually controls it.
 *
 * Changes are staged locally and written together on **Save**, with one reason covering the whole
 * batch — consistent with every other write in this module, which all require one.
 */

import * as React from 'react';
import { useMemo, useState } from 'react';
import { Loader2, Lock, Search, ShieldMinus, ShieldPlus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  hasPermission,
  searchRegistry,
  type EffectiveAccess,
  type PermissionMap,
  type PermissionSource,
  type RegistryNode,
} from '@/lib/access-control';
import { AccessHint, ModulePicker } from './access-ui';

export interface PendingChange {
  resource: string;
  action: string;
  /** `true` to grant, `false` to revoke. */
  next: boolean;
}

export interface AccessChecklistProps {
  registry: RegistryNode[];
  access: EffectiveAccess;
  /** Changes staged so far, keyed `${resource}::${action}`. */
  pending: Map<string, PendingChange>;
  onToggle: (resource: string, action: string, next: boolean) => void;
  /**
   * Permitted separately, not as one `disabled` flag: this app supports a delegated administrator who
   * may assign access but never revoke it (or the reverse), and collapsing the two into one switch
   * would mean either over-granting that role a power it should not have, or blocking it from the one
   * it should. An unchecked box is only ever a grant; a checked, editable box is only ever a revoke —
   * so each checkbox needs only the one permission that matches what ticking it would do.
   */
  canGrant: boolean;
  canRevoke: boolean;
}

const sourceSummary = (sources: PermissionSource[]): string =>
  sources
    .map((source) => (source.kind === 'Direct Permission' ? 'directly' : `via ${source.kind.toLowerCase()}: ${source.label}`))
    .join(', ');

export function AccessChecklist({ registry, access, pending, onToggle, canGrant, canRevoke }: AccessChecklistProps) {
  const [term, setTerm] = useState('');
  const [selectedModule, setSelectedModule] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const nodes = searchRegistry(registry, term);
    const byModule = new Map<string, RegistryNode[]>();
    for (const node of nodes) {
      const list = byModule.get(node.module) ?? [];
      list.push(node);
      byModule.set(node.module, list);
    }
    return [...byModule.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [registry, term]);

  // If a search narrows the grid to one module, open it straight away — picking the only card left
  // is busywork. Clearing the search does not auto-close it; that would fight the administrator who
  // typed a broader term on purpose while still reading that module's detail.
  React.useEffect(() => {
    if (grouped.length === 1) setSelectedModule(grouped[0][0]);
  }, [grouped]);

  // The selected module can fall out of the filtered set (search narrowed past it); the detail panel
  // below reflects that rather than silently showing a module no longer in the grid above it.
  const activeModule = grouped.find(([moduleName]) => moduleName === selectedModule);

  /** Effective (held-or-pending) state and its source list for one action. */
  const stateOf = (resource: string, action: string) => {
    const key = `${resource}::${action}`;
    const change = pending.get(key);
    const heldNow = hasPermission(access, resource, action);
    const checked = change ? change.next : heldNow;
    const sources = (access.sources[key] ?? []).filter((source) => source.kind !== 'Direct Permission');
    // Locked when the *current* holding (ignoring a pending change) comes from anything but a direct
    // grant. A pending revoke of a purely-direct permission must stay editable so it can be undone
    // before saving; a role-held one was never editable to begin with.
    const locked = heldNow && sources.length > 0;
    return { checked, locked, sources, changed: !!change };
  };

  const moduleCounts = (nodes: RegistryNode[]) => {
    let held = 0;
    let total = 0;
    for (const node of nodes) {
      for (const action of node.actions) {
        total += 1;
        if (stateOf(node.resource, action).checked) held += 1;
      }
    }
    return { held, total };
  };

  return (
    <div className="space-y-2.5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
        <Input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search modules, pages or actions…"
          className="pl-9"
        />
        {term && (
          <button
            type="button"
            onClick={() => setTerm('')}
            aria-label="Clear search"
            className="hr-inline-action absolute right-1 top-1/2 inline-flex -translate-y-1/2 items-center justify-center rounded-full p-1 text-slate-400 hover:bg-slate-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Every module, as a narrow single-line card, always visible — not a list where picking one
          pushes the rest down. Selecting one selects it; it does not reveal its content in place. */}
      {grouped.length === 0 ? (
        <p className="rounded-xl border border-white/70 bg-white/60 px-3 py-10 text-center text-sm text-muted-foreground">
          No modules match “{term}”.
        </p>
      ) : (
        <ModulePicker
          modules={grouped.map(([moduleName, nodes]) => {
            const { held, total } = moduleCounts(nodes);
            return {
              name: moduleName,
              caption: `${held}/${total}`,
              tone: held === 0 ? 'none' : held === total ? 'all' : 'some',
            };
          })}
          selected={selectedModule}
          onSelect={setSelectedModule}
        />
      )}

      {/* The detail panel: one module's pages, below the whole grid rather than under its own card,
          so the panel's position on screen does not jump around as different cards are picked. */}
      {activeModule ? (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-3">
          <p className="mb-2 text-sm font-semibold text-slate-800">{activeModule[0]}</p>
          <ScrollArea className="h-auto rounded-xl border border-white/70 bg-white/80 sm:h-[24rem]">
            <div className="space-y-1.5 p-2.5">
              {activeModule[1].map((node) => {
                const label = node.depth === 0 ? 'Module access' : node.resource.split('.').slice(1).join(' › ');
                return (
                  <div key={node.resource} className="rounded-lg border border-white bg-white/90 px-2.5 py-2 shadow-sm">
                    <p className="mb-1.5 truncate text-xs font-semibold text-slate-700">{label}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                      {node.actions.map((action) => {
                        const { checked, locked, sources, changed } = stateOf(node.resource, action);
                        const id = `${node.resource}::${action}`;
                        // An unchecked box can only become a grant; a checked, editable box can only
                        // become a revoke. Each needs only the one permission that matches.
                        const notPermitted = checked ? !canRevoke : !canGrant;
                        return (
                          <label
                            key={id}
                            htmlFor={id}
                            className={cn(
                              'flex min-h-11 basis-[calc(50%-0.5rem)] items-center gap-2 text-xs sm:min-h-8 sm:basis-auto sm:gap-1.5',
                              locked ? 'cursor-not-allowed text-slate-400' : 'cursor-pointer',
                              changed && !locked && 'font-medium text-indigo-700',
                            )}
                          >
                            <Checkbox
                              id={id}
                              checked={checked}
                              disabled={locked || notPermitted}
                              onCheckedChange={(next) => onToggle(node.resource, action, next === true)}
                            />
                            <span className="truncate">{action}</span>
                            {locked && (
                              <AccessHint
                                content={
                                  <>
                                    Held {sourceSummary(sources)}. Remove it from there — Additional roles,
                                    Departments, Projects or Temporary access below — not by unticking here.
                                  </>
                                }
                              >
                                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center" aria-label="Why is this locked?">
                                  <Lock className="h-3 w-3 text-slate-400" />
                                </span>
                              </AccessHint>
                            )}
                            {changed && !locked && (
                              checked ? (
                                <ShieldPlus className="h-3 w-3 shrink-0 text-indigo-600" />
                              ) : (
                                <ShieldMinus className="h-3 w-3 shrink-0 text-destructive" />
                              )
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-slate-200 bg-white/50 px-3 py-8 text-center text-sm text-muted-foreground">
          Select a module above to see its pages.
        </p>
      )}
    </div>
  );
}

/**
 * The save bar: appears only once something is staged, summarises it, and requires a reason before
 * either the grant or the revoke half of the batch is written — matching every other write in this
 * module.
 */
export function AccessChecklistSaveBar({
  pending,
  reason,
  onReasonChange,
  onSave,
  onDiscard,
  saving,
  error,
}: {
  pending: Map<string, PendingChange>;
  reason: string;
  onReasonChange: (value: string) => void;
  onSave: () => void;
  onDiscard: () => void;
  saving: boolean;
  error: string | null;
}) {
  if (pending.size === 0) return null;

  const grants = [...pending.values()].filter((change) => change.next).length;
  const revokes = pending.size - grants;

  return (
    <div className="hr-sticky-actions sticky bottom-0 -mx-1 space-y-2 rounded-xl border border-indigo-200 bg-white/95 p-3 shadow-lg backdrop-blur-sm">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {grants > 0 && (
          <Badge variant="outline" className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-700">
            <ShieldPlus className="h-3 w-3" />
            {grants} to grant
          </Badge>
        )}
        {revokes > 0 && (
          <Badge variant="outline" className="gap-1 border-destructive/30 bg-destructive/5 text-destructive">
            <ShieldMinus className="h-3 w-3" />
            {revokes} to revoke
          </Badge>
        )}
        <span className="text-muted-foreground">Nothing is saved until you confirm below.</span>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <Textarea
        value={reason}
        onChange={(event) => onReasonChange(event.target.value)}
        placeholder="Why are these permissions changing?"
        rows={2}
        className="text-sm"
      />

      <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
        <Button variant="outline" size="sm" onClick={onDiscard} disabled={saving}>
          Discard
        </Button>
        <Button size="sm" onClick={onSave} disabled={saving || !reason.trim()}>
          {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Save changes
        </Button>
      </div>
    </div>
  );
}
