
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { db } from '@/lib/firebase';
import { collection, getDocs, addDoc, serverTimestamp, runTransaction, doc, getDoc } from 'firebase/firestore';
import type { MainItem, SubItem, Project, Site, InventoryLog } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Calendar as CalendarIcon, Loader2, Save } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

const stockInSchema = z.object({
    itemId: z.string().min(1),
    itemType: z.enum(['Main', 'Sub']),
    quantity: z.coerce.number().min(1),
    date: z.date(),
    vehicleNo: z.string().optional(),
});

const stockOutSchema = z.object({
    itemId: z.string().min(1),
    itemType: z.enum(['Main', 'Sub']),
    quantity: z.coerce.number().min(1),
    date: z.date(),
    projectId: z.string().min(1),
    siteId: z.string().optional(),
});

export default function InventoryPage() {
    const { toast } = useToast();
    const [mainItems, setMainItems] = useState<MainItem[]>([]);
    const [subItems, setSubItems] = useState<SubItem[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);
    const [sites, setSites] = useState<Record<string, Site[]>>({});
    const [isSaving, setIsSaving] = useState(false);

    const stockInForm = useForm({ resolver: zodResolver(stockInSchema), defaultValues: { date: new Date(), quantity: 1 } });
    const stockOutForm = useForm({ resolver: zodResolver(stockOutSchema), defaultValues: { date: new Date(), quantity: 1 } });
    
    const watchedStockOutProjectId = stockOutForm.watch('projectId');

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [mainItemsSnap, subItemsSnap, projectsSnap] = await Promise.all([
                    getDocs(collection(db, 'main_items')),
                    getDocs(collection(db, 'sub_items')),
                    getDocs(collection(db, 'projects')),
                ]);
                setMainItems(mainItemsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as MainItem)));
                setSubItems(subItemsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as SubItem)));
                setProjects(projectsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)));
            } catch (error) {
                toast({ title: "Error", description: "Failed to load initial data.", variant: "destructive" });
            }
        };
        fetchData();
    }, [toast]);
    
    useEffect(() => {
        const fetchSites = async () => {
            if (watchedStockOutProjectId && !sites[watchedStockOutProjectId]) {
                const sitesSnap = await getDocs(collection(db, 'projects', watchedStockOutProjectId, 'sites'));
                setSites(prev => ({
                    ...prev,
                    [watchedStockOutProjectId]: sitesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Site))
                }));
            }
        };
        fetchSites();
    }, [watchedStockOutProjectId, sites]);

    const allItems = useMemo(() => [
        ...mainItems.map(i => ({ ...i, type: 'Main' as const })),
        ...subItems.map(i => ({ ...i, type: 'Sub' as const }))
    ], [mainItems, subItems]);

    const handleStockInSubmit = async (values: z.infer<typeof stockInSchema>) => {
        setIsSaving(true);
        const selectedItem = allItems.find(item => item.id === values.itemId && item.type === values.itemType);
        if(!selectedItem) {
            toast({ title: 'Error', description: 'Selected item not found', variant: 'destructive'});
            setIsSaving(false);
            return;
        }

        const logEntry: Omit<InventoryLog, 'id'> = {
            date: Timestamp.fromDate(values.date),
            itemId: values.itemId,
            itemName: selectedItem.name,
            itemType: values.itemType,
            transactionType: 'Stock In',
            quantity: values.quantity,
            vehicleNo: values.vehicleNo,
        };

        try {
            await addDoc(collection(db, 'inventory_logs'), logEntry);
            toast({ title: 'Success', description: 'Stock-in recorded successfully.' });
            stockInForm.reset();
        } catch (error) {
            toast({ title: 'Error', description: 'Failed to record stock-in.', variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    };
    
    const handleStockOutSubmit = async (values: z.infer<typeof stockOutSchema>) => {
        setIsSaving(true);
        const selectedItem = allItems.find(item => item.id === values.itemId && item.type === values.itemType);
        if(!selectedItem) {
            toast({ title: 'Error', description: 'Selected item not found', variant: 'destructive'});
            setIsSaving(false);
            return;
        }

        const logEntry: Omit<InventoryLog, 'id'> = {
            date: Timestamp.fromDate(values.date),
            itemId: values.itemId,
            itemName: selectedItem.name,
            itemType: values.itemType,
            transactionType: 'Stock Out',
            quantity: values.quantity,
            projectId: values.projectId,
            siteId: values.siteId,
        };

        try {
            await addDoc(collection(db, 'inventory_logs'), logEntry);
            toast({ title: 'Success', description: 'Stock-out recorded successfully.' });
            stockOutForm.reset();
        } catch (error) {
            toast({ title: 'Error', description: 'Failed to record stock-out.', variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    }


    const renderStockInForm = () => (
        <Form {...stockInForm}>
            <form onSubmit={stockInForm.handleSubmit(handleStockInSubmit)} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     <FormField
                        control={stockInForm.control}
                        name="itemType"
                        render={({ field }) => (
                           <FormItem>
                               <FormLabel>Item Type</FormLabel>
                               <Select onValueChange={field.onChange} defaultValue={field.value}>
                                    <FormControl><SelectTrigger><SelectValue placeholder="Select Type"/></SelectTrigger></FormControl>
                                    <SelectContent><SelectItem value="Main">Main Item</SelectItem><SelectItem value="Sub">Sub-Item</SelectItem></SelectContent>
                               </Select>
                               <FormMessage />
                           </FormItem>
                        )}
                    />
                     <FormField
                        control={stockInForm.control}
                        name="itemId"
                        render={({ field }) => (
                           <FormItem>
                               <FormLabel>Item Name</FormLabel>
                               <Select onValueChange={field.onChange} defaultValue={field.value} disabled={!stockInForm.watch('itemType')}>
                                    <FormControl><SelectTrigger><SelectValue placeholder="Select Item"/></SelectTrigger></FormControl>
                                    <SelectContent>
                                        {(stockInForm.watch('itemType') === 'Main' ? mainItems : subItems).map(item => (
                                            <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                               </Select>
                               <FormMessage />
                           </FormItem>
                        )}
                    />
                    <FormField control={stockInForm.control} name="quantity" render={({field}) => <FormItem><FormLabel>Quantity</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage/></FormItem>} />
                    <FormField control={stockInForm.control} name="date" render={({field}) => <FormItem className="flex flex-col"><FormLabel>Date</FormLabel><Popover><PopoverTrigger asChild><FormControl><Button variant="outline" className={cn(!field.value && "text-muted-foreground")}><CalendarIcon className="mr-2 h-4 w-4"/>{field.value ? format(field.value, 'PPP') : <span>Pick a date</span>}</Button></FormControl></PopoverTrigger><PopoverContent className="w-auto p-0"><Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus /></PopoverContent></Popover><FormMessage/></FormItem>} />
                    <FormField control={stockInForm.control} name="vehicleNo" render={({field}) => <FormItem><FormLabel>Vehicle No. (Optional)</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage/></FormItem>} />
                </div>
                 <Button type="submit" disabled={isSaving}>
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4" />}
                    Record Stock In
                </Button>
            </form>
        </Form>
    );

    const renderStockOutForm = () => (
         <Form {...stockOutForm}>
            <form onSubmit={stockOutForm.handleSubmit(handleStockOutSubmit)} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     <FormField control={stockOutForm.control} name="itemType" render={({ field }) => ( <FormItem> <FormLabel>Item Type</FormLabel> <Select onValueChange={field.onChange} defaultValue={field.value}> <FormControl><SelectTrigger><SelectValue placeholder="Select Type"/></SelectTrigger></FormControl> <SelectContent><SelectItem value="Main">Main Item</SelectItem><SelectItem value="Sub">Sub-Item</SelectItem></SelectContent> </Select> <FormMessage /> </FormItem> )} />
                     <FormField control={stockOutForm.control} name="itemId" render={({ field }) => ( <FormItem> <FormLabel>Item Name</FormLabel> <Select onValueChange={field.onChange} defaultValue={field.value} disabled={!stockOutForm.watch('itemType')}> <FormControl><SelectTrigger><SelectValue placeholder="Select Item"/></SelectTrigger></FormControl> <SelectContent> {(stockOutForm.watch('itemType') === 'Main' ? mainItems : subItems).map(item => ( <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem> ))} </SelectContent> </Select> <FormMessage /> </FormItem> )} />
                    <FormField control={stockOutForm.control} name="quantity" render={({field}) => <FormItem><FormLabel>Quantity</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage/></FormItem>} />
                    <FormField control={stockOutForm.control} name="date" render={({field}) => <FormItem className="flex flex-col"><FormLabel>Date</FormLabel><Popover><PopoverTrigger asChild><FormControl><Button variant="outline" className={cn(!field.value && "text-muted-foreground")}><CalendarIcon className="mr-2 h-4 w-4"/>{field.value ? format(field.value, 'PPP') : <span>Pick a date</span>}</Button></FormControl></PopoverTrigger><PopoverContent className="w-auto p-0"><Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus /></PopoverContent></Popover><FormMessage/></FormItem>} />
                    <FormField control={stockOutForm.control} name="projectId" render={({field}) => <FormItem><FormLabel>Project</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Select Project"/></SelectTrigger></FormControl><SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}</SelectContent></Select><FormMessage/></FormItem>} />
                    <FormField control={stockOutForm.control} name="siteId" render={({field}) => <FormItem><FormLabel>Site (Optional)</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value} disabled={!watchedStockOutProjectId}><FormControl><SelectTrigger><SelectValue placeholder="Select Site"/></SelectTrigger></FormControl><SelectContent>{(sites[watchedStockOutProjectId] || []).map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select><FormMessage/></FormItem>} />
                </div>
                 <Button type="submit" disabled={isSaving}>
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4" />}
                    Record Stock Out
                </Button>
            </form>
        </Form>
    );

  return (
    <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/store-stock-management">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-xl font-bold">Inventory Management</h1>
        </div>
      </div>
        <Tabs defaultValue="stock-in">
            <TabsList className="mb-4">
                <TabsTrigger value="stock-in">Stock In</TabsTrigger>
                <TabsTrigger value="stock-out">Stock Out</TabsTrigger>
                <TabsTrigger value="current-stock">Current Stock</TabsTrigger>
                <TabsTrigger value="logs">Logs</TabsTrigger>
            </TabsList>
            <TabsContent value="stock-in">
                <Card>
                    <CardHeader><CardTitle>Record Stock In</CardTitle><CardDescription>Add new items to your inventory.</CardDescription></CardHeader>
                    <CardContent>{renderStockInForm()}</CardContent>
                </Card>
            </TabsContent>
            <TabsContent value="stock-out">
                 <Card>
                    <CardHeader><CardTitle>Record Stock Out</CardTitle><CardDescription>Dispatch items from inventory for project use.</CardDescription></CardHeader>
                    <CardContent>{renderStockOutForm()}</CardContent>
                </Card>
            </TabsContent>
             <TabsContent value="current-stock">
                <Card><CardHeader><CardTitle>Current Stock</CardTitle></CardHeader><CardContent><p>Current stock view will be implemented here.</p></CardContent></Card>
            </TabsContent>
             <TabsContent value="logs">
                 <Card><CardHeader><CardTitle>Inventory Logs</CardTitle></CardHeader><CardContent><p>Inventory logs will be displayed here.</p></CardContent></Card>
            </TabsContent>
        </Tabs>
    </div>
  );
}
