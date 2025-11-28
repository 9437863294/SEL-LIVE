'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, Plus, Trash2, Library, ShieldAlert } from 'lucide-react';
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
  BillItem,
  WorkOrder,
  WorkOrderItem,
  JmcEntry,
  Project,
  ProformaBill,
  Bill,
  BoqItem,
  WorkflowStep,
  ActionLog,
  Subcontractor,
} from '@/lib/types';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { WorkOrderItemSelectorDialog } from '@/components/subcontractors-management/WorkOrderItemSelectorDialog';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { getAssigneeForStep, calculateDeadline } from '@/lib/workflow-utils';

const initialBillDetails = {
  proformaNo: '',
  date: new Date().toISOString().split('T')[0],
  workOrderId: '',
  subcontractorId: '',
};

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
  boqQty: number;
  jmcCertifiedQty: number;
  alreadyBilledQty: number;
  // In UI we actually treat billedQty as string, but convert when saving
};

export default function CreateProformaPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const router = useRouter();
  const { project: projectSlug } = useParams() as { project: string };

  const [details, setDetails] = useState(initialBillDetails);
  const [items, setItems] = useState<EnrichedBillItem[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isSelectorOpen, setIsSelectorOpen] = useState(false);

  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<WorkOrder | null>(null);

  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [jmcEntries, setJmcEntries] = useState<JmcEntry[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [existingProformaBills, setExistingProformaBills] = useState<ProformaBill[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [subcontractors, setSubcontractors] = useState<Subcontractor[]>([]);

  const [payablePercentage, setPayablePercentage] = useState<number>(100);
  const [approvalCopy, setApprovalCopy] = useState<File | null>(null);
  const [showApprovalUpload, setShowApprovalUpload] = useState(false);

  useEffect(() => {
    const fetchProjectAndData = async () => {
      if (!projectSlug) return;

      const projectsQuery = query(collection(db, 'projects'));
      const projectSnap = await getDocs(projectsQuery);
      const project = projectSnap.docs
        .map((doc) => ({ id: doc.id, ...doc.data() } as Project))
        .find((p) => slugify(p.projectName) === projectSlug);

      if (!project) {
        console.error('Project not found from slug:', projectSlug);
        toast({ title: 'Error', description: 'Project not found.', variant: 'destructive' });
        return;
      }
      setCurrentProject(project);

      // Use collectionGroup to match the behavior of the working Bill page
      const subsQuery = query(collectionGroup(db, 'subcontractors'));
      const woQuery = query(collectionGroup(db, 'workOrders'));
      const jmcQuery = query(collectionGroup(db, 'jmcEntries'));
      const billsQuery = query(collectionGroup(db, 'bills'));
      const proformaQuery = query(collectionGroup(db, 'proformaBills'));
      const boqQuery = query(collection(db, 'projects', project.id, 'boqItems'));

      const [subsSnap, woSnap, jmcSnap, billsSnap, boqSnap, proformaSnap] = await Promise.all([
        getDocs(subsQuery),
        getDocs(woQuery),
        getDocs(jmcQuery),
        getDocs(billsQuery),
        getDocs(boqQuery),
        getDocs(proformaQuery),
      ]);

      const allSubs = subsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Subcontractor));
      const allWos = woSnap.docs.map((d) => ({ id: d.id, ...d.data() } as WorkOrder));

      const projectWorkOrders = allWos.filter((wo) => wo.projectId === project.id);
      const subIdsWithProjectWo = new Set(projectWorkOrders.map((wo) => wo.subcontractorId));

      setSubcontractors(allSubs.filter((sub) => subIdsWithProjectWo.has(sub.id)));
      setWorkOrders(projectWorkOrders);

      setJmcEntries(
        jmcSnap.docs
          .map((d) => d.data() as JmcEntry)
          .filter((jmc) => jmc.projectId === project.id),
      );
      setBills(
        billsSnap.docs
          .map((d) => ({ id: d.id, ...d.data() } as Bill))
          .filter((b) => b.projectId === project.id),
      );
      setExistingProformaBills(
        proformaSnap.docs
          .map((d) => ({ id: d.id, ...d.data() } as ProformaBill))
          .filter((p) => p.projectId === project.id),
      );
      setBoqItems(boqSnap.docs.map((d) => ({ id: d.id, ...d.data() } as BoqItem)));
    };

    fetchProjectAndData();
  }, [projectSlug, toast]);

  const filteredWorkOrders = useMemo(() => {
    if (!details.subcontractorId) return [];
    return workOrders.filter((wo) => wo.subcontractorId === details.subcontractorId);
  }, [details.subcontractorId, workOrders]);

  const handleSubcontractorChange = (subcontractorId: string) => {
    setDetails((prev) => ({
      ...prev,
      subcontractorId,
      workOrderId: '', // Reset work order when subcontractor changes
    }));
    setSelectedWorkOrder(null);
    setItems([]);
  };

  useEffect(() => {
    const wo = workOrders.find((w) => w.id === details.workOrderId);
    setSelectedWorkOrder(wo || null);
    if (details.workOrderId) {
      setItems([]);
    }
  }, [details.workOrderId, workOrders]);

  const handleDetailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setDetails((prev) => ({ ...prev, [name]: value }));
  };

  const handleItemChange = (index: number, field: 'billedQty', value: string) => {
    const newItems = [...items];
    const item = newItems[index];
    const billedQty = parseFloat(value);

    const availableForBilling = item.orderQty - item.alreadyBilledQty;

    if (isNaN(billedQty) || billedQty < 0) {
      (item as any).billedQty = '';
      (item as any).totalAmount = '';
    } else if (billedQty > availableForBilling) {
      toast({
        title: 'Quantity Exceeded',
        description: `Billed quantity cannot be more than the available quantity (${availableForBilling}).`,
        variant: 'destructive',
      });
      (item as any).billedQty = availableForBilling.toString();
    } else {
      (item as any).billedQty = value;
    }

    const rate = parseFloat(item.rate as any);
    if (!isNaN(rate) && (item as any).billedQty) {
      (item as any).totalAmount = (parseFloat((item as any).billedQty) * rate).toFixed(2);
    } else {
      (item as any).totalAmount = '';
    }

    newItems[index] = item;
    setItems(newItems);
  };

  const handleItemsAdd = (selectedWoItems: WorkOrderItem[]) => {
    const newBillItems: EnrichedBillItem[] = selectedWoItems.map((woItem) => {
      const totalJmcCertifiedForBoqItem = jmcEntries
        .flatMap((jmc) => jmc.items)
        .filter((jmcItem) => jmcItem.boqSlNo === woItem.boqSlNo)
        .reduce((sum, item) => sum + (item.certifiedQty || 0), 0);

      const alreadyBilledForWoItem = bills
        .filter((bill) => bill.workOrderId === details.workOrderId)
        .flatMap((bill) => bill.items)
        .filter((billItem) => billItem.jmcItemId === woItem.id)
        .reduce((sum, item) => sum + parseFloat((item.billedQty as any) || '0'), 0);

      const availableForBilling = woItem.orderQty - alreadyBilledForWoItem;

      const boqItem = boqItems.find((b) => b.id === woItem.boqItemId);
      const boqQty = boqItem ? Number((boqItem as any).QTY || 0) : 0;

      return {
        jmcItemId: woItem.id,
        jmcEntryId: '',
        jmcNo: '',
        boqSlNo: woItem.boqSlNo || '',
        description: woItem.description,
        unit: woItem.unit,
        rate: String(woItem.rate) as any,
        orderQty: woItem.orderQty,
        boqQty,
        jmcCertifiedQty: totalJmcCertifiedForBoqItem,
        alreadyBilledQty: alreadyBilledForWoItem,
        executedQty: String(Math.max(0, availableForBilling)) as any,
        billedQty: '' as any,
        totalAmount: '' as any,
      } as EnrichedBillItem;
    });
    setItems((prev) => [...prev, ...newBillItems]);
  };

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const financials = useMemo(() => {
    const subtotal = items.reduce(
      (sum, item) => sum + parseFloat((item.totalAmount as any) || '0'),
      0,
    );
    const payableAmount = subtotal * (payablePercentage / 100);
    return { subtotal, payableAmount };
  }, [items, payablePercentage]);

  const handleSave = async () => {
    if (!user || !details.proformaNo || !selectedWorkOrder || items.length === 0) {
      toast({
        title: 'Missing Required Fields',
        description: 'Please fill in Proforma No, select a Work Order, and add at least one item.',
        variant: 'destructive',
      });
      return;
    }

    const workOrderValue = selectedWorkOrder.totalAmount || 0;

    const totalBilledInRegularBills = bills
      .filter((b) => b.workOrderId === selectedWorkOrder.id)
      .reduce((sum, bill) => sum + (bill.netPayable || 0), 0);

    const totalInOtherProformas = existingProformaBills
      .filter((pb) => pb.workOrderId === selectedWorkOrder.id)
      .reduce((sum, bill) => sum + (bill.payableAmount || 0), 0);

    const totalClaimedSoFar = totalBilledInRegularBills + totalInOtherProformas;
    const remainingWorkOrderValue = workOrderValue - totalClaimedSoFar;

    const exceedsLimit = financials.payableAmount > remainingWorkOrderValue;
    setShowApprovalUpload(exceedsLimit);

    if (exceedsLimit && !approvalCopy) {
      toast({
        title: 'Approval Required',
        description:
          'The payable amount exceeds the remaining work order value. Please upload an approval copy.',
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
      if (steps.length === 0) throw new Error('Billing workflow has no steps.');
      const firstStep = steps[0];

      let approvalCopyUrl: string | undefined = undefined;
      if (approvalCopy && exceedsLimit) {
        // TODO: upload approvalCopy to storage and set approvalCopyUrl
      }

      const itemsToSave: (Omit<BillItem, 'billedQty'> & { billedQty: number })[] = items.map(
        ({ jmcCertifiedQty, alreadyBilledQty, boqQty, orderQty, ...rest }) => {
          const billedQtyNumber = parseFloat((rest as any).billedQty || '0');
          return {
            ...(rest as Omit<BillItem, 'billedQty'>),
            billedQty: isNaN(billedQtyNumber) ? 0 : billedQtyNumber,
          };
        },
      );

      const proformaData: Omit<ProformaBill, 'id'> = {
        proformaNo: details.proformaNo,
        date: details.date,
        workOrderId: details.workOrderId,
        workOrderNo: selectedWorkOrder.workOrderNo,
        subcontractorId: selectedWorkOrder.subcontractorId,
        subcontractorName: selectedWorkOrder.subcontractorName,
        items: itemsToSave,
        subtotal: financials.subtotal,
        payablePercentage,
        payableAmount: financials.payableAmount,
        createdAt: serverTimestamp() as unknown as Timestamp,
        projectId: currentProject?.id || '',
        projectName: currentProject?.projectName || '',
        status: 'Pending',
        stage: firstStep.name,
        currentStepId: firstStep.id,
        assignees: [],
        history: [],
        approvalCopyUrl,
      };

      const tempForAssignment = { ...proformaData, amount: proformaData.payableAmount };
      const assignees = await getAssigneeForStep(firstStep, tempForAssignment as any);
      if (!assignees || assignees.length === 0)
        throw new Error(`Could not find assignee for step: ${firstStep.name}`);
      proformaData.assignees = assignees;

      const deadline = await calculateDeadline(new Date(), firstStep.tat);
      (proformaData as any).deadline = Timestamp.fromDate(deadline);

      const initialLog: ActionLog = {
        action: 'Created',
        comment: 'Proforma/Advance bill created.',
        userId: user.id,
        userName: user.name,
        timestamp: Timestamp.now(),
        stepName: 'Creation',
      };
      proformaData.history = [initialLog];

      if (!currentProject) throw new Error('Project ID is missing');

      await addDoc(collection(db, 'projects', currentProject.id, 'proformaBills'), proformaData);

      toast({
        title: 'Proforma Bill Created',
        description: 'The new proforma/advance bill has been successfully saved.',
      });
      router.push(`/subcontractors-management/${projectSlug}/billing`);
    } catch (error: any) {
      console.error('Error creating proforma bill: ', error);
      toast({
        title: 'Save Failed',
        description: error.message || 'An error occurred while saving the proforma bill.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const formatCurrency = (amount: string | number) => {
    const num = parseFloat(String(amount));
    if (isNaN(num)) return formatCurrency(0);
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(num);
  };

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
            <h1 className="text-2xl font-bold">Proforma / Advance Bill</h1>
          </div>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Proforma Bill
          </Button>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Proforma Bill Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <Label htmlFor="subcontractorId">Subcontractor</Label>
                <Select value={details.subcontractorId} onValueChange={handleSubcontractorChange}>
                  <SelectTrigger id="subcontractorId">
                    <SelectValue placeholder="Select a Subcontractor" />
                  </SelectTrigger>
                  <SelectContent>
                    {subcontractors.map((sc) => (
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
                  onValueChange={(value) => setDetails((prev) => ({ ...prev, workOrderId: value }))}
                  disabled={!details.subcontractorId}
                >
                  <SelectTrigger id="workOrderId">
                    <SelectValue placeholder="Select a Work Order" />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredWorkOrders.map((wo) => (
                      <SelectItem key={wo.id} value={wo.id}>
                        {wo.workOrderNo}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="proformaNo">Proforma/Advance No</Label>
                <Input
                  id="proformaNo"
                  name="proformaNo"
                  value={details.proformaNo}
                  onChange={handleDetailChange}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="date">Date</Label>
                <Input id="date" name="date" type="date" value={details.date} onChange={handleDetailChange} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Items</CardTitle>
                <CardDescription>Add items from the selected Work Order.</CardDescription>
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
                    <TableHead>BOQ Sl. No.</TableHead>
                    <TableHead className="w-72">Description</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>BOQ Qty</TableHead>
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

                      {/* Description – neatly clamped to 2 lines, full text on hover */}
                      <TableCell className="max-w-[18rem] align-top py-2">
                        <div
                          className="line-clamp-2 text-sm leading-snug break-words"
                          title={item.description}
                        >
                          {item.description}
                        </div>
                      </TableCell>

                      <TableCell>{item.unit}</TableCell>
                      <TableCell>{item.boqQty}</TableCell>
                      <TableCell>{item.orderQty}</TableCell>
                      <TableCell>{item.jmcCertifiedQty}</TableCell>
                      <TableCell>{item.alreadyBilledQty}</TableCell>
                      <TableCell className="font-semibold">
                        {item.orderQty - item.alreadyBilledQty}
                      </TableCell>
                      <TableCell>{formatCurrency(item.rate as any)}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          value={(item as any).billedQty}
                          onChange={(e) => handleItemChange(index, 'billedQty', e.target.value)}
                          max={item.orderQty - item.alreadyBilledQty}
                          className="w-24"
                        />
                      </TableCell>
                      <TableCell>{formatCurrency((item as any).totalAmount)}</TableCell>
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
          <CardHeader>
            <CardTitle>Financial Summary</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-4">
              <Label>Payable Percentage</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  placeholder="Payable %"
                  value={payablePercentage}
                  onChange={(e) => setPayablePercentage(parseFloat(e.target.value) || 0)}
                />
                <span className="text-muted-foreground">%</span>
              </div>
              {showApprovalUpload && (
                <div className="space-y-2 pt-4">
                  <Alert variant="destructive">
                    <ShieldAlert className="h-4 w-4" />
                    <AlertTitle>Approval Required</AlertTitle>
                    <AlertDescription>
                      This amount exceeds the work order value. Please upload an approval document to
                      proceed.
                    </AlertDescription>
                  </Alert>
                  <Label htmlFor="approvalCopy">Approval Copy</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="approvalCopy"
                      type="file"
                      onChange={(e) =>
                        setApprovalCopy(e.target.files ? e.target.files[0] : null)
                      }
                    />
                    {approvalCopy && (
                      <span className="text-sm text-muted-foreground truncate">
                        {approvalCopy.name}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="space-y-3 p-4 bg-muted/50 rounded-lg">
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-medium">{formatCurrency(financials.subtotal)}</span>
              </div>
              <Separator />
              <div className="flex justify-between items-center font-bold text-lg">
                <span>Payable Amount</span>
                <span>{formatCurrency(financials.payableAmount)}</span>
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
