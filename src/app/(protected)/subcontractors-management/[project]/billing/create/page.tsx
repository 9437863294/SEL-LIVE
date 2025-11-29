// /src/app/(protected)/billing-recon/[project]/billing/create/page.tsx
'use client';

import { useState, useEffect, useMemo, Fragment, useId } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, Plus, Trash2, Library, ChevronDown, ChevronRight } from 'lucide-react';
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
  serverTimestamp,
  getDoc,
  Timestamp,
  collectionGroup,
} from 'firebase/firestore';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type {
  WorkOrderItem,
  JmcEntry,
  Project,
  Bill,
  ProformaBill,
  WorkflowStep,
  ActionLog,
  Subcontractor,
  SubItem,
  BillItem,
} from '@/lib/types';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import WorkOrderItemSelectorDialog from '@/components/subcontractors-management/WorkOrderItemSelectorDialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { getAssigneeForStep, calculateDeadline } from '@/lib/workflow-utils';

/**
 * Local WorkOrder shim — add to lib/types.ts later for long-term fix.
 */
type WorkOrder = {
  id: string;
  workOrderNo: string;
  subcontractorId: string;
  projectId: string;
  subcontractorName?: string;
  totalAmount: number;
  items: WorkOrderItem[];
};

/** Utilities **/
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

