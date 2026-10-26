'use client';

/**
 * One over-limit request, in full, and the decision on it.
 *
 * Opened from the inbox or straight from a notification (`?open=<id>`), so it loads the request
 * itself together with the vehicle's trips that day — the manager decides on the day's running, not
 * on one number. Whoever the request has reached (the vehicle's approver, its backup, the escalation
 * list) decides; being reached is the authority. Fleet Trips · Review may decide any waiting request,
 * logged as an override. The driver never decides their own.
 *
 * Each choice says what it does before it is sent: how far the vehicle may run today, and — for
 * approve-and-raise — that its daily limit changes from now on.
 */

import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpCircle, CheckCircle2, Gauge, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { FormDialog } from '@/components/shared/form-dialog';
import { fleetErrorMessage, fleetFetch } from '@/components/fleet/fleet-api';
import { ApprovalStatusBadge, TripStatusBadge } from '@/components/fleet/fleet-ui';
import { useFleetQuery } from '@/components/fleet/use-fleet-query';
import { ErrorBlock, Field, LoadingBlock } from '@/components/driver-management/trips/trip-ui';
import { useToast } from '@/hooks/use-toast';
import { istTimeLabel, shortDateLabel } from '@/lib/fleet/dates';
import { APPROVAL_DECISION_LABELS, formatKm, round1, type ApprovalDecision, type FleetApproval, type FleetTrip } from '@/lib/fleet/types';
import { cn } from '@/lib/utils';

export const LEVEL_LABELS: Record<number, string> = {
  1: "Vehicle's approver",
  2: 'Backup approver',
  3: 'Fleet escalation',
};

/** Can this person decide this request (the server checks again). */
export function canDecideApproval(approval: Pick<FleetApproval, 'status' | 'driverUserId' | 'notifiedIds'>, userId: string, canOverride: boolean): boolean {
  if (approval.status !== 'pending' || !userId || approval.driverUserId === userId) return false;
  return approval.notifiedIds.includes(userId) || canOverride;
}

const DECISIONS: Array<{ value: ApprovalDecision; icon: typeof CheckCircle2; tone: string }> = [
  { value: 'approve', icon: CheckCircle2, tone: 'text-emerald-600' },
  { value: 'approve_cap', icon: Gauge, tone: 'text-sky-600' },
  { value: 'approve_raise', icon: ArrowUpCircle, tone: 'text-indigo-600' },
  { value: 'reject', icon: XCircle, tone: 'text-rose-600' },
];

function Figure({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-2.5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('mt-0.5 text-base font-semibold tabular-nums', warn ? 'text-amber-700' : 'text-slate-900')}>{value}</p>
    </div>
  );
}

const tripKm = (trip: FleetTrip) => trip.billableDistanceKm ?? (trip.odoDistanceKm ?? trip.gpsDistanceKm);

