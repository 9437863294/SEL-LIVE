'use client';

/**
 * Record the payment of one or several approved claims — one bank transfer often settles a month's
 * claims. Each claim is paid its own approved amount; a claim the server refuses (already paid,
 * no longer waiting for this person) is reported by number and the rest still go through.
 */

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FormDialog } from '@/components/shared/form-dialog';
import { useToast } from '@/hooks/use-toast';
import { formatINR, sumMoney } from '@/lib/employee-trips/rates';
import { PAYMENT_MODES, type PaymentMode } from '@/lib/employee-trips/types';
import { errorMessage, tripFetch } from './trip-api';
import { Field, Money } from './trip-ui';

export interface PayableClaim {
  id: string;
  claimNumber: string;
  employeeName: string;
  amount: number;
}

export function PayDialog({ open, onOpenChange, claims, today, onPaid }: { open: boolean; onOpenChange: (open: boolean) => void; claims: PayableClaim[]; today: string; onPaid: () => void }) {
  const { toast } = useToast();
  const [paidOn, setPaidOn] = useState(today);
  const [mode, setMode] = useState<PaymentMode>('Bank Transfer');
  const [reference, setReference] = useState('');
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [attempted, setAttempted] = useState(false);

  // A fresh form each time the dialog opens (adjusted during render, not in an effect).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setPaidOn(today);
      setReference('');
      setRemarks('');
      setAttempted(false);
    }
  }

  const needsReference = mode !== 'Cash' && mode !== 'Payroll';
  const referenceError = attempted && needsReference && !reference.trim() ? `Enter the ${mode} reference (UTR or cheque number).` : undefined;
  const dateError = attempted && (!paidOn || paidOn > today) ? 'Enter a payment date that is not in the future.' : undefined;
  const total = sumMoney(claims.map((claim) => claim.amount));

  async function submit() {
    setAttempted(true);
    if ((needsReference && !reference.trim()) || !paidOn || paidOn > today) return;
    setSubmitting(true);
    try {
      const result = await tripFetch<{ paid: { claimNumber: string; amount: number }[]; failed: { error: string }[] }>('claims/pay', {
        body: { claimIds: claims.map((claim) => claim.id), payment: { paidOn, mode, reference, remarks } },
      });
      if (result.paid.length) {
        toast({ title: result.paid.length === 1 ? `${result.paid[0].claimNumber} marked paid` : `${result.paid.length} claims marked paid`, description: `Total ${formatINR(sumMoney(result.paid.map((entry) => entry.amount)))}` });
      }
      if (result.failed.length) {
        toast({ variant: 'destructive', title: `${result.failed.length} not paid`, description: result.failed.map((entry) => entry.error).join(' ') });
      }
      onPaid();
      if (!result.failed.length) onOpenChange(false);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Payment not recorded', description: errorMessage(error) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={claims.length === 1 ? `Record payment — ${claims[0].claimNumber}` : `Record payment — ${claims.length} claims`}
      description={claims.length === 1 ? `To ${claims[0].employeeName}` : 'One payment entry for every claim selected; each is paid its own approved amount.'}
      onSubmit={submit}
      submitting={submitting}
      submitLabel="Mark as paid"
    >
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Amount</p>
        <p className="text-2xl font-semibold text-slate-900">
          <Money value={total} />
        </p>
        {claims.length > 1 && (
          <ul className="mt-2 max-h-32 space-y-0.5 overflow-y-auto text-xs text-slate-600">
            {claims.map((claim) => (
              <li key={claim.id} className="flex justify-between gap-2">
                <span className="truncate">
                  {claim.claimNumber} · {claim.employeeName}
                </span>
                <Money value={claim.amount} className="shrink-0" />
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Paid on" required error={dateError} htmlFor="pay-date">
          <Input id="pay-date" type="date" value={paidOn} max={today} onChange={(event) => setPaidOn(event.target.value)} className="bg-white" />
        </Field>
        <Field label="Mode" required>
          <Select value={mode} onValueChange={(value) => setMode(value as PaymentMode)}>
            <SelectTrigger className="bg-white text-left">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAYMENT_MODES.map((entry) => (
                <SelectItem key={entry} value={entry}>
                  {entry}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Field label={needsReference ? 'Reference (UTR / cheque no.)' : 'Reference'} required={needsReference} error={referenceError} htmlFor="pay-reference">
        <Input id="pay-reference" value={reference} onChange={(event) => setReference(event.target.value)} maxLength={80} className="bg-white" placeholder={mode === 'Payroll' ? 'e.g. October 2026 payroll' : undefined} />
      </Field>
      <Field label="Remarks" htmlFor="pay-remarks">
        <Textarea id="pay-remarks" value={remarks} onChange={(event) => setRemarks(event.target.value)} rows={2} maxLength={500} className="bg-white" />
      </Field>
    </FormDialog>
  );
}
