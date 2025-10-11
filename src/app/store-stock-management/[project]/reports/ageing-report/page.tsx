
'use client';

import { useState, useEffect, useMemo, Fragment } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';
import type { InventoryLog } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { differenceInDays } from 'date-fns';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface AgeingBucket {
    quantity: number;
    value: number;
}

interface AgeingData {
    itemName: string;
    unit: string;
    buckets: Record<string, AgeingBucket>;
    totalQuantity: number;
    totalValue: number;
}

const BUCKET_PRESETS = {
  monthly: [
    { label: '0-30', from: 0, to: 30 },
    { label: '31-60', from: 31, to: 60 },
    { label: '61-90', from: 61, to: 90 },
    { label: '91-180', from: 91, to: 180 },
    { label: '181-365', from: 181, to: 365 },
    { label: '365+', from: 366, to: Infinity },
  ],
  quarterly: [
    { label: '0-90', from: 0, to: 90 },
    { label: '91-180', from: 91, to: 180 },
    { label: '181-270', from: 181, to: 270 },
    { label: '271-365', from: 271, to: 365 },
    { label: '365+', from: 366, to: Infinity },
  ],
  yearly: [
    { label: '0-365', from: 0, to: 365 },
    { label: '1-2 Years', from: 366, to: 730 },
    { label: '2-3 Years', from: 731, to: 1095 },
    { label: '3+ Years', from: 1096, to: Infinity },
  ]
};

type Preset = keyof typeof BUCKET_PRESETS;

export default function AgeingReportPage() {
    const { toast } = useToast();
    const params = useParams();
    const projectSlug = params.project as string;
    const [inventoryLogs, setInventoryLogs] = useState<InventoryLog[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [activePreset, setActivePreset] = useState<Preset>('monthly');

    const currentBuckets = BUCKET_PRESETS[activePreset];

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

        inventoryLogs
          .filter(log => log.transactionType === 'Goods Receipt' && log.availableQuantity > 0)
          .forEach(log => {
            if (!itemBalances[log.itemId]) {
                const initialBuckets: Record<string, AgeingBucket> = {};
                currentBuckets.forEach(bucket => {
                    initialBuckets[bucket.label] = { quantity: 0, value: 0 };
                });
                itemBalances[log.itemId] = {
                    itemName: log.itemName,
                    unit: log.unit,
                    buckets: initialBuckets,
                    totalQuantity: 0,
                    totalValue: 0,
                };
            }

            const age = differenceInDays(now, log.date.toDate());
            
            const bucket = currentBuckets.find(b => age >= b.from && age <= b.to);
            if(!bucket) return;
            
            const bracket = bucket.label;
            
            const quantityInBracket = log.availableQuantity;
            const valueInBracket = quantityInBracket * (log.cost || 0);

            itemBalances[log.itemId].buckets[bracket].quantity += quantityInBracket;
            itemBalances[log.itemId].buckets[bracket].value += valueInBracket;
        });

        Object.values(itemBalances).forEach(item => {
            item.totalQuantity = Object.values(item.buckets).reduce((sum, bucket) => sum + bucket.quantity, 0);
            item.totalValue = Object.values(item.buckets).reduce((sum, bucket) => sum + bucket.value, 0);
        });

        return Object.values(itemBalances).filter(item => item.totalQuantity > 0);

    }, [inventoryLogs, currentBuckets]);
    
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
                    <CardDescription>Breakdown of inventory stock by age. Select a preset to change the view.</CardDescription>
                    <div className="pt-4">
                        <Label>Report Presets</Label>
                        <Select value={activePreset} onValueChange={(value) => setActivePreset(value as Preset)}>
                            <SelectTrigger className="w-[180px]">
                                <SelectValue placeholder="Select a preset" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="monthly">Monthly</SelectItem>
                                <SelectItem value="quarterly">Quarterly</SelectItem>
                                <SelectItem value="yearly">Yearly</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead rowSpan={2} className="align-bottom">Item Name</TableHead>
                                <TableHead rowSpan={2} className="align-bottom">Unit</TableHead>
                                {currentBuckets.map(bucket => (
                                    <TableHead key={bucket.label} colSpan={2} className="text-center border-l">{bucket.label}{activePreset !== 'yearly' && ' days'}</TableHead>
                                ))}
                                <TableHead colSpan={2} className="text-center font-bold border-l">Total Balance</TableHead>
                            </TableRow>
                            <TableRow>
                                {currentBuckets.map(bucket => (
                                    <Fragment key={bucket.label}>
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
                                        <TableCell colSpan={4 + currentBuckets.length * 2}><Skeleton className="h-8 w-full" /></TableCell>
                                    </TableRow>
                                ))
                            ) : ageingReportData.length > 0 ? (
                                ageingReportData.map((item, i) => (
                                    <TableRow key={i}>
                                        <TableCell>{item.itemName}</TableCell>
                                        <TableCell>{item.unit}</TableCell>
                                        {currentBuckets.map(bucket => (
                                            <Fragment key={bucket.label}>
                                                <TableCell className="text-right border-l">{formatValue(item.buckets[bucket.label].quantity)}</TableCell>
                                                <TableCell className="text-right">{formatCurrency(item.buckets[bucket.label].value)}</TableCell>
                                            </Fragment>
                                        ))}
                                        <TableCell className="text-right font-bold border-l">{formatValue(item.totalQuantity)}</TableCell>
                                        <TableCell className="text-right font-bold">{formatCurrency(item.totalValue)}</TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={4 + currentBuckets.length * 2} className="text-center h-24">No inventory data to display.</TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}
