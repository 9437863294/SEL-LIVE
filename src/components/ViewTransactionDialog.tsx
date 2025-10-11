
'use client';

import { useState, useEffect } from 'react';
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
import type { InventoryLog, EnrichedLogItem } from '@/lib/types';
import { format } from 'date-fns';
import DocumentLink from './DocumentLink';
import type { TransactionSummary } from '@/app/store-stock-management/[project]/transactions/page';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Loader2 } from 'lucide-react';

interface ViewTransactionDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  transactionSummary: TransactionSummary | null;
}

export default function ViewTransactionDialog({ isOpen, onOpenChange, transactionSummary: initialSummary }: ViewTransactionDialogProps) {
  const [summary, setSummary] = useState<TransactionSummary | null>(initialSummary);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const fetchLatestData = async () => {
      if (!initialSummary || !initialSummary.id) return;
      
      setIsLoading(true);
      try {
        let items: EnrichedLogItem[] = [];
        if (initialSummary.transactionType === 'Goods Receipt') {
            const grnQuery = query(collection(db, 'inventoryLogs'), where('details.grnNo', '==', initialSummary.id));
            const grnSnapshot = await getDocs(grnQuery);
            const grnItems = grnSnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as InventoryLog));
            
            if (grnItems.length === 0) {
              setSummary(null); // GRN might have been deleted
              return;
            }

            const issueQuery = query(collection(db, 'inventoryLogs'), where('details.sourceGrn', '==', initialSummary.id));
            const issueSnapshot = await getDocs(issueQuery);
            const issues = issueSnapshot.docs.map(doc => doc.data() as InventoryLog);
            
            items = grnItems.map(grnItem => {
                const issuedQty = issues
                    .filter(issue => issue.itemId === grnItem.itemId)
                    .reduce((sum, issue) => sum + issue.quantity, 0);
                const balanceQty = grnItem.availableQuantity;
                return {
                    ...grnItem,
                    originalQuantity: grnItem.quantity,
                    issuedQuantity: issuedQty,
                    balanceQuantity: balanceQty,
                };
            });
        } else { // Goods Issue
           const issueQuery = query(collection(db, 'inventoryLogs'), where('details.issuedTo', '==', initialSummary.details?.issuedTo), where('date', '==', initialSummary.date));
           const issueSnapshot = await getDocs(issueQuery);
           const issueItems = issueSnapshot.docs.map(doc => ({...doc.data(), id: doc.id} as InventoryLog));
           
           items = issueItems.map(item => ({
               ...item,
               originalQuantity: 0,
               issuedQuantity: item.quantity,
               balanceQuantity: 0,
           }));
        }

        const totalAmount = items.reduce((sum, item) => sum + (item.quantity || 0) * (item.cost || 0), 0);
        const remainingValue = initialSummary.transactionType === 'Goods Receipt'
          ? items.reduce((sum, item) => sum + ((item.balanceQuantity || 0) * (item.cost || 0)), 0)
          : 0;
          
        setSummary({
          ...initialSummary,
          items,
          totalAmount,
          remainingValue,
          details: items[0]?.details || initialSummary.details, // Use details from the first fetched item
        });
      } catch (error) {
        console.error("Failed to fetch latest transaction details", error);
      } finally {
        setIsLoading(false);
      }
    };

    if (isOpen) {
      fetchLatestData();
    } else {
        // Reset state when dialog is closed to avoid showing stale data briefly on next open
        setSummary(null);
    }
  }, [isOpen, initialSummary]);

  if (!summary && !isLoading) return null;
  
  const formatDate = (date: string | Date | null | undefined) => {
    if (!date) return 'N/A';
    try {
      const d = typeof date === 'string' ? new Date(date) : date;
      return format(d, 'dd MMM, yyyy');
    } catch {
      return 'Invalid Date';
    }
  };

  const formatCurrency = (amount: number | null | undefined) => {
    if (amount === null || typeof amount === 'undefined') return 'N/A';
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  };
  
  const isGrn = summary?.transactionType === 'Goods Receipt';

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Transaction Details: {summary?.id}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
            <div className="h-96 flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin" />
            </div>
        ) : !summary ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground">
                Could not load transaction details. It may have been deleted.
            </div>
        ) : (
          <div className="max-h-[70vh] overflow-y-auto p-4 space-y-4">
            {summary.details && isGrn && (
              <>
                <div className="space-y-4">
                  <h4 className="font-semibold text-lg">GRN Details</h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                     <div><Label>GRN No.</Label><p className="font-medium">{summary.details.grnNo}</p></div>
                     <div><Label>Supplier</Label><p className="font-medium">{summary.details.supplier}</p></div>
                     <div><Label>P.O. Number</Label><p className="font-medium">{summary.details.poNumber}</p></div>
                     <div><Label>P.O. Date</Label><p className="font-medium">{formatDate(summary.details.poDate)}</p></div>
                     <div><Label>Invoice No.</Label><p className="font-medium">{summary.details.invoiceNumber}</p></div>
                     <div><Label>Invoice Date</Label><p className="font-medium">{formatDate(summary.details.invoiceDate)}</p></div>
                     <div><Label>Invoice Amount</Label><p className="font-medium">{formatCurrency(summary.details.invoiceAmount)}</p></div>
                  </div>
                </div>
                <Separator />
                 <div className="space-y-4">
                    <h4 className="font-semibold text-lg">Transporter Details</h4>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                        <div><Label>Vehicle No.</Label><p className="font-medium">{summary.details.vehicleNo || 'N/A'}</p></div>
                        <div><Label>Waybill No.</Label><p className="font-medium">{summary.details.waybillNo || 'N/A'}</p></div>
                        <div><Label>LR No.</Label><p className="font-medium">{summary.details.lrNo || 'N/A'}</p></div>
                        <div><Label>LR Date</Label><p className="font-medium">{formatDate(summary.details.lrDate)}</p></div>
                    </div>
                 </div>
                 
                 <div className="space-y-2">
                  <h4 className="font-semibold text-lg">Attached Documents</h4>
                   <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Invoice(s)</Label>
                      {(summary.details.invoiceFileUrls && summary.details.invoiceFileUrls.length > 0) ? (
                          summary.details.invoiceFileUrls.map((file: any, i: number) => <DocumentLink key={i} file={file} />)
                      ) : <p className="text-sm">No invoice documents attached.</p>}
                   </div>
                   <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Transporter Doc(s)</Label>
                      {(summary.details.transporterDocUrls && summary.details.transporterDocUrls.length > 0) ? (
                           summary.details.transporterDocUrls.map((file: any, i: number) => <DocumentLink key={i} file={file} />)
                      ) : <p className="text-sm">No transporter documents attached.</p>}
                   </div>
                 </div>
                <Separator />
              </>
            )}

            {!isGrn && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                <div><Label>Issued To</Label><p className="font-medium">{summary.details?.issuedTo || 'N/A'}</p></div>
                <div><Label>Notes</Label><p className="font-medium">{summary.details?.notes || 'N/A'}</p></div>
              </div>
            )}

            <div className="space-y-4">
              <h4 className="font-semibold text-lg">{isGrn ? 'Items Received' : 'Items Issued'}</h4>
              <div className="border rounded-md">
                 <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item Name</TableHead>
                      <TableHead>Qty</TableHead>
                      <TableHead>Unit Cost</TableHead>
                      <TableHead>Total Cost</TableHead>
                      {isGrn && <TableHead>Issued Qty</TableHead>}
                      {isGrn && <TableHead>Balance Qty</TableHead>}
                      {isGrn && <TableHead className="text-right">Remaining Value</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.items.map(item => (
                      <TableRow key={item.id}>
                        <TableCell>{item.itemName}</TableCell>
                        <TableCell>{item.quantity} {item.unit}</TableCell>
                        <TableCell>{formatCurrency(item.cost)}</TableCell>
                        <TableCell>{formatCurrency((item.quantity || 0) * (item.cost || 0))}</TableCell>
                        {isGrn && <TableCell className="text-destructive">{item.issuedQuantity}</TableCell>}
                        {isGrn && <TableCell className="font-semibold">{item.balanceQuantity}</TableCell>}
                        {isGrn && (
                            <TableCell className="text-right font-bold">
                                {formatCurrency((item.balanceQuantity || 0) * (item.cost || 0))}
                            </TableCell>
                        )}
                      </TableRow>
                    ))}
                     <TableRow className="font-bold bg-muted">
                        <TableCell colSpan={isGrn ? 3 : 3} className="text-right">Total</TableCell>
                        <TableCell colSpan={isGrn ? 1 : 4} className="text-right">{formatCurrency(summary.totalAmount)}</TableCell>
                        {isGrn && <TableCell colSpan={2}></TableCell>}
                        {isGrn && (
                          <TableCell className="text-right">{formatCurrency(summary.remainingValue)}</TableCell>
                        )}
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Close</Button></DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
