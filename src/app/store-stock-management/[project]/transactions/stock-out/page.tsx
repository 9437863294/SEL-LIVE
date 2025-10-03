
'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { ArrowLeft, Plus, Trash2, Save, Loader2, Calendar as CalendarIcon, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import type { InventoryLog } from '@/lib/types';
import { Textarea } from '@/components/ui/textarea';
import { collection, getDocs, addDoc, query, where, writeBatch, doc, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { ItemSelector } from '@/components/ItemSelector';


const itemSchema = z.object({
  id: z.string(),
  itemId: z.string().min(1, { message: "" }),
  itemName: z.string(),
  itemUnit: z.string(),
  availableQty: z.number(),
  quantity: z.coerce.number().min(1, 'Qty must be > 0').max(Number.MAX_SAFE_INTEGER, 'Qty too large'),
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
  const params = useParams() as { project: string };
  const projectSlug = params.project;

  const [isSaving, setIsSaving] = useState(false);
  const [availableItems, setAvailableItems] = useState<InventoryLog[]>([]);
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
        append({ id: `item-${Date.now()}`, itemId: '', itemName: '', itemUnit: '', availableQty: 0, quantity: 1 });
    }
  }, [fields, append]);

  useEffect(() => {
    const fetchInventory = async () => {
      if (!projectSlug) return;
      setIsLoadingItems(true);
      try {
        const q = query(
          collection(db, 'inventoryLogs'),
          where('projectId', '==', projectSlug),
          where('availableQuantity', '>', 0)
        );
        const snapshot = await getDocs(q);
        const itemsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryLog));
        setAvailableItems(itemsData);
      } catch (error) {
        console.error('Error fetching inventory:', error);
      }
      setIsLoadingItems(false);
    };
    fetchInventory();
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
    append({ id: `item-${Date.now()}`, itemId: '', itemName: '', itemUnit: '', availableQty: 0, quantity: 1 });
  };

  const handleRemoveItem = (index: number) => {
    if (fields.length > 1) {
      remove(index);
    }
  };

  const handleItemSelect = (index: number, selectedItem: any | null) => {
    if (selectedItem) {
      update(index, {
        ...form.getValues(`items.${index}`),
        itemId: selectedItem.itemId,
        itemName: selectedItem.itemName,
        itemUnit: selectedItem.unit,
        availableQty: selectedItem.availableQuantity,
      });
    }
  };
  
  const onSubmit = async (data: StockOutFormValues) => {
    setIsSaving(true);
    const batch = writeBatch(db);

    try {
        for (const item of data.items) {
            const logsToUpdateQuery = query(
                collection(db, 'inventoryLogs'),
                where('projectId', '==', projectSlug),
                where('itemId', '==', item.itemId),
                where('availableQuantity', '>', 0),
                orderBy('date', 'asc')
            );
            const logsToUpdateSnap = await getDocs(logsToUpdateQuery);
            
            let quantityToIssue = item.quantity;

            for (const logDoc of logsToUpdateSnap.docs) {
                if (quantityToIssue <= 0) break;
                
                const logData = logDoc.data() as InventoryLog;
                const available = logData.availableQuantity;
                const quantityToDeduct = Math.min(quantityToIssue, available);

                batch.update(logDoc.ref, {
                    availableQuantity: available - quantityToDeduct
                });

                quantityToIssue -= quantityToDeduct;

                // Create new Goods Issue log entry
                const newIssueLogRef = doc(collection(db, 'inventoryLogs'));
                batch.set(newIssueLogRef, {
                    date: data.issueDate,
                    itemId: item.itemId,
                    itemName: item.itemName,
                    itemType: logData.itemType,
                    transactionType: 'Goods Issue',
                    quantity: quantityToDeduct,
                    availableQuantity: 0, 
                    unit: item.itemUnit,
                    cost: logData.cost, 
                    projectId: projectSlug,
                    description: `Issued to ${data.issuedTo}`,
                    details: {
                      issuedTo: data.issuedTo,
                      notes: data.notes,
                      sourceGrn: logData.details?.grnNo
                    }
                });
            }
            if(quantityToIssue > 0) {
              throw new Error(`Not enough stock for ${item.itemName}. Tried to issue ${item.quantity}, but only ${item.availableQty} available.`);
            }
        }
        await batch.commit();
        toast({ title: 'Success', description: 'Stock out transaction recorded successfully.' });
        router.push(`/store-stock-management/${projectSlug}/transactions`);
    } catch (e: any) {
      console.error(e);
      toast({ title: 'Error', description: e.message || 'Failed to save stock-out transaction.', variant: 'destructive' });
    } finally {
        setIsSaving(false);
    }
  };

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
                        <FormField control={form.control} name="issueDate" render={({ field }) => ( <FormItem className="space-y-2 flex flex-col"> <FormLabel>Issue Date</FormLabel> <Popover> <PopoverTrigger asChild> <Button variant="outline" className={cn('justify-start text-left font-normal', !field.value && 'text-muted-foreground')}> <CalendarIcon className="mr-2 h-4 w-4" /> {field.value ? format(field.value, 'PPP') : <span>Pick a date</span>} </Button> </PopoverTrigger> <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus /></PopoverContent> </Popover> <FormMessage /> </FormItem> )}/>
                        <FormField control={form.control} name="issuedTo" render={({ field }) => ( <FormItem className="space-y-2"> <FormLabel>Issued To</FormLabel> <FormControl><Input placeholder="e.g., Subcontractor Name / Site Location" {...field} /></FormControl> <FormMessage /> </FormItem> )}/>
                        <div className="md:col-span-2">
                            <FormField control={form.control} name="notes" render={({ field }) => ( <FormItem className="space-y-2"> <FormLabel>Notes</FormLabel> <FormControl><Textarea placeholder="Add any relevant notes for this transaction..." {...field} /></FormControl> <FormMessage /> </FormItem> )}/>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader><CardTitle>Items to Issue</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                        {fields.map((field, index) => (
                            <div key={field.id} className="p-4 border rounded-md grid grid-cols-12 gap-4 items-end">
                               <div className="col-span-12 md:col-span-6">
                                   <FormField control={form.control} name={`items.${index}.itemId`} render={() => ( <FormItem className="space-y-1"> <FormLabel>Item</FormLabel> <ItemSelector key={field.id} mainItems={[]} subItems={uniqueAvailableItems} selectedItemId={form.getValues(`items.${index}.itemId`)} onSelect={(selectedItem) => handleItemSelect(index, selectedItem)} isLoading={isLoadingItems} /> <FormMessage /> </FormItem> )}/>
                               </div>
                                <div className="col-span-6 md:col-span-2">
                                     <Label>Available</Label>
                                     <Input value={form.getValues(`items.${index}.availableQty`)} readOnly className="bg-muted"/>
                                </div>
                                <div className="col-span-6 md:col-span-3">
                                  <FormField control={form.control} name={`items.${index}.quantity`} render={({ field: qtyField }) => ( <FormItem className="space-y-1"> <FormLabel>Issue Quantity</FormLabel> <FormControl><Input type="number" {...qtyField} onChange={(e) => { const val = e.target.valueAsNumber; if (val > form.getValues(`items.${index}.availableQty`)) { toast({title: "Quantity Exceeded", description: "Issue quantity cannot be greater than available quantity.", variant: "destructive"}); } else { qtyField.onChange(val || 0); } }} />
                                  </FormControl> <FormMessage /> </FormItem> )}/>
                                </div>
                                <div className="col-span-12 md:col-span-1 text-right">
                                    <Button variant="destructive" size="icon" type="button" onClick={() => handleRemoveItem(index)} className="flex-shrink-0"><Trash2 className="h-4 w-4"/></Button>
                                </div>
                            </div>
                        ))}
                        <Button variant="outline" size="sm" type="button" onClick={handleAddItem} className="mt-2"><Plus className="mr-2 h-4 w-4" /> Add Item</Button>
                    </CardContent>
                </Card>
            </div>
        </div>
      </form>
    </Form>
  );
}
