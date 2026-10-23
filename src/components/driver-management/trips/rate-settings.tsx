'use client';

/**
 * Settings › Rates per km.
 *
 * The rate card is a list of revisions, each in force from its date until the next one. A trip is
 * priced by the revision in force on the trip date, so changing a rate means adding a revision from
 * the day it starts — trips before that day keep the old rate. A revision that has priced a
 * submitted claim is locked (the server refuses the edit); one that has not can still be corrected.
 */

import { useMemo, useState } from 'react';
import { IndianRupee, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { FormDialog } from '@/components/shared/form-dialog';
import { PageHeader } from '@/components/shared/page-header';
import { StatusBadge } from '@/components/shared/status-badge';
import { VM_PRIMARY_BUTTON } from '@/components/vehicle-management/vm-ui';
import { revisionOn, sortRevisions } from '@/lib/employee-trips/rates';
import type { RateRevision } from '@/lib/employee-trips/types';
import { useTripClaims } from './trip-claims-provider';
import { ErrorBlock, Field, LoadingBlock, shortDate } from './trip-ui';
import { useTripSettings } from './use-trip-settings';

interface RowDraft {
  key: string;
  vehicleType: string;
  own: string;
  company: string;
}

const STARTER_TYPES = ['Two Wheeler', 'Car'];
const rateText = (value: number | null) => (value === null ? '' : String(value));
const rateCell = (value: number | null) => (value === null ? <span className="text-muted-foreground">Not paid</span> : <span className="tabular-nums font-medium">₹{value}/km</span>);

export default function RateSettings() {
  const { data: boot } = useTripClaims();
  const { payload, error, saving, load, save } = useTripSettings();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [note, setNote] = useState('');
  const [rows, setRows] = useState<RowDraft[]>([]);
  const [deleting, setDeleting] = useState<RateRevision | null>(null);

  const today = boot?.today ?? '';
  const revisions = useMemo(() => sortRevisions(payload?.settings.rateRevisions ?? []).reverse(), [payload]);
  const current = payload ? revisionOn(payload.settings.rateRevisions, today) : null;
  const canEdit = Boolean(payload?.canEdit);
  const vehicleTypes = boot?.vehicleTypes ?? [];

  function openEditor(revision: RateRevision | null) {
    const source = revision ?? current ?? revisions[0] ?? null;
    setEditingId(revision?.id ?? null);
    setEffectiveFrom(revision?.effectiveFrom ?? today);
    setNote(revision?.note ?? '');
    setRows(
      source?.rates.length
        ? source.rates.map((row, index) => ({ key: `${index}-${row.vehicleType}`, vehicleType: row.vehicleType, own: rateText(row.own), company: rateText(row.company) }))
        : STARTER_TYPES.map((type) => ({ key: type, vehicleType: type, own: '', company: '' })),
    );
    setEditorOpen(true);
  }

  const setRow = (key: string, patch: Partial<RowDraft>) => setRows((existing) => existing.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const unusedTypes = vehicleTypes.filter((type) => !rows.some((row) => row.vehicleType.toLowerCase() === type.toLowerCase()));
  const duplicateDate = revisions.some((revision) => revision.effectiveFrom === effectiveFrom && revision.id !== editingId);

  async function submit() {
    const ok = await save(
      {
        part: 'rate-revision',
        revision: {
          id: editingId ?? undefined,
          effectiveFrom,
          note,
          rates: rows.map((row) => ({ vehicleType: row.vehicleType, own: row.own.trim() === '' ? null : Number(row.own), company: row.company.trim() === '' ? null : Number(row.company) })),
        },
      },
      editingId ? 'Rate card updated' : 'Rate card added',
    );
    if (ok) setEditorOpen(false);
  }

  if (error) return <ErrorBlock message={error} onRetry={() => void load()} />;
  if (!payload) return <LoadingBlock />;

  const status = (revision: RateRevision) => (revision.id === current?.id ? <StatusBadge tone="success">In force</StatusBadge> : revision.effectiveFrom > today ? <StatusBadge tone="info">Upcoming</StatusBadge> : <StatusBadge tone="neutral">Past</StatusBadge>);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Rates per km"
        icon={IndianRupee}
        backHref="/driver-management/settings"
        description="A trip is paid at the rate in force on its date. To change a rate, add a rate card from the day the new rate starts."
        actions={
          canEdit ? (
            <Button type="button" className={VM_PRIMARY_BUTTON} onClick={() => openEditor(null)}>
              <Plus className="mr-2 h-4 w-4" aria-hidden />
              New rate card
            </Button>
          ) : undefined
        }
      />

      {!revisions.length && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No rate card yet — trips are recorded at ₹0 per km until one is added.
            {canEdit && (
              <div className="mt-3">
                <Button type="button" variant="outline" onClick={() => openEditor(null)}>
                  <Plus className="mr-2 h-4 w-4" aria-hidden />
                  Set the first rates
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {revisions.map((revision) => (
        <Card key={revision.id} className={revision.id === current?.id ? 'border-emerald-200' : undefined}>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0 pb-2">
            <div className="min-w-0">
              <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
                From {shortDate(revision.effectiveFrom)}
                {status(revision)}
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                {revision.note ? `${revision.note} · ` : ''}
                {revision.savedByName ? `Saved by ${revision.savedByName}${revision.savedAt ? ` on ${shortDate(revision.savedAt)}` : ''}` : ''}
              </p>
            </div>
            {canEdit && (
              <div className="flex gap-1.5">
                <Button type="button" variant="outline" size="sm" onClick={() => openEditor(revision)} aria-label={`Edit rate card from ${revision.effectiveFrom}`}>
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                </Button>
                <Button type="button" variant="outline" size="sm" className="text-rose-600 hover:text-rose-700" onClick={() => setDeleting(revision)} aria-label={`Delete rate card from ${revision.effectiveFrom}`}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </div>
            )}
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vehicle type</TableHead>
                    <TableHead className="text-right">Own vehicle</TableHead>
                    <TableHead className="text-right">Company vehicle</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {revision.rates.map((row) => (
                    <TableRow key={row.vehicleType}>
                      <TableCell className="font-medium">{row.vehicleType}</TableCell>
                      <TableCell className="text-right">{rateCell(row.own)}</TableCell>
                      <TableCell className="text-right">{rateCell(row.company)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ))}

      <FormDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        size="lg"
        title={editingId ? 'Edit rate card' : 'New rate card'}
        description="Leave a rate blank when that ownership is not paid per km (often company vehicles, whose fuel the company pays). Unclaimed trips are re-priced when you save."
        onSubmit={submit}
        submitting={saving}
        submitDisabled={!effectiveFrom || duplicateDate || !rows.some((row) => row.vehicleType.trim())}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="In force from" required htmlFor="rate-from" error={duplicateDate ? 'A rate card from this date already exists — edit that one.' : undefined}>
            <Input id="rate-from" type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} className="bg-white" />
          </Field>
          <Field label="Note" htmlFor="rate-note">
            <Input id="rate-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} placeholder="e.g. Revised for fuel price" className="bg-white" />
          </Field>
        </div>

        <div className="space-y-2">
          <div className="hidden grid-cols-[minmax(0,1fr)_7rem_7rem_2rem] gap-2 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:grid">
            <span>Vehicle type</span>
            <span>Own ₹/km</span>
            <span>Company ₹/km</span>
            <span />
          </div>
          {rows.map((row) => (
            <div key={row.key} className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 p-2 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_2rem] sm:border-0 sm:p-0">
              <Input value={row.vehicleType} onChange={(event) => setRow(row.key, { vehicleType: event.target.value })} placeholder="Vehicle type" className="col-span-2 bg-white sm:col-span-1" aria-label="Vehicle type" />
              <Input type="number" inputMode="decimal" min="0" step="0.01" value={row.own} onChange={(event) => setRow(row.key, { own: event.target.value })} placeholder="Own" className="bg-white" aria-label={`${row.vehicleType} own-vehicle rate`} />
              <Input type="number" inputMode="decimal" min="0" step="0.01" value={row.company} onChange={(event) => setRow(row.key, { company: event.target.value })} placeholder="Company" className="bg-white" aria-label={`${row.vehicleType} company-vehicle rate`} />
              <Button type="button" variant="ghost" size="icon" className="col-span-2 h-9 w-full sm:col-span-1 sm:w-8" onClick={() => setRows((existing) => existing.filter((entry) => entry.key !== row.key))} aria-label={`Remove ${row.vehicleType}`}>
                <X className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            {unusedTypes.length > 0 && (
              <Select value="" onValueChange={(type) => setRows((existing) => [...existing, { key: `${Date.now()}`, vehicleType: type, own: '', company: '' }])}>
                <SelectTrigger className="w-full bg-white text-left sm:w-56" aria-label="Add a vehicle type">
                  <SelectValue placeholder="Add a vehicle type…" />
                </SelectTrigger>
                <SelectContent>
                  {unusedTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button type="button" variant="outline" size="sm" onClick={() => setRows((existing) => [...existing, { key: `${Date.now()}`, vehicleType: '', own: '', company: '' }])}>
              <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Other type
            </Button>
          </div>
        </div>
      </FormDialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        destructive
        title="Delete this rate card?"
        description={deleting ? `The rates from ${shortDate(deleting.effectiveFrom)}. Unclaimed trips of those dates are re-priced by the card before it. A card that has priced a submitted claim cannot be deleted.` : undefined}
        onConfirm={async () => {
          if (!deleting) return;
          const ok = await save({ part: 'delete-rate-revision', revisionId: deleting.id }, 'Rate card deleted');
          if (!ok) throw new Error('not deleted');
        }}
      />
    </div>
  );
}
