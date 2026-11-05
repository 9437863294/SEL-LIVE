'use client';

/**
 * The pieces of Daily Requisition's workflow editor
 * (src/app/(protected)/daily-requisition/settings/workflow-configuration/page.tsx): a person picker
 * that takes any number of people, the editor's section cards, a segmented control, the step's
 * button groups, and the preview of what the assignee sees.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { Check, ChevronDown, Info, Paperclip, Search, X, type LucideIcon } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { personOptionLabel } from '@/lib/people-directory';
import type { User } from '@/lib/types';
import { cn } from '@/lib/utils';

/* ── people ──────────────────────────────────────────────────────────────── */

const AVATAR_COLOURS = ['#0f766e', '#7c3aed', '#ea580c', '#db2777', '#2563eb', '#15803d', '#b45309', '#0891b2'];

function colourFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_COLOURS[Math.abs(hash) % AVATAR_COLOURS.length];
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** A person's name and, where known, their designation (src/lib/people-directory.ts). */
export function personParts(user: User | undefined, id: string): { name: string; subtitle: string } {
  if (!user) return { name: id, subtitle: 'Not found' };
  const [name, subtitle = ''] = personOptionLabel(user, undefined, { separator: '\u0000' }).split('\u0000');
  return { name, subtitle };
}

export function Avatar({ id, name, size = 'md' }: { id: string; name: string; size?: 'sm' | 'md' }) {
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center rounded-full font-bold text-white',
        size === 'sm' ? 'h-6 w-6 text-[9px]' : 'h-8 w-8 text-[11px]',
      )}
      style={{ background: colourFor(id) }}
      aria-hidden
    >
      {initialsOf(name)}
    </span>
  );
}

interface PeoplePickerProps {
  users: User[];
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
  /** A single-line trigger for table rows. */
  compact?: boolean;
  /** Labels the first chip (e.g. "Primary") so the order reads. */
  firstLabel?: string;
}

