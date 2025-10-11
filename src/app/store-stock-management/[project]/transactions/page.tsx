
'use client';

import { useState, useEffect, useMemo, Fragment, useCallback } from 'react';
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
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import { db, storage } from '@/lib/firebase';
import { collection, getDocs, query, where, writeBatch, doc, orderBy, Timestamp, runTransaction, getDoc } from 'firebase/firestore';
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
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipProvider, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';


export interface TransactionSummary {
    id: string; // GRN No or a generated Issue ID
    date: Date;
    transactionType: string;
    totalAmount: number;
    remainingValue: number;
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
  const [typeFilter, setTypeFilter] = useState('all');
  const [selectedTransaction, setSelectedTransaction] = useState<TransactionSummary | null>(null);
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(isDeleting);
  const [isAutoAssembling, setIsAutoAssembling] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

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
    if (projectSlug) {
        fetchData();
    }
  }, [projectSlug]);
  
  const handleViewDetails = (transactionSummary: TransactionSummary) => {
    setSelectedTransaction(transactionSummary);
    setIsViewOpen(true);
  };
  
  const handleDeleteTransaction = async (summary: TransactionSummary) => {
      setIsDeleting(true);
      
      try {
          const inventoryLogsRef = collection(db, 'inventoryLogs');
          
          await runTransaction(db, async (transaction) => {
              const issueDocIdsToDelete = new Set(summary.items.map(item => item.id));
              const relevantIssueLogs = transactions.filter(t => issueDocIdsToDelete.has(t.id));
  
              const sourceGrnItemsToRead = new Set<string>();
  
              for (const issueItem of relevantIssueLogs) {
                  if (issueItem.details?.sourceGrn) {
                      const sourceGrnItemsQuery = query(
                          inventoryLogsRef,
                          where('projectId', '==', projectSlug),
                          where('details.grnNo', '==', issueItem.details.sourceGrn)
                      );
                      const sourceGrnItemsSnap = await getDocs(sourceGrnItemsQuery); // This is outside transaction, but we need the IDs first
                      sourceGrnItemsSnap.forEach(doc => sourceGrnItemsToRead.add(doc.id));
                  }
              }
  
              const sourceGrnDocs = await Promise.all(
                  Array.from(sourceGrnItemsToRead).map(id => transaction.get(doc(inventoryLogsRef, id)))
              );
              const sourceGrnDataMap = new Map(sourceGrnDocs.map(doc => [doc.id, doc.data() as InventoryLog]));
              const sourceGrnUpdates = new Map<string, number>();
  
              for (const issueItem of relevantIssueLogs) {
                  if (issueItem.itemType === 'Main' && issueItem.details?.sourceGrn) {
                      let sourceDocId: string | undefined;
                      for(const [id, data] of sourceGrnDataMap.entries()) {
                          if (data.details?.grnNo === issueItem.details.sourceGrn && data.itemId === issueItem.itemId) {
                              sourceDocId = id;
                              break;
                          }
                      }
                      
                      if (sourceDocId) {
                          const currentUpdate = sourceGrnUpdates.get(sourceDocId) || 0;
                          sourceGrnUpdates.set(sourceDocId, currentUpdate + issueItem.quantity);
                      }
  
                  } else if (issueItem.itemType === 'Sub' && issueItem.description?.includes('by breaking')) {
                      const setsBrokenDownMatch = issueItem.description.match(/by breaking (\d+) sets/);
                      const setsToRestore = setsBrokenDownMatch ? parseInt(setsBrokenDownMatch[1], 10) : 0;
                      const mainItemName = issueItem.description.split(' of ')[1];
                      const mainItemBoq = boqItems.find(b => getItemDescription(b) === mainItemName);
  
                      if (setsToRestore > 0 && mainItemBoq && issueItem.details?.sourceGrn) {
                           let sourceDocId: string | undefined;
                           for(const [id, data] of sourceGrnDataMap.entries()) {
                               if (data.details?.grnNo === issueItem.details.sourceGrn && data.itemId === mainItemBoq.id) {
                                   sourceDocId = id;
                                   break;
                               }
                           }
                          if (sourceDocId) {
                              const currentUpdate = sourceGrnUpdates.get(sourceDocId) || 0;
                              sourceGrnUpdates.set(sourceDocId, currentUpdate + setsToRestore);
                          }
                      }
                  }
              }
              
              sourceGrnUpdates.forEach((qtyToAdd, docId) => {
                  const docRef = doc(inventoryLogsRef, docId);
                  const currentData = sourceGrnDataMap.get(docId);
                  if (currentData) {
                      transaction.update(docRef, { availableQuantity: currentData.availableQuantity + qtyToAdd });
                  }
              });
  
              issueDocIdsToDelete.forEach(id => {
                  transaction.delete(doc(inventoryLogsRef, id));
              });
          });
  
          toast({ title: "Success", description: "Transaction and its items have been deleted, and stock has been reversed." });
          fetchData();
      } catch (error: any) {
          console.error("Error deleting transaction:", error);
          toast({ title: "Delete Failed", description: error.message || "An error occurred while deleting.", variant: "destructive" });
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

  const getItemDescription = (item: BoqItem) => {
    const descriptionKeys = ['Description', 'DESCRIPTION OF ITEMS', 'DESCRIPTION OF ITEMS(SCHEDULE-VIIA-SS) SUPPLY OF FOLLOWING EQUIPMENT & MATERIALS (As per Technical Specification)'];
    for (const key of descriptionKeys) {
      if (item[key]) {
        return item[key];
      }
    }
    const fallbackKey = Object.keys(item).find(k => k.toLowerCase().includes('description'));
    return fallbackKey ? item[fallbackKey] : '';
  };


  const handleAutoAssembly = async () => {
    setIsAutoAssembling(true);
    let setsCreatedCount = 0;
    let mainItemsAffected: string[] = [];

    try {
        await runTransaction(db, async (transaction) => {
            const inventoryLogsRef = collection(db, 'inventoryLogs');
            
            const currentProjectInventorySnap = await getDocs(query(inventoryLogsRef, where('projectId', '==', projectSlug)));
            const currentProjectInventory = currentProjectInventorySnap.docs.map(d => ({id: d.id, ...d.data()}) as InventoryLog);

            const mainItemsWithBOM = boqItems.filter(item => item.bom && item.bom.length > 0);
            
            const componentInventory: Record<string, { totalAvailable: number; logs: {id: string, available: number}[] }> = {};

            currentProjectInventory.forEach(item => {
                if (item.itemType === 'Sub' && item.availableQuantity > 0) {
                  if (!componentInventory[item.itemId]) {
                      componentInventory[item.itemId] = { totalAvailable: 0, logs: [] };
                  }
                  componentInventory[item.itemId].totalAvailable += item.availableQuantity;
                  componentInventory[item.itemId].logs.push({ id: item.id, available: item.availableQuantity });
                }
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
                    const mainItemDescription = getItemDescription(mainItem);
                    if (!mainItemsAffected.includes(mainItemDescription)) {
                        mainItemsAffected.push(mainItemDescription);
                    }

                    for (const bomComponent of mainItem.bom) {
                        const componentId = bomComponent.id;
                        let consumedQty = setsToCreate * bomComponent.qtyPerSet;

                        componentInventory[componentId].logs.sort((a, b) => a.available - b.available);

                        for (const log of componentInventory[componentId].logs) {
                            if (consumedQty <= 0) break;
                            const deduction = Math.min(consumedQty, log.available);
                            transaction.update(doc(inventoryLogsRef, log.id), { availableQuantity: log.available - deduction });
                            log.available -= deduction; // Update local state for subsequent calculations in the same transaction
                            consumedQty -= deduction;
                        }

                        const newConsumptionLogRef = doc(inventoryLogsRef);
                        transaction.set(newConsumptionLogRef, {
                             date: Timestamp.now(),
                             itemId: componentId,
                             itemName: `${mainItemDescription} - ${bomComponent.section}`,
                             itemType: 'Sub',
                             transactionType: 'Conversion',
                             quantity: setsToCreate * bomComponent.qtyPerSet,
                             availableQuantity: 0,
                             unit: 'Kg',
                             cost: 0, // Cost for conversion logs can be tricky, might need separate logic
                             projectId: projectSlug,
                             description: `Auto-assembled into ${setsToCreate} sets of ${mainItemDescription}`,
                        });
                    }

                    const newMainItemLogRef = doc(collection(db, 'inventoryLogs'));
                    transaction.set(newMainItemLogRef, {
                        date: Timestamp.now(),
                        itemId: mainItem.id,
                        itemName: mainItemDescription,
                        itemType: 'Main',
                        transactionType: 'Goods Receipt',
                        quantity: setsToCreate,
                        availableQuantity: setsToCreate,
                        unit: mainItem.UNIT || mainItem.UNITS || 'Set',
                        projectId: projectSlug,
                        description: 'Auto-assembled from BOM components',
                        details: { fromConversion: true, sourceGrn: null },
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
                remainingValue: 0,
                items: [],
                details: grnItem.details,
            };
        }
        
        const issuesFromThisGrnItem = goodsIssues.filter(issue => issue.details?.sourceGrn === grnNo && issue.itemId === grnItem.itemId);
        const totalIssuedQty = issuesFromThisGrnItem.reduce((sum, issue) => sum + issue.quantity, 0);
        
        const enrichedItem: EnrichedLogItem = {
          ...grnItem,
          originalQuantity: grnItem.quantity,
          issuedQuantity: totalIssuedQty,
          balanceQuantity: grnItem.availableQuantity,
        };

        grnSummaries[grnNo].items.push(enrichedItem);
        grnSummaries[grnNo].totalAmount += (grnItem.quantity || 0) * (grnItem.cost || 0);
    });

    Object.values(grnSummaries).forEach(summary => {
        summary.remainingValue = summary.items.reduce((sum, item) => sum + ((item.balanceQuantity || 0) * (item.cost || 0)), 0);
    });
    
    const issueSummaries: Record<string, TransactionSummary> = {};
    goodsIssues.forEach(issueItem => {
        const issueTo = issueItem.details?.issuedTo || 'Unknown';
        const dateStr = format(issueItem.date.toDate(), 'yyyy-MM-dd-HH-mm');
        const issueGroupId = `ISSUE-${dateStr}-${issueTo}`;

        if (!issueSummaries[issueGroupId]) {
            issueSummaries[issueGroupId] = {
                id: issueGroupId,
                date: issueItem.date.toDate(),
                transactionType: 'Goods Issue',
                totalAmount: 0,
                remainingValue: 0,
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
        
        issueSummaries[issueGroupId].items.push(enrichedItem);
        issueSummaries[issueGroupId].totalAmount += (issueItem.quantity || 0) * (issueItem.cost || 0);
    });

    const allSummaries = [...Object.values(grnSummaries), ...Object.values(issueSummaries)];
    
    allSummaries.sort((a,b) => b.date.getTime() - a.date.getTime());

    return allSummaries.filter(summary =>
      (typeFilter === 'all' || summary.transactionType === typeFilter) &&
      summary.id.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [transactions, searchTerm, typeFilter, boqItems]);
  
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

  const toggleRowExpansion = (id: string) => {
    const newExpandedRows = new Set(expandedRows);
    if (expandedRows.has(id)) {
      newExpandedRows.delete(id);
    } else {
      newExpandedRows.add(id);
    }
    setExpandedRows(newExpandedRows);
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
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="Goods Receipt">Goods Receipt</SelectItem>
                    <SelectItem value="Goods Issue">Goods Issue</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12"></TableHead>
                  <TableHead>Transaction ID</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Total Amount</TableHead>
                  <TableHead>Remaining Value</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={7}>
                        <Skeleton className="h-6 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : transactionSummaries.length > 0 ? (
                  transactionSummaries.map((summary) => (
                    <Fragment key={summary.id}>
                    <TableRow>
                      <TableCell>
                        <Button size="icon" variant="ghost" onClick={() => toggleRowExpansion(summary.id)}>
                          {expandedRows.has(summary.id) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </Button>
                      </TableCell>
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
                        {summary.transactionType === 'Goods Receipt' ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(summary.remainingValue) : 'N/A'}
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
                     {expandedRows.has(summary.id) && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={7} className="p-0">
                            <div className="p-4">
                              <h4 className="font-semibold text-sm mb-2 ml-2">Items</h4>
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Item Name</TableHead>
                                    <TableHead>Qty</TableHead>
                                    <TableHead>Unit Cost</TableHead>
                                    <TableHead>Total Cost</TableHead>
                                    {summary.transactionType === 'Goods Receipt' && (
                                      <>
                                        <TableHead>Issued Qty</TableHead>
                                        <TableHead>Balance Qty</TableHead>
                                        <TableHead className="text-right">Remaining Value</TableHead>
                                      </>
                                    )}
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {summary.items.map(item => (
                                    <TableRow key={item.id}>
                                      <TableCell>{item.itemName}</TableCell>
                                      <TableCell>{item.quantity} {item.unit}</TableCell>
                                      <TableCell>{new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(item.cost || 0)}</TableCell>
                                      <TableCell>{new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format((item.quantity || 0) * (item.cost || 0))}</TableCell>
                                      {summary.transactionType === 'Goods Receipt' && (
                                        <>
                                          <TableCell className="text-destructive">{item.issuedQuantity}</TableCell>
                                          <TableCell className="font-semibold">{item.balanceQuantity}</TableCell>
                                          <TableCell className="text-right font-bold">{new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format((item.balanceQuantity || 0) * (item.cost || 0))}</TableCell>
                                        </>
                                      )}
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center h-24">
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

    