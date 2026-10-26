'use client';

/**
 * Over the daily limit: the vehicle has run most of its km for today, and this trip would take it
 * past them. Two ways on, and only two:
 *
 * - **Ask for approval** — the request goes to the vehicle's approver (or the driver's reporting
 *   authority), moves up the chain if nobody answers, and expires after two hours. The home screen
 *   watches for the answer; approved, "Start now" reopens the start with everything already filled.
 * - **Emergency start** — start now, past the limit, with a reason. Counted: a driver has a few a
 *   month (Settings › Fleet), the manager is told at once, and the trip is flagged.
 *
 * The figures are the server's (`StartLimitCheck`), shown as they are, so the driver sees exactly
 * why they were stopped.
 */

import { useState } from 'react';
import { AlertTriangle, Hourglass, Send, Siren } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FormDialog } from '@/components/shared/form-dialog';
import { useToast } from '@/hooks/use-toast';
import { formatKm, type FleetApproval, type FleetTrip } from '@/lib/fleet/types';
import type { FleetBootstrap } from '@/lib/fleet/server/overview';
import { fleetErrorMessage, fleetFetch, newClientId } from '@/components/fleet/fleet-api';
import { Field } from '@/components/driver-management/trips/trip-ui';
import { cn } from '@/lib/utils';
import { fieldErrors, postStart, prepareLocation, startBody, toNumber, type OverLimitState } from './start-helpers';

type Mode = 'ask' | 'emergency';

