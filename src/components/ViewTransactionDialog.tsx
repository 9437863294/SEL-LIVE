
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
import type { InventoryLog } from '@/lib/types';
import { format } from 'date-fns';
import DocumentLink from './DocumentLink';

interface ViewTransactionDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: InventoryLog | null;
}

export default function ViewTransactionDialog({ isOpen, onOpenChange, transaction }: ViewTransactionDialogProps) {
  if (!transaction) return null;

  const details = transaction.details;
  
  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return 'N/A';
    try {
      return format(new Date(dateString), 'dd MMM, yyyy');
    } catch {
      return 'Invalid Date';
    }
  };

  const formatCurrency = (amount: number | null | undefined) => {
    if (amount === null || typeof amount === 'undefined') return 'N/A';
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>GRN Details: {details?.grnNo}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-y-auto p-4 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><Label>Type</Label><p className="font-medium">{transaction.transactionType}</p></div>
            <div><Label>Date</Label><p className="font-medium">{format(transaction.date.toDate(), 'dd MMM, yyyy HH:mm')}</p></div>
            <div><Label>Item Name</Label><p className="font-medium">{transaction.itemName}</p></div>
            <div><Label>Quantity</Label><p className="font-medium">{transaction.quantity} {transaction.unit}</p></div>
          </div>

          {details && (
            <>
              <Separator />
              <div className="space-y-4">
                <h4 className="font-semibold text-lg">GRN Details</h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                   <div><Label>GRN No.</Label><p className="font-medium">{details.grnNo}</p></div>
                   <div><Label>Supplier</Label><p className="font-medium">{details.supplier}</p></div>
                   <div><Label>P.O. Number</Label><p className="font-medium">{details.poNumber}</p></div>
                   <div><Label>P.O. Date</Label><p className="font-medium">{formatDate(details.poDate)}</p></div>
                   <div><Label>Invoice No.</Label><p className="font-medium">{details.invoiceNumber}</p></div>
                   <div><Label>Invoice Date</Label><p className="font-medium">{formatDate(details.invoiceDate)}</p></div>
                   <div><Label>Invoice Amount</Label><p className="font-medium">{formatCurrency(details.invoiceAmount)}</p></div>
                </div>
              </div>
              <Separator />
               <div className="space-y-4">
                  <h4 className="font-semibold text-lg">Transporter Details</h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                      <div><Label>Vehicle No.</Label><p className="font-medium">{details.vehicleNo || 'N/A'}</p></div>
                      <div><Label>Waybill No.</Label><p className="font-medium">{details.waybillNo || 'N/A'}</p></div>
                      <div><Label>LR No.</Label><p className="font-medium">{details.lrNo || 'N/A'}</p></div>
                      <div><Label>LR Date</Label><p className="font-medium">{formatDate(details.lrDate)}</p></div>
                  </div>
               </div>
               
               <div className="space-y-2">
                <h4 className="font-semibold text-lg">Attached Documents</h4>
                 <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Invoice(s)</Label>
                    {(details.invoiceFileUrls && details.invoiceFileUrls.length > 0) ? (
                        details.invoiceFileUrls.map((file: any, i: number) => <DocumentLink key={i} file={file} />)
                    ) : <p className="text-sm">No invoice documents attached.</p>}
                 </div>
                 <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Transporter Doc(s)</Label>
                    {(details.transporterDocUrls && details.transporterDocUrls.length > 0) ? (
                         details.transporterDocUrls.map((file: any, i: number) => <DocumentLink key={i} file={file} />)
                    ) : <p className="text-sm">No transporter documents attached.</p>}
                 </div>
               </div>
            </>
          )}

        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Close</Button></DialogClose>
      </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
