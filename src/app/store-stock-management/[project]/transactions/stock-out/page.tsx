
'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { ArrowLeft, Plus, Trash2, Save, Loader2, Calendar as CalendarIcon, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import type { InventoryLog, BoqItem, FabricationBomItem } from '@/lib/types';
import { Textarea } from '@/components/ui/textarea';
import { collection, getDocs, addDoc, query, where, writeBatch, doc, orderBy, Timestamp, runTransaction } from 'firebase/firestore';
import { db, storage } from '@/lib/firebase';
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { ItemSelector } from '@/components/ItemSelector';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';


const bomItemSchema = z.object({
  id: z.string(),
  markNo: z.string(),
  section: z.string(),
  grade: z.string(),
  length: z.number(),
  width: z.number(),
  unitWt: z.number(),
  wtPerPc: z.number(),
  totalWtPerSet: z.number(),
  qtyPerSet: z.number(),
  totalWtKg: z.number(),
  // Issue specific fields
  quantity: z.coerce.number().min(0, { message: 'Qty must be >= 0.' }),
  availableQty: z.number().default(0), // New field for availability
});


const itemSchema = z.object({
  id: z.string(),
  itemId: z.string().min(1, { message: "" }),
  itemName: z.string(),
  itemUnit: z.string(),
  availableQty: z.number(),
  quantity: z.coerce.number().min(1, 'Qty must be > 0').max(Number.MAX_SAFE_INTEGER, 'Qty too large'),
  isComponentIssue: z.boolean().default(false),
  bomItems: z.array(bomItemSchema).optional(),
});

const stockOutSchema = z.object({
    issueDate: z.date({ required_error: "An issue date is required." }),
    issuedTo: z.string().min(1, "Issued To is required."),
    notes: z.string().optional().default(''),
    items: z.array(itemSchema).min(1, { message: 'At least one item is required.' }),
});

type StockOutFormValues = z.infer<typeof stockOutSchema>;

