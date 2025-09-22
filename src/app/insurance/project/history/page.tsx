
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import type { ProjectInsurancePolicy, ProjectPolicyRenewal, User } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';

type HistoryEvent = {
    id: string;
    date: Date;
    policyNo: string;
    assetName: string;
    eventType: 'Policy Created' | 'Policy Renewed';
    user: string;
    details: string;
};

export default function ProjectInsuranceHistoryPage() {
    const { toast } = useToast();
    const [events, setEvents] = useState<HistoryEvent[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchHistory = async () => {
            setIsLoading(true);
            try {
                const [policiesSnap, usersSnap] = await Promise.all([
                    getDocs(query(collection(db, 'project_insurance_policies'), orderBy('insurance_start_date', 'desc'))),
                    getDocs(collection(db, 'users'))
                ]);

                const policies = policiesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProjectInsurancePolicy));
                const usersMap = new Map(usersSnap.docs.map(doc => [doc.id, (doc.data() as User).name]));

                const historyEvents: HistoryEvent[] = [];

                for (const policy of policies) {
                    // Add policy creation event
                    if(policy.insurance_start_date) {
                         historyEvents.push({
                            id: `create-${policy.id}`,
                            date: policy.insurance_start_date.toDate(),
                            policyNo: policy.policy_no,
                            assetName: policy.assetName,
                            eventType: 'Policy Created',
                            user: 'System/Initial',
                            details: `Sum Insured: ${formatCurrency(policy.sum_insured)}`,
                        });
                    }

                    // Add renewal events from subcollection
                    const renewalsSnap = await getDocs(collection(db, 'project_insurance_policies', policy.id, 'history'));
                    renewalsSnap.forEach(renewalDoc => {
                        const renewal = renewalDoc.data() as ProjectPolicyRenewal;
                        historyEvents.push({
                            id: `renew-${renewalDoc.id}`,
                            date: renewal.renewalDate.toDate(),
                            policyNo: policy.policy_no,
                            assetName: policy.assetName,
                            eventType: 'Policy Renewed',
                            user: usersMap.get(renewal.renewedBy) || 'Unknown User',
                            details: `Renewed premium: ${formatCurrency(renewal.premium)}`,
                        });
                    });
                }
                
                historyEvents.sort((a,b) => b.date.getTime() - a.date.getTime());
                setEvents(historyEvents);

            } catch (error) {
                console.error("Error fetching history:", error);
                toast({ title: 'Error', description: 'Failed to fetch project insurance history.', variant: 'destructive' });
            }
            setIsLoading(false);
        };
        fetchHistory();
    }, [toast]);

    const formatCurrency = (amount: number) => {
        if (typeof amount !== 'number') return 'N/A';
        return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
    };

    return (
        <div className="w-full">
            <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Link href="/insurance/project">
                        <Button variant="ghost" size="icon">
                            <ArrowLeft className="h-6 w-6" />
                        </Button>
                    </Link>
                    <div>
                        <h1 className="text-xl font-bold">Project Insurance History</h1>
                        <p className="text-sm text-muted-foreground">A complete log of all project insurance activities.</p>
                    </div>
                </div>
            </div>
            
            <Card>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Date</TableHead>
                                <TableHead>Asset Name</TableHead>
                                <TableHead>Policy No.</TableHead>
                                <TableHead>Event</TableHead>
                                <TableHead>User</TableHead>
                                <TableHead>Details</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                Array.from({ length: 10 }).map((_, i) => (
                                    <TableRow key={i}>
                                        <TableCell colSpan={6}><Skeleton className="h-8" /></TableCell>
                                    </TableRow>
                                ))
                            ) : events.length > 0 ? (
                                events.map(event => (
                                    <TableRow key={event.id}>
                                        <TableCell>{format(event.date, 'dd MMM, yyyy')}</TableCell>
                                        <TableCell>{event.assetName}</TableCell>
                                        <TableCell>{event.policyNo}</TableCell>
                                        <TableCell>{event.eventType}</TableCell>
                                        <TableCell>{event.user}</TableCell>
                                        <TableCell>{event.details}</TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={6} className="text-center h-24">No history found.</TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    )
}
