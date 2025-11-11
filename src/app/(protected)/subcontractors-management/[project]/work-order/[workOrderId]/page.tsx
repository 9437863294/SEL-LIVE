
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
import type { WorkOrder, WorkOrderItem, BoqItem, Project, JmcEntry, Bill } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';

type EnrichedWorkOrderItem = WorkOrderItem & {
    boqQty: string;
    boqRate: string;
    totalJmcCertifiedQty: number;
    totalBilledQty: number;
};

export default function WorkOrderDetailsPage() {
    const params = useParams();
    const router = useRouter();
    const { project: projectSlug, workOrderId } = params as { project: string, workOrderId: string };
    const { toast } = useToast();

    const [workOrder, setWorkOrder] = useState<WorkOrder | null>(null);
    const [enrichedItems, setEnrichedItems] = useState<EnrichedWorkOrderItem[]>([]);
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
                const jmcQuery = query(collection(db, 'projects', projectData.id, 'jmcEntries'));
                const billsQuery = query(collection(db, 'projects', projectData.id, 'bills'));

                const [woDocSnap, jmcSnap, billsSnap] = await Promise.all([
                    getDoc(woDocRef),
                    getDocs(jmcQuery),
                    getDocs(billsSnap)
                ]);


                if (!woDocSnap.exists()) {
                    toast({ title: 'Work Order not found', variant: 'destructive' });
                    return notFound();
                }

                const woData = { id: woDocSnap.id, ...woDocSnap.data() } as WorkOrder;
                setWorkOrder(woData);

                const jmcEntries = jmcSnap.docs.map(doc => doc.data() as JmcEntry);
                const certifiedQtyMap = new Map<string, number>();

                jmcEntries.forEach(entry => {
                    entry.items.forEach(item => {
                        const currentQty = certifiedQtyMap.get(item.boqSlNo) || 0;
                        certifiedQtyMap.set(item.boqSlNo, currentQty + (item.certifiedQty || 0));
                    });
                });

                const bills = billsSnap.docs.map(doc => doc.data() as Bill);
                const billedQtyMap = new Map<string, number>();
                bills.forEach(bill => {
                    bill.items.forEach(item => {
                        // Assuming jmcItemId holds the work order item id
                        const currentQty = billedQtyMap.get(item.jmcItemId) || 0;
                        billedQtyMap.set(item.jmcItemId, currentQty + (parseFloat(item.billedQty) || 0));
                    });
                });
                
                const boqItemIds = woData.items.map(item => item.boqItemId);
                if (boqItemIds.length > 0) {
                    const boqQuery = query(collection(db, 'projects', projectData.id, 'boqItems'), where('__name__', 'in', boqItemIds));
                    const boqSnapshot = await getDocs(boqQuery);
                    const boqItemsMap = new Map(boqSnapshot.docs.map(doc => [doc.id, doc.data() as BoqItem]));

                    const enriched = woData.items.map(item => {
                        const boqItem = boqItemsMap.get(item.boqItemId);
                        const rateKey = boqItem ? Object.keys(boqItem).find(key => key.toLowerCase().includes('rate')) || 'rate' : 'rate';
                        const totalJmcCertifiedQty = certifiedQtyMap.get(item.boqSlNo || '') || 0;
                        const totalBilledQty = billedQtyMap.get(item.id) || 0;
                        
                        return {
                            ...item,
                            boqQty: boqItem ? String(boqItem['QTY'] || '0') : 'N/A',
                            boqRate: boqItem && rateKey ? String((boqItem as any)[rateKey] || '0') : 'N/A',
                            totalJmcCertifiedQty,
                            totalBilledQty,
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

    return (
        <div className="w-full px-4 sm:px-6 lg:px-8">
            <div className="mb-6 flex items-center gap-2">
                <Link href={`/subcontractors-management/${projectSlug}/work-order`}>
                    <Button variant="ghost" size="icon">
                        <ArrowLeft className="h-6 w-6" />
                    </Button>
                </Link>
                <div>
                    <h1 className="text-2xl font-bold">Work Order Details</h1>
                    <p className="text-sm text-muted-foreground">WO No: {workOrder.workOrderNo}</p>
                </div>
            </div>

            <Card className="mb-6">
                <CardHeader>
                    <CardTitle>Summary</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                        <p className="text-sm text-muted-foreground">Date</p>
                        <p className="font-medium">{formatDate(workOrder.date)}</p>
                    </div>
                     <div>
                        <p className="text-sm text-muted-foreground">Subcontractor</p>
                        <p className="font-medium">{workOrder.subcontractorName}</p>
                    </div>
                     <div>
                        <p className="text-sm text-muted-foreground">Total Amount</p>
                        <p className="font-bold text-lg">{formatCurrency(workOrder.totalAmount)}</p>
                    </div>
                </CardContent>
            </Card>

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
