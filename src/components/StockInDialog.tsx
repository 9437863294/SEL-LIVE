
'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import type { InventoryLog, BoqItem } from '@/lib/types';
import { Plus, Trash2, Save, Loader2 } from 'lucide-react';
import { BoqItemSelector } from './BoqItemSelector';
import { Textarea } from './ui/textarea';
import { collection, getDocs, addDoc, doc, runTransaction, updateDoc, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useParams } from 'next/navigation';

interface StockInDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onConfirm: () => void;
}

const initialItemState = {
    itemId: '',
    itemName: '',
    itemUnit: '',
    quantity: 1,
    batchNo: '',
    unitCost: 0,
};

type GrnItem = typeof initialItemState;

export function StockInDialog({ isOpen, onOpenChange, onConfirm }: StockInDialogProps) {
  const { toast } = useToast();
  const params = useParams() as { project: string };
  const projectSlug = params.project;

  const [supplier, setSupplier] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<GrnItem[]>([initialItemState]);
  const [isSaving, setIsSaving] = useState(false);

  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [isLoadingItems, setIsLoadingItems] = useState(true);

  useEffect(() => {
    if (isOpen) {
        const fetchBoq = async () => {
            if (!projectSlug) return;
            setIsLoadingItems(true);
            try {
                const q = query(collection(db, 'boqItems'), where('projectSlug', '==', projectSlug));
                const boqSnapshot = await getDocs(q);
                const boqData = boqSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BoqItem));
                setBoqItems(boqData);
            } catch (error) {
                console.error("Error fetching BOQ:", error);
            }
            setIsLoadingItems(false);
        };
        fetchBoq();
    }
  }, [isOpen, projectSlug]);

  const resetForm = () => {
    setSupplier('');
    setPoNumber('');
    setInvoiceNumber('');
    setNotes('');
    setItems([initialItemState]);
  };

  const handleAddItem = () => {
    setItems([...items, { ...initialItemState }]);
  };

  const handleRemoveItem = (index: number) => {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== index));
    }
  };

  const handleItemChange = (index: number, field: keyof GrnItem, value: any) => {
    const newItems = [...items];
    (newItems[index] as any)[field] = value;
    setItems(newItems);
  };
  
   const getItemDescription = (item: BoqItem) => {
    const descriptionKeys = [
      'Description',
      'DESCRIPTION OF ITEMS',
      'DESCRIPTION OF ITEMS(SCHEDULE-VIIA-SS) SUPPLY OF FOLLOWING EQUIPMENT & MATERIALS (As per Technical Specification)'
    ];
    for (const key of descriptionKeys) {
      if (item[key]) {
        return item[key];
      }
    }
    const fallbackKey = Object.keys(item).find(k => k.toLowerCase().includes('description'));
    return fallbackKey ? item[fallbackKey] : '';
  };
  
  const handleItemSelect = (index: number, item: BoqItem | null) => {
      if(item) {
        handleItemChange(index, 'itemId', item.id);
        handleItemChange(index, 'itemName', getItemDescription(item));
        handleItemChange(index, 'itemUnit', item['UNIT'] || item['UNITS'] || '');
      } else {
        handleItemChange(index, 'itemId', '');
        handleItemChange(index, 'itemName', '');
        handleItemChange(index, 'itemUnit', '');
      }
  }

  const handleSave = async () => {
    if (!supplier || items.some(item => !item.itemId || item.quantity <= 0)) {
        toast({ title: 'Validation Error', description: 'Please fill in Supplier and all item details.', variant: 'destructive' });
        return;
    }
    setIsSaving(true);
    
    try {
        const batchId = `GRN-${Date.now()}`;
        const writePromises = items.map(item => {
            const logEntry: Omit<InventoryLog, 'id'> = {
                date: new Date(),
                itemId: item.itemId,
                itemName: item.itemName,
                itemType: 'Sub', // Assuming all BOQ items are treated as Sub-items for stock purposes
                transactionType: 'Goods Receipt',
                quantity: item.quantity,
                projectId: projectSlug,
                description: `GRN from ${supplier}. PO: ${poNumber}, Inv: ${invoiceNumber}. ${notes}`,
                cost: item.unitCost,
                batch: item.batchNo,
                details: { supplier, poNumber, invoiceNumber },
            };
            return addDoc(collection(db, 'inventoryLogs'), logEntry);
        });

        await Promise.all(writePromises);

        toast({ title: 'Success', description: 'Goods receipt recorded successfully.' });
        onConfirm();
        resetForm();
        onOpenChange(false);
    } catch (e) {
        console.error(e);
        toast({ title: 'Error', description: 'Failed to save stock-in transaction.', variant: 'destructive'});
    } finally {
        setIsSaving(false);
    }
  };
  
  const selectedSlNo = (item: GrnItem) => {
    const boqItem = boqItems.find(bi => bi.id === item.itemId);
    return boqItem ? (boqItem['Sl No'] || boqItem['SL. No.']) : null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Stock In (GRN)</DialogTitle>
          <DialogDescription>Record a new goods receipt. Add items and quantities received.</DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
            </div>
             <div className="space-y-2">
                <Label>Items</Label>
                <div className="space-y-2">
                    {items.map((item, index) => (
                        <div key={index} className="grid grid-cols-[1fr,100px,120px,120px,auto] gap-2 items-end p-2 border rounded-md">
                           <div className="space-y-1">
                             {index === 0 && <Label className="text-xs">BOQ Item</Label>}
                             <BoqItemSelector
                                boqItems={boqItems}
                                selectedSlNo={selectedSlNo(item)}
                                onSelect={(selectedItem) => handleItemSelect(index, selectedItem)}
                                isLoading={isLoadingItems}
                              />
                           </div>
                           <div className="space-y-1">
                              {index === 0 && <Label className="text-xs">Quantity</Label>}
                              <Input type="number" placeholder="1" value={item.quantity} onChange={e => handleItemChange(index, 'quantity', Number(e.target.value))}/>
                           </div>
                           <div className="space-y-1">
                               {index === 0 && <Label className="text-xs">Batch No.</Label>}
                               <Input placeholder="Batch/Lot" value={item.batchNo} onChange={e => handleItemChange(index, 'batchNo', e.target.value)} />
                            </div>
                           <div className="space-y-1">
                                {index === 0 && <Label className="text-xs">Unit Cost</Label>}
                                <Input type="number" placeholder="0" value={item.unitCost} onChange={e => handleItemChange(index, 'unitCost', Number(e.target.value))} />
                            </div>
                           <Button variant="destructive" size="icon" onClick={() => handleRemoveItem(index)}>
                                <Trash2 className="h-4 w-4"/>
                           </Button>
                        </div>
                    ))}
                </div>
                 <Button variant="outline" size="sm" onClick={handleAddItem}>
                    <Plus className="mr-2 h-4 w-4" /> Add Item
                 </Button>
            </div>
             <div className="space-y-2">
                <Label htmlFor="notes">Notes / Remarks</Label>
                <Textarea id="notes" placeholder="Add any relevant notes for this transaction..." value={notes} onChange={e => setNotes(e.target.value)} />
             </div>
        </div>
        <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button onClick={handleSave} disabled={isSaving}>
                 {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4" />}
                Save Transaction
            </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
