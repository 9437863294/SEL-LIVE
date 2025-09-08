
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, Plus, Trash2, Search, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs } from 'firebase/firestore';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';
import type { BoqItem } from '@/lib/types';
import { ScrollArea } from '@/components/ui/scroll-area';


const initialJmcDetails = {
    jmcNo: '',
    woNo: '',
    jmcDate: new Date().toISOString().split('T')[0],
};

const initialItem = {
    boqSlNo: '',
    description: '',
    unit: '',
    rate: '',
    executedQty: '',
    totalAmount: '',
};

type JmcItem = typeof initialItem;


export default function JmcEntryPage() {
  const { toast } = useToast();
  const [details, setDetails] = useState(initialJmcDetails);
  const [items, setItems] = useState<JmcItem[]>([initialItem]);
  const [isSaving, setIsSaving] = useState(false);
  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [isBoqLoading, setIsBoqLoading] = useState(true);
  const [openPopoverIndex, setOpenPopoverIndex] = useState<number | null>(null);


  useEffect(() => {
    const fetchBoqItems = async () => {
        setIsBoqLoading(true);
        try {
            const boqSnapshot = await getDocs(collection(db, "boqItems"));
            const boqData = boqSnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as BoqItem));
            setBoqItems(boqData);
        } catch (error) {
            console.error("Error fetching BOQ items:", error);
            toast({ title: "Error", description: "Could not fetch BOQ items.", variant: "destructive" });
        }
        setIsBoqLoading(false);
    };
    fetchBoqItems();
  }, [toast]);

  const handleDetailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setDetails(prev => ({ ...prev, [name]: value }));
  };

  const handleItemChange = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const newItems = [...items];
    const item = newItems[index];
    const updatedItem = { ...item, [name]: value };

    if (name === 'executedQty' || name === 'rate') {
        const qty = parseFloat(updatedItem.executedQty);
        const rate = parseFloat(updatedItem.rate);
        if (!isNaN(qty) && !isNaN(rate)) {
            updatedItem.totalAmount = (qty * rate).toFixed(2);
        } else {
            updatedItem.totalAmount = '';
        }
    }

    newItems[index] = updatedItem;
    setItems(newItems);
  };
  
  const handleBoqSelect = (index: number, boqItem: BoqItem) => {
    const newItems = [...items];
    const itemToUpdate = newItems[index];
    const rateKey = Object.keys(boqItem).find(k => k.toLowerCase().includes('price') && !k.toLowerCase().includes('total')) || 'BASIC PRICE';

    itemToUpdate.boqSlNo = boqItem['SL. No.'] || '';
    itemToUpdate.description = boqItem['DESCRIPTION OF ITEMS'] || '';
    itemToUpdate.unit = boqItem['UNITS'] || '';
    itemToUpdate.rate = String(boqItem[rateKey] || '0');
    
    if (itemToUpdate.executedQty) {
        const qty = parseFloat(itemToUpdate.executedQty);
        const rate = parseFloat(itemToUpdate.rate);
         if (!isNaN(qty) && !isNaN(rate)) {
            itemToUpdate.totalAmount = (qty * rate).toFixed(2);
        }
    }

    setItems(newItems);
    setOpenPopoverIndex(null);
  };

  const addItem = () => {
    setItems([...items, { ...initialItem }]);
  };

  const removeItem = (index: number) => {
    const newItems = items.filter((_, i) => i !== index);
    setItems(newItems);
  };

  const handleSave = async () => {
    setIsSaving(true);
    if (!details.jmcNo || !details.woNo || items.some(item => !item.boqSlNo)) {
        toast({
            title: 'Missing Required Fields',
            description: 'Please fill in JMC No, WO No, and ensure all items have a BOQ Sl. No.',
            variant: 'destructive',
        });
        setIsSaving(false);
        return;
    }
    
    try {
        const jmcData = {
            ...details,
            items,
            createdAt: new Date().toISOString()
        };
        await addDoc(collection(db, 'jmcEntries'), jmcData);
        toast({
            title: 'JMC Entry Created',
            description: 'The new JMC entry with all its items has been successfully saved.',
        });
        setDetails(initialJmcDetails);
        setItems([initialItem]);
    } catch (error) {
        console.error("Error creating JMC entry: ", error);
        toast({
            title: 'Save Failed',
            description: 'An error occurred while saving the JMC entry.',
            variant: 'destructive',
        });
    } finally {
        setIsSaving(false);
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
            <Link href="/billing-recon/tpsodl/jmc">
                <Button variant="ghost" size="icon">
                    <ArrowLeft className="h-6 w-6" />
                </Button>
            </Link>
            <h1 className="text-2xl font-bold">Create JMC Entry</h1>
        </div>
        <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Entry
        </Button>
      </div>

      <Card className="mb-6">
        <CardHeader>
            <CardTitle>JMC Details</CardTitle>
            <CardDescription>Provide the main details for this Joint Measurement Certificate.</CardDescription>
        </CardHeader>
        <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                    <Label htmlFor="jmcNo">JMC No</Label>
                    <Input id="jmcNo" name="jmcNo" value={details.jmcNo} onChange={handleDetailChange} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="woNo">WO No</Label>
                    <Input id="woNo" name="woNo" value={details.woNo} onChange={handleDetailChange} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="jmcDate">JMC Date</Label>
                    <Input id="jmcDate" name="jmcDate" type="date" value={details.jmcDate} onChange={handleDetailChange} />
                </div>
            </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
            <CardTitle>JMC Items</CardTitle>
            <CardDescription>Add one or more items executed under this JMC.</CardDescription>
        </CardHeader>
        <CardContent>
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead className="w-[150px]">BOQ Sl. No.</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="w-[100px]">Unit</TableHead>
                        <TableHead className="w-[120px]">Rate</TableHead>
                        <TableHead className="w-[120px]">Executed Qty</TableHead>
                        <TableHead className="w-[150px]">Total Amount</TableHead>
                        <TableHead className="w-[50px]">Action</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {items.map((item, index) => (
                        <TableRow key={index}>
                           <TableCell>
                                <Popover open={openPopoverIndex === index} onOpenChange={(isOpen) => setOpenPopoverIndex(isOpen ? index : null)}>
                                    <PopoverTrigger asChild>
                                        <Button variant="outline" className="w-full justify-between">
                                            {item.boqSlNo || "Select..."}
                                            <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-[400px] p-0">
                                        <Command>
                                            <CommandInput placeholder="Search BOQ..." />
                                            <CommandList>
                                                <CommandEmpty>{isBoqLoading ? 'Loading...' : 'No BOQ item found.'}</CommandEmpty>
                                                <CommandGroup>
                                                   <ScrollArea className="h-72">
                                                    {boqItems.map(boqItem => (
                                                        <CommandItem
                                                            key={boqItem.id}
                                                            value={`${boqItem['SL. No.'] || ''} ${boqItem['DESCRIPTION OF ITEMS'] || ''}`}
                                                            onSelect={() => handleBoqSelect(index, boqItem)}
                                                        >
                                                            <Check className={cn("mr-2 h-4 w-4", item.boqSlNo === boqItem['SL. No.'] ? "opacity-100" : "opacity-0")} />
                                                            <span className="flex-1">{boqItem['SL. No.']} - {boqItem['DESCRIPTION OF ITEMS']}</span>
                                                        </CommandItem>
                                                    ))}
                                                    </ScrollArea>
                                                </CommandGroup>
                                            </CommandList>
                                        </Command>
                                    </PopoverContent>
                                </Popover>
                           </TableCell>
                            <TableCell>{item.description}</TableCell>
                            <TableCell>{item.unit}</TableCell>
                            <TableCell>{item.rate}</TableCell>
                            <TableCell>
                                <Input name="executedQty" value={item.executedQty} onChange={(e) => handleItemChange(index, e)} type="number" />
                            </TableCell>
                            <TableCell>{item.totalAmount}</TableCell>
                            <TableCell>
                                <Button variant="ghost" size="icon" onClick={() => removeItem(index)} disabled={items.length <= 1}>
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
            <Button variant="outline" onClick={addItem} className="mt-4">
                <Plus className="mr-2 h-4 w-4" /> Add Item
            </Button>
        </CardContent>
      </Card>
    </div>
  );
}
