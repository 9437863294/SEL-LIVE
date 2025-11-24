
'use client';

import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import Link from 'next/link';
import { ArrowLeft, RefreshCw, Loader2, Calendar as CalendarIcon, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, query } from 'firebase/firestore';
import type { Employee, SalaryDetail } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';
import { syncSalary } from '@/ai';
import { format, getYear, startOfMonth } from 'date-fns';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export default function EmployeeSalaryPage() {
  const { toast } = useToast();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const [displayedEmployees, setDisplayedEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const currentYear = getYear(new Date());
  const currentMonth = new Date().getMonth();

  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [selectedMonth, setSelectedMonth] = useState<number>(currentMonth);

  const canView = can('View', 'Settings.Employee Management');
  const canSync = can('Sync from GreytHR', 'Settings.Employee Management');

  useEffect(() => {
    if (!isAuthLoading && !canView) {
      setIsLoading(false);
    }
  }, [isAuthLoading, canView]);

  const handleSync = async () => {
    if (!canSync) {
        toast({ title: "Permission Denied", description: "You don't have permission to sync salaries.", variant: "destructive" });
        return;
    }
    setIsSyncing(true);
    setDisplayedEmployees([]);
    
    try {
        const firstDayOfMonth = new Date(selectedYear, selectedMonth, 1);
        const monthString = format(firstDayOfMonth, 'yyyy-MM-dd');
        
        const result = await syncSalary({ month: monthString });
        if (result.success) {
            toast({
                title: 'Sync Successful',
                description: result.message,
            });
            setDisplayedEmployees(result.employees || []);
        } else {
            throw new Error(result.message);
        }
    } catch (error: any) {
         toast({
            title: 'Sync Failed',
            description: error.message || 'An unknown error occurred.',
            variant: 'destructive',
        });
        setDisplayedEmployees([]);
    } finally {
        setIsSyncing(false);
    }
  }

  const formatCurrency = (amount: number | undefined) => {
    if (typeof amount !== 'number' || isNaN(amount)) return 'N/A';
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
    }).format(amount);
  };
  
  const yearOptions = useMemo(() => {
      const startYear = currentYear - 5;
      return Array.from({ length: 10 }, (_, i) => startYear + i).reverse();
  }, [currentYear]);

  const monthOptions = useMemo(() => {
      return Array.from({ length: 12 }, (_, i) => ({
          value: i,
          label: format(new Date(2000, i), 'MMMM'),
      }));
  }, []);

  const toggleRowExpansion = (employeeId: string) => {
    setExpandedRows(prev => {
        const newSet = new Set(prev);
        if (newSet.has(employeeId)) {
            newSet.delete(employeeId);
        } else {
            newSet.add(employeeId);
        }
        return newSet;
    });
  };

  if (isAuthLoading) {
      return (
        <div className="w-full max-w-6xl mx-auto">
            <div className="mb-6"><Skeleton className="h-10 w-80" /></div>
            <Card><CardContent><Skeleton className="h-96" /></CardContent></Card>
        </div>
      )
  }

  if (!canView) {
    return <div>Access Denied</div>;
  }

  return (
    <div className="w-full max-w-6xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/settings/employee">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Employee Salary</h1>
            <p className="text-muted-foreground">View and manage salary details for all employees.</p>
          </div>
        </div>
         <div className="flex items-center gap-2">
            <Select value={String(selectedYear)} onValueChange={(val) => setSelectedYear(Number(val))}>
                <SelectTrigger className="w-[120px]">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {yearOptions.map(year => (
                        <SelectItem key={year} value={String(year)}>{year}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <Select value={String(selectedMonth)} onValueChange={(val) => setSelectedMonth(Number(val))}>
                <SelectTrigger className="w-[150px]">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {monthOptions.map(month => (
                        <SelectItem key={month.value} value={String(month.value)}>{month.label}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <Button onClick={handleSync} disabled={isSyncing || !canSync}>
                {isSyncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <RefreshCw className="mr-2 h-4 w-4" />}
                Sync Salary
            </Button>
        </div>
      </div>
      
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12"></TableHead>
                <TableHead>Employee ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Gross Salary</TableHead>
                <TableHead>Net Salary</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isSyncing ? (
                Array.from({length: 5}).map((_, i) => (
                    <TableRow key={i}>
                        <TableCell colSpan={5}><Skeleton className="h-6 w-full" /></TableCell>
                    </TableRow>
                ))
              ) : displayedEmployees.length > 0 ? (
                displayedEmployees.map(emp => (
                  <Fragment key={emp.employeeId}>
                    <TableRow onClick={() => toggleRowExpansion(emp.employeeId)} className="cursor-pointer">
                      <TableCell>
                         <Button size="icon" variant="ghost">
                            {expandedRows.has(emp.employeeId) ? <ChevronDown className="h-4 w-4"/> : <ChevronRight className="h-4 w-4"/>}
                         </Button>
                      </TableCell>
                      <TableCell>{emp.employeeId}</TableCell>
                      <TableCell>{emp.name}</TableCell>
                      <TableCell>{formatCurrency(emp.grossSalary)}</TableCell>
                      <TableCell>{formatCurrency(emp.netSalary)}</TableCell>
                    </TableRow>
                    {expandedRows.has(emp.employeeId) && (
                        <TableRow className="bg-muted/50 hover:bg-muted/50">
                            <TableCell colSpan={5} className="p-0">
                                <div className="p-4">
                                    <h4 className="font-semibold mb-2 ml-2">Salary Breakdown</h4>
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Component</TableHead>
                                                <TableHead>Type</TableHead>
                                                <TableHead className="text-right">Amount</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {(emp.salaryDetails || []).map((detail, index) => (
                                                <TableRow key={index}>
                                                    <TableCell>{detail.description}</TableCell>
                                                    <TableCell>
                                                        <Badge variant={detail.type === 'INCOME' ? 'secondary' : 'destructive'}>
                                                            {detail.type}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="text-right">{formatCurrency(detail.amount)}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            </TableCell>
                        </TableRow>
                    )}
                  </Fragment>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center">
                    No salary data to display. Please select a month and sync.
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

  