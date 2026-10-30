'use client';

/**
 * Settings › Departments — the company's departments and who heads each. The head is stored as the
 * person's user id (`head`), which is what E-Approval and HR route to, with their name beside it
 * (`headName`) for screens that show it; no head is an empty `head`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, getDocs, updateDoc } from 'firebase/firestore';
import { Briefcase, Check, ChevronsUpDown, Pencil, Plus, Trash2, UserRound, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { DataList } from '@/components/shared/data-list';
import { SearchInput } from '@/components/shared/filter-bar';
import { FormDialog } from '@/components/shared/form-dialog';
import { PageHeader } from '@/components/shared/page-header';
import { StatusBadge } from '@/components/shared/status-badge';
import { TableCard } from '@/components/shared/table-card';
import { StatusToggle } from '@/components/settings/projects/project-dialogs';
import { SettingsAccessDenied, SettingsPage } from '@/components/settings/settings-ui';
import { useBackNavigation } from '@/hooks/use-back-navigation';
import { useUiText } from '@/hooks/use-company-profile';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import type { Department } from '@/lib/types';
import { cn } from '@/lib/utils';

interface Person {
  id: string;
  name: string;
  detail?: string;
}

interface DepartmentForm {
  name: string;
  head: string;
  status: Department['status'];
}

const EMPTY_FORM: DepartmentForm = { name: '', head: '', status: 'Active' };

/** "N/A" was the old page's only choice; it names nobody. */
const headId = (department: Department) => (department.head && department.head !== 'N/A' ? department.head : '');

async function loadDepartments(): Promise<Department[]> {
  const snapshot = await getDocs(collection(db, 'departments'));
  return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }) as Department).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
}