export default function StockOutPage() {
  const { toast } = useToast();
  const router = useRouter();
  const params = useParams();
  const projectSlug = params.project as string;

  const [isSaving, setIsSaving] = useState(false);
  const [availableItems, setAvailableItems] = useState<InventoryLog[]>([]);
  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [isLoadingItems, setIsLoadingItems] = useState(true);

  const form = useForm<StockOutFormValues>({
    resolver: zodResolver(stockOutSchema),
    defaultValues: {
      issueDate: new Date(),
      issuedTo: '',
      notes: '',
      items: [],
    },
  });

  const { fields, append, remove, update } = useFieldArray({
    control: form.control,
    name: 'items',
  });
  
  useEffect(() => {
    if(fields.length === 0){
        append({ id: `item-${Date.now()}`, itemId: '', itemName: '', itemUnit: '', availableQty: 0, quantity: 1, isComponentIssue: false, bomItems: [] });
    }
  }, [fields, append]);

  useEffect(() => {
    const fetchInventoryAndBoq = async () => {
      if (!projectSlug) return;
      setIsLoadingItems(true);
      try {
        const inventoryQuery = query(
          collection(db, 'inventoryLogs'),
          where('projectId', '==', projectSlug)
        );
        const boqQuery = query(collection(db, 'boqItems'), where('projectSlug', '==', projectSlug));

        const [inventorySnapshot, boqSnapshot] = await Promise.all([
          getDocs(inventoryQuery),
          getDocs(boqQuery),
        ]);

        const itemsData = inventorySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryLog))
          .filter(item => item.availableQuantity > 0);
        setAvailableItems(itemsData);

        const boqData = boqSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BoqItem));
        setBoqItems(boqData);
        
      } catch (error) {
        console.error('Error fetching data:', error);
      }
      setIsLoadingItems(false);
    };
    fetchInventoryAndBoq();
  }, [projectSlug]);
  
  const uniqueAvailableItems = useMemo(() => {
    const itemMap = new Map<string, InventoryLog>();
    availableItems.forEach(item => {
        const existing = itemMap.get(item.itemId);
        if(existing) {
            existing.availableQuantity += item.availableQuantity;
        } else {
            itemMap.set(item.itemId, { ...item });
        }
    });
    return Array.from(itemMap.values());
  }, [availableItems]);


  const handleAddItem = () => {
    append({ id: `item-${Date.now()}`, itemId: '', itemName: '', itemUnit: '', availableQty: 0, quantity: 1, isComponentIssue: false, bomItems: [] });
  };

  const handleRemoveItem = (index: number) => {
    if (fields.length > 1) {
      remove(index);
    }
  };

  const handleItemSelect = (index: number, selectedInventoryItem: InventoryLog | null) => {
    if (selectedInventoryItem) {
      const relatedBoqItem = boqItems.find(b => b.id === selectedInventoryItem.itemId);
      const bom = relatedBoqItem?.bom || [];
      
      const mainItemAvailableQty = uniqueAvailableItems.find(i => i.itemId === selectedInventoryItem.itemId)?.availableQty || 0;

      update(index, {
        ...form.getValues(`items.${index}`),
        itemId: selectedInventoryItem.itemId,
        itemName: selectedInventoryItem.itemName,
        itemUnit: selectedInventoryItem.unit,
        availableQty: mainItemAvailableQty,
        bomItems: bom.map(b => {
          const componentAvailable = (mainItemAvailableQty * (b.qtyPerSet || 0));
          return {
            ...b, 
            id: `bom-${selectedInventoryItem.itemId}-${b.markNo}`, 
            quantity: 0,
            availableQty: componentAvailable
          }
        }),
      });
    }
  };
  
  const onSubmit = async (data: StockOutFormValues) => {
    setIsSaving(true);

    try {
        await runTransaction(db, async (transaction) => {
            for (const item of data.items) {
                const isComponentIssue = item.isComponentIssue && item.bomItems && item.bomItems.length > 0;
                
                if (isComponentIssue) {
                    const requiredMainQty = item.bomItems!.reduce((maxSets, bi) => {
                        if (bi.quantity > 0 && bi.qtyPerSet > 0) {
                            return Math.max(maxSets, bi.quantity / bi.qtyPerSet);
                        }
                        return maxSets;
                    }, 0);

                    if (requiredMainQty <= 0) continue;

                    let totalAvailableForMainItem = 0;
                    const logsToUpdateQuery = query(collection(db, 'inventoryLogs'), where('projectId', '==', projectSlug), where('itemId', '==', item.itemId), where('transactionType', '==', 'Goods Receipt'));
                    const logsToUpdateSnap = await getDocs(logsToUpdateQuery);
                    
                    const logsWithStock = logsToUpdateSnap.docs.map(d => {
                        const data = d.data() as InventoryLog;
                        totalAvailableForMainItem += data.availableQuantity;
                        return { ...data, id: d.id };
                    }).filter(l => l.availableQuantity > 0).sort((a, b) => a.date.toDate().getTime() - b.date.toDate().getTime());
                    
                    if (requiredMainQty > totalAvailableForMainItem) {
                        throw new Error(`Not enough stock for ${item.itemName}. Required sets: ${requiredMainQty.toFixed(3)}, Available sets: ${totalAvailableForMainItem.toFixed(3)}.`);
                    }

                    let mainQtyToDeduct = requiredMainQty;
                    for (const logDoc of logsWithStock) {
                        if (mainQtyToDeduct <= 0) break;
                        const deduction = Math.min(mainQtyToDeduct, logDoc.availableQuantity);
                        transaction.update(doc(db, 'inventoryLogs', logDoc.id), {
                            availableQuantity: logDoc.availableQuantity - deduction
                        });
                        mainQtyToDeduct -= deduction;
                    }

                    for (const bomItem of item.bomItems!.filter(bi => bi.quantity > 0)) {
                        const newIssueLogRef = doc(collection(db, 'inventoryLogs'));
                        transaction.set(newIssueLogRef, {
                            date: Timestamp.fromDate(data.issueDate),
                            itemId: bomItem.id,
                            itemName: `${item.itemName} - ${bomItem.section}`,
                            itemType: 'Sub',
                            transactionType: 'Goods Issue',
                            quantity: bomItem.quantity,
                            availableQuantity: 0,
                            unit: 'Kg',
                            cost: bomItem.unitCost || 0,
                            projectId: projectSlug,
                            description: `Issued to ${data.issuedTo}`,
                            details: { issuedTo: data.issuedTo, notes: data.notes, sourceGrn: 'BOM_CONVERSION' }
                        });
                    }
                } else {
                    let quantityToIssue = item.quantity;
                    const logsToUpdateQuery = query(collection(db, 'inventoryLogs'), where('projectId', '==', projectSlug), where('itemId', '==', item.itemId), where('transactionType', '==', 'Goods Receipt'));
                    const logsToUpdateSnap = await getDocs(logsToUpdateQuery);
                    const logsWithStock = logsToUpdateSnap.docs.map(d => ({ ...d.data(), id: d.id } as InventoryLog)).filter(l => l.availableQuantity > 0).sort((a,b) => a.date.toDate().getTime() - b.date.toDate().getTime());
                    
                    let totalAvailable = logsWithStock.reduce((sum, log) => sum + log.availableQuantity, 0);
                    if(quantityToIssue > totalAvailable) {
                        throw new Error(`Not enough stock for ${item.itemName}. Required: ${quantityToIssue}, Available: ${totalAvailable}.`);
                    }

                    for (const logDoc of logsWithStock) {
                        if (quantityToIssue <= 0) break;
                        const deduction = Math.min(quantityToIssue, logDoc.availableQuantity);
                        transaction.update(doc(db, 'inventoryLogs', logDoc.id), {
                            availableQuantity: logDoc.availableQuantity - deduction
                        });
                        
                        const newIssueLogRef = doc(collection(db, 'inventoryLogs'));
                         transaction.set(newIssueLogRef, {
                            date: Timestamp.fromDate(data.issueDate),
                            itemId: item.itemId,
                            itemName: item.itemName,
                            itemType: 'Main',
                            transactionType: 'Goods Issue',
                            quantity: deduction,
                            availableQuantity: 0,
                            unit: item.itemUnit,
                            cost: logDoc.cost,
                            projectId: projectSlug,
                            description: `Issued to ${data.issuedTo}`,
                            details: { issuedTo: data.issuedTo, notes: data.notes, sourceGrn: logDoc.details?.grnNo }
                         });
                         quantityToIssue -= deduction;
                    }
                }
            }
        });
        toast({ title: 'Success', description: 'Stock out transaction recorded successfully.' });
        router.push(`/store-stock-management/${projectSlug}/transactions`);
    } catch (e: any) {
        console.error(e);
        toast({ title: 'Error', description: e.message || 'Failed to save stock-out transaction.', variant: 'destructive' });
    } finally {
        setIsSaving(false);
    }
};

  const watchedItems = form.watch('items');

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <div className="w-full max-w-4xl mx-auto">
            <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Link href={`/store-stock-management/${projectSlug}/transactions`}>
                        <Button variant="ghost" size="icon" type="button">
                            <ArrowLeft className="h-6 w-6" />
                        </Button>
                    </Link>
                    <div>
                        <h1 className="text-2xl font-bold">Stock Out (Goods Issue Note)</h1>
                        <p className="text-muted-foreground">Record items being issued from the inventory.</p>
                    </div>
                </div>
                <Button type="submit" disabled={isSaving}>
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4" />}
                    Save Transaction
                </Button>
            </div>

            <div className="space-y-6">
                <Card>
                    <CardHeader><CardTitle>Issue Details</CardTitle></CardHeader>
                    <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FormField
                            control={form.control}
                            name="issueDate"
                            render={({ field }) => (
                                <FormItem className="space-y-2 flex flex-col">
                                    <FormLabel>Issue Date</FormLabel>
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <FormControl>
                                            <Button
                                                variant={"outline"}
                                                className={cn("w-full justify-start text-left font-normal", !field.value && "text-muted-foreground")}
                                            >
                                                <CalendarIcon className="mr-2 h-4 w-4" />
                                                {field.value ? format(field.value, "PPP") : <span>Pick a date</span>}
                                            </Button>
                                            </FormControl>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-auto p-0">
                                            <Calendar
                                                mode="single"
                                                selected={field.value}
                                                onSelect={field.onChange}
                                                initialFocus
                                            />
                                        </PopoverContent>
                                    </Popover>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField control={form.control} name="issuedTo" render={({ field }) => ( <FormItem className="space-y-2"> <FormLabel>Issued To</FormLabel> <FormControl><Input placeholder="e.g., Subcontractor Name / Site Location" {...field} /></FormControl> <FormMessage /> </FormItem> )}/>
                        <div className="md:col-span-2">
                            <FormField control={form.control} name="notes" render={({ field }) => ( <FormItem className="space-y-2"> <FormLabel>Notes</FormLabel> <FormControl><Textarea placeholder="Add any relevant notes for this transaction..." {...field} /></FormControl> <FormMessage /> </FormItem> )}/>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader><CardTitle>Items to Issue</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                        {fields.map((field, index) => {
                          const hasBom = (watchedItems[index]?.bomItems?.length ?? 0) > 0;
                          const isComponentIssue = watchedItems[index]?.isComponentIssue;
                          
                          const requiredMainQtyForBom = (() => {
                              if (!isComponentIssue || !watchedItems[index]?.bomItems) return 0;
                              return watchedItems[index].bomItems!.reduce((maxSets, bi) => {
                                  if (bi.quantity > 0 && bi.qtyPerSet > 0) {
                                      return Math.max(maxSets, bi.quantity / bi.qtyPerSet);
                                  }
                                  return maxSets;
                              }, 0);
                          })();
                          
                          const boqItem = boqItems.find(i => i.id === watchedItems[index]?.itemId);
                          const baseUnit = boqItem?.['UNIT'] || boqItem?.['UNITS'] || '';
                          const conversionUnits = boqItem?.conversions?.map(c => c.toUnit) || [];
                          const unitOptions = [...new Set([baseUnit, ...conversionUnits])].filter(Boolean);

                          return (
                            <div key={field.id} className="p-4 border rounded-md space-y-4">
                                <div className="flex justify-between items-start">
                                    <div className="flex-grow grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <FormField control={form.control} name={`items.${index}.itemId`} render={() => ( <FormItem className="space-y-1"> <FormLabel>Item</FormLabel> <ItemSelector key={field.id} items={uniqueAvailableItems} selectedItemId={form.getValues(`items.${index}.itemId`)} onSelect={(selectedItem) => handleItemSelect(index, selectedItem)} isLoading={isLoadingItems} /> <FormMessage /> </FormItem> )}/>
                                        {hasBom && (
                                            <div className="flex items-end pb-1">
                                                <FormField control={form.control} name={`items.${index}.isComponentIssue`} render={({ field: switchField }) => ( <FormItem className="flex flex-row items-center gap-2 rounded-lg border p-3"> <FormControl><Switch checked={switchField.value} onCheckedChange={switchField.onChange} id={`isComponentIssue-${index}`} /></FormControl> <Label htmlFor={`isComponentIssue-${index}`} className="cursor-pointer">Issue Components</Label> </FormItem> )} />
                                            </div>
                                        )}
                                    </div>
                                    <Button variant="destructive" size="icon" type="button" onClick={() => handleRemoveItem(index)} className="ml-4 flex-shrink-0"><Trash2 className="h-4 w-4"/></Button>
                                </div>
                                {isComponentIssue && hasBom ? (
                                    <div className="pl-4 border-l-2 space-y-2">
                                       <p className="text-sm font-medium text-muted-foreground">Issue BOM Components:</p>
                                       {watchedItems[index]?.bomItems?.map((bomItem, bomIndex) => {
                                            const mainItemAvailable = watchedItems[index].availableQty;
                                            const setsAvailableBasedOnMain = mainItemAvailable > 0 ? mainItemAvailable : 0;
                                            const thisComponentQtyAvailable = setsAvailableBasedOnMain * bomItem.qtyPerSet;

                                           return (
                                              <div key={bomItem.id} className="grid grid-cols-3 gap-2 items-center">
                                                 <Label className="text-xs truncate col-span-2">{`${bomItem.section} - ${bomItem.grade} (Av: ${thisComponentQtyAvailable.toFixed(3)})`}</Label>
                                                 <FormField control={form.control} name={`items.${index}.bomItems.${bomIndex}.quantity`} render={({ field: bomQtyField }) => ( 
                                                    <FormItem> 
                                                      <FormControl>
                                                        <Input type="number" placeholder="Issue Qty" {...bomQtyField} 
                                                            onChange={(e) => {
                                                                const val = e.target.valueAsNumber;
                                                                if (val > thisComponentQtyAvailable) {
                                                                    toast({ title: 'Quantity Exceeded', description: `Cannot issue more than available: ${thisComponentQtyAvailable.toFixed(3)}`, variant: 'destructive'});
                                                                } else {
                                                                    bomQtyField.onChange(val || 0);
                                                                }
                                                            }}
                                                        />
                                                      </FormControl>
                                                    </FormItem>
                                                 )}/>
                                              </div>
                                           )
                                       })}
                                        {requiredMainQtyForBom > 0 && <p className="text-xs text-blue-600 font-medium">Requires {requiredMainQtyForBom.toFixed(3)} sets of main item.</p>}
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
                                      <div>
                                          <Label>Available Qty</Label>
                                          <Input value={form.getValues(`items.${index}.availableQty`)} readOnly className="bg-muted"/>
                                      </div>
                                       <div>
                                            <Label>Unit</Label>
                                            {unitOptions.length > 1 ? (
                                                <Select
                                                    value={form.getValues(`items.${index}.itemUnit`)}
                                                    onValueChange={(value) => form.setValue(`items.${index}.itemUnit`, value)}
                                                >
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Select Unit" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {unitOptions.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                                                    </SelectContent>
                                                </Select>
                                            ) : (
                                                <Input value={form.getValues(`items.${index}.itemUnit`)} readOnly className="bg-muted" />
                                            )}
                                        </div>
                                      <FormField control={form.control} name={`items.${index}.quantity`} render={({ field: qtyField }) => ( <FormItem className="space-y-1"> <FormLabel>Issue Quantity</FormLabel> <FormControl><Input type="number" {...qtyField} onChange={(e) => { const val = e.target.valueAsNumber; const available = form.getValues(`items.${index}.availableQty`); if (val > available) { toast({title: "Quantity Exceeded", description: `Issue quantity cannot be greater than available quantity (${available}).`, variant: "destructive"}); } else { qtyField.onChange(val || 0); } }} />
                                      </FormControl> <FormMessage /> </FormItem> )}/>
                                    </div>
                                )}
                            </div>
                          )})}
                        <Button variant="outline" size="sm" type="button" onClick={handleAddItem} className="mt-2"><Plus className="mr-2 h-4 w-4" /> Add Item</Button>
                    </CardContent>
                </Card>
            </div>
        </div>
      </form>
    </Form>
  );
}

    