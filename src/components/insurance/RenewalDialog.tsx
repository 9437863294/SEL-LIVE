'use client';

import { useEffect, useState } from 'react';
import { collection, doc, runTransaction, Timestamp } from 'firebase/firestore';
import { Loader2 } from 'lucide-react';
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
}

/**
 * Record the payment of a personal policy's current premium.
 *
 * Payments are always against the instalment the policy is waiting on. The payment names that
 * instalment, so the schedule shows it paid whatever day the money actually went — the register used
 * to match on the payment date and left every late or early payment looking unpaid. The write is a
 * transaction on the policy's due date, so two people recording the same premium cannot both
 * advance it, and the premium's open task is closed once the payment is in.
 */
export function RenewalDialog({ isOpen, onOpenChange, policy, onSuccess }: RenewalDialogProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [isSaving, setIsSaving] = useState(false);

  const instalment = toDate(policy.due_date);
  const [amount, setAmount] = useState<string>('');
  const [paymentDate, setPaymentDate] = useState<Date | undefined>();
  const [receiptDate, setReceiptDate] = useState<Date | undefined>();
  const [paymentMode, setPaymentMode] = useState('');
  const [referenceNo, setReferenceNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [receipt, setReceipt] = useState<File[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    setAmount(String(policy.premium || ''));
    setPaymentDate(new Date());
    setReceiptDate(undefined);
    setPaymentMode(policy.auto_debit ? 'Auto Debit' : '');
    setReferenceNo('');
    setRemarks('');
    setReceipt([]);
  }, [isOpen, policy.premium, policy.auto_debit]);

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
        description: already ? 'Someone has already recorded this premium. Refresh to see the latest.' : 'Failed to record the payment.',
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
          <DialogTitle>Record Premium Payment</DialogTitle>
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
            Record Payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
