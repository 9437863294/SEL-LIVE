
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, Plus, Trash2, Library } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs, doc, query, where, serverTimestamp, runTransaction, getDoc, Timestamp } from 'firebase/firestore';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { BillItem, WorkOrder, WorkOrderItem, JmcEntry, Project, Bill, ProformaBill, WorkflowStep, ActionLog, Subcontractor } from '@/lib/types';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { WorkOrderItemSelectorDialog } from '@/components/subcontractors-management/WorkOrderItemSelectorDialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { getAssigneeForStep, calculateDeadline } from '@/lib/workflow-utils';

const initialBillDetails = {
    billNo: '',
    billDate: new Date().toISOString().split('T')[0],
    workOrderId: '',
    subcontractorId: '',
};

const slugify = (text: string) => {
  if (!text) return '';
  return text.toString().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

type EnrichedBillItem = BillItem & {
    orderQty: number;
    jmcCertifiedQty: number;
    alreadyBilledQty: number;
};

type AdvanceDeductionItem = {
    id: string;
    reference: string; // ProformaBill ID
    deductionType: 'amount' | 'percentage';
    deductionValue: number; // Holds the raw amount or percentage
    amount: number; // Holds the final calculated deduction amount
};


export default function CreateBillPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const router = useRouter();
  const { project: projectSlug } = useParams() as { project: string };

  const [details, setDetails] = useState(initialBillDetails);
  const [items, setItems] = useState<EnrichedBillItem[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isSelectorOpen, setIsSelectorOpen] = useState(false);
  
  const [allWorkOrders, setAllWorkOrders] = useState<WorkOrder[]>([]);
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<WorkOrder | null>(null);

  const [jmcEntries, setJmcEntries] = useState<JmcEntry[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [proformaBills, setProformaBills] = useState<ProformaBill[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [subcontractors, setSubcontractors] = useState<Subcontractor[]>([]);
  
  const [gstType, setGstType] = useState<'percentage' | 'manual'>('percentage');
  const [gstPercentage, setGstPercentage] = useState<number>(18);
  const [gstAmount, setGstAmount] = useState<number>(0);

  const [retentionType, setRetentionType] = useState<'percentage' | 'manual'>('percentage');
  const [retentionPercentage, setRetentionPercentage] = useState<number>(5);
  const [manualRetentionAmount, setManualRetentionAmount] = useState<number>(0);
  const [otherDeduction, setOtherDeduction] = useState<number>(0);
  
  const [advanceDeductions, setAdvanceDeductions] = useState<AdvanceDeductionItem[]>([{ id: crypto.randomUUID(), reference: '', deductionType: 'amount', deductionValue: 0, amount: 0 }]);


  useEffect(() => {
    const fetchProjectAndWorkOrders = async () => {
        if (!projectSlug) return;
        
        const projectsQuery = query(collection(db, 'projects'));
        const projectSnap = await getDocs(projectsQuery);
        const project = projectSnap.docs
            .map(doc => ({ id: doc.id, ...doc.data() } as Project))
            .find(p => slugify(p.projectName) === projectSlug);

        if (!project) {
            console.error("Project not found from slug:", projectSlug);
            toast({ title: "Error", description: "Project not found.", variant: "destructive" });
            return;
        }
        setCurrentProject(project);

        const subsQuery = query(collection(db, 'projects', project.id, 'subcontractors'));
        const woQuery = query(collection(db, 'projects', project.id, 'workOrders'));
        const jmcQuery = query(collection(db, 'projects', project.id, 'jmcEntries'));
        const billsQuery = query(collection(db, 'projects', project.id, 'bills'));
        const proformaBillsQuery = query(collection(db, 'projects', project.id, 'proformaBills'));

        const [subsSnap, woSnap, jmcSnap, billsSnap, proformaSnap] = await Promise.all([
          getDocs(subsQuery),
          getDocs(woQuery),
          getDocs(jmcQuery),
          getDocs(billsQuery),
          getDocs(proformaBillsQuery)
        ]);

        setSubcontractors(subsSnap.docs.map(d => ({id: d.id, ...d.data()} as Subcontractor)));
        setAllWorkOrders(woSnap.docs.map(d => ({id: d.id, ...d.data()} as WorkOrder)));
        setJmcEntries(jmcSnap.docs.map(d => d.data() as JmcEntry));
        setBills(billsSnap.docs.map(d => ({id: d.id, ...d.data()} as Bill)));
        setProformaBills(proformaSnap.docs.map(d => ({id: d.id, ...d.data()} as ProformaBill)));
    };
    fetchProjectAndWorkOrders();
  }, [projectSlug, toast]);
  
  const filteredWorkOrders = useMemo(() => {
      if (!details.subcontractorId) return [];
      return allWorkOrders.filter(wo => wo.subcontractorId === details.subcontractorId);
  }, [allWorkOrders, details.subcontractorId]);

  const handleSubcontractorChange = (subcontractorId: string) => {
    setDetails(prev => ({
        ...prev,
        subcontractorId,
        workOrderId: '', // Reset work order when subcontractor changes
    }));
    setSelectedWorkOrder(null);
    setItems([]);
  };

  useEffect(() => {
      const wo = allWorkOrders.find(w => w.id === details.workOrderId);
      setSelectedWorkOrder(wo || null);
      if(details.workOrderId) {
        setItems([]); 
      }
  }, [details.workOrderId, allWorkOrders]);

  const availableProformaBills = useMemo(() => {
    const deductedAmounts: Record<string, number> = {};
    bills.forEach(bill => {
        (bill.advanceDeductions || []).forEach(deduction => {
            deductedAmounts[deduction.reference] = (deductedAmounts[deduction.reference] || 0) + deduction.amount;
        });
    });

    const workOrderProformas = proformaBills.filter(proforma => proforma.workOrderId === details.workOrderId);

    return workOrderProformas
        .map(proforma => {
            const totalDeducted = deductedAmounts[proforma.id] || 0;
            const remainingBalance = (proforma.payableAmount || 0) - totalDeducted;
            return {
                ...proforma,
                totalDeducted,
                remainingBalance,
            };
        })
        .filter(proforma => proforma.remainingBalance > 0);
  }, [proformaBills, bills, details.workOrderId]);

  const handleDetailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setDetails(prev => ({ ...prev, [name]: value }));
  };
  
  const handleItemChange = (index: number, field: 'billedQty', value: string) => {
      const newItems = [...items];
      const item = newItems[index];
      const billedQty = parseFloat(value);
      const availableQty = parseFloat(item.executedQty);
      
      if(isNaN(billedQty) || billedQty < 0) {
        item.billedQty = '';
        item.totalAmount = '';
      } else if (billedQty > availableQty) {
          toast({
              title: 'Quantity Exceeded',
              description: `Billed quantity cannot be more than available quantity (${availableQty}).`,
              variant: 'destructive',
          });
          item.billedQty = availableQty.toString();
      } else {
          item.billedQty = value;
      }
      
      const rate = parseFloat(item.rate);
      if(!isNaN(rate) && item.billedQty) {
          item.totalAmount = (parseFloat(item.billedQty) * rate).toFixed(2);
      } else {
          item.totalAmount = '';
      }

      newItems[index] = item;
      setItems(newItems);
  };
  
  const handleItemsAdd = (selectedWoItems: WorkOrderItem[]) => {
      const newBillItems: EnrichedBillItem[] = selectedWoItems.map(woItem => {
          
        const totalJmcCertifiedForBoqItem = jmcEntries
            .flatMap(jmc => jmc.items)
            .filter(jmcItem => jmcItem.boqSlNo === woItem.boqSlNo)
            .reduce((sum, item) => sum + (item.certifiedQty || 0), 0);
        
        const alreadyBilledForWoItem = bills
            .filter(bill => bill.workOrderId === details.workOrderId)
            .flatMap(bill => bill.items)
            .filter(billItem => billItem.jmcItemId === woItem.id)
            .reduce((sum, item) => sum + parseFloat(item.billedQty || '0'), 0);

        const availableForBilling = totalJmcCertifiedForBoqItem - alreadyBilledForWoItem;

        return {
            jmcItemId: woItem.id,
            jmcEntryId: '',
            jmcNo: '',
            boqSlNo: woItem.boqSlNo || '',
            description: woItem.description,
            unit: woItem.unit,
            rate: String(woItem.rate),
            orderQty: woItem.orderQty,
            jmcCertifiedQty: totalJmcCertifiedForBoqItem,
            alreadyBilledQty: alreadyBilledForWoItem,
            executedQty: String(Math.max(0, availableForBilling)),
            billedQty: '',
            totalAmount: '',
        };
      });
      setItems(prev => [...prev, ...newBillItems]);
  }

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const handleAdvanceChange = (id: string, field: keyof AdvanceDeductionItem, value: any) => {
    setAdvanceDeductions(prev => {
        return prev.map(adv => {
            if (adv.id !== id) return adv;
            
            const newAdv = { ...adv, [field]: value };
            
            const selectedProforma = availableProformaBills.find(p => p.id === newAdv.reference);
            const maxAmount = selectedProforma?.remainingBalance || 0;
            
            if (field === 'reference') {
                newAdv.deductionType = 'amount';
                newAdv.deductionValue = 0;
                newAdv.amount = 0;
            }

            if (newAdv.deductionType === 'amount') {
                newAdv.amount = Math.min(maxAmount, Number(newAdv.deductionValue) || 0);
            } else if (newAdv.deductionType === 'percentage') {
                const calculatedAmount = maxAmount * (Number(newAdv.deductionValue) / 100);
                newAdv.amount = Math.min(maxAmount, calculatedAmount);
            }
            
            // Final check to prevent over-deduction
            if (newAdv.amount > maxAmount) {
                newAdv.amount = maxAmount;
                 if(newAdv.deductionType === 'amount') newAdv.deductionValue = maxAmount;
            }

            return newAdv;
        });
    });
  };

  const addAdvanceField = () => {
    setAdvanceDeductions(prev => [...prev, { id: crypto.randomUUID(), reference: '', deductionType: 'amount', deductionValue: 0, amount: 0 }]);
  };
  const removeAdvanceField = (id: string) => {
    if (advanceDeductions.length > 1) {
        setAdvanceDeductions(prev => prev.filter(adv => adv.id !== id));
    } else {
        setAdvanceDeductions([{ id: crypto.randomUUID(), reference: '', deductionType: 'amount', deductionValue: 0, amount: 0 }]);
    }
  };

  const financials = useMemo(() => {
    const subtotal = items.reduce((sum, item) => sum + parseFloat(item.totalAmount || '0'), 0);
    const finalGstAmount = gstType === 'percentage' ? (subtotal * (gstPercentage / 100)) : gstAmount;
    const finalRetentionAmount = retentionType === 'percentage' ? (subtotal * (retentionPercentage / 100)) : manualRetentionAmount;
    const totalAdvanceDeduction = advanceDeductions.reduce((sum, adv) => sum + (adv.amount || 0), 0);
    const grossAmount = subtotal + finalGstAmount;
    const totalDeductions = finalRetentionAmount + totalAdvanceDeduction + otherDeduction;
    const netPayable = grossAmount - totalDeductions;
    return { subtotal, finalGstAmount, grossAmount, finalRetentionAmount, totalDeductions, netPayable, totalAdvanceDeduction, otherDeduction };
  }, [items, gstType, gstPercentage, gstAmount, retentionType, retentionPercentage, manualRetentionAmount, otherDeduction, advanceDeductions]);


  const handleSave = async () => {
    if (!user || !details.billNo || !selectedWorkOrder || items.length === 0) {
        toast({ title: 'Missing Required Fields', description: 'Please fill in Bill No, select a Work Order, and add at least one item.', variant: 'destructive'});
        return;
    }
    setIsSaving(true);
    
    try {
        const workflowRef = doc(db, 'workflows', 'billing-workflow');
        const workflowSnap = await getDoc(workflowRef);
        if (!workflowSnap.exists()) throw new Error('Billing workflow not found.');
        
        const steps = (workflowSnap.data().steps || []) as WorkflowStep[];
        if(steps.length === 0) throw new Error('Billing workflow has no steps.');
        const firstStep = steps[0];
        
        const itemsToSave = items.map(({ jmcCertifiedQty, alreadyBilledQty, orderQty, ...rest }) => ({
            ...rest,
            billedQty: rest.billedQty || '0',
        }));

        const billData: Omit<Bill, 'id'> = {
            ...details,
            workOrderNo: selectedWorkOrder.workOrderNo,
            items: itemsToSave,
            subtotal: financials.subtotal,
            gstType,
            gstPercentage: gstType === 'percentage' ? gstPercentage : null,
            gstAmount: financials.finalGstAmount,
            grossAmount: financials.grossAmount,
            retentionType,
            retentionPercentage: retentionType === 'percentage' ? retentionPercentage : null,
            retentionAmount: financials.finalRetentionAmount,
            otherDeduction: financials.otherDeduction,
            advanceDeductions: advanceDeductions.filter(adv => adv.reference && adv.amount > 0),
            totalDeductions: financials.totalDeductions,
            netPayable: financials.netPayable,
            totalAmount: financials.netPayable,
            createdAt: serverTimestamp() as Timestamp,
            projectId: currentProject?.id || '',
            status: 'Pending',
            stage: firstStep.name,
            currentStepId: firstStep.id,
            assignees: [],
            history: [],
        };
        
        const tempForAssignment = { ...billData, amount: billData.netPayable, date: billData.billDate };
        const assignees = await getAssigneeForStep(firstStep, tempForAssignment as any);
        if(!assignees || assignees.length === 0) throw new Error(`Could not find assignee for step: ${firstStep.name}`);
        billData.assignees = assignees;

        const deadline = await calculateDeadline(new Date(), firstStep.tat);
        (billData as any).deadline = Timestamp.fromDate(deadline);

        const initialLog: ActionLog = {
            action: 'Created',
            comment: 'Bill created.',
            userId: user.id,
            userName: user.name,
            timestamp: Timestamp.now(),
            stepName: 'Creation',
        };
        billData.history = [initialLog];


        if(!currentProject) throw new Error("Project ID is missing");
        
        await addDoc(collection(db, 'projects', currentProject.id, 'bills'), billData);
        
        toast({ title: 'Bill Created', description: 'The new bill has been successfully saved.' });
        router.push(`/subcontractors-management/${projectSlug}/billing`);

    } catch (error) {
        console.error("Error creating bill: ", error);
        toast({ title: 'Save Failed', description: 'An error occurred while saving the bill.', variant: 'destructive' });
    } finally {
        setIsSaving(false);
    }
  };
  
  const formatCurrency = (amount: string | number) => {
    const num = parseFloat(String(amount));
    if(isNaN(num)) return amount;
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(num);
  }

  const selectedAdvanceReferences = useMemo(() => 
    new Set(advanceDeductions.map(ad => ad.reference).filter(Boolean)),
    [advanceDeductions]
  );

  return (
    <>
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
              <Link href={`/subcontractors-management/${projectSlug}/billing`}>
                  <Button variant="ghost" size="icon"> <ArrowLeft className="h-6 w-6" /> </Button>
              </Link>
              <h1 className="text-2xl font-bold">Bill Entry</h1>
          </div>
          <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save Bill
          </Button>
        </div>

        <Card className="mb-6">
          <CardHeader><CardTitle>Bill Details</CardTitle></CardHeader>
          <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  <div className="space-y-2">
                      <Label htmlFor="subcontractorId">Subcontractor</Label>
                      <Select value={details.subcontractorId} onValueChange={handleSubcontractorChange}>
                          <SelectTrigger id="subcontractorId"><SelectValue placeholder="Select a Subcontractor" /></SelectTrigger>
                          <SelectContent>
                              {subcontractors.map(sc => <SelectItem key={sc.id} value={sc.id}>{sc.legalName}</SelectItem>)}
                          </SelectContent>
                      </Select>
                  </div>
                  <div className="space-y-2">
                      <Label htmlFor="workOrderId">Work Order No</Label>
                      <Select 
                        value={details.workOrderId} 
                        onValueChange={(value) => setDetails(prev => ({ ...prev, workOrderId: value }))}
                        disabled={!details.subcontractorId}
                      >
                          <SelectTrigger id="workOrderId"><SelectValue placeholder="Select a Work Order" /></SelectTrigger>
                          <SelectContent>
                              {filteredWorkOrders.map(wo => <SelectItem key={wo.id} value={wo.id}>{wo.workOrderNo}</SelectItem>)}
                          </SelectContent>
                      </Select>
                  </div>
                   <div className="space-y-2">
                      <Label>Subcontractor Name</Label>
                      <Input value={selectedWorkOrder?.subcontractorName || ''} readOnly className="bg-muted"/>
                  </div>
                  <div className="space-y-2">
                      <Label htmlFor="billNo">Bill No</Label>
                      <Input id="billNo" name="billNo" value={details.billNo} onChange={handleDetailChange} />
                  </div>
                  <div className="space-y-2">
                      <Label htmlFor="billDate">Bill Date</Label>
                      <Input id="billDate" name="billDate" type="date" value={details.billDate} onChange={handleDetailChange} />
                  </div>
              </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
               <div className="flex items-center justify-between">
                  <div>
                      <CardTitle>Bill Items</CardTitle>
                      <CardDescription>Add items from the selected Work Order to this bill.</CardDescription>
                  </div>
                  <Button variant="outline" type="button" onClick={() => setIsSelectorOpen(true)} disabled={!selectedWorkOrder}>
                      <Library className="mr-2 h-4 w-4" /> Add Items from Work Order
                  </Button>
              </div>
          </CardHeader>
          <CardContent>
              <div className="overflow-x-auto">
                  <Table>
                      <TableHeader>
                          <TableRow>
                              <TableHead>BOQ Sl. No.</TableHead>
                              <TableHead>Description</TableHead>
                              <TableHead>Unit</TableHead>
                              <TableHead>Order Qty</TableHead>
                              <TableHead>JMC Certified Qty</TableHead>
                              <TableHead>Already Billed Qty</TableHead>
                              <TableHead>Available for Billing</TableHead>
                              <TableHead>Rate</TableHead>
                              <TableHead>Billed Qty</TableHead>
                              <TableHead>Total Amount</TableHead>
                              <TableHead>Action</TableHead>
                          </TableRow>
                      </TableHeader>
                      <TableBody>
                          {items.map((item, index) => (
                              <TableRow key={item.jmcItemId}>
                                  <TableCell>{item.boqSlNo}</TableCell>
                                  <TableCell>{item.description}</TableCell>
                                  <TableCell>{item.unit}</TableCell>
                                  <TableCell>{item.orderQty}</TableCell>
                                  <TableCell>{item.jmcCertifiedQty}</TableCell>
                                  <TableCell>{item.alreadyBilledQty}</TableCell>
                                  <TableCell className="font-semibold">{item.executedQty}</TableCell>
                                  <TableCell>{formatCurrency(item.rate)}</TableCell>
                                  <TableCell>
                                      <Input 
                                        type="number" 
                                        value={item.billedQty}
                                        onChange={(e) => handleItemChange(index, 'billedQty', e.target.value)}
                                        max={item.executedQty}
                                      />
                                  </TableCell>
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

        <Card className="mt-6">
            <CardHeader><CardTitle>Financial Summary</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-6">
                    <div>
                        <Label>GST</Label>
                        <RadioGroup value={gstType} onValueChange={(v) => setGstType(v as any)} className="flex gap-4 mt-2">
                            <div className="flex items-center space-x-2">
                              <RadioGroupItem value="percentage" id="gst-percentage" />
                              <Label htmlFor="gst-percentage">By Percentage</Label>
                            </div>
                            <div className="flex items-center space-x-2">
                              <RadioGroupItem value="manual" id="gst-manual" />
                              <Label htmlFor="gst-manual">Manual Entry</Label>
                            </div>
                        </RadioGroup>
                        {gstType === 'percentage' ? (
                            <div className="flex items-center gap-2 mt-2">
                                <Input type="number" placeholder="GST %" value={gstPercentage} onChange={e => setGstPercentage(parseFloat(e.target.value) || 0)} />
                                <span className="text-muted-foreground">%</span>
                            </div>
                        ) : (
                            <Input type="number" placeholder="Enter GST Amount" value={gstAmount} onChange={e => setGstAmount(parseFloat(e.target.value) || 0)} className="mt-2" />
                        )}
                    </div>
                     <Separator />
                    <div>
                        <Label>Deductions</Label>
                        <div className="space-y-4 mt-2">
                            <div className="space-y-2">
                                <Label>Retention</Label>
                                <RadioGroup value={retentionType} onValueChange={(v) => setRetentionType(v as any)} className="flex gap-4">
                                    <div className="flex items-center space-x-2"><RadioGroupItem value="percentage" id="ret-percentage" /><Label htmlFor="ret-percentage">Percentage</Label></div>
                                    <div className="flex items-center space-x-2"><RadioGroupItem value="manual" id="ret-manual" /><Label htmlFor="ret-manual">Manual</Label></div>
                                </RadioGroup>
                                {retentionType === 'percentage' ? (
                                    <div className="flex items-center gap-2 mt-2">
                                        <Input type="number" placeholder="Retention %" value={retentionPercentage} onChange={e => setRetentionPercentage(parseFloat(e.target.value) || 0)} />
                                        <span className="text-muted-foreground">%</span>
                                    </div>
                                ) : (
                                    <Input type="number" placeholder="Enter Retention Amount" value={manualRetentionAmount} onChange={e => setManualRetentionAmount(parseFloat(e.target.value) || 0)} className="mt-2" />
                                )}
                            </div>
                            <div className="space-y-2">
                                <Label>Advance Deductions</Label>
                                {advanceDeductions.map((adv) => {
                                const selectedProforma = availableProformaBills.find(p => p.id === adv.reference);
                                return (
                                <Card key={adv.id} className="p-4 space-y-3">
                                    <div className="flex items-start gap-2">
                                        <div className="flex-grow space-y-2">
                                            <Select
                                                value={adv.reference}
                                                onValueChange={(value) => handleAdvanceChange(adv.id, 'reference', value)}
                                            >
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Select Proforma/Advance" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {availableProformaBills.map(proforma => (
                                                        <SelectItem key={proforma.id} value={proforma.id} disabled={selectedAdvanceReferences.has(proforma.id) && proforma.id !== adv.reference}>
                                                            {proforma.proformaNo} ({formatCurrency(proforma.remainingBalance)})
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <RadioGroup value={adv.deductionType} onValueChange={(v) => handleAdvanceChange(adv.id, 'deductionType', v as any)} className="flex gap-4 pt-2">
                                                <div className="flex items-center space-x-2"><RadioGroupItem value="amount" id={`adv-type-amount-${adv.id}`} /><Label htmlFor={`adv-type-amount-${adv.id}`}>Amount</Label></div>
                                                <div className="flex items-center space-x-2"><RadioGroupItem value="percentage" id={`adv-type-percent-${adv.id}`} /><Label htmlFor={`adv-type-percent-${adv.id}`}>Percentage</Label></div>
                                            </RadioGroup>
                                            <div className="flex items-center gap-2">
                                                <Input
                                                    type="number"
                                                    placeholder={adv.deductionType === 'amount' ? 'Amount to Deduct' : 'Percentage to Deduct'}
                                                    value={adv.deductionValue}
                                                    onChange={(e) => handleAdvanceChange(adv.id, 'deductionValue', e.target.value)}
                                                />
                                                {adv.deductionType === 'percentage' && <span className="text-muted-foreground">%</span>}
                                            </div>
                                        </div>
                                        <Button type="button" variant="ghost" size="icon" onClick={() => removeAdvanceField(adv.id)}><Trash2 className="h-4 w-4 text-destructive"/></Button>
                                    </div>
                                    {selectedProforma && (
                                    <div className="text-xs text-muted-foreground space-y-1 bg-muted p-2 rounded-md">
                                        <div className="flex justify-between"><span>Total Proforma Value:</span> <span>{formatCurrency(selectedProforma.payableAmount || 0)}</span></div>
                                        <div className="flex justify-between"><span>Previously Deducted:</span> <span>{formatCurrency(selectedProforma.totalDeducted || 0)}</span></div>
                                        <div className="flex justify-between font-medium"><span>Available Balance:</span> <span>{formatCurrency(selectedProforma.remainingBalance || 0)}</span></div>
                                        <div className="flex justify-between font-bold"><span>Balance After Deduction:</span> <span>{formatCurrency((selectedProforma.remainingBalance || 0) - adv.amount)}</span></div>
                                    </div>
                                    )}
                                </Card>
                                )})}
                                <Button type="button" variant="outline" size="sm" onClick={addAdvanceField} className="mt-2">
                                    <Plus className="mr-2 h-4 w-4" /> Add Advance
                                </Button>
                            </div>
                             <div className="space-y-2">
                                <Label htmlFor="otherDeduction">Other Deductions</Label>
                                <Input
                                    id="otherDeduction"
                                    type="number"
                                    placeholder="Enter other deductions"
                                    value={otherDeduction}
                                    onChange={(e) => setOtherDeduction(Number(e.target.value) || 0)}
                                />
                            </div>
                        </div>
                    </div>
                </div>
                <div className="space-y-3 p-4 bg-muted/50 rounded-lg">
                    <div className="flex justify-between items-center text-sm">
                        <span className="text-muted-foreground">Subtotal</span>
                        <span className="font-medium">{formatCurrency(financials.subtotal)}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                        <span className="text-muted-foreground">GST</span>
                        <span className="font-medium">{formatCurrency(financials.finalGstAmount)}</span>
                    </div>
                    <Separator />
                    <div className="flex justify-between items-center font-semibold">
                        <span>Gross Amount</span>
                        <span>{formatCurrency(financials.grossAmount)}</span>
                    </div>
                     <div className="flex justify-between items-center text-sm text-destructive">
                        <span className="text-muted-foreground">Retention</span>
                        <span className="font-medium">-{formatCurrency(financials.finalRetentionAmount)}</span>
                    </div>
                     <div className="flex justify-between items-center text-sm text-destructive">
                        <span className="text-muted-foreground">Advance Deductions</span>
                        <span className="font-medium">-{formatCurrency(financials.totalAdvanceDeduction)}</span>
                    </div>
                     <div className="flex justify-between items-center text-sm text-destructive">
                        <span className="text-muted-foreground">Other Deductions</span>
                        <span className="font-medium">-{formatCurrency(financials.otherDeduction)}</span>
                    </div>
                     <Separator />
                     <div className="flex justify-between items-center font-bold text-lg">
                        <span>Net Payable Amount</span>
                        <span>{formatCurrency(financials.netPayable)}</span>
                    </div>
                </div>
            </CardContent>
        </Card>
      </div>
      <WorkOrderItemSelectorDialog
        isOpen={isSelectorOpen}
        onOpenChange={setIsSelectorOpen}
        onConfirm={handleItemsAdd}
        workOrder={selectedWorkOrder}
        alreadyAddedItems={items}
      />
    </>
  );
}

    

    