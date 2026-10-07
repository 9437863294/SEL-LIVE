'use client';

import { useEffect, useState } from 'react';
import { doc, Timestamp, updateDoc } from 'firebase/firestore';
import { Loader2 } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import { actorFromUser, withUpdateAudit } from '@/lib/audit-fields';
import type { Attachment, InsurancePolicy, PolicySettlement } from '@/lib/types';
import {
  formatDay,
  formatInr,
  RECEIPT_MODES,
  SETTLEMENT_HINT,
  SETTLEMENT_STATUS,
  SETTLEMENT_TYPES,
  settlementNet,
  toDate,
  type SettlementType,
} from '@/lib/insurance';
import { completeTasksForDue, PERSONAL_POLICIES, uploadInsuranceFiles } from '@/lib/insurance-service';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { AttachmentList, DateField, PendingFiles } from '@/components/insurance/insurance-ui';

interface Props {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  policy: InsurancePolicy;
  /** The kind of close-out to start with; ignored when the policy already has a settlement. */
  initialType?: SettlementType;
  /** Open straight on the payment-received section, for a settlement awaiting its money. */
  focusPayment?: boolean;
  onSuccess: () => void;
}

const num = (s: string) => (s.trim() === '' ? null : Number(s));

/**
 * Close out a personal policy — maturity or death claim, surrender or premature closure — and
 * record the money the insurer pays. It can be saved in two steps: the request when it is lodged,
 * then the payment once it is credited. Either way the policy stops expecting premiums.
 */
