'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { collection, deleteDoc, doc, getDoc, getDocs, writeBatch } from 'firebase/firestore';
import { Edit, ExternalLink, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { formatCreatedBy, formatUpdatedBy } from '@/lib/audit-fields';
import type { InsurancePolicy, PolicyRenewal } from '@/lib/types';
import {
  annualisedPremium,
  formatDay,
  formatInr,
  graceDays,
  instalmentRegister,
  personalPolicyState,
  policyFrequency,
  premiumSchedule,
  relativeDays,
  toDate,
} from '@/lib/insurance';
import { PERSONAL_POLICIES } from '@/lib/insurance-service';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { PageHeader } from '@/components/shared/page-header';
import { TableCard } from '@/components/shared/table-card';
import { RenewalDialog } from '@/components/insurance/RenewalDialog';
import { AccessDenied, AttachmentList, Fact, InstalmentBadge, PersonalStateBadge } from '@/components/insurance/insurance-ui';
import { cn } from '@/lib/utils';

export default function PolicyDetailsPage() {
  const { policyId } = useParams() as { policyId: string };
  const { toast } = useToast();
  const router = useRouter();
  const { can, isLoading: authLoading } = useAuthorization();
  const canView = can('View', 'Insurance.Personal Insurance');
  const canEdit = can('Edit', 'Insurance.Personal Insurance');
  const canDelete = can('Delete', 'Insurance.Personal Insurance');
  const canRenew = can('Renew', 'Insurance.Personal Insurance');

  const [policy, setPolicy] = useState<InsurancePolicy | null>(null);
  const [renewals, setRenewals] = useState<PolicyRenewal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRenewOpen, setIsRenewOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchPolicyData = useCallback(async () => {
    if (!policyId) return;
    setIsLoading(true);
    try {
      const snap = await getDoc(doc(db, PERSONAL_POLICIES, policyId));
      if (!snap.exists()) {
        toast({ title: 'Error', description: 'Policy not found.', variant: 'destructive' });
        router.push('/insurance/personal');
        return;
      }
      setPolicy({ id: snap.id, ...snap.data() } as InsurancePolicy);
      const renewalsSnap = await getDocs(collection(db, PERSONAL_POLICIES, policyId, 'renewals'));
      setRenewals(
        renewalsSnap.docs
          .map((d) => ({ id: d.id, ...d.data() } as PolicyRenewal))
          .sort((a, b) => (toDate(b.paymentDate)?.getTime() ?? 0) - (toDate(a.paymentDate)?.getTime() ?? 0)),
      );
    } catch (error) {
      console.error('Error fetching policy data:', error);
      toast({ title: 'Error', description: 'Failed to fetch policy details.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [policyId, router, toast]);

  useEffect(() => {
    if (!authLoading && canView) fetchPolicyData();
  }, [authLoading, canView, fetchPolicyData]);

  const derived = useMemo(() => {
    if (!policy) return null;
    const now = new Date();
    const frequency = policyFrequency(policy);
    const grace = graceDays(frequency, policy.grace_period_days);
    const maturity = toDate(policy.date_of_maturity);
    const schedule = premiumSchedule(toDate(policy.date_of_comm), frequency, policy.tenure || 0)
      .filter((d) => !maturity || d < maturity);
    const nextDue = toDate(policy.due_date);
    const rows = instalmentRegister(schedule, nextDue, renewals, now, grace);
    const recordedPaid = renewals.reduce((s, r) => s + (r.amount ?? 0), 0);
    return {
      state: personalPolicyState(policy, now),
      frequency,
      grace,
      nextDue,
      rows,
      recordedPaid,
      // Payments that fit no instalment (legacy rows on a policy with no schedule) are still shown.
      unmatched: renewals.filter((r) => !rows.some((row) => row.payment?.id === r.id)),
    };
  }, [policy, renewals]);

  const handleDelete = async () => {
    if (!policy) return;
    setIsDeleting(true);
    try {
      // Firestore does not cascade: remove the payment history first so nothing is left orphaned.
      const renewalsSnap = await getDocs(collection(db, PERSONAL_POLICIES, policy.id, 'renewals'));
      const batch = writeBatch(db);
      renewalsSnap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      await deleteDoc(doc(db, PERSONAL_POLICIES, policy.id));
      toast({ title: 'Policy deleted', description: `${policy.policy_no} has been removed.` });
      router.push('/insurance/personal');
    } catch (error) {
      console.error('Error deleting policy:', error);
      toast({ title: 'Error', description: 'Failed to delete the policy.', variant: 'destructive' });
      setIsDeleting(false);
    }
  };

  if (authLoading || (isLoading && canView)) {
    return (
      <div className="w-full space-y-4">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }
  if (!canView) return <AccessDenied what="view personal insurance policies" />;
  if (!policy || !derived) return null;

  const { state, frequency, grace, nextDue, rows, recordedPaid, unmatched } = derived;
  const canRecordPayment = canRenew && !!nextDue && ['active', 'due-soon', 'grace', 'lapsed'].includes(state);
  const updatedLine = formatUpdatedBy(policy);

  return (
    <>
      <div className="w-full space-y-4">
        <PageHeader
          title={policy.policy_name || policy.policy_no}
          backHref="/insurance/personal"
          backLabel="Back to personal insurance"
          badge={<PersonalStateBadge state={state} />}
          meta={[
            { label: 'Policy No', value: policy.policy_no },
            { label: 'Insured', value: policy.insured_person },
            { label: 'Insurer', value: policy.insurance_company },
          ]}
          actions={
            <>
              {canRecordPayment && (
                <Button size="sm" className="gap-1.5" onClick={() => setIsRenewOpen(true)}>
                  <RotateCcw className="h-3.5 w-3.5" /> Record Payment
                </Button>
              )}
              {canEdit && (
                <Link href={`/insurance/personal/edit/${policy.id}`}>
                  <Button size="sm" variant="outline" className="w-full gap-1.5"><Edit className="h-3.5 w-3.5" /> Edit</Button>
                </Link>
              )}
              {canDelete && (
                <Button size="sm" variant="outline" className="gap-1.5 text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
              )}
            </>
          }
        />

        {state === 'lapsed' && nextDue && (
          <div className="rounded-xl border border-rose-200 bg-rose-50/60 px-4 py-3 text-sm text-rose-800">
            The premium due {formatDay(nextDue)} is unpaid beyond the {grace}-day grace period. Cover may have lapsed — check revival terms with the insurer.
          </div>
        )}
        {state === 'grace' && nextDue && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm text-amber-800">
            The premium due {formatDay(nextDue)} is in its grace period — pay by {formatDay(new Date(nextDue.getTime() + grace * 86_400_000))} to keep cover in force.
          </div>
        )}

        <Card>
          <CardHeader><CardTitle>Policy Summary</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4">
            <Fact label="Category">{policy.policy_category || '—'}</Fact>
            <Fact label="Sum Assured">{formatInr(policy.sum_insured)}</Fact>
            <Fact label="Premium">{formatInr(policy.premium)} <span className="font-normal text-muted-foreground">· {frequency}</span></Fact>
            <Fact label="Yearly Outgo">{frequency === 'One-Time' ? '—' : formatInr(annualisedPremium(policy.premium, frequency))}</Fact>
            <Fact label="Next Premium Due">
              {nextDue ? <>{formatDay(nextDue)} <span className="font-normal text-muted-foreground">· {relativeDays(nextDue)}</span></> : '—'}
            </Fact>
            <Fact label="Commencement">{formatDay(policy.date_of_comm)}</Fact>
            <Fact label="Maturity">{formatDay(policy.date_of_maturity)}</Fact>
            <Fact label="Premium-Paying Term">{policy.tenure ? `${policy.tenure} years` : '—'}</Fact>
            <Fact label="Last Premium Date">{formatDay(policy.last_premium_date)}</Fact>
            <Fact label="Grace Period">{grace} days</Fact>
            <Fact label="Auto Debit">{policy.auto_debit ? 'Yes' : 'No'}</Fact>
            <Fact label="Recorded Payments">{renewals.length} · {formatInr(recordedPaid)}</Fact>
            <Fact label="Nominee">{policy.nominee_name ? `${policy.nominee_name}${policy.nominee_relationship ? ` (${policy.nominee_relationship})` : ''}` : '—'}</Fact>
            <Fact label="Agent / Advisor">{policy.agent_name ? `${policy.agent_name}${policy.agent_contact ? ` · ${policy.agent_contact}` : ''}` : '—'}</Fact>
            <Fact label="Issued">{formatDay(policy.policy_issue_date)}</Fact>
            <Fact label="Recorded">{formatCreatedBy(policy)}</Fact>
            {updatedLine && <Fact label="Last Edited">{updatedLine}</Fact>}
            {policy.remarks && <Fact label="Remarks" className="col-span-2 md:col-span-3 lg:col-span-4"><span className="font-normal">{policy.remarks}</span></Fact>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Documents</CardTitle></CardHeader>
          <CardContent><AttachmentList attachments={policy.attachments ?? []} /></CardContent>
        </Card>

        <TableCard
          title="Premium Register"
          description={rows.length ? `${rows.length} instalments across the premium-paying term.` : 'Set commencement and term on the policy to see its full schedule.'}
          scroll="natural"
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Paid On</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && unmatched.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="h-24 text-center text-muted-foreground">No schedule or payments yet.</TableCell></TableRow>
              ) : (
                <>
                  {rows.map((row) => (
                    <TableRow key={row.no} className={cn(row.isCurrent && 'bg-muted/40')}>
                      <TableCell className="tabular-nums">{row.no}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatDay(row.dueDate)}</TableCell>
                      <TableCell><InstalmentBadge state={row.state} /></TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">{row.payment?.amount ? formatInr(row.payment.amount) : '—'}</TableCell>
                      <TableCell className="whitespace-nowrap">{row.payment ? formatDay(row.payment.paymentDate) : row.state === 'paid' ? <span className="text-muted-foreground">Before tracking</span> : '—'}</TableCell>
                      <TableCell>{row.payment?.paymentType || '—'}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {row.payment?.referenceNo || '—'}
                        {row.payment?.renewalCopyUrl && (
                          <a href={row.payment.renewalCopyUrl} target="_blank" rel="noopener noreferrer" className="ml-2 inline-flex items-center gap-1 text-xs text-primary hover:underline">
                            Receipt <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {row.isCurrent && canRecordPayment && (
                          <Button size="sm" className="h-7 gap-1 text-xs" onClick={() => setIsRenewOpen(true)}>
                            <RotateCcw className="h-3 w-3" /> Pay
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {unmatched.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>—</TableCell>
                      <TableCell className="whitespace-nowrap">{formatDay(r.instalmentDueDate ?? r.paymentDate)}</TableCell>
                      <TableCell><InstalmentBadge state="paid" /></TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">{r.amount ? formatInr(r.amount) : '—'}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatDay(r.paymentDate)}</TableCell>
                      <TableCell>{r.paymentType || '—'}</TableCell>
                      <TableCell>{r.referenceNo || '—'}</TableCell>
                      <TableCell />
                    </TableRow>
                  ))}
                </>
              )}
            </TableBody>
          </Table>
        </TableCard>
      </div>

      {canRecordPayment && (
        <RenewalDialog isOpen={isRenewOpen} onOpenChange={setIsRenewOpen} policy={policy} onSuccess={fetchPolicyData} />
      )}

      <AlertDialog open={confirmDelete} onOpenChange={(o) => !isDeleting && setConfirmDelete(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete policy {policy.policy_no}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the policy and its {renewals.length} recorded payment{renewals.length === 1 ? '' : 's'}. To keep the
              history, edit the policy and set its status to Surrendered or Closed instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDelete(); }}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
