
'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
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
  Plus,
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';


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
  availableQty: z.number().optional().default(0),
});


const itemSchema = z.object({
  id: z.string(),
  itemId: z.string().min(1, { message: "" }),
  itemName: z.string(),
  itemUnit: z.string(),
  boqSlNo: z.string().optional(),
  quantity: z.coerce.number().min(0, { message: 'Qty must be >= 0.' }),
  receiveUnit: z.string().min(1, { message: 'Receive unit is required.'}),
  unitCost: z.coerce.number().optional(),
  isBomGrn: z.boolean().default(false),
  bomItems: z.array(z.any()).optional(),
});

const generateGrnSchema = (mandatoryFields: any) => z.object({
    grnNo: z.string().min(1, "GRN No. is required."),
    grnDate: z.date({ required_error: "A GRN date is required." }),
    supplier: z.string().min(1, "Supplier name is required."),
    poNumber: mandatoryFields.poNumber ? z.string().min(1, "P.O. Number is required.") : z.string().optional(),
    poDate: mandatoryFields.poDate ? z.date({ required_error: "A P.O. date is required."}) : z.date().optional(),
    invoiceNumber: mandatoryFields.invoiceNumber ? z.string().min(1, "Invoice number is required.") : z.string().optional(),
    invoiceDate: mandatoryFields.invoiceDate ? z.date({ required_error: "An invoice date is required."}) : z.date().optional(),
    invoiceAmount: mandatoryFields.invoiceAmount ? z.coerce.number().min(0, "Amount must be positive.") : z.coerce.number().nullable().optional(),
    invoiceFiles: mandatoryFields.invoiceFiles ? z.array(z.custom<File>()).min(1, "Invoice file is required.") : z.array(z.custom<File>()).optional().default([]),
    transporterDocs: mandatoryFields.transporterDocs ? z.array(z.custom<File>()).min(1, "Transporter document is required.") : z.array(z.custom<File>()).optional().default([]),
    vehicleNo: mandatoryFields.vehicleNo ? z.string().min(1, "Vehicle No. is required.") : z.string().optional().default(''),
    waybillNo: mandatoryFields.waybillNo ? z.string().min(1, "Waybill No. is required.") : z.string().optional().default(''),
    lrNo: mandatoryFields.lrNo ? z.string().min(1, "LR No. is required.") : z.string().optional().default(''),
    lrDate: mandatoryFields.lrDate ? z.date({ required_error: "An LR date is required."}) : z.date().optional(),
    notes: z.string().optional().default(''),
    items: z.array(itemSchema).min(1, { message: 'At least one item is required.' }),
});

type GrnFormValues = z.infer<ReturnType<typeof generateGrnSchema>>;