async function loadPeople(): Promise<Person[]> {
  const snapshot = await getDocs(collection(db, 'users'));
  return snapshot.docs
    .map((entry) => {
      const data = entry.data() as { name?: string; email?: string; status?: string };
      return { id: entry.id, name: (data.name ?? '').trim(), detail: data.email, active: data.status !== 'Inactive' };
    })
    .filter((person) => person.name && person.active)
    .map(({ id, name, detail }) => ({ id, name, detail }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export default function ManageDepartmentPage() {
  const back = useBackNavigation('/settings');
  const { toast } = useToast();
  const t = useUiText();
  const { can } = useAuthorization();
  const canView = can('View', 'Settings.Manage Department');
  const canAdd = can('Add', 'Settings.Manage Department');
  const canEdit = can('Edit', 'Settings.Manage Department');
  const canDelete = can('Delete', 'Settings.Manage Department');

  const [departments, setDepartments] = useState<Department[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // The dialog's contents outlive its `open` flag, so the title does not change while it fades out.
  const [editing, setEditing] = useState<Department | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<DepartmentForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Department | null>(null);

  useEffect(() => {
    if (!canView) return;
    let live = true;
    loadDepartments()
      .then((list) => {
        if (live) setDepartments(list);
      })
      .catch((error) => {
        console.error('Error fetching departments: ', error);
        toast({ title: 'Could not load departments', description: 'Check your connection and reload the page.', variant: 'destructive' });
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    // The head picker's list. Optional: without it the list is empty and the current head stays.
    loadPeople()
      .then((list) => {
        if (live) setPeople(list);
      })
      .catch((error) => console.error('Error fetching users for the head picker: ', error));
    return () => {
      live = false;
    };
  }, [canView, toast]);

  const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);
  const headName = useCallback(
    (department: Department) => {
      const id = headId(department);
      if (!id) return '';
      return peopleById.get(id)?.name ?? department.headName ?? '';
    },
    [peopleById],
  );

  const shown = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return departments;
    return departments.filter((department) => `${department.name} ${headName(department)}`.toLowerCase().includes(query));
  }, [departments, headName, search]);

  if (!canView) return <SettingsAccessDenied title="Departments" icon={Briefcase} />;

  const activeCount = departments.filter((department) => department.status === 'Active').length;
  const trimmedName = form.name.trim();
  const duplicate = departments.some(
    (department) => department.id !== editing?.id && (department.name ?? '').trim().toLowerCase() === trimmedName.toLowerCase(),
  );

  const openForm = (department: Department | null) => {
    setEditing(department);
    setForm(department ? { name: department.name ?? '', head: headId(department), status: department.status === 'Inactive' ? 'Inactive' : 'Active' } : EMPTY_FORM);
    setFormOpen(true);
  };

  const save = async () => {
    if (!trimmedName || duplicate) return;
    const payload = { name: trimmedName, head: form.head, headName: form.head ? peopleById.get(form.head)?.name ?? editing?.headName ?? '' : '', status: form.status };
    setSaving(true);
    try {
      if (editing) {
        await updateDoc(doc(db, 'departments', editing.id), payload);
        toast({ title: 'Department updated', description: trimmedName });
      } else {
        await addDoc(collection(db, 'departments'), payload);
        toast({ title: 'Department added', description: trimmedName });
      }
      setFormOpen(false);
      setDepartments(await loadDepartments());
    } catch (error) {
      console.error('Error saving department: ', error);
      toast({ title: 'Not saved', description: 'Check your connection and try again.', variant: 'destructive' });
    }
    setSaving(false);
  };

  const remove = async () => {
    if (!deleteTarget) return;
    try {
      await deleteDoc(doc(db, 'departments', deleteTarget.id));
      setDepartments((current) => current.filter((department) => department.id !== deleteTarget.id));
      toast({ title: 'Department deleted', description: deleteTarget.name });
    } catch (error) {
      console.error('Error deleting department: ', error);
      toast({ title: 'Not deleted', description: 'Check your connection and try again.', variant: 'destructive' });
      throw error;
    }
  };

  return (
    <SettingsPage>
      <PageHeader
        title="Departments"
        description="The company's departments and who heads each. E-Approval and HR send a department's approvals to its head."
        icon={Briefcase}
        backHref={back.href}
        backLabel={back.label}
        onBackClick={back.onClick}
        meta={loading ? undefined : [{ label: 'Active', value: `${activeCount} of ${departments.length}` }]}
        actions={
          canAdd ? (
            <Button onClick={() => openForm(null)}>
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              Add department
            </Button>
          ) : undefined
        }
      />

      <TableCard
        title="Departments"
        icon={Briefcase}
        count={loading ? undefined : shown.length}
        total={departments.length}
        noun="department"
        scroll="natural"
        toolbar={departments.length > 6 ? <SearchInput value={search} onChange={setSearch} placeholder="Search departments or heads" className="sm:max-w-sm" /> : undefined}
      >
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, row) => <Skeleton key={row} className="h-11 w-full rounded-lg" />)}
          </div>
        ) : (
          <div className="p-3 sm:p-0">
            <DataList
              frameless
              rows={shown}
              empty={
                <p className="py-10 text-center text-sm text-muted-foreground">
                  {departments.length ? 'No department matches the search.' : 'No departments yet.'}
                </p>
              }
              columns={[
                { header: 'Department', mobile: 'title', className: 'font-medium', cell: (department) => department.name },
                {
                  header: 'Head of department',
                  cell: (department) => {
                    const name = headName(department);
                    return name ? (
                      <span className="inline-flex min-w-0 items-center gap-1.5">
                        <UserRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span className="truncate">{name}</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Not set</span>
                    );
                  },
                },
                { header: 'Status', mobile: 'aside', cell: (department) => <StatusBadge status={department.status} /> },
                {
                  header: 'Actions',
                  align: 'right',
                  mobile: 'footer',
                  cell: (department) => (
                    <div className="flex justify-end gap-1">
                      {canEdit && (
                        <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={() => openForm(department)}>
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          {t('edit')}
                        </Button>
                      )}
                      {canDelete && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1.5 text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(department)}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          {t('delete')}
                        </Button>
                      )}
                      {!canEdit && !canDelete && <span className="text-xs text-muted-foreground">View only</span>}
                    </div>
                  ),
                },
              ]}
            />
          </div>
        )}
      </TableCard>

      <FormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        size="sm"
        title={editing ? 'Edit department' : 'Add a department'}
        description={editing ? editing.name : 'Name it, and say who heads it.'}
        submitLabel={editing ? t('save') : 'Add department'}
        submitting={saving}
        submitDisabled={!trimmedName || duplicate}
        onSubmit={save}
      >
        <div className="space-y-1.5">
          <Label htmlFor="department-name">Name</Label>
          <Input
            id="department-name"
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            placeholder="e.g. Human Resources"
            maxLength={80}
            autoFocus
            aria-invalid={duplicate}
          />
          {duplicate && <p className="text-xs font-medium text-danger">There is already a department with this name.</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="department-head">Head of department</Label>
          <HeadPicker
            id="department-head"
            value={form.head}
            fallbackName={editing?.headName}
            people={people}
            onChange={(head) => setForm((current) => ({ ...current, head }))}
          />
          <p className="text-xs text-muted-foreground">Approvals addressed to the department go to this person.</p>
        </div>
        <div className="space-y-1.5">
          <Label id="department-status-label">Status</Label>
          <StatusToggle id="department-status" value={form.status} onChange={(status) => setForm((current) => ({ ...current, status }))} />
        </div>
      </FormDialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        destructive
        title="Delete this department?"
        description={
          deleteTarget
            ? `"${deleteTarget.name}" will be deleted. People and records in other modules that name it will show it as missing — marking it Inactive is usually safer.`
            : undefined
        }
        confirmLabel="Delete department"
        onConfirm={remove}
      />
    </SettingsPage>
  );
}

