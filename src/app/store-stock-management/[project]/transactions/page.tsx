
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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { useParams } from 'next/navigation';
import type { InventoryLog } from '@/lib/types';
import { format } from 'date-fns';
import Link from 'next/link';
import ViewTransactionDialog from '@/components/ViewTransactionDialog';


const allColumns = ['Cost', 'Details', 'Notes'];

interface GrnSummary {
    grnNo: string;
    date: Date;
    transactionType: string;
    grnAmount: number;
    items: InventoryLog[];
}

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
        (a, b) => b.date.toDate().getTime() - a.date.toDate().getTime()
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
  
  const grnSummaries = useMemo(() => {
      const groupedByGrn: Record<string, GrnSummary> = {};

      transactions.forEach(t => {
          const grnNo = t.details?.grnNo;
          if (!grnNo) return;

          if (!groupedByGrn[grnNo]) {
              groupedByGrn[grnNo] = {
                  grnNo: grnNo,
                  date: t.date.toDate(),
                  transactionType: t.transactionType,
                  grnAmount: 0, // Initialize amount
                  items: []
              };
          }
          groupedByGrn[grnNo].items.push(t);
          // Aggregate the cost from each item
          const itemCost = (t.quantity || 0) * (t.cost || 0);
          groupedByGrn[grnNo].grnAmount += itemCost;
      });
      
      return Object.values(groupedByGrn).filter(summary => 
          summary.grnNo.toLowerCase().includes(searchTerm.toLowerCase())
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
                  placeholder="Filter by GRN No..."
                  className="pl-8"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>GRN No</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>GRN Amount</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={5}>
                        <Skeleton className="h-6 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : grnSummaries.length > 0 ? (
                  grnSummaries.map((summary) => (
                    <TableRow key={summary.grnNo} onClick={() => handleViewDetails(summary.items[0])} className="cursor-pointer">
                      <TableCell>{summary.grnNo}</TableCell>
                      <TableCell className="text-sm">
                        {summary.date ? format(summary.date, 'dd/MM/yyyy HH:mm') : 'N/A'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={getBadgeVariant(summary.transactionType)}>
                          {summary.transactionType}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {summary.grnAmount ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(summary.grnAmount) : 'N/A'}
                      </TableCell>
                      <TableCell>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); handleViewDetails(summary.items[0]); }}>
                            <Eye className="h-4 w-4"/>
                          </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center h-24">
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
