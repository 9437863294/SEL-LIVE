

'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, ShieldAlert, Calendar as CalendarIcon, Table as TableIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import type { ExpenseRequest, Project, Department } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { DateRange } from 'react-day-picker';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';


const pivotOptions = [
    { value: 'projectName', label: 'Project' },
    { value: 'departmentName', label: 'Department' },
    { value: 'headOfAccount', label: 'Head of Account' },
    { value: 'subHeadOfAccount', label: 'Sub-Head of Account' },
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

interface PivotRow {
    type: 'data' | 'total';
    level: number;
    label: string;
    data: Record<string, number | string>;
    isExpanded?: boolean;
    subRows?: PivotRow[];
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
        rows: ['projectName'] as string[],
        columns: ['month'] as string[],
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
                const [expensesSnap, projectsSnap, deptsSnap] = await Promise.all([
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
        const { rows: rowFields, columns: colFields, value: valueField } = pivotConfig;
        if (rowFields.length === 0 || colFields.length === 0 || filteredExpenses.length === 0) {
            return { rows: [], columns: [], grandTotal: 0 };
        }

        const getColumnValues = (data: EnrichedExpense[], fields: string[]) => {
            if (fields.length === 0) return [{ key: 'Total', values: {} }];
            const field = fields[0];
            const uniqueValues = Array.from(new Set(data.map(item => String(item[field as keyof EnrichedExpense] || 'N/A')))).sort();
            
            const result: any[] = [];
            uniqueValues.forEach(value => {
                const filtered = data.filter(item => String(item[field as keyof EnrichedExpense] || 'N/A') === value);
                const subValues = getColumnValues(filtered, fields.slice(1));
                result.push({ key: value, values: subValues });
            });
            return result;
        };

        const flattenColumns = (cols: any[]): { key: string; path: string[] }[] => {
            if (cols.length === 0) return [];
            let flat: { key: string; path: string[] }[] = [];
            cols.forEach(col => {
                if (col.values && Object.keys(col.values).length > 0 && col.values[0]?.key !== 'Total') {
                     flattenColumns(col.values).forEach(subCol => {
                        flat.push({ key: subCol.key, path: [col.key, ...subCol.path] });
                    });
                } else {
                    flat.push({ key: col.key, path: [col.key] });
                }
            });
            return flat;
        };
        
        const columnHierarchy = getColumnValues(filteredExpenses, colFields);
        const flatCols = flattenColumns(columnHierarchy);

        const groupData = (data: EnrichedExpense[], level: number): PivotRow[] => {
            if (level >= rowFields.length) return [];

            const rowField = rowFields[level];
            const grouped = new Map<string, EnrichedExpense[]>();

            data.forEach(item => {
                const key = String(item[rowField as keyof EnrichedExpense] || 'N/A');
                if (!grouped.has(key)) grouped.set(key, []);
                grouped.get(key)!.push(item);
            });
            
            const result: PivotRow[] = [];
            
            Array.from(grouped.keys()).sort().forEach(key => {
                const items = grouped.get(key)!;
                const rowData: Record<string, number> = { __rowTotal: 0 };
                
                flatCols.forEach(col => {
                    const colKey = col.path.join('_');
                    const filteredItems = items.filter(item => {
                        return col.path.every((p, i) => String(item[colFields[i] as keyof EnrichedExpense]) === p);
                    });
                    const cellValue = filteredItems.reduce((acc, curr) => acc + (valueField === 'amount' ? curr.amount : 1), 0);
                    rowData[colKey] = cellValue;
                });
                rowData.__rowTotal = Object.values(rowData).reduce((sum, val) => sum + val, 0);

                const subRows = groupData(items, level + 1);

                result.push({
                    type: 'data',
                    level: level,
                    label: key,
                    data: rowData,
                    subRows: subRows.length > 0 ? subRows : undefined
                });
            });

            return result;
        };
        
        const finalRows = groupData(filteredExpenses, 0);
        const grandTotal = finalRows.reduce((acc, row) => acc + (row.data.__rowTotal as number), 0);
        
        return { rows: finalRows, columns: flatCols, grandTotal };

    }, [filteredExpenses, pivotConfig]);
    
     const handleRowConfigChange = (field: string) => {
        setPivotConfig(prev => {
            const newRows = prev.rows.includes(field)
                ? prev.rows.filter(r => r !== field)
                : [...prev.rows, field];
            return { ...prev, rows: newRows };
        });
    };
    
    const handleColConfigChange = (field: string) => {
        setPivotConfig(prev => {
            const newCols = prev.columns.includes(field)
                ? prev.columns.filter(c => c !== field)
                : [...prev.columns, field];
            return { ...prev, columns: newCols };
        });
    };

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
                    <CardHeader><CardTitle>Access Denied</CardTitle><p>You do not have permission to view reports.</p></CardHeader>
                    <CardContent className="flex justify-center p-8"><ShieldAlert className="h-16 w-16 text-destructive" /></CardContent>
                </Card>
            </div>
        );
    }
    
    const renderRows = (rows: PivotRow[], path: string[] = []) => {
        return rows.flatMap((row, index) => {
            const currentPath = [...path, row.label];
            const uniqueKey = `${row.level}-${currentPath.join('-')}`;
            const rowElement = (
                <TableRow key={uniqueKey} className={row.level === 0 ? 'bg-muted/50' : ''}>
                    <TableCell style={{ paddingLeft: `${(row.level * 1.5) + 1}rem` }} className="font-medium whitespace-nowrap">
                        {row.label}
                    </TableCell>
                    {pivotData.columns.map(col => (
                        <TableCell key={col.path.join('_')} className="text-right">
                           {pivotConfig.value === 'amount' ? (row.data[col.path.join('_')] || 0).toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 }) : (row.data[col.path.join('_')] || 0).toLocaleString()}
                        </TableCell>
                    ))}
                    <TableCell className="text-right font-bold">
                        {pivotConfig.value === 'amount' ? (row.data.__rowTotal || 0).toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 }) : (row.data.__rowTotal || 0).toLocaleString()}
                    </TableCell>
                </TableRow>
            );
            
            const subRowElements = row.subRows ? renderRows(row.subRows, currentPath) : [];
            return [rowElement, ...subRowElements];
        });
    };
    
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
                         <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" className="w-full justify-between">
                                    <span>{pivotConfig.rows.length > 0 ? `${pivotConfig.rows.length} selected` : 'Select Rows'}</span>
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="w-56">
                                <DropdownMenuLabel>Group By</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                {pivotOptions.map(opt => (
                                    <DropdownMenuCheckboxItem
                                        key={opt.value}
                                        checked={pivotConfig.rows.includes(opt.value)}
                                        onCheckedChange={() => handleRowConfigChange(opt.value)}
                                        onSelect={(e) => e.preventDefault()}
                                    >
                                        {opt.label}
                                    </DropdownMenuCheckboxItem>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                    <div className="space-y-2">
                        <Label>Columns</Label>
                         <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" className="w-full justify-between">
                                    <span>{pivotConfig.columns.length > 0 ? `${pivotConfig.columns.length} selected` : 'Select Columns'}</span>
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="w-56">
                                <DropdownMenuLabel>Columns</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                {[...pivotOptions, {value: 'month', label: 'Month'}].map(opt => (
                                    <DropdownMenuCheckboxItem
                                        key={opt.value}
                                        checked={pivotConfig.columns.includes(opt.value)}
                                        onCheckedChange={() => handleColConfigChange(opt.value)}
                                        onSelect={(e) => e.preventDefault()}
                                    >
                                        {opt.label}
                                    </DropdownMenuCheckboxItem>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>
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
                                        <TableHead>
                                            {pivotConfig.rows.map(r => pivotOptions.find(o => o.value === r)?.label).join(' / ')}
                                        </TableHead>
                                        {pivotData.columns.map(col => <TableHead key={col.path.join('_')} className="text-right whitespace-nowrap">{col.path.join(' - ')}</TableHead>)}
                                        <TableHead className="text-right font-bold whitespace-nowrap">Grand Total</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {renderRows(pivotData.rows)}
                                    <TableRow className="bg-muted font-bold text-lg">
                                       <TableCell>Grand Total</TableCell>
                                       {pivotData.columns.map(col => {
                                            const colKey = col.path.join('_');
                                            const colTotal = pivotData.rows.reduce((sum, row) => sum + ((row.data[colKey] as number) || 0), 0);
                                            return (
                                                <TableCell key={`total-${colKey}`} className="text-right">
                                                    {pivotConfig.value === 'amount' ? colTotal.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 }) : colTotal.toLocaleString()}
                                                </TableCell>
                                            )
                                       })}
                                       <TableCell className="text-right">
                                           {pivotConfig.value === 'amount' ? pivotData.grandTotal.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 }) : pivotData.grandTotal.toLocaleString()}
                                       </TableCell>
                                    </TableRow>
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