/** A searchable list of the app's people; the head must be someone who can sign in. */
function HeadPicker({
  id,
  value,
  fallbackName,
  people,
  onChange,
}: {
  id: string;
  value: string;
  /** The stored name, for a head no longer in the list (left the company, account closed). */
  fallbackName?: string;
  people: readonly Person[];
  onChange: (userId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  const matches = query ? people.filter((person) => `${person.name} ${person.detail ?? ''}`.toLowerCase().includes(query)) : people;
  const current = value ? people.find((person) => person.id === value)?.name ?? fallbackName ?? 'Someone no longer listed' : '';

  const choose = (userId: string) => {
    onChange(userId);
    setOpen(false);
    setSearch('');
  };

  return (
    // Modal so the list scrolls with the wheel inside the dialog, whose scroll lock otherwise
    // swallows it (the popover is portalled outside the dialog).
    <Popover modal open={open} onOpenChange={(next) => { setOpen(next); if (!next) setSearch(''); }}>
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
          <span className={cn('flex min-w-0 items-center gap-2', !current && 'text-muted-foreground')}>
            <UserRound className="h-4 w-4 shrink-0 opacity-60" aria-hidden="true" />
            <span className="truncate">{current || 'No one'}</span>
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-[16rem] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search people" value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>{people.length ? 'No one matches.' : 'The list of people could not be loaded.'}</CommandEmpty>
            <CommandGroup>
              {value && !query && (
                <CommandItem value="__clear__" onSelect={() => choose('')}>
                  <X className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  No one
                </CommandItem>
              )}
              {matches.map((person) => (
                <CommandItem key={person.id} value={person.id} onSelect={() => choose(person.id)}>
                  <Check className={cn('mr-2 h-4 w-4 shrink-0', value === person.id ? 'opacity-100' : 'opacity-0')} aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{person.name}</span>
                    {person.detail && <span className="block truncate text-[11px] text-muted-foreground">{person.detail}</span>}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
