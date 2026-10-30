'use client';

/**
 * Theme Management › Module groups: the company's groups for the home page — create, rename,
 * recolour, reorder and delete them, and choose which group each module belongs to.
 *
 * Edits the draft like everything else on Theme Management, so nothing changes for anyone until it
 * is published, and every published version can be restored. A module sits in at most one group;
 * one in none is shown under "Other". Grouping only arranges cards — it never grants a module.
 */

import { useId, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Layers, Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SettingsSection } from '@/components/appearance/controls';
import { GROUP_TONE } from '@/components/home/home-parts';
import {
  DEFAULT_MODULE_GROUPS,
  GROUP_COLORS,
  MAX_MODULE_GROUPS,
  OTHER_GROUP_ID,
  cleanText,
  type GroupColor,
  type ModuleGroup,
} from '@/lib/appearance/model';
import { moduleDisplayName } from '@/lib/module-display-names';
import { permissionModules } from '@/lib/permissions';
import { cn } from '@/lib/utils';

const ALL_MODULES = Object.keys(permissionModules);

/** A slug unique among `taken`, from a label — the same shape the model accepts. */
function newGroupId(label: string, taken: Set<string>): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 34) || 'group';
  let id = base;
  for (let n = 2; taken.has(id) || id === OTHER_GROUP_ID; n++) id = `${base}-${n}`;
  return id;
}

