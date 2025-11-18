
'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useRouter, notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/firebase';
import { collection, doc, getDoc, getDocs, query, collectionGroup, where } from 'firebase/firestore';
import type { WorkOrder, WorkOrderItem, BoqItem, Project, JmcEntry, Bill, ProformaBill } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import { Progress } from '@/components/ui/progress';

type EnrichedWorkOrderItem = WorkOrderItem & {
    boqQty: string;
    boqRate: string;
    totalJmcCertifiedQty: number;
    totalBilledQty: number;
    scope1?: string;
    scope2?: string;
};

const getScope1 = (item: any): string => String(item?.scope1 || item?.['Scope 1'] || '').trim();
const getScope2 = (item: any): string => String(item?.scope2 || item?.['Scope 2'] || '').trim();
const getBoqSlNo = (item: any): string => String(item?.boqSlNo ?? item?.['BOQ SL No'] ?? item?.['SL. No.'] ?? '').trim();
const compositeKey = (item: any) => `${getScope1(item)}_${getScope2(item)}_${getBoqSlNo(item)}`;

export default function WorkOrderDetailsPage() {
    const params = useParams();
    const router = useRouter();
    const { project: projectSlug, workOrderId } = params as { project: string, workOrderId: string };
    const { toast } = useToast();

    const [workOrder, setWorkOrder] = useState<WorkOrder | null>(null);
    const [enrichedItems, setEnrichedItems] = useState<EnrichedWorkOrderItem[]>([]);
    const [financials, setFinancials] = useState({
        totalAdvanceTaken: 0,
        totalAdvanceDeducted: 0,
        totalBilled: 0,
    });
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchWorkOrderDetails = async () => {
            if (!workOrderId) return;
            setIsLoading(true);

            try {
                // Find the WO first to get its project ID
                const allWoSnapshot = await getDocs(collectionGroup(db, 'workOrders'));
                const woDoc = allWoSnapshot.docs.find(doc => doc.id === workOrderId);

                if (!woDoc || !woDoc.exists()) {
                    toast({ title: 'Work Order not found', variant: 'destructive' });
                    return notFound();
                }

                const woData = { id: woDoc.id, ...woDoc.data() } as WorkOrder;
                setWorkOrder(woData);

                const projectId = woData.projectId;
                if (!projectId) {
                    throw new Error("Work order is missing project information.");
                }

                // Fetch related data without filters
                const [jmcSnap, billsSnap, proformaSnap, boqSnap] = await Promise.all([
                    getDocs(collectionGroup(db, 'jmcEntries')),
                    getDocs(collectionGroup(db, 'bills')),
                    getDocs(collectionGroup(db, 'proformaBills')),
                    getDocs(query(collection(db, 'projects', projectId, 'boqItems'))),
                ]);

                // Client-side filtering
                const jmcEntries = jmcSnap.docs.map(doc => doc.data() as JmcEntry).filter(entry => entry.projectId === projectId);
                const allBills = billsSnap.docs.map(doc => doc.data() as Bill);
                const bills = allBills.filter(bill => bill.workOrderId === workOrderId);
                const proformaBills = proformaSnap.docs.map(doc => doc.data() as ProformaBill).filter(pb => pb.workOrderId === workOrderId);
                
                const jmcCertifiedQtyMap = new Map<string, number>();
                jmcEntries.flatMap(entry => entry.items || []).forEach(jmcItem => {
                    const key = compositeKey(jmcItem);
                    const currentQty = jmcCertifiedQtyMap.get(key) || 0;
                    jmcCertifiedQtyMap.set(key, currentQty + (jmcItem.certifiedQty || 0));
                });

                const billedQtyMap = new Map<string, number>();
                let totalBilledAmount = 0;
                let totalAdvanceDeducted = 0;

                bills.forEach(bill => {
                    if (!bill.isRetentionBill) {
                        totalBilledAmount += bill.netPayable || 0;
                    }
                    (bill.advanceDeductions || []).forEach(deduction => {
                        totalAdvanceDeducted += deduction.amount;
                    });
                    bill.items.forEach(item => {
                        const currentQty = billedQtyMap.get(item.jmcItemId) || 0;
                        billedQtyMap.set(item.jmcItemId, currentQty + (parseFloat(item.billedQty) || 0));
                    });
                });

                const totalAdvanceTaken = proformaBills.reduce((sum, bill) => sum + bill.payableAmount, 0);
                setFinancials({ totalAdvanceTaken, totalAdvanceDeducted, totalBilled: totalBilledAmount });

                const boqItemsMap = new Map<string, BoqItem>();
                boqSnap.forEach(doc => {
                    boqItemsMap.set(doc.id, {id: doc.id, ...doc.data()} as BoqItem);
                });
                
                const enriched = woData.items.map(item => {
                    const boqItem = boqItemsMap.get(item.boqItemId);
                    const rateKey = boqItem ? Object.keys(boqItem).find(key => key.toLowerCase().includes('rate')) || 'rate' : 'rate';
                    const key = compositeKey(item);
                    
                    return {
                        ...item,
                        boqQty: boqItem ? String((boqItem as any)['QTY'] || '0') : 'N/A',
                        boqRate: boqItem && rateKey ? String((boqItem as any)[rateKey] || '0') : 'N/A',
                        totalJmcCertifiedQty: jmcCertifiedQtyMap.get(key) || 0,
                        totalBilledQty: billedQtyMap.get(item.id) || 0,
                        scope1: getScope1(item),
                        scope2: getScope2(item),
                    };
                });
                setEnrichedItems(enriched);
            } catch (error) {
                console.error("Error fetching work order:", error);
                toast({ title: "Error", description: "Failed to load work order details.", variant: "destructive" });
            } finally {
                setIsLoading(false);
            }
        };
        
        fetchWorkOrderDetails();
    }, [projectSlug, workOrderId, toast]);


    const formatCurrency = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
    const formatDate = (date: any) => date?.toDate ? format(date.toDate(), 'dd MMM, yyyy') : 'N/A';

    if (isLoading) {
        return (
            <div className="w-full px-4 sm:px-6 lg:px-8">
                <Skeleton className="h-10 w-96 mb-6" />
                <Skeleton className="h-[500px] w-full" />
            </div>
        );
    }
    
    if (!workOrder) {
        return (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <h2 className="text-2xl font-semibold">Work Order Not Found</h2>
            <p className="text-muted-foreground mt-2">The requested work order could not be located.</p>
            <Button asChild className="mt-4">
              <Link href={`/subcontractors-management/${projectSlug}/work-order`}>Back to Work Orders</Link>
            </Button>
          </div>
        );
    }
    
    const progressPercentage = workOrder.totalAmount > 0 ? (financials.totalBilled / workOrder.totalAmount) * 100 : 0;
    const netAdvanceBalance = financials.totalAdvanceTaken - financials.totalAdvanceDeducted;


    return (
        <div className="w-full px-4 sm:px-6 lg:px-8">
            <div className="mb-6 flex items-center gap-2">
                <Link href={`/subcontractors-management/${projectSlug}/reports/work-order-progress`}>
                    <Button variant="ghost" size="icon">
                        <ArrowLeft className="h-6 w-6" />
                    </Button>
                </Link>
                <div>
                    <h1 className="text-2xl font-bold">Work Order Details</h1>
                    <p className="text-sm text-muted-foreground">WO No: {workOrder.workOrderNo}</p>
                </div>
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                <Card>
                    <CardHeader><CardTitle>Financial Summary</CardTitle></CardHeader>
                    <CardContent className="space-y-3 text-sm">
                        <div className="flex justify-between"><span>Work Order Value</span><span className="font-semibold">{formatCurrency(workOrder.totalAmount)}</span></div>
                         <div className="flex justify-between"><span>Total Billed Amount</span><span className="font-semibold">{formatCurrency(financials.totalBilled)}</span></div>
                        <div className="flex justify-between"><span>Total Advance Taken</span><span className="font-semibold">{formatCurrency(financials.totalAdvanceTaken)}</span></div>
                        <div className="flex justify-between"><span>Total Advance Deducted</span><span className="font-semibold text-destructive">-{formatCurrency(financials.totalAdvanceDeducted)}</span></div>
                        <div className="flex justify-between font-bold border-t pt-2"><span>Net Advance Balance</span><span>{formatCurrency(netAdvanceBalance)}</span></div>
                    </CardContent>
                </Card>
                 <Card>
                    <CardHeader><CardTitle>Billing & Progress</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                         <div className="flex justify-between text-sm"><span>Total Billed Amount</span><span className="font-semibold">{formatCurrency(financials.totalBilled)}</span></div>
                         <div>
                            <div className="flex justify-between items-center mb-1">
                               <p className="text-sm font-medium">Financial Progress</p>
                               <p className="text-sm font-semibold">{progressPercentage.toFixed(2)}%</p>
                            </div>
                            <Progress value={progressPercentage} />
                         </div>
                    </CardContent>
                </Card>
            </div>

             <Card>
                <CardHeader>
                    <CardTitle>Work Order Items</CardTitle>
                </CardHeader>
                <CardContent>
                     <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>BOQ Sl.No</TableHead>
                                    <TableHead>Description</TableHead>
                                    <TableHead>Unit</TableHead>
                                    <TableHead>BOQ Qty</TableHead>
                                    <TableHead>BOQ Rate</TableHead>
                                    <TableHead>Order Qty</TableHead>
                                    <TableHead>JMC Certified Qty</TableHead>
                                    <TableHead>Billed Qty</TableHead>
                                    <TableHead>Order Rate</TableHead>
                                    <TableHead>Total Amount</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {enrichedItems.map(item => (
                                    <TableRow key={item.id}>
                                        <TableCell>{item.boqSlNo}</TableCell>
                                        <TableCell>{item.description}</TableCell>
                                        <TableCell>{item.unit}</TableCell>
                                        <TableCell>{item.boqQty}</TableCell>
                                        <TableCell>{formatCurrency(parseFloat(item.boqRate))}</TableCell>
                                        <TableCell>{item.orderQty}</TableCell>
                                        <TableCell className="font-medium text-blue-600">{item.totalJmcCertifiedQty}</TableCell>
                                        <TableCell className="font-medium text-green-600">{item.totalBilledQty}</TableCell>
                                        <TableCell>{formatCurrency(item.rate)}</TableCell>
                                        <TableCell>{formatCurrency(item.totalAmount)}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
             </Card>
        </div>
    );
}

