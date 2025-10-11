
'use client';

import { useState, useEffect, useMemo, Fragment, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';
import type { BoqItem, InventoryLog, EnrichedLogItem } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Calendar as CalendarIcon, Search, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DateRange } from 'react-day-picker';
import { format } from 'date-fns';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import type { TransactionSummary } from '@/app/store-stock-management/[project]/transactions/page';
import ViewTransactionDialog from '@/components/ViewTransactionDialog';


interface InventoryItem {
    id: string;
    slNo: string;
    description: string;
    boqQty: number;
    unit: string;
    stockIn: number;
    stockOut: number;
    balance: number;
    stockValue: number;
}

export default function InventoryPage() {
    const params = useParams();
    const projectSlug = params.project as string;
    const { toast } = useToast();

    const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
    const [inventoryLogs, setInventoryLogs] = useState<InventoryLog[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    
    // Filter states
    const [searchTerm, setSearchTerm] = useState('');
    const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
    const [showOnlyWithTransactions, setShowOnlyWithTransactions] = useState(false);
    const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

    const [selectedTransaction, setSelectedTransaction] = useState<TransactionSummary | null>(null);
    const [isViewOpen, setIsViewOpen] = useState(false);

    useEffect(() => {
        if (!projectSlug) return;
        const fetchData = async () => {
            setIsLoading(true);
            try {
                const boqQuery = query(collection(db, 'boqItems'), where('projectSlug', '==', projectSlug));
                const inventoryQuery = query(collection(db, 'inventoryLogs'), where('projectId', '==', projectSlug));
                
                const [boqSnapshot, inventorySnapshot] = await Promise.all([
                    getDocs(boqQuery),
                    getDocs(inventoryQuery)
                ]);

                const boqData = boqSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BoqItem));
                const inventoryData = inventorySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryLog));

                setBoqItems(boqData);
                setInventoryLogs(inventoryData);

            } catch (error) {
                console.error("Error fetching inventory data:", error);
                toast({ title: 'Error', description: 'Failed to fetch inventory data.', variant: 'destructive' });
            }
            setIsLoading(false);
        };
        fetchData();
    }, [projectSlug, toast]);
    
    const toggleRowExpansion = (itemId: string) => {
        setExpandedRows(prev => {
          const newSet = new Set(prev);
          if (newSet.has(itemId)) {
            newSet.delete(itemId);
          } else {
            newSet.add(itemId);
          }
          return newSet;
        });
    };

    const inventoryData = useMemo((): InventoryItem[] => {
        if (isLoading) return [];

        const filteredLogs = dateRange?.from && dateRange?.to
            ? inventoryLogs.filter(log => {
                const logDate = log.date.toDate();
                return logDate >= dateRange.from! && logDate <= dateRange.to!;
            })
            : inventoryLogs;

        const stockMovements = new Map<string, { stockIn: number; stockOut: number; latestCost: number }>();

        boqItems.forEach(item => {
            stockMovements.set(item.id, { stockIn: 0, stockOut: 0, latestCost: 0 });
        });

        filteredLogs.forEach(log => {
            const current = stockMovements.get(log.itemId) || { stockIn: 0, stockOut: 0, latestCost: 0 };
            if (log.transactionType === 'Goods Receipt') {
                current.stockIn += log.quantity;
                if(log.cost && log.cost > 0) { // Update latest cost only from GRNs with cost
                    current.latestCost = log.cost;
                }
            } else if (log.transactionType === 'Goods Issue' || log.transactionType === 'Conversion') {
                current.stockOut += log.quantity;
            }
            stockMovements.set(log.itemId, current);
        });
        
        const boqWithMainItems = boqItems.filter(item => item['Sl No'] || item['SL. No.']);
        
        let calculatedData = boqWithMainItems.map(item => {
            const movements = stockMovements.get(item.id) || { stockIn: 0, stockOut: 0, latestCost: 0 };
            const balance = movements.stockIn - movements.stockOut;
            return {
                id: item.id,
                slNo: String(item['Sl No'] || item['SL. No.'] || ''),
                description: String(item['Description'] || item['DESCRIPTION OF ITEMS'] || ''),
                boqQty: Number(item['BOQ QTY'] || item['Total Qty'] || 0),
                unit: String(item['UNIT'] || item['UNITS'] || 'N/A'),
                stockIn: movements.stockIn,
                stockOut: movements.stockOut,
                balance: balance,
                stockValue: balance * movements.latestCost,
            };
        });

        if (showOnlyWithTransactions) {
          calculatedData = calculatedData.filter(item => item.stockIn > 0 || item.stockOut > 0);
        }
        
        const lowercasedFilter = searchTerm.toLowerCase();
        const finalFilteredData = !searchTerm
            ? calculatedData
            : calculatedData.filter(item => 
                item.slNo.toLowerCase().includes(lowercasedFilter) ||
                item.description.toLowerCase().includes(lowercasedFilter)
            );

        return finalFilteredData.sort((a,b) => parseFloat(a.slNo) - parseFloat(b.slNo));

    }, [boqItems, inventoryLogs, isLoading, searchTerm, dateRange, showOnlyWithTransactions]);
    
    const clearFilters = () => {
        setSearchTerm('');
        setDateRange(undefined);
        setShowOnlyWithTransactions(false);
    }
    
    const itemTransactionDetails = useCallback((itemId: string) => {
        return inventoryLogs.filter(log => log.itemId === itemId).sort((a, b) => b.date.toDate().getTime() - a.date.toDate().getTime());
    }, [inventoryLogs]);

    const handleViewTransaction = (log: InventoryLog) => {
        const transactionId = log.details?.grnNo || `ISSUE-${format(log.date.toDate(), 'yyyy-MM-dd-HH-mm')}-${log.details?.issuedTo}`;
        
        const allLogsForTransaction = inventoryLogs.filter(l => {
          if (log.transactionType === 'Goods Receipt') {
            return l.details?.grnNo === log.details?.grnNo;
          }
          // This grouping for issues is a simplified assumption
          const issueGroupId = `ISSUE-${format(l.date.toDate(), 'yyyy-MM-dd-HH-mm')}-${l.details?.issuedTo}`;
          return issueGroupId === transactionId;
        });
        
        const summary: TransactionSummary = {
          id: transactionId,
          date: log.date.toDate(),
          transactionType: log.transactionType,
          totalAmount: allLogsForTransaction.reduce((sum, item) => sum + ((item.quantity || 0) * (item.cost || 0)), 0),
          remainingValue: 0, // Recalculate if needed, complex for issues
          items: allLogsForTransaction.map(item => ({...item, originalQuantity: 0, issuedQuantity: 0, balanceQuantity: 0})),
          details: log.details,
        };
        setSelectedTransaction(summary);
        setIsViewOpen(true);
    };

    const formatCurrency = (amount: number) => {
      if (typeof amount !== 'number' || isNaN(amount)) return 'N/A';
      return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
    };

    return (
        <>
            <div>
                <h1 className="text-3xl font-bold mb-6">Inventory Status</h1>

                <Card className="mb-6">
                    <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-end gap-4">
                        <div className="relative w-full sm:w-auto flex-grow">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search by Sl. No. or Description..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pl-8"
                            />
                        </div>
                        <div className="w-full sm:w-auto">
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        id="date"
                                        variant={"outline"}
                                        className={cn(
                                        "w-full sm:w-[300px] justify-start text-left font-normal",
                                        !dateRange && "text-muted-foreground"
                                        )}
                                    >
                                        <CalendarIcon className="mr-2 h-4 w-4" />
                                        {dateRange?.from ? (
                                        dateRange.to ? (
                                            <>
                                            {format(dateRange.from, "LLL dd, y")} -{" "}
                                            {format(dateRange.to, "LLL dd, y")}
                                            </>
                                        ) : (
                                            format(dateRange.from, "LLL dd, y")
                                        )
                                        ) : (
                                        <span>Pick a date range</span>
                                        )}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="start">
                                    <Calendar
                                        initialFocus
                                        mode="range"
                                        defaultMonth={dateRange?.from}
                                        selected={dateRange}
                                        onSelect={setDateRange}
                                        numberOfMonths={2}
                                    />
                                </PopoverContent>
                            </Popover>
                        </div>
                        <div className="flex items-center space-x-2">
                            <Switch id="filter-transactions" checked={showOnlyWithTransactions} onCheckedChange={setShowOnlyWithTransactions} />
                            <Label htmlFor="filter-transactions" className="whitespace-nowrap">Show only items with transactions</Label>
                        </div>
                        <Button onClick={clearFilters} variant="secondary">Clear</Button>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent>
                        <ScrollArea className="h-[calc(100vh-28rem)]">
                            <Table>
                                <TableHeader className="sticky top-0 bg-background z-10">
                                    <TableRow>
                                        <TableHead className="w-12"></TableHead>
                                        <TableHead>Sl. No.</TableHead>
                                        <TableHead>Description</TableHead>
                                        <TableHead>Unit</TableHead>
                                        <TableHead className="text-right">BOQ Qty</TableHead>
                                        <TableHead className="text-right">Stock In</TableHead>
                                        <TableHead className="text-right">Stock Out</TableHead>
                                        <TableHead className="text-right font-bold">Balance</TableHead>
                                        <TableHead className="text-right font-bold">Stock item Value</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {isLoading ? (
                                        Array.from({ length: 15 }).map((_, i) => (
                                            <TableRow key={i}>
                                                <TableCell colSpan={9}><Skeleton className="h-6 w-full" /></TableCell>
                                            </TableRow>
                                        ))
                                    ) : inventoryData.length > 0 ? (
                                        inventoryData.map(item => (
                                            <Fragment key={item.id}>
                                                <TableRow onClick={() => toggleRowExpansion(item.id)} className="cursor-pointer">
                                                    <TableCell>
                                                        <Button size="icon" variant="ghost">
                                                            {expandedRows.has(item.id) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                                        </Button>
                                                    </TableCell>
                                                    <TableCell>{item.slNo}</TableCell>
                                                    <TableCell className="font-medium">{item.description}</TableCell>
                                                    <TableCell>{item.unit}</TableCell>
                                                    <TableCell className="text-right">{item.boqQty.toLocaleString()}</TableCell>
                                                    <TableCell className="text-right text-green-600">{item.stockIn.toLocaleString()}</TableCell>
                                                    <TableCell className="text-right text-red-600">{item.stockOut.toLocaleString()}</TableCell>
                                                    <TableCell className="text-right font-bold">{item.balance.toLocaleString()}</TableCell>
                                                    <TableCell className="text-right font-bold">{formatCurrency(item.stockValue)}</TableCell>
                                                </TableRow>
                                                {expandedRows.has(item.id) && (
                                                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                                                        <TableCell colSpan={9} className="p-2">
                                                            <div className="p-2 bg-background rounded-md">
                                                                <h4 className="font-semibold text-sm mb-2">Transaction History</h4>
                                                                <Table>
                                                                    <TableHeader>
                                                                        <TableRow>
                                                                            <TableHead>Date</TableHead>
                                                                            <TableHead>GRN / Issue ID</TableHead>
                                                                            <TableHead>Type</TableHead>
                                                                            <TableHead>Unit</TableHead>
                                                                            <TableHead className="text-right">Qty</TableHead>
                                                                            <TableHead className="text-right">Price</TableHead>
                                                                            <TableHead className="text-right">Total</TableHead>
                                                                            <TableHead className="text-right">Remaining Qty</TableHead>
                                                                            <TableHead className="text-right">Remaining Value</TableHead>
                                                                        </TableRow>
                                                                    </TableHeader>
                                                                    <TableBody>
                                                                        {itemTransactionDetails(item.id).map(log => {
                                                                            const remainingValue = (log.availableQuantity || 0) * (log.cost || 0);
                                                                            return (
                                                                                <TableRow key={`${log.id}-${log.date.toMillis()}`}>
                                                                                    <TableCell>{format(log.date.toDate(), 'dd MMM yyyy')}</TableCell>
                                                                                    <TableCell>
                                                                                        <Button variant="link" className="p-0 h-auto" onClick={(e) => { e.stopPropagation(); handleViewTransaction(log); }}>
                                                                                            {log.details?.grnNo || `Issued to ${log.details?.issuedTo}`}
                                                                                        </Button>
                                                                                    </TableCell>
                                                                                    <TableCell>
                                                                                    <Badge variant={log.transactionType === 'Goods Receipt' ? 'default' : 'destructive'}>{log.transactionType}</Badge>
                                                                                    </TableCell>
                                                                                    <TableCell>{log.unit}</TableCell>
                                                                                    <TableCell className="text-right">{log.quantity.toLocaleString()}</TableCell>
                                                                                    <TableCell className="text-right">{formatCurrency(log.cost || 0)}</TableCell>
                                                                                    <TableCell className="text-right">{formatCurrency((log.quantity || 0) * (log.cost || 0))}</TableCell>
                                                                                    <TableCell className="text-right font-semibold">{log.availableQuantity || 0}</TableCell>
                                                                                    <TableCell className="text-right font-semibold">{formatCurrency(remainingValue)}</TableCell>
                                                                                </TableRow>
                                                                            )
                                                                        })}
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
                                            <TableCell colSpan={9} className="text-center h-24">
                                                No inventory data to display for this project or selected filters.
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </ScrollArea>
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
