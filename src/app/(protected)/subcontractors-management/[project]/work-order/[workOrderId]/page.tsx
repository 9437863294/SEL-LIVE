
'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter, notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/firebase';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
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

const getScope1 = (item: any): string => item?.scope1 || item?.['Scope 1'] || '';
const getScope2 = (item: any): string => item?.scope2 || item?.['Scope 2'] || '';


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
        const fetchWorkOrder = async () => {
            if (!projectSlug || !workOrderId) return;
            setIsLoading(true);

            try {
                const projectsQuery = query(collection(db, 'projects'));
                const projectsSnapshot = await getDocs(projectsQuery);
                const slugify = (text: string) => text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');
                const projectData = projectsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)).find(p => slugify(p.projectName) === projectSlug);

                if (!projectData) {
                    toast({ title: 'Project not found', variant: 'destructive' });
                    return notFound();
                }
                
                const woDocRef = doc(db, 'projects', projectData.id, 'workOrders', workOrderId);
                const [woDocSnap, jmcSnap, billsSnap, proformaSnap] = await Promise.all([
                    getDoc(woDocRef),
                    getDocs(query(collection(db, 'projects', projectData.id, 'jmcEntries'), where('woNo', '==', (await getDoc(woDocRef)).data()?.workOrderNo))),
                    getDocs(query(collection(db, 'projects', projectData.id, 'bills'), where('workOrderId', '==', workOrderId))),
                    getDocs(query(collection(db, 'projects', projectData.id, 'proformaBills'), where('workOrderId', '==', workOrderId))),
                ]);

                if (!woDocSnap.exists()) {
                    toast({ title: 'Work Order not found', variant: 'destructive' });
                    return notFound();
                }

                const woData = { id: woDocSnap.id, ...woDocSnap.data() } as WorkOrder;
                setWorkOrder(woData);

                const jmcEntries = jmcSnap.docs.map(doc => doc.data() as JmcEntry);
                
                const bills = billsSnap.docs.map(doc => doc.data() as Bill);
                const billedQtyMap = new Map<string, number>();
                let totalBilledAmount = 0;
                let totalAdvanceDeducted = 0;

                bills.forEach(bill => {
                    totalBilledAmount += bill.netPayable || 0;
                    (bill.advanceDeductions || []).forEach(deduction => {
                        totalAdvanceDeducted += deduction.amount;
                    });
                    bill.items.forEach(item => {
                        // Match on jmcItemId which refers to the WorkOrderItem ID
                        const currentQty = billedQtyMap.get(item.jmcItemId) || 0;
                        billedQtyMap.set(item.jmcItemId, currentQty + (parseFloat(item.billedQty) || 0));
                    });
                });
                
                const proformaBills = proformaSnap.docs.map(doc => doc.data() as ProformaBill);
                const totalAdvanceTaken = proformaBills.reduce((sum, bill) => sum + bill.payableAmount, 0);

                setFinancials({ totalAdvanceTaken, totalAdvanceDeducted, totalBilled: totalBilledAmount });

                const boqItemIds = woData.items.map(item => item.boqItemId);
                if (boqItemIds.length > 0) {
                    const boqQuery = query(collection(db, 'projects', projectData.id, 'boqItems'), where('__name__', 'in', boqItemIds));
                    const boqSnapshot = await getDocs(boqQuery);
                    const boqItemsMap = new Map(boqSnapshot.docs.map(doc => [doc.id, doc.data() as BoqItem]));

                    const enriched = woData.items.map(item => {
                        const boqItem = boqItemsMap.get(item.boqItemId);
                        const rateKey = boqItem ? Object.keys(boqItem).find(key => key.toLowerCase().includes('rate')) || 'rate' : 'rate';
                        
                        const itemScope1 = getScope1(item);
                        const itemScope2 = getScope2(item);
                        
                        const totalJmcCertifiedQty = jmcEntries
                            .flatMap(entry => entry.items)
                            .filter(jmcItem => 
                                jmcItem.boqSlNo === item.boqSlNo &&
                                getScope1(jmcItem) === itemScope1 &&
                                getScope2(jmcItem) === itemScope2
                            )
                            .reduce((sum, jmcItem) => sum + (jmcItem.certifiedQty || 0), 0);

                        const totalBilledQty = billedQtyMap.get(item.id) || 0;
                        
                        return {
                            ...item,
                            boqQty: boqItem ? String(boqItem['QTY'] || '0') : 'N/A',
                            boqRate: boqItem && rateKey ? String((boqItem as any)[rateKey] || '0') : 'N/A',
                            totalJmcCertifiedQty,
                            totalBilledQty,
                            scope1: itemScope1,
                            scope2: itemScope2,
                        };
                    });
                    setEnrichedItems(enriched);
                }

            } catch (error) {
                console.error("Error fetching work order:", error);
                toast({ title: "Error", description: "Failed to load work order details.", variant: "destructive" });
            } finally {
                setIsLoading(false);
            }
        };

        fetchWorkOrder();
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
        return <p>Work Order not found.</p>;
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
