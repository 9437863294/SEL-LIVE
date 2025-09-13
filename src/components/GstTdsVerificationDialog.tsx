
'use client';

import { useState, useEffect } from 'react';
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
import { Loader2 } from 'lucide-react';
import type { DailyRequisitionEntry } from '@/lib/types';
import { RadioGroup, RadioGroupItem } from './ui/radio-group';

interface GstTdsVerificationDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  entry: DailyRequisitionEntry | null;
  onSuccess: () => void;
}

type GstType = 'igst' | 'cgst-sgst';

export function GstTdsVerificationDialog({
  isOpen,
  onOpenChange,
  entry,
  onSuccess,
}: GstTdsVerificationDialogProps) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  
  const [gstType, setGstType] = useState<GstType>('igst');
  const [gstPercentage, setGstPercentage] = useState(0);

  const [taxDetails, setTaxDetails] = useState({
    netAmount: '0',
    igstAmount: '0',
    tdsAmount: '0',
    cgstAmount: '0',
    sgstAmount: '0',
    retentionAmount: '0',
    notes: '',
  });

  useEffect(() => {
    if (entry) {
        // Reset state when a new entry is passed in
        const netAmt = entry.netAmount || entry.grossAmount || 0;
        setTaxDetails({
            netAmount: String(netAmt),
            igstAmount: String(entry.igstAmount || 0),
            tdsAmount: String(entry.tdsAmount || 0),
            cgstAmount: String(entry.cgstAmount || 0),
            sgstAmount: String(entry.sgstAmount || 0),
            retentionAmount: String(entry.retentionAmount || 0),
            notes: entry.verificationNotes || '',
        });
        setGstPercentage(0);
        setGstType('igst');
    }
  }, [entry]);
  
  useEffect(() => {
    if (!entry) return;

    const grossAmount = entry.grossAmount || 0;
    const tds = parseFloat(taxDetails.tdsAmount) || 0;
    const retention = parseFloat(taxDetails.retentionAmount) || 0;
    let igst = 0;
    let cgst = 0;
    let sgst = 0;

    if (gstType === 'igst') {
        igst = (grossAmount * gstPercentage) / 100;
        setTaxDetails(prev => ({ ...prev, igstAmount: String(igst), cgstAmount: '0', sgstAmount: '0' }));
    } else { // cgst-sgst
        cgst = (grossAmount * gstPercentage) / 200; // Split percentage
        sgst = (grossAmount * gstPercentage) / 200;
        setTaxDetails(prev => ({ ...prev, igstAmount: '0', cgstAmount: String(cgst), sgstAmount: String(sgst) }));
    }
    
    const totalGst = igst + cgst + sgst;
    const netAmount = grossAmount + totalGst - tds - retention;
    
    setTaxDetails(prev => ({ ...prev, netAmount: String(netAmount) }));

  }, [gstType, gstPercentage, taxDetails.tdsAmount, taxDetails.retentionAmount, entry]);


  const handleInputChange = (field: keyof typeof taxDetails, value: string) => {
    setTaxDetails(prev => ({ ...prev, [field]: value }));
  };

  const handleVerify = async () => {
    if (!entry) return;
    setIsLoading(true);
    try {
      await updateDoc(doc(db, 'dailyRequisitions', entry.id), {
        status: 'Verified',
        verifiedAt: new Date(),
        netAmount: parseFloat(taxDetails.netAmount) || 0,
        igstAmount: parseFloat(taxDetails.igstAmount) || 0,
        tdsAmount: parseFloat(taxDetails.tdsAmount) || 0,
        cgstAmount: parseFloat(taxDetails.cgstAmount) || 0,
        sgstAmount: parseFloat(taxDetails.sgstAmount) || 0,
        retentionAmount: parseFloat(taxDetails.retentionAmount) || 0,
        verificationNotes: taxDetails.notes,
      });
      toast({ title: 'Success', description: 'Entry has been marked as verified.' });
      onSuccess();
      onOpenChange(false);
    } catch (error) {
      console.error("Error verifying entry: ", error);
      toast({ title: 'Error', description: 'Failed to verify the entry.', variant: 'destructive' });
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Verify Entry: {entry.receptionNo}</DialogTitle>
          <DialogDescription>Enter tax details to complete verification.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
            <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Project:</span>
                <span className="font-medium">{(entry as any).projectName || 'N/A'}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Gross Amount:</span>
                <span className="font-medium">{formatCurrency(entry.grossAmount)}</span>
            </div>
            
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
                </RadioGroup>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label htmlFor="gstPercentage">GST Rate (%)</Label>
                    <Input id="gstPercentage" type="number" value={gstPercentage} onChange={e => setGstPercentage(parseFloat(e.target.value) || 0)} />
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="tdsAmount">TDS Amount</Label>
                    <Input id="tdsAmount" type="number" value={taxDetails.tdsAmount} onChange={e => handleInputChange('tdsAmount', e.target.value)} />
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
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
                    <Label htmlFor="retentionAmount">Retention Amount</Label>
                    <Input id="retentionAmount" type="number" value={taxDetails.retentionAmount} onChange={e => handleInputChange('retentionAmount', e.target.value)} />
                </div>
            </div>
             <div className="space-y-2">
                <Label htmlFor="netAmount">Net Amount</Label>
                <Input id="netAmount" type="number" value={taxDetails.netAmount} readOnly />
            </div>

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
            Mark as Verified
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

