
'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  ArrowLeft,
  Plus,
  Trash2,
  Save,
  Loader2,
  Calendar as CalendarIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import type { InventoryLog, BoqItem } from '@/lib/types';
import { BoqItemSelector } from '@/components/BoqItemSelector';
import { Textarea } from '@/components/ui/textarea';
import { collection, getDocs, addDoc, query, where } from 'firebase/firestore';
import { db, storage } from '@/lib/firebase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';


const itemSchema = z.object({
  id: z.string(),
  itemId: z.string().min(1, { message: 'Item is required.' }),
  itemName: z.string(),
  itemUnit: z.string(),
  quantity: z.coerce.number().min(1, { message: 'Qty must be > 0.' }),
  receiveUnit: z.string().min(1, { message: 'Unit is required.' }),
  batchNo: z.string(),
  unitCost: z.coerce.number().min(0),
});

const grnSchema = z.object({
    grnNo: z.string(),
    grnDate: z.date({ required_error: "GRN date is required." }),
    supplier: z.string().min(1, "Supplier name is required."),
    poNumber: z.string().min(1, "P.O. Number is required."),
    poDate: z.date().optional(),
    invoiceNumber: z.string().min(1, "Invoice number is required."),
    invoiceDate: z.date().optional(),
    invoiceAmount: z.coerce.number().optional(),
    vehicleNo: z.string().optional(),
    waybillNo: z.string().optional(),
    lrNo: z.string().optional(),
    lrDate: z.date().optional(),
    notes: z.string().optional(),
    items: z.array(itemSchema).min(1, { message: 'At least one item is required.' }),
});

type GrnFormValues = z.infer<typeof grnSchema>;

