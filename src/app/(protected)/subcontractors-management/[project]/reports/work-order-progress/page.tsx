
'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where, collectionGroup } from 'firebase/firestore';
import type { WorkOrder, Bill, Project } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';

interface EnrichedWorkOrder extends WorkOrder {
    totalBilled: number;
    progress: number;
}

const slugify = (text: string) => {
  if (!text) return '';
  return text.toString().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

export default function WorkOrderProgressReport() {
    const params = useParams();
    const router = useRouter();
    const { project: projectSlug } = params as { project: string };
    const { toast } = useToast();

    const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
    const [bills, setBills] = useState<Bill[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        const fetchData = async () => {
            if (!projectSlug) return;
            setIsLoading(true);

            try {
                const projectsQuery = query(collection(db, 'projects'));
                const projectsSnapshot = await getDocs(projectsQuery);
                const projectData = projectsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)).find(p => slugify(p.projectName) === projectSlug);

                if (!projectData) {
                    toast({ title: 'Project not found', variant: 'destructive' });
                    setIsLoading(false);
                    return;
                }
                
                const woQuery = query(collectionGroup(db, 'workOrders'));
                const billsQuery = query(collectionGroup(db, 'bills'));

                const [woSnap, billsSnap] = await Promise.all([
                    getDocs(woQuery),
                    getDocs(billsQuery),
                ]);

                setWorkOrders(woSnap.docs.map(d => ({ id: d.id, ...d.data() } as WorkOrder)).filter(wo => wo.projectId === projectData.id));
                setBills(billsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Bill)).filter(b => b.projectId === projectData.id));

            } catch (error: any) {
                console.error("Error fetching report data:", error);
                 if (error.code === 'failed-precondition') {
                    toast({
                        title: 'Database Index Required',
                        description: "The query for this report requires a custom index. Please create it in the Firebase console for the collection group.",
                        variant: 'destructive',
                        duration: 10000,
                    });
                } else {
                    toast({ title: "Error", description: "Failed to load report data.", variant: "destructive" });
                }
            } finally {
                setIsLoading(false);
            }
        };
        fetchData();
    }, [projectSlug, toast]);

    const enrichedWorkOrders = useMemo(() => {
        return workOrders.map(wo => {
            const woBills = bills.filter(bill => bill.workOrderId === wo.id && !bill.isRetentionBill);
            const totalBilled = woBills.reduce((sum, bill) => sum + (bill.netPayable || 0), 0);
            const progress = wo.totalAmount > 0 ? (totalBilled / wo.totalAmount) * 100 : 0;
            return {
                ...wo,
                totalBilled,
                progress,
            };
        }).filter(wo => 
            wo.workOrderNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
            wo.subcontractorName.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [workOrders, bills, searchTerm]);
    
    const formatCurrency = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);

    return (
        <div className="w-full px-4 sm:px-6 lg:px-8">
            <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Link href={`/subcontractors-management/${projectSlug}/reports`}>
                        <Button variant="ghost" size="icon">
                            <ArrowLeft className="h-6 w-6" />
                        </Button>
                    </Link>
                    <h1 className="text-2xl font-bold">Work Order Progress Report</h1>
                </div>
                <div className="relative w-full max-w-sm">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input 
                        placeholder="Search by WO No or Contractor..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        className="pl-8"
                    />
                </div>
            </div>

            <Card>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Work Order ID</TableHead>
                                <TableHead>Contractor</TableHead>
                                <TableHead>WO Value</TableHead>
                                <TableHead>Total Billed</TableHead>
                                <TableHead>Progress (%)</TableHead>
                                <TableHead>Status</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                Array.from({ length: 5 }).map((_, i) => (
                                    <TableRow key={i}>
                                        <TableCell colSpan={6}><Skeleton className="h-6 w-full" /></TableCell>
                                    </TableRow>
                                ))
                            ) : enrichedWorkOrders.length > 0 ? (
                                enrichedWorkOrders.map(wo => (
                                    <TableRow key={wo.id} onClick={() => router.push(`/subcontractors-management/${projectSlug}/work-order/${wo.id}`)} className="cursor-pointer">
                                        <TableCell className="font-medium text-primary hover:underline">{wo.workOrderNo}</TableCell>
                                        <TableCell>{wo.subcontractorName}</TableCell>
                                        <TableCell>{formatCurrency(wo.totalAmount)}</TableCell>
                                        <TableCell>{formatCurrency(wo.totalBilled)}</TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <Progress value={wo.progress} className="w-24 h-2" />
                                                <span>{wo.progress.toFixed(1)}%</span>
                                            </div>
                                        </TableCell>
                                        <TableCell>Active</TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={6} className="text-center h-24">
                                        No work orders found.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}