export function ApprovalDecisionDialog({
  approvalId,
  open,
  onOpenChange,
  onDone,
  currentUserId,
  canOverride,
}: {
  approvalId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: (approval: FleetApproval) => void;
  currentUserId: string;
  canOverride: boolean;
}) {
  const { toast } = useToast();
  const query = useFleetQuery<{ approval: FleetApproval; todaysTrips: FleetTrip[] }>(open && approvalId ? `approvals/${approvalId}` : null);
  const approval = query.data?.approval.id === approvalId ? query.data.approval : null;
  const trips = approval ? query.data?.todaysTrips ?? [] : [];

  const [decision, setDecision] = useState<ApprovalDecision>('approve');
  const [capKm, setCapKm] = useState('');
  const [newLimit, setNewLimit] = useState('');
  const [note, setNote] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // A fresh decision each time the dialog opens or switches request (adjusted during render).
  const session = open ? approvalId : null;
  const [lastSession, setLastSession] = useState(session);
  if (session !== lastSession) {
    setLastSession(session);
    if (session) {
      setDecision('approve');
      setCapKm('');
      setNewLimit('');
      setNote('');
      setAttempted(false);
    }
  }

  const decidable = approval ? canDecideApproval(approval, currentUserId, canOverride) : false;
  const overriding = Boolean(approval && decidable && !approval.notifiedIds.includes(currentUserId));
  const cap = capKm.trim() === '' ? null : Number(capKm);
  const limit = newLimit.trim() === '' ? null : Number(newLimit);

  // A cap within what the limit already leaves would allow less than no approval (the server
  // refuses it too — src/lib/fleet/approvals.ts).
  const leftUnderLimit = approval ? round1(Math.max(0, approval.limitKm - approval.usedKm)) : 0;
  const errors: { capKm?: string; newLimit?: string; note?: string } = {};
  if (approval) {
    if (decision === 'approve_cap' && (cap === null || !Number.isFinite(cap) || cap <= 0 || cap > 2000)) errors.capKm = 'Enter the km this trip may run.';
    else if (decision === 'approve_cap' && cap !== null && cap <= leftUnderLimit) errors.capKm = `${formatKm(leftUnderLimit)} are left within the limit already — cap above that, or reject.`;
    if (decision === 'approve_raise' && (limit === null || !Number.isFinite(limit) || limit <= approval.limitKm || limit > 2000)) errors.newLimit = `A new daily limit above ${approval.limitKm} km.`;
    if (decision === 'reject' && !note.trim()) errors.note = 'Say why — the driver sees this.';
  }
  const shown = attempted ? errors : {};

  // What the vehicle may run today if this goes through.
  let effect = '';
  if (approval) {
    if (decision === 'approve') effect = `${approval.vehicleNumber} may run ${formatKm(round1(approval.usedKm + approval.requestedKm))} today.`;
    else if (decision === 'approve_cap') effect = cap && cap > 0 ? `${approval.vehicleNumber} may run ${formatKm(round1(approval.usedKm + cap))} today — ${formatKm(cap)} for this trip instead of ${formatKm(approval.requestedKm)}.` : 'Enter the km this trip may run.';
    else if (decision === 'approve_raise')
      effect =
        limit && limit > approval.limitKm
          ? `${approval.vehicleNumber} may run ${formatKm(round1(Math.max(limit, approval.usedKm + approval.requestedKm)))} today, and its daily limit becomes ${formatKm(Math.round(limit))} from now on.`
          : `Enter a new daily limit above ${formatKm(approval.limitKm)}.`;
    else effect = 'The driver cannot start this trip. They may ask again, or start it as an emergency (counted against their monthly allowance).';
  }

  async function submit() {
    setAttempted(true);
    if (!approval || Object.keys(errors).length) return;
    setSubmitting(true);
    try {
      const result = await fleetFetch<{ approval: FleetApproval }>(`approvals/${approval.id}`, {
        method: 'POST',
        body: { action: decision, capKm: decision === 'approve_cap' ? cap : null, newLimitKm: decision === 'approve_raise' ? limit : null, note: note.trim() },
      });
      toast({
        title: result.approval.status === 'approved' ? 'Approved' : 'Rejected',
        description: result.approval.status === 'approved' ? `${result.approval.vehicleNumber} may run ${formatKm(result.approval.allowedKm)} today. The driver has been told.` : `${result.approval.driverName} has been told.`,
      });
      onDone(result.approval);
      onOpenChange(false);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Decision not saved', description: fleetErrorMessage(error, 'The decision could not be saved.') });
      void query.reload();
    } finally {
      setSubmitting(false);
    }
  }

  const title = approval ? `${approval.vehicleNumber} · over-limit request` : 'Over-limit request';
  const description = approval ? `${approval.driverName} · ${shortDateLabel(approval.dateKey)} · asked at ${istTimeLabel(approval.createdAt)}` : undefined;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={title}
      description={description}
      onSubmit={decidable ? submit : undefined}
      submitting={submitting}
      submitLabel={decision === 'reject' ? 'Reject request' : APPROVAL_DECISION_LABELS[decision]}
      footer={
        decidable ? undefined : (
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Close
            </Button>
          </DialogClose>
        )
      }
    >
      {!approval ? (
        query.error ? (
          <ErrorBlock message={query.error} onRetry={query.reload} />
        ) : (
          <LoadingBlock />
        )
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <ApprovalStatusBadge status={approval.status} />
            <span className="text-xs text-muted-foreground">
              {LEVEL_LABELS[approval.level] ?? `Level ${approval.level}`}
              {approval.status === 'pending' ? ` · expires ${istTimeLabel(approval.expiresAt)}` : ''}
              {approval.status === 'pending' && approval.escalateAt ? ` · escalates ${istTimeLabel(approval.escalateAt)}` : ''}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Figure label="Used today" value={formatKm(approval.usedKm)} />
            <Figure label="Daily limit" value={formatKm(approval.limitKm)} />
            <Figure label="This trip" value={formatKm(approval.requestedKm)} />
            <Figure label="Day would be" value={formatKm(round1(approval.usedKm + approval.requestedKm))} warn />
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
            <p className="font-medium text-slate-800">
              {approval.purposeName}
              {approval.projectName ? <span className="font-normal text-muted-foreground"> · {approval.projectName}</span> : null}
            </p>
            <p className="mt-1 whitespace-pre-line break-words text-slate-700">{approval.reason}</p>
          </div>

          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {approval.vehicleNumber} on {shortDateLabel(approval.dateKey)}
            </h3>
            {trips.length ? (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
                {trips.map((trip) => (
                  <li key={trip.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="w-12 shrink-0 tabular-nums text-xs text-muted-foreground">{istTimeLabel(trip.startedAt)}</span>
                    <span className="min-w-0 flex-1">
                      <Link href={`/driver-management/fleet/trips/${trip.id}`} className="block truncate font-medium text-slate-800 hover:underline">
                        {trip.purposeName}
                        {trip.projectName ? ` · ${trip.projectName}` : ''}
                      </Link>
                      <span className="block truncate text-xs text-muted-foreground">{trip.driverName}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-xs font-medium">{formatKm(tripKm(trip))}</span>
                    <span className="shrink-0">
                      <TripStatusBadge status={trip.status} />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-muted-foreground">No trips on this vehicle that day yet.</p>
            )}
          </section>

          {approval.status !== 'pending' && approval.decidedAt && (
            <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
              <p className="font-medium text-slate-800">
                {approval.decision ? APPROVAL_DECISION_LABELS[approval.decision] : 'Decided'} by {approval.decidedByName} at {istTimeLabel(approval.decidedAt)}
              </p>
              {approval.allowedKm !== null && <p className="text-xs text-muted-foreground">Allowed {formatKm(approval.allowedKm)} that day{approval.newLimitKm ? `; daily limit raised to ${formatKm(approval.newLimitKm)}` : ''}.</p>}
              {approval.decisionNote && <p className="mt-1 text-xs text-slate-700">{approval.decisionNote}</p>}
            </div>
          )}

          {approval.history.length > 1 && (
            <details className="rounded-lg border border-slate-200 bg-white p-3 text-xs">
              <summary className="cursor-pointer font-medium text-slate-700">History ({approval.history.length})</summary>
              <ol className="mt-2 space-y-1">
                {approval.history.map((entry, index) => (
                  <li key={`${entry.at}-${index}`} className="flex gap-2 text-slate-600">
                    <span className="w-12 shrink-0 tabular-nums">{istTimeLabel(entry.at)}</span>
                    <span className="min-w-0 flex-1 break-words">
                      <span className="font-medium text-slate-700">{entry.byName}</span> · {entry.action.replace(/_/g, ' ')}
                      {entry.level ? ` · level ${entry.level}` : ''}
                      {entry.note ? ` — ${entry.note}` : ''}
                    </span>
                  </li>
                ))}
              </ol>
            </details>
          )}

          {decidable && (
            <section className="space-y-3 border-t border-slate-100 pt-3">
              <h3 className="text-sm font-semibold text-slate-800">Your decision</h3>
              {overriding && <p className="rounded-lg border border-sky-200 bg-sky-50 p-2.5 text-xs text-sky-900">This request has not reached you. Deciding it is recorded as an override.</p>}
              <RadioGroup value={decision} onValueChange={(value) => setDecision(value as ApprovalDecision)} className="grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label="Decision">
                {DECISIONS.map((option) => (
                  <Label
                    key={option.value}
                    htmlFor={`decision-${option.value}`}
                    className={cn('flex cursor-pointer items-center gap-2.5 rounded-lg border p-3 text-sm font-normal transition-colors', decision === option.value ? 'border-primary bg-primary/5' : 'border-slate-200 bg-white hover:bg-slate-50')}
                  >
                    <RadioGroupItem id={`decision-${option.value}`} value={option.value} />
                    <option.icon className={cn('h-4 w-4 shrink-0', option.tone)} aria-hidden />
                    <span className="font-medium text-slate-800">{APPROVAL_DECISION_LABELS[option.value]}</span>
                  </Label>
                ))}
              </RadioGroup>

              {decision === 'approve_cap' && (
                <Field label="Km this trip may run" required error={shown.capKm} htmlFor="decision-cap" hint={`Asked for ${formatKm(approval.requestedKm)}; more than ${formatKm(leftUnderLimit)} (what the limit already leaves).`}>
                  <Input id="decision-cap" type="number" inputMode="decimal" step="1" min="1" max="2000" value={capKm} onChange={(event) => setCapKm(event.target.value)} className="bg-white" aria-invalid={Boolean(shown.capKm)} />
                </Field>
              )}
              {decision === 'approve_raise' && (
                <Field label="New daily limit (km)" required error={shown.newLimit} htmlFor="decision-limit" hint={`Now ${formatKm(approval.limitKm)}. Applies to every day from now on.`}>
                  <Input id="decision-limit" type="number" inputMode="numeric" step="1" min={approval.limitKm + 1} max="2000" value={newLimit} onChange={(event) => setNewLimit(event.target.value)} className="bg-white" aria-invalid={Boolean(shown.newLimit)} />
                </Field>
              )}

              <p className={cn('rounded-lg border p-2.5 text-xs', decision === 'reject' ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900')}>{effect}</p>

              <Field label={decision === 'reject' ? 'Reason' : 'Note for the driver'} required={decision === 'reject'} error={shown.note} htmlFor="decision-note">
                <Textarea id="decision-note" value={note} onChange={(event) => setNote(event.target.value)} rows={2} maxLength={500} placeholder={decision === 'reject' ? 'e.g. Use the pickup for this delivery' : 'Optional'} className="bg-white" aria-invalid={Boolean(shown.note)} />
              </Field>
            </section>
          )}
          {!decidable && approval.status === 'pending' && approval.driverUserId === currentUserId && (
            <p className="text-xs text-muted-foreground">This is your own request — it is decided by your approver.</p>
          )}
        </>
      )}
    </FormDialog>
  );
}