export function ModuleGroupsEditor({
  groups,
  onChange,
  disabled,
}: {
  groups: ModuleGroup[];
  onChange: (next: ModuleGroup[]) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const searchId = useId();

  const groupOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of groups) for (const name of group.modules) if (!map.has(name)) map.set(name, group.id);
    return map;
  }, [groups]);
  const unassigned = ALL_MODULES.filter((name) => !groupOf.has(name)).length;

  const update = (id: string, change: Partial<ModuleGroup>) =>
    onChange(groups.map((group) => (group.id === id ? { ...group, ...change } : group)));

  const move = (index: number, by: -1 | 1) => {
    const target = index + by;
    if (target < 0 || target >= groups.length) return;
    const next = [...groups];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const addGroup = () => {
    if (groups.length >= MAX_MODULE_GROUPS) return;
    const taken = new Set(groups.map((group) => group.id));
    const label = 'New group';
    // The next colour not in use yet, so a new group stands apart from the others.
    const used = new Set(groups.map((group) => group.color));
    const color = GROUP_COLORS.find((c) => !used.has(c)) ?? 'slate';
    onChange([...groups, { id: newGroupId(label, taken), label, color, modules: [] }]);
  };

  // Moving a module takes it out of every group first, so it can only ever be in one.
  const assign = (moduleName: string, groupId: string) =>
    onChange(
      groups.map((group) => {
        const modules = group.modules.filter((name) => name !== moduleName);
        return group.id === groupId ? { ...group, modules: [...modules, moduleName] } : { ...group, modules };
      }),
    );

  const needle = query.trim().toLowerCase();
  const listed = ALL_MODULES.filter((name) => !needle || `${name} ${moduleDisplayName(name)}`.toLowerCase().includes(needle));

  return (
    <SettingsSection
      title="Module groups"
      icon={Layers}
      description="The headings modules are shown under on the home page — always in Command, Launchpad and Aurora Glass, and in Classic when grouping is on. Each module is in one group; a module in none appears under Other."
      action={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5"
          disabled={disabled}
          onClick={() => onChange(DEFAULT_MODULE_GROUPS)}
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Built-in groups
        </Button>
      }
    >
      <div className="space-y-2">
        <p className="text-sm font-semibold">Groups, in the order they are shown</p>
        {groups.length === 0 ? (
          <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            No groups — every module is shown under Other. Add a group to start sorting them.
          </p>
        ) : (
          <ul className="divide-y rounded-xl border">
            {groups.map((group, index) => (
              <li key={group.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <ColorPicker value={group.color} disabled={disabled} label={group.label} onChange={(color) => update(group.id, { color })} />
                <GroupName group={group} disabled={disabled} onCommit={(label) => update(group.id, { label })} />
                <span className="w-24 shrink-0 text-xs text-muted-foreground tabular-nums">
                  {group.modules.length === 1 ? '1 module' : `${group.modules.length} modules`}
                </span>
                <div className="flex shrink-0 items-center">
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={`Move ${group.label} up`} disabled={disabled || index === 0} onClick={() => move(index, -1)}>
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={`Move ${group.label} down`} disabled={disabled || index === groups.length - 1} onClick={() => move(index, 1)}>
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    aria-label={`Delete ${group.label}`}
                    title={group.modules.length ? `Delete — its ${group.modules.length} module(s) move to Other` : 'Delete'}
                    disabled={disabled}
                    onClick={() => onChange(groups.filter((g) => g.id !== group.id))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={disabled || groups.length >= MAX_MODULE_GROUPS} onClick={addGroup}>
          <Plus className="h-4 w-4" aria-hidden="true" /> Add group
        </Button>
        {groups.length >= MAX_MODULE_GROUPS ? <p className="text-xs text-muted-foreground">Up to {MAX_MODULE_GROUPS} groups.</p> : null}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">
            Which group each module is in
            {unassigned > 0 ? <span className="ml-2 font-normal text-muted-foreground">· {unassigned} under Other</span> : null}
          </p>
          <div className="relative w-full sm:w-64">
            <label htmlFor={searchId} className="sr-only">
              Find a module
            </label>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input id={searchId} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a module…" className="h-9 pl-8" />
          </div>
        </div>
        <ul className="grid grid-cols-1 gap-x-4 rounded-xl border px-3 py-1 md:grid-cols-2">
          {listed.map((name) => {
            const current = groupOf.get(name) ?? OTHER_GROUP_ID;
            const group = groups.find((g) => g.id === current);
            return (
              <li key={name} className="flex min-w-0 items-center gap-3 border-b py-2 last:border-b-0">
                <span className="min-w-0 flex-1 truncate text-sm" title={name}>
                  {moduleDisplayName(name)}
                </span>
                <Select value={current} onValueChange={(value) => assign(name, value)} disabled={disabled}>
                  <SelectTrigger className="h-8 w-44 shrink-0 text-left text-xs" aria-label={`Group for ${moduleDisplayName(name)}`}>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={cn('h-2.5 w-2.5 shrink-0 rounded-sm', group ? GROUP_TONE[group.color].dot : 'bg-slate-300')} aria-hidden="true" />
                      <span className="truncate">
                        <SelectValue />
                      </span>
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {groups.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.label}
                      </SelectItem>
                    ))}
                    <SelectItem value={OTHER_GROUP_ID}>Other (no group)</SelectItem>
                  </SelectContent>
                </Select>
              </li>
            );
          })}
          {listed.length === 0 ? <li className="py-3 text-sm text-muted-foreground">No module matches “{query.trim()}”.</li> : null}
        </ul>
      </div>
    </SettingsSection>
  );
}

/**
 * The group's name, committed on blur or Enter rather than per keystroke: the draft is validated as
 * it is edited, which trims spaces and drops a group with no name — so committing every keystroke
 * would eat the space between two words, and clearing the field to retype would delete the group.
 */
function GroupName({ group, disabled, onCommit }: { group: ModuleGroup; disabled?: boolean; onCommit: (label: string) => void }) {
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    if (text === null) return;
    const clean = cleanText(text, 40);
    if (clean && clean !== group.label) onCommit(clean);
    setText(null);
  };
  return (
    <Input
      value={text ?? group.label}
      maxLength={40}
      disabled={disabled}
      aria-label="Group name"
      className="h-9 min-w-40 flex-1"
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        }
        if (event.key === 'Escape') setText(null);
      }}
    />
  );
}

function ColorPicker({ value, onChange, disabled, label }: { value: GroupColor; onChange: (color: GroupColor) => void; disabled?: boolean; label: string }) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as GroupColor)} disabled={disabled}>
      {/* The selected item's own swatch and name show through SelectValue. */}
      <SelectTrigger className="h-9 w-32 shrink-0 text-left text-xs" aria-label={`Colour for ${label}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {GROUP_COLORS.map((color) => (
          <SelectItem key={color} value={color}>
            <span className="flex items-center gap-2">
              <span className={cn('h-3 w-3 rounded', GROUP_TONE[color].dot)} aria-hidden="true" />
              {GROUP_TONE[color].label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
