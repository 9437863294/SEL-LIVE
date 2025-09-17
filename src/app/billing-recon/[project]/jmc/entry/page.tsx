
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, Plus, Trash2, Library } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs } from 'firebase/firestore';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { BoqItem } from '@/lib/types';
import { BoqItemSelector } from '@/components/BoqItemSelector';
import { BoqMultiSelectDialog } from '@/components/BoqMultiSelectDialog';
import { useParams } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';

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
  const { user } = useAuth();
  const { project: projectSlug } = useParams() as { project: string };
  const [details, setDetails] = useState(initialJmcDetails);
  const [items, setItems] = useState<JmcItem[]>([initialItem]);
  const [isSaving, setIsSaving] = useState(false);
  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [isBoqLoading, setIsBoqLoading] = useState(true);
  const [isMultiSelectOpen, setIsMultiSelectOpen] = useState(false);

  useEffect(() => {
    const fetchBoqItems = async () => {
        if (!projectSlug) return;
        setIsBoqLoading(true);
        try {
            const boqSnapshot = await getDocs(collection(db, "projects", projectSlug, "boqItems"));
            const boqData = boqSnapshot.docs.map(doc => {
                const data = doc.data();
                return { 
                    ...data, 
                    id: doc.id, 
                    'SL. No.': String(data['SL. No.'] || '') 
                } as BoqItem;
            }).sort((a, b) => {
                const slNoA = parseFloat(a['SL. No.']);
                const slNoB = parseFloat(b['SL. No.']);
                if (isNaN(slNoA) || isNaN(slNoB)) return 0;
                return slNoA - slNoB;
            });
            setBoqItems(boqData);
        } catch (error) {
            console.error("Error fetching BOQ items:", error);
            toast({ title: "Error", description: "Could not fetch BOQ items for this project.", variant: "destructive" });
        }
        setIsBoqLoading(false);
    };
    fetchBoqItems();
  }, [projectSlug, toast]);

  const handleDetailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setDetails(prev => ({ ...prev, [name]: value }));
  };
  
  const findBasicPriceKey = (boqItem: BoqItem): string | undefined => {
    const keys = Object.keys(boqItem);
    return keys.find(key => key.toLowerCase().includes('price') && !key.toLowerCase().includes('total'));
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
  
  const handleBoqSelect = (index: number, boqItem: BoqItem | null) => {
    const newItems = [...items];
    const itemToUpdate = newItems[index];

    if (boqItem) {
        const rateKey = findBasicPriceKey(boqItem) || 'BASIC PRICE';
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
    } else {
        Object.assign(itemToUpdate, initialItem);
    }
    
    setItems(newItems);
  };
  
  const handleMultiBoqSelect = (selectedBoqItems: BoqItem[]) => {
      const newJmcItems = selectedBoqItems.map(boqItem => {
          const rateKey = findBasicPriceKey(boqItem) || 'BASIC PRICE';
          return {
              boqSlNo: boqItem['SL. No.'] || '',
              description: boqItem['DESCRIPTION OF ITEMS'] || '',
              unit: boqItem['UNITS'] || '',
              rate: String(boqItem[rateKey] || '0'),
              executedQty: '',
              totalAmount: '',
          };
      });

      // If the first item is empty, replace it. Otherwise, add the new items.
      const existingItems = items.length === 1 && items[0].boqSlNo === ''
          ? []
          : items;

      setItems([...existingItems, ...newJmcItems]);
  };

  const addItem = () => {
    setItems([...items, { ...initialItem }]);
  };

  const removeItem = (index: number) => {
    if (items.length > 1) {
        const newItems = items.filter((_, i) => i !== index);
        setItems(newItems);
    } else {
        // If it's the last item, just reset it to the initial state
        setItems([{...initialItem}]);
    }
  };

  const handleSave = async () => {
    if (!user) {
        toast({ title: 'Authentication Error', description: 'You must be logged in.', variant: 'destructive'});
        return;
    }
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
        await addDoc(collection(db, 'projects', projectSlug, 'jmcEntries'), jmcData);

        await logUserActivity({
            userId: user.id,
            action: 'Create JMC Entry',
            details: {
                project: projectSlug,
                jmcNo: details.jmcNo,
                workOrderNo: details.woNo,
                itemCount: items.length,
            }
        });

        toast({
            title: 'JMC Entry Created',
            description: 'The new JMC entry has been successfully saved.',
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
    <>
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
            <Link href={`/billing-recon/${projectSlug}/jmc`}>
                <Button variant="ghost" size="icon">
                    <ArrowLeft className="h-6 w-6" />
                </Button>
            </Link>
            <h1 className="text-xl font-bold">Create JMC Entry</h1>
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
             <div className="flex items-center justify-between">
                <div>
                    <CardTitle>JMC Items</CardTitle>
                    <CardDescription>Add one or more items executed under this JMC.</CardDescription>
                </div>
                <Button variant="outline" onClick={() => setIsMultiSelectOpen(true)}>
                    <Library className="mr-2 h-4 w-4" /> Add Multiple Items
                </Button>
            </div>
        </CardHeader>
        <CardContent>
            <div className="overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[250px]">BOQ Sl. No.</TableHead>
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
                                    <BoqItemSelector
                                        boqItems={boqItems}
                                        selectedSlNo={item.boqSlNo}
                                        onSelect={(boqItem) => handleBoqSelect(index, boqItem)}
                                        isLoading={isBoqLoading}
                                    />
                                </TableCell>
                                <TableCell>{item.description}</TableCell>
                                <TableCell>{item.unit}</TableCell>
                                <TableCell>{item.rate}</TableCell>
                                <TableCell>
                                    <Input name="executedQty" value={item.executedQty} onChange={(e) => handleItemChange(index, e)} type="number" />
                                </TableCell>
                                <TableCell>{item.totalAmount}</TableCell>
                                <TableCell>
                                    <Button variant="ghost" size="icon" onClick={() => removeItem(index)}>
                                        <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
            <Button variant="outline" onClick={addItem} className="mt-4">
                <Plus className="mr-2 h-4 w-4" /> Add Item
            </Button>
        </CardContent>
      </Card>
    </div>
    <BoqMultiSelectDialog
        isOpen={isMultiSelectOpen}
        onOpenChange={setIsMultiSelectOpen}
        boqItems={boqItems}
        onConfirm={handleMultiBoqSelect}
    />
    </>
  );
}
