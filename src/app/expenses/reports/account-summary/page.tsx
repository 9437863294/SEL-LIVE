
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import type { AccountHead, SubAccountHead, ExpenseRequest } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';

interface SubHeadSummary {
    subHeadName: string;
    totalAmount: number;
    requestCount: number;
}

interface HeadSummary {
    headName: string;
    totalAmount: number;
    requestCount: number;
    subHeads: SubHeadSummary[];
}

export default function AccountSummaryPage() {
    const { toast } = useToast();
    const { can, isLoading: isAuthLoading } = useAuthorization();
    const [summary, setSummary] = useState<HeadSummary[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const canViewPage = can('View All', 'Expenses.Expense Requests');

    useEffect(() => {
        if (isAuthLoading) return;
        if (!canViewPage) {
            setIsLoading(false);
            return;
        }

        const fetchSummaryData = async () => {
            setIsLoading(true);
            try {
                const [headsSnap, subHeadsSnap, expensesSnap] = await Promise.all([
                    getDocs(collection(db, 'accountHeads')),
                    getDocs(collection(db, 'subAccountHeads')),
                    getDocs(collection(db, 'expenseRequests'))
                ]);

                const heads = headsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as AccountHead));
                const subHeads = subHeadsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as SubAccountHead));
                const expenses = expensesSnap.docs.map(doc => doc.data() as ExpenseRequest);
                
                const summaryData = heads.map(head => {
                    const relevantSubHeads = subHeads.filter(sh => sh.headId === head.id);
                    let headTotalAmount = 0;
                    let headRequestCount = 0;

                    const subHeadSummaries = relevantSubHeads.map(subHead => {
                        const subHeadExpenses = expenses.filter(exp => exp.subHeadOfAccount === subHead.name);
                        const totalAmount = subHeadExpenses.reduce((sum, exp) => sum + exp.amount, 0);
                        headTotalAmount += totalAmount;
                        headRequestCount += subHeadExpenses.length;
                        return {
                            subHeadName: subHead.name,
                            totalAmount: totalAmount,
                            requestCount: subHeadExpenses.length,
                        };
                    });
                    
                    return {
                        headName: head.name,
                        totalAmount: headTotalAmount,
                        requestCount: headRequestCount,
                        subHeads: subHeadSummaries.filter(sh => sh.requestCount > 0).sort((a,b) => b.totalAmount - a.totalAmount),
                    };
                });
                
                setSummary(summaryData.filter(h => h.requestCount > 0).sort((a,b) => b.totalAmount - a.totalAmount));

            } catch (error) {
                console.error("Error fetching account summary:", error);
                toast({ title: "Error", description: "Failed to fetch summary data.", variant: "destructive" });
            }
            setIsLoading(false);
        };
        
        fetchSummaryData();

    }, [isAuthLoading, canViewPage, toast]);
    
    if (isAuthLoading) {
      return (
        <div className="w-full px-4 sm:px-6 lg:px-8">
            <Skeleton className="h-10 w-96 mb-6" />
            <Skeleton className="h-96 w-full" />
        </div>
      )
    }

    if (!canViewPage) {
        return (
            <div className="w-full px-4 sm:px-6 lg:px-8">
                <div className="mb-6 flex items-center gap-2">
                    <Link href="/expenses/reports"><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
                    <h1 className="text-2xl font-bold">Head of Account Summary</h1>
                </div>
                <Card>
                    <CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission to view this report.</CardDescription></CardHeader>
                    <CardContent className="flex justify-center p-8"><ShieldAlert className="h-16 w-16 text-destructive" /></CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="w-full px-4 sm:px-6 lg:px-8">
            <div className="mb-6 flex items-center gap-2">
                <Link href="/expenses/reports">
                    <Button variant="ghost" size="icon">
                        <ArrowLeft className="h-6 w-6" />
                    </Button>
                </Link>
                <h1 className="text-2xl font-bold">Head of Account Summary</h1>
            </div>
            
            {isLoading ? (
                 <div className="space-y-2">
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                </div>
            ) : (
                <Accordion type="multiple" defaultValue={summary.map(s => s.headName)}>
                    {summary.map(head => (
                        <AccordionItem value={head.headName} key={head.headName}>
                            <AccordionTrigger className="text-lg font-semibold hover:no-underline">
                                <div className="flex justify-between w-full pr-4">
                                    <span>{head.headName}</span>
                                    <span className="text-right font-bold text-primary">
                                        {head.totalAmount.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}
                                    </span>
                                </div>
                            </AccordionTrigger>
                            <AccordionContent>
                                <Card>
                                    <CardContent className="p-0">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>Sub-Head of Account</TableHead>
                                                    <TableHead className="text-right">Total Requests</TableHead>
                                                    <TableHead className="text-right">Total Amount</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {head.subHeads.map(sub => (
                                                    <TableRow key={sub.subHeadName}>
                                                        <TableCell>{sub.subHeadName}</TableCell>
                                                        <TableCell className="text-right">{sub.requestCount.toLocaleString()}</TableCell>
                                                        <TableCell className="text-right">{sub.totalAmount.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </CardContent>
                                </Card>
                            </AccordionContent>
                        </AccordionItem>
                    ))}
                </Accordion>
            )}
        </div>
    );
}
