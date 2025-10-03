
'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Plus,
  Trash2,
  Save,
  Loader2,
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

const initialItemState = {
  id: Date.now(),
  itemId: '',
  itemName: '',
  itemUnit: '',
  quantity: 1,
  receiveUnit: '',
  batchNo: '',
  unitCost: 0,
};

type GrnItem = typeof initialItemState;

export default function StockInPage() {
  const { toast } = useToast();
  const router = useRouter();
  const params = useParams() as { project: string };
  const projectSlug = params.project;

  const [supplier, setSupplier] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<GrnItem[]>([{...initialItemState, id: Date.now()}]);
  const [isSaving, setIsSaving] = useState(false);

  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [isLoadingItems, setIsLoadingItems] = useState(true);

  useEffect(() => {
    const fetchBoq = async () => {
      if (!projectSlug) return;
      setIsLoadingItems(true);
      try {
        const q = query(
          collection(db, 'boqItems'),
          where('projectSlug', '==', projectSlug)
        );
        const boqSnapshot = await getDocs(q);
        const boqData = boqSnapshot.docs.map(
          (doc) => ({ id: doc.id, ...doc.data() } as BoqItem)
        );
        setBoqItems(boqData);
      } catch (error) {
        console.error('Error fetching BOQ:', error);
      }
      setIsLoadingItems(false);
    };
    fetchBoq();
  }, [projectSlug]);

  const handleAddItem = () => {
    setItems(prevItems => [...prevItems, { ...initialItemState, id: Date.now() }]);
  };

  const handleRemoveItem = (id: number) => {
    if (items.length > 1) {
        setItems(items.filter((item) => item.id !== id));
    } else {
        setItems([{...initialItemState, id: Date.now()}]); // Reset the last item
    }
  };

  const handleItemChange = (
    id: number,
    field: keyof Omit<GrnItem, 'id'>,
    value: any
  ) => {
    setItems(prevItems =>
      prevItems.map(item =>
        item.id === id ? { ...item, [field]: value } : item
      )
    );
  };
  
  const getItemDescription = (item: BoqItem) => {
    const descriptionKeys = [
      'Description',
      'DESCRIPTION OF ITEMS',
      'DESCRIPTION OF ITEMS(SCHEDULE-VIIA-SS) SUPPLY OF FOLLOWING EQUIPMENT & MATERIALS (As per Technical Specification)'
    ];
    for (const key of descriptionKeys) {
      if (item[key]) {
        return String(item[key]);
      }
    }
    const fallbackKey = Object.keys(item).find(k => k.toLowerCase().includes('description'));
    return fallbackKey ? String(item[fallbackKey]) : '';
  };

  const handleItemSelect = (id: number, selectedBoqItem: BoqItem | null) => {
    setItems(prevItems =>
      prevItems.map(item => {
        if (item.id === id) {
          if (selectedBoqItem) {
            const description = getItemDescription(selectedBoqItem);
            const unit = selectedBoqItem['UNIT'] || selectedBoqItem['UNITS'] || '';
            return {
              ...item,
              itemId: selectedBoqItem.id,
              itemName: description,
              itemUnit: unit,
              receiveUnit: unit,
            };
          } else {
            return {
              ...initialItemState,
              id: item.id, // Keep the unique ID
            };
          }
        }
        return item;
      })
    );
  };

  const handleSave = async () => {
    if (!supplier || items.some((item) => !item.itemId || item.quantity <= 0)) {
      toast({
        title: 'Validation Error',
        description: 'Please fill in Supplier and all item details.',
        variant: 'destructive',
      });
      return;
    }
    setIsSaving(true);

    try {
      const writePromises = items.map((item) => {
        const logEntry: Omit<InventoryLog, 'id'> = {
          date: new Date(),
          itemId: item.itemId,
          itemName: item.itemName,
          itemType: 'Sub', // Assuming all BOQ items are sub-items for now
          transactionType: 'Goods Receipt',
          quantity: item.quantity,
          unit: item.receiveUnit,
          projectId: projectSlug,
          description: `GRN from ${supplier}. PO: ${poNumber}, Inv: ${invoiceNumber}. ${notes}`,
          cost: item.unitCost,
          batch: item.batchNo,
          details: { supplier, poNumber, invoiceNumber },
        };
        return addDoc(collection(db, 'inventoryLogs'), logEntry);
      });

      await Promise.all(writePromises);

      toast({
        title: 'Success',
        description: 'Goods receipt recorded successfully.',
      });
      router.push(`/store-stock-management/${projectSlug}/transactions`);
    } catch (e) {
      console.error(e);
      toast({
        title: 'Error',
        description: 'Failed to save stock-in transaction.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const getSelectedSlNo = (item: GrnItem) => {
    if (!item.itemId) return '';
    const boqItem = boqItems.find((bi) => bi.id === item.itemId);
    return boqItem ? String(boqItem['Sl No'] || boqItem['SL. No.'] || '') : '';
  };


  return (
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
            <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4" />}
                Save Transaction
            </Button>
        </div>

        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>GRN Details</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="supplier">Supplier</Label>
                        <Input id="supplier" placeholder="e.g., ACME Corp" value={supplier} onChange={e => setSupplier(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="poNumber">P.O. Number</Label>
                        <Input id="poNumber" placeholder="e.g., PO-12345" value={poNumber} onChange={e => setPoNumber(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="invoiceNumber">Invoice Number</Label>
                        <Input id="invoiceNumber" placeholder="e.g., INV-67890" value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Items Received</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                    {items.map((item, index) => (
                        <div key={item.id} className="grid grid-cols-[1fr,80px,100px,120px,120px,auto] gap-2 items-end p-2 border rounded-md">
                           <div className="space-y-1">
                             {index === 0 && <Label className="text-xs">BOQ Item</Label>}
                             <BoqItemSelector
                                key={item.id} 
                                boqItems={boqItems}
                                selectedSlNo={getSelectedSlNo(item)}
                                onSelect={(selectedBoqItem) => handleItemSelect(item.id, selectedBoqItem)}
                                isLoading={isLoadingItems}
                              />
                           </div>
                           <div className="space-y-1">
                              {index === 0 && <Label className="text-xs">Quantity</Label>}
                              <Input type="number" placeholder="1" value={item.quantity} onChange={e => handleItemChange(item.id, 'quantity', Number(e.target.value))}/>
                           </div>
                            <div className="space-y-1">
                              {index === 0 && <Label className="text-xs">Receive Unit</Label>}
                              <Input placeholder="e.g. Box" value={item.receiveUnit} onChange={e => handleItemChange(item.id, 'receiveUnit', e.target.value)} />
                           </div>
                           <div className="space-y-1">
                               {index === 0 && <Label className="text-xs">Batch No.</Label>}
                               <Input placeholder="Batch/Lot" value={item.batchNo} onChange={e => handleItemChange(item.id, 'batchNo', e.target.value)} />
                            </div>
                           <div className="space-y-1">
                                {index === 0 && <Label className="text-xs">Unit Cost</Label>}
                                <Input type="number" placeholder="0" value={item.unitCost} onChange={e => handleItemChange(item.id, 'unitCost', Number(e.target.value))} />
                            </div>
                           <Button variant="destructive" size="icon" onClick={() => handleRemoveItem(item.id)}>
                                <Trash2 className="h-4 w-4"/>
                           </Button>
                        </div>
                    ))}
                    <Button variant="outline" size="sm" onClick={handleAddItem} className="mt-2">
                        <Plus className="mr-2 h-4 w-4" /> Add Item
                    </Button>
                </CardContent>
            </Card>

             <Card>
                <CardHeader>
                    <CardTitle>Notes</CardTitle>
                </CardHeader>
                <CardContent>
                    <Textarea id="notes" placeholder="Add any relevant notes for this transaction..." value={notes} onChange={e => setNotes(e.target.value)} />
                </CardContent>
            </Card>
        </div>
    </div>
  );
}
