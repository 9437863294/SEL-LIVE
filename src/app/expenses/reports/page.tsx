
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, ShieldAlert, Calendar as CalendarIcon, Table as TableIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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


const pivotOptions = [
    { value: 'projectName', label: 'Project' },
    { value: 'departmentName', label: 'Department' },
    { value: 'headOfAccount', label: 'Head of Account' },
    { value: 'subHeadOfAccount', label: 'Sub-Head of Account' },
    { value: 'month', label: 'Month' },
];

const valueOptions = [
    { value: 'amount', label: 'Total Amount' },
    { value: 'count', label: 'Number of Requests' },
];

interface EnrichedExpense extends ExpenseRequest {
    projectName: string;
    departmentName: string;
    month: string;
}

export default function ExpenseReportsPage() {
    const { toast } = useToast();
    const { can, isLoading: isAuthLoading } = useAuthorization();
    
    const [allExpenses, setAllExpenses] = useState<EnrichedExpense[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const [filters, setFilters] = useState({
        dateRange: {
            from: startOfMonth(new Date()),
            to: endOfMonth(new Date()),
        } as DateRange | undefined,
    });
    
    const [pivotConfig, setPivotConfig] = useState({
        rows: 'projectName',
        columns: 'month',
        value: 'amount',
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

                const projectsMap = new Map(projectsSnap.docs.map(doc => [doc.id, (doc.data() as Project).projectName]));
                const deptsMap = new Map(deptsSnap.docs.map(doc => [doc.id, (doc.data() as Department).name]));

                const enrichedExpenses = expensesSnap.docs.map(doc => {
                    const data = doc.data() as ExpenseRequest;
                    return {
                        ...data,
                        projectName: projectsMap.get(data.projectId) || 'Unknown Project',
                        departmentName: deptsMap.get(data.departmentId) || 'Unknown Department',
                        month: format(new Date(data.createdAt), 'yyyy-MM'),
                    } as EnrichedExpense;
                });
                
                setAllExpenses(enrichedExpenses);

            } catch (error) {
                console.error("Error fetching initial data:", error);
                toast({ title: "Error", description: "Failed to fetch initial data.", variant: "destructive" });
            }
            setIsLoading(false);
        };
        
        fetchInitialData();
    }, [isAuthLoading, canViewPage, toast]);
    
    const filteredExpenses = useMemo(() => {
        if (isLoading) return [];
        return allExpenses.filter(exp => {
            const expDate = new Date(exp.createdAt);
            const isDateMatch = filters.dateRange?.from && filters.dateRange?.to 
                ? expDate >= filters.dateRange.from && expDate <= filters.dateRange.to
                : true;
            return isDateMatch;
        });
    }, [filters, allExpenses, isLoading]);
    
    const pivotData = useMemo(() => {
        if (!pivotConfig.rows || !pivotConfig.columns || filteredExpenses.length === 0) {
            return { rows: [], columns: [], data: new Map() };
        }

        const uniqueRowValues = Array.from(new Set(filteredExpenses.map(item => String(item[pivotConfig.rows as keyof EnrichedExpense]))));
        const uniqueColumnValues = Array.from(new Set(filteredExpenses.map(item => String(item[pivotConfig.columns as keyof EnrichedExpense])))).sort();
        
        const dataMap = new Map<string, any>();

        uniqueRowValues.forEach(rowValue => {
            const rowData: { [key: string]: number | string } = { __rowLabel: rowValue };
            let rowTotal = 0;

            uniqueColumnValues.forEach(colValue => {
                const filtered = filteredExpenses.filter(item => 
                    String(item[pivotConfig.rows as keyof EnrichedExpense]) === rowValue &&
                    String(item[pivotConfig.columns as keyof EnrichedExpense]) === colValue
                );

                if (pivotConfig.value === 'amount') {
                    const sum = filtered.reduce((acc, curr) => acc + curr.amount, 0);
                    rowData[colValue] = sum;
                    rowTotal += sum;
                } else { // count
                    const count = filtered.length;
                    rowData[colValue] = count;
                    rowTotal += count;
                }
            });
            
            rowData.__rowTotal = rowTotal;
            dataMap.set(rowValue, rowData);
        });
        
        return { rows: uniqueRowValues, columns: uniqueColumnValues, data: dataMap };

    }, [filteredExpenses, pivotConfig]);


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
                    <Link href="/expenses"><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
                    <h1 className="text-2xl font-bold">Expense Reports</h1>
                </div>
                <Card>
                    <CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission to view reports.</CardDescription></CardHeader>
                    <CardContent className="flex justify-center p-8"><ShieldAlert className="h-16 w-16 text-destructive" /></CardContent>
                </Card>
            </div>
        );
    }
    
    return (
        <div className="w-full px-4 sm:px-6 lg:px-8">
            <div className="mb-6 flex items-center gap-2">
                <Link href="/expenses">
                    <Button variant="ghost" size="icon">
                        <ArrowLeft className="h-6 w-6" />
                    </Button>
                </Link>
                <h1 className="text-2xl font-bold">Expense Pivot Report</h1>
            </div>

            <Card className="mb-6">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><TableIcon className="h-5 w-5" /> Report Configuration</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="space-y-2">
                        <Label>Rows</Label>
                        <Select value={pivotConfig.rows} onValueChange={(value) => setPivotConfig(prev => ({...prev, rows: value}))}>
                            <SelectTrigger><SelectValue/></SelectTrigger>
                            <SelectContent>{pivotOptions.map(opt => <SelectItem key={opt.value} value={opt.value} disabled={opt.value === pivotConfig.columns}>{opt.label}</SelectItem>)}</SelectContent>
                        </Select>
                    </div>
                     <div className="space-y-2">
                        <Label>Columns</Label>
                        <Select value={pivotConfig.columns} onValueChange={(value) => setPivotConfig(prev => ({...prev, columns: value}))}>
                            <SelectTrigger><SelectValue/></SelectTrigger>
                            <SelectContent>{pivotOptions.map(opt => <SelectItem key={opt.value} value={opt.value} disabled={opt.value === pivotConfig.rows}>{opt.label}</SelectItem>)}</SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label>Values</Label>
                        <Select value={pivotConfig.value} onValueChange={(value) => setPivotConfig(prev => ({...prev, value: value}))}>
                            <SelectTrigger><SelectValue/></SelectTrigger>
                            <SelectContent>{valueOptions.map(opt => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}</SelectContent>
                        </Select>
                    </div>
                     <div className="space-y-2">
                        <Label>Date Range</Label>
                        <Popover>
                            <PopoverTrigger asChild>
                              <Button id="date" variant={"outline"} className={cn("w-full justify-start text-left font-normal", !filters.dateRange && "text-muted-foreground")}>
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {filters.dateRange?.from ? (filters.dateRange.to ? <>{format(filters.dateRange.from, "LLL dd, y")} - {format(filters.dateRange.to, "LLL dd, y")}</> : format(filters.dateRange.from, "LLL dd, y")) : <span>Pick a date</span>}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar initialFocus mode="range" defaultMonth={filters.dateRange?.from} selected={filters.dateRange} onSelect={(range) => setFilters(prev => ({...prev, dateRange: range}))} numberOfMonths={2}/>
                            </PopoverContent>
                        </Popover>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Summary</CardTitle>
                </CardHeader>
                <CardContent>
                    {isLoading ? <Skeleton className="h-80 w-full" /> : (
                        <div className="overflow-x-auto border rounded-lg">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>{pivotOptions.find(o => o.value === pivotConfig.rows)?.label || 'Row'}</TableHead>
                                        {pivotData.columns.map(col => <TableHead key={col} className="text-right">{col}</TableHead>)}
                                        <TableHead className="text-right font-bold">Grand Total</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {pivotData.rows.map(rowValue => {
                                        const rowData = pivotData.data.get(rowValue);
                                        return (
                                            <TableRow key={rowValue}>
                                                <TableCell className="font-medium">{rowValue}</TableCell>
                                                {pivotData.columns.map(col => (
                                                    <TableCell key={col} className="text-right">
                                                        {pivotConfig.value === 'amount' ? (rowData[col] || 0).toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 }) : (rowData[col] || 0).toLocaleString()}
                                                    </TableCell>
                                                ))}
                                                <TableCell className="text-right font-bold">
                                                    {pivotConfig.value === 'amount' ? (rowData.__rowTotal || 0).toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 }) : (rowData.__rowTotal || 0).toLocaleString()}
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

    