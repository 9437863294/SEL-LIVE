'use client';

/**
 * Settings › Projects — the project form, the sub-division site form and the in-charge picker they
 * share. The page owns loading and saving; these only collect and check the values. The form
 * dialogs take `initial` once, when they mount — the page gives each opening a new `key`.
 */

import { useState } from 'react';
import { Check, ChevronsUpDown, UserRound, X } from 'lucide-react';
import { FormDialog } from '@/components/shared/form-dialog';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  EMPTY_PROJECT_FORM,
  EMPTY_SUBDIVISION_FORM,
  PROJECT_STATUSES,
  type ProjectFormValues,
  type ProjectStatus,
  type SubdivisionFormValues,
} from '@/lib/project-subdivisions';

export interface InChargePerson {
  id: string;
  name: string;
  /** Designation or email — the second line in the list. */
  detail?: string;
}

/**
 * Who is in charge: a searchable list of the app's users, or any name typed in — a site in-charge
 * is not always someone with a login. Stores the name, as the project record always has.
 */
export function InChargePicker({
  id,
  value,
  onChange,
  people,
  disabled,
}: {
  id?: string;
  value: string;
  onChange: (name: string) => void;
  people: readonly InChargePerson[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const typed = search.trim();
  const query = typed.toLowerCase();
  const listed = people.some((person) => person.name.toLowerCase() === query);
  // Filtered here, not by cmdk: cmdk hides a group with no matching items, which took the
  // "Use what I typed" option with it.
  const matches = query ? people.filter((person) => `${person.name} ${person.detail ?? ''}`.toLowerCase().includes(query)) : people;

  const choose = (name: string) => {
    onChange(name);
    setOpen(false);
    setSearch('');
  };

  return (
    // Modal so the list scrolls with the wheel inside a dialog, whose scroll lock otherwise
    // swallows it (the popover is portalled outside the dialog).
    <Popover modal open={open} onOpenChange={(next) => { setOpen(next); if (!next) setSearch(''); }}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className={cn('flex min-w-0 items-center gap-2', !value && 'text-muted-foreground')}>
            <UserRound className="h-4 w-4 shrink-0 opacity-60" aria-hidden="true" />
            <span className="truncate">{value || 'No one assigned'}</span>
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-[16rem] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search people or type a name" value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>Type a name to assign someone.</CommandEmpty>
            <CommandGroup>
              {value && !typed && (
                <CommandItem value="__clear__" onSelect={() => choose('')}>
                  <X className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  No one assigned
                </CommandItem>
              )}
              {matches.map((person) => (
                <CommandItem key={person.id} value={person.id} onSelect={() => choose(person.name)}>
                  <Check className={cn('mr-2 h-4 w-4 shrink-0', value === person.name ? 'opacity-100' : 'opacity-0')} aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{person.name}</span>
                    {person.detail && <span className="block truncate text-[11px] text-muted-foreground">{person.detail}</span>}
                  </span>
                </CommandItem>
              ))}
              {/* Last, so Enter on a partial name picks the person it matches, not the fragment. */}
              {typed && !listed && (
                <CommandItem value={`__typed__ ${typed}`} onSelect={() => choose(typed)}>
                  <UserRound className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate">Use “{typed}”</span>
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Active / Inactive as a two-button switch — one tap, and both choices visible. */
function StatusToggle({ id, value, onChange }: { id: string; value: ProjectStatus; onChange: (status: ProjectStatus) => void }) {
  return (
    // A <label for> cannot name a div; the Field's label names the group instead.
    <div id={id} role="radiogroup" aria-labelledby={`${id}-label`} className="flex w-full rounded-lg border bg-muted/40 p-1 sm:w-fit">
      {PROJECT_STATUSES.map((status) => (
        <button
          key={status}
          type="button"
          role="radio"
          aria-checked={value === status}
          onClick={() => onChange(status)}
          className={cn(
            'flex-1 rounded-md px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-none',
            value === status
              ? status === 'Active'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-slate-600 text-white shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {status}
        </button>
      ))}
    </div>
  );
}

function Field({ id, label, hint, children, className }: { id: string; label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      <Label id={`${id}-label`} htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
      {message}
    </p>
  );
}

/* ── Project ─────────────────────────────────────────────────────────────────────────────────── */

export function ProjectFormDialog({
  open,
  onOpenChange,
  mode,
  initial,
  people,
  validate,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'add' | 'edit';
  initial: ProjectFormValues | null;
  people: readonly InChargePerson[];
  /** The page's uniqueness check against every project. */
  validate: (values: ProjectFormValues) => string | null;
  /** Resolves when saved; a rejection keeps the dialog open with its message. */
  onSave: (values: ProjectFormValues) => Promise<void>;
}) {
  const [form, setForm] = useState<ProjectFormValues>(() => initial ?? EMPTY_PROJECT_FORM);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof ProjectFormValues>(key: K, value: ProjectFormValues[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setError(null);
  };

  const submit = async () => {
    const problem = validate(form);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    try {
      await onSave(form);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the project.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={mode === 'add' ? 'Add project' : 'Edit project'}
      description={
        mode === 'add'
          ? 'Its sub-division sites can be added from the list once it is saved.'
          : 'Changes apply wherever this project is used.'
      }
      onSubmit={submit}
      submitting={saving}
      submitLabel={mode === 'add' ? 'Add project' : 'Save changes'}
    >
      <FormError message={error} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="project-name" label="Project name *" className="sm:col-span-2">
          <Input id="project-name" autoFocus placeholder="e.g. 400 kV Kurnool–Anantapur Line" value={form.projectName} onChange={(e) => set('projectName', e.target.value)} />
        </Field>
        <Field id="project-code" label="Site code">
          <Input id="project-code" placeholder="e.g. SEL-001" value={form.siteCode} onChange={(e) => set('siteCode', e.target.value)} />
        </Field>
        <Field id="project-division" label="Division">
          <Input id="project-division" placeholder="e.g. Electrical" value={form.projectDivision} onChange={(e) => set('projectDivision', e.target.value)} />
        </Field>
        <Field id="project-site" label="Project site">
          <Input id="project-site" placeholder="e.g. Hyderabad" value={form.projectSite} onChange={(e) => set('projectSite', e.target.value)} />
        </Field>
        <Field id="project-location" label="Location">
          <Input id="project-location" placeholder="e.g. Gachibowli, Hyderabad" value={form.location} onChange={(e) => set('location', e.target.value)} />
        </Field>
        <Field id="project-in-charge" label="Site in-charge">
          <InChargePicker id="project-in-charge" value={form.siteInCharge} onChange={(name) => set('siteInCharge', name)} people={people} />
        </Field>
        <Field id="project-status" label="Status">
          <StatusToggle id="project-status" value={form.status} onChange={(status) => set('status', status)} />
        </Field>
        <Field id="project-description" label="Description" className="sm:col-span-2">
          <Textarea id="project-description" rows={2} placeholder="Scope, client or anything that identifies the project" value={form.projectDescription} onChange={(e) => set('projectDescription', e.target.value)} />
        </Field>
      </div>
    </FormDialog>
  );
}

/* ── Sub-division site ───────────────────────────────────────────────────────────────────────── */

export function SubdivisionFormDialog({
  open,
  onOpenChange,
  mode,
  projectName,
  initial,
  people,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'add' | 'edit';
  projectName: string;
  initial: SubdivisionFormValues | null;
  people: readonly InChargePerson[];
  /** Resolves when saved; a rejection keeps the dialog open with its message. */
  onSave: (values: SubdivisionFormValues) => Promise<void>;
}) {
  const [form, setForm] = useState<SubdivisionFormValues>(() => initial ?? EMPTY_SUBDIVISION_FORM);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof SubdivisionFormValues>(key: K, value: SubdivisionFormValues[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setError(null);
  };

  const submit = async () => {
    if (!form.name.trim()) {
      setError('Enter the site name.');
      return;
    }
    setSaving(true);
    try {
      await onSave(form);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the site.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={mode === 'add' ? 'Add sub-division site' : 'Edit sub-division site'}
      description={<>Under <span className="font-medium text-foreground">{projectName}</span></>}
      onSubmit={submit}
      submitting={saving}
      submitLabel={mode === 'add' ? 'Add site' : 'Save changes'}
    >
      <FormError message={error} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="site-name" label="Site name *" className="sm:col-span-2">
          <Input id="site-name" autoFocus placeholder="e.g. Kurnool Section A" value={form.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field id="site-code" label="Site code" hint="Unique within this project.">
          <Input id="site-code" placeholder="e.g. SEL-001-01" value={form.code} onChange={(e) => set('code', e.target.value)} />
        </Field>
        <Field id="site-location" label="Location">
          <Input id="site-location" placeholder="e.g. Kurnool, AP" value={form.location} onChange={(e) => set('location', e.target.value)} />
        </Field>
        <Field id="site-in-charge" label="Site in-charge">
          <InChargePicker id="site-in-charge" value={form.siteInCharge} onChange={(name) => set('siteInCharge', name)} people={people} />
        </Field>
        <Field id="site-status" label="Status">
          <StatusToggle id="site-status" value={form.status} onChange={(status) => set('status', status)} />
        </Field>
      </div>
    </FormDialog>
  );
}
