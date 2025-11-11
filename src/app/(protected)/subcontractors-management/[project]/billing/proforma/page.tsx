
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, Plus, Trash2, Library } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs, doc, query, where, serverTimestamp } from 'firebase/firestore';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { BillItem, WorkOrder, WorkOrderItem, JmcEntry, Project, ProformaBill, Bill } from '@/lib/types';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { WorkOrderItemSelectorDialog } from '@/components/WorkOrderItemSelectorDialog';
import { Separator } from '@/components/ui/separator';

const initialBillDetails = {
    proformaNo: '',
    date: new Date().toISOString().split('T')[0],
    workOrderId: '',
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
    boqQty: number;
    jmcCertifiedQty: number;
    alreadyBilledQty: number;
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
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  
  const [payablePercentage, setPayablePercentage] = useState<number>(100);

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

        const woQuery = query(collection(db, 'projects', project.id, 'workOrders'));
        const jmcQuery = query(collection(db, 'projects', project.id, 'jmcEntries'));
        const billsQuery = query(collection(db, 'projects', project.id, 'bills'));
        const boqQuery = query(collection(db, 'projects', project.id, 'boqItems'));

        const [woSnap, jmcSnap, billsSnap, boqSnap] = await Promise.all([
          getDocs(woQuery),
          getDocs(jmcQuery),
          getDocs(billsQuery),
          getDocs(boqQuery)
        ]);

        setWorkOrders(woSnap.docs.map(d => ({id: d.id, ...d.data()} as WorkOrder)));
        setJmcEntries(jmcSnap.docs.map(d => d.data() as JmcEntry));
        setBills(billsSnap.docs.map(d => ({id: d.id, ...d.data()} as Bill)));
        setBoqItems(boqSnap.docs.map(d => ({ id: d.id, ...d.data() } as BoqItem)));
    };
    fetchProjectAndWorkOrders();
  }, [projectSlug, toast]);
  
  useEffect(() => {
      const wo = workOrders.find(w => w.id === details.workOrderId);
      setSelectedWorkOrder(wo || null);
      setItems([]);
  }, [details.workOrderId, workOrders]);

  const handleDetailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setDetails(prev => ({ ...prev, [name]: value }));
  };
  
  const handleItemChange = (index: number, field: 'billedQty', value: string) => {
      const newItems = [...items];
      const item = newItems[index];
      const billedQty = parseFloat(value);
      
      const availableForBilling = item.boqQty - item.alreadyBilledQty;
      
      if(isNaN(billedQty) || billedQty < 0) {
        item.billedQty = '';
        item.totalAmount = '';
      } else if (billedQty > availableForBilling) {
          toast({
              title: 'Quantity Exceeded',
              description: `Billed quantity cannot be more than the available quantity (${availableForBilling}).`,
              variant: 'destructive',
          });
          item.billedQty = availableForBilling.toString();
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
        
        const boqItem = boqItems.find(b => b.id === woItem.boqItemId);
        const boqQty = boqItem ? Number((boqItem as any).QTY || 0) : 0;

        return {
            jmcItemId: woItem.id,
            jmcEntryId: '',
            jmcNo: '',
            boqSlNo: woItem.boqSlNo || '',
            description: woItem.description,
            unit: woItem.unit,
            rate: String(woItem.rate),
            orderQty: woItem.orderQty,
            boqQty: boqQty,
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

  const financials = useMemo(() => {
    const subtotal = items.reduce((sum, item) => sum + parseFloat(item.totalAmount || '0'), 0);
    const payableAmount = subtotal * (payablePercentage / 100);
    return { subtotal, payableAmount };
  }, [items, payablePercentage]);


  const handleSave = async () => {
    if (!user || !details.proformaNo || !selectedWorkOrder || items.length === 0) {
        toast({ title: 'Missing Required Fields', description: 'Please fill in Proforma No, select a Work Order, and add at least one item.', variant: 'destructive'});
        return;
    }
    setIsSaving(true);
    
    try {
        const itemsToSave = items.map(({ jmcCertifiedQty, alreadyBilledQty, boqQty, ...rest }) => ({
            ...rest,
            billedQty: parseFloat(rest.billedQty) || 0,
        }));

        const proformaData: Omit<ProformaBill, 'id'> = {
            proformaNo: details.proformaNo,
            date: details.date,
            workOrderId: details.workOrderId,
            workOrderNo: selectedWorkOrder.workOrderNo,
            subcontractorId: selectedWorkOrder.subcontractorId,
            subcontractorName: selectedWorkOrder.subcontractorName,
            items: itemsToSave,
            subtotal: financials.subtotal,
            payablePercentage: payablePercentage,
            payableAmount: financials.payableAmount,
            createdAt: serverTimestamp(),
            projectId: currentProject?.id || '',
        };

        if(!currentProject) throw new Error("Project ID is missing");
        
        await addDoc(collection(db, 'projects', currentProject.id, 'proformaBills'), proformaData);
        
        toast({ title: 'Proforma Bill Created', description: 'The new proforma/advance bill has been successfully saved.' });
        router.push(`/subcontractors-management/${projectSlug}/billing`);

    } catch (error) {
        console.error("Error creating proforma bill: ", error);
        toast({ title: 'Save Failed', description: 'An error occurred while saving the proforma bill.', variant: 'destructive' });
    } finally {
        setIsSaving(false);
    }
  };
  
  const formatCurrency = (amount: string | number) => {
    const num = parseFloat(String(amount));
    if(isNaN(num)) return amount;
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(num);
  }

  return (
    <>
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
              <Link href={`/subcontractors-management/${projectSlug}/billing`}>
                  <Button variant="ghost" size="icon"> <ArrowLeft className="h-6 w-6" /> </Button>
              </Link>
              <h1 className="text-2xl font-bold">Proforma / Advance Bill</h1>
          </div>
          <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save Proforma Bill
          </Button>
        </div>

        <Card className="mb-6">
          <CardHeader><CardTitle>Proforma Bill Details</CardTitle></CardHeader>
          <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                      <Label htmlFor="workOrderId">Work Order No</Label>
                      <Select value={details.workOrderId} onValueChange={(value) => setDetails(prev => ({ ...prev, workOrderId: value }))}>
                          <SelectTrigger id="workOrderId"><SelectValue placeholder="Select a Work Order" /></SelectTrigger>
                          <SelectContent>
                              {workOrders.map(wo => <SelectItem key={wo.id} value={wo.id}>{wo.workOrderNo}</SelectItem>)}
                          </SelectContent>
                      </Select>
                  </div>
                  <div className="space-y-2">
                      <Label htmlFor="proformaNo">Proforma/Advance No</Label>
                      <Input id="proformaNo" name="proformaNo" value={details.proformaNo} onChange={handleDetailChange} />
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
                                  <TableCell>{item.description}</TableCell>
                                  <TableCell>{item.unit}</TableCell>
                                  <TableCell>{item.boqQty}</TableCell>
                                  <TableCell>{item.orderQty}</TableCell>
                                  <TableCell>{item.jmcCertifiedQty}</TableCell>
                                  <TableCell>{item.alreadyBilledQty}</TableCell>
                                  <TableCell className="font-semibold">{item.boqQty - item.alreadyBilledQty}</TableCell>
                                  <TableCell>{formatCurrency(item.rate)}</TableCell>
                                  <TableCell>
                                      <Input 
                                        type="number" 
                                        value={item.billedQty}
                                        onChange={(e) => handleItemChange(index, 'billedQty', e.target.value)}
                                        max={item.boqQty - item.alreadyBilledQty}
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
                <div className="space-y-4">
                    <Label>Payable Percentage</Label>
                    <div className="flex items-center gap-2">
                        <Input type="number" placeholder="Payable %" value={payablePercentage} onChange={e => setPayablePercentage(parseFloat(e.target.value) || 0)} />
                        <span className="text-muted-foreground">%</span>
                    </div>
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
