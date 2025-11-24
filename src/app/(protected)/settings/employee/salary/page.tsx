

'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Edit, RefreshCw, Loader2, Calendar as CalendarIcon } from 'lucide-react';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format, startOfMonth } from 'date-fns';
import { cn } from '@/lib/utils';

export default function EmployeeSalaryPage() {
  const { toast } = useToast();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<Date>(startOfMonth(new Date()));

  const canView = can('View', 'Settings.Employee Management');
  const canSync = can('Sync from GreytHR', 'Settings.Employee Management');

  const fetchEmployees = useCallback(async () => {
    setIsLoading(true);
    try {
      const q = query(collection(db, 'employees'));
      const querySnapshot = await getDocs(q);
      const employeesData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Employee));
      setEmployees(employeesData);
    } catch (error) {
      console.error("Error fetching employees:", error);
      toast({
        title: 'Error',
        description: 'Failed to fetch employees.',
        variant: 'destructive',
      });
    } finally {
        setIsLoading(false);
    }
  }, [toast]);
  
  useEffect(() => {
    if (isAuthLoading) return;
    if (canView) {
      fetchEmployees();
    } else {
      setIsLoading(false);
    }
  }, [isAuthLoading, canView, fetchEmployees]);
  
  const handleSync = async () => {
    if (!canSync) {
        toast({ title: "Permission Denied", description: "You don't have permission to sync salaries.", variant: "destructive" });
        return;
    }
    setIsSyncing(true);
    try {
        const monthString = format(selectedMonth, 'yyyy-MM-01');
        const result = await syncSalary({ month: monthString });
        if (result.success) {
            toast({
                title: 'Sync Successful',
                description: result.message,
            });
            await fetchEmployees();
        } else {
            throw new Error(result.message);
        }
    } catch (error: any) {
         toast({
            title: 'Sync Failed',
            description: error.message || 'An unknown error occurred.',
            variant: 'destructive',
        });
    } finally {
        setIsSyncing(false);
    }
  }

  const formatCurrency = (amount: number | undefined) => {
    if (typeof amount !== 'number') return 'N/A';
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
    }).format(amount);
  };

  if (isAuthLoading || (isLoading && canView)) {
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
            <Popover>
                <PopoverTrigger asChild>
                    <Button
                        variant={"outline"}
                        className={cn(
                            "w-[240px] justify-start text-left font-normal",
                            !selectedMonth && "text-muted-foreground"
                        )}
                        >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {selectedMonth ? format(selectedMonth, "MMMM yyyy") : <span>Select a month</span>}
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                    <Calendar
                        mode="single"
                        selected={selectedMonth}
                        onSelect={(date) => date && setSelectedMonth(date)}
                        initialFocus
                    />
                </PopoverContent>
            </Popover>
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
              {employees.length > 0 ? (
                employees.map(emp => (
                  <TableRow key={emp.id}>
                    <TableCell>{emp.employeeId}</TableCell>
                    <TableCell>{emp.name}</TableCell>
                    <TableCell>{emp.department}</TableCell>
                    <TableCell>{emp.designation}</TableCell>
                    <TableCell>{formatCurrency((emp as any).grossSalary)}</TableCell>
                    <TableCell>{formatCurrency((emp as any).netSalary)}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center">No employees found.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

