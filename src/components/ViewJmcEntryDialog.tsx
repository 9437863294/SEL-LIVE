
'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import type { JmcEntry, BoqItem, Bill, JmcItem } from '@/lib/types';
import { format } from 'date-fns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { ScrollArea } from './ui/scroll-area';
import { useMemo, useState, useEffect } from 'react';
import { Input } from './ui/input';
import { Loader2, Save } from 'lucide-react';

interface ViewJmcEntryDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  jmcEntry: JmcEntry | null;
  boqItems: BoqItem[];
  bills: Bill[];
  isEditMode?: boolean;
  onVerify?: (taskId: string, action: string, comment: string, updatedItems: JmcItem[]) => Promise<void>;
  isLoading?: boolean;
}

export default function ViewJmcEntryDialog({ isOpen, onOpenChange, jmcEntry, boqItems, bills, isEditMode = false, onVerify, isLoading }: ViewJmcEntryDialogProps) {
  const [editableItems, setEditableItems] = useState<JmcItem[]>([]);

  useEffect(() => {
    if (jmcEntry) {
      setEditableItems(JSON.parse(JSON.stringify(jmcEntry.items))); // Deep copy
    }
  }, [jmcEntry]);

  const enrichedItems = useMemo(() => {
    if (!jmcEntry) return []; // Guard against null jmcEntry
    const itemsToDisplay = isEditMode ? editableItems : jmcEntry.items;
    if (!itemsToDisplay || !Array.isArray(boqItems)) return [];

    return itemsToDisplay.map(item => {
      const boqItem = boqItems.find(b => b['BOQ SL No'] === item.boqSlNo || b['SL. No.'] === item.boqSlNo);
      const boqQty = boqItem ? Number(boqItem.QTY || boqItem['Total Qty'] || 0) : 0;
      
      const totalCertifiedQty = jmcEntry.items
        .filter(i => i.boqSlNo === item.boqSlNo)
        .reduce((sum, i) => sum + (i.certifiedQty || 0), 0);

      return {
        ...item,
        boqQty,
        totalCertifiedQty,
      };
    });
  }, [jmcEntry, boqItems, isEditMode, editableItems]);

  // Early return must be after all hook calls.
  if (!jmcEntry) return null;
  
  const formatCurrency = (amount: number | string) => {
    const num = parseFloat(String(amount));
    if(isNaN(num)) return String(amount);
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(num);
  }
  
  const handleItemChange = (index: number, field: 'executedQty' | 'certifiedQty', value: string) => {
    const newItems = [...editableItems];
    const numValue = parseFloat(value);
    
    if (!isNaN(numValue)) {
      (newItems[index] as any)[field] = numValue;
      const rate = Number(newItems[index].rate) || 0;
      const executedQty = Number(newItems[index].executedQty) || 0;
      newItems[index].totalAmount = executedQty * rate;
      setEditableItems(newItems);
    }
  };
  
  const handleSaveAndVerify = () => {
      if (onVerify && jmcEntry) {
          onVerify(jmcEntry.id, 'Verified', 'Verified with edits', editableItems);
      }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{isEditMode ? 'Verify & Edit' : 'JMC Details'}: {jmcEntry.jmcNo}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh]">
          <div className="space-y-4 p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label>JMC No.</Label>
                <p className="font-medium">{jmcEntry.jmcNo}</p>
              </div>
              <div>
                <Label>Work Order No.</Label>
                <p className="font-medium">{jmcEntry.woNo}</p>
              </div>
              <div>
                <Label>JMC Date</Label>
                <p className="font-medium">{format(new Date(jmcEntry.jmcDate), 'dd MMM, yyyy')}</p>
              </div>
            </div>
            
            <Separator />

            <div>
              <h3 className="text-lg font-semibold mb-2">Items</h3>
              <div className="border rounded-md">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>BOQ Sl. No.</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead>Unit</TableHead>
                            <TableHead>Rate</TableHead>
                            <TableHead>Executed Qty</TableHead>
                            <TableHead>Certified Qty</TableHead>
                            <TableHead>Total Amount</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {enrichedItems.map((item, index) => (
                            <TableRow key={index}>
                                <TableCell>{item.boqSlNo}</TableCell>
                                <TableCell>{item.description}</TableCell>
                                <TableCell>{item.unit}</TableCell>
                                <TableCell>{formatCurrency(item.rate)}</TableCell>
                                <TableCell>
                                  {isEditMode ? <Input type="number" value={item.executedQty} onChange={(e) => handleItemChange(index, 'executedQty', e.target.value)} /> : item.executedQty}
                                </TableCell>
                                <TableCell>
                                   {isEditMode ? <Input type="number" value={item.certifiedQty ?? ''} onChange={(e) => handleItemChange(index, 'certifiedQty', e.target.value)} /> : (item.certifiedQty ?? 'N/A')}
                                </TableCell>
                                <TableCell>{formatCurrency(item.totalAmount)}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
              </div>
            </div>
          </div>
        </ScrollArea>
        <DialogFooter className="mt-4 pr-4">
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
           {isEditMode && (
              <Button onClick={handleSaveAndVerify} disabled={isLoading}>
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4"/>}
                Save & Verify
              </Button>
            )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
