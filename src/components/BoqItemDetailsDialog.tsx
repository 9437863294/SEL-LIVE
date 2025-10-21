
'use client';

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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { ScrollArea } from './ui/scroll-area';
import { format } from 'date-fns';

interface BoqItemDetailsDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  item: BoqItem | null;
  jmcEntries: JmcEntry[];
  bills: Bill[];
  isPanel?: boolean; // New prop
}

export default function BoqItemDetailsDialog({ 
    isOpen, 
    onOpenChange, 
    item,
    jmcEntries,
    bills,
    isPanel = false,
}: BoqItemDetailsDialogProps) {
  if (!item) return null;

  const boqSlNo = item['SL. No.'] || item['BOQ SL No'];

  const relevantJmcItems = jmcEntries
    .flatMap(entry => 
      entry.items
        .filter(jmcItem => jmcItem.boqSlNo === boqSlNo)
        .map(jmcItem => ({ ...jmcItem, jmcNo: entry.jmcNo, jmcDate: entry.jmcDate }))
    );

  const relevantBillItems = bills
    .flatMap(bill => 
      bill.items
        .filter(billItem => billItem.boqSlNo === boqSlNo)
        .map(billItem => ({ ...billItem, billNo: bill.billNo, billDate: bill.billDate }))
    );
    
  const formatCurrency = (amount: string | number) => {
    const num = parseFloat(String(amount));
    if(isNaN(num)) return amount;
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(num);
  }

  const content = (
    <>
      <div className={isPanel ? "p-4" : ""}>
        {isPanel ? (
          <div>
            <h3 className="text-lg font-semibold">Item Breakdown: Sl. No. {boqSlNo}</h3>
            <p className="text-sm text-muted-foreground">{item['Description'] || item['Item Spec']}</p>
          </div>
        ) : (
          <DialogHeader>
            <DialogTitle>Item Breakdown: Sl. No. {boqSlNo}</DialogTitle>
            <DialogDescription>
              {item['Description'] || item['Item Spec']}
            </DialogDescription>
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
                              <TableCell>{item['Total Qty'] || item['qty'] || 0}</TableCell>
                              <TableCell>{item['JMC Executed Qty'] || 0}</TableCell>
                              <TableCell>{item['Billed Qty'] || 0}</TableCell>
                              <TableCell>{(item['Total Qty'] || item['qty'] || 0) - (item['JMC Executed Qty'] || 0)}</TableCell>
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
                      </TableRow>
                  </TableHeader>
                  <TableBody>
                      {relevantJmcItems.length > 0 ? (
                          relevantJmcItems.map((jmcItem, index) => (
                            <TableRow key={index}>
                              <TableCell>{jmcItem.jmcNo}</TableCell>
                              <TableCell>{format(new Date(jmcItem.jmcDate), 'dd MMM, yyyy')}</TableCell>
                              <TableCell>{jmcItem.executedQty}</TableCell>
                            </TableRow>
                          ))
                      ) : (
                          <TableRow>
                            <TableCell colSpan={3} className="text-center h-24">
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
                            <TableRow key={index}>
                              <TableCell>{billItem.billNo}</TableCell>
                              <TableCell>{format(new Date(billItem.billDate), 'dd MMM, yyyy')}</TableCell>
                              <TableCell>{billItem.billedQty}</TableCell>
                              <TableCell>{formatCurrency(billItem.totalAmount)}</TableCell>
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
    </>
  );

  if (isPanel) {
    return content;
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <ScrollArea className="max-h-[70vh] p-1">
            {content}
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
