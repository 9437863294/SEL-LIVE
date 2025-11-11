
'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import type { Bill } from '@/lib/types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { ScrollArea } from '../ui/scroll-area';

interface ViewBillDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  bill: Bill | null;
}

export default function ViewBillDialog({ isOpen, onOpenChange, bill }: ViewBillDialogProps) {
  if (!bill) return null;
  
  const formatCurrency = (amount: string | number) => {
    const num = parseFloat(String(amount));
    if(isNaN(num)) return amount;
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(num);
  }

  const grandTotal = bill.items.reduce((sum, item) => sum + parseFloat(item.totalAmount || '0'), 0);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Bill Details: {bill.billNo}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh]">
          <div className="space-y-4 p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label>Bill No.</Label>
                <p className="font-medium">{bill.billNo}</p>
              </div>
              <div>
                <Label>Work Order No.</Label>
                <p className="font-medium">{bill.woNo}</p>
              </div>
              <div>
                <Label>Bill Date</Label>
                <p className="font-medium">{bill.billDate}</p>
              </div>
            </div>
            
            <Separator />

            <div>
              <h3 className="text-lg font-semibold mb-2">Billed Items</h3>
              <div className="border rounded-md">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>JMC No.</TableHead>
                            <TableHead>BOQ Sl.No.</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead>Unit</TableHead>
                            <TableHead>Rate</TableHead>
                            <TableHead>Billed Qty</TableHead>
                            <TableHead>Total</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {bill.items.map((item) => (
                            <TableRow key={item.jmcItemId}>
                                <TableCell>{item.jmcNo}</TableCell>
                                <TableCell>{item.boqSlNo}</TableCell>
                                <TableCell>{item.description}</TableCell>
                                <TableCell>{item.unit}</TableCell>
                                <TableCell>{formatCurrency(item.rate)}</TableCell>
                                <TableCell>{item.billedQty}</TableCell>
                                <TableCell>{formatCurrency(item.totalAmount)}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
              </div>
              <div className="flex justify-end mt-4">
                  <div className="w-full max-w-xs space-y-2">
                    <div className="flex justify-between font-bold text-lg">
                        <span>Grand Total</span>
                        <span>{formatCurrency(grandTotal)}</span>
                    </div>
                  </div>
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
