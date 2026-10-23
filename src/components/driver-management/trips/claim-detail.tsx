'use client';

/**
 * One claim: its trips, where it stands, and — for the person it waits for — the decision.
 *
 * An approver decides trip by trip: approve (the default), cut the distance, reject, or send back to
 * the employee. The totals preview runs the same `applyDecisions` the server runs, so a decision the
 * server would refuse is explained before it is sent. The payer records the payment here or in bulk
 * from Payments. The claimant can withdraw a claim nobody has acted on yet.
 */

import { useMemo, useState } from 'react';
import { Banknote, CircleCheck, GitBranch, ReceiptText, RotateCcw, Send, Undo2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { DataList, type ListColumn } from '@/components/shared/data-list';
import { FormDialog } from '@/components/shared/form-dialog';
import { PageHeader } from '@/components/shared/page-header';
import { VM_PRIMARY_BUTTON } from '@/components/vehicle-management/vm-ui';
import { useToast } from '@/hooks/use-toast';
import { formatINR } from '@/lib/employee-trips/rates';
import { applyDecisions, claimTotals, type LineDecisionInput } from '@/lib/employee-trips/workflow';
import { formatKm, type ClaimHistoryEntry, type LineDecision, type TripDecision, type TripRecord } from '@/lib/employee-trips/types';
import { cn } from '@/lib/utils';
import { errorMessage, tripFetch, type ClaimDetail } from './trip-api';
import { useTripClaims } from './trip-claims-provider';
import { useTripQuery } from './use-trip-query';
import { PayDialog } from './pay-dialog';
import { ClaimStatusBadge, ErrorBlock, FlagChips, Km, LoadingBlock, Money, StageTrail, VehicleLabel, shortDate } from './trip-ui';

interface DecisionDraft {
  decision: LineDecision;
  approvedKm: string;
  remarks: string;
}

const DECISION_LABELS: Record<LineDecision, string> = { approve: 'Approve', adjust: 'Cut distance', reject: 'Reject', return: 'Send back' };

const HISTORY_ICONS: Record<ClaimHistoryEntry['action'], React.ComponentType<{ className?: string }>> = {
  submitted: Send,
  approved: CircleCheck,
  paid: Banknote,
  returned: Undo2,
  rejected: XCircle,
  withdrawn: RotateCcw,
  rerouted: GitBranch,
};

const HISTORY_LABELS: Record<ClaimHistoryEntry['action'], string> = {
  submitted: 'Submitted',
  approved: 'Approved',
  paid: 'Paid',
  returned: 'Sent back',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  rerouted: 'Re-routed',
};

type DialogKind = 'approve' | 'return' | 'reject' | 'withdraw' | 'pay';

/**
 * The approver's decisions as the server will apply them: the same `applyDecisions`, so the same
 * refusals. Cheap enough to run on every render — a claim holds at most 200 trips.
 */
function previewDecisions(trips: TripRecord[], inputs: LineDecisionInput[], stageName: string, user: { id: string; name: string } | null) {
  try {
    const outcome = applyDecisions(trips, inputs, { stageName, byId: user?.id ?? '', byName: user?.name ?? '', at: '' });
    const decided = new Map<string, TripDecision>(outcome.kept.map((entry) => [entry.tripId, entry.decision]));
    const kept = trips.filter((trip) => decided.has(trip.id));
    return { totals: claimTotals(kept.map((trip) => ({ ...trip, decision: decided.get(trip.id)! }))), summary: outcome.summary, decided, error: null as string | null };
  } catch (failure) {
    return { totals: null, summary: '', decided: new Map<string, TripDecision>(), error: errorMessage(failure) };
  }
}

export default function ClaimDetailView({ claimId }: { claimId: string }) {
  const { toast } = useToast();
  const { data, reload: reloadBootstrap } = useTripClaims();
  const query = useTripQuery<ClaimDetail>(claimId ? `claims/${claimId}` : null);
  const detail = query.data;
  const error = detail ? null : query.error;
  const [drafts, setDrafts] = useState<Record<string, DecisionDraft>>({});
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);

  const claim = detail?.claim;
  const trips = useMemo(() => detail?.trips ?? [], [detail]);
  const abilities = detail?.abilities;
  const deciding = Boolean(abilities?.decide);
  const stage = claim?.stages[claim.currentStageIndex];
  const nextStage = claim?.stages[claim.currentStageIndex + 1];

  const draftOf = (trip: TripRecord): DecisionDraft => drafts[trip.id] ?? { decision: 'approve', approvedKm: '', remarks: '' };
  const setDraft = (tripId: string, patch: Partial<DecisionDraft>) => setDrafts((current) => ({ ...current, [tripId]: { ...(current[tripId] ?? { decision: 'approve', approvedKm: '', remarks: '' }), ...patch } }));

  const inputs: LineDecisionInput[] = useMemo(
    () =>
      Object.entries(drafts)
        .filter(([, draft]) => draft.decision !== 'approve')
        .map(([tripId, draft]) => ({ tripId, decision: draft.decision, approvedKm: draft.decision === 'adjust' ? Number(draft.approvedKm) : null, remarks: draft.remarks })),
    [drafts],
  );

  const preview = deciding && stage ? previewDecisions(trips, inputs, stage.name, data?.user ?? null) : null;

  async function act(body: Record<string, unknown>, done: string) {
    setBusy(true);
    try {
      await tripFetch(`claims/${claimId}`, { body });
      toast({ title: done });
      setDialog(null);
      setDrafts({});
      query.reload();
      reloadBootstrap();
    } catch (failure) {
      toast({ variant: 'destructive', title: 'Not done', description: errorMessage(failure) });
    } finally {
      setBusy(false);
    }
  }

  const openDialog = (kind: DialogKind) => {
    setRemarks('');
    setDialog(kind);
  };

  if (error) return <ErrorBlock message={error} onRetry={query.reload} />;
  if (!detail || !claim || !abilities) return <LoadingBlock />;

  const own = claim.employeeId === data?.user.id;
  const backHref = own ? '/driver-management/my-claims' : abilities.pay ? '/driver-management/payments' : abilities.decide ? '/driver-management/approvals' : data?.access.viewAll ? '/driver-management/claims' : '/driver-management/approvals';
  const approvedChanged = claim.totals.approvedAmount !== claim.totals.claimedAmount;

  const columns: ListColumn<TripRecord>[] = [
    {
      header: 'Trip',
      mobile: 'title',
      cell: (trip) => (
        <div className="min-w-0 max-w-[20rem]">
          <p className="truncate font-medium text-slate-800">
            {trip.fromPlace} → {trip.toPlace}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {shortDate(trip.tripDate)} · {trip.purpose}
          </p>
          {trip.projectName && <p className="truncate text-[11px] text-muted-foreground">{trip.projectName}</p>}
          {trip.notes && <p className="truncate text-[11px] italic text-slate-500" title={trip.notes}>“{trip.notes}”</p>}
        </div>
      ),
    },
    { header: 'Vehicle', cell: (trip) => <VehicleLabel ownership={trip.ownership} vehicleNumber={trip.vehicleNumber} vehicleType={trip.vehicleType} /> },
    {
      header: 'Odometer',
      cell: (trip) => (trip.startOdometer !== null && trip.endOdometer !== null ? <span className="whitespace-nowrap tabular-nums text-xs">{trip.startOdometer.toLocaleString('en-IN')} – {trip.endOdometer.toLocaleString('en-IN')}</span> : <span className="text-xs text-muted-foreground">Typed in</span>),
    },
    { header: 'Distance', align: 'right', cell: (trip) => <Km value={trip.distanceKm} /> },
    {
      header: 'Claimed',
      align: 'right',
      cell: (trip) => (
        <span className="inline-flex flex-col items-end">
          <Money value={trip.totalAmount} className="font-medium" />
          <span className="whitespace-nowrap text-[11px] text-muted-foreground">
            {trip.ratePerKm !== null ? `₹${trip.ratePerKm}/km` : 'no rate'}
            {trip.tollAmount + trip.parkingAmount > 0 ? ` + ${formatINR(trip.tollAmount + trip.parkingAmount)}` : ''}
          </span>
        </span>
      ),
    },
    {
      header: 'Checks',
      cell: (trip) =>
        trip.flags.length || trip.decision ? (
          <div className="flex max-w-[16rem] flex-col gap-1">
            <FlagChips flags={trip.flags} />
            {trip.decision && trip.decision.decision !== 'approve' && (
              <span className={cn('text-[11px]', trip.decision.decision === 'reject' ? 'text-rose-700' : 'text-amber-700')} title={trip.decision.remarks}>
                {trip.decision.decision === 'reject' ? 'Rejected' : `Cut to ${formatKm(trip.decision.approvedKm)}`} at {trip.decision.stageName} by {trip.decision.byName}
                {trip.decision.remarks ? `: ${trip.decision.remarks}` : ''}
              </span>
            )}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      header: 'Approved',
      align: 'right',
      cell: (trip) => {
        const decision = deciding ? preview?.decided.get(trip.id) : trip.decision;
        if (deciding && draftOf(trip).decision === 'return') return <span className="text-xs text-amber-700">Sent back</span>;
        if (!decision) return deciding ? <Money value={trip.totalAmount} /> : <span className="text-xs text-muted-foreground">—</span>;
        return <Money value={decision.approvedAmount} className={cn('font-medium', decision.decision === 'reject' && 'text-rose-700 line-through')} />;
      },
    },
  ];

  if (deciding) {
    columns.push({
      header: 'Decision',
      mobile: 'footer',
      cell: (trip) => {
        if (trip.status === 'rejected' || trip.decision?.decision === 'reject') return <span className="text-xs text-rose-700">Rejected earlier</span>;
        const draft = draftOf(trip);
        const allowedKm = trip.decision ? trip.decision.approvedKm : trip.distanceKm;
        return (
          <div className="flex w-full min-w-[12rem] flex-col gap-1.5">
            <Select value={draft.decision} onValueChange={(value) => setDraft(trip.id, { decision: value as LineDecision })}>
              <SelectTrigger className={cn('h-9 bg-white text-left text-xs', draft.decision === 'reject' && 'border-rose-300 text-rose-700', draft.decision === 'adjust' && 'border-amber-300', draft.decision === 'return' && 'border-amber-300')} aria-label="Decision">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(DECISION_LABELS) as LineDecision[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {DECISION_LABELS[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {draft.decision === 'adjust' && (
              <Input type="number" inputMode="decimal" step="0.1" min="0" max={allowedKm} value={draft.approvedKm} onChange={(event) => setDraft(trip.id, { approvedKm: event.target.value })} placeholder={`Allowed km (below ${allowedKm})`} className="h-9 bg-white text-xs" aria-label="Allowed distance in km" />
            )}
            {draft.decision !== 'approve' && (
              <Input value={draft.remarks} onChange={(event) => setDraft(trip.id, { remarks: event.target.value })} maxLength={300} placeholder={draft.decision === 'return' ? 'What should be corrected?' : 'Reason'} className="h-9 bg-white text-xs" aria-label="Reason" />
            )}
          </div>
        );
      },
    });
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={claim.claimNumber}
        icon={ReceiptText}
        backHref={backHref}
        badge={<ClaimStatusBadge status={claim.status} />}
        description={`${claim.employeeName} · ${shortDate(claim.periodFrom)}${claim.periodTo !== claim.periodFrom ? ` – ${shortDate(claim.periodTo)}` : ''}`}
        meta={[
          { label: 'Trips', value: `${claim.totals.tripCount} · ${formatKm(claim.totals.distanceKm)}` },
          { label: 'Claimed', value: <Money value={claim.totals.claimedAmount} /> },
          ...(approvedChanged || claim.status === 'approved' || claim.status === 'paid' ? [{ label: 'Approved', value: <Money value={claim.totals.approvedAmount} /> }] : []),
          { label: 'Submitted', value: shortDate(claim.submittedAt) },
          ...(claim.projectName ? [{ label: 'Project', value: claim.projectName }] : []),
          ...(claim.departmentName ? [{ label: 'Department', value: claim.departmentName }] : []),
        ]}
        actions={
          <>
            {abilities.withdraw && (
              <Button type="button" variant="outline" onClick={() => openDialog('withdraw')}>
                <RotateCcw className="mr-2 h-4 w-4" aria-hidden />
                Withdraw
              </Button>
            )}
            {(abilities.decide || abilities.pay) && (
              <>
                <Button type="button" variant="outline" onClick={() => openDialog('return')}>
                  <Undo2 className="mr-2 h-4 w-4" aria-hidden />
                  Send back
                </Button>
                <Button type="button" variant="outline" className="text-rose-600 hover:text-rose-700" onClick={() => openDialog('reject')}>
                  <XCircle className="mr-2 h-4 w-4" aria-hidden />
                  Reject
                </Button>
              </>
            )}
            {abilities.decide && (
              <Button type="button" className={VM_PRIMARY_BUTTON} disabled={Boolean(preview?.error)} onClick={() => openDialog('approve')}>
                <CircleCheck className="mr-2 h-4 w-4" aria-hidden />
                Approve {preview?.totals ? formatINR(preview.totals.approvedAmount) : ''}
              </Button>
            )}
            {abilities.pay && (
              <Button type="button" className={VM_PRIMARY_BUTTON} onClick={() => setDialog('pay')}>
                <Banknote className="mr-2 h-4 w-4" aria-hidden />
                Mark as paid
              </Button>
            )}
          </>
        }
      />

      {abilities.viaOverride && (abilities.decide || abilities.pay) && (
        <p className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-xs text-violet-900">
          You are not assigned to {stage?.name}. Acting here uses your Override Workflow permission and is recorded as an override.
        </p>
      )}
      {deciding && preview?.error && <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">{preview.error}</p>}
      {claim.remarks && (
        <p className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700">
          <span className="font-medium">Note from {claim.employeeName}:</span> {claim.remarks}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          <DataList rows={trips} columns={columns} dense rowClassName={(trip) => (trip.decision?.decision === 'reject' || trip.status === 'rejected' ? 'opacity-70' : undefined)} empty={<p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No trips remain on this claim.</p>} />

          {detail.returnedTrips.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Sent back from this claim</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {detail.returnedTrips.map((trip) => (
                  <div key={trip.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-700">
                        {trip.fromPlace} → {trip.toPlace} · {shortDate(trip.tripDate)}
                      </p>
                      {trip.returnNote?.claimNumber === claim.claimNumber && <p className="text-xs text-amber-700">{trip.returnNote.remarks}</p>}
                    </div>
                    <span className="text-xs text-muted-foreground">{trip.claimNumber ? `Now on ${trip.claimNumber}` : trip.status === 'draft' ? 'With the employee' : ''}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Progress</CardTitle>
            </CardHeader>
            <CardContent>
              <StageTrail claim={claim} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Amounts</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Distance claimed</dt><dd><Km value={claim.totals.distanceKm} /></dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Toll &amp; parking</dt><dd><Money value={claim.totals.tollParking} /></dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Claimed</dt><dd className="font-medium"><Money value={claim.totals.claimedAmount} /></dd></div>
                {deciding && preview?.totals ? (
                  <div className="flex justify-between gap-2 border-t pt-1.5"><dt className="text-muted-foreground">Approving now</dt><dd className="font-semibold text-emerald-700"><Money value={preview.totals.approvedAmount} /></dd></div>
                ) : (
                  <div className="flex justify-between gap-2 border-t pt-1.5"><dt className="text-muted-foreground">Approved</dt><dd className="font-semibold"><Money value={claim.totals.approvedAmount} /> · <Km value={claim.totals.approvedKm} /></dd></div>
                )}
              </dl>
              {claim.payment && (
                <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-900">
                  <p className="font-semibold">Paid <Money value={claim.payment.amount} /> on {shortDate(claim.payment.paidOn)}</p>
                  <p>{claim.payment.mode}{claim.payment.reference ? ` · ${claim.payment.reference}` : ''} · by {claim.payment.byName}</p>
                  {claim.payment.remarks && <p className="mt-0.5">{claim.payment.remarks}</p>}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">History</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3">
                {[...claim.history].reverse().map((entry, index) => {
                  const Icon = HISTORY_ICONS[entry.action] ?? Send;
                  return (
                    <li key={`${entry.at}-${index}`} className="flex gap-2.5 text-sm">
                      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', entry.action === 'rejected' ? 'text-rose-600' : entry.action === 'returned' ? 'text-amber-600' : entry.action === 'paid' || entry.action === 'approved' ? 'text-emerald-600' : 'text-slate-400')} />
                      <div className="min-w-0">
                        <p className="text-slate-800">
                          <span className="font-medium">{HISTORY_LABELS[entry.action]}</span>
                          {entry.action !== 'submitted' && entry.stageName ? ` · ${entry.stageName}` : ''}
                          {entry.amount !== undefined && entry.action !== 'rerouted' ? <> · <Money value={entry.amount} /></> : null}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {entry.byName}
                          {entry.override ? ' (override)' : ''} · {new Date(entry.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                        </p>
                        {entry.lineSummary && <p className="text-xs text-amber-700">{entry.lineSummary}</p>}
                        {entry.remarks && <p className="mt-0.5 break-words text-xs text-slate-600">{entry.remarks}</p>}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>

      <FormDialog
        open={dialog === 'approve'}
        onOpenChange={(open) => !open && setDialog(null)}
        size="md"
        title={`Approve ${claim.claimNumber}`}
        description={nextStage ? `It goes next to ${nextStage.name}${nextStage.assigneeNames.length ? ` (${nextStage.assigneeNames.join(', ')})` : ''}.` : undefined}
        onSubmit={() => act({ action: 'approve', decisions: inputs, remarks }, `${claim.claimNumber} approved`)}
        submitting={busy}
        submitLabel={`Approve ${preview?.totals ? formatINR(preview.totals.approvedAmount) : ''}`}
        submitDisabled={Boolean(preview?.error)}
      >
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <p>
            Approving <span className="font-semibold">{preview?.totals ? formatINR(preview.totals.approvedAmount) : '—'}</span> of {formatINR(claim.totals.claimedAmount)} claimed.
          </p>
          {preview?.summary && <p className="mt-0.5 text-xs">Changes: {preview.summary}.</p>}
        </div>
        <Textarea value={remarks} onChange={(event) => setRemarks(event.target.value)} rows={2} maxLength={500} placeholder="Remarks (optional)" className="bg-white" aria-label="Remarks" />
      </FormDialog>

      <FormDialog
        open={dialog === 'return' || dialog === 'reject' || dialog === 'withdraw'}
        onOpenChange={(open) => !open && setDialog(null)}
        size="md"
        title={dialog === 'reject' ? `Reject ${claim.claimNumber}?` : dialog === 'withdraw' ? `Withdraw ${claim.claimNumber}?` : `Send ${claim.claimNumber} back?`}
        description={
          dialog === 'reject'
            ? 'Every trip still on the claim is rejected for good. Use “Send back” instead if the employee can fix it.'
            : dialog === 'withdraw'
              ? 'The trips go back to My Trips as unclaimed, to change and submit again.'
              : 'The trips go back to the employee as unclaimed, with your note, to correct and submit on a new claim.'
        }
        onSubmit={() => act({ action: dialog, remarks }, dialog === 'reject' ? `${claim.claimNumber} rejected` : dialog === 'withdraw' ? `${claim.claimNumber} withdrawn` : `${claim.claimNumber} sent back`)}
        submitting={busy}
        submitDisabled={dialog !== 'withdraw' && remarks.trim().length < 3}
        submitLabel={dialog === 'reject' ? 'Reject claim' : dialog === 'withdraw' ? 'Withdraw claim' : 'Send back'}
      >
        <Textarea value={remarks} onChange={(event) => setRemarks(event.target.value)} rows={3} maxLength={500} placeholder={dialog === 'reject' ? 'Why is it rejected?' : dialog === 'withdraw' ? 'Reason (optional)' : 'What should the employee correct?'} className="bg-white" aria-label="Remarks" />
      </FormDialog>

      {data && (
        <PayDialog
          open={dialog === 'pay'}
          onOpenChange={(open) => !open && setDialog(null)}
          claims={[{ id: claim.id, claimNumber: claim.claimNumber, employeeName: claim.employeeName, amount: claim.totals.approvedAmount }]}
          today={data.today}
          onPaid={() => {
            query.reload();
            reloadBootstrap();
          }}
        />
      )}
    </div>
  );
}
