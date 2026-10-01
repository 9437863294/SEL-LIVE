'use client';

/**
 * Expenses › Settings › Who Does What — the module's own answer to "who will act, what will they
 * act on, and who are the alternatives", for Expenses alone.
 *
 * Global roles stay in Settings › Access Management; nothing here edits a role. This screen names
 * each of the eleven real, enforced Expenses actions and records, per action, who acts on it, what
 * they act on (the same people everywhere, a role, a different person per department, or a
 * different person above a threshold) and who stands in when they cannot. How much authority that
 * record carries is itself a per-action setting: `roles-only` changes nothing, `assigned-too`
 * widens access beyond the role holders, `assigned-only` narrows it to the people named. The two
 * non-default modes are tinted so an enforced action is visible scanning down the page.
 *
 * Every row collapses to one quiet line, because eleven open editors is not a screen anybody can
 * read. The domain logic — the action list, the resolution, `mayAct`, the validation and the
 * audit-log flattening — lives in `src/lib/expenses-roles.ts` and is covered by
 * `tests/expenses-roles.test.mjs`; this file is the editor for it and nothing more.
 *
 * Writes the whole of `expensesSettings/user-roles` (merge: false) — the document is this page's
 * alone, so a full replace is what makes a removed assignment actually disappear. The before/after
 * in the activity log is measured against the document as it stood a moment before the write.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, doc as docRef, getDoc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  FlaskConical,
  Loader2,
  Lock,
  Plus,
  Save,
  ScrollText,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Tags,
  Trash2,
  UserCog,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { diffFields } from '@/lib/activity-logger';
import {
  hasPermission as roleHasPermission,
  resolveEffectiveAccess,
  type EffectiveAccess,
  type RoleLike,
  type ScopeGrantConfig,
  type UserAccessGrant,
} from '@/lib/access-control';
import {
  ASSIGNMENT_LABELS,
  EXPENSES_ACTIONS,
  EXPENSES_ACTION_GROUPS,
  MODE_LABELS,
  assignmentFor,
  emptyPair,
  flattenExpensesRoles,
  mayAct,
  resolveExpensesRolesDoc,
  validateExpensesRoles,
  type ActionMode,
  type ActorPair,
  type AmountBand,
  type AssignmentType,
  type ExpensesActionAssignment,
  type ExpensesActionDef,
  type ExpensesActionKey,
  type ExpensesRolesDoc,
} from '@/lib/expenses-roles';
import { EXPENSES_ROLES_PATH, useExpensesRoles } from '@/components/expenses/use-expenses-roles';
import {
  CONTROL_LABEL,
  ControlAccessDenied,
  ControlCard,
  IssueList,
  ReadOnlyNotice,
  stampLine,
} from '@/components/expenses/settings-control-kit';
import type { ExpenseSettingsIssue } from '@/lib/expenses-settings';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/** Radix Select cannot hold an empty item value, so "nothing chosen" travels as this. */
const NONE = '__none__';

const ACCESS_GRANTS = 'accessGrants';
const ACCESS_SCOPE_GRANTS = 'accessScopeGrants';

const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

