
'use client';

import { useState, useEffect, useMemo, useCallback, useId } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, Library, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import {
  collection,
  addDoc,
  getDocs,
  doc,
  query,
  where,
  serverTimestamp,
  getDoc,
  updateDoc,
  collectionGroup,
} from 'firebase/firestore';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { BillItem, WorkOrder, WorkOrderItem, JmcEntry, Project, Bill, ProformaBill } from '@/lib/types';
import { useParams, useRouter, notFound } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { WorkOrderItemSelectorDialog } from '@/components/subcontractors-management/WorkOrderItemSelectorDialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';

const slugify = (text: string) => {
  if (!text) return '';
  return text
    .toString()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
};

type EnrichedBillItem = BillItem & {
  orderQty: number;
  jmcCertifiedQty: number;
  alreadyBilledQty: number;
};

type AdvanceDeductionItem = {
  id: string;
  reference: string;
  deductionType: 'amount' | 'percentage';
  deductionValue: number;
  amount: number;
};

export default function EditBillPage() {
  const { toast } = useToast();
  const router = useRouter();
  const { project: projectSlug, billId } = useParams() as { project: string; billId: string };
  const advanceDeductionId = useId();

  const [bill, setBill] = useState<Bill | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [workOrder, setWorkOrder] = useState<WorkOrder | null>(null);
  
  // States for financial calculations
  const [gstType, setGstType] = useState<'percentage' | 'manual'>('percentage');
  const [gstPercentage, setGstPercentage] = useState<number>(18);
  const [gstAmount, setGstAmount] = useState<number>(0);
  const [retentionType, setRetentionType] = useState<'percentage' | 'manual'>('percentage');
  const [retentionPercentage, setRetentionPercentage] = useState<number>(5);
  const [manualRetentionAmount, setManualRetentionAmount] = useState<number>(0);
  const [otherDeduction, setOtherDeduction] = useState<number>(0);
  const [advanceDeductions, setAdvanceDeductions] = useState<AdvanceDeductionItem[]>([]);

  useEffect(() => {
    const fetchBill = async () => {
        if (!billId) return;
        setIsLoading(true);
        try {
            const billsQuery = query(collectionGroup(db, 'bills'), where('__name__', '==', `projects/${projectSlug}/bills/${billId}`));
            const billSnapshot = await getDocs(billsQuery);

            if (billSnapshot.empty) {
                 const billsQueryFallback = query(collectionGroup(db, 'bills'), where('__name__', '==', `projects/${currentProject?.id}/bills/${billId}`));
                 const billSnapshotFallback = await getDocs(billsQuery);
                 if(billSnapshotFallback.empty) {
                    toast({ title: 'Bill not found', variant: 'destructive' });
                    notFound();
                    return;
                 }
            }
            
            const billDocSnap = billSnapshot.docs[0];
            const billData = { id: billDocSnap.id, ...billDocSnap.data() } as Bill;
            setBill(billData);

            // Fetch related project
            const projectRef = doc(db, 'projects', billData.projectId);
            const projectSnap = await getDoc(projectRef);
            if (projectSnap.exists()) {
              setCurrentProject({id: projectSnap.id, ...projectSnap.data()} as Project);
            }

            setGstType(billData.gstType || 'percentage');
            setGstPercentage(billData.gstPercentage ?? 18);
            setGstAmount(billData.gstAmount || 0);
            setRetentionType(billData.retentionType || 'percentage');
            setRetentionPercentage(billData.retentionPercentage ?? 5);
            setManualRetentionAmount(billData.retentionAmount || 0);
            setOtherDeduction(billData.otherDeduction || 0);
            setAdvanceDeductions((billData.advanceDeductions || []).map(ad => ({...ad, id: `adv-${advanceDeductionId}-${Math.random()}`})));

            const woDocRef = doc(db, 'projects', billData.projectId, 'workOrders', billData.workOrderId);
            const woDocSnap = await getDoc(woDocRef);
            if(woDocSnap.exists()) {
              setWorkOrder({id: woDocSnap.id, ...woDocSnap.data()} as WorkOrder);
            }

        } catch (error) {
            console.error("Error fetching bill data:", error);
            toast({ title: 'Error', description: 'Failed to load bill data.', variant: 'destructive' });
        }
        setIsLoading(false);
    };
    fetchBill();
  }, [projectSlug, billId, toast, notFound, currentProject]);

  const handleItemChange = (index: number, field: 'billedQty', value: string) => {
    if (!bill) return;
    const newItems = [...bill.items];
    const item = { ...newItems[index] };
    const billedQty = parseFloat(value);
    
    if (isNaN(billedQty) || billedQty < 0) {
      item.billedQty = '';
      item.totalAmount = '';
    } else {
      item.billedQty = value;
      const rate = parseFloat(item.rate);
      if (!isNaN(rate)) {
        item.totalAmount = (billedQty * rate).toFixed(2);
      }
    }
    newItems[index] = item;
    setBill({ ...bill, items: newItems });
  };
  
  const removeItem = (index: number) => {
    if (!bill) return;
    const newItems = bill.items.filter((_, i) => i !== index);
    setBill({ ...bill, items: newItems });
  };
  
   const financials = useMemo(() => {
    if (!bill) return { subtotal: 0, finalGstAmount: 0, grossAmount: 0, finalRetentionAmount: 0, totalDeductions: 0, netPayable: 0, totalAdvanceDeduction: 0, otherDeduction: 0 };
    
    const subtotal = bill.items.reduce((sum, item) => sum + parseFloat(item.totalAmount || '0'), 0);
    const finalGstAmount = gstType === 'percentage' ? (subtotal * (gstPercentage / 100)) : gstAmount;
    const finalRetentionAmount = retentionType === 'percentage' ? (subtotal * (retentionPercentage / 100)) : manualRetentionAmount;
    const totalAdvanceDeduction = advanceDeductions.reduce((sum, adv) => sum + (adv.amount || 0), 0);
    const grossAmount = subtotal + finalGstAmount;
    const totalDeductions = finalRetentionAmount + totalAdvanceDeduction + otherDeduction;
    const netPayable = grossAmount - totalDeductions;
    return { subtotal, finalGstAmount, grossAmount, finalRetentionAmount, totalDeductions, netPayable, totalAdvanceDeduction, otherDeduction };
  }, [bill, gstType, gstPercentage, gstAmount, retentionType, retentionPercentage, manualRetentionAmount, otherDeduction, advanceDeductions]);


  const handleSave = async () => {
    if (!bill || !currentProject) return;
    setIsSaving(true);
    try {
      const billRef = doc(db, 'projects', currentProject.id, 'bills', billId);
      const { id, ...dataToUpdate } = {
        ...bill,
        items: bill.items.map(item => {
          const { id: itemId, ...rest } = item as any; // remove client-side id if present
          return rest;
        }),
        subtotal: financials.subtotal,
        gstType,
        gstPercentage: gstType === 'percentage' ? gstPercentage : null,
        gstAmount: financials.finalGstAmount,
        grossAmount: financials.grossAmount,
        retentionType,
        retentionPercentage: retentionType === 'percentage' ? retentionPercentage : null,
        retentionAmount: financials.finalRetentionAmount,
        otherDeduction: otherDeduction,
        advanceDeductions: advanceDeductions.map(ad => ({...ad, id: undefined })), // remove client-side id
        totalDeductions: financials.totalDeductions,
        netPayable: financials.netPayable,
        totalAmount: financials.netPayable,
      };

      await updateDoc(billRef, dataToUpdate);

      toast({ title: 'Bill Updated', description: 'The bill has been successfully updated.' });
      router.push(`/subcontractors-management/${projectSlug}/billing/log`);
    } catch (error) {
      console.error("Error updating bill: ", error);
      toast({ title: 'Update Failed', description: 'An error occurred while saving the bill.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const formatCurrency = (amount: number | string) => {
    const num = parseFloat(String(amount));
    if (isNaN(num)) return formatCurrency(0);
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(num);
  };
  
   if (isLoading) {
    return <div className="p-8"><Skeleton className="w-full h-96"/></div>;
  }
  
  if (!bill) {
      return <div className="p-8">Bill not found.</div>;
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href={`/subcontractors-management/${projectSlug}/billing/log`}>
            <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
          </Link>
          <h1 className="text-2xl font-bold">Edit Bill: {bill.billNo}</h1>
        </div>
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Update Bill
        </Button>
      </div>

      {/* Bill Items */}
       <Card>
          <CardHeader><CardTitle>Bill Items</CardTitle></CardHeader>
          <CardContent>
              <div className="overflow-x-auto">
                  <Table>
                      <TableHeader>
                          <TableRow>
                              <TableHead>BOQ Sl. No.</TableHead>
                              <TableHead>Description</TableHead>
                              <TableHead>Billed Qty</TableHead>
                              <TableHead>Rate</TableHead>
                              <TableHead>Total Amount</TableHead>
                              <TableHead>Action</TableHead>
                          </TableRow>
                      </TableHeader>
                      <TableBody>
                          {bill.items.map((item, index) => (
                              <TableRow key={item.jmcItemId}>
                                  <TableCell>{item.boqSlNo}</TableCell>
                                  <TableCell>{item.description}</TableCell>
                                  <TableCell>
                                      <Input 
                                        type="number" 
                                        value={item.billedQty}
                                        onChange={(e) => handleItemChange(index, 'billedQty', e.target.value)}
                                        className="w-24"
                                      />
                                  </TableCell>
                                  <TableCell>{formatCurrency(item.rate)}</TableCell>
                                  <TableCell>{formatCurrency(item.totalAmount)}</TableCell>
                                  <TableCell>
                                      <Button variant="ghost" size="icon" onClick={() => removeItem(index)}>
                                          <Trash2 className="h-4 w-4 text-destructive" />
                                      </Button>
                                  </TableCell>
                              </TableRow>
                          ))}
                      </TableBody>
                  </Table>
              </div>
          </CardContent>
        </Card>
      
      {/* Financial Summary */}
      <Card className="mt-6">
        <CardHeader><CardTitle>Financial Summary</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* GST & Deductions */}
            <div className="space-y-6">
                 <div>
                    <Label>GST</Label>
                    <RadioGroup value={gstType} onValueChange={(v) => setGstType(v as any)} className="flex gap-4 mt-2">
                        <div className="flex items-center space-x-2"><RadioGroupItem value="percentage" id="gst-percentage" /><Label htmlFor="gst-percentage">Percentage</Label></div>
                        <div className="flex items-center space-x-2"><RadioGroupItem value="manual" id="gst-manual" /><Label htmlFor="gst-manual">Manual</Label></div>
                    </RadioGroup>
                    {gstType === 'percentage' ? (
                        <div className="flex items-center gap-2 mt-2"><Input type="number" value={gstPercentage} onChange={e => setGstPercentage(parseFloat(e.target.value) || 0)} /><span className="text-muted-foreground">%</span></div>
                    ) : (
                        <Input type="number" value={gstAmount} onChange={e => setGstAmount(parseFloat(e.target.value) || 0)} className="mt-2" />
                    )}
                </div>
                 <Separator />
                <div>
                    <Label>Deductions</Label>
                    <div className="space-y-2 mt-2">
                        <Label>Retention</Label>
                        <RadioGroup value={retentionType} onValueChange={(v) => setRetentionType(v as any)} className="flex gap-4">
                            <div className="flex items-center space-x-2"><RadioGroupItem value="percentage" id="ret-percentage" /><Label htmlFor="ret-percentage">Percentage</Label></div>
                            <div className="flex items-center space-x-2"><RadioGroupItem value="manual" id="ret-manual" /><Label htmlFor="ret-manual">Manual</Label></div>
                        </RadioGroup>
                        {retentionType === 'percentage' ? (
                            <div className="flex items-center gap-2 mt-2"><Input type="number" value={retentionPercentage} onChange={e => setRetentionPercentage(parseFloat(e.target.value) || 0)} /><span className="text-muted-foreground">%</span></div>
                        ) : (
                            <Input type="number" value={manualRetentionAmount} onChange={e => setManualRetentionAmount(parseFloat(e.target.value) || 0)} className="mt-2" />
                        )}
                    </div>
                     <div className="space-y-2 mt-4">
                        <Label>Other Deductions</Label>
                        <Input type="number" value={otherDeduction} onChange={(e) => setOtherDeduction(Number(e.target.value) || 0)} />
                    </div>
                </div>
            </div>
            {/* Summary Table */}
             <div className="space-y-3 p-4 bg-muted/50 rounded-lg">
                <div className="flex justify-between items-center text-sm"><span className="text-muted-foreground">Subtotal</span><span className="font-medium">{formatCurrency(financials.subtotal)}</span></div>
                <div className="flex justify-between items-center text-sm"><span className="text-muted-foreground">GST</span><span className="font-medium">{formatCurrency(financials.finalGstAmount)}</span></div>
                <Separator />
                <div className="flex justify-between font-semibold"><span>Gross Amount</span><span>{formatCurrency(financials.grossAmount)}</span></div>
                <div className="flex justify-between text-sm text-destructive"><span className="text-muted-foreground">Retention</span><span className="font-medium">-{formatCurrency(financials.finalRetentionAmount)}</span></div>
                <div className="flex justify-between text-sm text-destructive"><span className="text-muted-foreground">Advance Deductions</span><span className="font-medium">-{formatCurrency(financials.totalAdvanceDeduction)}</span></div>
                <div className="flex justify-between text-sm text-destructive"><span className="text-muted-foreground">Other Deductions</span><span className="font-medium">-{formatCurrency(financials.otherDeduction)}</span></div>
                <Separator />
                <div className="flex justify-between font-bold text-lg"><span>Net Payable Amount</span><span>{formatCurrency(financials.netPayable)}</span></div>
            </div>
        </CardContent>
      </Card>
    </div>
  );
}
