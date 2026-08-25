'use client';

/**
 * The registry as a checkbox tree (§11, §32, §38).
 *
 * One component serves three jobs: picking permissions for a new role, granting permissions
 * directly to a user, and building a template. They are the same operation — choose a subset of the
 * registry — and having one implementation is what stops the three from disagreeing about what
 * "select all" means.
 *
 * ── Two decisions that shape the whole component ────────────────────────────────────────────────
 *
 *   1. **Inherited permissions are shown, never editable.** When granting direct permissions to
 *      somebody who already holds half of them through a role, those boxes render ticked, dimmed
 *      and locked. The alternative — an empty box next to a permission the user demonstrably has —
 *      invites an administrator to grant a duplicate and then wonder why removing it changed
 *      nothing. §11's "show inherited permissions", made load-bearing.
 *
 *   2. **Only modules matching the search render their children.** The registry has ~1,200 leaves.
 *      Mounting every checkbox and letting CSS hide them is what makes a permission tree feel
 *      broken on a mid-range laptop, so filtered-out modules are not rendered at all and collapsed
 *      accordions never mount their contents.
 */

import * as React from 'react';
import { useMemo, useState } from 'react';
import { ChevronRight, Lock, Search, SquareCheck, SquareMinus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  countPermissions,
  permissionKey,
  registryActions,
  registryToPermissionMap,
  searchRegistry,
  type PermissionMap,
  type RegistryNode,
} from '@/lib/access-control';

export interface PermissionTreeProps {
  registry: RegistryNode[];
  /** The selection being edited. */
  value: PermissionMap;
  onChange: (next: PermissionMap) => void;
  /**
   * Permissions the subject already holds from somewhere else. Rendered ticked and locked, and
   * never written into `value` — granting a duplicate of an inherited permission is a no-op that
   * only makes the grant document harder to read.
   */
  inherited?: PermissionMap;
  /** Label for the inherited badge — "from HR Executive", "from 2 roles". */
  inheritedLabel?: string;
  disabled?: boolean;
  /** Height of the scroll area. The role builder wants more than a dialog does. */
  heightClassName?: string;
}

const hasAction = (map: PermissionMap | undefined, resource: string, action: string): boolean =>
  !!map?.[resource]?.includes(action);