export function SettlementDialog({ isOpen, onOpenChange, policy, initialType, focusPayment, onSuccess }: Props) {
  const { toast } = useToast();
  const { user } = useAuth();
  const existing = policy.settlement ?? null;
  const [isSaving, setIsSaving] = useState(false);

  const [type, setType] = useState<SettlementType>('Surrender');
  const [requestDate, setRequestDate] = useState<Date | undefined>();
  const [requestRef, setRequestRef] = useState('');
  const [claimedAmount, setClaimedAmount] = useState('');
  const [reason, setReason] = useState('');
  const [received, setReceived] = useState(false);
  const [receivedDate, setReceivedDate] = useState<Date | undefined>();
  const [grossAmount, setGrossAmount] = useState('');
  const [deductions, setDeductions] = useState('');
  const [paymentMode, setPaymentMode] = useState('');
  const [paymentRef, setPaymentRef] = useState('');
  const [creditedTo, setCreditedTo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [documents, setDocuments] = useState<Attachment[]>([]);
  const [newFiles, setNewFiles] = useState<File[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    const s = policy.settlement;
    const matured = (() => { const m = toDate(policy.date_of_maturity); return !!m && m <= new Date(); })();
    const t: SettlementType = s?.type ?? initialType ?? (matured ? 'Maturity Claim' : 'Surrender');
    setType(t);
    setRequestDate(toDate(s?.requestDate) ?? new Date());
    setRequestRef(s?.requestRef ?? '');
    setClaimedAmount(s?.claimedAmount != null ? String(s.claimedAmount) : t === 'Maturity Claim' || t === 'Death Claim' ? String(policy.sum_insured || '') : '');
    setReason(s?.reason ?? '');
    setReceived(s?.status === 'Received' || !!focusPayment);
    setReceivedDate(toDate(s?.receivedDate) ?? (focusPayment ? new Date() : undefined));
    setGrossAmount(s?.grossAmount != null ? String(s.grossAmount) : s?.claimedAmount != null ? String(s.claimedAmount) : '');
    setDeductions(s?.deductions != null ? String(s.deductions) : '');
    setPaymentMode(s?.paymentMode ?? '');
    setPaymentRef(s?.paymentRef ?? '');
    setCreditedTo(s?.creditedTo ?? '');
    setRemarks(s?.remarks ?? '');
    setDocuments(s?.documents ?? []);
    setNewFiles([]);
  }, [isOpen, policy, initialType, focusPayment]);

  const net = settlementNet(num(grossAmount), num(deductions));
  const isClaim = type === 'Maturity Claim' || type === 'Death Claim';
  const amountLabel = isClaim ? 'Amount Claimed (₹)' : type === 'Surrender' ? 'Surrender Value Quoted (₹)' : 'Closure Value Quoted (₹)';

  const handleSave = async () => {
    const actor = actorFromUser(user);
    if (!user || !actor) {
      toast({ title: 'Not signed in', description: 'Sign in again to save.', variant: 'destructive' });
      return;
    }
    const today = new Date();
    const fail = (description: string) => toast({ title: 'Check the details', description, variant: 'destructive' });
    if (!requestDate) return fail('Enter the date the request was made to the insurer.');
    if (requestDate > today) return fail('The request date cannot be in the future.');
    const claimed = num(claimedAmount);
    if (claimed !== null && (!Number.isFinite(claimed) || claimed < 0)) return fail(`${amountLabel.replace(' (₹)', '')} must be a positive amount.`);
    const gross = num(grossAmount);
    const less = num(deductions);
    if (received) {
      if (!receivedDate) return fail('Enter the date the money was received.');
      if (receivedDate > today) return fail('The received date cannot be in the future.');
      if (receivedDate < requestDate) return fail('The money cannot be received before the request was made.');
      if (gross === null || !Number.isFinite(gross) || gross < 0) return fail('Enter the gross amount paid by the insurer.');
      if (less !== null && (!Number.isFinite(less) || less < 0)) return fail('Deductions must be a positive amount.');
      if ((less ?? 0) > gross) return fail('Deductions cannot be more than the gross amount.');
      if (!paymentMode) return fail('Select how the money was received.');
    }

    setIsSaving(true);
    try {
      const uploaded = newFiles.length ? await uploadInsuranceFiles(`insurance-policies/${policy.id}/settlement`, newFiles) : [];
      const settlement: PolicySettlement = {
        type,
        status: received ? 'Received' : 'Requested',
        requestDate: Timestamp.fromDate(requestDate),
        requestRef: requestRef.trim() || null,
        claimedAmount: claimed,
        reason: reason.trim() || null,
        receivedDate: received && receivedDate ? Timestamp.fromDate(receivedDate) : null,
        grossAmount: received ? gross : null,
        deductions: received ? (less ?? 0) : null,
        netAmount: received ? settlementNet(gross, less) : null,
        paymentMode: received ? paymentMode : null,
        paymentRef: received ? paymentRef.trim() || null : null,
        creditedTo: received ? creditedTo.trim() || null : null,
        remarks: remarks.trim() || null,
        documents: [...documents, ...uploaded],
        recordedBy: actor.userId,
        recordedByName: actor.userName ?? null,
        recordedAt: Timestamp.now(),
      };
      const endedOn = received && receivedDate ? receivedDate : requestDate;
      await updateDoc(doc(db, PERSONAL_POLICIES, policy.id), {
        status: SETTLEMENT_STATUS[type],
        due_date: null,
        settlement,
        closed_on: Timestamp.fromDate(endedOn),
        closure_amount: settlement.netAmount,
        ...withUpdateAudit(actor),
      });

      // A policy that has ended expects no more premiums, nor a maturity to chase.
      if (!existing) {
        const note = `${type} ${received ? `— ${formatInr(settlement.netAmount ?? 0)} received ${formatDay(receivedDate)}` : `requested ${formatDay(requestDate)}`}.`;
        const due = toDate(policy.due_date);
        const maturity = toDate(policy.date_of_maturity);
        await Promise.all([
          due ? completeTasksForDue(policy.id, due, user, `${note} No further premiums.`) : null,
          maturity ? completeTasksForDue(policy.id, maturity, user, note, 'maturity') : null,
        ]).catch((e) => console.warn('Settlement saved, but its tasks could not be closed:', e));
      }

      toast({
        title: received ? 'Settlement recorded' : 'Request recorded',
        description: received
          ? `${policy.policy_no}: ${formatInr(settlement.netAmount ?? 0)} received. Policy marked ${SETTLEMENT_STATUS[type]}.`
          : `${policy.policy_no} marked ${SETTLEMENT_STATUS[type]} — record the payment once it is credited.`,
      });
      onSuccess();
      onOpenChange(false);
    } catch (error) {
      console.error('Error saving settlement:', error);
      toast({ title: 'Error', description: 'Failed to save the settlement.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !isSaving && onOpenChange(open)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{existing ? 'Settlement Details' : 'Close Policy'}</DialogTitle>
          <DialogDescription>
            {policy.policy_no} · {policy.insured_person} · {policy.insurance_company}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-3">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Request to the insurer</h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label>Settlement Type</Label>
                <Select value={type} onValueChange={(v) => setType(v as SettlementType)} disabled={isSaving}>
                  <SelectTrigger aria-label="Settlement type"><SelectValue /></SelectTrigger>
                  <SelectContent>{SETTLEMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {SETTLEMENT_HINT[type]} The policy will be marked <span className="font-medium text-foreground">{SETTLEMENT_STATUS[type]}</span> and stop expecting premiums.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="st-request-date">Request Date</Label>
                <DateField id="st-request-date" value={requestDate} onChange={setRequestDate} disabled={isSaving} maxDate={new Date()} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="st-request-ref">{isClaim ? 'Claim No.' : 'Request / Reference No.'}</Label>
                <Input id="st-request-ref" value={requestRef} onChange={(e) => setRequestRef(e.target.value)} disabled={isSaving} autoComplete="off" placeholder="As given by the insurer" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="st-claimed">{amountLabel}</Label>
                <Input id="st-claimed" type="number" inputMode="decimal" min={0} value={claimedAmount} onChange={(e) => setClaimedAmount(e.target.value)} disabled={isSaving} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="st-reason">{type === 'Death Claim' ? 'Date & Cause of Death' : 'Reason'}</Label>
                <Input id="st-reason" value={reason} onChange={(e) => setReason(e.target.value)} disabled={isSaving} autoComplete="off" placeholder={type === 'Maturity Claim' ? 'Optional' : 'Why the policy is being closed'} />
              </div>
            </div>
          </section>

          <section className="space-y-3 border-t border-border/60 pt-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Payment received</h3>
                <p className="text-xs text-muted-foreground">Leave off while the insurer is still processing; come back to add it.</p>
              </div>
              <Switch checked={received} onCheckedChange={setReceived} disabled={isSaving} aria-label="Payment received" />
            </div>
            {received && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="st-received-date">Date Received</Label>
                  <DateField id="st-received-date" value={receivedDate} onChange={setReceivedDate} disabled={isSaving} maxDate={new Date()} />
                </div>
                <div className="space-y-2">
                  <Label>Received By</Label>
                  <Select value={paymentMode} onValueChange={setPaymentMode} disabled={isSaving}>
                    <SelectTrigger aria-label="Payment mode"><SelectValue placeholder="Select mode" /></SelectTrigger>
                    <SelectContent>{RECEIPT_MODES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="st-gross">Gross Amount (₹)</Label>
                  <Input id="st-gross" type="number" inputMode="decimal" min={0} value={grossAmount} onChange={(e) => setGrossAmount(e.target.value)} disabled={isSaving} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="st-deductions">Deductions — TDS, charges, loan (₹)</Label>
                  <Input id="st-deductions" type="number" inputMode="decimal" min={0} value={deductions} onChange={(e) => setDeductions(e.target.value)} disabled={isSaving} placeholder="0" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="st-utr">UTR / Cheque No.</Label>
                  <Input id="st-utr" value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)} disabled={isSaving} autoComplete="off" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="st-account">Credited To (Bank A/c)</Label>
                  <Input id="st-account" value={creditedTo} onChange={(e) => setCreditedTo(e.target.value)} disabled={isSaving} autoComplete="off" placeholder="e.g. SBI ••4521" />
                </div>
                <div className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2 md:col-span-2">
                  <p className="text-xs text-muted-foreground">Net amount received</p>
                  <p className="text-lg font-semibold tabular-nums text-foreground">{net === null ? '—' : formatInr(net)}</p>
                  {net !== null && num(claimedAmount) !== null && net !== num(claimedAmount) && (
                    <p className="text-xs text-amber-600">Differs from the {formatInr(num(claimedAmount) ?? 0)} {isClaim ? 'claimed' : 'quoted'}.</p>
                  )}
                </div>
              </div>
            )}
          </section>

          <section className="space-y-3 border-t border-border/60 pt-4">
            <div className="space-y-2">
              <Label htmlFor="st-docs">Documents</Label>
              <p className="text-xs text-muted-foreground">Claim form, discharge voucher, settlement letter, bank credit advice.</p>
              {documents.length > 0 && <AttachmentList attachments={documents} onRemove={(i) => setDocuments((d) => d.filter((_, j) => j !== i))} />}
              <Input
                id="st-docs"
                type="file"
                multiple
                onChange={(e) => { const files = Array.from(e.target.files ?? []); setNewFiles((f) => [...f, ...files]); e.target.value = ''; }}
                disabled={isSaving}
              />
              <PendingFiles files={newFiles} onRemove={(i) => setNewFiles((f) => f.filter((_, j) => j !== i))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="st-remarks">Remarks</Label>
              <Textarea id="st-remarks" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} disabled={isSaving} />
            </div>
          </section>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>Cancel</Button>
          <Button type="button" onClick={handleSave} disabled={isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {received ? 'Save Settlement' : 'Save Request'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