/** Choose any number of people: chips for those chosen, a searchable list for the rest. */
export function PeoplePicker({ users, value, onChange, disabled, placeholder = 'Add people…', compact, firstLabel }: PeoplePickerProps) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const byId = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const chosen = value.filter(Boolean);
  const options = useMemo(() => {
    const t = term.trim().toLowerCase();
    return users
      .filter((u) => !chosen.includes(u.id))
      .map((u) => ({ id: u.id, ...personParts(u, u.id) }))
      .filter((p) => !t || p.name.toLowerCase().includes(t) || p.subtitle.toLowerCase().includes(t))
      .slice(0, 60);
  }, [users, chosen, term]);

  const remove = (id: string) => onChange(chosen.filter((x) => x !== id));

  return (
    <Popover open={open && !disabled} onOpenChange={(o) => { setOpen(o); if (!o) setTerm(''); }}>
      <PopoverTrigger asChild disabled={disabled}>
        <div
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-disabled={disabled}
          className={cn(
            'flex w-full cursor-pointer flex-wrap items-center gap-1.5 rounded-xl border bg-card px-1.5 text-left transition hover:border-violet-300',
            compact ? 'min-h-9 py-1' : 'min-h-11 py-1.5',
            open && 'border-violet-500 ring-2 ring-violet-500/15',
            disabled && 'cursor-not-allowed opacity-60 hover:border-border',
          )}
        >
          {chosen.map((id, i) => {
            const { name } = personParts(byId.get(id), id);
            return (
              <span key={id} className="flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 py-0.5 pl-0.5 pr-2 text-xs font-semibold text-slate-800">
                <Avatar id={id} name={name} size="sm" />
                <span className="max-w-[150px] truncate">{name}</span>
                {i === 0 && firstLabel && chosen.length > 1 ? (
                  <span className="rounded-full bg-violet-200/70 px-1.5 text-[10px] font-bold text-violet-800">{firstLabel}</span>
                ) : null}
                {!disabled && (
                  <button
                    type="button"
                    aria-label={`Remove ${name}`}
                    className="text-slate-400 hover:text-slate-700"
                    onClick={(event) => {
                      event.stopPropagation();
                      remove(id);
                    }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </span>
            );
          })}
          <span className="flex min-w-[120px] flex-1 items-center justify-between gap-2 px-1.5 text-sm text-muted-foreground">
            {chosen.length ? (compact ? '' : 'Add more…') : placeholder}
            <ChevronDown className="h-4 w-4 shrink-0" />
          </span>
        </div>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(380px,var(--radix-popover-trigger-width))] min-w-[280px] p-1.5">
        <div className="relative mb-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            autoFocus
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search people…"
            className="h-9 w-full rounded-lg border bg-background pl-8 pr-2 text-sm outline-none focus:border-violet-500"
          />
        </div>
        <div className="max-h-64 overflow-y-auto">
          {options.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">{term ? 'No one matches.' : 'Everyone is already added.'}</p>
          ) : (
            options.map((p) => (
              <button
                key={p.id}
                type="button"
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-muted"
                onClick={() => onChange([...chosen, p.id])}
              >
                <Avatar id={p.id} name={p.name} size="sm" />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold leading-tight">{p.name}</span>
                  {p.subtitle ? <span className="block truncate text-[11px] text-muted-foreground">{p.subtitle}</span> : null}
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ── layout ──────────────────────────────────────────────────────────────── */

/** A coloured tile with an icon, as the editor's section headings use. */
export function IconTile({ icon: Icon, from, to, size = 'md' }: { icon: LucideIcon; from: string; to: string; size?: 'sm' | 'md' }) {
  return (
    <span
      className={cn('grid shrink-0 place-items-center text-white', size === 'sm' ? 'h-7 w-7 rounded-[9px]' : 'h-9 w-9 rounded-[11px]')}
      style={{ background: `linear-gradient(145deg, ${from}, ${to})` }}
    >
      <Icon className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-[18px] w-[18px]'} />
    </span>
  );
}

export function EditorSection({
  icon,
  from,
  to,
  title,
  description,
  aside,
  children,
}: {
  icon: LucideIcon;
  from: string;
  to: string;
  title: string;
  description: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-b px-4 py-4 last:border-b-0 sm:px-5 sm:py-5">
      <div className="mb-3 flex items-center gap-2.5">
        <IconTile icon={icon} from={from} to={to} size="sm" />
        <div className="min-w-0">
          <h3 className="text-sm font-bold leading-tight">{title}</h3>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        {aside ? <div className="ml-auto shrink-0">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function FieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-[11.5px] font-bold text-slate-600">
      {children}
    </label>
  );
}

export function Hint({ children, tone }: { children: ReactNode; tone?: 'warn' }) {
  return tone === 'warn' ? (
    <p className="mt-2 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[12.5px] font-semibold text-amber-800">
      <Info className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </p>
  ) : (
    <p className="mt-1.5 text-[11.5px] text-muted-foreground">{children}</p>
  );
}

export interface SegmentOption<V extends string> {
  value: V;
  label: string;
  icon?: LucideIcon;
}

export function Segmented<V extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: V;
  options: SegmentOption<V>[];
  onChange: (value: V) => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex flex-wrap gap-0.5 rounded-xl bg-muted p-[3px]" role="radiogroup">
      {options.map((option) => {
        const on = option.value === value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex items-center gap-1.5 rounded-[9px] px-3 py-1.5 text-[12.5px] font-semibold text-muted-foreground transition disabled:cursor-not-allowed',
              on && 'bg-card text-foreground shadow-[0_2px_8px_-3px_rgba(15,23,42,0.27)]',
            )}
          >
            {Icon ? <Icon className="h-[15px] w-[15px]" /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── the step's buttons ──────────────────────────────────────────────────── */

export interface ActionGroup {
  name: string;
  colour: string;
  actions: string[];
}

/** The workflow's actions, grouped by what they do. */
export const ACTION_GROUPS: ActionGroup[] = [
  { name: 'Decide', colour: '#16a34a', actions: ['Approve', 'Reject', 'Revise', 'Return to Pending', 'Cancel'] },
  { name: 'Verify', colour: '#2563eb', actions: ['Verify', 'Re-verify', 'Verified', 'View Checklist'] },
  { name: 'Edit data', colour: '#7c3aed', actions: ['Edit', 'Update', 'Add', 'Delete', 'Update Approved Amount'] },
  {
    name: 'Payment & close',
    colour: '#ea580c',
    actions: ['Mark as Received', 'Send for Payment', 'Mark as Received for Payment', 'Create Expense Request', 'Complete'],
  },
];

/** Actions that move a requisition on — a stage needs at least one. */
export const FORWARD_ACTIONS = ['Approve', 'Verify', 'Verified', 'Send for Payment', 'Complete', 'Mark as Received', 'Mark as Received for Payment'];

export function ActionGroups({
  selected,
  onToggle,
  disabled,
}: {
  selected: Set<string>;
  onToggle: (action: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3">
      {ACTION_GROUPS.map((group) => (
        <div key={group.name}>
          <div className="mb-1.5 flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.07em] text-muted-foreground">
            <i className="h-2 w-2 rounded-[3px]" style={{ background: group.colour }} />
            {group.name}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {group.actions.map((action) => {
              const on = selected.has(action);
              return (
                <button
                  key={action}
                  type="button"
                  disabled={disabled}
                  aria-pressed={on}
                  onClick={() => onToggle(action)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-[11px] border bg-card py-1.5 pl-2 pr-3 text-[12.5px] font-semibold text-muted-foreground transition disabled:cursor-not-allowed disabled:opacity-60',
                    on && 'text-foreground',
                  )}
                  style={on ? { borderColor: group.colour, background: `color-mix(in srgb, ${group.colour} 9%, hsl(var(--card)))` } : undefined}
                >
                  <span
                    className="grid h-4 w-4 place-items-center rounded-[5px] border-2 text-white"
                    style={on ? { background: group.colour, borderColor: group.colour } : { borderColor: '#cbd5e1' }}
                  >
                    {on ? <Check className="h-2.5 w-2.5" strokeWidth={3.4} /> : null}
                  </span>
                  {action}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── preview ─────────────────────────────────────────────────────────────── */

export function AssigneePreview({
  stepLabel,
  tat,
  instructions,
  upload,
  buttons,
}: {
  stepLabel: string;
  tat: number;
  instructions: string;
  upload: 'Required' | 'Optional' | 'Not Required';
  buttons: string[];
}) {
  const primary = buttons.find((b) => FORWARD_ACTIONS.includes(b));
  return (
    <div className="mx-3.5 mb-3.5 overflow-hidden rounded-2xl border bg-muted/40">
      <div className="border-b bg-card p-3">
        <div className="flex items-center justify-between gap-2">
          <b className="truncate text-[13px]">REC/0001 · Sample party</b>
          <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">{tat} h to act</span>
        </div>
        <p className="truncate text-[11.5px] text-muted-foreground">₹ 27,500 · Sample project · {stepLabel}</p>
      </div>
      <div className="mx-3 my-2.5 flex gap-2 rounded-xl bg-indigo-50 px-2.5 py-2 text-xs text-indigo-800">
        {instructions ? (
          <>
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="whitespace-pre-wrap break-words">{instructions}</span>
          </>
        ) : (
          <span className="text-muted-foreground">No instructions shown</span>
        )}
      </div>
      {upload !== 'Not Required' && (
        <div className="mx-3 mb-2.5 flex items-center justify-center gap-1.5 rounded-xl border-[1.5px] border-dashed border-slate-300 p-2 text-[11.5px] font-semibold text-muted-foreground">
          <Paperclip className="h-3.5 w-3.5" />
          {upload === 'Required' ? 'Attachment required before acting' : 'Attach a file (optional)'}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5 px-3 pb-3">
        {buttons.length ? (
          buttons.map((b) => (
            <span
              key={b}
              className={cn(
                'rounded-[9px] border bg-card px-2.5 py-1 text-[11.5px] font-bold',
                b === primary && 'border-transparent bg-gradient-to-r from-teal-700 to-green-600 text-white',
                ['Reject', 'Cancel', 'Delete'].includes(b) && 'border-rose-200 text-rose-700',
              )}
            >
              {b}
            </span>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">No buttons</span>
        )}
      </div>
    </div>
  );
}

export function SummaryRows({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <div>
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-3 border-t border-dashed px-4 py-1.5 text-[12.5px]">
          <span className="text-muted-foreground">{label}</span>
          <b className="min-w-0 text-right">{value}</b>
        </div>
      ))}
    </div>
  );
}

export function CheckList({ items }: { items: Array<{ ok: boolean; label: string }> }) {
  return (
    <div className="px-4 pb-3.5 pt-1">
      {items.map((item) => (
        <div key={item.label} className="flex items-start gap-2 py-0.5 text-[12.5px] font-semibold">
          <span
            className={cn(
              'mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full',
              item.ok ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700',
            )}
          >
            {item.ok ? <Check className="h-[11px] w-[11px]" strokeWidth={3} /> : <span className="text-[11px] font-extrabold">!</span>}
          </span>
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

export function SideBox({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[20px] border bg-card">
      <header className="flex items-center justify-between px-4 pb-2 pt-3">
        <b className="text-[13.5px]">{title}</b>
        {aside ? <small className="text-[11.5px] font-semibold text-muted-foreground">{aside}</small> : null}
      </header>
      {children}
    </div>
  );
}