export default function StockInPage() {
  const { toast } = useToast();
  const router = useRouter();
  const params = useParams();
  const projectSlug = params.project as string;

  const [isSaving, setIsSaving] = useState(false);
  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [availableItems, setAvailableItems] = useState<InventoryLog[]>([]);
  const [isLoadingItems, setIsLoadingItems] = useState(true);
  const [previewGrnNo, setPreviewGrnNo] = useState('Generating...');
  const [isBoqMultiSelectOpen, setIsBoqMultiSelectOpen] = useState(false);
  const [units, setUnits] = useState<string[]>([]);
  
  const [grnSchema, setGrnSchema] = useState(() => generateGrnSchema({}));

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const settingsDoc = await getDoc(doc(db, 'storeStockSettings', 'grnEntry'));
        if (settingsDoc.exists()) {
          setGrnSchema(() => generateGrnSchema(settingsDoc.data().mandatoryFields || {}));
        } else {
          setGrnSchema(() => generateGrnSchema({})); // fallback to default non-mandatory
        }
      } catch (error) {
        console.error("Could not fetch GRN settings:", error);
      }
    };
    fetchSettings();
  }, []);

  const form = useForm<GrnFormValues>({
    resolver: zodResolver(grnSchema),
    defaultValues: {
      grnNo: '',
      grnDate: new Date(),
      supplier: '',
      poNumber: '',
      invoiceNumber: '',
      vehicleNo: '',
      waybillNo: '',
      lrNo: '',
      notes: '',
      poDate: undefined,
      invoiceDate: undefined,
      invoiceAmount: null,
      lrDate: undefined,
      items: [],
      invoiceFiles: [],
      transporterDocs: [],
    },
  });
  
  const { fields, append, remove, update } = useFieldArray({
    control: form.control,
    name: 'items',
  });
  
  const watchedItems = form.watch('items');

   useEffect(() => {
    const generatePreviewId = async () => {
        try {
            const configRef = doc(db, 'serialNumberConfigs', 'store-stock-grn');
            const configDoc = await getDoc(configRef);
            if (configDoc.exists()) {
                const configData = configDoc.data() as SerialNumberConfig;
                const newIndex = configData.startingIndex;
                const datePart = format(new Date(), (configData.format || 'yyyyMMdd').replace(/y/g, 'y').replace(/m/g, 'M').replace(/d/g, 'd'));
                const formattedIndex = String(newIndex).padStart(4, '0');
                const grnNo = `${configData.prefix || ''}${datePart}${formattedIndex}${configData.suffix || ''}`;
                setPreviewGrnNo(grnNo);
                form.setValue('grnNo', grnNo);
            } else {
                 setPreviewGrnNo('Config not found');
            }
        } catch (error) {
            setPreviewGrnNo('Error generating ID');
        }
    };

    generatePreviewId();
    if(fields.length === 0){
        append({ id: `item-${Date.now()}`, itemId: '', itemName: '', itemUnit: '', boqSlNo: '', quantity: 1, receiveUnit: '', unitCost: 0, isBomGrn: false, bomItems: [] });
    }
  }, [projectSlug, form, fields, append]);


  useEffect(() => {
    const fetchBoq = async () => {
      if (!projectSlug) return;
      setIsLoadingItems(true);
      try {
        const q = query(collection(db, 'boqItems'), where('projectSlug', '==', projectSlug));
        const unitsSnap = await getDocs(collection(db, 'units'));
        
        const inventoryQuery = query(
          collection(db, 'inventoryLogs'),
          where('projectId', '==', projectSlug)
        );
        const inventorySnapshot = await getDocs(inventoryQuery);
        const inventoryData = inventorySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryLog));
        setAvailableItems(inventoryData);

        const boqSnapshot = await getDocs(q);
        const boqData = boqSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BoqItem));
        setBoqItems(boqData);
        setUnits(unitsSnap.docs.map(doc => doc.data().name as string));

      } catch (error) {
        console.error('Error fetching BOQ:', error);
      }
      setIsLoadingItems(false);
    };
    fetchBoq();
  }, [projectSlug]);

  const handleAddItem = () => {
    append({ id: `item-${Date.now()}`, itemId: '', itemName: '', itemUnit: '', boqSlNo: '', quantity: 1, receiveUnit: '', unitCost: 0, isBomGrn: false, bomItems: [] });
  };

  const handleRemoveItem = (index: number) => {
    if (fields.length > 1) {
      remove(index);
    } else {
      toast({ title: "Cannot remove last item", description: "You must have at least one item in the GRN.", variant: "destructive" });
    }
  };

  const getItemDescription = (item: BoqItem | FabricationBomItem) => {
    const descriptionKeys = ['Description', 'DESCRIPTION OF ITEMS', 'DESCRIPTION OF ITEMS(SCHEDULE-VIIA-SS) SUPPLY OF FOLLOWING EQUIPMENT & MATERIALS (As per Technical Specification)'];
    for (const key of descriptionKeys) {
      if ((item as BoqItem)[key]) return String((item as BoqItem)[key]);
    }
    if ((item as FabricationBomItem).section) {
        return `${(item as FabricationBomItem).section}`;
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
        bomItems: selectedBoqItem.bom?.map(b => {
          const bomComponentId = `bom-${selectedBoqItem.id}-${b.markNo}`;
          const componentAvailable = availableItems.filter(i => i.itemId === bomComponentId && i.itemType === 'Sub').reduce((sum, i) => sum + i.availableQuantity, 0);
          return {
            ...b,
            id: bomComponentId,
            quantity: 0,
            unitCost: 0,
            availableQty: componentAvailable,
          };
        }) || [],
      };
      
      form.setValue(`items.${index}`, updatedItem, { shouldValidate: true });
    }
  };
  
  const handleAddFromBom = (selectedBoqItems: BoqItem[]) => {
      const newItems = selectedBoqItems.map(mainItem => {
          const unit = mainItem['UNIT'] || mainItem['UNITS'] || 'Set';
          return {
            id: `item-${Date.now()}-${Math.random()}`,
            itemId: mainItem.id,
            itemName: getItemDescription(mainItem),
            itemUnit: unit,
            boqSlNo: getSlNo(mainItem),
            quantity: 0,
            receiveUnit: unit,
            unitCost: 0,
            isBomGrn: true,
            bomItems: mainItem.bom?.map(bomItem => {
              const bomComponentId = `bom-${mainItem.id}-${bomItem.markNo}`;
              const componentAvailable = availableItems.filter(i => i.itemId === bomComponentId && i.itemType === 'Sub').reduce((sum, i) => sum + i.availableQuantity, 0);
              return {
                ...bomItem,
                id: bomComponentId,
                quantity: 0,
                unitCost: 0,
                availableQty: componentAvailable,
              };
            }) || []
          };
      });

      const currentItems = form.getValues('items');
      const isFirstItemEmpty = fields.length === 1 && !fields[0].itemId;

      if(isFirstItemEmpty && newItems.length > 0) {
        form.setValue('items', [newItems[0]]);
        if(newItems.length > 1) {
           append(newItems.slice(1));
        }
      } else {
        append(newItems);
      }
  };
  
  const totalGrnValue = watchedItems.reduce((sum, item) => {
      let itemTotal = 0;
      if (item.isBomGrn && item.bomItems) {
        itemTotal = item.bomItems.reduce((bomSum, bomItem) => bomSum + ((bomItem.quantity || 0) * (bomItem.unitCost || 0)), 0);
      } else {
        itemTotal = (item.quantity || 0) * (item.unitCost || 0);
      }
      return sum + itemTotal;
  }, 0);

  const onSubmit = async (data: GrnFormValues) => {
    setIsSaving(true);
    
    try {
        const configRef = doc(db, 'serialNumberConfigs', 'store-stock-grn');
        const grnNo = await runTransaction(db, async (transaction) => {
            const configDoc = await transaction.get(configRef);
            if (!configDoc.exists()) throw new Error("GRN serial number configuration not found!");
            const configData = configDoc.data() as SerialNumberConfig;
            const newIndex = configData.startingIndex;
            const datePart = format(new Date(), (configData.format || 'yyyyMMdd').replace(/y/g, 'y').replace(/m/g, 'M').replace(/d/g, 'd'));
            const formattedIndex = String(newIndex).padStart(4, '0');
            const newGrnNo = `${configData.prefix || ''}${datePart}${formattedIndex}${configData.suffix || ''}`;
            transaction.update(configRef, { startingIndex: newIndex + 1 });
            return newGrnNo;
        });

        const uploadFile = async (file: File) => {
            const storagePath = `grn-documents/${grnNo}/${file.name}`;
            const storageRef = ref(storage, storagePath);
            await uploadBytes(storageRef, file);
            return getDownloadURL(storageRef);
        };
        const invoiceFileUrls = await Promise.all((data.invoiceFiles || []).map(uploadFile));
        const transporterDocUrls = await Promise.all((data.transporterDocs || []).map(uploadFile));

        const batch = writeBatch(db);

        const baseDetails = {
          grnNo,
          supplier: data.supplier,
          poNumber: data.poNumber,
          poDate: data.poDate ? format(data.poDate, 'yyyy-MM-dd') : null,
          invoiceNumber: data.invoiceNumber,
          invoiceDate: data.invoiceDate ? format(data.invoiceDate, 'yyyy-MM-dd') : null,
          invoiceAmount: data.invoiceAmount,
          invoiceFileUrls: invoiceFileUrls.map((url, i) => ({ name: data.invoiceFiles?.[i].name || 'file', url })),
          transporterDocUrls: transporterDocUrls.map((url, i) => ({ name: data.transporterDocs?.[i].name || 'file', url })),
          vehicleNo: data.vehicleNo,
          waybillNo: data.waybillNo,
          lrNo: data.lrNo,
          lrDate: data.lrDate ? format(data.lrDate, 'yyyy-MM-dd') : null,
          notes: data.notes,
      };

      for (const item of data.items) {
          const itemDetails = {
            ...baseDetails,
            boqSlNo: item.boqSlNo,
          };
          
          if (item.isBomGrn && item.bomItems) {
              for (const bomItem of item.bomItems) {
                  if (bomItem.quantity > 0) {
                      const receiptLogRef = doc(collection(db, 'inventoryLogs'));
                      batch.set(receiptLogRef, {
                          date: Timestamp.fromDate(data.grnDate),
                          itemId: bomItem.id,
                          itemName: `${item.itemName} - ${getItemDescription(bomItem)}`,
                          itemType: 'Sub',
                          transactionType: 'Goods Receipt',
                          quantity: bomItem.quantity,
                          availableQuantity: bomItem.quantity,
                          unit: 'Kg',
                          cost: bomItem.unitCost,
                          projectId: projectSlug,
                          details: itemDetails,
                      });
                  }
              }
          } else { 
              const logRef = doc(collection(db, 'inventoryLogs'));
              const boqItem = boqItems.find(bi => bi.id === item.itemId);
              let finalQuantity = item.quantity;
              let finalUnitCost = item.unitCost || 0;
              let finalUnit = item.itemUnit;

              if (item.receiveUnit !== item.itemUnit && boqItem?.conversions) {
                  const conversion = boqItem.conversions.find(c => c.toUnit === item.receiveUnit && c.fromUnit === item.itemUnit);
                  if (conversion) {
                      finalQuantity = (item.quantity / conversion.toQty) * conversion.fromQty;
                      finalUnitCost = (item.unitCost || 0) / (finalQuantity / item.quantity);
                  }
              }

              const logEntry: Omit<InventoryLog, 'id'> = {
                  date: Timestamp.fromDate(data.grnDate),
                  itemId: item.itemId,
                  itemName: item.itemName,
                  itemType: 'Main',
                  transactionType: 'Goods Receipt',
                  quantity: finalQuantity,
                  availableQuantity: finalQuantity,
                  unit: finalUnit,
                  projectId: projectSlug,
                  cost: finalUnitCost,
                  details: itemDetails,
              };
              batch.set(logRef, logEntry);
          }
      }
      await batch.commit();

      toast({ title: 'Success', description: 'Goods receipt recorded successfully.' });
      router.push(`/store-stock-management/${projectSlug}/transactions`);
    } catch (e) {
      console.error(e);
      toast({ title: 'Error', description: 'Failed to save stock-in transaction.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };
  
  useEffect(() => {
    const subscription = form.watch((value, { name, type }) => {
        if (name?.startsWith('items') && name.endsWith('.quantity') && type === 'change') {
            const itemIndex = parseInt(name.split('.')[1], 10);
            const currentItem = form.getValues(`items.${itemIndex}`);
            
            if (currentItem.isBomGrn && currentItem.bomItems && currentItem.bomItems.length > 0) {
                 const possibleSets = currentItem.bomItems.map(bi => 
                    (bi.quantity > 0 && bi.qtyPerSet > 0) ? Math.floor(bi.quantity / bi.qtyPerSet) : 0
                );

                const finalQty = possibleSets.every(val => val !== Infinity) ? Math.min(...possibleSets) : 0;
                
                if (currentItem.quantity !== finalQty) {
                    form.setValue(`items.${itemIndex}.quantity`, finalQty, { shouldValidate: true });
                }
            }
        }
    });
    return () => subscription.unsubscribe();
  }, [form]);

  const getSelectedSlNo = (index: number): string => {
    const itemId = form.getValues(`items.${index}.itemId`);
    if (!itemId) return '';
    const boqItem = boqItems.find(bi => bi.id === itemId);
    return boqItem ? String(boqItem['Sl No'] || boqItem['SL. No.'] || '') : '';
  };

  const DatePickerField = ({ name, label }: { name: keyof GrnFormValues; label: string }) => (
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
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus />
            </PopoverContent>
          </Popover>
          <FormMessage />
        </FormItem>
      )}
    />
  );
  
  const FileUpload = ({ name, label }: { name: keyof GrnFormValues; label: string }) => {
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


  return (
    <>
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
                        <h1 className="text-2xl font-bold">Stock In (Goods Receipt Note)</h1>
                        <p className="text-muted-foreground">Record a new goods receipt. Add items and quantities received.</p>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <div className="text-right">
                        <p className="text-sm text-muted-foreground">Total GRN Value</p>
                        <p className="text-2xl font-bold">
                            {new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(totalGrnValue)}
                        </p>
                    </div>
                    <Button type="submit" disabled={isSaving}>
                        {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4" />}
                        Save Transaction
                    </Button>
                </div>
            </div>

            <div className="space-y-6">
                <Card>
                    <CardHeader><CardTitle>GRN Details</CardTitle></CardHeader>
                    <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
                       <FormField control={form.control} name="grnNo" render={({ field }) => (<FormItem className="space-y-2"><FormLabel>GRN No.</FormLabel><FormControl><Input {...field} readOnly value={previewGrnNo}/></FormControl><FormMessage /></FormItem>)}/>
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
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <CardTitle>Items Received</CardTitle>
                            <Button type="button" variant="outline" onClick={() => setIsBoqMultiSelectOpen(true)}><Library className="mr-2 h-4 w-4" /> Add from BOM</Button>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {fields.map((field, index) => {
                            const currentItem = boqItems.find(i => i.id === watchedItems[index]?.itemId);
                            const baseUnit = currentItem?.['UNIT'] || currentItem?.['UNITS'] || '';
                            const conversionUnits = currentItem?.conversions?.map(c => c.toUnit) || [];
                            const unitOptions = [...new Set([baseUnit, ...conversionUnits])].filter(Boolean);
                            const bom = currentItem?.bom || [];
                            const isComponentIssue = watchedItems[index]?.isBomGrn;

                            return (
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
                                      { (bom.length > 0) && (
                                            <div className="flex items-end pb-1">
                                                <FormField control={form.control} name={`items.${index}.isBomGrn`} render={({ field: switchField }) => ( <FormItem className="flex flex-row items-center gap-2 rounded-lg border p-3"> <FormControl><Switch checked={switchField.value} onCheckedChange={switchField.onChange} id={`isBomGrn-${index}`} /></FormControl> <Label htmlFor={`isBomGrn-${index}`} className="cursor-pointer">GRN as BOM</Label> </FormItem> )} />
                                            </div>
                                        )}
                                  </div>
                                    <Button variant="destructive" size="icon" type="button" onClick={() => handleRemoveItem(index)} className="ml-4 flex-shrink-0"><Trash2 className="h-4 w-4"/></Button>
                                </div>

                               {isComponentIssue ? (
                                    <div className="pl-4 border-l-2 space-y-2">
                                       <p className="text-sm font-medium text-muted-foreground">BOM Components:</p>
                                       <Table>
                                         <TableHeader>
                                           <TableRow>
                                             <TableHead>Mark No.</TableHead>
                                             <TableHead>Section</TableHead>
                                             <TableHead>Qty/Set</TableHead>
                                             <TableHead>Receive Qty (Kg)</TableHead>
                                             <TableHead>Cost per Unit</TableHead>
                                           </TableRow>
                                         </TableHeader>
                                         <TableBody>
                                          {watchedItems[index]?.bomItems?.map((bomItem, bomIndex) => (
                                              <TableRow key={bomItem.id}>
                                                  <TableCell>{bomItem.markNo}</TableCell>
                                                  <TableCell>{bomItem.section}</TableCell>
                                                  <TableCell>{bomItem.qtyPerSet}</TableCell>
                                                  <TableCell>
                                                    <FormField control={form.control} name={`items.${index}.bomItems.${bomIndex}.quantity`} render={({ field: bomQtyField }) => ( <FormItem> <FormControl><Input type="number" placeholder="Receive Qty (Kg)" {...bomQtyField} onChange={(e) => bomQtyField.onChange(e.target.valueAsNumber || 0)}/></FormControl> </FormItem>)}/>
                                                  </TableCell>
                                                  <TableCell>
                                                    <FormField control={form.control} name={`items.${index}.bomItems.${bomIndex}.unitCost`} render={({ field: bomCostField }) => ( <FormItem> <FormControl><Input type="number" placeholder="Cost/Kg" {...bomCostField} value={bomCostField.value ?? ''} onChange={(e) => bomCostField.onChange(e.target.valueAsNumber || 0)} /></FormControl> </FormItem>)}/>
                                                  </TableCell>
                                              </TableRow>
                                          ))}
                                         </TableBody>
                                       </Table>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end">
                                      <FormField control={form.control} name={`items.${index}.quantity`} render={({ field }) => ( <FormItem className="space-y-1"> <FormLabel>Quantity</FormLabel> <FormControl><Input type="number" {...field} /></FormControl> <FormMessage /> </FormItem> )}/>
                                      <FormField
                                        control={form.control}
                                        name={`items.${index}.receiveUnit`}
                                        render={({ field }) => (
                                          <FormItem className="space-y-1">
                                            <FormLabel>Receive Unit</FormLabel>
                                            {unitOptions.length > 1 ? (
                                              <Select onValueChange={field.onChange} value={field.value}>
                                                  <FormControl>
                                                      <SelectTrigger><SelectValue placeholder="Select Unit" /></SelectTrigger>
                                                  </FormControl>
                                                  <SelectContent>
                                                      {unitOptions.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                                                  </SelectContent>
                                              </Select>
                                            ) : (
                                              <Input readOnly value={field.value} className="bg-muted" />
                                            )}
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />
                                      <FormField control={form.control} name={`items.${index}.unitCost`} render={({ field }) => ( <FormItem className="space-y-1"> <FormLabel>Unit Cost</FormLabel> <FormControl><Input type="number" {...field} value={field.value ?? ''} /></FormControl> <FormMessage /> </FormItem> )}/>
                                      <div className="space-y-1 text-right">
                                        <Label className="text-xs">Total Cost</Label>
                                        <p className="font-semibold">{new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format((watchedItems[index]?.quantity || 0) * (watchedItems[index]?.unitCost || 0))}</p>
                                      </div>
                                    </div>
                                )}
                            </div>
                          )})}
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
    <BoqMultiSelectDialog
        isOpen={isBoqMultiSelectOpen}
        onOpenChange={setIsBoqMultiSelectOpen}
        boqItems={boqItems}
        onConfirm={handleAddFromBom}
    />
    </>
  );
}

