'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import type { ProformaBill } from '@/lib/types';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/table';
import { ScrollArea } from './ui/scroll-area';
import { useMemo } from 'react';
import { Printer } from 'lucide-react';

interface ViewProformaBillDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  bill: ProformaBill | null;
}

const slugify = (text: string | undefined) => {
  if (!text) return '';
  return text.toString().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
};


export default function ViewProformaBillDialog({
  isOpen,
  onOpenChange,
  bill,
}: ViewProformaBillDialogProps) {
  if (!bill) return null;
  
  const formatCurrency = (amount: string | number) => {
    const num = parseFloat(String(amount));
    if(isNaN(num)) return amount;
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(num);
  }
  
  const financials = useMemo(() => {
    const subtotal = bill.items.reduce((sum, item) => sum + parseFloat(String(item.totalAmount || '0')), 0);
    const payableAmount = bill.payableAmount || 0;
    return { subtotal, payableAmount };
  }, [bill]);

  const handlePrint = () => {
    const projectSlug = slugify(bill.projectName);
    window.open(`/billing-recon/${projectSlug}/proforma-bill/${bill.id}/print`, '_blank');
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Proforma/Advance Details: {bill.proformaNo}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh]">
          <div className="space-y-4 p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label>Proforma No.</Label>
                <p className="font-medium">{bill.proformaNo}</p>
              </div>
              <div>
                <Label>Work Order No.</Label>
                <p className="font-medium">{bill.workOrderNo}</p>
              </div>
              <div>
                <Label>Date</Label>
                <p className="font-medium">{bill.date}</p>
              </div>
               <div>
                <Label>Subcontractor</Label>
                <p className="font-medium">{bill.subcontractorName}</p>
              </div>
            </div>
            
            <Separator />

            <div>
              <h3 className="text-lg font-semibold mb-2">Items</h3>
              <div className="border rounded-md">
                <Table>
                    <TableHeader>
                        <TableRow>
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
                    <div className="flex justify-between items-center font-semibold">
                        <span>Subtotal</span>
                        <span>{formatCurrency(financials.subtotal)}</span>
                    </div>
                     <div className="flex justify-between items-center text-sm">
                        <span className="text-muted-foreground">Payable Percentage</span>
                        <span className="font-medium">{bill.payablePercentage}%</span>
                    </div>
                    <Separator />
                    <div className="flex justify-between font-bold text-lg">
                        <span>Payable Amount</span>
                        <span>{formatCurrency(financials.payableAmount)}</span>
                    </div>
                  </div>
              </div>
            </div>
          </div>
        </ScrollArea>
        <DialogFooter className="mt-4 pr-4 sm:justify-between">
            <Button variant="outline" onClick={handlePrint}>
              <Printer className="mr-2 h-4 w-4" /> Print
            </Button>
            <DialogClose asChild>
              <Button variant="outline">Close</Button>
            </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
