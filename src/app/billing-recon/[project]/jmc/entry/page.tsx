
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, Plus, Trash2, Library } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs, query, where } from 'firebase/firestore';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { BoqItem, JmcEntry as JmcEntryType } from '@/lib/types';
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
    rate: 0,
    executedQty: 0,
    certifiedQty: 0,
    totalAmount: 0,
    boqQty: 0,
    totalCertifiedQty: 0,
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
  const [allJmcEntries, setAllJmcEntries] = useState<JmcEntryType[]>([]);
  const [isBoqLoading, setIsBoqLoading] = useState(true);
  const [isBoqMultiSelectOpen, setIsBoqMultiSelectOpen] = useState(false);

  useEffect(() => {
    const fetchBoqAndJmcData = async () => {
        if (!projectSlug) return;
        setIsBoqLoading(true);
        try {
            const boqSnapshot = await getDocs(query(collection(db, "projects", projectSlug, "boqItems")));
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
            
            const jmcSnapshot = await getDocs(collection(db, "projects", projectSlug, "jmcEntries"));
            setAllJmcEntries(jmcSnapshot.docs.map(doc => doc.data() as JmcEntryType));

        } catch (error) {
            console.error("Error fetching data:", error);
            toast({ title: "Error", description: "Could not fetch project data.", variant: "destructive" });
        }
        setIsBoqLoading(false);
    };
    fetchBoqAndJmcData();
  }, [projectSlug, toast]);

  const totalCertifiedQtyMap = useMemo(() => {
    const map: Record<string, number> = {};
    allJmcEntries.forEach(entry => {
        entry.items.forEach(item => {
            if (item.boqSlNo) {
                map[item.boqSlNo] = (map[item.boqSlNo] || 0) + (item.certifiedQty || 0);
            }
        });
    });
    return map;
  }, [allJmcEntries]);

  const handleDetailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setDetails(prev => ({ ...prev, [name]: value }));
  };
  
  const findBasicPriceKey = (boqItem: BoqItem): string | undefined => {
    const knownPriceKeys = ['UNIT PRICE', 'Unit Rate', 'Rate', 'UNIT PRICE'];
    for (const key of knownPriceKeys) {
        if (boqItem.hasOwnProperty(key)) {
            return key;
        }
    }
    // Fallback for other possible rate columns
    return Object.keys(boqItem).find(key => key.toLowerCase().includes('rate') && !key.toLowerCase().includes('total'));
};

  const handleItemChange = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const newItems = [...items];
    const item = newItems[index];
    const updatedItem = { ...item, [name]: value };

    if (name === 'executedQty' || name === 'rate' || name === 'certifiedQty') {
        const qty = parseFloat(String(updatedItem.executedQty));
        const rate = parseFloat(String(updatedItem.rate));
        if (!isNaN(qty) && !isNaN(rate)) {
            updatedItem.totalAmount = qty * rate;
        } else {
            updatedItem.totalAmount = 0;
        }
    }

    newItems[index] = updatedItem;
    setItems(newItems);
  };
  
  const handleBoqSelect = (index: number, boqItem: BoqItem | null) => {
    const newItems = [...items];
    const itemToUpdate = newItems[index];
  
    if (boqItem) {
      const rateKey = findBasicPriceKey(boqItem);
      const rawRate = rateKey ? boqItem[rateKey] : 0;
      const rateNum =
        typeof rawRate === 'number'
          ? rawRate
          : Number(String(rawRate ?? '0').replace(/,/g, '').trim());
      
      const boqSlNo = String((boqItem as any)['BOQ SL No'] ?? '');
  
      Object.assign(itemToUpdate, {
        boqSlNo: boqSlNo,
        description: String((boqItem as any)['Description'] ?? ''),
        unit: (boqItem as any)['Unit'] ?? (boqItem as any)['UNIT'] ?? '',
        rate: Number.isFinite(rateNum) ? rateNum : 0,
        boqQty: Number((boqItem as any)['QTY'] || 0),
        totalCertifiedQty: totalCertifiedQtyMap[boqSlNo] || 0
      });
  
      const qty = Number(itemToUpdate.executedQty) || 0;
      itemToUpdate.totalAmount = qty * (Number(itemToUpdate.rate) || 0);
    } else {
      Object.assign(itemToUpdate, initialItem);
    }
  
    setItems(newItems);
  };
  
  
    const handleMultiBoqSelect = (selectedBoqItems: BoqItem[]) => {
        const newJmcItems = selectedBoqItems.map((boqItem) => {
        const rateKey = findBasicPriceKey(boqItem);
        const rawRate = rateKey ? (boqItem as any)[rateKey] : 0;
        const rateNum =
            typeof rawRate === 'number'
            ? rawRate
            : Number(String(rawRate ?? '0').replace(/,/g, '').trim());
    
        const slNo = String(
            (boqItem as any)['BOQ SL No'] ??
            ''
        );
    
        return {
            ...initialItem,
            boqSlNo: slNo,
            description: (boqItem as any)['Description'] ?? '',
            unit: (boqItem as any)['Unit'] ?? (boqItem as any)['UNIT'] ?? '',
            rate: Number.isFinite(rateNum) ? rateNum : 0,
            boqQty: Number((boqItem as any)['QTY'] || 0),
            totalCertifiedQty: totalCertifiedQtyMap[slNo] || 0,
        } as JmcItem;
        });
    
        const existingItems =
        items.length === 1 && items[0].boqSlNo === '' ? [] : items;
    
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

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  }


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
                <Button variant="outline" onClick={() => setIsBoqMultiSelectOpen(true)}>
                    <Library className="mr-2 h-4 w-4" /> Add Items from BOQ
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
                            <TableHead>Unit</TableHead>
                            <TableHead>BOQ Qty</TableHead>
                            <TableHead>Total Certified Qty</TableHead>
                            <TableHead className="w-[120px]">Rate</TableHead>
                            <TableHead className="w-[120px]">Executed Qty</TableHead>
                            <TableHead className="w-[120px]">Certified Qty</TableHead>
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
                                <TableCell>{item.boqQty}</TableCell>
                                <TableCell>{item.totalCertifiedQty}</TableCell>
                                <TableCell>{item.rate}</TableCell>
                                <TableCell>
                                    <Input name="executedQty" value={item.executedQty} onChange={(e) => handleItemChange(index, e)} type="number" />
                                </TableCell>
                                <TableCell>
                                    <Input name="certifiedQty" value={item.certifiedQty} onChange={(e) => handleItemChange(index, e)} type="number" />
                                </TableCell>
                                <TableCell>{formatCurrency(item.totalAmount)}</TableCell>
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
        isOpen={isBoqMultiSelectOpen}
        onOpenChange={setIsBoqMultiSelectOpen}
        boqItems={boqItems}
        onConfirm={handleMultiBoqSelect}
    />
    </>
  );
}

    