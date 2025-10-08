
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
  Eye,
  Edit,
  Trash2,
  Loader2,
  GitCommit,
} from 'lucide-react';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where, writeBatch, doc, orderBy, Timestamp, runTransaction } from 'firebase/firestore';
import { useParams, useRouter } from 'next/navigation';
import type { InventoryLog, EnrichedLogItem, BoqItem } from '@/lib/types';
import { format } from 'date-fns';
import Link from 'next/link';
import ViewTransactionDialog from '@/components/ViewTransactionDialog';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipProvider, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';


export interface TransactionSummary {
    id: string; // GRN No or a generated Issue ID
    date: Date;
    transactionType: string;
    totalAmount: number;
    items: EnrichedLogItem[];
    details?: InventoryLog['details'];
}

export default function TransactionsPage() {
  const params = useParams();
  const router = useRouter();
  const projectSlug = params.project as string;
  const [transactions, setTransactions] = useState<InventoryLog[]>([]);
  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTransaction, setSelectedTransaction] = useState<TransactionSummary | null>(null);
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isAutoAssembling, setIsAutoAssembling] = useState(false);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const q = query(
        collection(db, 'inventoryLogs'),
        where('projectId', '==', projectSlug)
      );
      const boqQuery = query(collection(db, 'boqItems'), where('projectSlug', '==', projectSlug));

      const [transactionsSnap, boqSnap] = await Promise.all([getDocs(q), getDocs(boqQuery)]);

      const data = transactionsSnap.docs.map(
        (doc) => ({ ...doc.data(), id: doc.id } as InventoryLog)
      );
      data.sort(
        (a, b) => b.date.toDate().getTime() - a.date.toDate().getTime()
      );
      setTransactions(data);
      setBoqItems(boqSnap.docs.map(d => ({id: d.id, ...d.data()} as BoqItem)));

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
  
  const handleDeleteTransaction = async (summary: TransactionSummary) => {
    setIsDeleting(true);
    try {
        if (summary.transactionType === 'Goods Receipt') {
            const hasBeenIssued = summary.items.some(item => item.issuedQuantity > 0);
            if (hasBeenIssued) {
                toast({ title: "Delete Error", description: "Cannot delete GRN. Some items have already been issued.", variant: "destructive" });
                setIsDeleting(false);
                return;
            }
            
            const batch = writeBatch(db);
            summary.items.forEach(item => {
                const docRef = doc(db, 'inventoryLogs', item.id);
                batch.delete(docRef);
            });
            await batch.commit();
            toast({ title: "Success", description: "GRN and all its items have been deleted." });

        } else if (summary.transactionType === 'Goods Issue') {
            const batch = writeBatch(db);

            for (const issueItem of summary.items) {
                // Find all GRN records for this specific item, ordered by date to ensure FIFO
                const grnItemsQuery = query(
                    collection(db, 'inventoryLogs'), 
                    where('projectId', '==', projectSlug),
                    where('itemId', '==', issueItem.itemId),
                    where('transactionType', '==', 'Goods Receipt')
                );
                const grnItemsSnap = await getDocs(grnItemsQuery);

                const grnDocs = grnItemsSnap.docs
                    .map(d => ({...d.data(), id: d.id} as InventoryLog))
                    .sort((a,b) => a.date.toDate().getTime() - b.date.toDate().getTime());

                if (grnDocs.length > 0) {
                    // Add the quantity back to the first available GRN record
                    // This is a simplified FIFO refund. A more complex system might distribute it.
                    const firstGrnDoc = grnDocs[0];
                    const grnItem = firstGrnDoc;
                    const newAvailableQty = grnItem.availableQuantity + issueItem.quantity;
                    batch.update(doc(db, 'inventoryLogs', firstGrnDoc.id), { availableQuantity: newAvailableQty });
                } else {
                     // This case should be rare if data is consistent, but it's good to handle.
                     console.warn(`Could not find a source GRN for issued item ${issueItem.itemName} to return stock to.`);
                }
                
                // Delete the goods issue log itself
                batch.delete(doc(db, 'inventoryLogs', issueItem.id));
            }
            await batch.commit();
            toast({ title: "Success", description: "Goods issue has been reversed and stock updated." });
        }
        fetchData();
    } catch (error) {
        console.error("Error deleting transaction:", error);
        toast({ title: "Delete Failed", description: "An error occurred while deleting.", variant: "destructive" });
    }
    setIsDeleting(false);
  };

  const handleEditTransaction = (summary: TransactionSummary) => {
    if (summary.transactionType === 'Goods Receipt') {
      const hasBeenIssued = summary.items.some(item => item.issuedQuantity > 0);
      if (hasBeenIssued) {
        toast({ title: "Cannot Edit", description: "This GRN cannot be edited because some items have already been issued. Please reverse the relevant Goods Issue transactions first.", variant: "destructive" });
        return;
      }
      router.push(`/store-stock-management/${projectSlug}/transactions/stock-in/${summary.id}/edit`);
    } else {
         toast({ title: "Info", description: "Editing Goods Issue is not supported. Please delete and create a new one.", variant: "default" });
    }
  };

  const handleAutoAssembly = async () => {
    setIsAutoAssembling(true);
    let setsCreatedCount = 0;
    let mainItemsAffected: string[] = [];

    try {
        await runTransaction(db, async (transaction) => {
            const mainItemsWithBOM = boqItems.filter(item => item.bom && item.bom.length > 0);
            
            const componentInventory: Record<string, { totalAvailable: number; logs: {id: string, available: number}[] }> = {};

            const subItemsQuery = query(collection(db, 'inventoryLogs'), where('projectId', '==', projectSlug), where('itemType', '==', 'Sub'), where('availableQuantity', '>', 0));
            const subItemsSnap = await getDocs(subItemsQuery);

            subItemsSnap.forEach(doc => {
                const item = doc.data() as InventoryLog;
                if (!componentInventory[item.itemId]) {
                    componentInventory[item.itemId] = { totalAvailable: 0, logs: [] };
                }
                componentInventory[item.itemId].totalAvailable += item.availableQuantity;
                componentInventory[item.itemId].logs.push({ id: doc.id, available: item.availableQuantity });
            });

            for (const mainItem of mainItemsWithBOM) {
                if (!mainItem.bom) continue;

                let possibleSets = Infinity;
                for (const bomComponent of mainItem.bom) {
                    const componentId = `bom-${mainItem.id}-${bomComponent.markNo}`;
                    const inventory = componentInventory[componentId];
                    if (!inventory || inventory.totalAvailable < bomComponent.qtyPerSet) {
                        possibleSets = 0;
                        break;
                    }
                    possibleSets = Math.min(possibleSets, Math.floor(inventory.totalAvailable / bomComponent.qtyPerSet));
                }

                const setsToCreate = Math.floor(possibleSets);

                if (setsToCreate > 0) {
                    setsCreatedCount += setsToCreate;
                    mainItemsAffected.push(mainItem.Description || mainItem.id);

                    for (const bomComponent of mainItem.bom) {
                        const componentId = `bom-${mainItem.id}-${bomComponent.markNo}`;
                        let consumedQty = setsToCreate * bomComponent.qtyPerSet;

                        componentInventory[componentId].logs.sort((a, b) => a.available - b.available);

                        for (const log of componentInventory[componentId].logs) {
                            if (consumedQty <= 0) break;
                            const deduction = Math.min(consumedQty, log.available);
                            transaction.update(doc(db, 'inventoryLogs', log.id), { availableQuantity: log.available - deduction });
                            log.available -= deduction;
                            consumedQty -= deduction;
                        }

                        const newConsumptionLogRef = doc(collection(db, 'inventoryLogs'));
                        transaction.set(newConsumptionLogRef, {
                             date: Timestamp.now(),
                             itemId: componentId,
                             itemName: `${mainItem.Description} - ${bomComponent.section}`,
                             itemType: 'Sub',
                             transactionType: 'Conversion',
                             quantity: setsToCreate * bomComponent.qtyPerSet,
                             availableQuantity: 0,
                             unit: 'Kg',
                             projectId: projectSlug,
                             description: `Auto-assembled into ${setsToCreate} sets of ${mainItem.Description}`,
                        });
                    }

                    const newMainItemLogRef = doc(collection(db, 'inventoryLogs'));
                    transaction.set(newMainItemLogRef, {
                        date: Timestamp.now(),
                        itemId: mainItem.id,
                        itemName: mainItem.Description,
                        itemType: 'Main',
                        transactionType: 'Goods Receipt',
                        quantity: setsToCreate,
                        availableQuantity: setsToCreate,
                        unit: mainItem.UNIT || 'Set',
                        projectId: projectSlug,
                        description: 'Auto-assembled from BOM components',
                        details: { fromConversion: true },
                    });
                }
            }
        });

        if (setsCreatedCount > 0) {
            toast({
                title: "Auto-Assembly Complete",
                description: `Successfully created ${setsCreatedCount} set(s) for: ${mainItemsAffected.join(', ')}.`,
            });
            await fetchData();
        } else {
            toast({ title: "Auto-Assembly", description: "No complete sets could be formed from available components." });
        }
    } catch (e: any) {
        console.error("Auto-assembly transaction failed:", e);
        toast({ title: "Error", description: `Auto-assembly failed: ${e.message}`, variant: "destructive" });
    } finally {
        setIsAutoAssembling(false);
    }
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
            .filter(issue => issue.details?.sourceGrn === grnItem.details?.grnNo && issue.itemId === grnItem.itemId)
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
        
        const issueDate = format(issueItem.date.toDate(), 'yyyy-MM-dd-HH-mm-ss');
        const groupId = `ISSUE-${issueDate}-${issueTo}-${Math.random().toString(36).substring(2, 9)}`;


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
          originalQuantity: 0, 
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
        return 'default';
      case 'Goods Issue':
        return 'destructive';
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
                 <Button variant="secondary" onClick={handleAutoAssembly} disabled={isAutoAssembling}>
                    {isAutoAssembling ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <GitCommit className="mr-2 h-4 w-4" />}
                    Auto-Assemble
                </Button>
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
                  <TableHead className="text-right">Actions</TableHead>
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
                    <TableRow key={summary.id}>
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
                      <TableCell className="text-right">
                        <AlertDialog>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                               <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                               <DropdownMenuItem onSelect={() => handleViewDetails(summary)}>
                                  <Eye className="mr-2 h-4 w-4" /> View
                               </DropdownMenuItem>
                               <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <div>
                                            <DropdownMenuItem
                                                onSelect={() => handleEditTransaction(summary)}
                                                disabled={summary.transactionType === 'Goods Issue' || (summary.transactionType === 'Goods Receipt' && summary.items.some(item => item.issuedQuantity > 0))}
                                            >
                                                <Edit className="mr-2 h-4 w-4" /> Edit
                                            </DropdownMenuItem>
                                        </div>
                                    </TooltipTrigger>
                                    {summary.transactionType === 'Goods Issue' ? (
                                        <TooltipContent>
                                            <p>Edit not supported for Goods Issue.</p>
                                        </TooltipContent>
                                    ) : (summary.transactionType === 'Goods Receipt' && summary.items.some(item => item.issuedQuantity > 0)) && (
                                        <TooltipContent>
                                            <p>Cannot edit GRN after items have been issued.</p>
                                        </TooltipContent>
                                    )}
                                </Tooltip>
                               </TooltipProvider>

                               <DropdownMenuSeparator />
                               <AlertDialogTrigger asChild>
                                 <DropdownMenuItem className="text-destructive">
                                    <Trash2 className="mr-2 h-4 w-4" /> Delete
                                 </DropdownMenuItem>
                               </AlertDialogTrigger>
                            </DropdownMenuContent>
                          </DropdownMenu>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    This action is irreversible. Deleting a transaction will permanently alter your inventory records. Are you sure you want to continue?
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleDeleteTransaction(summary)} disabled={isDeleting}>
                                    {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}
                                    Delete
                                </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
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