export default function StockInPage() {
  const { toast } = useToast();
  const router = useRouter();
  const params = useParams() as { project: string };
  const projectSlug = params.project;

  const [isSaving, setIsSaving] = useState(false);
  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [isLoadingItems, setIsLoadingItems] = useState(true);

  const form = useForm<GrnFormValues>({
    resolver: zodResolver(grnSchema),
    defaultValues: {
      grnDate: new Date(),
      poDate: undefined,
      invoiceDate: undefined,
      lrDate: undefined,
      items: [{ id: `item-${Date.now()}`, itemId: '', itemName: '', itemUnit: '', quantity: 1, receiveUnit: '', batchNo: '', unitCost: 0 }],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'items',
  });

   useEffect(() => {
    const grn = `GRN-${projectSlug.substring(0, 4).toUpperCase()}-${format(new Date(), 'yyyyMMdd')}-${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
    form.setValue('grnNo', grn);
  }, [projectSlug, form]);


  useEffect(() => {
    const fetchBoq = async () => {
      if (!projectSlug) return;
      setIsLoadingItems(true);
      try {
        const q = query(collection(db, 'boqItems'), where('projectSlug', '==', projectSlug));
        const boqSnapshot = await getDocs(q);
        const boqData = boqSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BoqItem));
        setBoqItems(boqData);
      } catch (error) {
        console.error('Error fetching BOQ:', error);
      }
      setIsLoadingItems(false);
    };
    fetchBoq();
  }, [projectSlug]);

  const handleAddItem = () => {
    append({ id: `item-${Date.now()}`, itemId: '', itemName: '', itemUnit: '', quantity: 1, receiveUnit: '', batchNo: '', unitCost: 0 });
  };

  const handleRemoveItem = (index: number) => {
    if (fields.length > 1) {
      remove(index);
    } else {
      form.resetField(`items.${index}`);
    }
  };

  const getItemDescription = (item: BoqItem) => {
    const descriptionKeys = ['Description', 'DESCRIPTION OF ITEMS', 'DESCRIPTION OF ITEMS(SCHEDULE-VIIA-SS) SUPPLY OF FOLLOWING EQUIPMENT & MATERIALS (As per Technical Specification)'];
    for (const key of descriptionKeys) {
      if (item[key]) return String(item[key]);
    }
    const fallbackKey = Object.keys(item).find(k => k.toLowerCase().includes('description'));
    return fallbackKey ? String(item[fallbackKey]) : '';
  };

  const handleItemSelect = (index: number, selectedBoqItem: BoqItem | null) => {
    if (selectedBoqItem) {
      const description = getItemDescription(selectedBoqItem);
      const unit = selectedBoqItem['UNIT'] || selectedBoqItem['UNITS'] || '';
      form.setValue(`items.${index}.itemId`, selectedBoqItem.id);
      form.setValue(`items.${index}.itemName`, description);
      form.setValue(`items.${index}.itemUnit`, unit);
      form.setValue(`items.${index}.receiveUnit`, unit);
    } else {
      form.resetField(`items.${index}`);
    }
  };

  const onSubmit = async (data: GrnFormValues) => {
    setIsSaving(true);
    try {
      const writePromises = data.items.map((item) => {
        const logEntry: Omit<InventoryLog, 'id'> = {
          date: data.grnDate,
          itemId: item.itemId,
          itemName: item.itemName,
          itemType: 'Sub',
          transactionType: 'Goods Receipt',
          quantity: item.quantity,
          unit: item.receiveUnit,
          projectId: projectSlug,
          description: `GRN from ${data.supplier}. PO: ${data.poNumber}, Inv: ${data.invoiceNumber}.`,
          cost: item.unitCost,
          batch: item.batchNo,
          details: { 
            supplier: data.supplier, 
            poNumber: data.poNumber, 
            poDate: data.poDate ? format(data.poDate, 'yyyy-MM-dd') : null,
            invoiceNumber: data.invoiceNumber,
            invoiceDate: data.invoiceDate ? format(data.invoiceDate, 'yyyy-MM-dd') : null,
            invoiceAmount: data.invoiceAmount,
            vehicleNo: data.vehicleNo,
            waybillNo: data.waybillNo,
            lrNo: data.lrNo,
            lrDate: data.lrDate ? format(data.lrDate, 'yyyy-MM-dd') : null,
            notes: data.notes,
          },
        };
        return addDoc(collection(db, 'inventoryLogs'), logEntry);
      });
      await Promise.all(writePromises);
      toast({ title: 'Success', description: 'Goods receipt recorded successfully.' });
      router.push(`/store-stock-management/${projectSlug}/transactions`);
    } catch (e) {
      console.error(e);
      toast({ title: 'Error', description: 'Failed to save stock-in transaction.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };
  
  const getSelectedSlNo = (index: number): string => {
    const itemId = form.getValues(`items.${index}.itemId`);
    if (!itemId) return '';
    const boqItem = boqItems.find(bi => bi.id === itemId);
    return boqItem ? String(boqItem['Sl No'] || boqItem['SL. No.'] || '') : '';
  };

  const DatePickerField = ({ name, label }: { name: keyof GrnFormValues, label: string }) => (
    <FormField
      control={form.control}
      name={name as any}
      render={({ field }) => (
        <FormItem className="space-y-2">
          <FormLabel>{label}</FormLabel>
          <Popover>
            <PopoverTrigger asChild>
              <FormControl>
                <Button variant="outline" className={cn('w-full justify-start text-left font-normal', !field.value && 'text-muted-foreground')}>
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {field.value ? format(field.value, 'PPP') : <span>Pick a date</span>}
                </Button>
              </FormControl>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus /></PopoverContent>
          </Popover>
          <FormMessage />
        </FormItem>
      )}
    />
  );


  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <div className="w-full max-w-6xl mx-auto">
            <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Link href={`/store-stock-management/${projectSlug}/transactions`}>
                        <Button variant="ghost" size="icon">
                            <ArrowLeft className="h-6 w-6" />
                        </Button>
                    </Link>
                    <div>
                        <h1 className="text-2xl font-bold">Stock In (Goods Receipt Note)</h1>
                        <p className="text-muted-foreground">Record a new goods receipt. Add items and quantities received.</p>
                    </div>
                </div>
                <Button type="submit" disabled={isSaving}>
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4" />}
                    Save Transaction
                </Button>
            </div>

            <div className="space-y-6">
                <Card>
                    <CardHeader><CardTitle>GRN Details</CardTitle></CardHeader>
                    <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <FormField control={form.control} name="grnNo" render={({ field }) => (<FormItem className="space-y-2"><FormLabel>GRN No.</FormLabel><FormControl><Input {...field} readOnly /></FormControl><FormMessage /></FormItem>)}/>
                        <DatePickerField name="grnDate" label="GRN Date" />
                        <FormField control={form.control} name="supplier" render={({ field }) => (<FormItem className="space-y-2"><FormLabel>Supplier Name</FormLabel><FormControl><Input placeholder="e.g., ACME Corp" {...field} /></FormControl><FormMessage /></FormItem>)}/>
                        <FormField control={form.control} name="poNumber" render={({ field }) => (<FormItem className="space-y-2"><FormLabel>P.O. Number</FormLabel><FormControl><Input placeholder="e.g., PO-12345" {...field} /></FormControl><FormMessage /></FormItem>)}/>
                        <DatePickerField name="poDate" label="P.O. Date" />
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader><CardTitle>Invoice Details</CardTitle></CardHeader>
                    <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <FormField control={form.control} name="invoiceNumber" render={({ field }) => (<FormItem className="space-y-2"><FormLabel>Invoice No.</FormLabel><FormControl><Input placeholder="e.g., INV-67890" {...field} /></FormControl><FormMessage /></FormItem>)}/>
                        <DatePickerField name="invoiceDate" label="Invoice Date" />
                        <FormField control={form.control} name="invoiceAmount" render={({ field }) => (<FormItem className="space-y-2"><FormLabel>Invoice Amount</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>)}/>
                    </CardContent>
                </Card>

                 <Card>
                    <CardHeader><CardTitle>Transporter Details</CardTitle></CardHeader>
                    <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <FormField control={form.control} name="vehicleNo" render={({ field }) => (<FormItem className="space-y-2"><FormLabel>Vehicle No.</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)}/>
                        <FormField control={form.control} name="waybillNo" render={({ field }) => (<FormItem className="space-y-2"><FormLabel>Waybill No.</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)}/>
                        <FormField control={form.control} name="lrNo" render={({ field }) => (<FormItem className="space-y-2"><FormLabel>LR No.</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)}/>
                        <DatePickerField name="lrDate" label="LR Date" />
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader><CardTitle>Items Received</CardTitle></CardHeader>
                    <CardContent className="space-y-2">
                        {fields.map((field, index) => (
                            <div key={field.id} className="grid grid-cols-[1fr,80px,100px,120px,120px,auto] gap-2 items-end p-2 border rounded-md">
                                <FormField
                                    control={form.control}
                                    name={`items.${index}.itemId`}
                                    render={() => (
                                        <FormItem className="space-y-1">
                                            {index === 0 && <FormLabel className="text-xs">BOQ Item</FormLabel>}
                                            <BoqItemSelector
                                                key={field.id} 
                                                boqItems={boqItems}
                                                selectedSlNo={getSelectedSlNo(index)}
                                                onSelect={(selectedBoqItem) => handleItemSelect(index, selectedBoqItem)}
                                                isLoading={isLoadingItems}
                                            />
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField control={form.control} name={`items.${index}.quantity`} render={({ field }) => (<FormItem className="space-y-1">{index === 0 && <FormLabel className="text-xs">Quantity</FormLabel>}<FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>)} />
                                <FormField control={form.control} name={`items.${index}.receiveUnit`} render={({ field }) => (<FormItem className="space-y-1">{index === 0 && <FormLabel className="text-xs">Receive Unit</FormLabel>}<FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                                <FormField control={form.control} name={`items.${index}.batchNo`} render={({ field }) => (<FormItem className="space-y-1">{index === 0 && <FormLabel className="text-xs">Batch No.</FormLabel>}<FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                                <FormField control={form.control} name={`items.${index}.unitCost`} render={({ field }) => (<FormItem className="space-y-1">{index === 0 && <FormLabel className="text-xs">Unit Cost</FormLabel>}<FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>)} />
                               <Button variant="destructive" size="icon" type="button" onClick={() => handleRemoveItem(index)}><Trash2 className="h-4 w-4"/></Button>
                            </div>
                        ))}
                        <Button variant="outline" size="sm" type="button" onClick={handleAddItem} className="mt-2"><Plus className="mr-2 h-4 w-4" /> Add Item</Button>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
                    <CardContent>
                       <FormField control={form.control} name="notes" render={({ field }) => (<FormItem><FormControl><Textarea placeholder="Add any relevant notes for this transaction..." {...field} /></FormControl><FormMessage /></FormItem>)}/>
                    </CardContent>
                </Card>
            </div>
        </div>
      </form>
    </Form>
  );
}

