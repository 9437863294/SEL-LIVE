
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
import type { GrnSummary } from '@/app/store-stock-management/[project]/transactions/page';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

interface ViewTransactionDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  grnSummary: GrnSummary | null;
}

export default function ViewTransactionDialog({ isOpen, onOpenChange, grnSummary }: ViewTransactionDialogProps) {
  if (!grnSummary) return null;

  const details = grnSummary.details;
  
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
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>GRN Details: {details?.grnNo}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-y-auto p-4 space-y-4">
          
          {details && (
            <>
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
              <Separator />
            </>
          )}

          <div className="space-y-4">
            <h4 className="font-semibold text-lg">Items Received</h4>
            <div className="border rounded-md">
               <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item Name</TableHead>
                    <TableHead>BOQ Sl. No</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Unit Cost</TableHead>
                    <TableHead className="text-right">Total Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {grnSummary.items.map(item => (
                    <TableRow key={item.id}>
                      <TableCell>{item.itemName}</TableCell>
                      <TableCell>{item.details?.boqSlNo || 'N/A'}</TableCell>
                      <TableCell>{item.quantity} {item.unit}</TableCell>
                      <TableCell>{formatCurrency(item.cost)}</TableCell>
                      <TableCell className="text-right">{formatCurrency((item.quantity || 0) * (item.cost || 0))}</TableCell>
                    </TableRow>
                  ))}
                   <TableRow className="font-bold bg-muted">
                      <TableCell colSpan={4} className="text-right">GRN Total</TableCell>
                      <TableCell className="text-right">{formatCurrency(grnSummary.grnAmount)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Close</Button></DialogClose>
      </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
