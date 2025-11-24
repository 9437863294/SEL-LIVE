'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, RefreshCw, Loader2, Calendar as CalendarIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, query } from 'firebase/firestore';
import type { Employee } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';
import { syncSalary } from '@/ai';
import { format, getYear, startOfMonth } from 'date-fns';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

export default function EmployeeSalaryPage() {
  const { toast } = useToast();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const [displayedEmployees, setDisplayedEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);

  const currentYear = getYear(new Date());
  const currentMonth = new Date().getMonth(); // 0-11

  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [selectedMonth, setSelectedMonth] = useState<number>(currentMonth);

  const canView = can('View', 'Settings.Employee Management');
  const canSync = can('Sync from GreytHR', 'Settings.Employee Management');

  useEffect(() => {
    if (!isAuthLoading && !canView) {
      setIsLoading(false);
    } else if (!isAuthLoading && canView) {
      // Don't fetch anything by default, wait for user to sync
      setIsLoading(false);
    }
  }, [isAuthLoading, canView]);

  const handleSync = async () => {
    if (!canSync) {
        toast({ title: "Permission Denied", description: "You don't have permission to sync salaries.", variant: "destructive" });
        return;
    }
    setIsSyncing(true);
    setIsLoading(true);
    try {
        // Construct the first day of the selected month
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
        setIsLoading(false);
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
                <TableHead>Employee ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Designation</TableHead>
                <TableHead>Gross Salary</TableHead>
                <TableHead>Net Salary</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({length: 5}).map((_, i) => (
                    <TableRow key={i}>
                        <TableCell colSpan={6}><Skeleton className="h-6 w-full" /></TableCell>
                    </TableRow>
                ))
              ) : displayedEmployees.length > 0 ? (
                displayedEmployees.map(emp => (
                  <TableRow key={emp.employeeId}>
                    <TableCell>{emp.employeeId}</TableCell>
                    <TableCell>{emp.name}</TableCell>
                    <TableCell>{emp.department || 'N/A'}</TableCell>
                    <TableCell>{emp.designation || 'N/A'}</TableCell>
                    <TableCell>{formatCurrency(emp.grossSalary)}</TableCell>
                    <TableCell>{formatCurrency(emp.netSalary)}</TableCell>
                  </TableRow>
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