export function PermissionTree({
  registry,
  value,
  onChange,
  inherited,
  inheritedLabel = 'inherited',
  disabled = false,
  heightClassName = 'h-[26rem]',
}: PermissionTreeProps) {
  const [term, setTerm] = useState('');
  const [openModules, setOpenModules] = useState<string[]>([]);
  const [onlySelected, setOnlySelected] = useState(false);

  const allActions = useMemo(() => registryActions(registry), [registry]);

  /** Nodes grouped by module, after search and the "selected only" filter. */
  const grouped = useMemo(() => {
    let nodes = searchRegistry(registry, term);
    if (onlySelected) {
      nodes = nodes.filter((node) =>
        node.actions.some(
          (action) => hasAction(value, node.resource, action) || hasAction(inherited, node.resource, action),
        ),
      );
    }
    const byModule = new Map<string, RegistryNode[]>();
    for (const node of nodes) {
      const list = byModule.get(node.module) ?? [];
      list.push(node);
      byModule.set(node.module, list);
    }
    return [...byModule.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [registry, term, onlySelected, value, inherited]);

  // A search narrows to a handful of modules, and making the user expand each one to see the hit is
  // busywork — so a query auto-expands what it matched.
  const effectiveOpen = useMemo(() => {
    if (term.trim() || onlySelected) return new Set(grouped.map(([moduleName]) => moduleName));
    return new Set(openModules);
  }, [term, onlySelected, grouped, openModules]);

  const selectedCount = countPermissions(value);
  const inheritedCount = countPermissions(inherited);

  /* -------------------------------------------------------------------------------------------
   * Mutations. All go through `commit`, which drops empty keys so a map never accumulates
   * `{"A": []}` entries — those serialise into the grant document and make a diff look like a
   * change when nothing changed.
   * ---------------------------------------------------------------------------------------- */

  const commit = (next: PermissionMap) => {
    const cleaned: PermissionMap = {};
    for (const [resource, actions] of Object.entries(next)) {
      const unique = [...new Set(actions)].filter(Boolean);
      if (unique.length) cleaned[resource] = unique.sort();
    }
    onChange(cleaned);
  };

  const toggleAction = (resource: string, action: string, checked: boolean) => {
    if (disabled) return;
    const next: PermissionMap = { ...value };
    const current = new Set(next[resource] ?? []);
    if (checked) current.add(action);
    else current.delete(action);
    next[resource] = [...current];
    commit(next);
  };

  const setNodeAll = (node: RegistryNode, checked: boolean) => {
    if (disabled) return;
    const next: PermissionMap = { ...value };
    if (checked) next[node.resource] = [...node.actions];
    else delete next[node.resource];
    commit(next);
  };

  const setModuleAll = (nodes: RegistryNode[], checked: boolean) => {
    if (disabled) return;
    const next: PermissionMap = { ...value };
    for (const node of nodes) {
      if (checked) next[node.resource] = [...node.actions];
      else delete next[node.resource];
    }
    commit(next);
  };

  /** "Every Approve, everywhere" — §11's select-an-action-across-modules. */
  const setActionEverywhere = (action: string, checked: boolean) => {
    if (disabled) return;
    const next: PermissionMap = { ...value };
    for (const node of registry) {
      if (!node.actions.includes(action)) continue;
      const current = new Set(next[node.resource] ?? []);
      if (checked) current.add(action);
      else current.delete(action);
      next[node.resource] = [...current];
    }
    commit(next);
  };

  const moduleState = (nodes: RegistryNode[]): 'none' | 'some' | 'all' => {
    let selected = 0;
    let total = 0;
    for (const node of nodes) {
      total += node.actions.length;
      selected += node.actions.filter((action) => hasAction(value, node.resource, action)).length;
    }
    if (selected === 0) return 'none';
    return selected === total ? 'all' : 'some';
  };

  return (
    <div className="space-y-2.5">
      {/* Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
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
              className="absolute right-2 top-2 rounded-full p-1 text-slate-400 hover:bg-slate-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant={onlySelected ? 'default' : 'outline'}
            size="sm"
            onClick={() => setOnlySelected((flag) => !flag)}
          >
            Selected only
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => commit(registryToPermissionMap(registry))}
          >
            Select all
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => commit({})}>
            Clear all
          </Button>
        </div>
      </div>

      {/* Cross-module action shortcuts. */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-white/70 bg-white/70 px-2.5 py-2">
        <span className="mr-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Apply an action everywhere
        </span>
        {['View', 'Add', 'Edit', 'Delete', 'Approve', 'Export'].filter((action) => allActions.includes(action)).map(
          (action) => (
            <Button
              key={action}
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              className="h-7 px-2 text-xs"
              onClick={() => setActionEverywhere(action, true)}
            >
              + {action}
            </Button>
          ),
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700">
          Selected: {selectedCount} permissions
        </Badge>
        {inheritedCount > 0 && (
          <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">
            {inheritedCount} already held ({inheritedLabel})
          </Badge>
        )}
        <span>{grouped.length} module(s) shown</span>
      </div>

      {/* Tree */}
      <ScrollArea className={cn('rounded-xl border border-white/70 bg-white/60', heightClassName)}>
        <div className="divide-y divide-slate-100">
          {grouped.length === 0 && (
            <p className="px-3 py-10 text-center text-sm text-muted-foreground">
              No permissions match “{term}”.
            </p>
          )}

          {grouped.map(([moduleName, nodes]) => {
            const open = effectiveOpen.has(moduleName);
            const state = moduleState(nodes);
            const total = nodes.reduce((sum, node) => sum + node.actions.length, 0);
            const chosen = nodes.reduce(
              (sum, node) => sum + node.actions.filter((action) => hasAction(value, node.resource, action)).length,
              0,
            );

            return (
              <div key={moduleName}>
                <div className="flex items-center gap-2 px-2.5 py-2">
                  <button
                    type="button"
                    onClick={() =>
                      setOpenModules((current) =>
                        current.includes(moduleName)
                          ? current.filter((name) => name !== moduleName)
                          : [...current, moduleName],
                      )
                    }
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    aria-expanded={open}
                  >
                    <ChevronRight
                      className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', open && 'rotate-90')}
                    />
                    <span className="truncate text-sm font-semibold text-slate-800">{moduleName}</span>
                    <Badge
                      variant="outline"
                      className={cn(
                        'shrink-0 text-[10px]',
                        state === 'all'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : state === 'some'
                            ? 'border-amber-200 bg-amber-50 text-amber-700'
                            : 'border-slate-200 bg-white text-slate-500',
                      )}
                    >
                      {chosen}/{total}
                    </Badge>
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={disabled}
                    className="h-7 shrink-0 gap-1 px-2 text-xs"
                    onClick={() => setModuleAll(nodes, state !== 'all')}
                  >
                    {state === 'all' ? <SquareMinus className="h-3.5 w-3.5" /> : <SquareCheck className="h-3.5 w-3.5" />}
                    {state === 'all' ? 'Clear' : 'All'}
                  </Button>
                </div>

                {open && (
                  <div className="space-y-1.5 bg-slate-50/60 px-2.5 pb-2.5 pt-1">
                    {nodes.map((node) => {
                      const nodeAll = node.actions.every((action) => hasAction(value, node.resource, action));
                      const label = node.depth === 0 ? 'Module access' : node.resource.split('.').slice(1).join(' › ');
                      return (
                        <div
                          key={node.resource}
                          className="rounded-lg border border-white bg-white/80 px-2.5 py-2 shadow-sm"
                        >
                          <div className="mb-1.5 flex items-center justify-between gap-2">
                            <p className="min-w-0 truncate text-xs font-semibold text-slate-700">{label}</p>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={disabled}
                              className="h-6 shrink-0 px-1.5 text-[11px]"
                              onClick={() => setNodeAll(node, !nodeAll)}
                            >
                              {nodeAll ? 'Clear' : 'Select all'}
                            </Button>
                          </div>
                          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                            {node.actions.map((action) => {
                              const isInherited = hasAction(inherited, node.resource, action);
                              const checked = isInherited || hasAction(value, node.resource, action);
                              const id = `${node.resource}::${action}`;
                              return (
                                <label
                                  key={id}
                                  htmlFor={id}
                                  className={cn(
                                    'flex min-h-8 cursor-pointer items-center gap-1.5 text-xs',
                                    isInherited && 'cursor-not-allowed text-slate-400',
                                  )}
                                >
                                  <Checkbox
                                    id={id}
                                    checked={checked}
                                    disabled={disabled || isInherited}
                                    onCheckedChange={(next) => toggleAction(node.resource, action, next === true)}
                                  />
                                  <span className="truncate">{action}</span>
                                  {isInherited && (
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Lock className="h-3 w-3 shrink-0 text-slate-400" />
                                        </TooltipTrigger>
                                        <TooltipContent className="text-xs">
                                          Already held {inheritedLabel} — granting it again would change nothing.
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  )}
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

/** Read-only rendering of a permission map, for previews and role detail panels. */
export function PermissionMapSummary({
  map,
  registry,
  emptyLabel = 'No permissions',
  max = 12,
}: {
  map: PermissionMap;
  registry: RegistryNode[];
  emptyLabel?: string;
  max?: number;
}) {
  const byModule = useMemo(() => {
    const grouped = new Map<string, number>();
    const known = new Map(registry.map((node) => [node.resource, node.module]));
    for (const [resource, actions] of Object.entries(map)) {
      const moduleName = known.get(resource) ?? resource.split('.')[0];
      grouped.set(moduleName, (grouped.get(moduleName) ?? 0) + actions.length);
    }
    return [...grouped.entries()].sort((a, b) => b[1] - a[1]);
  }, [map, registry]);

  if (!byModule.length) return <p className="text-xs text-muted-foreground">{emptyLabel}</p>;

  const shown = byModule.slice(0, max);
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map(([moduleName, count]) => (
        <Badge key={moduleName} variant="outline" className="text-[10px] text-slate-600">
          {moduleName} · {count}
        </Badge>
      ))}
      {byModule.length > shown.length && (
        <Badge variant="outline" className="text-[10px] text-muted-foreground">
          +{byModule.length - shown.length} more modules
        </Badge>
      )}
    </div>
  );
}

