
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

interface AgeingData {
    itemName: string;
    unit: string;
    '0-30': number;
    '31-60': number;
    '61-90': number;
    '91-180': number;
    '181-365': number;
    '365+': number;
    total: number;
}

const ageBrackets = ['0-30', '31-60', '61-90', '91-180', '181-365', '365+'];

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

        inventoryLogs.forEach(log => {
            if (!itemBalances[log.itemId]) {
                itemBalances[log.itemId] = {
                    itemName: log.itemName,
                    unit: log.unit,
                    '0-30': 0,
                    '31-60': 0,
                    '61-90': 0,
                    '91-180': 0,
                    '181-365': 0,
                    '365+': 0,
                    total: 0,
                };
            }

            const age = differenceInDays(now, log.date.toDate());
            let bracket: keyof Omit<AgeingData, 'itemName' | 'unit' | 'total'>;

            if (age <= 30) bracket = '0-30';
            else if (age <= 60) bracket = '31-60';
            else if (age <= 90) bracket = '61-90';
            else if (age <= 180) bracket = '91-180';
            else if (age <= 365) bracket = '181-365';
            else bracket = '365+';

            if (log.transactionType === 'Goods Receipt') {
                itemBalances[log.itemId][bracket] += log.availableQuantity;
            }
        });

        Object.values(itemBalances).forEach(item => {
            item.total = ageBrackets.reduce((sum, bracket) => sum + item[bracket as keyof Omit<AgeingData, 'itemName' | 'unit' | 'total'>], 0);
        });

        return Object.values(itemBalances).filter(item => item.total > 0);

    }, [inventoryLogs]);


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
                                <TableHead>Item Name</TableHead>
                                <TableHead>Unit</TableHead>
                                {ageBrackets.map(bracket => (
                                    <TableHead key={bracket} className="text-right">{bracket}</TableHead>
                                ))}
                                <TableHead className="text-right font-bold">Total Balance</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                Array.from({ length: 5 }).map((_, i) => (
                                    <TableRow key={i}>
                                        <TableCell colSpan={8}><Skeleton className="h-8 w-full" /></TableCell>
                                    </TableRow>
                                ))
                            ) : ageingReportData.length > 0 ? (
                                ageingReportData.map((item, i) => (
                                    <TableRow key={i}>
                                        <TableCell>{item.itemName}</TableCell>
                                        <TableCell>{item.unit}</TableCell>
                                        {ageBrackets.map(bracket => (
                                            <TableCell key={bracket} className="text-right">{item[bracket as keyof typeof item]}</TableCell>
                                        ))}
                                        <TableCell className="text-right font-bold">{item.total}</TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={8} className="text-center h-24">No inventory data to display.</TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}
