
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import type { Department, ExpenseRequest } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';

interface DepartmentSummary {
    departmentName: string;
    totalAmount: number;
    requestCount: number;
}

export default function DepartmentSummaryPage() {
    const { toast } = useToast();
    const { can, isLoading: isAuthLoading } = useAuthorization();
    const [summary, setSummary] = useState<DepartmentSummary[]>([]);
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
                const [deptsSnap, expensesSnap] = await Promise.all([
                    getDocs(collection(db, 'departments')),
                    getDocs(collection(db, 'expenseRequests'))
                ]);

                const departments = deptsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Department));
                const expenses = expensesSnap.docs.map(doc => doc.data() as ExpenseRequest);
                
                const summaryData = departments.map(dept => {
                    const deptExpenses = expenses.filter(exp => exp.departmentId === dept.id);
                    const totalAmount = deptExpenses.reduce((sum, exp) => sum + exp.amount, 0);
                    return {
                        departmentName: dept.name,
                        totalAmount: totalAmount,
                        requestCount: deptExpenses.length,
                    };
                });
                
                setSummary(summaryData.sort((a,b) => b.totalAmount - a.totalAmount));

            } catch (error) {
                console.error("Error fetching department summary:", error);
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
                    <h1 className="text-2xl font-bold">Department-wise Summary</h1>
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
                <h1 className="text-2xl font-bold">Department-wise Summary</h1>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>Total Expenses by Department</CardTitle>
                    <CardDescription>A summary of total requested amounts and the number of requests per department.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Department</TableHead>
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
                                <TableRow key={s.departmentName}>
                                    <TableCell className="font-medium">{s.departmentName}</TableCell>
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
