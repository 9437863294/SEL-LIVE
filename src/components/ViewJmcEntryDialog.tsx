
'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import type { JmcEntry, BoqItem, Bill } from '@/lib/types';
import { format } from 'date-fns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { ScrollArea } from './ui/scroll-area';
import { useMemo } from 'react';

interface ViewJmcEntryDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  jmcEntry: JmcEntry | null;
  boqItems: BoqItem[];
  bills: Bill[];
}

export default function ViewJmcEntryDialog({ isOpen, onOpenChange, jmcEntry, boqItems, bills }: ViewJmcEntryDialogProps) {
  if (!jmcEntry) return null;
  
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  }

  const enrichedItems = useMemo(() => {
    return jmcEntry.items.map(item => {
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
  }, [jmcEntry.items, boqItems, jmcEntry.id]);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>JMC Details: {jmcEntry.jmcNo}</DialogTitle>
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
                            <TableHead>BOQ Qty</TableHead>
                            <TableHead>Rate</TableHead>
                            <TableHead>Total Certified Qty</TableHead>
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
                                <TableCell>{item.boqQty}</TableCell>
                                <TableCell>{formatCurrency(item.rate)}</TableCell>
                                <TableCell>{item.totalCertifiedQty}</TableCell>
                                <TableCell>{item.executedQty}</TableCell>
                                <TableCell>{item.certifiedQty ?? 'N/A'}</TableCell>
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
