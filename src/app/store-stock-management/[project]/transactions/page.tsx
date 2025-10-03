
'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import {
  MoreHorizontal,
  PlusCircle,
  MinusCircle,
  Search,
  Columns3,
  Eye,
  File as FileIcon,
  Download,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { useParams } from 'next/navigation';
import type { InventoryLog } from '@/lib/types';
import { format } from 'date-fns';
import Link from 'next/link';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';

const allColumns = ['Cost', 'Details', 'Notes'];

function ViewTransactionDialog({ isOpen, onOpenChange, transaction }: { isOpen: boolean, onOpenChange: (open: boolean) => void, transaction: InventoryLog | null }) {
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
          <DialogTitle>Transaction Details: {transaction.itemName}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-y-auto p-4 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><Label>Type</Label><p className="font-medium">{transaction.transactionType}</p></div>
            <div><Label>Date</Label><p className="font-medium">{format(transaction.date.toDate(), 'dd MMM, yyyy HH:mm')}</p></div>
            <div><Label>Quantity</Label><p className="font-medium">{transaction.quantity}</p></div>
            <div><Label>Unit</Label><p className="font-medium">{transaction.unit}</p></div>
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

const DocumentLink = ({ file }: { file: { name: string, url: string }}) => (
    <a href={file.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-primary hover:underline">
        <FileIcon className="h-4 w-4" />
        {file.name}
    </a>
);


export default function TransactionsPage() {
  const params = useParams();
  const projectSlug = params.project as string;
  const [transactions, setTransactions] = useState<InventoryLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Filter and visibility state
  const [searchTerm, setSearchTerm] = useState('');
  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >({
    Cost: true,
    Details: true,
    Notes: true,
  });

  const [selectedTransaction, setSelectedTransaction] = useState<InventoryLog | null>(null);
  const [isViewOpen, setIsViewOpen] = useState(false);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const q = query(
        collection(db, 'inventoryLogs'),
        where('projectId', '==', projectSlug)
      );
      const [transactionsSnap] = await Promise.all([getDocs(q)]);

      const data = transactionsSnap.docs.map(
        (doc) => ({ ...doc.data(), id: doc.id } as InventoryLog)
      );
      data.sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );
      setTransactions(data);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [projectSlug]);
  
  const handleViewDetails = (transaction: InventoryLog) => {
    setSelectedTransaction(transaction);
    setIsViewOpen(true);
  };

  const filteredTransactions = useMemo(() => {
    return transactions.filter(
      (t) =>
        t.itemName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (t.batch || '').toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [transactions, searchTerm]);

  const getBadgeVariant = (type: string) => {
    switch (type) {
      case 'Goods Receipt':
      case 'Return':
        return 'default';
      case 'Goods Issue':
        return 'destructive';
      case 'Conversion':
      case 'Transfer':
      case 'Adjustment':
      default:
        return 'secondary';
    }
  };

  return (
    <>
      <div>
        <h1 className="text-3xl font-bold mb-6">Transactions</h1>
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <CardTitle>Movement History</CardTitle>
                <CardDescription>
                  A complete log of all stock movements and transactions.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Link href={`/store-stock-management/${projectSlug}/transactions/stock-in`}>
                    <Button variant="outline">
                        <PlusCircle className="mr-2 h-4 w-4" /> Stock In
                    </Button>
                </Link>
                <Button variant="outline">
                  <MinusCircle className="mr-2 h-4 w-4" /> Stock Out
                </Button>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2">
              <div className="relative flex-grow">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Filter by Item Name or Batch..."
                  className="pl-8"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">
                    <Columns3 className="mr-2 h-4 w-4" />
                    Columns
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Toggle Columns</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {allColumns.map((col) => (
                    <DropdownMenuCheckboxItem
                      key={col}
                      checked={columnVisibility[col]}
                      onCheckedChange={(checked) =>
                        setColumnVisibility((prev) => ({
                          ...prev,
                          [col]: !!checked,
                        }))
                      }
                    >
                      {col}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Item Name</TableHead>
                  <TableHead>Quantity</TableHead>
                  {columnVisibility['Cost'] && <TableHead>Cost</TableHead>}
                  {columnVisibility['Details'] && (
                    <TableHead>Details</TableHead>
                  )}
                  {columnVisibility['Notes'] && <TableHead>Notes</TableHead>}
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={8}>
                        <Skeleton className="h-6 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : filteredTransactions.length > 0 ? (
                  filteredTransactions.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="text-sm">
                        {t.date
                          ? format(
                              t.date instanceof Date ? t.date : t.date.toDate(),
                              'dd/MM/yyyy HH:mm'
                            )
                          : 'N/A'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={getBadgeVariant(t.transactionType)}>
                          {t.transactionType}
                        </Badge>
                      </TableCell>
                      <TableCell>{t.itemName}</TableCell>
                      <TableCell
                        className={cn(
                          'font-semibold',
                          t.quantity > 0 ? 'text-green-600' : 'text-red-600'
                        )}
                      >
                        {t.quantity > 0 ? `+${t.quantity}` : t.quantity}
                      </TableCell>
                      {columnVisibility['Cost'] && (
                        <TableCell>
                          {t.cost ? `$${t.cost.toFixed(2)}` : ''}
                        </TableCell>
                      )}
                      {columnVisibility['Details'] && (
                        <TableCell className="text-xs whitespace-pre-wrap">
                          {t.description}
                        </TableCell>
                      )}
                      {columnVisibility['Notes'] && (
                        <TableCell>{t.notes}</TableCell>
                      )}
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => handleViewDetails(t)}>
                                <Eye className="mr-2 h-4 w-4"/>
                                View Details
                            </DropdownMenuItem>
                            <DropdownMenuItem>Edit</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center h-24">
                      No transactions found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
      <ViewTransactionDialog 
        isOpen={isViewOpen}
        onOpenChange={setIsViewOpen}
        transaction={selectedTransaction}
      />
    </>
  );
}
