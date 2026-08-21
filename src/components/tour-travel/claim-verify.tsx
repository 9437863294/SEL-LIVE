'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { doc, onSnapshot } from 'firebase/firestore';
import { AlertTriangle, CheckCircle2, FileWarning, Loader2, MinusCircle, ShieldCheck, XCircle } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  TT_COLLECTIONS,
  findDuplicateBills,
  roundMoney,
  summarizeSettlement,
  travelStatusLabel,
  type TravelClaim,
  type TravelClaimItem,
  type VerificationDecision,
} from '@/lib/tour-travel';
import {
  TravelControlError,
  approveClaimItemException,
  approveTravelClaim,
  completeManagerReview,
  loadClaimItems,
  rejectTravelClaim,
  returnClaimForCorrection,
  verifyClaimItem,
} from '@/lib/tour-travel-service';
import { TT_PERMISSION_MODULE } from './module-layout-shell';
import { useTravelActor } from './use-travel-config';
import { Money, TravelAccessDenied, TravelDataList, TravelLoader, TravelPageHeader, TravelSection, TravelStatusBadge, travelDialog } from './travel-ui';

const DECISION_LABEL: Record<VerificationDecision, string> = {
  PENDING: 'Pending',
  ACCEPTED: 'Accepted',
  REDUCED: 'Reduced',
  DISALLOWED: 'Disallowed',
  BILL_REQUESTED: 'Bill requested',
};

/**
 * Finance verification screen (spec section 22).
 *
 * The whole point of this view is the four-column truth: **Claimed | Policy | Allowed | Disallowed**,
 * side by side, for every line. `claimedAmount` is rendered from the stored value and is never
 * editable — a reduction is entered as the *allowed* figure, and the service writes it to
 * `approvedAmount`, leaving the employee's original number untouched (control rule 51.8).
 *
 * That is what makes the disallowed column meaningful: it is always
 * `claimed − allowed`, derived rather than typed, so it can't be made to disagree with either side.
 */
