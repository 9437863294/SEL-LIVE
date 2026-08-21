'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { doc, onSnapshot } from 'firebase/firestore';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  Lock,
  PlaneLanding,
  ReceiptIndianRupee,
  Undo2,
  Wallet,
  XCircle,
} from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  TT_COLLECTIONS,
  roundMoney,
  type TravelAdvance,
  type TravelClaim,
  type TravelRequest,
} from '@/lib/tour-travel';
import {
  TravelControlError,
  actOnTravelRequest,
  cancelTravelRequest,
  closeTour,
  createClaimFromTour,
  evaluateTourClosureState,
  markTravelCompleted,
  requestTravelAdvance,
  submitTravelRequest,
  type TourApprovalAction,
} from '@/lib/tour-travel-service';
import { TT_PERMISSION_MODULE } from './module-layout-shell';
import { useTravelActor, useTravelCollection, useTravelConfig } from './use-travel-config';
import {
  Money,
  TravelField,
  TravelLoader,
  TravelPageHeader,
  TravelSection,
  TravelStatusBadge,
  TravelDataList,
  travelDialog,
} from './travel-ui';

/**
 * Tour detail and action surface.
 *
 * This is where a tour actually moves, so every transition the service layer exposes is reachable
 * from here and each button is gated on the *same* condition the service enforces — the UI hides
 * what would be refused rather than letting a user discover the rule from an error toast. The
 * service still re-checks everything, because the mobile client and a stale tab can both get here.
 *
 * The approval panel deliberately shows the estimate, the entitlement and the outstanding-advance
 * position alongside the decision buttons (spec section 10). An approver looking at "Approve /
 * Reject" with no policy context is the failure mode this module exists to fix.
 */
