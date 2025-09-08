
'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import type { JmcEntry } from '@/lib/types';
import { format } from 'date-fns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { ScrollArea } from './ui/scroll-area';

interface ViewJmcEntryDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  jmcEntry: JmcEntry | null;
}

export default function ViewJmcEntryDialog({ isOpen, onOpenChange, jmcEntry }: ViewJmcEntryDialogProps) {
  if (!jmcEntry) return null;
  
  const formatCurrency = (amount: string) => {
    const num = parseFloat(amount);
    if(isNaN(num)) return amount;
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(num);
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
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
                            <TableHead>Rate</TableHead>
                            <TableHead>Executed Qty</TableHead>
                            <TableHead>Total Amount</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {jmcEntry.items.map((item, index) => (
                            <TableRow key={index}>
                                <TableCell>{item.boqSlNo}</TableCell>
                                <TableCell>{item.description}</TableCell>
                                <TableCell>{item.unit}</TableCell>
                                <TableCell>{formatCurrency(item.rate)}</TableCell>
                                <TableCell>{item.executedQty}</TableCell>
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
