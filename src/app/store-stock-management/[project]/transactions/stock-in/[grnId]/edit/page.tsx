
'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  ArrowLeft,
  Save,
  Loader2,
  Trash2,
  Calendar as CalendarIcon,
  Upload,
  File as FileIcon,
  X,
  Library,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import type { InventoryLog, BoqItem, SerialNumberConfig, FabricationBomItem, Attachment } from '@/lib/types';
import { collection, getDocs, query, where, doc, runTransaction, getDoc, writeBatch } from 'firebase/firestore';
import { db, storage } from '@/lib/firebase';
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { BoqItemSelector } from '@/components/BoqItemSelector';
import { Skeleton } from '@/components/ui/skeleton';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { Textarea } from '@/components/ui/textarea';
import { BoqMultiSelectDialog } from '@/components/BoqMultiSelectDialog';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Timestamp } from 'firebase/firestore';


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
  // GRN specific fields
  quantity: z.coerce.number().min(0, { message: 'Qty must be >= 0.' }),
  unitCost: z.coerce.number().optional(),
});


const itemSchema = z.object({
  id: z.string(),
  itemId: z.string().min(1, { message: "" }),
  itemName: z.string(),
  itemUnit: z.string(),
  boqSlNo: z.string().optional(),
  quantity: z.coerce.number().min(1, { message: 'Qty must be > 0.' }),
  receiveUnit: z.string().min(1, ''),
  unitCost: z.coerce.number().optional(),
  isBomGrn: z.boolean().default(false),
  bomItems: z.array(z.any()).optional(),
});

const grnSchema = z.object({
    grnNo: z.string().min(1, "GRN No. is required."),
    grnDate: z.date({ required_error: "A GRN date is required." }),
    supplier: z.string().min(1, "Supplier name is required."),
    poNumber: z.string().min(1, "P.O. Number is required."),
    poDate: z.date().optional(),
    invoiceNumber: z.string().min(1, "Invoice number is required."),
    invoiceDate: z.date().optional(),
    invoiceAmount: z.coerce.number().nullable().optional(),
    invoiceFiles: z.array(z.custom<File>()).optional().default([]),
    transporterDocs: z.array(z.custom<File>()).optional().default([]),
    vehicleNo: z.string().optional().default(''),
    waybillNo: z.string().optional().default(''),
    lrNo: z.string().optional().default(''),
    lrDate: z.date().optional(),
    notes: z.string().optional().default(''),
    items: z.array(itemSchema).min(1, { message: 'At least one item is required.' }),
});

type GrnFormValues = z.infer<typeof grnSchema>;

