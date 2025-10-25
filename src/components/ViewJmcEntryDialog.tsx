
'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import type { JmcEntry, BoqItem, Bill, JmcItem, ActionConfig } from '@/lib/types';
import { format } from 'date-fns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { ScrollArea } from './ui/scroll-area';
import { useMemo, useState, useEffect } from 'react';
import { Input } from './ui/input';
import { Loader2, Save } from 'lucide-react';
import ViewJmcEntryDialog from './ViewJmcEntryDialog';
import { Eye } from 'lucide-react';

type EnrichedJmcItem = JmcItem & {
  boqQty: number;
  previousCertifiedQty: number;
};

interface ViewJmcEntryDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  jmcEntry: JmcEntry | null;
  boqItems: BoqItem[];
  bills: Bill[];
  isEditMode?: boolean;
  onVerify?: (
    taskId: string,
    action: string | ActionConfig,
    comment: string,
    updatedItems: JmcItem[]
  ) => Promise<void>;
  isLoading?: boolean;
}

export default function ViewJmcEntryDialog({
  isOpen,
  onOpenChange,
  jmcEntry,
  boqItems,
  bills,
  isEditMode = false,
  onVerify,
  isLoading,
}: ViewJmcEntryDialogProps) {
  const [editableItems, setEditableItems] = useState<JmcItem[]>([]);

  useEffect(() => {
    if (jmcEntry?.items) {
      // Deep copy to avoid mutating parent state
      setEditableItems(JSON.parse(JSON.stringify(jmcEntry.items)) as JmcItem[]);
    } else {
      setEditableItems([]);
    }
  }, [jmcEntry, isOpen]);

  const enrichedItems: EnrichedJmcItem[] = useMemo(() => {
    if (!jmcEntry || !Array.isArray(boqItems)) return [];

    const itemsToDisplay = isEditMode ? editableItems : jmcEntry.items;
    
    return itemsToDisplay.map((item) => {
        const boqItem = boqItems.find(b => 
            String((b as any)['BOQ SL No'] || (b as any)['SL. No.'] || '').trim() === String(item.boqSlNo || '').trim()
        );
        const boqQty = boqItem ? Number((boqItem as any).QTY ?? (boqItem as any)['Total Qty'] ?? 0) : 0;
        
        // This is a placeholder for the logic to calculate previous certified quantity
        const previousCertifiedQty = 0; 

        return {
            ...item,
            boqQty,
            previousCertifiedQty,
        };
    });
}, [jmcEntry, boqItems, isEditMode, editableItems]);


  const formatCurrency = (amount: number | string) => {
    const num = Number(amount);
    if (Number.isNaN(num)) return String(amount);
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(num);
  };
  
  const handleItemChange = (
    index: number,
    field: 'executedQty' | 'certifiedQty',
    value: string
  ) => {
    setEditableItems((prev) => {
      const next = [...prev];
      const numValue = Number(value);
      if (!Number.isNaN(numValue)) {
        const item = { ...next[index] };
        (item as any)[field] = numValue;
        const rate = Number(item.rate) || 0;
        const executedQty = Number(item.executedQty) || 0;
        item.totalAmount = executedQty * rate;
        next[index] = item;
      }
      return next;
    });
  };
  
  const handleSaveAndVerify = () => {
    if (onVerify && jmcEntry) {
      onVerify(jmcEntry.id, 'Verified', 'Verified with edits', editableItems);
    }
  };

  if (!jmcEntry) return null;

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
                <p className="font-medium">
                  {jmcEntry.jmcDate ? format(new Date(jmcEntry.jmcDate), 'dd MMM, yyyy') : '—'}
                </p>
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
                      <TableHead>BOQ Qty</TableHead>
                      <TableHead>Rate</TableHead>
                      <TableHead>Prev. Certified</TableHead>
                      <TableHead>Executed Qty</TableHead>
                      <TableHead>Certified Qty</TableHead>
                      <TableHead>Total Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {enrichedItems.map((item, index) => (
                      <TableRow key={`${item.boqSlNo}-${index}`}>
                        <TableCell>{item.boqSlNo}</TableCell>
                        <TableCell>{item.description}</TableCell>
                        <TableCell>{item.unit}</TableCell>
                        <TableCell>{item.boqQty}</TableCell>
                        <TableCell>{formatCurrency(item.rate)}</TableCell>
                        <TableCell>{item.previousCertifiedQty}</TableCell>
                        <TableCell>
                          {isEditMode ? (
                            <Input
                              type="number"
                              inputMode="decimal"
                              value={item.executedQty}
                              onChange={(e) => handleItemChange(index, 'executedQty', e.target.value)}
                            />
                          ) : (
                            item.executedQty
                          )}
                        </TableCell>
                        <TableCell>
                           {isEditMode ? (
                            <Input
                              type="number"
                              inputMode="decimal"
                              value={item.certifiedQty}
                              onChange={(e) => handleItemChange(index, 'certifiedQty', e.target.value)}
                            />
                          ) : (
                            item.certifiedQty ?? 'N/A'
                          )}
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
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save &amp; Verify
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