export default function ClaimVerify({ claimId }: { claimId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const { can } = useAuthorization();
  const actor = useTravelActor();

  const [claim, setClaim] = useState<TravelClaim | null>(null);
  const [items, setItems] = useState<TravelClaimItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const [editing, setEditing] = useState<TravelClaimItem | null>(null);
  const [decision, setDecision] = useState<VerificationDecision>('ACCEPTED');
  const [allowedAmount, setAllowedAmount] = useState<number | ''>('');
  const [remarks, setRemarks] = useState('');
  const [accountingHead, setAccountingHead] = useState('');

  const [returnOpen, setReturnOpen] = useState(false);
  const [returnRemarks, setReturnRemarks] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const canVerify = can('Verify', `${TT_PERMISSION_MODULE}.Claims`);
  const canApprove = can('Approve', `${TT_PERMISSION_MODULE}.Claims`);
  const canApproveException = can('Approve Exception', `${TT_PERMISSION_MODULE}.Claims`);

  const refreshItems = async () => setItems(await loadClaimItems(claimId));

  useEffect(() => {
    const stop = onSnapshot(
      doc(db, TT_COLLECTIONS.claims, claimId),
      snapshot => {
        setClaim(snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as TravelClaim) : null);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return stop;
  }, [claimId]);

  // Items are re-read whenever the claim document changes, because every verification also rewrites
  // the claim's denormalized totals — that write is the reliable signal that a line moved. The load
  // is inlined rather than calling `refreshItems` so the effect's dependencies are just the values
  // that should retrigger it.
  const claimTotalApproved = claim?.totalApproved;
  const claimItemCount = claim?.itemCount;
  const claimStatus = claim?.status;
  useEffect(() => {
    let cancelled = false;
    void loadClaimItems(claimId).then(loaded => {
      if (!cancelled) setItems(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [claimId, claimTotalApproved, claimItemCount, claimStatus]);

  /** Lines sharing a bill fingerprint or file hash, flagged for the verifier (spec section 17). */
  const duplicateIds = useMemo(() => {
    const groups = findDuplicateBills(
      items.map(item => ({
        id: item.id,
        vendor: item.vendor,
        invoiceNumber: item.billReference,
        invoiceDate: item.expenseDate,
        amount: item.claimedAmount,
        fileHash: item.fileHash,
      })),
    );
    return new Set(groups.flatMap(group => group.records.map(record => record.id)));
  }, [items]);

  const summary = useMemo(
    () => summarizeSettlement({ items, advancePaid: claim?.advancePaid || 0 }),
    [items, claim?.advancePaid],
  );

  const pendingCount = items.filter(item => item.decision === 'PENDING').length;
  const exceptionsNeedingApproval = items.filter(
    item => item.policyLimit != null && (item.approvedAmount ?? item.claimedAmount) > item.policyLimit && !item.exceptionApprovedBy,
  );

  const run = async (key: string, action: () => Promise<void>, successTitle: string) => {
    if (!actor) {
      toast({ variant: 'destructive', title: 'Not signed in' });
      return;
    }
    setBusy(key);
    try {
      await action();
      await refreshItems();
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
  };

  const openEditor = (item: TravelClaimItem) => {
    setEditing(item);
    // Default the allowed figure to what policy permits, so the common case (accept the policy
    // position) is one click rather than arithmetic the verifier has to redo.
    const suggested = item.policyLimit != null ? Math.min(item.claimedAmount, item.policyLimit) : item.claimedAmount;
    setDecision(suggested < item.claimedAmount ? 'REDUCED' : 'ACCEPTED');
    setAllowedAmount(suggested);
    setRemarks(item.verifierRemarks || '');
    setAccountingHead(item.accountingHead || '');
  };

  if (loading) return <TravelLoader label="Loading claim…" />;
  if (!claim) {
    return (
      <TravelSection title="Claim not found">
        <p className="text-sm text-muted-foreground">This claim does not exist or has been removed.</p>
      </TravelSection>
    );
  }
  if (!canVerify && !canApprove) return <TravelAccessDenied what="claim verification" />;

  const underVerification = ['SUBMITTED', 'MANAGER_REVIEW', 'FINANCE_REVIEW'].includes(claim.status);
  const locked = ['PAID', 'SETTLED'].includes(claim.status);

  return (
    <div className="space-y-4 pb-24">
      <TravelPageHeader
        title={`Verify ${claim.referenceNumber}`}
        description={`${claim.employeeName} · tour ${claim.travelRequestNumber} · ${claim.itemCount} line(s)`}
        actions={
          <div className="flex items-center gap-2">
            <TravelStatusBadge status={claim.status} />
            <Button asChild variant="outline" size="sm">
              <Link href={`/tour-travel/claims/${claimId}`}>Claim summary</Link>
            </Button>
          </div>
        }
      />

      {locked && (
        <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <p>This claim is {travelStatusLabel(claim.status).toLowerCase()} and financially locked. Lines can be reviewed but not changed.</p>
        </div>
      )}

      {!underVerification && !locked && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>This claim is {travelStatusLabel(claim.status).toLowerCase()} and is not currently under verification.</p>
        </div>
      )}

      <TravelSection
        title="Line Verification"
        description="The claimed amount is the employee's submission and is never overwritten — a reduction is recorded as a separate allowed figure."
      >
        <TravelDataList
          rows={items}
          rowClassName={item =>
            (item.policyLimit != null && item.claimedAmount > item.policyLimit) || duplicateIds.has(item.id)
              ? 'bg-amber-50/40 border-amber-200'
              : undefined
          }
          columns={[
            {
              header: 'Expense',
              mobile: 'title',
              cell: item => (
                <>
                  <p className="font-medium text-slate-800">
                    {item.category}
                    <span className="ml-1.5 text-xs font-normal tabular-nums text-muted-foreground">{item.expenseDate}</span>
                  </p>
                  {item.vendor && <p className="text-[11px] font-normal text-muted-foreground">{item.vendor}</p>}
                  {item.description && <p className="text-[11px] font-normal text-muted-foreground">{item.description}</p>}
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {item.paidByCompany && (
                      <Badge variant="outline" className="border-slate-300 text-[10px] text-slate-600">Company paid</Badge>
                    )}
                    {duplicateIds.has(item.id) && (
                      <Badge variant="outline" className="border-rose-300 bg-rose-50 text-[10px] text-rose-700">Possible duplicate</Badge>
                    )}
                    {(item.flags || []).map(flag => (
                      <Badge key={flag} variant="outline" className="border-amber-300 bg-amber-50 text-[10px] text-amber-800">{flag}</Badge>
                    ))}
                  </div>
                  {item.exceptionReason && (
                    <p className="mt-1 text-[11px] font-normal italic text-amber-800">
                      Exception: {item.exceptionReason}
                      {item.exceptionApprovedBy ? ` — approved by ${item.exceptionApprovedByName}` : ' — awaiting approval'}
                    </p>
                  )}
                </>
              ),
            },
            {
              header: 'Decision',
              mobile: 'aside',
              cell: item => (
                <>
                  <Badge
                    variant="outline"
                    className={
                      item.decision === 'ACCEPTED'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : item.decision === 'PENDING'
                          ? 'border-slate-200 text-slate-600'
                          : 'border-amber-300 bg-amber-50 text-amber-800'
                    }
                  >
                    {DECISION_LABEL[item.decision]}
                  </Badge>
                  {item.verifierRemarks && <p className="mt-0.5 max-w-[16rem] text-[11px] italic text-slate-600">{item.verifierRemarks}</p>}
                </>
              ),
            },
            { header: 'Date', className: 'hidden lg:table-cell', mobile: 'omit', cell: item => <span className="tabular-nums">{item.expenseDate}</span> },
            // Claimed is always rendered, never an input — see the component comment.
            {
              header: 'Claimed',
              align: 'right',
              cell: item => <span className="font-medium tabular-nums"><Money value={item.claimedAmount} exact /></span>,
            },
            {
              header: 'Policy',
              align: 'right',
              cell: item =>
                item.policyLimit == null ? <span className="text-muted-foreground">—</span> : <Money value={item.policyLimit} exact />,
            },
            {
              header: 'Allowed',
              align: 'right',
              cell: item =>
                item.approvedAmount == null ? <span className="text-muted-foreground">—</span> : <Money value={item.approvedAmount} exact />,
            },
            {
              header: 'Disallowed',
              align: 'right',
              cell: item =>
                item.disallowedAmount > 0 ? (
                  <span className="font-medium text-rose-600"><Money value={item.disallowedAmount} exact /></span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                ),
            },
            ...(underVerification && canVerify
              ? [
                  {
                    header: 'Action',
                    mobile: 'footer' as const,
                    cell: (item: TravelClaimItem) => (
                      <div className="flex flex-1 items-center gap-1.5">
                        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => openEditor(item)}>
                          Verify
                        </Button>
                        {item.policyLimit != null &&
                          item.claimedAmount > item.policyLimit &&
                          item.exceptionReason &&
                          !item.exceptionApprovedBy &&
                          canApproveException && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs text-emerald-700"
                              disabled={busy === `exception-${item.id}`}
                              onClick={() => run(`exception-${item.id}`, () => approveClaimItemException(item.id, actor!), 'Exception approved')}
                            >
                              Approve exception
                            </Button>
                          )}
                      </div>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </TravelSection>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TravelSection title="Settlement Statement" description="Derived live from the verified lines.">
          <dl className="space-y-1.5 text-sm">
            <Row label="Total claimed" value={summary.totalClaimed} />
            <Row label="Total approved" value={summary.totalApproved} />
            <Row label="Disallowed" value={summary.totalDisallowed} tone="rose" />
            <div className="border-t border-slate-100 pt-1.5" />
            <Row label="Less: company direct payment" value={summary.companyPaid} />
            <Row label="Less: advance paid" value={summary.advancePaid} />
            <div className="border-t-2 border-slate-200 pt-1.5" />
            {summary.outcome === 'Recoverable from employee' ? (
              <Row label="Recoverable from employee" value={summary.recoverableFromEmployee} emphasis tone="rose" />
            ) : (
              <Row label="Payable to employee" value={summary.payableToEmployee} emphasis tone="emerald" />
            )}
            <p className="pt-1 text-xs text-muted-foreground">Outcome: {summary.outcome}</p>
          </dl>

          <div className="mt-3 border-t border-slate-100 pt-3 text-sm">
            <Row label="Approved tour estimate" value={claim.approvedEstimate} />
            <Row
              label="Variance vs estimate"
              value={roundMoney(summary.totalApproved - claim.approvedEstimate)}
              tone={summary.totalApproved > claim.approvedEstimate ? 'rose' : 'emerald'}
            />
          </div>
        </TravelSection>

        <TravelSection title="Verification Progress">
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Lines verified</span>
              <span className="font-medium">{items.length - pendingCount} / {items.length}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${items.length ? Math.round(((items.length - pendingCount) / items.length) * 100) : 0}%` }}
              />
            </div>
            {pendingCount > 0 && <p className="text-xs text-amber-700">{pendingCount} line(s) still need a decision.</p>}
            {exceptionsNeedingApproval.length > 0 && (
              <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                {exceptionsNeedingApproval.length} line(s) exceed entitlement and need exception approval before this claim can be approved.
              </p>
            )}
            {duplicateIds.size > 0 && (
              <p className="rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs text-rose-700">
                {duplicateIds.size} line(s) look like duplicate bills. Review before approving.
              </p>
            )}
          </div>

          {underVerification && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
              {claim.status === 'MANAGER_REVIEW' && (
                <Button
                  size="sm"
                  className="gap-1"
                  disabled={busy === 'manager'}
                  onClick={() => run('manager', () => completeManagerReview(claimId, actor!), 'Sent to Finance')}
                >
                  {busy === 'manager' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Verify & send to Finance
                </Button>
              )}
              {canApprove && claim.status === 'FINANCE_REVIEW' && (
                <Button
                  size="sm"
                  className="gap-1 bg-emerald-600 hover:bg-emerald-700"
                  disabled={busy === 'approve' || pendingCount > 0 || exceptionsNeedingApproval.length > 0}
                  onClick={() =>
                    run('approve', async () => {
                      const result = await approveTravelClaim(claimId, actor!);
                      router.push(
                        result.paymentId ? '/tour-travel/payments' : result.recoveryId ? '/tour-travel/recoveries' : `/tour-travel/claims/${claimId}`,
                      );
                    }, 'Claim approved')
                  }
                >
                  {busy === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Approve claim
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setReturnOpen(true)}>Return for correction</Button>
              <Button size="sm" variant="outline" className="text-rose-600" onClick={() => setRejectOpen(true)}>Reject</Button>
            </div>
          )}
        </TravelSection>
      </div>

      {/* ── Line verification dialog ─────────────────────────────────────────────────────────── */}
      <Dialog open={!!editing} onOpenChange={open => !open && setEditing(null)}>
        <DialogContent className={travelDialog.content}>
          <DialogHeader className={travelDialog.header}>
            <DialogTitle>Verify line — {editing?.category}</DialogTitle>
            <DialogDescription>
              Claimed {editing?.claimedAmount} · {editing?.policyLimit == null ? 'no policy limit' : `policy limit ${editing?.policyLimit}`}
            </DialogDescription>
          </DialogHeader>

          {editing && (
            <div className={travelDialog.body}>
              {editing.policyNote && (
                <p className="rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600">{editing.policyNote}</p>
              )}

              <div>
                <Label className="text-xs">Decision</Label>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  <DecisionButton active={decision === 'ACCEPTED'} onClick={() => { setDecision('ACCEPTED'); setAllowedAmount(editing.claimedAmount); }} icon={CheckCircle2} label="Accept in full" tone="emerald" />
                  <DecisionButton active={decision === 'REDUCED'} onClick={() => setDecision('REDUCED')} icon={MinusCircle} label="Reduce" tone="amber" />
                  <DecisionButton active={decision === 'DISALLOWED'} onClick={() => setDecision('DISALLOWED')} icon={XCircle} label="Disallow" tone="rose" />
                  <DecisionButton active={decision === 'BILL_REQUESTED'} onClick={() => setDecision('BILL_REQUESTED')} icon={FileWarning} label="Request bill" tone="slate" />
                </div>
              </div>

              {decision === 'REDUCED' && (
                <div>
                  <Label className="text-xs">Allowed amount</Label>
                  <Input
                    type="number" inputMode="decimal"
                    min={0}
                    max={editing.claimedAmount}
                    value={allowedAmount}
                    onChange={event => setAllowedAmount(event.target.value === '' ? '' : Number(event.target.value))}
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Disallowed will be recorded as {roundMoney(editing.claimedAmount - Number(allowedAmount || 0))}. The claimed amount of {editing.claimedAmount} stays on the record.
                  </p>
                </div>
              )}

              <div>
                <Label className="text-xs">
                  Remarks {(decision === 'REDUCED' || decision === 'DISALLOWED') && <span className="text-rose-600">*</span>}
                </Label>
                <Textarea value={remarks} onChange={event => setRemarks(event.target.value)} rows={2} placeholder="Why is this the allowed figure?" />
              </div>

              <div>
                <Label className="text-xs">Accounting head</Label>
                <Input value={accountingHead} onChange={event => setAccountingHead(event.target.value)} placeholder="GL code" />
              </div>
            </div>
          )}

          <DialogFooter className={travelDialog.footer}>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              disabled={busy === 'verify'}
              onClick={() =>
                run('verify', async () => {
                  await verifyClaimItem(editing!.id, actor!, {
                    decision,
                    approvedAmount: decision === 'REDUCED' ? Number(allowedAmount || 0) : undefined,
                    remarks,
                    accountingHead,
                  });
                  setEditing(null);
                }, 'Line verified')
              }
            >
              {busy === 'verify' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Save decision
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={returnOpen} onOpenChange={setReturnOpen}>
        <DialogContent className={travelDialog.content}>
          <DialogHeader className={travelDialog.header}>
            <DialogTitle>Return for correction</DialogTitle>
            <DialogDescription>The employee will be able to edit and resubmit this claim.</DialogDescription>
          </DialogHeader>
          <div className={travelDialog.body}>
            <Label className="text-xs">What needs correcting? <span className="text-rose-600">*</span></Label>
            <Textarea value={returnRemarks} onChange={event => setReturnRemarks(event.target.value)} rows={3} />
          </div>
          <DialogFooter className={travelDialog.footer}>
            <Button variant="outline" onClick={() => setReturnOpen(false)}>Cancel</Button>
            <Button
              disabled={busy === 'return'}
              onClick={() =>
                run('return', async () => {
                  await returnClaimForCorrection(claimId, actor!, returnRemarks);
                  setReturnOpen(false);
                  setReturnRemarks('');
                }, 'Claim returned')
              }
            >
              {busy === 'return' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Return
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className={travelDialog.content}>
          <DialogHeader className={travelDialog.header}>
            <DialogTitle>Reject claim</DialogTitle>
            <DialogDescription>This is terminal — the employee will need to raise a new claim.</DialogDescription>
          </DialogHeader>
          <div className={travelDialog.body}>
            <Label className="text-xs">Reason <span className="text-rose-600">*</span></Label>
            <Textarea value={rejectReason} onChange={event => setRejectReason(event.target.value)} rows={3} />
          </div>
          <DialogFooter className={travelDialog.footer}>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={busy === 'reject'}
              onClick={() =>
                run('reject', async () => {
                  await rejectTravelClaim(claimId, actor!, rejectReason);
                  setRejectOpen(false);
                  setRejectReason('');
                }, 'Claim rejected')
              }
            >
              {busy === 'reject' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DecisionButton({
  active,
  onClick,
  icon: Icon,
  label,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
  tone: 'emerald' | 'amber' | 'rose' | 'slate';
}) {
  const tones = {
    emerald: 'border-emerald-300 bg-emerald-50 text-emerald-800',
    amber: 'border-amber-300 bg-amber-50 text-amber-800',
    rose: 'border-rose-300 bg-rose-50 text-rose-800',
    slate: 'border-slate-300 bg-slate-50 text-slate-700',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors ${
        active ? tones[tone] : 'border-slate-200 text-slate-600 hover:bg-slate-50'
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </button>
  );
}

function Row({
  label,
  value,
  emphasis,
  tone,
}: {
  label: string;
  value: number;
  emphasis?: boolean;
  tone?: 'rose' | 'emerald';
}) {
  const colour = tone === 'rose' ? 'text-rose-600' : tone === 'emerald' ? 'text-emerald-700' : 'text-slate-800';
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={emphasis ? 'font-medium text-slate-800' : 'text-muted-foreground'}>{label}</dt>
      <dd className={`${emphasis ? 'font-semibold' : 'font-medium'} ${colour}`}>
        <Money value={value} exact />
      </dd>
    </div>
  );
}