export default function EditStockInPage({ params }: { params: { project: string; grnId: string } }) {
  const { toast } = useToast();
  const router = useRouter();
  const { project: projectSlug, grnId } = params;

  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [isLoadingItems, setIsLoadingItems] = useState(true);
  
  const form = useForm<GrnFormValues>({
    resolver: zodResolver(grnSchema),
    defaultValues: { items: [] },
  });

  const { fields, append, remove, update } = useFieldArray({
    control: form.control,
    name: 'items',
  });

  useEffect(() => {
    const fetchGrnData = async () => {
      setIsLoading(true);
      try {
        const q = query(collection(db, 'inventoryLogs'), where('details.grnNo', '==', grnId), where('projectId', '==', projectSlug));
        const snapshot = await getDocs(q);
        
        if (snapshot.empty) {
          toast({ title: 'Error', description: 'GRN not found.', variant: 'destructive' });
          router.push(`/store-stock-management/${projectSlug}/transactions`);
          return;
        }

        const grnItems = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryLog));
        const firstItem = grnItems[0];
        
        form.reset({
            grnNo: firstItem.details?.grnNo,
            grnDate: firstItem.date ? firstItem.date.toDate() : new Date(),
            supplier: firstItem.details?.supplier,
            poNumber: firstItem.details?.poNumber,
            poDate: firstItem.details?.poDate ? new Date(firstItem.details.poDate) : undefined,
            invoiceNumber: firstItem.details?.invoiceNumber,
            invoiceDate: firstItem.details?.invoiceDate ? new Date(firstItem.details.invoiceDate) : undefined,
            invoiceAmount: firstItem.details?.invoiceAmount,
            vehicleNo: firstItem.details?.vehicleNo,
            waybillNo: firstItem.details?.waybillNo,
            lrNo: firstItem.details?.lrNo,
            lrDate: firstItem.details?.lrDate ? new Date(firstItem.details.lrDate) : undefined,
            notes: firstItem.details?.notes,
            items: grnItems.map(item => ({
                id: item.id,
                itemId: item.itemId,
                itemName: item.itemName,
                itemUnit: item.unit,
                boqSlNo: item.details?.boqSlNo,
                quantity: item.quantity,
                receiveUnit: item.unit,
                unitCost: item.cost,
                isBomGrn: false,
                bomItems: [],
            }))
        });

      } catch (error) {
        console.error("Error fetching GRN data:", error);
      }
      setIsLoading(false);
    };

    fetchGrnData();
  }, [grnId, projectSlug, router, toast, form]);

   useEffect(() => {
    const fetchBoq = async () => {
      if (!projectSlug) return;
      setIsLoadingItems(true);
      try {
        const q = query(collection(db, 'boqItems'), where('projectSlug', '==', projectSlug));
        const unitsSnap = await getDocs(collection(db, 'units'));
        
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

  const onSubmit = async (data: GrnFormValues) => {
    setIsSaving(true);
    const batch = writeBatch(db);

    try {
        data.items.forEach(item => {
            const docRef = doc(db, 'inventoryLogs', item.id);
            const updateData = {
                quantity: item.quantity,
                availableQuantity: item.quantity, // Reset available qty on update
                cost: item.unitCost,
                date: Timestamp.fromDate(data.grnDate),
                details: {
                    ...boqItems.find(b => b.id === item.itemId)?.details, // Assumes details are on BOQ
                    grnNo: data.grnNo,
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
                    boqSlNo: item.boqSlNo,
                }
            };
            batch.update(docRef, updateData);
        });

        await batch.commit();
        toast({ title: 'Success', description: 'GRN updated successfully.' });
        router.push(`/store-stock-management/${projectSlug}/transactions`);
    } catch (e) {
      console.error(e);
      toast({ title: 'Error', description: 'Failed to update GRN.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };
  
    const getItemDescription = (item: BoqItem | FabricationBomItem) => {
    const descriptionKeys = ['Description', 'DESCRIPTION OF ITEMS', 'DESCRIPTION OF ITEMS(SCHEDULE-VIIA-SS) SUPPLY OF FOLLOWING EQUIPMENT & MATERIALS (As per Technical Specification)'];
    for (const key of descriptionKeys) {
      if ((item as BoqItem)[key]) return String((item as BoqItem)[key]);
    }
    if ((item as FabricationBomItem).section) {
        return `${(item as FabricationBomItem).section} - ${(item as FabricationBomItem).grade}`;
    }
    const fallbackKey = Object.keys(item).find(k => k.toLowerCase().includes('description'));
    return fallbackKey ? String((item as BoqItem)[fallbackKey]) : '';
  };
  
  const getSlNo = (item: BoqItem): string => {
    return String(item['Sl No'] || item['SL. No.'] || '');
  }

  const handleItemSelect = (index: number, selectedBoqItem: BoqItem | null) => {
    if (selectedBoqItem) {
      const description = getItemDescription(selectedBoqItem);
      const unit = selectedBoqItem['UNIT'] || selectedBoqItem['UNITS'] || '';
      const slNo = getSlNo(selectedBoqItem);
      
      const currentItem = form.getValues(`items.${index}`);
      const updatedItem = {
        ...currentItem,
        itemId: selectedBoqItem.id,
        itemName: description,
        itemUnit: unit,
        receiveUnit: unit,
        boqSlNo: slNo,
        bomItems: selectedBoqItem.bom?.map(b => ({ ...b, id: `bom-${selectedBoqItem.id}-${b.markNo}`, quantity: 0, unitCost: 0 })) || [],
      };
      
      form.setValue(`items.${index}`, updatedItem, { shouldValidate: true });
    }
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
                  {field.value ? format(new Date(field.value), 'PPP') : <span>Pick a date</span>}
                </Button>
              </FormControl>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus />
            </PopoverContent>
          </Popover>
          <FormMessage />
        </FormItem>
      )}
    />
  );
  
  const FileUpload = ({ name, label }: { name: keyof GrnFormValues, label: string }) => {
    const files = form.watch(name as any) as File[] || [];
    return (
      <FormField
        control={form.control}
        name={name}
        render={({ field }) => (
          <FormItem className="space-y-2">
            <FormLabel>{label}</FormLabel>
            <div className="flex items-center gap-2">
               <FormControl>
                    <Input id={name} type="file" multiple className="hidden" onChange={(e) => field.onChange(Array.from(e.target.files || []))} />
               </FormControl>
                <Label htmlFor={name} className="flex-grow border rounded-md p-2 text-sm text-muted-foreground truncate cursor-pointer hover:bg-muted/50">
                    {files.length > 0 ? `${files.length} file(s) selected` : 'No file selected'}
                </Label>
                <Button asChild variant="outline">
                    <Label htmlFor={name} className="cursor-pointer">
                        <Upload className="mr-2 h-4 w-4"/> Upload
                    </Label>
                </Button>
            </div>
             {files.length > 0 && (
                <div className="mt-2 space-y-1">
                    {files.map((file, i) => (
                        <div key={i} className="flex items-center justify-between p-1 bg-muted/50 rounded-md text-xs">
                           <span>{file.name}</span>
                            <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => {
                                const newFiles = [...files];
                                newFiles.splice(i, 1);
                                field.onChange(newFiles);
                            }}>
                                <X className="w-4 h-4" />
                            </Button>
                        </div>
                    ))}
                </div>
             )}
            <FormMessage />
          </FormItem>
        )}
      />
    );
  };
  
    const getSelectedSlNo = (index: number): string => {
        const itemId = form.getValues(`items.${index}.itemId`);
        if (!itemId) return '';
        const boqItem = boqItems.find(bi => bi.id === itemId);
        return boqItem ? String(boqItem['Sl No'] || boqItem['SL. No.'] || '') : '';
    };


  if (isLoading) {
    return (
        <div className="w-full max-w-6xl mx-auto">
            <Skeleton className="h-10 w-64 mb-6"/>
            <Skeleton className="h-96 w-full" />
        </div>
    )
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <div className="w-full max-w-6xl mx-auto">
            <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Link href={`/store-stock-management/${projectSlug}/transactions`}>
                        <Button variant="ghost" size="icon" type="button">
                            <ArrowLeft className="h-6 w-6" />
                        </Button>
                    </Link>
                    <div>
                        <h1 className="text-2xl font-bold">Edit Goods Receipt Note</h1>
                        <p className="text-muted-foreground">Editing GRN: {form.getValues('grnNo')}</p>
                    </div>
                </div>
                <Button type="submit" disabled={isSaving}>
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4" />}
                    Update Transaction
                </Button>
            </div>

            <div className="space-y-6">
                <Card>
                    <CardHeader><CardTitle>GRN Details</CardTitle></CardHeader>
                    <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
                       <FormField control={form.control} name="grnNo" render={({ field }) => (<FormItem className="space-y-2"><FormLabel>GRN No.</FormLabel><FormControl><Input {...field} readOnly /></FormControl><FormMessage /></FormItem>)}/>
                       <DatePickerField name="grnDate" label="GRN Date" />
                       <FormField control={form.control} name="supplier" render={({ field }) => (<FormItem className="space-y-2"><FormLabel>Supplier Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)}/>
                       <FormField control={form.control} name="poNumber" render={({ field }) => (<FormItem className="space-y-2"><FormLabel>P.O. Number</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)}/>
                       <DatePickerField name="poDate" label="P.O. Date" />
                    </CardContent>
                </Card>
                
                <Card>
                    <CardHeader><CardTitle>Invoice Details</CardTitle></CardHeader>
                    <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <FormField control={form.control} name="invoiceNumber" render={({ field }) => (<FormItem className="space-y-2"><FormLabel>Invoice No.</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)}/>
                        <DatePickerField name="invoiceDate" label="Invoice Date" />
                        <FormField control={form.control} name="invoiceAmount" render={({ field }) => (<FormItem className="space-y-2"><FormLabel>Invoice Amount</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                        <div className="md:col-span-3">
                           <FileUpload name="invoiceFiles" label="Upload Invoice(s)" />
                        </div>
                    </CardContent>
                </Card>
                
                <Card>
                    <CardHeader><CardTitle>Transporter Details</CardTitle></CardHeader>
                    <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <FormField control={form.control} name="vehicleNo" render={({ field }) => (<FormItem className="space-y-2"><FormLabel>Vehicle No.</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)}/>
                        <FormField control={form.control} name="waybillNo" render={({ field }) => (<FormItem className="space-y-2"><FormLabel>Waybill No.</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)}/>
                        <FormField control={form.control} name="lrNo" render={({ field }) => (<FormItem className="space-y-2"><FormLabel>LR No.</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)}/>
                        <DatePickerField name="lrDate" label="LR Date" />
                         <div className="md:col-span-3">
                           <FileUpload name="transporterDocs" label="Upload Transporter Doc(s)" />
                        </div>
                    </CardContent>
                </Card>
                
                <Card>
                    <CardHeader><CardTitle>Items Received</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                        {fields.map((field, index) => (
                            <div key={field.id} className="p-4 border rounded-md space-y-4">
                               <div className="flex justify-between items-start">
                                  <div className="flex-grow grid grid-cols-1 md:grid-cols-2 gap-4">
                                      <FormField
                                        control={form.control}
                                        name={`items.${index}.itemId`}
                                        render={() => (
                                          <FormItem className="space-y-1">
                                            <FormLabel>BOQ Item</FormLabel>
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
                                  </div>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
                                  <FormField control={form.control} name={`items.${index}.quantity`} render={({ field: qtyField }) => ( <FormItem className="space-y-1"> <FormLabel>Quantity</FormLabel> <FormControl><Input type="number" {...qtyField} /></FormControl> <FormMessage /> </FormItem> )}/>
                                  <FormField control={form.control} name={`items.${index}.unitCost`} render={({ field: costField }) => ( <FormItem className="space-y-1"> <FormLabel>Unit Cost</FormLabel> <FormControl><Input type="number" {...costField} value={costField.value ?? ''} /></FormControl> <FormMessage /> </FormItem> )}/>
                                  <div className="space-y-1 text-right">
                                    <Label className="text-xs">Total Cost</Label>
                                    <p className="font-semibold">{new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format((form.watch(`items.${index}.quantity`) || 0) * (form.watch(`items.${index}.unitCost`) || 0))}</p>
                                  </div>
                                </div>
                            </div>
                        ))}
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

    