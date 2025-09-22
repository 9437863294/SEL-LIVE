
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import type { InsurancePolicy, PolicyRenewal, User } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';

type HistoryEvent = {
    id: string;
    date: Date;
    policyNo: string;
    policyHolder: string;
    eventType: 'Policy Created' | 'Premium Paid';
    user: string;
    details: string;
};

export default function PersonalInsuranceHistoryPage() {
    const { toast } = useToast();
    const [events, setEvents] = useState<HistoryEvent[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchHistory = async () => {
            setIsLoading(true);
            try {
                const [policiesSnap, usersSnap] = await Promise.all([
                    getDocs(query(collection(db, 'insurance_policies'), orderBy('date_of_comm', 'desc'))),
                    getDocs(collection(db, 'users'))
                ]);

                const policies = policiesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as InsurancePolicy));
                const usersMap = new Map(usersSnap.docs.map(doc => [doc.id, (doc.data() as User).name]));

                const historyEvents: HistoryEvent[] = [];

                for (const policy of policies) {
                    // Add policy creation event
                    if(policy.date_of_comm) {
                         historyEvents.push({
                            id: `create-${policy.id}`,
                            date: policy.date_of_comm.toDate(),
                            policyNo: policy.policy_no,
                            policyHolder: policy.insured_person,
                            eventType: 'Policy Created',
                            user: 'System/Initial', // Assuming we don't track creator yet
                            details: `Sum Insured: ${formatCurrency(policy.sum_insured)}`,
                        });
                    }

                    // Add renewal events
                    const renewalsSnap = await getDocs(collection(db, 'insurance_policies', policy.id, 'renewals'));
                    renewalsSnap.forEach(renewalDoc => {
                        const renewal = renewalDoc.data() as PolicyRenewal;
                        historyEvents.push({
                            id: `renew-${renewalDoc.id}`,
                            date: renewal.renewalDate.toDate(),
                            policyNo: policy.policy_no,
                            policyHolder: policy.insured_person,
                            eventType: 'Premium Paid',
                            user: usersMap.get(renewal.renewedBy) || 'Unknown User',
                            details: `Paid via ${renewal.paymentType}`,
                        });
                    });
                }
                
                historyEvents.sort((a,b) => b.date.getTime() - a.date.getTime());
                setEvents(historyEvents);

            } catch (error) {
                console.error("Error fetching history:", error);
                toast({ title: 'Error', description: 'Failed to fetch history.', variant: 'destructive' });
            }
            setIsLoading(false);
        };
        fetchHistory();
    }, [toast]);

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
    };

    return (
        <div className="w-full">
            <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Link href="/insurance/personal">
                        <Button variant="ghost" size="icon">
                            <ArrowLeft className="h-6 w-6" />
                        </Button>
                    </Link>
                    <div>
                        <h1 className="text-xl font-bold">Insurance History</h1>
                        <p className="text-sm text-muted-foreground">A complete log of all personal insurance activities.</p>
                    </div>
                </div>
            </div>
            
            <Card>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Date</TableHead>
                                <TableHead>Policy No.</TableHead>
                                <TableHead>Policy Holder</TableHead>
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
                                        <TableCell>{format(event.date, 'dd MMM, yyyy HH:mm')}</TableCell>
                                        <TableCell>{event.policyNo}</TableCell>
                                        <TableCell>{event.policyHolder}</TableCell>
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
