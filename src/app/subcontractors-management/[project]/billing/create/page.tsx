
'use client';

import { useState, useEffect } from 'react';
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
import type { BillItem, WorkOrder, WorkOrderItem, JmcEntry, Project } from '@/lib/types';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { WorkOrderItemSelectorDialog } from '@/components/WorkOrderItemSelectorDialog';

const initialBillDetails = {
    billNo: '',
    billDate: new Date().toISOString().split('T')[0],
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

export default function CreateBillPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const router = useRouter();
  const { project: projectSlug } = useParams() as { project: string };

  const [details, setDetails] = useState(initialBillDetails);
  const [items, setItems] = useState<BillItem[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isSelectorOpen, setIsSelectorOpen] = useState(false);
  
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<WorkOrder | null>(null);

  useEffect(() => {
    const fetchWorkOrders = async () => {
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
        const projectId = project.id;
        
        const woQuery = query(collection(db, 'projects', projectId, 'workOrders'));
        const woSnap = await getDocs(woQuery);
        setWorkOrders(woSnap.docs.map(d => ({id: d.id, ...d.data()} as WorkOrder)));
    };
    fetchWorkOrders();
  }, [projectSlug, toast]);
  
  useEffect(() => {
      const wo = workOrders.find(w => w.id === details.workOrderId);
      setSelectedWorkOrder(wo || null);
      setItems([]); // Reset items when WO changes
  }, [details.workOrderId, workOrders]);

  const handleDetailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setDetails(prev => ({ ...prev, [name]: value }));
  };
  
  const handleItemChange = (index: number, field: 'billedQty', value: string) => {
      const newItems = [...items];
      const item = newItems[index];
      const billedQty = parseFloat(value);
      const availableQty = parseFloat(item.executedQty); // ExecutedQty holds available qty
      
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
      const newBillItems: BillItem[] = selectedWoItems.map(woItem => ({
        jmcItemId: woItem.id, 
        jmcEntryId: '', 
        jmcNo: '', 
        boqSlNo: woItem.boqSlNo || '',
        description: woItem.description,
        unit: woItem.unit,
        rate: String(woItem.rate),
        executedQty: String(woItem.orderQty), 
        billedQty: '',
        totalAmount: '',
      }));
      setItems(prev => [...prev, ...newBillItems]);
  }

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!user || !details.billNo || !selectedWorkOrder || items.length === 0) {
        toast({ title: 'Missing Required Fields', description: 'Please fill in Bill No, select a Work Order, and add at least one item.', variant: 'destructive'});
        return;
    }
    setIsSaving(true);
    
    try {
        const totalAmount = items.reduce((sum, item) => sum + parseFloat(item.totalAmount || '0'), 0);
        const billData = {
            ...details,
            workOrderNo: selectedWorkOrder.workOrderNo,
            items: items.map(item => ({...item, billedQty: parseFloat(item.billedQty)})),
            totalAmount,
            createdAt: serverTimestamp()
        };
        const projectId = selectedWorkOrder.projectId;
        await addDoc(collection(db, 'projects', projectId, 'bills'), billData);
        
        toast({ title: 'Bill Created', description: 'The new bill has been successfully saved.' });
        router.push(`/subcontractors-management/${projectSlug}/billing/log`);

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

  return (
    <>
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
              <Link href={`/subcontractors-management/${projectSlug}/billing`}>
                  <Button variant="ghost" size="icon"> <ArrowLeft className="h-6 w-6" /> </Button>
              </Link>
              <h1 className="text-2xl font-bold">Create New Bill</h1>
          </div>
          <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save Bill
          </Button>
        </div>

        <Card className="mb-6">
          <CardHeader><CardTitle>Bill Details</CardTitle></CardHeader>
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
                  <Button variant="outline" onClick={() => setIsSelectorOpen(true)} disabled={!selectedWorkOrder}>
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
                              <TableHead>Ordered Qty</TableHead>
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
                                  <TableCell>{item.executedQty}</TableCell>
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
