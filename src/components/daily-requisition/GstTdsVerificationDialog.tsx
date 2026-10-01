
'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { AlertCircle, Loader2 } from 'lucide-react';
import type { DailyRequisitionEntry } from '@/lib/types';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { diffFields } from '@/lib/activity-logger';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { RegistrationSelect, treatmentWarning, useBillRegistration } from '@/components/expenses/bill-registration';
import { registrationLabel } from '@/lib/gst-registrations';
import { checkGstin, suggestGstType } from '@/lib/statutory';

interface GstTdsVerificationDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  entry: DailyRequisitionEntry | null;
  onSuccess: () => void;
}

type GstType = 'igst' | 'cgst-sgst' | 'none';

export function GstTdsVerificationDialog({
  isOpen,
  onOpenChange,
  entry,
  onSuccess,
}: GstTdsVerificationDialogProps) {
  const { toast } = useToast();
  const { log } = useActivityLogger(ACTIVITY_MODULES.DAILY_REQUISITION);
  const [isLoading, setIsLoading] = useState(false);
  
  const [gstType, setGstType] = useState<GstType>('igst');
  const [gstPercentage, setGstPercentage] = useState(0);
  /** The company GST registration chosen on this bill; '' leaves it to the attribution chain. */
  const [gstRegistrationId, setGstRegistrationId] = useState('');

  const [originalNetAmount, setOriginalNetAmount] = useState(0);
  const [taxDetails, setTaxDetails] = useState({
    calculatedNetAmount: '0',
    igstAmount: '0',
    tdsAmount: '0',
    cgstAmount: '0',
    sgstAmount: '0',
    retentionAmount: '0',
    otherDeduction: '0',
    notes: '',
    gstNo: '',
  });

  /**
   * Which of the company's registrations this bill belongs to: the choice made here, else the
   * project's state, else the department's, else the default (src/lib/gst-registrations.ts). It is
   * that registration's state — not one hardcoded state — that decides CGST + SGST versus IGST.
   */
  const bill = useBillRegistration({
    gstRegistrationId,
    projectId: entry?.projectId,
    departmentId: entry?.departmentId,
  });
  const mismatch = gstType === 'none' ? null : treatmentWarning(bill, taxDetails.gstNo, gstType);

  useEffect(() => {
    if (entry) {
        const netAmt = entry.netAmount || entry.grossAmount || 0;
        setOriginalNetAmount(netAmt);
        setTaxDetails({
            calculatedNetAmount: String(netAmt),
            igstAmount: String(entry.igstAmount || 0),
            tdsAmount: String(entry.tdsAmount || 0),
            cgstAmount: String(entry.cgstAmount || 0),
            sgstAmount: String(entry.sgstAmount || 0),
            retentionAmount: String(entry.retentionAmount || 0),
            otherDeduction: String(entry.otherDeduction || 0),
            notes: entry.verificationNotes || '',
            gstNo: entry.gstNo || '',
        });
        // Carried from the expense request, or set at an earlier verification; '' = work it out.
        setGstRegistrationId(entry.gstRegistrationId || '');
        
        // Start from what the entry already carries (from its expense request, or an earlier
        // verification): the stored treatment and rate, else read back from the amounts. Resetting the
        // rate to 0 here used to recompute — and wipe — GST that had been entered upstream.
        const gross = entry.grossAmount || 0;
        const storedGst = (entry.igstAmount || 0) + (entry.cgstAmount || 0) + (entry.sgstAmount || 0);
        const type: GstType = entry.gstType
          ? entry.gstType
          : entry.igstAmount && entry.igstAmount > 0
            ? 'igst'
            : entry.cgstAmount && entry.cgstAmount > 0
              ? 'cgst-sgst'
              : 'none';
        setGstType(type);
        setGstPercentage(
          type === 'none'
            ? 0
            : typeof entry.gstRate === 'number' && entry.gstRate > 0
              ? entry.gstRate
              : gross > 0
                ? Math.round((storedGst / gross) * 10000) / 100
                : 0,
        );
    }
  }, [entry]);
  
  const handleInputChange = (field: keyof typeof taxDetails, value: string) => {
    setTaxDetails(prev => ({ ...prev, [field]: value }));
  };

  /** Another registration can make the same bill inter-state, so the split is suggested afresh. */
  const onRegistrationChange = (next: string) => {
    setGstRegistrationId(next);
    const supplier = checkGstin(taxDetails.gstNo);
    const chosen = next ? bill.options.find(registration => registration.id === next) ?? null : bill.automatic;
    if (gstType !== 'none' && supplier.valid && supplier.stateCode && chosen?.stateCode) {
      setGstType(suggestGstType(supplier.stateCode, chosen.stateCode));
    }
  };

  const amountMismatch = useMemo(() => {
    if (!entry) return false;
    // Use a small tolerance for floating point comparisons
    return Math.abs(parseFloat(taxDetails.calculatedNetAmount) - originalNetAmount) > 0.01;
  }, [taxDetails.calculatedNetAmount, originalNetAmount, entry]);


  useEffect(() => {
    if (!entry) return;

    const grossAmount = entry.grossAmount || 0;
    const tds = parseFloat(taxDetails.tdsAmount) || 0;
    const retention = parseFloat(taxDetails.retentionAmount) || 0;
    const otherDeduction = parseFloat(taxDetails.otherDeduction) || 0;
    let igst = 0;
    let cgst = 0;
    let sgst = 0;

    if (gstType === 'none') {
        setGstPercentage(0);
        setTaxDetails(prev => ({ ...prev, gstNo: '', igstAmount: '0', cgstAmount: '0', sgstAmount: '0' }));
    } else if (gstType === 'igst') {
        igst = (grossAmount * gstPercentage) / 100;
        setTaxDetails(prev => ({ ...prev, igstAmount: String(igst.toFixed(2)), cgstAmount: '0', sgstAmount: '0' }));
    } else { // cgst-sgst
        cgst = (grossAmount * gstPercentage) / 200; // Split percentage
        sgst = (grossAmount * gstPercentage) / 200;
        setTaxDetails(prev => ({ ...prev, igstAmount: '0', cgstAmount: String(cgst.toFixed(2)), sgstAmount: String(sgst.toFixed(2)) }));
    }
    
    const totalGst = igst + cgst + sgst;
    // Under reverse charge the company pays the GST to the government, not to the supplier.
    const calculatedNetAmount = grossAmount + (entry.reverseCharge ? 0 : totalGst) - tds - retention - otherDeduction;
    
    setTaxDetails(prev => ({ ...prev, calculatedNetAmount: String(calculatedNetAmount.toFixed(2)) }));

  }, [gstType, gstPercentage, taxDetails.tdsAmount, taxDetails.retentionAmount, taxDetails.otherDeduction, entry]);


  const handleVerify = async () => {
    if (!entry) return;
    setIsLoading(true);

    const newStatus = amountMismatch ? 'Needs Review' : 'Verified';
    const successMessage = amountMismatch 
      ? `Entry marked for review due to amount mismatch.`
      : `Entry has been marked as verified.`;

    try {
      const updateData: any = {
        status: newStatus,
        verifiedAt: new Date(),
        igstAmount: parseFloat(taxDetails.igstAmount) || 0,
        tdsAmount: parseFloat(taxDetails.tdsAmount) || 0,
        cgstAmount: parseFloat(taxDetails.cgstAmount) || 0,
        sgstAmount: parseFloat(taxDetails.sgstAmount) || 0,
        retentionAmount: parseFloat(taxDetails.retentionAmount) || 0,
        otherDeduction: parseFloat(taxDetails.otherDeduction) || 0,
        verificationNotes: taxDetails.notes,
        gstNo: gstType === 'none' ? '' : taxDetails.gstNo,
        gstType,
        gstRate: gstType === 'none' ? 0 : gstPercentage,
      };

      // Written only where there is something to choose and the choice has moved, so a one-state
      // company's verification diff reads exactly as it did before.
      if (bill.canChoose && (entry.gstRegistrationId || '') !== gstRegistrationId) {
        updateData.gstRegistrationId = gstRegistrationId;
      }

      // Only update the netAmount if it matches the original, otherwise preserve the old amount
      if (!amountMismatch) {
          updateData.netAmount = parseFloat(taxDetails.calculatedNetAmount) || 0;
      }

      await updateDoc(doc(db, 'dailyRequisitions', entry.id), updateData);

      // Audit: what the verifier changed. Only the tax / amount fields this dialog owns are
      // compared — status is reported separately as from/to, verifiedAt changes every time.
      const { status: _status, verifiedAt: _verifiedAt, ...taxAfter } = updateData;
      const taxBefore: Record<string, unknown> = {};
      for (const key of Object.keys(taxAfter)) taxBefore[key] = (entry as any)[key] ?? null;
      void log(
        newStatus === 'Verified' ? 'Verify GST & TDS' : 'Mark GST & TDS Needs Review',
        {
          receptionNo: entry.receptionNo ?? null,
          partyName: entry.partyName ?? null,
          grossAmount: entry.grossAmount ?? 0,
          from: entry.status ?? null,
          to: newStatus,
          ...(bill.canChoose ? { gstRegistration: registrationLabel(bill.registration) } : {}),
          amountMismatch,
          ...(amountMismatch
            ? { calculatedNetAmount: parseFloat(taxDetails.calculatedNetAmount) || 0, preservedNetAmount: originalNetAmount }
            : {}),
          changes: diffFields(taxBefore, taxAfter),
        },
        { recordId: entry.id, recordRef: entry.receptionNo || undefined },
      );

      toast({ title: 'Success', description: successMessage });
      onSuccess();
      onOpenChange(false);
    } catch (error) {
      console.error("Error verifying entry: ", error);
      toast({ title: 'Error', description: 'Failed to save verification details.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };
  
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  };

  if (!entry) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Verify Entry: {entry.receptionNo}</DialogTitle>
          <DialogDescription>Enter tax details to complete verification.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4 max-h-[70vh] overflow-y-auto pr-2">
            <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Project:</span>
                <span className="font-medium">{(entry as any).projectName || 'N/A'}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Gross Amount:</span>
                <span className="font-medium">{formatCurrency(entry.grossAmount)}</span>
            </div>
            {(entry.invoiceNo || entry.panNo || entry.tdsSection || entry.hsnSac || entry.reverseCharge) && (
              <div className="grid grid-cols-1 gap-1 rounded-md border bg-muted/30 p-3 text-xs sm:grid-cols-2">
                <span className="font-semibold text-muted-foreground sm:col-span-2">From the expense request</span>
                {entry.invoiceNo && <span>Invoice: <span className="font-medium">{entry.invoiceNo}</span>{entry.invoiceDate ? ` · ${entry.invoiceDate}` : ''}</span>}
                {entry.panNo && <span>PAN: <span className="font-mono font-medium">{entry.panNo}</span></span>}
                {entry.tdsSection && entry.tdsSection !== 'none' && <span>TDS: <span className="font-medium">{entry.tdsSection} @ {entry.tdsRate ?? 0}%</span></span>}
                {entry.hsnSac && <span>HSN / SAC: <span className="font-medium">{entry.hsnSac}</span></span>}
                {entry.reverseCharge && <span className="font-medium text-amber-700 sm:col-span-2">Reverse charge — GST is not added to the amount payable.</span>}
                {entry.otherDeductionReason && <span className="sm:col-span-2">Other deduction: {entry.otherDeductionReason}</span>}
              </div>
            )}
            
            <Separator />

            {bill.canChoose && (
              <div className="space-y-2">
                <Label htmlFor="gstRegistration">GST registration</Label>
                <RegistrationSelect id="gstRegistration" value={gstRegistrationId} onValueChange={onRegistrationChange} bill={bill} />
                <p className="text-xs text-muted-foreground">
                  {bill.registration ? (
                    <>
                      <span className="font-mono">{bill.registration.gstin}</span> · {bill.attribution.reason}
                    </>
                  ) : (
                    bill.attribution.reason
                  )}
                </p>
              </div>
            )}

             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>GST Type</Label>
                    <RadioGroup value={gstType} onValueChange={(value: GstType) => setGstType(value)} className="flex gap-4">
                        <div className="flex items-center space-x-2">
                            <RadioGroupItem value="igst" id="igst-radio" />
                            <Label htmlFor="igst-radio">IGST</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <RadioGroupItem value="cgst-sgst" id="cgst-sgst-radio" />
                            <Label htmlFor="cgst-sgst-radio">CGST/SGST</Label>
                        </div>
                         <div className="flex items-center space-x-2">
                            <RadioGroupItem value="none" id="none-radio" />
                            <Label htmlFor="none-radio">No GST</Label>
                        </div>
                    </RadioGroup>
                </div>
                 <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="gstPercentage">GST Rate (%)</Label>
                        <Input id="gstPercentage" type="number" value={gstPercentage} onChange={e => setGstPercentage(parseFloat(e.target.value) || 0)} disabled={gstType === 'none'}/>
                    </div>
                     <div className="space-y-2">
                        <Label htmlFor="gstNo">GST No.</Label>
                        <Input id="gstNo" type="text" value={taxDetails.gstNo} onChange={e => handleInputChange('gstNo', e.target.value)} disabled={gstType === 'none'} />
                    </div>
                </div>
            </div>

            {mismatch && (
              <p className="flex items-start gap-1.5 rounded-md bg-amber-50 px-2.5 py-2 text-xs font-medium text-amber-800">
                <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
                <span>
                  {mismatch.message}{' '}
                  <button type="button" className="underline hover:no-underline" onClick={() => setGstType(mismatch.expected as GstType)}>
                    Use {mismatch.expected === 'igst' ? 'IGST' : 'CGST/SGST'}
                  </button>
                </span>
              </p>
            )}

            <Separator />
            <p className="font-medium text-sm text-muted-foreground">Amounts:</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                    <Label htmlFor="igstAmount">IGST Amount</Label>
                    <Input id="igstAmount" type="number" value={taxDetails.igstAmount} readOnly />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="cgstAmount">CGST Amount</Label>
                    <Input id="cgstAmount" type="number" value={taxDetails.cgstAmount} readOnly />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="sgstAmount">SGST Amount</Label>
                    <Input id="sgstAmount" type="number" value={taxDetails.sgstAmount} readOnly />
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="tdsAmount">TDS Amount</Label>
                    <Input id="tdsAmount" type="number" value={taxDetails.tdsAmount} onChange={e => handleInputChange('tdsAmount', e.target.value)} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="retentionAmount">Retention Amount</Label>
                    <Input id="retentionAmount" type="number" value={taxDetails.retentionAmount} onChange={e => handleInputChange('retentionAmount', e.target.value)} />
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="otherDeduction">Other Deduction</Label>
                    <Input id="otherDeduction" type="number" value={taxDetails.otherDeduction} onChange={e => handleInputChange('otherDeduction', e.target.value)} />
                </div>
            </div>
            
            <Separator />
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                  <Label htmlFor="originalNetAmount">Original Net Amount</Label>
                  <Input id="originalNetAmount" type="text" value={formatCurrency(originalNetAmount)} readOnly className="font-medium text-muted-foreground" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="calculatedNetAmount">Calculated Net Amount</Label>
                <Input id="calculatedNetAmount" type="number" value={taxDetails.calculatedNetAmount} readOnly className="font-bold text-lg h-12" />
              </div>
            </div>

            {amountMismatch && (
                <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Amount Mismatch</AlertTitle>
                    <AlertDescription>
                        The calculated net amount does not match the original amount. Saving will mark this entry for review with the original amount preserved.
                    </AlertDescription>
                </Alert>
            )}

            <div className="space-y-2">
                <Label htmlFor="notes">Notes (Optional)</Label>
                <Textarea id="notes" value={taxDetails.notes} onChange={e => handleInputChange('notes', e.target.value)} />
            </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={handleVerify} disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {amountMismatch ? 'Mark for Review' : 'Mark as Verified'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
