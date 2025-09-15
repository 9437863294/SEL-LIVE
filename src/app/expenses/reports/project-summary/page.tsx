
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import type { Project, ExpenseRequest } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';

interface ProjectSummary {
    projectName: string;
    totalAmount: number;
    requestCount: number;
}

export default function ProjectSummaryPage() {
    const { toast } = useToast();
    const { can, isLoading: isAuthLoading } = useAuthorization();
    const [summary, setSummary] = useState<ProjectSummary[]>([]);
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
                const [projectsSnap, expensesSnap] = await Promise.all([
                    getDocs(collection(db, 'projects')),
                    getDocs(collection(db, 'expenseRequests'))
                ]);

                const projects = projectsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project));
                const expenses = expensesSnap.docs.map(doc => doc.data() as ExpenseRequest);
                
                const summaryData = projects.map(proj => {
                    const projExpenses = expenses.filter(exp => exp.projectId === proj.id);
                    const totalAmount = projExpenses.reduce((sum, exp) => sum + exp.amount, 0);
                    return {
                        projectName: proj.projectName,
                        totalAmount: totalAmount,
                        requestCount: projExpenses.length,
                    };
                });
                
                setSummary(summaryData.sort((a,b) => b.totalAmount - a.totalAmount));

            } catch (error) {
                console.error("Error fetching project summary:", error);
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
                    <h1 className="text-2xl font-bold">Project-wise Summary</h1>
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
                <h1 className="text-2xl font-bold">Project-wise Summary</h1>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>Total Expenses by Project</CardTitle>
                    <CardDescription>A summary of total requested amounts and the number of requests per project.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Project</TableHead>
                                <TableHead className="text-right">Total Requests</TableHead>
                                <TableHead className="text-right">Total Amount</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                Array.from({ length: 5 }).map((_, i) => (
                                    <TableRow key={i}>
                                        <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                                        <TableCell className="text-right"><Skeleton className="h-5 w-16 ml-auto" /></TableCell>
                                        <TableCell className="text-right"><Skeleton className="h-5 w-24 ml-auto" /></TableCell>
                                    </TableRow>
                                ))
                            ) : summary.map(s => (
                                <TableRow key={s.projectName}>
                                    <TableCell className="font-medium">{s.projectName}</TableCell>
                                    <TableCell className="text-right">{s.requestCount.toLocaleString()}</TableCell>
                                    <TableCell className="text-right font-semibold">{s.totalAmount.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}
