
'use client';

import { useState, useEffect, useMemo, Fragment } from 'react';
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
  where,
  serverTimestamp,
  getDoc,
  runTransaction,
  collectionGroup,
  writeBatch,
} from 'firebase/firestore';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type {
  WorkOrderItem as OriginalWorkOrderItem,
  SubItem,
  BoqItem,
  Subcontractor,
  Project,
  SerialNumberConfig,
  FabricationBomItem,
} from '@/lib/types';
import { BoqItemSelector } from '@/components/billing-recon/BoqItemSelector';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';
import { format } from 'date-fns';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BoqMultiSelectDialog } from '@/components/billing-recon/BoqMultiSelectDialog';
import { Switch } from '@/components/ui/switch';
import { nanoid } from 'nanoid';
import { cn } from '@/lib/utils';


// Add isBreakdown to UI-level type
type WorkOrderItem = Omit<OriginalWorkOrderItem, 'id' | 'subItems'> & {
  id: string;
  isBreakdown: boolean;
  subItems: (SubItem & { id: string })[];
  boqSlNo?: string;
};


const initialWorkOrderDetails = {
    workOrderNo: '',
    date: new Date().toISOString().split('T')[0],
    subcontractorId: '',
};

const initialSubItemState: Omit<SubItem, 'id'> = {
  name: '',
  unit: 'sqm',
  quantity: 0,
  rate: 0,
  totalAmount: 0,
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
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  useEffect(() => {
    const fetchData = async () => {
        if(!projectSlug) return;
        
        const projectsQuery = query(collection(db, 'projects'));
        const projectsSnapshot = await getDocs(projectsQuery);
        const projectData = projectsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)).find(p => slugify(p.projectName) === projectSlug);

        if(!projectData) {
            toast({ title: 'Project not found', variant: 'destructive'});
            return;
        }
        setCurrentProject(projectData);
        
        const subsSnap = await getDocs(query(collection(db, 'subcontractors'), where('status', '==', 'Active')));
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
    if(items.length === 0){
        addItem();
    }
  }, [projectSlug, items]);

  const handleDetailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setDetails(prev => ({ ...prev, [name]: value }));
  };

  const handleItemChange = (index: number, field: keyof Omit<WorkOrderItem, 'id' | 'boqItemId' | 'description' | 'unit' | 'subItems'>, value: string | number | boolean) => {
    const newItems = [...items];
    const item = newItems[index];

    if (field === 'isBreakdown') {
      item.isBreakdown = value as boolean;
      if (value && item.subItems.length === 0) {
        item.subItems = [{ ...initialSubItemState, id: nanoid() }];
      }
    } else if (field === 'orderQty' || field === 'rate') {
      (item[field] as number) = Number(value) || 0;
    } else {
      (item as any)[field] = value;
    }

    if (!item.isBreakdown) {
      item.totalAmount = (item.orderQty || 0) * (item.rate || 0);
    } else {
      item.totalAmount = item.subItems.reduce((sum, si) => sum + ((si.quantity || 0) * (si.rate || 0)), 0) * (item.orderQty || 0);
    }

    newItems[index] = item;
    setItems(newItems);
  };
  
  const handleSubItemChange = (itemIndex: number, subIndex: number, field: keyof SubItem, value: string | number) => {
    const newItems = [...items];
    const mainItem = newItems[itemIndex];
    const subItem = mainItem.subItems[subIndex];

    if (field === 'quantity' || field === 'rate') {
      (subItem[field] as number) = Number(value) || 0;
    } else {
      (subItem as any)[field] = value;
    }
    
    subItem.totalAmount = (subItem.quantity || 0) * (subItem.rate || 0);
    
    // Recalculate main item total from sub-items and main item's multiplier
    mainItem.totalAmount = mainItem.subItems.reduce((sum, si) => sum + (si.totalAmount || 0), 0) * (mainItem.orderQty || 0);
    
    setItems(newItems);
  };
  
  const addSubItem = (itemIndex: number) => {
    const newItems = [...items];
    newItems[itemIndex].subItems.push({ ...initialSubItemState, id: nanoid() });
    setItems(newItems);
  };

  const removeSubItem = (itemIndex: number, subItemId: string) => {
    const newItems = [...items];
    if(newItems[itemIndex].subItems.length > 1) {
        newItems[itemIndex].subItems = newItems[itemIndex].subItems.filter(si => si.id !== subItemId);
        // Recalculate main item total
        newItems[itemIndex].totalAmount = newItems[itemIndex].subItems.reduce((sum, si) => sum + (si.totalAmount || 0), 0) * (newItems[itemIndex].orderQty || 0);
        setItems(newItems);
    }
  };

  const addItem = () => {
    setItems([...items, { id: nanoid(), boqItemId: '', description: '', unit: '', orderQty: 0, rate: 0, totalAmount: 0, isBreakdown: false, subItems: [] }]);
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
    };
    setItems(newItems);
  };
  
  const handleMultiBoqSelect = (selectedItems: BoqItem[]) => {
      const newWorkOrderItems: WorkOrderItem[] = selectedItems.map(boqItem => {
          const rateKey = Object.keys(boqItem).find(key => key.toLowerCase().includes('rate')) || 'rate';
          return {
              id: nanoid(),
              boqItemId: boqItem.id,
              description: String(boqItem.Description || boqItem.DESCRIPTION || ''),
              unit: String(boqItem.UNIT || boqItem.Unit || ''),
              orderQty: 0,
              rate: Number((boqItem as any)[rateKey] || 0),
              totalAmount: 0,
              boqSlNo: String(boqItem['BOQ SL No'] || ''),
              isBreakdown: false,
              subItems: [],
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
  
  const toggleRowExpansion = (itemId: string) => {
    setExpandedRows(prev => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
      }
      return newSet;
    });
  };

  const handleSave = async () => {
    if (!user || !currentProject || !details.subcontractorId || items.length === 0) {
      toast({ title: 'Missing Fields', description: 'Please select a subcontractor and add at least one item.', variant: 'destructive' });
      return;
    }
    setIsSaving(true);
    
    try {
        const configDocRef = doc(db, 'serialNumberConfigs', 'work-order');
        
        await runTransaction(db, async (transaction) => {
            const configDoc = await transaction.get(configDocRef);
            if (!configDoc.exists()) throw new Error("Work Order serial number configuration not found!");
            const config = configDoc.data() as SerialNumberConfig;
            const newIndex = config.startingIndex;
            const datePart = config.format ? format(new Date(), config.format.replace(/y/g, 'y').replace(/m/g, 'M').replace(/d/g, 'd')) : '';
            const workOrderNo = `${config.prefix || ''}${datePart}${String(newIndex).padStart(4, '0')}${config.suffix || ''}`;
            
            transaction.update(configDocRef, { startingIndex: newIndex + 1 });

            const subcontractorName = subcontractors.find(s => s.id === details.subcontractorId)?.legalName || 'Unknown';
            const totalAmount = items.reduce((sum, item) => sum + (item.totalAmount || 0), 0);
            
            const woCollectionRef = collection(db, 'projects', currentProject.id, 'workOrders');
            const newWoRef = doc(woCollectionRef);

            const itemsToSave = items.map(item => {
                const { id, isBreakdown, subItems, ...rest } = item;
                return {
                    ...rest,
                    id: nanoid(), // generate a new clean id for firestore
                    totalAmount: item.totalAmount,
                    subItems: item.isBreakdown ? item.subItems.map(({id: subId, ...subRest}) => ({...subRest, id: nanoid()})) : []
                };
            });
            
            const workOrderData = {
                ...details,
                workOrderNo,
                projectId: currentProject.id,
                subcontractorName,
                totalAmount,
                items: itemsToSave,
                createdAt: serverTimestamp(),
                createdBy: user.id
            };
            
            transaction.set(newWoRef, workOrderData);
        });
        
        toast({ title: 'Work Order Created', description: `Successfully created the work order.` });
        router.push(`/subcontractors-management/${projectSlug}/work-order`);

    } catch (error: any) {
        console.error("Error creating work order:", error);
        toast({ title: 'Save Failed', description: error.message || 'Could not create work order.', variant: 'destructive' });
    } finally {
        setIsSaving(false);
    }
  };

  const formatCurrency = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);

  return (
    <>
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
            <Link href={`/subcontractors-management/${projectSlug}/work-order`}><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
            <h1 className="text-2xl font-bold">Create Work Order</h1>
        </div>
        <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Work Order
        </Button>
      </div>

      <Card className="mb-6">
        <CardHeader><CardTitle>Work Order Details</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-2"><Label htmlFor="workOrderNo">Work Order No.</Label><Input id="workOrderNo" value={previewWoNo} readOnly className="bg-muted" /></div>
            <div className="space-y-2"><Label htmlFor="date">Date</Label><Input id="date" name="date" type="date" value={details.date} onChange={handleDetailChange} /></div>
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
                    <TableHeader><TableRow><TableHead className="w-12"></TableHead><TableHead>BOQ Sl.No</TableHead><TableHead className="w-1/3">Description</TableHead><TableHead>Unit</TableHead><TableHead>Break Down</TableHead><TableHead>Order Qty</TableHead><TableHead>Order Rate</TableHead><TableHead>Total Amount</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
                    <TableBody>
                        {items.map((item, index) => {
                            const boqItem = boqItems.find(b => b.id === item.boqItemId);
                            const rateKey = boqItem ? Object.keys(boqItem).find(key => key.toLowerCase().includes('rate')) || 'rate' : 'rate';
                            const boqRate = boqItem && rateKey ? (boqItem as any)[rateKey] : 0;
                            const isExpanded = expandedRows.has(item.id);
                            return (
                                <Fragment key={item.id}>
                                <TableRow>
                                    <TableCell>
                                        {item.isBreakdown && (
                                            <Button size="icon" variant="ghost" onClick={() => toggleRowExpansion(item.id)}>
                                                {isExpanded ? <ChevronDown className="h-4 w-4"/> : <ChevronRight className="h-4 w-4"/>}
                                            </Button>
                                        )}
                                    </TableCell>
                                    <TableCell className="w-48">
                                        <BoqItemSelector
                                          boqItems={boqItems}
                                          selectedSlNo={item.boqSlNo || null}
                                          onSelect={(selectedBoqItem) => handleBoqItemSelect(index, selectedBoqItem)}
                                          isLoading={false}
                                        />
                                    </TableCell>
                                    <TableCell><p className="line-clamp-2" title={item.description}>{item.description}</p></TableCell>
                                    <TableCell><Input value={item.unit} readOnly className="bg-muted min-w-[80px]"/></TableCell>
                                    <TableCell><Switch checked={item.isBreakdown} onCheckedChange={(checked) => handleItemChange(index, 'isBreakdown', checked)} /></TableCell>
                                    <TableCell><Input type="number" value={item.orderQty} onChange={(e) => handleItemChange(index, 'orderQty', e.target.value)} className={cn("min-w-[100px]")}/></TableCell>
                                    <TableCell><Input type="number" value={item.rate} onChange={(e) => handleItemChange(index, 'rate', e.target.value)} className={cn("min-w-[120px]", item.isBreakdown && "line-through bg-muted")} disabled={item.isBreakdown}/></TableCell>
                                    <TableCell><Input value={formatCurrency(item.totalAmount)} readOnly className="bg-muted min-w-[150px]"/></TableCell>
                                    <TableCell className="text-right">
                                        <Button variant="ghost" size="icon" onClick={() => removeItem(item.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                                    </TableCell>
                                </TableRow>
                                {isExpanded && item.isBreakdown && (
                                    <TableRow className="bg-muted/30">
                                        <TableCell colSpan={9} className="p-2">
                                            <div className="p-2 space-y-2">
                                                 <h4 className="font-semibold text-sm">Sub-Items (per 1 set of Main Item)</h4>
                                                {item.subItems.map((sub, subIndex) => (
                                                    <div key={sub.id} className="grid grid-cols-6 gap-2 items-center">
                                                        <Input placeholder="Name" value={sub.name} onChange={e => handleSubItemChange(index, subIndex, 'name', e.target.value)} className="col-span-2"/>
                                                        <Input placeholder="Unit" value={sub.unit} onChange={e => handleSubItemChange(index, subIndex, 'unit', e.target.value)} />
                                                        <Input type="number" placeholder="Qty/Set" value={sub.quantity} onChange={e => handleSubItemChange(index, subIndex, 'quantity', e.target.value)} />
                                                        <Input type="number" placeholder="Rate" value={sub.rate} onChange={e => handleSubItemChange(index, subIndex, 'rate', e.target.value)} />
                                                        <div className="flex items-center gap-2">
                                                            <Input value={formatCurrency(sub.totalAmount)} readOnly className="bg-background/50" />
                                                            <Button variant="ghost" size="icon" onClick={() => removeSubItem(index, sub.id)}><Trash2 className="h-4 w-4 text-destructive"/></Button>
                                                        </div>
                                                    </div>
                                                ))}
                                                <Button variant="outline" size="sm" onClick={() => addSubItem(index)}><Plus className="mr-2 h-4 w-4"/> Add Sub-Item</Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                )}
                                </Fragment>
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

```
- src/components/ui/textarea.tsx:
```tsx

import * as React from "react"

import { cn } from "@/lib/utils"

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Textarea.displayName = "Textarea"

export { Textarea }

```
- src/hooks/use-local-storage.tsx:
```tsx

'use client';

import { useState, useEffect } from 'react';

function useLocalStorage<T>(key: string, initialValue: T) {
  const [storedValue, setStoredValue] = useState<T>(() => {
    if (typeof window === 'undefined') {
      return initialValue;
    }
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.log(error);
      return initialValue;
    }
  });

  const setValue = (value: T | ((val: T) => T)) => {
    try {
      const valueToStore =
        value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(key, JSON.stringify(valueToStore));
      }
    } catch (error) {
      console.log(error);
    }
  };

  return [storedValue, setValue] as const;
}

export default useLocalStorage;

```