

'use client';

import { useState, useEffect } from 'react';
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
import { useToast } from '@/hooks/use-toast';
import { db, storage } from '@/lib/firebase';
import { doc, updateDoc, addDoc, collection, Timestamp, runTransaction } from 'firebase/firestore';
import { Loader2, Calendar as CalendarIcon, Upload, File as FileIcon, X } from 'lucide-react';
import type { ProjectInsurancePolicy } from '@/lib/types';
import { format, addYears, addMonths, addDays } from 'date-fns';
import { useAuth } from './auth/AuthProvider';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Calendar } from './ui/calendar';
import { cn } from '@/lib/utils';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

interface ProjectRenewalDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  policy: ProjectInsurancePolicy;
  onSuccess: () => void;
}

export function ProjectRenewalDialog({ isOpen, onOpenChange, policy, onSuccess }: ProjectRenewalDialogProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [isSaving, setIsSaving] = useState(false);
  const [renewalCopy, setRenewalCopy] = useState<File | null>(null);
  
  const [renewalData, setRenewalData] = useState({
    newPolicyNo: policy.policy_no,
    newPremium: policy.premium,
    newSumInsured: policy.sum_insured,
    newStartDate: policy.insured_until ? addDays(policy.insured_until.toDate(), 1) : new Date(),
    newTenureYears: policy.tenure_years,
    newTenureMonths: policy.tenure_months,
  });

  const [newEndDate, setNewEndDate] = useState<Date | undefined>();

  useEffect(() => {
    if (isOpen) {
      setRenewalData({
        newPolicyNo: policy.policy_no,
        newPremium: policy.premium,
        newSumInsured: policy.sum_insured,
        newStartDate: policy.insured_until ? addDays(policy.insured_until.toDate(), 1) : new Date(),
        newTenureYears: policy.tenure_years,
        newTenureMonths: policy.tenure_months,
      });
      setRenewalCopy(null);
    }
  }, [isOpen, policy]);
  
  useEffect(() => {
    const { newStartDate, newTenureYears, newTenureMonths } = renewalData;
    if (newStartDate && (newTenureYears > 0 || newTenureMonths > 0)) {
        let endDate = addYears(newStartDate, newTenureYears);
        endDate = addMonths(endDate, newTenureMonths);
        setNewEndDate(endDate);
    } else {
        setNewEndDate(undefined);
    }
  }, [renewalData.newStartDate, renewalData.newTenureYears, renewalData.newTenureMonths]);


  const handleInputChange = (field: keyof typeof renewalData, value: string | number) => {
    setRenewalData(prev => ({ ...prev, [field]: value }));
  };
  
  const handleDateChange = (date: Date | undefined) => {
      setRenewalData(prev => ({...prev, newStartDate: date || new Date()}));
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setRenewalCopy(e.target.files[0]);
    }
  };

  const handleSave = async () => {
    if (!user || !newEndDate) {
      toast({ title: "Error", description: "User not logged in or missing renewal details.", variant: "destructive" });
      return;
    }
    setIsSaving(true);
    
    try {
        let renewalCopyUrl: string | undefined = undefined;
        if (renewalCopy) {
            const storagePath = `project-renewals/${policy.id}/${renewalCopy.name}`;
            const storageRef = ref(storage, storagePath);
            await uploadBytes(storageRef, renewalCopy);
            renewalCopyUrl = await getDownloadURL(storageRef);
        }

        await runTransaction(db, async (transaction) => {
            const policyRef = doc(db, 'project_insurance_policies', policy.id);
            const historyRef = doc(collection(db, 'project_insurance_policies', policy.id, 'history'));

            // 1. Archive the current state
            const oldPolicyData = {
                renewalDate: Timestamp.now(),
                renewedBy: user.id,
                policyNo: policy.policy_no,
                premium: policy.premium,
                sumInsured: policy.sum_insured,
                startDate: policy.insurance_start_date,
                endDate: policy.insured_until,
                renewalCopyUrl: renewalCopyUrl,
            };
            transaction.set(historyRef, oldPolicyData);
            
            // 2. Update the main policy document with new details
            const updatedPolicyData = {
                policy_no: renewalData.newPolicyNo,
                premium: renewalData.newPremium,
                sum_insured: renewalData.newSumInsured,
                insurance_start_date: Timestamp.fromDate(renewalData.newStartDate),
                insured_until: Timestamp.fromDate(newEndDate),
                tenure_years: renewalData.newTenureYears,
                tenure_months: renewalData.newTenureMonths,
            };
            transaction.update(policyRef, updatedPolicyData);
        });

        toast({ title: "Success", description: "Policy renewed successfully." });
        onSuccess();
        onOpenChange(false);
    } catch (error) {
        console.error("Error renewing policy:", error);
        toast({ title: "Error", description: "Failed to renew policy.", variant: "destructive" });
    } finally {
        setIsSaving(false);
    }
  };
  
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Renew Project Policy</DialogTitle>
          <DialogDescription>
            Enter the details for the renewed policy period.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
           <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                  <Label>New Policy No.</Label>
                  <Input value={renewalData.newPolicyNo} onChange={e => handleInputChange('newPolicyNo', e.target.value)} />
              </div>
              <div className="space-y-2">
                  <Label>New Premium</Label>
                  <Input type="number" value={renewalData.newPremium} onChange={e => handleInputChange('newPremium', e.target.valueAsNumber)} />
              </div>
              <div className="space-y-2">
                  <Label>New Sum Insured</Label>
                  <Input type="number" value={renewalData.newSumInsured} onChange={e => handleInputChange('newSumInsured', e.target.valueAsNumber)} />
              </div>
               <div className="space-y-2">
                  <Label>New Start Date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full justify-start font-normal">
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {renewalData.newStartDate ? format(renewalData.newStartDate, 'PPP') : 'Select date'}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                        <Calendar mode="single" selected={renewalData.newStartDate} onSelect={handleDateChange} initialFocus />
                    </PopoverContent>
                  </Popover>
               </div>
           </div>
           <div className="flex items-end gap-2">
                <div className="flex-1 space-y-2">
                    <Label>New Tenure (Years)</Label>
                    <Input type="number" value={renewalData.newTenureYears} onChange={e => handleInputChange('newTenureYears', e.target.valueAsNumber)} />
                </div>
                <div className="flex-1 space-y-2">
                    <Label>New Tenure (Months)</Label>
                    <Input type="number" value={renewalData.newTenureMonths} onChange={e => handleInputChange('newTenureMonths', e.target.valueAsNumber)} />
                </div>
            </div>
            <div className="space-y-2">
              <Label>New End Date (Auto-calculated)</Label>
              <Input value={newEndDate ? format(newEndDate, 'dd MMM, yyyy') : 'N/A'} readOnly />
            </div>
            <div className="space-y-2">
              <Label>Renewal Copy</Label>
              <Input type="file" onChange={handleFileChange} />
              {renewalCopy && (
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <FileIcon className="h-3 w-3" />
                    <span>{renewalCopy.name}</span>
                    <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setRenewalCopy(null)}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
              )}
            </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>Cancel</Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Renewal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
