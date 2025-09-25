
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, History, Save, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { db, storage } from '@/lib/firebase';
import { collection, getDocs, addDoc, Timestamp, runTransaction, doc, getDoc, writeBatch } from 'firebase/firestore';
import type { MainItem, SubItem, Project, Site, InventoryLog, ItemWithStock, BomItem } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Calendar as CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const stockInItemSchema = z.object({
    itemId: z.string().min(1, 'Item is required.'),
    itemType: z.enum(['Main', 'Sub'], { required_error: 'Item type is required.'}),
    quantity: z.coerce.number().min(1, 'Quantity must be at least 1.'),
});

const stockInSchema = z.object({
    date: z.date(),
    vehicleNo: z.string().optional(),
    items: z.array(stockInItemSchema).min(1, "Please add at least one item."),
});

const stockOutItemSchema = z.object({
    itemId: z.string().min(1, 'Item is required.'),
    itemType: z.enum(['Main', 'Sub'], { required_error: 'Item type is required.'}),
    quantity: z.coerce.number().min(1, 'Quantity must be at least 1.'),
});

const stockOutSchema = z.object({
    date: z.date(),
    projectId: z.string().min(1, 'Project is required.'),
    siteId: z.string().optional(),
    items: z.array(stockOutItemSchema).min(1, "Please add at least one item."),
});


