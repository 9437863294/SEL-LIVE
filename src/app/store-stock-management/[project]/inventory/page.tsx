
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

        const stockMovements = new Map<string, { stockIn: number; stockOut: number }>();

        inventoryLogs.forEach(log => {
            const current = stockMovements.get(log.itemId) || { stockIn: 0, stockOut: 0 };
            if (log.transactionType === 'Goods Receipt') {
                current.stockIn += log.quantity;
            } else if (log.transactionType === 'Goods Issue') {
                current.stockOut += log.quantity;
            }
            stockMovements.set(log.itemId, current);
        });
        
        const boqWithMainItems = boqItems.filter(item => item['Sl No']);

        return boqWithMainItems.map(item => {
            const movements = stockMovements.get(item.id) || { stockIn: 0, stockOut: 0 };
            const subItemMovements = (item.bom || []).reduce((acc, bomItem) => {
                const subMovements = stockMovements.get(`bom-${item.id}-${bomItem.markNo}`) || { stockIn: 0, stockOut: 0 };
                acc.stockIn += subMovements.stockIn;
                acc.stockOut += subMovements.stockOut;
                return acc;
            }, { stockIn: 0, stockOut: 0 });

            const stockIn = movements.stockIn + subItemMovements.stockIn;
            const stockOut = movements.stockOut + subItemMovements.stockOut;

            return {
                id: item.id,
                slNo: String(item['Sl No'] || item['SL. No.'] || ''),
                description: String(item['Description'] || item['DESCRIPTION OF ITEMS'] || ''),
                boqQty: Number(item['BOQ QTY'] || item['Total Qty'] || 0),
                unit: String(item['UNIT'] || item['UNITS'] || 'N/A'),
                stockIn: stockIn,
                stockOut: stockOut,
                balance: stockIn - stockOut,
            };
        }).sort((a,b) => parseFloat(a.slNo) - parseFloat(b.slNo));

    }, [boqItems, inventoryLogs, isLoading]);

    return (
        <div>
            <h1 className="text-3xl font-bold mb-6">Inventory Status</h1>
            <Card>
                <CardHeader>
                    <CardTitle>Stock Overview</CardTitle>
                    <CardDescription>A summary of your inventory based on BOQ items.</CardDescription>
                </CardHeader>
                <CardContent>
                    <ScrollArea className="h-[calc(100vh-22rem)]">
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
                                            No inventory data to display for this project.
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
