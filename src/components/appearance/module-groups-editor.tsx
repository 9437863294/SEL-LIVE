'use client';

/**
 * Theme Management › Module groups: the company's groups for the home page, as a board — one card
 * per group, its modules as chips inside it, an "Other" card for modules in no group, and a card to
 * add a group.
 *
 * - A group card: its colour (click the swatch), its name (click to rename), how many modules it
 *   holds, and a menu to move it earlier or later or delete it.
 * - A module chip: drag it onto another card, or use its arrow for a "Move to" menu — the menu is
 *   the way on a phone, where dragging is not available, and from the keyboard.
 *
 * Edits the draft like everything else on Theme Management, so nothing changes for anyone until it
 * is published, and every published version can be restored. A module sits in at most one group;
 * one in none is shown under "Other". Grouping only arranges cards — it never grants a module.
 */

import { useEffect, useId, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, ChevronDown, Layers, MoreHorizontal, Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
/** The drag payload's type, so a card accepts module chips and nothing else dropped on it. */
const DRAG_TYPE = 'application/x-sel-module';

const byLabel = (left: string, right: string) => moduleDisplayName(left).localeCompare(moduleDisplayName(right));

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

interface Target {
  id: string;
  label: string;
  color: GroupColor | null;
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

  const placed = useMemo(() => new Set(groups.flatMap((group) => group.modules)), [groups]);
  const unassigned = useMemo(() => ALL_MODULES.filter((name) => !placed.has(name)).sort(byLabel), [placed]);
  // Where a module can be moved to, for the chips' menus: every group, then Other.
  const targets: Target[] = useMemo(
    () => [...groups.map(({ id, label, color }) => ({ id, label, color })), { id: OTHER_GROUP_ID, label: 'Other (no group)', color: null }],
    [groups],
  );

  const needle = query.trim().toLowerCase();
  const matches = (name: string) => !needle || `${name} ${moduleDisplayName(name)}`.toLowerCase().includes(needle);
  const matchCount = needle ? ALL_MODULES.filter(matches).length : 0;

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

  const chip = (name: string, current: string) => (
    <ModuleChip key={name} name={name} current={current} targets={targets} dimmed={!matches(name)} highlighted={Boolean(needle) && matches(name)} disabled={disabled} onMove={assign} />
  );

  return (
    <SettingsSection
      title="Module groups"
      icon={Layers}
      description="The headings modules are shown under on the home page — always in Command, Launchpad and Aurora Glass, and in Classic when grouping is on. Drag a module onto another group, or use its arrow to move it."
      action={
        <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5" disabled={disabled} onClick={() => onChange(DEFAULT_MODULE_GROUPS)}>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Built-in groups
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <label htmlFor={searchId} className="sr-only">
            Find a module
          </label>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input id={searchId} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a module…" className="h-9 pl-8" />
        </div>
        <p role="status" className="text-xs text-muted-foreground">
          {needle
            ? matchCount === 1
              ? '1 module matches — highlighted below.'
              : `${matchCount} modules match — highlighted below.`
            : `${groups.length} ${groups.length === 1 ? 'group' : 'groups'} · ${unassigned.length} ${unassigned.length === 1 ? 'module' : 'modules'} under Other`}
        </p>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-3">
        {groups.map((group, index) => (
          <BoardCard
            key={group.id}
            onDropModule={(name) => assign(name, group.id)}
            disabled={disabled}
            header={
              <>
                <ColourPicker value={group.color} label={group.label} disabled={disabled} onChange={(color) => update(group.id, { color })} />
                <GroupName group={group} disabled={disabled} onCommit={(label) => update(group.id, { label })} />
                <span className="shrink-0 rounded-full bg-muted px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">{group.modules.length}</span>
                <GroupMenu
                  label={group.label}
                  count={group.modules.length}
                  disabled={disabled}
                  first={index === 0}
                  last={index === groups.length - 1}
                  onMove={(by) => move(index, by)}
                  onDelete={() => onChange(groups.filter((g) => g.id !== group.id))}
                />
              </>
            }
          >
            {group.modules.length === 0 ? (
              <p className="px-0.5 text-xs text-muted-foreground">No modules yet — drag one here, or move one from its menu.</p>
            ) : (
              [...group.modules].sort(byLabel).map((name) => chip(name, group.id))
            )}
          </BoardCard>
        ))}

        <BoardCard
          onDropModule={(name) => assign(name, OTHER_GROUP_ID)}
          disabled={disabled}
          className="border-dashed bg-muted/30"
          header={
            <>
              <span className="h-5 w-5 shrink-0 rounded-md border-2 border-dashed border-muted-foreground/40" aria-hidden="true" />
              <span className="min-w-0 flex-1 px-1.5 text-sm font-semibold">Other</span>
              <span className="shrink-0 rounded-full bg-muted px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">{unassigned.length}</span>
            </>
          }
        >
          {unassigned.length === 0 ? (
            <p className="px-0.5 text-xs text-muted-foreground">Every module is in a group. Drop one here to take it out of its group.</p>
          ) : (
            unassigned.map((name) => chip(name, OTHER_GROUP_ID))
          )}
        </BoardCard>

        <button
          type="button"
          onClick={addGroup}
          disabled={disabled || groups.length >= MAX_MODULE_GROUPS}
          className="flex min-h-[7.5rem] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed text-sm font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="h-5 w-5" aria-hidden="true" />
          {groups.length >= MAX_MODULE_GROUPS ? `Up to ${MAX_MODULE_GROUPS} groups` : 'Add group'}
        </button>
      </div>
    </SettingsSection>
  );
}

/** A card on the board that module chips can be dropped onto. */
function BoardCard({
  header,
  children,
  onDropModule,
  disabled,
  className,
}: {
  header: ReactNode;
  children: ReactNode;
  onDropModule: (name: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [over, setOver] = useState(false);
  const accepts = (event: DragEvent) => !disabled && Array.from(event.dataTransfer.types).includes(DRAG_TYPE);
  return (
    <div
      onDragOver={(event) => {
        if (!accepts(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setOver(true);
      }}
      onDragLeave={(event) => {
        // Leaving for one of the card's own children is not leaving the card.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(event) => {
        setOver(false);
        if (!accepts(event)) return;
        event.preventDefault();
        const name = event.dataTransfer.getData(DRAG_TYPE);
        if (name) onDropModule(name);
      }}
      className={cn('flex min-w-0 flex-col rounded-xl border bg-card transition-colors', over && 'border-primary bg-primary/5 ring-1 ring-primary', className)}
    >
      <div className="flex items-center gap-1.5 border-b px-2 py-1.5">{header}</div>
      <div className="flex min-h-[4.5rem] flex-wrap content-start gap-1.5 p-2">{children}</div>
    </div>
  );
}

/** A module on the board: drag it by its name, or open its arrow for "Move to". */
function ModuleChip({
  name,
  current,
  targets,
  dimmed,
  highlighted,
  disabled,
  onMove,
}: {
  name: string;
  current: string;
  targets: Target[];
  dimmed: boolean;
  highlighted: boolean;
  disabled?: boolean;
  onMove: (name: string, groupId: string) => void;
}) {
  const label = moduleDisplayName(name);
  return (
    <div
      draggable={!disabled}
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, name);
        event.dataTransfer.effectAllowed = 'move';
      }}
      title={label === name ? undefined : name}
      className={cn(
        'inline-flex max-w-full items-center rounded-md border bg-background text-xs shadow-sm transition-opacity',
        !disabled && 'cursor-grab active:cursor-grabbing',
        dimmed && 'opacity-35',
        highlighted && 'border-primary ring-1 ring-primary',
      )}
    >
      <span className="truncate py-1 pl-2 pr-0.5">{label}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <button
            type="button"
            aria-label={`Move ${label} to another group`}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-r-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed"
          >
            <ChevronDown className="h-3 w-3" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Move {label} to</DropdownMenuLabel>
          {targets.map((target, index) => (
            <div key={target.id}>
              {target.id === OTHER_GROUP_ID && index > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem disabled={target.id === current} onSelect={() => onMove(name, target.id)} className="gap-2 text-sm">
                <span
                  aria-hidden="true"
                  className={cn('h-2.5 w-2.5 shrink-0 rounded-sm', target.color ? GROUP_TONE[target.color].dot : 'border border-dashed border-muted-foreground/60')}
                />
                <span className="truncate">{target.label}</span>
                {target.id === current ? <span className="ml-auto text-[11px] text-muted-foreground">Here</span> : null}
              </DropdownMenuItem>
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** The group's colour: a swatch that opens the twelve to choose from. */
function ColourPicker({ value, onChange, disabled, label }: { value: GroupColor; onChange: (color: GroupColor) => void; disabled?: boolean; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label={`Colour for ${label}: ${GROUP_TONE[value].label}`}
          className={cn('h-5 w-5 shrink-0 rounded-md shadow-sm ring-offset-background transition hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:hover:scale-100', GROUP_TONE[value].dot)}
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <p className="mb-1.5 px-0.5 text-xs font-medium text-muted-foreground">Colour</p>
        <div className="grid grid-cols-6 gap-1.5" role="radiogroup" aria-label={`Colour for ${label}`}>
          {GROUP_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={color === value}
              aria-label={GROUP_TONE[color].label}
              title={GROUP_TONE[color].label}
              onClick={() => {
                onChange(color);
                setOpen(false);
              }}
              className={cn(
                'h-6 w-6 rounded-md ring-offset-background transition hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                GROUP_TONE[color].dot,
                color === value && 'ring-2 ring-foreground ring-offset-2',
              )}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Move earlier / later and delete, out of the way in a menu. */
function GroupMenu({
  label,
  count,
  first,
  last,
  disabled,
  onMove,
  onDelete,
}: {
  label: string;
  count: number;
  first: boolean;
  last: boolean;
  disabled?: boolean;
  onMove: (by: -1 | 1) => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={`More for ${label}`}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem disabled={first} onSelect={() => onMove(-1)} className="gap-2">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Show earlier
        </DropdownMenuItem>
        <DropdownMenuItem disabled={last} onSelect={() => onMove(1)} className="gap-2">
          <ArrowRight className="h-4 w-4" aria-hidden="true" /> Show later
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onDelete} className="gap-2 text-destructive focus:text-destructive">
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          <span>
            Delete group
            {count > 0 ? <span className="block text-[11px] text-muted-foreground">{count === 1 ? 'Its module moves to Other' : `Its ${count} modules move to Other`}</span> : null}
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The group's name: shown in full (wrapping to two lines) and turned into a field when clicked.
 * A field all the time cut long names off at the card's width.
 *
 * Committed on blur or Enter rather than per keystroke: the draft is validated as it is edited,
 * which trims spaces and drops a group with no name — so committing every keystroke would eat the
 * space between two words, and clearing the field to retype would delete the group. Escape puts the
 * name back.
 */
function GroupName({ group, disabled, onCommit }: { group: ModuleGroup; disabled?: boolean; onCommit: (label: string) => void }) {
  const [text, setText] = useState<string | null>(null);
  if (text === null) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setText(group.label)}
        title={disabled ? undefined : 'Rename'}
        aria-label={`Rename ${group.label}`}
        className="min-w-0 flex-1 rounded-md px-1.5 py-1 text-left text-sm font-semibold leading-tight transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:hover:bg-transparent"
      >
        <span className="line-clamp-2 break-words">{group.label}</span>
      </button>
    );
  }
  const commit = () => {
    const clean = cleanText(text, 40);
    if (clean && clean !== group.label) onCommit(clean);
    setText(null);
  };
  return <NameField value={text} onChange={setText} onCommit={commit} onCancel={() => setText(null)} />;
}

/** The rename field, focused with its text selected as it opens. */
function NameField({ value, onChange, onCommit, onCancel }: { value: string; onChange: (value: string) => void; onCommit: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.select(), []);
  return (
    <Input
      ref={ref}
      value={value}
      maxLength={40}
      aria-label="Group name"
      className="h-8 min-w-0 flex-1 px-1.5 text-sm font-semibold"
      onChange={(event) => onChange(event.target.value)}
      onBlur={onCommit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onCommit();
        }
        if (event.key === 'Escape') onCancel();
      }}
    />
  );
}