export default function InventoryPage() {
    const { toast } = useToast();
    const [mainItems, setMainItems] = useState<MainItem[]>([]);
    const [subItems, setSubItems] = useState<SubItem[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);
    const [sites, setSites] = useState<Record<string, Site[]>>({});
    const [inventoryLogs, setInventoryLogs] = useState<InventoryLog[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    const stockInForm = useForm<z.infer<typeof stockInSchema>>({ resolver: zodResolver(stockInSchema), defaultValues: { date: new Date(), vehicleNo: '', items: [{ itemId: '', itemType: undefined, quantity: 1}] } });
    const stockOutForm = useForm<z.infer<typeof stockOutSchema>>({ resolver: zodResolver(stockOutSchema), defaultValues: { date: new Date(), projectId: '', siteId: '', items: [{ itemId: '', itemType: undefined, quantity: 1 }] } });
    
    const { fields: stockInFields, append: appendStockIn, remove: removeStockIn } = useFieldArray({ control: stockInForm.control, name: 'items' });
    const { fields: stockOutFields, append: appendStockOut, remove: removeStockOut } = useFieldArray({ control: stockOutForm.control, name: 'items' });
    
    const watchProjectId = stockOutForm.watch('projectId');

    const fetchData = async () => {
        setIsLoading(true);
        try {
            const [mainItemsSnap, subItemsSnap, projectsSnap, logsSnap] = await Promise.all([
                getDocs(collection(db, 'main_items')),
                getDocs(collection(db, 'sub_items')),
                getDocs(collection(db, 'projects')),
                getDocs(collection(db, 'inventory_logs')),
            ]);
            const projectsData = projectsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project));
            setMainItems(mainItemsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as MainItem)));
            setSubItems(subItemsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as SubItem)));
            setProjects(projectsData);
            setInventoryLogs(logsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryLog)));

            const sitesData: Record<string, Site[]> = {};
            for (const project of projectsData) {
                const sitesSnap = await getDocs(collection(db, 'projects', project.id, 'sites'));
                sitesData[project.id] = sitesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Site));
            }
            setSites(sitesData);

        } catch (error) {
            toast({ title: "Error", description: "Failed to load initial data.", variant: "destructive" });
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [toast]);
    
    const allItems = useMemo(() => [
        ...mainItems.map(i => ({ ...i, type: 'Main' as const })),
        ...subItems.map(i => ({ ...i, type: 'Sub' as const }))
    ], [mainItems, subItems]);
    
    const currentStock = useMemo(() => {
        const stockMap = new Map<string, ItemWithStock>();
        allItems.forEach(item => {
            stockMap.set(`${item.id}-${item.type}`, { ...item, stock: 0 });
        });
        inventoryLogs.forEach(log => {
            const key = `${log.itemId}-${log.itemType}`;
            if (stockMap.has(key)) {
                const currentItem = stockMap.get(key)!;
                if (log.transactionType === 'Stock In') {
                    currentItem.stock += log.quantity;
                } else if (log.transactionType === 'Stock Out') {
                    currentItem.stock -= log.quantity;
                }
                stockMap.set(key, currentItem);
            }
        });
        return Array.from(stockMap.values());
    }, [allItems, inventoryLogs]);


    const handleStockInSubmit = async (values: z.infer<typeof stockInSchema>) => {
        setIsSaving(true);
        const logsBatch: Omit<InventoryLog, 'id'>[] = [];

        for (const item of values.items) {
            const selectedItem = allItems.find(i => i.id === item.itemId && i.type === item.itemType);
            if (!selectedItem) {
                toast({ title: 'Error', description: `Item with ID ${item.itemId} not found.`, variant: 'destructive'});
                setIsSaving(false);
                return;
            }

            logsBatch.push({
                date: Timestamp.fromDate(values.date),
                itemId: item.itemId,
                itemName: selectedItem.name,
                itemType: item.itemType,
                transactionType: 'Stock In',
                quantity: item.quantity,
                vehicleNo: values.vehicleNo
            });
        }

        try {
            const batch = writeBatch(db);
            logsBatch.forEach(logEntry => {
                const newLogRef = doc(collection(db, 'inventory_logs'));
                batch.set(newLogRef, logEntry);
            });
            await batch.commit();

            await fetchData();
            toast({ title: 'Success', description: 'Stock transactions recorded successfully.' });
            stockInForm.reset({ date: new Date(), vehicleNo: '', items: [{ itemId: '', itemType: undefined, quantity: 1}] });
        } catch (error) {
            toast({ title: 'Error', description: 'Failed to record stock transaction.', variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    };
    
    const handleStockOutSubmit = async (values: z.infer<typeof stockOutSchema>) => {
        setIsSaving(true);
        const logsBatch: Omit<InventoryLog, 'id'>[] = [];

        for (const item of values.items) {
             const selectedItem = allItems.find(i => i.id === item.itemId && i.type === item.itemType);
            if (!selectedItem) {
                toast({ title: 'Error', description: 'Selected item not found', variant: 'destructive'});
                setIsSaving(false);
                return;
            }
            
            const currentItemStock = currentStock.find(s => s.id === item.itemId && s.type === item.itemType)?.stock || 0;
            if(item.quantity > currentItemStock) {
                toast({ title: 'Insufficient Stock', description: `Cannot stock out ${item.quantity} of ${selectedItem.name}. Only ${currentItemStock} available.`, variant: 'destructive' });
                setIsSaving(false);
                return;
            }
            logsBatch.push({ date: Timestamp.fromDate(values.date), itemId: item.itemId, itemName: selectedItem.name, itemType: item.itemType, transactionType: 'Stock Out', quantity: item.quantity, projectId: values.projectId, siteId: values.siteId });
        }

        try {
            const batch = writeBatch(db);
            logsBatch.forEach(logEntry => {
                const newLogRef = doc(collection(db, 'inventory_logs'));
                batch.set(newLogRef, logEntry);
            });
            await batch.commit();

            await fetchData();
            toast({ title: 'Success', description: 'Stock-out recorded successfully.' });
            stockOutForm.reset({ date: new Date(), projectId: '', siteId: '', items: [{ itemId: '', itemType: undefined, quantity: 1 }] });
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
                    <FormField control={stockInForm.control} name="date" render={({field}) => <FormItem className="flex flex-col"><FormLabel>Date</FormLabel><Popover><PopoverTrigger asChild><FormControl><Button variant="outline" className={cn(!field.value && "text-muted-foreground")}><CalendarIcon className="mr-2 h-4 w-4"/>{field.value ? format(field.value, 'PPP') : <span>Pick a date</span>}</Button></FormControl></PopoverTrigger><PopoverContent className="w-auto p-0"><Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus /></PopoverContent></Popover><FormMessage/></FormItem>} />
                    <FormField control={stockInForm.control} name="vehicleNo" render={({field}) => <FormItem><FormLabel>Vehicle No.</FormLabel><FormControl><Input placeholder="e.g. OD02AB1234" {...field} value={field.value || ''} /></FormControl><FormMessage/></FormItem>} />
                 </div>
                
                <Table>
                    <TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Item</TableHead><TableHead>Quantity</TableHead><TableHead className="w-12"></TableHead></TableRow></TableHeader>
                    <TableBody>
                        {stockInFields.map((field, index) => (
                            <TableRow key={field.id}>
                                <TableCell><FormField control={stockInForm.control} name={`items.${index}.itemType`} render={({field}) => <Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl><SelectContent><SelectItem value="Main">Main</SelectItem><SelectItem value="Sub">Sub</SelectItem></SelectContent></Select>} /></TableCell>
                                <TableCell><FormField control={stockInForm.control} name={`items.${index}.itemId`} render={({field}) => <Select onValueChange={field.onChange} value={field.value} disabled={!stockInForm.watch(`items.${index}.itemType`)}><FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl><SelectContent>{(stockInForm.watch(`items.${index}.itemType`) === 'Main' ? mainItems : subItems).map(i => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}</SelectContent></Select>} /></TableCell>
                                <TableCell><FormField control={stockInForm.control} name={`items.${index}.quantity`} render={({field}) => <Input type="number" {...field} />} /></TableCell>
                                <TableCell><Button variant="ghost" size="icon" onClick={() => removeStockIn(index)}><Trash2 className="h-4 w-4 text-destructive"/></Button></TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
                <div className="flex justify-between">
                    <Button type="button" variant="outline" onClick={() => appendStockIn({ itemId: '', itemType: undefined, quantity: 1})}><Plus className="mr-2 h-4 w-4" />Add Row</Button>
                    <Button type="submit" disabled={isSaving}>
                        {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4" />}
                        Record Stock In
                    </Button>
                </div>
            </form>
        </Form>
    );

    const renderStockOutForm = () => (
         <Form {...stockOutForm}>
            <form onSubmit={stockOutForm.handleSubmit(handleStockOutSubmit)} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <FormField control={stockOutForm.control} name="date" render={({field}) => <FormItem className="flex flex-col"><FormLabel>Date</FormLabel><Popover><PopoverTrigger asChild><FormControl><Button variant="outline" className={cn(!field.value && "text-muted-foreground")}><CalendarIcon className="mr-2 h-4 w-4"/>{field.value ? format(field.value, 'PPP') : <span>Pick a date</span>}</Button></FormControl></PopoverTrigger><PopoverContent className="w-auto p-0"><Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus /></PopoverContent></Popover><FormMessage/></FormItem>} />
                    <FormField control={stockOutForm.control} name="projectId" render={({field}) => <FormItem><FormLabel>Project</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl><SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}</SelectContent></Select></FormItem>} />
                    <FormField control={stockOutForm.control} name="siteId" render={({field}) => <FormItem><FormLabel>Site</FormLabel><Select onValueChange={field.onChange} value={field.value || ''} disabled={!watchProjectId}><FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl><SelectContent>{(sites[watchProjectId] || []).map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select></FormItem>} />
                </div>
                 <Table>
                    <TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Item</TableHead><TableHead>Quantity</TableHead><TableHead className="w-12"></TableHead></TableRow></TableHeader>
                    <TableBody>
                        {stockOutFields.map((field, index) => (
                            <TableRow key={field.id}>
                                <TableCell><FormField control={stockOutForm.control} name={`items.${index}.itemType`} render={({field}) => <Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl><SelectContent><SelectItem value="Main">Main</SelectItem><SelectItem value="Sub">Sub</SelectItem></SelectContent></Select>} /></TableCell>
                                <TableCell><FormField control={stockOutForm.control} name={`items.${index}.itemId`} render={({field}) => <Select onValueChange={field.onChange} value={field.value} disabled={!stockOutForm.watch(`items.${index}.itemType`)}><FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl><SelectContent>{(stockOutForm.watch(`items.${index}.itemType`) === 'Main' ? mainItems : subItems).map(i => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}</SelectContent></Select>} /></TableCell>
                                <TableCell><FormField control={stockOutForm.control} name={`items.${index}.quantity`} render={({field}) => <Input type="number" {...field} />} /></TableCell>
                                <TableCell><Button variant="ghost" size="icon" onClick={() => removeStockOut(index)}><Trash2 className="h-4 w-4 text-destructive"/></Button></TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
                <div className="flex justify-between">
                    <Button type="button" variant="outline" onClick={() => appendStockOut({ itemId: '', itemType: undefined, quantity: 1 })}><Plus className="mr-2 h-4 w-4" />Add Row</Button>
                    <Button type="submit" disabled={isSaving}>
                        {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4" />}
                        Record Stock Out
                    </Button>
                </div>
            </form>
        </Form>
    );
    
    const renderCurrentStock = () => (
      <Card>
        <CardHeader>
          <CardTitle>Current Stock Levels</CardTitle>
          <CardDescription>An overview of your current inventory.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item Name</TableHead>
                <TableHead>Item Type</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">Current Stock</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={4} className="h-24 text-center">Loading...</TableCell></TableRow>
              ) : currentStock.length > 0 ? (
                currentStock.map(item => (
                  <TableRow key={`${item.id}-${item.type}`}>
                    <TableCell>{item.name}</TableCell>
                    <TableCell>{item.type}</TableCell>
                    <TableCell>{item.unit || 'N/A'}</TableCell>
                    <TableCell className="text-right font-medium">{item.stock}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow><TableCell colSpan={4} className="h-24 text-center">No items in inventory.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
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
                {renderCurrentStock()}
            </TabsContent>
             <TabsContent value="logs">
                 <Card><CardHeader><CardTitle>Inventory Logs</CardTitle></CardHeader><CardContent><p>Inventory logs will be displayed here.</p></CardContent></Card>
            </TabsContent>
        </Tabs>
    </div>
  );
}

    