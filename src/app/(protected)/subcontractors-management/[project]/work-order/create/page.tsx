
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, Plus, Trash2, Library } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs, query, doc, serverTimestamp, getDoc, runTransaction } from 'firebase/firestore';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { WorkOrderItem, BoqItem, Subcontractor, Project, SerialNumberConfig } from '@/lib/types';
import { BoqItemSelector } from '@/components/billing-recon/BoqItemSelector';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';
import { format } from 'date-fns';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BoqMultiSelectDialog } from '@/components/billing-recon/BoqMultiSelectDialog';

const initialWorkOrderDetails = {
    workOrderNo: '',
    date: new Date().toISOString().split('T')[0],
    subcontractorId: '',
};

const extractScope1 = (boqItem: BoqItem): string => {
  const key = Object.keys(boqItem).find(k => k.toLowerCase().replace(/\s+|\./g, '') === 'scope1');
  return key ? String((boqItem as any)[key] ?? '') : '';
};

const extractScope2 = (boqItem: BoqItem): string => {
  const key = Object.keys(boqItem).find(k => k.toLowerCase().replace(/\s+|\./g, '') === 'scope2');
  return key ? String((boqItem as any)[key] ?? '') : '';
};

export default function CreateWorkOrderPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const router = useRouter();
  const { project: projectSlug } = useParams() as { project: string };

  const [details, setDetails] = useState(initialWorkOrderDetails);
  const [items, setItems] = useState<WorkOrderItem[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [subcontractors, setSubcontractors] = useState<Subcontractor[]>([]);
  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [isBoqMultiSelectOpen, setIsBoqMultiSelectOpen] = useState(false);
  const [previewWoNo, setPreviewWoNo] = useState('Generating...');

  useEffect(() => {
    const fetchData = async () => {
        if(!projectSlug) return;
        
        const projectsQuery = query(collection(db, 'projects'));
        const projectsSnapshot = await getDocs(projectsQuery);
        const slugify = (text: string) => text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');
        const projectData = projectsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)).find(p => slugify(p.projectName) === projectSlug);

        if(!projectData) {
            toast({ title: 'Project not found', variant: 'destructive'});
            return;
        }
        setCurrentProject(projectData);
        
        const subsSnap = await getDocs(collection(db, 'subcontractors'));
        setSubcontractors(subsSnap.docs.map(d => ({id: d.id, ...d.data()} as Subcontractor)));

        const boqSnap = await getDocs(collection(db, 'projects', projectData.id, 'boqItems'));
        setBoqItems(boqSnap.docs.map(d => ({id: d.id, ...d.data()} as BoqItem)));
    };
    fetchData();
  }, [projectSlug, toast]);

  useEffect(() => {
    const generatePreviewId = async () => {
        try {
            const configRef = doc(db, 'serialNumberConfigs', 'work-order');
            const configDoc = await getDoc(configRef);
            if (configDoc.exists()) {
                const configData = configDoc.data() as SerialNumberConfig;
                const newIndex = configData.startingIndex;
                const datePart = configData.format ? format(new Date(), configData.format.replace(/y/g, 'y').replace(/m/g, 'M').replace(/d/g, 'd')) : '';
                const formattedIndex = String(newIndex).padStart(4, '0');
                const requestNo = `${configData.prefix || ''}${datePart}${formattedIndex}${configData.suffix || ''}`;
                setPreviewWoNo(requestNo);
            } else {
                setPreviewWoNo('Config not found');
            }
        } catch (error) {
            setPreviewWoNo('Error generating ID');
        }
    };
    generatePreviewId();
  }, []);

  const handleDetailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setDetails(prev => ({ ...prev, [name]: value }));
  };

  const handleItemChange = (index: number, field: keyof Omit<WorkOrderItem, 'id' | 'boqItemId' | 'description' | 'unit'>, value: string) => {
    const newItems = [...items];
    const item = newItems[index];
    
    if (field === 'orderQty' || field === 'rate') {
      (item[field] as number) = parseFloat(value) || 0;
    } else {
      (item as any)[field] = value;
    }

    item.totalAmount = (item.orderQty || 0) * (item.rate || 0);
    newItems[index] = item;
    setItems(newItems);
  };
  
  const addItem = () => {
    setItems([...items, { id: crypto.randomUUID(), boqItemId: '', description: '', unit: '', orderQty: 0, rate: 0, totalAmount: 0 }]);
  };

  const handleBoqItemSelect = (index: number, boqItem: BoqItem | null) => {
    if (!boqItem) return;
    const rateKey = Object.keys(boqItem).find(key => key.toLowerCase().includes('rate')) || 'rate';
    const newItems = [...items];
    newItems[index] = {
      ...newItems[index],
      boqItemId: boqItem.id,
      description: String(boqItem.Description || boqItem.DESCRIPTION || ''),
      unit: String(boqItem.UNIT || boqItem.Unit || ''),
      rate: Number((boqItem as any)[rateKey] || 0),
      boqSlNo: String(boqItem['BOQ SL No'] || ''),
      scope1: extractScope1(boqItem),
      scope2: extractScope2(boqItem),
    };
    setItems(newItems);
  };

  const handleMultiBoqSelect = (selectedItems: BoqItem[]) => {
      const newWorkOrderItems: WorkOrderItem[] = selectedItems.map(boqItem => {
          const rateKey = Object.keys(boqItem).find(key => key.toLowerCase().includes('rate')) || 'rate';
          return {
              id: crypto.randomUUID(),
              boqItemId: boqItem.id,
              description: String(boqItem.Description || boqItem.DESCRIPTION || ''),
              unit: String(boqItem.UNIT || boqItem.Unit || ''),
              orderQty: 0,
              rate: Number((boqItem as any)[rateKey] || 0),
              totalAmount: 0,
              boqSlNo: String(boqItem['BOQ SL No'] || ''),
              scope1: extractScope1(boqItem),
              scope2: extractScope2(boqItem),
          };
      });

      const isFirstItemEmpty = items.length === 1 && !items[0].boqItemId;
      if(isFirstItemEmpty) {
          setItems(newWorkOrderItems);
      } else {
          setItems(prev => [...prev, ...newWorkOrderItems]);
      }
  }

  const removeItem = (id: string) => {
    setItems(items.filter(item => item.id !== id));
  };

  const handleSave = async () => {
    if (!user || !currentProject || !details.subcontractorId || items.length === 0) {
      toast({ title: 'Missing Fields', description: 'Please select a subcontractor and add at least one item.', variant: 'destructive' });
      return;
    }
    setIsSaving(true);
    
    try {
        const configDocRef = doc(db, 'serialNumberConfigs', 'work-order');
        
        const workOrderNo = await runTransaction(db, async (transaction) => {
            const configDoc = await transaction.get(configDocRef);
            if (!configDoc.exists()) throw new Error("Work Order serial number configuration not found!");
            const config = configDoc.data() as SerialNumberConfig;
            const newIndex = config.startingIndex;
            const datePart = config.format ? format(new Date(), config.format.replace(/y/g, 'y').replace(/m/g, 'M').replace(/d/g, 'd')) : '';
            const newWoNo = `${config.prefix || ''}${datePart}${String(newIndex).padStart(4, '0')}${config.suffix || ''}`;
            transaction.update(configDocRef, { startingIndex: newIndex + 1 });
            return newWoNo;
        });

        const subcontractorName = subcontractors.find(s => s.id === details.subcontractorId)?.legalName || 'Unknown';
        const totalAmount = items.reduce((sum, item) => sum + (item.totalAmount || 0), 0);
        
        const woCollectionRef = collection(db, 'projects', currentProject.id, 'workOrders');
        const workOrderData = {
            ...details,
            workOrderNo,
            projectId: currentProject.id,
            subcontractorName,
            totalAmount,
            items,
            createdAt: serverTimestamp(),
            createdBy: user.id
        };
        await addDoc(woCollectionRef, workOrderData);
        
        toast({ title: 'Work Order Created', description: `Successfully created WO# ${workOrderNo}` });
        router.push(`/subcontractors-management/${projectSlug}/work-order`);

    } catch (error: any) {
        console.error("Error creating work order:", error);
        toast({ title: 'Save Failed', description: error.message || 'Could not create work order.', variant: 'destructive' });
    } finally {
        setIsSaving(false);
    }
  };

  return (
    <>
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
            <Link href={`/subcontractors-management/${projectSlug}/work-order`}>
                <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
            </Link>
            <h1 className="text-2xl font-bold">Create Work Order</h1>
        </div>
        <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Work Order
        </Button>
      </div>

      <Card className="mb-6">
        <CardHeader>
            <CardTitle>Work Order Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-2">
                <Label htmlFor="workOrderNo">Work Order No.</Label>
                <Input id="workOrderNo" value={previewWoNo} readOnly className="bg-muted" />
            </div>
            <div className="space-y-2">
                <Label htmlFor="date">Date</Label>
                <Input id="date" name="date" type="date" value={details.date} onChange={handleDetailChange} />
            </div>
             <div className="space-y-2">
                <Label htmlFor="subcontractor">Subcontractor</Label>
                <Select value={details.subcontractorId} onValueChange={(value) => setDetails(prev => ({ ...prev, subcontractorId: value }))}>
                    <SelectTrigger id="subcontractor"><SelectValue placeholder="Select a subcontractor" /></SelectTrigger>
                    <SelectContent>
                        {subcontractors.map(s => <SelectItem key={s.id} value={s.id}>{s.legalName}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
             <div className="flex justify-between items-center">
                <div>
                    <CardTitle>Work Order Items</CardTitle>
                    <CardDescription>Select items from the BOQ and specify quantity and rate.</CardDescription>
                </div>
                 <Button variant="outline" type="button" onClick={() => setIsBoqMultiSelectOpen(true)}><Library className="mr-2 h-4 w-4" /> Add Multiple Items</Button>
            </div>
        </CardHeader>
        <CardContent>
            <div className="overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>BOQ Sl.No</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead>Unit</TableHead>
                            <TableHead>BOQ Qty</TableHead>
                            <TableHead>BOQ Rate</TableHead>
                            <TableHead>Order Qty</TableHead>
                            <TableHead>Order Rate</TableHead>
                            <TableHead>Total Amount</TableHead>
                            <TableHead className="text-right">Action</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {items.map((item, index) => {
                            const boqItem = boqItems.find(b => b.id === item.boqItemId);
                            const boqQty = boqItem ? boqItem['QTY'] : '';
                            const rateKey = boqItem ? Object.keys(boqItem).find(k => k.toLowerCase().includes('rate')) : 'rate';
                            const boqRate = boqItem && rateKey ? (boqItem as any)[rateKey] : 0;

                            return (
                                <TableRow key={item.id}>
                                    <TableCell>
                                        <Input value={item.boqSlNo || ''} readOnly className="bg-muted min-w-[100px]"/>
                                    </TableCell>
                                    <TableCell>
                                        <Input value={item.description} readOnly className="bg-muted min-w-[250px]"/>
                                    </TableCell>
                                    <TableCell>
                                        <Input value={item.unit} readOnly className="bg-muted min-w-[80px]"/>
                                    </TableCell>
                                    <TableCell>
                                        <Input value={boqQty} readOnly className="bg-muted min-w-[100px]"/>
                                    </TableCell>
                                    <TableCell>
                                        <Input value={boqRate} readOnly className="bg-muted min-w-[120px]"/>
                                    </TableCell>
                                    <TableCell>
                                        <Input type="number" value={item.orderQty} onChange={(e) => handleItemChange(index, 'orderQty', e.target.value)} className="min-w-[100px]"/>
                                    </TableCell>
                                    <TableCell>
                                        <Input type="number" value={item.rate} onChange={(e) => handleItemChange(index, 'rate', e.target.value)} className="min-w-[120px]"/>
                                    </TableCell>
                                    <TableCell>
                                        <Input value={item.totalAmount.toFixed(2)} readOnly className="bg-muted min-w-[150px]"/>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button variant="ghost" size="icon" onClick={() => removeItem(item.id)}>
                                            <Trash2 className="h-4 w-4 text-destructive" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </div>
            <Button variant="outline" size="sm" onClick={addItem} className="mt-4"><Plus className="mr-2 h-4 w-4"/> Add Item</Button>
        </CardContent>
      </Card>
    </div>
    <BoqMultiSelectDialog
        isOpen={isBoqMultiSelectOpen}
        onOpenChange={setIsBoqMultiSelectOpen}
        boqItems={boqItems}
        onConfirm={handleMultiBoqSelect}
        alreadyAddedItems={[]}
      />
    </>
  );
}
