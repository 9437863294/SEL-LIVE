
'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';
import type { BoqItem, InventoryLog } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Calendar as CalendarIcon, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DateRange } from 'react-day-picker';
import { format } from 'date-fns';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

interface InventoryItem {
    id: string;
    slNo: string;
    description: string;
    boqQty: number;
    unit: string;
    stockIn: number;
    stockOut: number;
    balance: number;
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
                const inventoryData = inventorySnapshot.docs.map(doc => doc.data() as InventoryLog);

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

    const inventoryData = useMemo((): InventoryItem[] => {
        if (isLoading) return [];
        
        const filteredLogs = dateRange?.from && dateRange?.to
            ? inventoryLogs.filter(log => {
                const logDate = log.date.toDate();
                return logDate >= dateRange.from! && logDate <= dateRange.to!;
            })
            : inventoryLogs;

        const stockMovements = new Map<string, { stockIn: number; stockOut: number }>();

        // Initialize all BOQ items in the map
        boqItems.forEach(item => {
            stockMovements.set(item.id, { stockIn: 0, stockOut: 0 });
        });

        filteredLogs.forEach(log => {
            let itemIdToUpdate: string | undefined;
            let quantity = log.quantity;

            if (log.itemType === 'Main') {
                itemIdToUpdate = log.itemId;
            } else if (log.itemType === 'Sub' && log.transactionType === 'Goods Issue') {
                // This is a component issue, we need to find the parent main item
                const parentBoqItem = boqItems.find(boq => 
                    boq.bom?.some(bomItem => `bom-${boq.id}-${bomItem.markNo}` === log.itemId)
                );
                if (parentBoqItem) {
                    const bomItem = parentBoqItem.bom!.find(bi => `bom-${parentBoqItem.id}-${bi.markNo}` === log.itemId)!;
                    // This issue of components effectively "uses up" a fraction of the main item
                    itemIdToUpdate = parentBoqItem.id;
                    // The "quantity" to deduct from the main item is proportional to how many sets this component issue represents.
                    quantity = log.quantity / bomItem.qtyPerSet;
                }
            }
            
            if (itemIdToUpdate) {
                const current = stockMovements.get(itemIdToUpdate) || { stockIn: 0, stockOut: 0 };
                if (log.transactionType === 'Goods Receipt') {
                    current.stockIn += quantity;
                } else if (log.transactionType === 'Goods Issue') {
                    current.stockOut += quantity;
                }
                stockMovements.set(itemIdToUpdate, current);
            }
        });
        
        const boqWithMainItems = boqItems.filter(item => item['Sl No'] || item['SL. No.']);

        let calculatedData = boqWithMainItems.map(item => {
            const movements = stockMovements.get(item.id) || { stockIn: 0, stockOut: 0 };
            
            return {
                id: item.id,
                slNo: String(item['Sl No'] || item['SL. No.'] || ''),
                description: String(item['Description'] || item['DESCRIPTION OF ITEMS'] || ''),
                boqQty: Number(item['BOQ QTY'] || item['Total Qty'] || 0),
                unit: String(item['UNIT'] || item['UNITS'] || 'N/A'),
                stockIn: movements.stockIn,
                stockOut: movements.stockOut,
                balance: movements.stockIn - movements.stockOut,
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

    return (
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
                        <Checkbox id="filter-transactions" checked={showOnlyWithTransactions} onCheckedChange={(checked) => setShowOnlyWithTransactions(!!checked)} />
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
                                    <TableHead>Sl. No.</TableHead>
                                    <TableHead>Description</TableHead>
                                    <TableHead>Unit</TableHead>
                                    <TableHead className="text-right">BOQ Qty</TableHead>
                                    <TableHead className="text-right">Stock In</TableHead>
                                    <TableHead className="text-right">Stock Out</TableHead>
                                    <TableHead className="text-right font-bold">Balance</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isLoading ? (
                                    Array.from({ length: 15 }).map((_, i) => (
                                        <TableRow key={i}>
                                            <TableCell colSpan={7}><Skeleton className="h-6 w-full" /></TableCell>
                                        </TableRow>
                                    ))
                                ) : inventoryData.length > 0 ? (
                                    inventoryData.map(item => (
                                        <TableRow key={item.id}>
                                            <TableCell>{item.slNo}</TableCell>
                                            <TableCell className="font-medium">{item.description}</TableCell>
                                            <TableCell>{item.unit}</TableCell>
                                            <TableCell className="text-right">{item.boqQty.toLocaleString()}</TableCell>
                                            <TableCell className="text-right text-green-600">{item.stockIn.toLocaleString()}</TableCell>
                                            <TableCell className="text-right text-red-600">{item.stockOut.toLocaleString()}</TableCell>
                                            <TableCell className="text-right font-bold">{item.balance.toLocaleString()}</TableCell>
                                        </TableRow>
                                    ))
                                ) : (
                                    <TableRow>
                                        <TableCell colSpan={7} className="text-center h-24">
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
    );
}
