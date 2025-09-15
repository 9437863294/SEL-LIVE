
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, ShieldAlert, Calendar as CalendarIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import type { AccountHead, SubAccountHead, ExpenseRequest, Project, Department } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { DateRange } from 'react-day-picker';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';

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
    const [allExpenses, setAllExpenses] = useState<ExpenseRequest[]>([]);
    const [allHeads, setAllHeads] = useState<AccountHead[]>([]);
    const [allSubHeads, setAllSubHeads] = useState<SubAccountHead[]>([]);
    const [allProjects, setAllProjects] = useState<Project[]>([]);
    const [allDepartments, setAllDepartments] = useState<Department[]>([]);

    const [filters, setFilters] = useState({
        projectId: 'all',
        departmentId: 'all',
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
                const [headsSnap, subHeadsSnap, expensesSnap, projectsSnap, deptsSnap] = await Promise.all([
                    getDocs(collection(db, 'accountHeads')),
                    getDocs(collection(db, 'subAccountHeads')),
                    getDocs(collection(db, 'expenseRequests')),
                    getDocs(collection(db, 'projects')),
                    getDocs(collection(db, 'departments')),
                ]);

                setAllHeads(headsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as AccountHead)));
                setAllSubHeads(subHeadsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as SubAccountHead)));
                setAllExpenses(expensesSnap.docs.map(doc => doc.data() as ExpenseRequest));
                setAllProjects(projectsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)));
                setAllDepartments(deptsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Department)));

            } catch (error) {
                console.error("Error fetching initial data:", error);
                toast({ title: "Error", description: "Failed to fetch initial data.", variant: "destructive" });
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
            const isDeptMatch = filters.departmentId === 'all' || exp.departmentId === filters.departmentId;
            const isDateMatch = filters.dateRange?.from && filters.dateRange?.to 
                ? expDate >= filters.dateRange.from && expDate <= filters.dateRange.to
                : true;
            return isProjectMatch && isDeptMatch && isDateMatch;
        });

        const summaryData = allHeads.map(head => {
            const relevantSubHeads = allSubHeads.filter(sh => sh.headId === head.id);
            let headTotalAmount = 0;
            let headRequestCount = 0;

            const subHeadSummaries = relevantSubHeads.map(subHead => {
                const subHeadExpenses = filteredExpenses.filter(exp => exp.subHeadOfAccount === subHead.name);
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

    }, [filters, allExpenses, allHeads, allSubHeads, isLoading, canViewPage]);
    
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

            <Card className="mb-6">
                <CardHeader><CardTitle>Filters</CardTitle></CardHeader>
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
                                    <>{format(filters.dateRange.from, "LLL dd, y")} - {format(filters.dateRange.to, "LLL dd, y")}</>
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
                                onSelect={(range) => setFilters(prev => ({...prev, dateRange: range}))}
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
                    <div className="w-full md:w-1/3">
                        <Label>Department</Label>
                        <Select value={filters.departmentId} onValueChange={(value) => setFilters(prev => ({...prev, departmentId: value}))}>
                            <SelectTrigger><SelectValue/></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Departments</SelectItem>
                                {allDepartments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                </CardContent>
            </Card>
            
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
