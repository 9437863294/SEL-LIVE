'use client';

/**
 * Create a claim: choose which unclaimed trips go on it — one, several or all — and send it for
 * approval. A trip is one journey; a claim is what gets approved and paid, and holds as many trips
 * as the employee puts on it.
 *
 * Opens with the trips the employee already picked (or every unclaimed trip when none were picked)
 * ticked, shows the total as the selection changes, and where the claim goes first. When the
 * workflow routes by project or department, trips of different ones become separate claims, each
 * going to its own approver — said before anything is sent. The server re-prices the trips from the
 * current rate card and freezes them on the claim.
 */

import { useMemo, useState } from 'react';
import { Plus, ReceiptText, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DialogClose } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { FormDialog } from '@/components/shared/form-dialog';
import { useToast } from '@/hooks/use-toast';
import { sumMoney } from '@/lib/employee-trips/rates';
import { REPORTING_SOURCE_LABELS, formatKm, type TripRecord } from '@/lib/employee-trips/types';
import { cn } from '@/lib/utils';
import { errorMessage, tripFetch, type Bootstrap } from './trip-api';
import { FlagChips, Money, shortDate } from './trip-ui';

export interface CreatedClaim {
  id: string;
  claimNumber: string;
  amount: number;
}

export function CreateClaimDialog({
  open,
  onOpenChange,
  data,
  candidates,
  preselected,
  onSubmitted,
  onRecordTrip,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: Bootstrap;
  /** Every trip that can go on a claim now (unclaimed, inside the claim window). */
  candidates: TripRecord[];
  /** Trips to start ticked; empty ticks them all. */
  preselected: string[];
  onSubmitted: (claims: CreatedClaim[]) => void;
  /** Offered when there is nothing to claim yet. */
  onRecordTrip?: () => void;
}) {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [remarks, setRemarks] = useState('');
  const [declared, setDeclared] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // A fresh selection each time the dialog opens (adjusted during render, not in an effect).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      const wanted = preselected.filter((id) => candidates.some((trip) => trip.id === id));
      setSelected(new Set(wanted.length ? wanted : candidates.map((trip) => trip.id)));
      setRemarks('');
      setDeclared(false);
      setFailure(null);
    }
  }

  const listed = useMemo(() => [...candidates].sort((a, b) => a.tripDate.localeCompare(b.tripDate) || a.createdAt.localeCompare(b.createdAt)), [candidates]);
  const trips = listed.filter((trip) => selected.has(trip.id));
  const km = Math.round(trips.reduce((total, trip) => total + trip.distanceKm, 0) * 10) / 10;
  const amount = sumMoney(trips.map((trip) => trip.totalAmount));
  const flagged = trips.filter((trip) => trip.flags.length).length;
  const allTicked = listed.length > 0 && trips.length === listed.length;

  const stages = data.settings.stages;
  const byProject = stages.some((stage) => stage.routing === 'project');
  const byDepartment = stages.some((stage) => stage.routing === 'department');
  const groups = useMemo(() => {
    const keys = new Map<string, string>();
    for (const trip of trips) {
      const key = `${byProject ? trip.projectId ?? '' : ''}|${byDepartment ? trip.departmentId ?? '' : ''}`;
      keys.set(key, [byProject ? trip.projectName || 'No project' : null, byDepartment ? trip.departmentName || 'No department' : null].filter(Boolean).join(' · '));
    }
    return [...keys.values()];
  }, [byDepartment, byProject, trips]);
  const first = stages.find((stage) => stage.kind === 'approval');
  const payment = stages.find((stage) => stage.kind === 'payment');
  // Who it goes to first, by name where that is already known (not when it depends on the trips' project).
  const firstApproval = data.firstApproval;
  const firstPeople = !firstApproval.dependsOnTrips && firstApproval.names.length ? firstApproval.names.join(', ') : null;
  const routeLine = (
    <>
      Goes first to{' '}
      {firstPeople ? (
        <>
          <span className="font-medium text-slate-800">{firstPeople}</span>
          {firstApproval.reportingSource ? `, your reporting authority (${REPORTING_SOURCE_LABELS[firstApproval.reportingSource]})` : ` — ${firstApproval.stageName}`}
        </>
      ) : (
        <span className="font-medium text-slate-800">{first?.name ?? 'the approver'}</span>
      )}
      , then {payment?.name ?? 'payment'}.
    </>
  );

  const toggle = (id: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  async function submit() {
    if (!trips.length) return;
    if (!declared) {
      setFailure('Tick the confirmation box above to create the claim.');
      return;
    }
    setSubmitting(true);
    setFailure(null);
    try {
      const result = await tripFetch<{ claims: CreatedClaim[] }>('claims', { body: { tripIds: trips.map((trip) => trip.id), remarks, declaration: true } });
      toast({
        title: result.claims.length === 1 ? `Claim ${result.claims[0].claimNumber} created` : `${result.claims.length} claims created`,
        description: result.claims.length === 1 ? `It is now with ${first?.name ?? 'the approver'}.` : result.claims.map((claim) => claim.claimNumber).join(', '),
      });
      onSubmitted(result.claims);
      onOpenChange(false);
    } catch (error) {
      const message = errorMessage(error, 'The claim could not be created.');
      setFailure(message);
      toast({ variant: 'destructive', title: 'Claim not created', description: message });
    } finally {
      setSubmitting(false);
    }
  }

  if (!listed.length) {
    return (
      <FormDialog
        open={open}
        onOpenChange={onOpenChange}
        size="md"
        title="Create a claim"
        description="A claim puts one or more of your recorded trips up for approval and payment."
        footer={
          <>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Close
              </Button>
            </DialogClose>
            {onRecordTrip && (
              <Button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  onRecordTrip();
                }}
              >
                <Plus className="mr-2 h-4 w-4" aria-hidden />
                Record a trip
              </Button>
            )}
          </>
        }
      >
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-200 px-4 py-10 text-center">
          <ReceiptText className="h-8 w-8 text-slate-300" aria-hidden />
          <p className="text-sm font-medium text-slate-700">No unclaimed trips</p>
          <p className="max-w-sm text-xs text-muted-foreground">Record your trips first. Every trip that is not on a claim yet can then be added to one.</p>
        </div>
      </FormDialog>
    );
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      className="sm:max-w-3xl"
      title="Create a claim"
      description="Tick the trips to put on this claim — one trip, several, or all of them."
      onSubmit={submit}
      submitting={submitting}
      submitDisabled={!trips.length}
      submitLabel={!trips.length ? 'Choose trips' : groups.length > 1 ? `Create ${groups.length} claims` : `Create claim · ${trips.length} trip${trips.length === 1 ? '' : 's'}`}
    >
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Claim amount</p>
          <p className="text-2xl font-semibold text-slate-900">
            <Money value={amount} />
          </p>
          <p className="text-xs text-slate-600">
            {trips.length} of {listed.length} trip{listed.length === 1 ? '' : 's'} · {formatKm(km)}
          </p>
        </div>
        <p className="max-w-xs text-right text-xs text-slate-600">{routeLine}</p>
      </div>

      <div className="rounded-lg border border-slate-200">
        <label className="flex cursor-pointer items-center gap-2.5 border-b border-slate-100 bg-slate-50/60 px-3 py-2 text-xs font-medium text-slate-700">
          <Checkbox checked={allTicked} onCheckedChange={(value) => setSelected(value === true ? new Set(listed.map((trip) => trip.id)) : new Set())} aria-label="Select all trips" />
          {allTicked ? 'All unclaimed trips selected' : `Select all ${listed.length} unclaimed trips`}
        </label>
        <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
          {listed.map((trip) => {
            const ticked = selected.has(trip.id);
            return (
              <li key={trip.id}>
                <label className={cn('flex cursor-pointer items-start gap-2.5 px-3 py-2.5 text-sm transition-colors hover:bg-slate-50', ticked && 'bg-primary/5')}>
                  <Checkbox checked={ticked} onCheckedChange={(value) => toggle(trip.id, value === true)} className="mt-0.5" aria-label={`Trip on ${shortDate(trip.tripDate)} from ${trip.fromPlace} to ${trip.toPlace}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-800">
                      {trip.fromPlace} → {trip.toPlace}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {shortDate(trip.tripDate)} · {trip.vehicleNumber} · {formatKm(trip.distanceKm)}
                      {trip.purpose ? ` · ${trip.purpose}` : ''}
                    </span>
                    {trip.returnNote && <span className="block truncate text-xs text-amber-700">Sent back earlier: {trip.returnNote.remarks}</span>}
                    <FlagChips flags={trip.flags} className="mt-1" />
                  </span>
                  <Money value={trip.totalAmount} className="shrink-0 font-medium" />
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      {groups.length > 1 && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
          <p className="font-semibold">These trips become {groups.length} claims</p>
          <p className="mt-0.5">Approvals are routed by {byProject ? 'project' : 'department'}, so each goes to its own approver: {groups.join('; ')}.</p>
        </div>
      )}
      {flagged > 0 && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          {flagged} selected trip{flagged === 1 ? ' is' : 's are'} flagged for a second look. The approver will see why — add a note below if it helps.
        </p>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="claim-remarks" className="text-xs font-medium">
          Note for the approver
        </Label>
        <Textarea id="claim-remarks" value={remarks} onChange={(event) => setRemarks(event.target.value)} rows={2} maxLength={500} placeholder="Optional" className="bg-white" />
      </div>

      <label className={cn('flex cursor-pointer items-start gap-2.5 rounded-lg border bg-white p-3 text-sm', failure && !declared ? 'border-rose-300' : 'border-slate-200')}>
        <Checkbox
          checked={declared}
          onCheckedChange={(value) => {
            setDeclared(value === true);
            setFailure(null);
          }}
          className="mt-0.5"
          aria-label="Declaration"
        />
        <span className="text-slate-700">I confirm these trips were made for official work, and the readings and amounts are correct.</span>
      </label>
      {failure && <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{failure}</p>}
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Send className="h-3 w-3" aria-hidden />
        Trips on a claim are locked. If something needs changing, the approver can send it back to you.
      </p>
    </FormDialog>
  );
}
