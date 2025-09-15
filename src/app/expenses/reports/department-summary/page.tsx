
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, ShieldAlert, Calendar as CalendarIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import type { Department, ExpenseRequest, Project } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { DateRange } from 'react-day-picker';
import { format, startOfMonth, endOfMonth, startOfYear, endOfYear } from 'date-fns';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';

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
    const [allExpenses, setAllExpenses] = useState<ExpenseRequest[]>([]);
    const [allDepartments, setAllDepartments] = useState<Department[]>([]);
    const [allProjects, setAllProjects] = useState<Project[]>([]);
    
    const [filters, setFilters] = useState({
        projectId: 'all',
        dateRange: {
            from: startOfMonth(new Date()),
            to: endOfMonth(new Date()),
        } as DateRange | undefined,
    });

    const canViewPage = can('View All', 'Expenses.Expense Requests');

    useEffect(() => {
        if (isAuthLoading) return;
        if (!canViewPage) {
            setIsLoading(false);
            return;
        }

        const fetchInitialData = async () => {
            setIsLoading(true);
            try {
                const [deptsSnap, expensesSnap, projectsSnap] = await Promise.all([
                    getDocs(collection(db, 'departments')),
                    getDocs(collection(db, 'expenseRequests')),
                    getDocs(collection(db, 'projects')),
                ]);

                setAllDepartments(deptsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Department)));
                setAllExpenses(expensesSnap.docs.map(doc => doc.data() as ExpenseRequest));
                setAllProjects(projectsSnap.docs.map(doc => ({id: doc.id, ...doc.data()} as Project)));

            } catch (error) {
                console.error("Error fetching initial data:", error);
                toast({ title: "Error", description: "Failed to fetch initial data for report.", variant: "destructive" });
            }
            setIsLoading(false);
        };
        
        fetchInitialData();

    }, [isAuthLoading, canViewPage, toast]);
    
     useEffect(() => {
        if (isLoading || !canViewPage) return;
        
        const filteredExpenses = allExpenses.filter(exp => {
            const expDate = new Date(exp.createdAt);
            const isProjectMatch = filters.projectId === 'all' || exp.projectId === filters.projectId;
            const isDateMatch = filters.dateRange?.from && filters.dateRange?.to 
                ? expDate >= filters.dateRange.from && expDate <= filters.dateRange.to
                : true;
            return isProjectMatch && isDateMatch;
        });

        const summaryData = allDepartments.map(dept => {
            const deptExpenses = filteredExpenses.filter(exp => exp.departmentId === dept.id);
            const totalAmount = deptExpenses.reduce((sum, exp) => sum + exp.amount, 0);
            return {
                departmentName: dept.name,
                totalAmount: totalAmount,
                requestCount: deptExpenses.length,
            };
        });
        
        setSummary(summaryData.sort((a, b) => b.totalAmount - a.totalAmount));

    }, [filters, allExpenses, allDepartments, isLoading, canViewPage]);

    if (isAuthLoading) {
      return (
        <div className="w-full px-4 sm:px-6 lg:px-8">
            <Skeleton className="h-10 w-96 mb-6" />
            <Skeleton className="h-24 w-full mb-6" />
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

            <Card className="mb-6">
                <CardHeader>
                    <CardTitle>Filters</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col md:flex-row gap-4">
                    <div className="w-full md:w-1/3">
                         <Label>Date Range</Label>
                         <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                id="date"
                                variant={"outline"}
                                className={cn(
                                  "w-full justify-start text-left font-normal",
                                  !filters.dateRange && "text-muted-foreground"
                                )}
                              >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {filters.dateRange?.from ? (
                                  filters.dateRange.to ? (
                                    <>
                                      {format(filters.dateRange.from, "LLL dd, y")} -{" "}
                                      {format(filters.dateRange.to, "LLL dd, y")}
                                    </>
                                  ) : (
                                    format(filters.dateRange.from, "LLL dd, y")
                                  )
                                ) : (
                                  <span>Pick a date</span>
                                )}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                initialFocus
                                mode="range"
                                defaultMonth={filters.dateRange?.from}
                                selected={filters.dateRange}
                                onSelect={(range) => setFilters(prev => ({ ...prev, dateRange: range }))}
                                numberOfMonths={2}
                              />
                            </PopoverContent>
                          </Popover>
                    </div>
                     <div className="w-full md:w-1/3">
                        <Label>Project</Label>
                        <Select value={filters.projectId} onValueChange={(value) => setFilters(prev => ({...prev, projectId: value}))}>
                            <SelectTrigger><SelectValue/></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Projects</SelectItem>
                                {allProjects.map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                </CardContent>
            </Card>

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