const toNumber = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const nanoid = () => {
  try {
    // @ts-ignore
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return (crypto as any).randomUUID();
  } catch (e) {
    /* ignore */
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
};

/** UI types (client-side enriched) **/
type EnrichedSubItem = Omit<SubItem, 'quantity' | 'rate' | 'totalAmount'> & {
  id: string;
  billedQty: string;
  totalAmount: string;
  rate: string;
  quantity: string;
  jmcCertifiedQty: number;
  alreadyBilledQty: number;
  availableQty: number;
};

type EnrichedBillItem = Omit<
  BillItem,
  'rate' | 'totalAmount' | 'billedQty' | 'subItems' | 'jmcItemId' | 'executedQty'
> & {
  id: string;
  isBreakdown: boolean;
  orderQty: number;
  jmcCertifiedQty: number;
  alreadyBilledQty: number;
  availableQty: number;
  billedQty: string; // The UI state is a string
  totalAmount: string;
  rate: string;
  subItems: EnrichedSubItem[];
  boqItemId?: string;
  jmcItemId: string; // Ensure this is mandatory
  executedQty: number;
};

type AdvanceDeductionItem = {
  id: string;
  reference: string;
  deductionType: 'amount' | 'percentage';
  deductionValue: number;
  amount: number;
};

const initialBillDetails = {
  billNo: '',
  billDate: new Date().toISOString().split('T')[0],
  workOrderId: '',
  subcontractorId: '',
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
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const [gstType, setGstType] = useState<'percentage' | 'manual'>('percentage');
  const [gstPercentage, setGstPercentage] = useState<number>(18);
  const [gstAmount, setGstAmount] = useState<number>(0);

  const [retentionType, setRetentionType] = useState<'percentage' | 'manual'>('percentage');
  const [retentionPercentage, setRetentionPercentage] = useState<number>(5);
  const [manualRetentionAmount, setManualRetentionAmount] = useState<number>(0);
  const [otherDeduction, setOtherDeduction] = useState<number>(0);
  const [advanceDeductions, setAdvanceDeductions] = useState<AdvanceDeductionItem[]>([]);
  const advanceDeductionId = useId();

  useEffect(() => {
    let mounted = true;
    const fetchProjectAndData = async () => {
      if (!projectSlug) return;

      try {
        const projectsQuery = query(collection(db, 'projects'));
        const projectSnap = await getDocs(projectsQuery);
        if (!mounted) return;

        const project = projectSnap.docs
          .map(d => ({ id: d.id, ...(d.data() as any) } as Project))
          .find(p => slugify(p.projectName) === projectSlug);

        if (!project) {
          toast({ title: 'Error', description: 'Project not found.', variant: 'destructive' });
          return;
        }
        setCurrentProject(project);

        const subsQuery = query(collectionGroup(db, 'subcontractors'));
        const woQuery = query(collection(db, 'projects', project.id, 'workOrders'));
        const jmcQuery = query(collection(db, 'projects', project.id, 'jmcEntries'));
        const billsQuery = query(collection(db, 'projects', project.id, 'bills'));
        const proformaBillsQuery = query(collection(db, 'projects', project.id, 'proformaBills'));

        const [subsSnap, woSnap, jmcSnap, billsSnap, proformaSnap] = await Promise.all([
          getDocs(subsQuery),
          getDocs(woQuery),
          getDocs(jmcQuery),
          getDocs(billsQuery),
          getDocs(proformaBillsQuery),
        ]);

        if (!mounted) return;

        const allSubs = subsSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Subcontractor));
        const projectWorkOrders = woSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as WorkOrder));

        const subIdsWithProjectWo = new Set(projectWorkOrders.map(wo => wo.subcontractorId));
        setSubcontractors(allSubs.filter(sub => subIdsWithProjectWo.has(sub.id)));
        setAllWorkOrders(projectWorkOrders);

        setJmcEntries(jmcSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as JmcEntry)));
        setBills(billsSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Bill)));
        setProformaBills(proformaSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as ProformaBill)));
      } catch (err: any) {
        console.error('Error fetching project data', err);
        toast({
          title: 'Error',
          description: err?.message || 'Failed to fetch project data',
          variant: 'destructive',
        });
      }
    };

    fetchProjectAndData();
    return () => {
      mounted = false;
    };
  }, [projectSlug, toast]);

  const filteredWorkOrders = useMemo(() => {
    if (!details.subcontractorId) return [];
    return allWorkOrders.filter(wo => wo.subcontractorId === details.subcontractorId);
  }, [allWorkOrders, details.subcontractorId]);

  const subcontractorsWithWorkOrders = useMemo(() => {
    const subIdsWithWo = new Set(allWorkOrders.map(wo => wo.subcontractorId));
    return subcontractors.filter(sub => subIdsWithWo.has(sub.id));
  }, [allWorkOrders, subcontractors]);

  const handleSubcontractorChange = (subcontractorId: string) => {
    setDetails(prev => ({ ...prev, subcontractorId, workOrderId: '' }));
    setSelectedWorkOrder(null);
    setItems([]);
  };

  useEffect(() => {
    const wo = allWorkOrders.find(w => w.id === details.workOrderId) || null;
    setSelectedWorkOrder(wo);
    setItems([]); // reset items when WO changes
  }, [details.workOrderId, allWorkOrders]);

  const availableProformaBills = useMemo(() => {
    const deductedAmounts: Record<string, number> = {};
    bills.forEach(bill => {
      (bill.advanceDeductions || []).forEach(d => {
        deductedAmounts[d.reference] = (deductedAmounts[d.reference] || 0) + (d.amount || 0);
      });
    });

    const workOrderProformas = proformaBills.filter(p => p.workOrderId === details.workOrderId);
    return workOrderProformas
      .map(p => {
        const totalDeducted = deductedAmounts[p.id] || 0;
        const remainingBalance = (p.payableAmount || 0) - totalDeducted;
        return { ...p, totalDeducted, remainingBalance };
      })
      .filter(p => (p.remainingBalance || 0) > 0);
  }, [proformaBills, bills, details.workOrderId]);

  const handleDetailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setDetails(prev => ({ ...prev, [name]: value }));
  };

  const handleItemChange = (index: number, field: 'billedQty', value: string) => {
    const newItems = [...items];
    const item = newItems[index];
    const billedQtyNum = toNumber(value);

    if (isNaN(billedQtyNum) || billedQtyNum < 0) {
      item.billedQty = '';
    } else if (billedQtyNum > item.availableQty) {
      toast({
        title: 'Quantity Exceeded',
        description: `Billed quantity cannot be more than available (${item.availableQty}).`,
        variant: 'destructive',
      });
      item.billedQty = String(item.availableQty);
    } else {
      item.billedQty = String(billedQtyNum);
    }

    // For breakdown items, update sub-items based on parent change
    if (item.isBreakdown && item.subItems) {
      const parentBilledQty = toNumber(item.billedQty);
      item.subItems = item.subItems.map(si => {
        const subItemBilledQty = parentBilledQty * toNumber(si.quantity);
        return {
          ...si,
          billedQty: String(subItemBilledQty),
          totalAmount: String(subItemBilledQty * toNumber(si.rate)),
        };
      });
      // The total amount of the parent is the sum of its sub-items' totals
      item.totalAmount = String(item.subItems.reduce((sum, si) => sum + toNumber(si.totalAmount), 0));
    } else {
      item.totalAmount = String(toNumber(item.billedQty) * toNumber(item.rate));
    }

    newItems[index] = item;
    setItems(newItems);
  };

  const handleSubItemChange = (itemIndex: number, subIndex: number, value: string) => {
    const newItems = [...items];
    const mainItem = newItems[itemIndex];
    if (!mainItem.isBreakdown || !mainItem.subItems) return;

    const subItem = mainItem.subItems[subIndex];
    const billedQtyNum = toNumber(value);

    if (isNaN(billedQtyNum) || billedQtyNum < 0) {
      subItem.billedQty = '';
    } else if (billedQtyNum > subItem.availableQty) {
      toast({
        title: 'Quantity Exceeded',
        description: `Sub-item billed qty cannot exceed available (${subItem.availableQty}).`,
        variant: 'destructive',
      });
      subItem.billedQty = String(subItem.availableQty);
    } else {
      subItem.billedQty = String(billedQtyNum);
    }

    subItem.totalAmount = String(toNumber(subItem.billedQty) * toNumber(subItem.rate));

    // Recalculate main item total from sub-items (amount)
    const subItemsTotalValue = mainItem.subItems.reduce(
      (s, si) => s + toNumber(si.totalAmount || '0'),
      0
    );
    mainItem.totalAmount = String(subItemsTotalValue);

    // === NEW LOGIC: main billedQty based on qty progress, not amount ===
    let fractionSum = 0;
    let validSubCount = 0;

    for (const si of mainItem.subItems) {
      const qtyPerSet = toNumber(si.quantity); // qty in one set (e.g. 5, 6, 5)
      const billed = toNumber(si.billedQty); // how much user entered

      if (qtyPerSet > 0) {
        fractionSum += billed / qtyPerSet; // set-equivalent for this subitem
        validSubCount += 1;
      }
    }

    if (validSubCount > 0) {
      const avgSetsDone = fractionSum / validSubCount; // average across all subitems
      mainItem.billedQty = avgSetsDone.toFixed(3); // e.g. 0.333, 0.667
    } else {
      mainItem.billedQty = '0';
    }

    newItems[itemIndex] = mainItem;
    setItems(newItems);
  };

  const handleItemsAdd = (selectedWoItems: WorkOrderItem[]) => {
    const existingJmcIds = new Set(items.map(i => i.jmcItemId));
    const filteredAdd = selectedWoItems.filter(wo => !existingJmcIds.has(wo.id));

    const newBillItems: EnrichedBillItem[] = filteredAdd.map(woItem => {
      const totalJmcCertifiedForBoqItem = jmcEntries
        .flatMap(j => j.items || [])
        .filter(jItem => jItem.boqSlNo === woItem.boqSlNo)
        .reduce((s, it) => s + (it.certifiedQty || 0), 0);

      const alreadyBilledForWoItem = bills
        .filter(b => b.workOrderId === details.workOrderId)
        .flatMap(b => b.items || [])
        .filter(bi => bi.jmcItemId === woItem.id)
        .reduce((s, it) => s + (it.billedQty || 0), 0);

      const availableForBilling = Math.max(0, (woItem.orderQty || 0) - alreadyBilledForWoItem);

      return {
        id: nanoid(),
        jmcItemId: woItem.id,
        jmcEntryId: '',
        jmcNo: '',
        boqItemId: woItem.boqItemId,
        boqSlNo: woItem.boqSlNo,
        description: woItem.description,
        unit: woItem.unit,
        orderQty: woItem.orderQty,
        rate: String(woItem.rate),
        jmcCertifiedQty: totalJmcCertifiedForBoqItem,
        alreadyBilledQty: alreadyBilledForWoItem,
        availableQty: availableForBilling,
        billedQty: '',
        totalAmount: '',
        isBreakdown: !!(woItem.subItems && woItem.subItems.length > 0),
        executedQty: availableForBilling,
        subItems: (woItem.subItems || []).map(si => {
          const qtyPerSet = toNumber(si.quantity);
          const subItemAvailable = Math.max(0, availableForBilling * qtyPerSet);
          return {
            ...si,
            id: nanoid(),
            billedQty: '',
            totalAmount: '',
            rate: String(si.rate),
            quantity: String(qtyPerSet),
            jmcCertifiedQty: 0,
            alreadyBilledQty: 0,
            availableQty: subItemAvailable,
          };
        }),
      };
    });

    setItems(prev => [...prev, ...newBillItems]);
  };

  const removeItem = (index: number) => setItems(items.filter((_, i) => i !== index));

  const toggleRowExpansion = (itemId: string) => {
    setExpandedRows(prev => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) newSet.delete(itemId);
      else newSet.add(itemId);
      return newSet;
    });
  };

  const handleAdvanceChange = (
    id: string,
    field: keyof AdvanceDeductionItem | 'reference' | 'deductionType' | 'deductionValue',
    value: any
  ) => {
    setAdvanceDeductions(prev =>
      prev.map(adv => {
        if (adv.id !== id) return adv;
        const newAdv = { ...adv };
        if (field === 'reference') {
          newAdv.reference = String(value || '');
          newAdv.deductionType = 'amount';
          newAdv.deductionValue = 0;
          newAdv.amount = 0;
        } else if (field === 'deductionType') {
          newAdv.deductionType = value === 'percentage' ? 'percentage' : 'amount';
        } else if (field === 'deductionValue') {
          newAdv.deductionValue = toNumber(value);
        } else if (field === 'amount') {
          newAdv.amount = toNumber(value);
        }

        const selectedProforma = availableProformaBills.find(p => p.id === newAdv.reference);
        const maxAmount = selectedProforma?.remainingBalance || 0;

        if (newAdv.deductionType === 'amount') {
          newAdv.amount = Math.min(maxAmount, toNumber(newAdv.deductionValue));
          newAdv.deductionValue = newAdv.amount;
        } else {
          const calculated = (maxAmount * toNumber(newAdv.deductionValue)) / 100;
          newAdv.amount = Math.min(maxAmount, calculated);
        }

        if (newAdv.amount > maxAmount) {
          newAdv.amount = maxAmount;
          if (newAdv.deductionType === 'amount') newAdv.deductionValue = maxAmount;
        }
        return newAdv;
      })
    );
  };

  const addAdvanceField = () =>
    setAdvanceDeductions(prev => [
      ...prev,
      { id: nanoid(), reference: '', deductionType: 'amount', deductionValue: 0, amount: 0 },
    ]);

  const removeAdvanceField = (id: string) => {
    if (advanceDeductions.length > 0)
      setAdvanceDeductions(prev => prev.filter(a => a.id !== id));
  };

  const financials = useMemo(() => {
    const subtotal = items.reduce((s, it) => s + toNumber(it.totalAmount || '0'), 0);
    const finalGstAmount = gstType === 'percentage' ? subtotal * (gstPercentage / 100) : gstAmount;
    const finalRetentionAmount =
      retentionType === 'percentage'
        ? subtotal * (retentionPercentage / 100)
        : manualRetentionAmount;
    const totalAdvanceDeduction = advanceDeductions.reduce(
      (s, adv) => s + toNumber(adv.amount || 0),
      0
    );
    const grossAmount = subtotal + finalGstAmount;
    const totalDeductions = finalRetentionAmount + totalAdvanceDeduction + otherDeduction;
    const netPayable = grossAmount - totalDeductions;
    return {
      subtotal,
      finalGstAmount,
      grossAmount,
      finalRetentionAmount,
      totalDeductions,
      netPayable,
      totalAdvanceDeduction,
      otherDeduction,
    };
  }, [
    items,
    gstType,
    gstPercentage,
    gstAmount,
    retentionType,
    retentionPercentage,
    manualRetentionAmount,
    otherDeduction,
    advanceDeductions,
  ]);

  const handleSave = async () => {
    if (!user || !details.billNo || !selectedWorkOrder || items.length === 0) {
      toast({
        title: 'Missing Required Fields',
        description: 'Please fill in Bill No, select a Work Order, and add at least one item.',
        variant: 'destructive',
      });
      return;
    }
    setIsSaving(true);

    try {
      const workflowRef = doc(db, 'workflows', 'billing-workflow');
      const workflowSnap = await getDoc(workflowRef);
      if (!workflowSnap.exists()) throw new Error('Billing workflow not found.');

      const steps = (workflowSnap.data().steps || []) as WorkflowStep[];
      if (!steps || steps.length === 0) throw new Error('Billing workflow has no steps.');
      const firstStep = steps[0];

      const itemsToSave: BillItem[] = items.map(it => ({
        jmcItemId: it.jmcItemId,
        jmcEntryId: it.jmcEntryId,
        jmcNo: it.jmcNo,
        boqItemId: it.boqItemId || '',
        boqSlNo: it.boqSlNo,
        description: it.description || '',
        unit: it.unit || '',
        rate: toNumber(it.rate),
        executedQty: it.executedQty,
        billedQty: toNumber(it.billedQty),
        totalAmount: toNumber(it.totalAmount),
        subItems: (it.subItems || []).map(si => ({
          id: si.id || nanoid(),
          slNo: si.slNo,
          name: si.name,
          unit: si.unit,
          quantity: toNumber(si.quantity),
          rate: toNumber(si.rate),
          totalAmount: toNumber(si.totalAmount),
        })),
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
        advanceDeductions: advanceDeductions
          .filter(adv => adv.reference && adv.amount > 0)
          .map(adv => ({
            id: adv.id,
            reference: adv.reference,
            amount: adv.amount,
            deductionType: adv.deductionType,
            deductionValue: adv.deductionValue,
          })),
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

      const tempForAssignment = {
        ...billData,
        amount: billData.netPayable,
        date: billData.billDate,
      };
      const assignees = await getAssigneeForStep(firstStep, tempForAssignment as any);
      if (!assignees || assignees.length === 0)
        throw new Error(`Could not find assignee for step: ${firstStep.name}`);
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

      if (!currentProject) throw new Error('Project ID is missing');

      await addDoc(collection(db, 'projects', currentProject.id, 'bills'), billData);

      toast({ title: 'Bill Created', description: 'The new bill has been successfully saved.' });
      router.push(`/subcontractors-management/${projectSlug}/billing`);
    } catch (error: any) {
      console.error('Error creating bill:', error);
      toast({
        title: 'Save Failed',
        description: error?.message || 'An error occurred while saving the bill.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const formatCurrency = (amount: string | number) => {
    const num = parseFloat(String(amount));
    if (isNaN(num))
      return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
      }).format(0);
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
    }).format(num);
  };

  const alreadyAddedWorkOrderItems = useMemo(() => {
    return items.map(it => ({
      id: it.jmcItemId,
      boqItemId: it.boqItemId || '',
      description: it.description,
      unit: it.unit,
      orderQty: it.orderQty,
      rate: toNumber(it.rate),
      totalAmount: toNumber(it.totalAmount),
      boqSlNo: it.boqSlNo,
      subItems: (it.subItems || []).map(si => ({
        id: si.id,
        slNo: si.slNo,
        name: si.name,
        unit: si.unit,
        quantity: toNumber(si.quantity),
        rate: toNumber(si.rate),
        totalAmount: toNumber(si.totalAmount),
      })),
    }));
  }, [items]);

  const selectedAdvanceReferences = useMemo(
    () => new Set(advanceDeductions.map(ad => ad.reference).filter(Boolean)),
    [advanceDeductions]
  );

  return (
    <>
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href={`/subcontractors-management/${projectSlug}/billing`}>
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-6 w-6" />
              </Button>
            </Link>
            <h1 className="text-2xl font-bold">Bill Entry</h1>
          </div>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save Bill
          </Button>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Bill Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="subcontractorId">Subcontractor</Label>
                <Select value={details.subcontractorId} onValueChange={handleSubcontractorChange}>
                  <SelectTrigger id="subcontractorId">
                    <SelectValue placeholder="Select a Subcontractor" />
                  </SelectTrigger>
                  <SelectContent>
                    {subcontractorsWithWorkOrders.map(sc => (
                      <SelectItem key={sc.id} value={sc.id}>
                        {sc.legalName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="workOrderId">Work Order No</Label>
                <Select
                  value={details.workOrderId}
                  onValueChange={v => setDetails(prev => ({ ...prev, workOrderId: v }))}
                  disabled={!details.subcontractorId}
                >
                  <SelectTrigger id="workOrderId">
                    <SelectValue placeholder="Select a Work Order" />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredWorkOrders.map(wo => (
                      <SelectItem key={wo.id} value={wo.id}>
                        {wo.workOrderNo}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Subcontractor Name</Label>
                <Input
                  value={selectedWorkOrder?.subcontractorName || ''}
                  readOnly
                  className="bg-muted"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="billNo">Bill No</Label>
                <Input id="billNo" name="billNo" value={details.billNo} onChange={handleDetailChange} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="billDate">Bill Date</Label>
                <Input
                  id="billDate"
                  name="billDate"
                  type="date"
                  value={details.billDate}
                  onChange={handleDetailChange}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Bill Items</CardTitle>
                <CardDescription>
                  Add items from the selected Work Order to this bill.
                </CardDescription>
              </div>
              <Button
                variant="outline"
                type="button"
                onClick={() => setIsSelectorOpen(true)}
                disabled={!selectedWorkOrder}
              >
                <Library className="mr-2 h-4 w-4" /> Add Items from Work Order
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead></TableHead>
                    <TableHead>BOQ Sl. No.</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>Order Qty</TableHead>
                    <TableHead>JMC Certified Qty</TableHead>
                    <TableHead>Already Billed Qty</TableHead>
                    <TableHead>Available</TableHead>
                    <TableHead>Billed Qty</TableHead>
                    <TableHead>Rate</TableHead>
                    <TableHead>Total Amount</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item, index) => (
                    <Fragment key={item.id}>
                      <TableRow>
                        <TableCell>
                          {item.isBreakdown && (
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => toggleRowExpansion(item.id)}
                            >
                              {expandedRows.has(item.id) ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                        </TableCell>
                        <TableCell>{item.boqSlNo}</TableCell>
                        <TableCell className="max-w-xs">
                          <div className="whitespace-normal overflow-hidden text-ellipsis [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]">
                                   {item.description}</div></TableCell>
                        <TableCell>{item.unit}</TableCell>
                        <TableCell>{item.orderQty}</TableCell>
                        <TableCell>{item.jmcCertifiedQty}</TableCell>
                        <TableCell>{item.alreadyBilledQty}</TableCell>
                        <TableCell className="font-semibold">{item.availableQty}</TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            value={item.billedQty}
                            onChange={e =>
                              handleItemChange(index, 'billedQty', e.target.value)
                            }
                            max={item.availableQty}
                            className="w-24"
                            disabled={item.isBreakdown}
                          />
                        </TableCell>
                        <TableCell>{formatCurrency(item.rate)}</TableCell>
                        <TableCell>{formatCurrency(item.totalAmount)}</TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeItem(index)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>

                      {expandedRows.has(item.id) && item.isBreakdown && (
                        <TableRow className="bg-muted/50 hover:bg-muted/50">
                          <TableCell colSpan={12} className="p-0">
                            <div className="p-4">
                              <h4 className="mb-2 ml-2 font-semibold">Sub-Items Breakdown</h4>
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Sl.No</TableHead>
                                    <TableHead>Description</TableHead>
                                    <TableHead>Qty/Set</TableHead>
                                    <TableHead>Available Qty</TableHead>
                                    <TableHead>Billed Qty</TableHead>
                                    <TableHead>Rate</TableHead>
                                    <TableHead>Total Amount</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {item.subItems.map((sub, subIndex) => (
                                    <TableRow key={sub.id}>
                                      <TableCell>{sub.slNo}</TableCell>
                                      <TableCell>{sub.name}</TableCell>
                                      <TableCell>{sub.quantity}</TableCell>
                                      <TableCell className="font-semibold">
                                        {sub.availableQty}
                                      </TableCell>
                                      <TableCell>
                                        <Input
                                          type="number"
                                          className="w-24"
                                          value={sub.billedQty}
                                          onChange={e =>
                                            handleSubItemChange(
                                              index,
                                              subIndex,
                                              e.target.value
                                            )
                                          }
                                        />
                                      </TableCell>
                                      <TableCell>{formatCurrency(sub.rate)}</TableCell>
                                      <TableCell>{formatCurrency(sub.totalAmount)}</TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Financial Summary</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-8 md:grid-cols-2">
            <div className="space-y-6">
              <div>
                <Label>GST</Label>
                <RadioGroup
                  value={gstType}
                  onValueChange={v => setGstType(v as any)}
                  className="mt-2 flex gap-4"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="percentage" id="gst-percentage" />
                    <Label htmlFor="gst-percentage">Percentage</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="manual" id="gst-manual" />
                    <Label htmlFor="gst-manual">Manual</Label>
                  </div>
                </RadioGroup>
                {gstType === 'percentage' ? (
                  <div className="mt-2 flex items-center gap-2">
                    <Input
                      type="number"
                      placeholder="GST %"
                      value={gstPercentage}
                      onChange={e => setGstPercentage(toNumber(e.target.value))}
                    />
                    <span className="text-muted-foreground">%</span>
                  </div>
                ) : (
                  <Input
                    type="number"
                    placeholder="Enter GST Amount"
                    value={gstAmount}
                    onChange={e => setGstAmount(toNumber(e.target.value))}
                    className="mt-2"
                  />
                )}
              </div>

              <Separator />

              <div>
                <Label>Deductions</Label>
                <div className="mt-2 space-y-4">
                  <div className="space-y-2">
                    <Label>Retention</Label>
                    <RadioGroup
                      value={retentionType}
                      onValueChange={v => setRetentionType(v as any)}
                      className="flex gap-4"
                    >
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="percentage" id="ret-percentage" />
                        <Label htmlFor="ret-percentage">Percentage</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="manual" id="ret-manual" />
                        <Label htmlFor="ret-manual">Manual</Label>
                      </div>
                    </RadioGroup>
                    {retentionType === 'percentage' ? (
                      <div className="mt-2 flex items-center gap-2">
                        <Input
                          type="number"
                          placeholder="Retention %"
                          value={retentionPercentage}
                          onChange={e =>
                            setRetentionPercentage(toNumber(e.target.value))
                          }
                        />
                        <span className="text-muted-foreground">%</span>
                      </div>
                    ) : (
                      <Input
                        type="number"
                        placeholder="Enter Retention Amount"
                        value={manualRetentionAmount}
                        onChange={e =>
                          setManualRetentionAmount(toNumber(e.target.value))
                        }
                        className="mt-2"
                      />
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label>Advance Deductions</Label>
                    {advanceDeductions.map(adv => {
                      const selectedProforma = availableProformaBills.find(
                        p => p.id === adv.reference
                      );
                      return (
                        <Card key={adv.id} className="space-y-3 p-4">
                          <div className="flex items-start gap-2">
                            <div className="flex-grow space-y-2">
                              <Select
                                value={adv.reference}
                                onValueChange={v =>
                                  handleAdvanceChange(
                                    adv.id,
                                    'reference' as any,
                                    v
                                  )
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Select Proforma/Advance" />
                                </SelectTrigger>
                                <SelectContent>
                                  {availableProformaBills.map(proforma => (
                                    <SelectItem
                                      key={proforma.id}
                                      value={proforma.id}
                                      disabled={
                                        selectedAdvanceReferences.has(proforma.id) &&
                                        proforma.id !== adv.reference
                                      }
                                    >
                                      {proforma.proformaNo} (
                                      {formatCurrency(proforma.remainingBalance)})
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>

                              <RadioGroup
                                value={adv.deductionType}
                                onValueChange={v =>
                                  handleAdvanceChange(
                                    adv.id,
                                    'deductionType' as any,
                                    v
                                  )
                                }
                                className="flex gap-4 pt-2"
                              >
                                <div className="flex items-center space-x-2">
                                  <RadioGroupItem
                                    value="amount"
                                    id={`adv-type-amount-${adv.id}`}
                                  />
                                  <Label htmlFor={`adv-type-amount-${adv.id}`}>
                                    Amount
                                  </Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                  <RadioGroupItem
                                    value="percentage"
                                    id={`adv-type-percent-${adv.id}`}
                                  />
                                  <Label htmlFor={`adv-type-percent-${adv.id}`}>
                                    Percentage
                                  </Label>
                                </div>
                              </RadioGroup>

                              <div className="flex items-center gap-2">
                                <Input
                                  type="number"
                                  placeholder={
                                    adv.deductionType === 'amount'
                                      ? 'Amount to Deduct'
                                      : 'Percentage to Deduct'
                                  }
                                  value={adv.deductionValue}
                                  onChange={e =>
                                    handleAdvanceChange(
                                      adv.id,
                                      'deductionValue' as any,
                                      e.target.value
                                    )
                                  }
                                />
                                {adv.deductionType === 'percentage' && (
                                  <span className="text-muted-foreground">%</span>
                                )}
                              </div>
                            </div>

                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => removeAdvanceField(adv.id)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>

                          {selectedProforma && (
                            <div className="space-y-1 rounded-md bg-muted p-2 text-xs text-muted-foreground">
                              <div className="flex justify-between">
                                <span>Total Proforma Value:</span>
                                <span>
                                  {formatCurrency(selectedProforma.payableAmount || 0)}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span>Previously Deducted:</span>
                                <span>
                                  {formatCurrency(selectedProforma.totalDeducted || 0)}
                                </span>
                              </div>
                              <div className="flex justify-between font-medium">
                                <span>Available Balance:</span>
                                <span>
                                  {formatCurrency(
                                    selectedProforma.remainingBalance || 0
                                  )}
                                </span>
                              </div>
                              <div className="flex justify-between font-bold">
                                <span>Balance After Deduction:</span>
                                <span>
                                  {formatCurrency(
                                    (selectedProforma.remainingBalance || 0) -
                                      adv.amount
                                  )}
                                </span>
                              </div>
                            </div>
                          )}
                        </Card>
                      );
                    })}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={addAdvanceField}
                      className="mt-2"
                    >
                      <Plus className="mr-2 h-4 w-4" /> Add Advance
                    </Button>
                  </div>

                  <div className="mt-4 space-y-2">
                    <Label htmlFor="otherDeduction">Other Deductions</Label>
                    <Input
                      id="otherDeduction"
                      type="number"
                      placeholder="Enter other deductions"
                      value={otherDeduction}
                      onChange={e =>
                        setOtherDeduction(toNumber(e.target.value))
                      }
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-3 rounded-lg bg-muted/50 p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-medium">
                  {formatCurrency(financials.subtotal)}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">GST</span>
                <span className="font-medium">
                  {formatCurrency(financials.finalGstAmount)}
                </span>
              </div>
              <Separator />
              <div className="flex justify-between font-semibold">
                <span>Gross Amount</span>
                <span>{formatCurrency(financials.grossAmount)}</span>
              </div>
              <div className="flex justify-between text-sm text-destructive">
                <span className="text-muted-foreground">Retention</span>
                <span className="font-medium">
                  -{formatCurrency(financials.finalRetentionAmount)}
                </span>
              </div>
              <div className="flex justify-between text-sm text-destructive">
                <span className="text-muted-foreground">Advance Deductions</span>
                <span className="font-medium">
                  -{formatCurrency(financials.totalAdvanceDeduction)}
                </span>
              </div>
              <div className="flex justify-between text-sm text-destructive">
                <span className="text-muted-foreground">Other Deductions</span>
                <span className="font-medium">
                  -{formatCurrency(financials.otherDeduction)}
                </span>
              </div>
              <Separator />
              <div className="flex justify-between text-lg font-bold">
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
        alreadyAddedItems={alreadyAddedWorkOrderItems}
      />
    </>
  );
}
