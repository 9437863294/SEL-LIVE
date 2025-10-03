
'use client';

import { useState, useEffect, useMemo, Fragment } from 'react';
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


export interface TransactionSummary {
    id: string; // GRN No or a generated Issue ID
    date: Date;
    transactionType: string;
    totalAmount: number;
    items: EnrichedLogItem[];
    details?: InventoryLog['details'];
}

export interface EnrichedLogItem extends InventoryLog {
  originalQuantity: number;
  issuedQuantity: number;
  balanceQuantity: number;
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

  const [selectedTransaction, setSelectedTransaction] = useState<TransactionSummary | null>(null);
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
  
  const handleViewDetails = (transactionSummary: TransactionSummary) => {
    setSelectedTransaction(transactionSummary);
    setIsViewOpen(true);
  };
  
  const transactionSummaries = useMemo(() => {
    const goodsReceipts = transactions.filter(t => t.transactionType === 'Goods Receipt');
    const goodsIssues = transactions.filter(t => t.transactionType === 'Goods Issue');

    const grnSummaries: Record<string, TransactionSummary> = {};

    goodsReceipts.forEach(grnItem => {
        const grnNo = grnItem.details?.grnNo;
        if (!grnNo) return;

        if (!grnSummaries[grnNo]) {
            grnSummaries[grnNo] = {
                id: grnNo,
                date: grnItem.date.toDate(),
                transactionType: 'Goods Receipt',
                totalAmount: 0,
                items: [],
                details: grnItem.details,
            };
        }
        
        const issuedQty = goodsIssues
            .filter(issue => issue.details?.sourceGrn === grnItem.id)
            .reduce((sum, issue) => sum + issue.quantity, 0);
            
        const enrichedItem: EnrichedLogItem = {
          ...grnItem,
          originalQuantity: grnItem.quantity,
          issuedQuantity: issuedQty,
          balanceQuantity: grnItem.quantity - issuedQty,
        };

        grnSummaries[grnNo].items.push(enrichedItem);
        grnSummaries[grnNo].totalAmount += (grnItem.quantity || 0) * (grnItem.cost || 0);
    });
    
    const issueSummaries: Record<string, TransactionSummary> = {};
    goodsIssues.forEach(issueItem => {
        const issueTo = issueItem.details?.issuedTo;
        if (!issueTo) return;
        
        const issueDate = format(issueItem.date.toDate(), 'yyyy-MM-dd');
        const groupId = `ISSUE-${issueDate}-${issueTo}`;

        if (!issueSummaries[groupId]) {
            issueSummaries[groupId] = {
                id: groupId,
                date: issueItem.date.toDate(),
                transactionType: 'Goods Issue',
                totalAmount: 0,
                items: [],
                details: issueItem.details,
            };
        }
        
        const enrichedItem: EnrichedLogItem = {
          ...issueItem,
          originalQuantity: 0, // Not applicable for issue summary
          issuedQuantity: issueItem.quantity,
          balanceQuantity: 0,
        };
        
        issueSummaries[groupId].items.push(enrichedItem);
        issueSummaries[groupId].totalAmount += (issueItem.quantity || 0) * (issueItem.cost || 0);
    });

    const allSummaries = [...Object.values(grnSummaries), ...Object.values(issueSummaries)];
    
    allSummaries.sort((a,b) => b.date.getTime() - a.date.getTime());

    return allSummaries.filter(summary =>
      summary.id.toLowerCase().includes(searchTerm.toLowerCase())
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
                <Link href={`/store-stock-management/${projectSlug}/transactions/stock-out`}>
                  <Button variant="outline">
                    <MinusCircle className="mr-2 h-4 w-4" /> Stock Out
                  </Button>
                </Link>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2">
              <div className="relative flex-grow">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Filter by GRN or Issue ID..."
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
                  <TableHead>Transaction ID</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Total Amount</TableHead>
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
                ) : transactionSummaries.length > 0 ? (
                  transactionSummaries.map((summary) => (
                    <TableRow key={summary.id} onClick={() => handleViewDetails(summary)} className="cursor-pointer">
                      <TableCell>{summary.id}</TableCell>
                      <TableCell className="text-sm">
                        {summary.date ? format(summary.date, 'dd/MM/yyyy HH:mm') : 'N/A'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={getBadgeVariant(summary.transactionType)}>
                          {summary.transactionType}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {summary.totalAmount ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(summary.totalAmount) : 'N/A'}
                      </TableCell>
                      <TableCell>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); handleViewDetails(summary); }}>
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
        transactionSummary={selectedTransaction}
      />
    </>
  );
}