export function OverLimitDialog({
  open,
  onOpenChange,
  bootstrap,
  state,
  onRequested,
  onStarted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bootstrap: FleetBootstrap;
  state: OverLimitState;
  onRequested: (approval: FleetApproval) => void;
  onStarted: (trip: FleetTrip) => void;
}) {
  const { toast } = useToast();
  const { limit, values } = state;
  const emergenciesLeft = bootstrap.emergenciesLeft;
  const [mode, setMode] = useState<Mode>('ask');
  const [requestedKm, setRequestedKm] = useState(values.expectedKm || String(limit.expectedKm));
  const [reason, setReason] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // A fresh start id for the emergency attempt: the refused start created nothing.
  const [clientStartId] = useState(() => newClientId('start'));

  const km = toNumber(requestedKm);
  const reasonError = attempted && reason.trim().length < 5 ? (mode === 'ask' ? 'Say why the extra running is needed.' : 'Say what the emergency is.') : serverErrors.reason || undefined;
  const kmError = attempted && mode === 'ask' && (km === null || km < 1 || km > 2000) ? 'How far will the trip go?' : serverErrors.requestedKm || undefined;

  async function submit() {
    setAttempted(true);
    setFailure(null);
    if (reason.trim().length < 5) return;
    if (mode === 'ask' && (km === null || km < 1 || km > 2000)) return;
    if (mode === 'emergency' && emergenciesLeft <= 0) return;
    setSubmitting(true);
    try {
      if (mode === 'ask') {
        const result = await fleetFetch<{ approval: FleetApproval; reused: boolean }>('approvals', {
          method: 'POST',
          body: { vehicleId: values.vehicleId, requestedKm: km, reason: reason.trim(), projectId: values.projectId, purposeId: values.purposeId },
        });
        toast({
          title: result.reused ? 'Already asked' : 'Request sent',
          description: result.reused ? 'Your earlier request is still waiting for an answer.' : 'You will be told the moment it is decided. Keep this screen open or come back to it.',
        });
        onRequested(result.approval);
        return;
      }
      if (!values.uploaded) throw new Error('The odometer photo was not uploaded — start again.');
      const located = await prepareLocation({ background: false });
      const { trip } = await postStart(startBody(values, clientStartId, located.position, values.uploaded, { reason: reason.trim() }));
      toast({ title: 'Emergency start', description: `${trip.vehicleNumber} — your manager has been told.` });
      onStarted(trip);
    } catch (error) {
      setServerErrors(fieldErrors(error));
      const message = fleetErrorMessage(error, mode === 'ask' ? 'The request could not be sent.' : 'The trip could not be started.');
      setFailure(message);
      toast({ variant: 'destructive', title: mode === 'ask' ? 'Not sent' : 'Not started', description: message });
    } finally {
      setSubmitting(false);
    }
  }

  const figures = [
    { label: 'Used today', value: formatKm(limit.usedKm) },
    { label: limit.allowedKm > limit.limitKm ? 'Allowed today' : 'Daily limit', value: formatKm(limit.allowedKm) },
    { label: 'This trip', value: formatKm(limit.expectedKm) },
    { label: 'Over by', value: formatKm(limit.overByKm), alert: true },
  ];

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => !submitting && onOpenChange(next)}
      size="md"
      title={`${state.vehicleNumber || 'This vehicle'} is over its limit`}
      description={`${formatKm(limit.remainingKm)} left today — this trip needs approval first.`}
      onSubmit={submit}
      submitting={submitting}
      submitDisabled={mode === 'emergency' && emergenciesLeft <= 0}
      footer={
        <>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={submitting}>
              Not now
            </Button>
          </DialogClose>
          <Button type="submit" disabled={submitting || (mode === 'emergency' && emergenciesLeft <= 0)} variant={mode === 'emergency' ? 'destructive' : 'default'}>
            {mode === 'ask' ? <Send className="mr-2 h-4 w-4" aria-hidden /> : <Siren className="mr-2 h-4 w-4" aria-hidden />}
            {mode === 'ask' ? 'Ask for approval' : 'Start as emergency'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {figures.map((figure) => (
          <div key={figure.label} className={cn('min-w-0 rounded-xl border p-2.5', figure.alert ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-slate-50')}>
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{figure.label}</p>
            <p className={cn('mt-0.5 text-base font-semibold tabular-nums', figure.alert ? 'text-rose-700' : 'text-slate-800')}>{figure.value}</p>
          </div>
        ))}
      </div>

      {state.pendingApprovalId && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <Hourglass className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          You already asked for this vehicle today and the request is still waiting. Asking again shows that request.
        </p>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="How to go on">
        {(
          [
            { value: 'ask', title: 'Ask for approval', hint: 'Your approver decides; it expires in two hours.', icon: Send },
            { value: 'emergency', title: 'Emergency start', hint: emergenciesLeft > 0 ? `${emergenciesLeft} of ${bootstrap.settings.emergencyMonthlyMax} left this month.` : 'None left this month.', icon: Siren },
          ] as const
        ).map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={mode === option.value}
            onClick={() => {
              setMode(option.value);
              setFailure(null);
            }}
            className={cn(
              'flex min-w-0 items-start gap-2.5 rounded-xl border p-3 text-left transition-colors',
              mode === option.value ? (option.value === 'emergency' ? 'border-rose-300 bg-rose-50' : 'border-primary/40 bg-primary/5') : 'border-slate-200 bg-white hover:bg-slate-50',
            )}
          >
            <option.icon className={cn('mt-0.5 h-4 w-4 shrink-0', option.value === 'emergency' ? 'text-rose-600' : 'text-primary')} aria-hidden />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-slate-800">{option.title}</span>
              <span className="block text-xs text-muted-foreground">{option.hint}</span>
            </span>
          </button>
        ))}
      </div>

      {mode === 'ask' && (
        <Field label="Km for this trip" required error={kmError} htmlFor="fleet-overlimit-km">
          <Input id="fleet-overlimit-km" type="number" inputMode="decimal" min="1" max="2000" step="1" value={requestedKm} onChange={(event) => setRequestedKm(event.target.value)} className="bg-white" />
        </Field>
      )}
      <Field label={mode === 'ask' ? 'Why is it needed?' : 'What is the emergency?'} required error={reasonError} htmlFor="fleet-overlimit-reason">
        <Textarea
          id="fleet-overlimit-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
          maxLength={mode === 'ask' ? 500 : 300}
          placeholder={mode === 'ask' ? 'e.g. Second material run to Site A — the pickup is under repair' : 'e.g. Injured worker to hospital'}
          className="bg-white"
        />
      </Field>

      {mode === 'emergency' && (
        <p className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {emergenciesLeft > 0
            ? 'The trip starts now with the same vehicle, purpose and odometer photo. It is flagged, counted against your monthly emergencies, and your manager is told straight away.'
            : 'You have used every emergency start for this month. Ask for approval instead.'}
        </p>
      )}
      {failure && <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{failure}</p>}
    </FormDialog>
  );
}
