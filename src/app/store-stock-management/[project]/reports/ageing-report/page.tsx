
'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';
import type { InventoryLog } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { differenceInDays } from 'date-fns';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

interface AgeingBucket {
    quantity: number;
    value: number;
}

interface AgeingData {
    itemName: string;
    unit: string;
    '0-30': AgeingBucket;
    '31-60': AgeingBucket;
    '61-90': AgeingBucket;
    '91-180': AgeingBucket;
    '181-365': AgeingBucket;
    '365+': AgeingBucket;
    totalQuantity: number;
    totalValue: number;
}

const ageBrackets: (keyof Omit<AgeingData, 'itemName' | 'unit' | 'totalQuantity' | 'totalValue'>)[] = ['0-30', '31-60', '61-90', '91-180', '181-365', '365+'];

export default function AgeingReportPage() {
    const { toast } = useToast();
    const params = useParams();
    const projectSlug = params.project as string;
    const [inventoryLogs, setInventoryLogs] = useState<InventoryLog[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    
    useEffect(() => {
        if (!projectSlug) return;
        const fetchData = async () => {
            setIsLoading(true);
            try {
                const q = query(collection(db, 'inventoryLogs'), where('projectId', '==', projectSlug));
                const snapshot = await getDocs(q);
                const logs = snapshot.docs.map(doc => ({ ...doc.data() } as InventoryLog));
                setInventoryLogs(logs);
            } catch (error) {
                console.error("Error fetching data:", error);
                toast({ title: "Error", description: "Failed to fetch inventory data.", variant: "destructive" });
            }
            setIsLoading(false);
        };
        fetchData();
    }, [projectSlug, toast]);

    const ageingReportData = useMemo(() => {
        const itemBalances: Record<string, AgeingData> = {};
        const now = new Date();

        // Process only GRNs with available quantity to determine stock age and value
        inventoryLogs
          .filter(log => log.transactionType === 'Goods Receipt' && log.availableQuantity > 0)
          .forEach(log => {
            if (!itemBalances[log.itemId]) {
                itemBalances[log.itemId] = {
                    itemName: log.itemName,
                    unit: log.unit,
                    '0-30': { quantity: 0, value: 0 },
                    '31-60': { quantity: 0, value: 0 },
                    '61-90': { quantity: 0, value: 0 },
                    '91-180': { quantity: 0, value: 0 },
                    '181-365': { quantity: 0, value: 0 },
                    '365+': { quantity: 0, value: 0 },
                    totalQuantity: 0,
                    totalValue: 0,
                };
            }

            const age = differenceInDays(now, log.date.toDate());
            let bracket: keyof Omit<AgeingData, 'itemName' | 'unit' | 'totalQuantity' | 'totalValue'>;

            if (age <= 30) bracket = '0-30';
            else if (age <= 60) bracket = '31-60';
            else if (age <= 90) bracket = '61-90';
            else if (age <= 180) bracket = '91-180';
            else if (age <= 365) bracket = '181-365';
            else bracket = '365+';
            
            const quantityInBracket = log.availableQuantity;
            const valueInBracket = quantityInBracket * (log.cost || 0);

            itemBalances[log.itemId][bracket].quantity += quantityInBracket;
            itemBalances[log.itemId][bracket].value += valueInBracket;
        });

        // Calculate totals for each item
        Object.values(itemBalances).forEach(item => {
            item.totalQuantity = ageBrackets.reduce((sum, bracket) => sum + item[bracket].quantity, 0);
            item.totalValue = ageBrackets.reduce((sum, bracket) => sum + item[bracket].value, 0);
        });

        return Object.values(itemBalances).filter(item => item.totalQuantity > 0);

    }, [inventoryLogs]);
    
    const formatValue = (value: number) => {
      if (value === 0) return '-';
      return value.toLocaleString('en-IN');
    }
    
     const formatCurrency = (amount: number) => {
        if (amount === 0) return '-';
        return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);
    };

    return (
        <div className="w-full">
            <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Link href={`/store-stock-management/${projectSlug}/reports`}>
                      <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
                    </Link>
                    <h1 className="text-2xl font-bold">Inventory Ageing Report</h1>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Ageing Summary</CardTitle>
                    <CardDescription>Breakdown of inventory stock by age in days.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead rowSpan={2} className="align-bottom">Item Name</TableHead>
                                <TableHead rowSpan={2} className="align-bottom">Unit</TableHead>
                                {ageBrackets.map(bracket => (
                                    <TableHead key={bracket} colSpan={2} className="text-center border-l">{bracket} days</TableHead>
                                ))}
                                <TableHead colSpan={2} className="text-center font-bold border-l">Total Balance</TableHead>
                            </TableRow>
                            <TableRow>
                                {ageBrackets.map(bracket => (
                                    <Fragment key={bracket}>
                                        <TableHead className="text-right border-l">Qty</TableHead>
                                        <TableHead className="text-right">Value</TableHead>
                                    </Fragment>
                                ))}
                                <TableHead className="text-right border-l">Qty</TableHead>
                                <TableHead className="text-right">Value</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                Array.from({ length: 5 }).map((_, i) => (
                                    <TableRow key={i}>
                                        <TableCell colSpan={16}><Skeleton className="h-8 w-full" /></TableCell>
                                    </TableRow>
                                ))
                            ) : ageingReportData.length > 0 ? (
                                ageingReportData.map((item, i) => (
                                    <TableRow key={i}>
                                        <TableCell>{item.itemName}</TableCell>
                                        <TableCell>{item.unit}</TableCell>
                                        {ageBrackets.map(bracket => (
                                            <Fragment key={bracket}>
                                                <TableCell className="text-right border-l">{formatValue(item[bracket].quantity)}</TableCell>
                                                <TableCell className="text-right">{formatCurrency(item[bracket].value)}</TableCell>
                                            </Fragment>
                                        ))}
                                        <TableCell className="text-right font-bold border-l">{formatValue(item.totalQuantity)}</TableCell>
                                        <TableCell className="text-right font-bold">{formatCurrency(item.totalValue)}</TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={16} className="text-center h-24">No inventory data to display.</TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}
