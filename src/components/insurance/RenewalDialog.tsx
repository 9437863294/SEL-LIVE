'use client';

import { useEffect, useState } from 'react';
import { collection, doc, runTransaction, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { ExternalLink, Loader2 } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import { actorFromUser, withUpdateAudit } from '@/lib/audit-fields';
import type { InsurancePolicy, PolicyRenewal } from '@/lib/types';
import {
  dayKey,
  formatDay,
  formatInr,
  nextDueAfterPayment,
  PAYMENT_MODES,
  policyFrequency,
  toDate,
} from '@/lib/insurance';
import { completeTasksForDue, PERSONAL_POLICIES, uploadInsuranceFiles } from '@/lib/insurance-service';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { DateField, PendingFiles } from '@/components/insurance/insurance-ui';

interface RenewalDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  policy: InsurancePolicy;
  onSuccess: () => void;
  /** A recorded payment to correct — amount, dates, mode, reference, remarks or receipt. */
  payment?: PolicyRenewal | null;
  /** An instalment already counted as paid but with no payment on record, to add its details to. */
  forInstalment?: Date | null;
}

/**
 * Record the payment of a personal policy's current premium, correct a recorded payment, or add
 * the details and receipt of an instalment that was paid before it was tracked here.
 *
 * Only recording the current premium moves the policy's due date; the other two leave it alone.
 *
 * Payments are always against the instalment the policy is waiting on. The payment names that
 * instalment, so the schedule shows it paid whatever day the money actually went — the register used
 * to match on the payment date and left every late or early payment looking unpaid. The write is a
 * transaction on the policy's due date, so two people recording the same premium cannot both
 * advance it, and the premium's open task is closed once the payment is in.
 */
