
'use client';

import { useState, useRef, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { db, storage } from '@/lib/firebase';
import { doc, updateDoc, collection, addDoc, Timestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Loader2, Calendar as CalendarIcon, Upload, File as FileIcon, X, RotateCw } from 'lucide-react';
import type { InsurancePolicy, PolicyRenewal } from '@/lib/types';
import { format, addMonths, addQuarters, addYears } from 'date-fns';
import { cn } from '@/lib/utils';
import { useAuth } from './auth/AuthProvider';

interface RenewalDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  policy: InsurancePolicy;
  onSuccess: () => void;
  defaultPaymentDate?: Date;
}

export function RenewalDialog({ isOpen, onOpenChange, policy, onSuccess, defaultPaymentDate }: RenewalDialogProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [isSaving, setIsSaving] = useState(false);
  
  const [paymentDate, setPaymentDate] = useState<Date | undefined>(defaultPaymentDate || new Date());
  const [receiptDate, setReceiptDate] = useState<Date | undefined>(new Date());
  const [paymentType, setPaymentType] = useState('');
  const [remarks, setRemarks] = useState('');
  const [renewalCopy, setRenewalCopy] = useState<File | null>(null);

  useEffect(() => {
    if (isOpen) {
      setPaymentDate(defaultPaymentDate || new Date());
      setReceiptDate(new Date());
      setPaymentType('');
      setRemarks('');
      setRenewalCopy(null);
    }
  }, [isOpen, defaultPaymentDate]);

  const handleSave = async () => {
    if (!paymentDate || !receiptDate || !paymentType) {
      toast({ title: "Validation Error", description: "Please fill all required fields.", variant: "destructive" });
      return;
    }
    if (!user) {
        toast({ title: 'Authentication Error', description: 'You must be logged in.', variant: 'destructive' });
        return;
    }
    
    setIsSaving(true);
    
    try {
        let renewalCopyUrl: string | undefined = undefined;
        if (renewalCopy) {
            const storageRef = ref(storage, `insurance-renewals/${policy.id}/${renewalCopy.name}`);
            await uploadBytes(storageRef, renewalCopy);
            renewalCopyUrl = await getDownloadURL(storageRef);
        }
        
        const renewalData: Omit<PolicyRenewal, 'id'> = {
            policyId: policy.id,
            renewalDate: Timestamp.now(),
            paymentDate: Timestamp.fromDate(paymentDate),
            receiptDate: Timestamp.fromDate(receiptDate),
            paymentType,
            remarks,
            renewalCopyUrl,
            renewedBy: user.id,
        };

        await addDoc(collection(db, 'insurance_policies', policy.id, 'renewals'), renewalData);

        // Calculate next due date
        let nextDueDate: Date | null = null;
        if(policy.due_date){
            const currentDueDate = policy.due_date.toDate ? policy.due_date.toDate() : new Date(policy.due_date);
            switch (policy.payment_type) {
                case 'Monthly': nextDueDate = addMonths(currentDueDate, 1); break;
                case 'Quarterly': nextDueDate = addQuarters(currentDueDate, 1); break;
                case 'Yearly': nextDueDate = addYears(currentDueDate, 1); break;
                default: break;
            }
        }
        
        const policyRef = doc(db, 'insurance_policies', policy.id);
        const maturityDate = policy.date_of_maturity?.toDate ? policy.date_of_maturity.toDate() : new Date(policy.date_of_maturity);
        const willBeMature = nextDueDate && nextDueDate > maturityDate;


        await updateDoc(policyRef, {
            due_date: nextDueDate && !willBeMature ? Timestamp.fromDate(nextDueDate) : null
        });

        toast({ title: "Success", description: "Policy renewal recorded successfully." });
        onSuccess(); // Refresh the list in the parent component
        onOpenChange(false);
    } catch (error) {
        console.error("Error saving renewal:", error);
        toast({ title: "Error", description: "Failed to save renewal details.", variant: "destructive" });
    } finally {
        setIsSaving(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setRenewalCopy(e.target.files[0]);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Renew Policy: {policy.policy_no}</DialogTitle>
          <DialogDescription>
            Record the payment details for this premium.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
           <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Date of Payment</Label>
                <Popover>
                    <PopoverTrigger asChild>
                        <Button variant="outline" className="w-full justify-start font-normal">
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {paymentDate ? format(paymentDate, 'PPP') : 'Select date'}
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                        <Calendar 
                            mode="single" 
                            selected={paymentDate} 
                            onSelect={setPaymentDate} 
                            initialFocus 
                            captionLayout="dropdown-buttons"
                            fromYear={1980}
                            toYear={new Date().getFullYear() + 5}
                        />
                    </PopoverContent>
                </Popover>
              </div>
               <div className="space-y-2">
                <Label>Date of Receipt</Label>
                 <Popover>
                    <PopoverTrigger asChild>
                        <Button variant="outline" className="w-full justify-start font-normal">
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {receiptDate ? format(receiptDate, 'PPP') : 'Select date'}
                        </Button>
                    </PopoverTrigger>
                     <PopoverContent className="w-auto p-0">
                        <Calendar 
                            mode="single" 
                            selected={receiptDate} 
                            onSelect={setReceiptDate} 
                            initialFocus 
                            captionLayout="dropdown-buttons"
                            fromYear={1980}
                            toYear={new Date().getFullYear() + 5}
                        />
                    </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-2">
                <Label>Payment Type</Label>
                <Select onValueChange={setPaymentType}>
                    <SelectTrigger><SelectValue placeholder="Select payment type" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="Cash">Cash</SelectItem>
                        <SelectItem value="Card">Card</SelectItem>
                        <SelectItem value="Net Banking">Net Banking</SelectItem>
                        <SelectItem value="UPI">UPI</SelectItem>
                        <SelectItem value="Auto Debit">Auto Debit</SelectItem>
                    </SelectContent>
                </Select>
              </div>
               <div className="space-y-2">
                  <Label>Renewal Copy</Label>
                  <Input type="file" onChange={handleFileChange} />
                  {renewalCopy && (
                     <div className="text-xs text-muted-foreground flex items-center gap-2">
                        <FileIcon className="h-3 w-3" />
                        <span>{renewalCopy.name}</span>
                        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setRenewalCopy(null)}><X className="h-3 w-3" /></Button>
                     </div>
                  )}
               </div>
           </div>
            <div className="space-y-2">
              <Label>Remarks</Label>
              <Textarea placeholder="Add any relevant remarks..." value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Renewal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
