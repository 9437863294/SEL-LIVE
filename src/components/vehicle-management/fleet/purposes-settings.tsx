'use client';

/**
 * Settings › Fleet › Purposes: what a driver picks as the reason for a trip.
 *
 * A purpose can demand a project (a site visit is billed to the site) or a typed reason ("Other").
 * Until the list is first changed, the seven starting purposes are offered without being stored;
 * the first save stores them all, so trips already made keep pointing at the same ids. Removing a
 * purpose only stops it being offered — trips keep its name.
 */

import { useMemo, useState } from 'react';
import { ListChecks, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { DataList, type ListColumn } from '@/components/shared/data-list';
import { FormDialog } from '@/components/shared/form-dialog';
import { StatusBadge } from '@/components/shared/status-badge';
import { VM_PRIMARY_BUTTON } from '@/components/vehicle-management/vm-ui';
import { EmptyBlock, Field } from '@/components/driver-management/trips/trip-ui';
import { fleetErrorMessage, fleetFetch } from '@/components/fleet/fleet-api';
import { useToast } from '@/hooks/use-toast';
import type { Purpose } from '@/lib/fleet/types';
import { fieldErrorsOf } from './fleet-masters';

/** Seeded purposes carry `default-…` ids and no creation date until stored. */
const isSeed = (purpose: Purpose) => !purpose.createdAt;

export default function PurposesSettings({ purposes, canEdit, onChanged }: { purposes: Purpose[]; canEdit: boolean; onChanged: () => void }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState<Purpose | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<Purpose | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const rows = useMemo(() => [...purposes].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)), [purposes]);
  const seeded = purposes.length > 0 && purposes.every(isSeed);
  const nextOrder = rows.length ? Math.min(1000, rows[rows.length - 1].sortOrder + 10) : 10;

  const remove = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await fleetFetch(`purposes/${deleting.id}`, { method: 'DELETE' });
      toast({ title: 'Purpose removed', description: `${deleting.name} is no longer offered. Trips keep it.` });
      setDeleting(null);
      onChanged();
    } catch (failure) {
      toast({ variant: 'destructive', title: 'Not removed', description: fleetErrorMessage(failure, 'The purpose could not be removed.') });
      throw failure;
    } finally {
      setDeleteBusy(false);
    }
  };

  const columns: Array<ListColumn<Purpose>> = [
    { header: 'Purpose', mobile: 'title', cell: (purpose) => <span className="font-medium text-slate-800">{purpose.name}</span> },
    {
      header: 'Asks for',
      mobile: 'detail',
      cell: (purpose) => (
        <div className="flex flex-wrap gap-1">
          {purpose.requiresProject && <StatusBadge tone="info">Project</StatusBadge>}
          {purpose.requiresReason && <StatusBadge tone="warning">Reason</StatusBadge>}
          {!purpose.requiresProject && !purpose.requiresReason && <span className="text-muted-foreground">—</span>}
        </div>
      ),
    },
    { header: 'Order', align: 'right', mobile: 'omit', cell: (purpose) => <span className="tabular-nums text-slate-600">{purpose.sortOrder}</span> },
    { header: 'Status', mobile: 'aside', cell: (purpose) => <StatusBadge tone={purpose.active ? 'success' : 'neutral'}>{purpose.active ? 'Offered' : 'Hidden'}</StatusBadge> },
    ...(canEdit
      ? [
          {
            header: '',
            align: 'right' as const,
            mobile: 'footer' as const,
            cell: (purpose: Purpose) => (
              <span className="flex justify-end gap-1">
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(purpose)} aria-label={`Edit ${purpose.name}`}>
                  <Pencil className="h-4 w-4" aria-hidden />
                  <span className="ml-1.5 sm:hidden">Edit</span>
                </Button>
                <Button type="button" size="sm" variant="ghost" className="text-rose-600 hover:text-rose-700" onClick={() => setDeleting(purpose)} aria-label={`Remove ${purpose.name}`}>
                  <Trash2 className="h-4 w-4" aria-hidden />
                  <span className="ml-1.5 sm:hidden">Remove</span>
                </Button>
              </span>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-600">
            The driver picks one when starting a trip. <span className="font-medium">Project</span>: the trip must be billed to a project. <span className="font-medium">Reason</span>: the driver must say what it was for.
            {seeded && ' These are the starting purposes; saving any change stores the list.'}
          </p>
          {canEdit && (
            <Button type="button" className={VM_PRIMARY_BUTTON} onClick={() => setEditing(null)}>
              <Plus className="mr-2 h-4 w-4" aria-hidden />
              Add purpose
            </Button>
          )}
        </CardContent>
      </Card>

      <DataList rows={rows} columns={columns} rowClassName={(purpose) => (purpose.active ? undefined : 'opacity-60')} empty={<EmptyBlock icon={ListChecks} title="No purposes" />} />

      <PurposeDialog
        open={editing !== undefined}
        onOpenChange={(open) => !open && setEditing(undefined)}
        purpose={editing ?? null}
        nextOrder={nextOrder}
        onSaved={() => {
          setEditing(undefined);
          onChanged();
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        destructive
        loading={deleteBusy}
        title={`Remove ${deleting?.name ?? 'purpose'}?`}
        description="Drivers stop being offered it. Trips already made keep it, and reports still show it."
        confirmLabel="Remove"
        onConfirm={remove}
      />
    </div>
  );
}

interface PurposeForm {
  name: string;
  requiresReason: boolean;
  requiresProject: boolean;
  active: boolean;
  sortOrder: string;
}

const formFrom = (purpose: Purpose | null, nextOrder: number): PurposeForm =>
  purpose
    ? { name: purpose.name, requiresReason: purpose.requiresReason, requiresProject: purpose.requiresProject, active: purpose.active, sortOrder: String(purpose.sortOrder) }
    : { name: '', requiresReason: false, requiresProject: false, active: true, sortOrder: String(nextOrder) };

function PurposeDialog({ open, onOpenChange, purpose, nextOrder, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; purpose: Purpose | null; nextOrder: number; onSaved: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState<PurposeForm>(() => formFrom(purpose, nextOrder));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const session = open ? `open:${purpose?.id ?? 'new'}` : 'closed';
  const [lastSession, setLastSession] = useState(session);
  if (session !== lastSession) {
    setLastSession(session);
    if (open) {
      setForm(formFrom(purpose, nextOrder));
      setErrors({});
    }
  }
  const set = <K extends keyof PurposeForm>(key: K, value: PurposeForm[K]) => setForm((current) => ({ ...current, [key]: value }));

  async function submit() {
    const order = Number(form.sortOrder);
    const invalid: Record<string, string> = {};
    if (form.name.trim().length < 2) invalid.name = 'Name the purpose.';
    if (!Number.isInteger(order) || order < 0 || order > 1000) invalid.sortOrder = 'A whole number from 0 to 1,000.';
    if (Object.keys(invalid).length) {
      setErrors(invalid);
      return;
    }
    setSaving(true);
    try {
      const body = { name: form.name.trim(), requiresReason: form.requiresReason, requiresProject: form.requiresProject, active: form.active, sortOrder: order };
      await fleetFetch(purpose ? `purposes/${purpose.id}` : 'purposes', { method: purpose ? 'PATCH' : 'POST', body });
      toast({ title: purpose ? 'Purpose updated' : 'Purpose added', description: body.name });
      onSaved();
    } catch (failure) {
      setErrors(fieldErrorsOf(failure));
      toast({ variant: 'destructive', title: 'Not saved', description: fleetErrorMessage(failure, 'The purpose could not be saved.') });
    } finally {
      setSaving(false);
    }
  }

  const toggles: { key: 'requiresProject' | 'requiresReason' | 'active'; label: string; hint: string }[] = [
    { key: 'requiresProject', label: 'Needs a project', hint: 'The trip is billed to the project the driver picks.' },
    { key: 'requiresReason', label: 'Needs a reason', hint: 'The driver types what the trip was for — for "Other" and the like.' },
    { key: 'active', label: 'Offered to drivers', hint: 'Off: hidden from the start-trip screen, kept on old trips.' },
  ];

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} size="md" title={purpose ? `Edit ${purpose.name}` : 'Add a purpose'} onSubmit={submit} submitting={saving} submitLabel={purpose ? 'Save' : 'Add purpose'}>
      <Field label="Name" required error={errors.name} htmlFor="purpose-name">
        <Input id="purpose-name" value={form.name} onChange={(event) => set('name', event.target.value)} maxLength={80} placeholder="e.g. Bank work" className="bg-white" aria-invalid={Boolean(errors.name)} />
      </Field>
      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {toggles.map((toggle) => (
          <label key={toggle.key} className="flex cursor-pointer items-start justify-between gap-4 p-3">
            <span className="min-w-0">
              <span className="block text-sm font-medium text-slate-800">{toggle.label}</span>
              <span className="block text-xs text-muted-foreground">{toggle.hint}</span>
            </span>
            <Switch checked={form[toggle.key]} onCheckedChange={(value) => set(toggle.key, value)} aria-label={toggle.label} />
          </label>
        ))}
      </div>
      <Field label="Order in the list" error={errors.sortOrder} htmlFor="purpose-order" hint="Lower comes first.">
        <Input id="purpose-order" type="number" inputMode="numeric" step="1" value={form.sortOrder} onChange={(event) => set('sortOrder', event.target.value)} className="w-28 bg-white" />
      </Field>
    </FormDialog>
  );
}
