'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { doc, onSnapshot } from 'firebase/firestore';
import { AlertTriangle, Loader2, Lock, Send, ShieldCheck } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  TT_COLLECTIONS,
  roundMoney,
  summarizeSettlement,
  travelStatusLabel,
  type TravelClaim,
  type TravelClaimItem,
} from '@/lib/tour-travel';
import {
  TravelControlError,
  loadClaimItems,
  markClaimFinancePosted,
  setClaimItemException,
  submitTravelClaim,
} from '@/lib/tour-travel-service';
import { TT_PERMISSION_MODULE } from './module-layout-shell';
import { useTravelActor } from './use-travel-config';
import { Money, TravelDataList, TravelField, TravelLoader, TravelPageHeader, TravelSection, TravelStatusBadge, travelDialog } from './travel-ui';

/**
 * Claim detail — the employee's view of their tour settlement (spec section 20).
 *
 * Shows the settlement statement in the order the spec lays it out (actual expense, less company
 * payment, less advance, net) and exposes the two things the employee still has to do: justify any
 * line above entitlement, and submit. Finance's verification lives on the separate `/verify` route,
 * so this page never invites an employee to edit a figure that has already been decided.
 */
export default function ClaimDetail({ claimId }: { claimId: string }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { can } = useAuthorization();
  const actor = useTravelActor();

  const [claim, setClaim] = useState<TravelClaim | null>(null);
  const [items, setItems] = useState<TravelClaimItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const [exceptionItem, setExceptionItem] = useState<TravelClaimItem | null>(null);
  const [exceptionReason, setExceptionReason] = useState('');

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

  useEffect(() => {
    void loadClaimItems(claimId).then(setItems);
  }, [claimId, claim?.totalApproved, claim?.itemCount, claim?.status]);

  const summary = useMemo(
    () => summarizeSettlement({ items, advancePaid: claim?.advancePaid || 0 }),
    [items, claim?.advancePaid],
  );

  /** Lines above entitlement with no reason yet — these block submission. */
  const needExceptionReason = useMemo(
    () => items.filter(item => item.policyLimit != null && item.claimedAmount > item.policyLimit && !item.exceptionReason?.trim()),
    [items],
  );

  const run = async (key: string, action: () => Promise<void>, successTitle: string) => {
    if (!actor) {
      toast({ variant: 'destructive', title: 'Not signed in' });
      return;
    }
    setBusy(key);
    try {
      await action();
      setItems(await loadClaimItems(claimId));
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

  if (loading) return <TravelLoader label="Loading claim…" />;
  if (!claim) {
    return (
      <TravelSection title="Claim not found">
        <p className="text-sm text-muted-foreground">This claim does not exist or has been removed.</p>
      </TravelSection>
    );
  }

  const isOwner = claim.employeeUserId === user?.id;
  const canSubmit = ['DRAFT', 'CORRECTION_REQUIRED'].includes(claim.status) && (isOwner || can('Submit', `${TT_PERMISSION_MODULE}.Claims`));
  const canVerify = can('Verify', `${TT_PERMISSION_MODULE}.Claims`) && ['SUBMITTED', 'MANAGER_REVIEW', 'FINANCE_REVIEW'].includes(claim.status);
  const canPost = can('Post To Accounts', `${TT_PERMISSION_MODULE}.Payments`) && ['PAID', 'SETTLED'].includes(claim.status) && !claim.financePosted;
  const locked = ['PAID', 'SETTLED'].includes(claim.status);

  return (
    <div className="space-y-4">
      <TravelPageHeader
        title={claim.referenceNumber}
        description={`${claim.employeeName} · tour ${claim.travelRequestNumber} · claimed ${claim.claimDate}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <TravelStatusBadge status={claim.status} />
            {claim.financePosted && (
              <Badge variant="outline" className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-700">
                <ShieldCheck className="h-3 w-3" /> Posted
              </Badge>
            )}
            {locked && (
              <Badge variant="outline" className="gap-1 border-slate-300 text-slate-600">
                <Lock className="h-3 w-3" /> Locked
              </Badge>
            )}
          </div>
        }
      />

      {claim.status === 'CORRECTION_REQUIRED' && claim.correctionRemarks && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">Returned for correction</p>
            <p className="text-xs">{claim.correctionRemarks}</p>
          </div>
        </div>
      )}

      {claim.status === 'REJECTED' && claim.rejectionReason && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">
          <p className="font-semibold">Claim rejected</p>
          <p className="text-xs">{claim.rejectionReason}</p>
        </div>
      )}

      {(canSubmit || canVerify || canPost) && (
        <div className="flex flex-wrap gap-2 rounded-lg border border-white/60 bg-white/80 p-3 backdrop-blur-sm">
          {canSubmit && (
            <Button
              className="gap-2 bg-gradient-to-r from-emerald-500 to-teal-600"
              disabled={busy === 'submit' || needExceptionReason.length > 0}
              onClick={() => run('submit', () => submitTravelClaim(claimId, actor!).then(() => undefined), 'Claim submitted')}
            >
              {busy === 'submit' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Submit Claim
            </Button>
          )}
          {canVerify && (
            <Button asChild variant="outline" className="gap-2">
              <Link href={`/tour-travel/claims/${claimId}/verify`}>Open verification</Link>
            </Button>
          )}
          {canPost && (
            <Button
              variant="outline"
              className="gap-2"
              disabled={busy === 'post'}
              onClick={() => run('post', () => markClaimFinancePosted(claimId, actor!), 'Posted to accounts')}
            >
              {busy === 'post' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Mark Posted to Accounts
            </Button>
          )}
          <Button asChild variant="ghost" className="gap-2">
            <Link href={`/tour-travel/requests/${claim.travelRequestId}`}>View tour</Link>
          </Button>
        </div>
      )}

      {needExceptionReason.length > 0 && canSubmit && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          <p className="font-semibold">{needExceptionReason.length} line(s) exceed entitlement</p>
          <p className="text-xs">Add a reason to each before submitting — use the &quot;Explain&quot; button on the line.</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <TravelSection title="Tour Settlement Statement" className="lg:col-span-2">
          <Table>
            <TableBody>
              <StatementRow label="Travel" value={categoryTotal(items, ['Airfare', 'Train', 'Bus'])} />
              <StatementRow label="Hotel" value={categoryTotal(items, ['Hotel'])} />
              <StatementRow label="Daily Allowance" value={categoryTotal(items, ['Daily Allowance'])} />
              <StatementRow label="Local Travel" value={categoryTotal(items, ['Taxi', 'Auto', 'Local Conveyance', 'Mileage', 'Fuel', 'Toll', 'Parking'])} />
              <StatementRow label="Other" value={categoryTotal(items, ['Food', 'Laundry', 'Telephone/Internet', 'Client Entertainment', 'Printing', 'Site Expense', 'Miscellaneous'])} />
              <TableRow className="border-t-2 font-semibold">
                <TableCell>Actual Expense</TableCell>
                <TableCell className="text-right"><Money value={summary.totalApproved} /></TableCell>
              </TableRow>
              <StatementRow label="Less: Company Direct Payment" value={summary.companyPaid} negative />
              <StatementRow label="Less: Advance" value={summary.advancePaid} negative />
              <TableRow className="border-t-2 text-base font-bold">
                <TableCell>{summary.outcome === 'Recoverable from employee' ? 'Recoverable from Employee' : 'Payable to Employee'}</TableCell>
                <TableCell className={summary.outcome === 'Recoverable from employee' ? 'text-right text-rose-600' : 'text-right text-emerald-700'}>
                  <Money value={summary.outcome === 'Recoverable from employee' ? summary.recoverableFromEmployee : summary.payableToEmployee} />
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
          {summary.totalDisallowed > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              You claimed <Money value={summary.totalClaimed} />; <Money value={summary.totalDisallowed} /> was not allowed. Line-level reasons are shown below.
            </p>
          )}
        </TravelSection>

        <TravelSection title="Claim Summary">
          <div className="space-y-2">
            <TravelField label="Employee">{claim.employeeName}</TravelField>
            <TravelField label="Project">{claim.projectName}</TravelField>
            <TravelField label="Department">{claim.departmentName}</TravelField>
            <TravelField label="Approved tour estimate"><Money value={claim.approvedEstimate} /></TravelField>
            <TravelField label="Variance vs estimate">
              <span className={summary.totalApproved > claim.approvedEstimate ? 'text-rose-600' : 'text-emerald-700'}>
                <Money value={roundMoney(summary.totalApproved - claim.approvedEstimate)} />
              </span>
            </TravelField>
            <TravelField label="Status">{travelStatusLabel(claim.status)}</TravelField>
            {claim.managerVerifiedByName && <TravelField label="Manager verified by">{claim.managerVerifiedByName}</TravelField>}
            {claim.financeVerifiedByName && <TravelField label="Finance verified by">{claim.financeVerifiedByName}</TravelField>}
            {claim.approvedByName && <TravelField label="Approved by">{claim.approvedByName}</TravelField>}
          </div>
        </TravelSection>
      </div>

      <TravelSection title="Claim Lines" description={`${items.length} line(s). Claimed amounts are your submission and are never changed.`}>
        <TravelDataList
          rows={items}
          rowClassName={item => (item.policyLimit != null && item.claimedAmount > item.policyLimit ? 'bg-amber-50/40 border-amber-200' : undefined)}
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
                  {item.paidByCompany && (
                    <Badge variant="outline" className="mt-0.5 border-slate-300 text-[10px] text-slate-600">Company paid — not reimbursed</Badge>
                  )}
                  {item.exceptionReason && <p className="mt-0.5 text-[11px] font-normal italic text-amber-800">Reason: {item.exceptionReason}</p>}
                </>
              ),
            },
            {
              header: 'Claimed',
              align: 'right',
              mobile: 'aside',
              cell: item => <span className="font-semibold tabular-nums"><Money value={item.claimedAmount} /></span>,
            },
            { header: 'Date', className: 'hidden lg:table-cell', mobile: 'omit', cell: item => <span className="tabular-nums">{item.expenseDate}</span> },
            {
              header: 'Entitlement',
              align: 'right',
              cell: item => (item.policyLimit == null ? <span className="text-muted-foreground">—</span> : <Money value={item.policyLimit} />),
            },
            {
              header: 'Allowed',
              align: 'right',
              cell: item =>
                item.approvedAmount == null ? (
                  <span className="text-muted-foreground">Pending</span>
                ) : (
                  <span className={item.disallowedAmount > 0 ? 'text-rose-600' : ''}>
                    <Money value={item.approvedAmount} />
                  </span>
                ),
            },
            {
              header: 'Remarks',
              className: 'hidden md:table-cell max-w-[14rem]',
              cell: item => <span className="text-xs text-muted-foreground">{item.verifierRemarks || item.policyNote}</span>,
            },
            ...(canSubmit
              ? [
                  {
                    header: 'Action',
                    mobile: 'footer' as const,
                    cell: (item: TravelClaimItem) =>
                      item.policyLimit != null && item.claimedAmount > item.policyLimit ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          onClick={() => {
                            setExceptionItem(item);
                            setExceptionReason(item.exceptionReason || '');
                          }}
                        >
                          {item.exceptionReason ? 'Edit reason' : 'Explain'}
                        </Button>
                      ) : null,
                  },
                ]
              : []),
          ]}
        />
      </TravelSection>

      <Dialog open={!!exceptionItem} onOpenChange={open => !open && setExceptionItem(null)}>
        <DialogContent className={travelDialog.content}>
          <DialogHeader className={travelDialog.header}>
            <DialogTitle>Exception reason — {exceptionItem?.category}</DialogTitle>
            <DialogDescription>
              You claimed {exceptionItem?.claimedAmount} against an entitlement of {exceptionItem?.policyLimit}. Explain the excess of{' '}
              {roundMoney((exceptionItem?.claimedAmount || 0) - (exceptionItem?.policyLimit || 0))}.
            </DialogDescription>
          </DialogHeader>
          <div className={travelDialog.body}>
            <Label className="text-xs">Reason <span className="text-rose-600">*</span></Label>
            <Textarea value={exceptionReason} onChange={event => setExceptionReason(event.target.value)} rows={3} placeholder="e.g. no hotel within entitlement was available near the site" />
          </div>
          <DialogFooter className={travelDialog.footer}>
            <Button variant="outline" onClick={() => setExceptionItem(null)}>Cancel</Button>
            <Button
              disabled={busy === 'exception'}
              onClick={() =>
                run('exception', async () => {
                  await setClaimItemException(exceptionItem!.id, actor!, exceptionReason);
                  setExceptionItem(null);
                }, 'Reason saved')
              }
            >
              {busy === 'exception' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Save reason
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Sums the approved (or, before verification, claimed) value of the given categories. Uses the same
 * "unverified settles at claimed" rule as `summarizeSettlement`, so the statement's category rows
 * always add up to its Actual Expense line.
 */
function categoryTotal(items: TravelClaimItem[], categories: string[]) {
  return roundMoney(
    items
      .filter(item => categories.includes(item.category))
      .reduce((sum, item) => sum + Number(item.approvedAmount ?? item.claimedAmount), 0),
  );
}

function StatementRow({ label, value, negative }: { label: string; value: number; negative?: boolean }) {
  if (value === 0 && negative) return null;
  return (
    <TableRow>
      <TableCell className="text-sm text-muted-foreground">{label}</TableCell>
      <TableCell className="text-right text-sm">
        {negative ? '− ' : ''}
        <Money value={value} />
      </TableCell>
    </TableRow>
  );
}