export default function TourRequestDetail({ requestId }: { requestId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { user, users } = useAuth();
  const { can } = useAuthorization();
  const actor = useTravelActor();
  const config = useTravelConfig();

  const [request, setRequest] = useState<TravelRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [closureBlockers, setClosureBlockers] = useState<string[]>([]);

  const { records: advances } = useTravelCollection<TravelAdvance>(TT_COLLECTIONS.advances, { field: 'travelRequestId', value: requestId });
  const { records: claims } = useTravelCollection<TravelClaim>(TT_COLLECTIONS.claims, { field: 'travelRequestId', value: requestId });

  // Approval dialog
  const [approvalAction, setApprovalAction] = useState<TourApprovalAction | null>(null);
  const [approvalRemarks, setApprovalRemarks] = useState('');
  const [modifiedAmount, setModifiedAmount] = useState<number | ''>('');

  // Advance dialog
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [advanceAmount, setAdvanceAmount] = useState<number | ''>('');
  const [advanceReason, setAdvanceReason] = useState('');
  const [advanceOverride, setAdvanceOverride] = useState('');

  // Cancellation dialog
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [ticketCharge, setTicketCharge] = useState<number | ''>('');
  const [hotelCharge, setHotelCharge] = useState<number | ''>('');
  const [refundExpected, setRefundExpected] = useState<number | ''>('');

  useEffect(() => {
    const stop = onSnapshot(
      doc(db, TT_COLLECTIONS.requests, requestId),
      snapshot => {
        setRequest(snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as TravelRequest) : null);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return stop;
  }, [requestId]);

  const claim = claims[0];
  const isTraveller = request?.employeeUserId === user?.id;
  const isCurrentApprover = !!request && (request.currentApprovers || []).includes(user?.id || '');
  const currentStage = request?.approvalStages?.[request.currentStageIndex || 0];

  const entitlement = useMemo(() => {
    if (!request) return undefined;
    const destination = request.itinerary?.[request.itinerary.length - 1]?.toCity || '';
    return config.entitlementFor(request.grade, destination);
  }, [request, config]);

  const advanceTotals = useMemo(() => {
    const open = advances.filter(advance => !['REJECTED', 'CANCELLED'].includes(advance.status));
    return {
      approved: roundMoney(open.reduce((sum, advance) => sum + Number(advance.approvedAmount || 0), 0)),
      paid: roundMoney(open.reduce((sum, advance) => sum + Number(advance.paidAmount || 0), 0)),
      outstanding: roundMoney(open.reduce((sum, advance) => sum + Math.max(0, Number(advance.paidAmount || 0) - Number(advance.settledAmount || 0)), 0)),
    };
  }, [advances]);

  const userName = (id?: string) => users.find(entry => entry.id === id)?.name || '—';

  const run = useCallback(
    async (key: string, action: () => Promise<void>, successTitle: string) => {
      if (!actor) {
        toast({ variant: 'destructive', title: 'Not signed in' });
        return;
      }
      setBusy(key);
      try {
        await action();
        toast({ title: successTitle });
      } catch (error) {
        toast({
          variant: 'destructive',
          title: 'Action failed',
          description: error instanceof TravelControlError ? error.message : 'Something went wrong. Please try again.',
        });
      } finally {
        setBusy(null);
      }
    },
    [actor, toast],
  );

  /**
   * Role members for role-based approval stages. Resolved from the loaded user list rather than a
   * query, because the AuthProvider already holds every user and their role.
   */
  const roleMembers = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const entry of users) {
      if (!entry.role) continue;
      map[entry.role] = [...(map[entry.role] || []), entry.id];
    }
    return map;
  }, [users]);

  const handleSubmit = () =>
    run('submit', async () => {
      await submitTravelRequest(requestId, actor!, { roleMembers });
    }, 'Tour submitted for approval');

  // The form redirects here with ?submit=1 after "Save & Submit", so the chain is resolved against
  // the saved document rather than the in-memory form state.
  useEffect(() => {
    if (searchParams?.get('submit') !== '1' || !request || !actor || busy) return;
    if (request.status !== 'DRAFT') return;
    void run('submit', async () => {
      await submitTravelRequest(requestId, actor, { roleMembers });
      router.replace(`/tour-travel/requests/${requestId}`);
    }, 'Tour submitted for approval');
  }, [searchParams, request, actor, busy, requestId, roleMembers, run, router]);

  const handleApproval = () =>
    run('approve', async () => {
      await actOnTravelRequest(requestId, approvalAction!, actor!, {
        remarks: approvalRemarks,
        modifiedAmount: modifiedAmount === '' ? null : Number(modifiedAmount),
        roleMembers,
      });
      setApprovalAction(null);
      setApprovalRemarks('');
      setModifiedAmount('');
    }, 'Decision recorded');

  const handleAdvance = () =>
    run('advance', async () => {
      await requestTravelAdvance(
        {
          travelRequestId: requestId,
          requestedAmount: Number(advanceAmount || 0),
          requestReason: advanceReason,
          overrideReason: advanceOverride,
        },
        actor!,
      );
      setAdvanceOpen(false);
      setAdvanceAmount('');
      setAdvanceReason('');
      setAdvanceOverride('');
    }, 'Advance requested');

  const handleCreateClaim = () =>
    run('claim', async () => {
      const result = await createClaimFromTour(requestId, actor!);
      router.push(`/tour-travel/claims/${result.id}`);
    }, 'Claim created');

  const handleClose = () =>
    run('close', async () => {
      try {
        await closeTour(requestId, actor!);
        setClosureBlockers([]);
      } catch (error) {
        // Surface the whole checklist inline rather than as a one-line toast.
        const state = await evaluateTourClosureState(requestId);
        setClosureBlockers(state.readiness.blockers);
        throw error;
      }
    }, 'Tour closed');

  if (loading) return <TravelLoader label="Loading tour…" />;
  if (!request) {
    return (
      <TravelSection title="Tour not found">
        <p className="text-sm text-muted-foreground">This tour request does not exist or has been removed.</p>
      </TravelSection>
    );
  }

  const canApprove = can('Approve', `${TT_PERMISSION_MODULE}.Approvals`);
  const showSubmit = request.status === 'DRAFT' && (isTraveller || request.createdBy === user?.id || can('Submit', `${TT_PERMISSION_MODULE}.Tour Requests`));
  const showApprovalPanel = request.status === 'UNDER_APPROVAL' && isCurrentApprover && canApprove;
  const showPostFacto = !!request.postFactoApprovalRequired && request.isEmergency;
  const showAdvance =
    request.advanceRequired &&
    ['APPROVED', 'TRAVEL_SCHEDULED', 'IN_PROGRESS'].includes(request.status) &&
    advances.length === 0 &&
    (isTraveller || can('Request', `${TT_PERMISSION_MODULE}.Advances`));
  const showComplete = ['APPROVED', 'TRAVEL_SCHEDULED', 'IN_PROGRESS'].includes(request.status) && (isTraveller || can('Mark Complete', `${TT_PERMISSION_MODULE}.Tour Requests`));
  const showCreateClaim = ['COMPLETED', 'CLAIM_PENDING'].includes(request.status) && !request.claimId && (isTraveller || can('Add', `${TT_PERMISSION_MODULE}.Claims`));
  const showClose = request.status === 'SETTLEMENT_PENDING' && can('Close Tour', `${TT_PERMISSION_MODULE}.Tour Requests`);
  const showCancel = !['CLOSED', 'CANCELLED'].includes(request.status) && can('Cancel', `${TT_PERMISSION_MODULE}.Tour Requests`);

  return (
    <div className="space-y-4">
      <TravelPageHeader
        title={request.referenceNumber}
        description={`${request.tourType} · ${request.employeeName} · ${request.departureDate} → ${request.returnDate}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <TravelStatusBadge status={request.status} />
            {request.status === 'CLOSED' && (
              <Badge variant="outline" className="gap-1 border-slate-300 text-slate-600">
                <Lock className="h-3 w-3" /> Locked
              </Badge>
            )}
          </div>
        }
      />

      {showPostFacto && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">Post-facto approval required</p>
            <p className="text-xs">This emergency tour was allowed to proceed before approval. {request.emergencyReason}</p>
          </div>
        </div>
      )}

      {closureBlockers.length > 0 && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">
          <p className="font-semibold">This tour cannot be closed yet</p>
          <ul className="mt-1 list-inside list-disc text-xs">
            {closureBlockers.map(blocker => <li key={blocker}>{blocker}</li>)}
          </ul>
        </div>
      )}

      {/* ── Action bar ───────────────────────────────────────────────────────────────────────── */}
      {(showSubmit || showAdvance || showComplete || showCreateClaim || showClose || showCancel) && (
        <div className="flex flex-wrap gap-2 rounded-lg border border-white/60 bg-white/80 p-3 backdrop-blur-sm">
          {showSubmit && (
            <Button onClick={handleSubmit} disabled={busy === 'submit'} className="gap-2 bg-gradient-to-r from-sky-500 to-cyan-600">
              {busy === 'submit' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />} Submit for Approval
            </Button>
          )}
          {showAdvance && (
            <Button variant="outline" onClick={() => { setAdvanceAmount(request.advanceRequestedAmount || ''); setAdvanceOpen(true); }} className="gap-2">
              <Wallet className="h-4 w-4" /> Request Advance
            </Button>
          )}
          {showComplete && (
            <Button variant="outline" onClick={() => run('complete', () => markTravelCompleted(requestId, actor!), 'Travel marked complete')} disabled={busy === 'complete'} className="gap-2">
              {busy === 'complete' ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlaneLanding className="h-4 w-4" />} Mark Travel Complete
            </Button>
          )}
          {showCreateClaim && (
            <Button onClick={handleCreateClaim} disabled={busy === 'claim'} className="gap-2 bg-gradient-to-r from-emerald-500 to-teal-600">
              {busy === 'claim' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ReceiptIndianRupee className="h-4 w-4" />} Create Expense Claim
            </Button>
          )}
          {request.claimId && (
            <Button asChild variant="outline" className="gap-2">
              <Link href={`/tour-travel/claims/${request.claimId}`}>
                <ReceiptIndianRupee className="h-4 w-4" /> View Claim
              </Link>
            </Button>
          )}
          {showClose && (
            <Button variant="outline" onClick={handleClose} disabled={busy === 'close'} className="gap-2">
              {busy === 'close' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />} Close Tour
            </Button>
          )}
          {showCancel && (
            <Button variant="ghost" onClick={() => setCancelOpen(true)} className="gap-2 text-rose-600">
              <XCircle className="h-4 w-4" /> Cancel Tour
            </Button>
          )}
        </div>
      )}

      {/* ── Approval panel ───────────────────────────────────────────────────────────────────── */}
      {showApprovalPanel && (
        <TravelSection
          title={`Your decision — ${currentStage?.name || 'Approval'}`}
          description="Review the policy position before deciding."
          className="border-amber-200 bg-amber-50/40"
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <TravelField label="Estimated Cost"><Money value={request.estimate?.total || 0} /></TravelField>
            <TravelField label="Advance Requested"><Money value={request.advanceRequestedAmount || 0} /></TravelField>
            <TravelField label="Duration">{request.durationDays} day(s)</TravelField>
            <TravelField label="Hotel Entitlement">
              {entitlement ? <Money value={entitlement.hotelLimitPerNight} /> : <span className="text-amber-700">Not configured</span>}
            </TravelField>
          </div>

          {(request.policyExceptions?.length || 0) > 0 && (
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Policy exceptions</p>
              <ul className="mt-1 space-y-1 text-sm text-amber-900">
                {request.policyExceptions!.map((exception, index) => (
                  <li key={index} className="flex flex-wrap items-baseline justify-between gap-2">
                    <span>{exception.category}</span>
                    {exception.excess > 0 && <span className="font-medium"><Money value={exception.excess} /> above entitlement</span>}
                  </li>
                ))}
              </ul>
              {request.policyExceptions![0]?.reason && (
                <p className="mt-2 text-xs italic text-amber-800">Reason: {request.policyExceptions![0].reason}</p>
              )}
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" className="gap-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => setApprovalAction('Approve')}>
              <CheckCircle2 className="h-4 w-4" /> Approve
            </Button>
            <Button size="sm" variant="outline" onClick={() => setApprovalAction('Approve with Modification')}>Approve with Modification</Button>
            <Button size="sm" variant="outline" onClick={() => setApprovalAction('Send Back')}>Send Back</Button>
            <Button size="sm" variant="outline" onClick={() => setApprovalAction('Request Clarification')}>Request Clarification</Button>
            <Button size="sm" variant="outline" className="text-rose-600" onClick={() => setApprovalAction('Reject')}>
              <XCircle className="mr-1 h-4 w-4" /> Reject
            </Button>
          </div>
        </TravelSection>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <TravelSection title="Tour Details" className="lg:col-span-2">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <TravelField label="Employee">{request.employeeName}</TravelField>
            <TravelField label="Employee ID">{request.employeeCode}</TravelField>
            <TravelField label="Designation">{request.designation}</TravelField>
            <TravelField label="Travel Grade">{request.grade}</TravelField>
            <TravelField label="Department">{request.departmentName}</TravelField>
            <TravelField label="Cost Centre">{request.costCentre}</TravelField>
            <TravelField label="Tour Type">{request.tourType}</TravelField>
            <TravelField label="Project">{request.projectName}</TravelField>
            <TravelField label="Client">{request.clientName}</TravelField>
            <TravelField label="Reporting Manager">{userName(request.reportingManagerId)}</TravelField>
            <TravelField label="HOD">{userName(request.hodId)}</TravelField>
            <TravelField label="Raised By">{request.createdByName}</TravelField>
            <TravelField label="Purpose" className="col-span-2 sm:col-span-3">{request.purpose}</TravelField>
          </div>
        </TravelSection>

        <TravelSection title="Financial Position">
          <dl className="space-y-2 text-sm">
            <Row label="Approved estimate" value={request.approvedAmount ?? request.estimate?.total ?? 0} />
            {request.approvedAmount != null && request.approvedAmount !== request.estimate?.total && (
              <p className="text-[11px] text-amber-700">Approved at a modified amount; the original estimate was {request.estimate?.total}.</p>
            )}
            <Row label="Advance approved" value={advanceTotals.approved} />
            <Row label="Advance paid" value={advanceTotals.paid} />
            <Row label="Advance outstanding" value={advanceTotals.outstanding} emphasis />
            {claim && (
              <>
                <div className="border-t border-slate-100 pt-2" />
                <Row label="Claim submitted" value={claim.totalClaimed} />
                <Row label="Claim approved" value={claim.totalApproved} />
                <Row label={claim.netRecoverable > 0 ? 'Recoverable' : 'Payable to employee'} value={claim.netRecoverable > 0 ? claim.netRecoverable : claim.netPayable} emphasis />
              </>
            )}
          </dl>
        </TravelSection>
      </div>

      <TravelSection title="Journey Itinerary">
        <TravelDataList
          rows={request.itinerary || []}
          columns={[
            {
              header: 'Journey',
              mobile: 'title',
              cell: leg => (
                <>
                  {leg.fromCity || '—'} → {leg.toCity || '—'}
                  <span className="ml-1.5 text-xs font-normal tabular-nums text-muted-foreground">{leg.date}</span>
                </>
              ),
            },
            {
              header: 'Est. cost',
              align: 'right',
              mobile: 'aside',
              cell: leg => <span className="font-semibold"><Money value={leg.estimatedCost || 0} /></span>,
            },
            { header: 'Date', className: 'hidden lg:table-cell', mobile: 'omit', cell: leg => <span className="tabular-nums">{leg.date}</span> },
            { header: 'From', className: 'hidden sm:table-cell', mobile: 'omit', cell: leg => leg.fromCity },
            { header: 'To', className: 'hidden sm:table-cell', mobile: 'omit', cell: leg => leg.toCity },
            { header: 'Mode', cell: leg => leg.mode },
            { header: 'Class', cell: leg => leg.travelClass || '—' },
            { header: 'Departure', cell: leg => leg.departureTime || '—' },
          ]}
        />
      </TravelSection>

      {(request.accommodation?.length || 0) > 0 && (
        <TravelSection title="Accommodation Plan">
          <TravelDataList
            rows={request.accommodation!}
            columns={[
              {
                header: 'City',
                mobile: 'title',
                cell: stay => (
                  <>
                    {stay.city || '—'}
                    {stay.cityClass && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{stay.cityClass}</span>}
                  </>
                ),
              },
              {
                header: 'Tariff / night',
                align: 'right',
                mobile: 'aside',
                cell: stay => <span className="font-semibold"><Money value={stay.estimatedTariffPerNight || 0} /></span>,
              },
              { header: 'Class', className: 'hidden lg:table-cell', mobile: 'omit', cell: stay => stay.cityClass },
              { header: 'Check-in', cell: stay => <span className="tabular-nums">{stay.checkIn}</span> },
              { header: 'Check-out', cell: stay => <span className="tabular-nums">{stay.checkOut}</span> },
              { header: 'Nights', cell: stay => <span className="tabular-nums">{stay.nights}</span> },
              { header: 'Arranged by', cell: stay => stay.arrangement },
            ]}
          />
        </TravelSection>
      )}

      <TravelSection title="Approval Trail" description="Every decision is appended, never overwritten.">
        {(request.approvalHistory?.length || 0) === 0 ? (
          <p className="py-3 text-center text-sm text-muted-foreground">
            {request.status === 'DRAFT' ? 'Not yet submitted for approval.' : 'No decisions recorded yet.'}
          </p>
        ) : (
          <ol className="space-y-2">
            {request.approvalHistory!.map((entry, index) => (
              <li key={index} className="flex items-start gap-3 rounded-lg border border-slate-100 px-3 py-2">
                <span
                  className={
                    entry.action === 'Reject'
                      ? 'mt-1 h-2 w-2 shrink-0 rounded-full bg-rose-500'
                      : entry.action === 'Send Back'
                        ? 'mt-1 h-2 w-2 shrink-0 rounded-full bg-amber-500'
                        : 'mt-1 h-2 w-2 shrink-0 rounded-full bg-emerald-500'
                  }
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800">
                    {entry.action} — {entry.stageName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {entry.userName}
                    {entry.modifiedAmount ? ` · modified to ${entry.modifiedAmount}` : ''}
                  </p>
                  {entry.remarks && <p className="mt-0.5 text-xs italic text-slate-600">{entry.remarks}</p>}
                </div>
              </li>
            ))}
          </ol>
        )}

        {(request.approvalStages?.length || 0) > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
            {request.approvalStages!.map((stage, index) => {
              const done = index < (request.currentStageIndex || 0) || ['APPROVED', 'CLOSED', 'SETTLEMENT_PENDING', 'COMPLETED'].includes(request.status);
              const active = index === (request.currentStageIndex || 0) && request.status === 'UNDER_APPROVAL';
              return (
                <Badge
                  key={stage.id}
                  variant="outline"
                  className={
                    active
                      ? 'border-amber-300 bg-amber-50 text-amber-800'
                      : done
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-slate-200 text-slate-500'
                  }
                >
                  {index + 1}. {stage.name}
                </Badge>
              );
            })}
          </div>
        )}
      </TravelSection>

      {advances.length > 0 && (
        <TravelSection
          title="Travel Advances"
          actions={
            <Button asChild variant="ghost" size="sm">
              <Link href="/tour-travel/advances">Open register</Link>
            </Button>
          }
        >
          <TravelDataList
            rows={advances}
            columns={[
              { header: 'Reference', mobile: 'title', cell: advance => <span className="font-medium">{advance.referenceNumber}</span> },
              { header: 'Status', mobile: 'aside', cell: advance => <TravelStatusBadge status={advance.status} /> },
              { header: 'Requested', align: 'right', cell: advance => <Money value={advance.requestedAmount} /> },
              { header: 'Approved', align: 'right', cell: advance => <Money value={advance.approvedAmount} /> },
              { header: 'Paid', align: 'right', cell: advance => <Money value={advance.paidAmount} /> },
              {
                header: 'Outstanding',
                align: 'right',
                cell: advance => (
                  <Money value={Math.max(0, roundMoney(advance.paidAmount - (advance.settledAmount || 0)))} />
                ),
              },
            ]}
          />
        </TravelSection>
      )}

      {/* ── Dialogs ──────────────────────────────────────────────────────────────────────────── */}
      <Dialog open={!!approvalAction} onOpenChange={open => !open && setApprovalAction(null)}>
        <DialogContent className={travelDialog.content}>
          <DialogHeader className={travelDialog.header}>
            <DialogTitle>{approvalAction}</DialogTitle>
            <DialogDescription>
              {request.referenceNumber} · {request.employeeName} · estimated {request.estimate?.total}
            </DialogDescription>
          </DialogHeader>
          <div className={travelDialog.body}>
            {approvalAction === 'Approve with Modification' && (
              <div>
                <Label className="text-xs">Approved amount</Label>
                <Input
                  type="number" inputMode="decimal"
                  min={0}
                  value={modifiedAmount}
                  onChange={event => setModifiedAmount(event.target.value === '' ? '' : Number(event.target.value))}
                  placeholder={String(request.estimate?.total || 0)}
                />
                <p className="mt-1 text-[11px] text-muted-foreground">The employee&apos;s original estimate is kept on the record.</p>
              </div>
            )}
            <div>
              <Label className="text-xs">
                Remarks {(approvalAction === 'Reject' || approvalAction === 'Send Back') && <span className="text-rose-600">*</span>}
              </Label>
              <Textarea value={approvalRemarks} onChange={event => setApprovalRemarks(event.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter className={travelDialog.footer}>
            <Button variant="outline" onClick={() => setApprovalAction(null)}>Cancel</Button>
            <Button onClick={handleApproval} disabled={busy === 'approve'}>
              {busy === 'approve' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={advanceOpen} onOpenChange={setAdvanceOpen}>
        <DialogContent className={travelDialog.content}>
          <DialogHeader className={travelDialog.header}>
            <DialogTitle>Request Travel Advance</DialogTitle>
            <DialogDescription>Against {request.referenceNumber} — estimated {request.estimate?.total}</DialogDescription>
          </DialogHeader>
          <div className={travelDialog.body}>
            <div>
              <Label className="text-xs">Advance amount</Label>
              <Input
                type="number" inputMode="decimal"
                min={0}
                max={request.estimate?.total}
                value={advanceAmount}
                onChange={event => setAdvanceAmount(event.target.value === '' ? '' : Number(event.target.value))}
              />
            </div>
            <div>
              <Label className="text-xs">Reason</Label>
              <Textarea value={advanceReason} onChange={event => setAdvanceReason(event.target.value)} rows={2} />
            </div>
            <div>
              <Label className="text-xs">Override reason (only if an old advance is outstanding)</Label>
              <Textarea value={advanceOverride} onChange={event => setAdvanceOverride(event.target.value)} rows={2} placeholder="Leave blank unless the system asks for it" />
            </div>
          </div>
          <DialogFooter className={travelDialog.footer}>
            <Button variant="outline" onClick={() => setAdvanceOpen(false)}>Cancel</Button>
            <Button onClick={handleAdvance} disabled={busy === 'advance'}>
              {busy === 'advance' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className={travelDialog.content}>
          <DialogHeader className={travelDialog.header}>
            <DialogTitle>Cancel Tour</DialogTitle>
            <DialogDescription>Cancellation charges and expected refunds are tracked on the record.</DialogDescription>
          </DialogHeader>
          <div className={travelDialog.body}>
            <div>
              <Label className="text-xs">Reason <span className="text-rose-600">*</span></Label>
              <Textarea value={cancelReason} onChange={event => setCancelReason(event.target.value)} rows={2} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-[11px]">Ticket charge</Label>
                <Input type="number" inputMode="decimal" min={0} value={ticketCharge} onChange={event => setTicketCharge(event.target.value === '' ? '' : Number(event.target.value))} />
              </div>
              <div>
                <Label className="text-[11px]">Hotel charge</Label>
                <Input type="number" inputMode="decimal" min={0} value={hotelCharge} onChange={event => setHotelCharge(event.target.value === '' ? '' : Number(event.target.value))} />
              </div>
              <div>
                <Label className="text-[11px]">Refund expected</Label>
                <Input type="number" inputMode="decimal" min={0} value={refundExpected} onChange={event => setRefundExpected(event.target.value === '' ? '' : Number(event.target.value))} />
              </div>
            </div>
          </div>
          <DialogFooter className={travelDialog.footer}>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>Keep tour</Button>
            <Button
              variant="destructive"
              disabled={busy === 'cancel'}
              onClick={() =>
                run('cancel', async () => {
                  await cancelTravelRequest(requestId, actor!, {
                    reason: cancelReason,
                    ticketCancellationCharge: Number(ticketCharge || 0),
                    hotelCancellationCharge: Number(hotelCharge || 0),
                    refundExpected: Number(refundExpected || 0),
                  });
                  setCancelOpen(false);
                }, 'Tour cancelled')
              }
            >
              {busy === 'cancel' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Undo2 className="mr-2 h-4 w-4" />} Cancel Tour
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, value, emphasis }: { label: string; value: number; emphasis?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={emphasis ? 'font-medium text-slate-800' : 'text-muted-foreground'}>{label}</dt>
      <dd className={emphasis ? 'font-semibold text-slate-900' : 'font-medium text-slate-700'}>
        <Money value={value} />
      </dd>
    </div>
  );
}