export function RenewalDialog({ isOpen, onOpenChange, policy, onSuccess, payment, forInstalment }: RenewalDialogProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [isSaving, setIsSaving] = useState(false);

  const mode: 'record' | 'edit' | 'backfill' = payment ? 'edit' : forInstalment ? 'backfill' : 'record';
  const instalment = payment
    ? toDate(payment.instalmentDueDate) ?? toDate(payment.paymentDate)
    : forInstalment ?? toDate(policy.due_date);
  const [amount, setAmount] = useState<string>('');
  const [paymentDate, setPaymentDate] = useState<Date | undefined>();
  const [receiptDate, setReceiptDate] = useState<Date | undefined>();
  const [paymentMode, setPaymentMode] = useState('');
  const [referenceNo, setReferenceNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [receipt, setReceipt] = useState<File[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    setReceipt([]);
    if (payment) {
      setAmount(String(payment.amount ?? policy.premium ?? ''));
      setPaymentDate(toDate(payment.paymentDate) ?? undefined);
      const receiptOn = toDate(payment.receiptDate);
      const paidOn = toDate(payment.paymentDate);
      setReceiptDate(receiptOn && (!paidOn || dayKey(receiptOn) !== dayKey(paidOn)) ? receiptOn : undefined);
      setPaymentMode(payment.paymentType || '');
      setReferenceNo(payment.referenceNo || '');
      setRemarks(payment.remarks || '');
      return;
    }
    setAmount(String(policy.premium || ''));
    // An old instalment was most likely paid on its due date, not today.
    setPaymentDate(forInstalment && forInstalment < new Date() ? forInstalment : new Date());
    setReceiptDate(undefined);
    setPaymentMode(policy.auto_debit ? 'Auto Debit' : '');
    setReferenceNo('');
    setRemarks('');
  }, [isOpen, policy.premium, policy.auto_debit, payment, forInstalment]);

  const handleSave = async () => {
    const actor = actorFromUser(user);
    const paid = Number(amount);
    if (!instalment) {
      toast({ title: 'Nothing due', description: 'This policy has no premium awaiting payment.', variant: 'destructive' });
      return;
    }
    if (!paymentDate || !paymentMode || !Number.isFinite(paid) || paid <= 0) {
      toast({ title: 'Missing details', description: 'Enter the amount, payment date and payment mode.', variant: 'destructive' });
      return;
    }
    if (paymentDate > new Date()) {
      toast({ title: 'Check the date', description: 'The payment date cannot be in the future.', variant: 'destructive' });
      return;
    }
    if (!user || !actor) {
      toast({ title: 'Not signed in', description: 'Sign in again to record the payment.', variant: 'destructive' });
      return;
    }

    setIsSaving(true);
    try {
      const [copy] = receipt.length ? await uploadInsuranceFiles(`insurance-renewals/${policy.id}`, receipt) : [];

      if (mode === 'edit' && payment) {
        await updateDoc(doc(db, PERSONAL_POLICIES, policy.id, 'renewals', payment.id), {
          amount: paid,
          paymentDate: Timestamp.fromDate(paymentDate),
          receiptDate: Timestamp.fromDate(receiptDate ?? paymentDate),
          paymentType: paymentMode,
          referenceNo: referenceNo.trim() || null,
          remarks: remarks.trim(),
          ...(copy ? { renewalCopyUrl: copy.url } : {}),
          ...withUpdateAudit(actor),
        });
        toast({ title: 'Payment updated', description: `Instalment due ${formatDay(instalment)} has been saved.` });
        onSuccess();
        onOpenChange(false);
        return;
      }

      if (mode === 'backfill') {
        const renewal: Omit<PolicyRenewal, 'id'> = {
          policyId: policy.id,
          renewalDate: Timestamp.now(),
          paymentDate: Timestamp.fromDate(paymentDate),
          receiptDate: Timestamp.fromDate(receiptDate ?? paymentDate),
          paymentType: paymentMode,
          remarks: remarks.trim(),
          renewalCopyUrl: copy?.url ?? null,
          renewedBy: user.id,
          renewedByName: user.name ?? null,
          instalmentDueDate: Timestamp.fromDate(instalment),
          amount: paid,
          referenceNo: referenceNo.trim() || null,
        };
        await setDoc(doc(collection(db, PERSONAL_POLICIES, policy.id, 'renewals')), renewal);
        await completeTasksForDue(policy.id, instalment, user, `Premium of ${formatInr(paid)} paid on ${formatDay(paymentDate)} (${paymentMode}).`)
          .catch((e) => console.warn('Payment saved, but its task could not be closed:', e));
        toast({ title: 'Payment details added', description: `Instalment due ${formatDay(instalment)} now has its payment on record.` });
        onSuccess();
        onOpenChange(false);
        return;
      }

      const next = nextDueAfterPayment(
        {
          commencement: toDate(policy.date_of_comm),
          frequency: policyFrequency(policy),
          termYears: policy.tenure || 0,
          maturity: toDate(policy.date_of_maturity),
        },
        instalment,
      );

      const policyRef = doc(db, PERSONAL_POLICIES, policy.id);
      await runTransaction(db, async (tx) => {
        const fresh = await tx.get(policyRef);
        const freshDue = toDate(fresh.data()?.due_date);
        if (!fresh.exists() || !freshDue || dayKey(freshDue) !== dayKey(instalment)) {
          throw new Error('ALREADY_RECORDED');
        }
        const renewal: Omit<PolicyRenewal, 'id'> = {
          policyId: policy.id,
          renewalDate: Timestamp.now(),
          paymentDate: Timestamp.fromDate(paymentDate),
          receiptDate: Timestamp.fromDate(receiptDate ?? paymentDate),
          paymentType: paymentMode,
          remarks: remarks.trim(),
          renewalCopyUrl: copy?.url ?? null,
          renewedBy: user.id,
          renewedByName: user.name ?? null,
          instalmentDueDate: Timestamp.fromDate(instalment),
          amount: paid,
          referenceNo: referenceNo.trim() || null,
        };
        tx.set(doc(collection(db, PERSONAL_POLICIES, policy.id, 'renewals')), renewal);
        tx.update(policyRef, {
          due_date: next ? Timestamp.fromDate(next) : null,
          last_renewed_at: Timestamp.now(),
          last_payment_type: paymentMode,
          ...withUpdateAudit(actor),
        });
      });

      await completeTasksForDue(policy.id, instalment, user, `Premium of ${formatInr(paid)} paid on ${formatDay(paymentDate)} (${paymentMode}).`)
        .catch((e) => console.warn('Payment saved, but its task could not be closed:', e));

      toast({
        title: 'Payment recorded',
        description: next ? `Next premium due ${formatDay(next)}.` : 'That was the final premium for this policy.',
      });
      onSuccess();
      onOpenChange(false);
    } catch (error) {
      const already = error instanceof Error && error.message === 'ALREADY_RECORDED';
      console.error('Error recording premium:', error);
      toast({
        title: already ? 'Already recorded' : 'Error',
        description: already
          ? 'Someone has already recorded this premium. Refresh to see the latest.'
          : mode === 'edit' ? 'Failed to update the payment.' : 'Failed to record the payment.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !isSaving && onOpenChange(open)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{mode === 'edit' ? 'Edit Premium Payment' : mode === 'backfill' ? 'Add Payment Details' : 'Record Premium Payment'}</DialogTitle>
          <DialogDescription>
            {policy.policy_no} · {policy.insured_person}
            {instalment ? ` · instalment due ${formatDay(instalment)}` : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 py-2 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="premium-amount">Amount Paid (₹)</Label>
            <Input id="premium-amount" type="number" inputMode="decimal" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} disabled={isSaving} />
            {Number(amount) > 0 && policy.premium > 0 && Number(amount) !== policy.premium && (
              <p className="text-xs text-amber-600">Differs from the policy premium of {formatInr(policy.premium)}.</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Payment Mode</Label>
            <Select value={paymentMode} onValueChange={setPaymentMode} disabled={isSaving}>
              <SelectTrigger aria-label="Payment mode"><SelectValue placeholder="Select payment mode" /></SelectTrigger>
              <SelectContent>{PAYMENT_MODES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Date of Payment</Label>
            <DateField value={paymentDate} onChange={setPaymentDate} disabled={isSaving} toYear={new Date().getFullYear()} />
          </div>
          <div className="space-y-2">
            <Label>Date of Receipt</Label>
            <DateField value={receiptDate} onChange={setReceiptDate} disabled={isSaving} placeholder="Same as payment" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="premium-ref">Transaction / Receipt No.</Label>
            <Input id="premium-ref" value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} disabled={isSaving} autoComplete="off" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="premium-receipt">Premium Receipt</Label>
            <Input
              id="premium-receipt"
              type="file"
              onChange={(e) => { setReceipt(Array.from(e.target.files ?? []).slice(0, 1)); e.target.value = ''; }}
              disabled={isSaving}
            />
            <PendingFiles files={receipt} onRemove={() => setReceipt([])} />
            {payment?.renewalCopyUrl && (
              <p className="text-xs text-muted-foreground">
                <a href={payment.renewalCopyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                  Current receipt <ExternalLink className="h-3 w-3" />
                </a>
                {' '}— choose a file to replace it.
              </p>
            )}
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="premium-remarks">Remarks</Label>
            <Textarea id="premium-remarks" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} disabled={isSaving} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>Cancel</Button>
          <Button type="button" onClick={handleSave} disabled={isSaving || !instalment}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {mode === 'edit' ? 'Save Changes' : mode === 'backfill' ? 'Save Details' : 'Record Payment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