const newBandId = () => `band-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** A person or a role as the pickers see it: a name, and a second line to tell two Ashas apart. */
interface PickerOption {
  id: string;
  name: string;
  note?: string;
}

interface DirectoryUser extends PickerOption {
  email: string;
  role: string;
  status: string;
}

const GROUP_ICON: Record<(typeof EXPENSES_ACTION_GROUPS)[number], LucideIcon> = {
  Requests: FileText,
  Masters: Tags,
  Controls: SlidersHorizontal,
  Reporting: ScrollText,
};

const GROUP_HINT: Record<(typeof EXPENSES_ACTION_GROUPS)[number], string> = {
  Requests: 'Raising, editing and importing the requests themselves.',
  Masters: 'The account heads and the numbering every request draws on.',
  Controls: 'The rules the module enforces on every form and register.',
  Reporting: 'The report centre, the exports and the audit trail.',
};

/** Slate for the default, amber for widening, emerald for narrowing — the same three everywhere. */
type ModeTone = 'slate' | 'amber' | 'emerald';

const MODE_TONE: Record<ActionMode, ModeTone> = {
  'roles-only': 'slate',
  'assigned-too': 'amber',
  'assigned-only': 'emerald',
};

const MODE_CONSEQUENCE: Record<ActionMode, string> = {
  'roles-only': 'Nothing about access changes — whoever holds the role permission may act, as today.',
  'assigned-too': 'Widens access: the people named may act as well as anyone holding the role permission.',
  'assigned-only': 'Narrows access: only the people named may act. Holding the role permission is no longer enough.',
};

const MODE_CHIP: Record<ModeTone, string> = {
  slate: 'border-slate-200 bg-slate-50 text-slate-600',
  amber: 'border-amber-200 bg-amber-50 text-amber-800',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
};

const MODE_EDGE: Record<ModeTone, string> = {
  slate: 'border-l-transparent',
  amber: 'border-l-amber-400',
  emerald: 'border-l-emerald-400',
};

const SEGMENT_ACTIVE: Record<ModeTone, string> = {
  slate: 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200',
  amber: 'bg-amber-100 text-amber-900 shadow-sm ring-1 ring-amber-200',
  emerald: 'bg-emerald-100 text-emerald-900 shadow-sm ring-1 ring-emerald-200',
};

/* ── access ──────────────────────────────────────────────────────────────── */

/**
 * View with View or Edit on Expenses › User Roles, or View on Expenses › Settings. Edit with Edit
 * on the section, or with Manage Accounts on Settings — the right that administers the module's
 * other masters, so the page is not read-only for everyone until roles grant the new section.
 */
function useExpensesRolesAccess() {
  const { can, isLoading } = useAuthorization();
  const resource = 'Expenses.User Roles';
  const canEdit = can('Edit', resource) || can('Manage Accounts', 'Expenses.Settings');
  const canView = canEdit || can('View', resource) || can('View', 'Expenses.Settings');
  return { canView, canEdit, isLoading };
}

/* ── small shared pieces ─────────────────────────────────────────────────── */

/** diffFields only walks the keys of `after`, so anything dropped is spelt out as removed. */
function withRemovals(before: Record<string, string>, after: Record<string, string>) {
  const padded: Record<string, string> = { ...after };
  for (const key of Object.keys(before)) if (!(key in padded)) padded[key] = '(removed)';
  return padded;
}

/** One figure in the header strip. */
function SummaryStat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'warning' }) {
  return (
    <div className="min-w-0 px-4 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className={cn('truncate text-sm font-semibold text-slate-900', tone === 'warning' && 'text-amber-700')} title={value}>
        {value}
      </p>
      {hint && <p className="truncate text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** A row of mutually exclusive choices, small enough to sit inside a table cell. */
function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled,
  ariaLabel,
}: {
  options: readonly { value: T; label: string; tone?: ModeTone }[];
  value: T;
  onChange: (next: T) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex flex-wrap items-center gap-1 rounded-lg border bg-slate-50/70 p-1">
      {options.map(option => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => !disabled && onChange(option.value)}
            className={cn(
              'h-7 rounded-md px-2.5 text-xs font-medium transition-colors',
              active ? SEGMENT_ACTIVE[option.tone ?? 'slate'] : 'text-slate-600 hover:bg-white hover:text-slate-900',
              disabled && 'cursor-not-allowed opacity-60 hover:bg-transparent',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A searchable multi-select over people (or roles), usable at a hundred of them.
 *
 * Chosen entries are chips with a remove button; the popover is a filtered checklist that stays
 * open so several people can be picked in one go. Filtering is done here rather than by cmdk
 * (`shouldFilter={false}`) so a name, an email and a designation all match the same box. An id
 * that no longer resolves to anybody is still shown — as a tinted chip — because silently dropping
 * it would hide exactly the problem `validateExpensesRoles` is warning about.
 */
function ActorPicker({
  options,
  value,
  onChange,
  disabled,
  placeholder,
  ariaLabel,
  single,
  emptyText,
}: {
  options: readonly PickerOption[];
  value: readonly string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  placeholder: string;
  ariaLabel: string;
  /** One choice only — for the checker, where "who" is a single person. */
  single?: boolean;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const byId = useMemo(() => new Map(options.map(option => [option.id, option])), [options]);

  const needle = query.trim().toLowerCase();
  const shown = needle
    ? options.filter(option => `${option.name} ${option.note ?? ''}`.toLowerCase().includes(needle))
    : options;

  const toggle = (id: string) => {
    if (single) {
      onChange([id]);
      setOpen(false);
      return;
    }
    onChange(value.includes(id) ? value.filter(current => current !== id) : [...value, id]);
  };

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {value.map(id => {
        const option = byId.get(id);
        return (
          <span
            key={id}
            className={cn(
              'inline-flex max-w-[12rem] items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px]',
              option ? 'border-slate-200 bg-slate-50 text-slate-700' : 'border-destructive/40 bg-destructive/5 text-destructive',
            )}
            title={option ? [option.name, option.note].filter(Boolean).join(' · ') : `No longer exists (${id})`}
          >
            <span className="truncate">{option ? option.name : 'No longer exists'}</span>
            {!disabled && (
              <button
                type="button"
                aria-label={`Remove ${option ? option.name : id}`}
                className="shrink-0 rounded hover:text-destructive"
                onClick={() => onChange(value.filter(current => current !== id))}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        );
      })}

      {value.length === 0 && disabled && <span className="text-[11px] text-muted-foreground">{emptyText ?? 'Nobody'}</span>}

      {!disabled && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={ariaLabel}
              className="h-7 gap-1 border-dashed px-2 text-[11px] font-normal text-muted-foreground"
            >
              <Plus className="h-3 w-3" /> {value.length === 0 ? placeholder : single ? 'Change' : 'Add'}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[20rem] p-0">
            <Command shouldFilter={false}>
              <CommandInput value={query} onValueChange={setQuery} placeholder={placeholder} className="h-9 text-sm" />
              <CommandList>
                <CommandEmpty>Nobody matches that.</CommandEmpty>
                <CommandGroup>
                  {shown.map(option => {
                    const chosen = value.includes(option.id);
                    return (
                      <CommandItem key={option.id} value={option.id} onSelect={() => toggle(option.id)} className="gap-2">
                        <span
                          className={cn(
                            'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                            chosen ? 'border-primary bg-primary text-primary-foreground' : 'border-slate-300',
                            single && 'rounded-full',
                          )}
                        >
                          {chosen && <Check className="h-3 w-3" />}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm">{option.name}</span>
                          {option.note && <span className="block truncate text-[11px] text-muted-foreground">{option.note}</span>}
                        </span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

/** "Who acts" above "Alternatives", the pair every assignment type is made of. */
function PairFields({
  pair,
  onChange,
  options,
  alternateOptions,
  disabled,
  primaryLabel,
  primaryPlaceholder,
}: {
  pair: { primary: string[]; alternates: string[] };
  onChange: (next: { primary: string[]; alternates: string[] }) => void;
  options: readonly PickerOption[];
  /** Alternatives are always people, even when the primary is a role. */
  alternateOptions: readonly PickerOption[];
  disabled: boolean;
  primaryLabel: string;
  primaryPlaceholder: string;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="min-w-0 space-y-1.5">
        <span className={CONTROL_LABEL}>{primaryLabel}</span>
        <ActorPicker
          options={options}
          value={pair.primary}
          disabled={disabled}
          placeholder={primaryPlaceholder}
          ariaLabel={primaryLabel}
          onChange={primary => onChange({ ...pair, primary })}
        />
      </div>
      <div className="min-w-0 space-y-1.5">
        <span className={CONTROL_LABEL}>Alternatives</span>
        <ActorPicker
          options={alternateOptions}
          value={pair.alternates}
          disabled={disabled}
          placeholder="Who stands in"
          ariaLabel="Alternatives"
          emptyText="No alternative"
          onChange={alternates => onChange({ ...pair, alternates })}
        />
      </div>
    </div>
  );
}

/** "Up to ₹1,00,000 — Asha, alt Bimal" — the band as a sentence, under the editable row. */
function bandSentence(band: AmountBand, nameOf: (id: string) => string): string {
  const range =
    band.from === null && band.to === null
      ? 'Any amount'
      : band.from === null
        ? `Up to ${money.format(band.to as number)}`
        : band.to === null
          ? `${money.format(band.from)} and above`
          : `${money.format(band.from)} to ${money.format(band.to)}`;
  const who = band.primary.length ? band.primary.map(nameOf).join(', ') : 'nobody assigned';
  const alt = band.alternates.length ? `, alt ${band.alternates.map(nameOf).join(', ')}` : '';
  return `${range} — ${who}${alt}`;
}

/** The first two names and "+N", for a one-line summary. */
function listNames(ids: readonly string[], nameOf: (id: string) => string, max = 2): string {
  if (ids.length === 0) return '';
  const head = ids.slice(0, max).map(nameOf).join(', ');
  return ids.length > max ? `${head} +${ids.length - max}` : head;
}

/* ── one action ──────────────────────────────────────────────────────────── */

function ActionRow({
  def,
  assignment,
  onChange,
  open,
  onToggle,
  canEdit,
  users,
  roles,
  departments,
  nameOf,
  errorCount,
  warningCount,
}: {
  def: ExpensesActionDef;
  assignment: ExpensesActionAssignment;
  onChange: (next: ExpensesActionAssignment) => void;
  open: boolean;
  onToggle: () => void;
  canEdit: boolean;
  users: readonly PickerOption[];
  roles: readonly PickerOption[];
  departments: readonly PickerOption[];
  nameOf: (id: string) => string;
  errorCount: number;
  warningCount: number;
}) {
  const [deptSearch, setDeptSearch] = useState('');
  const tone = MODE_TONE[assignment.mode];
  const enforced = assignment.mode !== 'roles-only';

  const types: AssignmentType[] = [
    'users',
    'roles',
    ...(def.departmentScoped ? (['department'] as AssignmentType[]) : []),
    ...(def.amountAware ? (['amount'] as AssignmentType[]) : []),
  ];

  const mappedDepartments = Object.entries(assignment.byDepartment).filter(
    ([, pair]) => pair.primary.length > 0 || pair.alternates.length > 0,
  ).length;

  /** The one-line answer to "who acts?", for the collapsed row. */
  const summary = (() => {
    switch (assignment.type) {
      case 'roles': {
        if (assignment.roles.primary.length === 0) return 'No role named';
        const alt = assignment.roles.alternates.length ? ` · alt ${listNames(assignment.roles.alternates, nameOf)}` : '';
        return `${listNames(assignment.roles.primary, nameOf)}${alt}`;
      }
      case 'department':
        return mappedDepartments === 0
          ? 'No department mapped'
          : `${mappedDepartments} of ${departments.length || mappedDepartments} departments mapped`;
      case 'amount':
        return assignment.bands.length === 0
          ? 'No amount band set'
          : `${assignment.bands.length} ${assignment.bands.length === 1 ? 'band' : 'bands'}`;
      default: {
        if (assignment.users.primary.length === 0) return 'Nobody named';
        const alt = assignment.users.alternates.length ? ` · alt ${listNames(assignment.users.alternates, nameOf)}` : '';
        return `${listNames(assignment.users.primary, nameOf)}${alt}`;
      }
    }
  })();

  const setPair = (key: 'users' | 'roles', pair: ActorPair) =>
    onChange(key === 'users' ? { ...assignment, users: pair } : { ...assignment, roles: pair });

  const setDepartmentPair = (departmentId: string, pair: { primary: string[]; alternates: string[] }) =>
    onChange({ ...assignment, byDepartment: { ...assignment.byDepartment, [departmentId]: pair } });

  const setBand = (id: string, change: Partial<AmountBand>) =>
    onChange({ ...assignment, bands: assignment.bands.map(band => (band.id === id ? { ...band, ...change } : band)) });

  const deptNeedle = deptSearch.trim().toLowerCase();
  const shownDepartments = deptNeedle
    ? departments.filter(department => `${department.name} ${department.note ?? ''}`.toLowerCase().includes(deptNeedle))
    : departments;

  return (
    <div className={cn('border-l-2 transition-colors', MODE_EDGE[tone], open && 'bg-slate-50/40')}>
      {/* The quiet line. Everything an administrator needs to decide whether to open it. */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-sm font-medium text-slate-800">{def.title}</span>
            <span className={cn('shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium', MODE_CHIP[tone])}>
              {MODE_LABELS[assignment.mode].title}
            </span>
            {errorCount > 0 && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded border border-destructive/30 bg-destructive/5 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                <AlertTriangle className="h-3 w-3" /> {errorCount}
              </span>
            )}
            {errorCount === 0 && warningCount > 0 && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                <AlertTriangle className="h-3 w-3" /> {warningCount}
              </span>
            )}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
            {ASSIGNMENT_LABELS[assignment.type].title} · {summary}
          </span>
        </span>
        {!open && <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:block">{def.hint}</span>}
      </button>

      {open && (
        <div className="space-y-3 border-t bg-white px-3 py-3 sm:px-4">
          <p className="text-[11px] leading-5 text-muted-foreground">
            {def.hint} Today a role carrying <span className="font-medium text-slate-700">{def.permission.action}</span> on{' '}
            <span className="font-medium text-slate-700">{def.permission.section}</span> can already do this, whatever is set
            below.
          </p>

          {/* ── authority ── */}
          <div className="space-y-1.5">
            <span className={CONTROL_LABEL}>Authority</span>
            <Segmented
              ariaLabel={`Authority for ${def.title}`}
              disabled={!canEdit}
              value={assignment.mode}
              onChange={mode => onChange({ ...assignment, mode })}
              options={[
                { value: 'roles-only' as ActionMode, label: MODE_LABELS['roles-only'].title, tone: 'slate' },
                { value: 'assigned-too' as ActionMode, label: MODE_LABELS['assigned-too'].title, tone: 'amber' },
                { value: 'assigned-only' as ActionMode, label: MODE_LABELS['assigned-only'].title, tone: 'emerald' },
              ]}
            />
            <p
              className={cn(
                'flex items-start gap-1.5 rounded-md border px-2 py-1.5 text-[11px] leading-4',
                MODE_CHIP[tone],
              )}
            >
              {enforced ? <Lock className="mt-px h-3 w-3 shrink-0" /> : <ShieldCheck className="mt-px h-3 w-3 shrink-0" />}
              <span>
                <span className="font-medium">{MODE_CONSEQUENCE[assignment.mode]}</span>{' '}
                <span className="opacity-80">{MODE_LABELS[assignment.mode].hint}</span>
              </span>
            </p>
          </div>

          {/* ── assigned by ── */}
          <div className="space-y-1.5">
            <span className={CONTROL_LABEL}>Assigned by</span>
            <Segmented
              ariaLabel={`How ${def.title} is assigned`}
              disabled={!canEdit}
              value={assignment.type}
              onChange={type => onChange({ ...assignment, type })}
              options={types.map(type => ({ value: type, label: ASSIGNMENT_LABELS[type].title }))}
            />
            <p className="text-[11px] text-muted-foreground">{ASSIGNMENT_LABELS[assignment.type].hint}</p>
          </div>

          {/* ── who acts ── */}
          {assignment.type === 'users' && (
            <PairFields
              pair={assignment.users}
              onChange={pair => setPair('users', pair)}
              options={users}
              alternateOptions={users}
              disabled={!canEdit}
              primaryLabel="Who acts"
              primaryPlaceholder="Choose people"
            />
          )}

          {assignment.type === 'roles' && (
            <PairFields
              pair={assignment.roles}
              onChange={pair => setPair('roles', pair)}
              options={roles}
              alternateOptions={users}
              disabled={!canEdit}
              primaryLabel="Which roles act"
              primaryPlaceholder="Choose roles"
            />
          )}

          {assignment.type === 'department' && (
            <div className="overflow-hidden rounded-lg border">
              <div className="flex flex-col gap-2 border-b bg-slate-50/70 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[11px] text-muted-foreground">
                  A different person per department. Departments not listed fall back to the role permission.
                </p>
                {departments.length > 8 && (
                  <div className="relative w-full sm:w-[14rem]">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="h-8 pl-8 text-sm"
                      placeholder="Search departments"
                      aria-label="Search departments"
                      value={deptSearch}
                      onChange={event => setDeptSearch(event.target.value)}
                    />
                  </div>
                )}
              </div>
              {departments.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">No departments found.</p>
              ) : shownDepartments.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">No department matches “{deptSearch}”.</p>
              ) : (
                <div className="max-h-[20rem] min-w-0 overflow-x-auto overflow-y-auto">
                  <table className="w-full min-w-[42rem] border-collapse text-sm">
                    <thead>
                      <tr className="border-b bg-white text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        <th scope="col" className="w-[14rem] py-2 pl-3 pr-3 font-semibold">
                          Department
                        </th>
                        <th scope="col" className="px-3 py-2 font-semibold">
                          Who acts
                        </th>
                        <th scope="col" className="px-3 py-2 font-semibold">
                          Alternatives
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {shownDepartments.map(department => {
                        const pair = assignment.byDepartment[department.id] ?? emptyPair();
                        return (
                          <tr key={department.id} className="align-top">
                            <td className="py-2 pl-3 pr-3">
                              <span className="block truncate text-sm text-slate-800">{department.name}</span>
                              {department.note && (
                                <span className="block truncate text-[11px] text-muted-foreground">{department.note}</span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <ActorPicker
                                options={users}
                                value={pair.primary}
                                disabled={!canEdit}
                                placeholder="Choose people"
                                ariaLabel={`Who acts for ${department.name}`}
                                onChange={primary => setDepartmentPair(department.id, { ...pair, primary })}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <ActorPicker
                                options={users}
                                value={pair.alternates}
                                disabled={!canEdit}
                                placeholder="Who stands in"
                                ariaLabel={`Alternatives for ${department.name}`}
                                emptyText="No alternative"
                                onChange={alternates => setDepartmentPair(department.id, { ...pair, alternates })}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {assignment.type === 'amount' && (
            <div className="overflow-hidden rounded-lg border">
              <div className="flex flex-col gap-2 border-b bg-slate-50/70 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[11px] text-muted-foreground">
                  The first band a request’s amount falls into decides. Leave a figure blank for “no limit”.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 gap-1.5 text-xs"
                  disabled={!canEdit}
                  onClick={() =>
                    onChange({
                      ...assignment,
                      bands: [...assignment.bands, { id: newBandId(), from: null, to: null, primary: [], alternates: [] }],
                    })
                  }
                >
                  <Plus className="h-3.5 w-3.5" /> Add band
                </Button>
              </div>
              {assignment.bands.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No bands yet. Add one with no ceiling to cover every amount.
                </p>
              ) : (
                <div className="min-w-0 overflow-x-auto">
                  <table className="w-full min-w-[46rem] border-collapse text-sm">
                    <thead>
                      <tr className="border-b bg-white text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        <th scope="col" className="w-[8rem] py-2 pl-3 pr-2 font-semibold">
                          From ₹
                        </th>
                        <th scope="col" className="w-[8rem] px-2 py-2 font-semibold">
                          To ₹
                        </th>
                        <th scope="col" className="px-2 py-2 font-semibold">
                          Who acts
                        </th>
                        <th scope="col" className="px-2 py-2 font-semibold">
                          Alternatives
                        </th>
                        <th scope="col" className="py-2 pl-2 pr-3">
                          <span className="sr-only">Remove</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {assignment.bands.map(band => (
                        <tr key={band.id} className="align-top">
                          <td className="py-2 pl-3 pr-2">
                            <Input
                              className="h-8 w-[7rem] text-sm tabular-nums"
                              inputMode="numeric"
                              placeholder="No floor"
                              aria-label="Band floor"
                              disabled={!canEdit}
                              value={band.from === null ? '' : String(band.from)}
                              onChange={event => {
                                const digits = event.target.value.replace(/[^\d]/g, '');
                                setBand(band.id, { from: digits === '' ? null : Number(digits) });
                              }}
                            />
                          </td>
                          <td className="px-2 py-2">
                            <Input
                              className="h-8 w-[7rem] text-sm tabular-nums"
                              inputMode="numeric"
                              placeholder="No ceiling"
                              aria-label="Band ceiling"
                              disabled={!canEdit}
                              value={band.to === null ? '' : String(band.to)}
                              onChange={event => {
                                const digits = event.target.value.replace(/[^\d]/g, '');
                                setBand(band.id, { to: digits === '' ? null : Number(digits) });
                              }}
                            />
                          </td>
                          <td className="px-2 py-2">
                            <ActorPicker
                              options={users}
                              value={band.primary}
                              disabled={!canEdit}
                              placeholder="Choose people"
                              ariaLabel="Who acts in this band"
                              onChange={primary => setBand(band.id, { primary })}
                            />
                          </td>
                          <td className="px-2 py-2">
                            <ActorPicker
                              options={users}
                              value={band.alternates}
                              disabled={!canEdit}
                              placeholder="Who stands in"
                              ariaLabel="Alternatives in this band"
                              emptyText="No alternative"
                              onChange={alternates => setBand(band.id, { alternates })}
                            />
                          </td>
                          <td className="py-2 pl-2 pr-3">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              aria-label="Remove this band"
                              disabled={!canEdit}
                              onClick={() =>
                                onChange({ ...assignment, bands: assignment.bands.filter(other => other.id !== band.id) })
                              }
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {assignment.bands.length > 0 && (
                <ul className="space-y-0.5 border-t bg-slate-50/50 px-3 py-2">
                  {assignment.bands.map(band => (
                    <li key={band.id} className="truncate text-[11px] text-slate-600">
                      {bandSentence(band, nameOf)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── the page ────────────────────────────────────────────────────────────── */

export default function ExpensesUserRolesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { log } = useActivityLogger(ACTIVITY_MODULES.EXPENSES);
  const { canView, canEdit, isLoading: isAuthLoading } = useExpensesRolesAccess();
  const { doc: remote, isLoading: isDocLoading, stamp } = useExpensesRoles();

  /* The draft follows the live document until something is edited, then holds until saved. */
  const [draft, setDraft] = useState<ExpensesRolesDoc | null>(null);
  const [awaitingFrom, setAwaitingFrom] = useState<string | null>(null);
  const remoteKey = useMemo(() => JSON.stringify(remote), [remote]);
  const draftKey = draft === null ? remoteKey : JSON.stringify(draft);
  if (awaitingFrom !== null && (draftKey === remoteKey || remoteKey !== awaitingFrom)) {
    // Render-phase adjustment: the save has landed (or a newer snapshot has), so hand back to live.
    setAwaitingFrom(null);
    setDraft(null);
  }
  const value = draft ?? remote;
  const isDirty = awaitingFrom === null && draftKey !== remoteKey;

  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [roles, setRoles] = useState<(PickerOption & { raw: RoleLike })[]>([]);
  const [departments, setDepartments] = useState<PickerOption[]>([]);
  const [isListLoading, setIsListLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [openAction, setOpenAction] = useState<ExpensesActionKey | null>(null);

  /* ── the directory ── */

  useEffect(() => {
    if (isAuthLoading || !canView) {
      if (!isAuthLoading) setIsListLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [usersSnap, rolesSnap, departmentsSnap] = await Promise.all([
          getDocs(collection(db, 'users')),
          getDocs(collection(db, 'roles')),
          getDocs(collection(db, 'departments')),
        ]);
        if (cancelled) return;
        setUsers(
          usersSnap.docs
            .map(entry => {
              const data = entry.data() as {
                name?: string;
                email?: string;
                designation?: string | null;
                role?: string;
                status?: string;
              };
              const status = data.status || 'Active';
              return {
                id: entry.id,
                name: data.name || data.email || entry.id,
                email: data.email || '',
                role: data.role || '',
                status,
                // The second line tells two people of the same name apart: the email always, plus
                // what they do and whether the login is still live.
                note: [data.email, data.designation || data.role, status === 'Active' ? '' : status]
                  .filter(Boolean)
                  .join(' · '),
              };
            })
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
        setRoles(
          rolesSnap.docs
            .map(entry => {
              const raw: RoleLike = { ...(entry.data() as Omit<RoleLike, 'id'>), id: entry.id };
              return { id: entry.id, name: raw.name || entry.id, note: raw.description || undefined, raw };
            })
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
        setDepartments(
          departmentsSnap.docs
            .map(entry => {
              const data = entry.data() as { name?: string; head?: string };
              return { id: entry.id, name: data.name || entry.id, note: data.head || undefined };
            })
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      } catch (error) {
        console.error('Could not load people, roles and departments:', error);
        toast({
          title: 'Could not load the directory',
          description: 'The pickers may be incomplete. Reload before changing anything.',
          variant: 'destructive',
        });
      } finally {
        if (!cancelled) setIsListLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthLoading, canView]);

  const userById = useMemo(() => new Map(users.map(entry => [entry.id, entry])), [users]);
  const roleById = useMemo(() => new Map(roles.map(entry => [entry.id, entry])), [roles]);
  const departmentById = useMemo(() => new Map(departments.map(entry => [entry.id, entry])), [departments]);

  /** An id is a person or a role; both arrive here, so both are resolved. */
  const nameOf = useMemo(
    () => (id: string) => userById.get(id)?.name ?? roleById.get(id)?.name ?? `(no longer exists: ${id})`,
    [userById, roleById],
  );
  const departmentName = useMemo(() => (id: string) => departmentById.get(id)?.name ?? id, [departmentById]);

  /* ── what is wrong with it ── */

  const rolesIssues = useMemo(
    () =>
      validateExpensesRoles(value, {
        // Only once the directory has actually loaded: validating against an empty list would
        // report every assignment as pointing at somebody who no longer exists.
        userIds: users.length ? users.map(entry => entry.id) : undefined,
        roleIds: roles.length ? roles.map(entry => entry.id) : undefined,
        departmentIds: departments.length ? departments.map(entry => entry.id) : undefined,
      }),
    [value, users, roles, departments],
  );
  const blocked = rolesIssues.some(issue => issue.severity === 'error');
  const issues = useMemo<ExpenseSettingsIssue[]>(
    () => rolesIssues.map(issue => ({ severity: issue.severity, message: issue.message })),
    [rolesIssues],
  );
  const issueCounts = useMemo(() => {
    const counts = new Map<string, { errors: number; warnings: number }>();
    for (const issue of rolesIssues) {
      const current = counts.get(issue.actionKey) ?? { errors: 0, warnings: 0 };
      if (issue.severity === 'error') current.errors += 1;
      else current.warnings += 1;
      counts.set(issue.actionKey, current);
    }
    return counts;
  }, [rolesIssues]);

  /* ── the figures in the strip ── */

  const enforcedCount = EXPENSES_ACTIONS.filter(def => assignmentFor(value, def.key).mode !== 'roles-only').length;
  const wideningCount = EXPENSES_ACTIONS.filter(def => assignmentFor(value, def.key).mode === 'assigned-too').length;
  const narrowingCount = enforcedCount - wideningCount;
  const peopleNamed = useMemo(() => {
    const ids = new Set<string>();
    for (const def of EXPENSES_ACTIONS) {
      const assignment = assignmentFor(value, def.key);
      for (const id of [...assignment.users.primary, ...assignment.users.alternates, ...assignment.roles.alternates]) ids.add(id);
      for (const pair of Object.values(assignment.byDepartment)) for (const id of [...pair.primary, ...pair.alternates]) ids.add(id);
      for (const band of assignment.bands) for (const id of [...band.primary, ...band.alternates]) ids.add(id);
    }
    return ids.size;
  }, [value]);
  const withoutAlternate = EXPENSES_ACTIONS.filter(def => {
    const assignment = assignmentFor(value, def.key);
    if (assignment.mode === 'roles-only') return false;
    if (assignment.type === 'users') return assignment.users.primary.length > 0 && assignment.users.alternates.length === 0;
    if (assignment.type === 'roles') return assignment.roles.primary.length > 0 && assignment.roles.alternates.length === 0;
    return false;
  }).length;

  /* ── editing ── */

  const setAssignment = (key: ExpensesActionKey, next: ExpensesActionAssignment) =>
    setDraft(current => {
      const base = current ?? remote;
      return { actions: { ...base.actions, [key]: next } };
    });

  /* ── save ── */

  /** Plain arrays and nulls only; `undefined` is what Firestore rejects. */
  const buildPayload = () => ({
    actions: Object.fromEntries(
      EXPENSES_ACTIONS.map(def => {
        const assignment = assignmentFor(value, def.key);
        return [
          def.key,
          {
            mode: assignment.mode,
            type: assignment.type,
            users: { primary: [...assignment.users.primary], alternates: [...assignment.users.alternates] },
            roles: { primary: [...assignment.roles.primary], alternates: [...assignment.roles.alternates] },
            // An empty pair carries nothing, so it is dropped rather than stored as a dead key.
            byDepartment: Object.fromEntries(
              Object.entries(assignment.byDepartment)
                .filter(([, pair]) => pair.primary.length > 0 || pair.alternates.length > 0)
                .map(([departmentId, pair]) => [
                  departmentId,
                  { primary: [...pair.primary], alternates: [...pair.alternates] },
                ]),
            ),
            bands: assignment.bands.map(band => ({
              id: band.id,
              from: band.from === null ? null : band.from,
              to: band.to === null ? null : band.to,
              primary: [...band.primary],
              alternates: [...band.alternates],
            })),
          },
        ];
      }),
    ),
  });

  const handleSave = async () => {
    if (!user || !canEdit || blocked || isSaving) return;
    setIsSaving(true);
    try {
      const payload = buildPayload();
      const reference = docRef(db, EXPENSES_ROLES_PATH.collection, EXPENSES_ROLES_PATH.doc);
      const snapshot = await getDoc(reference);
      const before = resolveExpensesRolesDoc(snapshot.exists() ? snapshot.data() : undefined);
      await setDoc(
        reference,
        {
          ...payload,
          updatedAt: serverTimestamp(),
          updatedById: user.id,
          updatedByName: user.name || user.email || user.id,
        },
        { merge: false },
      );
      const flatBefore = flattenExpensesRoles(before, nameOf, departmentName);
      const flatAfter = flattenExpensesRoles(resolveExpensesRolesDoc(payload), nameOf, departmentName);
      const changes = diffFields(flatBefore, withRemovals(flatBefore, flatAfter));
      await log(
        'Update Expenses User Roles',
        { changes, changedCount: Object.keys(changes).length, enforcedActions: enforcedCount },
        { recordId: 'user-roles', recordRef: 'User Roles' },
      );
      setDraft(resolveExpensesRolesDoc(payload));
      setAwaitingFrom(remoteKey);
      toast({
        title: 'Assignments saved',
        description:
          enforcedCount === 0
            ? 'Recorded for reference. Who may act in Expenses is unchanged.'
            : `${enforcedCount} ${enforcedCount === 1 ? 'action is' : 'actions are'} now decided by these assignments.`,
      });
    } catch (error) {
      console.error('Could not save the Expenses user roles:', error);
      toast({ title: 'Save failed', description: 'The assignments were not written.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const discard = () => {
    setAwaitingFrom(null);
    setDraft(null);
  };

  /* ── the "who may act?" checker ─────────────────────────────────────────── */

  const [check, setCheck] = useState<{ userId: string; actionKey: ExpensesActionKey; departmentId: string; amount: string }>({
    userId: '',
    actionKey: 'raise-request',
    departmentId: '',
    amount: '',
  });
  /**
   * The chosen person's effective access, resolved here the way `AuthProvider` resolves the signed-in
   * user's: `resolveEffectiveAccess` is a pure function over the roles collection and the person's
   * own `accessGrants` document, so it answers for an arbitrary user without a server call. The
   * grant and the scope-grant configuration are optional — if either read is denied this falls back
   * to the base role alone and says so, rather than reporting a verdict it cannot stand behind.
   */
  const [checkAccess, setCheckAccess] = useState<{
    userId: string;
    access: EffectiveAccess | null;
    /** False when the additive grant could not be read, so the verdict is base-role only. */
    complete: boolean;
    isLoading: boolean;
  }>({ userId: '', access: null, complete: true, isLoading: false });

  useEffect(() => {
    const userId = check.userId;
    // Gated on the directory load rather than on `roles.length`: an installation with no role
    // documents at all still has to get an answer, not a spinner that never resolves.
    if (!userId || isListLoading) {
      setCheckAccess({ userId: '', access: null, complete: true, isLoading: Boolean(userId) });
      return;
    }
    const person = userById.get(userId);
    if (!person) {
      setCheckAccess({ userId: '', access: null, complete: true, isLoading: false });
      return;
    }
    let cancelled = false;
    setCheckAccess({ userId, access: null, complete: true, isLoading: true });
    (async () => {
      let grant: Partial<UserAccessGrant> | null = null;
      let scopeGrants: ScopeGrantConfig[] = [];
      let complete = true;
      try {
        const grantSnap = await getDoc(docRef(db, ACCESS_GRANTS, userId));
        grant = grantSnap.exists() ? (grantSnap.data() as Partial<UserAccessGrant>) : null;
      } catch (error) {
        console.error('Could not read the additional access grant:', error);
        complete = false;
      }
      try {
        const scopeSnap = await getDocs(collection(db, ACCESS_SCOPE_GRANTS));
        scopeGrants = scopeSnap.docs.map(entry => ({ id: entry.id, ...entry.data() }) as ScopeGrantConfig);
      } catch {
        // Optional configuration: an installation that has never used department- or
        // designation-based access has none, and its absence changes nothing.
        scopeGrants = [];
      }
      if (cancelled) return;
      const access = resolveEffectiveAccess({
        user: { id: person.id, name: person.name, email: person.email, role: person.role, status: person.status },
        roles: roles.map(entry => entry.raw),
        grant,
        scopeGrants,
      });
      setCheckAccess({ userId, access, complete, isLoading: false });
    })();
    return () => {
      cancelled = true;
    };
  }, [check.userId, roles, userById, isListLoading]);

  const checkDef = EXPENSES_ACTIONS.find(def => def.key === check.actionKey) ?? EXPENSES_ACTIONS[0];
  const checkAssignment = assignmentFor(value, checkDef.key);
  const checkContext = {
    departmentId: checkDef.departmentScoped && check.departmentId ? check.departmentId : undefined,
    amount: checkDef.amountAware && check.amount !== '' ? Number(check.amount) : undefined,
  };
  const checkPerson = check.userId ? userById.get(check.userId) : undefined;
  const ready = Boolean(checkPerson) && checkAccess.userId === check.userId && !checkAccess.isLoading;
  /** The role/permission half of the answer — exactly what `can(action, section)` would say. */
  const rolePermits = ready
    ? roleHasPermission(checkAccess.access, checkDef.permission.section, checkDef.permission.action, checkContext.departmentId)
    : false;
  /** The role ids the person holds, for a by-role assignment: `users.role` is a name, not an id. */
  const checkRoleIds = useMemo(() => {
    if (!checkPerson) return [] as string[];
    const names = new Set(
      [checkPerson.role, ...(checkAccess.access?.effectiveRoleNames ?? [])].filter(Boolean) as string[],
    );
    return roles.filter(entry => names.has(entry.name) || names.has(entry.id)).map(entry => entry.id);
  }, [checkPerson, checkAccess.access, roles]);
  const verdict = ready
    ? mayAct(checkAssignment, { userId: check.userId, roleIds: checkRoleIds }, rolePermits, checkContext)
    : null;
  const BASIS_WORDS: Record<string, string> = {
    role: 'their role permission',
    primary: 'they are the person assigned',
    alternate: 'they are the alternative',
    'assigned-role': 'they hold the role assigned',
    none: 'nothing grants it',
  };

  /* ── render ── */

  if (isAuthLoading || isDocLoading) {
    return (
      <div className="w-full space-y-4">
        <Skeleton className="h-14 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="w-full space-y-4">
        <PageHeader icon={UserCog} title="Who Does What" backHref="/expenses/settings" backLabel="Back to settings" />
        <ControlAccessDenied />
      </div>
    );
  }

  return (
    <div className="w-full space-y-4">
      <PageHeader
        icon={UserCog}
        title="Who Does What"
        description={stampLine(stamp, 'Who acts on each Expenses action, what they act on, and who stands in for them')}
        backHref="/expenses/settings"
        backLabel="Back to settings"
      />

      {/* Where the set-up stands, before any of the detail. */}
      <div className="grid grid-cols-2 divide-x divide-y rounded-xl border bg-white shadow-sm sm:grid-cols-4 sm:divide-y-0">
        <SummaryStat label="Actions" value={String(EXPENSES_ACTIONS.length)} hint={`Across ${EXPENSES_ACTION_GROUPS.length} groups`} />
        <SummaryStat
          label="Decided here"
          value={enforcedCount === 0 ? 'None' : String(enforcedCount)}
          hint={
            enforcedCount === 0
              ? 'Roles alone decide everything'
              : `${wideningCount} widened, ${narrowingCount} narrowed`
          }
        />
        <SummaryStat
          label="People named"
          value={peopleNamed === 0 ? 'None' : String(peopleNamed)}
          hint={peopleNamed === 0 ? 'Nobody assigned yet' : `Out of ${users.length} in the directory`}
        />
        <SummaryStat
          label="Needs attention"
          value={rolesIssues.length === 0 ? 'Nothing' : String(rolesIssues.length)}
          hint={
            rolesIssues.length === 0
              ? 'No gaps found'
              : `${withoutAlternate} enforced without an alternative`
          }
          tone={rolesIssues.length === 0 ? undefined : 'warning'}
        />
      </div>

      {!canEdit && <ReadOnlyNotice section="User Roles" />}

      {/* Roles stay global; this page is only ever about the Expenses module. */}
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg border bg-slate-50/70 px-3 py-2 text-[11px] text-muted-foreground">
        <Users className="h-3.5 w-3.5 shrink-0" />
        <span>
          Roles and permissions themselves live in{' '}
          <Link href="/settings/access-management" className="font-medium text-primary underline-offset-2 hover:underline">
            Settings › Access Management
          </Link>
          . This page assigns the Expenses module’s own actions to people, and nothing on it edits a role.
        </span>
      </p>

      <IssueList issues={issues} />

      {/* ── the actions, grouped ── */}
      {EXPENSES_ACTION_GROUPS.map(group => {
        const defs = EXPENSES_ACTIONS.filter(def => def.group === group);
        const groupEnforced = defs.filter(def => assignmentFor(value, def.key).mode !== 'roles-only').length;
        return (
          <ControlCard
            key={group}
            icon={GROUP_ICON[group]}
            title={group}
            description={GROUP_HINT[group]}
            contentClassName="p-0"
            actions={
              <span className="text-[11px] text-muted-foreground">
                {defs.length} {defs.length === 1 ? 'action' : 'actions'}
                {groupEnforced > 0 && ` · ${groupEnforced} decided here`}
              </span>
            }
          >
            <div className="divide-y">
              {defs.map(def => {
                const counts = issueCounts.get(def.key) ?? { errors: 0, warnings: 0 };
                return (
                  <ActionRow
                    key={def.key}
                    def={def}
                    assignment={assignmentFor(value, def.key)}
                    onChange={next => setAssignment(def.key, next)}
                    open={openAction === def.key}
                    onToggle={() => setOpenAction(current => (current === def.key ? null : def.key))}
                    canEdit={canEdit}
                    users={users}
                    roles={roles}
                    departments={departments}
                    nameOf={nameOf}
                    errorCount={counts.errors}
                    warningCount={counts.warnings}
                  />
                );
              })}
            </div>
          </ControlCard>
        );
      })}

      {/* ── who may act? ── */}
      <ControlCard
        icon={FlaskConical}
        title="Who may act?"
        description="Pick a person and an action to see the answer these assignments and their role give together."
      >
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="min-w-0 space-y-1.5">
              <span className={CONTROL_LABEL}>Person</span>
              <ActorPicker
                options={users}
                value={check.userId ? [check.userId] : []}
                single
                placeholder={isListLoading ? 'Loading people…' : 'Choose a person'}
                ariaLabel="Person to check"
                onChange={next => setCheck(current => ({ ...current, userId: next[0] ?? '' }))}
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              <span className={CONTROL_LABEL}>Action</span>
              <Select
                value={check.actionKey}
                onValueChange={next => setCheck(current => ({ ...current, actionKey: next as ExpensesActionKey }))}
              >
                <SelectTrigger className="h-8 text-sm" aria-label="Action to check">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPENSES_ACTION_GROUPS.map(group => (
                    <SelectGroup key={group}>
                      <SelectLabel>{group}</SelectLabel>
                      {EXPENSES_ACTIONS.filter(def => def.group === group).map(def => (
                        <SelectItem key={def.key} value={def.key}>
                          {def.title}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0 space-y-1.5">
              <span className={CONTROL_LABEL}>Department</span>
              {checkDef.departmentScoped ? (
                <Select
                  value={check.departmentId || NONE}
                  onValueChange={next => setCheck(current => ({ ...current, departmentId: next === NONE ? '' : next }))}
                >
                  <SelectTrigger className="h-8 text-sm" aria-label="Department to check">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>— any department —</SelectItem>
                    {departments.map(department => (
                      <SelectItem key={department.id} value={department.id}>
                        {department.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="flex h-8 items-center text-[11px] text-muted-foreground">Not department-specific.</p>
              )}
            </div>
            <div className="min-w-0 space-y-1.5">
              <span className={CONTROL_LABEL}>Amount ₹</span>
              {checkDef.amountAware ? (
                <Input
                  className="h-8 text-sm tabular-nums"
                  inputMode="numeric"
                  placeholder="Any amount"
                  aria-label="Amount to check"
                  value={check.amount}
                  onChange={event =>
                    setCheck(current => ({ ...current, amount: event.target.value.replace(/[^\d]/g, '') }))
                  }
                />
              ) : (
                <p className="flex h-8 items-center text-[11px] text-muted-foreground">Not amount-specific.</p>
              )}
            </div>
          </div>

          {!check.userId ? (
            <p className="rounded-lg border border-dashed px-3 py-5 text-center text-sm text-muted-foreground">
              Choose a person to see whether they may {checkDef.title.charAt(0).toLowerCase() + checkDef.title.slice(1)}.
            </p>
          ) : checkAccess.isLoading || !verdict ? (
            <div className="flex items-center gap-2 rounded-lg border px-3 py-5 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Working out what their role allows…
            </div>
          ) : (
            <div
              className={cn(
                'space-y-1.5 rounded-lg border px-3 py-2.5 text-sm',
                verdict.allowed
                  ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900'
                  : 'border-destructive/30 bg-destructive/5 text-destructive',
              )}
            >
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold">
                {verdict.allowed ? <Check className="h-4 w-4 shrink-0" /> : <Lock className="h-4 w-4 shrink-0" />}
                {checkPerson?.name} {verdict.allowed ? 'may' : 'may not'}{' '}
                {checkDef.title.charAt(0).toLowerCase() + checkDef.title.slice(1)}
                {checkContext.departmentId ? ` in ${departmentName(checkContext.departmentId)}` : ''}
                {checkContext.amount !== undefined ? ` at ${money.format(checkContext.amount)}` : ''}.
              </p>
              <p className="text-[12px] leading-5 opacity-90">
                <span className="font-medium">Because:</span> {verdict.reason} — {BASIS_WORDS[verdict.basis] ?? verdict.basis}.{' '}
                <span className="font-medium">Authority:</span> {MODE_LABELS[verdict.mode].title}.
              </p>
              <p className="text-[11px] leading-5 opacity-80">
                Their role {rolePermits ? 'carries' : 'does not carry'}{' '}
                <span className="font-medium">{checkDef.permission.action}</span> on{' '}
                <span className="font-medium">{checkDef.permission.section}</span>
                {checkAccess.access?.effectiveRoleNames.length
                  ? ` (as ${checkAccess.access.effectiveRoleNames.join(', ')})`
                  : ''}
                .{' '}
                {checkAccess.complete
                  ? 'Resolved from their base role plus any additional, project or temporary access they hold.'
                  : 'Their additional access grant could not be read, so this is their base role only — they may in fact hold more.'}
              </p>
              {isDirty && (
                <p className="flex items-start gap-1.5 text-[11px] font-medium leading-4 opacity-90">
                  <AlertTriangle className="mt-px h-3 w-3 shrink-0" /> Answered against the unsaved changes on this page.
                </p>
              )}
            </div>
          )}
        </div>
      </ControlCard>

      {/* ── save ── */}
      {canEdit && (
        <div className="sticky bottom-0 z-10 rounded-t-xl border border-b-0 bg-background/95 px-4 py-3 shadow-[0_-8px_24px_-20px_rgba(15,23,42,0.5)] backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <span
                className={cn(
                  'h-2 w-2 shrink-0 rounded-full',
                  isDirty ? (blocked ? 'bg-destructive' : 'bg-amber-500') : 'bg-emerald-500',
                )}
              />
              {blocked ? 'Fix the errors above before saving.' : isDirty ? 'Unsaved changes.' : 'All changes saved.'}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {isDirty ? (
                <Button type="button" variant="outline" size="sm" disabled={isSaving} onClick={discard}>
                  Discard
                </Button>
              ) : (
                <Button asChild variant="outline" size="sm">
                  <Link href="/expenses/settings">Back to settings</Link>
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                className="min-w-[110px] gap-2"
                disabled={!isDirty || blocked || isSaving}
                onClick={handleSave}
              >
                {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                {isSaving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
