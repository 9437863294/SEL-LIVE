
'use client';

import { useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import type { BoqItem, JmcEntry, Bill } from '@/lib/types';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/table';
import { ScrollArea } from './ui/scroll-area';
import { format } from 'date-fns';
import ViewJmcEntryDialog from './ViewJmcEntryDialog';
import { Eye } from 'lucide-react';

interface BoqItemDetailsDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  item: BoqItem | null;
  jmcEntries: JmcEntry[];
  bills: Bill[];
  isPanel?: boolean; // New prop
}

const formatCurrency = (amount: string | number) => {
  const num = parseFloat(String(amount));
  if (isNaN(num)) return String(amount);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
  }).format(num);
};

export default function BoqItemDetailsDialog({
  isOpen,
  onOpenChange,
  item,
  jmcEntries,
  bills,
  isPanel = false,
}: BoqItemDetailsDialogProps) {
  const [selectedJmc, setSelectedJmc] = useState<JmcEntry | null>(null);
  const [isJmcViewOpen, setIsJmcViewOpen] = useState(false);

  const handleViewJmc = (jmcNo: string) => {
    const jmc = jmcEntries.find(entry => entry.jmcNo === jmcNo);
    if (jmc) {
      setSelectedJmc(jmc);
      setIsJmcViewOpen(true);
    }
  };

  const data = useMemo(() => {
    if (!item) return null;

    const boqSlNo = String(item['SL. No.'] || item['BOQ SL No'] || '').trim();
    
    if (boqSlNo === '') return null; 

    const description = item['Description'] || item['Item Spec'];
    const boqQty = Number(item['Total Qty'] || item['qty'] || item['QTY'] || 0);

    const relevantJmcItems = jmcEntries
      .flatMap((entry) =>
        entry.items
          .filter((jmcItem) => {
            const jmcSlNo = String(jmcItem.boqSlNo || '').trim();
            return jmcSlNo === boqSlNo;
          })
          .map((jmcItem) => ({
            ...jmcItem,
            jmcNo: entry.jmcNo,
            jmcDate: entry.jmcDate,
          })),
      );

    const totalExecutedQty = relevantJmcItems.reduce(
      (sum, jmcItem) => sum + Number(jmcItem.executedQty || 0),
      0,
    );

    const relevantBillItems = bills
      .flatMap((bill) =>
        bill.items
          .filter((billItem) => {
            const billSlNo = String(billItem.boqSlNo || '').trim();
            return billSlNo === boqSlNo;
          })
          .map((billItem) => ({
            ...billItem,
            billNo: bill.billNo,
            billDate: bill.billDate,
          })),
      );

    const totalBilledQty = relevantBillItems.reduce(
      (sum, billItem) => sum + Number(billItem.billedQty || 0),
      0,
    );
    
    return {
      boqSlNo,
      description,
      boqQty,
      relevantJmcItems,
      totalExecutedQty,
      relevantBillItems,
      totalBilledQty,
    };
  }, [item, jmcEntries, bills]); 

  const formatDateSafe = (dateInput: any) => {
    if (!dateInput) return 'N/A';
    try {
      if (typeof dateInput.toDate === 'function') {
        return format(dateInput.toDate(), 'dd MMM, yyyy');
      }
      const date = new Date(dateInput);
      if (isNaN(date.getTime())) return 'Invalid Date';
      return format(date, 'dd MMM, yyyy');
    } catch (error) {
      console.warn('Could not format date:', dateInput, error);
      return 'Invalid Date';
    }
  };

  if (!item || !data) return null;

  const {
    boqSlNo,
    description,
    boqQty,
    relevantJmcItems,
    totalExecutedQty,
    relevantBillItems,
    totalBilledQty,
  } = data;
  
  const content = (
    <>
      <div className={isPanel ? 'p-4' : ''}>
        {isPanel ? (
          <div>
            <h3 className="text-lg font-semibold">
              Item Breakdown: Sl. No. {boqSlNo}
            </h3>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
        ) : (
          <DialogHeader>
            <DialogTitle>Item Breakdown: Sl. No. {boqSlNo}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
        )}
        <div className="space-y-6 mt-4">
          <div>
            <h3 className="text-lg font-semibold mb-2">Quantity Summary</h3>
            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>BOQ Quantity</TableHead>
                    <TableHead>JMC Executed Qty</TableHead>
                    <TableHead>Billed Qty</TableHead>
                    <TableHead>Balance Qty</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>{boqQty}</TableCell>
                    <TableCell>{totalExecutedQty}</TableCell>
                    <TableCell>{totalBilledQty}</TableCell>
                    <TableCell>{boqQty - totalExecutedQty}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </div>

          <Separator />

          <div>
            <h3 className="text-lg font-semibold mb-2">JMC Breakdown</h3>
            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>JMC No.</TableHead>
                    <TableHead>JMC Date</TableHead>
                    <TableHead>Executed Qty</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {relevantJmcItems.length > 0 ? (
                    relevantJmcItems.map((jmcItem, index) => (
                      <TableRow key={`jmc-${jmcItem.jmcNo}-${index}`}>
                        <TableCell>{jmcItem.jmcNo}</TableCell>
                        <TableCell>
                          {formatDateSafe(jmcItem.jmcDate)}
                        </TableCell>
                        <TableCell>{jmcItem.executedQty}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" onClick={() => handleViewJmc(jmcItem.jmcNo)}>
                            <Eye className="mr-2 h-4 w-4" /> View
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center h-24">
                        No JMC entries found for this item.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          <Separator />

          <div>
            <h3 className="text-lg font-semibold mb-2">Billing Breakdown</h3>
            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Bill No.</TableHead>
                    <TableHead>Bill Date</TableHead>
                    <TableHead>Billed Qty</TableHead>
                    <TableHead>Total Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {relevantBillItems.length > 0 ? (
                    relevantBillItems.map((billItem, index) => (
                      <TableRow key={`bill-${billItem.billNo}-${index}`}>
                        <TableCell>{billItem.billNo}</TableCell>
                        <TableCell>
                          {formatDateSafe(billItem.billDate)}
                        </TableCell>
                        <TableCell>{billItem.billedQty}</TableCell>
                        <TableCell>
                          {formatCurrency(billItem.totalAmount)}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center h-24">
                        No bills found for this item.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      </div>
      <ViewJmcEntryDialog
        isOpen={isJmcViewOpen}
        onOpenChange={setIsJmcViewOpen}
        jmcEntry={selectedJmc}
        boqItems={[]} 
        bills={[]}
      />
    </>
  );

  if (isPanel) {
    return <>{content}</>;
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <ScrollArea className="max-h-[70vh] p-1">{content}</ScrollArea>
        <DialogFooter className="mt-4 pr-4">
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
