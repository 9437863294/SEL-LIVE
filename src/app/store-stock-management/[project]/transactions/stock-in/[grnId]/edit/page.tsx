
'use client';

import { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import type { InventoryLog, BoqItem, SerialNumberConfig, FabricationBomItem } from '@/lib/types';
import { collection, getDocs, query, where, doc, runTransaction, getDoc, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { BoqItemSelector } from '@/components/BoqItemSelector';
import { Skeleton } from '@/components/ui/skeleton';


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
    supplier: z.string().min(1, "Supplier name is required."),
    poNumber: z.string().min(1, "P.O. Number is required."),
    items: z.array(itemSchema).min(1, { message: 'At least one item is required.' }),
});

type GrnFormValues = z.infer<typeof grnSchema>;

export default function EditStockInPage() {
  const { toast } = useToast();
  const router = useRouter();
  const params = useParams() as { project: string; grnId: string };
  const { project: projectSlug, grnId } = params;

  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);

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
            supplier: firstItem.details?.supplier,
            poNumber: firstItem.details?.poNumber,
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
                details: {
                    ...boqItems.find(b => b.id === item.itemId)?.details, // Assumes details are on BOQ
                    grnNo: data.grnNo,
                    supplier: data.supplier,
                    poNumber: data.poNumber,
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
                       <FormField control={form.control} name="supplier" render={({ field }) => (<FormItem className="space-y-2"><FormLabel>Supplier Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)}/>
                       <FormField control={form.control} name="poNumber" render={({ field }) => (<FormItem className="space-y-2"><FormLabel>P.O. Number</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)}/>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader><CardTitle>Items Received</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                        {fields.map((field, index) => (
                            <div key={field.id} className="p-4 border rounded-md space-y-4">
                               <div className="flex justify-between items-start">
                                    <p className="font-semibold">{field.itemName}</p>
                                    <Button variant="ghost" size="icon" type="button" onClick={() => remove(index)} className="ml-4 flex-shrink-0"><Trash2 className="h-4 w-4 text-destructive"/></Button>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
                                    <FormField control={form.control} name={`items.${index}.quantity`} render={({ field }) => ( <FormItem className="space-y-1"> <FormLabel>Quantity</FormLabel> <FormControl><Input type="number" {...field} /></FormControl> <FormMessage /> </FormItem> )}/>
                                    <FormField control={form.control} name={`items.${index}.unitCost`} render={({ field }) => ( <FormItem className="space-y-1"> <FormLabel>Unit Cost</FormLabel> <FormControl><Input type="number" {...field} value={field.value ?? ''} /></FormControl> <FormMessage /> </FormItem> )}/>
                                    <div className="space-y-1 text-right">
                                        <Label className="text-xs">Total Cost</Label>
                                        <p className="font-semibold">{new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format((form.watch(`items.${index}.quantity`) || 0) * (form.watch(`items.${index}.unitCost`) || 0))}</p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </CardContent>
                </Card>
            </div>
        </div>
      </form>
    </Form>
  );
}
